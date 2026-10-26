// 西安工业大学(http://jwgl2018.xatu.edu.cn) 拾光课程表适配脚本，基于天津农学院适配脚本
// 本校开发者适配，出现问题请提issues或者提交pr更改,这更加快速
//感谢XingHeYuZhuan、aryunm、jursin...等的帮助，感谢trae的辅助

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
    return s.replace(/^["']|["']$/g, "");
}

/** 按课程、教师、地点和星期合并连续节次，保持原有50周范围。 */
function mergeContinuousLessons(lessons) {
    const groups = new Map();
    for (const lesson of lessons) {
        const key = JSON.stringify([lesson.courseSequence, lesson.name, lesson.teacher, lesson.position, lesson.day]);
        if (!groups.has(key)) groups.set(key, { lesson, weeks: Array.from({ length: 50 }, () => new Set()) });
        const { weeks } = groups.get(key);
        for (const week of lesson.weeks) {
            if (week >= 50) continue;
            for (let section = lesson.startSection; section <= lesson.endSection; section++) weeks[week].add(section);
        }
    }
    const courses = [];
    for (const { lesson, weeks } of groups.values()) {
        const blocks = new Map();
        weeks.forEach((sections, week) => {
            const sorted = [...sections].sort((a, b) => a - b);
            for (let i = 0; i < sorted.length; i++) {
                const start = sorted[i];
                while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
                const key = `${start}-${sorted[i]}`;
                if (!blocks.has(key)) blocks.set(key, []);
                blocks.get(key).push(week);
            }
        });
        for (const [key, courseWeeks] of blocks) {
            const [startSection, endSection] = key.split('-').map(Number);
            courses.push({
                name: lesson.courseSequence ? `${lesson.name} | ${lesson.courseSequence}` : lesson.name,
                teacher: lesson.teacher, position: lesson.position, day: lesson.day,
                startSection, endSection, weeks: courseWeeks,
                credit: lesson.credit,
                ...(/教3/.test(lesson.position) && startSection === 3 && endSection === 4 ? {
                    isCustomTime: true, customStartTime: "10:10", customEndTime: "11:40"
                } : {})
            });
        }
    }
    return courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
}

/** 从同一课表响应的课程列表中读取学分，按课程序号匹配，避免同名课程混淆。 */
function parseCourseCredits(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const credits = new Map();
    for (const table of doc.querySelectorAll("table")) {
        const header = Array.from(table.rows).find(row =>
            Array.from(row.cells).some(cell => cell.tagName === "TH" && cell.textContent.trim() === "学分"));
        if (!header) continue;
        const headers = Array.from(header.cells).map(cell => cell.textContent.trim());
        const creditIndex = headers.indexOf("学分");
        const sequenceIndex = headers.indexOf("课程序号");
        if (sequenceIndex < 0) continue;
        for (const row of table.rows) {
            const sequence = row.cells[sequenceIndex]?.textContent.trim();
            const text = row.cells[creditIndex]?.textContent.trim();
            if (!sequence || !/^\d+(?:\.\d+)?$/.test(text)) continue;
            credits.set(sequence, Number(text));
        }
    }
    return credits;
}

function parseTaskActivities(html) {
    const credits = parseCourseCredits(html);
    const lessons = [];
    for (const block of html.split(/var\s+teachers\s*=/).slice(1)) {
        const activities = [...block.matchAll(/new\s+TaskActivity\(([\s\S]*?)\);/g)];
        let teacher = "未知教师";
        for (let i = 0; i < activities.length; i++) {
            const activity = activities[i];
            const before = block.slice(i ? activities[i - 1].index + activities[i - 1][0].length : 0, activity.index);
            const teachers = before.match(/actTeachers\s*=\s*(\[[\s\S]*?\])/);
            if (teachers) {
                teacher = [...teachers[1].matchAll(/name\s*:\s*["'](.*?)["']/g)].map(m => m[1]).join("、") || "未知教师";
            }
            const args = powerSplit(activity[1]);
            const courseSequence = (args[2] || "").match(/\(([^()]*)\)$/)?.[1] || "";
            const credit = credits.get(courseSequence);
            const position = (args[5] || "未知地点").replace(/\(.*?\)/g, "");
            const weeks = [...(args[6] || "")].flatMap((bit, week) => bit === "1" ? [week] : []);
            const indexes = block.slice(activity.index + activity[0].length, activities[i + 1]?.index)
                .matchAll(/index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+);/g);
            for (const index of indexes) {
                lessons.push({
                    name: (args[3] || "未知课程").split('(')[0], courseSequence,
                    teacher, position, day: Number(index[1]) + 1,
                    startSection: Number(index[2]) + 1, endSection: Number(index[2]) + 1,
                    weeks, credit
                });
            }
        }
    }
    return mergeContinuousLessons(lessons);
}

async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(`http://jwgl2018.xatu.edu.cn/eams/${path}`, {
            credentials: "include", signal: controller.signal,
            ...(body !== undefined ? {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
            } : {})
        });
        if (!res.ok) throw new Error(`教务请求失败：HTTP ${res.status}`);
        const html = await res.text();
        return { html, serverTime: Date.parse(res.headers.get("Date") || "") };
    } catch (e) {
        if (controller.signal.aborted) throw new Error("教务请求超时，请稍后重试");
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/** 根据教务首页的当前教学周，推算第一教学周的周一（北京时间）。 */
function inferCurrentSemester(html, referenceTime) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const label = Array.from(doc.querySelectorAll("strong"))
        .find(el => el.textContent.trim() === "当前教学周");
    const weekText = label?.parentElement?.querySelector("span")?.textContent.trim();
    const totalMatch = label?.parentElement?.querySelector("i")?.textContent.match(/\/\s*(\d+)/);
    if (!weekText || !/^\d+$/.test(weekText) || !totalMatch) return null;

    const week = Number(weekText);
    const totalWeeks = Number(totalMatch[1]);
    if (week < 1 || week > totalWeeks || totalWeeks > 53) return null;

    // 固定按教务的 UTC+8 日期计算第一周周一。
    const start = new Date(referenceTime + 8 * 3600000);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 - (week - 1) * 7);

    const isAutumn = start.getUTCMonth() >= 6;
    const year = start.getUTCFullYear() - (isAutumn ? 0 : 1);
    return {
        schoolYear: `${year}-${year + 1}`, term: isAutumn ? "1" : "2",
        semesterStartDate: start.toISOString().slice(0, 10),
        semesterTotalWeeks: totalWeeks
    };
}

async function getCurrentSemesterConfig() {
    try {
        const { html, serverTime } = await request("homeExt!main.action?sf_request_type=ajax");
        const current = inferCurrentSemester(html, Number.isFinite(serverTime) ? serverTime : Date.now());
        if (!current) throw new Error("未能识别当前教学周");
        return current;
    } catch (e) {
        console.warn(`[开学日期推算] ${e.message}`);
        window.shiguangBridge.showToast(`${e.message}；开学日期请手动设置`);
        return null;
    }
}

async function detectParameters() {
    const { html } = await request("courseTableForStd.action?sf_request_type=ajax");
    const idsMatch = html.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    if (!idsMatch || !tagIdMatch) return null;
    return { ids: idsMatch[1], tagId: tagIdMatch[1] };
}

async function getSelectedSemester({ tagId }, current) {
    const { html } = await request("dataQuery.action?sf_request_type=ajax",
        `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar`);
    const data = Function(`return (${html});`)();
    const list = Object.values(data.semesters).flat().map(s => ({
        id: s.id, name: `${s.schoolYear}学年 ${String(s.name) === "1" ? "秋季" : "春季"}学期`,
        isCurrent: s.schoolYear === current?.schoolYear && String(s.name) === current?.term
    }));
    const currentIndex = list.findIndex(s => s.isCurrent);
    const idx = await window.shiguangBridgePromise.showSingleSelection("选择学期",
        JSON.stringify(list.map(s => s.name + (s.isCurrent ? "（当前学期）" : ""))),
        currentIndex);
    return idx === null ? null : list[idx];
}

async function fetchAndParseCourses(semesterId, ids) {
    const { html } = await request("courseTableForStd!courseTable.action?sf_request_type=ajax",
        `ignoreHead=1&setting.kind=std&semester.id=${encodeURIComponent(semesterId)}&ids=${encodeURIComponent(ids)}`);
    return parseTaskActivities(html);
}

async function applyTimeSlots() {
    const slots = [
        ["08:20", "09:05"], ["09:15", "10:00"],
        ["10:20", "11:05"], ["11:15", "12:00"],
        ["14:00", "14:45"], ["14:55", "15:40"],
        ["16:00", "16:45"], ["16:55", "17:40"],
        ["18:10", "18:55"], ["19:05", "19:50"],
        ["20:00", "20:45"], ["20:55", "21:40"]
    ].map(([startTime, endTime], i) => ({ number: i + 1, startTime, endTime }));
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();
        if (!params) throw new Error("未能识别教务参数，请确认已登录");

        const current = await getCurrentSemesterConfig();
        const semester = await getSelectedSemester(params, current);
        if (!semester) return; 

        window.shiguangBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);
        
        if (!courses.length) throw new Error("未解析到课程数据");

        if (current && !semester.isCurrent) window.shiguangBridge.showToast("历史或其他学期开学日期请手动设置");
        if (!await applyTimeSlots()) {
            console.error("作息时间保存失败，导入未完成");
            return;
        }
        if (semester.isCurrent && !await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: current.semesterStartDate,
            semesterTotalWeeks: current.semesterTotalWeeks
        }))) {
            throw new Error("学期配置保存失败，导入未完成");
        }
        if (!await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses))) {
            throw new Error("课程保存失败，导入未完成");
        }
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        console.error(`[异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();
