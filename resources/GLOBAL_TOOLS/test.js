// 南开大学（研究生）教育综合管理系统 拾光课程表适配脚本
// 适用系统: https://yjs.nankai.edu.cn/   入口: 培养 → 个人课表 (py/page/student/grkcb.htm)
//
// 要点:
//   1. 服务端渲染(JSP)输出表格, 无 JSON 接口, 只能解析 DOM;
//   2. 表格按「周次」分周渲染, 同一门课只在它真正上课的那一周出现 —— 逐周抓取第 1 ~ N 周, 每周抓
//      到什么就记一条 weeks=[N] 的原子记录; 跨周合并 / 连续节次合并 / 去重交给官方函数处理;
//   3. 只抓一次不带参数的课表页: 学年 / 学期 / 周次三个 <select>（选中项即学校默认学期）与作息
//      说明都在这一份响应里; 学年学期不给用户挑, 确认框列出学年 / 学期 / 开学日期后直接导入。
//
// 维护者: Cure   |   出现问题请提 issues 或提交 PR

/* 包在 IIFE 里: 不污染教务页面全局, 重复注入时顶层 const 也不会重复声明（函数体不再缩进一级）。 */
(function () {
'use strict';

/* ============================ 常量 ============================ */

// 课表页路径（系统内所有页面均为 /<模块>/page/<角色>/<页面>.htm 结构）
const NKU_KB_PAGE = '/py/page/student/grkcb.htm';

// 逐周抓取的并发数（同一 JSP 会话并发过高会被串行化, 3 比较稳）
const NKU_FETCH_CONCURRENCY = 3;

// 兜底作息: 正常从课表页正文解析, 这里只作解析失败（页面改版）时的保底; 下标 + 1 即节次
const NKU_FALLBACK_TIME_SLOTS = [
    '08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40', '12:00-12:45',
    '12:55-13:40', '14:00-14:45', '14:55-15:40', '16:00-16:45', '16:55-17:40',
    '18:30-19:15', '19:25-20:10', '20:20-21:05', '21:15-22:00'
].map((range, index) => {
    const [startTime, endTime] = range.split('-');
    return { number: index + 1, startTime, endTime };
});

// 开学日期（第 1 周周一）推算基准 = [月, 日, 年偏移]: 取基准日当天或之后的第一个周一（系统无校历）
const NKU_TERM_BASE = {
    '11': [9, 1, 0],  // 第一学期: 当年 9 月 1 日
    '12': [2, 20, 1], // 第二学期: 次年 2 月 20 日
    '13': [7, 1, 0]   // 短学期:   当年 7 月 1 日
};

/* ============================ 通用工具 ============================ */

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字 -> 整数（支持 一 ~ 九十九）; 无法解析返回 NaN */
function cnToInt(text) {
    const s = String(text || '').replace(/\s/g, '');
    if (!s) return NaN;
    if (s === '十') return 10;
    if (s.length === 1) return Object.prototype.hasOwnProperty.call(CN_DIGITS, s) ? CN_DIGITS[s] : NaN;
    const idx = s.indexOf('十');
    if (idx === -1) return NaN;
    const high = idx === 0 ? 1 : CN_DIGITS[s[idx - 1]];
    const low = idx === s.length - 1 ? 0 : CN_DIGITS[s[idx + 1]];
    return (high === undefined || low === undefined) ? NaN : high * 10 + low;
}

/** 规整空白与全角空格 */
function normalizeText(text) {
    return String(text == null ? '' : text).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "8:00" / "08:00:00" -> "08:00"; 非法返回 null */
function formatTime(value) {
    const match = typeof value === 'string' ? value.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/) : null;
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "08:45" -> 525; 非法返回 -1 */
function timeToMinutes(value) {
    const t = formatTime(value);
    return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : -1;
}

/** 日期 -> "YYYY-MM-DD" */
function formatDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ============================ 桥接层 ============================ */

function showToast(message) {
    try { window.shiguangBridge.showToast(message); } catch { /* 提示失败不打断导入 */ }
}

function notifyTaskCompletion() {
    try { window.shiguangBridge.notifyTaskCompletion(); } catch { /* 结束信号交给宿主处理 */ }
}

const bridgeSupports = method =>
    !!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise[method] === 'function');

/* ============================ 页面解析 ============================ */

/** 把表格展开成二维网格, 正确处理 rowspan / colspan（课表用 rowspan 跨节次） */
function buildTableGrid(table) {
    const grid = [];
    const occupied = [];

    Array.from(table.querySelectorAll('tr')).forEach((tr, rowIndex) => {
        let col = 0;
        Array.from(tr.children).forEach(cell => {
            const tag = (cell.tagName || '').toLowerCase();
            if (tag !== 'td' && tag !== 'th') return;

            while (occupied[rowIndex] && occupied[rowIndex][col]) col++;
            const colspan = Math.max(parseInt(cell.getAttribute('colspan') || '1', 10) || 1, 1);
            const rowspan = Math.max(parseInt(cell.getAttribute('rowspan') || '1', 10) || 1, 1);

            for (let i = 0; i < rowspan; i++) {
                const r = rowIndex + i;
                grid[r] = grid[r] || [];
                occupied[r] = occupied[r] || [];
                for (let j = 0; j < colspan; j++) {
                    if (!i && !j) grid[r][col] = cell;
                    occupied[r][col + j] = true;
                }
            }
            col += colspan;
        });
    });

    return grid;
}

/** 表头形如 <th colspan="2">时间</th><th>星期一</th>… -> { 列下标: 星期(1~7) } */
function findDayColumns(grid) {
    const dayChars = '一二三四五六日';
    const map = {};
    (grid[0] || []).forEach((cell, col) => {
        if (!cell) return;
        const match = normalizeText(cell.textContent).replace(/\s/g, '').match(/^星期([一二三四五六日天])$/);
        if (!match) return;
        const day = dayChars.indexOf(match[1] === '天' ? '日' : match[1]) + 1;
        if (day >= 1 && day <= 7) map[col] = day;
    });
    return map;
}

/** 课表主表格 */
function findTimetable(doc) {
    const direct = doc.querySelector('table.table-course');
    if (direct && /星期/.test(direct.textContent || '')) return direct;

    return Array.from(doc.querySelectorAll('table')).find(table =>
        /星期一/.test(table.textContent || '') && /第\s*\d+\s*节/.test(table.textContent || '')) || null;
}

/** 单元格里的 <a> -> 按行切分的文本数组（<br> 视为换行）: 课程名 / 周次说明 / 第X节 -- 第Y节 / 教师 / 地点 */
function anchorToLines(anchor) {
    const clone = anchor.cloneNode(true);
    Array.from(clone.querySelectorAll('br')).forEach(br => {
        br.parentNode.replaceChild(document.createTextNode('\n'), br);
    });
    return String(clone.textContent || '').replace(/\u00a0/g, ' ').split('\n')
        .map(line => normalizeText(line)).filter(Boolean);
}

/** 解析一个课程链接 -> { name, teacher, position, day, startSection, endSection }
 *  周次不在这里判断: 抓取哪一周, 这条记录就属于哪一周（见 crawlAllWeeks 的原子化） */
function parseCourseAnchor(anchor, day) {
    const lines = anchorToLines(anchor);
    const strong = anchor.querySelector('strong');
    let name = normalizeText(strong ? strong.textContent : '') || normalizeText(lines[0] || '');
    name = name.replace(/^[|\s]+/, '');
    if (!name) return null;

    // 「第X节 -- 第Y节」所在行
    const sectionIdx = lines.findIndex(line => /第\s*\d+\s*节/.test(line));
    if (sectionIdx < 0) return null;

    const numbers = (lines[sectionIdx].match(/第\s*(\d+)\s*节/g) || [])
        .map(token => Number(token.replace(/\D/g, ''))).filter(num => num > 0);
    if (!numbers.length) return null;

    // 教师 / 地点紧随节次行; 有些课程没有独立教师行, 此时第一行其实是地点
    let teacher = normalizeText(lines[sectionIdx + 1] || '');
    let position = normalizeText(lines[sectionIdx + 2] || '');
    if (!position && /楼|室|馆|场地|校区|通知|待定/.test(teacher)) {
        position = teacher;
        teacher = '';
    }

    if (!(day >= 1 && day <= 7)) return null;
    return {
        name,
        teacher,
        position: position || '待定',
        day,
        startSection: Math.min.apply(null, numbers),
        endSection: Math.max.apply(null, numbers)
    };
}

/** 解析某一周课表页面里的所有课程; null 表示页面里找不到课表（可能登录已失效） */
function parseTimetableDoc(doc) {
    const table = findTimetable(doc);
    if (!table) return null;

    const grid = buildTableGrid(table);
    const dayColumns = findDayColumns(grid);
    const colKeys = Object.keys(dayColumns);
    if (colKeys.length === 0) return null;

    const courses = [];
    for (let row = 1; row < grid.length; row++) {
        colKeys.forEach(key => {
            const cell = grid[row] ? grid[row][Number(key)] : null;
            if (!cell) return;
            // 同一格可能塞了多门课（冲突课程）, 逐个解析
            Array.from(cell.querySelectorAll('a'))
                .filter(anchor => /第\s*\d+\s*节/.test(anchor.textContent || ''))
                .forEach(anchor => {
                    const course = parseCourseAnchor(anchor, dayColumns[key]);
                    if (course) courses.push(course);
                });
        });
    }
    return courses;
}

/** 从页面底部说明文字解析作息时间, 形如 "上午:第一节 8:00-8:45 第二节8:55-9:40 …"
 *  时间段必须从 1 开始且编号连续, 否则返回 null 交给兜底表 */
function parseTimeSlotsFromDoc(doc) {
    const bodyText = doc && doc.body ? doc.body.textContent || '' : '';
    if (!bodyText) return null;

    const normalized = bodyText
        .replace(/[：]/g, ':')
        .replace(/[–—~～至]/g, '-')
        .replace(/\s+/g, ' ');
    const pattern = /第([一二三四五六七八九十]+)节?:?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g;
    const collected = new Map();
    let match;

    while ((match = pattern.exec(normalized)) !== null) {
        const number = cnToInt(match[1]);
        const startTime = formatTime(match[2]);
        const endTime = formatTime(match[3]);
        if (!number || !startTime || !endTime) continue;
        if (timeToMinutes(startTime) >= timeToMinutes(endTime)) continue;
        collected.set(number, { number, startTime, endTime });
    }

    const slots = Array.from(collected.values()).sort((a, b) => a.number - b.number);
    if (!slots.length) return null;
    return slots.every((slot, index) => slot.number === index + 1) ? slots : null;
}

/* ============================ 合并与去重（官方参考实现）============================ */

/** 拾光官方《课程合并与去重函数》的参考实现, 照搬（只精简了注释）:
 *  https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
 *  输入 / 输出都是原子课程 { name, teacher, position, day, startSection, endSection, weeks } */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(course => Object.assign({}, course, {
        name: course.name || '',
        teacher: course.teacher || '',
        position: course.position || '',
        weeks: Array.isArray(course.weeks) ? [].concat(course.weeks).sort((a, b) => a - b) : []
    }));

    // 阶段 1: 合并连续节次与完全重复的记录（前提: 名称 / 教师 / 地点 / 星期 / 周次一致）
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0));

    const withSections = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameWeeks = current.name === next.name
            && current.teacher === next.teacher
            && current.position === next.position
            && current.day === next.day
            && current.weeks.join(',') === next.weeks.join(',');
        if (sameWeeks && current.endSection + 1 === next.startSection) {
            current.endSection = next.endSection;
        } else if (sameWeeks && current.startSection === next.startSection && current.endSection === next.endSection) {
            continue;
        } else {
            withSections.push(current);
            current = next;
        }
    }
    withSections.push(current);

    // 阶段 2: 合并同节次的周次（前提: 名称 / 教师 / 地点 / 星期 / 起止节次一致）
    withSections.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0));

    const merged = [];
    let head = withSections[0];
    for (let i = 1; i < withSections.length; i++) {
        const next = withSections[i];
        const sameSection = head.name === next.name
            && head.teacher === next.teacher
            && head.position === next.position
            && head.day === next.day
            && head.startSection === next.startSection
            && head.endSection === next.endSection;
        if (sameSection) {
            head.weeks = Array.from(new Set([].concat(head.weeks, next.weeks))).sort((a, b) => a - b);
        } else {
            merged.push(head);
            head = next;
        }
    }
    merged.push(head);

    return merged;
}

