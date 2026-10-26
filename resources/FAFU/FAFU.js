// 文件: FAFU.js (v3)
// 福建农林大学教务系统课程表导入脚本
// 适配对象: 经典正方教务系统 (jwgl.fafu.edu.cn, default2.aspx)
// 说明: 解析"时间网格"式课表 —— 行为节次、列为星期，
//      课程单元格为分行文本(课程名 / 周X第Y节{第X-Y周} / 教师 / 地点)。
//      v3: 支持课表位于同源 iframe 内；用 innerHTML 按 <br> 切行；失败时输出诊断。

// ---------------- 通用工具 ----------------
function cleanText(s) {
    return (s || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 展开周次数组 "1-16" 及 单/双周 过滤
function expandWeeks(start, end, parity) {
    const weeks = [];
    for (let i = start; i <= end; i++) {
        if (parity === 1 && i % 2 !== 1) continue;
        if (parity === 2 && i % 2 !== 0) continue;
        weeks.push(i);
    }
    return weeks;
}

// 解析课程信息行："周一第1,2节{第1-5周}" / "{第1-17周|2节/周}" / "{第16-16周|双周}"
function parseInfoLine(info) {
    let day = 0;
    const dayM = /星期?([一二三四五六日])/.exec(info || '');
    if (dayM) day = '一二三四五六日'.indexOf(dayM[1]) + 1;

    let sections = [];
    const secM = /第(\d+(?:,\d+)*)节/.exec(info || '');
    if (secM) sections = secM[1].split(',').map(Number);

    let weekStart = 0, weekEnd = 0;
    const wM = /第(\d+)(?:-(\d+))?周/.exec(info || '');
    if (wM) {
        weekStart = parseInt(wM[1]);
        weekEnd = wM[2] ? parseInt(wM[2]) : weekStart;
    }
    let parity = 0;
    if (/单周/.test(info || '')) parity = 1;
    else if (/双周/.test(info || '')) parity = 2;

    return { day, sections, weekStart, weekEnd, parity };
}

// ---------------- 若课表在 iframe 中，需递归收集同源文档 ----------------
function getAllDocs() {
    const docs = [document];
    const seen = new Set([document]);
    (function walk(doc) {
        try {
            const frames = doc.querySelectorAll('iframe, frame');
            frames.forEach(f => {
                const inner = f.contentDocument;
                if (inner && !seen.has(inner)) {
                    seen.add(inner);
                    docs.push(inner);
                    walk(inner);
                }
            });
        } catch (e) { /* 跨域 iframe 无法访问，忽略 */ }
    })(document);
    return docs;
}

// 在所有文档中定位课表网格
function locateGridTable() {
    for (const doc of getAllDocs()) {
        const tables = doc.querySelectorAll('table');
        for (const t of tables) {
            const txt = cleanText(t.textContent || '');
            if (txt.includes('上午') && txt.includes('第1节') &&
                /星期[一二三四五六日]/.test(txt)) {
                return t;
            }
        }
    }
    return null;
}

function countTables() {
    return getAllDocs().reduce((n, d) => n + d.querySelectorAll('table').length, 0);
}

// 星期列的水平范围 {星期号: {left, right}}
function buildDayColumns(table) {
    const headerTr = Array.from(table.querySelectorAll('tr'))
        .find(tr => /星期[一二三四五六日]/.test(tr.textContent || ''));
    if (!headerTr) return {};
    const cols = {};
    Array.from(headerTr.querySelectorAll('td, th')).forEach(td => {
        const m = /星期([一二三四五六日])/.exec(td.textContent || '');
        if (!m) return;
        const dayNum = '一二三四五六日'.indexOf(m[1]) + 1;
        const r = td.getBoundingClientRect();
        if (r.width > 0) cols[dayNum] = { left: r.left, right: r.right };
    });
    return cols;
}

// 因单元格有 rowspan/colspan，用几何位置判断其属于哪个星期列
function dayFromRect(td, dayCols) {
    const r = td.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    for (const dayNum in dayCols) {
        const c = dayCols[dayNum];
        if (cx >= c.left - 2 && cx <= c.right + 2) return parseInt(dayNum);
    }
    return 0;
}

// 用单元格 HTML 按 <br> 切行(不依赖 innerText，隐藏表格也能解析)
function cellLines(td) {
    const html = td.innerHTML || '';
    return html.split(/<br\s*\/?>/i)
        .map(s => cleanText(s.replace(/<[^>]*>/g, '')));
}

// 把行按空行切成课程块，每块 4 行：课程名/节次周次/教师/地点
function splitBlocks(lines) {
    const blocks = [];
    let cur = [];
    for (const ln of lines) {
        if (ln === '') {
            if (cur.length) { blocks.push(cur); cur = []; }
        } else {
            cur.push(ln);
        }
    }
    if (cur.length) blocks.push(cur);
    return blocks;
}

// 解析网格课表
function parseGridTable(table) {
    const dayCols = buildDayColumns(table);
    const courses = [];
    const rows = Array.from(table.querySelectorAll('tr'));

    rows.forEach(tr => {
        // 该行首个"第X节"标签（用于无节次信息的课程，如体育）
        let rowSectionStart = 0;
        Array.from(tr.querySelectorAll('td')).forEach(td => {
            if (rowSectionStart) return;
            const m = /^第(\d+)节$/.exec(cleanText(td.innerText || td.textContent || ''));
            if (m) rowSectionStart = parseInt(m[1]);
        });

        Array.from(tr.querySelectorAll('td')).forEach(td => {
            const lines = cellLines(td).map(l => l.trim());
            if (!lines.some(l => l)) return; // 全空则跳过
            const blocks = splitBlocks(lines);

            blocks.forEach(block => {
                // 课程块需至少 4 行且末行为地点（可过滤"上午/早晨/第X节"等标签）
                if (block.length < 4 || !block[3]) return;
                const name = block[0] || '';
                const info = block[1] || '';
                const teacher = block[2] || '';
                const location = block[3] || '';

                const parsed = parseInfoLine(info);
                const day = parsed.day || dayFromRect(td, dayCols);

                let sections = parsed.sections;
                if (!sections.length && rowSectionStart) {
                    const span = td.rowSpan || 1;
                    sections = Array.from({ length: span }, (_, i) => rowSectionStart + i);
                }
                const weeks = expandWeeks(parsed.weekStart, parsed.weekEnd, parsed.parity);

                if (!day || !sections.length || !weeks.length || !name) return;
                courses.push({
                    name: name,
                    day: day,
                    weeks: weeks,
                    teacher: teacher,
                    position: location,
                    startSection: sections[0],
                    endSection: sections[sections.length - 1]
                });
            });
        });
    });
    return courses;
}

// ---------------- 主流程 ----------------
async function scrapeAndParseCourses() {
    window.shiguangBridge.showToast("正在解析课表数据...");
    const table = locateGridTable();
    if (!table) {
        const ts = countTables();
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            "未定位到课表网格。\n当前共检测到 " + ts + " 个表格。\n请确认：\n1.已登录教务系统\n2.已在【信息查询-学生个人课表】点击【查询】并显示课程\n3.若课表在 iframe/新窗口，脚本已自动尝试进入同源 iframe" +
            (ts === 0 ? "\n\n提示：检测到 0 个表格，可能脚本运行于错误页面/跨域 iframe，请返回课表页面后重试。" : ""),
            "确定"
        );
        return null;
    }
    const result = parseGridTable(table);
    if (result.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            "已定位到课表，但未解析出任何课程。\n请点击【查询】让课表显示课程数据后重试。",
            "确定"
        );
        return null;
    }
    return { courses: result };
}

async function saveCourses(courses) {
    window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

// 预设时间段
const presetTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:50", endTime: "16:35" },
    { number: 9, startTime: "16:40", endTime: "17:25" },
    { number: 10, startTime: "18:25", endTime: "19:10" },
    { number: 11, startTime: "19:15", endTime: "20:00" },
    { number: 12, startTime: "20:05", endTime: "20:50" }
];

async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "福建农林大学课表导入",
        "导入前请确保已在【学生个人课表】页面点击了【查询】并显示了课程。\n确认后脚本将自动解析当前课表。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    const result = await scrapeAndParseCourses();
    if (!result) return;
    const ok = await saveCourses(result.courses);
    if (!ok) return;
    await importPresetTimeSlots();
    window.shiguangBridge.showToast(`课程导入成功，共 ${result.courses.length} 门！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();