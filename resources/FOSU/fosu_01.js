/**
 * 佛山大学强智教务系统适配
 * @since 2026-5-14
 * @description 支持课程表导入，需要校园网访问
 * @author e7g
 * @version 1.0
 */

function parseWeeksString(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    
    let cleanStr = weekStr;
    while (cleanStr.includes('(周)')) {
        cleanStr = cleanStr.replace('(周)', '');
    }
    while (cleanStr.includes('周')) {
        cleanStr = cleanStr.replace('周', '');
    }
    cleanStr = cleanStr.trim();
    
    const parts = cleanStr.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
            const nums = trimmed.split('-').map(s => parseInt(s.trim(), 10));
            const start = nums[0];
            const end = nums[1];
            if (!isNaN(start) && !isNaN(end)) {
                for (let w = start; w <= end; w++) {
                    weeks.push(w);
                }
            }
        } else {
            const week = parseInt(trimmed, 10);
            if (!isNaN(week)) {
                weeks.push(week);
            }
        }
    }
    
    return weeks.sort((a, b) => a - b);
}

function parseSectionFromText(text) {
    const startIdx = text.indexOf('[');
    const endIdx = text.indexOf(']节');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        return null;
    }
    
    const sectionStr = text.substring(startIdx + 1, endIdx);
    const sections = sectionStr.split('-').map(s => parseInt(s.trim(), 10));
    
    if (sections.some(s => isNaN(s))) {
        return null;
    }
    
    return {
        start: Math.min(...sections),
        end: Math.max(...sections)
    };
}

function removeSectionFromText(text) {
    const startIdx = text.indexOf('[');
    const endIdx = text.indexOf(']节');
    if (startIdx === -1 || endIdx === -1) {
        return text;
    }
    return text.substring(0, startIdx).trim();
}

function extractFontContent(line) {
    const startTag = line.indexOf('<font');
    if (startTag === -1) return null;
    
    const closeTag = line.indexOf('>', startTag);
    if (closeTag === -1) return null;
    
    const endTag = line.indexOf('</font>', closeTag);
    if (endTag === -1) return null;
    
    return line.substring(closeTag + 1, endTag).trim();
}

function removeHtmlTags(text) {
    let result = '';
    let inTag = false;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '<') {
            inTag = true;
        } else if (text[i] === '>') {
            inTag = false;
        } else if (!inTag) {
            result += text[i];
        }
    }
    return result.trim();
}

function parseCourseFromDiv(divContent, dayIndex, sectionIndex) {
    const courses = [];
    
    if (!divContent || divContent.includes('&nbsp;') || divContent.trim() === '') {
        return courses;
    }
    
    const courseBlocks = [];
    let currentBlock = '';
    let dashCount = 0;
    
    for (let i = 0; i < divContent.length; i++) {
        if (divContent[i] === '-') {
            dashCount++;
        } else {
            if (dashCount >= 10) {
                if (currentBlock.trim()) {
                    courseBlocks.push(currentBlock);
                }
                currentBlock = '';
            } else if (dashCount > 0) {
                for (let j = 0; j < dashCount; j++) {
                    currentBlock += '-';
                }
            }
            currentBlock += divContent[i];
            dashCount = 0;
        }
    }
    if (currentBlock.trim()) {
        courseBlocks.push(currentBlock);
    }
    
    let pendingCourse = null;
    
    for (const block of courseBlocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock || trimmedBlock.includes('&nbsp;')) continue;
        
        const lines = trimmedBlock.split('<br>').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) continue;
        
        const courseName = removeHtmlTags(lines[0]);
        let teacher = '';
        let position = '';
        let weeks = [];
        let startSection = sectionIndex * 2 - 1;
        let endSection = sectionIndex * 2;
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('title="老师"')) {
                const content = extractFontContent(line);
                if (content) {
                    teacher = content;
                }
            } else if (line.includes('title="周次(节次)"')) {
                const content = extractFontContent(line);
                if (content) {
                    weeks = parseWeeksString(content);
                }
            } else if (line.includes('title="教室"')) {
                const content = extractFontContent(line);
                if (content) {
                    position = content;
                    const sectionMatch = parseSectionFromText(content);
                    if (sectionMatch) {
                        startSection = sectionMatch.start;
                        endSection = sectionMatch.end;
                        position = removeSectionFromText(content);
                    }
                }
            }
        }
        
        if (teacher && !weeks.length) {
            pendingCourse = {
                name: courseName,
                teacher: teacher,
                position: '',
                day: dayIndex,
                startSection: startSection,
                endSection: endSection,
                weeks: []
            };
        } else if (weeks.length > 0) {
            if (pendingCourse && pendingCourse.name === courseName) {
                pendingCourse.position = position;
                pendingCourse.startSection = startSection;
                pendingCourse.endSection = endSection;
                pendingCourse.weeks = weeks;
                courses.push(pendingCourse);
                pendingCourse = null;
            } else {
                if (courseName && weeks.length > 0) {
                    courses.push({
                        name: courseName,
                        teacher: teacher,
                        position: position,
                        day: dayIndex,
                        startSection: startSection,
                        endSection: endSection,
                        weeks: weeks
                    });
                }
            }
        }
    }
    
    return courses;
}

