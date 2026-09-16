// 重庆三峡科技大学（sanxiau.edu.cn）拾光课程表适配脚本
// 教务系统：正方软件 V-9.0（zftal-ui-v5）
// 课表页：/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default
//
// 数据来源：AJAX（POST 表单），返回 JSON，课程在 kbList 数组内。
// 本脚本不包含任何账号密码，完全依赖用户在软件内已建立的教务会话（cookie）。
//
// 【已知问题】部分 Android WebView 上数组方法（filter 等）会算出错误结果，故本文件
// 所有数据处理只用下标循环、定长标记表与字符串拼接，不使用 Set / filter / map /
// sort / 展开运算符。改动时请保持这一约定。

/* ============================================================
 * 一、纯函数：解析工具
 * ============================================================ */

/**
 * 解析周次字符串，返回去重升序的周次数组。
 * 支持 "1-16周"、"1-15周(单)"、"2-16周(双)"、"1-3周(单),4-16周"、"1,3,5周" 等写法。
 *
 * @param {string} weekStr 原始周次字符串
 * @returns {number[]} 去重且升序的周次
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const text = String(weekStr).trim();
    if (!text) return [];

    // 1. 按逗号 / 顿号 / 分号切分多个区间
    const segments = text.split(/[,，、;；]+/);

    // 用定长标记表去重（周次 1-99），从小到大扫一遍即为升序。数组方法的坑见文件头。
    const seen = [];
    for (let i = 0; i < 100; i++) seen[i] = false;

    for (let si = 0; si < segments.length; si++) {
        const seg = String(segments[si]).trim();
        if (!seg) continue;

        // 奇偶限制：单周 / 双周（兼容 "(单)" "单周" "(单双)" 等写法）
        const isOdd = /单/.test(seg) && !/单双/.test(seg);
        const isEven = /双/.test(seg) && !/单双/.test(seg);

        // 抽取该区间内所有 "a-b" 片段（全局匹配以支持 "1-3" 与 "1,3,5" 混排）
        const rangeRe = /(\d+)\s*-\s*(\d+)/g;
        let matched = false;
        let m;

        while ((m = rangeRe.exec(seg)) !== null) {
            matched = true;
            let start = parseInt(m[1], 10);
            let end = parseInt(m[2], 10);
            if (isNaN(start) || isNaN(end)) continue;
            if (start > end) { const t = start; start = end; end = t; } // 容错：反序
            for (let w = start; w <= end; w++) {
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 !== 0) continue;
                if (w > 0 && w < 100) seen[w] = true;
            }
        }

        // 4. 该区间没有 "a-b" 形式，则抽取所有孤立数字（"1,3,5周"）
        if (!matched) {
            const singles = seg.match(/\d+/g);
            if (singles) {
                for (let k = 0; k < singles.length; k++) {
                    const w = parseInt(singles[k], 10);
                    if (isNaN(w)) continue;
                    if (isOdd && w % 2 === 0) continue;
                    if (isEven && w % 2 !== 0) continue;
                    if (w > 0 && w < 100) seen[w] = true;
                }
            }
        }
    }

    const out = [];
    for (let w = 1; w < 100; w++) {
        if (seen[w]) out.push(w);
    }
    return out;
}

/**
 * 解析节次字符串，返回 { startSection, endSection }。
 * 支持 "1-2" / "3" / "第1-2节" / 补零的 "0102"；本校准许 11-14 节，不做上限裁剪。
 *
 * @param {string} sectionStr 原始节次字符串
 * @returns {{startSection:number, endSection:number}|null}
 */
