// ========== 工具函数 ==========

/**
 * 解析周数字符串
 * @param {string} Str 如：1-6,7-13周(单)
 * @returns {Array} 返回数组 [1,3,5,7,9,11,13]
 */
function getWeeks(Str) {
    function range(con, tag) {
        let retWeek = [];
        con.slice(0, -1).split(',').forEach(w => {
            let tt = w.split('-');
            let start = parseInt(tt[0]);
            let end = parseInt(tt[tt.length - 1]);
            if (tag === 1 || tag === 2) {
                retWeek.push(...Array(end + 1 - start).fill(start).map((x, y) => x + y).filter(f => {
                    return f % tag === 0;
                }));
            } else {
                retWeek.push(...Array(end + 1 - start).fill(start).map((x, y) => x + y).filter(v => {
                    return v % 2 !== 0;
                }));
            }
        });
        return retWeek;
    }

    Str = Str.replace(/[(){}|第\[\]]/g, "").replace(/到/g, "-");
    let reWeek = [];
    let week1 = [];
    
    while (Str.search(/周|\s/) !== -1) {
        let index = Str.search(/周|\s/);
        if (Str[index + 1] === '单' || Str[index + 1] === '双') {
            week1.push(Str.slice(0, index + 2).replace(/周|\s/g, ""));
            index += 2;
        } else {
            week1.push(Str.slice(0, index + 1).replace(/周|\s/g, ""));
            index += 1;
        }
        Str = Str.slice(index);
        index = Str.search(/\d/);
        if (index !== -1) Str = Str.slice(index);
        else Str = "";
    }
    
    if (Str.length !== 0) week1.push(Str);
    
    week1.forEach(v => {
        if (v.slice(-1) === "双") {
            reWeek.push(...range(v, 2));
        } else if (v.slice(-1) === "单") {
            reWeek.push(...range(v, 3));
        } else {
            reWeek.push(...range(v + "全", 1));
        }
    });
    
    return reWeek;
}

/**
 * 解析节次字符串
 * @param {string} Str 如: 1-4节 或 1-2-3-4节
 * @returns {Array} [1,2,3,4]
 */
function getSection(Str) {
    let reJc = [];
    let strArr = Str.replace("节", "").trim().split("-");
    
    if (strArr.length <= 2) {
        for (let i = Number(strArr[0]); i <= Number(strArr[strArr.length - 1]); i++) {
            reJc.push(Number(i));
        }
    } else {
        strArr.forEach(v => {
            reJc.push(Number(v));
        });
    }
    
    return reJc;
}

/**
 * 检查是否在登录页面
 * @returns {boolean}
 */
function isLoginPage() {
    const url = window.location.href;
    // 检查URL是否包含登录页面特征
    return url.includes('login') || url.includes('Login') || 
           document.querySelector('input[type="password"]') !== null;
}

/**
 * 解析课程HTML数据
 * @param {string} html 课程表HTML
 * @returns {Array} 课程数组
 */