function findTagContent(html, tagName, startFrom) {
    const openTag = '<' + tagName;
    const closeTag = '</' + tagName + '>';
    
    let start = html.indexOf(openTag, startFrom || 0);
    if (start === -1) return null;
    
    const tagEnd = html.indexOf('>', start);
    if (tagEnd === -1) return null;
    
    let depth = 1;
    let pos = tagEnd + 1;
    
    while (depth > 0 && pos < html.length) {
        const nextOpen = html.indexOf(openTag, pos);
        const nextClose = html.indexOf(closeTag, pos);
        
        if (nextClose === -1) return null;
        
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            pos = html.indexOf('>', nextOpen) + 1;
        } else {
            depth--;
            if (depth === 0) {
                return {
                    content: html.substring(tagEnd + 1, nextClose),
                    endPos: nextClose + closeTag.length
                };
            }
            pos = nextClose + closeTag.length;
        }
    }
    return null;
}

function findAllTags(html, tagName) {
    const results = [];
    let pos = 0;
    while (true) {
        const result = findTagContent(html, tagName, pos);
        if (!result) break;
        results.push(result.content);
        pos = result.endPos;
    }
    return results;
}

function findTagWithAttr(html, tagName, attrName, attrValue) {
    const openTag = '<' + tagName;
    const closeTag = '</' + tagName + '>';
    
    let pos = 0;
    while (true) {
        let start = html.indexOf(openTag, pos);
        if (start === -1) return null;
        
        const tagEnd = html.indexOf('>', start);
        if (tagEnd === -1) return null;
        
        const tagDecl = html.substring(start, tagEnd + 1);
        
        const attrPattern = attrName + '="';
        const attrStart = tagDecl.indexOf(attrPattern);
        if (attrStart !== -1) {
            const attrValueStart = attrStart + attrPattern.length;
            const attrValueEnd = tagDecl.indexOf('"', attrValueStart);
            if (attrValueEnd !== -1) {
                const foundValue = tagDecl.substring(attrValueStart, attrValueEnd);
                if (foundValue === attrValue || foundValue.includes(attrValue)) {
                    let depth = 1;
                    let searchPos = tagEnd + 1;
                    
                    while (depth > 0 && searchPos < html.length) {
                        const nextOpen = html.indexOf(openTag, searchPos);
                        const nextClose = html.indexOf(closeTag, searchPos);
                        
                        if (nextClose === -1) return null;
                        
                        if (nextOpen !== -1 && nextOpen < nextClose) {
                            depth++;
                            searchPos = html.indexOf('>', nextOpen) + 1;
                        } else {
                            depth--;
                            if (depth === 0) {
                                return html.substring(tagEnd + 1, nextClose);
                            }
                            searchPos = nextClose + closeTag.length;
                        }
                    }
                }
            }
        }
        
        pos = tagEnd + 1;
    }
    return null;
}

function parseSemesterValue(semesterValue) {
    const parts = semesterValue.split('-');
    if (parts.length !== 3) return null;
    
    const startYear = parts[0];
    const endYear = parts[1];
    const semesterNum = parts[2];
    
    if (startYear.length !== 4 || endYear.length !== 4 || semesterNum.length !== 1) {
        return null;
    }
    
    return {
        startYear: parseInt(startYear, 10),
        endYear: parseInt(endYear, 10),
        semesterNum: semesterNum
    };
}

