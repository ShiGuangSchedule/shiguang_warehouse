// 文件: JXNU.js
// 功能：从江西师范大学系统获取课程表， 解析后导入到拾光课程表
// 适配：江西师大教务系统
// 维护者：glxgo

// ---------- 常量配置 ----------

const UNIT_COUNT = 13; // 每天最大节次数

// ---------- 全局验证函数 ----------

function validateYearInput(input) {
    if (/^\d{4}$/.test(input)) return false;
    return "请输入四位数字的年份（例如 2024）";
}

function validateWeeksInput(input) {
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > 55) return "请输入 1-55 之间的有效周数";
    return false;
}

// ---------- 单元格文本解析 ----------

/**
 * 从课程格子文本中提取课程名、教师、教室
 * 输入例如："军事理论(W7103)合班吕俊.4班"
 */
function parseCellText(line) {
    line = line.trim();
    if (line.length < 3) return null;

    let room = '', name = '', teacher = '';

    const rmMatch = line.match(/\(([^)]+)\)/);
    if (rmMatch) {
        room = rmMatch[1].trim();
        name = line.substring(0, line.indexOf('(' + rmMatch[1] + ')')).trim();
        const after = line.substring(
            line.indexOf('(' + rmMatch[1] + ')') + rmMatch[1].length + 2
        ).trim();

        const hbMatch = after.match(/合班(.+?)(?:$|\.\d+班|\s)/);
        if (hbMatch) teacher = hbMatch[1].trim();

        if (!teacher) {
            const jgMatch = after.match(/教工(.+?)(?:#|$|\s)/);
            if (jgMatch) teacher = jgMatch[1].trim();
        }

        if (!teacher && after.length > 0 && !after.match(/^\d+班$/)) {
            teacher = after.replace(/\.\d+班$/, '').trim();
        }
    } else {
        name = line;
    }

    name = name.replace(/\s+/g, '');
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) return null;
    if (name.length > 50) name = name.substring(0, 50);

    return { name, teacher, room };
}

/**
 * 判断单元格文本是否是"节次标签"
 */
function isPeriodLabel(text) {
    const t = text.trim();
    if (!t) return false;

    const cleaned = t.replace(/\s+/g, '');
    const normalized = cleaned.replace(/^第/, '').replace(/节$/, '');

    if (/^[1-9]$/.test(normalized)) return true;
    if (/^(1[0-3]?)$/.test(normalized) && parseInt(normalized) <= UNIT_COUNT) return true;

    const rangeMatch = normalized.match(/^(\d{1,2})(?:[-–—~～,]|至)(\d{1,2})$/);
    if (rangeMatch) {
        const s = parseInt(rangeMatch[1]);
        const e = parseInt(rangeMatch[2]);
        if (s >= 1 && e <= UNIT_COUNT && s <= e) return true;
    }

    const rawTokens = (t.match(/\d{1,2}/g) || []).map(n => parseInt(n, 10));
    if (rawTokens.length >= 2 && rawTokens.every(n => n >= 1 && n <= UNIT_COUNT)) {
        const stripped = t.replace(/\d{1,2}/g, '').replace(/[第节\s]/g, '');
        if (!stripped) return true;
    }

    if (t.includes('晚') && (t.includes('上') || t.includes('自'))) return true;
    return false;
}

/**
 * 从节次标签文本解析出节次数字数组
 * "1" → [1], "3-4" → [3,4], "第6-7节" → [6,7], "6 7" → [6,7], "晚上" → [10,11,12]
 */
function parsePeriodText(text) {
    const t = text.trim();
    if (!t) return [];
    if (t.includes('晚') && (t.includes('上') || t.includes('自'))) return [10, 11, 12];

    const rawTokens = (t.match(/\d{1,2}/g) || [])
        .map(n => parseInt(n, 10))
        .filter(n => n >= 1 && n <= UNIT_COUNT);
    if (rawTokens.length >= 2) {
        const stripped = t.replace(/\d{1,2}/g, '').replace(/[第节\s]/g, '');
        if (!stripped) {
            const nums = [...new Set(rawTokens)].sort((a, b) => a - b);
            if (nums[nums.length - 1] - nums[0] + 1 === nums.length) return nums;
        }
    }

    // 优先检查原始文本中是否有换行或空白分隔符（如 "1\n2"）
    // 按 \n 或空白分割，每个部分独立解析为单个节次
    if (t.includes('\n') || t.includes('\r') || /\s{2,}/.test(t)) {
        const parts = t.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length >= 2) {
            const nums = [];
            for (const p of parts) {
                const n = parseInt(p, 10);
                if (n >= 1 && n <= UNIT_COUNT && !nums.includes(n)) nums.push(n);
            }
            if (nums.length >= 2) { nums.sort((a, b) => a - b); return nums; }
        }
    }

    const cleaned = t.replace(/\s+/g, '');
    const normalized = cleaned.replace(/^第/, '').replace(/节$/, '');

    const rangeMatch = normalized.match(/^(\d{1,2})(?:[-–—~～,]|至)(\d{1,2})$/);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start >= 1 && end <= UNIT_COUNT && start <= end) {
            const result = [];
            for (let i = start; i <= end; i++) result.push(i);
            return result;
        }
    }

    const singleMatch = normalized.match(/^(\d{1,2})$/);
    if (singleMatch) {
        const num = parseInt(singleMatch[1], 10);
        if (num >= 1 && num <= UNIT_COUNT) return [num];
    }

    const nums = (normalized.match(/\d{1,2}/g) || [])
        .map(n => parseInt(n, 10))
        .filter(n => n >= 1 && n <= UNIT_COUNT);
    if (nums.length > 0) {
        return [...new Set(nums)].sort((a, b) => a - b);
    }
    return [];
}

