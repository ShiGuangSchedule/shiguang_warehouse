// 黑龙江大学本科选课系统（xsxk.hlju.edu.cn）拾光课表导入适配脚本
// 课表接口：/xszykb/queryxszykbzong（JSON 数组）
//   字段：SKSJ 课程文本、KEY(xqN_jcM 星期_大节)、KSJC/JSJC 起止节次、ZC 周次位图
//   课程文本格式：课程名【001】\n[教师]\n[周次][地点]\n第X-Y节（节次行可能缺失）
// 作息：12 节（接口 /component/queryxqkjsj 获取）

// 黑龙江大学作息时间（2026-2027 第一学期）
const HLJU_BACHELOR_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:35" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:20", endTime: "15:05" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:20", endTime: "17:05" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:20", endTime: "20:05" },
    { number: 11, startTime: "20:10", endTime: "20:55" },
    { number: 12, startTime: "21:00", endTime: "21:45" }
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

// 从 performance 资源中查找课表请求 URL（queryxszykbzong）
function findScheduleRequest() {
    const resources = performance.getEntriesByType("resource");
    const matches = resources.map(item => item.name).filter(url => url.indexOf("queryxszykbzong") !== -1);
    return matches.length ? matches[matches.length - 1] : null;
}

// 获取当前学期（xn=2026-2027&xq=1），从 queryxnxqdata 接口取 SFDQXQ=1 的学期
async function fetchCurrentSemester() {
    const response = await fetch("/component/queryxnxqdata", {
        method: "POST",
        credentials: "include",
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        }
    });
    if (!response.ok) throw new Error(`学期接口请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data.content) ? data.content : []);
    const current = list.find(item => String(item.SFDQXQ) === "1");
    if (!current || !current.XN || !current.XQ) {
        throw new Error("未获取到当前学期信息");
    }
    return { xn: current.XN, xq: String(current.XQ) };
}

async function fetchSchedule() {
    const semester = await fetchCurrentSemester();
    const url = findScheduleRequest() || "/xszykb/queryxszykbzong";
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: `xn=${encodeURIComponent(semester.xn)}&xq=${encodeURIComponent(semester.xq)}`
    });
    if (!response.ok) throw new Error(`课表接口请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (!data || typeof data !== "object") throw new Error("课表接口返回格式异常");
    const list = Array.isArray(data) ? data : (Array.isArray(data.content) ? data.content : null);
    if (!list) throw new Error("课表接口返回格式异常");
    return list;
}

// 解析周次文本：支持带/不带方括号
//   "1-17周" 或 "[1-17周]" → 1..17
//   "1,4-8双,9,12-16双周" → 1,4,6,8,9,12,14,16
function parseWeeksText(weekStr) {
    const text = String(weekStr || "").replace(/\s+/g, "").replace(/^\[|\]$/g, "");
    if (!text) return [];
    const body = text.replace(/周/g, "");
    const weeks = [];
    const parts = body.split(",");
    for (const part of parts) {
        const pm = part.match(/^(\d+)(?:-(\d+))?(单|双)?$/);
        if (!pm) continue;
        const start = Number(pm[1]);
        const end = pm[2] ? Number(pm[2]) : start;
        const parity = pm[3]; // "单" / "双" / undefined
        for (let w = start; w <= end; w++) {
            if (parity === "单" && w % 2 === 0) continue;
            if (parity === "双" && w % 2 === 1) continue;
            weeks.push(w);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析课程文本：课程名【001】\n[教师]\n[周次][地点]\n第X-Y节（节次行可能缺失）
function parseCourseText(sksj) {
    const lines = String(sksj || "").split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return null;

    // 考试记录（以【...考试】开头）跳过
    if (lines[0].indexOf("考试】") !== -1) return null;

    const name = lines[0];

    // 教师：第二行固定为 [教师名]
    let teacher = "";
    if (/^\[[^\]]+\]$/.test(lines[1])) {
        teacher = lines[1].slice(1, -1);
    }

    // 周次与地点：从第 3 行起，含"周"的 [..] 为周次，其后 [..] 为地点
    // 地点可能含嵌套方括号（如 [4号楼-[617]计算机5机房分室2]），用平衡括号匹配
    let weekStr = "";
    let position = "";
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/\[([^\]]*周[^\]]*)\]/);
        if (m) {
            if (!weekStr) weekStr = m[1];
            const rest = line.slice(line.indexOf(m[0]) + m[0].length).trim();
            if (rest.startsWith("[") && !position) {
                position = rest.slice(1, -1);
            }
            continue;
        }
        const posM = line.match(/^\[(.+)\]$/);
        if (posM && !position && posM[1].indexOf("周") === -1) {
            position = posM[1];
        }
    }

    const weeks = parseWeeksText(weekStr);
    if (weeks.length === 0) return null;

    return { name, teacher: teacher || "未知", position: position || "待定", weeks };
}

function parseSchedule(data) {
    const courses = [];

    for (const row of data) {
        if (!row || typeof row !== "object") continue;

        const key = String(row.KEY || "");
        // 劳动教育等无位置排布的记录（KEY=bz 或无节次）跳过
        if (key === "bz" || !key) continue;

        const dayMatch = key.match(/xq(\d+)/);
        if (!dayMatch) continue;
        const day = Number(dayMatch[1]);
        if (!(day >= 1 && day <= 7)) continue;

        // 起止节次：KSJC/JSJC 字段优先
        const startSection = Number(row.KSJC);
        const endSection = Number(row.JSJC);
        if (!startSection || !endSection || startSection > endSection) continue;

        const parsed = parseCourseText(row.SKSJ);
        if (!parsed) continue;

        courses.push({
            name: parsed.name,
            teacher: parsed.teacher,
            position: parsed.position,
            day,
            startSection,
            endSection,
            weeks: parsed.weeks
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
        "导入前请确保已登录选课系统并打开课表查询页面。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在获取课表数据...");
    try {
        const data = await fetchSchedule();
        const courses = parseSchedule(data);
        if (courses.length === 0) throw new Error("课表中未解析到有效课程，请确认当前学期有课。");

        const merged = mergeCourses(courses);

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));
        await saveTimeSlots(HLJU_BACHELOR_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${merged.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();
