/**
 * 湖南商务职业技术学院教务系统(hnvcc.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

/**
 * 定义一个全局的学年验证函数。
 */
window.validateYearInput = function(input) {
    // 检查输入是否为四位数字
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    } else {
        return "请输入四位数字的学年！";
    }
}

/**
 * 验证周次字符串并转换为数字数组
 * @param {string} weekStr 课表中的周次字符串
 * @returns {number[]} 周数数组
 */
function parseWeeks(weekStr) {
    const weeks = [];
    // 匹配 "第...周" 或 "第...(..."，提取中间的范围部分
    const match = weekStr.match(/第(.*?)(周|\()/); 
    if (!match) return weeks;

    const ranges = match[1].split(','); 

    for (const range of ranges) {
        // 兼容处理 1-10 或 10 这样的数字
        const parts = range.split('-');
        if (parts.length === 2) {
            let start = parseInt(parts[0].trim());
            let end = parseInt(parts[1].trim());
            if (start > end) [start, end] = [end, start];
            
            for (let i = start; i <= end; i++) {
                if (!weeks.includes(i)) {
                    weeks.push(i);
                }
            }
        } else if (parts.length === 1) {
            const week = parseInt(parts[0].trim());
            if (!isNaN(week) && !weeks.includes(week)) {
                weeks.push(week);
            }
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 解析节次字符串为开始和结束节次 
 * 允许字符串包含其他文本（如 "第一大节\n第1-2节"），只要包含数字范围即可。
 * @param {string} sectionStr 课表的节次行标题（包含文字和数字）
 * @returns {{start: number, end: number} | null}
 */
function parseSections(sectionStr) {
    // 1. 尝试匹配范围格式：匹配 (\d+)-(\d+)
    let match = sectionStr.match(/(\d+)\s*-\s*(\d+)/);
    if (match) {
        return {
            start: parseInt(match[1]),
            end: parseInt(match[2])
        };
    }
    
    // 2. 尝试匹配单个节次格式：匹配单个 (\d+)
    match = sectionStr.match(/(\d+)/); 
    if (match) {
        const section = parseInt(match[1]);
        // 忽略小于 1 的数字，避免解析到其他无关的数字
        if (section > 0) {
            return {
                start: section,
                end: section
            };
        }
    }
    
    // 3. 都没有匹配到，返回 null
    return null;
}


/**
 * 异步获取教务系统课表 HTML 内容，并用 DOMParser 转换成 Document 对象。
 * @param {string} xnxqid 学年学期ID
 * @returns {Document | null} 解析后的 Document 对象或 null
 */
async function fetchTimetable(xnxqid) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    
    // 完整的 URL 路径
    const url = `http://jwxt.hnvcc.edu.cn/jsxsd/framework/mainV_index_loadkb.htmlx?rq=all&xnxqid=${xnxqid}&xswk=false`;

    try {
        const response = await fetch(url, {
            "body": null,
            "mode": "cors",
            "credentials": "include" // 确保携带了教务系统的登录Session
        });

        if (!response.ok) {
            window.shiguangBridge.showToast(`网络响应错误，状态码: ${response.status}。请检查登录状态。`);
            return null;
        }

        const htmlData = await response.text();
        window.shiguangBridge.showToast("数据获取成功，开始解析 HTML...");
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlData, "text/html");

        return doc;

    } catch (error) {
        window.shiguangBridge.showToast(`请求过程中发生错误: ${error.message}`);
        return null;
    }
}


/**
 * 主要解析逻辑：从 Document 对象中提取课程数据
 * @param {Document} doc - 包含课表数据的 Document 对象
 * @returns {{courses: object[], config: object} | null}
 */
function parseTimetable(doc) {
    const courses = [];
    let parsedRowCount = 0; 
    const timetable = doc.getElementById('timetable');
    
    if (!timetable) {
        window.shiguangBridge.showToast("HTML 中未找到课表表格 #timetable。");
        return null;
    }

    // 尝试从 li_showWeek 元素中提取总周数，默认 20
    const totalWeeksElement = doc.getElementById('li_showWeek');
    const totalWeeksMatch = (totalWeeksElement ? totalWeeksElement.innerHTML : '').match(/\/(\d+)周/);
    const semesterTotalWeeks = totalWeeksMatch ? parseInt(totalWeeksMatch[1]) : 20;

    const rows = timetable.querySelectorAll('tbody > tr');

    rows.forEach((row, rowIndex) => {
        
        const allCells = row.querySelectorAll('td');

        // 1. 过滤掉不符合格式的行（如备注行或空行）
        if (allCells.length < 2 || row.querySelector('td[colspan="7"]')) {
            return;
        }

        const sectionCell = allCells[0]; 
        // 提取节次单元格的纯文本
        const sectionText = sectionCell.innerText.trim();
        const sections = parseSections(sectionText); 

        if (!sections) {
            return; 
        }
        
        parsedRowCount++;

        // 遍历周一到周日
        for (let day = 1; day <= 7; day++) {
            const cellIndex = day; 
            const dayCell = allCells[cellIndex]; 
            
            if (!dayCell) continue;

            // 获取详细课程信息的容器
            const itemBoxes = dayCell.querySelectorAll('.item-box');
            
            itemBoxes.forEach(box => {
                
                // 优化：只选择 .item-box 的直接子元素 <p>，避免任何可能的嵌套干扰
                const courseNamePs = box.querySelectorAll(':scope > p'); 

                courseNamePs.forEach(nameP => {
                    try {
                        const name = nameP.innerText.trim();
                        if (!name) return; // 课程名为空，跳过

                        // 查找紧随 P 标签的 .tch-name 元素（包含教师和学分）
                        let tchNameDiv = nameP.nextElementSibling;
                        while (tchNameDiv && (tchNameDiv.nodeType !== 1 || !tchNameDiv.classList.contains('tch-name'))) {
                            tchNameDiv = tchNameDiv.nextElementSibling;
                        }

                        if (!tchNameDiv || !tchNameDiv.classList.contains('tch-name')) {
                            // 未找到教师信息，跳过
                            return; 
                        }
                        
                        // 提取教师
                        const teacherSpan = tchNameDiv.querySelector('span:nth-child(1)');
                        const teacher = teacherSpan ? teacherSpan.innerText.replace('教师：', '').trim() : '';

                        // 2. 查找地点/周次 Div
                        let infoDiv = null;
                        let currentElement = tchNameDiv.nextElementSibling;

                        while (currentElement) {
                            // 目标 Location/Week DIV: 必须是 DIV 且包含位置图标
                            if (currentElement.tagName === 'DIV' && currentElement.querySelector('img[src*="item1.png"]')) {
                                infoDiv = currentElement;
                                break; 
                            }
                            
                            // 遇到下一个课程名 P 标签，停止搜索
                            if (currentElement.tagName === 'P') {
                                break; 
                            }

                            currentElement = currentElement.nextElementSibling;
                        }

                        if (!infoDiv) {
                            // 未找到地点/周次信息，跳过
                            return; 
                        }
                        
                        // 提取地点和周次
                        let position = '';
                        let weekText = '';

                        const infoSpans = infoDiv.querySelectorAll('span');
                        if (infoSpans.length >= 1) {
                            position = infoSpans[0].innerText.trim(); 
                        }
                        if (infoSpans.length >= 2) {
                            weekText = infoSpans[1].innerText.trim();
                        }
                        
                        // 3. 构造课程对象
                        const weeksArray = parseWeeks(weekText);
                        
                        if (weeksArray.length > 0) {
                            const newCourse = {
                                name: name,
                                teacher: teacher,
                                position: position,
                                day: day, // 1=周一, 7=周日
                                startSection: sections.start,
                                endSection: sections.end,
                                weeks: weeksArray
                            };
                            courses.push(newCourse);
                        } 

                    } catch (e) {
                        // 保留 error 级别的日志以防关键错误被忽略
                        console.error(`解析课程时发生未预期的错误: ${e.message}`, e);
                    }
                }); 
            }); 
        }
    });
    
    // 构造配置对象
    const config = {
        semesterTotalWeeks: semesterTotalWeeks,
        firstDayOfWeek: 1 // 一周的第一天是周一
    };

    return { courses, config };
}

/**
 * 合并连续的课程节次
 * 合并条件：同一天、同一周次、同一课程名、同一教师、同一地点，且节次连续。
 * @param {object[]} courses 待合并的课程列表
 * @returns {object[]} 合并后的课程列表
 */
function mergeCourses(courses) {
    if (!courses || courses.length === 0) {
        return [];
    }
    
    // 1. 排序：确保同一天、同一周次的课程按节次顺序排列
    courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        const weekA = JSON.stringify(a.weeks);
        const weekB = JSON.stringify(b.weeks);
        if (weekA !== weekB) return weekA.localeCompare(weekB);
        return a.startSection - b.startSection;
    });

    const mergedCourses = [];
    // 初始化第一个课程为当前的合并起点
    let currentMergedCourse = { ...courses[0] }; 

    for (let i = 1; i < courses.length; i++) {
        const nextCourse = courses[i];

        const isSameDay = nextCourse.day === currentMergedCourse.day;
        const isSameWeeks = JSON.stringify(nextCourse.weeks) === JSON.stringify(currentMergedCourse.weeks);
        const isSameName = nextCourse.name === currentMergedCourse.name;
        const isSameTeacher = nextCourse.teacher === currentMergedCourse.teacher;
        const isSamePosition = nextCourse.position === currentMergedCourse.position;
        const isConsecutive = nextCourse.startSection === currentMergedCourse.endSection + 1;

        // 检查合并条件
        const canMerge = isSameDay && isSameWeeks && isSameName && isSameTeacher && isSamePosition && isConsecutive;

        if (canMerge) {
            currentMergedCourse.endSection = nextCourse.endSection;
        } else {
            mergedCourses.push(currentMergedCourse);
            currentMergedCourse = { ...nextCourse };
        }
    }
    mergedCourses.push(currentMergedCourse);
    
    return mergedCourses;
}



