// 内蒙古工业大学教务系统课程导入脚本
// 根据教务处网站内容解析课程表数据
// 2025.11.25

// ============生成时间段配置==============

/**
 * 默认时段配置，来源于学校官网(2025.11.23)
 */
const defaultTimeSlots = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:55", "endTime": "09:35" },
    { "number": 3, "startTime": "10:05", "endTime": "10:50" },
    { "number": 4, "startTime": "11:00", "endTime": "11:40" },
    { "number": 5, "startTime": "13:30", "endTime": "14:15" },
    { "number": 6, "startTime": "14:25", "endTime": "15:05" },
    { "number": 7, "startTime": "15:35", "endTime": "16:20" },
    { "number": 8, "startTime": "16:30", "endTime": "17:10" },
    { "number": 9, "startTime": "18:00", "endTime": "18:45" },
    { "number": 10, "startTime": "18:45", "endTime": "19:35" },
    { "number": 11, "startTime": "19:45", "endTime": "20:30" },
    { "number": 12, "startTime": "20:30", "endTime": "21:20" }
];

/**
 * 从HTML文本中解析时段信息
 * @param {string} doc -  DOM 文档对象
 * @returns {Object} 时段信息对象
 */
function parseTimeSlotsFromHTML(doc) {
    const timeSlots = {};
    
    const timetable = doc.querySelector('table#timetable');
    if (timetable) {
        const rows = timetable.querySelectorAll('tr');
        
        for (let i = 1; i < rows.length; i++) { // 跳过表头行
            const th = rows[i].querySelector('th');
            if (th) {
                const sectionText = th.textContent.trim();
                
                // 解析格式如："第1节\n08:20\n┆\n09:05"
                const sectionMatch = sectionText.match(/第(\d+)节/);
                const timeMatch = sectionText.match(/(\d{2}:\d{2})/g);
                
                if (sectionMatch && timeMatch && timeMatch.length >= 2) {
                    const section = parseInt(sectionMatch[1]);
                    timeSlots[section] = {
                        section: section,
                        startTime: timeMatch[0],
                        endTime: timeMatch[1]
                    };
                }
            }
        }
    }
    
    if (Object.keys(timeSlots).length === 0) {
        throw new Error('未找到时段信息表格');
    }
    
    return timeSlots;
}

/**
 * 从指定网页地址异步获取HTML并解析时段信息，如果解析失败则返回默认时段
 * @param {string} url - 网页地址
 * @returns {Promise<Array<Object>>} 时段信息数组，按节次排序
 * @returns {number} .number 节次编号
 * @returns {string} .startTime 开始时间
 * @returns {string} .endTime 结束时间
 */
async function getTimeSlotsArray(url) {
    try {
        const doc = await fetchAndParseHTML(url, 'gbk');
        
        // 解析时段信息
        const timeSlots = parseTimeSlotsFromHTML(doc);
        
        const hasValidData = Object.keys(timeSlots).length > 0 && 
                            timeSlots[1] && timeSlots[1].startTime;
        
        if (hasValidData) {
            // 转换为目标格式
            return Object.values(timeSlots).map(slot => ({
                number: slot.section,
                startTime: slot.startTime,
                endTime: slot.endTime
            })).sort((a, b) => a.number - b.number);
        } else {
            throw new Error('解析到的时段数据不完整');
        }
    } catch (error) {
        console.error('从HTML解析时段信息失败，使用默认时段:', error.message);
        // 使用默认时段
        return defaultTimeSlots;
    }
}

// ============解析课程表数据==============

/**
 * 解析周数字符串
 * @param {string} weeksText - 周数字符串，支持格式："11周"、"1-13周"、"1-10周,11-18周"
 * @returns {number[]} 解析后的周数数组，按升序排列
 */
function parseWeeks(weeksText) {
    if (!weeksText) return [];
    
    const weeks = [];
    const text = weeksText.replace('周', '').trim();
    
    // 处理单个周数 "11周" -> [11]
    if (/^\d+$/.test(text)) {
        return [parseInt(text)];
    }
    
    // 处理范围 "1-13周" -> [1,2,3,...,13]
    const rangeMatch = text.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        for (let i = start; i <= end; i++) {
            weeks.push(i);
        }
        return weeks;
    }
    
    // 处理多个范围 "1-10周,11-18周"
    const ranges = text.split(',');
    ranges.forEach(range => {
        const singleMatch = range.match(/^(\d+)$/);
        if (singleMatch) {
            weeks.push(parseInt(singleMatch[1]));
        } else {
            const rangeMatch = range.match(/(\d+)-(\d+)/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                for (let i = start; i <= end; i++) {
                    weeks.push(i);
                }
            }
        }
    });
    
    return weeks;
}

