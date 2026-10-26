// 兰州大学本科生教务系统 拾光课程表适配
// 适配对象: 兰州大学本科生教务管理系统 (jwk.lzu.edu.cn/academic)
// 使用方式: 登录教务后, 在【学生课表】网格视图 或【课程列表】视图 点击"执行导入"
//
// 说明(依次尝试, 取第一个成功的):
//  - 策略C: 行列网格课表解析 (兰大 showTimetable 学生课表页)
//  - 策略B: 课程列表表格解析 (含多时段、跨框架递归, 支持课程列表/选课结果视图)
//  - 策略A: URP 标准网格课表解析 (td[id*="_"] + .class_div, 兼容其他 URP 视图)
//  - 策略B2: 纯文本兜底解析 (innerText 行)
//  - 作息时间: 页面网格表头动态读取, 否则回退到兰大预设作息(秋季)
//  - 递归穿透 <iframe>/<frame> 框架, 课程列表页(index_frame.jsp)也可导入

// ========== 兰大预设作息时间 (秋季学期, 校教〔2014〕4号) ==========
// 1-2节 8:30-10:10 / 3-4节 10:30-12:10 / 5-6节 14:30-16:10 /
// 7-8节 16:30-18:10 / 9-10节 19:00-20:40 / 第11节 20:50-21:35
const LZU_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:25", endTime: "10:10" },
    { number: 3, startTime: "10:30", endTime: "11:15" },
    { number: 4, startTime: "11:25", endTime: "12:10" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" }
];

