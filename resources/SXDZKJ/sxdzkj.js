// 山西电子科技学院(sxdzkj.edu.cn) 拾光课程表适配脚本
// 基于青果教务系统适配
// 适配器ID: SXDZKJ

async function checkLoginEnvironment() {
    const currentUrl = window.location.href;
    if (currentUrl.includes("sso.sxdzkj.edu.cn/sso-auth") || currentUrl.includes("cas/login")) {
        window.shiguangBridge.showToast("请先登录教务系统再进行导入");
        return false;
    }
    return true;
}

function parseWeeks(weekStr) {
    const weeks = [];
    const groups = weekStr.split(',');
    groups.forEach(group => {
        const isSingle = group.includes('单');
        const isDouble = group.includes('双');
        const rangeMatch = group.match(/(\d+)-(\d+)/);
        
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let i = start; i <= end; i++) {
                if (isSingle && i % 2 === 0) continue;
                if (isDouble && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            const num = parseInt(group.replace(/[^\d]/g, ''));
            if (!isNaN(num)) weeks.push(num);
        }
    });
    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

function encodeParams(params) {
    return btoa(params);
}

const dayMap = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7
};

function parseScheduleString(scheduleStr, teacher, courseName) {
    const results = [];
    if (!scheduleStr || scheduleStr.trim() === '') return results;

    const sessions = scheduleStr.split('；').map(s => s.trim()).filter(s => s);

    sessions.forEach(session => {
        // 有地点: "1-16周 三[7-8] 南-317(115)" / "1-16周(单) 一[5-6] 南-311(115)"
        // 无地点: "1-16周 三[5-6]"
        const match = session.match(/([\d\-]+周(?:\([单双]\))?)\s+([一二三四五六日天])\[(\d+\-\d+)\](?:\s*(.*))?/);
        if (match) {
            const weekStr = match[1];
            const dayChar = match[2];
            const sectionStr = match[3];
            const position = (match[4] || "").trim();

            const weeks = parseWeeks(weekStr);
            const day = dayMap[dayChar];
            const sections = sectionStr.split('-').map(Number);

            if (weeks.length > 0 && day && sections.length === 2) {
                results.push({
                    name: courseName,
                    teacher: teacher,
                    position: position,
                    day: day,
                    startSection: sections[0],
                    endSection: sections[1],
                    weeks: weeks
                });
            }
        }
    });

    return results;
}

function parseCourseData(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const allCourses = [];

    const allTables = doc.querySelectorAll('table');
    if (allTables.length === 0) {
        console.warn("未找到表格");
        return [];
    }

    // 课程列表（含上课时间地点列）
    allTables.forEach(table => {
        if (!/上课时间地点/.test(table.textContent)) return;
        allCourses.push(...parseCourseList(table));
    });

    console.log("解析完成，共课程条目:", allCourses.length);
    return allCourses;
}

function parseCourseList(table) {
    const courses = [];
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        // 课程列表：第3列课程、第7列教师、第11列时间地点
        if (cells.length < 11) return;
        const courseCell = cells[2];
        const teacherCell = cells[6];
        const scheduleCell = cells[10];
        const courseName = courseCell.textContent.trim().replace(/\[.*?\]/g, '');
        const teacher = teacherCell.textContent.trim().replace(/\[.*?\]/g, '');
        const scheduleStr = scheduleCell.textContent.trim();
        if (!scheduleStr) return;
        const parsed = parseScheduleString(scheduleStr, teacher, courseName);
        courses.push(...parsed);
    });
    return courses;
}

async function getYearAndSemester() {
    const currentYear = new Date().getFullYear();
    const yearStr = await window.shiguangBridgePromise.showPrompt(
        "输入学年",
        "请输入学年（如 2025-2026 输入2025）:",
        currentYear.toString(),
        "validateYearInput"
    );
    
    if (yearStr === null) return null;
    
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        0
    );
    
    if (semesterIndex === null) return null;
    
    return {
        xn: yearStr,
        xq: semesterIndex === 0 ? "0" : "1"
    };
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年！";
    }
}

async function fetchCourses(xn, xq) {
    try {
        window.shiguangBridge.showToast("正在获取课表数据...");
        
        let xh = "";
        try {
            const userCodeMatch = document.cookie.match(/userCode[=:]([^;]+)/);
            if (userCodeMatch) xh = userCodeMatch[1];
        } catch (e) {}
        
        if (!xh) {
            xh = await window.shiguangBridgePromise.showPrompt(
                "输入学号",
                "请输入你的学号:",
                "",
                null
            );
            if (!xh) return [];
        }
        
        console.log("使用参数:", { xn, xq, xh });
        
        const paramStr = `xn=${xn}&xq=${xq}&xh=${xh}`;
        const encodedParams = encodeParams(paramStr);
        
        const url = `https://jwxt.sxdzkj.edu.cn/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=${encodedParams}`;
        
        console.log("请求课表数据:", url);
        
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });
        
        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        let text;
        try {
            text = new TextDecoder('gbk').decode(arrayBuffer);
        } catch (e) {
            text = new TextDecoder('utf-8').decode(arrayBuffer);
        }
        
        console.log("课表响应长度:", text.length);
        
        return parseCourseData(text);
    } catch (error) {
        window.shiguangBridge.showToast("获取课表失败: " + error.message);
        console.error("获取课表失败:", error);
        return [];
    }
}

async function importPresetTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:50" },
        { "number": 2, "startTime": "09:00", "endTime": "09:50" },
        { "number": 3, "startTime": "10:10", "endTime": "11:00" },
        { "number": 4, "startTime": "11:10", "endTime": "12:00" },
        { "number": 5, "startTime": "14:00", "endTime": "14:50" },
        { "number": 6, "startTime": "15:00", "endTime": "15:50" },
        { "number": 7, "startTime": "16:10", "endTime": "17:00" },
        { "number": 8, "startTime": "17:10", "endTime": "18:00" },
        { "number": 9, "startTime": "19:00", "endTime": "19:50" },
        { "number": 10, "startTime": "20:00", "endTime": "20:50" }
    ];
    
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        window.shiguangBridge.showToast("时间段导入成功");
    } catch (error) {
        console.error("导入时间段失败:", error);
    }
}

async function runImportFlow() {
    const isReady = await checkLoginEnvironment();
    if (!isReady) return;
    
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "教务导入",
        "山西电子科技学院课表导入\n\n请确保已登录教务系统。\n点击确定开始导入。",
        "确定导入"
    );
    if (!confirmed) return;
    
    const semesterParams = await getYearAndSemester();
    if (!semesterParams) {
        window.shiguangBridge.showToast("导入已取消");
        return;
    }
    
    console.log("选择的学期:", semesterParams);
    
    const courses = await fetchCourses(semesterParams.xn, semesterParams.xq);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未找到课程数据");
        return;
    }
    
    console.log("解析到的课程:", courses);
    
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast(`成功保存 ${courses.length} 门课程`);
    } catch (error) {
        window.shiguangBridge.showToast("保存课程失败: " + error.message);
        return;
    }
    
    await importPresetTimeSlots();
    
    window.shiguangBridge.showToast(`导入完成！共 ${courses.length} 条课程记录`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
