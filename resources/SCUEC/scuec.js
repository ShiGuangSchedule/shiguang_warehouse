// ==========================================
// 文件: scuec.js
// 中南民族大学教务系统课程表导入脚本
// 开发规范: 结构化编程 + async/await 流程控制树
// ==========================================

// ========== 第一部分：工具函数 ==========

/**
 * 检查是否在正确的教务系统页面
 */
function isOnSchedulePage() {
    const url = window.location.href;
    return /jiaowu|jwgl|course|schedule|curriculum/i.test(url) || 
           document.querySelector('table.CourseFormTable') !== null;
}

/**
 * 解析周次字符串
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    const normalized = String(weekStr)
        .replace(/周/g, '')
        .replace(/\s+/g, '');

    const parts = normalized.split(/[,，、;；]/).filter(Boolean);
    for (const part of parts) {
        const match = part.match(/^(\d+)(?:[-~](\d+))?(?:\((单|双)\))?$/);
        if (!match) continue;

        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : start;
        const parity = match[3];

        for (let i = start; i <= end; i++) {
            if (parity === '单' && i % 2 === 0) continue;
            if (parity === '双' && i % 2 === 1) continue;
            weeks.push(i);
        }
    }

    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

/**
 * 将 HTML 转成纯文本，不依赖被页面覆盖的 document.createElement。
 */
function htmlToText(html) {
    if (!html) return '';

    return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, '\u00a0')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number('0x' + hex)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

/**
 * 清理文本：移除HTML标签但保留文本内容
 * 特别处理空标签和多余空格
 */
