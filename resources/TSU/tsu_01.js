// 依赖接口：
//   POST /frame/droplist/getDropLists.action                     学期列表(JSON)
//   GET  /student/xkjg.wdkb.jsp?menucode=S20301                  内部学号 xh(GBK HTML)
//   GET  /student/wsxk.xskcb10319.jsp?params=base64              课表数据(GBK HTML)
//   POST /frame/desk/showLessonScheduleInfosV14.action           第一周周一日期

// ===== 作息时间 =====
// 夏令时（每年 5月1日–10月7日）：作为基础时间段（骨架）提交
const SUMMER_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:55", endTime: "09:40" },
    { number: 3,  startTime: "10:00", endTime: "10:45" },
    { number: 4,  startTime: "10:55", endTime: "11:40" },
    { number: 5,  startTime: "14:30", endTime: "15:15" },
    { number: 6,  startTime: "15:25", endTime: "16:10" },
    { number: 7,  startTime: "16:30", endTime: "17:15" },
    { number: 8,  startTime: "17:25", endTime: "18:10" },
    { number: 9,  startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

// 冬令时（每年 10月8日–次年4月30日）差量：仅下午 5–8 节整体提前 30 分钟，
// 上午 1–4 节与晚间 9–10 节由骨架自动补齐
const WINTER_DIFF_SLOTS = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" }
];

// ===== 日期工具 =====
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// 夏令时：本年 5月1日–10月7日；冬令时：10月8日–次年4月30日（1–4月导入时自上一年起算）
function buildComboDateRanges() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const winterStartYear = month <= 4 ? year - 1 : year;
    return {
        summer: { startDate: `${year}-05-01`, endDate: `${year}-10-07` },
        winter: { startDate: `${winterStartYear}-10-08`, endDate: `${winterStartYear + 1}-04-30` }
    };
}

// 开学日期弹窗默认值的兜底：本周周一（周日归上一周）
function getMondayOfCurrentWeek() {
    const now = new Date();
    const offset = now.getDay() === 0 ? -6 : 1 - now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() + offset);
    return formatDate(monday);
}

// showPrompt 的全局验证函数：false=通过，字符串=错误文案
function validateDateInput(input) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return "请输入 YYYY-MM-DD 格式的日期！";
    }
    const date = new Date(input + "T00:00:00");
    if (isNaN(date.getTime()) || formatDate(date) !== input) {
        return "该日期不存在，请检查！";
    }
    return false;
}

