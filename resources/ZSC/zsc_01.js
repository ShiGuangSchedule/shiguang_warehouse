// 电子科技大学中山学院(jwgln.zsc.edu.cn) 拾光课程表适配脚本
// 出现问题请联系维护者 Lanjunyee，或提交 issue / PR 反馈。

const BASE_URL = "https://jwgln.zsc.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;
const URL_COURSE = `${BASE_URL}/jsxsd/xskb/xskb_list.do`;

const WEEKDAY_LABELS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const pureWeekData = String(weekStr).split("(")[0].split("（")[0];
    pureWeekData.split(/[,，、]/).forEach(seg => {
        seg = seg.trim();
        if (!seg) return;
        if (seg.includes("-")) {
            const [s, e] = seg.split("-").map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = Math.min(s, e); i <= Math.max(s, e); i++) {
                    if (i > 0) weeks.push(i);
                }
            }
        } else {
            const w = parseInt(seg, 10);
            if (!isNaN(w) && w > 0) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
            (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

function parseTimetableToModel(doc) {
    const timetable = doc.getElementById("kbtable");
    if (!timetable) return [];

    const rows = Array.from(timetable.querySelectorAll("tr"));
    const headerRow = rows[0];
    if (!headerRow) return [];

    const headerCells = Array.from(headerRow.querySelectorAll("th, td"));
    const columnDays = [];
    headerCells.forEach(cell => {
        const text = (cell.textContent || "").replace(/\s/g, "");
        const index = WEEKDAY_LABELS.findIndex(label => text === label || text.includes(label));
        if (index >= 0) columnDays.push(index + 1);
    });
    if (columnDays.length !== 7) return [];

    const rawCourses = [];
    rows.slice(1).forEach(row => {
        const labelCell = row.querySelector("th");
        if (!labelCell) return;
        const label = (labelCell.textContent || "").replace(/\s/g, "");
        const sectionMatch = label.match(/^第(\d+)[，,](\d+)节$/);
        if (!sectionMatch) return;
        const startSection = Number(sectionMatch[1]);
        const endSection = Number(sectionMatch[2]);

        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 7) return;

        for (let index = 0; index < 7; index++) {
            const day = columnDays[index];
            const cell = cells[index];
            if (!cell) continue;

            Array.from(cell.querySelectorAll("div.kbcontent")).forEach(div => {
                const rawHtml = div.innerHTML.trim();
                if (!rawHtml || rawHtml === "&nbsp;") return;

                const blocks = rawHtml.split(/-{10,}/);
                blocks.forEach(block => {
                    if (!block.trim()) return;
                    const tempDiv = doc.createElement("div");
                    tempDiv.innerHTML = block;

                    let name = "";
                    for (const node of tempDiv.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        }
                    }
                    if (!name) return;

                    const teacherRaw = tempDiv.querySelector('font[title="老师"], font[title="教师"]')?.textContent || "";
                    const teacher = teacherRaw.replace(/任课教师[:：]/, "").trim();
                    const positionRaw = tempDiv.querySelector('font[title="教室"]')?.textContent || "";
                    const position = positionRaw.trim();
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.textContent || "";
                    const weeks = parseWeeks(weekStr);
                    if (weeks.length === 0) return;

                    rawCourses.push({
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
        }
    });

    return mergeAndDistinctCourses(rawCourses);
}

async function requestSemesterPage() {
    const response = await fetch(URL_SEMESTER, {
        method: "GET",
        credentials: "include"
    });
    return await response.text();
}

async function requestSemesterDetailPage(semesterId) {
    const response = await fetch(URL_SEMESTER, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `xnxq01id=${encodeURIComponent(semesterId)}`,
        credentials: "include"
    });
    return await response.text();
}

async function requestCoursePage(semesterId) {
    const response = await fetch(URL_COURSE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `jx0404id=&cj0701id=&zc=&demo=&xnxq01id=${encodeURIComponent(semesterId)}`,
        credentials: "include"
    });
    return await response.text();
}

async function fetchSemesterList() {
    const html = await requestSemesterPage();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const select = doc.getElementById("xnxq01id");
    if (!select) return { list: [], defaultIndex: -1 };

    const allOptions = Array.from(select.querySelectorAll("option"))
        .map(opt => ({
            value: opt.value,
            label: opt.textContent.trim(),
            selected: opt.hasAttribute("selected")
        }))
        .filter(opt => /^\d{4}-\d{4}-[12]$/.test(opt.value));

    if (allOptions.length === 0) return { list: [], defaultIndex: -1 };

    let selectedIndex = allOptions.findIndex(o => o.selected);
    if (selectedIndex === -1) selectedIndex = 0;

    const start = Math.max(0, selectedIndex - 3);
    const end = Math.min(allOptions.length, selectedIndex + 4);
    const list = allOptions.slice(start, end);

    return { list: list, defaultIndex: selectedIndex - start };
}

async function fetchSemesterInfo(semesterId) {
    const html = await requestSemesterDetailPage(semesterId);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const timetable = doc.getElementById("kbtable");
    if (!timetable) return { startDate: null, totalWeeks: null };

    const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    if (rows.length === 0) return { startDate: null, totalWeeks: null };

    let startDate = null;
    for (const row of rows) {
        const dateCell = row.querySelector("td[title]");
        if (!dateCell) continue;
        const title = dateCell.getAttribute("title") || "";
        const match = title.match(/^(\d{4})年(\d{1,2})月(\d{1,2})$/);
        if (match) {
            startDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
            break;
        }
    }

    let totalWeeks = null;
    for (const row of rows) {
        const firstTd = row.querySelector("td");
        if (!firstTd) continue;
        const n = parseInt((firstTd.textContent || "").trim(), 10);
        if (!isNaN(n) && n > 0) {
            if (totalWeeks === null || n > totalWeeks) totalWeeks = n;
        }
    }

    if (totalWeeks !== null && totalWeeks < 8) totalWeeks = null;

    return { startDate: startDate, totalWeeks: totalWeeks };
}

async function fetchCourses(semesterId) {
    const html = await requestCoursePage(semesterId);
    return parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));
}

async function saveAppConfig(semesterStartDate, totalWeeks) {
    try {
        const config = {
            "semesterTotalWeeks": totalWeeks || 20,
            "firstDayOfWeek": 1
        };
        if (semesterStartDate) {
            config.semesterStartDate = semesterStartDate;
        }
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课表配置导入失败，已跳过。");
        return false;
    }
}

async function saveAppTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:30", "endTime": "15:15" },
        { "number": 6, "startTime": "15:25", "endTime": "16:10" },
        { "number": 7, "startTime": "16:20", "endTime": "17:05" },
        { "number": 8, "startTime": "17:15", "endTime": "18:00" },
        { "number": 9, "startTime": "18:40", "endTime": "19:25" },
        { "number": 10, "startTime": "19:35", "endTime": "20:20" },
        { "number": 11, "startTime": "20:30", "endTime": "21:15" },
        { "number": 12, "startTime": "21:25", "endTime": "22:10" }
    ];
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("作息导入失败，已跳过。");
        return false;
    }
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示",
            "请确保已成功登录教务系统。是否开始导入？",
            "开始"
        );
        if (!confirmed) return;

        window.shiguangBridge.showToast("正在获取学期列表...");
        const { list: semesters, defaultIndex } = await fetchSemesterList();
        if (!semesters || semesters.length === 0) {
            window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
            return;
        }

        const labels = semesters.map(s => s.label);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(labels), defaultIndex
        );
        if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return;
        const semesterId = semesters[selectedIndex].value;

        window.shiguangBridge.showToast("正在获取学期信息...");
        const { startDate: semesterStartDate, totalWeeks } = await fetchSemesterInfo(semesterId);

        window.shiguangBridge.showToast("正在请求课程数据...");
        const finalCourses = await fetchCourses(semesterId);
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        await saveAppConfig(semesterStartDate, totalWeeks);
        await saveAppTimeSlots();

        let saved = false;
        try {
            saved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        } catch (saveError) {
            saved = false;
        }
        if (saved !== true) {
            window.shiguangBridge.showToast("课程导入失败，请重试。");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + (error && error.message ? error.message : error));
    }
}

runImportFlow();
