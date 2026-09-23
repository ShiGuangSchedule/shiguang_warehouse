// 浙江树人学院（浙江树人大学）拾光课程表适配脚本
// 学校: 浙江树人学院 / 浙江树人大学 (zjsru.edu.cn, ZJSRU)
// 教务: xk.jwc.zjsru.edu.cn —— 正方教务 ASP.NET WebForms 版（xskbcx.aspx 学生个人课表）
// 登录: 统一身份认证 CAS (rz.zjsru.edu.cn)，教务首页会自动跳转
//
// 与 SHUFEZJ / UJS 的正方适配不同：这里是 WebForms 版，课表为服务端渲染的 HTML 表格
// (table#Table1.schedule)，单元格以 <br> 分行、且一格可能并排多门课，故按「周X第N节」
// 锚点切分；学年/学期是服务端控件，切换需要 __EVENTTARGET 回发。
// 软件是在点击「执行导入」时把脚本注入当前页执行一次，CAS 登录后一般停在教务首页，
// 因此脚本会在同域内自行拉取课表页取数。
//
// 作息时间取自学校官方校历底部《上课时间表》
// (https://www.zjsru.edu.cn/info/1411/54428.htm)，拱宸桥 / 杨汛桥两校区不同，
// 导入时由用户选择，见 ZJSRU_CAMPUS_TIME_SLOTS。
//
// 取数基址由 location.pathname 推导，因此若用户经 WebVPN 打开教务（页面地址形如
// /https/webvpn<hash>/xskbcx.aspx），脚本同样可以正常工作。
//
// 参考: SUDA（同为 table#Table1.schedule 结构）；多校区作息参照 GDPU / HNSF
// Author: CagierAsh123

// ========================== 常量 ==========================

// 课表页里「周X第N节{周次}」这一行的形态
const ZJSRU_PERIOD_RE = /^周([一二三四五六日天])第([0-9]+(?:,[0-9]+)*)节(?:\{([^}]*)\})?$/;
const ZJSRU_DAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
const ZJSRU_TERM_NAMES = { "1": "第1学期", "2": "第2学期", "3": "第3学期(短)" };
const ZJSRU_TABLE_SELECTOR = "table#Table1.schedule";
const ZJSRU_MIN_TOTAL_WEEKS = 18; // 学期总周数下限，避免个别短课表把学期截断

// ========================== 作息时间（来源：学校官方校历） ==========================
// https://www.zjsru.edu.cn/info/1411/54428.htm 底部《上课时间表》
// 注：杨汛桥校区不设第五节。软件的作息校验要求节次必须从 1 起连续编号
//     （validateTimeSlotsOrThrow），否则导入会直接报错；而教务系统给杨汛桥
//     学生排课时仍按全校统一节次返回（下午第一节就是「第六节」，并未坍缩为
//     -1 或重编号），所以这里虚拟一个第 5 节占位以保持节次连续，
//     使第六节仍然落在 6 号上。
const ZJSRU_CAMPUS_TIME_SLOTS = {
    gongchenqiao: {
        label: "拱宸桥校区",
        slots: [
            { number: 1, startTime: "08:10", endTime: "08:50" },
            { number: 2, startTime: "09:00", endTime: "09:40" },
            { number: 3, startTime: "09:55", endTime: "10:35" },
            { number: 4, startTime: "10:45", endTime: "11:25" },
            { number: 5, startTime: "11:35", endTime: "12:15" },
            { number: 6, startTime: "13:30", endTime: "14:10" },
            { number: 7, startTime: "14:20", endTime: "15:00" },
            { number: 8, startTime: "15:10", endTime: "15:50" },
            { number: 9, startTime: "16:00", endTime: "16:40" },
            { number: 10, startTime: "18:10", endTime: "18:50" },
            { number: 11, startTime: "19:00", endTime: "19:40" },
            { number: 12, startTime: "19:50", endTime: "20:30" }
        ]
    },
    yangxunqiao: {
        label: "杨汛桥校区",
        slots: [
            { number: 1, startTime: "08:30", endTime: "09:10" },
            { number: 2, startTime: "09:15", endTime: "09:55" },
            { number: 3, startTime: "10:10", endTime: "10:50" },
            { number: 4, startTime: "10:55", endTime: "11:35" },
            { number: 5, startTime: "11:35", endTime: "12:15" },
            { number: 6, startTime: "13:30", endTime: "14:10" },
            { number: 7, startTime: "14:15", endTime: "14:55" },
            { number: 8, startTime: "15:05", endTime: "15:45" },
            { number: 9, startTime: "15:50", endTime: "16:30" },
            { number: 10, startTime: "18:00", endTime: "18:40" },
            { number: 11, startTime: "18:45", endTime: "19:25" },
            { number: 12, startTime: "19:30", endTime: "20:10" }
        ]
    }
};

