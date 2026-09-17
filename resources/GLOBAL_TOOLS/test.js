// 南开大学（研究生）教育综合管理系统 拾光课程表适配脚本
// 适用系统: https://yjs.nankai.edu.cn/   —— 培养 → 个人课表 (py/page/student/grkcb.htm)
//
// 系统特点（决定了本脚本的实现方式）:
//   1. 服务端渲染(JSP)页面, 课表以 HTML 表格输出, 没有可用的 JSON 接口;
//   2. 课表按「周次」参数 zc 分周渲染 —— 同一门课只会在它真正上课的那一周出现在表格里,
//      单元格内的「十七周 / 前八周」只是给用户看的说明文字;
//   3. 因此本脚本会依次抓取第 1 ~ N 周的课表, 用「课程在第几周出现过」来还原真实周次,
//      这比解析中文周次说明更准确。脚本同时保留中文说明的解析作为兜底与自检:
//      若某些课程出现的周次明显超出其说明文字(说明本系统当前并未分周渲染),
//      则自动改用说明文字推导周次, 保证两种情况都能正确导入。
//   4. 「以下课程时间地点待定」表格里的课程没有具体星期/节次, 无法导入课表。
//      脚本会在开始抓取前单独弹一个红色警告样式的确认框（⚠️ + 逐条课程清单）,
//      用户确认后才继续导入（取消则整个导入中止）。
//      注: 桥接层的弹窗没有颜色参数, 红色样式是靠在弹窗显示期间覆盖插件的 CSS 实现的,
//      应用端若用原生弹窗则样式不生效, 但弹窗本身与 ⚠️ 文案照常显示。
//
// 维护者: Cure   |   出现问题请提 issues 或提交 PR

/* =========================================================================
 * 整个脚本包在 IIFE 中执行, 原因有两个:
 *   1. 不污染教务系统页面的全局作用域（页面本身加载了 jQuery 与一堆业务脚本）;
 *   2. 脚本被重复注入（例如用户连续点两次导入）时, 顶层 const 重复声明会直接抛错,
 *      用 IIFE 包起来就天然幂等。
 * 为保持 diff 可读, 函数体没有再向内缩进一级。
 * ========================================================================= */
(function () {
'use strict';

/* ============================ 常量 ============================ */

// 课表页面路径（系统内所有页面均为 /<模块>/page/<角色>/<页面>.htm 结构）
const NKU_KB_PAGE = '/py/page/student/grkcb.htm';

// 抓取周次时的并发数（同一 JSP 会话并发过高可能被串行化, 3 是比较稳的值）
const NKU_FETCH_CONCURRENCY = 3;

// 学期日期(base) 与 学期代码(#xj) 的对应关系
// 系统不提供开学日期, 这里只用来给出推算基准, 最终仍需用户确认
const NKU_TERM_BASE = {
    '11': { month: 8, day: 1, yearOffset: 0 }, // 第一学期: 当年 9 月 1 日之后第一个周一
    '13': { month: 5, day: 20, yearOffset: 0 }, // 短学期:  当年 6 月 20 日之后第一个周一
    '12': { month: 1, day: 20, yearOffset: 1 } // 第二学期: 次年 2 月 20 日之后第一个周一
};

// 兜底的作息时间（南开大学研究生课程, 取自课表页底部说明文字）
// 正常情况下脚本会直接从页面上解析, 这里只作为解析失败时的保底
const NKU_FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '12:00', endTime: '12:45' },
    { number: 6, startTime: '12:55', endTime: '13:40' },
    { number: 7, startTime: '14:00', endTime: '14:45' },
    { number: 8, startTime: '14:55', endTime: '15:40' },
    { number: 9, startTime: '16:00', endTime: '16:45' },
    { number: 10, startTime: '16:55', endTime: '17:40' },
    { number: 11, startTime: '18:30', endTime: '19:15' },
    { number: 12, startTime: '19:25', endTime: '20:10' },
    { number: 13, startTime: '20:20', endTime: '21:05' },
    { number: 14, startTime: '21:15', endTime: '22:00' }
];

/* ---- 「时间地点待定」警告弹窗的配色 ----
 * 桥接层的 showAlert 只接受 (标题, 正文, 按钮文字), 没有颜色参数, 所以只能在我们
 * 自己的对话框显示期间往页面里插一段样式来覆盖它。选择器沿用插件内联对话框的 id
 * （#bridge-dialog-overlay / #bridge-dialog-container）, 用 !important 压过它的内联样式。
 * 如果应用端用的是原生弹窗（DOM 里找不到这些节点）, 这段样式不会生效 —— 属于尽力而为,
 * 失败没有任何副作用, 弹窗本身照常显示。
 */
const NKU_WARNING_STYLE_ID = 'nku-pending-warning-style';
const NKU_WARNING_CSS = [
    '#bridge-dialog-container { border: 2px solid #d93025 !important; }',
    '#bridge-dialog-container h3 { color: #d93025 !important; }',
    '#bridge-dialog-container button { background-color: #d93025 !important; }'
].join('\n');

/* ============================ 通用工具 ============================ */

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 中文数字转整数, 支持 一 ~ 九十九（本场景足够）。
 * @param {string} text
 * @returns {number} 无法解析时返回 NaN
 */