function parseScheduleHtml(html) {
    let result = [];
    let uniqueCourses = []; // 移到外部作用域
    
    try {
        // 创建临时div来解析HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        console.log('开始解析课程表HTML...');
        
        // 查找课程表格
        const table = tempDiv.querySelector('#kbtable') || tempDiv.querySelector('table');
        if (!table) {
            throw new Error('未找到课程表格');
        }
        
        // 遍历所有行(每行是一个大节时间段)
        const rows = table.querySelectorAll('tr');
        console.log(`找到 ${rows.length} 行`);
        
        // 用于记录已处理的div,避免重复(跨大节课程会在多行出现)
        const processedDivs = new Set();
        
        rows.forEach((tr, rowIdx) => {
            const tds = tr.querySelectorAll('td');
            
            // 遍历这一行的所有td列
            // 注意: querySelectorAll('td')只选择td元素,不包括th
            // 所以td[0]就是星期一, td[1]是星期二, ..., td[6]是星期日
            tds.forEach((td, colIdx) => {
                // 查找这个单元格里的课程内容div
                const hiddenDiv = td.querySelector('div.kbcontent');
                
                // 如果没有隐藏div或内容为空,跳过
                if (!hiddenDiv) {
                    return;
                }
                
                // 检查是否已经处理过这个div(根据name属性去重)
                const divName = hiddenDiv.getAttribute('name') || hiddenDiv.getAttribute('id');
                if (divName && processedDivs.has(divName)) {
                    return; // 已处理过,跳过
                }
                
                const divText = hiddenDiv.textContent.trim();
                if (!divText || divText.length <= 6) {
                    return;
                }
                
                // 从div的name属性提取星期信息
                // name格式: "hash-星期-序号" 例如 "EBC6F96389D143DC9C53084617F9C7D2-2-1"
                // 其中第二部分的数字: 1=星期一, 2=星期二, ..., 7=星期日
                let day = colIdx + 1; // 默认使用列索引
                if (divName) {
                    const nameParts = divName.split('-');
                    if (nameParts.length >= 3) {
                        const dayFromName = parseInt(nameParts[1]);
                        if (!isNaN(dayFromName) && dayFromName >= 1 && dayFromName <= 7) {
                            day = dayFromName;
                        }
                    }
                }
                
                // 标记为已处理
                if (divName) {
                    processedDivs.add(divName);
                }
                
                console.log(`\n[行${rowIdx} 列${colIdx} 星期${day}]`);
                console.log(`内容预览: ${divText.substring(0, 50)}...`);
                
                // 可能包含多个课程，用 ----- 分隔
                const courseSections = hiddenDiv.innerHTML.split(/-----+/);
                console.log(`分割成 ${courseSections.length} 个课程段`);
                
                // 用于课程段去重(避免完全相同的课程段被重复添加)
                const processedSections = new Set();
                
                // 遍历每个课程段
                courseSections.forEach((section, sectionIdx) => {
                    const sectionText = section.replace(/<[^>]*>/g, '').trim();
                    if (!sectionText || sectionText.length < 3) {
                        return;
                    }
                    
                    // 检查是否已经处理过完全相同的课程段(内容去重)
                    if (processedSections.has(sectionText)) {
                        console.log(`  跳过重复课程段 ${sectionIdx + 1}`);
                        return;
                    }
                    processedSections.add(sectionText);
                    
                    console.log(`  课程段 ${sectionIdx + 1}:`);
                    console.log(`  原始HTML:`, section.substring(0, 200));
                    
                    let course = {
                        day: day, // 星期几(1=周一, 2=周二, ..., 7=周日)
                        weeks: [],
                        sections: [],
                        name: '',
                        teacher: '',
                        position: ''
                    };
                    
                    // 解析HTML，按br分割成行
                    const lines = section.split(/<br\s*\/?>/i);
                    console.log(`  分割成 ${lines.length} 行`);
                    
                    let firstTextLine = true; // 标记是否是第一个有效文本行
                    
                    lines.forEach((line, lineIdx) => {
                        // 跳过空行
                        const plainText = line.replace(/<[^>]*>/g, '').trim();
                        if (!plainText || plainText === '&nbsp;') {
                            return;
                        }
                        
                        console.log(`    行${lineIdx}: ${line.substring(0, 100)}`);
                        console.log(`    纯文本: ${plainText}`);
                        
                        // 第一个有效文本行就是课程名(没有title属性)
                        if (firstTextLine && !course.name) {
                            // 移除span标签(包含调课标记如&nbspO)但保留其他内容
                            let courseName = line.replace(/<span[^>]*>.*?<\/span>/gi, '').trim();
                            // 提取纯文本
                            courseName = courseName.replace(/<[^>]*>/g, '').trim();
                            // 清理HTML实体
                            courseName = courseName.replace(/&nbsp;/g, ' ').trim();
                            
                            course.name = courseName;
                            console.log(`    ✓ 第一行作为课程名: ${course.name}`);
                            firstTextLine = false;
                            return;
                        }
                        firstTextLine = false;
                        
                        // 检查这一行的title属性（使用双引号）
                        if (line.includes('title="老师"')) {
                            course.teacher = plainText;
                            console.log(`    ✓ 匹配老师: ${course.teacher}`);
                        }
                        else if (line.includes('title="教室"')) {
                            // 对于教室，需要先移除隐藏的font标签，再提取文本
                            const cleanLine = line.replace(/<font[^>]*style="display:none;"[^>]*>.*?<\/font>/gi, '');
                            const cleanText = cleanLine.replace(/<[^>]*>/g, '').trim();
                            // 再移除可能残留的前导数字
                            const finalPosition = cleanText.replace(/^[\d-]+/, '').trim();
                            course.position = finalPosition;
                            console.log(`    ✓ 匹配教室: ${course.position}`);
                        }
                        else if (line.includes('title="周次(节次)"')) {
                            console.log(`    ✓ 匹配周次节次: ${plainText}`);
                            
                            // 解析周次: "1-18(周)[06-07节]"
                            const weekMatch = plainText.match(/^(.+?)\(周\)/);
                            if (weekMatch) {
                                const weekStr = weekMatch[1];
                                course.weeks = getWeeks(weekStr + '周');
                                console.log(`    -> 周: ${course.weeks}`);
                            }
                            
                            // 解析节次: "[06-07节]"
                            const sectionMatch = plainText.match(/\[(.+?)节?\]/);
                            if (sectionMatch) {
                                const sectionStr = sectionMatch[1];
                                course.sections = getSection(sectionStr + '节');
                                console.log(`    -> 节: ${course.sections}`);
                            }
                        }
                        // 如果没有找到教室，尝试从包含隐藏font的行提取
                        // 这行可能格式如: <font style="display:none;">01-02</font><font style="display:none;">20</font>北院卓媒220
                        else if (!course.position && line.includes('style="display:none;"')) {
                            // 移除所有隐藏的font标签
                            const visibleText = line.replace(/<font[^>]*style="display:none;"[^>]*>.*?<\/font>/gi, '')
                                                    .replace(/<[^>]*>/g, '')
                                                    .trim();
                            if (visibleText && visibleText.length > 0) {
                                // 移除所有前导的数字和连字符（如 "01-0220" 或 "06-0722"）
                                // 匹配模式：开头的数字-数字组合
                                const cleanPosition = visibleText.replace(/^[\d-]+/, '').trim();
                                if (cleanPosition.length > 0) {
                                    course.position = cleanPosition;
                                    console.log(`    ✓ 提取教室（清理后）: ${course.position}`);
                                }
                            }
                        }
                    });
                    
                    // 验证并添加课程
                    if (course.name && course.weeks.length > 0 && course.sections.length > 0) {
                        course.teacher = course.teacher || "未知教师";
                        course.position = course.position || "未知地点";
                        
                        console.log(`  ✓ 完整课程:`, {
                            name: course.name,
                            teacher: course.teacher,
                            position: course.position,
                            day: course.day,
                            weeks: `${course.weeks.length}周`,
                            sections: course.sections
                        });
                        result.push(course);
                    } else {
                        console.warn(`  ✗ 信息不完整:`, {
                            name: course.name || '无',
                            teacher: course.teacher || '无',
                            weeks: course.weeks.length,
                            sections: course.sections.length
                        });
                    }
                });
            });
        });
        
        console.log(`\n解析完成,共得到 ${result.length} 条课程记录(去重前)`);
        
        // 合并完全相同的课程(去重)，并合并仅周次不同的同节次课程
        const courseMap = new Map();
        
        result.forEach(course => {
            // 生成课程唯一标识: 名称+老师+地点+星期+节次（不包含周次）
            const mergeKey = `${course.name}|${course.teacher}|${course.position}|${course.day}|${course.sections.join(',')}`;
            
            if (!courseMap.has(mergeKey)) {
                // 深拷贝一份以避免引用问题
                courseMap.set(mergeKey, { ...course, weeks: [...course.weeks] });
            } else {
                console.log(`  合并同时间不同周次的课程: ${course.name} (${course.teacher})`);
                const existingCourse = courseMap.get(mergeKey);
                // 合并并去重然后重新排序周次
                existingCourse.weeks = [...new Set([...existingCourse.weeks, ...course.weeks])].sort((a, b) => a - b);
            }
        });
        
        uniqueCourses = Array.from(courseMap.values());
        
        console.log(`合并/去重后剩余 ${uniqueCourses.length} 条课程记录`);
        
    } catch (err) {
        console.error('解析课程表出错:', err);
        throw new Error('解析课程表失败: ' + err.message);
    }

    return uniqueCourses;
}