// ---------- DOM 解析（当前页面） ----------

/**
 * 在指定 window 对象中递归查找课表表格。
 * 匹配条件：表格第一行（表头）必须包含"星期一"且至少有 7 列（周一到周日）。
 * 支持表格位于 iframe 内的情况。
 */
function findCourseTable(win) {
    try {
        for (const t of win.document.querySelectorAll('table')) {
            // 初级筛选：表格内容要包含"星期一"
            if (!t.textContent.includes('星期一')) continue;
            // 中级筛选：表格第一行必须有至少 7 列
            if (t.rows.length === 0) continue;
            const firstRow = t.rows[0];
            if (firstRow.cells.length < 7) continue;
            // 高级筛选：第一行某列确实包含"星期一"文本
            let hasMondayHeader = false;
            for (let c = 0; c < firstRow.cells.length; c++) {
                if (firstRow.cells[c].textContent.includes('星期一')) {
                    hasMondayHeader = true;
                    break;
                }
            }
            if (hasMondayHeader) return t;
        }
    } catch (e) {
        // 跨域 iframe 无法访问，跳过
    }
    // 递归查找 iframe
    try {
        for (let i = 0; i < win.frames.length; i++) {
            const found = findCourseTable(win.frames[i]);
            if (found) return found;
        }
    } catch (e) {
        // 跨域 iframe 无法访问，跳过
    }
    return null;
}

/**
 * 从当前页面的 DOM 中，用 table.rows API 提取课程数据。
 *
 * 核心差异（对比旧脚本的 querySelectorAll 平铺方案）：
 *   旧脚本用 gridTable.querySelectorAll('td, th') 获取所有格子的扁平列表，
 *   在有 rowspan 时索引会错位，导致课程落到错误的星期列。
 *
 *   本方案用 table.rows[r].cells[c]——浏览器原生处理 rowspan，
 *   rowspan 覆盖的格在下一行的 cells 中自动消失，不需要手动追踪。
 */