function cnToInt(text) {
    const s = String(text || '').replace(/\s/g, '');
    if (!s) return NaN;
    if (s === '十') return 10;
    if (s.length === 1) {
        return Object.prototype.hasOwnProperty.call(CN_DIGITS, s) ? CN_DIGITS[s] : NaN;
    }
    const idx = s.indexOf('十');
    if (idx === -1) return NaN;
    const high = idx === 0 ? 1 : CN_DIGITS[s[idx - 1]];
    const low = idx === s.length - 1 ? 0 : CN_DIGITS[s[idx + 1]];
    if (high === undefined || low === undefined) return NaN;
    return high * 10 + low;
}

/** 中文数字或阿拉伯数字 -> 整数 */
function parseWeekNumber(token) {
    const s = String(token || '').trim();
    if (/^\d+$/.test(s)) return Number(s);
    return cnToInt(s);
}

/** 规整空白与全角空格 */
function normalizeText(text) {
    return String(text == null ? '' : text)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** "8:00" / "08:00:00" -> "08:00", 非法返回 null */
function formatTime(timeStr) {
    if (typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "08:45" -> 525 */
function timeToMinutes(timeStr) {
    const t = formatTime(timeStr);
    if (!t) return -1;
    const parts = t.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
}

/** 日期 -> "YYYY-MM-DD" */
function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 连续整数区间 -> 数组 */
function makeRange(from, to) {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const out = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
}

/** 数组去重并升序 */
function uniqueSorted(numbers) {
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

/** 判断 a 是否为 b 的子集 */
function isSubsetOf(a, b) {
    return a.every(item => b.indexOf(item) !== -1);
}

/* ============================ 桥接层封装 ============================ */

function showToast(message) {
    try {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
            window.shiguangBridge.showToast(message);
        }
    } catch {
        // 提示失败不值得打断导入流程
    }
}

function notifyTaskCompletion() {
    try {
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch {
        // 结束信号交给宿主处理, 这里不做补偿
    }
}

/**
 * 是否支持某个异步桥接方法。
 * 应用内执行时 window.shiguangBridgePromise 一定存在, 但出于健壮性仍然检查。
 */
function bridgeSupports(method) {
    return !!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise[method] === 'function');
}

/** 红色警告配色: 只在我们的弹窗显示期间生效, 用完立刻撤掉, 避免影响其它弹窗 */
function applyWarningStyle() {
    try {
        if (document.getElementById(NKU_WARNING_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = NKU_WARNING_STYLE_ID;
        style.textContent = NKU_WARNING_CSS;
        (document.head || document.documentElement).appendChild(style);
    } catch {
        // 配色是锦上添花, 失败不影响弹窗与导入
    }
}

function removeWarningStyle() {
    try {
        const style = document.getElementById(NKU_WARNING_STYLE_ID);
        if (style && style.parentNode) style.parentNode.removeChild(style);
    } catch {
        // 同上, 撤不掉也不影响导入
    }
}

/* ============================ 页面结构解析 ============================ */

/**
 * 把 HTML 表格展开成规整的二维网格, 正确处理 rowspan / colspan。
 * 课表里「上午/下午/晚上」用 rowspan 跨行、课程用 rowspan 跨节次,
 * 因此必须用网格而不是简单的行/列下标。
 * @param {HTMLTableElement} table
 * @returns {Array<Array<HTMLTableCellElement>>} grid[row][col]
 */
function buildTableGrid(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    const grid = [];
    const occupied = [];

    rows.forEach((tr, rowIndex) => {
        let col = 0;
        Array.from(tr.children).forEach(cell => {
            const tagName = (cell.tagName || '').toLowerCase();
            if (tagName !== 'td' && tagName !== 'th') return;

            while (occupied[rowIndex] && occupied[rowIndex][col]) col++;

            const colspan = Math.max(parseInt(cell.getAttribute('colspan') || '1', 10) || 1, 1);
            const rowspan = Math.max(parseInt(cell.getAttribute('rowspan') || '1', 10) || 1, 1);

            for (let i = 0; i < rowspan; i++) {
                const r = rowIndex + i;
                if (!grid[r]) grid[r] = [];
                if (!occupied[r]) occupied[r] = [];
                for (let j = 0; j < colspan; j++) {
                    if (i === 0 && j === 0) grid[r][col] = cell;
                    occupied[r][col + j] = true;
                }
            }
            col += colspan;
        });
    });

    return grid;
}

/**
 * 从表头找出「星期几」所在列。
 * 表头形如: <th colspan="2">时间</th><th>星期一</th>...<th>星期日</th>
 * @returns {Object<number, number>} 列下标 -> 星期(1~7)
 */
function findDayColumns(grid) {
    const header = grid[0] || [];
    const dayChars = '一二三四五六日';
    const map = {};

    for (let col = 0; col < header.length; col++) {
        const cell = header[col];
        if (!cell) continue;
        const text = normalizeText(cell.textContent).replace(/\s/g, '');
        const match = text.match(/^星期([一二三四五六日天])$/);
        if (!match) continue;
        const ch = match[1] === '天' ? '日' : match[1];
        const day = dayChars.indexOf(ch) + 1;
        if (day >= 1 && day <= 7) map[col] = day;
    }

    return map;
}

/** 找到课表主表格 */
function findTimetable(doc) {
    const direct = doc.querySelector('table.table-course');
    if (direct && /星期/.test(direct.textContent || '')) return direct;

    const tables = Array.from(doc.querySelectorAll('table'));
    return tables.find(table =>
        /星期一/.test(table.textContent || '') && /第\s*\d+\s*节/.test(table.textContent || '')
    ) || null;
}

/**
 * 把单元格里的 <a> 转成按行切分的文本数组（<br> 视为换行, &nbsp; 视为普通空格）。
 * 典型单元格内容:
 *   群论
 *   || 十七周
 *   第1节 -- 第2节
 *   朱开恩
 *   主楼333
 * @param {HTMLAnchorElement} anchor
 * @returns {string[]}
 */
function anchorToLines(anchor) {
    const clone = anchor.cloneNode(true);
    Array.from(clone.querySelectorAll('br')).forEach(br => {
        br.parentNode.replaceChild(document.createTextNode('\n'), br);
    });

    return String(clone.textContent || '')
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map(line => normalizeText(line))
        .filter(line => line.length > 0);
}

/**
 * 解析单元格中的一个课程链接。
 * @param {HTMLAnchorElement} anchor
 * @param {number} day 星期(1~7)
 * @returns {Object|null}
 */
function parseCourseAnchor(anchor, day) {
    const lines = anchorToLines(anchor);
    if (lines.length === 0) return null;

    const strongEl = anchor.querySelector('strong');
    let name = strongEl ? normalizeText(strongEl.textContent) : '';
    if (!name) {
        name = normalizeText(lines[0]).replace(/^[|\s]+/, '');
    }
    if (!name) return null;

    // 定位「第X节 -- 第Y节」所在行
    const sectionIdx = lines.findIndex(line => /第\s*\d+\s*节/.test(line));

    // 周次说明文字: 位于课程名与节次行之间（形如 "|| 十七周"）
    let weekDesc = '';
    const upperBound = sectionIdx < 0 ? lines.length : sectionIdx;
    weekDesc = lines
        .slice(1, upperBound)
        .join(' ')
        .replace(/[|｜]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // 节次范围
    let startSection = null;
    let endSection = null;
    if (sectionIdx >= 0) {
        const numbers = (lines[sectionIdx].match(/第\s*(\d+)\s*节/g) || [])
            .map(token => Number(String(token).replace(/[^\d]/g, '')))
            .filter(num => !isNaN(num) && num > 0);
        if (numbers.length > 0) {
            startSection = Math.min.apply(null, numbers);
            endSection = Math.max.apply(null, numbers);
        }
    }

    // 教师 / 上课地点: 紧随节次行
    let teacher = '';
    let position = '';
    if (sectionIdx >= 0) {
        teacher = normalizeText(lines[sectionIdx + 1] || '');
        position = normalizeText(lines[sectionIdx + 2] || '');
        // 有些课程没有独立教师行, 此时第一行其实是地点
        if (!position && teacher && /楼|室|馆|场地|校区|通知|待定/.test(teacher)) {
            position = teacher;
            teacher = '';
        }
    }

    const anchorClass = anchor.getAttribute('class') || '';
    const pending = /corg|c-org|orange/i.test(anchorClass);

    if (startSection === null) return null;
    if (!(day >= 1 && day <= 7)) return null;

    return {
        name,
        teacher,
        position: position || '待定',
        day,
        startSection,
        endSection,
        weekDesc,
        pending
    };
}

/**
 * 解析某一周课表页面里的所有课程。
 * @param {Document} doc
 * @returns {Array<Object>|null} null 表示页面里找不到课表（可能登录已失效）
 */
function parseTimetableDoc(doc) {
    const table = findTimetable(doc);
    if (!table) return null;

    const grid = buildTableGrid(table);
    const dayColumns = findDayColumns(grid);
    if (Object.keys(dayColumns).length === 0) {
        return null;
    }

    const courses = [];
    const colKeys = Object.keys(dayColumns).map(Number);

    for (let row = 1; row < grid.length; row++) {
        for (let i = 0; i < colKeys.length; i++) {
            const col = colKeys[i];
            const cell = grid[row] ? grid[row][col] : null;
            if (!cell) continue;

            // 同一格可能塞了多门课（冲突课程）, 逐个解析
            const anchors = Array.from(cell.querySelectorAll('a'))
                .filter(a => /第\s*\d+\s*节/.test(a.textContent || ''));

            anchors.forEach(anchor => {
                const course = parseCourseAnchor(anchor, dayColumns[col]);
                if (course) courses.push(course);
            });
        }
    }

    return courses;
}

/**
 * 从页面底部说明文字里解析作息时间。页面上的文字形如:
 *   上午:第一节 8:00-8:45 第二节8:55-9:40 ... 第七节:14:00-14:45 ...
 * @param {Document} doc
 * @returns {Array<Object>|null}
 */
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
    // 桥接层要求时间段必须从 1 开始且编号连续, 不满足就整体放弃
    const valid = slots.length > 0 && slots.every((slot, index) => slot.number === index + 1);
    if (!valid) return null;

    return slots;
}

/**
 * 解析「以下课程时间地点待定」表格。
 * 这些课程没有星期/节次信息, 无法写进课表, 只能交给用户手动添加。
 * @param {Document} doc
 * @returns {Array<{code: string, name: string, teacher: string, time: string, position: string, remark: string}>}
 */
function parsePendingCourses(doc) {
    const result = [];

    Array.from(doc.querySelectorAll('table')).forEach(table => {
        const headerCells = Array.from(table.querySelectorAll('thead th'))
            .map(th => normalizeText(th.textContent));
        const headerText = headerCells.join(' ');

        if (!headerText || !/课程名称/.test(headerText) || !/上课时间/.test(headerText)) return;

        const headers = headerCells.length > 0
            ? headerCells
            : Array.from(table.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(cell => normalizeText(cell.textContent));

        const indexOf = keyword => headers.findIndex(header => header.indexOf(keyword) !== -1);
        const codeIdx = indexOf('课程编号');
        const nameIdx = indexOf('课程名称');
        const teacherIdx = indexOf('任课教师');
        const timeIdx = indexOf('上课时间');
        const positionIdx = indexOf('上课地点');
        const remarkIdx = indexOf('备注');

        Array.from(table.querySelectorAll('tbody tr')).forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td'));
            if (cells.length === 0) return;
            const value = idx => (idx >= 0 && cells[idx]) ? normalizeText(cells[idx].textContent) : '';
            const name = value(nameIdx);
            if (!name) return;
            result.push({
                code: value(codeIdx),
                name,
                teacher: value(teacherIdx),
                time: value(timeIdx),
                position: value(positionIdx),
                remark: value(remarkIdx)
            });
        });
    });

    return result;
}

/**
 * 把「时间地点待定」课程整理成弹窗里展示的多行文本, 每门课一行:
 *   1. 实验室安全教育（吴强 · 时间待定 · 场地详见学院通知）
 * 课程太多时只列前 limit 门, 其余折叠成一行汇总, 避免弹窗被撑爆。
 * @param {Array<Object>} pendingCourses
 * @param {number} [limit=8]
 * @returns {string}
 */
function formatPendingCourses(pendingCourses, limit) {
    const max = typeof limit === 'number' && limit > 0 ? limit : 8;
    const lines = pendingCourses.slice(0, max).map((course, index) => {
        const details = [course.teacher, course.time, course.position, course.remark]
            .map(item => normalizeText(item))
            .filter(Boolean);
        return `${index + 1}. ${course.name}${details.length > 0 ? `（${details.join(' · ')}）` : ''}`;
    });
    if (pendingCourses.length > max) {
        lines.push(`… 等共 ${pendingCourses.length} 门`);
    }
    return lines.join('\n');
}

/**
 * 「时间地点待定」课程的确认弹窗。
 *
 * 这些课程在系统里只有「时间待定」四个字, 没有星期与节次, 排不进课表,
 * 只能由用户在应用里手动添加。所以这里单独弹一个需要用户确认的对话框
 * 把课程逐条列清楚, 而不是只在收尾提示里塞一行文字:
 *   - 用户确认（或环境不支持弹窗）→ 继续导入其余课程;
 *   - 用户取消 → 整个导入中止, 不写入任何数据。
 *
 * 视觉上用警告样式提醒用户注意: 文案前缀 ⚠️ / ✅, 并在弹窗显示期间套一层红色配色
 * （见 applyWarningStyle —— 桥接层不提供颜色参数, 只能覆盖插件自身的 CSS）。
 *
 * @param {Array<Object>} pendingCourses
 * @returns {Promise<boolean>} 是否继续导入
 */
async function confirmPendingCourses(pendingCourses) {
    if (!Array.isArray(pendingCourses) || pendingCourses.length === 0) return true;

    const list = formatPendingCourses(pendingCourses);

    if (!bridgeSupports('showAlert')) {
        // 没有弹窗能力时退回提示信息, 不阻塞导入流程
        showToast(`⚠️ 另有 ${pendingCourses.length} 门「时间地点待定」课程无法导入课表, 请手动添加。`);
        return true;
    }

    const title = `⚠️ 有 ${pendingCourses.length} 门课程时间地点待定`;
    const content = `⚠️ 以下 ${pendingCourses.length} 门课程在系统中没有具体的上课时间与地点, `
        + '无法写入课表, 需要你在导入完成后手动添加：\n\n'
        + `${list}\n\n`
        + '✅ 以上课程不影响其余课程的导入。';

    // 显示期间套一层红色警告配色（尽力而为, 失败不影响弹窗）
    applyWarningStyle();
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(title, content, '继续导入');
        return confirmed === true;
    } catch (error) {
        return true;
    } finally {
        removeWarningStyle();
    }
}

/* ============================ 周次推导 ============================ */

/**
 * 解析中文周次说明（如 "十七周" / "前八周" / "第3-10周"）为周次数组。
 *
 * 南开这套系统里周次说明是给用户看的描述性文字, 常见语义:
 *   前X周  -> 第 1 ~ X 周
 *   后X周  -> 最后 X 周
 *   第X周  -> 仅第 X 周
 *   X周    -> 从第 1 周起持续 X 周
 *   单周/双周 作为修饰再过滤
 *
 * @param {string} desc
 * @param {number} totalWeeks
 * @returns {number[]|null} 无法解析返回 null
 */
function parseWeekDescToWeeks(desc, totalWeeks) {
    const raw = normalizeText(desc);
    if (!raw) return null;

    const s = raw.replace(/\s/g, '').replace(/[~～至–—ー]/g, '-');
    const num = '([0-9]+|[一二三四五六七八九十]+)';
    let weeks = null;

    let match = s.match(new RegExp(`第?${num}-第?${num}周`));
    if (match) {
        const from = parseWeekNumber(match[1]);
        const to = parseWeekNumber(match[2]);
        if (from > 0 && to > 0) weeks = makeRange(from, to);
    }

    if (!weeks) {
        match = s.match(new RegExp(`前${num}周`));
        if (match) {
            const n = parseWeekNumber(match[1]);
            if (n > 0) weeks = makeRange(1, n);
        }
    }

    if (!weeks) {
        match = s.match(new RegExp(`后${num}周`));
        if (match) {
            const n = parseWeekNumber(match[1]);
            if (n > 0) weeks = makeRange(Math.max(1, totalWeeks - n + 1), totalWeeks);
        }
    }

    if (!weeks) {
        match = s.match(new RegExp(`第${num}周`));
        if (match) {
            const n = parseWeekNumber(match[1]);
            if (n > 0) weeks = [n];
        }
    }

    if (!weeks) {
        // 形如 "十七周" —— 视为从第 1 周起持续 17 周
        match = s.match(new RegExp(`^${num}周`));
        if (match) {
            const n = parseWeekNumber(match[1]);
            if (n > 0) weeks = makeRange(1, n);
        }
    }

    if (!weeks) return null;

    if (/单周/.test(s)) weeks = weeks.filter(w => w % 2 === 1);
    if (/双周/.test(s)) weeks = weeks.filter(w => w % 2 === 0);

    return weeks.length > 0 ? uniqueSorted(weeks) : null;
}

/* ============================ 抓取与合并 ============================ */

/**
 * 读取 <select> 的所有选项。
 * @param {HTMLSelectElement|null} selectEl
 * @returns {Array<{value: string, label: string, selected: boolean}>}
 */
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

function pickDefault(options, fallbackIndex) {
    if (!options.length) return '';
    const selected = options.find(option => option.selected);
    if (selected) return selected.value;
    const idx = Math.min(Math.max(fallbackIndex, 0), options.length - 1);
    return options[idx].value;
}

/** 当前文档是否为本系统的课表页（用于区分「页面结构变了/登录失效」和「这一周没课」） */
function looksLikeCourseDoc(doc) {
    if (!doc) return false;
    if (doc.querySelector('#xn') || doc.querySelector('#xj') || doc.querySelector('#kcbForm')) return true;
    const title = doc.title || '';
    return /课表|南开大学/.test(title);
}

/**
 * 抓取某一周的课表页面。
 * @param {string} xn 学年（起始年份, 如 "2026"）
 * @param {string} xj 学期代码（"11" 第一学期 / "12" 第二学期 / "13" 短学期）
 * @param {number} zc 周次
 * @returns {Promise<Document>}
 */
async function fetchWeekDoc(xn, xj, zc) {
    const url = `${NKU_KB_PAGE}?xn=${encodeURIComponent(xn)}&xj=${encodeURIComponent(xj)}&zc=${encodeURIComponent(zc)}`;

    const response = await fetch(url, {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'X-Requested-With': 'XMLHttpRequest'
        },
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`第 ${zc} 周课表请求失败，状态码 ${response.status}`);
    }

    // 统一认证（CAS）过期时会被重定向到登录页
    const finalUrl = response.url || '';
    if (finalUrl && !/\/py\/page\/student\/grkcb\.htm/.test(finalUrl)) {
        throw new Error(`第 ${zc} 周课表请求被重定向（${finalUrl}），登录状态可能已失效`);
    }

    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * 读取「时间地点待定」课程。
 *
 * 页面上的待定表格跟随页面当前选中的学年学期, 如果用户选了别的学期就不准了,
 * 所以这里按用户选定的学年学期重新抓一次课表页（第 1 周即可）;
 * 抓取失败时退回当前页面, 至少不会比原来更差。
 *
 * @param {string} xn
 * @param {string} xj
 * @returns {Promise<Array<Object>>}
 */
async function fetchPendingCourses(xn, xj) {
    let fetched = null;
    try {
        const doc = await fetchWeekDoc(xn, xj, 1);
        fetched = parsePendingCourses(doc);
    } catch {
        // 抓取失败就退回当前页面, 见下方
    }

    if (fetched && fetched.length > 0) {
        return fetched;
    }

    // 抓不到就用当前页面的待定表（它跟随页面当前学期）
    return parsePendingCourses(document);
}

/** 简单的并发池 */
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let cursor = 0;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= tasks.length) return;
            results[index] = await tasks[index]();
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(limit, tasks.length); i++) workers.push(worker());
    await Promise.all(workers);
    return results;
}