/**
 * 转换课程数据格式以符合拾光课程表规范
 * @param {Array} rawCourses 原始课程数据
 * @returns {Array} 转换后的课程数据
 */
function convertCoursesToStandardFormat(rawCourses) {
    const validCourses = [];
    
    rawCourses.forEach((course, index) => {
        try {
            // 处理节次：将原始格式转换为startSection和endSection
            let startSection = 1;
            let endSection = 1;
            
            if (course.sections && course.sections.length > 0) {
                const sections = course.sections.sort((a, b) => a - b);
                startSection = sections[0];
                endSection = sections[sections.length - 1];
            }

            // 验证必需字段
            if (!startSection || !endSection || startSection < 1 || endSection < 1) {
                console.error(`课程 ${index + 1} 缺少有效的节次信息:`, course);
                throw new Error(`课程节次信息无效: startSection=${startSection}, endSection=${endSection}`);
            }

            if (!course.day || course.day < 1 || course.day > 7) {
                console.error(`课程 ${index + 1} 星期数据无效:`, course);
                throw new Error(`课程星期数据无效: day=${course.day}`);
            }

            if (!course.weeks || course.weeks.length === 0) {
                console.error(`课程 ${index + 1} 缺少周次信息:`, course);
                throw new Error(`课程周次信息缺失`);
            }

            const convertedCourse = {
                name: course.name || "未知课程",
                teacher: course.teacher || "未知教师", 
                position: course.position || "未知地点",
                day: course.day,
                startSection: startSection,
                endSection: endSection,
                weeks: course.weeks
            };

            validCourses.push(convertedCourse);
            
        } catch (err) {
            console.error(`转换课程 ${index + 1} 时出错:`, err.message);
            // 如果任何课程转换失败，抛出错误
            throw new Error(`课程数据验证失败: ${err.message}`);
        }
    });

    return validCourses;
}

