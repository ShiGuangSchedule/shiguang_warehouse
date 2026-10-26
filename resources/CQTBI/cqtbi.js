// 重庆工商职业学院（重庆开放大学）教务系统课表导入适配脚本
// 教务系统：强智 jsxsd（jwgl.cqtbi.edu.cn:81），导入页面 xsMainV.htmlx

// 该校作息时间（12 节）
const CQTBI_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:40" },
    { number: 2,  startTime: "08:50", endTime: "09:30" },
    { number: 3,  startTime: "09:40", endTime: "10:20" },
    { number: 4,  startTime: "10:40", endTime: "11:20" },
    { number: 5,  startTime: "11:30", endTime: "12:10" },
    { number: 6,  startTime: "14:00", endTime: "14:40" },
    { number: 7,  startTime: "14:50", endTime: "15:30" },
    { number: 8,  startTime: "15:40", endTime: "16:20" },
    { number: 9,  startTime: "16:40", endTime: "17:20" },
    { number: 10, startTime: "17:30", endTime: "18:10" },
    { number: 11, startTime: "19:00", endTime: "19:40" },
    { number: 12, startTime: "19:50", endTime: "20:30" }
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

// 解析周次："第2-5,7-10周(全部) 星期一" → [2,3,4,5,7,8,9,10]
function parseWeeksText(weekStr) {
    const m = String(weekStr || "").match(/第([\d,\-、]+)周/);
    if (!m) return [];
    const weeks = new Set();
    m[1].split(/[,、]/).forEach(part => {
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            const [lo, hi] = start < end ? [start, end] : [end, start];
            for (let i = lo; i <= hi; i++) weeks.add(i);
        } else if (/^\d+$/.test(part)) {
            weeks.add(Number(part));
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

// 解析节次："01~02~03节" → { start: 1, end: 3 }；"02~03节" → { start: 2, end: 3 }
function parseSectionsText(sectionStr) {
    const nums = String(sectionStr || "").match(/\d+/g);
    if (!nums || nums.length === 0) return null;
    const list = nums.map(Number).filter(n => n > 0);
    if (list.length === 0) return null;
    let start = list[0];
    let end = list[0];
    for (let i = 1; i < list.length; i++) {
        if (list[i] === end + 1) end = list[i];
        else break;
    }
    return { start, end };
}

// 收集当前页及同域 iframe 的 document（跨域 iframe 无法访问则跳过）
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

// 查找可访问的 jwgl 教务页面，取其 origin 作为接口基址
function findJwglBase() {
    const candidates = collectDocs().map(d => {
        try { return d.location.href; } catch (_) { return ""; }
    });
    const jwgl = candidates.find(u => /jwgl\.cqtbi\.edu\.cn/i.test(u));
    if (jwgl) {
        try {
            return new URL(jwgl).origin;
        } catch (_) {
            // Fall through to window origin.
        }
    }
    return window.location.origin;
}

// 从课表页读取当前校区作息 ID（#kbjcmsid_ul 激活 tab 的 data-value）
function readCampusSjms(doc) {
    const active = doc.querySelector("#kbjcmsid_ul li.layui-this[data-value]");
    if (active) return active.getAttribute("data-value");
    const any = doc.querySelector("#kbjcmsid_ul li[data-value]");
    return any ? any.getAttribute("data-value") : null;
}

// 从课表页读取当前学年学期（如 2026-2027-1），优先取选中项
// 注意：该校下拉的 option 文本为 "2026-2027-1"，value 为空，故需读文本内容
function readSemesterId(doc) {
    for (const sel of doc.querySelectorAll("select")) {
        const selOpt = sel.selectedOptions[0] || sel.options[sel.selectedIndex];
        if (selOpt) {
            const text = (selOpt.textContent || selOpt.value || "").trim();
            if (/^\d{4}-\d{4}-\d$/.test(text)) return text;
        }
    }
    for (const opt of doc.querySelectorAll("select option")) {
        const text = (opt.textContent || opt.value || "").trim();
        if (/^\d{4}-\d{4}-\d$/.test(text)) return text;
    }
    return null;
}

// 从 #week 下拉读取学期配置：第一个日期为开学日，下拉项数即总周数
function readSemesterConfig(doc) {
    const sel = doc.getElementById("week");
    if (!sel) return { startDate: null, totalWeeks: null };
    const dates = Array.from(sel.querySelectorAll("option"))
        .map(o => o.value.trim())
        .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
    return { startDate: dates[0] || null, totalWeeks: dates.length || null };
}

// 请求课表 API 并解析返回的 HTML（返回课程数组）
async function fetchCoursesByApi() {
    const docs = collectDocs();
    // 参数优先从能读到校区 tab 的 document 读取
    let sjms = null;
    let xnxqid = null;
    for (const doc of docs) {
        if (!sjms) sjms = readCampusSjms(doc);
        if (!xnxqid) xnxqid = readSemesterId(doc);
        if (sjms && xnxqid) break;
    }
    if (!sjms) throw new Error("未能从页面读取校区信息（#kbjcmsid_ul），请确认在课表页面。");
    if (!xnxqid) throw new Error("未能从页面读取当前学年学期，请确认在课表页面。");

    const base = findJwglBase();
    const url = `${base}/jsxsd/framework/mainV_index_loadkb.htmlx` +
        `?rq=all&sjmsValue=${encodeURIComponent(sjms)}&xnxqid=${encodeURIComponent(xnxqid)}&xswk=false`;

    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`课表接口请求失败（HTTP ${response.status}）`);
    const html = await response.text();

    const parsed = new DOMParser().parseFromString(html, "text/html");
    return parseCourseTableFromDom(parsed);
}

// 解析渲染后的课表表格
function parseCourseTableFromDom(doc) {
    const table = doc.getElementById("timetable");
    if (!table) return [];

    const courses = [];
    table.querySelectorAll("tbody > tr").forEach(row => {
        if (row.querySelector("td[colspan]")) return; // 表头或分隔行
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) return;

        for (let day = 1; day <= 7; day++) {
            const cell = cells[day];
            if (!cell) continue;
            cell.querySelectorAll(".item-box").forEach(box => {
                box.querySelectorAll(":scope > p").forEach(nameP => {
                    try {
                        const name = nameP.innerText.trim();
                        if (!name) return;

                        // 课程名 P 之后的 .tch-name（教师 + 节次）
                        let tchName = nameP.nextElementSibling;
                        while (tchName && (tchName.nodeType !== 1 || !tchName.classList.contains("tch-name"))) {
                            tchName = tchName.nextElementSibling;
                        }
                        if (!tchName) return;
                        const tchSpans = tchName.querySelectorAll("span");
                        const teacher = (tchSpans[0] ? tchSpans[0].innerText.replace("教师：", "").trim() : "") || "未知";
                        const sections = parseSectionsText(tchSpans[2] ? tchSpans[2].innerText : "");
                        if (!sections) return;

                        // 紧接着的 DIV：span[0] 教室、span[1] 周次
                        let infoDiv = tchName.nextElementSibling;
                        while (infoDiv && (infoDiv.nodeType !== 1 || infoDiv.tagName !== "DIV")) {
                            infoDiv = infoDiv.nextElementSibling;
                        }
                        if (!infoDiv) return;
                        const infoSpans = infoDiv.querySelectorAll("span");
                        const position = infoSpans[0] ? infoSpans[0].innerText.trim() : "";
                        const weeks = parseWeeksText(infoSpans[1] ? infoSpans[1].innerText : "");
                        if (weeks.length === 0) return;

                        courses.push({
                            name,
                            teacher,
                            position: position || "待定",
                            day,
                            startSection: sections.start,
                            endSection: sections.end,
                            weeks
                        });
                    } catch (e) {
                        console.error("JS: 解析课程失败", e);
                    }
                });
            });
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

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已登录教务系统并进入课表页面",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在请求课表数据...");
    try {
        const courses = await fetchCoursesByApi();
        if (!courses || courses.length === 0) {
            throw new Error("接口返回的课表中未解析到课程，请确认当前学期有课且已选择全部周。");
        }

        const merged = mergeCourses(courses);
        // 学期配置（#week 下拉）可能在任意一个 iframe 中，遍历所有可访问 document 查找
        let config = { startDate: null, totalWeeks: null };
        for (const doc of collectDocs()) {
            config = readSemesterConfig(doc);
            if (config.startDate) break;
        }
        const { startDate, totalWeeks } = config;

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));

        if (startDate && totalWeeks) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                semesterStartDate: startDate,
                semesterTotalWeeks: totalWeeks
            }));
        }
        await saveTimeSlots(CQTBI_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${merged.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();