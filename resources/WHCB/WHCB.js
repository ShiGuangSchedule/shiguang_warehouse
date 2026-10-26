
// 节次对应的时间映射表
const TimeSlots = {
    1: { start: "08:10", end: "08:55" },
    2: { start: "09:05", end: "09:50" },
    3: { start: "10:10", end: "10:55" },
    4: { start: "11:05", end: "11:50" },
    5: { start: "12:00", end: "12:45" },
    6: { start: "13:05", end: "13:50" },
    7: { start: "14:00", end: "14:45" },
    8: { start: "14:55", end: "15:40" },
    9: { start: "16:00", end: "16:45" },
    10: { start: "16:55", end: "17:40" },
    11: { start: "19:00", end: "19:45" },
    12: { start: "19:55", end: "20:40" }
};
// 解析课程名称
function parseCourseName(text) {
    if (!text) return "";
    const match = text.match(/^([^\[\]]+)/);
    return match ? match[1].trim() : text.trim();
}

// 解析教室信息
function parseClassroom(text) {
    if (!text) return "";
    const parts = text.split(',');
    if (parts.length >= 3) return parts[parts.length - 1].trim();
    if (parts.length === 2) return parts[1].trim();
    return text.trim();
}

// 解析节次范围
function parseSections(roomText) {
    if (!roomText) return { start: 1, end: 1 };
    
    const match = roomText.match(/(\d+)-(\d+)\s*[节]?$/);
    if (match) return { start: parseInt(match[1]), end: parseInt(match[2]) };
    
    const parts = roomText.split(',');
    for (const part of parts) {
        const sectionMatch = part.match(/(\d+)-(\d+)/);
        if (sectionMatch && !part.includes('周')) {
            return { start: parseInt(sectionMatch[1]), end: parseInt(sectionMatch[2]) };
        }
    }
    
    return { start: 1, end: 1 };
}

// 解析周次信息
function parseWeeksFromRoom(roomText) {
    if (!roomText) return [];
    
    const weeks = new Set();
    const weekPatterns = roomText.match(/(\d+)(?:-(\d+))?周/g);
    
    if (weekPatterns) {
        weekPatterns.forEach(pattern => {
            const match = pattern.match(/(\d+)(?:-(\d+))?周/);
            if (match) {
                const startWeek = parseInt(match[1]);
                const endWeek = match[2] ? parseInt(match[2]) : startWeek;
                for (let week = startWeek; week <= endWeek; week++) weeks.add(week);
            }
        });
    }
    
    return Array.from(weeks).sort((a, b) => a - b);
}

// 提取课程数据
function extractCourses() {
    const courses = [];
    const courseCells = document.querySelectorAll('td[data-role="item"]');
    
    courseCells.forEach(cell => {
        const courseDivs = cell.querySelectorAll('.mtt_arrange_item');
        if (courseDivs.length === 0) return;
        
        const day = parseInt(cell.getAttribute('data-week') || "1");
        const beginUnit = parseInt(cell.getAttribute('data-begin-unit') || "1");
        const endUnit = parseInt(cell.getAttribute('data-end-unit') || beginUnit);
        const startSection = Math.min(beginUnit, endUnit);
        const endSection = Math.max(beginUnit, endUnit);
        
        courseDivs.forEach(courseDiv => {
            const detailDiv = courseDiv.querySelector('.mtt_item_kcmc');
            if (!detailDiv) return;
            
            const courseNameNode = detailDiv.firstChild;
            const rawCourseName = courseNameNode?.nodeValue?.trim() || "";
            if (!rawCourseName) return;
            
            const teacherElement = detailDiv.querySelector('.mtt_item_jxbmc');
            const teacher = teacherElement?.innerText?.trim() || "";
            
            const roomElement = detailDiv.querySelector('.mtt_item_room');
            const rawRoomText = roomElement?.innerText?.trim() || "";
            
            const weeks = parseWeeksFromRoom(rawRoomText);
            if (weeks.length === 0) return;
            
            const position = parseClassroom(rawRoomText);
            
            let finalStartSection = startSection;
            let finalEndSection = endSection;
            
            if (startSection === 1 && endSection === 1) {
                const sections = parseSections(rawRoomText);
                finalStartSection = sections.start;
                finalEndSection = sections.end;
            }
            
            const course = {
                name: parseCourseName(rawCourseName),
                teacher: teacher,
                position: position,
                day: day,
                startSection: finalStartSection,
                endSection: finalEndSection,
                weeks: weeks
            };
            
            if (course.name && course.weeks.length > 0) courses.push(course);
        });
    });
    
    return courses;
}

