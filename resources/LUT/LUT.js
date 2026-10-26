// 兰州理工大学教务系统课程表适配

const API_ROOT = "/jwapp/sys";
const TERM_URL = `${API_ROOT}/wdkb/modules/jshkcb/dqxnxq.do`;
const COURSE_URL = `${API_ROOT}/wdkb/modules/xskcb/cxxszhxqkb.do`;
const LUT_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:30", endTime: "16:20" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:40", endTime: "18:30" },
    { number: 9, startTime: "19:30", endTime: "20:20" },
    { number: 10, startTime: "20:30", endTime: "21:20" }
];

function rowsOf(data, name) {
    return data && data.datas && data.datas[name] && Array.isArray(data.datas[name].rows)
        ? data.datas[name].rows : [];
}

async function requestJson(url, params) {
    const options = { credentials: "include" };
    if (params) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
        options.body = new URLSearchParams(params);
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`请求失败: ${response.status} ${url}`);
    const data = await response.json();
    if (data.code && data.code !== "0") throw new Error(`教务系统拒绝请求: ${url}`);
    return data;
}

function parseWeeks(value, maxWeek) {
    const text = String(value || "").replace(/[第周]/g, "").replace(/，/g, ",");
    const numbers = text.match(/\d+/g) || [];
    const odd = /单/.test(text);
    const even = /双/.test(text);
    const weeks = new Set();
    const add = week => {
        if (week > 0 && week <= maxWeek && (!odd && !even || odd && week % 2 === 1 || even && week % 2 === 0)) {
            weeks.add(week);
        }
    };
    if (!numbers.length || /全周|全部/.test(text)) {
        for (let week = 1; week <= maxWeek; week++) add(week);
    } else {
        numbers.forEach(number => add(Number(number)));
        const rangePattern = /(\d+)\s*[至到-]\s*(\d+)/g;
        let match;
        while ((match = rangePattern.exec(text))) {
            for (let week = Number(match[1]); week <= Number(match[2]); week++) add(week);
        }
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

function parseTime(value) {
    const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}

function getTimeSlots(rows) {
    return rows.map((row, index) => ({
        number: Number(row.DM || index + 1),
        startTime: parseTime(row.KSSJ || row.START_TIME),
        endTime: parseTime(row.JSSJ || row.END_TIME)
    })).filter(slot => slot.startTime && slot.endTime).sort((a, b) => a.number - b.number);
}

async function loadLutSchedule() {
    const termData = await requestJson(TERM_URL);
    const term = rowsOf(termData, "dqxnxq")[0];
    if (!term || !term.DM) throw new Error("未找到当前学期，请先登录教务系统");

    const courseData = await requestJson(COURSE_URL, { XNXQDM: term.DM });
    const courseRows = rowsOf(courseData, "cxxszhxqkb");
    const timeSlots = LUT_TIME_SLOTS;
    const courses = courseRows.flatMap(row => {
        const day = Number(row.SKXQ);
        const startSection = Number(row.KSJC);
        const endSection = Number(row.JSJC);
        const weeks = parseWeeks(row.ZCMC, 30);
        if (!row.KCM || !day || !startSection || !endSection || !weeks.length) return [];
        return [{
            name: String(row.KCM).trim(),
            teacher: String(row.SKJS || "").trim(),
            position: String(row.JASMC || "").trim(),
            day,
            startSection,
            endSection,
            weeks
        }];
    });
    return { term, courses, timeSlots };
}

async function importLutCourses() {
    const result = await loadLutSchedule();
    if (!result.courses.length) throw new Error("课表接口未返回可导入课程，请检查当前学期");

    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
    if (result.timeSlots.length) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(result.timeSlots));
    }
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterStartDate: null,
        semesterTotalWeeks: Math.max(...result.courses.flatMap(course => course.weeks), 20),
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1
    }));
    window.shiguangBridge.showToast(`兰州理工大学课表导入成功，共 ${result.courses.length} 条安排`);
    window.shiguangBridge.notifyTaskCompletion();
}

(async function run() {
    try {
        await importLutCourses();
    } catch (error) {
        console.error("兰州理工大学课表导入失败:", error);
        window.shiguangBridge.showToast(`课表导入失败: ${error.message}`);
    }
})();