function parseSections(sectionStr) {
    if (sectionStr === null || sectionStr === undefined) return null;
    const text = String(sectionStr).trim();
    if (!text) return null;

    // 去掉 "第" "节" "课" 等中文字符，只留数字和连字符
    const normalized = text.replace(/[^\d-]/g, '');
    if (!normalized) return null;

    // a-b 形式
    const rangeMatch = normalized.match(/^(\d+)\s*-\s*(\d+)$/) || normalized.match(/(\d+)-(\d+)/);
    if (rangeMatch) {
        let start = parseInt(rangeMatch[1], 10);
        let end = parseInt(rangeMatch[2], 10);
        if (isNaN(start) || isNaN(end)) return null;
        if (start > end) { const t = start; start = end; end = t; }
        return { startSection: start, endSection: end };
    }

    // 纯数字形式：可能是 "3" 也可能是补零的 "0102"
    const digits = normalized.replace(/-/g, '');
    if (/^\d{4}$/.test(digits)) {
        // "0102" -> 1~2
        const start = parseInt(digits.slice(0, 2), 10);
        const end = parseInt(digits.slice(2, 4), 10);
        if (start > 0 && end >= start) return { startSection: start, endSection: end };
    }
    if (/^\d+$/.test(digits)) {
        const n = parseInt(digits, 10);
        if (!isNaN(n) && n > 0) return { startSection: n, endSection: n };
    }

    return null;
}

/**
 * 合并与去重：连续节次（1-2 + 3-4 → 1-4）与完全重复的记录合并，节次相同者周次取并集。
 * 星期、周次、地点、教师任一不同即视为独立排课单元，不合并。
 *
 * @param {Array} courses 课程数组
 * @returns {Array} 处理后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses || [];

    // 复制并规整字段（parseWeeks 已保证周次去重升序）
    const list = [];
    for (let i = 0; i < courses.length; i++) {
        const c = courses[i] || {};
        const srcWeeks = Array.isArray(c.weeks) ? c.weeks : [];
        const weeks = [];
        for (let k = 0; k < srcWeeks.length; k++) weeks.push(srcWeeks[k]);
        list.push({
            name: c.name || '',
            teacher: c.teacher || '',
            position: c.position || '',
            day: c.day || 0,
            startSection: c.startSection || 0,
            endSection: c.endSection || 0,
            weeks: weeks
        });
    }

    // 先按 课程名/教师/地点/星期/周次/起始节次 排序，使可合并项彼此相邻
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    // 第一轮：合并连续节次 / 去除完全重复
    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameKey =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection &&
                            current.endSection === next.endSection;

        if (sameKey && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameKey && isDuplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    // 第二轮：节次也相同者，合并周次
    step1.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const step2 = [];
    let cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameSlot =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;
        if (sameSlot) {
            // 周次并集（标记表合并，天然升序）
            const mark = [];
            for (let i = 0; i < 100; i++) mark[i] = false;
            for (let i = 0; i < cur.weeks.length; i++) {
                const w = cur.weeks[i];
                if (w > 0 && w < 100) mark[w] = true;
            }
            for (let i = 0; i < nxt.weeks.length; i++) {
                const w = nxt.weeks[i];
                if (w > 0 && w < 100) mark[w] = true;
            }
            const merged = [];
            for (let w = 1; w < 100; w++) {
                if (mark[w]) merged.push(w);
            }
            cur.weeks = merged;
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);

    return step2;
}

/* ============================================================
 * 二、数据解析：正方 kbList -> 拾光 CourseJsonModel
 * ============================================================ */

