// 燕山大学研究生管理系统 (yjsxt.ysu.edu.cn) 拾光课程表适配脚本
// 学期与作息：GET /api/schedule/class/setting/current?yearTerm=  （返回 yearTerm 列表 + lessonConfig 作息）
// 课表：       GET /api/schedule/table/byStudent?page=0&size=200&t=<时间戳>&yearTerm=
// 字段说明：week 实为星期(1-7)，lessonNumber 为节次，周次范围只在 classTimeRange 文本里（；可分隔多段）
// 研究生系统没有教学日历接口，不写课表配置（开学日期非必传，避免清空用户已设值）

// 把 "周X" 文本转成星期数字
function parseDayFromText(seg) {
    const match = seg.match(/周([一二三四五六日天])/);
    if (!match) return 0;
    return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[match[1]];
}

// 解析 classTimeRange 开头的周次段，如 "2-5" / "15" / "2,4,6"
function parseWeeks(weekText) {
    const weeks = [];
    for (const part of String(weekText).split(",")) {
        const start = Number(part.split("-")[0]);
        const end = Number(part.split("-")[1] || start);
        for (let w = start; w <= end; w++) {
            if (w) weeks.push(w);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 每条 data 是一节课（一个节次），按「课程名 + classTimeRange」去重后拆成课程段
function parseJsonData(json) {
    const list = json && json.data;
    if (!Array.isArray(list)) return [];

    const seen = new Set();
    const courses = [];

    for (const item of list) {
        const key = item.courseName + "|" + item.classTimeRange;
        if (seen.has(key)) continue;
        seen.add(key);

        const teacher = (item.courseTeacher || []).map(t => t.name).join("、");
        const position = String(item.classroomName || "").trim();

        // 一个 classTimeRange 可能含多段，用「；」分隔
        for (const seg of String(item.classTimeRange || "").split(/[；;]/)) {
            const weekMatch = seg.match(/^([\d,\-]+)周/);
            const day = parseDayFromText(seg);
            const sectionMatch = seg.match(/(\d+)-(\d+)节/) || seg.match(/(\d+)节/);
            if (!weekMatch || !day || !sectionMatch) continue;

            courses.push({
                name: String(item.courseName || "").trim(),
                teacher: teacher,
                position: position,
                day: day,
                startSection: Number(sectionMatch[1]),
                endSection: Number(sectionMatch[2] || sectionMatch[1]),
                weeks: parseWeeks(weekMatch[1])
            });
        }
    }

    return courses;
}

// 无明确「当前学期」标记，按日期推断：9月~次年1月为第一学期，其余为第二学期
function inferYearTerm() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 9) return year + "-" + (year + 1) + "-1";
    if (month <= 1) return (year - 1) + "-" + year + "-1";
    return (year - 1) + "-" + year + "-2";
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录燕山大学研究生管理系统", "好的，开始导入");
}

// 接口需要 token 头鉴权，值即 satoken（Sa-Token）
function getToken() {
    const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
    try {
        return window.localStorage.getItem("satoken") || window.sessionStorage.getItem("satoken") || "";
    } catch (e) {
        return "";
    }
}

// 读取学期列表与作息配置
async function fetchSetting(yearTerm) {
    try {
        const resp = await fetch("/api/schedule/class/setting/current?yearTerm=" + yearTerm,
            { method: "GET", credentials: "include", headers: { "token": getToken() } });
        if (!resp.ok) return null;
        const data = (await resp.json()).data;
        if (!data || !Array.isArray(data.yearTerm) || !Array.isArray(data.lessonConfig)) return null;
        return {
            yearTerms: data.yearTerm,
            timeSlots: data.lessonConfig.map(item => ({
                number: item.lessonNumber,
                startTime: String(item.lessonTime[0]).slice(11, 16),
                endTime: String(item.lessonTime[1]).slice(11, 16)
            }))
        };
    } catch (e) { return null; }
}

async function selectYearTerm(setting, defaultTerm) {
    const defaultIndex = setting.yearTerms.indexOf(defaultTerm);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(setting.yearTerms), defaultIndex === -1 ? 0 : defaultIndex);
    if (index === null || index === -1) return null;
    return setting.yearTerms[index];
}

async function fetchAndParseCourses(yearTerm) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    try {
        const resp = await fetch("/api/schedule/table/byStudent?page=0&size=200&t=" + Date.now() + "&yearTerm=" + yearTerm,
            { method: "GET", credentials: "include", headers: { "token": getToken() } });
        if (!resp.ok) throw new Error("状态码 " + resp.status);
        const courses = parseJsonData(await resp.json());
        if (!courses.length) throw new Error("未找到课程数据，请确认所选学期是否正确。");
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

    const defaultTerm = inferYearTerm();
    const setting = await fetchSetting(defaultTerm);
    if (!setting) { window.shiguangBridge.showToast("导入失败：未读取到课表设置，请确保已登录研究生管理系统。"); return; }

    const yearTerm = await selectYearTerm(setting, defaultTerm);
    if (yearTerm === null) { window.shiguangBridge.showToast("未选择学期，导入终止。"); return; }

    const courses = await fetchAndParseCourses(yearTerm);
    if (courses === null) return;
    if (!await saveCourses(courses)) return;

    try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(setting.timeSlots)); } catch (e) {}

    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();