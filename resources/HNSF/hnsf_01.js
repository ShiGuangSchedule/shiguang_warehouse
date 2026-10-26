// 河南师范大学(htu.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    
    // 假设新接口的 'zc' 字段已经是逗号分隔的周次数字字符串
    const weeks = weekStr.split(',')
        .map(w => Number(w.trim())) // 转换为数字
        .filter(w => !isNaN(w) && w > 0); // 过滤掉无效数字

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");
    
    // 检查JSON结构
    if (!jsonData || jsonData.code !== 0 || !Array.isArray(jsonData.data)) {
        console.warn("JS: JSON 数据结构错误或code不为0。");
        return [];
    }

    const rawCourseList = jsonData.data;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段检查
        if (!rawCourse.kcmc || !rawCourse.teaxms || !rawCourse.jxcdmc || 
            !rawCourse.xq || !rawCourse.ps || !rawCourse.pe || !rawCourse.zc) {
            // console.warn("JS: 发现缺少关键字段的课程记录，跳过。", rawCourse);
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zc);
        
        // 周次有效性检查
        if (weeksArray.length === 0) {
             // console.warn(`JS: 课程 ${rawCourse.kcmc} 周次解析失败或为空，跳过。`);
             continue;
        }

        const day = Number(rawCourse.xq); // xq: 星期几 (周一为1)
        const startSection = Number(rawCourse.ps);
        const endSection = Number(rawCourse.pe);
        
        // 数字有效性检查
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
             // console.warn(`JS: 课程 ${rawCourse.kcmc} 星期或节次数据无效，跳过。`);
             continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.teaxms.trim(),
            position: rawCourse.jxcdmc.trim(),
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


function isLoginPage() {
    const url = window.location.href;
    
    const expectedBaseUrl = 'https://jwc.htu.edu.cn';
    
    const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const isRootLogin = cleanUrl === expectedBaseUrl; 

    const isKeywordLogin = url.includes('login') || url.includes('cas');
    
    return url.includes('htu.edu.cn') && (isRootLogin || isKeywordLogin);
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
    const semesters = ["第一学期 (01)", "第二学期 (02)"];
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

    // 学年学期代码组合：202501 (第一学期), 202502 (第二学期)
    // semesterIndex 0 对应 01, 1 对应 02
    const semesterCode = semesterIndex === 0 ? "01" : "02"; 
    const xnxqdmBody = `xnxqdm=${academicYear}${semesterCode}`;
    const url = "https://jwc.htu.edu.cn/new/student/xsgrkb/getCalendarWeekDatas";

    console.log(`JS: 发送请求到 ${url}, body: ${xnxqdmBody}`);

    const requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        "body": xnxqdmBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }
        
        const jsonText = await response.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error('JS: JSON 解析失败:', e);
            window.shiguangBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
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
    { number: 7, startTime: "16:40", endTime: "17:25" },
    { number: 8, startTime: "17:35", "endTime": "18:20" },
    { number: 9, startTime: "19:30", "endTime": "20:15" },
    { number: 10, startTime: "20:25", "endTime": "21:10" }
];
const SummerTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "15:00", endTime: "15:45" },
    { number: 6, startTime: "15:55", endTime: "16:40" },
    { number: 7, startTime: "17:10", endTime: "17:55" },
    { number: 8, startTime: "18:05", "endTime": "18:50" },
    { number: 9, startTime: "20:00", "endTime": "20:45" },
    { number: 10, startTime: "20:55", "endTime": "21:40" }
];
const NewCampusTimeSlots = [
     { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:25", endTime: "10:10" },
    { number: 3, startTime: "10:30", endTime: "11:15" },
    { number: 4, startTime: "11:25", endTime: "12:10" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", "endTime": "17:40" },
    { number: 9, startTime: "18:40", "endTime": "19:25" },
    { number: 10, startTime: "19:35", "endTime": "20:20" }
]

async function selectCampus() {
    const campusOptions = ["建设东路校区/平原湖校区", "创新港校区"]
    console.log("JS: 提示用户选择校区。");
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(campusOptions),
        0
    );
    return selectedIndex;
}

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

    // 2. 获取并解析课程
    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses } = result;

    // 3. 课程数据保存。
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    // 4. 作息时间选择与导入
    const campusIndex = await selectCampus();
    let selectedTimeSlots = [];
    if (campusIndex === 0) {
        // 0: 建设东路校区/平原湖校区
        const timeSlotsIndex = await selectTimeSlotsType();
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
    } else if (campusIndex === 1) {
        // 1: 创新港校区
        selectedTimeSlots = NewCampusTimeSlots;
        console.log("JS: 已选择创新港校区作息。");
    }
    await importPresetTimeSlots(selectedTimeSlots);


    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();