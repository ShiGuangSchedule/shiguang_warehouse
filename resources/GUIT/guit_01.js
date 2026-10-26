const PRIMARY_TIME_SLOTS = [
    { number: 1, startTime: "09:00", endTime: "09:40" },
    { number: 2, startTime: "09:45", endTime: "10:25" },
    { number: 3, startTime: "11:10", endTime: "11:50" },
    { number: 4, startTime: "11:55", endTime: "12:35" },
    { number: 5, startTime: "14:30", endTime: "15:10" },
    { number: 6, startTime: "15:15", endTime: "15:55" },
    { number: 7, startTime: "16:15", endTime: "16:55" },
    { number: 8, startTime: "17:00", endTime: "17:40" },
    { number: 9, startTime: "19:00", endTime: "19:40" },
    { number: 10, startTime: "19:45", endTime: "20:25" },
    { number: 11, startTime: "20:30", endTime: "21:10" }
];

const SCHEDULE_TIME_MAP = {
    "一": [
        { number: 1, startTime: "09:00", endTime: "09:40" },
        { number: 2, startTime: "09:45", endTime: "10:25" },
        { number: 3, startTime: "10:40", endTime: "11:20" },
        { number: 4, startTime: "11:25", endTime: "12:05" },
        { number: 5, startTime: "14:30", endTime: "15:10" },
        { number: 6, startTime: "15:15", endTime: "15:55" },
        { number: 7, startTime: "16:15", endTime: "16:55" },
        { number: 8, startTime: "17:00", endTime: "17:40" },
        { number: 9, startTime: "19:00", endTime: "19:40" },
        { number: 10, startTime: "19:45", endTime: "20:25" },
        { number: 11, startTime: "20:30", endTime: "21:10" }
    ],
    "二": [
        { number: 1, startTime: "09:00", endTime: "09:40" },
        { number: 2, startTime: "09:45", endTime: "10:25" },
        { number: 3, startTime: "10:55", endTime: "11:20" },
        { number: 4, startTime: "11:40", endTime: "12:20" },
        { number: 5, startTime: "14:30", endTime: "15:10" },
        { number: 6, startTime: "15:15", endTime: "15:55" },
        { number: 7, startTime: "16:15", endTime: "16:55" },
        { number: 8, startTime: "17:00", endTime: "17:40" },
        { number: 9, startTime: "19:00", endTime: "19:40" },
        { number: 10, startTime: "19:45", endTime: "20:25" },
        { number: 11, startTime: "20:30", endTime: "21:10" }
    ],
    "三": PRIMARY_TIME_SLOTS
};

const BUILDING_SCHEDULE_MAP = {
    C: "一",
    E: "一",
    G: "一",
    D: "二",
    F: "二",
    H: "二",
    A: "三",
    B: "三",
    J: "三",
    K: "三",
    L: "三",
    M: "三"
};

const DAY_FIELD_MAP = {
    mon: 1,
    tu: 2,
    wes: 3,
    tur: 4,
    fri: 5,
    sat: 6,
    sun: 7
};

function showToast(message) {
    if (typeof window.shiguangBridge !== "undefined" && window.shiguangBridge.showToast) {
        window.shiguangBridge.showToast(message);
    } else {
        console.log(message);
    }
}

function getBaseOrigin() {
    return window.location.origin;
}