// ========================== 表格解析 ==========================

/**
 * 取出单元格的文本行。正方的课程信息用 <br> 分行，需要先把 <br> 还原成换行。
 */
function zjsruCellLines(cell) {
    const doc = cell.ownerDocument || document;
    const html = (cell.innerHTML || "").replace(/<br\s*\/?>/gi, "\n");
    const tmp = doc.createElement("div");
    tmp.innerHTML = html;
    return (tmp.textContent || "")
        .split("\n")
        .map(s => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

/**
 * 解析花括号里的周次，兼容：
 *   "第2-18周" / "第9-9周" / "第3-17周|单周" / "第2-18周|双周" / "第1-5,7-9周"
 * 返回升序去重后的周次数组。
 */
function zjsruParseWeeks(brace) {
    if (!brace) return [];
    const weeks = new Set();
    const odd = /\|?\s*单周/.test(brace);
    const even = /\|?\s*双周/.test(brace);
    const body = brace.split("|")[0].replace(/第/g, "").replace(/周/g, "");
    for (const seg of body.split(",")) {
        const part = seg.trim();
        if (!part) continue;
        const range = part.match(/(\d+)\s*[-~－—]\s*(\d+)/);
        let start, end;
        if (range) {
            start = parseInt(range[1], 10);
            end = parseInt(range[2], 10);
        } else {
            const single = part.match(/(\d+)/);
            if (!single) continue;
            start = end = parseInt(single[1], 10);
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        if (start > end) [start, end] = [end, start];
        if (end > 60) end = 60; // 防御异常数据
        for (let w = start; w <= end; w++) {
            if (odd && w % 2 === 0) continue;
            if (even && w % 2 === 1) continue;
            weeks.add(w);
        }
    }
    return [...weeks].sort((a, b) => a - b);
}

/**
 * 解析一个单元格里的所有课程。
 * 结构: 课程名 / 周X第N节{周次} / 教师 / 教室 [/ 附加信息...]，多门课依次排列。
 * 星期取自课程自身的「周X」，不依赖表格列序，列布局变化也不会错位。
 */
function zjsruParseCell(cell) {
    const lines = zjsruCellLines(cell);
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
        if (ZJSRU_PERIOD_RE.test(lines[i])) anchors.push(i);
    }
    const courses = [];
    for (let a = 0; a < anchors.length; a++) {
        const k = anchors[a];
        const name = (lines[k - 1] || "").trim();
        if (!name) continue;
        const m = lines[k].match(ZJSRU_PERIOD_RE);
        if (!m) continue;
        const day = ZJSRU_DAY_MAP[m[1]];
        if (!day) continue;
        const sections = m[2].split(",").map(s => parseInt(s, 10)).filter(Number.isFinite);
        if (!sections.length) continue;
        const weeks = zjsruParseWeeks(m[3]);
        if (!weeks.length) continue;
        // 本门课的附加行：下一门课的课名行为界
        const stop = (a + 1 < anchors.length) ? anchors[a + 1] - 1 : lines.length;
        const rest = lines.slice(k + 1, stop);
        courses.push({
            name: name,
            teacher: (rest[0] || "").trim(),
            position: (rest[1] || "").trim(),
            day: day,
            startSection: Math.min(...sections),
            endSection: Math.max(...sections),
            weeks: weeks
        });
    }
    return courses;
}

/**
 * 解析整个课表表格。正方的 rowspan 单元格在 DOM 里只属于一行，
 * 直接遍历所有 td 不会重复；星期由每门课自己的「周X」决定。
 */
function zjsruParseTable(table) {
    const courses = [];
    for (const cell of table.querySelectorAll("td")) {
        for (const c of zjsruParseCell(cell)) courses.push(c);
    }
    return mergeAndDistinctCourses(courses);
}

/**
 * 节次与周次合并去重。
 * 直接取自 wiki《课程合并与去重函数》提供的参考实现，未做改动：
 * https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
            (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// ========================== 页面定位与取数 ==========================

/**
 * 查找课表表格，兼容直接打开课表页与同源 iframe 嵌套
 */
function zjsruFindTable(doc) {
    doc = doc || document;
    let table = doc.querySelector(ZJSRU_TABLE_SELECTOR);
    if (table) return table;
    for (const iframe of doc.querySelectorAll("iframe")) {
        try {
            const inner = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!inner) continue;
            table = inner.querySelector(ZJSRU_TABLE_SELECTOR);
            if (table) return table;
        } catch (_) { /* 跨域忽略 */ }
    }
    return null;
}

/**
 * 识别学号：优先取当前 URL 的 xh 参数，其次找教务首页菜单里的 xh=xxxx 链接。
 */
function zjsruDetectStudentId(doc) {
    doc = doc || document;
    try {
        const fromUrl = new URLSearchParams(location.search).get("xh");
        if (fromUrl && /^\d{4,}$/.test(fromUrl.trim())) return fromUrl.trim();
    } catch (_) { /* ignore */ }
    for (const a of doc.querySelectorAll("a[href*='xh=']")) {
        const m = (a.getAttribute("href") || "").match(/[?&]xh=(\d{4,})/);
        if (m) return m[1];
    }
    const m2 = (doc.documentElement ? doc.documentElement.innerHTML : "").match(/[?&]xh=(\d{4,})/);
    return m2 ? m2[1] : "";
}

/**
 * 课表页地址。基址取自当前路径，因此校内直连与 WebVPN 代理路径都适用。
 */
function zjsruScheduleUrl(studentId) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const qs = studentId ? ("?xh=" + encodeURIComponent(studentId) + "&type=1") : "?type=1";
    return new URL("xskbcx.aspx" + qs, base).toString();
}

