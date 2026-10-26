// 哈尔滨工业大学(hit.edu.cn) 研究生课表适配脚本
// 研究生教育管理系统

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const cleaned = weekStr.replace(/周/g, '').trim();
    if (!cleaned) return [];
    const weeks = [];
    const parts = cleaned.split(/[,，]/);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const isOdd = trimmed.startsWith('单');
        const isEven = trimmed.startsWith('双');
        const rangeStr = isOdd || isEven ? trimmed.substring(1) : trimmed;
        const rangeMatch = rangeStr.match(/^(\d+)\s*[-~]\s*(\d+)$/);
        const singleMatch = rangeStr.match(/^(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            for (let w = start; w <= end; w++) {
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 !== 0) continue;
                weeks.push(w);
            }
        } else if (singleMatch) {
            const num = parseInt(singleMatch[1], 10);
            if (isOdd && num % 2 === 0) continue;
            if (isEven && num % 2 !== 0) continue;
            weeks.push(num);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseCourseCell(cellStr, day, sections) {
    if (!cellStr || cellStr === 'null') return [];
    const courses = [];
    const entries = cellStr.split('<br/>');
    for (const entry of entries) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        // 格式: 课程名◇教师[周次]教室[节次]节
        // 先找◇分割课程名和教师
        const teacherSplit = trimmed.split('\u25C7');
        if (teacherSplit.length < 2) {
            console.log("HIT调试: 无◇分隔, text=" + trimmed.substring(0, 40));
            continue;
        }
        const courseName = teacherSplit[0].trim();
        const rest = teacherSplit.slice(1).join('\u25C7').trim();

        // 从rest中提取: 教师[周次]教室[节次]节
        // 找第一个[之前的是教师
        const firstBracket = rest.indexOf('[');
        if (firstBracket === -1) continue;
        const teacher = rest.substring(0, firstBracket).trim();

        // 提取周次: [周次] 中的内容
        const weekMatch = rest.match(/\[(\d+[-~，,\d]+)周\]/);
        if (!weekMatch) {
            console.log("HIT调试: 无周次, rest=" + rest.substring(0, 50));
            continue;
        }
        const weeksStr = weekMatch[1];
        const weeks = parseWeeks(weeksStr);
        if (weeks.length === 0) continue;

        // 提取节次: 最后一个[节次]节 中的内容
        const sectionMatch = rest.match(/\[(.+)\]节/);
        if (!sectionMatch) {
            console.log("HIT调试: 无节次, rest=" + rest.substring(0, 50));
            continue;
        }
        const sectionStr = sectionMatch[1].trim();

        // 提取教室: 周次]和节次[之间的内容
        const afterWeek = rest.substring(rest.indexOf(']周]') + 3);
        const beforeSection = afterWeek.substring(0, afterWeek.lastIndexOf('['));
        const room = beforeSection.trim();

        const sectionParts = sectionStr.split(/[,，\s]+/);
        const startSection = parseInt(sectionParts[0], 10);
        const endSection = sectionParts.length > 1 ? parseInt(sectionParts[sectionParts.length - 1], 10) : startSection;
        if (isNaN(startSection) || isNaN(endSection)) {
            console.log("HIT调试: 节次解析失败, sectionStr=" + sectionStr);
            continue;
        }

        console.log("HIT调试: 解析成功, " + courseName + "|" + teacher + "|" + room + "|d" + day + "|s" + startSection + "-" + endSection + "|w" + weeks.length);
        courses.push({
            name: courseName,
            teacher: teacher,
            position: room,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        });
    }
    return courses;
}

function mergeCourses(courses) {
    if (courses.length <= 1) return courses;
    courses.sort((a, b) => {
        return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0);
    });
    const merged = [];
    let cur = courses[0];
    for (let i = 1; i < courses.length; i++) {
        const nxt = courses[i];
        if (cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            merged.push(cur);
            cur = nxt;
        }
    }
    merged.push(cur);
    return merged;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "研究生课表导入",
        "导入前请确保您已在浏览器中成功登录研究生系统",
        "好的，开始导入"
    );
}

async function fetchCurrentSchedule() {
    const url = "/xs/index/getDqxqkb?sf_request_type=ajax";
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include"
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data.isSuccess || !data.module) return null;
        return data;
    } catch (e) {
        return null;
    }
}

async function fetchSemesterInfo() {
    const url = "/xs/index/getZcxx?sf_request_type=ajax";
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include"
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data.isSuccess || !data.module) return null;
        return data.module;
    } catch (e) {
        return null;
    }
}

const dayMap = { mon: 1, tues: 2, wed: 3, thur: 4, fri: 5, sat: 6, sun: 7 };

function parseScheduleData(scheduleData) {
    const allCourses = [];
    const module = scheduleData.module;
    console.log("HIT调试: module行数=" + module.length);
    for (const row of module) {
        const sections = row.jcmc;
        for (const [dayKey, dayNum] of Object.entries(dayMap)) {
            const cellStr = row[dayKey];
            if (!cellStr || cellStr === 'null') continue;
            console.log("HIT调试: " + dayKey + "=" + cellStr.substring(0, 50));
            const courses = parseCourseCell(cellStr, dayNum, sections);
            console.log("HIT调试: 解析出" + courses.length + "门课");
            allCourses.push(...courses);
        }
    }
    return mergeCourses(allCourses);
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

async function setPresetTimeSlots() {
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:50" },
        { "number": 2, "startTime": "08:55", "endTime": "09:45" },
        { "number": 3, "startTime": "10:00", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:45" },
        { "number": 5, "startTime": "13:45", "endTime": "14:35" },
        { "number": 6, "startTime": "14:40", "endTime": "15:30" },
        { "number": 7, "startTime": "15:45", "endTime": "16:35" },
        { "number": 8, "startTime": "16:40", "endTime": "17:30" },
        { "number": 9, "startTime": "18:30", "endTime": "19:20" },
        { "number": 10, "startTime": "19:25", "endTime": "20:15" },
        { "number": 11, "startTime": "20:30", "endTime": "21:20" },
        { "number": 12, "startTime": "21:25", "endTime": "22:15" }
    ];

    try {
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("HIT: 预设时间段导入成功");
        }
    } catch (error) {
        console.error("HIT: 导入时间段失败:", error);
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在获取课表数据...");

    const [scheduleData, semesterInfo] = await Promise.all([
        fetchCurrentSchedule(),
        fetchSemesterInfo()
    ]);

    if (!scheduleData) {
        window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
        return;
    }

    console.log("HIT调试: API返回成功, module长度=" + scheduleData.module.length);
    console.log("HIT调试: 第一行数据=" + JSON.stringify(scheduleData.module[0]));

    const courses = parseScheduleData(scheduleData);
    console.log("HIT调试: 总共解析=" + courses.length + "门课");
    if (courses.length > 0) {
        console.log("HIT调试: 第一门=" + JSON.stringify(courses[0]));
    }
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未找到课程数据");
        return;
    }

    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    await setPresetTimeSlots();

    if (semesterInfo && semesterInfo.ZCJSSJ) {
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                semesterStartDate: null,
                semesterTotalWeeks: 20
            }));
        } catch (e) {}
    }

    const semesterName = semesterInfo ? semesterInfo.MC : "当前学期";
    window.shiguangBridge.showToast("课程导入成功！" + semesterName + "，共 " + courses.length + " 门课程");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