// 生成夏季作息时间段
function generateSummerTimeSlots() {
    return [
        { "number": 1, "startTime": "08:20", "endTime": "09:05" },
        { "number": 2, "startTime": "09:15", "endTime": "10:00" }, 
        { "number": 3, "startTime": "10:20", "endTime": "11:05" }, 
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "15:55", "endTime": "16:40" },
        { "number": 8, "startTime": "16:50", "endTime": "17:35" },
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        { "number": 10, "startTime": "19:55", "endTime": "20:40" },
        { "number": 11, "startTime": "20:45", "endTime": "21:30" }, 
        { "number": 12, "startTime": "21:35", "endTime": "22:20" }
    ];
}

// 生成冬季作息时间段
function generateWinterTimeSlots() {
    return [
        { "number": 1, "startTime": "08:20", "endTime": "09:05" },
        { "number": 2, "startTime": "09:15", "endTime": "10:00" }, 
        { "number": 3, "startTime": "10:20", "endTime": "11:05" }, 
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "14:30", "endTime": "15:15" },
        { "number": 6, "startTime": "15:25", "endTime": "16:10" },
        { "number": 7, "startTime": "16:25", "endTime": "17:10" },
        { "number": 8, "startTime": "17:20", "endTime": "18:05" },
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        { "number": 10, "startTime": "19:55", "endTime": "20:40" },
        { "number": 11, "startTime": "20:45", "endTime": "21:30" }, 
        { "number": 12, "startTime": "21:35", "endTime": "22:20" }
    ];
}