/**
 * 生成时间段配置
 * @param {number} campusIdx 校区索引(0为龙泉校区，1为安宁校区)
 * @returns {Array} 时间段数组
 */
function generateTimeSlots(campusIdx = 0) {
    // 云南财经大学默认时间配置（龙泉校区）
    const timeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:50", "endTime": "09:30" },
        { "number": 3, "startTime": "10:00", "endTime": "10:40" },
        { "number": 4, "startTime": "10:50", "endTime": "11:30" },
        { "number": 5, "startTime": "11:40", "endTime": "12:20" },
        { "number": 6, "startTime": "14:30", "endTime": "15:10" },
        { "number": 7, "startTime": "15:20", "endTime": "16:00" },
        { "number": 8, "startTime": "16:30", "endTime": "17:10" },
        { "number": 9, "startTime": "17:20", "endTime": "18:00" },
        { "number": 10, "startTime": "18:10", "endTime": "18:30" },
        { "number": 11, "startTime": "19:00", "endTime": "19:40" },
        { "number": 12, "startTime": "19:50", "endTime": "20:30" },
        { "number": 13, "startTime": "20:50", "endTime": "21:30" },
        { "number": 14, "startTime": "21:40", "endTime": "22:20" }
    ];

    // 安宁校区时间配置
    const timeSlots_AN = [
        { "number": 1, "startTime": "08:20", "endTime": "09:00" },
        { "number": 2, "startTime": "09:10", "endTime": "09:50" },
        { "number": 3, "startTime": "10:10", "endTime": "10:50" },
        { "number": 4, "startTime": "11:00", "endTime": "11:40" },
        { "number": 5, "startTime": "11:50", "endTime": "12:30" },
        { "number": 6, "startTime": "14:00", "endTime": "14:40" },
        { "number": 7, "startTime": "14:50", "endTime": "15:30" },
        { "number": 8, "startTime": "15:40", "endTime": "16:20" },
        { "number": 9, "startTime": "16:40", "endTime": "17:20" },
        { "number": 10, "startTime": "17:30", "endTime": "18:10" },
        { "number": 11, "startTime": "19:00", "endTime": "19:40" },
        { "number": 12, "startTime": "19:50", "endTime": "20:30" },
        { "number": 13, "startTime": "20:40", "endTime": "21:20" }
    ];

    return campusIdx === 1 ? timeSlots_AN : timeSlots;
}

