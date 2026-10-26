// 安徽财经大学 (aufe.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请联系开发者或者提交PR更改,这更加快速

// 配置

// 可手动指定域名，留空则自动从当前页面获取
const BASE_URL = ""; // 例如 "http://jwcxk2-aufe-edu-cn.vpn2.aufe.edu.cn:8118"

// 工具函数

// 自动获取当前域名
function getBaseUrl() {
    if (BASE_URL) return BASE_URL;
    const url = new URL(window.location.href);
    return url.origin;
}

// 解析 classWeek 字符串 (支持不定长度)
function parseWeekString(weekStr) {
    let weeks = [];
    if (!weekStr) return weeks;
    for (let i = 0; i < weekStr.length; i++) {
        if (weekStr[i] === '1') weeks.push(i + 1);
    }
    return weeks;
}

// 格式化时间 (0800 -> 08:00)
function formatTime(timeStr) {
    if (timeStr && timeStr.length === 4) {
        return timeStr.substring(0, 2) + ":" + timeStr.substring(2);
    }
    return timeStr;
}

// 格式化日期 (20260831 -> 2026-08-31)
function formatDate(dateStr) {
    if (dateStr && dateStr.length === 8) {
        return dateStr.substring(0, 4) + "-" + dateStr.substring(4, 6) + "-" + dateStr.substring(6, 8);
    }
    return dateStr;
}

