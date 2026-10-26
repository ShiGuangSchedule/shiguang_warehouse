// 洛阳理工学院教务（乘方教务）适配器
// 流程：获取学期列表 → 选择学期 → 导入课表与教务作息
// 接口：
//   GET  /new/student/xsgrkb/week.page            课表页数据（学期下拉 + 作息表，直接请求获取，无需进入课表页面）
//   POST /new/student/xsgrkb/getCalendarWeekDatas  整学期课程数据

// 周次字符串
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(",").map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析按周场地字符串
function parseVenueWeeks(jxcdmc2) {
    const venueMap = new Map();
    let lastRoom = null;
    String(jxcdmc2 || "").split(",").forEach(part => {
        const match = part.trim().match(/^(.*?)-(\d+)$/);
        if (!match) return;
        const room = match[1].trim();
        const week = parseInt(match[2], 10);
        if (room) lastRoom = room;
        if (!lastRoom || isNaN(week)) return;
        if (!venueMap.has(lastRoom)) venueMap.set(lastRoom, []);
        venueMap.get(lastRoom).push(week);
    });
    return venueMap;
}

// 课程地点
function resolvePosition(item) {
    const primary = String(item.jxcdmc || "").trim();
    if (primary) return primary;
    if (String(item.bapjxcd || "") === "1") return "不用场地";
    return "待定";
}

function cleanTeacherName(raw) {
    return String(raw || "").replace(/\[[^\]]*\]/g, "").trim();
}

// 课表接口数据
function parseCourseList(apiJson, slotMap) {
    if (!apiJson) throw new Error("课表接口无响应");
    if (apiJson.code !== 0) {
        const message = String(apiJson.message || "").trim();
        throw new Error(message || `课表接口返回错误（code=${apiJson.code}）`);
    }
    if (!Array.isArray(apiJson.data)) throw new Error("课表接口返回格式不正确");

    const courseMap = new Map();
    apiJson.data.forEach(item => {
        const day = parseInt(item.xq, 10);
        const startSection = parseInt(item.ps, 10);
        const endSection = parseInt(item.pe, 10);
        const allWeeks = parseWeeks(item.zc);
        if (!item.kcmc || !allWeeks.length || isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) return;

        const teacher = cleanTeacherName(item.teaxms || item.pkr) || "未知";
        const venues = parseVenueWeeks(item.jxcdmc2);
        const venueEntries = venues.size > 0
            ? Array.from(venues.entries(), ([position, weeks]) => ({ position, weeks: [...new Set(weeks)].sort((a, b) => a - b) }))
            : [{ position: resolvePosition(item), weeks: allWeeks }];

        venueEntries.forEach(({ position, weeks }) => {
            const course = { name: item.kcmc.trim(), teacher, position, day, startSection, endSection, weeks };

            const actualStart = String(item.qssj || "").slice(0, 5);
            const actualEnd = String(item.jssj || "").slice(0, 5);
            const expectedStart = slotMap[startSection] && slotMap[startSection].start;
            const expectedEnd = slotMap[endSection] && slotMap[endSection].end;
            if (actualStart && actualEnd && (actualStart !== expectedStart || actualEnd !== expectedEnd)) {
                course.isCustomTime = true;
                course.customStartTime = actualStart;
                course.customEndTime = actualEnd;
            }

            const key = [course.name, teacher, position, day,
                course.isCustomTime ? actualStart + actualEnd : `${startSection}-${endSection}`].join("__");
            const existing = courseMap.get(key);
            if (existing) {
                existing.weeks = [...new Set(existing.weeks.concat(weeks))].sort((a, b) => a - b);
            } else {
                courseMap.set(key, course);
            }
        });
    });

    return Array.from(courseMap.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.name.localeCompare(b.name)
    );
}

// 从 week.page 源码提取作息表
function parseBusinessHoursFromHtml(htmlText) {
    const match = htmlText.match(/var\s+businessHours\s*=\s*\$\.parseJSON\('(\[.*?\])'\);/);
    const slots = [];
    const map = {};
    if (match) {
        JSON.parse(match[1]).forEach(item => {
            const number = parseInt(item.jcdm, 10);
            const startTime = String(item.qssj || "").slice(0, 5);
            const endTime = String(item.jssj || "").slice(0, 5);
            if (isNaN(number) || !startTime || !endTime) return;
            slots.push({ number, startTime, endTime });
            map[number] = { start: startTime, end: endTime };
        });
        slots.sort((a, b) => a.number - b.number);
    }
    return { slots, map };
}