function parseCourseTableFromCurrentPage() {
    const courses = [];
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

    const table = findCourseTable(window);
    if (!table) {
        console.warn("[JXNU] 未找到课表表格");
        return { courses, html: '' };
    }

    const pageHtml = document.documentElement.outerHTML;
    const rows = table.rows;
    if (rows.length < 3) {
        console.warn("[JXNU] 课表格行数不足:", rows.length);
        return { courses, html: pageHtml };
    }

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
        const rowText = rows[i].textContent.trim();
        if (dayNames.some(d => rowText.includes(d))) {
            headerRowIdx = i;
            break;
        }
    }
    if (headerRowIdx < 0) {
        console.warn("[JXNU] 未找到课表表头行");
        return { courses, html: pageHtml };
    }

    const headerRow = rows[headerRowIdx];
    const totalCols = headerRow.cells.length;
    console.log(`[JXNU] 表头共 ${totalCols} 列`);

    // 定位"星期一"所在列
    let firstDayCol = -1;
    for (let c = 0; c < totalCols; c++) {
        const t = headerRow.cells[c].textContent.trim().replace(/\s+/g, '');
        console.log(`[JXNU]   列 ${c}: "${t}"`);
        if (t.includes('星期一')) firstDayCol = c;
    }
    if (firstDayCol < 0) {
        console.warn("[JXNU] 未找到星期一的表头列");
        return { courses, html: pageHtml };
    }

    // dayColMap: 表头列索引 → 星期几
    const dayColMap = {};
    for (let c = firstDayCol; c < totalCols && c - firstDayCol < 7; c++) {
        dayColMap[c] = c - firstDayCol + 1;
    }
    console.log(`[JXNU] 星期一在列 ${firstDayCol}，dayColMap:`, JSON.stringify(dayColMap));

    // periodLabelCol = 星期一的前一列
    const periodLabelCol = firstDayCol - 1;
    console.log(`[JXNU] periodLabelCol=${periodLabelCol}`);

    // rowspan 追踪
    const rowspanActive = new Array(totalCols).fill(0);
    let totalPeriodRows = 0;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const cells = row.cells;
        if (cells.length < 2) {
            console.log(`[JXNU]   行 ${r}: 只有 ${cells.length} 格（分隔行）`);
        }

        // ---- 用 Column-pass 算法遍历 ----
        // 必须完整扫过每一列表头位，哪怕当前行可见单元格已经用完，
        // 否则末尾列的 rowspan 不会在这一行递减，后续行会整体错位。
        let periodText = '', foundPeriod = false;
        let periods = [], courseData = [];
        let cellIdx = 0;

        for (let col = 0; col < totalCols; col++) {
            if (rowspanActive[col] > 0) {
                rowspanActive[col]--;
                continue;
            }

            if (cellIdx >= cells.length) continue;

            const cell = cells[cellIdx++];
            if (cell.rowSpan > 1) rowspanActive[col] = cell.rowSpan - 1;

            const text = cell.textContent.trim();

            // 方案A：如果 col == periodLabelCol，用列位置判断
            // 方案B：同时检查 col > periodLabelCol 的短表格情况
            if (col === periodLabelCol) {
                if (text && isPeriodLabel(text)) {
                    periodText = text; periods = parsePeriodText(text);
                    foundPeriod = periods.length > 0;
                }
                if (foundPeriod) console.log(`[JXNU]   行${r} period: "${text.replace(/\s+/g,' ')}" → [${periods}]`);
            }

            // 如果是课程列，尝试从中提取课程名（用 isPeriodLabel 排除误判）
            if (dayColMap[col] && text && text.length >= 2 && text !== '\u00a0') {
                const cleanText = text.replace(/\s+/g, '');
                const skipWords = ['上午', '下午', '晚上', '中午', '中 午', '午休', '节次'];
                if (!skipWords.includes(cleanText) && text.length > 2) {
                    courseData.push({ cell, text, day: dayColMap[col] });
                    console.log(`[JXNU]   行${r} col${col}(周${dayColMap[col]}): "${text.replace(/\s+/g,' ').substring(0,60)}"`);
                }
            }
        }

        // 如果没找到 period → 尝试方案C：扫描当前行所有格找 period
        if (!foundPeriod) {
            for (let ci = 0; ci < cells.length; ci++) {
                const t = cells[ci].textContent.trim();
                if (t && isPeriodLabel(t)) {
                    periodText = t; periods = parsePeriodText(t);
                    foundPeriod = periods.length > 0;
                    console.log(`[JXNU]   行${r} [方案C] 扫描找到 period: "${t.replace(/\s+/g,' ')}" 在 cell[${ci}]`);
                    break;
                }
            }
        }

        if (!foundPeriod) {
            console.log(`[JXNU]   行${r}: 未找到节次标签`);
            continue;
        }

        totalPeriodRows++;
        let rowCount = 0;

        for (const { cell, text, day } of courseData) {
            let name = '', teacher = '', room = '';
            const titleEl = cell.querySelector('.title font, .title');

            if (titleEl) {
                name = titleEl.textContent.trim();
                if (/[\u4e00-\u9fa5a-zA-Z]/.test(name)) {
                    const pEls = cell.querySelectorAll('p font');
                    if (pEls.length >= 2) room = pEls[1].textContent.trim();
                    if (pEls.length >= 3) teacher = pEls[2].textContent.trim();
                    if (!room && pEls.length >= 1) {
                        const t = pEls[0].textContent.trim();
                        if (/[楼馆教栋区斋轩堂室]/.test(t)) room = t;
                    }
                } else { name = ''; }
            }

            if (!name) {
                const parsed = parseCellText(text);
                if (!parsed || !parsed.name) {
                    console.log(`[JXNU]     parseCellText失败: "${text.replace(/\s+/g,' ').substring(0,60)}"`);
                    continue;
                }
                name = parsed.name; teacher = parsed.teacher || teacher; room = parsed.room || room;
            }

            name = name.replace(/\s+/g, '');
            if (!/[\u4e00-\u9fa5a-zA-Z]/.test(name)) continue;

            courses.push({ name, teacher: teacher || '', position: room || '',
                day, startSection: periods[0], endSection: periods[periods.length - 1], weeks: [] });
            rowCount++;
        }
        console.log(`[JXNU]   行${r}: 解析到 ${rowCount} 门课`);
    }

    console.log(`[JXNU] 共 ${totalPeriodRows} 行数据`);

    const seen = new Set();
    const deduped = [];
    for (const c of courses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.teacher}|${c.position}`;
        if (!seen.has(key)) { seen.add(key); deduped.push(c); }
    }

    console.log(`[JXNU] 完成: ${courses.length} → ${deduped.length} 条`);
    return { courses: deduped, html: pageHtml };
}

// ---------- 时间段配置 ----------

function getTimeSlots() {
    return [
        { number: 1, startTime: "08:00", endTime: "08:40" },
        { number: 2, startTime: "08:50", endTime: "09:30" },
        { number: 3, startTime: "09:40", endTime: "10:20" },
        { number: 4, startTime: "10:30", endTime: "11:10" },
        { number: 5, startTime: "11:20", endTime: "12:00" },
        { number: 6, startTime: "14:00", endTime: "14:40" },
        { number: 7, startTime: "14:50", endTime: "15:30" },
        { number: 8, startTime: "15:40", endTime: "16:20" },
        { number: 9, startTime: "16:30", endTime: "17:10" },
        { number: 10, startTime: "19:00", endTime: "19:40" },
        { number: 11, startTime: "19:50", endTime: "20:30" },
        { number: 12, startTime: "20:40", endTime: "21:20" },
    ];
}

// ---------- 用户交互 ----------

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "江西师范大学 课表导入",
        "请确认：\n1. 已在浏览器中登录教务系统\n2. 已进入学生课表查询页面并选择了正确的学年学期\n3. 已点击【查询】按钮，课表已正常显示\n\n点击确定开始导入。",
        "确定，开始导入"
    );
}

async function getTotalWeeks() {
    return await window.shiguangBridgePromise.showPrompt(
        "设置本学期总周数",
        "请输入本学期总周数（默认 20，范围 1-55）:",
        "20",
        "validateWeeksInput"
    );
}

// ---------- 主流程 ----------

async function run() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

        const weeksInput = await getTotalWeeks();
        if (weeksInput === null) { window.shiguangBridge.showToast("导入已取消。"); return; }
        const totalWeeks = parseInt(weeksInput, 10);
        if (isNaN(totalWeeks) || totalWeeks < 1) { window.shiguangBridge.showToast("周数设置无效。"); return; }
        const defaultWeeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

        window.shiguangBridge.showToast("正在解析课表数据...");
        const { courses: parsedCourses, html: pageHtml } = parseCourseTableFromCurrentPage();

        if (parsedCourses.length === 0) {
            // 解析失败时给出更具体的提示
            let detail = "";
            if (!pageHtml.includes('星期一')) {
                detail = '当前页面不包含课表表格。请确认：\n' +
                    '1. 已进入学生课表查询页面\n' +
                    '2. 已选择学年学期并点击【查询】\n' +
                    '3. 课表已正常显示（页面中能看到"星期一"表头）';
            } else if (pageHtml.includes('星期一') && document.querySelectorAll('table').length > 0) {
                detail = '已找到包含"星期一"的课表表格，但未能从中解析出有效的课程数据。\n' +
                    '请确认已从下拉菜单中选择了正确的学年学期，并点击了【查询/确定】按钮。\n\n' +
                    '常见问题：\n' +
                    '1. 页面加载后未点击【查询】按钮\n' +
                    '2. 当前学期没有课程安排（课表空白）\n' +
                    '3. 选错了学年或学期';
            } else {
                detail = '未能在当前页面中找到课表数据。\n' +
                    '请确认已在学生课表查询页面正确选择了学期并点击了【查询】。';
            }
            await window.shiguangBridgePromise.showAlert("未解析到课程", detail, "确定");
            return;
        }

        const coursesWithWeeks = parsedCourses.map(c => ({
            name: c.name, teacher: c.teacher, position: c.position,
            day: c.day, startSection: c.startSection, endSection: c.endSection,
            weeks: c.weeks.length > 0 ? c.weeks : defaultWeeks,
        }));

        try {
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(coursesWithWeeks));
            window.shiguangBridge.showToast(`课程数据已导入（共 ${coursesWithWeeks.length} 条）`);
        } catch (saveErr) {
            console.error("[JXNU] 保存课程失败:", saveErr);
            await window.shiguangBridgePromise.showAlert("保存课程失败", saveErr.message || String(saveErr), "确定");
            return;
        }

        const timeSlots = getTimeSlots();
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("时间段数据已导入");
        } catch (slotErr) {
            console.error("[JXNU] 保存时间段失败:", slotErr);
            window.shiguangBridge.showToast(`时间段保存失败：${slotErr.message}`);
        }

        window.shiguangBridge.showToast("导入完成！");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (err) {
        console.error("[JXNU] 导入流程出错:", err);
        try {
            await window.shiguangBridgePromise.showAlert("导入失败", `未知错误：${err.message || err}\n\n请联系开发者。`, "确定");
        } catch (_) {}
        window.shiguangBridge.notifyTaskCompletion();
    }
}

run();
