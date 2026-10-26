// 怀化职业技术学院教务系统（jwgl.hhvtc.com.cn）拾光课表导入适配脚本
// 青果教务：课表表格单元格 .have-content 只有空内容，课程详情在隐藏 div [id^="weekly0"] 内
//   每个详情 div 含 ul>li：课程名称 / 任课教师 / 上课时间（[周次]星期[节次]）/ 上课地点 / 合班信息
// 作息分夏秋（5.1起）与冬春（10.1起）两套，导入时通过选择器让用户选择

// 夏秋作息（5.1 起）
const HHVT_TIME_SLOTS_SUMMER = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:20", endTime: "17:05" },
    { number: 8, startTime: "17:15", endTime: "18:00" }
];

// 冬春作息（10.1 起）
const HHVT_TIME_SLOTS_WINTER = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" }
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

// 收集可访问的 document（frameset 用 <frame>，普通页面用 <iframe>）
function collectDocs() {
    const docs = [document];
    const frames = document.querySelectorAll("iframe, frame");
    for (const f of frames) {
        try {
            if (f.contentDocument) docs.push(f.contentDocument);
        } catch (_) {
            // 跨域 frame 无法访问，忽略。
        }
    }
    return docs;
}

// 从各 frame 中查找课表详情 div（[id^="weekly0"]）
// 注入时机早于页面加载完成，故轮询等待（最长 6 秒）
async function findDetailDivs() {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
        for (const doc of collectDocs()) {
            const divs = doc.querySelectorAll('[id^="weekly0"]');
            if (divs.length > 0) {
                return { doc, divs };
            }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return null;
}

// 解析周次文本："3周"→[3]；"1-18周"→[1..18]；"1-8,10-18周"→[1..8,10..18]
function parseWeeksText(weekStr) {
    const text = String(weekStr || "").replace(/\s+/g, "");
    const m = text.match(/\[(.*?)\]/);
    if (!m) return [];
    const body = m[1].replace(/周/g, "");
    const weeks = [];
    const parts = body.split(",");
    for (const part of parts) {
        const range = part.split("-");
        const start = Number(range[0]);
        const end = range.length > 1 ? Number(range[1]) : start;
        if (!start) continue;
        for (let w = start; w <= end; w++) weeks.push(w);
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 星期汉字 → 拾光 day（一=1 … 日=7）
const DAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };

// 解析单个详情 div（ul>li 结构）
function parseDetailDiv(div) {
    const lis = div.querySelectorAll("li");
    if (lis.length === 0) return null;

    let name = "";
    let teacher = "";
    let position = "";
    let timeText = "";

    for (const li of lis) {
        const text = (li.textContent || "").trim();
        if (text.indexOf("课程名称") !== -1) {
            name = text.replace(/^.*?[:：]/, "").trim();
        } else if (text.indexOf("任课教师") !== -1) {
            teacher = text.replace(/^.*?[:：]/, "").trim();
        } else if (text.indexOf("上课时间") !== -1) {
            timeText = text.replace(/^.*?[:：]/, "").trim();
        } else if (text.indexOf("上课地点") !== -1) {
            position = text.replace(/^.*?[:：]/, "").trim();
        }
    }

    if (!name || !timeText) return null;

    // 上课时间：[3周]一[1-2节]
    const dayMatch = timeText.match(/[一二三四五六日]/);
    if (!dayMatch) return null;
    const day = DAY_MAP[dayMatch[0]];
    const sectionMatch = timeText.match(/\[(\d+)-(\d+)节\]/);
    if (!sectionMatch) return null;
    const weeks = parseWeeksText(timeText);
    if (weeks.length === 0) return null;

    return {
        name,
        teacher: teacher || "未知",
        position: position || "待定",
        day,
        startSection: Number(sectionMatch[1]),
        endSection: Number(sectionMatch[2]),
        weeks
    };
}

// 解析所有详情 div
function parseCourses(divs) {
    const courses = [];
    for (const div of divs) {
        const course = parseDetailDiv(div);
        if (course) courses.push(course);
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
        "导入前请确保已登录并打开课表查询页面。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 作息选择：按当前日期给默认（5.1-9.30 夏秋，10.1-4.30 冬春）
    const now = new Date();
    const defaultIdx = (now.getMonth() + 1 >= 5 && now.getMonth() + 1 <= 9) ? 0 : 1;
    const picked = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(["夏秋作息（5月1日起）", "冬春作息（10月1日起）"]),
        defaultIdx
    );
    if (picked === null || picked < 0) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    const timeSlots = picked === 0 ? HHVT_TIME_SLOTS_SUMMER : HHVT_TIME_SLOTS_WINTER;

    window.shiguangBridge.showToast("正在获取课表数据...");
    try {
        const found = await findDetailDivs();
        if (!found) throw new Error("未找到课表详情，请确认已登录并打开课表查询页面。");

        const courses = parseCourses(found.divs);
        if (courses.length === 0) throw new Error("课表中未解析到有效课程，请确认当前学期有课。");

        const merged = mergeCourses(courses);

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));
        await saveTimeSlots(timeSlots);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${merged.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();
