// ====================== 工具函数 ======================

/**
 * 检查用户是否已登录。
 * 如果当前URL包含登录关键字，说明用户未登录，返回false。
 * 如果不包含登录关键字，说明用户已登录，返回true。
 */
function isUserLoggedIn() {
    const url = window.location.href;
    const loginKeywords = [
        "https://jwc.mmpt.edu.cn/xtgl/login_slogin.html"
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

// 解析节次字符串 -> 开始节次和结束节次
function parseSections(sectionStr) {
    if (!sectionStr) return { start: 1, end: 1 };
    
    // 处理 "1-2节" 或 "3-4节" 等格式
    const match = sectionStr.match(/(\d+)-(\d+)节?/);
    if (match) {
        return {
            start: parseInt(match[1]),
            end: parseInt(match[2])
        };
    }
    
    // 处理单个节次 "1节" 等
    const singleMatch = sectionStr.match(/(\d+)节?/);
    if (singleMatch) {
        const num = parseInt(singleMatch[1]);
        return { start: num, end: num };
    }
    
    return { start: 1, end: 1 };
}

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

const MMPT_CONFIG = {
    name: '茂名职业技术学院',
    domains: ['mmpt.edu.cn', 'mmvtc.edu.cn'],
    jwcUrl: 'https://jwc.mmpt.edu.cn',
    apiPath: '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
};

// 茂名职业技术学院作息时间表配置
const MMVT_SCHEDULE_CONFIG = {
    '南校区': {
        timeSlots: [
            { number: 1, startTime: "08:30", endTime: "09:10" },
            { number: 2, startTime: "09:20", endTime: "10:00" },
            { number: 3, startTime: "10:15", endTime: "10:55" },
            { number: 4, startTime: "11:05", endTime: "11:45" },
            { number: 5, startTime: "14:30", endTime: "15:10" },
            { number: 6, startTime: "15:20", endTime: "16:00" },
            { number: 7, startTime: "16:15", endTime: "16:55" },
            { number: 8, startTime: "17:05", endTime: "17:45" },
            { number: 9, startTime: "19:00", endTime: "19:40" },
            { number: 10, startTime: "19:50", endTime: "20:30" },
            { number: 11, startTime: "20:40", endTime: "21:20" }
        ]
    },
    '北校区': {
        timeSlots: [
            { number: 1, startTime: "08:00", endTime: "08:40" },
            { number: 2, startTime: "08:50", endTime: "09:30" },
            { number: 3, startTime: "09:40", endTime: "10:20" },
            { number: 4, startTime: "10:30", endTime: "11:10" },
            { number: 5, startTime: "11:20", endTime: "12:00" },
            { number: 6, startTime: "14:30", endTime: "15:10" },
            { number: 7, startTime: "15:20", endTime: "16:00" },
            { number: 8, startTime: "16:15", endTime: "16:55" },
            { number: 9, startTime: "17:05", endTime: "17:45" },
            { number: 10, startTime: "19:00", endTime: "19:40" },
            { number: 11, startTime: "19:50", endTime: "20:30" },
            { number: 12, startTime: "20:40", endTime: "21:20" }
        ]
    }
};


// 获取MMPT配置（无需选择，直接使用）
function getMMPTConfig() {
    return MMPT_CONFIG;
}

// 选择校区时间表
async function selectCampusSchedule() {
    const campuses = Object.keys(MMVT_SCHEDULE_CONFIG);
    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区时间表", 
        JSON.stringify(campuses),
        -1
    );
    
    if (campusIndex === null) {
        window.shiguangBridge.showToast("未选择校区，使用南校区时间表");
        return MMVT_SCHEDULE_CONFIG['南校区'];
    }
    
    return MMVT_SCHEDULE_CONFIG[campuses[campusIndex]];
}


// 选择学年
async function selectAcademicYear() {
    const currentYear = new Date().getFullYear();
    const years = [];
    
    // 生成最近3年的学年选项，格式为 xxxx-xxxx
    for (let i = 0; i < 3; i++) {
        const year = currentYear - i;
        years.push(`${year}-${year + 1}`);
    }
    
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", 
        JSON.stringify(years),
        0 // 默认选择当前学年
    );
    
    if (yearIndex === null) {
        return currentYear; // 默认当前学年
    }
    
    return currentYear - yearIndex;
}

