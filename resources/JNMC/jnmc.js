// 济宁医学院教务（乘方教务 · 旧版 .action 接口）适配器

const PRESET_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:40" },
    { number: 2, startTime: "08:50", endTime: "09:30" },
    { number: 3, startTime: "09:50", endTime: "10:30" },
    { number: 4, startTime: "10:40", endTime: "11:20" },
    { number: 5, startTime: "11:30", endTime: "12:10" },
    { number: 6, startTime: "14:00", endTime: "14:40" },
    { number: 7, startTime: "14:50", endTime: "15:30" },
    { number: 8, startTime: "15:50", endTime: "16:30" },
    { number: 9, startTime: "16:40", endTime: "17:20" },
    { number: 10, startTime: "17:30", endTime: "18:10" },
    { number: 11, startTime: "19:00", endTime: "19:40" },
    { number: 12, startTime: "19:50", endTime: "20:30" },
    { number: 13, startTime: "20:50", endTime: "21:30" },
    { number: 14, startTime: "21:40", endTime: "22:20" }
];

function uniqueSortedNumbers(numbers) {
    return [...new Set(numbers)].sort((a, b) => a - b);
}

// 支持 "10,7,8,9"、"1-4"、"1-4,7" 等周次写法。
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = [];
    String(weekStr).replace(/[，、]/g, ",").split(",").forEach(part => {
        const text = part.trim().replace(/周/g, "");
        const range = text.match(/^(\d+)\s*[-~]\s*(\d+)$/);
        if (range) {
            const start = parseInt(range[1], 10);
            const end = parseInt(range[2], 10);
            if (start > 0 && end >= start) {
                for (let week = start; week <= end; week += 1) weeks.push(week);
            }
            return;
        }
        const week = parseInt(text, 10);
        if (!isNaN(week) && week > 0) weeks.push(week);
    });
    return uniqueSortedNumbers(weeks);
}

function parseSections(sectionStr) {
    return uniqueSortedNumbers(
        String(sectionStr || "")
            .replace(/[，、]/g, ",")
            .split(",")
            .map(section => parseInt(section.trim(), 10))
            .filter(section => !isNaN(section) && section > 0)
    );
}

// 反斜杠表示合并教室（如 "B205\206教室"），逗号才是不同地点的分隔符。
function resolvePosition(raw) {
    const position = String(raw || "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
    return position || "待定";
}

function cleanTeacher(raw) {
    const teacher = String(raw || "")
        .split(/[,，、]/)
        .map(name => name.trim())
        .filter(Boolean)
        .join("、");
    return teacher || "未知";
}

function courseKey(course) {
    return [
        course.name,
        course.teacher,
        course.position,
        course.day,
        course.startSection,
        course.endSection
    ].join("__");
}

function addCourse(courseMap, item, weeks) {
    const day = parseInt(item.xq, 10);
    const sections = parseSections(item.jcdm2);
    const allWeeks = uniqueSortedNumbers(weeks);
    if (!item.kcmc || sections.length === 0 || allWeeks.length === 0 ||
        isNaN(day) || day < 1 || day > 7) return;

    const course = {
        name: String(item.kcmc).trim(),
        teacher: cleanTeacher(item.teaxms),
        position: resolvePosition(item.jxcdmc || item.jxcdmcs),
        day,
        startSection: Math.min(...sections),
        endSection: Math.max(...sections),
        weeks: allWeeks
    };

    const key = courseKey(course);
    const existing = courseMap.get(key);
    if (existing) {
        existing.weeks = uniqueSortedNumbers([...existing.weeks, ...course.weeks]);
    } else {
        courseMap.set(key, course);
    }
}

function sortCourses(courses) {
    return courses.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.endSection - b.endSection ||
        a.name.localeCompare(b.name)
    );
}

// 从整学期课表解析课程，作为周课表接口不可用时的回退。
function parseCourseList(kbxx) {
    if (!Array.isArray(kbxx)) throw new Error("课表接口返回格式不正确");
    const courseMap = new Map();
    kbxx.forEach(item => {
        addCourse(courseMap, item, parseWeeks(item.zcs));
    });
    return sortCourses(Array.from(courseMap.values()));
}

