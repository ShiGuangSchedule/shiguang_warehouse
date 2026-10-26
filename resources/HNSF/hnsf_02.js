// ====================== 工具函数 ======================

/**
 * 检查用户是否已登录。
 * 如果当前URL包含登录关键字，说明用户未登录，返回false。
 * 如果不包含登录关键字，说明用户已登录，返回true。
 */
function isUserLoggedIn() {
    const url = window.location.href;
    const loginKeywords = [
        "https://jwc.htu.edu.cn/xtgl/login_slogin.html"
    ];
    
    // 检查URL是否包含登录关键字
    for (const keyword of loginKeywords) {
        if (url.includes(keyword)) {
            return false; // 包含登录关键字，说明用户未登录
        }
    }
    
    // 不包含登录关键字，说明用户已登录
    return true;
}

// 展开 weeks 字符串 -> 数字数组
function parseWeeks(weeksStr) {
    const weeks = new Set();
    if (!weeksStr) return [];
    const parts = weeksStr.split(",");
    for (const part of parts) {
        if (part.includes("-")) {
            const [start, end] = part.split("-").map(n => parseInt(n));
            for (let i = start; i <= end && i <= 20; i++) {
                weeks.add(i);
            }
        } else {
            const n = parseInt(part);
            if (n >= 1 && n <= 20) weeks.add(n);
        }
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

// 合并重复课程
function mergeDuplicateCourses(courses) {
    const merged = [];
    const keyMap = {}; // key = name+day+startSection+endSection+position

    for (const c of courses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.position}`;
        if (!keyMap[key]) {
            keyMap[key] = { ...c, weeks: [...c.weeks] };
        } else {
            keyMap[key].weeks = Array.from(new Set([...keyMap[key].weeks, ...c.weeks]));
        }
    }

    for (const k in keyMap) merged.push(keyMap[k]);
    return merged;
}



// ====================== 选择月份 ======================
async function selectMonth() {
    try {
        // 生成月份选项
        const months = [];
        const currentYear = new Date().getFullYear();
        
        // 生成当前学年（9月到次年6月）的月份选项
        for (let month = 9; month <= 12; month++) {
            months.push(`${currentYear}年${month}月`);
        }
        for (let month = 1; month <= 6; month++) {
            months.push(`${currentYear + 1}年${month}月`);
        }
        
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择要获取课程的月份",
            JSON.stringify(months),
            0
        );
        
        if (selectedIndex === null) return null;
        
        const selectedMonth = months[selectedIndex];
        const year = parseInt(selectedMonth.split('年')[0]);
        const month = parseInt(selectedMonth.split('年')[1].split('月')[0]);
        
        // 计算该月的开始和结束日期
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // 该月最后一天
        
        return {
            startDate: startDate,
            endDate: endDate,
            year: year,
            month: month
        };
    } catch (err) {
        console.error("选择月份失败:", err);
        return null;
    }
}

// ====================== 异步获取课程数据 ======================
async function fetchCoursesData() {
    try {
        // 让用户选择月份
        const monthSelection = await selectMonth();
        if (!monthSelection) {
            window.shiguangBridge.showToast("用户取消选择月份！");
            return null;
        }
        
        // 格式化日期为API需要的格式
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}+00%3A00%3A00`;
        };
        
        const d1 = formatDate(monthSelection.startDate);
        const d2 = formatDate(monthSelection.endDate);
        
        
        const res = await fetch("https://jwc.htu.edu.cn/new/desktop/getCalendar", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `d1=${d1}&d2=${d2}`
        });
        const json = await res.json();
        
        
        return json; // 直接返回课程数据数组
    } catch (err) {
        console.error("获取课程数据失败:", err);
        window.shiguangBridge.showToast("获取课程数据失败：" + err.message);
        return null;
    }
}