// ========== 网络请求功能 ==========

/**
 * POST 教学周历页面（获取当前学期的开学日期与最大周次）
 * @param {string} semesterId 形如 "2025-2026-2"
 */
async function requestSemesterDetailPage(semesterId) {
    const response = await fetch(`/jsxsd/jxzl/jxzl_query`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `xnxq01id=${semesterId}`,
        credentials: "include"
    });
    return await response.text();
}

/**
 * 获取当前学期的开学日期 + 最大周次
 * @param {string} semesterId 形如 "2025-2026-2"
 * @returns {Promise<{startDate: string|null, totalWeeks: number|null}>}
 */
async function fetchSemesterInfo(semesterId) {
    const html = await requestSemesterDetailPage(semesterId);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const timetable = doc.getElementById("kbtable");
    if (!timetable) return { startDate: null, totalWeeks: null };

    const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    if (rows.length === 0) return { startDate: null, totalWeeks: null };

    const firstDateCell = rows[0].querySelector("td[title]");
    const title = firstDateCell?.getAttribute("title") || "";
    const match = title.match(/^(\d{4})年(\d{2})月(\d{2})$/);
    const startDate = match ? `${match[1]}-${match[2]}-${match[3]}` : null;

    // 最大周次：所有行第一个 td 中能解析为整数的最大值
    let totalWeeks = null;
    for (const row of rows) {
        const firstTd = row.querySelector("td");
        if (!firstTd) continue;
        const n = parseInt(firstTd.textContent.trim(), 10);
        if (!isNaN(n) && n > 0) {
            if (totalWeeks === null || n > totalWeeks) totalWeeks = n;
        }
    }

    return { startDate, totalWeeks };
}

/**
 * 获取学期列表
 * @returns {Promise<Object>} 学期列表数据
 */
async function getSemesterList() {
    window.shiguangBridge.showToast('正在获取学期列表...');
    const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET', credentials: 'include' });
    const htmlText = await response.text();
    const parser = new DOMParser();
    let doc = parser.parseFromString(htmlText, 'text/html');

    const selectElem = doc.getElementById('xnxq01id');
    let semesters = [];
    let semesterValues = [];
    let defaultIndex = 0;
    let currentSemesterValue = null;

    if (selectElem) {
        const options = selectElem.querySelectorAll('option');
        options.forEach((opt, index) => {
            const isCurrentSemester = opt.hasAttribute('selected') || opt.selected;
            semesters.push(opt.innerText.trim());
            semesterValues.push(opt.value);
            if (isCurrentSemester) {
                defaultIndex = index;
                currentSemesterValue = opt.value;
            }
        });
    }

    // 仅保留最新学期往前五年内的学期选项
    const semesterYearPattern = /^(\d{4})-(\d{4})-(\d+)$/;
    const semesterStartYears = [];
    const semesterRecords = semesterValues.map((value, index) => {
        const label = semesters[index] || '';
        const valueMatch = String(value).match(semesterYearPattern);
        const labelMatch = String(label).match(semesterYearPattern);
        const startYear = valueMatch ? Number(valueMatch[1]) : (labelMatch ? Number(labelMatch[1]) : null);

        if (startYear !== null) {
            semesterStartYears.push(startYear);
        }

        return { index, value, label, startYear };
    });

    if (semesterStartYears.length > 0) {
        const latestStartYear = Math.max(...semesterStartYears);
        const minStartYear = latestStartYear - 4;
        const filteredSemesters = [];
        const filteredSemesterValues = [];
        let filteredDefaultIndex = -1;

        semesterRecords.forEach((record) => {
            if (record.startYear !== null && record.startYear >= minStartYear) {
                const isCurrentSemester = record.value === currentSemesterValue;
                filteredSemesters.push(isCurrentSemester ? `${record.label}（当前学期）` : record.label);
                filteredSemesterValues.push(record.value);
                if (isCurrentSemester || record.index === defaultIndex) {
                    filteredDefaultIndex = filteredSemesters.length - 1;
                }
            }
        });

        semesters = filteredSemesters;
        semesterValues = filteredSemesterValues;

        if (filteredDefaultIndex !== -1) {
            defaultIndex = filteredDefaultIndex;
        } else if (defaultIndex >= semesterValues.length) {
            defaultIndex = Math.max(semesterValues.length - 1, 0);
        }
    }

    return { semesters, semesterValues, defaultIndex, htmlText };
}

