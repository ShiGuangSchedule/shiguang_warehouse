// 大连工程学院教务系统（jw.dlutci.edu.cn）拾光课表导入适配脚本
// 基于智慧教务(app)系统，接口为 xskcb.do 获取课表、xnxqcx.do 选择学期

// 大连工程学院作息时间表（第1-12节）
const DLUTCI_TIME_SLOTS = [
    { number: 1,  startTime: "08:10", endTime: "08:55" },
    { number: 2,  startTime: "09:00", endTime: "09:45" },
    { number: 3,  startTime: "10:15", endTime: "11:00" },
    { number: 4,  startTime: "11:05", endTime: "11:50" },
    { number: 5,  startTime: "13:20", endTime: "14:05" },
    { number: 6,  startTime: "14:10", endTime: "14:55" },
    { number: 7,  startTime: "15:15", endTime: "16:00" },
    { number: 8,  startTime: "16:00", endTime: "16:45" },
    { number: 9,  startTime: "17:45", endTime: "18:30" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:35", endTime: "20:20" },
    { number: 12, startTime: "20:20", endTime: "21:05" }
];

// 周次位图解析：SKZC 为"0"/"1"串，第 i 位为"1"表示第 i+1 周有课
function parseWeeks(skzc) {
    const value = String(skzc || "");
    const weeks = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures.
    }
    return "未知错误";
}

// 教室：JASMC 为主，XXXQDM_DISPLAY 校区做后缀；均无则"待定"
function parsePosition(row) {
    const campus = String(row.XXXQDM_DISPLAY || "").trim();
    const room = String(row.JASMC || "").trim();
    if (campus && room) return `${room}（${campus}）`;
    return room || campus || "待定";
}

function parseCourse(row) {
    const day = Number(row.SKXQ);
    const startSection = Number(row.KSJC);
    const endSection = Number(row.JSJC);
    const weeks = parseWeeks(row.SKZC);
    if (!row.KCM || !day || day < 1 || day > 7 || !startSection || !endSection ||
        startSection > endSection || weeks.length === 0) return null;

    return {
        name: String(row.KCM).trim(),
        teacher: String(row.SKJS || "").split(/[\\/、,，]/)[0].trim() || "未知",
        position: parsePosition(row),
        day,
        startSection,
        endSection,
        weeks
    };
}

// 接口返回 JSON = { datas: { xskcb: { rows: [...] } } }，按行为一门课；同一门课多处时段会分多条，按组合键去重
function transformSchedule(payload) {
    const rows = payload && payload.datas && payload.datas.xskcb && payload.datas.xskcb.rows;
    if (!Array.isArray(rows)) return [];
    const rawCourses = rows.map(parseCourse).filter(Boolean);

    const seen = new Set();
    const courses = [];
    for (const c of rawCourses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(',')}|${c.teacher}|${c.position}`;
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push(c);
    }
    return courses;
}

// 判断是否登录页
function isLoginPage() {
    const url = window.location.href;
    return /login/i.test(url);
}

async function fetchCurrentSemester() {
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: "",
        credentials: "include"
    });
    if (!response.ok) throw new Error(`当前学期接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.dqxnxq && payload.datas.dqxnxq.rows;
    const term = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!term || (!term.DM && !term.XNXQDM)) throw new Error("未获取到当前学期信息。");
    return { code: String(term.XNXQDM || term.DM) };
}

async function fetchSemesterList() {
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: "*order=-DM",
        credentials: "include"
    });
    if (!response.ok) throw new Error(`学期列表接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.xnxqcx && payload.datas.xnxqcx.rows;
    if (!Array.isArray(rows)) throw new Error("学期列表返回数据格式异常。");
    return rows.filter(item => item && (item.DM || item.XNXQDM)).map(item => {
        const code = String(item.XNXQDM || item.DM);
        const MC = String(item.MC || item.DM || item.XNXQDM);
        return { code, name: MC };
    });
}

// 选择学期，默认定位到当前学期
async function selectSemester() {
    const current = await fetchCurrentSemester();
    const list = await fetchSemesterList();
    if (list.length === 0) throw new Error("未获取到学期列表。");

    const defaultIndex = Math.max(0, list.findIndex(s => s.code === current.code));
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(list.map(s => s.name)),
        defaultIndex
    );
    if (selectedIndex === null || selectedIndex === undefined) return null;
    return list[selectedIndex];
}

async function fetchCourses(xnxqdm) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    // 请求参数仅传 XNXQDM，即可返回该学期全部课表
    const response = await fetch("/jwapp/sys/wdkb/modules/xskcb/xskcb.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: `XNXQDM=${encodeURIComponent(xnxqdm)}`,
        credentials: "include"
    });
    if (!response.ok) throw new Error(`课表接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    return transformSchedule(payload);
}

// 保存预设作息时间（失败仅告警，不阻断课程导入）
async function saveTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        console.log("JS: 作息时间保存成功");
    } catch (error) {
        console.error("JS: 作息时间保存失败:", error);
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }

    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已登录教务系统，建议在课表页面进行导入",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    try {
        const semester = await selectSemester();
        if (!semester) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }
        console.log(`JS: 选择学期: ${semester.name} (${semester.code})`);

        const courses = await fetchCourses(semester.code);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学期是否正确。");
            return;
        }

        window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

        await saveTimeSlots(DLUTCI_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error:", error);
    }
}

runImportFlow();