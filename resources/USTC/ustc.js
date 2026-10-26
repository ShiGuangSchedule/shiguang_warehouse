// 中国科学技术大学(ustc.edu.cn) 拾光课程表适配脚本

// ========== 辅助函数 ==========

/**
 * 解析 USTC 周次字符串
 * 支持格式: "1-16周", "1-8,10-16周", "1-15(单)周", "2-16(双)周", "1-5,9-11(单),12-15周"
 * @param {string} str - 周次字符串
 * @returns {number[]} - 周次数组，如 [1,2,3,4,5,9,11,12,13,14,15]
 */
function parseWeekString(str) {
    if (!str) return [];
    const parts = str.replace(/[^0-9,()单双\-]/g, '').split(',');
    const result = [];
    for (const part of parts) {
        if (!part.trim()) continue;
        // 匹配 "5-10(单)" 或 "6-12(双)" 格式
        const oddEvenMatch = part.match(/(\d+)-(\d+)\((单|双)\)/);
        if (oddEvenMatch) {
            const start = parseInt(oddEvenMatch[1]);
            const end = parseInt(oddEvenMatch[2]);
            const flag = oddEvenMatch[3];
            for (let i = start; i <= end; i++) {
                if (flag === '单' && i % 2 === 0) continue;
                if (flag === '双' && i % 2 !== 0) continue;
                result.push(i);
            }
        } else if (part.includes('-')) {
            // 匹配 "1-8" 格式
            const cleaned = part.replace(/[()]/g, '');
            const [start, end] = cleaned.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) result.push(i);
            }
        } else {
            // 匹配单个数字 "3"
            const num = parseInt(part);
            if (!isNaN(num)) result.push(num);
        }
    }
    return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * 解析节次字符串（复用 getWeekNumber 逻辑，支持范围格式）
 * @param {string} str - 如 "3,4,5" 或 "3-5"
 * @returns {number[]} - 如 [3, 4, 5]
 */
function parseTimeSpan(str) {
    if (!str) return [];
    const cleaned = str.replace(/[^0-9,-]/g, '');
    const parts = cleaned.split(',');
    const result = [];
    for (const part of parts) {
        if (!part.trim()) continue;
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) result.push(i);
            }
        } else {
            const num = Number(part);
            if (!isNaN(num)) result.push(num);
        }
    }
    return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * 合并同课程不同周的数据
 * 同一门课在不同周、相同时间段的条目合并 weeks 数组
 * @param {Array} courses - 原始课程数组
 * @returns {Array} - 合并后的课程数组
 */
