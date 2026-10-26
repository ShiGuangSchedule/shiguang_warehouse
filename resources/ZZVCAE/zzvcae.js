// 郑州汽车工程职业学院 (zzvcae.edu.cn) 拾光课程表适配脚本
// 平台：树维 EAMS 教务（与郑州航空工业管理学院 jwglxt.zua.edu.cn 同平台）
// 参考：郑州航院 zua.js（树维 EAMS Fetch 解析流程），针对本校 CAS 单点登录与作息做适配
//
// 使用说明：
//   1. 在 App 内本适配的入口地址会打开 CAS 统一身份认证登录页
//   2. 登录 CAS 成功后，进入【服务大厅】→【学生课表查询】，等待课表页面加载完成
//   3. 回到 App 点击【执行导入】即可
//   注意：教务系统禁止从 jw.zzvcae.edu.cn 直接登录，必须经由 CAS 登录并在服务大厅访问过一次课表，
//         这样 jw.zzvcae.edu.cn 域下才会建立有效的教务会话，脚本的接口请求才能成功。

const BASE_URL = "https://jw.zzvcae.edu.cn";
const MAX_SUPPORTED_WEEK = 60;

// 本校作息兜底（学校未发布公开作息表时使用；正常情况下脚本会优先从课表页动态解析作息）
// 这里暂按常见高职作息填写占位，实测后以教务系统课表页解析出的作息为准
const ZZQCC_TIME_SLOTS_FALLBACK = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        const char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== "\\")) {
            if (!inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inQuote = false;
            }
        }
        if (!inQuote) {
            if (char === "(" || char === "[" || char === "{") depth++;
            if (char === ")" || char === "]" || char === "}") depth--;
        }
        if (char === "," && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current));
    return args;
}