// ===== 周次解析（支持 12-16 / 8 / 1-8单 / 9-17双 / 1,3,5）=====
function parseWeeks(weekStr) {
    const weeks = [];
    weekStr.split(",").forEach(group => {
        const g = group.trim();
        const isSingle = g.includes("单");
        const isDouble = g.includes("双");
        const rangeMatch = g.match(/(\d+)\s*-\s*(\d+)/);
        if (rangeMatch) {
            for (let i = parseInt(rangeMatch[1]); i <= parseInt(rangeMatch[2]); i++) {
                if (isSingle && i % 2 === 0) continue;
                if (isDouble && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            const num = parseInt(g.replace(/[^\d]/g, ""));
            if (!isNaN(num)) weeks.push(num);
        }
    });
    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

// ===== 课表 HTML 解析 =====
// 输入：xskcb10319.jsp 返回的 GBK 解码后 HTML
// 结构：每个星期列是 td.td；每门课一个 <div style='padding-bottom:5px...'>，
//       div 内按 <br> 分行依次为 课程名/教师/周次[起止节次]/地点
function parseCourseTableHtml(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, "text/html");
    const rawItems = [];

    doc.querySelectorAll("tr").forEach(row => {
        const cells = row.querySelectorAll("td.td");
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 一行内 td.td 依次对应 星期一~星期日
            const divs = cell.querySelectorAll("div[style*='padding-bottom:5px']");
            divs.forEach(div => {
                const lines = Array.from(div.childNodes)
                    .map(n => n.textContent.trim())
                    .filter(t => t.length > 0);
                if (lines.length < 3) return;
                const timeMatch = lines[2].match(/^(.+?)\s*\[(\d+)-(\d+)\]\s*$/);
                if (!timeMatch) return;
                rawItems.push({
                    name: lines[0],
                    teacher: lines[1] || "",
                    position: lines[3] || "未知地点",
                    day: day,
                    startSection: parseInt(timeMatch[2]),
                    endSection: parseInt(timeMatch[3]),
                    weeks: parseWeeks(timeMatch[1])
                });
            });
        });
    });

    // 完全重复项去重（青果网格可能对跨节次课程重复渲染）
    const seen = new Set();
    const uniqueItems = rawItems.filter(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}|${item.startSection}|${item.endSection}|${item.weeks.join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // 合并去重：同(名|师|地|星期)按周次展开为节次矩阵，再按连续节次聚合
    const groupMap = new Map();
    uniqueItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, {});
        const weekMap = groupMap.get(key);
        item.weeks.forEach(w => {
            if (!weekMap[w]) weekMap[w] = new Set();
            for (let s = item.startSection; s <= item.endSection; s++) weekMap[w].add(s);
        });
    });

    const finalCourses = [];
    groupMap.forEach((weekMap, key) => {
        const [name, teacher, position, day] = key.split("|");
        const patternMap = new Map();
        Object.keys(weekMap).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(weekMap[week]).sort((a, b) => a - b);
            if (sections.length === 0) return;
            let start = sections[0];
            for (let i = 0; i < sections.length; i++) {
                if (i === sections.length - 1 || sections[i + 1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, new Set());
                    patternMap.get(pKey).add(week);
                    if (i < sections.length - 1) start = sections[i + 1];
                }
            }
        });
        patternMap.forEach((weekSet, pKey) => {
            const [sStart, sEnd] = pKey.split("-").map(Number);
            finalCourses.push({
                name, teacher, position,
                day: parseInt(day),
                startSection: sStart,
                endSection: sEnd,
                weeks: Array.from(weekSet).sort((a, b) => a - b)
            });
        });
    });
    return finalCourses;
}

// ===== 接口封装 =====
const JWXT_BASE = window.location.origin;

// 学期列表 → 用户选择 → { xn, xq, name }
async function selectSemester() {
    window.shiguangBridge.showToast("正在获取学期列表...");
    const resp = await fetch(JWXT_BASE + "/frame/droplist/getDropLists.action", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0",
        credentials: "include"
    });
    const list = await resp.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error("学期列表为空");
    const names = list.map(item => item.name);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), 0);
    if (selectedIndex === null) return null;
    const [xn, xq] = list[selectedIndex].code.split("-");
    return { xn, xq, name: list[selectedIndex].name };
}

// 内部学号（≠登录账号）：wdkb.jsp 的隐藏域，实时 DOM 兜底
async function getInternalStudentId() {
    const resp = await fetch(JWXT_BASE + "/student/xkjg.wdkb.jsp?menucode=S20301", { credentials: "include" });
    const html = new TextDecoder("gbk").decode(await resp.arrayBuffer());
    const tagMatch = html.match(/<input[^>]*id=["']xh["'][^>]*>/i);
    if (tagMatch) {
        const valueMatch = tagMatch[0].match(/value=["']([^"']+)["']/i);
        if (valueMatch) return valueMatch[1];
    }
    let fromDom = null;
    (function walk(win) {
        if (fromDom) return;
        try {
            const el = win.document.getElementById("xh");
            if (el && el.value) { fromDom = el.value; return; }
        } catch (e) {}
        for (let i = 0; i < win.frames.length; i++) { try { walk(win.frames[i]); } catch (e) {} }
    })(window);
    return fromDom;
}

// 课表 HTML（GBK）
async function fetchCourseHtml(xn, xq, xh) {
    const params = btoa(`xn=${xn}&xq=${xq}&xh=${xh}`);
    const resp = await fetch(`${JWXT_BASE}/student/wsxk.xskcb10319.jsp?params=${params}`, { credentials: "include" });
    return new TextDecoder("gbk").decode(await resp.arrayBuffer());
}

// 第一周周一日期（教学日历接口，jxz=1 即第 1 周，周一列头日期即开学日期）
// 注意：泰山该接口返回 UTF-8（课表接口才是 GBK）；失败返回 null，由调用方兜底
async function fetchSemesterStartDate(xn, xq) {
    const resp = await fetch(`${JWXT_BASE}/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=1`, {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
        credentials: "include"
    });
    const html = await resp.text();
    const match = html.match(/<br\s*\/?>\s*(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = xq === "1" ? String(parseInt(xn) + 1) : String(xn);
    return `${year}-${match[1]}-${match[2]}`;
}

// ===== 导入步骤 =====
async function saveCourseConfig(startDate) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: startDate
        }));
        window.shiguangBridge.showToast("开学日期已保存");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存开学日期失败: " + error.message);
        return false;
    }
}