/**
 * 抓取第 1 ~ maxWeek 周的课表, 汇总每门课出现在哪些周。
 * @returns {Promise<{courses: Array, failedWeeks: number[], okWeeks: number[]}>}
 */
async function crawlAllWeeks(xn, xj, maxWeek) {
    const weekNumbers = [];
    for (let week = 1; week <= maxWeek; week++) weekNumbers.push(week);

    showToast(`正在抓取第 1 ~ ${maxWeek} 周课表，请稍候…（共 ${maxWeek} 次请求）`);

    const tasks = weekNumbers.map(week => async () => {
        try {
            const doc = await fetchWeekDoc(xn, xj, week);
            const courses = parseTimetableDoc(doc);
            if (courses === null) {
                if (looksLikeCourseDoc(doc)) {
                    // 页面是本系统的课表页, 只是没有课表表格 —— 多为超出本学期周次范围
                    return { week, courses: [], error: null };
                }
                return { week, courses: null, error: '页面中找不到课表（登录状态可能已失效）' };
            }
            return { week, courses, error: null };
        } catch (error) {
            return { week, courses: null, error: error.message };
        }
    });

    const results = await runWithConcurrency(tasks, NKU_FETCH_CONCURRENCY);

    const courses = [];
    const failedWeeks = [];
    const okWeeks = [];

    results.forEach(result => {
        if (!result) return;
        if (result.error || result.courses === null) {
            failedWeeks.push(result.week);
            return;
        }
        okWeeks.push(result.week);
        result.courses.forEach(course => {
            courses.push(Object.assign({}, course, { week: result.week }));
        });
    });

    return { courses, failedWeeks, okWeeks };
}

