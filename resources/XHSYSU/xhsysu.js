// 广州新华学院 (xhsysu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统V9标准接口适配（CAS SSO版）
// 课表 POST /kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151   校历 POST /kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154
// 校内直连前缀为空；经 WebVPN 时路径带 /http/<hex> 前缀，需保留

// 校内统一作息（14 节，40 分钟一节，08:20 起），来源：教务处「上课时间段一览表」
const XHSYSU_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:10", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "10:50" },
    { number: 4, startTime: "11:00", endTime: "11:40" },
    { number: 5, startTime: "11:50", endTime: "12:30" },
    { number: 6, startTime: "12:40", endTime: "13:20" },
    { number: 7, startTime: "13:30", endTime: "14:10" },
    { number: 8, startTime: "14:20", endTime: "15:00" },
    { number: 9, startTime: "15:10", endTime: "15:50" },
    { number: 10, startTime: "16:10", endTime: "16:50" },
    { number: 11, startTime: "17:00", endTime: "17:40" },
    { number: 12, startTime: "19:00", endTime: "19:40" },
    { number: 13, startTime: "19:50", endTime: "20:30" },
    { number: 14, startTime: "20:40", endTime: "21:20" }
];

// 校内直连前缀为空，WebVPN 需保留 /http/<hex>，否则变成跨域请求
function apiUrl(path) {
    const prefix = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    return window.location.origin + (prefix ? prefix[0] : "") + path;
}

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));
    // 排序键里 weeks 必须先于 startSection，否则同节次不同周次的记录会插进来打断连续节次
    list.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) || (a.startSection || 0) - (b.startSection || 0));
    const step1 = [];
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
        const nxt = list[i];
        const same = cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.weeks.join(',') === nxt.weeks.join(',');
        if (same && cur.endSection + 1 === nxt.startSection) cur.endSection = nxt.endSection;
        else if (same && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) continue;
        else { step1.push(cur); cur = nxt; }
    }
    step1.push(cur);
    // 再按节次排序，把同节次不同周次的记录并到一起
    step1.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) || (a.endSection || 0) - (b.endSection || 0));
    const step2 = [];
    cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        if (cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else { step2.push(cur); cur = nxt; }
    }
    step2.push(cur);
    return step2.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const text = String(weekStr);
    const keepOdd = text.includes("单");
    const keepEven = text.includes("双");
    const weeks = [];
    // "周/单/双/第"与括号统一换成分隔符，剩下的就是纯数字或"起-止"
    for (const part of text.replace(/[单双第周()（）]/g, ",").split(",")) {
        const [from, to] = part.split("-").map(Number);
        if (!from) continue;
        for (let w = from; w <= (to || from); w++) {
            if (keepOdd && w % 2 === 0) continue;
            if (keepEven && w % 2 !== 0) continue;
            weeks.push(w);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const list = [];
    for (const c of jsonData.kbList) {
        if (!c.kcmc || !c.xqj || !c.jcs || !c.zcd) continue;
        const weeks = parseWeeks(c.zcd);
        if (!weeks.length) continue;
        const parts = c.jcs.split('-');
        const startSection = Number(parts[0]);
        const endSection = Number(parts[parts.length - 1]);
        const day = Number(c.xqj);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) continue;
        // cdmc 返回"未排地点"时不是真实教室，置空
        const position = String(c.cdmc || "").trim();
        list.push({
            name: c.kcmc.trim(),
            teacher: String(c.xm || "").trim(),
            position: position === "未排地点" ? "" : position,
            day, startSection, endSection, weeks
        });
    }
    return mergeAndDistinctCourses(list);
}

// CAS 入口为 /lyuapServer/login，登录后跳 /sso/lyiotlogin，WebVPN 下路径含 /http/<hex>
function isLoginPage() {
    return window.location.href.includes("lyuapServer/login") ||
        window.location.pathname.endsWith("/sso/lyiotlogin");
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录广州新华学院教务系统", "好的，开始导入");
}