/**
 * 解析 kbList 得到拾光课程数组。
 * 关键字段：kcmc 课程名 / xm 教师 / xqmc 校区 + cdmc 教室 / xqj 星期 / zcd 周次 / jcor 节次。
 * sjkList 是无固定上课时间的网课，本函数不读取。
 *
 * @param {object} jsonData 接口返回的 JSON
 * @returns {Array} 拾光课程数组
 */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];

    const initialCourseList = [];

    for (const raw of jsonData.kbList) {
        // 「未排地点」的课不跳过：实测它们仍有固定上课时间（如毛概 周五5-6节），
        // 只是没排教室。真正没有时间的网课在 sjkList，本函数读不到。

        // --- 课程名 ---
        // 直接用 kcmc。课表图例里的类型标记（★☆〇■◆）在校方接口里位于 xslxbj 字段，
        // 不是拼在 kcmc 里的，本适配器不读取该字段，也不把标记写进课程名。
        const courseName = String(raw.kcmc || '').trim();
        if (!courseName) continue;

        // --- 教师 ---
        const teacher = String(raw.xm || raw.jsxm || raw.jsmc || '').trim();

        // 校区与教室是两个独立字段，拼成 "校区 教室"；教室缺失时补占位文字，
        // 不因为没地点就丢掉这门课。
        const campus = String(raw.xqmc || '').trim();
        const room = String(raw.cdmc || raw.jxdd || '').trim();
        // 不用 [a, b].filter(Boolean).join(' ')：真机上实测会丢掉校区（见文件头）。
        const place = room || '未排地点';
        const position = campus ? (campus + ' ' + place) : place;

        // --- 星期 ---
        const day = parseInt(raw.xqj, 10);
        if (isNaN(day) || day < 1 || day > 7) continue;

        // 周次只认 zcd。本校准方的 zcmc 是教师职称（教授/讲师/实验师），不是周次字符串。
        // zcd 缺失时 parseWeeks 返回空数组，下一行即把该行整条跳过，不会产出无周次的脏数据。
        const weeksArray = parseWeeks(raw.zcd || '');
        if (weeksArray.length === 0) continue;

        // --- 节次 ---
        const sectionSource = raw.jcor || raw.jcs || raw.jc || raw.jcsjmc || '';
        const sections = parseSections(sectionSource);
        if (!sections) continue;
        const { startSection, endSection } = sections;

        initialCourseList.push({
            name: courseName,
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    return mergeAndDistinctCourses(initialCourseList);
}

/* ============================================================
 * 三、网络请求
 * ============================================================ */

/**
 * 从当前页面 URL 推导教务系统上下文根（多数为 origin + /jwglxt，本校即 origin）。
 *
 * @returns {string} 形如 "http://host" 或 "http://host/jwglxt"
 */
function getContextRoot() {
    const origin = window.location.origin;
    const path = window.location.pathname || '';
    // 若当前路径里出现 /jwglxt/，则上下文根带该前缀
    const m = path.match(/^(.*?\/jwglxt)(?=\/|$)/);
    if (m) return origin + m[1];
    return origin;
}

/** 构造通用请求头 */
function jsonHeaders() {
    return {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'accept': 'application/json, text/javascript, */*; q=0.01'
    };
}

/**
 * 抓取课表页面，解析可选学年（xnm）与学期（xqm）；同时可判断是否已登录。
 *
 * @returns {Promise<object|null>} { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex }
 */
async function fetchAcademicOptions() {
    const url = getContextRoot() + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
    try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        if (!response.ok) return null;

        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');

        // 用下标循环，不用 Array.from / filter / map / slice（见文件头）
        const yearNodes = doc.querySelectorAll('#xnm option');
        const semNodes = doc.querySelectorAll('#xqm option');

        const allYearOptions = [];
        for (let i = 0; i < yearNodes.length; i++) {
            const opt = yearNodes[i];
            if (opt.value === '') continue;
            allYearOptions.push({
                value: opt.value,
                text: String(opt.textContent).trim(),
                selected: !!opt.selected
            });
        }

        const semesterOptions = [];
        for (let i = 0; i < semNodes.length; i++) {
            const opt = semNodes[i];
            if (opt.value === '') continue;
            semesterOptions.push({
                value: opt.value,
                text: String(opt.textContent).trim(),
                selected: !!opt.selected
            });
        }

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        let selectedIndex = -1;
        for (let i = 0; i < allYearOptions.length; i++) {
            if (allYearOptions[i].selected) { selectedIndex = i; break; }
        }

        let semSelectedIndex = -1;
        for (let i = 0; i < semesterOptions.length; i++) {
            if (semesterOptions[i].selected) { semSelectedIndex = i; break; }
        }
        const defaultSemesterIndex = semSelectedIndex !== -1 ? semSelectedIndex : 0;

        // 取子集也用循环，避开 slice
        const subYearOptions = [];
        if (selectedIndex === -1) {
            const end = Math.min(allYearOptions.length, 5);
            for (let i = 0; i < end; i++) subYearOptions.push(allYearOptions[i]);
        } else {
            // 以当前学年为中心，向前 2 年、向后 2 年，避免列表过长
            const start = Math.max(0, selectedIndex - 2);
            const end = Math.min(allYearOptions.length, selectedIndex + 3);
            for (let i = start; i < end; i++) subYearOptions.push(allYearOptions[i]);
        }

        return {
            yearOptions: subYearOptions,
            semesterOptions: semesterOptions,
            defaultYearIndex: selectedIndex === -1 ? 0 : selectedIndex - Math.max(0, selectedIndex - 2),
            defaultSemesterIndex: defaultSemesterIndex
        };
    } catch (e) {
        return null;
    }
}

/**
 * 让用户选择学年与学期；页面解析失败（如未登录）时按当前日期兜底并提示。
 *
 * @returns {Promise<{academicYear:string, semesterCode:string}|null>} 用户取消返回 null
 */
async function selectAcademicYearAndSemester() {
    let optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        // 兜底：未登录或页面结构异常时，按当前日期推测学年学期
        const d = new Date();
        const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
        const isFirstSemester = d.getMonth() >= 7;
        optionsData = {
            yearOptions: [
                { value: String(y - 1), text: `${y - 1}-${y}` },
                { value: String(y), text: `${y}-${y + 1}` },
                { value: String(y + 1), text: `${y + 1}-${y + 2}` }
            ],
            semesterOptions: [
                { value: '3', text: '第一学期' },
                { value: '12', text: '第二学期' }
            ],
            defaultYearIndex: 1,
            defaultSemesterIndex: isFirstSemester ? 0 : 1
        };
        window.shiguangBridge.showToast('未能读取学年列表，已切换为智能预测，请确认后选择');
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearTexts = [];
    for (let i = 0; i < yearOptions.length; i++) yearTexts.push(yearOptions[i].text);
    const semesterTexts = [];
    for (let i = 0; i < semesterOptions.length; i++) semesterTexts.push(semesterOptions[i].text);

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学年', JSON.stringify(yearTexts), defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期', JSON.stringify(semesterTexts), defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/**
 * POST 表单并返回解析后的 JSON。
 *
 * @param {string} url 接口地址
 * @param {string} body 表单内容
 * @returns {Promise<object|null>} 失败返回 null
 */
async function postForm(url, body) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: jsonHeaders(),
            body: body,
            credentials: 'include'
        });
        if (!response.ok) return null;
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            // 返回的不是 JSON，通常意味着会话已失效、被重定向到登录页
            return null;
        }
    } catch (e) {
        return null;
    }
}