function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizeHtmlLines(html) {
    return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/&nbsp;/gi, " ")
        .replace(/<[^>]+>/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function parseWeeks(rawText) {
    const text = String(rawText || "")
        .replace(/\s+/g, "")
        .replace(/周/g, "")
        .replace(/，/g, ",")
        .replace(/、/g, ",");

    if (!text) return [];

    const weeks = new Set();
    text.split(",").forEach((segment) => {
        if (!segment) return;

        const isOdd = /单/.test(segment);
        const isEven = /双/.test(segment);
        const cleaned = segment.replace(/[单双]/g, "");
        const match = cleaned.match(/^(\d+)(?:-(\d+))?$/);
        if (!match) return;

        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        for (let week = start; week <= end; week++) {
            if (isOdd && week % 2 === 0) continue;
            if (isEven && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });

    return Array.from(weeks).sort((a, b) => a - b);
}

function parseSectionAndRoom(rawLocation) {
    const value = String(rawLocation || "").trim();
    const match = value.match(/^(\d{2})(\d{2})(.*)$/);
    if (!match) return null;

    return {
        startSection: Number(match[1]),
        endSection: Number(match[2]),
        position: match[3].trim() || "待定"
    };
}

function getBuildingCode(position) {
    const match = String(position || "").trim().match(/^([A-Z])/i);
    return match ? match[1].toUpperCase() : "";
}

function getScheduleTypeByPosition(position) {
    const buildingCode = getBuildingCode(position);
    return BUILDING_SCHEDULE_MAP[buildingCode] || "三";
}

function getTimeSlotMap(scheduleType) {
    const map = new Map();
    (SCHEDULE_TIME_MAP[scheduleType] || PRIMARY_TIME_SLOTS).forEach((slot) => {
        map.set(slot.number, slot);
    });
    return map;
}

function fillCustomTime(course) {
    const scheduleType = getScheduleTypeByPosition(course.position);
    if (scheduleType === "三") {
        return course;
    }

    if (course.startSection >= 5 && course.endSection <= 11) {
        return course;
    }

    const timeSlotMap = getTimeSlotMap(scheduleType);
    const startSlot = timeSlotMap.get(course.startSection);
    const endSlot = timeSlotMap.get(course.endSection);
    if (!startSlot || !endSlot) {
        return course;
    }

    const primaryTimeSlotMap = new Map(PRIMARY_TIME_SLOTS.map((slot) => [slot.number, slot]));
    const primaryStartSlot = primaryTimeSlotMap.get(course.startSection);
    const primaryEndSlot = primaryTimeSlotMap.get(course.endSection);
    if (
        primaryStartSlot &&
        primaryEndSlot &&
        primaryStartSlot.startTime === startSlot.startTime &&
        primaryEndSlot.endTime === endSlot.endTime
    ) {
        return course;
    }

    return {
        ...course,
        isCustomTime: true,
        customStartTime: startSlot.startTime,
        customEndTime: endSlot.endTime
    };
}

function parseCellCourses(cellHtml, day, row, totalWeeks) {
    const lines = normalizeHtmlLines(cellHtml);
    if (!lines.length) return [];

    const courses = [];
    for (let index = 0; index < lines.length; index += 2) {
        const locationLine = lines[index];
        const weekLine = lines[index + 1] || "";
        const sectionInfo = parseSectionAndRoom(locationLine);
        if (!sectionInfo) continue;

        const weeks = parseWeeks(weekLine);
        courses.push(fillCustomTime({
            name: String(row.cname || "").trim(),
            teacher: String(row.TeacherName || row.assteachername || "").trim() || "未知教师",
            position: sectionInfo.position || "待定",
            day,
            startSection: sectionInfo.startSection,
            endSection: sectionInfo.endSection,
            weeks: weeks.length ? weeks : Array.from({ length: totalWeeks }, (_, i) => i + 1)
        }));
    }

    return courses;
}

function deduplicateCourses(courses) {
    const seen = new Map();
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
        if (!seen.has(key)) {
            seen.set(key, course);
        }
    });
    return Array.from(seen.values());
}

async function requestJson(path, options = {}) {
    const response = await fetch(`${getBaseOrigin()}${path}`, {
        credentials: "include",
        ...options
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`接口 ${path} 返回了非 JSON 内容，请确认已登录并位于正确页面。`);
    }

    if (!response.ok) {
        throw new Error(`接口 ${path} 请求失败，HTTP ${response.status}`);
    }

    return data;
}

async function requestText(path, options = {}) {
    const response = await fetch(`${getBaseOrigin()}${path}`, {
        credentials: "include",
        ...options
    });

    if (!response.ok) {
        throw new Error(`接口 ${path} 请求失败，HTTP ${response.status}`);
    }

    return response.text();
}

function parseStudentIdFromHtml(html) {
    const idMatch = String(html || "").match(/name=["']stid["'][^>]*value=["']([^"']+)["']/i);
    return idMatch ? idMatch[1].trim() : "";
}

async function fetchStudentProfile() {
    const html = await requestText("/Admin_Areas/StInfo/studentInfo");
    const studentId = parseStudentIdFromHtml(html);
    if (!studentId) {
        throw new Error("未能从个人信息页面解析出学号。");
    }

    const body = new URLSearchParams({ stid: studentId });
    const profile = await requestJson("/Admin_Areas/StInfo/getStInfo", {
        method: "POST",
        headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString()
    });

    return {
        studentId,
        enrolldate: String(profile?.enrolldate || "").trim(),
        grade: String(profile?.grade || "").trim()
    };
}

function getEnrollmentThreshold(profile) {
    const enrollmentDate = String(profile?.enrolldate || "").trim();
    if (enrollmentDate) {
        return enrollmentDate;
    }

    const grade = Number(profile?.grade || 0);
    if (grade >= 1900 && grade <= 2100) {
        return `${grade}-01-01`;
    }

    return "";
}

async function fetchTermList() {
    const terms = await requestJson("/Admin_Areas/Res/GetTermInfoAll", {
        method: "POST",
        headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
        }
    });

    if (!Array.isArray(terms) || !terms.length) {
        throw new Error("未获取到学期信息。");
    }

    const filteredTerms = terms.filter((term) => {
        if (!term || !term.term || !term.startdate) return false;
        const name = String(term.termname || "");
        return /学年第[一二三四五六七八九十]+学期/.test(name);
    });

    return filteredTerms.length ? filteredTerms : terms.filter((term) => term && term.term && term.startdate);
}

function filterTermsByEnrollment(terms, enrollmentThreshold) {
    if (!enrollmentThreshold) return terms;

    const filtered = terms.filter((term) => {
        return String(term.enddate || term.startdate || "") >= enrollmentThreshold;
    });

    return filtered.length ? filtered : terms;
}

function getDefaultTermIndex(terms) {
    const today = getTodayString();
    const currentIndex = terms.findIndex((term) => {
        return term.startdate <= today && today <= String(term.enddate || "9999-12-31");
    });
    if (currentIndex >= 0) return currentIndex;

    const regularIndex = terms.findIndex((term) => /学期/.test(String(term.termname || "")));
    return regularIndex >= 0 ? regularIndex : 0;
}

async function selectTerm(terms) {
    const items = terms.map((term) => {
        return String(term.termname || term.term);
    });
    const defaultIndex = getDefaultTermIndex(terms);

    if (typeof window.shiguangBridgePromise === "undefined") {
        return terms[defaultIndex];
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择要导入的学期",
        JSON.stringify(items),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1) {
        throw new Error("已取消导入。");
    }

    return terms[selectedIndex];
}

async function fetchCoursePage(termCode, page, rowsPerPage) {
    const body = new URLSearchParams({
        term: termCode,
        page: String(page),
        rows: String(rowsPerPage)
    });

    const data = await requestJson("/Admin_Areas/StInfo/GetCourseQuery", {
        method: "POST",
        headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString()
    });

    if (!data || !Array.isArray(data.rows)) {
        throw new Error("课表接口未返回有效数据。");
    }

    return data;
}

async function fetchAllCourseRows(termCode) {
    const rowsPerPage = 50;
    const firstPage = await fetchCoursePage(termCode, 1, rowsPerPage);
    const allRows = [...firstPage.rows];
    const total = Number(firstPage.total || allRows.length);
    const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));

    for (let page = 2; page <= totalPages; page++) {
        const pageData = await fetchCoursePage(termCode, page, rowsPerPage);
        allRows.push(...pageData.rows);
    }

    return allRows;
}

function buildCourses(rows, totalWeeks) {
    const courses = [];

    rows.forEach((row) => {
        Object.entries(DAY_FIELD_MAP).forEach(([field, day]) => {
            const cellValue = row[field];
            if (!cellValue) return;
            courses.push(...parseCellCourses(cellValue, day, row, totalWeeks));
        });
    });

    return deduplicateCourses(courses);
}

async function saveConfig(term) {
    const config = {
        semesterStartDate: String(term.startdate),
        semesterTotalWeeks: Number(term.weeknum || 20),
        firstDayOfWeek: 1
    };

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

async function saveTimeSlots() {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(PRIMARY_TIME_SLOTS));
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function runImportFlow() {
    try {
        showToast("正在获取个人信息...");
        const studentProfile = await fetchStudentProfile();
        const enrollmentThreshold = getEnrollmentThreshold(studentProfile);

        showToast("正在获取学期信息...");
        const terms = filterTermsByEnrollment(await fetchTermList(), enrollmentThreshold);
        const selectedTerm = await selectTerm(terms);

        showToast(`正在获取 ${selectedTerm.termname || selectedTerm.term} 课表...`);
        const rows = await fetchAllCourseRows(String(selectedTerm.term));
        const totalWeeks = Number(selectedTerm.weeknum || 20);
        const courses = buildCourses(rows, totalWeeks);

        if (!courses.length) {
            throw new Error("未解析到课程，请确认当前账号已在教务系统中可查看课表。");
        }

        if (typeof window.shiguangBridgePromise === "undefined") {
            console.log("Selected term:", selectedTerm);
            console.log("Courses:", courses);
            console.log("Time slots:", PRIMARY_TIME_SLOTS);
            alert(`解析完成，共 ${courses.length} 门课程。请查看控制台输出。`);
            return;
        }

        await saveConfig(selectedTerm);
        await saveTimeSlots();
        await saveCourses(courses);

        showToast(`导入完成，共 ${courses.length} 门课程`);
        if (typeof window.shiguangBridge !== "undefined" && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error(error);
        showToast(`导入失败: ${error.message}`);
    }
}

runImportFlow();
