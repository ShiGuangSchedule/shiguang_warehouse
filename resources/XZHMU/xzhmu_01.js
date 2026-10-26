// 徐州医科大学-研究生(xzhmu.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

const DAY_MAP = {
    'Monday': 1, 
    'Tuesday': 2, 
    'Wednesday': 3,
    'Thursday': 4, 
    'Friday': 5, 
    'Saturday': 6, 
    'Sunday': 7
};

/** 预设作息时间 */
const PRESET_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:40" },
    { number: 2,  startTime: "08:50", endTime: "09:30" },
    { number: 3,  startTime: "09:40", endTime: "10:20" },
    { number: 4,  startTime: "10:30", endTime: "11:10" },
    { number: 5,  startTime: "11:20", endTime: "12:00" },
    { number: 6,  startTime: "14:00", endTime: "14:40" },
    { number: 7,  startTime: "14:50", endTime: "15:30" },
    { number: 8,  startTime: "15:40", endTime: "16:20" },
    { number: 9,  startTime: "16:30", endTime: "17:10" },
    { number: 10, startTime: "17:20", endTime: "18:00" },
    { number: 11, startTime: "19:00", endTime: "19:40" },
    { number: 12, startTime: "19:50", endTime: "20:30" },
    { number: 13, startTime: "20:40", endTime: "21:20" }
];

/** 课表配置 */
const COURSE_CONFIG = {
    defaultClassDuration: 40,
    defaultBreakDuration: 10
};

/** 节次文本 -> 数字，提取末尾数字 */
function sectionTextToNumber(text) {
    const m = text.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : undefined;
}

/** 解析周次字符串，支持 "5-5周"、"1,3,5周"、"1-5(单)"、"第1-5周" 等 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = new Set();
    const cleaned = String(weekStr)
        .replace(/[周第]/g, '')
        .replace(/[，、；]/g, ',')
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')')
        .trim();

    const segRegex = /(\d+)(?:\s*-\s*(\d+))?\s*(?:\(?\s*([单双])\s*\)?)?/g;
    let match;
    while ((match = segRegex.exec(cleaned)) !== null) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : start;
        const flag = match[3] || '';
        for (let w = start; w <= end; w++) {
            if (flag === '单' && w % 2 === 0) continue;
            if (flag === '双' && w % 2 !== 0) continue;
            weeks.add(w);
        }
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

/** 穿透 iframe 查找包含课表的 document */
function getTargetDocument() {
    if (document.querySelector('table#kb.curriculum')) return document;

    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (doc && doc.querySelector('table#kb.curriculum')) {
                console.log(`JS: 在 iframe#${iframe.id || '(匿名)'} 中找到课表`);
                return doc;
            }
        } catch (e) {
            console.warn('JS: 无法访问 iframe', iframe.id, e.message);
        }
    }
    return null;
}

/** 提取两个 span 之间的裸文本（用于教师名） */
function extractTeacherBetweenSpans(root, afterSpanIndex, beforeSpanIndex) {
    const spans = root.querySelectorAll('span');
    if (spans.length <= afterSpanIndex || spans.length <= beforeSpanIndex) return '';

    const afterSpan = spans[afterSpanIndex];
    const beforeSpan = spans[beforeSpanIndex];

    let collecting = false;
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

    let node;
    while ((node = walker.nextNode())) {
        const parent = node.parentNode;
        if (parent === afterSpan) { collecting = true; continue; }
        if (parent === beforeSpan) { collecting = false; break; }
        if (collecting) text += node.textContent;
    }
    return text.trim();
}

/** 解析单个 C_kc_subject / C_kc_today_subject div，可能包含多门课 */
function parseSubjectDiv(div, day, startSection, endSection) {
    const courses = [];
    const ps = div.querySelectorAll('p');

    ps.forEach(p => {
        const html = p.innerHTML.replace(/<br\s*\/?>/gi, '\n');
        const blocks = html.split(/\n\s*\n/);

        blocks.forEach(block => {
            const trimmed = block.trim();
            if (!trimmed) return;

            const tmp = document.createElement('div');
            tmp.innerHTML = trimmed;

            const spans = Array.from(tmp.querySelectorAll('span'))
                .map(s => s.textContent.trim())
                .filter(Boolean);

            if (spans.length < 3) return;

            const name = spans[0];
            const weeksStr = spans[1];
            const position = spans[2];
            const teacher = extractTeacherBetweenSpans(tmp, 1, 2);
            const weeks = parseWeeks(weeksStr);

            if (!name || !position || weeks.length === 0) return;

            courses.push({
                name,
                teacher: teacher || '',
                position,
                day,
                startSection,
                endSection,
                weeks
            });
        });
    });
    return courses;
}

