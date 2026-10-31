// 成都医学院教务（乘方教务）适配器
// 流程：选一次学期（课表/考试/上课任务/开学日期共用）→ 拉上课任务与课表 → 询问是否导入考试 → 保存配置、课程与作息
// 接口：
//   GET  /new/student/xsgrkb/week.page             课表页（学期下拉 + 作息表）
//   POST /new/student/xsgrkb/getCalendarWeekDatas  整学期课程数据
//   POST /new/student/xsksrw/paginateXsksrw        学生考试任务
//   POST /new/student/xskcrw/skrwDatas             上课任务（学分与选修类别）
//   POST /new/xlxx/getDatesOfWeek                  第1周日期（开学日期）

// 周次字符串
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(",").map(w => parseInt(w.trim(), 10)).filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 按周场地字符串
function parseVenueWeeks(jxcdmc2) {
    const venueMap = new Map();
    String(jxcdmc2 || "").split(",").forEach(part => {
        const match = part.trim().match(/^(.*?)-(\d+)$/);
        if (!match) return;
        const week = parseInt(match[2], 10);
        const key = match[1].trim() || "不用场地";
        if (!venueMap.has(key)) venueMap.set(key, []);
        venueMap.get(key).push(week);
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

// 教师名
function cleanTeacherName(raw) {
    return [...new Set(String(raw || "").replace(/\[[^\]]*\]/g, "").split(",").map(n => n.trim()).filter(Boolean))].join(",");
}

// 课表接口数据
function parseCourseList(apiJson, slotMap, taskMap) {
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

        const teacher = cleanTeacherName(item.teaxms) || "未知";
        const info = taskMap.get(item.kcrwdm);
        const name = `${item.kcmc.trim()}${info && info.tag ? `(${info.tag})` : ""}`;
        const actualStart = String(item.qssj || "").slice(0, 5);
        const actualEnd = String(item.jssj || "").slice(0, 5);
        const expectedStart = slotMap[startSection] && slotMap[startSection].start;
        const expectedEnd = slotMap[endSection] && slotMap[endSection].end;
        const isCustomTime = actualStart && actualEnd && (actualStart !== expectedStart || actualEnd !== expectedEnd);
        const venues = parseVenueWeeks(item.jxcdmc2);
        const venueEntries = venues.size > 0
            ? Array.from(venues.entries(), ([position, weeks]) => ({ position, weeks: [...new Set(weeks)].sort((a, b) => a - b) }))
            : [{ position: resolvePosition(item), weeks: allWeeks }];

        venueEntries.forEach(({ position, weeks }) => {
            const course = { name, teacher, position, day, startSection, endSection, weeks };
            if (info) course.credit = info.credit;
            if (isCustomTime) {
                course.isCustomTime = true;
                course.customStartTime = actualStart;
                course.customEndTime = actualEnd;
            }

            const key = [course.name, teacher, position, day,
                isCustomTime ? `${actualStart}${actualEnd}` : `${startSection}-${endSection}`].join("__");
            const existing = courseMap.get(key);
            if (existing) existing.weeks = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b);
            else courseMap.set(key, course);
        });
    });

    return Array.from(courseMap.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.name.localeCompare(b.name)
    );
}

// 考试安排数据
function parseExamList(rows, slots) {
    const exams = [];
    rows.forEach(item => {
        const day = parseInt(item.xq, 10);
        const week = parseInt(item.zc, 10);
        const [startTime, endTime] = String(item.kssj || "").split("--").map(part => part.trim().slice(0, 5));
        const validTime = startTime && endTime && /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime);
        if (!item.kcmc || isNaN(day) || day < 1 || day > 7 || isNaN(week) || week < 1 || !validTime) return;

        const examType = String(item.kslbmc || "").trim().replace(/考试$/, "");
        const exam = {
            name: `${item.kcmc.trim()}${examType ? `(${examType})` : ""}`,
            teacher: "",
            position: String(item.kscdmc || "").trim() || "待定",
            day,
            weeks: [week]
        };
        const matched = slots && slots.find(s => s.startTime === startTime && s.endTime === endTime);
        if (matched) {
            exam.startSection = exam.endSection = matched.number;
        } else {
            exam.isCustomTime = true;
            exam.customStartTime = startTime;
            exam.customEndTime = endTime;
        }
        exams.push(exam);
    });
    return exams;
}

// 任选课类别标识
function resolveElectiveTag(task) {
    if (String(task.xdfsmc || "").trim() !== "任选") return "";
    if (String(task.kcflmc || "").includes("艺术")) return "艺术";
    if (String(task.kcdlmc || "").includes("通识")) return "通识";
    if (String(task.kcdlmc || "").includes("专业")) return "专业";
    return "";
}