/**
 * 根据学期值获取课程表HTML
 * @param {string} semesterValue 学期参数值
 * @returns {Promise<string>} 课程表HTML
 */
async function fetchScheduleForSemester(semesterValue, semesterPageHtml = '', timeModeValue = null) {
    let formData = new URLSearchParams();
    formData.append('jx0404id', '');
    formData.append('cj0701id', '');
    formData.append('zc', '');
    formData.append('demo', '');
    formData.append('xnxq01id', semesterValue);
    formData.append('kbjcmsid', timeModeValue === null
        ? getTimeModeValue(semesterPageHtml, option => option.textContent.trim() === '全部')
        : timeModeValue);

    const postResponse = await fetch('/jsxsd/xskb/xskb_list.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        credentials: 'include'
    });
    return await postResponse.text();
}

/**
 * 根据文本匹配时间模式选项 value
 * @param {string} html 页面HTML
 * @param {Function} matcher 选项匹配函数
 * @returns {string} 时间模式 value
 */
function getTimeModeValue(html, matcher) {
    const sourceDoc = html
        ? new DOMParser().parseFromString(html, 'text/html')
        : document;
    const modeSelect = sourceDoc.getElementById('kbjcmsid');
    if (!modeSelect) return '';

    const option = Array.from(modeSelect.options).find(matcher);
    return option ? option.value : '';
}

/**
 * 判断课表页面是否存在课程
 * @param {string} html 课表HTML
 * @returns {boolean} 是否存在课程
 */
function hasScheduleCourses(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('#kbtable div.kbcontent'))
        .some(course => course.textContent.trim().length > 6);
}

// ========== 主要功能函数 ==========

/**
 * 获取和解析课程数据
 * @param {string} html 课程表HTML
 */
async function fetchAndParseCourses(html) {
    try {
        console.log('开始解析获取到的课程表HTML...');
        if (!html) {
            console.warn('未传入有效的课程表HTML');
            return null;
        }

        console.log('成功获取课程表HTML，开始解析...');

        // 解析课程数据
        const rawCourses = parseScheduleHtml(html);
        if (!rawCourses || rawCourses.length === 0) {
            console.warn('未解析到课程数据');
            return null;
        }

        console.log(`原始解析到 ${rawCourses.length} 条课程记录`);

        // 转换为标准格式
        const courses = convertCoursesToStandardFormat(rawCourses);
        console.log(`转换为标准格式后有 ${courses.length} 门课程`);

        return courses;
    } catch (error) {
        console.error('获取或解析课程数据失败:', error);
        return null;
    }
}

/**
 * 保存课程数据到拾光课程表
 * @param {Array} courses 课程数组
 */