function cleanHTML(html) {
    if (!html) return '';

    return htmlToText(html)
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 智能分割文本为行
 * 支持 \n, <br>, <hr> 分隔符
 */
function smartSplitLines(html, separator = '<br') {
    if (!html) return [];
    
    let parts = [];
    
    // 如果指定了分隔符，先用分隔符分割
    if (separator === '<hr') {
        parts = html.split(/<hr\s*\/?>/i);
    } else if (separator === '<br') {
        parts = html.split(/<br\s*\/?>/i);
    } else {
        parts = [html];
    }
    
    // 对每个部分清理并分行
    let lines = [];
    parts.forEach(part => {
        let cleaned = cleanHTML(part);
        if (cleaned) {
            // 再按空行分割
            let subLines = cleaned.split(/\n+/).map(l => l.trim()).filter(l => l !== '');
            lines.push(...subLines);
        }
    });
    
    return lines;
}

/**
 * 解析单个课程信息（更加健壮）
 */
function parseSingleCourse(courseHTML) {
    if (!courseHTML || courseHTML.trim() === '') {
        return null;
    }

    try {
        const lines = htmlToText(courseHTML)
            .replace(/\u00a0/g, ' ')
            .split(/\n+/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        if (lines.length === 0) {
            return null;
        }

        const firstLine = lines[0];
        const weekMatch = firstLine.match(/\d+(?:\s*[-~]\s*\d+)?周(?:\((?:单|双)\))?/);
        const sectionMatch = firstLine.match(/[（(]第(\d+)(?:\s*[-~]\s*(\d+))?节[）)]/);
        const weekToken = weekMatch ? weekMatch[0] : '';
        const weeks = parseWeeks(weekToken);

        if (weeks.length === 0) {
            return null;
        }

        const weekIndex = weekMatch ? weekMatch.index : firstLine.length;
        const sectionIndex = sectionMatch ? sectionMatch.index : firstLine.length;
        const nameEnd = Math.min(weekIndex, sectionIndex);

        let name = firstLine
            .slice(0, nameEnd)
            .replace(/\[\d+\]\s*$/, '')
            .trim();

        if (!name) {
            return null;
        }

        let startSection = sectionMatch ? Number(sectionMatch[1]) : 0;
        let endSection = sectionMatch && sectionMatch[2]
            ? Number(sectionMatch[2])
            : startSection;

        const customTimeMatch = firstLine.match(/[（(](\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})[）)]/);
        const rest = lines.slice(1);
        const positionLine = rest.find((line) => /[楼馆场室厅]/.test(line));
        const teacherLine = rest.find((line) => line !== positionLine);

        const result = {
            name: name,
            teacher: teacherLine || rest.filter((line) => line !== positionLine).join(' '),
            position: positionLine || '待定',
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        };

        if (customTimeMatch) {
            result.isCustomTime = true;
            result.customStartTime = customTimeMatch[1];
            result.customEndTime = customTimeMatch[2];
        }

        return result;
    } catch (error) {
        console.error('[ERROR] 解析课程出错:', error);
        return null;
    }
}

/**
 * 从单个单元格中提取所有课程（支持 <hr> 分隔的多个课程）
 */
function extractCoursesFromCell(cellElement, dayIndex) {
    if (!cellElement) return [];
    
    try {
        const cellHTML = cellElement.innerHTML || '';
        const cellText = cellElement.textContent || '';
        
        if (!cellText || cellText.replace(/\u00a0/g, '').trim() === '') {
            return [];
        }
        
        // 按 <hr> 分割
        const courseParts = cellHTML.split(/<hr\s*\/?>/i);
        const courses = [];
        
        console.log(`[DEBUG] 单元格分解为 ${courseParts.length} 个课程块`);
        
        courseParts.forEach((part, idx) => {
            const courseInfo = parseSingleCourse(part);
            if (courseInfo) {
                courseInfo.day = dayIndex + 1;
                courses.push(courseInfo);
                console.log(`[DEBUG]   块${idx + 1}: ${courseInfo.name}`);
            }
        });
        
        return courses;
        
    } catch (error) {
        console.error('[ERROR] 提取单元格课程失败:', error);
        return [];
    }
}

/**
 * 从表格中提取所有课程
 */
function extractCoursesFromTable() {
    const courses = [];
    const courseMap = new Map();
    
    try {
        const table = document.querySelector('table.CourseFormTable');
        if (!table) {
            console.error('[ERROR] 找不到课程表');
            return null;
        }

        const rows = Array.from(table.rows);
        if (rows.length < 2) {
            console.error('[ERROR] 表格行数不足');
            return null;
        }

        console.log(`[INFO] 开始解析课程表（共 ${rows.length} 行）`);

        const headerRow = rows[0];
        const headers = Array.from(headerRow.cells).map(cell => cell.textContent.trim());
        const dayColumns = headers.slice(2);
        const pendingRowspans = new Array(dayColumns.length).fill(0);
        
        console.log(`[INFO] 日期列: ${dayColumns.join(', ')}`);
        
        // 遍历数据行
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const cells = Array.from(row.cells);
            
            if (cells.length === 0) continue;
            
            // 检查"未安排时间课程"部分
            const captionCell = cells.find(cell => cell.querySelector('table.NoFitCourse'));
            if (captionCell) {
                console.log('[INFO] 检测到未安排课程表');
                const unscheduledCourses = extractUnscheduledCourses(captionCell);
                if (unscheduledCourses) {
                    courses.push(...unscheduledCourses);
                }
                break;
            }
            
            // 获取行的节次信息
            const sectionCell = cells[1];
            let dayStartSection = 0;
            if (sectionCell) {
                const sectionText = sectionCell.textContent.trim();
                const sectionMatch = sectionText.match(/第(\d+)节/);
                if (sectionMatch) {
                    dayStartSection = Number(sectionMatch[1]);
                }
            }
            
            const dayCells = cells.slice(2);
            let dayCellPointer = 0;

            // 遍历每天的课程，跳过被上方 rowspan 占用的列
            for (let dayIndex = 0; dayIndex < dayColumns.length; dayIndex++) {
                if (pendingRowspans[dayIndex] > 0) {
                    pendingRowspans[dayIndex]--;
                    continue;
                }

                const courseCell = dayCells[dayCellPointer];
                if (!courseCell) continue;

                dayCellPointer++;
                
                const cellCourses = extractCoursesFromCell(courseCell, dayIndex);
                
                cellCourses.forEach(courseInfo => {
                    if (courseInfo.startSection === 0 && courseInfo.endSection === 0) {
                        courseInfo.startSection = dayStartSection;
                        courseInfo.endSection = dayStartSection;
                    }
                    
                    const courseKey = `${courseInfo.day}-${courseInfo.name}-${courseInfo.teacher}-${courseInfo.position}-${courseInfo.weeks.join(',')}`;
                    
                    if (courseMap.has(courseKey)) {
                        const existing = courseMap.get(courseKey);
                        existing.startSection = Math.min(existing.startSection, courseInfo.startSection);
                        existing.endSection = Math.max(existing.endSection, courseInfo.endSection);
                    } else {
                        courseMap.set(courseKey, courseInfo);
                    }
                });

                const rowspan = Math.max(Number(courseCell.getAttribute('rowspan') || '1'), 1);
                const colspan = Math.max(Number(courseCell.getAttribute('colspan') || '1'), 1);

                if (rowspan > 1) {
                    for (let offset = 0; offset < colspan && dayIndex + offset < dayColumns.length; offset++) {
                        pendingRowspans[dayIndex + offset] = Math.max(
                            pendingRowspans[dayIndex + offset],
                            rowspan - 1
                        );
                    }
                }

                if (colspan > 1) {
                    dayIndex += colspan - 1;
                }
            }
        }
        
        const courseList = Array.from(courseMap.values());
        courseList.sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.startSection !== b.startSection) return a.startSection - b.startSection;
            return a.endSection - b.endSection;
        });
        
        courses.push(...courseList);
        console.log(`[INFO] ✓ 成功提取 ${courses.length} 门课程`);
        return courses;
        
    } catch (error) {
        console.error('[ERROR] 解析课程表失败:', error);
        return null;
    }
}

