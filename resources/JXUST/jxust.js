// 江西理工大学(jxust.edu.cn)拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 预设节次时间
const TimeSlots = [
    { "number": 1, "startTime": "08:30", "endTime": "09:15" },
    { "number": 2, "startTime": "09:20", "endTime": "10:05" }, 
    { "number": 3, "startTime": "10:25", "endTime": "11:10" }, 
    { "number": 4, "startTime": "11:15", "endTime": "12:00" },
    { "number": 5, "startTime": "14:00", "endTime": "14:45" }, 
    { "number": 6, "startTime": "14:50", "endTime": "15:35" },
    { "number": 7, "startTime": "15:55", "endTime": "16:40" }, 
    { "number": 8, "startTime": "16:45", "endTime": "17:30" },
    { "number": 9, "startTime": "19:00", "endTime": "19:45" }, 
    { "number": 10, "startTime": "19:50", "endTime": "20:35" }
];

// 课表配置
const CourseConfig = {
    "semesterTotalWeeks": 20 
};

// 解析周次 (parseWeeks)
function parseWeeks(weeksStr) {
    const weeks = [];
    if (!weeksStr) return weeks;
    const cleanedStr = weeksStr.replace(/\(周\)|\[.*?节\]|<\/?[a-z]+[^>]*>/ig, '').trim(); 
    if (cleanedStr === '') return weeks;

    cleanedStr.split(',').forEach(part => {
        const rangeMatch = part.match(/^(\d+)-(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let i = start; i <= end; i++) {
                weeks.push(i);
            }
        } else {
            const singleWeek = parseInt(part);
            if (!isNaN(singleWeek)) {
                weeks.push(singleWeek);
            }
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 核心解析函数 (parseCourseTable)
function parseCourseTable(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const courseList = [];

    const table = doc.getElementById('kbtable');
    if (!table) {
        window.shiguangBridge.showToast("错误：未找到课表表格 (id=kbtable)。");
        return [];
    }
    
    // 节次映射
    const sectionMap = [
        { start: 1, end: 2 },  
        { start: 3, end: 4 },  
        { start: 5, end: 6 },  
        { start: 7, end: 8 },  
        { start: 9, end: 10 }  
    ];

    const rows = table.querySelectorAll('tr');
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const mapIndex = i - 1; 
        if (mapIndex >= sectionMap.length) continue; 
        const sections = sectionMap[mapIndex];
        
        const cells = row.querySelectorAll('td');

        for (let j = 0; j < cells.length; j++) {
            const cell = cells[j];
            const dayOfWeek = j + 1; 
            const detailDiv = cell.querySelectorAll('div')[1]; 
            
            if (!detailDiv) continue; 

            const rawContent = detailDiv.innerHTML.trim();
            if (rawContent === '' || rawContent.replace(/&nbsp;|<[^>]*>/ig, '').trim() === '') continue; 

            // 多个课程块以分隔符处理
            const courseBlocks = rawContent.split('---------------------<br>');
            
            courseBlocks.forEach(blockHtml => {
                if (blockHtml.trim() === '') return;
                
                const cleanedBlock = blockHtml.replace(/<br\/?>/gi, '\n').trim();
                
                const nameMatch = cleanedBlock.match(/^(.*?)\n/);
                let name = (nameMatch && nameMatch[1].trim()) || "未知课程";
                name = name.replace(/<span[^>]*>.*?<\/span>|<\/?[a-z]+[^>]*>/ig, '').trim(); 
                
                const teacherMatch = cleanedBlock.match(/<font title="老师">([^<]+?)<\/font>/i);
                const teacher = (teacherMatch && teacherMatch[1].trim()) || "暂无教师";

                const positionMatch = cleanedBlock.match(/<font title="教室">([^<]+?)<\/font>/i);
                const position = (positionMatch && positionMatch[1].trim()) || "暂无教室";

                const weeksSectionMatch = cleanedBlock.match(/<font title="周次\(节次\)">([^<]+?)<\/font>/i);
                const weeksSectionStr = (weeksSectionMatch && weeksSectionMatch[1].trim()) || "";

                const weeksArray = parseWeeks(weeksSectionStr);
                
                if (weeksArray.length === 0) {
                    return; 
                }

                const course = {
                    name: name,
                    teacher: teacher,
                    position: position,
                    day: dayOfWeek,             
                    startSection: sections.start,
                    endSection: sections.end,
                    weeks: weeksArray
                };
                
                courseList.push(course);
            });
        }
    }
    
    return courseList;
}

// 网络请求函数
async function fetchCourseHtml() {
    window.shiguangBridge.showToast("正在获取课表数据...");
    const URL = "https://jw.jxust.edu.cn/jsxsd/xskb/xskb_list.do";
    try {
        const response = await fetch(URL, {
            "method": "GET",
            "credentials": "include"
        });
        
        if (!response.ok) {
            throw new Error(`网络请求失败，状态码: ${response.status}`);
        }
        
        const text = await response.text();
        
        window.shiguangBridge.showToast("课表数据获取成功，开始解析...");
        return text;
    } catch (error) {
        window.shiguangBridge.showToast(`网络请求异常: ${error.message}`);
        return null;
    }
}


async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false; 
    }
}

async function saveConfig() {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(CourseConfig));
        window.shiguangBridge.showToast("课表配置更新成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}

async function saveCourses(parsedCourses) {
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("未解析到任何课程数据，跳过保存。");
        return true;
    }
    
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 门课程！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存失败: ${error.message}`);
        return false;
    }
}

async function runImportFlow() {
    
    const LOGIN_URL_START = "https://authserver.jxust.edu.cn/authserver/login";
    if (window.location.href.startsWith(LOGIN_URL_START)) {
        window.shiguangBridge.showToast("错误：当前页面为登录页，请先完成登录后再尝试导入！");
        return;
    }

    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "开始导入",
        "请确保您已登录教务系统",
        "确定"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 获取 HTML
    const htmlContent = await fetchCourseHtml();
    if (htmlContent === null) {
        window.shiguangBridge.showToast("导入终止。");
        return; 
    }
    
    // 解析课程数据
    const parsedCourses = parseCourseTable(htmlContent);
    
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("解析失败或未发现有效课程。导入终止。");
        return;
    }
    
    // 导入时间段数据
    await importPresetTimeSlots(); 

    // 导入课表配置
    if (!await saveConfig()) return;

    // 课程数据保存
    if (!await saveCourses(parsedCourses)) return;

    // 流程成功
    window.shiguangBridge.showToast("所有任务已完成！课表已导入成功！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();