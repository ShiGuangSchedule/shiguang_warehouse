// 广东轻工职业技术大学教务适配器
// 适配器ID: GDIPU_01

// 提示用户输入学期开始日期
const promptForStartDate = async () => {
    try {
        const today = new Date();
        const defaultDate = today.toISOString().split('T')[0];
        
        const startDate = await window.shiguangBridgePromise.showPrompt(
            "请输入学期开始日期",
            "格式：YYYY-MM-DD（例如：2026-02-24）",
            defaultDate,
            "validateDate"
        );
        
        if (startDate === null) {
            throw new Error("用户取消了输入");
        }
        
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            window.shiguangBridge.showToast("日期格式不正确，请使用YYYY-MM-DD格式");
            throw new Error("日期格式不正确");
        }
        
        return startDate;
    } catch (error) {
        console.error("获取开始日期失败:", error);
        throw error;
    }
};

// 日期验证函数（供AndroidBridge调用）
function validateDate(dateStr) {
    if (!dateStr) {
        return "日期不能为空";
    }
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return "日期格式不正确，请使用YYYY-MM-DD格式";
    }
    
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        return "无效的日期";
    }
    
    return false;
}

// 获取课程表数据
const fetchTimetable = async (date) => {
    try {
        const response = await fetch('https://jw.gdipu.edu.cn/jsxsd/framework/main_index_loadkb.jsp', {
            method: 'POST',
            headers: {
                'Accept': 'text/html, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': 'https://jw.gdipu.edu.cn',
                'Referer': window.location.href,
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include',
            body: `rq=${date}`
        });
        
        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 检查是否有课程
        const hasCourses = checkIfHasCourses(html);
        
        return { html, hasCourses };
    } catch (error) {
        console.error('获取课程表失败:', error);
        throw error;
    }
};

// 检查HTML中是否有课程
const checkIfHasCourses = (html) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const table = doc.querySelector('form table.kb_table');
    if (!table) {
        return false;
    }
    
    const courseCells = table.querySelectorAll('td p[title]');
    return courseCells.length > 0;
};

// 从HTML字符串解析课程表
const parseTimetableFromHTML = (html, date) => {
    const courses = [];
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const table = doc.querySelector('form table.kb_table');
    if (!table) {
        console.error('未找到课程表表格');
        return courses;
    }
    
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach((row) => {
        const sectionCell = row.querySelector('td:first-child');
        if (!sectionCell) return;
        
        const sectionText = sectionCell.textContent.trim().split('\n')[0];
        const sectionInfo = parseSection(sectionText);
        
        // 遍历星期几的列（从第2列到第8列）
        for (let colIndex = 1; colIndex <= 7; colIndex++) {
            const dayCell = row.querySelector(`td:nth-child(${colIndex + 1})`);
            if (!dayCell) continue;
            
            const courseP = dayCell.querySelector('p[title]');
            if (!courseP) continue;
            
            const title = courseP.getAttribute('title');
            const courseInfo = parseCourseFromTitle(title);
            
            const timeInfo = parseTimeInfo(courseInfo.time || '');
            
            let dayOfWeek;
            if (timeInfo.day && timeInfo.day > 0) {
                dayOfWeek = timeInfo.day;
            } else {
                // 列索引映射：1->星期一(1), 2->星期二(2), 3->星期三(3), 4->星期四(4), 5->星期五(5), 6->星期六(6), 7->星期日(7)
                dayOfWeek = colIndex;
            }
            
            // 将跨节课程拆分为多个单节课程
            const startSection = sectionInfo.startSection;
            const endSection = sectionInfo.endSection;
            
            for (let section = startSection; section <= endSection; section++) {
                const course = {
                    name: courseInfo.name || '',
                    teacher: '', // 这个系统似乎没有教师信息
                    position: courseInfo.location || '',
                    day: dayOfWeek,
                    startSection: section,
                    endSection: section, // 单节课，开始和结束节次相同
                    weeks: timeInfo.weeks.length > 0 ? timeInfo.weeks : [1] // 暂时使用第1周
                };
                
                courses.push(course);
            }
        }
    });
    
    return courses;
};

// 从title属性解析课程信息
const parseCourseFromTitle = (title) => {
    const info = {};
    
    const creditMatch = title.match(/课程学分：([\d.]+)/);
    const propertyMatch = title.match(/课程属性：([^<]+)/);
    const nameMatch = title.match(/课程名称：([^<]+)/);
    const timeMatch = title.match(/上课时间：([^<]+)/);
    const locationMatch = title.match(/上课地点：([^<]+)/);
    const campusMatch = title.match(/上课校区：([^<]+)/);
    const groupMatch = title.match(/分组名：([^<]+)/);
    
    if (creditMatch) info.credit = creditMatch[1];
    if (propertyMatch) info.property = propertyMatch[1].trim();
    if (nameMatch) info.name = nameMatch[1].trim();
    if (timeMatch) info.time = timeMatch[1].trim();
    if (locationMatch) info.location = locationMatch[1].trim();
    if (campusMatch) info.campus = campusMatch[1].trim();
    if (groupMatch) info.group = groupMatch[1].trim();
    
    return info;
};