async function importTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SUMMER_TIME_SLOTS));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

async function importComboSchedule() {
    const ranges = buildComboDateRanges();
    const comboSchedule = {
        name: "泰山学院夏冬作息方案",
        publicSchedules: [
            {
                name: "夏令时",
                startDate: ranges.summer.startDate,
                endDate: ranges.summer.endDate,
                timeSlots: [] // 与骨架一致，全部由骨架补齐
            },
            {
                name: "冬令时",
                startDate: ranges.winter.startDate,
                endDate: ranges.winter.endDate,
                timeSlots: WINTER_DIFF_SLOTS // 仅提交下午 5–8 节差异
            }
        ]
    };

    try {
        await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(comboSchedule));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("组合作息导入失败: " + error.message);
        return false;
    }
}

// ===== 流程编排 =====
// notifyTaskCompletion() 只在成功后调用；任何取消/失败立即终止
async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "青果教务导入",
        "将从教务接口直接获取课表数据，请确保已在当前浏览器登录教务系统。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    // 1. 学期列表 + 用户选择（列表拉取失败大概率是未登录）
    let semester;
    try {
        semester = await selectSemester();
    } catch (error) {
        window.shiguangBridge.showToast("获取学期列表失败，请确认已登录教务系统");
        return;
    }
    if (semester === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    // 2. 内部学号
    let studentId;
    try {
        studentId = await getInternalStudentId();
    } catch (error) {
        studentId = null;
    }
    if (!studentId) {
        window.shiguangBridge.showToast("获取学号失败，请稍后重试或向维护者反馈");
        return;
    }

    // 3. 拉取并解析课表
    window.shiguangBridge.showToast(`正在抓取「${semester.name}」课表数据...`);
    let courses;
    try {
        const html = await fetchCourseHtml(semester.xn, semester.xq, studentId);
        courses = parseCourseTableHtml(html);
    } catch (error) {
        window.shiguangBridge.showToast("导入失败：" + error.message);
        return;
    }
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程数据，请确认所选学期有课程安排");
        return;
    }

    // 4. 开学日期：接口自动获取 → 用户确认（取消则终止）
    let apiStartDate = null;
    try {
        apiStartDate = await fetchSemesterStartDate(semester.xn, semester.xq);
    } catch (error) {
        apiStartDate = null;
    }
    const startDate = await window.shiguangBridgePromise.showPrompt(
        "确认开学日期",
        "请确认本学期第一周周一的日期（用于校准周数）",
        apiStartDate || getMondayOfCurrentWeek(),
        "validateDateInput"
    );
    if (startDate === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    // 5. 保存开学日期
    const configSaved = await saveCourseConfig(startDate);
    if (!configSaved) return;

    // 6. 保存课程
    try {
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saveResult !== true) {
            window.shiguangBridge.showToast("导入失败：课程数据未能保存");
            return;
        }
    } catch (error) {
        window.shiguangBridge.showToast("导入失败：" + error.message);
        return;
    }

    // 7. 时间段（骨架）→ 组合作息
    const timeSlotSaved = await importTimeSlots();
    if (timeSlotSaved) {
        await importComboSchedule();
    } else {
        window.shiguangBridge.showToast("时间段导入失败，跳过组合作息。");
    }

    // 8. 全部成功
    window.shiguangBridge.showToast(`导入成功，共 ${courses.length} 门课程，夏/冬令时将按日期自动切换`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