/**
 * 提取未安排时间的课程
 */
function extractUnscheduledCourses(element) {
    try {
        const table = element.querySelector('table.NoFitCourse');
        if (!table) return null;
        
        const courses = [];
        const rows = table.querySelectorAll('tbody tr');
        
        console.log(`[INFO] 未安排课程表有 ${rows.length} 行`);
        
        rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
                const courseName = cells[0].textContent.trim();
                const weekStr = cells[1].textContent.trim();
                const teacher = cells[2].textContent.trim();
                
                const weeks = parseWeeks(weekStr);
                
                if (courseName && weeks.length > 0) {
                    courses.push({
                        name: courseName,
                        teacher: teacher,
                        position: '待定',
                        day: 0,
                        startSection: 0,
                        endSection: 0,
                        weeks: weeks
                    });
                    
                    console.log(`[INFO] 未安排课程: ${courseName}`);
                }
            }
        });
        
        return courses.length > 0 ? courses : null;
    } catch (error) {
        console.error('[ERROR] 解析未安排课程失败:', error);
        return null;
    }
}

/**
 * 生成时间段配置
 */
function generateTimeSlots() {
    const fallback = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:10", "endTime": "14:55" },
        { "number": 6, "startTime": "15:05", "endTime": "15:50" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "18:40", "endTime": "19:25" },
        { "number": 10, "startTime": "19:30", "endTime": "20:15" },
        { "number": 11, "startTime": "20:20", "endTime": "21:05" }
    ];

    const table = document.querySelector('table.CourseFormTable');
    if (!table) return fallback;

    const slots = [];
    const rows = Array.from(table.rows);

    for (const row of rows) {
        const sectionCell = row.cells[1];
        if (!sectionCell) continue;

        const text = sectionCell.textContent.trim();
        const numberMatch = text.match(/第(\d+)节/);
        const timeMatch = text.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);

        if (!numberMatch || !timeMatch) continue;

        slots.push({
            number: Number(numberMatch[1]),
            startTime: timeMatch[1],
            endTime: timeMatch[2]
        });
    }

    return slots.length > 0 ? slots.sort((a, b) => a.number - b.number) : fallback;
}

// ========== 第二部分：业务函数 ==========

/**
 * 业务函数: 从页面获取课程数据
 */