async function runImportFlow() {
    const currentTitle = document.title || '';
    if (currentTitle.includes('登录') || currentTitle.includes('Login')) {
        window.shiguangBridge.showToast("请先登录教务系统");
        return;
    }

    // 获取用户输入：学年
    let currentYear = new Date().getFullYear();
    const academicYear = await window.shiguangBridgePromise.showPrompt(
        "选择学年", 
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        String(currentYear),
        "validateYearInput"
    );
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    // 获取用户输入：学期
    const semesters = ["1（第一学期）", "2（第二学期）"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", 
        JSON.stringify(semesters),
        -1 
    );
    if (semesterIndex === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    const semesterNumber = semesterIndex + 1;

    // 构造学年学期 ID (xnxqid)
    const nextYear = parseInt(academicYear) + 1;
    const xnxqid = `${academicYear}-${nextYear}-${semesterNumber}`;
    window.shiguangBridge.showToast(`准备获取 ${academicYear} 学年第 ${semesterNumber} 学期数据...`);
    
    // 获取用户输入：作息季节
    const seasons = ["夏季作息", "冬季作息"];
    const seasonIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息季节", 
        JSON.stringify(seasons),
        -1
    );
    if (seasonIndex === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    const selectedSeason = seasonIndex === 0 ? 'summer' : 'winter';
    const seasonText = seasonIndex === 0 ? '夏季作息' : '冬季作息';
    window.shiguangBridge.showToast(`已选择：${seasonText}。`);

    // 异步获取和解析 HTML 数据
    const doc = await fetchTimetable(xnxqid);
    if (doc === null) {
        return; 
    }
    
    const parsedData = parseTimetable(doc);
    
    if (!parsedData || parsedData.courses.length === 0) {
        window.shiguangBridge.showToast("课表解析失败或未解析到课程。请检查登录状态、学期选择或课表数据是否为空。");
        return;
    }

    let { courses, config } = parsedData;
    
    // 执行课程合并逻辑
    const originalCourseCount = courses.length;
    courses = mergeCourses(courses);
    
    // 提交课程数据
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        const mergedCount = originalCourseCount - courses.length;
        window.shiguangBridge.showToast(`课程导入成功！原始 ${originalCourseCount} 门，合并 ${mergedCount} 门，最终导入 ${courses.length} 门。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课程数据保存失败: ${error.message}`);
        return;
    }

    // 提交课表配置数据 
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    // 提交预设时间段数据
    try {
        let timeSlots;
        if (selectedSeason === 'summer') {
            timeSlots = generateSummerTimeSlots();
        } else {
            timeSlots = generateWinterTimeSlots();
        }

        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast(`预设时间段导入成功！已使用${seasonText}。请在设置中校对具体时间。`);
    } catch (error) {
        window.shiguangBridge.showToast(`导入时间段失败: ${error.message}`);
    }

    window.shiguangBridge.showToast("所有任务已完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();