/**
 * 按 (课程名 + 教师 + 地点 + 星期 + 节次) 归并各周记录, 得到每门课的周次集合。
 */
function groupCoursesBySignature(records) {
    const keyOf = course => [
        course.name, course.teacher, course.position, course.day, course.startSection, course.endSection
    ].join('\u0001');

    const groups = new Map();
    records.forEach(course => {
        const key = keyOf(course);
        if (!groups.has(key)) {
            groups.set(key, {
                name: course.name,
                teacher: course.teacher,
                position: course.position,
                day: course.day,
                startSection: course.startSection,
                endSection: course.endSection,
                weekDesc: course.weekDesc || '',
                pending: !!course.pending,
                crawlWeeks: new Set()
            });
        }
        const group = groups.get(key);
        group.crawlWeeks.add(course.week);
        if (!group.weekDesc && course.weekDesc) group.weekDesc = course.weekDesc;
        if (course.pending) group.pending = true;
    });

    return Array.from(groups.values());
}

/**
 * 决定每门课最终的周次。
 *
 * 默认信任「抓取结果」（即第几周出现过就是第几周）。但为了兼容
 * 「系统并不分周渲染」的情况, 做了如下自检: 若同一门课出现的周次
 * 明显超出它自己的中文周次说明（filtered 情况下不可能发生）,
 * 说明抓取到的其实是同一份完整课表, 此时改用说明文字推导的周次。
 *
 * 为避免个别说明文字解析偏差导致误判, 只有「至少 2 门课、且不少于
 * 一半的课程」都出现矛盾时才切换策略。
 */