/* ============================ 列表读取与抓取 ============================ */

/** <select> 的选项 -> [{ value, label, selected }] */
function readSelectOptions(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.querySelectorAll('option'))
        .map(option => ({
            value: normalizeText(option.value),
            label: normalizeText(option.textContent || option.value),
            selected: option.selected === true || option.hasAttribute('selected')
        }))
        .filter(option => option.value !== '');
}

/** 页面已选中的选项值; 没有选中项时返回空串 */
function selectedValue(options) {
    const selected = options.find(option => option.selected);
    return selected ? selected.value : '';
}

/** 文档是否为本系统的课表页 —— 用来区分「这一周没课」和「登录失效 / 请求被拦」 */
const looksLikeCoursePage = doc =>
    !!(doc && (doc.querySelector('#kcbForm') || doc.querySelector('#zc') || doc.querySelector('#xn')));

/** 课表页地址; 不带任何参数即为系统默认的当前学期 */
const kbPageUrl = (xn, xj, zc) =>
    `${NKU_KB_PAGE}?xn=${encodeURIComponent(xn)}&xj=${encodeURIComponent(xj)}&zc=${encodeURIComponent(zc)}`;

/** 抓一个页面并解析成 DOM。请求失败 / 状态异常一律抛出, 由调用方统一按「没抓到」处理 */
async function fetchCourseDoc(url) {
    const response = await fetch(url, { method: 'GET', credentials: 'include' });
    if (!response.ok) throw new Error('页面请求失败');
    return new DOMParser().parseFromString(await response.text(), 'text/html');
}

