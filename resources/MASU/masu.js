// 马鞍山学院教务系统（jwxt.masu.edu.cn）拾光课表导入适配脚本
// 青果/URP 金刚教务：课表渲染后直接解析 #manualArrangeCourseTable 表格，
// 课程文本格式：课程名(序号) (教师) (周次,教室)，一个单元格可能含多门课

// 预设作息时间（该校实际 11 节）
const MASU_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:10", endTime: "09:55" },
    { number: 3, startTime: "10:15", endTime: "11:00" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "13:50", endTime: "14:35" },
    { number: 6, startTime: "14:40", endTime: "15:25" },
    { number: 7, startTime: "15:45", endTime: "16:30" },
    { number: 8, startTime: "16:35", endTime: "17:20" },
    { number: 9, startTime: "18:20", endTime: "19:05" },
    { number: 10, startTime: "19:10", endTime: "19:55" },
    { number: 11, startTime: "20:00", endTime: "20:45" }
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

// 从课表页 HTML 提取当前学期 id（semesterCalendar 配置中的 value:"403"），仅用于日志
function extractCurrentSemesterId() {
    const html = document.documentElement.outerHTML;
    const m = html.match(/value:"(\d+)"/);
    return m ? m[1] : null;
}

// 去掉课程名末尾的序号括号："形势与政策1(202620271.11202001.002)" → "形势与政策1"
function cleanCourseName(name) {
    return String(name || "").replace(/[（(][^（()）]*[)）]\s*$/, "").trim();
}

// 解析周次文本：支持 "2-5"、"双周2-6、10"、"2-3、6-7、9-14"、"6-7、9-11、13、16" 等
function parseWeeksText(weekStr) {
    let isOdd = false;
    let isEven = false;
    let s = String(weekStr || "").trim();
    if (s.includes("双周") || s.startsWith("双")) isEven = true;
    if (s.includes("单周") || s.startsWith("单")) isOdd = true;
    s = s.replace(/单周|双周|[单双]|第/g, "").replace(/周/g, "");

    const weeks = new Set();
    s.split(/[、,，;；]/).forEach(part => {
        part = part.trim();
        if (!part) return;
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            for (let i = start; i <= end; i++) {
                if (isEven && i % 2 !== 0) continue;
                if (isOdd && i % 2 === 0) continue;
                weeks.add(i);
            }
        } else if (/^\d+$/.test(part)) {
            const n = Number(part);
            if (isEven && n % 2 !== 0) return;
            if (isOdd && n % 2 === 0) return;
            weeks.add(n);
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

// 解析单元格文本中的单门课
// 文本格式：课程名(序号) (教师) (周次,教室)，教室可能含括号如 数智楼(3号实验楼)309
const COURSE_RE = /([^\s()]+)\([^()]*\)\s*\(([^()]*)\)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

function parseCourseText(text, day, startSection, endSection, courses) {
    let m;
    COURSE_RE.lastIndex = 0;
    while ((m = COURSE_RE.exec(text)) !== null) {
        const name = cleanCourseName(m[1]);
        const teacher = String(m[2] || "").trim();
        const weeksRoom = m[3];
        if (!name || !weeksRoom) continue;

        // 周次段 "周次,教室"：按第一个逗号切分（教室可能含括号但无逗号）
        const commaIdx = weeksRoom.indexOf(",");
        if (commaIdx === -1) continue;
        const weeksStr = weeksRoom.slice(0, commaIdx).trim();
        const room = weeksRoom.slice(commaIdx + 1).trim();
        const weeks = parseWeeksText(weeksStr);
        if (weeks.length === 0) continue;

        courses.push({
            name,
            teacher: teacher || "未知",
            position: room || "待定",
            day,
            startSection,
            endSection,
            weeks
        });
    }
}

// 从渲染后的课表表格解析全部课程
function parseCourseTableFromDom() {
    const table = document.querySelector("#manualArrangeCourseTable");
    if (!table) return null;

    const unitCount = 11; // 该校 11 节课
    const courses = [];
    const seen = new Set();

    table.querySelectorAll("td[id^='TD']").forEach(td => {
        const idMatch = td.id.match(/^TD(\d+)_/);
        if (!idMatch) return;
        const n = Number(idMatch[1]);
        const day = Math.floor(n / unitCount) + 1;
        const startSection = (n % unitCount) + 1;
        const rowspan = Number(td.getAttribute("rowspan")) || 1;
        const endSection = startSection + rowspan - 1;

        const text = (td.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return;

        parseCourseText(text, day, startSection, endSection, courses);
    });

    // 去重（同一课名/星期/节次/教师/教室可能重复出现）
    const deduped = courses.filter(c => {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.teacher}|${c.position}|${c.weeks.join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return deduped.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
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
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已登录教务系统，建议在课表页面进行导入",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在解析课表...");
    try {
        const semesterId = extractCurrentSemesterId();
        const courses = parseCourseTableFromDom();
        if (!courses || courses.length === 0) throw new Error("未在课表页面检测到有效课程，请确认课表已加载。");

        console.log(`JS: 当前学期 ${semesterId || "未知"}，解析到 ${courses.length} 条课程`);
        window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

        await saveTimeSlots(MASU_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error:", error);
    }
}

runImportFlow();