/**
 * 获取课表数据，主接口失败时回落到备用接口。
 *
 * @param {string} academicYear 学年，如 "2026"
 * @param {string} semesterCode 学期代码，如 "3"
 * @returns {Promise<object|null>} 含 kbList 的 JSON
 */
async function fetchCourseJson(academicYear, semesterCode) {
    const root = getContextRoot();
    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;

    const endpoints = [
        root + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
        root + '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151'
    ];

    for (const url of endpoints) {
        const json = await postForm(url, body);
        if (json && Array.isArray(json.kbList) && json.kbList.length > 0) {
            return json;
        }
    }
    return null;
}

/**
 * 从校历接口取「第 1 周起始日期」与「本学期总周数」。
 * 总周数取校历的周次条目数而非课表最大周次（课表可能只排到 16 周而学期有 18 周）。
 * 该接口并非所有学校都开放，取不到时两个字段均为 null，调用方据此不写配置。
 *
 * @param {string} academicYear 学年
 * @param {string} semesterCode 学期代码
 * @returns {Promise<{startDate: string|null, totalWeeks: number|null}>}
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    const empty = { startDate: null, totalWeeks: null };

    const root = getContextRoot();
    const url = root + '/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154';
    const json = await postForm(url, `xnm=${academicYear}&xqm=${semesterCode}`);
    if (!json) return empty;

    let list = null;
    if (Array.isArray(json)) list = json;
    else if (Array.isArray(json.items)) list = json.items;
    if (!list || list.length === 0) return empty;

    // --- 第 1 周的起始日期 ---
    // 不用 find：找不到就用第一条
    let firstWeek = null;
    for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        if (String(item.zs) === '1' || String(item.zsmc) === '1') { firstWeek = item; break; }
    }
    if (!firstWeek) firstWeek = list[0];

    let startDate = null;
    const candidates = [firstWeek.rq, firstWeek.zcrq, firstWeek.ksrq, firstWeek.qsrq];
    for (let i = 0; i < candidates.length; i++) {
        if (!candidates[i]) continue;
        // "2026-09-07/2026-09-13" 这种区间取前半段
        const match = String(candidates[i]).match(/(\d{4}-\d{2}-\d{2})/);
        if (match) { startDate = match[1]; break; }
    }

    // --- 总周数：取校历里最大的周次序号，取不到序号就退回条目数 ---
    let maxZs = 0;
    let numbered = 0;
    for (let i = 0; i < list.length; i++) {
        const n = parseInt((list[i] || {}).zs, 10);
        if (!isNaN(n) && n > 0) {
            numbered++;
            if (n > maxZs) maxZs = n;
        }
    }
    const totalWeeks = numbered > 0 ? maxZs : list.length;

    return { startDate: startDate, totalWeeks: totalWeeks };
}

/**
 * 本校作息时间（节次 -> 起止时间）。
 *
 * 2026-09-16 从教务「学生课表查询（按周次）」(gnmkdm=N2154) 页面实测读取，共 14 节、
 * 每节 40 分钟：1 08:30 / 2 09:20 / 3 10:20 / 4 11:10 / 5 12:30 / 6 13:20 / 7 14:30 /
 * 8 15:20 / 9 16:20 / 10 17:10 / 11 19:00 / 12 19:50 / 13 20:40 / 14 21:30。
 * 是从系统里读出的真实值，不是按常识推测的通用作息。
 *
 * 写死的原因是无接口可取：jcsj_cxJcsj.html 对学生账号返回"没有访问权限!"，
 * 课表页 HTML、课表模块 JS、校历接口与页面 41 个 script 中均无作息数据。
 * 学校调整作息时，改这里或直接在 App「课表设置 → 作息时间」中改。
 */
