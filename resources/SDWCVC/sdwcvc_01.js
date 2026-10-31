// 山东水利职业学院树维 EAMS 拾光适配脚本
// 适配作者：小漫君
// 参数拆分、周次位图、逐周合并与日期校验复用拾光 ZUA/zua.js（沿用 HFNU/hfnu.js 的 EAMS 实现）。
// TaskActivity 解析参考以上实现；教学周历英文日期格式参考 HIIT/hiit_01.js。
// 上游：https://github.com/ShiGuangSchedule/shiguang_warehouse/tree/pending/resources
// 按上游 MIT 许可保留来源；账号、学生参数、学期和开学日期均不写死。

const BASE_URL = 'https://jw.sdwcvc.edu.cn';
const MAX_SUPPORTED_WEEK = 60;

// 来源：学校官网“作息时间”公布的统一作息（第 1～10 节）。
// https://www.sdwcvc.edu.cn/ggfw/zxsj.htm
const SDWCVC_TIME_SLOTS = [
    { number: 1, startTime: '08:15', endTime: '09:00' },
    { number: 2, startTime: '09:10', endTime: '09:55' },
    { number: 3, startTime: '10:10', endTime: '10:55' },
    { number: 4, startTime: '11:05', endTime: '11:50' },
    { number: 5, startTime: '14:30', endTime: '15:15' },
    { number: 6, startTime: '15:25', endTime: '16:10' },
    { number: 7, startTime: '16:20', endTime: '17:05' },
    { number: 8, startTime: '17:15', endTime: '18:00' },
    { number: 9, startTime: '19:30', endTime: '20:15' },
    { number: 10, startTime: '20:25', endTime: '21:10' }
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
 * 沿用 HFNU 的按周次矩阵合并算法：只有课程名、教师、地点和星期均相同
 * 且在同一周内节次连续时才合并。remark 不参与分组，重复实验项会由 Set 去重。
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


function parseParameters(html) {
    const student = html.match(/bg\.form\.addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']\s*\)/);
    const semester = html.match(/\bentityId\s*:\s*["'](\d+)["']/);
    if (!student || !semester) throw new Error('未识别到教务课表参数，请先登录并进入“教务系统”。');
    return { ids: student[1], semesterId: semester[1] };
}

function parseSemesters(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const semesters = Array.from(doc.querySelectorAll('option')).map(function (option) {
        const id = option.value.trim();
        const name = option.textContent.trim();
        if (!/^\d+$/.test(id) || !/^\d{4}-\d{4}-\d+$/.test(name)) throw new Error('学期列表格式不匹配。');
        return { id, name };
    });
    if (semesters.length === 0) throw new Error('未获取到可选学期。');
    return semesters;
}

function parseTeacherName(block) {
    const teachers = block.match(/actTeachers\s*=\s*\[([\s\S]*?)\]\s*;/);
    if (!teachers) throw new Error('课程教师字段结构不匹配。');
    const names = Array.from(teachers[1].matchAll(/\bname\s*:\s*"([^"]*)"/g), function (match) { return match[1]; });
    if (teachers[1].trim() && names.length === 0) throw new Error('课程教师字段结构不匹配。');
    return Array.from(new Set(names)).join(',');
}

function parseTaskActivities(html) {
    const unitCountMatch = html.match(/\bunitCount\s*=\s*(\d+)\s*;/);
    if (!unitCountMatch || Number(unitCountMatch[1]) < 1) throw new Error('未获取到有效节次定义。');
    const unitCount = Number(unitCountMatch[1]);
    const indexRegex = new RegExp('index\\s*=\\s*(\\d+)\\s*\\*\\s*unitCount\\s*\\+\\s*(\\d+)\\s*;', 'g');
    const rawResults = [];
    const blocks = html.split(/var\s+teachers\s*=/);
    const expectedCount = (html.match(/new\s+TaskActivity\(/g) || []).length;
    let parsedCount = 0;

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const teacher = parseTeacherName(block);
        const activities = Array.from(block.matchAll(/new\s+TaskActivity\(([\s\S]*?)\)\s*;/g));
        for (let j = 0; j < activities.length; j++) {
            parsedCount++;
            const activity = activities[j];
            const args = powerSplit(activity[1]);
            if (args.length < 7 || typeof args[3] !== 'string' || typeof args[5] !== 'string' || !/^[01]+$/.test(args[6])) {
                throw new Error('课程活动字段结构不匹配。');
            }
            // EAMS 的课程显示名在名称后附加 <sup ...>...</sup>，保留名称中的罗马数字等正文。
            const name = args[3].replace(/\([^()]*\)\s*$/, '')
                .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>\s*$/i, '').trim();
            const position = args[5].trim();
            if (!name || args[6].length > MAX_SUPPORTED_WEEK + 1) throw new Error('课程名称或周次位图无效。');
            const weeks = parseWeeksBitmap(args[6]);
            // 全零位图没有实际教学周，不生成课程。
            if (weeks.length === 0) continue;
            const end = j + 1 < activities.length ? activities[j + 1].index : block.length;
            const scope = block.slice(activity.index + activity[0].length, end);
            indexRegex.lastIndex = 0;
            let match;
            let sectionCount = 0;
            while ((match = indexRegex.exec(scope)) !== null) {
                const day = Number(match[1]) + 1;
                const section = Number(match[2]) + 1;
                if (day < 1 || day > 7 || section < 1 || section > unitCount) throw new Error('课程星期或节次超出教务定义。');
                rawResults.push({ name, teacher, position, day, startSection: section, endSection: section, weeks: [...weeks] });
                sectionCount++;
            }
            if (sectionCount === 0) throw new Error('课程活动缺少实际上课节次。');
        }
    }
    if (parsedCount !== expectedCount) throw new Error('课程活动结构不匹配。');
    return mergeContinuousLessons(rawResults);
}

function parseCalendarInfo(html, semesterName) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const termCell = Array.from(doc.querySelectorAll('td')).find(function (cell) {
        return /学年度\s*\/\s*学期/.test(cell.textContent);
    });
    if (termCell?.nextElementSibling?.textContent.trim().replace(/\s+/g, '-') !== semesterName) {
        throw new Error('返回校历与所选学期不一致。');
    }
    const text = doc.body.textContent;
    const match = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s*~\s*([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s*\((\d+)\)/);
    if (!match) throw new Error('未识别到教学周历起止日期。');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startDate = normalizeNumericDate(match[3], months.indexOf(match[1]) + 1, match[2]);
    const endDate = normalizeNumericDate(match[6], months.indexOf(match[4]) + 1, match[5]);
    const totalWeeks = Number(match[7]);
    if (!startDate || !endDate || endDate < startDate || totalWeeks < 1 || totalWeeks > MAX_SUPPORTED_WEEK ||
        new Date(startDate + 'T00:00:00Z').getUTCDay() !== 1) {
        throw new Error('教学周历日期或总周数无效。');
    }
    return { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek: 1, defaultClassDuration: 45, defaultBreakDuration: 10 };
}

async function requestText(path, parameters) {
    const options = { credentials: 'include' };
    if (parameters !== undefined) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
        options.body = new URLSearchParams(parameters).toString();
    }
    const response = await fetch(BASE_URL + path, options);
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）。');
    const responseUrl = new URL(response.url);
    if (responseUrl.origin === BASE_URL && responseUrl.pathname === '/eams/loginExt.action') {
        throw new Error('教务接口返回了登录页，请从统一认证门户重新打开“教务系统”后导入。');
    }
    return response.text();
}

async function runImportFlow() {
    try {
        if (window.location.origin !== BASE_URL) {
            await window.shiguangBridgePromise.showAlert('请进入教务系统', '请先登录统一认证，并在门户中打开“教务系统”后导入。', '知道了');
            return;
        }
        window.shiguangBridge.showToast('正在读取学期信息…');
        const parameters = parseParameters(await requestText('/eams/courseTableForStd.action'));
        const semesters = parseSemesters(await requestText('/eams/dataQuery.action', {
            dataType: 'semester', entityId: parameters.semesterId
        }));
        const currentSemesterIndex = semesters.findIndex(function (semester) { return semester.id === parameters.semesterId; });
        if (currentSemesterIndex < 0) throw new Error('学期列表缺少教务当前学期。');
        const picked = await window.shiguangBridgePromise.showSingleSelection(
            '选择学期', JSON.stringify(semesters.map(function (semester) { return semester.name; })),
            currentSemesterIndex
        );
        if (picked === null) return;
        if (!Number.isInteger(picked) || picked < 0 || picked >= semesters.length) throw new Error('学期选择无效。');
        const semester = semesters[picked];
        window.shiguangBridge.showToast('正在获取整学期课表…');
        const courseHtml = await requestText('/eams/courseTableForStd!courseTable.action', {
            ignoreHead: '1', 'setting.kind': 'std', startWeek: '', 'semester.id': semester.id, ids: parameters.ids
        });
        const courses = parseTaskActivities(courseHtml);
        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert('该学期暂无课程', '所选学期没有已安排上课周次和节次的课程。', '知道了');
            return;
        }
        const config = parseCalendarInfo(await requestText('/eams/base/calendar-info.action', {
            version: '1', semesterId: semester.id
        }), semester.name);
        if (courses.some(function (course) { return course.weeks.some(function (week) { return week > config.semesterTotalWeeks; }); })) {
            throw new Error('课程周次超出所选学期校历。');
        }
        if (courses.some(function (course) { return course.endSection > SDWCVC_TIME_SLOTS.length; })) {
            throw new Error('课程节次超出学校统一作息表的第 1～10 节。');
        }
        if (!await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config))) throw new Error('课表配置保存失败。');
        if (!await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SDWCVC_TIME_SLOTS))) throw new Error('作息时间保存失败。');
        if (!await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses))) throw new Error('课程保存失败。');
        window.shiguangBridge.showToast('已获取 ' + courses.length + ' 条课程时段，并应用学校统一作息。');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert('导入失败', error.message, '知道了');
    }
}

runImportFlow();
