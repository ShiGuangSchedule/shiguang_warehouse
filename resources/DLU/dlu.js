// 大连大学正方教务系统课表适配脚本 (基于 API)

/**
 * 解析周次字符串，处理单双周和周次范围。
 * @param {string} weekStr - 例如 "1-16周(单)", "1-8周,10-18周"
 * @returns {number[]} 解析后的周次数组
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); 

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; 
                if (isDouble && w % 2 !== 0) continue; 
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        if (weeksArray.length === 0) {
            continue;
        }

        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年（例如2023）！";
    }
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "大连大学教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    const currentMonth = new Date().getMonth() + 1; 
    const defaultYear = currentMonth >= 8 ? currentYear : (Number(currentYear) - 1).toString(); 
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（如2023-2024 应该填2023）:",
        defaultYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    const currentMonth = new Date().getMonth() + 1; 
    const defaultSemesterIndex = currentMonth >= 8 ? 0 : 1; 
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );
    return semesterIndex;
}

/**
 * 将选择索引转换为 API 所需的学期码
 * DLU: 3 (第一学期), 12 (第二学期)
 */
function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = getSemesterCode(semesterIndex);

    // 接口参数
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}`;
    
    // API URL - 使用了用户截图中确认的 xskbcx_cxXsgrkb.html 路径
    const url = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

    console.log(`JS: 发送请求到 ${url}, body: ${xnmXqmBody}`);

    const requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        "body": xnmXqmBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }

        const jsonText = await response.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            window.shiguangBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        return { courses: courses };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

// 大连大学统一作息时间 (星期一至星期五)
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:00", endTime: "09:45" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:35" },
    { number: 5, startTime: "13:15", endTime: "14:00" },
    { number: 6, startTime: "14:05", endTime: "14:50" },
    { number: 7, startTime: "15:05", endTime: "15:50" },
    { number: 8, startTime: "15:55", endTime: "16:40" },
    { number: 9, startTime: "16:55", endTime: "17:40" },
    { number: 10, startTime: "17:45", endTime: "18:30" }
];

// 大连大学周末作息时间 (星期六、星期日)
const WeekendTimeSlots = [
    { number: 1, startTime: "08:45", endTime: "09:30" },
    { number: 2, startTime: "09:40", endTime: "10:25" },
    { number: 3, startTime: "10:35", endTime: "11:20" },
    { number: 5, startTime: "13:10", endTime: "13:55" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" }
];

function applyCustomTimeToCourses(courses) {
    let customizedCount = 0;
    const updatedCourses = courses.map((course) => {
        // 如果是周末的课程 (星期六或星期日)
        if (course.day === 6 || course.day === 7) {
            const startSlot = WeekendTimeSlots.find(slot => slot.number === course.startSection);
            const endSlot = WeekendTimeSlots.find(slot => slot.number === course.endSection);

            if (startSlot && endSlot) {
                customizedCount++;
                return {
                    ...course,
                    isCustomTime: true,
                    customStartTime: startSlot.startTime,
                    customEndTime: endSlot.endTime,
                };
            } else {
                console.warn(`JS: 周末课程 ${course.name} 的节次(${course.startSection}-${course.endSection})未命中自定义时间映射，回退为普通节次。`);
            }
        }
        return course;
    });

    console.log(`JS: 周末自定义时间处理完成，命中 ${customizedCount} 门课程。`);
    return updatedCourses;
}

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);

    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

/**
 * 导入流程入口
 */
async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        return;
    }
    let { courses } = result;

    // 对周末的课程应用自定义时间
    courses = applyCustomTimeToCourses(courses);

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    // 导入预设作息时间
    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程及作息时间导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