const DEFAULT_TIME_SLOTS = [
    { number: 1,  startTime: '08:30', endTime: '09:10' },
    { number: 2,  startTime: '09:20', endTime: '10:00' },
    { number: 3,  startTime: '10:20', endTime: '11:00' },
    { number: 4,  startTime: '11:10', endTime: '11:50' },
    { number: 5,  startTime: '12:30', endTime: '13:10' },
    { number: 6,  startTime: '13:20', endTime: '14:00' },
    { number: 7,  startTime: '14:30', endTime: '15:10' },
    { number: 8,  startTime: '15:20', endTime: '16:00' },
    { number: 9,  startTime: '16:20', endTime: '17:00' },
    { number: 10, startTime: '17:10', endTime: '17:50' },
    { number: 11, startTime: '19:00', endTime: '19:40' },
    { number: 12, startTime: '19:50', endTime: '20:30' },
    { number: 13, startTime: '20:40', endTime: '21:20' },
    { number: 14, startTime: '21:30', endTime: '22:10' }
];

/**
 * @returns {Promise<Array>} 本校作息 TimeSlotJsonModel 数组
 */
async function fetchTimeSlots() {
    const out = [];
    for (let i = 0; i < DEFAULT_TIME_SLOTS.length; i++) {
        const s = DEFAULT_TIME_SLOTS[i];
        out.push({ number: s.number, startTime: s.startTime, endTime: s.endTime });
    }
    return out;
}

