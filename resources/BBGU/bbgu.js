// 北部湾大学智慧教务系统（zhjw.bbgu.edu.cn）拾光课表导入适配脚本
// 新一代金智 resourceapi 接口：session/list 取学期、timePattern/get-large-period 取作息、
// timetable/class/timetable/student/my-table-detail 取课表

// 解析周次字符串："1-4,6-9" → [1,2,3,4,6,7,8,9]
function parseWeeks(weekStr) {
    const weeks = [];
    String(weekStr || "").split(",").forEach(part => {
        part = part.trim();
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else if (/^\d+$/.test(part)) {
            weeks.push(Number(part));
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析节次字符串："10-11" → { startSection: 10, endSection: 11 }；单值 "12" → 第12节
function parsePeriods(periodStr) {
    const str = String(periodStr || "").trim();
    const m = str.match(/^(\d+)-(\d+)$/);
    if (m) {
        const start = Number(m[1]);
        const end = Number(m[2]);
        if (!start || !end || start > end) return null;
        return { startSection: start, endSection: end };
    }
    if (/^\d+$/.test(str)) {
        const n = Number(str);
        if (!n) return null;
        return { startSection: n, endSection: n };
    }
    return null;
}

// 清洗教师名："周文红[主讲];" → "周文红"；"王柏玲[主讲];谢娟[主讲];" → "王柏玲、谢娟"
function cleanTeacher(name) {
    const cleaned = String(name || "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/[;；]+/g, "、")
        .replace(/、+$/, "")
        .trim();
    return cleaned || "未知";
}

function parseCourse(row) {
    const day = Number(row.weekDay);
    const periods = parsePeriods(row.periodFormat);
    const weeks = parseWeeks(row.teachingWeekFormat);
    if (!row.courseName || !day || day < 1 || day > 7 || !periods || weeks.length === 0) return null;

    const campus = String(row.campusName || "").trim();
    const room = String(row.roomName || "").trim();
    let position = room;
    if (campus && room) position = `${room}（${campus}）`;
    if (!position) position = campus || "待定";

    return {
        name: String(row.courseName).trim(),
        teacher: cleanTeacher(row.instructorName),
        position,
        day,
        startSection: periods.startSection,
        endSection: periods.endSection,
        weeks
    };
}

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

// 从页面存储中提取 JWT 鉴权 token（金智系统常见 key + 全量扫描兜底）
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
    // 全量扫描：找直接以 eyJ 开头（JWT）或 JSON 包装中含 eyJ 的字符串
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

async function requestJson(url, options) {
    const token = getAuthToken();
    const headers = { "X-Requested-With": "XMLHttpRequest" };
    if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const response = await fetch(url, Object.assign({
        credentials: "include",
        headers
    }, options));
    if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
    return response.json();
}

// 获取学期列表，返回 { id, year, term, beginDate, endDate, active }
async function fetchSemesters() {
    const payload = await requestJson("https://zhjw.bbgu.edu.cn/api/resourceapi/session/list");
    const list = payload && Array.isArray(payload.sessionVOList) ? payload.sessionVOList : [];
    return list.filter(s => s && s.id && s.year && s.term);
}

// 获取作息时间（第1-N节）
async function fetchTimeSlots(sessionId) {
    const payload = await requestJson(
        `https://zhjw.bbgu.edu.cn/api/resourceapi/timePattern/get-large-period?sessionId=${encodeURIComponent(sessionId)}`
    );
    const patterns = payload && Array.isArray(payload.data) ? payload.data : [];
    const slots = [];
    for (const group of patterns) {
        const list = Array.isArray(group.periodList) ? group.periodList : [];
        for (const p of list) {
            const number = Number(p.smallPeriod);
            if (!number || !p.startTime || !p.endTime) continue;
            slots.push({ number, startTime: p.startTime, endTime: p.endTime });
        }
    }
    return slots.sort((a, b) => a.number - b.number);
}

// 获取课表并解析
async function fetchCourses(sessionId) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    const payload = await requestJson(
        `https://zhjw.bbgu.edu.cn/api/timetable/class/timetable/student/my-table-detail?sessionId=${encodeURIComponent(sessionId)}`,
        { method: "POST", credentials: "include" }
    );
    const rows = payload && Array.isArray(payload.classTimetableVOList)
        ? payload.classTimetableVOList
        : (payload && payload.data && Array.isArray(payload.data.classTimetableVOList) ? payload.data.classTimetableVOList : []);
    if (rows.length === 0) throw new Error("教务系统返回数据格式异常。");

    const rawCourses = rows.map(parseCourse).filter(Boolean);

    // 同一门课多处时段会分多条，按组合键去重
    const seen = new Set();
    const courses = [];
    for (const c of rawCourses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(',')}|${c.teacher}|${c.position}`;
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push(c);
    }
    if (courses.length === 0) throw new Error("未找到包含有效时间的课程。");
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    return courses;
}

// 判断是否处于登录页
function isLoginPage() {
    const url = window.location.href;
    return url.includes("authserver") && url.includes("login");
}

// 选择学期，默认定位到当前激活学期
async function selectSemester() {
    const list = await fetchSemesters();
    if (list.length === 0) throw new Error("未获取到学期列表。");

    const defaultIndex = Math.max(0, list.findIndex(s => s.active === "Y"));
    const names = list.map(s => `${s.year}${s.term === "春" ? "春季" : "秋季"}学期`);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(names),
        defaultIndex
    );
    if (selectedIndex === null || selectedIndex === undefined) return null;
    return list[selectedIndex];
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

// 获取当前学期最大周次（失败返回 null）
async function fetchMaxWeek(sessionId) {
    try {
        const payload = await requestJson(
            `https://zhjw.bbgu.edu.cn/api/timetable/course/maxWeek/${encodeURIComponent(sessionId)}`
        );
        const weeks = Number(payload && payload.data);
        return weeks > 0 ? weeks : null;
    } catch (error) {
        console.error("JS: 获取最大周次失败:", error);
        return null;
    }
}

// 保存课表配置（开学日期、总周数；失败仅告警，不阻断课程导入）
async function saveCourseConfig(semester, courses) {
    try {
        const dateDiffDays = (new Date(semester.endDate) - new Date(semester.beginDate)) / 86400000;
        const weeksByDate = Math.round(dateDiffDays / 7);
        const maxCourseWeek = Math.max(0, ...courses.map(c => Math.max(...c.weeks)));
        const maxWeek = await fetchMaxWeek(semester.id);
        const config = {
            semesterStartDate: semester.beginDate,
            semesterTotalWeeks: maxWeek || Math.max(maxCourseWeek, weeksByDate || 20)
        };
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        console.log(`JS: 课表配置保存成功（开学 ${config.semesterStartDate}，共 ${config.semesterTotalWeeks} 周）`);
    } catch (error) {
        console.error("JS: 课表配置保存失败:", error);
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

    window.shiguangBridge.showToast("正在获取学期信息...");
    try {
        const semester = await selectSemester();
        if (!semester) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }
        console.log(`JS: 选择学期: ${semester.year}${semester.term} (${semester.id})`);

        const courses = await fetchCourses(semester.id);
        window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

        await saveCourseConfig(semester, courses);

        const timeSlots = await fetchTimeSlots(semester.id);
        await saveTimeSlots(timeSlots);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error:", error);
    }
}

runImportFlow();
