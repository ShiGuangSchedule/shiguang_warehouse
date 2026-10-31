// 北京交通大学 (bjtu.edu.cn) 拾光课程表适配脚本
// 教学支撑平台 aa.bjtu.edu.cn（Django），课表页 GET /course_selection/courseselect/stuschedule/
// 学期切换为页面下拉链接 ?xnxq=<学期>，作息时间在表格每行首格（第N节 [HH:MM-HH:MM]），直接提取
// 课程块：课号 / span=color000 课名 / div 内 周次+<i>教师 / span.text-muted 地点；同格可多门（单双周）

// 解析周次："第01-16周" / "第01, 03, 05周" / "第05-12周"
function parseWeeks(text) {
    const matched = String(text).match(/第(.+?)周/);
    if (!matched) return [];
    const weeks = [];
    for (const part of matched[1].split(/[,，]/)) {
        const range = part.trim().match(/^(\d+)-(\d+)$/);
        if (range) {
            for (let w = Number(range[1]); w <= Number(range[2]); w++) weeks.push(w);
        } else if (/^\d+$/.test(part.trim())) {
            weeks.push(Number(part.trim()));
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析课表 HTML：返回 { timeSlots, courses, semesterOptions }
function parseScheduleHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const semesterOptions = Array.from(doc.querySelectorAll("a[href*='xnxq=']"))
        .map(a => ({
            href: a.getAttribute("href"),
            text: a.textContent.trim().replace(/\s+学期$/, "")
        }))
        .filter(o => /^\d{4}-\d{4}-\d$/.test(o.text));

    // 下拉列表首位是下学期（无课），当前学期以标题按钮文本为准
    const currentText = (doc.querySelector(".widget-header button") || {}).textContent || "";
    const currentSemester = currentText.match(/\d{4}-\d{4}-\d/);
    const defaultIndex = currentSemester
        ? Math.max(0, semesterOptions.findIndex(o => o.text === currentSemester[0]))
        : 0;

    const table = doc.querySelector("table.table-bordered");
    if (!table) throw new Error("未找到课表格子，请确认已登录教学支撑平台。");

    const timeSlots = [];
    const courses = [];
    const seen = new Set();

    const rows = Array.from(table.rows);
    for (const row of rows) {
        if (row.cells.length < 8) continue;
        const head = row.cells[0].textContent;
        const sectionMatch = head.match(/第(\d+)节/);
        const timeMatch = head.match(/\[(\d{2}:\d{2})-(\d{2}:\d{2})\]/);
        if (!sectionMatch || !timeMatch) continue;
        const section = Number(sectionMatch[1]);
        timeSlots.push({ number: section, startTime: timeMatch[1], endTime: timeMatch[2] });

        for (let day = 1; day <= 7; day++) {
            const td = row.cells[day];
            if (!td) continue;
            for (const block of Array.from(td.children).filter(el => el.tagName === "DIV")) {
                const nameEl = block.querySelector("span[style*='color:#000']");
                const teacherEl = block.querySelector("i");
                const locationEl = block.querySelector("span.text-muted");
                if (!nameEl || !teacherEl || !locationEl) continue;

                const weekDiv = teacherEl.parentElement;
                const weeks = parseWeeks(weekDiv ? weekDiv.textContent : "");
                if (!weeks.length) continue;

                const name = nameEl.textContent.trim().replace(/\s*\[[^\]]+\]\s*$/, "");
                if (!name) continue;

                // 地点"海淀东校区, 东区一教, DQ409"只取最后一段，"地点见…通知"等整句保留
                const locationText = locationEl.textContent.trim();
                const location = locationText.split(",").pop().trim();

                const course = {
                    name: name,
                    teacher: teacherEl.textContent.trim(),
                    position: location,
                    day: day,
                    startSection: section,
                    endSection: section,
                    weeks: weeks
                };
                const key = JSON.stringify(course);
                if (seen.has(key)) continue;
                seen.add(key);
                courses.push(course);
            }
        }
    }

    if (!timeSlots.length) throw new Error("课表为空或结构异常。");
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    return { timeSlots, courses, semesterOptions, defaultIndex };
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录北京交通大学教学支撑平台", "好的，开始导入");
}

// 请求课表页（学期列表与默认学期都在首屏返回里）
async function fetchSchedulePage(query) {
    const resp = await fetch("/course_selection/courseselect/stuschedule/" + (query || ""),
        { method: "GET", credentials: "include" });
    if (!resp.ok) throw new Error("课表请求失败（HTTP " + resp.status + "）");
    return resp.text();
}

async function runImportFlow() {
    if (!await promptUserToStart()) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

    try {
        window.shiguangBridge.showToast("正在请求课表数据...");

        const defaultHtml = await fetchSchedulePage("");
        const { semesterOptions, defaultIndex } = parseScheduleHtml(defaultHtml);

        let html = defaultHtml;
        if (semesterOptions.length > 1) {
            const index = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期", JSON.stringify(semesterOptions.map(o => o.text)), defaultIndex);
            if (index === null || index === -1) { window.shiguangBridge.showToast("用户取消了导入。"); return; }
            if (index !== defaultIndex) html = await fetchSchedulePage(semesterOptions[index].href);
        }

        const { timeSlots, courses } = parseScheduleHtml(html);
        if (!courses.length) throw new Error("未解析到课程，请确认所选学期有课。");

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots)); } catch (e) {}

        window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        window.shiguangBridge.showToast("导入失败：" + e.message);
        console.error("JS: Import Error", e);
    }
}

runImportFlow();