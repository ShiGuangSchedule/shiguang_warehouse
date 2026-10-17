// 西南林业大学 (swfu.edu.cn) 拾光课程表适配脚本
// 正方教务 V9，接口：
// 学年学期 GET /jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151
// 课表 POST /jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151  xnm=&xqm=3&kzlx=ck&xsdm=&kclbdm=&kclxdm=
// 校历 POST /jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154  xnm=&xqm=   (rq/zs 字段)

const SWFU_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:10", endTime: "09:55" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "16:05", endTime: "16:50" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:20", endTime: "20:05" },
    { number: 11, startTime: "20:25", endTime: "21:10" },
    { number: 12, startTime: "21:15", endTime: "22:00" }
];

//解析周次字符串，处理单双周和周次范围
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const cleaned = weekStr
        .replace(/周数[:：]/g, '')
        .replace(/第/g, '')
        .replace(/周/g, '')
        .replace(/共\s*\d+\s*.*$/g, '');

    const segments = cleaned.split(/[,，、;；]/);

    const weeks = [];
    const segRegex = /(\d+)(?:\s*[-~]\s*(\d+))?\s*(?:[（(]?\s*([单双])\s*周?\s*[)）]?)?/g;

    for (const seg of segments) {
        const s = seg.trim();
        if (!s) continue;

        segRegex.lastIndex = 0;
        let m;
        while ((m = segRegex.exec(s)) !== null) {
            if (m[0] === '') {
                segRegex.lastIndex++;
                continue;
            }

            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : start;
            const flagStr = m[3] || '';

            let flag = 0;
            if (flagStr.includes('单')) flag = 1;
            else if (flagStr.includes('双')) flag = 2;

            for (let w = start; w <= end; w++) {
                if (flag === 1 && w % 2 === 0) continue;
                if (flag === 2 && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析 API 返回的 JSON 数据
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const courses = [];
    for (const c of jsonData.kbList) {
        if (!c.kcmc || !c.xqj || !c.jcs || !c.zcd) continue;
        const weeks = parseWeeks(c.zcd);
        if (!weeks.length) continue;
        const parts = String(c.jcs).split("-");
        const startSection = Number(parts[0]);
        const endSection = Number(parts[parts.length - 1]);
        const day = Number(c.xqj);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) continue;
        courses.push({
            name: String(c.kcmc).trim(),
            teacher: String(c.xm || "").trim(),
            position: String(c.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        });
    }
    return courses;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录西南林业大学教务系统", "好的，开始导入");
}

// 从课表查询页读取学年学期选项，默认选中当前学期
async function fetchAcademicOptions() {
    try {
        const resp = await fetch("/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151",
            { method: "GET", credentials: "include" });
        if (!resp.ok) return null;
        const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
        const read = sel => Array.from(doc.querySelectorAll(sel + " option"))
            .filter(o => o.value !== "")
            .map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.hasAttribute("selected") }));
        const years = read("#xnm"), semesters = read("#xqm");
        if (!years.length || !semesters.length) return null;
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

// 校历：rq="2026-08-31/2026-09-06"，数组长度即总周数
async function fetchSemesterConfig(academicYear, semesterCode) {
    try {
        const resp = await fetch("/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154", {
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
        return { semesterStartDate: startDate, semesterTotalWeeks: json.length };
    } catch (e) { return null; }
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    try {
        const resp = await fetch("/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`,
            credentials: "include"
        });
        if (!resp.ok) throw new Error("状态码 " + resp.status);
        const courses = parseJsonData(JSON.parse(await resp.text()));
        if (!courses.length) throw new Error("未找到课程数据，请确认所选学年学期是否正确。");
        return courses;
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

async function runImportFlow() {
    if (!await promptUserToStart()) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) { window.shiguangBridge.showToast("导入已取消。"); return; }

    const courses = await fetchAndParseCourses(selection.academicYear, selection.semesterCode);
    if (courses === null) return;
    if (!await saveCourses(courses)) return;

    const config = await fetchSemesterConfig(selection.academicYear, selection.semesterCode);
    if (config) {
        try { await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)); } catch (e) {}
    } else {
        window.shiguangBridge.showToast("未取到开学日期，已跳过课表配置，请在应用内手动设置。");
    }
    try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SWFU_TIME_SLOTS)); } catch (e) {}

    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
