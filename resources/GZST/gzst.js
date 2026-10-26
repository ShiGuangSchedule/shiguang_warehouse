// 广州松田职业技术学院(gzst.edu.cn)拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 预设节次时间
const TimeSlots = [
    { "number": 1, "startTime": "08:20", "endTime": "09:00" },
    { "number": 2, "startTime": "09:05", "endTime": "09:45" }, 
    { "number": 3, "startTime": "09:55", "endTime": "10:35" }, 
    { "number": 4, "startTime": "10:45", "endTime": "11:25" },
    { "number": 5, "startTime": "11:30", "endTime": "12:10" }, 
    { "number": 6, "startTime": "14:20", "endTime": "15:00" },
    { "number": 7, "startTime": "15:05", "endTime": "15:45" }, 
    { "number": 8, "startTime": "15:55", "endTime": "16:35" },
    { "number": 9, "startTime": "16:45", "endTime": "17:25" }, 
    { "number": 10, "startTime": "17:30", "endTime": "18:10" }, 
    { "number": 11, "startTime": "19:30", "endTime": "20:35" }, 
    { "number": 12, "startTime": "20:35", "endTime": "21:40" }
];

// 课表配置
const CourseConfig = {
    "semesterTotalWeeks": 20 
};

/**
 * 验证周次字符串并转换为数字数组
 * 同时移除周次字符串中的节次信息，因为它可能会干扰周次解析。
 * @param {string} weeksStr 课表中的周次字符串，如 "5-15,17(周)[02-03节]"
 * @returns {number[]} 周数数组
 */
function parseWeeks(weeksStr) {
    const weeks = [];
    if (!weeksStr) return weeks;
    // 移除括号内的内容（如 (周)）、[节次] 和 HTML 标签
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

/**
 * 从周次/节次字符串中提取节次范围
 * 修正了多节连排（如 [07-08-09-10节]）只识别到中间节次的问题。
 * @param {string} weeksSectionStr 包含节次信息的字符串
 * @returns {{start: number, end: number} | null} 节次范围对象
 */
function parseSectionsFromStr(weeksSectionStr) {
    // 匹配 [XX-XX节] 或 [XX节] 或 [XX-XX-XX节] 的完整内容
    const fullContentMatch = weeksSectionStr.match(/\[(\d+(?:-\d+)*)节\]/i); 
    
    if (fullContentMatch) {
        const numberString = fullContentMatch[1]; // 例如: "07-08-09-10" 或 "09-10" 或 "10"
        
        // 分割所有数字
        const numbers = numberString.split('-').map(n => parseInt(n));
        
        // 确保数字是有效的
        if (numbers.length > 0 && !isNaN(numbers[0])) {
            const start = numbers[0];
            // 结束节次是数组中的最后一个有效数字
            const end = numbers[numbers.length - 1]; 

            if (start > 0 && end > 0) {
                // 确保 end >= start
                return {
                    start: Math.min(start, end),
                    end: Math.max(start, end)
                };
            }
        }
    }
    return null;
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
    
    const rows = table.querySelectorAll('tr');
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        const cells = row.querySelectorAll('td');

        for (let j = 0; j < cells.length; j++) {
            const cell = cells[j];
            const dayOfWeek = j + 1;
            
            const detailDiv = cell.querySelector('div[class*="kbcontent"][style*="display: none"]'); 
            
            if (!detailDiv) continue; 

            const rawContent = detailDiv.innerHTML.trim();
            // 过滤空内容
            if (rawContent === '' || rawContent.replace(/&nbsp;|<[^>]*>/ig, '').trim() === '') continue; 

            // 多个课程块以分隔符处理
            const courseBlocks = rawContent.split('---------------------<br>');
            
            courseBlocks.forEach(blockHtml => {
                if (blockHtml.trim() === '') return;
                
                const cleanedBlock = blockHtml.replace(/<br\/?>/gi, '\n').trim(); 
                
                // 提取课程名 (第一行)
                const nameMatch = cleanedBlock.match(/^(.*?)(?:\<span.*?\/span\>)?\n/i); 
                let name = (nameMatch && nameMatch[1].trim()) || "未知课程";
                // 移除课程名中的 span 或其他标签
                name = name.replace(/<span[^>]*>.*?<\/span>|<\/?[a-z]+[^>]*>/ig, '').trim(); 
                
                // 提取教师
                const teacherMatch = cleanedBlock.match(/<font title="老师">([^<]+?)<\/font>/i);
                const teacher = (teacherMatch && teacherMatch[1].trim()) || "暂无教师";

                // 提取地点
                const positionMatch = cleanedBlock.match(/<font title="教室">([^<]+?)<\/font>/i);
                const position = (positionMatch && positionMatch[1].trim()) || "暂无教室";

                // 提取周次和节次字符串
                const weeksSectionMatch = cleanedBlock.match(/<font title="周次\(节次\)">([^<]+?)<\/font>/i);
                const weeksSectionStr = (weeksSectionMatch && weeksSectionMatch[1].trim()) || "";

                const sections = parseSectionsFromStr(weeksSectionStr);
                if (!sections) {
                    return; 
                }
                
                // 解析周次数组
                const weeksArray = parseWeeks(weeksSectionStr);
                if (weeksArray.length === 0) {
                    return; // 周次为空，跳过
                }

                const course = {
                    name: name,
                    teacher: teacher,
                    position: position,
                    day: dayOfWeek,             // 周几 (1-7)
                    startSection: sections.start, // 准确的开始节次
                    endSection: sections.end,   // 准确的结束节次
                    weeks: weeksArray           // 周次数组
                };
                
                courseList.push(course);
            });
        }
    }
    
    return courseList;
}

