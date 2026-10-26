// 广东药科大学 (gdpu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

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
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc || 
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) continue;
        
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
    
    return finalCourseList;
}

/**
 * 检查是否在登录页面。
 */
function isLoginPage() {
    return window.location.href.indexOf("lyuapServer/login") > -1; 
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
        "导入前请确保您已在浏览器中登录广东药科大学教务系统并进入课表页面",
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
 * 选择校区
 */
async function selectCampus() {
    const campusKeys = ["campus_1", "campus_2"];
    const campusDisplayNames = ["广州、云浮校区", "中山校区"];
    
    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(campusDisplayNames),
        0
    );
    
    if (campusIndex === null || campusIndex === -1) return null;
    return campusKeys[campusIndex];
}

/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    const semesterCode = getSemesterCode(semesterIndex);
    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`; 
    const url = "https://webvpn.gdpu.edu.cn/http/77726476706e69737468656265737421fae05285347e6f546e1dc7a99c406d36fe/kbcx/xskbcx_cxXsgrkb.html?vpn-12-o1-jwsys.gdpu.edu.cn&gnmkdm=N2151";

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
            window.shiguangBridge.showToast("数据解析失败，请检查是否登录过期。");
            return null;
        }

        const courses = parseJsonData(jsonData); 

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到课程数据，请检查学年学期。");
            return null;
        }
        
        const config = {
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1 
        };

        return { courses: courses, config: config }; 

    } catch (error) {
        window.shiguangBridge.showToast(`请求失败: ${error.message}`);
        console.error(error);
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
        console.error(error);
        return false;
    }
}

// 多校区作息时间表定义
const CampusTimeSlots = {
    // 广州、云浮校区
    "campus_1": [
        { number: 1, startTime: "08:30", endTime: "09:10" },
        { number: 2, startTime: "09:20", endTime: "10:00" },
        { number: 3, startTime: "10:10", endTime: "10:50" },
        { number: 4, startTime: "11:00", endTime: "11:40" },
        { number: 5, startTime: "11:50", endTime: "12:30" },
        { number: 6, startTime: "12:40", endTime: "13:20" },
        { number: 7, startTime: "14:00", endTime: "14:40" },
        { number: 8, startTime: "14:50", endTime: "15:30" },
        { number: 9, startTime: "15:40", endTime: "16:20" },
        { number: 10, startTime: "16:30", endTime: "17:10" },
        { number: 11, startTime: "17:20", endTime: "18:00" },
        { number: 12, startTime: "18:10", endTime: "18:50" },
        { number: 13, startTime: "19:00", endTime: "19:40" },
        { number: 14, startTime: "19:50", endTime: "20:30" },
        { number: 15, startTime: "20:40", endTime: "21:20" }
    ],
    // 中山校区 
    "campus_2": [
        { number: 1, startTime: "08:30", endTime: "09:10" },
        { number: 2, startTime: "09:20", endTime: "10:00" },
        { number: 3, startTime: "10:10", endTime: "10:50" },
        { number: 4, startTime: "11:00", endTime: "11:40" },
        { number: 5, startTime: "11:50", endTime: "12:30" },
        { number: 6, startTime: "12:40", endTime: "13:20" },
        { number: 7, startTime: "13:30", endTime: "14:10" },
        { number: 8, startTime: "14:20", endTime: "15:00" },
        { number: 9, startTime: "15:10", endTime: "15:50" },
        { number: 10, startTime: "16:00", endTime: "16:40" },
        { number: 11, startTime: "16:50", endTime: "17:30" },
        { number: 12, startTime: "17:40", endTime: "18:20" },
        { number: 13, startTime: "18:30", endTime: "19:10" },
        { number: 14, startTime: "19:20", endTime: "20:00" },
        { number: 15, startTime: "20:10", endTime: "20:50" }
    ]
};

async function importPresetTimeSlots(campusKey) {
    const timeSlots = CampusTimeSlots[campusKey];
    if (timeSlots && timeSlots.length > 0) {
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        } catch (error) {
            console.error(error);
        }
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先在浏览器登录教务系统！");
        return;
    }
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;

    const campusKey = await selectCampus();
    if (campusKey === null) return;

    const academicYear = await getAcademicYear();
    if (academicYear === null) return;

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) return;

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) return;
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) return;
    
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        console.error(error);
    }

    await importPresetTimeSlots(campusKey);
    window.shiguangBridge.showToast(`导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();