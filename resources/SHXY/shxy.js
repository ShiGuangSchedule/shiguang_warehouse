// 绥化学院(shxy.edu.cn) 拾光课程表适配脚本
// 基于乘方教务系统接口适配
// 出现问题请提issues或者提交pr更改

/**
 * 解析周次字符串，例如 "1,2,3,4,5" -> [1, 2, 3, 4, 5]
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(',')
        .map(w => Number(w.trim()))
        .filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 将教务系统返回的 JSON 转换为拾光标准的 CourseJsonModel 数组
 */
function parseJsonData(jsonData) {
    console.log("JS: 开始解析课程 JSON...");
    if (!jsonData || jsonData.code !== 0 || !Array.isArray(jsonData.data)) {
        return [];
    }

    let allProcessedCourses = [];

    jsonData.data.forEach(raw => {
        // 基础字段校验
        if (!(raw.kcmc && raw.xq && raw.ps && raw.pe)) return;

        // 识别并解析 jxcdmc2
        const locationMap = new Map();
        if (raw.jxcdmc2) {
            const parts = raw.jxcdmc2.split(',');
            parts.forEach(part => {
                const lastDashIndex = part.lastIndexOf('-');
                if (lastDashIndex !== -1) {
                    const room = part.substring(0, lastDashIndex).trim();
                    const week = Number(part.substring(lastDashIndex + 1));
                    if (!isNaN(week)) {
                        if (!locationMap.has(room)) locationMap.set(room, []);
                        locationMap.get(room).push(week);
                    }
                }
            });
        }

        if (locationMap.size > 0) {
            // 如果解析成功，则根据地点拆分为多个课程对象
            locationMap.forEach((weeks, room) => {
                allProcessedCourses.push({
                    name: raw.kcmc.trim(),
                    teacher: (raw.teaxms || "未知教师").trim(),
                    position: room || "未知地点",
                    day: Number(raw.xq),
                    startSection: Number(raw.ps),
                    endSection: Number(raw.pe),
                    weeks: weeks.sort((a, b) => a - b)
                });
            });
        } else if (raw.zc) {
            // 兜底方案：如果 jxcdmc2 无效，使用原有的 jxcdmc 和 zc 逻辑
            allProcessedCourses.push({
                name: raw.kcmc.trim(),
                teacher: (raw.teaxms || "未知教师").trim(),
                position: (raw.jxcdmc || "未知地点").trim(),
                day: Number(raw.xq),
                startSection: Number(raw.ps),
                endSection: Number(raw.pe),
                weeks: parseWeeks(raw.zc)
            });
        }
    });

    return allProcessedCourses.filter(course => {
        return course.weeks.length > 0 && course.startSection <= course.endSection;
    });
}

/**
 * 校验函数：验证用户输入的学年格式
 */
function validateYearInput(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的起始学年（如 2025）";
}

/**
 * 步骤 A: 显示引导公告
 */
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务导入说明",
        "1. 请确保已在浏览器中成功登录教务系统\n2. 导入过程中请勿关闭页面",
        "好的，开始导入"
    );
}

/**
 * 步骤 B: 获取用户输入的学年
 */
async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

/**
 * 步骤 C: 选择学期
 */
async function selectSemester() {
    const semesters = ["第一学期 (秋季)", "第二学期 (春季)"];
    return await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
}

/**
 * 发起网络请求并获取数据
 */
async function fetchCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求教务数据...");
    
    const semesterCode = semesterIndex === 0 ? "01" : "02"; 
    const body = `xnxqdm=${academicYear}${semesterCode}`;
    const url = "http://jwgl.shxy.edu.cn/new/student/xsgrkb/getCalendarWeekDatas";

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body,
            credentials: "include"
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const jsonData = await response.json();
        return parseJsonData(jsonData);
    } catch (e) {
        console.error("Fetch Error:", e);
        window.shiguangBridge.showToast("网络请求失败，请检查登录状态");
        return null;
    }
}

const CampusTimeSlots = {
    "老校区(厚德楼)": [
        { number: 1, startTime: "08:10", endTime: "08:55" },
        { number: 2, startTime: "09:00", endTime: "09:45" },
        { number: 3, startTime: "10:15", endTime: "11:00" },
        { number: 4, startTime: "11:05", endTime: "11:50" },
        { number: 5, startTime: "13:45", endTime: "14:30" },
        { number: 6, startTime: "14:35", endTime: "15:20" },
        { number: 7, startTime: "15:40", endTime: "16:25" },
        { number: 8, startTime: "16:30", endTime: "17:15" },
        { number: 9, startTime: "18:30", endTime: "19:15" },
        { number: 10, startTime: "19:20", endTime: "20:05" }
    ],
    "新校区(崇德楼)": [
        { number: 1, startTime: "08:10", endTime: "08:55" },
        { number: 2, startTime: "09:00", endTime: "09:45" },
        { number: 3, startTime: "10:30", endTime: "11:15" },
        { number: 4, startTime: "11:20", endTime: "12:05" },
        { number: 5, startTime: "13:45", endTime: "14:30" },
        { number: 6, startTime: "14:35", endTime: "15:20" },
        { number: 7, startTime: "15:55", endTime: "16:40" },
        { number: 8, startTime: "16:45", endTime: "17:30" },
        { number: 9, startTime: "18:30", endTime: "19:15" },
        { number: 10, startTime: "19:20", endTime: "20:05" }
    ]
};

async function selectCampus() {
    const campuses = Object.keys(CampusTimeSlots);
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区", JSON.stringify(campuses), 0
    );
    if (idx === null || idx === -1) return null;
    return campuses[idx];
}

// 主流程编排
async function runImportFlow() {
    // 1. 前置检查
    const isReady = await promptUserToStart();
    if (!isReady) return;

    // 2. 选择校区
    const campus = await selectCampus();
    if (!campus) {
        window.shiguangBridge.showToast("未选择校区，导入终止。");
        return;
    }

    // 3. 获取参数（学年、学期）
    const year = await getAcademicYear();
    if (!year) {
        window.shiguangBridge.showToast("导入已取消");
        return;
    }

    const semesterIdx = await selectSemester();
    if (semesterIdx === null) {
        window.shiguangBridge.showToast("导入已取消");
        return;
    }

    // 4. 执行获取与解析
    const courses = await fetchCourses(year, semesterIdx);
    if (!courses || courses.length === 0) {
        if (courses && courses.length === 0) window.shiguangBridge.showToast("该学期暂无课程数据");
        return;
    }

    // 5. 数据保存
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(CampusTimeSlots[campus]));
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！(${campus})`);
        window.shiguangBridge.notifyTaskCompletion();
        console.log("JS: 流程成功完成");
    } catch (e) {
        window.shiguangBridge.showToast("保存失败: " + e.message);
    }
}

// 启动入口
runImportFlow();
