// 南华大学(http://jwzx.usc.edu.cn:8924)拾光课程表适配脚本


const BASE_URL = "http://jwzx.usc.edu.cn:8924";
const [URL_COURSE, URL_CALENDAR] = [`${BASE_URL}/jsxsd/xskb/xskb_list.do`, `${BASE_URL}/jsxsd/jxzl/jxzl_query`];

// 工具函数
const parseSlots = arr => arr.map((s, i) => ({ number: i + 1, startTime: s.slice(0, 5), endTime: s.slice(6) }));
const TIME_SLOTS_SUMMER = parseSlots(["08:00-08:45","08:55-09:40","10:00-10:45","10:55-11:40","15:00-15:45","15:55-16:40","17:00-17:45","17:55-18:40","20:00-20:45","20:55-21:40"]);
const TIME_SLOTS_WINTER = parseSlots(["08:20-09:05","09:15-10:00","10:20-11:05","11:15-12:00","14:30-15:15","15:25-16:10","16:30-17:15","17:25-18:10","19:30-20:15","20:25-21:10"]);

const pad2 = n => String(n).padStart(2, "0");
const WEEK_MAP = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 日:7, 天:7 };

const parseWeeks = str => [...new Set((str || "").split("(")[0].split(",").flatMap(s => {
    const [st, ed] = s.split("-").map(Number);
    return (st && ed) ? Array.from({length: ed - st + 1}, (_, i) => st + i) : [st].filter(n => !isNaN(n));
}))].sort((a, b) => a - b);

const parseSectionRange = text => {
    const [_, s, e] = String(text || "").match(/(\d+)\s*(?:-\s*(\d+))?/) || [];
    return s ? { start: +s, end: +(e || s) } : null;
};

function parseDayColumns(table) {
    for (const row of table.rows) {
        const days = [...row.children].filter(el => /^(TH|TD)$/.test(el.tagName))
            .map(el => WEEK_MAP[el.textContent.trim().match(/^星期([一二三四五六日天])$/)?.[1]] || null);
        if (days.filter(Boolean).length >= 5) return days.filter(d => d !== null);
    }
    return null;
}

function parseCellCourses(cell, selector, day, rowSec) {
    const block = cell.querySelector(selector);
    if (!block?.innerHTML.trim() || block.innerHTML.trim() === "&nbsp;") return [];

    return block.innerHTML.split(/---------------------?/).flatMap(part => {
        if (!part.trim()) return [];
        const temp = document.createElement("div");
        temp.innerHTML = part;

        let name = "";
        for (const node of temp.childNodes) {
            if (node.tagName === "FONT") break;
            if (node.nodeType === 3) name += node.textContent.replace(/\s+/g, " ");
        }
        if (!(name = name.trim())) return [];

        const textOf = sel => (temp.querySelector(sel)?.textContent || "").trim();
        const teacher = textOf("font[title='老师'], font[title='教师']").replace("任课教师:", "") || "未知教师";
        const position = textOf("font[title='教室']") || "未知地点";
        const weekStr = textOf("font[title='周次(节次)']");

        const nums = (weekStr.match(/\[([\d\-,\s]+?)节\]/)?.[1] || "").split(/[^\d]+/).map(Number).filter(n => n > 0);
        const startSection = nums.length ? Math.min(...nums) : (rowSec?.start || 0);
        const endSection = nums.length ? Math.max(...nums) : (rowSec?.end || 0);
        const weeks = parseWeeks(weekStr);

        return (weeks.length && startSection) ? [{ name, teacher, position, day, startSection, endSection: Math.max(startSection, endSection), weeks }] : [];
    });
}

