// 广西电力职业技术学院(gxdlxy.com) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速


window.validateYearInput = function (input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false; // 验证通过
    } else {
        return "请输入四位数字的起始学年（如 2025）";
    }
};

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    const pureWeekData = weekStr.replace(/周|\(.*?\)/g, '');

    const segments = pureWeekData.split(',');
    segments.forEach(seg => {
        if (seg.includes('-')) {
            const range = seg.split('-').map(Number);
            const start = range[0];
            const end = range[1];
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    weeks.push(i);
                }
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) {
                weeks.push(w);
            }
        }
    });

    return [...new Set(weeks)].sort((a, b) => a - b);
}

function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;
    courses.sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.teacher !== b.teacher) return a.teacher.localeCompare(b.teacher);
        if (a.position !== b.position) return a.position.localeCompare(b.position);
        return a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const merged = [];
    let current = courses[0];

    for (let i = 1; i < courses.length; i++) {
        const next = courses[i];

        const isSameCourse =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = (current.endSection + 1 === next.startSection);

        if (isSameCourse && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection) {
            continue;
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

/**
 * 将 HTML 源码解析为课程模型
 */
function parseTimetableToModel(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return [];

    let rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 星期
            const detailDiv = cell.querySelector('div.kbcontent');
            if (!detailDiv) return;

            const rawHtml = detailDiv.innerHTML.trim();
            if (!rawHtml || rawHtml === "&nbsp;" || detailDiv.innerText.trim().length < 2) return;

            // 分割同一个格子内的多门课程
            const blocks = rawHtml.split(/---------------------|----------------------/);

            blocks.forEach(block => {
                if (!block.trim()) return;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = block;

                // 1. 提取课程名
                let name = "";
                for (let node of tempDiv.childNodes) {
                    if (node.nodeType === 3 && node.textContent.trim() !== "") {
                        name = node.textContent.trim();
                        break;
                    }
                }

                // 2. 提取教师
                const teacher = tempDiv.querySelector('font[title="老师"]')?.innerText.trim() || "未知教师";

                // 3. 提取地点与精准节次 (关键点)
                const locationFull = tempDiv.querySelector('font[title="教室"]')?.innerText || "未知地点";
                let startSection = 0;
                let endSection = 0;

                // 匹配内部的 [01-02]节 格式
                const sectionMatch = locationFull.match(/\[(\d+)-(\d+)\]节/);
                if (sectionMatch) {
                    startSection = parseInt(sectionMatch[1], 10);
                    endSection = parseInt(sectionMatch[2], 10);
                }

                // 清洗教室名
                const position = locationFull.replace(/\[\d+-\d+\]节$/, "").trim();

                // 4. 提取周次
                const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText || "";

                if (name && startSection > 0) {
                    rawCourses.push({
                        "name": name,
                        "teacher": teacher,
                        "weeks": parseWeeks(weekStr),
                        "position": position,
                        "day": day,
                        "startSection": startSection,
                        "endSection": endSection
                    });
                }
            });
        });
    });

    // 调用合并函数
    return mergeAndDistinctCourses(rawCourses);
}

// 交互封装模块

async function showWelcomeAlert() {
    return await window.shiguangBridgePromise.showAlert(
        "导入提示",
        "请确保已在内置浏览器中成功登录广西电力职业技术学院教务系统。",
        "开始导入"
    );
}

async function getSemesterParamsFromUser() {
    const currentYear = new Date().getFullYear();
    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入起始学年（如2025代表2025-2026学年）:",
        String(currentYear),
        "validateYearInput"
    );
    if (!year) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        0
    );
    if (semesterIndex === null) return null;

    // 拼接教务系统识别码
    return `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;
}

// 网络与存储封装模块

async function fetchCourseHtml(semesterId) {
    window.shiguangBridge.showToast("正在请求课表数据，请稍候...");
    const response = await fetch("https://jw.vpn.gxdlxy.com/jsxsd/xskb/xskb_list.do", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
        credentials: "include"
    });
    return await response.text();
}

async function saveCourseDataToApp(courses) {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        "semesterTotalWeeks": 20,
        "firstDayOfWeek": 1
    }));

    const timeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:10" },
        { "number": 2, "startTime": "09:20", "endTime": "10:00" },
        { "number": 3, "startTime": "10:20", "endTime": "11:00" },
        { "number": 4, "startTime": "11:10", "endTime": "11:50" },
        { "number": 5, "startTime": "14:30", "endTime": "15:10" },
        { "number": 6, "startTime": "15:20", "endTime": "16:00" },
        { "number": 7, "startTime": "16:10", "endTime": "16:50" },
        { "number": 8, "startTime": "16:50", "endTime": "17:30" },
        { "number": 9, "startTime": "19:40", "endTime": "20:20" },
        { "number": 10, "startTime": "20:30", "endTime": "21:10" }
    ];
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));

    // 保存最终课程
    return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

// 流程控制模块

async function runImportFlow() {
    try {
        const start = await showWelcomeAlert();
        if (!start) return;

        const semesterId = await getSemesterParamsFromUser();
        if (!semesterId) return;

        const html = await fetchCourseHtml(semesterId);

        const finalCourses = parseTimetableToModel(html);

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        await saveCourseDataToApp(finalCourses);

        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error(error);
        window.shiguangBridge.showToast("导入异常: " + error.message);
    }
}

// 启动执行
runImportFlow();