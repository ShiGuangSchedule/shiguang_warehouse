// 南通大学拾光课程表适配脚本
// 通过正方教务V9个人/班级课表接口获取课程，并转换为导入格式

(function () {
const WINTER_TIME_SLOTS = [
    { number: 1, startTime: "07:50", endTime: "08:30" },
    { number: 2, startTime: "08:40", endTime: "09:20" },
    { number: 3, startTime: "09:35", endTime: "10:15" },
    { number: 4, startTime: "10:30", endTime: "11:10" },
    { number: 5, startTime: "11:20", endTime: "12:00" },
    { number: 6, startTime: "13:30", endTime: "14:10" },
    { number: 7, startTime: "14:20", endTime: "15:00" },
    { number: 8, startTime: "15:20", endTime: "16:00" },
    { number: 9, startTime: "16:10", endTime: "16:50" },
    { number: 10, startTime: "18:30", endTime: "19:10" },
    { number: 11, startTime: "19:20", endTime: "20:00" },
    { number: 12, startTime: "20:10", endTime: "20:50" }
];

const SUMMER_TIME_SLOTS = [
    { number: 1, startTime: "07:50", endTime: "08:30" },
    { number: 2, startTime: "08:40", endTime: "09:20" },
    { number: 3, startTime: "09:35", endTime: "10:15" },
    { number: 4, startTime: "10:30", endTime: "11:10" },
    { number: 5, startTime: "11:20", endTime: "12:00" },
    { number: 6, startTime: "14:00", endTime: "14:40" },
    { number: 7, startTime: "14:50", endTime: "15:30" },
    { number: 8, startTime: "15:50", endTime: "16:30" },
    { number: 9, startTime: "16:40", endTime: "17:20" },
    { number: 10, startTime: "19:00", endTime: "19:40" },
    { number: 11, startTime: "19:50", endTime: "20:30" },
    { number: 12, startTime: "20:40", endTime: "21:20" }
];

function parseSections(value) {
    const numbers = String(value || "").match(/\d+/g);
    if (!numbers || numbers.length === 0) return null;
    const startSection = Number(numbers[0]);
    const endSection = Number(numbers[numbers.length - 1]);
    if (!Number.isInteger(startSection) || !Number.isInteger(endSection) || startSection < 1 || endSection < startSection) return null;
    return { startSection, endSection };
}

// 将周次文本转换为周数数组
function parseWeeks(value) {
    const weeks = new Set();
    String(value || "").replace(/（/g, "(").replace(/）/g, ")").split(/[，,、;]/).forEach((part) => {
        const numbers = part.match(/\d+/g);
        if (!numbers) return;
        const start = Number(numbers[0]);
        const end = Number(numbers[numbers.length - 1]);
        const odd = part.includes("单");
        const even = part.includes("双");
        for (let week = start; week <= end; week += 1) {
            if (odd && week % 2 === 0) continue;
            if (even && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });
    return [...weeks].sort((left, right) => left - right);
}

function normalizeStartDate(value) {
    const match = String(value || "").match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function findStartDate(value) {
    if (!value || typeof value !== "object") return normalizeStartDate(value);
    if (Array.isArray(value)) {
        const firstWeek = value.find((item) => String(item?.zs) === "1" || String(item?.zsmc) === "1") || value[0];
        return normalizeStartDate(firstWeek?.zrq || firstWeek?.zcrq || firstWeek?.rq);
    }
    const firstWeekDate = normalizeStartDate(value.zrq || value.zcrq || value.rq);
    if (firstWeekDate) return firstWeekDate;
    for (const [key, item] of Object.entries(value)) {
        const date = item && typeof item === "object" ? findStartDate(item) : null;
        if (date) return date;
    }
    return null;
}

async function fetchSemesterStartDate() {
    const xnm = document.querySelector("#xnm")?.value;
    const xqm = document.querySelector("#xqm")?.value;
    if (!xnm || !xqm) {
        console.warn("NTU semester start date: missing xnm or xqm", { xnm, xqm });
        return null;
    }
    const url = new URL("/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154", window.location.origin);
    try {
        const response = await fetch(url.href, {
            headers: {
                accept: "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}`,
            method: "POST",
            credentials: "include"
        });
        const rawText = await response.text();
        let data;
        try {
            data = JSON.parse(rawText);
        } catch {
            console.warn("NTU semester start date: response is not JSON", response.status, rawText);
            return null;
        }
        console.log("NTU semester start date response:", data);
        const startDate = findStartDate(data);
        console.log("NTU semester start date:", startDate || "not found");
        return startDate;
    } catch (error) {
        console.warn("NTU semester start date request failed:", error);
        return null;
    }
}

// 将课程字段转换为导入协议字段
function normalizeCourses(rawCourses) {
    const uniqueCourses = new Map();
    rawCourses.forEach((rawCourse) => {
        const name = String(rawCourse.kcmc || "").replace(/[■◆▲]/g, "").trim();
        const teacher = String(rawCourse.xm || "未知").trim() || "未知";
        const position = String(rawCourse.cdmc || "待定").trim() || "待定";
        const day = Number(rawCourse.xqj);
        const sections = parseSections(rawCourse.jcs || rawCourse.jc);
        const weeks = parseWeeks(rawCourse.zcd);
        if (!name || !sections || !Number.isInteger(day) || day < 1 || day > 7 || weeks.length === 0) return;
        const course = { name, teacher, position, day, startSection: sections.startSection, endSection: sections.endSection, weeks };
        const key = [name, teacher, position, day, sections.startSection, sections.endSection, weeks.join(",")].join("|");
        if (!uniqueCourses.has(key)) uniqueCourses.set(key, course);
    });
    return [...uniqueCourses.values()].sort((left, right) => left.day - right.day || left.startSection - right.startSection || left.name.localeCompare(right.name));
}

// 合并同一课程的重复节次
function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;
    const list = courses.map((course) => ({ ...course, weeks: [...new Set(course.weeks)].sort((left, right) => left - right) }));
    const sameBase = (left, right) => left.name === right.name && left.teacher === right.teacher && left.position === right.position && left.day === right.day;
    list.sort((left, right) => left.name.localeCompare(right.name) || left.teacher.localeCompare(right.teacher) || left.position.localeCompare(right.position) || left.day - right.day || left.startSection - right.startSection);
    const merged = [];
    for (const course of list) {
        const previous = merged[merged.length - 1];
        if (previous && sameBase(previous, course) && previous.startSection === course.startSection && previous.endSection === course.endSection) {
            previous.weeks = [...new Set([...previous.weeks, ...course.weeks])].sort((left, right) => left - right);
        } else if (previous && sameBase(previous, course) && previous.weeks.join(",") === course.weeks.join(",") && previous.endSection + 1 === course.startSection) {
            previous.endSection = course.endSection;
        } else {
            merged.push(course);
        }
    }
    return merged;
}

// 个人课表
async function fetchApiCourses() {
    const xnm = document.querySelector("#xnm")?.value;
    const xqm = document.querySelector("#xqm")?.value;
    if (!xnm || !xqm) return null;
    const url = new URL("/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151", window.location.origin);
    try {
        const response = await fetch(url.href, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
            body: `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=`,
            credentials: "include"
        });
        const data = await response.json();
        console.log("NTU course API response:", data);
        const rawCourses = data?.kbList || data?.datas?.kbList || data?.rows;
        if (!Array.isArray(rawCourses) || !rawCourses.length) return null;
        return mergeAndDistinctCourses(normalizeCourses(rawCourses));
    } catch (error) {
        console.warn("NTU course API request failed:", error);
        return null;
    }
}

// 班级课表
async function fetchClassApiCourses() {
    const pageMap = window.api?.data?.map || {};
    const readValue = (key) => pageMap[key] ?? document.querySelector(`#${key}`)?.value ?? "";
    const requestFields = [
        "xnm",
        "xqm",
        "njdm_id",
        "zyh_id",
        "bh_id",
        "tjkbzdm",
        "tjkbzxsdm",
        "zxszjjs"
    ];
    const body = new URLSearchParams();
    requestFields.forEach((key) => {
        const value = readValue(key);
        if (value !== "" && value !== null && typeof value !== "undefined") body.set(key, String(value));
    });
    if (!body.get("xnm") || !body.get("xqm") || !body.get("bh_id")) {
        console.warn("NTU class course API parameters are incomplete", Object.fromEntries(body));
        return null;
    }
    const url = new URL("/jwglxt/kbdy/bjkbdy_cxBjKb.html", window.location.origin);
    try {
        const response = await fetch(url.href, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
            body,
            credentials: "include"
        });
        const data = await response.json();
        console.log("NTU class course API response:", data);
        const rawCourses = data?.kbList || data?.datas?.kbList || data?.rows;
        if (!Array.isArray(rawCourses) || !rawCourses.length) return null;
        return mergeAndDistinctCourses(normalizeCourses(rawCourses));
    } catch (error) {
        console.warn("NTU class course API request failed:", error);
        return null;
    }
}

async function runImport() {
    try {
        if (!await window.shiguangBridgePromise.showAlert("南通大学课表导入", "导入前请确保已登录南通大学教务系统。", "开始导入")) return;
        const formAction = document.querySelector("#ajaxForm")?.getAttribute("action") || "";
        const isPersonalPage = /xskbcx_cxXskbcxIndex/i.test(formAction) || /\/kbcx\/xskbcx/i.test(window.location.pathname);
        const pageCourses = isPersonalPage ? await fetchApiCourses() : await fetchClassApiCourses();
        if (pageCourses?.length) {
            const pageWeeks = pageCourses.flatMap((course) => course.weeks);
            const semesterStartDate = await fetchSemesterStartDate();
            if (!semesterStartDate) throw new Error("未获取到开学日期，无法判断令时");
            const startMonth = Number(semesterStartDate.slice(5, 7));
            if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new Error(`开学日期格式无效：${semesterStartDate}`);
            const timeSlots = startMonth <= 6 ? WINTER_TIME_SLOTS : SUMMER_TIME_SLOTS;
            const courseConfig = { semesterTotalWeeks: Math.max(19, ...pageWeeks), defaultClassDuration: 40, firstDayOfWeek: 1 };
            courseConfig.semesterStartDate = semesterStartDate;
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(pageCourses));
            window.shiguangBridge.showToast(`导入成功：${pageCourses.length} 条课程安排`);
            window.shiguangBridge.notifyTaskCompletion();
            return;
        }
        window.shiguangBridge.showToast("当前页面未找到课表，请先打开个人或班级课表页面。");
    } catch (error) {
        console.error("NTU adapter error", error);
        window.shiguangBridge.showToast(`导入失败：${error.message}`);
    }
}

runImport();
})();