/**
 * 解析课程名称（去除<<>>）
 * @param {*} courseText - 原始课程名称文本
 * @returns {string} 解析后的课程名称
 */
function parseCourseName(courseText) {
    let name = courseText
        .replace(/<</g, '')  // 直接移除 <<
        .replace(/>>/g, '')  // 直接移除 >>
        .split(';')[0];
    
    return name.trim();
}

function parseSingleCourse(lines, day, timeSlot) {
    
    const courseNameMatch = lines[0].match(/<<(.*?)>>/);

    if (!courseNameMatch) {
        return null;
    }

    let courseData = {
        name: parseCourseName(courseNameMatch[1]),
        position: lines[1] || '',
        day: day,
        startSection: timeSlot,
        endSection: timeSlot,
        weeks: []
    };

    // 单门课程示例
    // ['<<离散数学导论>>;1', '教C', '贾老师', '1-15周', '讲课']
    // 无教师名课程示例：
    // ['<<体育选项课(一)>>;11', '操   场', '2-18周', '讲课']

    if (lines.length > 4) {
        // 有教师名课程
        courseData.teacher = lines[2].replace(/,$/, '');
        courseData.weeks = parseWeeks(lines[3]);
    } else {
        // 无教师名课程
        courseData.teacher = '';
        courseData.weeks = parseWeeks(lines[2]);
    }

    return courseData;
}

/**
 * 解析包含多个课程的课程信息块。
 *
 * @param {Array<string>} lines - 包含课程信息的字符串数组，每个元素表示一行数据。
 * @param {string} day - 表示课程所在的星期几。
 * @param {string} timeSlot - 表示课程所在的时间段。
 * @returns {Array<Object>} 返回一个包含课程信息的数组，每个课程信息是一个对象。
 */
function parseMultipleCourses(lines, day, timeSlot) {
    const courses = [];
    let currentCourseLines = [];

    // 示例：
    // ['<<工程训练C>>;11', '格物楼D', '刘老师', '1-10周', '讲课', '<<数据结构与算法>>;1', '教C', '秦老师', '11-18周', '讲课']

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('<<') && currentCourseLines.length > 0) {
            const courseData = parseSingleCourse(currentCourseLines, day, timeSlot);
            if (courseData) {
                courses.push(courseData);
            }
            currentCourseLines = [];
        }
        currentCourseLines.push(lines[i]);
    }

    if (currentCourseLines.length > 0) {

        const courseData = parseSingleCourse(currentCourseLines, day, timeSlot);
        if (courseData) {
            courses.push(courseData);
        }
    }

    return courses;
}

/**
 * 处理课程区块信息，解析出课程的详细信息。
 *
 * @param {string} block - 包含课程信息的HTML字符串，使用`<br>`分隔每行。
 * @param {string} day - 表示课程所在的星期几。
 * @param {string} timeSlot - 表示课程所在的时间段。
 * @returns {Array<Object>} 返回一个包含课程信息的数组，每个课程信息是一个对象。
 */
function processCourseBlock(block, day, timeSlot) {
    const lines = block.split('<br>').map(line => 
        line.replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    ).filter(line => line);

    const courses = [];

    const courseCount = lines.filter(line => line.includes('<<')).length;

    if (courseCount > 1) {
        courses.push(...parseMultipleCourses(lines, day, timeSlot));
    } else if (lines.length >= 4) {
        const courseData = parseSingleCourse(lines, day, timeSlot);
        if (courseData) {
            courses.push(courseData);
        }
    }

    return courses;
}

/**
 * 将HTML课程表转换为标准格式的课程数据
 * @param {string} url - 网页地址
 * @returns {Promise<Array<Object>>} 课程表数据数组
 * @returns {string} .name 课程名称
 * @returns {string} .teacher 授课教师
 * @returns {string} .position 上课地点
 * @returns {number} .day 星期几 (1=周一, 7=周日)
 * @returns {number} .startSection 开始节次
 * @returns {number} .endSection 结束节次
 * @returns {number[]} .weeks 上课周次数组
 */
