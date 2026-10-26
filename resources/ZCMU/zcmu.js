// 浙江中医药大学 (zcmu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统 v9.0 接口适配

/**
 * 解析周次字符串，处理单双周和周次范围。
 * 格式: "1-16周", "1-15周(单)", "2-16周(双)", "8周", "1-5周,7-8周"
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
 * 解析节次范围，例如 "1-2", "3-4", "6-8", "1-5"
 */
function parseSection(jcsStr) {
    if (!jcsStr) return { startSection: 1, endSection: 2 };
    const parts = jcsStr.split('-');
    const start = Number(parts[0]);
    const end = Number(parts[parts.length - 1]);
    return {
        startSection: isNaN(start) ? 1 : start,
        endSection: isNaN(end) ? start || 1 : end
    };
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xm ||
            !rawCourse.cdmc || !rawCourse.xqj ||
            !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) continue;

        const { startSection, endSection } = parseSection(rawCourse.jcs);
        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
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

    return finalCourseList;
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年！";
    }
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已登录教务系统并进入课表查询页面",
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
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;

    const url = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";

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
        console.error("获取课表失败: " + e);
    }

    window.shiguangBridge.showToast("未能获取课表数据，请检查是否已登录并进入课表页面。");
    return null;
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast("正在保存 " + parsedCourses.length + " 门课程...");
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

// 浙江中医药大学作息时间表（两校区不同）
const CampusTimeSlots = {
    "滨文校区": [
        { number: 1,  startTime: "08:15", endTime: "08:55" },
        { number: 2,  startTime: "09:00", endTime: "09:40" },
        { number: 3,  startTime: "09:55", endTime: "10:35" },
        { number: 4,  startTime: "10:40", endTime: "11:20" },
        { number: 5,  startTime: "11:25", endTime: "12:05" },
        { number: 6,  startTime: "13:45", endTime: "14:25" },
        { number: 7,  startTime: "14:30", endTime: "15:10" },
        { number: 8,  startTime: "15:20", endTime: "16:00" },
        { number: 9,  startTime: "16:05", endTime: "16:45" },
        { number: 10, startTime: "16:50", endTime: "17:55" },
        { number: 11, startTime: "18:00", endTime: "18:40" },
        { number: 12, startTime: "18:45", endTime: "19:25" },
        { number: 13, startTime: "19:30", endTime: "20:10" }
    ],
    "富春校区": [
        { number: 1,  startTime: "08:30", endTime: "09:10" },
        { number: 2,  startTime: "09:15", endTime: "09:55" },
        { number: 3,  startTime: "10:10", endTime: "10:50" },
        { number: 4,  startTime: "10:55", endTime: "11:35" },
        { number: 5,  startTime: "11:35", endTime: "13:15" },
        { number: 6,  startTime: "13:20", endTime: "14:00" },
        { number: 7,  startTime: "14:05", endTime: "14:45" },
        { number: 8,  startTime: "14:55", endTime: "15:35" },
        { number: 9,  startTime: "15:40", endTime: "16:20" },
        { number: 10, startTime: "16:25", endTime: "17:05" },
        { number: 11, startTime: "18:00", endTime: "18:40" },
        { number: 12, startTime: "18:45", endTime: "19:25" },
        { number: 13, startTime: "19:30", endTime: "20:10" }
    ]
};

async function selectCampus() {
    const campuses = Object.keys(CampusTimeSlots);
    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(campuses),
        0
    );
    if (campusIndex === null) return null;
    return campuses[campusIndex];
}

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast("正在导入 " + timeSlots.length + " 个预设时间段...");
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        }
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

    const campus = await selectCampus();
    if (campus === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) return;
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast("课表配置更新成功！总周数：" + config.semesterTotalWeeks + "周。");
    } catch (error) {
        window.shiguangBridge.showToast("课表配置保存失败: " + error.message);
    }

    await importPresetTimeSlots(CampusTimeSlots[campus]);

    window.shiguangBridge.showToast(campus + "课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();