function mergeCourses(courses) {
    const groups = {};
    courses.forEach(c => {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}`;
        if (!groups[key]) {
            groups[key] = { name: c.name, teacher: c.teacher, position: c.position, day: c.day, startSection: c.startSection, endSection: c.endSection, weeks: [] };
        }
        c.weeks.forEach(w => {
            if (!groups[key].weeks.includes(w)) groups[key].weeks.push(w);
        });
    });
    return Object.values(groups).sort((a, b) =>
        a.day !== b.day ? a.day - b.day : a.startSection - b.startSection
    );
}

// ========== DOM 解析 ==========

/**
 * 获取课表所在的 document 对象
 * USTC 教务系统将课表加载在 iframe 中（name="e-home-iframe-1"）
 * 需要先尝试直接访问，再尝试从 iframe 中获取
 * @returns {Document|null} - 课表所在的 document，未找到返回 null
 */
function getTimetableDocument() {
    // 策略 1：课表表格直接在当前页面（如脚本运行在 iframe 内部）
    var table = document.evaluate(
        "/html/body/div[2]/div[3]/div/div/table",
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;
    if (table) return document;

    // 策略 2：课表在 iframe 中（e-home-iframe-1 或任意 iframe）
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
        try {
            var iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
            if (!iframeDoc) continue;
            var t = iframeDoc.evaluate(
                "/html/body/div[2]/div[3]/div/div/table",
                iframeDoc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            ).singleNodeValue;
            if (t) return iframeDoc;
        } catch (e) {
            // 跨域 iframe 无法访问，跳过
        }
    }

    // 策略 3：尝试更通用的选择器（适配页面结构变化）
    // 在当前页面和 iframe 中查找包含课程元素的 table
    var allDocs = [document];
    for (var j = 0; j < iframes.length; j++) {
        try {
            var doc = iframes[j].contentDocument || iframes[j].contentWindow.document;
            if (doc) allDocs.push(doc);
        } catch (e) { /* skip cross-origin */ }
    }
    for (var k = 0; k < allDocs.length; k++) {
        var courseElements = allDocs[k].querySelectorAll('.c');
        if (courseElements.length > 0) return allDocs[k];
    }

    return null;
}

/**
 * 从指定 document 中解析所有课程数据
 *
 * 课程元素（.c class）内部结构:
 * - .title: 课程名称
 * - .teacher .name: 教师姓名（可多个）
 * - .time .week: 上课周次
 * - .timespan: 上课节次
 * - .classroom .name: 上课教室
 *
 * @param {Document} doc - 包含课表的 document 对象
 * @returns {Array} - 拾光课表格式的课程数组
 */
function parseCoursesFromDoc(doc) {
    var timeTable = doc.evaluate(
        "/html/body/div[2]/div[3]/div/div/table",
        doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue;
    if (!timeTable) return [];

    var rows = timeTable.getElementsByTagName("tr");
    var allCourses = [];

    for (var dayNumber = 0; dayNumber < 7; dayNumber++) {
        for (var i = 0; i < rows.length; i++) {
            // 带有 class 属性的 <tr> 是包含课程数据的行
            if (!rows[i].hasAttribute("class")) continue;
            var cells = rows[i].getElementsByTagName("td");
            var count = 0;
            var dayIdx = dayNumber;
            // 找到第 dayNumber 个不带 style 的 <td>（即对应星期几的列）
            var target = Array.from(cells).find(function(elem) {
                if (!elem.hasAttribute("style")) return ++count > dayIdx;
                return false;
            });
            if (!target) continue;

            // 提取该单元格中所有课程元素
            var elements = target.querySelectorAll(".c");
            elements.forEach(function(el) {
                var name = el.querySelector(".title")?.innerText?.trim();
                var teacher = Array.from(el.querySelectorAll(".teacher .name"))
                    .map(function(e) { return e.innerText.trim(); }).join(", ");
                var weekStr = el.querySelector(".time .week")?.innerText?.trim();
                var timeSpanStr = el.querySelector(".timespan")?.innerText?.trim();
                var location = el.querySelector(".classroom .name")?.innerText?.trim();

                if (!name || !weekStr || !timeSpanStr) return;

                var weeks = parseWeekString(weekStr);
                var timeSpan = parseTimeSpan(timeSpanStr);
                if (weeks.length === 0 || timeSpan.length === 0) return;

                allCourses.push({
                    name: name,
                    teacher: teacher || "未知教师",
                    position: location || "",
                    day: dayNumber + 1,  // 0=周一 → 1
                    startSection: Math.min.apply(null, timeSpan),
                    endSection: Math.max.apply(null, timeSpan),
                    weeks: weeks
                });
            });
        }
    }

    return mergeCourses(allCourses);
}

/**
 * 从页面提取学期名称
 * 在当前页面和 iframe 中查找学期选择器
 * @returns {string} - 学期名称
 */
function getSemesterName() {
    // 尝试在当前页面查找
    var el = document.querySelector(
        '.selectize-input.items.full.has-options.has-items .item'
    );
    if (el) return el.textContent.trim();

    // 尝试在 iframe 中查找
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
        try {
            var iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
            if (!iframeDoc) continue;
            var iframeEl = iframeDoc.querySelector(
                '.selectize-input.items.full.has-options.has-items .item'
            );
            if (iframeEl) return iframeEl.textContent.trim();
        } catch (e) { /* skip cross-origin */ }
    }

    // 尝试更通用的选择器
    var semesterSpan = document.querySelector('.currentSemester');
    if (semesterSpan) return semesterSpan.textContent.trim().replace(/，$/, '');

    return '未知学期';
}

// ========== USTC 时间段 ==========

/**
 * 获取 USTC 课程时间段配置
 * @returns {Array} - TimeSlotJsonModel 数组
 */
function getUSTCTimeSlots() {
    return [
        { number: 1, startTime: "07:50", endTime: "08:35" },
        { number: 2, startTime: "08:40", endTime: "09:25" },
        { number: 3, startTime: "09:45", endTime: "10:30" },
        { number: 4, startTime: "10:35", endTime: "11:20" },
        { number: 5, startTime: "11:25", endTime: "12:10" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "14:50", endTime: "15:35" },
        { number: 8, startTime: "15:55", endTime: "16:40" },
        { number: 9, startTime: "16:45", endTime: "17:30" },
        { number: 10, startTime: "17:35", endTime: "18:20" },
        { number: 11, startTime: "19:30", endTime: "20:15" },
        { number: 12, startTime: "20:20", endTime: "21:05" },
        { number: 13, startTime: "21:10", endTime: "21:55" }
    ];
}

// ========== 轮询等待 DOM 加载 ==========

/**
 * 延迟指定毫秒
 * @param {number} ms - 毫秒数
 * @returns {Promise}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 轮询等待课表 DOM 加载完成
 * 尝试在当前页面和 iframe 中查找课表表格
 * @param {number} intervalMs - 轮询间隔（毫秒）
 * @param {number} maxAttempts - 最大尝试次数
 * @returns {Promise<Document|null>} - 课表所在的 document，超时返回 null
 */
async function pollUntilTableReady(intervalMs, maxAttempts) {
    intervalMs = intervalMs || 1000;
    maxAttempts = maxAttempts || 30;
    for (var i = 0; i < maxAttempts; i++) {
        var doc = getTimetableDocument();
        if (doc) return doc;
        if (i < maxAttempts - 1) await delay(intervalMs);
    }
    return null;
}

// ========== 主流程 ==========

/**
 * 编排整个课程导入流程
 * 在任何一步用户取消或发生错误时，都会立即退出
 * AndroidBridge.notifyTaskCompletion() 只在完全成功后调用
 */
async function runImportFlow() {
    // 步骤 1：提示用户
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "USTC 课表导入",
        "请确保您已登录教务系统(jw.ustc.edu.cn)并处于课表查询页面。\n\n" +
        "操作步骤：\n" +
        "1. 登录教务系统\n" +
        "2. 进入「学生课表」页面\n" +
        "3. 选择需要导入的学期\n" +
        "4. 等待课表加载完成后点击「开始导入」",
        "好的，开始导入"
    );
    if (!confirmed) return;

    // 步骤 2：检查当前页面是否为教务系统
    if (!window.location.href.startsWith("https://jw.ustc.edu.cn")) {
        await window.shiguangBridgePromise.showAlert(
            "页面错误",
            "当前页面不是教务系统页面，请先登录并导航到「学生课表」页面。",
            "确定"
        );
        return;
    }

    // 步骤 3：轮询等待课表 DOM 加载完成（含 iframe 检测）
    window.shiguangBridge.showToast("正在等待课表加载...");
    var timetableDoc = await pollUntilTableReady();
    if (!timetableDoc) {
        window.shiguangBridge.showToast("未找到课表，请确认已进入「学生课表」页面且课表已加载");
        return;
    }

    // 步骤 4：解析课程数据（表格已加载，可能为空学期）
    var courses = parseCoursesFromDoc(timetableDoc);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("该学期暂无课程数据");
        return;
    }

    // 步骤 5：提取学期信息（用于 Toast 提示）
    var semesterName = getSemesterName();

    // 步骤 6：保存时间段
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(getUSTCTimeSlots())
        );
    } catch (e) {
        window.shiguangBridge.showToast("保存时间段失败: " + e.message);
        return;
    }

    // 步骤 7：保存课程
    try {
        await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );
    } catch (e) {
        window.shiguangBridge.showToast("保存课程失败: " + e.message);
        return;
    }

    // 步骤 8：完成
    window.shiguangBridge.showToast("成功导入 " + courses.length + " 门课程（" + semesterName + "）");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