// 日历接口按周返回精确教室；同一课程换教室时，按周次拆成多个课程项。
function parseWeeklyCourseList(rows) {
    if (!Array.isArray(rows)) return [];
    const courseMap = new Map();
    rows.forEach(({ item, week }) => {
        const actualWeek = parseInt(week, 10);
        if (isNaN(actualWeek) || actualWeek < 1) return;
        addCourse(courseMap, item, [actualWeek]);
    });
    return sortCourses(Array.from(courseMap.values()));
}

function maxWeekOf(kbxx) {
    return kbxx.reduce((maxWeek, item) => {
        const weeks = parseWeeks(item.zcs);
        return Math.max(maxWeek, ...(weeks.length ? weeks : [0]));
    }, 0);
}

// 读取课表页中的学期下拉框
function extractSemesterOptions(doc) {
    const selectElem = doc.getElementById("xnxqdm");
    if (!selectElem) return null;
    const semesters = [];
    const semesterValues = [];
    let defaultIndex = 0;
    Array.from(selectElem.querySelectorAll("option")).forEach(option => {
        if (!option.value) return;
        semesters.push(option.innerText.trim());
        semesterValues.push(option.value);
        if (option.selected || option.hasAttribute("selected")) defaultIndex = semesters.length - 1;
    });
    if (semesters.length === 0) return null;

    const start = Math.max(0, defaultIndex - 1);
    const end = Math.min(semesters.length, defaultIndex + 10);
    return {
        semesters: semesters.slice(start, end),
        semesterValues: semesterValues.slice(start, end),
        defaultIndex: defaultIndex - start
    };
}

// 导入前提示先登录教务系统
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "济宁医学院教务导入",
        "请先确保已登录教务系统，再继续导入。",
        "我已登录"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return null;
    }
    return true;
}

// 选择学期
async function selectSemester(semesterOptions) {
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.semesters),
        semesterOptions.defaultIndex
    );
    if (selectedIndex === null || selectedIndex === undefined) return null;
    const index = Number(selectedIndex);
    if (!Number.isInteger(index) || index < 0 || index >= semesterOptions.semesters.length) return null;
    return {
        label: semesterOptions.semesters[index],
        value: semesterOptions.semesterValues[index]
    };
}

