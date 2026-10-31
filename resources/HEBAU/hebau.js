// 河北农业大学 (urp.hebau.edu.cn) 拾光课程表适配脚本
// 金智教务 jwapp/sys/wdkb 模块，各接口均为 POST：
//   学期列表 /jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do      body: *order=-DM
//   校历     /jwapp/sys/wdkb/modules/xskcb/cxxljc.do        body: XN=&XQ=
//   课表     /jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do    body: XNXQDM=
//   作息     /jwapp/sys/wdkb/modules/jshkcb/jc.do           body: 空
// 周次用 SKZC 位图：第 i 位为 '1' 表示第 i+1 周有课

async function postForm(path, params) {
    const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error("接口请求失败（HTTP " + response.status + "）");
    return response.json();
}

// 金智响应统一取 datas.<key>.rows
function rowsOf(payload, key) {
    const data = payload && payload.datas && payload.datas[key];
    return data && Array.isArray(data.rows) ? data.rows : [];
}

// SKZC 位图 → 周次数组
function parseWeeks(bitmap) {
    const weeks = [];
    const text = String(bitmap || "");
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === "1") weeks.push(i + 1);
    }
    return weeks;
}

// 学期列表没有「当前学期」标记，按日期推断作为默认选项：9月~次年1月为第一学期
function inferYearTerm() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 9) return year + "-" + (year + 1) + "-1";
    if (month <= 1) return (year - 1) + "-" + year + "-1";
    return (year - 1) + "-" + year + "-2";
}

// 每条课表行 = 一天的一段课，按「课程名+教师+星期+节次+教室」合并同键周次
function parseCourses(tableRows) {
    const map = new Map();
    for (const row of tableRows) {
        const name = String(row.KCM || "").trim();
        const day = Number(row.SKXQ);
        const startSection = Number(row.KSJC);
        const endSection = Number(row.JSJC);
        const weeks = parseWeeks(row.SKZC);
        if (!name || day < 1 || day > 7 || !startSection || !endSection ||
            startSection > endSection || weeks.length === 0) continue;

        const teacher = String(row.SKJS || "").trim();
        const position = String(row.JASMC || "").trim();
        const key = [name, teacher, day, startSection, endSection, position].join("|");
        const holder = map.get(key);
        if (holder) {
            holder.weeks = Array.from(new Set([...holder.weeks, ...weeks])).sort((a, b) => a - b);
        } else {
            map.set(key, { name, teacher, position, day, startSection, endSection, weeks });
        }
    }
    return Array.from(map.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录河北农业大学教务系统", "好的，开始导入");
}

async function selectSemester(semesterRows, defaultTerm) {
    const defaultIndex = semesterRows.findIndex(row => row.DM === defaultTerm);
    const names = semesterRows.map(row => row.MC || row.DM);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(names), defaultIndex === -1 ? 0 : defaultIndex);
    if (index === null || index === -1) return null;
    return semesterRows[index];
}

// 校历：开学日期与总周数（ZZC 为总周数，取不到退回 ZJXZC）
async function fetchSemesterConfig(term) {
    try {
        const payload = await postForm("/jwapp/sys/wdkb/modules/xskcb/cxxljc.do",
            { XN: term.XNDM, XQ: term.XQDM });
        const row = rowsOf(payload, "cxxljc")[0];
        if (!row) return null;
        const beginDate = String(row.XQKSRQ || "").split(" ")[0];
        const totalWeeks = Number(row.ZZC) || Number(row.ZJXZC) || 0;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(beginDate) || !totalWeeks) return null;
        return { semesterStartDate: beginDate, semesterTotalWeeks: totalWeeks };
    } catch (e) { return null; }
}

async function fetchTimeSlots() {
    try {
        const payload = await postForm("/jwapp/sys/wdkb/modules/jshkcb/jc.do", {});
        return rowsOf(payload, "jc").map(row => ({
            number: row.DM,
            startTime: row.KSSJ,
            endTime: row.JSSJ
        }));
    } catch (e) { return []; }
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

async function runImportFlow() {
    if (!await promptUserToStart()) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

    try {
        const semesterRows = rowsOf(
            await postForm("/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do", { "*order": "-DM" }),
            "xnxqcx"
        ).filter(row => row && row.DM);
        if (semesterRows.length === 0) throw new Error("未获取到学期列表。");

        const term = await selectSemester(semesterRows, inferYearTerm());
        if (!term) { window.shiguangBridge.showToast("未选择学期，导入终止。"); return; }

        window.shiguangBridge.showToast("正在请求课表数据...");
        const [tablePayload, config, timeSlots] = await Promise.all([
            postForm("/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do", { XNXQDM: term.DM }),
            fetchSemesterConfig(term),
            fetchTimeSlots()
        ]);

        const courses = parseCourses(rowsOf(tablePayload, "cxxszhxqkb"));
        if (courses.length === 0) throw new Error("未找到课程数据，请确认所选学期是否正确。");
        if (!await saveCourses(courses)) return;

        if (config) {
            try { await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)); } catch (e) {}
        }
        if (timeSlots.length > 0) {
            try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots)); } catch (e) {}
        }

        window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        window.shiguangBridge.showToast("导入失败：" + e.message);
        console.error("JS: Import Error", e);
    }
}

runImportFlow();