function resolveWeeks(groups, totalWeeks) {
    const stats = groups.map(group => {
        const textWeeks = parseWeekDescToWeeks(group.weekDesc, totalWeeks);
        const crawlWeeks = uniqueSorted(Array.from(group.crawlWeeks));
        const violated = !!(textWeeks
            && textWeeks.length > 0
            && !isSubsetOf(crawlWeeks, textWeeks));
        return { group, textWeeks, crawlWeeks, violated };
    });

    const parsedCount = stats.filter(item => item.textWeeks && item.textWeeks.length > 0).length;
    const violatedCount = stats.filter(item => item.violated).length;
    const shouldUseText = parsedCount > 0
        && violatedCount >= 2
        && violatedCount * 2 >= parsedCount;

    if (shouldUseText) {
    } else {
    }

    return stats.map(item => {
        let weeks;
        if (shouldUseText && item.textWeeks && item.textWeeks.length > 0) {
            weeks = item.textWeeks;
        } else {
            weeks = item.crawlWeeks;
        }
        if (!weeks || weeks.length === 0) weeks = makeRange(1, totalWeeks);
        return {
            name: item.group.name,
            teacher: item.group.teacher,
            position: item.group.position,
            day: item.group.day,
            startSection: item.group.startSection,
            endSection: item.group.endSection,
            weeks: uniqueSorted(weeks),
            weekDesc: item.group.weekDesc
        };
    });
}