// 拉取课表页 HTML（含学期列表）
async function fetchSchedulePage() {
    const response = await fetch("/xsgrkbcx!getXsgrbkList.action", { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error(`无法打开课表页面（HTTP ${response.status}）`);
    return response.text();
}

// 拉取指定学期课表（HTML 内嵌 var kbxx=[...]）
async function fetchCourseData(xnxqdm) {
    const response = await fetch(
        `/xsgrkbcx!xsAllKbList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`,
        { method: "GET", credentials: "include" }
    );
    if (!response.ok) throw new Error(`课表请求失败（HTTP ${response.status}）`);
    const htmlText = await response.text();
    const match = htmlText.match(/var\s+kbxx\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error("课表数据解析失败，请检查登录状态");
    let kbxx;
    try {
        kbxx = JSON.parse(match[1]);
    } catch (error) {
        throw new Error(`课表数据解析失败：${error.message}`);
    }
    return kbxx;
}

function normalizeDate(raw) {
    const match = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function shiftDate(dateText, dayOffset) {
    const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setDate(date.getDate() + dayOffset);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function extractWeekStartDate(payload) {
    const dateRows = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
    const monday = dateRows.find(item => parseInt(item.xqmc, 10) === 1) || dateRows[0];
    return normalizeDate(monday && monday.rq);
}

// 获取某一周的日历数据，jxcdmc 是该周实际使用的教室。
async function fetchWeeklyCourseData(xnxqdm, week) {
    const response = await fetch(
        `/xsgrkbcx!getKbRq.action?xnxqdm=${encodeURIComponent(xnxqdm)}&zc=${encodeURIComponent(week)}`,
        { method: "GET", credentials: "include" }
    );
    if (!response.ok) throw new Error(`第${week}周课表请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
    return {
        rows: rows.map(item => ({ item, week })),
        weekStartDate: extractWeekStartDate(payload)
    };
}

async function fetchWeeklyCourses(xnxqdm, kbxx) {
    const weeks = Array.from({ length: maxWeekOf(kbxx) }, (_, index) => index + 1);
    if (weeks.length === 0) return { rows: [], successfulWeeks: [], semesterStartDate: null };

    const results = await Promise.all(weeks.map(async week => {
        try {
            const data = await fetchWeeklyCourseData(xnxqdm, week);
            return { week, ...data };
        } catch (error) {
            console.warn(`读取第${week}周课表失败`, error);
            return { week, rows: null, weekStartDate: null };
        }
    }));

    const datedWeek = results.find(result => result.weekStartDate);
    const semesterStartDate = datedWeek
        ? shiftDate(datedWeek.weekStartDate, -7 * (datedWeek.week - 1))
        : null;
    return {
        rows: results.flatMap(result => result.rows || []),
        successfulWeeks: results.filter(result => result.rows !== null).map(result => result.week),
        semesterStartDate
    };
}

function mergeWeeklyAndFallbackCourses(kbxx, weeklyData) {
    if (weeklyData.rows.length === 0) return parseCourseList(kbxx);

    const courseMap = new Map();
    parseWeeklyCourseList(weeklyData.rows).forEach(course => {
        courseMap.set(courseKey(course), course);
    });
    const successfulWeeks = new Set(weeklyData.successfulWeeks);
    if (successfulWeeks.size === weeklyData.successfulWeeks.length &&
        successfulWeeks.size >= maxWeekOf(kbxx)) return sortCourses(Array.from(courseMap.values()));

    // 仅为请求失败的周次使用整学期数据，避免覆盖周课表中的精确教室。
    kbxx.forEach(item => {
        const weeks = parseWeeks(item.zcs).filter(week => !successfulWeeks.has(week));
        if (weeks.length > 0) addCourse(courseMap, item, weeks);
    });
    return sortCourses(Array.from(courseMap.values()));
}

async function saveCourseConfig(config) {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function savePresetTimeSlots() {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS));
}

// 主流程：提示 → 选学期 → 拉课表 → 保存课程与作息
async function runImportFlow() {
    try {
        const alertConfirmed = await promptUserToStart();
        if (!alertConfirmed) return;

        const pageHtml = await fetchSchedulePage();
        const semesterOptions = extractSemesterOptions(new DOMParser().parseFromString(pageHtml, "text/html"));
        if (!semesterOptions) throw new Error("未找到学期列表，请先登录教务系统");

        const semester = await selectSemester(semesterOptions);
        if (!semester) { window.shiguangBridge.showToast("导入已取消"); return; }

        window.shiguangBridge.showToast(`正在获取 ${semester.label} 的课表...`);
        const allCourseData = await fetchCourseData(semester.value);
        const weeklyData = await fetchWeeklyCourses(semester.value, allCourseData);
        const courses = mergeWeeklyAndFallbackCourses(allCourseData, weeklyData);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "该学期没有获取到课程数据，请检查登录状态和所选学期。",
                "确定"
            );
            return;
        }

        const courseConfig = {
            semesterTotalWeeks: Math.max(maxWeekOf(allCourseData), 20),
            firstDayOfWeek: 1
        };
        if (weeklyData.semesterStartDate) {
            courseConfig.semesterStartDate = weeklyData.semesterStartDate;
        }

        await saveCourseConfig(courseConfig);
        await saveCourses(courses);
        try {
            await savePresetTimeSlots();
        } catch (error) {
            window.shiguangBridge.showToast(`课程已导入，作息时间导入失败：${error.message}`);
        }

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        if (!weeklyData.semesterStartDate) {
            window.shiguangBridge.showToast("未获取到开学日期，请在应用内手动设置。");
        }
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            error.message || String(error),
            "确定"
        );
    }
}

runImportFlow();
