// 无锡学院（cwxu.edu.cn）拾光课程表适配脚本
// 基于正方教务 V9 学生个人课表接口适配

const COURSE_API_URL = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "13:45", endTime: "14:30" },
    { number: 6, startTime: "14:40", endTime: "15:25" },
    { number: 7, startTime: "15:55", endTime: "16:40" },
    { number: 8, startTime: "16:50", endTime: "17:35" },
    { number: 9, startTime: "18:45", endTime: "19:30" },
    { number: 10, startTime: "19:40", endTime: "20:25" },
    { number: 11, startTime: "20:35", endTime: "21:20" }
];

function parseSections(rawText) {
    const match = String(rawText || "").match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
    if (!match) return [];

    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
        return [];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseWeeks(rawText) {
    const weeks = new Set();
    const normalized = String(rawText || "")
        .replace(/周数[:：]?/g, "")
        .replace(/第/g, "")
        .replace(/[，、；;]/g, ",")
        .replace(/（/g, "(")
        .replace(/）/g, ")");

    normalized.split(",").forEach((segment) => {
        const cleanSegment = segment.replace(/周/g, "").trim();
        if (!cleanSegment) return;

        const isOdd = cleanSegment.includes("单");
        const isEven = cleanSegment.includes("双");
        const rangeMatch = cleanSegment.match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
        if (!rangeMatch) return;

        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2] || rangeMatch[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) return;

        for (let week = start; week <= end; week += 1) {
            if (isOdd && week % 2 === 0) continue;
            if (isEven && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });

    return Array.from(weeks).sort((left, right) => left - right);
}

function removeDuplicates(courses) {
    const uniqueCourses = new Map();
    courses.forEach((course) => {
        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.startSection,
            course.endSection,
            course.weeks.join(",")
        ].join("|");
        if (!uniqueCourses.has(key)) uniqueCourses.set(key, course);
    });
    return Array.from(uniqueCourses.values());
}

function parseApiData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        throw new Error("教务系统返回的数据格式发生变化，请联系适配器维护者。");
    }

    const courses = jsonData.kbList.flatMap((rawCourse) => {
        const name = String(rawCourse.kcmc || "").trim();
        const teacher = String(rawCourse.xm || "未知").trim() || "未知";
        const position = String(rawCourse.cdmc || "待定").trim() || "待定";
        const day = Number(rawCourse.xqj);
        const sections = parseSections(rawCourse.jcs);
        const weeks = parseWeeks(rawCourse.zcd);

        if (!name || !Number.isInteger(day) || day < 1 || day > 7 || !sections.length || !weeks.length) {
            return [];
        }

        return [{
            name,
            teacher,
            position,
            day,
            startSection: sections[0],
            endSection: sections[sections.length - 1],
            weeks
        }];
    });

    return removeDuplicates(courses).sort((left, right) =>
        left.day - right.day ||
        left.startSection - right.startSection ||
        left.name.localeCompare(right.name)
    );
}

function buildCourseConfig(courses) {
    const weeks = courses.flatMap((course) => course.weeks);
    return {
        semesterTotalWeeks: Math.max(...weeks),
        firstDayOfWeek: 1
    };
}

function validateYearInput(input) {
    return /^\d{4}$/.test(String(input || "").trim())
        ? false
        : "请输入四位数字的起始学年，例如 2025。";
}

function getDefaultAcademicYear() {
    const now = new Date();
    return String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "无锡学院课表导入",
        "请先登录无锡学院教务系统。登录成功后可在教务系统任意页面开始导入。",
        "开始导入"
    );
}

async function getAcademicYear() {
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入学年的起始年份，例如 2025-2026 学年请输入 2025。",
        getDefaultAcademicYear(),
        "validateYearInput"
    );
}

async function selectSemester() {
    return await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        0
    );
}

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

async function fetchCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在获取课表数据...");

    const requestBody = new URLSearchParams({
        xnm: academicYear,
        xqm: getSemesterCode(semesterIndex),
        kzlx: "ck",
        xsdm: "",
        kclbdm: ""
    });

    let response;
    try {
        response = await fetch(COURSE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: requestBody.toString(),
            credentials: "include"
        });
    } catch (error) {
        throw new Error("无法请求课表，请检查网络并确认已经登录教务系统。");
    }

    if (!response.ok) {
        throw new Error(`请求课表失败（HTTP ${response.status}）。`);
    }

    const responseText = await response.text();
    if (response.redirected || /login_slogin|用户登录|教学管理信息服务平台/.test(responseText)) {
        throw new Error("登录状态已失效，请重新登录教务系统后再试。");
    }

    let jsonData;
    try {
        jsonData = JSON.parse(responseText);
    } catch (error) {
        throw new Error("教务系统未返回有效课表数据，请确认已经登录。");
    }

    const courses = parseApiData(jsonData);
    if (!courses.length) {
        throw new Error("所选学期未查询到课程，请检查学年和学期是否正确。");
    }

    return {
        courses,
        config: buildCourseConfig(courses)
    };
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error("CWXU: Save courses error", error);
        await window.shiguangBridgePromise.showAlert("保存失败", `课程保存失败：${error.message}`, "确定");
        return false;
    }
}

async function saveOptionalSettings(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        console.error("CWXU: Save config error", error);
        window.shiguangBridge.showToast(`课表配置保存失败：${error.message}`);
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    } catch (error) {
        console.error("CWXU: Save time slots error", error);
        window.shiguangBridge.showToast(`作息时间保存失败：${error.message}`);
    }
}

async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex < 0) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    let result;
    try {
        result = await fetchCourses(String(academicYear).trim(), semesterIndex);
    } catch (error) {
        console.error("CWXU: Fetch or parse error", error);
        await window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
        return;
    }

    const saved = await saveCourses(result.courses);
    if (!saved) return;

    await saveOptionalSettings(result.config);
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${result.courses.length} 条课程安排。`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