/**
 * 合并「同一门课、同一天、同一周次、节次相邻」的碎片（例如系统把它拆成了两格）。
 */
function mergeAdjacentSections(courses) {
    const buckets = new Map();
    courses.forEach(course => {
        const key = [course.name, course.teacher, course.position, course.day, course.weeks.join(',')].join('\u0001');
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(course);
    });

    const merged = [];
    buckets.forEach(list => {
        list.sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection);
        let current = null;
        list.forEach(course => {
            if (current && course.startSection <= current.endSection + 1) {
                current.endSection = Math.max(current.endSection, course.endSection);
            } else {
                if (current) merged.push(current);
                current = Object.assign({}, course);
            }
        });
        if (current) merged.push(current);
    });

    return merged;
}

/** 排序: 星期 -> 起始节次 -> 课程名 */
function sortCourses(courses) {
    return courses.sort((a, b) =>
        a.day - b.day
        || a.startSection - b.startSection
        || a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
}

/* ============================ 页面参数与交互 ============================ */

/**
 * 读取当前页面的学年 / 学期 / 周次选项。
 * 若当前页面不是课表页, 则尝试抓取课表页解析。
 * @returns {Promise<{xn: Array, xj: Array, zc: Array, curXn: string, curXj: string, curZc: string, doc: Document}>}
 */
async function extractPageParams() {

    let doc = document;
    let xnEl = document.querySelector('#xn');
    let xjEl = document.querySelector('#xj');
    let zcEl = document.querySelector('#zc');

    if (!xnEl || !xjEl || !zcEl) {
        try {
            const response = await fetch(NKU_KB_PAGE, {
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
                method: 'GET',
                credentials: 'include'
            });
            const html = await response.text();
            const fetched = new DOMParser().parseFromString(html, 'text/html');
            const fetchedXn = fetched.querySelector('#xn');
            const fetchedXj = fetched.querySelector('#xj');
            const fetchedZc = fetched.querySelector('#zc');
            if (fetchedXn && fetchedXj && fetchedZc) {
                doc = fetched;
                xnEl = fetchedXn;
                xjEl = fetchedXj;
                zcEl = fetchedZc;
            }
        } catch (error) {
        }
    }

    const xn = readSelectOptions(xnEl);
    const xj = readSelectOptions(xjEl);
    const zc = readSelectOptions(zcEl);

    const fallbackYear = String(new Date().getFullYear());
    const curXn = pickDefault(xn, xn.length - 1) || fallbackYear;
    const curXj = pickDefault(xj, 0) || '11';
    const curZc = pickDefault(zc, 0) || '1';

    return { xn, xj, zc, curXn, curXj, curZc, doc };
}

/**
 * 生成学年学期的候选列表（限制在页面所选学年前后各 2 年内, 避免列表过长）。
 */
function buildTermOptions(xnOptions, xjOptions, curXn, curXj) {
    const baseYear = Number(curXn) || new Date().getFullYear();
    let years = xnOptions.filter(option => Math.abs(Number(option.value) - baseYear) <= 2);
    if (years.length === 0) years = xnOptions.slice(-4);
    // 保证当前学年一定在列表里
    if (years.length > 0 && !years.some(option => option.value === curXn)) {
        const current = xnOptions.find(option => option.value === curXn);
        if (current) {
            years = years.concat([current]).sort((a, b) => Number(a.value) - Number(b.value));
        }
    }

    const labels = [];
    const values = [];
    let defaultIndex = 0;

    years.forEach(yearOption => {
        xjOptions.forEach(termOption => {
            if (yearOption.value === curXn && termOption.value === curXj) {
                defaultIndex = labels.length;
            }
            labels.push(`${yearOption.label}学年 ${termOption.label}`);
            values.push({
                xn: yearOption.value,
                xj: termOption.value,
                label: `${yearOption.label}学年 ${termOption.label}`
            });
        });
    });

    if (labels.length === 0) return null;
    return { labels, values, defaultIndex };
}

/**
 * 让用户选择要导入的学年学期, 默认选中页面上当前显示的学期。
 * @returns {Promise<{xn: string, xj: string, label: string}|null>}
 */
async function selectAcademicYearAndSemester(params) {
    const options = buildTermOptions(params.xn, params.xj, params.curXn, params.curXj);
    if (!options) return { xn: params.curXn, xj: params.curXj, label: '当前学期' };

    if (!bridgeSupports('showSingleSelection')) {
        return options.values[options.defaultIndex];
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学年学期',
        JSON.stringify(options.labels),
        options.defaultIndex
    );

    if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return null;
    return options.values[selectedIndex];
}

/**
 * 推算开学日期（第 1 周周一）。系统页面不提供开学日期, 只能按学期类型估算,
 * 再由用户从候选日期中确认。
 * @returns {string} YYYY-MM-DD
 */
function guessTermStartDate(xn, xj) {
    const startYear = Number(xn) || new Date().getFullYear();
    const rule = NKU_TERM_BASE[String(xj)] || NKU_TERM_BASE['11'];
    const base = new Date(startYear + rule.yearOffset, rule.month, rule.day);

    // 找到基准日之后（含当天）的第一个周一
    const dayOfWeek = base.getDay(); // 0 = 周日
    const delta = dayOfWeek === 1 ? 0 : (dayOfWeek === 0 ? 1 : 8 - dayOfWeek);
    base.setDate(base.getDate() + delta);
    return formatDate(base);
}

/**
 * 让用户确认开学日期（第 1 周周一）。
 * 给出一周前后的候选（-3 ~ +3 周）, 默认选中推算值。
 * @returns {Promise<string|null>} 用户取消返回 null
 */
async function selectSemesterStartDate(xn, xj) {
    const guess = guessTermStartDate(xn, xj);
    const guessDate = new Date(`${guess}T00:00:00`);

    const dates = [];
    const labels = [];
    let defaultIndex = 0;

    for (let offset = -3; offset <= 3; offset++) {
        const date = new Date(guessDate.getTime());
        date.setDate(date.getDate() + offset * 7);
        const text = formatDate(date);
        if (offset === 0) defaultIndex = labels.length;
        dates.push(text);
        labels.push(`${text}（周一）`);
    }

    if (!bridgeSupports('showSingleSelection')) return guess;

    const title = '确认第 1 周周一（开学日期）\n系统未提供开学日期, 请选择第 1 周的周一';
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        title,
        JSON.stringify(labels),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return null;
    return dates[selectedIndex];
}

/* ============================ 保存 ============================ */

async function saveCourses(courses) {
    showToast(`正在保存 ${courses.length} 门课程…`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
        return true;
    } catch (error) {
        showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

async function importPresetTimeSlots(timeSlots) {
    if (!Array.isArray(timeSlots) || timeSlots.length === 0) {
        return true;
    }
    showToast('正在导入作息时间…');
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (error) {
        showToast('导入作息时间失败: ' + error.message);
        return false;
    }
}

async function saveCourseConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        showToast('保存课表配置失败: ' + error.message);
        return false;
    }
}

/** 从作息时间中推算单节课时长与课间时长, 用于课表配置 */
function deriveDurations(timeSlots) {
    const fallback = { classDuration: 45, breakDuration: 10 };
    if (!Array.isArray(timeSlots) || timeSlots.length < 2) return fallback;
    const first = timeSlots[0];
    const second = timeSlots[1];
    const classDuration = timeToMinutes(first.endTime) - timeToMinutes(first.startTime);
    const breakDuration = timeToMinutes(second.startTime) - timeToMinutes(first.endTime);
    if (classDuration > 0 && breakDuration >= 0) {
        return { classDuration, breakDuration };
    }
    return fallback;
}

/* ============================ 主流程 ============================ */

function isLoginPage() {
    const url = window.location.href || '';
    return /iam\.nankai\.edu\.cn|cas\/login|pageAction=Logout/i.test(url);
}

function looksLikeCoursePage() {
    return !!findTimetable(document) || !!document.querySelector('#kcbForm') || !!document.querySelector('#zc');
}

async function promptUserToStart(params) {
    if (!bridgeSupports('showAlert')) return true;
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            '南开大学研究生课表导入',
            '导入前请确认已登录南开大学研究生教育综合管理系统, 并停留在「培养 → 个人课表」页面。\n\n'
            + '本脚本将自动读取作息时间, 逐周抓取课表并还原每门课的实际周次。'
            + '若课表周次较多, 抓取可能需要十几秒。',
            '开始导入'
        );
        return confirmed === true;
    } catch (error) {
        return true;
    }
}

