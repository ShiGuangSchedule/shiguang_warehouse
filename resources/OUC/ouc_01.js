// 中国海洋大学(ouc.edu.cn) 拾光课程表适配脚本 v3
// 基于强智教务系统网络请求方式导入 流程：确认登录 -> 拉取学期列表 -> 用户选择学期 -> 拉取教学周历 -> 请求课表 -> 选择校区作息 -> 保存课程/作息/配置

const BASE_URL = "https://jwgl2024.ouc.edu.cn";
const URL_COURSE   = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; 
const URL_CALENDAR = `${BASE_URL}/jsxsd/jxzl/jxzl_query`; 
const KBJCMSID = "16FD8C2BE55E15F9E0630100007FF6B5";

function pad2(n) { return String(n).padStart(2, "0"); }

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const isSingle = weekStr.includes("(单)");
    const isDouble = weekStr.includes("(双)");
    const clean = weekStr.replace(/\([单双]\)/g, "").replace(/[周课]/g, "");

    clean.split(/[,，、]/).forEach(seg => {
        seg = seg.trim();
        if (!seg) return;
        const m = seg.match(/^(\d+)\s*-\s*(\d+)$/);
        let start, end;
        if (m) { start = Number(m[1]); end = Number(m[2]); }
        else if (/^\d+$/.test(seg)) { start = end = Number(seg); }
        else { return; }
        for (let w = start; w <= end; w++) {
            if (isSingle && w % 2 === 0) continue;
            if (isDouble && w % 2 !== 0) continue;
            weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({ ...c, name: c.name || '', teacher: c.teacher || '', position: c.position || '', weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : [] }));

    list.sort((a, b) => {
        return (a.name || '').localeCompare(b.name || '') ||
               (a.teacher || '').localeCompare(b.teacher || '') ||
               (a.position || '').localeCompare(b.position || '') ||
               (a.day || 0) - (b.day || 0) ||
               (a.weeks || []).join(',').localeCompare((b.weeks || []).join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0] && { ...list[0] };

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        if (!current) { current = { ...next }; continue; }
        const same = current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            (current.weeks || []).join(',') === (next.weeks || []).join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;
        if (same && isContinuous) {
            current.endSection = next.endSection;
        } else if (same && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = { ...next };
        }
    }
    if (current) step1Merged.push(current);

    const step2Merged = [];
    let cur = step1Merged[0] && { ...step1Merged[0] };
    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        if (!cur) { cur = { ...nxt }; continue; }
        const same = cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;
        if (same) {
            cur.weeks = Array.from(new Set([...(cur.weeks || []), ...(nxt.weeks || [])])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = { ...nxt };
        }
    }
    if (cur) step2Merged.push(cur);

    return step2Merged;
}

// 课表解析
function parseCourseItem(li, day) {
    const titleEl = li.querySelector && li.querySelector(".qz-hasCourse-title");
    const name = titleEl ? titleEl.textContent.trim() : "";

    const text = (li.textContent || "").replace(/\s+/g, "");

    const timeMatch = text.match(/时间[：:]([^;；]*)(?:;|$)/);
    let weeks = [];
    let startSection = 1;
    let endSection = 1;
    if (timeMatch) {
        const timePart = timeMatch[1];
        const weekMatch = timePart.match(/([\d][\d,，、-]*(?:\([单双]\))?)\s*周/);
        if (weekMatch) weeks = parseWeeks(weekMatch[1]);
        const secMatch = timePart.match(/\[(\d+)(?:\s*-\s*(\d+))?\s*节\]/);
        if (secMatch) {
            startSection = Number(secMatch[1]);
            endSection = secMatch[2] ? Number(secMatch[2]) : startSection;
        }
    }

    const teacherMatch = text.match(/老师[：:]([^;；]+)/);
    const teacher = teacherMatch ? teacherMatch[1].trim() : "";

    const posMatch = text.match(/地点[：:]([^;；]*)/);
    const position = posMatch ? posMatch[1].trim() : "";

    if (!name || weeks.length === 0) return null;
    return { name, teacher, position, day, startSection, endSection, weeks };
}

function parseTimetableToModel(doc) {
    const table = doc.querySelector("table.qz-weeklyTable");
    if (!table) return [];

    const courses = [];
    const body = table.querySelector("tbody") || table;
    body.querySelectorAll("tr.qz-weeklyTable-tr").forEach(row => {
        let day = 0;
        row.querySelectorAll("td[name=kbDataTd], td[name='kbDataTd']").forEach(cell => {
            day++;
            cell.querySelectorAll("li.courselists-item").forEach(li => {
                const c = parseCourseItem(li, day);
                if (c) courses.push(c);
            });
        });
    });

    return mergeAndDistinctCourses(courses);
}

function parseSemesterOptions(doc) {
    const select = doc.querySelector("select#xnxq01id");
    if (!select) return { list: [], defaultIndex: -1 };
    const options = Array.from(select.querySelectorAll("option"));
    const allOptions = options.map(opt => ({
        value: opt.value.trim(),
        label: opt.textContent.trim()
    }));
    if (allOptions.length === 0) return { list: [], defaultIndex: -1 };

    let defaultIndex = options.findIndex(o => o.hasAttribute("selected"));
    if (defaultIndex === -1) defaultIndex = 0;

    const start = Math.max(0, defaultIndex - 3);
    const end = Math.min(allOptions.length, defaultIndex + 4);
    const list = allOptions.slice(start, end);
    const localDefault = defaultIndex - start;
    return { list, defaultIndex: localDefault };
}

function parseCalendarRows(doc) {
    const rows = [];
    const table = doc.querySelector("table.qz-weeklyTable") || doc.querySelector("table");
    if (!table) return rows;

    const body = table.querySelector("tbody") || table;
    body.querySelectorAll("tr").forEach(tr => {
        const cells = Array.from(tr.querySelectorAll("td"));
        if (!cells.length) return;
        const label = cells[0].textContent.replace(/\s+/g, "");
        const wkMatch = label.match(/第\s*(\d+)\s*周/);
        if (!wkMatch) return;

        const dayText = cells.slice(1).map(c => c.textContent.replace(/\s+/g, ""));
        rows.push({ week: Number(wkMatch[1]), cells: dayText });
    });
    return rows;
}

function deriveMondayFromRow(row, week, semesterYear) {
    const yearGuess = [semesterYear, semesterYear + 1];

    const fullDateIdx = [];
    row.cells.forEach((t, i) => {
        const m = t.match(/^(\d{1,2})月(\d{1,2})日$/);
        if (m) fullDateIdx.push({ idx: i, month: Number(m[1]), day: Number(m[2]) });
    });

    for (const fd of fullDateIdx) {
        const weekdayFrom = (fd.idx + 1) % 7; 
        for (const y of yearGuess) {
            const d = new Date(y, fd.month - 1, fd.day);
            if (d.getDay() === weekdayFrom) {
                const monday = new Date(d.getTime() - fd.idx * 86400000);
                return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
            }
        }
    }

    const mondayCell = row.cells[0];
    const mm = mondayCell.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (mm) {
        for (const y of yearGuess) {
            const d = new Date(y, Number(mm[1]) - 1, Number(mm[2]));
            if (d.getDay() === 1) return `${y}-${pad2(Number(mm[1]))}-${pad2(Number(mm[2]))}`;
        }
    }
    return null;
}

async function fetchSemesterList() {
    const html = await requestText(`${URL_COURSE}?viweType=0`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseSemesterOptions(doc);
}

async function fetchCalendarInfo(semesterId, semesterYear) {
    const url = `${URL_CALENDAR}?xnxq01id=${encodeURIComponent(semesterId)}`;
    const html = await requestText(url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const calendarRows = parseCalendarRows(doc);
    if (calendarRows.length === 0) return { startDate: null, totalWeeks: null };

    let startDate = null;
    let totalWeeks = 0;
    calendarRows.forEach(r => {
        if (r.week > totalWeeks) totalWeeks = r.week;
        if (r.week === 1) {
            startDate = deriveMondayFromRow(r, r.week, semesterYear);
        }
    });
    return { startDate, totalWeeks };
}

async function fetchCourses(semesterId) {
    const url = `${URL_COURSE}?viweType=0&showallprint=0&showkchprint=0&showkink=0&showfzmprint=0`
        + `&baseUrl=%2Fjsxsd&xsflMapListJsonStr=${encodeURIComponent("讲课学时,实践学时,")}`
        + `&xnxq01id=${encodeURIComponent(semesterId)}&zc=&kbjcmsid=${KBJCMSID}`;
    const html = await requestText(url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseTimetableToModel(doc);
}

async function requestText(url) {
    const resp = await fetch(url, { method: "GET", credentials: "include" });
    if (!resp.ok) {
        throw new Error(`请求失败：HTTP ${resp.status}`);
    }
    return await resp.text();
}

function buildCourseConfig(semesterStartDate, totalWeeks) {
    const config = {
        semesterTotalWeeks: totalWeeks || 20,
        firstDayOfWeek: 1,
        defaultClassDuration: 50,
        defaultBreakDuration: 10
    };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    return config;
}

async function saveCourseConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        return false;
    }
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }
    window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

const LAOSHAN_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:20" },
    { number: 6, startTime: "14:30", endTime: "15:20" },
    { number: 7, startTime: "15:30", endTime: "16:20" },
    { number: 8, startTime: "16:30", endTime: "17:20" },
    { number: 9, startTime: "17:30", endTime: "18:20" },
    { number: 10, startTime: "18:30", endTime: "19:20" },
    { number: 11, startTime: "19:30", endTime: "20:20" },
    { number: 12, startTime: "20:30", endTime: "21:20" }
];

const WEST_COAST_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:20" },
    { number: 2, startTime: "09:25", endTime: "10:15" },
    { number: 3, startTime: "10:30", endTime: "11:20" },
    { number: 4, startTime: "11:25", endTime: "12:15" },
    ...LAOSHAN_TIME_SLOTS.slice(4)
];

const SCHEDULE_OPTIONS = [
    { name: "崂山/鱼山校区", slots: LAOSHAN_TIME_SLOTS },
    { name: "西海岸校区", slots: WEST_COAST_TIME_SLOTS }
];

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("课程导入流程即将开始...");
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "中国海洋大学课表导入",
            "导入前请确保已成功登录教务系统，且当前网络可访问",
            "好的，开始导入"
        );
        if (!confirmed) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }

        window.shiguangBridge.showToast("正在获取学期列表...");
        const { list: semesters, defaultIndex } = await fetchSemesterList();
        if (!semesters || semesters.length === 0) {
            window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
            return;
        }

        const labels = semesters.map(s => s.label);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(labels),
            defaultIndex
        );
        if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }
        const semester = semesters[Math.min(selectedIndex, semesters.length - 1)];
        const semesterId = semester.value;

        const parts = semesterId.split("-");
        const suffix = Number(parts[2]);
        const semesterYear = suffix === 3 ? Number(parts[0]) + 1 : Number(parts[0]);

        window.shiguangBridge.showToast("正在获取学期信息...");
        let startDate = null, totalWeeks = null;
        try {
            const cal = await fetchCalendarInfo(semesterId, semesterYear);
            startDate = cal.startDate;
            totalWeeks = cal.totalWeeks;
        } catch (e) {
            console.warn("获取教学周历失败：", e.message);
        }

        window.shiguangBridge.showToast("正在请求课程数据...");
        const courses = await fetchCourses(semesterId);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        const scheduleIdxRaw = await window.shiguangBridgePromise.showSingleSelection(
            "请选择校区作息表：",
            JSON.stringify(SCHEDULE_OPTIONS.map(option => option.name)),
            0
        );
        const scheduleIndex = Number(scheduleIdxRaw);
        const schedule = SCHEDULE_OPTIONS[
            Number.isInteger(scheduleIndex) && scheduleIndex >= 0 && scheduleIndex < SCHEDULE_OPTIONS.length
                ? scheduleIndex
                : 0
        ];

        const config = buildCourseConfig(startDate, totalWeeks);
        await saveCourseConfig(config);
        await importPresetTimeSlots(schedule.slots);
        const courseSaved = await saveCourses(courses);
        if (!courseSaved) {
            window.shiguangBridge.showToast("课程保存失败，请重试。");
            return;
        }

        window.shiguangBridge.showToast(
            `导入成功：${courses.length} 门课程，作息 ${schedule.name}，共 ${config.semesterTotalWeeks} 周。`
        );
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("课程导入失败:", error);
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

runImportFlow();