async function convertToTargetFormat(url) {
    try {
        const doc = await fetchAndParseHTML(url, 'gbk');
        
        const timetable = [];
        const rows = doc.querySelectorAll('#timetable tr');
        
        // 跳过表头行
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const timeSlot = rowIndex; // 第1-13节对应rowIndex 1-13
            const cells = row.querySelectorAll('td');
            
            for (let day = 1; day <= cells.length; day++) {
                const cell = cells[day - 1];
                const content = cell.innerHTML.trim();
                
                if (content && content !== '&nbsp;') {

                    // 分割每个课程块（一个单元格可能有多个课程）
                    const courseBlocks = content.split(/<br>\s*<br>/);
                    
                    courseBlocks.forEach(block => {
                        if (block.trim()) {

                            const courses = processCourseBlock(block, day, timeSlot);

                            for (const course of courses) {
                                timetable.push(course);

                            }
                        }
                    });
                }
            }
        }

        return timetable;
        
    } catch (error) {

        return []; // 返回空数组作为错误回退
    }
}

/**
 * 合并连续的课程信息。
 * 合并条件：同一天、同一课程名称、同一位置、同一教师、同一周次且时间连续
 *
 * @param {Array<Object>} courses - 课程信息数组
 * @returns {Array<Object>} 返回合并后的课程信息数组
 */
function mergeContinuousCourses(courses) {
    // 按所有关键属性进行分组
    const grouped = {};
    
    courses.forEach(course => {
        // 使用周次数组的字符串表示作为分组键的一部分
        const weeksKey = JSON.stringify(course.weeks.sort((a, b) => a - b));
        const key = `${course.day}-${course.name}-${course.position}-${course.teacher || '未知'}-${weeksKey}`;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(course);
    });
    
    const result = [];
    
    // 处理每个分组
    Object.values(grouped).forEach(group => {
        // 按开始节次排序
        group.sort((a, b) => a.startSection - b.startSection);
        
        let currentCourse = null;
        
        group.forEach(course => {
            if (!currentCourse) {
                // 第一个课程
                currentCourse = { ...course };
            } else if (currentCourse.endSection + 1 === course.startSection) {
                // 时间连续，合并
                currentCourse.endSection = course.endSection;
            } else {
                // 时间不连续，将当前课程加入结果，开始新的课程
                result.push(currentCourse);
                currentCourse = { ...course };
            }
        });
        
        // 将最后一个课程加入结果
        if (currentCourse) {
            result.push(currentCourse);
        }
    });
    
    return result;
}

// ============配置获取==============

/*
    * 异步获取学年学期信息
    * @returns {Promise<Object>} 包含 studentid, year, term的对象
    * studentid: 标识ID
    * year: 学年，例如 45 (2025-1980)
    * term: 学期，1=春季，2=夏季，3=秋季
    */
async function getSemesterInfo(url) {
    try {
        const doc = await fetchAndParseHTML(url, 'gbk');
        
        // 查找 CTRT 元素
        const ctrtElement = doc.querySelector('eduaffair\\:CTRT');
        
        if (!ctrtElement) {
            throw new Error('未找到 CTRT 元素');
        }
        
        // 提取参数
        const params = {
            studentid: ctrtElement.getAttribute('studentid'),
            year: ctrtElement.getAttribute('year'),
            term: ctrtElement.getAttribute('term'),
        };
        
        return params;
        
    } catch (error) {
        console.error('提取参数时出错:', error);
        return null;
    }
}

/**
 * 获取指定学年和学期的最大周数值。
 *
 * @param {string} yearid - 学年的ID，例如 "2023"。
 * @param {string} termid - 学期的ID，例如 "1" 或 "2"。
 * @returns {Promise<number>} 返回一个Promise，解析为最大周数值。
 */
async function getMaxWeekValue(yearid, termid) {
    const url = `http://jw.imut.edu.cn/academic/manager/coursearrange/studentWeeklyTimetable.do?yearid=${yearid}&termid=${termid}`;
    try {
        const doc = await fetchAndParseHTML(url, 'gbk');
        
        // 查找whichWeek选择框
        const weekSelect = doc.querySelector('select[name="whichWeek"]');
        
        if (!weekSelect) {
            throw new Error('未找到周次选择框');
        }

        // 获取所有option的value并转换为数字
        const weekOptions = Array.from(weekSelect.querySelectorAll('option'));
        const weekValues = weekOptions
            .map(option => parseInt(option.value))
            .filter(value => !isNaN(value) && value !== 0); // 过滤掉非数字和空值

        if (weekValues.length === 0) {
            throw new Error('未找到有效的周数值');
        }
        const maxWeek = Math.max(...weekValues);

        return maxWeek;
        
    } catch (error) {
        console.error('获取最大周数时出错:', error);
        throw error;
    }
}