/**
 * 节次与周次合并去重函数（供开发者参考）
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
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
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
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
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// 从HTML中提取学期列表和动态接口路径
function parseIndexHtml(html, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    const select = doc.getElementById("planCode");
    if (!select) return null;
    
    const options = select.querySelectorAll("option");
    const semesterList = [];
    let defaultIndex = 0;
    
    options.forEach((opt, index) => {
        const value = opt.getAttribute("value");
        const text = opt.textContent.trim();
        if (value && value !== "no") {
            semesterList.push({
                value: value,
                label: text,
                isCurrent: text.includes("当前")
            });
            if (text.includes("当前")) defaultIndex = semesterList.length - 1;
        }
    });
    
    // 从JS中提取动态接口路径
    const scripts = doc.querySelectorAll("script");
    let ajaxUrl = null;
    for (const script of scripts) {
        const content = script.textContent;
        if (content && content.includes("ajaxStudentSchedule")) {
            const match = content.match(/url\s*:\s*"([^"]+ajaxStudentSchedule[^"]+)"/);
            if (match) {
                ajaxUrl = match[1];
                break;
            }
            const match2 = content.match(/\/student\/courseSelect\/thisSemesterCurriculum\/[A-Za-z0-9]+\/ajaxStudentSchedule\/past\/callback/);
            if (match2) {
                ajaxUrl = match2[0];
                break;
            }
        }
    }
    
    if (!ajaxUrl) {
        const forms = doc.querySelectorAll("form");
        for (const form of forms) {
            const action = form.getAttribute("action");
            if (action && action.includes("ajaxStudentSchedule")) {
                ajaxUrl = action;
                break;
            }
        }
    }
    
    return { semesterList, defaultIndex, ajaxUrl };
}

// 从校历页面解析开学日期
function parseStartDate(html) {
    // 匹配 var rq = "20260831";
    const match = html.match(/var\s+rq\s*=\s*"(\d{8})"/);
    if (match) {
        return formatDate(match[1]);
    }
    return null;
}

// 用户交互函数

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function selectSemesterFromList(semesterList, defaultIndex) {
    const labels = semesterList.map(s => s.label);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(labels),
        defaultIndex
    );
    if (index === null) return null;
    return semesterList[index];
}

async function getStartDate(defaultDate) {
    const result = await window.shiguangBridgePromise.showPrompt(
        "设置开学日期",
        "请输入本学期开学日期（格式：YYYY-MM-DD）:",
        defaultDate || "",
        "validateDate"
    );
    return result;
}

// 验证函数

function validateDate(input) {
    if (!input || input.trim().length === 0) return "开学日期不能为空！";
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(input)) return "请输入正确格式（例如：2026-08-31）";
    const parts = input.split("-");
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    if (month < 1 || month > 12) return "月份必须在1-12之间";
    if (day < 1 || day > 31) return "日期必须在1-31之间";
    return false;
}

// 数据获取与解析

async function fetchIndexPage(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/student/courseSelect/calendarSemesterCurriculum/index`, {
            method: "GET",
            credentials: "include"
        });
        const html = await response.text();
        const result = parseIndexHtml(html, baseUrl);
        if (!result || !result.semesterList || result.semesterList.length === 0) {
            throw new Error("未找到学期列表");
        }
        if (!result.ajaxUrl) {
            throw new Error("未找到课表接口路径");
        }
        return result;
    } catch (e) {
        window.shiguangBridge.showToast("获取首页失败: " + e.message);
        return null;
    }
}

async function fetchStartDate(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/indexCalendar`, {
            method: "GET",
            credentials: "include"
        });
        const html = await response.text();
        return parseStartDate(html);
    } catch (e) {
        console.error("获取开学日期失败:", e);
        return null;
    }
}

async function fetchTimeSlots(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/ajax/getSectionAndTime`, {
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: "planNumber=&ff=f",
            method: "POST",
            credentials: "include"
        });

        const data = await response.json();
        if (!data || !data.sectionTime || !Array.isArray(data.sectionTime)) {
            return null;
        }

        const timeSlots = data.sectionTime.map(item => ({
            number: parseInt(item.sessionName) || item.djjc,
            startTime: formatTime(item.startTime),
            endTime: formatTime(item.endTime)
        }));

        // 提取总周数
        let totalWeeks = null;
        if (data.section && data.section.zs) {
            totalWeeks = parseInt(data.section.zs);
        }

        return { timeSlots, totalWeeks };
    } catch (e) {
        console.error("获取时间段失败:", e);
        return null;
    }
}

async function fetchCourses(baseUrl, ajaxUrl, planCode) {
    try {
        window.shiguangBridge.showToast("正在获取教务数据...");

        const fullUrl = `${baseUrl}${ajaxUrl}`;

        const response = await fetch(fullUrl, {
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `&planCode=${planCode}`,
            method: "POST",
            credentials: "include"
        });

        const data = await response.json();

        if (!data) throw new Error("服务器未返回任何数据");
        if (!data.dateList || !Array.isArray(data.dateList)) {
            console.error("教务返回数据异常:", data);
            throw new Error("未能获取到课程列表，请检查是否已登录或该学期是否有课");
        }

        let courses = [];
        data.dateList.forEach(plan => {
            if (plan && plan.selectCourseList && Array.isArray(plan.selectCourseList)) {
                plan.selectCourseList.forEach(c => {
                    const teacher = (c.attendClassTeacher || "").replace(/\* /g, "").trim();

                    if (c.timeAndPlaceList && Array.isArray(c.timeAndPlaceList)) {
                        c.timeAndPlaceList.forEach(tp => {
                            let position = "";
                            if (tp.campusName) position += tp.campusName;
                            if (tp.teachingBuildingName) position += tp.teachingBuildingName;
                            if (tp.classroomName) position += tp.classroomName;

                            courses.push({
                                name: c.courseName || c.coureName || "未知课程",
                                teacher: teacher,
                                position: position || "未知地点",
                                day: tp.classDay,
                                startSection: tp.classSessions,
                                endSection: tp.classSessions + tp.continuingSession - 1,
                                weeks: parseWeekString(tp.classWeek),
                                isCustomTime: false
                            });
                        });
                    }
                });
            }
        });

        if (courses.length === 0) {
            throw new Error("该学期暂无排课数据");
        }

        return courses;
    } catch (e) {
        window.shiguangBridge.showToast("获取课程失败: " + e.message);
        return null;
    }
}

// 数据保存

async function saveToApp(courses, timeSlots, startDate, totalWeeks) {
    try {
        // 合并去重
        const mergedCourses = mergeAndDistinctCourses(courses);

        const courseSuccess = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(mergedCourses));
        if (!courseSuccess) {
            throw new Error("课程保存失败");
        }

        if (timeSlots && timeSlots.length > 0) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }

        const config = {};
        if (totalWeeks) {
            config.semesterTotalWeeks = totalWeeks;
        } else {
            config.semesterTotalWeeks = 20;
        }
        if (startDate) {
            config.semesterStartDate = startDate;
        }
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

        return true;
    } catch (e) {
        window.shiguangBridge.showToast("保存失败: " + e.message);
        return false;
    }
}

// 流程控制

async function runImportFlow() {
    const baseUrl = getBaseUrl();
    console.log("使用域名:", baseUrl);

    const alertResult = await promptUserToStart();
    if (!alertResult) return;

    // 获取学期列表
    window.shiguangBridge.showToast("正在获取学期列表...");
    const indexResult = await fetchIndexPage(baseUrl);
    if (!indexResult) return;

    // 选择学期
    const selected = await selectSemesterFromList(indexResult.semesterList, indexResult.defaultIndex);
    if (selected === null) {
        window.shiguangBridge.showToast("已取消");
        return;
    }

    // 获取开学日期（从校历页面自动获取，用户可修改）
    window.shiguangBridge.showToast("正在获取校历信息...");
    let startDate = await fetchStartDate(baseUrl);
    if (startDate) {
        startDate = await getStartDate(startDate);
        if (startDate === null) {
            window.shiguangBridge.showToast("已取消");
            return;
        }
    } else {
        startDate = await getStartDate("");
        if (startDate === null) {
            window.shiguangBridge.showToast("已取消");
            return;
        }
    }

    // 获取课程和时间段
    window.shiguangBridge.showToast("正在获取数据...");
    const [courses, timeSlotResult] = await Promise.all([
        fetchCourses(baseUrl, indexResult.ajaxUrl, selected.value),
        fetchTimeSlots(baseUrl)
    ]);

    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未获取到课程数据");
        return;
    }

    const timeSlots = timeSlotResult ? timeSlotResult.timeSlots : null;
    const totalWeeks = timeSlotResult ? timeSlotResult.totalWeeks : null;

    // 保存数据
    const saveResult = await saveToApp(courses, timeSlots, startDate, totalWeeks);
    if (!saveResult) return;

    window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程时段`);
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动
runImportFlow();