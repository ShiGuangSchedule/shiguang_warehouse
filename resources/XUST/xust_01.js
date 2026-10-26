// 西安科技大学(.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

// 统一标准作息时间
const TimeSlots = [
    { number: 1, startTime: "08:05", endTime: "08:55" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:05", endTime: "10:55" },
    { number: 4, startTime: "11:00", endTime: "11:50" },
    { number: 5, startTime: "14:10", endTime: "15:00" },
    { number: 6, startTime: "15:05", endTime: "15:55" },
    { number: 7, startTime: "16:05", endTime: "16:55" },
    { number: 8, startTime: "17:00", endTime: "17:50" },
    { number: 9, startTime: "19:00", endTime: "19:50" },
    { number: 10, startTime: "19:55", endTime: "20:45" }
];

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); // 匹配以数字周结束的

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }
        
        if (processed) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 地点与节次差异化时间适配
 */
function applyCustomTime(course) {
    if (!course.position) return course;

    const hasTi = course.position.includes('体');
    const pattern = /\d+-(9|1[0-8])-\d+/;
    if (!hasTi && !pattern.test(course.position)) return course;

    if (course.endSection < 3 || course.startSection > 4) return course;

    const standardStartMap = {};
    const standardEndMap = {};
    TimeSlots.forEach(slot => {
        standardStartMap[slot.number] = slot.startTime;
        standardEndMap[slot.number] = slot.endTime;
    });

    const customStartMap = { 3: "10:25", 4: "11:20" };
    const customEndMap = { 3: "11:15", 4: "12:10" };

    course.isCustomTime = true;
    course.customStartTime = customStartMap[course.startSection] || standardStartMap[course.startSection] || "08:05";
    course.customEndTime = customEndMap[course.endSection] || standardEndMap[course.endSection] || "20:45";

    return course;
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
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

        let courseItem = {
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day, 
            startSection: startSection,
            endSection: endSection, 
            weeks: weeksArray
        };

        // 应用差异化时间逻辑
        courseItem = applyCustomTime(courseItem);
        finalCourseList.push(courseItem);
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );
    
    return finalCourseList;
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
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    return await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
}

/**
 * 将选择索引转换为 API 所需的学期码。
 */
function getSemesterCode(semesterIndex) {
    // semesterIndex 3 (第一学期), 12 (第二学期)
    return semesterIndex === 0 ? "3" : "12";
}


/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    
    const targetUrls = [
        "http://59.74.174.150/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"
    ];

    for (const url of targetUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" 
                },
                body: requestBody,
                credentials: "include"
            });

            if (response.ok) {
                const jsonText = await response.text();
                const jsonData = JSON.parse(jsonText);
                if (jsonData && jsonData.kbList) {
                    const parsedCourses = parseJsonData(jsonData);
                    if (parsedCourses.length > 0) {
                        return {
                            courses: parsedCourses,
                            config: {
                                semesterStartDate: null,
                                semesterTotalWeeks: 20
                            }
                        };
                    }
                }
            }
        } catch (e) {
            console.error(`Entry failed: ${url}`);
        }
    }
    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
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

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
    }
}

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
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }
    
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();