// 合并函数
function mergeAndDistinctCourses(courses) {
    if (!courses?.length) return [];
    const key1 = c => [c.name, c.teacher, c.position, c.day, c.weeks.join()].join("|");
    const key2 = c => [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join("|");

    return courses.map(c => ({...c, weeks: [...c.weeks].sort((a, b) => a - b)}))
        .sort((a, b) => key1(a).localeCompare(key1(b)) || a.startSection - b.startSection)
        .reduce((acc, n) => { // 阶段1：合并连续/重复节次
            const cur = acc[acc.length - 1];
            if (cur && key1(cur) === key1(n)) {
                if (cur.endSection + 1 === n.startSection) cur.endSection = n.endSection;
                else if (cur.startSection !== n.startSection || cur.endSection !== n.endSection) acc.push(n);
            } else acc.push(n);
            return acc;
        }, [])
        .sort((a, b) => key2(a).localeCompare(key2(b)))
        .reduce((acc, n) => { // 阶段2：合并相同节次的周次
            const cur = acc[acc.length - 1];
            if (cur && key2(cur) === key2(n)) cur.weeks = [...new Set([...cur.weeks, ...n.weeks])].sort((a,b) => a - b);
            else acc.push(n);
            return acc;
        }, []);
}

const parseTimetableToModel = doc => {
    const table = doc.getElementById("kbtable");
    if (!table) return [];
    const dayMap = parseDayColumns(table) || [1, 2, 3, 4, 5, 6, 7];
    const selector = table.querySelector("div.kbcontent") ? "div.kbcontent" : "div.kbcontent1";

    return mergeAndDistinctCourses([...table.rows].flatMap(row => {
        const cells = [...row.querySelectorAll("td")];
        const dayCells = cells.length === dayMap.length + 1 ? cells.slice(1) : cells;
        if (dayCells.length !== dayMap.length) return [];
        const rowSec = parseSectionRange(row.querySelector("th")?.textContent);
        return dayCells.flatMap((cell, i) => dayMap[i] ? parseCellCourses(cell, selector, dayMap[i], rowSec) : []);
    }));
};

// 网络请求与解析
const parseHtml = html => new DOMParser().parseFromString(html, "text/html");
const req = async (url, opts) => {
    const res = await fetch(url, { credentials: "include", ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
};
const formOpts = body => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });

const requestCoursePage = semId => req(URL_COURSE, formOpts(`jx0404id=&cj0701id=&zc=&demo=&xnxq01id=${semId||""}`));
const requestCoursePageByGet = semId => req(`${URL_COURSE}?xnxq01id=${encodeURIComponent(semId||"")}&zc=&cj0701id=&demo=`, { method: "GET" });
const requestCalendarPage = semId => req(URL_CALENDAR, formOpts(`xnxq01id=${semId}`));

function parseSemesterOptions(html) {
    const select = parseHtml(html).getElementById("xnxq01id");
    if (!select) return { list: [], defaultIndex: -1 };
    const all = [...select.options].map(o => ({ value: o.value, label: o.textContent.trim(), selected: o.selected })).filter(o => o.value);
    const idx = Math.max(0, all.findIndex(o => o.selected));
    const start = Math.max(0, idx - 3);
    return { list: all.slice(start, idx + 4), defaultIndex: idx - start };
}

async function fetchCourses(semId) {
    let html = await requestCoursePage(semId).catch(() => null);
    let courses = html ? parseTimetableToModel(parseHtml(html)) : [];
    if (!courses.length) {
        html = await requestCoursePageByGet(semId).catch(() => null);
        if (html) courses = parseTimetableToModel(parseHtml(html));
    }
    return courses;
}

async function fetchSemesterInfo(semId) {
    try {
        const doc = parseHtml(await requestCalendarPage(semId));
        const dates = [...doc.querySelectorAll("td[title]")].map(td => {
            const m = td.getAttribute("title")?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
            return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null;
        }).filter(Boolean).sort();
        const totalWeeks = Math.max(0, ...[...doc.querySelectorAll("#kbtable tr td:first-child")].map(td => parseInt(td.textContent, 10)).filter(n => !isNaN(n)));
        return { startDate: dates[0] || null, totalWeeks: totalWeeks || null };
    } catch { return { startDate: null, totalWeeks: null }; }
}

// 全局校验
window.validateStartDateInput = input => !input?.trim() || /^\d{4}-\d{1,2}-\d{1,2}$/.test(input.trim()) ? false : "请输入形如 2026-09-01 的日期，或留空跳过";

async function promptSemesterStartDate() {
    const input = await window.shiguangBridgePromise.showPrompt("设置开学日期", "未能自动获取开学日期...\n请输入本学期第一周的星期一日期（如 2026-09-01），留空则跳过：", "", "validateStartDateInput");
    const m = input?.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null;
}

const computeTotalWeeks = courses => {
    const max = Math.max(0, ...courses.flatMap(c => c.weeks || []));
    return (max > 0 && max <= 40) ? max : 20;
};

function buildComboSchedule(semId, label) {
    const [_, y0, y1, term] = String(semId || "").match(/^(\d{4})-(\d{4})-(\d)$/) || [];
    if (!term) return null;
    const Y = term === "2" ? +y1 : +y0;
    const winter = { name: "秋冬季作息", startDate: `${term === "2" ? Y - 1 : Y}-10-01`, endDate: `${term === "2" ? Y : Y + 1}-04-30`, timeSlots: [] };
    return {
        name: `南华大学 ${label || semId} 作息方案`,
        publicSchedules: [ { name: "夏秋季作息", startDate: `${Y}-05-01`, endDate: `${Y}-09-30`, timeSlots: TIME_SLOTS_SUMMER }, winter ].sort((a,b) => a.startDate.localeCompare(b.startDate))
    };
}

const saveAppConfig = (startDate, weeks) => window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: weeks || 20, firstDayOfWeek: 7, defaultClassDuration: 45, ...(startDate && { semesterStartDate: startDate }) }));
const saveAppTimeSlots = () => window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS_WINTER));

// 主流程
(async function runImportFlow() {
    const bridge = window.shiguangBridge, pBridge = window.shiguangBridgePromise;
    try {
        if (!await pBridge.showAlert("提示", "请确保已登录教务在线，并已打开「学期理论课表」页面。\n是否开始导入？", "开始")) return;

        bridge.showToast("正在获取学期列表...");
        const { list, defaultIndex } = parseSemesterOptions(await requestCoursePage(""));
        if (!list.length) return bridge.showToast("未获取到学期列表，请检查登录状态。");

        const selIdx = await pBridge.showSingleSelection("选择学期", JSON.stringify(list.map(s => s.label)), defaultIndex);
        if (selIdx === null) return bridge.showToast("已取消导入。");

        bridge.showToast("正在请求课程数据...");
        const sem = list[selIdx], courses = await fetchCourses(sem.value);
        if (!courses.length) return bridge.showToast("未发现课程，请检查学期选择或登录状态。");

        bridge.showToast("正在获取学期信息...");
        const { startDate, totalWeeks } = await fetchSemesterInfo(sem.value);
        const finalStart = startDate || await promptSemesterStartDate();

        await saveAppConfig(finalStart, totalWeeks || computeTotalWeeks(courses));
        await pBridge.saveImportedCourses(JSON.stringify(courses));

        try {
            if (await saveAppTimeSlots()) {
                const combo = buildComboSchedule(sem.value, sem.label);
                if (combo) await pBridge.saveComboSchedule(JSON.stringify(combo));
            }
        } catch { bridge.showToast("时间段或组合作息导入异常，已跳过。"); }

        bridge.showToast(`成功导入 ${courses.length} 条课程`);
        bridge.notifyTaskCompletion();
    } catch (e) { bridge.showToast("异常: " + e.message); }
})();