/**
 * 修正后的合并逻辑：先进行精确去重，再合并连续的课程节次。
 * @param {Array} courses 课程列表
 * @returns {Array} 去重并合并后的课程列表
 */
function mergeCourses(courses) {
    if (!courses || courses.length === 0) {
        return [];
    }
    
    // 1. 排序：确保同一天、同一周次、完全相同的课程和连续的课程都排在一起
    courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        const weekA = JSON.stringify(a.weeks);
        const weekB = JSON.stringify(b.weeks);
        if (weekA !== weekB) return weekA.localeCompare(weekB);
        return a.startSection - b.startSection;
    });
    
    // 2. 精确去重
    const uniqueCourses = [];
    const courseSet = new Set(); 
    
    for (const course of courses) {
        // 创建一个包含所有关键属性的唯一 Key
        const key = `${course.name}|${course.teacher}|${course.position}|${course.day}|${course.startSection}|${course.endSection}|${JSON.stringify(course.weeks)}`;
        
        if (!courseSet.has(key)) {
            courseSet.add(key);
            uniqueCourses.push(course);
        }
    }

    if (uniqueCourses.length <= 1) {
        return uniqueCourses;
    }

    // 3. 连续课程合并逻辑
    const mergedCourses = [];
    let currentMergedCourse = { ...uniqueCourses[0] }; 

    for (let i = 1; i < uniqueCourses.length; i++) {
        const nextCourse = uniqueCourses[i];

        const isSameDay = nextCourse.day === currentMergedCourse.day;
        const isSameWeeks = JSON.stringify(nextCourse.weeks) === JSON.stringify(currentMergedCourse.weeks);
        const isSameName = nextCourse.name === currentMergedCourse.name;
        const isSameTeacher = nextCourse.teacher === currentMergedCourse.teacher;
        const isSamePosition = nextCourse.position === currentMergedCourse.position;
        
        // 检查是否连续 (下一节的开始 = 当前节的结束 + 1)
        const isConsecutive = nextCourse.startSection === currentMergedCourse.endSection + 1;

        const canMerge = isSameDay && isSameWeeks && isSameName && isSameTeacher && isSamePosition && isConsecutive;

        if (canMerge) {
            // 合并：更新结束节次
            currentMergedCourse.endSection = nextCourse.endSection;
        } else {
            // 无法合并：推入当前合并结果，并开始新的合并
            mergedCourses.push(currentMergedCourse);
            currentMergedCourse = { ...nextCourse };
        }
    }
    // 推入最后一次合并的结果
    mergedCourses.push(currentMergedCourse);
    
    return mergedCourses;
}


// 网络请求函数
async function fetchCourseHtml() {
    window.shiguangBridge.showToast("正在获取课表数据...");
    const URL = "https://jw.educationgroup.cn/gzstzyxy_jsxsd/xskb/xskb_list.do";
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

async function saveCourses(parsedCourses, originalCount, mergedCount) {
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("未解析到任何课程数据，跳过保存。");
        return true;
    }
    
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        if (originalCount !== undefined && mergedCount !== undefined) {
             window.shiguangBridge.showToast(`课程导入成功！原始 ${originalCount} 条，去重合并 ${mergedCount} 条，最终导入 ${parsedCourses.length} 条。`);
        } else {
             window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 条课程！`);
        }
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存失败: ${error.message}`);
        return false;
    }
}

async function runImportFlow() {
    
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "开始导入",
        "请确保您已登录教务系统，即将获取课表数据并进行课程去重和合并。",
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
    let parsedCourses = parseCourseTable(htmlContent);
    
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("解析失败或未发现有效课程。导入终止。");
        return;
    }
    
    const originalCourseCount = parsedCourses.length;

    // 课程去重和合并
    parsedCourses = mergeCourses(parsedCourses);
    const mergedCount = originalCourseCount - parsedCourses.length; 

    // 导入时间段数据
    await importPresetTimeSlots(); 

    // 导入课表配置
    if (!await saveConfig()) return;

    // 课程数据保存，并传入合并信息
    if (!await saveCourses(parsedCourses, originalCourseCount, mergedCount)) return;

    // 流程成功
    window.shiguangBridge.showToast("所有任务已完成！课表已导入成功！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();