async function fetchCoursesFromPage() {
    console.log('\n[步骤1] 开始从页面提取课程数据...');
    
    try {
        const courses = extractCoursesFromTable();
        
        if (!courses || courses.length === 0) {
            console.error('[ERROR] 未找到课程数据');
            return null;
        }
        
        console.log(`[步骤1] ✓ 成功提取 ${courses.length} 门课程\n`);
        console.log('课程详情:');
        courses.forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.name} | 师:${c.teacher} | 地:${c.position} | 周:${c.weeks.join(',')} | 第${c.startSection}-${c.endSection}节 | 星期${c.day}`);
        });
        console.log();
        
        return courses;
        
    } catch (error) {
        console.error('[步骤1] ✗ 提取课程失败:', error);
        throw error;
    }
}

/**
 * 业务函数: 显示确认弹窗
 */
async function showConfirmDialog(courseCount) {
    console.log('[步骤2] 显示确认弹窗...');
    
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "导入课程表",
            `检测到 ${courseCount} 门课程，是否导入？`,
            "确认导入"
        );
        
        if (confirmed) {
            console.log('[步骤2] ✓ 用户确认导入\n');
            return true;
        } else {
            console.log('[步骤2] ✗ 用户取消导入\n');
            return false;
        }
    } catch (error) {
        console.error('[步骤2] ✗ 显示弹窗失败:', error);
        throw error;
    }
}

/**
 * 业务函数: 保存课程
 */
async function saveCourses(courses) {
    console.log('[步骤3] 开始保存课程数据...');
    
    try {
        window.shiguangBridge.showToast('正在保存课程...');
        
        const result = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );
        
        if (result === true) {
            console.log(`[步骤3] ✓ 成功保存 ${courses.length} 门课程\n`);
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
            return true;
        } else {
            console.error('[步骤3] ✗ 课程保存失败');
            window.shiguangBridge.showToast('课程保存失败');
            throw new Error('课程保存失败');
        }
    } catch (error) {
        console.error('[步骤3] ✗ 保存课程出错:', error);
        throw error;
    }
}

/**
 * 业务函数: 保存时间段配置
 */
async function saveTimeSlots() {
    console.log('[步骤4] 开始保存时间段配置...');
    
    try {
        window.shiguangBridge.showToast('正在保存时间段配置...');
        
        const timeSlots = generateTimeSlots();
        
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(timeSlots)
        );
        
        if (result === true) {
            console.log('[步骤4] ✓ 时间段配置保存成功\n');
            window.shiguangBridge.showToast('时间段配置成功！');
            return true;
        } else {
            console.error('[步骤4] ✗ 时间段配置保存失败');
            window.shiguangBridge.showToast('时间段配置失败');
            throw new Error('时间段配置失败');
        }
    } catch (error) {
        console.error('[步骤4] ✗ 保存时间段出错:', error);
        throw error;
    }
}

// ========== 第三部分：流程控制树 ==========

/**
 * 主流程: 导入课程表
 */
async function runImportFlow() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║    开始导入中南民族大学课程表        ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    try {
        const courses = await fetchCoursesFromPage();
        if (!courses) {
            window.shiguangBridge.showToast('未找到课程数据');
            console.log('❌ 流程终止: 无课程数据\n');
            return false;
        }
        
        const userConfirmed = await showConfirmDialog(courses.length);
        if (!userConfirmed) {
            console.log('❌ 流程终止: 用户取消导入\n');
            return false;
        }
        
        const coursesSaved = await saveCourses(courses);
        if (!coursesSaved) {
            console.log('❌ 流程终止: 课程保存失败\n');
            return false;
        }
        
        const timeSlotsSaved = await saveTimeSlots();
        if (!timeSlotsSaved) {
            console.log('❌ 流程终止: 时间段配置失败\n');
            return false;
        }
        
        console.log('[步骤5] 发送完成信号...');
        window.shiguangBridge.notifyTaskCompletion();
        window.shiguangBridge.showToast('课程表导入完成！');
        
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║    导入流程完成 ✓                     ║');
        console.log('╚════════════════════════════════════════╝\n');
        return true;
        
    } catch (error) {
        console.error('\n❌ 导入流程出错:', error);
        console.log('╚════════════════════════════════════════╝\n');
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

// ========== 第四部分：程序入口 ==========

if (isOnSchedulePage() || document.querySelector('table.CourseFormTable')) {
    console.log('✓ 检测到中南民族大学教务系统课程表页面');
    
    setTimeout(() => {
        runImportFlow();
    }, 1000);
    
} else {
    console.log('✗ 当前不在课程表页面');
    window.shiguangBridge.showToast('请先在教务系统打开课程表页面！');
}