async function saveCourses(courses) {
    try {
        console.log(`正在保存 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        console.log('课程数据保存成功');
        return true;
    } catch (error) {
        console.error('保存课程失败:', error);
        return false;
    }
}

/**
 * 导入预设时间段到拾光课程表
 * @param {number} campusIdx 校区索引
 */
async function importPresetTimeSlots(campusIdx = 0) {
    try {
        console.log('正在导入时间段配置...');
        const presetTimeSlots = generateTimeSlots(campusIdx);
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        console.log('时间段配置导入成功');
        return true;
    } catch (error) {
        console.error('导入时间段失败:', error);
        return false;
    }
}

// 导入剩余配置
async function saveAppConfig(semesterStartDate, totalWeeks) {
    const config = {
        "semesterTotalWeeks": totalWeeks || 20,
        "firstDayOfWeek": 1,
        "defaultClassDuration": 40
    };
    if (semesterStartDate) {
        config.semesterStartDate = semesterStartDate;
    }
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// ========== 主执行流程 ==========

/**
 * 主导入函数:云南财经大学课程表导入
 */
async function importYnufeCourseSchedule() {
    // 检查是否在登录页面
    if (isLoginPage()) {
        console.log('检测到在登录页面，终止导入');
        window.shiguangBridge.showToast('请先登录教务系统！');
        return; // 直接返回,不抛出错误,不调用notifyTaskCompletion
    }
    
    try {
        console.log('云南财经大学课程导入开始...');

        // 获取学期列表
        let semesters = [], semesterValues = [], defaultIndex = 0, htmlText = '';
        try {
            const listData = await getSemesterList();
            semesters = listData.semesters;
            semesterValues = listData.semesterValues;
            defaultIndex = listData.defaultIndex;
            htmlText = listData.htmlText;
        } catch (e) {
            console.warn('获取学期列表网络请求失败:', e);
        }
        
        let targetHtml = htmlText;
        let selectedCampusIdx = 0; // 默认龙泉校区
        let semesterStartDate = null;
        let totalWeeks = null;

        if (semesters && semesters.length > 0) {
            // 选择学期，允许用户取消导入
            const selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期", 
                JSON.stringify(semesters), 
                defaultIndex
            );
            if (selectedIdx === null || selectedIdx === -1) {
                window.shiguangBridge.showToast("用户取消了导入");
                return false;
            }

            const semesterId = semesterValues[selectedIdx];

            // 获取当前学期的开学日期与最大周次
            const semesterInfo = await fetchSemesterInfo(semesterId);
            semesterStartDate = semesterInfo.startDate;
            totalWeeks = semesterInfo.totalWeeks;
            
            // 获取对应学期的课表HTML
            window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 的课表...`);
            targetHtml = await fetchScheduleForSemester(semesterId, htmlText);

            // 时间模式列表始终包含所有校区，必须使用当前所选学期的页面实际请求安宁校区模式
            const anningModeValue = getTimeModeValue(targetHtml, option => {
                return option.textContent.trim().includes('安宁校区');
            });
            if (anningModeValue) {
                const anningScheduleHtml = await fetchScheduleForSemester(
                    semesterId,
                    targetHtml,
                    anningModeValue
                );
                if (hasScheduleCourses(anningScheduleHtml)) {
                    selectedCampusIdx = 1;
                }
            }
            console.log(`根据时间模式自动选择${selectedCampusIdx === 1 ? '安宁校区' : '龙泉校区'}时间表`);
        }

        // 获取和解析课程数据
        let courses = await fetchAndParseCourses(targetHtml);
        
        // 如果没有获取到任何课程
        if (!courses || courses.length === 0) {
            console.log('未获取到课程数据');
            
            // 检查是否真的是空课表
            if (targetHtml && targetHtml.includes('kbtable')) {
                // 找到了课表元素但没有课程,是真的空课表
                console.log('检测到空课表');
                window.shiguangBridge.showToast('当前学期课表为空！');
                return false;
            } else {
                // 找不到课表元素,解析失败
                window.shiguangBridge.showToast('获取课表失败,请检查网络和页面状态');
                throw new Error('未找到课表数据');
            }
        } else {
            console.log(`成功解析 ${courses.length} 门课程`);
        }

        // 保存课程数据
        const saveResult = await saveCourses(courses);
        if (!saveResult) {
            return;
        }

        // 提前提示导入结果，避免被导入完成通知立即覆盖
        if (courses.length > 0) {
            const campusName = selectedCampusIdx === 1 ? "安宁校区" : "龙泉校区";
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！（${campusName}）`);
        }

        // 保存开学日期与最大周数
        const configResult = await saveAppConfig(semesterStartDate, totalWeeks);
        if (!configResult) {
            return;
        }

        // 导入时间段配置
        const timeSlotResult = await importPresetTimeSlots(selectedCampusIdx);
        if (!timeSlotResult) {
            window.shiguangBridge.showToast('导入时间段配置失败');
            throw new Error('导入时间段失败');
        }

        console.log('课程导入完成');
        return true;

    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

/**
 * 启动导入流程并处理完成信号
 */
async function runImportFlow() {
    const success = await importYnufeCourseSchedule();
    
    // 只有成功导入时才发送完成信号
    if (success) {
        window.shiguangBridge.notifyTaskCompletion();
    }
    
    return success;
}

// 启动导入流程
runImportFlow();
