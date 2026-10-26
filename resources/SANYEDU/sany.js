// 湖南三一工业职业技术学院（ehall.sanyedu.com）拾光课表导入适配脚本
// 金智教务（jwapp/sys/wdkb 模块）：
//   xskcb.do 学生课表：POST XNXQDM=学年学期，返回 datas.xskcb.rows[]
//   cxjcs.do 学期配置：返回当前学期开学日期(XQKSRQ)与总周数(ZZC)
// 每日 10 节（无午休拆分的独立小节，晚饭 17:30-18:30 休息）

// 预设作息时间（10 节）
const SANY_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

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

// 从当前页面 URL 提取 /jwapp 前缀（含 ehall 域名与可选哈希路径）
function getApiBase() {
    const m = window.location.href.match(/^(https?:\/\/[^/]+(?:[^?#]*)?)\/jwapp/);
    return m ? m[1] : window.location.origin;
}

const API_BASE = getApiBase();
const MODULES = {
    table: `${API_BASE}/jwapp/sys/wdkb/modules/xskcb/xskcb.do?enlink-vpn`,
    semester: `${API_BASE}/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do?enlink-vpn`
};

// 从页面存储中提取 JWT 鉴权 token（金智常见 key + 全量扫描兜底）
function getAuthToken() {
    const keys = ["Authorization", "access_token", "token", "X-Access-Token", "x-token", "auth_token", "jwt", "user_token"];
    for (const k of keys) {
        try {
            const v = window.localStorage.getItem(k) || window.sessionStorage.getItem(k);
            if (v && v.includes("eyJ")) return v;
        } catch (_) {
            // Ignore storage access errors.
        }
    }
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
        try {
            for (let i = 0; i < store.length; i++) {
                const raw = store.getItem(store.key(i));
                if (!raw) continue;
                if (raw.startsWith("eyJ")) return raw;
                const m = raw.match(/"([^"]*eyJ[^"]*)"/);
                if (m) return m[1];
            }
        } catch (_) {
            // Ignore storage access errors.
        }
    }
    return null;
}

async function postForm(url, params) {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" };
    if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: new URLSearchParams(params || {}).toString()
    });
    if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
    return response.json();
}

// 解析 SKZC 周次位图："00001111111111111111" 从第5位起为1 → 5..20
function parseWeekBitmap(bitmap) {
    const weeks = [];
    const s = String(bitmap || "");
    for (let i = 0; i < s.length; i++) {
        if (s.charAt(i) === "1") weeks.push(i + 1);
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 获取当前学期配置：cxjcs.do 返回全部学期（无 SFSY 等可区分字段），
// 按开学日期(XQKSRQ)取"最近开学且不晚于今天"的学期，得 XN/XQ/XQKSRQ/ZZC
async function fetchSemesterConfig() {
    const payload = await postForm(MODULES.semester);
    const rows = payload && payload.datas && payload.datas.cxjcs && payload.datas.cxjcs.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("未获取到学期配置信息");
    }
    const today = new Date();
    let best = null;
    let bestDate = -Infinity;
    for (const s of rows) {
        const start = new Date(String(s.XQKSRQ || "").slice(0, 10) + "T00:00:00");
        if (isNaN(start.getTime()) || start > today) continue;
        const t = start.getTime();
        if (t > bestDate) {
            bestDate = t;
            best = s;
        }
    }
    if (!best) {
        // 兜底：全部开学日期都晚于今天（如学期刚开始数据未刷新），取可用的最近一条
        best = rows[0];
    }
    const xn = String(best.XN || "").trim();
    const xq = String(best.XQ || "").trim();
    if (!xn || !xq) throw new Error("学期配置缺少学年学期");
    const semesterStart = String(best.XQKSRQ || "").slice(0, 10);
    const totalWeeks = Number(best.ZZC) || Number(best.ZJXZC) || 0;
    return { xnxqdm: `${xn}-${xq}`, semesterStartDate: semesterStart, totalWeeks };
}

async function fetchCourses(xnxqdm) {
    const payload = await postForm(MODULES.table, { XNXQDM: xnxqdm });
    const rows = payload && payload.datas && payload.datas.xskcb && payload.datas.xskcb.rows;
    if (!Array.isArray(rows)) return [];
    return rows;
}

function parseSchedule(rows) {
    const courses = [];
    for (const row of rows) {
        const name = String(row.KCM || "").trim();
        if (!name) continue;
        const day = Number(row.SKXQ);
        const startSection = Number(row.KSJC);
        const endSection = Number(row.JSJC);
        if (!(day >= 1 && day <= 7) || !startSection || !endSection || endSection < startSection) continue;
        const weeks = parseWeekBitmap(row.SKZC);
        if (weeks.length === 0) continue;
        courses.push({
            name,
            teacher: String(row.SKJS || "").trim() || "未知",
            position: String(row.JASMC || "").trim() || "待定",
            day,
            startSection,
            endSection,
            weeks
        });
    }
    return courses;
}

// 合并同课程同时间同教室的条目
function mergeCourses(courses) {
    const merged = new Map();
    for (const c of courses) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}`;
        const holder = merged.get(key);
        if (holder) {
            holder.weeks = Array.from(new Set([...holder.weeks, ...c.weeks])).sort((a, b) => a - b);
        } else {
            merged.set(key, { ...c, weeks: [...c.weeks].sort((a, b) => a - b) });
        }
    }
    return Array.from(merged.values()).sort(
        (a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name)
    );
}

// 保存作息时间
async function saveTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        console.error("JS: 作息时间保存失败", error);
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "课表导入",
        "导入前请确保已登录并打开课表页面。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在获取课表数据...");
    try {
        const config = await fetchSemesterConfig();
        const rows = await fetchCourses(config.xnxqdm);
        const courses = parseSchedule(rows);
        if (courses.length === 0) throw new Error("课表中未解析到有效课程，请确认本学期有课。");

        const merged = mergeCourses(courses);

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));

        // 保存学期配置（开学日期 + 总周数）
        const courseConfig = { semesterTotalWeeks: config.totalWeeks };
        if (config.semesterStartDate) courseConfig.semesterStartDate = config.semesterStartDate;
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));

        await saveTimeSlots(SANY_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${merged.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();