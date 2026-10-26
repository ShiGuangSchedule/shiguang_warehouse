// 中国石油大学（华东）研究生综合管理系统（degrees.upc.edu.cn）拾光课表导入适配脚本
// ASP.NET WebForms（/Gstudent/Course/StuCourseQuery.aspx）：

// 预设作息时间（与中国石油大学华东本科一致，12 节）
const UPC_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:50", endTime: "09:35" },
    { number: 3,  startTime: "09:55", endTime: "10:40" },
    { number: 4,  startTime: "10:45", endTime: "11:30" },
    { number: 5,  startTime: "11:35", endTime: "12:20" },
    { number: 6,  startTime: "14:00", endTime: "14:45" },
    { number: 7,  startTime: "14:50", endTime: "15:35" },
    { number: 8,  startTime: "15:55", endTime: "16:40" },
    { number: 9,  startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "19:00", endTime: "19:45" },
    { number: 11, startTime: "19:50", endTime: "20:35" },
    { number: 12, startTime: "20:40", endTime: "21:25" }
];

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures and use the generic fallback below.
    }
    return "未知错误";
}

// 解析周次文本："2-12"、"14"、"15-16" → [2,3,...,12] 等
function parseWeeksText(text) {
    const weeks = new Set();
    String(text || "").split(/、|,/).forEach(part => {
        part = part.trim();
        if (!part) return;
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const [lo, hi] = Number(range[1]) < Number(range[2])
                ? [Number(range[1]), Number(range[2])]
                : [Number(range[2]), Number(range[1])];
            for (let i = lo; i <= hi; i++) weeks.add(i);
        } else if (/^\d+$/.test(part)) {
            weeks.add(Number(part));
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

// 从当前页及同源 iframe 收集 document
function collectDocs() {
    const docs = [document];
    document.querySelectorAll("iframe").forEach(f => {
        try {
            if (f.contentDocument && f.contentDocument.getElementById) docs.push(f.contentDocument);
        } catch (_) {
            // Cross-origin iframe, skip.
        }
    });
    return docs;
}

// 找到课表表格
function findCourseTable() {
    for (const doc of collectDocs()) {
        const table = doc.getElementById("ctl00_contentParent_dgData");
        if (table) return table;
    }
    return null;
}

// 解析格子内的一门门课文本为课程数组
// 文本示例：应用统计方法与数据科学储建班｛2-12周[教师:曹晓敏,地点:东廊302]｝
//           模式分类与学习1班｛14周[教师:刘伟锋]、15-16周[教师:杨兴浩][地点:南堂201]｝
function parseCellText(text, day, startSection, endSection, courses) {
    const parts = String(text || "").split("；");
    parts.forEach(part => {
        part = part.trim();
        if (!part) return;
        const braceIdx = part.indexOf("｛");
        if (braceIdx === -1) return;
        const name = part.slice(0, braceIdx).replace(/\s+/g, " ").trim();
        if (!name) return;
        const body = part.slice(braceIdx + 1, part.lastIndexOf("｝") === -1 ? part.length : part.lastIndexOf("｝"));
        // 提取公共地点（无教师前缀的 [地点:X]，通常在全段末尾）
        let commonRoom = null;
        const commonMatch = body.match(/\[地点:([^\]]+)\]/g);
        if (commonMatch && commonMatch.length > 0) {
            const last = commonMatch[commonMatch.length - 1].match(/\[地点:([^\]]+)\]/)[1];
            commonRoom = last.trim();
        }
        // 先取出整段 [教师:...] 容器，完整匹配教师名；地点可能在其内或独立段
        const segRe = /([\d,\-、]+)周\s*\[教师:([^\]]+)\]/g;
        let seg, found = false;
        while ((seg = segRe.exec(body)) !== null) {
            const weeks = parseWeeksText(seg[1]);
            if (weeks.length === 0) continue;
            const teacherBody = seg[2].trim();
            // 教师：地点：，（兼容半角/全角逗号/空格）
            const commaIdx = teacherBody.search(/[,，]/);
            const teacher = (commaIdx === -1 ? teacherBody : teacherBody.slice(0, commaIdx)).trim();
            // 段内地点（[教师:X，地点:Y] 或 [教师:X,地点:Y]），从含 ] 的整段取
            const roomMatch = seg[0].match(/地点:([^\]]+)\]/);
            const room = roomMatch ? roomMatch[1].trim() : commonRoom;
            courses.push({
                name,
                teacher: teacher || "未知",
                position: room || "待定",
                day,
                startSection,
                endSection,
                weeks
            });
            found = true;
        }
        if (!found) {
            return;
        }
    });
}