function parseHtmlTable(htmlContent) {
    const courses = [];
    
    const tableContent = findTagWithAttr(htmlContent, 'table', 'id', 'kbtable');
    if (!tableContent) {
        console.error('未找到课程表格');
        return courses;
    }
    
    const rows = findAllTags(tableContent, 'tr');
    
    let sectionIndex = 0;
    
    for (const row of rows) {
        if (row.includes('星期一') || row.includes('备注')) {
            continue;
        }
        
        const thContent = findTagContent(row, 'th', 0);
        if (thContent) {
            const thText = thContent.content;
            const sectionNames = ['一', '二', '三', '四', '五', '六'];
            for (let i = 0; i < sectionNames.length; i++) {
                if (thText.includes('第' + sectionNames[i] + '大节')) {
                    sectionIndex = i + 1;
                    break;
                }
            }
        }
        
        if (sectionIndex === 0) continue;
        
        const cells = findAllTags(row, 'td');
        
        let dayIndex = 1;
        
        for (const cell of cells) {
            let kbcontentDivs = [];
            
            let divPos = 0;
            while (true) {
                const divStart = cell.indexOf('<div', divPos);
                if (divStart === -1) break;
                
                const divDeclEnd = cell.indexOf('>', divStart);
                if (divDeclEnd === -1) break;
                
                const divDecl = cell.substring(divStart, divDeclEnd + 1);
                
                if (divDecl.includes('class="kbcontent"') && !divDecl.includes('class="kbcontent1"')) {
                    const divContent = findTagContent(cell.substring(divStart), 'div', 0);
                    if (divContent) {
                        kbcontentDivs.push(divContent.content);
                    }
                }
                
                divPos = divDeclEnd + 1;
            }
            
            for (const divContent of kbcontentDivs) {
                const parsedCourses = parseCourseFromDiv(divContent, dayIndex, sectionIndex);
                courses.push(...parsedCourses);
            }
            
            dayIndex++;
        }
    }
    
    return courses;
}

function mergeSameCourses(courses) {
    const courseMap = new Map();
    
    for (const course of courses) {
        const key = `${course.name}-${course.teacher}-${course.position}-${course.day}-${course.startSection}-${course.endSection}`;
        
        if (courseMap.has(key)) {
            const existing = courseMap.get(key);
            for (const week of course.weeks) {
                if (!existing.weeks.includes(week)) {
                    existing.weeks.push(week);
                }
            }
        } else {
            courseMap.set(key, { ...course, weeks: [...course.weeks] });
        }
    }
    
    return Array.from(courseMap.values()).map(c => ({
        ...c,
        weeks: c.weeks.sort((a, b) => a - b)
    }));
}

async function parseAndImportCourses() {
    const tableElement = document.querySelector('table#kbtable');
    
    if (!tableElement) {
        console.error('未找到课程表格元素 #kbtable');
        window.shiguangBridge.showToast('未找到课程表格，请确保在正确的页面！');
        return false;
    }
    
    const htmlContent = tableElement.outerHTML;
    console.log('找到课程表格，开始解析...');
    
    let courses = parseHtmlTable(htmlContent);
    console.log(`解析到 ${courses.length} 条课程记录`);
    
    courses = mergeSameCourses(courses);
    console.log(`合并后 ${courses.length} 条课程记录`);
    
    console.log('解析结果:', JSON.stringify(courses, null, 2));
    
    try {
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            console.log('课程导入成功！');
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
            return true;
        } else {
            console.log('课程导入失败，结果：' + result);
            window.shiguangBridge.showToast('课程导入失败，请查看日志。');
            return false;
        }
    } catch (error) {
        console.error('导入课程时发生错误:', error);
        window.shiguangBridge.showToast('导入课程失败: ' + error.message);
        return false;
    }
}