// 解析上课时间字符串
const parseTimeInfo = (timeStr) => {
    const result = {
        weeks: [],
        day: 0,
        startSection: 0,
        endSection: 0
    };
    
    // 解析周数范围
    const weekMatch = timeStr.match(/第(\d+)(?:-(\d+))?周/);
    if (weekMatch) {
        const startWeek = parseInt(weekMatch[1], 10);
        if (weekMatch[2]) {
            const endWeek = parseInt(weekMatch[2], 10);
            for (let week = startWeek; week <= endWeek; week++) {
                result.weeks.push(week);
            }
        } else {
            result.weeks.push(startWeek);
        }
    }
    
    // 解析星期几
    const dayMap = {
        '星期一': 1,
        '星期二': 2,
        '星期三': 3,
        '星期四': 4,
        '星期五': 5,
        '星期六': 6,
        '星期日': 7
    };
    
    for (const [dayStr, dayNum] of Object.entries(dayMap)) {
        if (timeStr.includes(dayStr)) {
            result.day = dayNum;
            break;
        }
    }
    
    // 解析节次
    const sectionMatch = timeStr.match(/\[(\d+)-(\d+)\]/);
    if (sectionMatch) {
        result.startSection = parseInt(sectionMatch[1], 10);
        result.endSection = parseInt(sectionMatch[2], 10);
    }
    
    return result;
};

// 解析节次字符串
const parseSection = (sectionStr) => {
    const result = {
        startSection: 0,
        endSection: 0
    };
    
    if (sectionStr.includes('-')) {
        const parts = sectionStr.split('-');
        result.startSection = parseInt(parts[0], 10);
        result.endSection = parseInt(parts[1], 10);
    } else {
        result.startSection = parseInt(sectionStr, 10);
        result.endSection = parseInt(sectionStr, 10);
    }
    
    return result;
};

// 获取学期配置
const getSemesterConfig = (startDate, totalWeeks) => {
    return {
        semesterStartDate: startDate,
        totalWeeks: totalWeeks
    };
};

// 获取时间段配置
const getTimeSlots = (html) => {
    // 北区有14节课，使用准确时间配置
    return [
        { number: 1, startTime: "08:30", endTime: "09:10" },
        { number: 2, startTime: "09:15", endTime: "09:55" },
        { number: 3, startTime: "10:15", endTime: "10:55" },
        { number: 4, startTime: "11:00", endTime: "11:40" },
        { number: 5, startTime: "11:45", endTime: "12:25" },
        { number: 6, startTime: "13:15", endTime: "13:55" },
        { number: 7, startTime: "14:00", endTime: "14:40" },
        { number: 8, startTime: "14:45", endTime: "15:25" },
        { number: 9, startTime: "15:45", endTime: "16:25" },
        { number: 10, startTime: "16:30", endTime: "17:10" },
        { number: 11, startTime: "17:15", endTime: "17:55" },
        { number: 12, startTime: "19:30", endTime: "20:10" },
        { number: 13, startTime: "20:15", endTime: "20:55" },
        { number: 14, startTime: "21:00", endTime: "21:40" },
    ];
};

// 保存课程数据
const saveSchedule = async (courses, courseConfig, timeSlots) => {
    try {
        await Promise.allSettled([
            window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig)),
            window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses)),
            window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots))
        ]);
        
        window.shiguangBridge.showToast("课程表导入成功！");
        return true;
    } catch (error) {
        console.error("保存课程数据时出错:", error);
        window.shiguangBridge.showToast("课程表导入失败：" + error.message);
        return false;
    }
};

// 日期增加指定天数
const addDays = (dateStr, days) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
};

// 判断日期是否是周日（0=周日，1=周一，...，6=周六）
const isSunday = (dateStr) => {
    const date = new Date(dateStr);
    return date.getDay() === 0; // 0表示周日
};

// 获取多周课程表
const fetchMultiWeekTimetable = async (startDate) => {
    const allCourses = [];
    
    //如果起始日期是周日，请求日期就-1
    let requestDate = startDate;
    if (isSunday(startDate)) {
        requestDate = addDays(startDate, -1);
    }
    
    let weekCount = 0;
    let timeSlots = null;
    
    window.shiguangBridge.showToast("正在获取课程表数据，请稍候...");
    
    while (true) {
        weekCount++;
        
        try {
            const { html, hasCourses } = await fetchTimetable(requestDate);
            
            if (weekCount === 1) {
                timeSlots = getTimeSlots(html);
            }
            
            const weekCourses = parseTimetableFromHTML(html, requestDate);
            
            if (weekCourses.length > 0) {
                allCourses.push(...weekCourses);
                console.log(`第${weekCount}周: 找到 ${weekCourses.length} 门课程`);
            }
            
            if (!hasCourses) {
                console.log(`第${weekCount}周: 没有课程，停止获取`);
                break;
            }
            
            requestDate = addDays(requestDate, 7);
            
            if (weekCount >= 20) {
                console.log("达到最大周数限制（20周），停止获取");
                break;
            }
        } catch (error) {
            console.error(`获取第${weekCount}周课程表失败:`, error);
            window.shiguangBridge.showToast(`第${weekCount}周获取失败，继续下一周`);
            requestDate = addDays(requestDate, 7);
            continue;
        }
    }
    
    return {
        courses: allCourses,
        totalWeeks: weekCount,
        timeSlots: timeSlots || getTimeSlots('')
    };
};

// 主函数
(async () => {
    try {
        window.shiguangBridge.showToast("正在启动GDIPU课程表导入...");
        
        const startDate = await promptForStartDate();
        
        const { courses, totalWeeks, timeSlots } = await fetchMultiWeekTimetable(startDate);
        
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程信息");
            throw new Error("未找到课程信息");
        }
        
        console.log(`总共找到 ${courses.length} 门课程，共 ${totalWeeks} 周`);
        
        const courseConfig = getSemesterConfig(startDate, totalWeeks);
        
        const success = await saveSchedule(courses, courseConfig, timeSlots);
        
        if (success) {
            window.shiguangBridge.notifyTaskCompletion();
        } else {
            throw new Error("保存课程数据失败");
        }
        
    } catch (error) {
        console.error("导入课程表时出错:", error);
        window.shiguangBridge.showToast("导入课程表失败：" + error.message);
    }
})();