function cleanArg(value) {
    const trimmed = value.trim();
    if (trimmed === "null") return null;
    return trimmed.replace(/^["']|["']$/g, "");
}

function cleanCourseName(name) {
    return String(name || "未知课程")
        .replace(/<[^>]*>/g, "")           // 去掉教务页嵌入的 HTML 标签（如 <sup style='...'></sup> 颜色标记）
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/\([^()]*\)\s*$/, "")     // 去除尾部纯括号说明（如"（二）"）
        .trim();
}

function cleanPosition(position) {
    return String(position || "未知地点")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function parseWeeksBitmap(bitmap) {
    const weeks = [];
    const value = String(bitmap || "");
    // 树维 EAMS 位图的下标就是周次，下标 0 是占位符；拾光使用 1 基周次。
    for (let week = 1; week < value.length && week <= MAX_SUPPORTED_WEEK; week++) {
        if (value[week] === "1") weeks.push(week);
    }
    return weeks;
}

/**
 * 按周次矩阵合并算法：只有课程名、教师、地点和星期均相同
 * 且在同一周内节次连续时才合并。
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    const groups = {};
    lessons.forEach(lesson => {
        const key = `${lesson.name}|${lesson.teacher}|${lesson.position}|${lesson.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: lesson.name,
                teacher: lesson.teacher,
                position: lesson.position,
                day: lesson.day,
                weeksMatrix: Array.from({ length: MAX_SUPPORTED_WEEK + 1 }, () => new Set())
            };
        }

        if (Array.isArray(lesson.weeks)) {
            lesson.weeks.forEach(week => {
                if (Number.isInteger(week) && week > 0 && week <= MAX_SUPPORTED_WEEK) {
                    for (let section = lesson.startSection; section <= lesson.endSection; section++) {
                        groups[key].weeksMatrix[week].add(section);
                    }
                }
            });
        }
    });

    const merged = [];
    for (const key in groups) {
        const group = groups[key];
        const blockMap = {};

        for (let week = 1; week < group.weeksMatrix.length; week++) {
            const sections = Array.from(group.weeksMatrix[week]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            let start = sections[0];
            let previous = sections[0];
            for (let i = 1; i < sections.length; i++) {
                const current = sections[i];
                if (current === previous + 1) {
                    previous = current;
                } else {
                    const blockKey = `${start}-${previous}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(week);
                    start = current;
                    previous = current;
                }
            }

            const blockKey = `${start}-${previous}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(week);
        }

        for (const blockKey in blockMap) {
            const [startSection, endSection] = blockKey.split("-").map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection,
                endSection,
                weeks: blockMap[blockKey]
            });
        }
    }

    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return a.position.localeCompare(b.position);
    });
    return merged;
}

function parseTeacherName(block) {
    const teachersMatch = block.match(/actTeachers\s*=\s*\[([\s\S]*?)\]\s*;/);
    if (!teachersMatch) return "未知教师";

    const names = [];
    const nameRegex = /\bname\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = nameRegex.exec(teachersMatch[1])) !== null) {
        if (!names.includes(match[1])) names.push(match[1]);
    }
    return names.length > 0 ? names.join(",") : "未知教师";
}

function parseTaskActivities(html) {
    const rawResults = [];
    const unitCountMatch = html.match(/\bunitCount\s*=\s*(\d+)\s*;/);
    const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 14;
    const indexRegex = new RegExp(
        `index\\s*=\\s*(\\d+)\\s*\\*\\s*(?:unitCount|${unitCount})\\s*\\+\\s*(\\d+)\\s*;`,
        "g"
    );
    const blocks = html.split(/var\s+teachers\s*=/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const teacher = parseTeacherName(block);
        const activityRegex = /new\s+TaskActivity\(([\s\S]*?)\)\s*;/g;
        const activities = [];
        let activityMatch;
        while ((activityMatch = activityRegex.exec(block)) !== null) {
            activities.push({
                argsRaw: activityMatch[1],
                start: activityMatch.index,
                end: activityRegex.lastIndex
            });
        }

        for (let activityIndex = 0; activityIndex < activities.length; activityIndex++) {
            const activity = activities[activityIndex];
            const args = powerSplit(activity.argsRaw);
            if (args.length < 7) continue;

            const name = cleanCourseName(args[3]);
            const position = cleanPosition(args[5]);
            const weeks = parseWeeksBitmap(args[6]);
            if (weeks.length === 0) continue;

            const nextActivityStart = activityIndex + 1 < activities.length
                ? activities[activityIndex + 1].start
                : block.length;
            const activityScope = block.slice(activity.end, nextActivityStart);
            indexRegex.lastIndex = 0;
            let indexMatch;
            while ((indexMatch = indexRegex.exec(activityScope)) !== null) {
                const rawDay = parseInt(indexMatch[1], 10);
                const rawSection = parseInt(indexMatch[2], 10);
                if (rawDay < 0 || rawDay > 6 || rawSection < 0 || rawSection >= unitCount) continue;

                const day = rawDay + 1;
                const section = rawSection + 1;
                rawResults.push({
                    name,
                    teacher,
                    position,
                    day,
                    startSection: section,
                    endSection: section,
                    weeks: [...weeks]
                });
            }
        }
    }

    return mergeContinuousLessons(rawResults);
}

function parseParameters(html) {
    // 多种可能的 ids 表达方式
    const idsPatterns = [
        /bg\.form\.addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']\s*\)/,
        /["']ids["']\s*,\s*["'](\d+)["']/,
        /name=["']ids["'][^>]*value=["'](\d+)["']/i,
        /value=["'](\d+)["'][^>]*name=["']ids["']/i,
        /ids\s*=\s*["'](\d+)["']/
    ];
    let ids = null;
    for (const pattern of idsPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            ids = match[1];
            break;
        }
    }

    // 学期标签 id 匹配：优先 semesterBar\d+Semester，其次任意含 semester 的 id
    let tagIdMatch = html.match(/id=["'](semesterBar\d+Semester)["']/);
    if (!tagIdMatch) {
        tagIdMatch = html.match(/id=["']([^"']*[Ss]emester[^"']*)["']/);
    }
    if (!ids || !tagIdMatch) return null;

    const tagId = tagIdMatch[1];
    const escapedTagId = tagId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const elementMatch = html.match(new RegExp(`<[^>]*\\bid=["']${escapedTagId}["'][^>]*>`, "i"));
    const valueMatch = elementMatch ? elementMatch[0].match(/\bvalue=["'](\d+)["']/i) : null;

    return {
        ids,
        tagId,
        currentSemesterId: valueMatch ? valueMatch[1] : null
    };
}

/**
 * 从课表页 HTML 中动态解析作息时间（树维 EAMS 的节次表头为 th[id="0_节次"]，文本形如 "(08:00-08:45)"）
 */
function parseTimeSlotsFromHtml(html) {
    const timeSlots = [];
    const thRegex = /<th[^>]*id=["']0_(\d+)["'][^>]*>([\s\S]*?)<\/th>/gi;
    let match;
    while ((match = thRegex.exec(html)) !== null) {
        const number = parseInt(match[1], 10);
        const text = match[2].replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\u00a0/g, " ");
        const timeMatch = text.match(/(\d{1,2}:\d{2})\s*[-~至]\s*(\d{1,2}:\d{2})/);
        if (timeMatch && !isNaN(number)) {
            timeSlots.push({
                number,
                startTime: timeMatch[1].padStart(5, "0"),
                endTime: timeMatch[2].padStart(5, "0")
            });
        }
    }
    timeSlots.sort((a, b) => a.number - b.number);
    // 校验编号从 1 开始连续
    for (let i = 0; i < timeSlots.length; i++) {
        if (timeSlots[i].number !== i + 1) return [];
    }
    return timeSlots;
}

/**
 * 从学期对象中提取日期字段（兼容多种字段名与格式）
 */
function extractDateFromObj(obj, keys) {
    for (const k of keys) {
        const v = obj ? obj[k] : null;
        if (v !== null && v !== undefined && v !== "") {
            const m = String(v).match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
            if (m) {
                const d = normalizeNumericDate(m[1], m[2], m[3]);
                if (d) return d;
            }
        }
    }
    // 兜底：扫描对象所有字段值里是否含日期
    for (const k in obj || {}) {
        const v = obj[k];
        if (typeof v === "string") {
            const m = v.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
            if (m) {
                const d = normalizeNumericDate(m[1], m[2], m[3]);
                if (d) return d;
            }
        }
    }
    return null;
}

function parseSemesterResponse(raw) {
    const data = Function(`return (${raw});`)();
    const semesters = [];

    for (const key of Object.keys(data.semesters || {})) {
        const entries = Array.isArray(data.semesters[key]) ? data.semesters[key] : [];
        entries.forEach(semester => {
            if (semester && semester.id !== undefined) {
                const term = String(semester.name || "").trim();
                const label = /^第.*学期$/.test(term) ? term : `第${term}学期`;
                semesters.push({
                    id: String(semester.id),
                    schoolYear: String(semester.schoolYear || ""),
                    term,
                    name: `${semester.schoolYear} ${label}`.trim(),
                    startDate: extractDateFromObj(semester, ["startDate", "beginDate", "start", "startTime", "dateBegin"]),
                    endDate: extractDateFromObj(semester, ["endDate", "end", "endTime", "finishDate", "dateEnd"])
                });
            }
        });
    }

    semesters.sort((a, b) => {
        const yearCompare = b.schoolYear.localeCompare(a.schoolYear);
        if (yearCompare !== 0) return yearCompare;
        return b.term.localeCompare(a.term, undefined, { numeric: true });
    });

    return {
        semesters,
        currentSemesterId: data.semesterId === undefined ? null : String(data.semesterId)
    };
}

function normalizeNumericDate(year, month, day) {
    const yearNumber = Number(year);
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
    if (
        date.getUTCFullYear() !== yearNumber ||
        date.getUTCMonth() + 1 !== monthNumber ||
        date.getUTCDate() !== dayNumber
    ) {
        return null;
    }

    return [
        String(yearNumber).padStart(4, "0"),
        String(monthNumber).padStart(2, "0"),
        String(dayNumber).padStart(2, "0")
    ].join("-");
}

function parseCalendarInfo(html) {
    const text = String(html || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;|&#x0*A0;/gi, " ")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ");

    // 兼容多种表达：开始/结束日期、开始~结束、起止、YYYY-M-D / YYYY年M月D日 等
    const patterns = [
        /开始\s*\/\s*结束日期\s*[：:]?\s*(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})日?\s*[~—～至到]\s*(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})日?\s*\(?\s*(\d+)\s*周?\s*\)?/i,
        /开始\s*[：:]?\s*(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})日?\s*[~—～至到结束]?\s*(\d{4})?[-/年]?\s*(\d{1,2})?[-/月]?\s*(\d{1,2})?日?\s*[^0-9]{0,10}(\d+)\s*周?/i,
        /(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})日?\s*[~—～至到]\s*(\d{4})[-/年]\s*(\d{1,2})[-/月]\s*(\d{1,2})日?/
    ];
    let match = null;
    for (const pattern of patterns) {
        match = text.match(pattern);
        if (match) break;
    }
    if (!match) return null;

    // 计算总周数：优先取显式数字，否则按起止日期估算
    let semesterTotalWeeks = null;
    const explicitWeeks = match[7] ? Number(match[7]) : NaN;
    if (Number.isInteger(explicitWeeks) && explicitWeeks >= 1 && explicitWeeks <= MAX_SUPPORTED_WEEK) {
        semesterTotalWeeks = explicitWeeks;
    }

    const semesterStartDate = normalizeNumericDate(match[1], match[2], match[3]);
    if (!semesterStartDate) return null;

    // 结束日期用于估算周数（可选）
    let semesterEndDate = null;
    if (match[4] && match[5] && match[6]) {
        semesterEndDate = normalizeNumericDate(match[4], match[5], match[6]);
    }

    if (!semesterTotalWeeks && semesterEndDate && semesterEndDate >= semesterStartDate) {
        const days = Math.round((new Date(semesterEndDate) - new Date(semesterStartDate)) / 86400000) + 1;
        const estimated = Math.round(days / 7);
        if (estimated >= 1 && estimated <= MAX_SUPPORTED_WEEK) semesterTotalWeeks = estimated;
    }
    if (!semesterTotalWeeks) return null;

    return {
        semesterStartDate,
        semesterEndDate,
        semesterTotalWeeks,
        firstDayOfWeek: 1
    };
}