/*    * 异步获取第一个课程日期
    * 调用此函数需要先设定学年和学期，否则可能获取不到正确的数据
    *
    * @param {string} yearid - 学年ID
    * @param {string} termid - 学期ID
    * @returns {Promise<string>} 第一个课程日期字符串，格式如 "2025-09-01"
**/
async function getFirstCourseDate(yearid, termid) {
    const url = 'http://jw.imut.edu.cn/academic/manager/coursearrange/studentWeeklyTimetable.do';
    
    try {
        // 构建POST请求的表单数据
        const formData = new URLSearchParams();
        formData.append('yearid', yearid);
        formData.append('termid', termid);
        formData.append('whichWeek', '1');  // 固定请求第一周
        
        const doc = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `http://jw.imut.edu.cn/academic/manager/coursearrange/studentWeeklyTimetable.do?yearid=${yearid}&termid=${termid}`
            },
            body: formData.toString(),
            credentials: 'include'  // 包含cookie
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(text => {
            // 将文本解析为DOM文档
            const parser = new DOMParser();
            return parser.parseFromString(text, 'text/html');
        });
        
        // 查找第一个课程日期
        const firstDateTd = doc.querySelector('td[name="td0"]');
        
        if (firstDateTd) {
            const firstCourseDate = firstDateTd.textContent.trim();
            return firstCourseDate;
        } else {
            return null;
        }
        
    } catch (error) {
        console.error('获取数据失败:', error);
        return null;
    }
}

// 设置当前学年和学期
async function setCurrentYearAndTerm(yearid, termid) {
    const url = `http://jw.imut.edu.cn/academic/student/currcourse/currcourse.jsdo?year=${yearid}&term=${termid}`
    try {
        const doc = await fetchAndParseHTML(url, 'gbk');
        const text = doc.querySelector('#title td div').textContent.trim();
        const match = text.match(/(\d{4})(春|夏|秋)/);
        if (match) {
            const year = match[1];
            const season = match[2];

            let curtermid = (season === '春') ? 1 : (season === '夏') ? 2 : 3;
            let curyearid = String(parseInt(year) - 1980);

            if (curtermid == termid && curyearid == yearid) {
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('设置当前学年学期失败:', error);
        return false;
    }
}

// ====================== 辅助函数 ======================

// 请求与解析HTML的通用函数
async function fetchAndParseHTML(url, encoding = 'gbk') {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP错误! 状态码: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder(encoding);
    const htmlText = decoder.decode(buffer);
    const parser = new DOMParser();
    return parser.parseFromString(htmlText, 'text/html');
}

// 日期格式验证函数
function validateDateFormat(dateString) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (regex.test(dateString)) {
        return false;
    } else {
        return "请输入正确的日期格式，示例：2025-09-01";
    }
}

// 弹出日期确认对话框
async function setStartDate(suggestedDate) {
    const dateSelection = await window.shiguangBridgePromise.showPrompt(
        "请确认学期起始日期",
        `此日期来自您此学期第一节课日期，如有误，请修改（格式：YYYY-MM-DD）：`,
        suggestedDate || "",
        "validateDateFormat"
    );
    return dateSelection;
}

// 验证学年输入函数
function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false; // 验证通过
    } else {
        return "请输入四位数字的学年！"; // 验证失败
    }
}


// 选择学年
async function getAcademicYear(currentYear) {
    const yearSelection = await window.shiguangBridgePromise.showPrompt(
        "选择学年", 
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        parseInt(currentYear) + 1980, 
        "validateYearInput" // 传入全局函数名
    );
    const academicYear = String(parseInt(yearSelection) - 1980);
    return academicYear;
}

// 选择学期
async function selectTerms() {
    const terms = ["春（第二学期）", "夏", "秋（第一学期）"];
    const termIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(terms),
        -1
    );
    const term = termIndex + 1; // 转换为1,2,3

    return term;
}