// 上课任务数据
function parseTaskList(rows) {
    const map = new Map();
    rows.forEach(item => map.set(item.kcrwdm, { credit: item.xf, tag: resolveElectiveTag(item) }));
    return map;
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

// 插入午间段期中考试时间
function withLunchSlot(slots) {
    return slots
        .map(s => s.number >= 6 ? { ...s, number: s.number + 1 } : s)
        .concat([{ number: 6, startTime: "12:15", endTime: "14:15" }])
        .sort((a, b) => a.number - b.number);
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
        "成都医学院教务导入",
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

// 询问是否同时导入考试
async function askImportExams() {
    return await window.shiguangBridgePromise.showAlert(
        "导入考试安排",
        "是否同时导入本学期的考试安排？\n（期中/期末/补考将显示在课表对应日期）",
        "确定导入"
    );
}

// 获取课表页 HTML（含学期列表与作息表）
async function fetchSchedulePage() {
    const response = await fetch("/new/student/xsgrkb/week.page", { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error(`无法打开课表页面（HTTP ${response.status}）`);
    return response.text();
}

// 乘方统一表单 POST（课表/考试/任务/开学日期共用），附带 JSON 请求头与会话
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

// 请求第 1 周日期（开学日期）
async function fetchSemesterStartDate(xnxqdm) {
    const formData = new URLSearchParams();
    formData.append("xnxqdm", xnxqdm);
    formData.append("zc", "1");
    const rows = await (await postForm("/new/xlxx/getDatesOfWeek", formData)).json();
    return rows.find(item => item.xqmc === "1").rq;
}

// 分页拉取 rows/total 数据（考试/任务共用）
async function fetchPagedRows(url, baseParams, sort) {
    const allRows = [];
    let page = 1;

    for (;;) {
        const formData = new URLSearchParams(baseParams);
        formData.append("page", String(page));
        formData.append("rows", "100");
        formData.append("sort", sort);
        formData.append("order", "asc");

        const json = await (await postForm(url, formData)).json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
        allRows.push(...rows);

        const total = parseInt(json.total, 10);
        if (!total || allRows.length >= total || rows.length === 0) break;
        page += 1;
    }
    return allRows;
}

// 分页拉取指定学期的全部考试任务
async function fetchExamData(xnxqdm) {
    return fetchPagedRows("/new/student/xsksrw/paginateXsksrw", { xnxqdm, ksaplxdm: "", kslbdm: "" }, "zc,xq,jcdm2");
}

// 分页拉取指定学期的全部上课任务
async function fetchTaskData(xnxqdm) {
    return fetchPagedRows("/new/student/xskcrw/skrwDatas", { xnxqdm, kcdldm: "", kcfldm: "", kcmc: "" }, "kcrwdm,xdfsdm");
}

// 保存课表配置（学期 20 周、单节 40 分钟）
async function saveConfig(semesterStartDate) {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterStartDate,
        semesterTotalWeeks: 20,
        defaultClassDuration: 40
    }));
}

// 保存课程
async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

// 保存作息时间
async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return;
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

// 编排导入流程：提示 → 选学期 → 拉任务与课表 → 询问考试 → 保存配置、课程与作息
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
        let taskMap = new Map();
        try {
            taskMap = parseTaskList(await fetchTaskData(semester.value));
        } catch (error) {
            window.shiguangBridge.showToast(`上课任务获取失败，学分与类别标识已跳过：${error.message}`);
        }
        const courses = parseCourseList(await fetchCourseData(semester.value), slotMap, taskMap);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "该学期没有获取到课程数据，请检查登录状态和所选学期。",
                "确定"
            );
            return;
        }

        const exams = [];
        let timeSlots = slots;
        if (await askImportExams()) {
            timeSlots = withLunchSlot(slots);
            courses.forEach(c => {
                if (c.startSection >= 6) c.startSection += 1;
                if (c.endSection >= 6) c.endSection += 1;
            });
            window.shiguangBridge.showToast("正在获取考试安排...");
            exams.push(...parseExamList(await fetchExamData(semester.value), timeSlots));
            if (exams.length === 0) window.shiguangBridge.showToast("该学期暂时没有考试安排");
        }

        try {
            await saveConfig(await fetchSemesterStartDate(semester.value));
        } catch (error) {
            window.shiguangBridge.showToast(`课表配置导入失败，已跳过：${error.message}`);
        }

        await saveCourses([...courses, ...exams]);
        try {
            await saveTimeSlots(timeSlots);
        } catch (error) {
            window.shiguangBridge.showToast(`课程已导入，作息时间导入失败：${error.message}`);
        }

        const examTip = exams.length > 0 ? `成功导入 ${exams.length} 门考试` : "导入完成";
        window.shiguangBridge.showToast(examTip);
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