async function fetchAcademicOptions() {
    try {
        const resp = await fetch(apiUrl("/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151"), { method: "GET", credentials: "include" });
        if (!resp.ok) return null;
        const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
        const read = sel => Array.from(doc.querySelectorAll(sel + " option")).filter(o => o.value !== "")
            .map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.hasAttribute("selected") }));
        const years = read("#xnm"), semesters = read("#xqm");
        if (!years.length || !semesters.length) return null;
        // 学年过多，只取当前选中项前后各 2 项
        const selIdx = years.findIndex(o => o.selected);
        const start = Math.max(0, (selIdx === -1 ? 0 : selIdx) - 2);
        return {
            yearOptions: years.slice(start, Math.min(years.length, (selIdx === -1 ? 0 : selIdx) + 3)),
            semesterOptions: semesters,
            defaultYearIndex: selIdx === -1 ? 0 : selIdx - start,
            defaultSemesterIndex: Math.max(0, semesters.findIndex(o => o.selected))
        };
    } catch (e) { return null; }
}

async function selectAcademicYearAndSemester() {
    const data = await fetchAcademicOptions();
    if (!data) { window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保已登录。"); return null; }
    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = data;
    const yearIdx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(yearOptions.map(o => o.text)), defaultYearIndex);
    if (yearIdx === null || yearIdx === -1) return null;
    const semIdx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(semesterOptions.map(o => o.text)), defaultSemesterIndex);
    if (semIdx === null || semIdx === -1) return null;
    return { academicYear: yearOptions[yearIdx].value, semesterCode: semesterOptions[semIdx].value };
}

// 校历接口：按周返回数组，zs=周次，rq=该周起止("2026-08-31/2026-09-06")
// 第 1 周周一即开学日期，数组长度为该学期总周数
async function fetchSemesterWeeks(academicYear, semesterCode) {
    try {
        const resp = await fetch(apiUrl("/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154"), {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });
        if (!resp.ok) return null;
        const json = JSON.parse(await resp.text());
        if (!Array.isArray(json) || !json.length) return null;
        const first = json.find(i => Number(i.zs) === 1) || json[0];
        const startDate = String(first.rq || "").split("/")[0].trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
        return { startDate, totalWeeks: json.length };
    } catch (e) { return null; }
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    const [resp, weeks] = await Promise.all([
        fetch(apiUrl("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`,
            credentials: "include"
        }),
        fetchSemesterWeeks(academicYear, semesterCode)
    ]);
    try {
        if (!resp.ok) throw new Error("状态码 " + resp.status);
        const courses = parseJsonData(JSON.parse(await resp.text()));
        if (!courses.length) throw new Error("未找到课程数据，请确认所选学年学期正确或教务需要二次登录。");
        // 校历周数可能少于课程实际最大周次（实测达 18 周），取较大者避免高位周次被截断
        const maxWeek = Math.max(...courses.flatMap(c => c.weeks));
        return {
            courses,
            config: weeks ? {
                semesterStartDate: weeks.startDate,
                semesterTotalWeeks: Math.max(weeks.totalWeeks, maxWeek)
            } : null
        };
    } catch (e) {
        window.shiguangBridge.showToast("导入失败：" + e.message);
        console.error("JS: Import Error", e);
        return null;
    }
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (e) {
        window.shiguangBridge.showToast("课程保存失败: " + e.message);
        return false;
    }
}

// 应用侧 saveCourseConfig 是整体覆盖，不传 semesterStartDate 会清空用户已设的开学日期，所以只在拿到校历时写入
async function saveConfig(config) {
    if (!config) {
        window.shiguangBridge.showToast("未取到开学日期，已跳过课表配置，请在应用内手动设置。");
        return;
    }
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`开学日期 ${config.semesterStartDate}，共 ${config.semesterTotalWeeks} 周。`);
    } catch (e) {
        window.shiguangBridge.showToast("课表配置保存失败: " + e.message);
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }
    if (!await promptUserToStart()) { window.shiguangBridge.showToast("用户取消了导入。"); return; }
    const sel = await selectAcademicYearAndSemester();
    if (!sel) { window.shiguangBridge.showToast("未选择学年学期，导入终止。"); return; }
    const result = await fetchAndParseCourses(sel.academicYear, sel.semesterCode);
    if (!result) return;
    if (!await saveCourses(result.courses)) return;
    await saveConfig(result.config);
    try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(XHSYSU_TIME_SLOTS)); } catch (e) {}
    window.shiguangBridge.showToast("课程导入成功，共导入 " + result.courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();