// ========== 周次解析 ==========
// 支持: "1-18周" / "1-18周全周" / "1-17周单周" / "2-18周双周" /
//       "第10,11周" / "1-8,10-17周" / "1-5,7-8,10-12周双周,13-17周"
function parseWeeks(weekStr) {
    const weeks = new Set();
    if (!weekStr) return [];
    const text = String(weekStr).replace(/[第周]/g, "").replace(/[，;；]/g, ",");
    const segments = text.split(",");
    segments.forEach(seg => {
        const isOdd = seg.includes("单");
        const isEven = seg.includes("双");
        const clean = seg.replace(/[单双全]/g, "").trim();
        if (clean.includes("-")) {
            const [s, e] = clean.split("-").map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let w = s; w <= e; w++) {
                    if (isOdd && w % 2 === 0) continue;
                    if (isEven && w % 2 !== 0) continue;
                    weeks.add(w);
                }
            }
        } else if (clean) {
            const n = Number(clean);
            if (!isNaN(n) && n > 0) weeks.add(n);
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

// ========== 节次解析 ==========
// 支持: "上午12节"(1-2) "上午34节"(3-4) "下午56节"(5-6) "下午78节"(7-8)
//       "晚9-10节"(9-10) "晚9-11节"(9-11) "第3节"(3-3)
function parseSections(sectionStr) {
    if (!sectionStr) return null;
    const text = String(sectionStr).replace(/[节第上午下午晚上]/g, "");
    const dashed = text.match(/(\d+)-(\d+)/);
    if (dashed) {
        return { startSection: parseInt(dashed[1]), endSection: parseInt(dashed[2]) };
    }
    const numMatch = text.match(/(\d+)/);
    if (!numMatch) return null;
    const numStr = numMatch[1];
    // 形如 "12"/"34"/"56"/"78" 的连续两位 → 拆成两个节次; 单个数字 → 单节
    if (numStr.length === 2 && Number(numStr[1]) === Number(numStr[0]) + 1) {
        return { startSection: Number(numStr[0]), endSection: Number(numStr[1]) };
    }
    const n = parseInt(numStr);
    return { startSection: n, endSection: n };
}

// ========== 框架穿透辅助 ==========
// URP 老教务可能把课表放在 <iframe> 或 <frameset><frame> 里, 需要递归遍历所有同源子文档
function allDocuments() {
    const docs = [];
    const seen = new Set();
    const walk = (doc) => {
        if (!doc || seen.has(doc)) return;
        seen.add(doc);
        docs.push(doc);
        try {
            doc.querySelectorAll("iframe, frame").forEach(f => {
                try {
                    if (f.contentDocument) walk(f.contentDocument);
                } catch (e) { /* 跨域框架无法访问, 跳过 */ }
            });
        } catch (e) { /* ignore */ }
    };
    walk(document);
    return docs;
}

function queryAllInFrames(selector) {
    let nodes = [];
    allDocuments().forEach(doc => {
        try { nodes = nodes.concat(Array.from(doc.querySelectorAll(selector))); } catch (e) { /* ignore */ }
    });
    return nodes;
}

// ========== 策略A: URP 网格课表解析 ==========
function parseGridSchedule() {
    const courses = [];
    let timeSlots = null;
    const allTds = queryAllInFrames('td[id*="_"]');
    allTds.forEach(td => {
        const idParts = td.id.split("_");
        if (idParts.length !== 2) return;
        const day = parseInt(idParts[0]);
        if (isNaN(day) || day < 1 || day > 7) return;
        const classDivs = td.querySelectorAll(".class_div");
        classDivs.forEach(div => {
            const pTags = div.querySelectorAll("p");
            if (pTags.length < 5) return;
            // 兼容两种 DOM 结构: 教师/周次/节次/地点 在 p[1..4] 或 p[2..5]
            let teacherIdx = 2, weekIdx = 3, sectionIdx = 4, posIdx = 5;
            const p1Text = pTags[1] ? pTags[1].textContent.trim() : "";
            if (p1Text && !/\d/.test(p1Text) && !p1Text.includes("周") && p1Text.length < 10) {
                teacherIdx = 1; weekIdx = 2; sectionIdx = 3; posIdx = 4;
            }
            const name = pTags[0].textContent.trim();
            const teacher = (pTags[teacherIdx] ? pTags[teacherIdx].textContent : "").trim().replace(/\*+/g, " ").replace(/\s+/g, " ");
            const weeks = parseWeeks(pTags[weekIdx] ? pTags[weekIdx].textContent : "");
            const sec = parseSections(pTags[sectionIdx] ? pTags[sectionIdx].textContent : "");
            const position = pTags[posIdx] ? pTags[posIdx].textContent.trim() : "未知地点";
            if (name && weeks.length && sec) {
                courses.push({
                    name, teacher, position, day,
                    startSection: sec.startSection, endSection: sec.endSection, weeks
                });
            }
        });
    });
    // 尝试从网格表头动态读取作息时间: <th id="0_1">... (08:30-09:15)
    const ths = queryAllInFrames('th[id^="0_"]');
    const slots = [];
    ths.forEach(th => {
        const n = parseInt(th.id.split("_")[1]);
        const m = (th.textContent || "").match(/\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
        if (!isNaN(n) && m) slots.push({ number: n, startTime: m[1], endTime: m[2] });
    });
    if (slots.length) timeSlots = slots.sort((a, b) => a.number - b.number);
    return { courses, timeSlots };
}

// ========== 策略B: 列表/选课结果课表解析 ==========
// 适配"个人课表/选课结果"列表视图:
//  - 表格行结构: 课程信息行(课程号/课序号/课程名/教师...) 之后可跟 1 行或多行"排课行"
//  - 或 div 布局: innerText 中课程信息行与排课行相邻
// 排课字符串形如: "1-18周全周 星期一 下午56节 天山堂A504"
const WEEK_DAY_PATTERN = /([第]?[0-9,\-，]+周(?:全周|单周|双周)?)\s*(星期[一二三四五六日天]|周[一二三四五六日天])\s*((?:上午|下午|晚上|晚)?\s*\d+(?:-\d+)?节)\s*(\S+)/;
const WEEK_DAY_PATTERN_NO_POS = /([第]?[0-9,\-，]+周(?:全周|单周|双周)?)\s*(星期[一二三四五六日天]|周[一二三四五六日天])\s*((?:上午|下午|晚上|晚)?\s*\d+(?:-\d+)?节)/;
const DAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

function dayNum(dayText) {
    // 兼容 "星期一" / "周一" / "礼拜一" / "星期天"
    return dayFromText(dayText);
}

// 从文本片段数组中提取课程信息 (课程号 + 课程名 + 教师)
function findCourseInfo(tokens) {
    // 课程号特征: 形如 2402003 / 1402401b / 101402001(3)
    const codeIdx = tokens.findIndex(c => /^\d{3,}[a-zA-Z]*(\(\d+\))?$/.test(c) && c.length <= 12);
    if (codeIdx === -1) return null;
    // 课程名 = 课程号之后第一个非纯数字且不含"周"的片段; 教师 = 再下一个片段
    for (let i = codeIdx + 1; i < tokens.length; i++) {
        if (!/^[\d.\-]+$/.test(tokens[i]) && !tokens[i].includes("周")) {
            return {
                name: tokens[i],
                teacher: (tokens[i + 1] || "").replace(/\*+/g, " ").replace(/\s+/g, " ")
            };
        }
    }
    return null;
}

// 从文本中提取排课信息 (周次/星期/节次/地点); nextText 用于"地点在下一段"的兜底
function extractSchedule(text, nextText) {
    let m = text.match(WEEK_DAY_PATTERN);
    if (m) {
        return { weeks: parseWeeks(m[1]), day: dayNum(m[2]), sec: parseSections(m[3]), position: m[4] };
    }
    m = text.match(WEEK_DAY_PATTERN_NO_POS);
    if (m) {
        const rest = text.slice(text.indexOf(m[3]) + m[3].length).trim();
        const position = rest.split(/\s+/)[0] || (nextText || "").split(/\s+/)[0] || "";
        return { weeks: parseWeeks(m[1]), day: dayNum(m[2]), sec: parseSections(m[3]), position };
    }
    return null;
}

function pushCourse(courses, info, sched) {
    if (!info || !sched || !info.name || !sched.weeks.length || !sched.sec || !sched.day) return;
    courses.push({
        name: info.name,
        teacher: info.teacher,
        position: sched.position,
        day: sched.day,
        startSection: sched.sec.startSection,
        endSection: sched.sec.endSection,
        weeks: sched.weeks
    });
}

// 从文本中提取全部排课信息 (一个单元格内可能有多个时段)
function extractAllSchedules(text) {
    const out = [];
    const re = new RegExp(WEEK_DAY_PATTERN.source, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
        const weeks = parseWeeks(m[1]);
        const day = dayNum(m[2]);
        const sec = parseSections(m[3]);
        const position = m[4] || "";
        if (weeks.length && day && sec) {
            out.push({ weeks, day, sec: { startSection: sec.startSection, endSection: sec.endSection }, position });
        }
    }
    return out;
}

// 解析表格行结构 (兰大列表视图: 每门课一行, 上课时间地点在同一格内可含多个时段;
// 也兼容"课程信息行 + 后续排课行"的两行结构)
function parseListSchedule() {
    const courses = [];
    const rows = queryAllInFrames("tr");
    let pendingInfo = null;
    rows.forEach(row => {
        // 单元格内 <br> 转成空格再拼接, 避免多时段粘连(如 "...B604 1-17周单周 ...")
        const cells = Array.from(row.querySelectorAll("td, th")).map(c => {
            const parts = brTextLines(c).join(" ") || (c.textContent || "").trim();
            return parts;
        }).filter(Boolean);
        const rowText = cells.join(" ");
        const info = findCourseInfo(cells);
        if (info) pendingInfo = info;
        if (pendingInfo) {
            const scheds = extractAllSchedules(rowText);
            scheds.forEach(s => pushCourse(courses, pendingInfo, s));
        }
    });
    return { courses: dedupeAndMergeBlocks(courses), timeSlots: null };
}

// 解析整页文本行 (innerText), 适配 div 布局 / 复制的文本结构
function parseTextSchedule() {
    const courses = [];
    const allLines = [];
    allDocuments().forEach(doc => {
        const bodyText = (doc.body && doc.body.innerText) || "";
        const ls = bodyText.replace(/ /g, " ").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        ls.forEach(l => allLines.push(l));
    });
    let pendingInfo = null;
    allLines.forEach((line, idx) => {
        const tokens = line.split(/\s+/).filter(Boolean);
        const info = findCourseInfo(tokens);
        const nextLine = allLines[idx + 1] || "";
        if (info) {
            pendingInfo = info;
            const sched = extractSchedule(line, nextLine);
            if (sched) pushCourse(courses, info, sched);
        } else if (pendingInfo) {
            const sched = extractSchedule(line, nextLine);
            if (sched) pushCourse(courses, pendingInfo, sched);
        }
    });
    return { courses, timeSlots: null };
}

// ========== 策略C: 行列网格解析 (兰大 showTimetable.do 学生课表) ==========
// 结构: 表头行含"周一..周日"; 每门课是一个 td(id 形如 "1-2268", 首位数字=真实星期几),
//       内容按 <br> 分隔多行: 课程名<< >>;序号/地点/教师/周次/自身节次(如"晚9-11节")/备注
function cleanCourseName(s) {
    // "&lt;&lt;数学物理方法Ⅰ&gt;&gt;;2" → "数学物理方法Ⅰ"; 兼容无 <</>> 情况
    let n = String(s || "").replace(/&lt;|&gt;/g, "").replace(/<</g, "").split(">>")[0];
    n = n.replace(/;[0-9]+$/, "").replace(/[;0-9]+$/, "").trim();
    return n;
}

function isBuildingLike(t) {
    return /(堂|楼|馆|室|区|操场)/.test(t) || /[A-Za-z]+\s*\d+/.test(t);
}

// 按 <br> 分行提取单元格纯文本 (兼容 textContent 不产生换行的问题)
function brTextLines(cell) {
    const raw = cell.innerHTML || "";
    const segs = raw.split(/<br\s*\/?\s*>/i);
    const out = [];
    segs.forEach(seg => {
        const clean = seg.replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
        if (clean) out.push(clean);
    });
    return out;
}

// 从文本中识别节次区间 (如 "晚9-11节" "上午34节" "第1-2节")
function parseSectionFromText(text) {
    if (!text) return null;
    const m = String(text).match(/((?:上午|下午|晚上|晚|第)?\s*\d{1,2}\s*[-—~至]\s*\d{1,2}\s*节|(?:上午|下午|晚上|晚|第)?\s*\d{1,2}\s*节)/);
    if (m) return parseSections(m[1]);
    return null;
}

// 从课程格子 id (如 "5-2268") 首位取真实星期
function cellDay(cell, fallback) {
    const m = (cell.id || "").match(/^([1-7])-/);
    return m ? parseInt(m[1]) : fallback;
}

// 解析单个课程格子 → 返回课程块数组
function parseCourseCell(cell, day, fallbackSection) {
    const results = [];
    const lines = brTextLines(cell);
    if (!lines.length) return results;
    let cur = null;
    const flush = () => {
        if (cur) results.push(cur);
        cur = null;
    };
    lines.forEach(line => {
        const secL = /周/.test(line) ? null : parseSectionFromText(line);
        const isNameLine = line.includes(">>") || line.includes("<<")
            || (!cur && !/周|学时|讲课|堂|楼|馆|节/.test(line) && line.length <= 40 && !/^\d/.test(line));
        if (isNameLine) {
            flush();
            cur = { name: cleanCourseName(line), teacher: "", position: "", weeks: [], day: day, startSection: null, endSection: null };
        } else if (cur) {
            if (secL) {
                cur.startSection = secL.startSection;
                cur.endSection = secL.endSection;
            } else if (/[0-9]+周/.test(line) || /全周|单周|双周/.test(line)) {
                cur.weeks = parseWeeks(line);
            } else if (/学时|讲课|备注|实践/.test(line) || /^\d{1,2}:\d{2}/.test(line)) {
                // 备注/时间行忽略
            } else if (isBuildingLike(line)) {
                cur.position = line;
            } else {
                cur.teacher = (cur.teacher ? cur.teacher + " " : "") + line;
            }
        }
    });
    flush();
    // 自身文本未给出节次时, 用行标签节次
    results.forEach(b => {
        if (!b.startSection && fallbackSection) {
            b.startSection = fallbackSection.startSection;
            b.endSection = fallbackSection.endSection;
        }
    });
    return results;
}

function parsePeriodGrid() {
    const blocks = [];
    const tables = queryAllInFrames("table");
    for (const table of tables) {
        const dayInfo = tableDayColumns(table);
        if (!dayInfo) continue;
        const trs = Array.from(table.querySelectorAll("tr")).filter(r => r.querySelectorAll("td,th").length);
        let carriedSection = null;
        for (let r = dayInfo.headerRow + 1; r < trs.length; r++) {
            const cells = Array.from(trs[r].querySelectorAll("td,th"));
            // 行节次: 找不含"周"、内容短、含 节/时间 的标签单元格 (课程格都含周次, 不会误判)
            let rowSection = null;
            for (const c of cells) {
                const t = (c.textContent || "").trim();
                if (!t || t.length > 60 || /周/.test(t)) continue;
                if (!/节|^\d{1,2}:\d{2}/.test(t)) continue;
                rowSection = parseSectionFromText(t);
                if (rowSection) break;
            }
            if (!rowSection) rowSection = carriedSection;
            else carriedSection = rowSection;
            if (!rowSection) continue;
            // 逐格取课程
            for (let ci = 0; ci < cells.length; ci++) {
                const cell = cells[ci];
                const txt = (cell.textContent || "").trim();
                if (!txt || txt.length < 4 || /^(&nbsp;|\s|-|—|・|\.)*$/.test(txt)) continue;
                const looksCourse = /<<|>>/.test(txt) || (/周/.test(txt) && !dayFromText(txt));
                if (!looksCourse) continue;
                const day = cellDay(cell, dayInfo.colDay[ci] || 0);
                parseCourseCell(cell, day, rowSection).forEach(b => blocks.push(b));
            }
        }
    }
    return { courses: dedupeAndMergeBlocks(blocks), timeSlots: null };
}

// 归一化 + 同课相邻节次合并 + 去重
function dedupeAndMergeBlocks(blocks) {
    const slotCount = LZU_TIME_SLOTS.length; // 兰大最多11节
    const norm = [];
    blocks.forEach(b => {
        let s = b.startSection, e = b.endSection;
        if (!s || !e || e < s || !b.name || !b.weeks.length || !b.day) return;
        if (s > slotCount) return;
        if (e > slotCount) e = slotCount;
        norm.push({ name: b.name, teacher: (b.teacher || "").trim(), position: b.position || "", day: b.day, startSection: s, endSection: e, weeks: b.weeks });
    });
    const groups = {};
    const wkKey = w => w.join(",");
    norm.forEach(b => {
        const g = b.name + "|" + b.teacher + "|" + b.position + "|" + b.day + "|" + wkKey(b.weeks);
        (groups[g] = groups[g] || []).push(b);
    });
    const out = [];
    Object.keys(groups).forEach(g => {
        const grp = groups[g];
        const first = grp[0];
        if (grp.every(b => b.startSection === first.startSection && b.endSection === first.endSection)) {
            out.push(first); // 完全重复 → 保留一条
            return;
        }
        grp.sort((a, b) => a.startSection - b.startSection);
        let cur = { ...grp[0] };
        for (let i = 1; i < grp.length; i++) {
            const b = grp[i];
            if (b.startSection <= cur.endSection + 1) {
                cur.endSection = Math.max(cur.endSection, b.endSection);
                const ws = new Set(cur.weeks.concat(b.weeks));
                cur.weeks = Array.from(ws).sort((x, y) => x - y);
            } else {
                out.push(cur);
                cur = { ...b };
            }
        }
        out.push(cur);
    });
    return out;
}

// ========== 诊断收集 (全部策略失败时输出表格 DOM 骨架, 便于定位结构) ==========
// 短探针: 纯数字概览, 放在第一行, 抗复制乱码
function collectProbe() {
    const docs = allDocuments();
    let frTotal = 0, frOk = 0;
    try {
        document.querySelectorAll("iframe, frame").forEach(f => {
            frTotal++;
            try { if (f.contentDocument) frOk++; } catch (e) {}
        });
    } catch (e) {}
    let tables = 0, trs = 0, tds = 0, hdrTbl = 0, codeCells = 0, schedCells = 0;
    docs.forEach(doc => {
        try {
            tables += doc.querySelectorAll("table").length;
            trs += doc.querySelectorAll("tr").length;
            tds += doc.querySelectorAll("td, th").length;
            doc.querySelectorAll("table").forEach(t => {
                if ((t.innerText || t.textContent || "").indexOf("课程号") > -1) hdrTbl++;
            });
        } catch (e) {}
        try {
            doc.querySelectorAll("td").forEach(cd => {
                const t = (cd.textContent || "").trim();
                if (/^\d{3,}[a-zA-Z]*(\(\d+\))?$/.test(t) && t.length <= 12) codeCells++;
                if (/[0-9]+周/.test(t) && /(?:星期|周)[一二三四五六日天]/.test(t)) schedCells++;
            });
        } catch (e) {}
    });
    return "PROBE: 文档=" + docs.length
        + " 框架=" + frTotal + "/" + frOk
        + " 表=" + tables + " 行=" + trs + " 格=" + tds
        + " 含课程号表=" + hdrTbl
        + " 课程代码格=" + codeCells
        + " 排课格=" + schedCells;
}

function dayFromText(t) {
    // 支持 "星期一" / "周一" / "礼拜一" 等表头
    const s = String(t || "").replace(/星期|礼拜|周/g, "");
    return DAY_MAP[s] || 0;
}

// 找出"周一..周日"表头所在行及列→星期映射
function tableDayColumns(table) {
    const trs = Array.from(table.querySelectorAll("tr")).filter(r => r.querySelectorAll("td,th").length);
    for (let i = 0; i < trs.length; i++) {
        const cells = Array.from(trs[i].querySelectorAll("td,th"));
        const map = {};
        cells.forEach((c, ci) => {
            const d = dayFromText(c.textContent);
            if (d) map[ci] = d;
        });
        if (Object.keys(map).length >= 5) return { headerRow: i, colDay: map };
    }
    return null;
}

// 单元格摘要: 标签/id/class + innerHTML 开头(暴露嵌套结构)
function cellBrief(cell) {
    const id = cell.id || "";
    const cls = (typeof cell.className === "string" ? cell.className : (cell.className && cell.className.baseVal) || "").toString();
    const tag = cell.tagName || "";
    let s = "<" + tag + (id ? "#" + id : "") + (cls ? "." + String(cls).slice(0, 14) : "") + ">";
    s += (cell.innerHTML || "").replace(/\s+/g, " ").trim().slice(0, 36);
    return s;
}

function collectDiagnostics() {
    const L = [collectProbe()];
    try { L.push("URL尾: " + (window.location.href || "").slice(-90)); } catch (e) {}
    const tables = queryAllInFrames("table");
    L.push("tables=" + tables.length);
    tables.forEach((tb, ti) => {
        const dayInfo = tableDayColumns(tb);
        const trs = Array.from(tb.querySelectorAll("tr")).filter(r => r.querySelectorAll("td,th").length);
        if (!dayInfo) return; // 只展示含"周一..周日"的课表表格
        L.push("== 表T" + ti + " tr=" + trs.length + " 表头行=" + dayInfo.headerRow + " 列→星期: " + JSON.stringify(dayInfo.colDay));
        const start = Math.max(0, dayInfo.headerRow);
        let dumped = false;
        for (let r = start; r < Math.min(trs.length, start + 12); r++) {
            const cells = Array.from(trs[r].querySelectorAll("td,th"));
            const bs = cells.map(cellBrief);
            L.push("R" + r + "(" + cells.length + "): " + bs.join(" ⏐ "));
            // 找第一个疑似"课程格子"(文本含"周"且长度适中), 输出其完整 innerHTML
            if (!dumped) {
                const courseCell = cells.find((c) => {
                    const t = (c.textContent || "").trim();
                    return t.length > 6 && t.length < 500 && /周/.test(t);
                });
                if (courseCell) {
                    L.push("  [首个课程格子innerHTML] " + (courseCell.innerHTML || "").replace(/\s+/g, " ").slice(0, 500));
                    dumped = true;
                }
            }
        }
    });
    return L.join("\n");
}

// ========== 流程控制 ==========
async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "兰州大学教务导入",
            "请先登录教务系统并进入【学生课表】页面（网格视图），再点击确定开始导入。",
            "开始导入"
        );
        if (!confirmed) return;

        // 依次尝试各解析策略, 取第一个成功的
        let result = null;
        let usedStrategy = "";
        const strategies = [
            { name: "行列网格课表", fn: parsePeriodGrid },
            { name: "网格课表", fn: parseGridSchedule },
            { name: "列表课表(表格)", fn: parseListSchedule },
            { name: "列表课表(文本)", fn: parseTextSchedule }
        ];
        for (const s of strategies) {
            const r = s.fn();
            if (r.courses.length) {
                result = r;
                usedStrategy = s.name;
                break;
            }
        }

        if (!result || !result.courses.length) {
            try {
                const diag = collectDiagnostics();
                await window.shiguangBridgePromise.showAlert(
                    "未检测到课表数据",
                    diag + "\n\n----\n请确认处于【学生课表】网格视图。若仍有问题, 可将以上信息截图反馈给维护者, 便于改进适配",
                    "知道了"
                );
            } catch (e) {
                window.shiguangBridge.showToast("未检测到课表数据，请确认当前页面是个人课表后重试");
            }
            return;
        }

        const timeSlots = result.timeSlots && result.timeSlots.length ? result.timeSlots : LZU_TIME_SLOTS;

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: null,
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));

        window.shiguangBridge.showToast(`兰州大学课表导入成功(${usedStrategy}): 共 ${result.courses.length} 条安排`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("兰州大学课表导入失败:", error);
        window.shiguangBridge.showToast("课表导入失败: " + (error.message || error));
    }
}

runImportFlow();