async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "include", ...options });
    if (!response.ok) throw new Error(`网络请求失败: ${response.status}`);
    return await response.text();
}

async function detectParameters() {
    const html = await request(`${BASE_URL}/eams/courseTableForStd.action`);
    const params = parseParameters(html);
    if (!params) {
        console.warn("[参数识别失败] 未能从课表页识别 ids 与 semesterBar");
        throw new Error("未能识别教务参数，请确认已通过服务大厅登录并访问过课表页");
    }
    return params;
}

async function getSelectedSemester(tagId, currentSemesterId) {
    const form = new URLSearchParams();
    form.set("tagId", tagId);
    form.set("dataType", "semesterCalendar");
    if (currentSemesterId) form.set("value", currentSemesterId);
    form.set("empty", "false");

    const raw = await request(`${BASE_URL}/eams/dataQuery.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: form.toString()
    });
    const parsed = parseSemesterResponse(raw);
    if (parsed.semesters.length === 0) throw new Error("未获取到可选学期");

    const selectedId = currentSemesterId || parsed.currentSemesterId;
    const defaultIndex = parsed.semesters.findIndex(semester => semester.id === selectedId);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(parsed.semesters.map(semester => semester.name)),
        defaultIndex
    );
    return Number.isInteger(index) && index >= 0 && index < parsed.semesters.length
        ? parsed.semesters[index]
        : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    const form = new URLSearchParams();
    form.set("ignoreHead", "1");
    form.set("setting.kind", "std");
    form.set("startWeek", "");
    form.set("semester.id", String(semesterId));
    form.set("ids", String(ids));

    const html = await request(`${BASE_URL}/eams/courseTableForStd!courseTable.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: form.toString()
    });
    // 如果返回了登录页，说明教务会话未建立
    if (/loginExt|登录/i.test(html) && !html.includes("courseTableForStd") && html.length < 30000) {
        throw new Error("教务会话未建立（请求被重定向到登录页），请先在服务大厅打开过课表页面");
    }
    return parseTaskActivities(html);
}

