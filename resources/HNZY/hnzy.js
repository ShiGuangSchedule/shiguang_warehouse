// ====================== 工具函数 ======================

/**
 * 检查用户是否已登录。
 * 如果当前URL包含登录关键字，说明用户未登录，返回false。
 * 如果不包含登录关键字，说明用户已登录，返回true。
 */
function isUserLoggedIn() {
    const url = window.location.href;
    const loginKeywords = [
        "https://we.hnzj.edu.cn/sso/login"
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

// ====================== 弹窗选择学年学期 ======================
async function selectYearAndTerm(schoolYears, schoolTerms) {
    try {
        // 构造所有学年 x 学期组合
        const options = [];
        const mapping = []; // 用于根据选项索引找到学年和学期
        schoolYears.forEach(y => {
            schoolTerms.forEach(t => {
                options.push(`${y.label} ${t.label}`);
                mapping.push({ year: y.value, term: t.value });
            });
        });

        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择学年和学期",
            JSON.stringify(options),
            0
        );

        if (selectedIndex === null) return null;

        return mapping[selectedIndex];
    } catch (err) {
        console.error("选择学年学期失败:", err);
        return null;
    }
}


// ====================== 异步获取学年学期 ======================
async function fetchSchoolYearTerms() {
    try {
        const res = await fetch("https://one.hnzj.edu.cn/kcb/api/schoolyearTerms");
        const json = await res.json();
        return {
            schoolYears: json.response.schoolYears,
            schoolTerms: json.response.schoolTerms
        };
    } catch (err) {
        console.error("获取学年学期失败:", err);
        window.shiguangBridge.showToast("获取学年学期失败：" + err.message);
        return null;
    }
}

// ====================== 异步获取课程并处理 ======================
async function fetchCoursesForAllWeeks(year, term) {
    let allCourses = [];

    for (let week = 1; week <= 20; week++) {
        try {
            const url = `https://one.hnzj.edu.cn/kcb/api/course?schoolYear=${year}&schoolTerm=${term}&week=${week}`;
            const res = await fetch(url);
            const json = await res.json();


            json.response.forEach(dayInfo => {
                dayInfo.data.forEach(c => {
                    const weeks = parseWeeks(c.weeks);
                    if (!weeks.length) return;
                    allCourses.push({
                        name: c.courseName,
                        teacher: c.teacherName,
                        position: c.classRoom,
                        day: dayInfo.week,
                        startSection: parseInt(c.startSection),
                        endSection: parseInt(c.endSection),
                        weeks
                    });
                });
            });
        } catch (err) {
            console.error(`第 ${week} 周课程获取失败:`, err);
        }
    }

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

// ====================== 导入预设时间段（实际大节时间） ======================
async function importPresetTimeSlots() {
    // 调整后的课程大节时间，端点衔接，总时长不变
    const presetTimeSlots = [
        { number: 1, startTime: "08:30", endTime: "09:15" }, // 第一大节第一部分
        { number: 2, startTime: "09:15", endTime: "10:00" }, // 第一大节第二部分
        { number: 3, startTime: "10:20", endTime: "11:05" }, // 第二大节第一部分
        { number: 4, startTime: "11:05", endTime: "11:50" }, // 第二大节第二部分
        { number: 5, startTime: "14:20", endTime: "15:05" }, // 第三大节第一部分
        { number: 6, startTime: "15:05", endTime: "15:50" }, // 第三大节第二部分
        { number: 7, startTime: "16:10", endTime: "16:55" }, // 第四大节第一部分
        { number: 8, startTime: "16:55", endTime: "17:40" }, // 第四大节第二部分
		{ number: 9, startTime: "18:00", endTime: "18:45" }, // 第五大节第一部分
		{ number: 10, startTime: "18:45", endTime: "19:00" }, // 第五大节第二部分
        { number: 11, startTime: "19:00", endTime: "19:45" }, // 第六大节第一部分
        { number: 12, startTime: "19:45", endTime: "20:30" }  // 第六大节第二部分
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


// ====================== 主流程 ======================
async function runImportFlow() {
    // 检查用户是否已登录
    if (!isUserLoggedIn()) {
        window.shiguangBridge.showToast("检测到未登录状态，请先登录后再使用课程导入功能！");
        return;
    }
    
    window.shiguangBridge.showToast("课程导入流程即将开始...");

    // 1️⃣ 获取学年学期
    const yearTermData = await fetchSchoolYearTerms();
    if (!yearTermData) {
        return;
    }

    // 2️⃣ 用户选择
    const selection = await selectYearAndTerm(yearTermData.schoolYears, yearTermData.schoolTerms);
    if (!selection) {
        window.shiguangBridge.showToast("用户取消选择！");
        return;
    }

    // 3️⃣ 异步获取课程并处理
    const courses = await fetchCoursesForAllWeeks(selection.year, selection.term);
    if (!courses) {
        return;
    }

    // 4️⃣ 保存课程
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    // 5️⃣ 导入预设时间段
    await importPresetTimeSlots();

    // ✅ 只有所有步骤都成功完成，才通知任务完成
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS：整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动流程
runImportFlow();