async function importFlow() {
    if (isLoginPage()) {
        showToast('导入失败：请先登录南开大学研究生教育综合管理系统！');
        return;
    }
    if (!looksLikeCoursePage()) {
        showToast('导入失败：请先打开「培养 → 个人课表」页面再执行本脚本。');
        return;
    }

    const confirmed = await promptUserToStart();
    if (!confirmed) {
        showToast('已取消导入。');
        return;
    }

    // 1. 读取页面参数
    const params = await extractPageParams();
    if (params.xn.length === 0 || params.xj.length === 0 || params.zc.length === 0) {
        showToast('未能读取到学年/学期/周次信息，请确认已在「个人课表」页面。');
        return;
    }

    // 2. 选择学年学期
    const term = await selectAcademicYearAndSemester(params);
    if (!term) {
        showToast('已取消导入（未选择学年学期）。');
        return;
    }
    const { xn, xj, label } = term;
    const totalWeeks = params.zc.length;

    // 3. 作息时间（从当前页面解析）
    const timeSlots = parseTimeSlotsFromDoc(document) || NKU_FALLBACK_TIME_SLOTS;

    // 4. 「时间地点待定」课程 —— 单独弹窗让用户确认（放在耗时的逐周抓取之前, 取消就不用等了）
    const pendingCourses = await fetchPendingCourses(xn, xj);
    const pendingConfirmed = await confirmPendingCourses(pendingCourses);
    if (!pendingConfirmed) {
        showToast('已取消导入（「时间地点待定」课程未确认）。');
        return;
    }

    // 5. 逐周抓取并归并
    const crawl = await crawlAllWeeks(xn, xj, totalWeeks);
    if (crawl.okWeeks.length === 0) {
        showToast('课表抓取失败：所有周次都未取到数据，请确认登录状态后重试。');
        return;
    }
    if (crawl.courses.length === 0) {
        showToast(`${label} 未查询到任何课程，可能本学期无课或尚未选课。`);
        return;
    }

    const groups = groupCoursesBySignature(crawl.courses);
    const resolved = resolveWeeks(groups, totalWeeks);
    const merged = sortCourses(mergeAdjacentSections(resolved));

    const courses = merged.map(course => ({
        name: course.name,
        teacher: course.teacher,
        position: course.position,
        day: course.day,
        startSection: course.startSection,
        endSection: course.endSection,
        weeks: course.weeks
    }));


    // 6. 保存课程
    const saved = await saveCourses(courses);
    if (!saved) return;

    // 7. 导入作息时间
    await importPresetTimeSlots(timeSlots);

    // 8. 确认并保存开学日期
    const startDate = await selectSemesterStartDate(xn, xj);
    const durations = deriveDurations(timeSlots);
    await saveCourseConfig({
        semesterStartDate: startDate || null,
        semesterTotalWeeks: courses.reduce((max, c) => Math.max(max, ...c.weeks), 1),
        defaultClassDuration: durations.classDuration,
        defaultBreakDuration: durations.breakDuration,
        firstDayOfWeek: 1
    });

    // 9. 收尾提示
    let message = `导入成功！共导入 ${courses.length} 门课程。`;
    if (startDate) message += `\n开学日期：${startDate}`;
    if (crawl.failedWeeks.length > 0) {
        message += `\n注意：第 ${crawl.failedWeeks.join('、')} 周抓取失败, 这些周的课程可能缺失。`;
    }
    if (pendingCourses.length > 0) {
        // 课程清单已经在导入前的弹窗里逐条列过了, 这里只留一句简短的提醒
        message += `\n⚠️ 另有 ${pendingCourses.length} 门「时间地点待定」课程未导入课表, 请手动添加。`;
    }

    showToast(message);
    notifyTaskCompletion();
}

/* ============================ 入口 ============================ */

// 防重入: 用户连点两次导入、或脚本被重复注入时, 只让第一遍跑到底。
// 这是运行期的并发守卫, 不是可配置的开关。
const NKU_RUNNING_FLAG = '__NKU_IMPORT_RUNNING__';

async function runImportFlow() {
    if (window[NKU_RUNNING_FLAG]) return;
    window[NKU_RUNNING_FLAG] = true;
    try {
        await importFlow();
    } finally {
        window[NKU_RUNNING_FLAG] = false;
    }
}

// 宿主（应用 / 测试插件）在用户点击「开始导入」后注入并执行本脚本, 因此顶层直接启动流程。
// 流程的第一步就是向用户确认, 用户确认后才开始读取参数与抓取页面。
runImportFlow();

})();

