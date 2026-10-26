/**
 * 南阳师范学院教务系统课表导入适配脚本
 * 青果软件系统，通过 showLessonScheduleInfosV14.action 接口获取课表
 * 课程信息分布在 id 形如 weekly0X_Y 的 div 中（X 为星期，Y 为节次单元）
 */

function parseWeeks(weekStr) {
    // 兼容 "1-2,5-18" 逗号分段 + 区间
    const weeks = [];
    weekStr.split(',').forEach(part => {
        part = part.trim();
        if (part.includes('-')) {
            const dashSegs = part.split('-').map(Number);
            if (dashSegs.length === 2 && !isNaN(dashSegs[0]) && !isNaN(dashSegs[1])) {
                for (let i = dashSegs[0]; i <= dashSegs[1]; i++) weeks.push(i);
            }
        } else if (!isNaN(Number(part))) {
            weeks.push(Number(part));
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析单个 weekly 块里的 li 文本，返回课程信息
 */
function parseWeeklyDiv(divId, liTexts) {
    // id 形如 weekly03_1 -> 星期=3，节次单元=1
    const m = divId.match(/^weekly0?(\d+)_(\d+)$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 7) return null;

    let name = "", teacher = "", timeText = "", position = "";
    for (const t of liTexts) {
        const str = t.trim();
        if (str.startsWith("课程名称")) name = str.replace(/^课程名称：/, "").replace(/^<b>/, "").replace(/<\/b>$/, "");
        else if (str.startsWith("任课教师")) teacher = str.replace(/^任课教师：/, "").replace(/^<b>/, "").replace(/<\/b>$/, "");
        else if (str.startsWith("上课时间")) timeText = str.replace(/^上课时间：/, "").replace(/^<b>/, "").replace(/<\/b>$/, "");
        else if (str.startsWith("上课地点")) position = str.replace(/^上课地点：/, "").replace(/^<b>/, "").replace(/<\/b>$/, "");
    }

    if (!name || !timeText) return null;

    // 上课时间形如：[1-2,5-18周] 三[1-2节]
    const weekMatch = timeText.match(/\[([\d,\-]+)周\]/);
    const sectionMatch = timeText.match(/\[(\d+)(?:-(\d+))?节\]/);
    if (!weekMatch || !sectionMatch) return null;

    const weeks = parseWeeks(weekMatch[1]);
    const startSection = parseInt(sectionMatch[1], 10);
    const endSection = sectionMatch[2] ? parseInt(sectionMatch[2], 10) : startSection;

    if (weeks.length === 0) return null;

    return {
        name: name,
        teacher: teacher || "未知教师",
        position: position || "未知地点",
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

/**
 * 从接口返回的 HTML 中提取所有 weekly div 并解析课程
 */
function transformSchedule(htmlString) {
    console.log("JS: transformSchedule 正在解析 HTML...");

    const tempDoc = new DOMParser().parseFromString(htmlString, "text/html");

    // 只取包裹课程详情的 weekly div（跳过表格等内容）
    const weekDivs = Array.from(tempDoc.querySelectorAll('[id^="weekly"]'))
        .filter(d => d.classList.contains("weeklesson"));

    console.log(`JS: 找到 ${weekDivs.length} 个 weekly 课程块`);

    const rawCourses = [];

    weekDivs.forEach(div => {
        const divId = div.id;
        const lis = Array.from(div.querySelectorAll("ul li"));
        const liTexts = lis.map(li => li.innerHTML);
        const course = parseWeeklyDiv(divId, liTexts);
        if (course) rawCourses.push(course);
    });

    console.log(`JS: 解析出 ${rawCourses.length} 条课程记录`);

    // 青果系统同一门课会因节次格/周次分段生成重复的 weekly 块，
    // 按组合键去重（同一课程、同时段、同周次只保留一条）。
    const seen = new Set();
    const courses = [];
    for (const c of rawCourses) {
        const key = `${c.name}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(',')}|${c.teacher}|${c.position}`;
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push(c);
    }

    console.log(`JS: 去重后剩 ${courses.length} 门课程`);
    return courses;
}

function isLoginPage() {
    const url = window.location.href;
    return url.includes('login') || url.includes('cas');
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期 (0)", "第二学期 (1)"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

async function fetchAndParseCourses(academicYear, semesterIndex) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const semesterCode = semesterIndex === 0 ? "0" : "1";
    // 从当前页面 URL 提取 vpn-12-o1-{源站} 形式的后缀（如 nysyjw.nynu.edu.cn），
    // 不同登录会话源站域名可能不同；没匹配到时回退到教务源站固定值。
    const originMatch = window.location.href.match(/vpn-12-o1-([a-zA-Z0-9.\-]+(?:\.edu\.cn)?)/);
    const originHost = originMatch ? originMatch[1] : "nysyjw.nynu.edu.cn";
    const baseUrl = "https://vpn.nynu.edu.cn/http/77726476706e69737468656265737421feee52852d27265e67069ce29d51367b58d2/nysfjw/frame/desk/showLessonScheduleInfosV14.action";
    const url = `${baseUrl}?vpn-12-o1-${originHost}&xn=${academicYear}&xq=${semesterCode}`;
    console.log(`JS: 请求课表接口: ${url}`);

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }

        const htmlText = await response.text();
        const courses = transformSchedule(htmlText);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);
        return { courses };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterIndex = await selectSemester();
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const result = await fetchAndParseCourses(academicYear, semesterIndex);
    if (result === null) {
        return;
    }
    const { courses } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();