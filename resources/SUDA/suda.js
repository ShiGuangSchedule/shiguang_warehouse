// 苏州大学(suda.edu.cn)拾光课程表适配脚本
// Author：BernardYan2357

// ========================== 作息时间表 ==========================

const TimeSlots = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:50", endTime: "09:35" },
    { number: 3,  startTime: "09:55", endTime: "10:40" },
    { number: 4,  startTime: "10:45", endTime: "11:30" },
    { number: 5,  startTime: "11:35", endTime: "12:20" },
    { number: 6,  startTime: "14:00", endTime: "14:45" },
    { number: 7,  startTime: "14:50", endTime: "15:35" },
    { number: 8,  startTime: "15:55", endTime: "16:40" },
    { number: 9,  startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:25", endTime: "20:10" },
    { number: 12, startTime: "20:20", endTime: "21:05" }
];

// ========================== 解析函数 ==========================

/**
 * 解析时间行，提取星期、节次、周次
 * 示例: "周一第3,4,5节{第1-17周}" / "周二第8,9节{第2-16周|双周}"
 */
function parseTimeLine(timeLine) {
    const dayMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
    const dayM = timeLine.match(/周([一二三四五六日天])/);
    if (!dayM) return null;
    const day = dayMap[dayM[1]];
    const secM = timeLine.match(/第([0-9]+(?:,[0-9]+)*)节/);
    if (!secM) return null;
    const sections = secM[1].split(",").map(s => parseInt(s, 10)).filter(Number.isFinite);
    if (!sections.length) return null;
    const braceM = timeLine.match(/\{([^}]*)\}/);
    if (!braceM) return null;
    const brace = braceM[1];
    const rangeM = brace.match(/第(\d+)-(\d+)周/);
    if (!rangeM) return null;
    const startWeek = parseInt(rangeM[1], 10);
    const endWeek = parseInt(rangeM[2], 10);
    if (!Number.isFinite(startWeek) || !Number.isFinite(endWeek) || endWeek < startWeek) return null;
    let oddEven = "all";
    if (/\|单周/.test(brace)) oddEven = "odd";
    if (/\|双周/.test(brace)) oddEven = "even";
    const weeks = [];
    for (let w = startWeek; w <= endWeek; w++) {
        if (oddEven === "odd" && w % 2 === 0) continue;
        if (oddEven === "even" && w % 2 === 1) continue;
        weeks.push(w);
    }
    return { day, sections, weeks };
}

/**
 * 从课表 table 元素中解析所有课程
 */
function parseCourseTable(table) {
    const anchors = Array.from(table.querySelectorAll("a"));
    const courses = [];
    for (const a of anchors) {
        // innerHTML 确保 <br> 被转为换行符
        const rawText = (a.innerHTML || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/gi, " ")
            .replace(/\u00a0/g, " ")
            .replace(/\r/g, "")
            .trim();
        // 每个 <a> 的文本结构:  课程名 / 时间行 / 老师 / 地点
        const lines = rawText.split("\n").map(s => s.trim()).filter(Boolean);
        if (lines.length < 2) continue;
        const name = lines[0] || "";
        const timeLine = lines[1] || "";
        const teacher = lines[2] || "";
        const position = lines[3] || "";
        const parsed = parseTimeLine(timeLine);
        if (!parsed) continue;
        courses.push({
            name,
            teacher,
            position,
            day: parsed.day,
            startSection: Math.min(...parsed.sections),
            endSection: Math.max(...parsed.sections),
            weeks: parsed.weeks
        });
    }
    // 去重 → 合并相邻节次
    return mergeAdjacentSections(deduplicateCourses(courses));
}

/**
 * 去除重复课程（同名同老师同地点同时间同周次视为重复）
 */
