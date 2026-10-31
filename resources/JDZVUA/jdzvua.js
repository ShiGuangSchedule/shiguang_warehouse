// 景德镇艺术职业大学 (jdzvua.edu.cn) 拾光课程表适配脚本
// 纯 HTML 抓取：课表在 iframe 内 #manualArrangeCourseTable，切换学期无网络请求，
// 请先在页面上切换到目标学期课表再执行导入
// 课程信息在 td.infoTitle 的 title 属性：`课程名(编码) (教师);(周次,地点;...` 成对出现，
// td id 形如 TD{星期0-6}{节次-1}_0，rowspan 为跨节数
// 作息按楼栋分两组（08:00 起 / 08:20 起），课程覆盖多的一组写入预设作息，
// 少的一组课程按其楼栋时间写入自定义时间

const TIME_SLOT_A = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:35", endTime: "11:20" },
    { number: 4, startTime: "11:30", endTime: "12:15" },
    { number: 5, startTime: "14:20", endTime: "15:05" },
    { number: 6, startTime: "15:15", endTime: "16:00" },
    { number: 7, startTime: "16:35", endTime: "17:20" },
    { number: 8, startTime: "17:30", endTime: "18:15" },
    { number: 9, startTime: "19:20", endTime: "20:05" },
    { number: 10, startTime: "20:15", endTime: "21:00" }
];

const TIME_SLOT_B = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:20", endTime: "12:05" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:25", endTime: "17:10" },
    { number: 8, startTime: "17:20", endTime: "18:05" },
    { number: 9, startTime: "19:20", endTime: "20:05" },
    { number: 10, startTime: "20:15", endTime: "21:00" }
];

// 08:20 起的楼栋组
const BUILDINGS_A = ["上茶苑教6栋", "上茶苑教8栋", "芭蕉苑教14栋", "芭蕉苑教16栋",
    "芭蕉苑教18栋", "芭蕉苑教20栋", "长芗苑教10栋", "长芗苑教12栋", "香樟苑教2栋", "香樟苑教4栋"];
// 08:00 起的楼栋组
const BUILDINGS_B = ["上茶苑教7栋", "上茶苑教9栋", "体育馆", "梧桐苑", "芭蕉苑教15栋",
    "芭蕉苑教17栋", "芭蕉苑教19栋", "芭蕉苑教21栋", "长芗苑教11栋", "长芗苑教13栋",
    "香樟苑教1栋", "香樟苑教3栋", "香樟苑教5栋"];

// 周次："16-17" / "2-6 9-12" / "18"，空格分隔多段
function parseWeeks(text) {
    const weeks = [];
    for (const part of String(text).trim().split(/\s+/)) {
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            for (let w = Number(range[1]); w <= Number(range[2]); w++) weeks.push(w);
        } else if (/^\d+$/.test(part)) {
            weeks.push(Number(part));
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 地点末尾的校区标记 (景艺) 在 title 里常缺右括号或多一个右括号，按实际形态归一
function normalizeRoom(room) {
    const text = String(room).trim();
    if (/\(景艺$/.test(text)) return text + ")";
    if (/\(景艺\)\)$/.test(text)) return text.slice(0, -1);
    return text;
}

// 解析单个课表格子，title 按分号切成「课程/周次地点」交替的 token
function parseCell(id, rowspan, title) {
    const matched = String(id).match(/^TD(\d+)_/);
    if (!matched) return [];
    const n = Number(matched[1]);
    const day = Math.floor(n / 10) + 1;
    const startSection = (n % 10) + 1;
    const endSection = startSection + (Number(rowspan) || 1) - 1;
    if (day > 7 || endSection > 10) return [];

    const courses = [];
    const tokens = String(title).split(";").map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].charAt(0) === "(") continue;
        const info = tokens[i + 1];
        if (!info || info.charAt(0) !== "(") continue;
        i++;

        const body = info.slice(1);
        const comma = body.indexOf(",");
        if (comma < 0) continue;
        const weeks = parseWeeks(body.slice(0, comma));
        if (weeks.length === 0) continue;

        const head = tokens[i - 1].match(/^(.+?)\(([^)]+)\)\s*\(([^)]*)\)/);
        courses.push({
            name: head ? head[1] : tokens[i - 1],
            teacher: head ? head[3] : "",
            position: normalizeRoom(body.slice(comma + 1)),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        });
    }
    return courses;
}

// 在当前文档与各级 frame 中查找课表
function findCourseTable(doc) {
    const table = doc.querySelector("#manualArrangeCourseTable");
    if (table) return table;
    for (const frame of doc.querySelectorAll("iframe,frame")) {
        try {
            const found = findCourseTable(frame.contentDocument);
            if (found) return found;
        } catch (e) {
            // 跨域 frame 取不到 contentDocument，跳过
        }
    }
    return null;
}

// 楼栋匹配作息组，未匹配（如实践场地）返回 null 用预设作息
function groupOfPosition(position) {
    for (const building of BUILDINGS_A) if (position.includes(building)) return TIME_SLOT_A;
    for (const building of BUILDINGS_B) if (position.includes(building)) return TIME_SLOT_B;
    return null;
}

// 按所在作息组写入自定义时间（两组作息仅少数节次不同）
function applyCustomTime(course, group) {
    const start = group.find(s => s.number === course.startSection);
    const end = group.find(s => s.number === course.endSection);
    if (!start || !end) return course;
    return { ...course, isCustomTime: true, customStartTime: start.startTime, customEndTime: end.endTime };
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请先在页面上切换到要导入的学期课表，再点击导入",
        "好的，开始导入");
    if (!confirmed) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

    const table = findCourseTable(document);
    if (!table) {
        window.shiguangBridge.showToast("导入失败：未找到课表，请确认已打开课表页面。");
        return;
    }

    const courses = [];
    for (const td of table.querySelectorAll('td[id^="TD"]')) {
        const title = td.getAttribute("title");
        if (!title) continue;
        courses.push(...parseCell(td.id, td.getAttribute("rowspan"), title));
    }
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程，请确认课表已加载。");
        return;
    }

    // 统计两组楼栋各覆盖多少课程：覆盖多的一组直接写入预设作息，
    // 少的一组课程按其楼栋时间写入自定义时间，数量相同时默认 08:00 组
    let countA = 0;
    let countB = 0;
    for (const course of courses) {
        const group = groupOfPosition(course.position);
        if (group === TIME_SLOT_A) countA++;
        else if (group === TIME_SLOT_B) countB++;
    }
    const majority = countA > countB ? TIME_SLOT_A : TIME_SLOT_B;

    const result = courses.map(course => {
        const group = groupOfPosition(course.position);
        return group && group !== majority ? applyCustomTime(course, group) : course;
    });
    result.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result));
    } catch (e) {
        window.shiguangBridge.showToast("课程保存失败: " + e.message);
        return;
    }
    try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(majority)); } catch (e) {}

    window.shiguangBridge.showToast("课程导入成功，共导入 " + result.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();