async function importPresetTimeSlots() {
    console.log("正在准备预设时间段数据...");
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:45", "endTime": "09:25" },
        { "number": 3, "startTime": "09:40", "endTime": "10:20" },
        { "number": 4, "startTime": "10:25", "endTime": "11:05" },
        { "number": 5, "startTime": "11:10", "endTime": "11:50" },
        { "number": 6, "startTime": "13:30", "endTime": "14:10" },
        { "number": 7, "startTime": "14:15", "endTime": "14:55" },
        { "number": 8, "startTime": "15:10", "endTime": "15:50" },
        { "number": 9, "startTime": "15:55", "endTime": "16:35" },
        { "number": 10, "startTime": "16:40", "endTime": "17:20" },
        { "number": 11, "startTime": "18:30", "endTime": "19:10" },
        { "number": 12, "startTime": "19:15", "endTime": "19:55" },
        { "number": 13, "startTime": "20:05", "endTime": "20:45" },
        { "number": 14, "startTime": "20:50", "endTime": "21:30" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.shiguangBridge.showToast("时间段导入成功！");
            return true;
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.shiguangBridge.showToast("时间段导入失败，请查看日志。");
            return false;
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

function parseSemesterInfo() {
    const semesterSelect = document.querySelector('select#xnxq01id');
    if (!semesterSelect) {
        console.warn('未找到学期选择框');
        return { semester: '2025-2026-2', totalWeeks: 19 };
    }
    
    const selectedOption = semesterSelect.querySelector('option[selected]');
    const semesterValue = selectedOption ? selectedOption.value : semesterSelect.value;
    
    console.log('当前学期:', semesterValue);
    
    const parsed = parseSemesterValue(semesterValue);
    if (!parsed) {
        return { semester: semesterValue, totalWeeks: 19 };
    }
    
    const { startYear, endYear, semesterNum } = parsed;
    let startDate;
    
    function getSecondWeekMonday(year, month) {
        let firstDay = new Date(year, month, 1);
        let dayOfWeek = firstDay.getDay();
        if (dayOfWeek === 0) dayOfWeek = 7;
        
        let firstMonday = new Date(year, month, 1);
        if (dayOfWeek === 1) {
            // 1号就是周一，第一周周一就是1号
        } else {
            // 1号不是周一，第一周周一是下周一
            firstMonday.setDate(1 + (8 - dayOfWeek));
        }
        
        let secondMonday = new Date(firstMonday);
        secondMonday.setDate(firstMonday.getDate() + 7);
        
        return secondMonday;
    }
    
    if (semesterNum === '1') {
        startDate = getSecondWeekMonday(startYear, 8);
    } else {
        startDate = getSecondWeekMonday(endYear, 2);
    }
    
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    
    return {
        semester: semesterValue,
        startDate: formattedDate,
        totalWeeks: 19
    };
}

async function saveCourseConfig() {
    console.log("正在准备配置数据...");
    
    const semesterInfo = parseSemesterInfo();
    console.log('学期信息:', semesterInfo);
    
    const courseConfigData = {
        "semesterStartDate": semesterInfo.startDate || "2026-02-24",
        "semesterTotalWeeks": semesterInfo.totalWeeks,
        "defaultClassDuration": 40,
        "defaultBreakDuration": 5,
        "firstDayOfWeek": 1
    };

    try {
        console.log("正在尝试导入课表配置...");
        console.log("配置数据:", JSON.stringify(courseConfigData, null, 2));
        const configJsonString = JSON.stringify(courseConfigData);

        const result = await window.shiguangBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
            window.shiguangBridge.showToast(`配置导入成功！学期: ${semesterInfo.semester}, 开学: ${courseConfigData.semesterStartDate}`);
            return true;
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            window.shiguangBridge.showToast("配置导入失败，请查看日志。");
            return false;
        }
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        window.shiguangBridge.showToast("导入配置失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "佛山大学教务系统课表导入",
        "【重要】本系统需要使用校园网访问，请确保已连接校园网后再操作。\n\n导入步骤：\n1. 登录教务系统\n2. 导航到【培养管理】→【学期理论课表】\n3. 确认课表已加载显示\n4. 点击确定开始导入",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("开始解析课程表...");

    console.log("=== 开始课程表解析和导入流程 ===");

    const importResult = await parseAndImportCourses();
    if (!importResult) {
        console.log("课程导入失败或用户取消。");
        return;
    }

    console.log("课程导入完成。");
    window.shiguangBridge.showToast("课程导入完成！");

    await importPresetTimeSlots();
    await saveCourseConfig();

    console.log("=== 所有任务完成 ===");
    window.shiguangBridge.notifyTaskCompletion();
}

if (typeof window.shiguangBridge !== 'undefined' && window.shiguangBridge) {
    runImportFlow();
}