async function fetchCalendarInfo(semesterId) {
    const form = new URLSearchParams();
    form.set("version", "1");
    form.set("semesterId", String(semesterId));

    const html = await request(`${BASE_URL}/eams/base/calendar-info.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: form.toString()
    });
    const calendarInfo = parseCalendarInfo(html);
    if (!calendarInfo) {
        const cleaned = String(html || "")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;|&#160;/gi, " ")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ").trim();
        console.warn(`[学期日历] 未能解析学期日历，原文(清理后前400字): ${cleaned.slice(0, 400)}`);
        throw new Error("未能解析学期日历");
    }
    return calendarInfo;
}

/**
 * 获取作息时间：优先从课表页 HTML 动态解析，失败则使用兜底作息
 */
async function fetchTimeSlots() {
    try {
        const html = await request(`${BASE_URL}/eams/courseTableForStd.action`);
        const parsed = parseTimeSlotsFromHtml(html);
        if (parsed && parsed.length > 0) {
            console.log(`[作息] 已从课表页解析出 ${parsed.length} 个节次时间段`);
            return parsed;
        }
    } catch (error) {
        console.warn(`[作息] 课表页解析失败，使用兜底作息: ${error.message}`);
    }
    console.log(`[作息] 使用兜底作息（${ZZQCC_TIME_SLOTS_FALLBACK.length} 个节次）`);
    return ZZQCC_TIME_SLOTS_FALLBACK.map(slot => ({ ...slot }));
}

async function trySaveCalendarInfo(semesterId) {
    try {
        const calendarInfo = await fetchCalendarInfo(semesterId);
        const saveResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: calendarInfo.semesterStartDate,
            semesterTotalWeeks: calendarInfo.semesterTotalWeeks,
            firstDayOfWeek: calendarInfo.firstDayOfWeek
        }));
        return saveResult === true;
    } catch (error) {
        console.warn(`[学期信息设置失败] ${error.message}`);
        return false;
    }
}

async function trySaveTimeSlots() {
    try {
        const timeSlots = await fetchTimeSlots();
        const saveResult = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return saveResult === true;
    } catch (error) {
        console.warn(`[作息时间设置失败] ${error.message}`);
        return false;
    }
}

function buildCompletionMessage(calendarSaved, timeSlotsSaved) {
    if (calendarSaved && timeSlotsSaved) return "成功导入课表、学期信息和本校作息";
    if (!calendarSaved && !timeSlotsSaved) {
        return "课表已导入，学期日期和作息时间设置失败，请在设置中确认";
    }
    if (!calendarSaved) return "课表已导入，学期日期获取失败，请在设置中确认";
    return "课表已导入，作息时间设置失败，请在设置中确认";
}

/**
 * 从选中学期的数据中保存学期配置（开始日期 + 总周数=课表最大周次），失败返回 false
 */
async function trySaveSemesterConfig(semester, courses) {
    try {
        const startDate = semester && semester.startDate;
        if (!startDate) {
            console.warn("[学期配置] 学期数据中未找到开始日期，改用 calendar-info 兜底");
            return false;
        }
        let maxWeek = 0;
        (courses || []).forEach(course => {
            (course.weeks || []).forEach(w => {
                if (Number.isInteger(w) && w > maxWeek) maxWeek = w;
            });
        });
        const totalWeeks = maxWeek >= 1 ? maxWeek : 20;
        const config = { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek: 1 };
        console.log(`[学期配置] 保存: ${JSON.stringify(config)}`);
        const saveResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return saveResult === true;
    } catch (error) {
        console.warn(`[学期配置] 保存失败: ${error.message}`);
        return false;
    }
}

/**
 * 日期输入校验函数（供 showPrompt 使用）
 */
function validateDateInput(input) {
    const m = String(input || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return "请输入 YYYY-MM-DD 格式（如 2026-09-07）";
    const d = normalizeNumericDate(m[1], m[2], m[3]);
    if (!d) return "日期无效，请检查月份和日期";
    return false;
}

/**
 * 最终兜底：让用户输入本学期开学日期，并保存学期配置
 */
async function promptSemesterStartDate(courses) {
    try {
        const input = await window.shiguangBridgePromise.showPrompt(
            "设置本学期开学日期",
            "未能自动获取学期日期，请输入本学期开学日期（格式 YYYY-MM-DD，例如 2026-09-07）",
            "2026-09-07",
            "validateDateInput"
        );
        if (!input) {
            window.shiguangBridge.showToast("已跳过开学日期设置");
            return false;
        }
        const m = String(input).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) return false;
        const startDate = normalizeNumericDate(m[1], m[2], m[3]);
        if (!startDate) return false;

        let maxWeek = 0;
        (courses || []).forEach(course => {
            (course.weeks || []).forEach(w => {
                if (Number.isInteger(w) && w > maxWeek) maxWeek = w;
            });
        });
        const totalWeeks = maxWeek >= 1 ? maxWeek : 20;
        const config = { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek: 1 };
        console.log(`[学期配置] 用户输入开学日期保存: ${JSON.stringify(config)}`);
        const saveResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return saveResult === true;
    } catch (error) {
        console.warn(`[学期配置] 用户输入保存失败: ${error.message}`);
        return false;
    }
}

async function runImportFlow() {
    try {
        const alertConfirmed = await window.shiguangBridgePromise.showAlert(
            "郑州汽车工程职业学院课表导入",
            "请确认已完成以下步骤：\n1. 已在页面上通过统一身份认证（CAS）登录\n2. 已从【服务大厅】→【学生课表查询】打开过课表页面\n3. 当前页面处于 jw.zzvcae.edu.cn 域下\n\n确认后开始同步课表。",
            "开始同步"
        );
        if (!alertConfirmed) return;

        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();
        if (!params) throw new Error("未能识别教务参数，请确认已通过服务大厅登录并访问过课表页");

        const semester = await getSelectedSemester(params.tagId, params.currentSemesterId);
        if (!semester) return;

        window.shiguangBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);
        if (!courses || courses.length === 0) {
            console.warn("[课程解析] TaskActivity 解析结果为空，请检查上方[诊断]输出中的 TaskActivity/var teachers 标记");
            throw new Error("未解析到课程数据（请把控制台[诊断]信息反馈给开发者）");
        }

        console.log(`[课程解析] 成功解析 ${courses.length} 门课程时段`);
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saveResult) throw new Error("课程保存失败");

        // 学期配置：优先学期数据 → calendar-info 兜底 → 用户手动输入兜底
        let calendarSaved = await trySaveSemesterConfig(semester, courses);
        if (!calendarSaved) {
            calendarSaved = await trySaveCalendarInfo(semester.id);
        }
        if (!calendarSaved) {
            calendarSaved = await promptSemesterStartDate(courses);
        }
        const timeSlotsSaved = await trySaveTimeSlots();
        window.shiguangBridge.showToast(buildCompletionMessage(calendarSaved, timeSlotsSaved));
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error(`[郑州汽车工程职业学院课表导入异常] ${error && error.stack ? error.stack : error}`);
        try {
            await window.shiguangBridgePromise.showAlert("导入失败", error.message, "知道了");
        } catch (dialogError) {
            window.shiguangBridge.showToast(`导入失败: ${error.message}`);
        }
    }
}

runImportFlow();