// 选择学期
async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", 
        JSON.stringify(semesters),
        -1
    );
    
    if (semesterIndex === null) {
        return "3"; // 默认第一学期
    }
    
    return semesterIndex === 0 ? "3" : "12";
}

// ====================== 获取课程数据 ======================
async function fetchCourseData() {
    try {
        // 使用MMPT配置，让用户选择学年和学期
        const schoolConfig = getMMPTConfig();
        const academicYear = await selectAcademicYear();
        const semester = await selectSemester();
        
        console.log(`使用学校配置: ${schoolConfig.name}`);
        console.log(`选择学年: ${academicYear}, 选择学期: ${semester}`);
        
        // 构建完整的API URL
        const apiUrl = schoolConfig.jwcUrl + schoolConfig.apiPath;
        
        // 从新系统获取课程数据
        // 使用POST请求获取完整的课程数据
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                'xnm': academicYear,   // 用户选择的学年
                'xqm': semester,      // 用户选择的学期（3或12）
                'kzlx': 'ck',         // 课程类型
                'xsdm': '',           // 学生代码
                'kclbdm': ''          // 课程类别代码
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (err) {
        console.error("获取课程数据失败:", err);
        window.shiguangBridge.showToast("获取课程数据失败：" + err.message);
        return null;
    }
}

// ====================== 解析课程数据 ======================
function parseCourseData(responseData) {
    const courses = [];
    
    if (!responseData || !responseData.kbList) {
        console.error("响应数据格式不正确");
        return [];
    }
    
    responseData.kbList.forEach(course => {
        try {
            // 解析节次
            const sections = parseSections(course.jc);
            
            // 解析周次
            const weeks = parseWeeks(course.zcd);
            
            if (weeks.length === 0) {
                console.warn(`课程 ${course.kcmc} 没有有效的周次信息`);
                return;
            }
            
            courses.push({
                name: course.kcmc || "未知课程",
                teacher: course.xm || "未知教师",
                position: course.cdmc || "未知教室",
                day: parseInt(course.xqj) || 1,
                startSection: sections.start,
                endSection: sections.end,
                weeks: weeks
            });
        } catch (err) {
            console.error(`解析课程数据失败:`, err, course);
        }
    });
    
    return courses;
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

// ====================== 导入预设时间段（根据选择的校区） ======================
async function importPresetTimeSlots() {
    try {
        // 让用户选择校区时间表
        const campusConfig = await selectCampusSchedule();
        const timeSlots = campusConfig.timeSlots;
        
        console.log(`使用校区时间表: ${campusConfig.name || '未知校区'}`);
        console.log(`时间段数量: ${timeSlots.length}`);
        
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        if (result === true) {
            window.shiguangBridge.showToast(`时间段导入成功！共导入${timeSlots.length}个时间段`);
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

    try {
        // 1️⃣ 获取课程数据（选择学年学期）
        window.shiguangBridge.showToast("请选择学年和学期...");
        
        // 从新系统获取课程数据
        const responseData = await fetchCourseData();
        if (!responseData) {
            window.shiguangBridge.showToast("获取课程数据失败！");
            return;
        }
        
        // 2️⃣ 解析课程数据
        window.shiguangBridge.showToast("正在解析课程数据...");
        const courses = parseCourseData(responseData);
        if (!courses || courses.length === 0) {
            window.shiguangBridge.showToast("未找到课程数据！");
            return;
        }
        
        // 3️⃣ 合并重复课程
        window.shiguangBridge.showToast("正在合并重复课程...");
        const mergedCourses = mergeDuplicateCourses(courses);
        
        // 4️⃣ 保存课程
        window.shiguangBridge.showToast("正在保存课程数据...");
        const saveResult = await saveCourses(mergedCourses);
        if (!saveResult) {
            return;
        }

        // 5️⃣ 导入预设时间段（用户选择校区）
        window.shiguangBridge.showToast("请选择校区时间表...");
        await importPresetTimeSlots();

        // ✅ 只有所有步骤都成功完成，才通知任务完成
        window.shiguangBridge.showToast(`课程导入成功，共导入 ${mergedCourses.length} 门课程！`);
        console.log("JS：整个导入流程执行完毕并成功。");
        window.shiguangBridge.notifyTaskCompletion();
        
    } catch (err) {
        console.error("导入流程失败:", err);
        window.shiguangBridge.showToast("导入失败：" + err.message);
        // ❌ 失败时不调用 notifyTaskCompletion()
    }
}

// 启动流程
runImportFlow();