// 读取页面中的学期下拉框
function extractSemesterOptions(doc) {
    const selectElem = doc.getElementById("xnxqdm");
    if (!selectElem) return null;
    const semesters = [];
    const semesterValues = [];
    let defaultIndex = 0;
    Array.from(selectElem.querySelectorAll("option")).forEach(option => {
        if (!option.value) return;
        semesters.push(option.innerText.trim());
        semesterValues.push(option.value);
        if (option.selected || option.hasAttribute("selected")) defaultIndex = semesters.length - 1;
    });
    if (semesters.length === 0) return null;

    const start = Math.max(0, defaultIndex - 1);
    const end = Math.min(semesters.length, defaultIndex + 10);
    return {
        semesters: semesters.slice(start, end),
        semesterValues: semesterValues.slice(start, end),
        defaultIndex: defaultIndex - start
    };
}

// 导入前提示用户先登录教务系统
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "洛阳理工学院教务导入",
        "请先确保已登录教务系统，再继续导入。",
        "我已登录"
    );
}

// 从页面已有学期中选择目标学期
async function selectSemester(semesterOptions) {
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.semesters),
        semesterOptions.defaultIndex
    );
    if (selectedIndex === null || selectedIndex < 0) return null;
    return {
        label: semesterOptions.semesters[selectedIndex],
        value: semesterOptions.semesterValues[selectedIndex]
    };
}

// 直接获取课表页数据（学期下拉与作息表）。乘方教务系统的学期列表由服务端渲染，
// 不提供返回学期列表的 JSON 接口，因此直接请求 week.page 即可，无需用户进入课表页面。
async function fetchSchedulePage() {
    const response = await fetch("/new/student/xsgrkb/week.page", { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error(`无法获取课表数据（HTTP ${response.status}）`);
    return response.text();
}

// 乘方统一表单 POST，附带 JSON 请求头与会话
async function postForm(url, formData) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include",
        body: formData.toString()
    });
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response;
}

// 请求指定学期的课程数据
async function fetchCourseData(xnxqdm) {
    const year = parseInt(xnxqdm.slice(0, 4), 10);
    const formData = new URLSearchParams();
    formData.append("xnxqdm", xnxqdm);
    formData.append("zc", "");
    formData.append("d1", `${year}-08-01 00:00:00`);
    formData.append("d2", `${year + 1}-08-31 23:59:59`);
    return (await postForm("/new/student/xsgrkb/getCalendarWeekDatas", formData)).json();
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return;
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

// 编排导入流程：提示 → 选学期 → 请求课表 → 保存课程与作息时间
async function runImportFlow() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) { window.shiguangBridge.showToast("导入已取消"); return; }

        const pageHtml = await fetchSchedulePage();
        const semesterOptions = extractSemesterOptions(new DOMParser().parseFromString(pageHtml, "text/html"));
        if (!semesterOptions) throw new Error("未找到学期列表，请先登录教务系统");

        const semester = await selectSemester(semesterOptions);
        if (!semester) { window.shiguangBridge.showToast("导入已取消"); return; }

        const { slots, map: slotMap } = parseBusinessHoursFromHtml(pageHtml);
        window.shiguangBridge.showToast(`正在获取 ${semester.label} 的课表...`);
        const courses = parseCourseList(await fetchCourseData(semester.value), slotMap);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "该学期没有获取到课程数据，请检查登录状态和所选学期。",
                "确定"
            );
            return;
        }

        await saveCourses(courses);
        try {
            await saveTimeSlots(slots);
        } catch (error) {
            window.shiguangBridge.showToast(`课程已导入，作息时间导入失败：${error.message}`);
        }

        window.shiguangBridge.showToast("导入完成");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            error.message || String(error),
            "确定"
        );
    }
}

runImportFlow();
