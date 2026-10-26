/**
 * 广西医科大学智慧教务系统课表导入适配脚本
 * 通过 getCalendarWeekDatas 接口获取课表数据（POST，返回 JSON、全学期）
 * 课程节次直接由接口字段 ps(起始节次) / pe(结束节次) 提供
 */

// 广西医科大学作息时间表（第1-12节）
const GXMU_TIME_SLOTS = [
    { number: 1,  startTime: "08:20", endTime: "09:00" },
    { number: 2,  startTime: "09:05", endTime: "09:45" },
    { number: 3,  startTime: "10:05", endTime: "10:45" },
    { number: 4,  startTime: "10:50", endTime: "11:30" },
    { number: 5,  startTime: "11:35", endTime: "12:15" },
    { number: 6,  startTime: "14:30", endTime: "15:10" },
    { number: 7,  startTime: "15:15", endTime: "15:55" },
    { number: 8,  startTime: "16:15", endTime: "16:55" },
    { number: 9,  startTime: "17:00", endTime: "17:40" },
    { number: 10, startTime: "19:00", endTime: "19:40" },
    { number: 11, startTime: "19:45", endTime: "20:25" },
    { number: 12, startTime: "20:30", endTime: "21:10" }
];

function parseWeeks(weekStr) {
    // 兼容逗号分段的周次；数字按数值排序去重
    const weeks = [];
    weekStr.split(',').forEach(part => {
        part = part.trim();
        const n = Number(part);
        if (!isNaN(n) && n >= 1) weeks.push(n);
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析接口返回的单条课程记录，映射为课表所需结构
 */
function mapCourseRecord(record) {
    const weeks = parseWeeks(record.zc || "");
    if (weeks.length === 0) return null;

    const day = parseInt(record.xq, 10);
    const startSection = parseInt(record.ps, 10);
    const endSection = parseInt(record.pe, 10);
    if (!day || day < 1 || day > 7) return null;
    if (!startSection || isNaN(startSection)) return null;

    return {
        name: record.kcmc || "",
        teacher: record.teaxms || "未知教师",
        position: record.jxcdmc || "未知地点",
        day: day,
        startSection: startSection,
        endSection: isNaN(endSection) ? startSection : endSection,
        weeks: weeks
    };
}

/**
 * 从接口返回的 JSON 数据中提取并映射全部课程
 */
function transformSchedule(jsonData) {
    console.log("JS: transformSchedule 正在解析课时数据...");

    const data = jsonData && Array.isArray(jsonData.data) ? jsonData.data : [];
    console.log(`JS: 接口返回 ${data.length} 条课程记录`);

    const rawCourses = data
        .map(mapCourseRecord)
        .filter(Boolean);

    console.log(`JS: 解析出 ${rawCourses.length} 条课程记录`);

    // 同一门课会因周次分段生成多个课时记录，按组合键去重
    const seen = new Set();
    const courses = [];
    for (const c of rawCourses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(',')}|${c.teacher}|${c.position}`;
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push(c);
    }

    console.log(`JS: 去重后剩 ${courses.length} 门课程`);
    return courses;
}

function isLoginPage() {
    const url = window.location.href;
    return url.includes('login') || url.includes('lyuapServer');
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025，将匹配 202501 学期）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期 (0)", "第二学期 (1)"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = semesterIndex === 0 ? "01" : "02";
    const xnxqdm = `${academicYear}${semesterCode}`;

    // zc 传空表示全部周；d1/d2 为参考周起止日期，zc 为空时服务端返回全学期
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const pad = n => String(n).padStart(2, '0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
    const body = `xnxqdm=${xnxqdm}&zc=&d1=${encodeURIComponent(fmtDate(startOfWeek))}&d2=${encodeURIComponent(fmtDate(endOfWeek))}`;

    const url = "https://jwxt.gxmu.edu.cn/new/student/xsgrkb/getCalendarWeekDatas";
    console.log(`JS: 请求课表接口: ${url}`);
    console.log(`JS: 请求体: ${body}`);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            credentials: "include",
            body: body
        });

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }

        const jsonData = await response.json();
        const courses = transformSchedule(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);
        return { courses };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

async function saveTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        console.log("JS: 作息时间保存成功");
    } catch (error) {
        console.error('JS: Save TimeSlots Error:', error);
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        return;
    }
    const { courses } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    await saveTimeSlots(GXMU_TIME_SLOTS);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();