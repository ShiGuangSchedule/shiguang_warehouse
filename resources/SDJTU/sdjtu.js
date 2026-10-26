// 山东交通学院 (sdjtu.edu.cn) 拾光课程表适配脚本
// 教务系统类型：强智教务（通过深信服WebVPN访问）
// 直接读取页面DOM解析课表，WebVPN代理下fetch可能失败

/**
 * 将周次字符串解析为数字数组
 * 支持格式: 任意单周/单双周/区间/混合等组合
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    const pureWeekData = weekStr.split('(')[0];

    pureWeekData.split(',').forEach(seg => {
        seg = seg.trim();
        if (seg.includes('-')) {
            const [s, e] = seg.split('-').map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = s; i <= e; i++) weeks.push(i);
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 获取包含课表表格的文档对象
 * 优先当前页面，其次遍历iframe查找
 */
function getScheduleDocument() {
    // 1. 当前页面直接包含课表
    if (document.getElementById('kbtable')) {
        return document;
    }
    // 2. 在iframe中查找课表
    const iframes = document.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
        try {
            const iframeDoc = iframes[i].contentDocument;
            if (iframeDoc && iframeDoc.getElementById('kbtable')) {
                return iframeDoc;
            }
        } catch (e) {
            // 跨域iframe无法访问，跳过
        }
    }
    return null;
}

/**
 * 从DOM元素中按<br>分割提取行文本
 * 解决未挂载元素innerText无换行的问题
 */
function extractLines(element) {
    const lines = [];
    let currentLine = '';
    for (let i = 0; i < element.childNodes.length; i++) {
        const node = element.childNodes[i];
        if (node.nodeName === 'BR') {
            lines.push(currentLine.trim());
            currentLine = '';
        } else {
            currentLine += node.textContent;
        }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    return lines.filter(l => l.length > 0);
}

/**
 * 无法post到课表信息，故从课表HTML中解析时间段信息
 * 行头格式: "第一大节\n08:30-10:00"
 * 每个大节包含2个小节
 */
function parseTimeSlots(doc) {
    const table = doc.getElementById('kbtable');
    if (!table) return [];

    const rows = table.querySelectorAll('tr');
    const timeSlots = [];
    let sectionNum = 1;

    for (let i = 1; i < rows.length; i++) {
        const ths = rows[i].querySelectorAll('th');
        if (ths.length === 0) continue;

        const headerText = ths[0].innerText.trim();
        // 跳过备注行
        if (headerText.startsWith('备注')) continue;

        // 提取时间范围，格式如 "08:30-10:00"
        const timeMatch = headerText.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        if (!timeMatch) continue;

        const startTime = timeMatch[1];
        const endTime = timeMatch[2];

        // 每小节固定45分钟。
        // 第一小节从大节开始时间起算；第二小节从大节结束时间往前推45分钟。
        // 这样既兼容90分钟大节（45+45无课间），也兼容95分钟大节（45+5课间+45）
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const startMinutes = sh * 60 + sm;
        const endMinutes = eh * 60 + em;
        const CLASS_DURATION = 45;

        // 第一小节
        timeSlots.push({
            number: sectionNum++,
            startTime: startTime,
            endTime: formatTime(startMinutes + CLASS_DURATION)
        });

        // 第二小节（从大节结束时间往前推45分钟）
        timeSlots.push({
            number: sectionNum++,
            startTime: formatTime(endMinutes - CLASS_DURATION),
            endTime: endTime
        });
    }

    return timeSlots;
}

/**
 * 将分钟数格式化为 HH:mm
 */
function formatTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 解析课表HTML，提取课程数据
 */
function parseCourses(doc) {
    const table = doc.getElementById('kbtable');
    if (!table) return [];

    const courses = [];
    const rows = table.querySelectorAll('tr');

    // 从第2行开始遍历（第1行是星期表头）
    for (let i = 1; i < rows.length; i++) {
        const tds = rows[i].querySelectorAll('td');
        if (tds.length === 0) continue;

        // 遍历每一天的列（td索引0=星期一, 1=星期二, ..., 5=星期六）
        tds.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 1=周一, 6=周六

            // 获取显示视图的div（class="kbcontent"）
            const contentDivs = cell.querySelectorAll('.kbcontent');
            contentDivs.forEach(div => {
                const rawHtml = div.innerHTML.trim();
                if (!rawHtml || rawHtml === '&nbsp;') return;

                // 按分隔线拆分为多个课程块
                const blocks = rawHtml.split(/-{5,}/);

                blocks.forEach(block => {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    // 按<br>分割为行
                    const lines = extractLines(tempDiv);
                    if (lines.length < 2) return;

                    // 找到课程代码行（格式: 数字-数字+字母）
                    let codeLineIdx = -1;
                    for (let li = 0; li < lines.length; li++) {
                        if (/^\d{6}-\d{6}/.test(lines[li])) {
                            codeLineIdx = li;
                            break;
                        }
                    }
                    if (codeLineIdx === -1 || codeLineIdx + 1 >= lines.length) return;

                    // 课程名称 = 代码行下一行，去除尾部O/P调课标记
                    const name = lines[codeLineIdx + 1]
                        .replace(/[\s ]*[OP]\s*$/, '')
                        .trim();

                    // 提取各字段
                    const teacherFont = tempDiv.querySelector('font[title="老师"]') ||
                        tempDiv.querySelector('font[title="教师"]');
                    const weekFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    const roomFont = tempDiv.querySelector('font[title="教室"]');

                    if (!weekFont) return;

                    const weekInfo = weekFont.textContent.trim();
                    const teacher = teacherFont ? teacherFont.textContent.trim() : '';
                    const position = roomFont ? roomFont.textContent.trim() : '';

                    // 解析节次
                    const secMatch = weekInfo.match(/\[(\d+)(?:-(\d+))?节\]/);
                    if (!secMatch) return;

                    const startSection = parseInt(secMatch[1]);
                    const endSection = secMatch[2] ? parseInt(secMatch[2]) : startSection;

                    // 解析周次
                    const weeks = parseWeeks(weekInfo);
                    if (weeks.length === 0 || !name) return;

                    courses.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        day: day,
                        startSection: startSection,
                        endSection: endSection,
                        weeks: weeks
                    });
                });
            });
        });
    }

    return courses;
}

