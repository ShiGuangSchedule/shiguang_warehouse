// 南京信息工程大学教务系统（jwxt.nuist.edu.cn）拾光课程表适配脚本

function parseWeeks(skzc) {
    const value = String(skzc || "");
    const weeks = [];
    for (let i = 0; i < value.length; i++) {
        if (value[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

// jc.do 不可用时的 NUIST 默认作息（已由接口确认）。
const DEFAULT_TIME_SLOTS = [
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
    { number: 11, startTime: "20:35", endTime: "21:20" },
    { number: 12, startTime: "21:25", endTime: "22:00" }
];

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures and use the generic fallback below.
    }
    return "未知错误";
}

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

async function fetchCourses(xnxqdm) {
    const response = await fetch("/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do", {
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
    const table = payload && payload.datas && payload.datas.cxxszhxqkb;
    if (!table) throw new Error("教务系统返回数据格式异常。");
    if (table.extParams && Number(table.extParams.code) !== 1) {
        throw new Error(table.extParams.msg || "教务系统未发布该学期课表。");
    }

    const rows = Array.isArray(table.rows) ? table.rows : [];
    const courses = rows.map(parseCourse).filter(Boolean);
    if (courses.length === 0) throw new Error("未找到包含有效时间的课程。");
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    return { courses, xnxqdm };
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
    if (!term || !term.DM) throw new Error("未获取到当前学期信息。");
    return {
        code: String(term.DM),
        name: String(term.MC || term.DM)
    };
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
    return rows.filter(item => item && item.DM).map(item => ({
        code: String(item.DM),
        name: String(item.MC || item.DM),
        year: item.XNDM,
        term: item.XQDM
    }));
}

async function selectSemester() {
    let semesters;
    try {
        semesters = await fetchSemesterList();
    } catch (error) {
        window.shiguangBridge.showToast(`获取学期列表失败：${getErrorMessage(error)}`);
        return null;
    }
    if (semesters.length === 0) {
        window.shiguangBridge.showToast("未查询到可用学期。");
        return null;
    }

    let currentCode = null;
    try {
        currentCode = (await fetchCurrentSemester()).code;
    } catch (error) {
        console.warn("获取当前学期失败，将不设置默认选项", error);
    }

    const visibleSemesters = semesters.slice(0, 10);
    const defaultIndex = currentCode
        ? visibleSemesters.findIndex(item => item.code === currentCode)
        : -1;
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(visibleSemesters.map(item => item.name)),
        defaultIndex
    );
    if (selectedIndex === null || selectedIndex < 0 || !visibleSemesters[selectedIndex]) return null;
    return visibleSemesters[selectedIndex];
}

async function fetchTimeSlots() {
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/jc.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: "",
        credentials: "include"
    });
    if (!response.ok) throw new Error(`节次时间接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.jc && payload.datas.jc.rows;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows.map(row => ({
        number: Number(row.DM),
        startTime: String(row.KSSJ || ""),
        endTime: String(row.JSSJ || "")
    })).filter(slot => slot.number > 0 && slot.startTime && slot.endTime)
      .sort((a, b) => a.number - b.number);
}

async function fetchSemesterConfig(xnxqdm) {
    const parts = String(xnxqdm || "").split("-");
    if (parts.length < 3) return { semesterStartDate: null, semesterTotalWeeks: 20 };
    const response = await fetch("/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: `XN=${encodeURIComponent(`${parts[0]}-${parts[1]}`)}&XQ=${encodeURIComponent(parts[2])}`,
        credentials: "include"
    });
    if (!response.ok) throw new Error(`学期配置接口请求失败（HTTP ${response.status}）`);
    const payload = await response.json();
    const rows = payload && payload.datas && payload.datas.cxjcs && payload.datas.cxjcs.rows;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { semesterStartDate: null, semesterTotalWeeks: 20 };
    const rawDate = row.XQKSRQ || row.XQKSRQ_DISPLAY || row.KSRQ;
    const startDate = rawDate ? String(rawDate).split(/[ T]/)[0] : null;
    const totalWeeks = Number.parseInt(row.ZZC || row.ZCZ || row.ZC, 10);
    return {
        semesterStartDate: /^\d{4}-\d{2}-\d{2}$/.test(startDate || "") ? startDate : null,
        semesterTotalWeeks: Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : 20
    };
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "南京信息工程大学课表导入",
            "请先在当前教务页面完成登录，再开始导入。",
            "开始导入"
        );
        if (!confirmed) return;

        const semester = await selectSemester();
        if (!semester) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        window.shiguangBridge.showToast(`已选择学期：${semester.name}`);
        const result = await fetchCourses(semester.code);
        let semesterConfig = { semesterStartDate: null, semesterTotalWeeks: 20 };
        try {
            semesterConfig = await fetchSemesterConfig(semester.code);
        } catch (error) {
            console.warn("获取学期配置失败，将使用默认配置", error);
            window.shiguangBridge.showToast("开学日期获取失败，已使用默认配置继续导入。");
        }
        let timeSlots = DEFAULT_TIME_SLOTS;
        try {
            const fetchedTimeSlots = await fetchTimeSlots();
            if (fetchedTimeSlots.length > 0) timeSlots = fetchedTimeSlots;
        } catch (error) {
            console.warn("NUIST time slot request failed, using defaults", error);
            window.shiguangBridge.showToast("作息时间获取失败，已使用默认时间继续导入。");
        }
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            ...semesterConfig,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast(`成功导入 ${result.courses.length} 条课程记录（${result.xnxqdm}）。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("NUIST adapter error", error);
    }
}

runImportFlow();