// 合并重复课程
function mergeCourses(courses) {
    const courseMap = new Map();
    
    courses.forEach(course => {
        const key = `${course.name}-${course.teacher}-${course.day}-${course.startSection}-${course.endSection}-${course.position}`;
        
        if (courseMap.has(key)) {
            const existing = courseMap.get(key);
            const mergedWeeks = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b);
            existing.weeks = mergedWeeks;
            courseMap.set(key, existing);
        } else {
            courseMap.set(key, { ...course });
        }
    });
    
    return Array.from(courseMap.values());
}

// 排序课程
function sortCourses(courses) {
    return courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.endSection - b.endSection;
    });
}

// 生成时间段数据
function generateTimeSlots() {
    return Object.entries(TimeSlots).map(([number, time]) => ({
        number: parseInt(number),
        startTime: time.start,
        endTime: time.end
    }));
}

// 生成配置数据
function generateConfig(courses) {
    let maxWeek = 0;
    courses.forEach(course => {
        course.weeks.forEach(week => {
            if (week > maxWeek) maxWeek = week;
        });
    });
    return {
        semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,//不确定以后会不会改，先留着
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1
    };
}
//登录检测
async function login(){
    const promptMessage =`
使用前请注意：
1、开始导入前,请确保自己已经登录并进入课表
2、导入过程中请保持网络连接畅通
3、导入完成后如学期周数等信息错误请前往设置调整
4、导入完成后请前往设置自行设置开学时间
5、本工具仅支持导入当前学期课程
6、学校服务器很烂,课表数据可能加载较慢,请耐心等待
7、如果没有进入界面请前往学校学生门户登录并在新教务系统中打开课表后尝试导入
`;
    const wspc = "authserver.wspc.edu.cn";
    const timeTable = "jw.wspc.edu.cn";
    const currentHost = window.location.host;
    const confirmed = await window.shiguangBridgePromise.showAlert(
    "使用前请注意",
    promptMessage,
    "好的"
    );
    if (confirmed) {
        if (currentHost == wspc) {
        window.shiguangBridge.showToast("请先登录");
        return false;
        }
        else if (currentHost ==timeTable) {
            return true;
        }
        else
            window.shiguangBridge.showToast("请在学校的网站内导入");
        }
    else {
        window.shiguangBridge.showToast("取消导入操作");
        return false;
    }
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 门课程！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存失败: ${error.message}`);
        return false;
    }
}

async function importPresetTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
        return true; // 添加返回值
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false; // 添加返回值
    }
}

async function saveConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast("课表配置更新成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    const loginwindows = await login();
    if(!loginwindows){
        return;
    }
    // 提取课程数据
    const rawCourses = extractCourses();
    if(rawCourses.length === 0){
        window.shiguangBridge.showToast("未找到任何课程! 请确认已登录并进入课表页面。");
        return;
    }
    const mergedCourses = mergeCourses(rawCourses);
    if(mergedCourses.length === 0){
        window.shiguangBridge.showToast("课程合并失败，未生成任何课程数据！");
        return;
    }
    const finalCourses = sortCourses(mergedCourses);
    if(finalCourses.length === 0){
        window.shiguangBridge.showToast("课程排序失败，未生成任何课程数据！");
        return;
    } 
    // 生成时间段数据
    const timeSlots = generateTimeSlots();
    if(timeSlots.length === 0){
        window.shiguangBridge.showToast("时间段生成失败，未生成任何时间段数据！");
        return;
    }
    // 生成配置数据
    const config = generateConfig(finalCourses);
    // 输出课程数据结构
    const saveResult = await saveCourses(finalCourses);
    if(!saveResult){
        return;
    }
    // 输出时间段数据结构
    const timeSlotResult = await importPresetTimeSlots(timeSlots);
    if(!timeSlotResult){
        return;
    }
    // 输出课表配置数据结构
    const configResult = await saveConfig(config);
    if(!configResult){
        return;
    }
    window.shiguangBridge.showToast("成功导入课表！请前往设置调整开学时间等信息！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 执行
runImportFlow();