// ====================== 处理新格式的课程数据 ======================
async function processCoursesData(coursesData) {
    if (!coursesData || !Array.isArray(coursesData)) {
        return null;
    }

    const allCourses = [];

    coursesData.forEach((course) => {
        // 解析节次代码 (如 "0910" -> 第9节到第10节)
        const jcdm = course.jcdm || "";
        if (!jcdm || jcdm.length < 4) {
            return;
        }

        const startSection = parseInt(jcdm.substring(0, 2));
        const endSection = parseInt(jcdm.substring(2, 4));
        
        // 解析周次 (如 "10" -> [10])
        const weeks = parseWeeks(course.zc || "");
        if (!weeks.length) {
            return;
        }

        // 解析星期 (如 "3" -> 星期三)
        const day = parseInt(course.xq || "1");
        if (day < 1 || day > 7) {
            return;
        }

        // 处理地点格式，按照 [校本部]西校区新联楼0303 的格式
        let position = course.jxcdmc || "";
        const xqmc = course.xqmc || "校本部";
        if (position && !position.startsWith("[")) {
            position = `[${xqmc}]${position}`;
        }

        const processedCourse = {
            name: course.kcmc || "",
            teacher: course.teaxms || "",
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        };
        
        allCourses.push(processedCourse);
    });

    const mergedCourses = mergeDuplicateCourses(allCourses);
    
    return mergedCourses.length ? mergedCourses : null;
}

// ====================== 保存课程 ======================
async function saveCourses(courses) {
    try {
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            window.shiguangBridge.showToast("课程导入成功！");
            return true;
        } else {
            window.shiguangBridge.showToast("课程导入失败，请查看日志！");
            return false;
        }
    } catch (err) {
        console.error("保存课程失败:", err);
        window.shiguangBridge.showToast("保存课程失败：" + err.message);
        return false;
    }
}

// ====================== 导入预设时间段（一天5节大课，10节小课） ======================
async function importPresetTimeSlots() {
    // 一天5节大课，10节小课的时间安排
    const presetTimeSlots = [
        { number: 1, startTime: "08:00", endTime: "08:45" }, // 第1节
        { number: 2, startTime: "08:45", endTime: "09:30" }, // 第2节
        { number: 3, startTime: "09:50", endTime: "10:35" }, // 第3节
        { number: 4, startTime: "10:35", endTime: "11:20" }, // 第4节
        { number: 5, startTime: "14:00", endTime: "14:45" }, // 第5节
        { number: 6, startTime: "14:45", endTime: "15:30" }, // 第6节
        { number: 7, startTime: "15:50", endTime: "16:35" }, // 第7节
        { number: 8, startTime: "16:35", endTime: "17:20" }, // 第8节
        { number: 9, startTime: "19:00", endTime: "19:45" }, // 第9节
        { number: 10, startTime: "19:45", endTime: "20:30" } // 第10节
    ];
    
    try {
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            window.shiguangBridge.showToast("时间段导入成功！");
        } else {
            window.shiguangBridge.showToast("时间段导入失败，请查看日志！");
        }
    } catch (err) {
        console.error("时间段导入失败:", err);
        window.shiguangBridge.showToast("时间段导入失败：" + err.message);
    }
}


// ====================== 显示公告 ======================
async function showAnnouncement() {
    try {
        const announcement = `
课程导入工具使用说明：

1. 本工具用于从教务系统获取课程数据
2. 请确保已登录教务系统
3. 选择要获取课程的月份
4. 工具会自动下载原始数据和处理后的数据
5. 支持一天10节课的时间安排
6. 自动合并重复课程

使用前请确认网络连接正常！
        `.trim();
        
        await window.shiguangBridgePromise.showAlert(
            "课程导入工具公告",
            announcement
        );
    } catch (err) {
        console.error("显示公告失败:", err);
        // 如果弹窗失败，使用Toast提示
        window.shiguangBridge.showToast("课程导入工具启动中...");
    }
}

// ====================== 主流程 ======================
async function runImportFlow() {
    // 检查用户是否已登录
    if (!isUserLoggedIn()) {
        window.shiguangBridge.showToast("检测到未登录状态，请先登录后再使用课程导入功能！");
        return;
    }
    
    // 显示公告
    await showAnnouncement();
    
    window.shiguangBridge.showToast("课程导入流程即将开始...");

    // 1️⃣ 获取课程数据
    const coursesData = await fetchCoursesData();
    if (!coursesData) {
        return;
    }

    // 2️⃣ 处理课程数据
    const courses = await processCoursesData(coursesData);
    if (!courses) {
        window.shiguangBridge.showToast("没有找到有效的课程数据！");
        return;
    }

    // 3️⃣ 保存课程
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    // 4️⃣ 导入预设时间段
    await importPresetTimeSlots();

    // ✅ 只有所有步骤都成功完成，才通知任务完成
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS：整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动流程
runImportFlow();
