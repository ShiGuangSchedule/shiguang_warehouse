// 济源职业技术学院_拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

function parseWeeks(weekStr) {
    const weeks = [];
    const isDoubleWeek = weekStr.includes('双周');
    const isSingleWeek = weekStr.includes('单周');
    let cleanWeekStr = weekStr.replace('双周', '').replace('单周', '').trim();

    const parts = cleanWeekStr.split(',');

    for (const part of parts) {
        let currentPart = part.trim();

        if (currentPart.includes('-')) {
            const [start, end] = currentPart.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                if (isDoubleWeek) {
                    if (i % 2 === 0) weeks.push(i);
                } else if (isSingleWeek) {
                    if (i % 2 !== 0) weeks.push(i);
                } else {
                    weeks.push(i);
                }
            }
        } else if (!isNaN(Number(currentPart)) && currentPart !== '') {
            weeks.push(Number(currentPart));
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseCourseString(cellContent) {
    const courses = [];
    const content = cellContent.replace(/<\/?ul>/g, '').trim();
    const courseLines = content.split(/<br\s*\/?>/i);

    for (const line of courseLines) {
        const text = line.trim();
        if (!text) continue;

        const match = text.match(/(.+?)\s+([^\s(]+)\s*\(([^()]+)\)/);

        if (match) {
            const name = match[1].trim();
            const teacher = match[2].trim();
            const fullContent = match[3].trim();

            const lastSpaceIndex = fullContent.lastIndexOf(' ');

            if (lastSpaceIndex !== -1) {
                const weeksStr = fullContent.substring(0, lastSpaceIndex).trim();
                const position = fullContent.substring(lastSpaceIndex + 1).trim();

                if (name && teacher && position && weeksStr) {
                    courses.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        weeks: parseWeeks(weeksStr)
                    });
                }
            }
        }
    }
    return courses;
}

function transformSchedule(htmlString) {
    console.log("JS: transformSchedule 正在解析 HTML...");
    const rowsMatch = htmlString.match(/<tr class="mykb"[\s\S]*?<\/tr>/g);
    if (!rowsMatch) {
        console.warn("JS: transformSchedule 未找到任何课程行 (tr class='mykb')");
        return [];
    }

    const tempCourseList = [];
    const sectionMap = {};

    for (let i = 0; i < rowsMatch.length; i++) {
        const row = rowsMatch[i];
        const sectionMatch = row.match(/<td[^>]*?>[^<]*?(\d+)(?:\([^)]*\))?/i);
        if (sectionMatch && sectionMatch[1]) {
            sectionMap[i] = Number(sectionMatch[1]);
        }
    }

    for (let rowIndex = 0; rowIndex < rowsMatch.length; rowIndex++) {
        const row = rowsMatch[rowIndex];
        const currentSection = sectionMap[rowIndex];
        if (!currentSection) continue;

        const allCells = row.match(/<td\s+[^>]*?>[\s\S]*?<\/td>/g);
        if (!allCells) continue;

        let courseCells;

        if (allCells.length === 9) {
            courseCells = allCells.slice(2, 9);
        } else if (allCells.length === 8) {
            courseCells = allCells.slice(1, 8);
        } else {
            continue;
        }

        if (courseCells.length !== 7) {
            continue;
        }

        let dayOfWeek = 1;

        for (const cellHtml of courseCells) {
            const cellContentMatch = cellHtml.match(/<ul>([\s\S]*?)<\/ul>/);

            if (cellContentMatch) {
                const courseLinesContent = cellContentMatch[1];
                const coursesInCell = parseCourseString(courseLinesContent);

                for (const course of coursesInCell) {
                    if (dayOfWeek >= 1 && dayOfWeek <= 7) {
                         tempCourseList.push({
                            name: course.name,
                            teacher: course.teacher,
                            position: course.position,
                            day: dayOfWeek,
                            startSection: currentSection,
                            endSection: currentSection,
                            weeks: course.weeks
                        });
                    }
                }
            }
            dayOfWeek++;
        }
    }

    const finalCourseList = [];

    tempCourseList.sort((a, b) =>
        a.day - b.day ||
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        a.startSection - b.startSection
    );

    let currentMergedCourse = null;

    for (const course of tempCourseList) {
        if (currentMergedCourse === null) {
            currentMergedCourse = { ...course };
        } else {
            const isSameCourseContext = currentMergedCourse.name === course.name &&
                                        currentMergedCourse.teacher === course.teacher &&
                                        currentMergedCourse.position === course.position &&
                                        currentMergedCourse.weeks.join(',') === course.weeks.join(',');

            const isConsecutive = course.day === currentMergedCourse.day &&
                                  course.startSection === currentMergedCourse.endSection + 1;

            if (isSameCourseContext && isConsecutive) {
                currentMergedCourse.endSection = course.endSection;
            } else {
                finalCourseList.push(currentMergedCourse);
                currentMergedCourse = { ...course };
            }
        }
    }

    if (currentMergedCourse !== null) {
        finalCourseList.push(currentMergedCourse);
    }

    console.log(`JS: transformSchedule 解析并合并完成，共 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

function isLoginPage() {
    const url = window.location.href;
    return url.includes('jwgl.jyvtc.edu.cn/jyvtcjw/cas/login.action');
}

function validateYearInput(input) {
    console.log("JS: validateYearInput 被调用，输入: " + input);
    if (/^[0-9]{4}$/.test(input)) {
        console.log("JS: validateYearInput 验证通过。");
        return false;
    } else {
        console.log("JS: validateYearInput 验证失败。");
        return "请输入四位数字的学年！";
    }
}
async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    console.log("JS: 提示用户输入学年。");
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期 (0)", "第二学期 (1)"];
    console.log("JS: 提示用户选择学期。");
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    // 0是第一学期，1是第二学期
    const semesterCode = semesterIndex === 0 ? "0" : "1";
    const xnxqBody = `weeks=&xnxq=${academicYear}-${semesterCode}`;
    const url = "https://jwgl.jyvtc.edu.cn/jyvtcjw/frame/desk/showLessonScheduleDetail.action";

    console.log(`JS: 发送请求到 ${url}, body: ${xnxqBody}`);

    const requestOptions = {
        "headers": {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        "body": xnxqBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }

        const htmlText = await response.text();

        const courses = transformSchedule(htmlText);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);

        return { courses: courses };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

const Non_summerTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:14" },
    { number: 8, startTime: "17:15", "endTime": "18:00" },
    { number: 9, startTime: "19:30", "endTime": "20:14" },
    { number: 10, startTime: "20:15", "endTime": "21:00" }
];
const SummerTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "15:00", endTime: "15:45" },
    { number: 6, startTime: "15:55", endTime: "16:40" },
    { number: 7, startTime: "17:00", endTime: "17:44" },
    { number: 8, startTime: "17:45", "endTime": "18:30" },
    { number: 9, startTime: "19:30", "endTime": "20:14" },
    { number: 10, startTime: "20:15", "endTime": "21:00" }
];

async function selectTimeSlotsType() {
    const timeSlotsOptions = ["非夏季作息", "夏季作息"];
    console.log("JS: 提示用户选择作息时间类型。");
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(timeSlotsOptions),
        0
    );
    return selectedIndex;
}

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);

    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    // 1. 公告和前置检查。
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 获取学年失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学年: ${academicYear}`);


    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 选择学期失败/取消，流程终止。");
        return;
    }
    console.log(`JS: 已选择学期索引: ${semesterIndex}`);

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses } = result;

    // 5. 课程数据保存。
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    const timeSlotsIndex = await selectTimeSlotsType();
    let selectedTimeSlots = [];

    if (timeSlotsIndex === 0) {
        // 0: 非夏季作息
        selectedTimeSlots = Non_summerTimeSlots;
        console.log("JS: 已选择非夏季作息。");
    } else if (timeSlotsIndex === 1) {
        // 1: 夏季作息
        selectedTimeSlots = SummerTimeSlots;
        console.log("JS: 已选择夏季作息。");
    } else {
        selectedTimeSlots = Non_summerTimeSlots;
        console.warn("JS: 作息时间选择失败/取消，使用非夏季作息作为默认值。");
    }
    await importPresetTimeSlots(selectedTimeSlots);


    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();