/**
 * 读取当前页面选中的学期ID
 */
function getSemesterId(doc) {
    const select = doc.getElementById('xnxq01id');
    if (!select) return '未知学期';
    return select.value || '未知学期';
}

/**
 * 日期输入验证函数
 */
window.validateDateInput = function (input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        const d = new Date(input);
        if (!isNaN(d.getTime())) return false; // 验证通过
    }
    return "请输入正确的日期格式，如 2026-02-23";
};

/**
 * 根据学期ID推算默认开学日期
 * 第一学期（秋季）默认9月1日，第二学期（春季）默认2月23日
 */
function getDefaultStartDate(semesterId) {
    const match = semesterId.match(/^(\d{4})-(\d{4})-(\d)$/);
    if (!match) return '';
    const year = parseInt(match[1]);
    const sem = parseInt(match[3]);
    if (sem === 1) {
        return `${year}-08-24`;
    } else {
        return `${parseInt(match[2])}-02-23`;
    }
}

/**
 * 获取用户输入的开学日期
 * 本校寒暑假的开学时间都不固定，故采用此方案
 */
async function getSemesterStartDate(semesterId) {
    const defaultDate = getDefaultStartDate(semesterId);
    const dateInput = await window.shiguangBridgePromise.showPrompt(
        "设置开学日期",
        "请输入本学期开学日期，一般为周一（格式 YYYY-MM-DD，如 2026-02-23）：",
        defaultDate,
        "validateDateInput"
    );
    return dateInput; // 用户取消返回 null
}

/**
 * 主流程
 */
async function runImportFlow() {
    try {
        // 1. 确认提示
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "导入提示",
            "请确保您已登录教务系统并打开了【学期理论课表】页面（已选好学期）。\n脚本将直接读取当前页面的课表数据。",
            "确认并开始"
        );
        if (!confirmed) return;

        // 2. 获取课表文档
        const doc = getScheduleDocument();
        if (!doc) {
            window.shiguangBridge.showToast("未找到课表页面，请先打开【学期理论课表】");
            return;
        }

        const semesterId = getSemesterId(doc);

        // 3. 获取开学日期
        const startDate = await getSemesterStartDate(semesterId);
        if (startDate === null) {
            window.shiguangBridge.showToast("已取消开学日期输入");
            return;
        }

        // 4. 解析课程数据
        const courses = parseCourses(doc);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未获取到课程数据，该学期可能暂无课表");
            return;
        }

        // 5. 解析时间段
        const timeSlots = parseTimeSlots(doc);

        // 6. 保存数据
        if (timeSlots.length > 0) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        // 7. 保存课表配置（含开学日期）
        const config = {
            semesterStartDate: startDate,
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 5,
            firstDayOfWeek: 1
        };
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

        window.shiguangBridge.showToast(`[${semesterId}] 成功导入 ${courses.length} 条课程记录！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("适配脚本异常:", error);
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动导入流程
runImportFlow();