/** 简单的并发池 */
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < tasks.length) {
            const index = cursor++;
            results[index] = await tasks[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

/** 逐周抓取: 第 N 周抓到的每门课都记成一条原子记录（weeks = [N]）, 不做任何归并。
 *  返回 { courses, okWeeks }; okWeeks = 成功取到课表页的周次数（0 表示整轮都没抓到）。 */
async function crawlAllWeeks(xn, xj, weeks) {
    const tasks = weeks.map(week => async () => {
        try {
            const doc = await fetchCourseDoc(kbPageUrl(xn, xj, week));
            const list = parseTimetableDoc(doc);
            if (list) return { week, list };
            // 是本系统的课表页却没有表格 —— 多为超出本学期周次范围, 按当周无课处理
            return looksLikeCoursePage(doc) ? { week, list: [] } : null;
        } catch {
            return null;
        }
    });

    const courses = [];
    let okWeeks = 0;

    (await runWithConcurrency(tasks, NKU_FETCH_CONCURRENCY)).forEach(result => {
        if (!result) return;
        okWeeks++;
        result.list.forEach(course => courses.push(Object.assign({}, course, { weeks: [result.week] })));
    });

    return { courses, okWeeks };
}

/* ============================ 页面读取与确认 ============================ */

/** 取某个值在选项里的显示文本（学年形如 2026-2027, 学期形如 第一学期）; 找不到就用原始值 */
const labelOf = (options, value) => (options.find(option => option.value === value) || {}).label || value;

/** 第 1 周周一 = 基准日当天或之后的第一个周一; 学期代码认不出来时按第一学期 */
function guessStartDate(xn, xj) {
    const [month, day, offset] = NKU_TERM_BASE[String(xj)] || NKU_TERM_BASE['11'];
    const date = new Date((Number(xn) || new Date().getFullYear()) + offset, month - 1, day);
    date.setDate(date.getDate() + (8 - date.getDay()) % 7); // 当天就是周一则不动
    return formatDate(date);
}

/** 抓一次不带参数的课表页, 一次读齐: 学年与学期的值及显示文本（页面选中项 = 学校当前学期）、
 *  周次列表、作息时间、按学期规则推算的开学日期。读不到下拉框（登录失效 / 页面改版）返回 null */
async function loadCoursePage() {
    let doc;
    try {
        doc = await fetchCourseDoc(NKU_KB_PAGE);
    } catch {
        return null;
    }

    const xnOptions = readSelectOptions(doc.querySelector('#xn'));
    const xjOptions = readSelectOptions(doc.querySelector('#xj'));
    const weeks = readSelectOptions(doc.querySelector('#zc'))
        .map(option => Number(option.value)).filter(value => value > 0);
    const xn = selectedValue(xnOptions);
    const xj = selectedValue(xjOptions);
    if (!xn || !xj || !weeks.length) return null;

    return {
        xn,
        xj,
        xnLabel: labelOf(xnOptions, xn),
        xjLabel: labelOf(xjOptions, xj),
        startDate: guessStartDate(xn, xj),
        weeks,
        timeSlots: parseTimeSlotsFromDoc(doc)
    };
}

/** 导入信息确认框: 列出学年 / 学期 / 开学日期, 只能确认或关掉（关掉 = 放弃导入） */
async function confirmTerm(page) {
    if (!bridgeSupports('showAlert')) return true;

    const content = '即将导入以下内容，请确认：\n\n'
        + `　学年　　　${page.xnLabel}\n`
        + `　学期　　　${page.xjLabel}\n`
        + `　开学日期　${page.startDate}（周一）\n\n`
        + '学年与学期取自教务系统的默认学期，开学日期按学期规则推算。;
    try {
        return await window.shiguangBridgePromise.showAlert('确认导入信息', content, '开始导入') === true;
    } catch {
        return true;
    }
}

/* ============================ 保存 ============================ */

/** 调用桥接层的保存接口; 失败时给一句笼统提示（不带原始异常）并返回 false */
async function saveVia(method, payload, failMessage) {
    try {
        await window.shiguangBridgePromise[method](JSON.stringify(payload));
        return true;
    } catch {
        showToast(failMessage);
        return false;
    }
}

/** 从作息时间推算单节课与课间时长, 用于课表配置 */
function deriveDurations(timeSlots) {
    const fallback = { classDuration: 45, breakDuration: 10 };
    if (!Array.isArray(timeSlots) || timeSlots.length < 2) return fallback;

    const classDuration = timeToMinutes(timeSlots[0].endTime) - timeToMinutes(timeSlots[0].startTime);
    const breakDuration = timeToMinutes(timeSlots[1].startTime) - timeToMinutes(timeSlots[0].endTime);
    return (classDuration > 0 && breakDuration >= 0) ? { classDuration, breakDuration } : fallback;
}

/* ============================ 主流程 ============================ */

async function importFlow() {
    // 1. 抓一次无参课表页: 学年学期默认值、周次列表、作息时间都出在这一份响应里; 抓不到即中止
    const page = await loadCoursePage();
    if (!page) {
        showToast('导入失败：未获取到课表数据，请重新登录后重试。');
        return;
    }

    // 2. 确认框: 列出学年 / 学期 / 开学日期, 只能确认或关掉
    if (!await confirmTerm(page)) {
        showToast('已取消导入。');
        return;
    }

    // 3. 逐周抓取 -> 原子课程 -> 交给官方函数合并去重
    const crawl = await crawlAllWeeks(page.xn, page.xj, page.weeks);
    if (!crawl.okWeeks) {
        showToast('导入失败：未获取到课表数据，请重新登录后重试。');
        return;
    }
    if (!crawl.courses.length) {
        showToast('未查询到课程，请确认所选学年学期是否正确。');
        return;
    }
    const courses = mergeAndDistinctCourses(crawl.courses);

    // 4. 保存: 课程 -> 作息时间 -> 课表配置
    const timeSlots = page.timeSlots || NKU_FALLBACK_TIME_SLOTS;
    if (!await saveVia('saveImportedCourses', courses, '课程保存失败')) return;
    await saveVia('savePresetTimeSlots', timeSlots, '导入作息时间失败');

    // 开学日期用推算出来的第 1 周周一
    const durations = deriveDurations(timeSlots);
    await saveVia('saveCourseConfig', {
        semesterStartDate: page.startDate,
        semesterTotalWeeks: courses.reduce((max, course) => Math.max(max, ...course.weeks), 1),
        defaultClassDuration: durations.classDuration,
        defaultBreakDuration: durations.breakDuration,
        firstDayOfWeek: 1
    }, '保存课表配置失败');

    // 5. 完成
    notifyTaskCompletion();
}

/* ============================ 入口 ============================ */

// 宿主在用户点击「开始导入」后注入本脚本, 所以顶层直接启动: 抓一次课表页 -> 确认框 -> 逐周抓取
importFlow();

})();