function deduplicateCourses(list) {
    const seen = new Set();
    return list.filter(c => {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 合并同一课程相邻/连续的节次
 * 例如: 电工学（二）周一 第2节 + 第3,4,5节 → startSection=2, endSection=5
 * 不同 weeks 不合并（如单双周保持独立）
 */
function mergeAdjacentSections(list) {
    const groupMap = new Map();
    for (const c of list) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.weeks.join(",")}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(c);
    }
    const merged = [];
    for (const entries of groupMap.values()) {
        entries.sort((a, b) => a.startSection - b.startSection);
        let cur = { ...entries[0] };
        for (let i = 1; i < entries.length; i++) {
            const next = entries[i];
            if (next.startSection <= cur.endSection + 1) {
                cur.endSection = Math.max(cur.endSection, next.endSection);
            } else {
                merged.push(cur);
                cur = { ...next };
            }
        }
        merged.push(cur);
    }
    return merged;
}

/**
 * 检测学期开始日期
 * 读取 select#xqd（学期1/2）和 select#xnd（学年如"2025-2026"）
 * @param {Document} [doc=document] - 课表所在的 document（可能来自 iframe）
 */
function detectSemesterStartDate(doc) {
    try {
        doc = doc || document;
        const xqdSelect = doc.querySelector('select#xqd');
        const xndSelect = doc.querySelector('select#xnd');
        if (!xqdSelect) return null;
        const semester = parseInt(xqdSelect.value, 10);
        let startYear = new Date().getFullYear();
        if (xndSelect && xndSelect.value) {
            const m = xndSelect.value.match(/(\d{4})/);
            if (m) startYear = parseInt(m[1], 10);
        }
        if (semester === 1) return `${startYear}-09-01`;
        if (semester === 2) return `${startYear + 1}-03-02`;
        return null;
    } catch (e) {
        console.warn("检测学期开始日期失败:", e);
        return null;
    }
}

/**
 * 查找课表 table，兼容直接打开课表页和通过 iframe 嵌套的情况
 * @returns {HTMLTableElement|null}
 */
function findScheduleTable() {
    const selector = 'table#Table1.schedule';
    // 1. 先在当前文档查找
    let table = document.querySelector(selector);
    if (table) return table;
    // 2. 遍历 iframe 查找（同源才能访问）
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) continue;
            table = doc.querySelector(selector);
            if (table) return table;
            // 再查一层嵌套 iframe
            for (const inner of doc.querySelectorAll('iframe')) {
                try {
                    const innerDoc = inner.contentDocument || inner.contentWindow?.document;
                    if (!innerDoc) continue;
                    table = innerDoc.querySelector(selector);
                    if (table) return table;
                } catch (_) { /* 跨域忽略 */ }
            }
        } catch (_) { /* 跨域忽略 */ }
    }
    return null;
}

// ========================== 主流程 ==========================

async function runImportFlow() {
    // 1. 开始提示
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "苏大课表导入",
        "请确保当前页面已显示「学生个人课表」\n导入前请先在页面上选好学年和学期",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    // 2. 查找课表
    window.shiguangBridge.showToast("正在查找课表...");
    const table = findScheduleTable();
    if (!table) {
        window.shiguangBridge.showToast("未找到课表，请先打开「学生个人课表」页面。");
        return;
    }
    // 3. 解析课程
    window.shiguangBridge.showToast("正在解析课程数据...");
    const courses = parseCourseTable(table);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到任何课程，请确认课表已正确加载。");
        return;
    }
    // 4. 保存课程
    window.shiguangBridge.showToast(`正在保存 ${courses.length} 条课程...`);
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    // 5. 保存作息时间
    window.shiguangBridge.showToast(`正在导入 ${TimeSlots.length} 个时间段...`);
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
    // 6. 保存配置（select 在课表同一文档中，用 ownerDocument 确保 iframe 场景正确）
    const semesterStartDate = detectSemesterStartDate(table.ownerDocument);
    const config = {
        semesterStartDate: semesterStartDate,
        semesterTotalWeeks: 20,
        firstDayOfWeek: 1
    };
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    // 7. 完成
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 条课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();