/* ============================================================
 * 四、桥接调用
 * ============================================================ */

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '重庆三峡科技大学教务课表导入',
        '导入前请确保您已在当前页面成功登录教务系统。\n\n本脚本只会读取课表数据，不会保存您的账号或密码。',
        '好的，开始导入'
    );
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败：${error.message}`);
        return false;
    }
}

/**
 * 构造要写入的课表配置；**信息不足时返回 null**，调用方据此跳过 saveCourseConfig
 * （原因见 runImportFlow 第 5 步）。
 *
 * @param {{startDate: string|null, totalWeeks: number|null}} semesterInfo 校历信息
 * @param {Array} courses 已解析的课程
 * @returns {object|null} 配置对象，或 null（一个字都不写）
 */
function buildCourseConfig(semesterInfo, courses) {
    const startDate = semesterInfo && semesterInfo.startDate;
    // 没有开学日期就什么都不写——这是硬性约束，不是可选项。
    if (!startDate) return null;

    const config = { semesterStartDate: startDate };

    const maxWeek = 0;
    for (let i = 0; i < (courses || []).length; i++) {
        const ws = courses[i].weeks || [];
        for (let k = 0; k < ws.length; k++) {
            if (ws[k] > maxWeek) maxWeek = ws[k];
        }
    }
    const totalWeeks = Math.max((semesterInfo && semesterInfo.totalWeeks) || 0, maxWeek);
    if (totalWeeks > 0) config.semesterTotalWeeks = totalWeeks;

    return config;
}

async function saveConfig(config) {
    if (!config || Object.keys(config).length === 0) return;
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        // 配置保存失败不阻断主流程
        window.shiguangBridge.showToast(`课表配置保存失败：${error.message}`);
    }
}

async function savePresetTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast(`时间段保存失败：${error.message}`);
    }
}

/* ============================================================
 * 五、主流程
 * ============================================================ */

async function runImportFlow() {
    // 1. 前置说明
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast('用户取消了导入。');
        return;
    }

    // 2. 选择学年学期
    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast('未选择学年学期，导入流程终止。');
        return;
    }
    const { academicYear, semesterCode } = selection;

    // 3. 拉取并解析课表
    window.shiguangBridge.showToast('正在获取课表数据…');
    const json = await fetchCourseJson(academicYear, semesterCode);
    if (!json) {
        await window.shiguangBridgePromise.showAlert(
            '获取失败',
            '未能获取课表数据。\n\n请确认：\n1. 已登录教务系统；\n2. 当前学期确实有课表；\n3. 网络可访问教务系统。',
            '知道了'
        );
        return;
    }

    const courses = parseJsonData(json);
    if (courses.length === 0) {
        window.shiguangBridge.showToast('未解析到任何课程，请检查所选学年学期。');
        return;
    }

    // 4. 保存课程
    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    // 5. 保存课表配置
    // 必须保持「有才写，没有就一个字都不写」：App 侧 importCourseConfig 对
    // semesterStartDate / semesterTotalWeeks 是**直接覆盖**而非兜底合并，发出一份
    // 不含开学日期的配置会把用户手动设好的开学日期清成 null，整张课表周次随之错位。
    // 本校校历接口实测经常返回空，所以取不到就完全不调 saveCourseConfig。
    const [semesterInfo, timeSlots] = await Promise.all([
        fetchSemesterInfo(academicYear, semesterCode),
        fetchTimeSlots()
    ]);
    const semesterStartDate = semesterInfo.startDate;

    // buildCourseConfig 在取不到开学日期时返回 null —— 此时一个字都不写。
    const config = buildCourseConfig(semesterInfo, courses);
    if (config) await saveConfig(config);

    // 6. 保存作息时间（使用实测的 DEFAULT_TIME_SLOTS；学校调整作息需更新该常量）
    await savePresetTimeSlots(timeSlots);

    // 7. 完成
    let msg = `导入成功，共 ${courses.length} 条课程安排！`;
    if (semesterStartDate) {
        msg += ` 开学日期：${semesterStartDate}`;
    } else {
        msg += '（未取到开学日期，已保留您的课表设置；若周次不对请在「课表设置」中手动设置开学日期）';
    }
    if (timeSlots.length > 0) msg += ` 作息已导入 ${timeSlots.length} 节`;

    window.shiguangBridge.showToast(msg);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