async function zjsruFetchDoc(url) {
    const res = await fetch(url, { method: "GET", credentials: "include" });
    if (!res.ok) return null;
    const html = await res.text();
    return new DOMParser().parseFromString(html, "text/html");
}

/**
 * 读取课表页上的学年/学期下拉项
 */
function zjsruReadTermOptions(doc) {
    const yearSel = doc.querySelector("select#xnd");
    const termSel = doc.querySelector("select#xqd");
    if (!yearSel || !termSel) return null;
    const years = [...yearSel.options].map(o => o.value).filter(v => v);
    const terms = [...termSel.options].map(o => o.value).filter(v => v);
    if (!years.length || !terms.length) return null;
    const combos = [];
    for (const y of years) {
        for (const t of terms) combos.push({ year: y, term: t });
    }
    const current = combos.findIndex(c => c.year === yearSel.value && c.term === termSel.value);
    return { combos: combos, currentIndex: current < 0 ? 0 : current };
}

/**
 * 切换学年/学期：正方用 __EVENTTARGET 回发，必须带上当前页的 __VIEWSTATE
 */
async function zjsruFetchTermDoc(url, doc, year, term) {
    const pick = (name) => {
        const el = doc.querySelector("input[name='" + name + "']");
        return el ? el.value : "";
    };
    const body = new URLSearchParams();
    body.set("__EVENTTARGET", "xnd");
    body.set("__EVENTARGUMENT", "");
    body.set("__LASTFOCUS", "");
    body.set("__VIEWSTATE", pick("__VIEWSTATE"));
    body.set("__VIEWSTATEGENERATOR", pick("__VIEWSTATEGENERATOR"));
    body.set("xnd", year);
    body.set("xqd", term);
    const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
    });
    if (!res.ok) return null;
    const html = await res.text();
    return new DOMParser().parseFromString(html, "text/html");
}

// ========================== 业务步骤 ==========================

/**
 * 公告与前置确认
 */
async function zjsruPromptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "浙江树人学院 · 教务导入",
        "请先在本页面完成统一身份认证（CAS）登录。\n\n"
        + "导入时会自动拉取「学生个人课表」，并识别可选的学年/学期供你选择，"
        + "不需要手动打开课表页。",
        "我已登录，开始导入"
    );
}

/**
 * 定位课表：当前页就是课表页则直接用，否则在同域内自行拉取
 * @returns {Promise<{doc: Document, table: Element, url: string}|null>}
 */
async function zjsruLocateSchedule() {
    const table = zjsruFindTable(document);
    if (table) return { doc: document, table: table, url: "" };

    if (!/(^|\.)zjsru\.edu\.cn$/.test(location.hostname)) {
        window.shiguangBridge.showToast("当前不在浙江树人学院教务系统页面，请先登录教务系统。");
        return null;
    }

    window.shiguangBridge.showToast("正在获取课表页面...");
    const url = zjsruScheduleUrl(zjsruDetectStudentId(document));
    const doc = await zjsruFetchDoc(url);
    if (!doc) {
        window.shiguangBridge.showToast("课表页请求失败，请检查登录状态或网络环境。");
        return null;
    }
    const fetchedTable = zjsruFindTable(doc);
    if (!fetchedTable) {
        window.shiguangBridge.showToast("未获取到课表，请确认已登录统一身份认证（CAS）。");
        return null;
    }
    return { doc: doc, table: fetchedTable, url: url };
}

