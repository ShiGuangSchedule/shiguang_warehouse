// 铜仁学院 (gztrc.edu.cn) 拾光课程表适配脚本
// 联奕科技教务系统

/**
 * 解析周次字符串为周次数组
 * 支持格式: "2-12;14-18", "2-16 双", "3-17 单", "9;11-12"
 */
function parseWeeks(weeksStr) {
    const result = [];
    // 先按分号分割
    const parts = weeksStr.split(";");
    for (let part of parts) {
        part = part.trim();
        if (!part) continue;
        // 检查是否为单双周格式
        const doubleMatch = part.match(/^(\d+)-(\d+)\s*双$/);
        const singleMatch = part.match(/^(\d+)-(\d+)\s*单$/);
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        const singleWeekMatch = part.match(/^(\d+)$/);
        
        if (doubleMatch) {
            const start = parseInt(doubleMatch[1]);
            const end = parseInt(doubleMatch[2]);
            for (let w = start; w <= end; w++) {
                if (w % 2 === 0) result.push(w);
            }
        } else if (singleMatch) {
            const start = parseInt(singleMatch[1]);
            const end = parseInt(singleMatch[2]);
            for (let w = start; w <= end; w++) {
                if (w % 2 === 1) result.push(w);
            }
        } else if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let w = start; w <= end; w++) {
                result.push(w);
            }
        } else if (singleWeekMatch) {
            result.push(parseInt(singleWeekMatch[1]));
        }
    }
    return result;
}

/**
 * 解析节次字符串（如 "1,2"）为 [startSection, endSection]
 */
function parseSection(sectionStr) {
    const parts = sectionStr.split(",").map(Number).sort((a, b) => a - b);
    return {
        startSection: parts[0],
        endSection: parts[parts.length - 1]
    };
}

/**
 * 从 Cookie 中解析用户信息
 */
function parseUserFromCookie() {
    try {
        const cookies = document.cookie.split(";");
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.startsWith("user=")) {
                const userJson = decodeURIComponent(cookie.substring(5));
                return JSON.parse(userJson);
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 解析课表 API 返回的 JSON 数据
 */
function parseCourseData(jsonData) {
    const courses = [];
    
    for (let item of jsonData.data) {
        const weekInfo = item.week;
        const timeInfo = item.time;
        const courseList = item.courseList || [];
        
        // 教务weekCode: 1=周日,2=周一,3=周二,4=周三,5=周四,6=周五,7=周六
        // 规范day: 1=周一,2=周二,3=周三,4=周四,5=周五,6=周六,7=周日
        const weekCodeMap = { "1": 7, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6 };
        const day = weekCodeMap[weekInfo.weekCode];
        
        for (let course of courseList) {
            const { startSection, endSection } = parseSection(course.time);
            const weeks = parseWeeks(course.weeks);
            
            courses.push({
                name: course.courseName,
                teacher: course.teacherName,
                position: course.classroomName || "未知地点",
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }
    
    return courses;
}

/**
 * 预设时间段数据
 */
function getTimeSlots() {
    return [
        { number: 1,  startTime: "08:00", endTime: "08:45" },
        { number: 2,  startTime: "08:55", endTime: "09:40" },
        { number: 3,  startTime: "10:00", endTime: "10:45" },
        { number: 4,  startTime: "10:55", endTime: "11:40" },
        { number: 5,  startTime: "14:00", endTime: "14:45" },
        { number: 6,  startTime: "14:55", endTime: "15:40" },
        { number: 7,  startTime: "16:00", endTime: "16:45" },
        { number: 8,  startTime: "16:55", endTime: "17:40" },
        { number: 9,  startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" }
    ];
}

/**
 * 获取学期列表
 */
async function fetchSemesterList() {
    const res = await fetch("/api/baseInfo/semester/selectXnXqListTy", {
        method: "GET",
        credentials: "include"
    });
    if (!res.ok) throw new Error("获取学期列表失败");
    const json = await res.json();
    if (json.code !== 200) throw new Error("获取学期列表失败: " + (json.message || "未知错误"));
    
    // 过滤掉无效学期（如 "-2", "-1"）
    return json.data.filter(s => /^\d{4}-\d{4}-\d$/.test(s));
}

/**
 * 获取当前学期信息
 */
async function fetchCurrentSemester() {
    const res = await fetch("/api/baseInfo/semester/selectCurrentXnXq", {
        method: "GET",
        credentials: "include"
    });
    if (!res.ok) throw new Error("获取当前学期失败");
    const json = await res.json();
    if (json.code !== 200) return null;
    return json.data;
}

/**
 * 获取课表数据
 */
async function fetchCourseSchedule(semester, studentId) {
    const body = {
        semester: semester,
        weeks: Array.from({ length: 25 }, (_, i) => i + 1),
        studentId: studentId,
        querySource: "single",
        oddOrDouble: 1,
        startWeek: "1",
        stopWeek: "25"
    };
    
    const res = await fetch("/api/arrange/CourseScheduleAllQuery/studentCourseSchedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("获取课表数据失败");
    const json = await res.json();
    if (json.code !== 200) throw new Error("获取课表数据失败: " + (json.message || "未知错误"));
    return json;
}

/**
 * 主导入流程
 */
async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始导入课表...");
        
        // 1. 解析用户信息
        const userInfo = parseUserFromCookie();
        if (!userInfo || !userInfo.userName) {
            throw new Error("请先在教务系统中登录，再点击导入按钮。");
        }
        const studentId = userInfo.userName;
        
        // 2. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期列表...");
        const semesters = await fetchSemesterList();
        if (!semesters || semesters.length === 0) {
            throw new Error("未能获取学期列表，请确认已登录教务系统。");
        }
        
        // 3. 获取当前学期，确定默认选中项
        let defaultIndex = 0;
        const currentSemester = await fetchCurrentSemester();
        if (currentSemester && currentSemester.semester) {
            const idx = semesters.indexOf(currentSemester.semester);
            if (idx !== -1) defaultIndex = idx;
        }
        
        // 4. 让用户选择学期
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesters),
            defaultIndex
        );
        if (semesterIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const selectedSemester = semesters[semesterIndex];
        
        // 5. 获取课表数据
        window.shiguangBridge.showToast("正在获取课表数据...");
        const courseData = await fetchCourseSchedule(selectedSemester, studentId);
        
        // 6. 解析课程数据
        const courses = parseCourseData(courseData);
        if (!courses || courses.length === 0) {
            throw new Error("未解析到课程数据，可能该学期暂无课表。");
        }
        
        // 7. 保存学期开始日期配置
        if (currentSemester && currentSemester.ksrq) {
            try {
                const config = {
                    semesterStartDate: currentSemester.ksrq,
                    defaultClassDuration: 50,
                    defaultBreakDuration: 10
                };
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            } catch (e) {
                // 忽略配置保存失败
            }
        }
        
        // 8. 保存预设时间段
        const timeSlots = getTimeSlots();
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        } catch (e) {
            window.shiguangBridge.showToast("时间段导入失败，但课程将继续导入。");
        }
        
        // 9. 保存课程数据
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult) {
            window.shiguangBridge.showToast("成功导入 " + courses.length + " 条课程记录！");
            window.shiguangBridge.notifyTaskCompletion();
        }
        
    } catch (e) {
        console.error("[适配脚本错误] " + e.message);
        window.shiguangBridge.showToast("导入失败: " + e.message);
    }
}

// 启动导入流程
runImportFlow();