// 弹出修改学年和学期对话框
async function setYearAndTerm(currentYear, currentTerm) {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "请确认学年和学期",
        `当前学年为 ${parseInt(currentYear) + 1980} 年，学期为 ${currentTerm === '3' ? '秋（第一学期）' : currentTerm === '1' ? '春（第二学期）' : '夏'}。是否需要修改？`,
        "我要修改"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("使用默认学年和学期进行导入。");
        return false;
    }
    return true;
}

// ====================== 导入课程主流程 ======================

async function runImportFlow() {

    window.shiguangBridge.showToast("即将开始导入课表，请稍候...");

    // 获取学年学期信息
    const semesterInfo = await getSemesterInfo("http://jw.imut.edu.cn/academic/student/currcourse/currcourse.jsdo");
    if (!semesterInfo) {
        window.shiguangBridge.showToast("获取学生信息失败，请重试！");
        return;
    }
    currentYear = semesterInfo.year; // 当前年份 - 1980
    currentTerm = semesterInfo.term; // 当前学期

    // 自定义年份学期
    const needModify = await setYearAndTerm(currentYear, currentTerm);
    if (needModify) {
        currentYear = await getAcademicYear(currentYear);
        currentTerm = await selectTerms();
        window.shiguangBridge.showToast(`当前年份与学期已修改为：${parseInt(currentYear) + 1980} 年，学期 ${currentTerm === 2 ? '夏' : currentTerm === 1 ? '春（第二学期）' : '秋（第一学期）'}`);
    }

    // 设置当前学年和学期
    const setResult = await setCurrentYearAndTerm(currentYear, currentTerm);
    if (!setResult) {
        window.shiguangBridge.showToast("设置学年和学期失败！");
        return;
    }

    // 构造课程表URL
    const timetableUrl = `http://jw.imut.edu.cn/academic/manager/coursearrange/showTimetable.do?id=${semesterInfo.studentid}&yearid=${currentYear}&termid=${currentTerm}&timetableType=STUDENT&sectionType=BASE`;

    // 获取时段数据
    const timeSlots = await getTimeSlotsArray(timetableUrl);
    if (!timeSlots || timeSlots.length === 0) {
        window.shiguangBridge.showToast("获取时间段信息失败，使用默认时间段！");
    }

    // 获取并转换课程表数据
    let courses = await convertToTargetFormat(timetableUrl);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("获取课程表数据失败，请重试！");
        return;
    }

    // 合并连续课程
    courses = mergeContinuousCourses(courses)

    // 获取第一个课程日期
    let firstCourseDate = null;
    try {
        firstCourseDate = await getFirstCourseDate(currentYear, currentTerm);
    } catch (err) {
        console.warn("获取第一个课程日期失败:", err);
    }

    // 用户确认起始日期
    try {
        firstCourseDate = await setStartDate(firstCourseDate);
    } catch (err) {
        console.error("用户取消了日期输入:", err);
        window.shiguangBridge.showToast("未输入起始日期。");
    }

    // 获取最大周数
    let maxWeeks = 20; // 默认最大周数
    try {
        maxWeeks = await getMaxWeekValue(currentYear, currentTerm);
    } catch (err) {
        console.warn("获取最大周数失败，使用默认值 20");
    }

    // 配置课表配置
    const coursesConfig = {
        semesterStartDate: firstCourseDate,
        semesterTotalWeeks: maxWeeks,
    };

    // 将数据传递给Android端

    // 提交课程数据
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        const coursesCount = courses.length;
        window.shiguangBridge.showToast(`课程导入成功，共导入 ${coursesCount} 门课程！`);
    } catch (err) {
        console.error("课程导入失败:", err);
        window.shiguangBridge.showToast("课程导入失败：" + err.message);
        return;
    }

    // 提交时间段数据
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("时间段导入成功！");
    } catch (err) {
        console.error("时间段导入失败:", err);
        window.shiguangBridge.showToast("时间段导入失败：" + err.message);
        return;
    }

    // 提交课表配置
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(coursesConfig));
        window.shiguangBridge.showToast("课表配置保存成功！");
    } catch (err) {
        console.error("课表配置保存失败:", err);
        window.shiguangBridge.showToast("课表配置保存失败：" + err.message);
        return;
    }

    // 通知任务完成
    console.log("JS：整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();

}

runImportFlow();