// 解析课表表格
function parseCourseTableFromDom(table) {
    const courses = [];
    // 每行中节次号之后的 7 个 td，按相对顺序为 星期日|星期一|…|星期六
    // 拾光 day：1 表示星期一，7 表示星期日
    const dayByOffset = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

    table.querySelectorAll("tbody tr").forEach(row => {
        const tds = row.querySelectorAll("td");
        // 动态定位节次号 td（内容为纯数字 1~12），其后 7 个 td 为周日~周六
        // 注意："上午/下午/晚上" 是 rowspan 合并单元格，仅每大节首行存在，故不能固定列索引
        let secIndex = -1;
        let startSection = 0;
        for (let i = 0; i < tds.length; i++) {
            const t = Number((tds[i].textContent || "").trim());
            if (t >= 1 && t <= 12) { secIndex = i; startSection = t; break; }
        }
        if (secIndex === -1) return;

        for (let off = 0; off < 7; off++) {
            const td = tds[secIndex + 1 + off];
            if (!td) continue;
            const text = (td.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || text.indexOf("｛") === -1) continue;
            const rowspan = Number(td.getAttribute("rowspan")) || 1;
            const endSection = startSection + rowspan - 1;
            parseCellText(text, dayByOffset[off], startSection, endSection, courses);
        }
    });

    return courses;
}

// 合并相同课程（同名/同师/同地/同星期/同节次）的周次
function mergeCourses(courses) {
    const map = new Map();
    for (const c of courses) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}`;
        if (map.has(key)) {
            const existing = map.get(key);
            existing.weeks = Array.from(new Set([...existing.weeks, ...c.weeks])).sort((a, b) => a - b);
        } else {
            map.set(key, c);
        }
    }
    return Array.from(map.values());
}

// 保存作息时间（失败仅告警）
async function saveTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        console.error("JS: 作息时间保存失败", error);
    }
}

// 从教学日历页面解析开学日期与总周数
// 表格 ctl00_contentParent_dgData：每行一个周次，首列=星期日，每格为 日期(月份)
// 开学日期取第 1 周星期一所对应的完整日期；总周数 = 数据行数
function parseTermCalendar(html, currentSemester) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.getElementById("ctl00_contentParent_dgData");
    if (!table) return null;

    const rows = table.querySelectorAll("tbody tr, tr");
    const dates = [];
    let totalWeeks = 0;

    rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 8) return;
        // cells[0]=周次，cells[1..7]=星期日..星期六
        const rowWeeks = [];
        for (let i = 1; i <= 7; i++) {
            const span = cells[i].querySelector("span");
            const m = (span ? span.textContent : "").match(/(\d+)\s*\((\d+)月\)/);
            if (m) rowWeeks[i] = { day: Number(m[1]), month: Number(m[2]) };
        }
        if (Object.keys(rowWeeks).length > 0) {
            dates.push(rowWeeks);
            totalWeeks++;
        }
    });

    if (totalWeeks === 0) return null;

    // 用当前年份推算各日期所在年份：月份<=2 属于上一自然年，否则为当前年
    const currentYear = new Date().getFullYear();
    const firstRow = dates[0];
    // 第 1 周 星期一 = 列 index2（cells[2]）
    const monday = firstRow[2];
    if (!monday) return { semesterTotalWeeks: totalWeeks };
    const yearOf = (month) => (month <= 2 ? currentYear - 1 : currentYear);
    const mm = String(monday.month).padStart(2, "0");
    const dd = String(monday.day).padStart(2, "0");
    return {
        semesterStartDate: `${yearOf(monday.month)}-${mm}-${dd}`,
        semesterTotalWeeks: totalWeeks
    };
}

// 请求教学日历页面获取学期配置
async function fetchSemesterConfig() {
    try {
        // 从当前页面找到教学日历链接（#hykTermCalender 的 onclick 含 EID）
        let eid = null;
        for (const doc of collectDocs()) {
            const link = doc.getElementById("hykTermCalender") || doc.querySelector("a[onclick*='TermCalender.aspx']");
            if (link) {
                const onclick = link.getAttribute("onclick") || "";
                const m = onclick.match(/TermCalender\.aspx\?EID=([^&'"]+)/);
                if (m) { eid = m[1]; break; }
            }
        }
        if (!eid) return null;
        const url = `/PublicPage/TermCalender.aspx?EID=${encodeURIComponent(eid)}&UID=`;
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) return null;
        return parseTermCalendar(await response.text());
    } catch (error) {
        console.error("JS: 教学日历请求失败", error);
        return null;
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "研究生课表导入",
        "导入前请确保您已登录并打开课表查询页面（StuCourseQuery）",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在解析课表...");
    try {
        const table = findCourseTable();
        if (!table) throw new Error("未找到课表表格（ctl00_contentParent_dgData），请确认已打开课表页面。");

        const courses = parseCourseTableFromDom(table);
        if (courses.length === 0) throw new Error("课表中未解析到有效课程，请确认当前学期有课。");

        const merged = mergeCourses(courses);

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));

        // 学期配置优先从教学日历取，失败时以课程最大周次兜底
        const cal = await fetchSemesterConfig();
        const config = {
            semesterTotalWeeks: (cal && cal.semesterTotalWeeks) ||
                merged.reduce((m, c) => Math.max(m, (c.weeks[c.weeks.length - 1] || 0)), 0)
        };
        if (cal && cal.semesterStartDate) config.semesterStartDate = cal.semesterStartDate;
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

        await saveTimeSlots(UPC_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${merged.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();