/**
 * 选择并切换到目标学年/学期（默认当前学期）
 * @returns {Promise<{doc: Document, table: Element, url: string}|null>}
 */
async function zjsruChooseTerm(schedule) {
    const termInfo = zjsruReadTermOptions(schedule.doc);
    if (!termInfo || termInfo.combos.length <= 1) return schedule;

    const labels = termInfo.combos.map(c =>
        c.year + " 学年 " + (ZJSRU_TERM_NAMES[c.term] || ("第" + c.term + "学期")));
    const picked = await window.shiguangBridgePromise.showSingleSelection(
        "选择要导入的学期",
        JSON.stringify(labels),
        termInfo.currentIndex
    );
    if (picked === null || picked === undefined || picked < 0) {
        window.shiguangBridge.showToast("导入已取消。");
        return null;
    }

    const target = termInfo.combos[picked];
    const shownYear = (schedule.doc.querySelector("select#xnd") || {}).value;
    const shownTerm = (schedule.doc.querySelector("select#xqd") || {}).value;
    if (target.year === shownYear && target.term === shownTerm) return schedule;

    window.shiguangBridge.showToast("正在切换到 " + labels[picked] + "...");
    const pageUrl = schedule.url || (location.origin + location.pathname + location.search);
    const switched = await zjsruFetchTermDoc(pageUrl, schedule.doc, target.year, target.term);
    const switchedTable = switched ? zjsruFindTable(switched) : null;
    if (!switchedTable) {
        window.shiguangBridge.showToast("切换学期失败，请稍后重试。");
        return null;
    }
    return { doc: switched, table: switchedTable, url: schedule.url };
}

/**
 * 选择所在校区（决定导入哪一套作息时间）
 * @returns {Promise<string|null>} 校区 key
 */
async function zjsruSelectCampus() {
    const keys = Object.keys(ZJSRU_CAMPUS_TIME_SLOTS);
    const labels = keys.map(k => ZJSRU_CAMPUS_TIME_SLOTS[k].label);
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择所在校区",
        JSON.stringify(labels),
        0
    );
    if (idx === null || idx === undefined || idx < 0 || idx >= keys.length) {
        window.shiguangBridge.showToast("导入已取消，未选择校区。");
        return null;
    }
    return keys[idx];
}

/**
 * 提交课程数据
 */
async function zjsruSaveCourses(courses) {
    window.shiguangBridge.showToast("正在保存 " + courses.length + " 条课程...");
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

/**
 * 提交课表配置。学期开始日期留空：各学期开学日不是固定公式，
 * 写死会导致整张课表周次偏移，交由用户在软件内设置。
 */
async function zjsruSaveConfig(courses) {
    const maxWeek = courses.reduce((mx, c) => Math.max(mx, ...c.weeks), 0);
    const config = {
        semesterStartDate: null,
        semesterTotalWeeks: Math.max(ZJSRU_MIN_TOTAL_WEEKS, maxWeek)
    };
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        console.error("JS: 保存课表配置失败:", error);
    }
}

/**
 * 提交所选校区的作息时间
 */
async function zjsruImportTimeSlots(campusKey) {
    const campus = ZJSRU_CAMPUS_TIME_SLOTS[campusKey];
    if (!campus) return;
    window.shiguangBridge.showToast("正在导入" + campus.label + "作息时间...");
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(campus.slots));
        console.log("JS: 已导入 " + campus.label + " 作息 " + campus.slots.length + " 节");
    } catch (error) {
        window.shiguangBridge.showToast("作息时间导入失败: " + error.message);
    }
}

// ========================== 主流程 ==========================

async function runImportFlow() {
    // 1. 公告与前置确认
    const confirmed = await zjsruPromptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 2. 定位课表页
    const schedule = await zjsruLocateSchedule();
    if (!schedule) return;

    // 3. 选择学期
    const chosen = await zjsruChooseTerm(schedule);
    if (!chosen) return;

    // 4. 选择校区
    const campusKey = await zjsruSelectCampus();
    if (!campusKey) return;

    // 5. 解析课程
    const courses = zjsruParseTable(chosen.table);
    console.log("JS: 解析到 " + courses.length + " 条课程记录");
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到任何课程，该学期可能没有排课。");
        return;
    }

    // 6. 保存课程
    const saved = await zjsruSaveCourses(courses);
    if (!saved) return;

    // 7. 保存课表配置
    await zjsruSaveConfig(courses);

    // 8. 导入作息时间（失败不阻断整体流程）
    await zjsruImportTimeSlots(campusKey);

    // 9. 流程完全成功
    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 条课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
