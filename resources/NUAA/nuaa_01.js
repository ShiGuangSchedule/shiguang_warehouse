// 南京航空航天大学(aao-eas.nuaa.edu.cn) 拾光课程表适配脚本
// 基于旧树维(TJAU)方案，调整 TaskActivity 参数位次与 13 节作息

const BASE = "https://aao-eas.nuaa.edu.cn/eams";

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        let char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== '\\')) {
            if (!inQuote) { inQuote = true; quoteChar = char; }
            else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
            if (char === '(' || char === '[' || char === '{') depth++;
            if (char === ')' || char === ']' || char === '}') depth--;
        }
        if (char === ',' && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current));
    return args;
}

function cleanArg(s) {
    s = s.trim();
    if (s === "null") return null;
    return s.replace(/^["']|["']$/g, "");
}

function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                campus: l.campus || "",
                day: l.day,
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        } else if (!groups[key].campus && l.campus) {
            groups[key].campus = l.campus;
        }
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });

    const merged = [];
    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;
        const blockMap = {};

        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            let start = sections[0];
            let prev = sections[0];
            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr;
                } else {
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    start = curr;
                    prev = curr;
                }
            }
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                campus: group.campus || "",
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey]
            });
        }
    }

    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

// 系统节次 5/6 为午一/午二，不导入课表
// 1-4 保持；7-13 映射为官方第五节至第十一节（应用内 5-11）
function mapSection(nuaaSection) {
    if (nuaaSection >= 1 && nuaaSection <= 4) return nuaaSection;
    if (nuaaSection >= 7 && nuaaSection <= 13) return nuaaSection - 2;
    return null;
}

// 南航 TaskActivity 相对天津农学院整体右移 1 位：
// args[3]=课程名, args[6]=地点, args[7]=周次位图
function parseTaskActivities(html) {
    const rawResults = [];
    const blocks = html.split(/var\s+teachers\s*=/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        let teacherName = "未知教师";
        const tMatch = block.match(/actTeachers\s*=\s*\[\s*\{[\s\S]*?name:\s*"(.*?)"/);
        if (tMatch) teacherName = tMatch[1];

        const activityMatch = block.match(/new\s+TaskActivity\(([\s\S]*?)\);/);
        if (!activityMatch) continue;

        const args = powerSplit(activityMatch[1]);
        const courseName = (args[3] || "未知课程").trim();
        const positionRaw = (args[6] || "").trim();
        const position = positionRaw.replace(/\(.*?\)/g, "").trim() || "未知地点";
        const campus = /天目湖/.test(positionRaw) ? "天目湖" : "";
        const weeksBitmap = args[7] || "";

        const weeks = [];
        for (let j = 0; j < weeksBitmap.length; j++) {
            if (weeksBitmap[j] === '1') weeks.push(j);
        }

        const unitCountMatch = html.match(/unitCount\s*=\s*(\d+)/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1]) : 13;

        const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+);/g;
        let m;
        while ((m = idxRegex.exec(block)) !== null) {
            const day = parseInt(m[1]) + 1;
            const section = mapSection(parseInt(m[2]) + 1);
            if (section === null) continue;
            rawResults.push({
                name: courseName,
                teacher: teacherName,
                position: position,
                campus: campus,
                day: day,
                startSection: section,
                endSection: section,
                weeks: weeks
            });
        }
    }

    return mergeContinuousLessons(rawResults);
}

async function request(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) throw new Error(`网络请求失败: ${res.status}`);
    return await res.text();
}

function extractDefaultSemesterId(html) {
    // 教务页当前加载的学期：hidden input 或 semesterCalendar 初始化 value
    const target = html.match(/id="semesterCalendar_target"[\s\S]*?value="(\d+)"/);
    if (target) return target[1];
    const cal = html.match(/semesterCalendar\(\{[^}]*value:"(\d+)"/);
    if (cal) return cal[1];
    return "";
}

async function detectParameters() {
    const html = await request(`${BASE}/courseTableForStd.action?sf_request_type=ajax`);
    const idsMatch = html.match(/bg\.form\.addInput\(form,\s*"ids",\s*"(\d+)"\)/);
    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    if (!idsMatch || !tagIdMatch) return null;
    return {
        ids: idsMatch[1],
        tagId: tagIdMatch[1],
        defaultSemesterId: extractDefaultSemesterId(html)
    };
}

async function getSelectedSemester(tagId, defaultSemesterId) {
    const raw = await request(`${BASE}/dataQuery.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar`
    });
    const data = Function(`return (${raw});`)();
    const list = [];
    for (let key in data.semesters) {
        data.semesters[key].forEach(s => list.push({
            id: String(s.id),
            name: `${s.schoolYear} ${s.name}学期`
        }));
    }
    if (list.length === 0) throw new Error("未解析到学期列表，请确认已登录教务系统");

    // 默认选中教务页当前加载的学期，而不是列表里的第一条
    let defaultIndex = 0;
    if (defaultSemesterId) {
        const found = list.findIndex(s => s.id === String(defaultSemesterId));
        if (found >= 0) defaultIndex = found;
    }

    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(list.map(s => s.name)),
        defaultIndex
    );
    return idx !== null ? list[idx] : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    const html = await request(`${BASE}/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `ignoreHead=1&setting.kind=std&semester.id=${semesterId}&ids=${ids}`
    });
    return parseTaskActivities(html);
}

// 官方校历 11 节作息，不含午一/午二
function getTimeSlots(campus) {
    const tianmuhu = [
        ["08:30", "09:20"], ["09:25", "10:15"], ["10:30", "11:20"], ["11:25", "12:15"],
        ["14:00", "14:50"], ["14:55", "15:45"], ["16:00", "16:50"], ["16:55", "17:45"],
        ["18:45", "19:35"], ["19:40", "20:30"], ["20:35", "21:25"]
    ];
    const other = [
        ["08:00", "08:50"], ["08:55", "09:45"], ["10:15", "11:05"], ["11:10", "12:00"],
        ["14:00", "14:50"], ["14:55", "15:45"], ["16:15", "17:05"], ["17:10", "18:00"],
        ["18:45", "19:35"], ["19:40", "20:30"], ["20:35", "21:25"]
    ];
    const pairs = campus === "天目湖" ? tianmuhu : other;
    return pairs.map((p, i) => ({
        number: i + 1,
        startTime: p[0],
        endTime: p[1]
    }));
}

function detectCampusFromCourses(courses) {
    if (!courses || courses.length === 0) return "";
    const first = courses.find(c => c.campus);
    return first ? first.campus : "";
}

async function applyTimeSlots(courses) {
    const campus = detectCampusFromCourses(courses) || "其他校区";
    const slots = getTimeSlots(campus === "天目湖" ? "天目湖" : "other");
    window.shiguangBridge.showToast(`按${campus || "默认"}作息导入时间段`);
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();
        if (!params) {
            window.shiguangBridge.showToast("无法识别当前页面，请先登录教务系统并进入课表页面");
            return;
        }

        const semester = await getSelectedSemester(params.tagId, params.defaultSemesterId);
        if (!semester) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        window.shiguangBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);
        if (!courses || courses.length === 0) {
            window.shiguangBridge.showToast("未解析到课程数据，可能是学期选择错误或尚未登录");
            return;
        }

        await applyTimeSlots(courses);
        const payload = courses.map(({ campus, ...rest }) => rest);
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(payload));

        if (saveResult) {
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error(`[异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();