/** 解析 table#kb.curriculum */
function parseCurriculumTable() {
    const doc = getTargetDocument();
    if (!doc) {
        console.error('JS: 未在任何文档中找到课表 table#kb.curriculum');
        return [];
    }

    const table = doc.querySelector('table#kb.curriculum');
    if (!table) return [];

    const allCourses = [];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const coveredCells = new Set();

    rows.forEach((tr, rowIndex) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length === 0) return;

        const sectionText = tds[0].textContent.trim();
        const currentSection = sectionTextToNumber(sectionText);
        if (currentSection === undefined) return;

        for (let colIndex = 1; colIndex < tds.length; colIndex++) {
            const td = tds[colIndex];
            const key = `${rowIndex}-${colIndex}`;
            // 先判断是否被上方 rowspan 覆盖，避免重复解析
            if (coveredCells.has(key)) continue;

            const style = td.getAttribute('style') || '';
            if (style.includes('display: none')) continue;

            const dayAttr = td.getAttribute('w');
            const day = DAY_MAP[dayAttr];
            if (!day) continue;

            // 兼容普通课程与“今天”课程
            const div = td.querySelector('.C_kc_subject, .C_kc_today_subject');
            if (!div) continue;

            const rowspan = parseInt(td.getAttribute('rowspan') || '1', 10);
            const startSection = currentSection;
            const endSection = currentSection + rowspan - 1;

            for (let r = 1; r < rowspan; r++) {
                coveredCells.add(`${rowIndex + r}-${colIndex}`);
            }

            const courses = parseSubjectDiv(div, day, startSection, endSection);
            allCourses.push(...courses);
        }
    });

    return allCourses;
}

/** 抓取并解析课程数据 */
async function scrapeAndParseCourses() {
    window.shiguangBridge.showToast("正在检查页面并抓取课程数据...");
    try {
        const doc = getTargetDocument();
        if (!doc) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "未找到课表表格 (table#kb.curriculum)。\n请确认：\n1. 已登录教务系统\n2. 已进入课表查询页面\n3. 已点击查询且课表已加载",
                "确定"
            );
            return null;
        }

        const courses = parseCurriculumTable();
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未解析到任何课程，请检查课表是否加载完成。");
            return null;
        }

        console.log(`JS: 课程解析成功，共 ${courses.length} 条原始记录。`);
        return { courses };
    } catch (error) {
        console.error('JS: 抓取/解析失败:', error);
        window.shiguangBridge.showToast(`解析失败: ${error.message}`);
        await window.shiguangBridgePromise.showAlert(
            "解析失败",
            `发生错误：${error.message}\n请重试或联系开发者。`,
            "确定"
        );
        return null;
    }
}

/** 合并去重课程（参考《课程合并与去重函数》） */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    const step1Merged = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (sameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const step2Merged = [];
    let cur = step1Merged[0];
    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        const sameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (sameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/** 保存课程 */
async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(parsedCourses)
        );
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        console.error('JS: 课程保存失败:', error);
        window.shiguangBridge.showToast(`保存失败: ${error.message}`);
        return false;
    }
}

/** 保存课表配置 */
async function saveCourseConfig() {
    window.shiguangBridge.showToast("正在导入课表配置...");
    try {
        await window.shiguangBridgePromise.saveCourseConfig(
            JSON.stringify(COURSE_CONFIG)
        );
        console.log("JS: 课表配置保存成功！");
        return true;
    } catch (error) {
        console.error('JS: 课表配置保存失败:', error);
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        return false;
    }
}

/** 保存预设作息时间 */
async function savePresetTimeSlots() {
    window.shiguangBridge.showToast(`正在导入 ${PRESET_TIME_SLOTS.length} 节作息时间...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(PRESET_TIME_SLOTS)
        );
        console.log("JS: 作息时间保存成功！");
        return true;
    } catch (error) {
        console.error('JS: 作息时间保存失败:', error);
        window.shiguangBridge.showToast(`作息时间保存失败: ${error.message}`);
        return false;
    }
}

/** 流程编排 */
async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保：\n1. 已成功登录教务系统\n2. 已进入课表查询页面\n3. 已选择学年学期并点击【查询】\n4. 页面上已显示课程表",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }

    const merged = mergeAndDistinctCourses(result.courses);
    console.log(`JS: 合并去重后剩余 ${merged.length} 条记录。`);

    const saveResult = await saveCourses(merged);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    // 配置类导入失败不阻断流程
    await saveCourseConfig();
    await savePresetTimeSlots();

    window.shiguangBridge.showToast(`课程导入成功，共 ${merged.length} 条记录！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();