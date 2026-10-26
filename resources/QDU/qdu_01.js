// 青岛大学(xjw.qdu.edu.cn)拾光课程表适配脚本
// 由本校开发者JellyfisHawthorn适配
// 出现问题请提联系开发者或者提交pr更改,这更加快速

const BASE_URL = "https://xjw.qdu.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;   // 教学周历（学期列表 + 开学日期 + 最大周次）
const URL_COURSE = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; // 课表查询
const URL_PLAN = `${BASE_URL}/jsxsd/pyfa/pyfa_query`; // 执行计划查询（用于查课程学分）
const URL_FXPLAN = `${BASE_URL}/jsxsd/pyfa/fxpyfa_query`; // 辅修执行计划查询
const URL_WZYPLAN = `${BASE_URL}/jsxsd/pyfa/wzypyfa_query`; // 微专业执行计划查询

// 工具函数

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const pureWeekData = weekStr.split('(')[0];
    pureWeekData.split(',').forEach(seg => {
        if (seg.includes('-')) {
            const [s, e] = seg.split('-').map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = s; i <= e; i++) weeks.push(i);
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
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

    // 阶段 1：合并连续节次与完全重复记录
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
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次
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

// 核心解析逻辑

function parseTimetableToModel(doc, courseCredits) {
    // 获取课程学分对象

    const timetable = doc.getElementById('timetable');
    if (!timetable) return [];

    let rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

    rows.forEach((row, SectionIndex) => {

        const cells = row.querySelectorAll('td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDivs = cell.querySelectorAll('div.kbcontent');

            detailDivs.forEach(div => {
                const rawHtml = div.innerHTML.trim();
                if (!rawHtml || rawHtml === "&nbsp;" || div.innerText.trim().length < 2) return;

                const blocks = rawHtml.split(/---------------------|----------------------/);

                blocks.forEach(block => {
                    if (!block.trim()) return;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let name = "";
                    for (let node of tempDiv.childNodes) {
                        if (node.nodeType === 1 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        }
                    }

                    const teacherRaw = tempDiv.querySelector('font[title="老师"], font[title="教师"]')?.innerText || "";
                    const teacher = teacherRaw.replace("任课教师:", "").trim();
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText || "未知地点";
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText || "";

                    let startSection = SectionIndex * 2 + 1;
                    if (SectionIndex >= 2) startSection += 1;
                    if (SectionIndex >= 4) startSection += 1;

                    let endSection = 0;
                    if (SectionIndex === 5) endSection = startSection; else endSection = startSection + 1;

                    if (name) {
                        rawCourses.push({
                            "name": name,
                            "teacher": teacher || "未知教师",
                            "weeks": parseWeeks(weekStr),
                            "position": position,
                            "day": day,
                            "startSection": startSection,
                            "endSection": endSection,
                            "credit": courseCredits[name] || null
                        });
                    }
                });
            });
        });
    });

    return mergeAndDistinctCourses(rawCourses);
}

// 网络请求封装

/**
 * GET 教学周历页面（用于获取学期列表）
 */
async function requestSemesterPage() {
    const response = await fetch(URL_SEMESTER, {
        method: "GET",
        credentials: "include"
    });
    return await response.text();
}

/**
 * POST 教学周历页面（用于获取指定学期的开学日期与最大周次）
 * @param {string} semesterId 形如 "2025-2026-2"
 */
async function requestSemesterDetailPage(semesterId) {
    const response = await fetch(URL_SEMESTER, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `xnxq01id=${semesterId}`,
        credentials: "include"
    });
    return await response.text();
}

/**
 * POST 课表页面（用于获取课程数据）
 * @param {string} semesterId 形如 "2025-2026-2"
 */
async function requestCoursePage(semesterId) {
    const response = await fetch(URL_COURSE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `jx0404id=&cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
        credentials: "include"
    });
    return await response.text();
}

/**
 * GET 执行计划页面（用于获取课程对应的学分）
 */
async function requestPlanPage() {
    const response = await fetch(URL_PLAN, {
        method: "GET",
        credentials: "include"
    });
    return await response.text();
}

/**
* GET 辅修执行计划页面（用于获取课程对应的学分）
*/
async function requestFxFPlanPage() {
    const response = await fetch(URL_FXPLAN, {
        method: "GET",
        credentials: "include"
    });
    return await response.text();
}

/**
* GET 微专业执行计划页面（用于获取课程对应的学分）
*/
async function requestWZYPlanPage() {
    const response = await fetch(URL_WZYPLAN, {
        method: "GET",
        credentials: "include"
    });
    return await response.text();
}

// 业务逻辑

/**
 * 获取学期列表，以 selected 为原点上下各取 3 个
 * @returns {Promise<{list: Array<{value:string,label:string}>, defaultIndex:number}>}
 */
async function fetchSemesterList() {
    const html = await requestSemesterPage();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const select = doc.getElementById("xnxq01id");
    if (!select) return { list: [], defaultIndex: -1 };

    const allOptions = Array.from(select.querySelectorAll("option")).map(opt => ({
        value: opt.value,
        label: opt.textContent.trim(),
        selected: opt.hasAttribute("selected")
    }));

    let selectedIndex = allOptions.findIndex(o => o.selected);
    if (selectedIndex === -1) selectedIndex = 0;

    const start = Math.max(0, selectedIndex - 3);
    const end = Math.min(allOptions.length, selectedIndex + 4);

    const list = allOptions.slice(start, end);
    const defaultIndex = selectedIndex - start;

    return { list, defaultIndex };
}

/**
 * 获取指定学期的开学日期 + 最大周次
 * @param {string} semesterId 形如 "2025-2026-2"
 * @returns {Promise<{startDate: string|null, totalWeeks: number|null}>}
 */
async function fetchSemesterInfo(semesterId) {
    const html = await requestSemesterDetailPage(semesterId);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const timetable = doc.getElementById("kbtable");
    if (!timetable) return { startDate: null, totalWeeks: null };

    const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    if (rows.length === 0) return { startDate: null, totalWeeks: null };

    const firstDateCell = rows[0].querySelector("td[title]");
    const title = firstDateCell?.getAttribute("title") || "";
    const match = title.match(/^(\d{4})年(\d{2})月(\d{2})$/);
    const startDate = match ? `${match[1]}-${match[2]}-${match[3]}` : null;

    // 最大周次：所有行第一个 td 中能解析为整数的最大值
    let totalWeeks = null;
    for (const row of rows) {
        const firstTd = row.querySelector("td");
        if (!firstTd) continue;
        const n = parseInt(firstTd.textContent.trim(), 10);
        if (!isNaN(n) && n > 0) {
            if (totalWeeks === null || n > totalWeeks) totalWeeks = n;
        }
    }

    return { startDate, totalWeeks };
}

/**
 * 获取并解析指定学期的课程
 * @param {string} semesterId 形如 "2025-2026-2"
 * @returns {Promise<Array<Object>>}
 */
async function fetchCourses(semesterId) {
    const courseCredits = await fetchAllCourseCredits();
    const html = await requestCoursePage(semesterId);
    return parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"), courseCredits);
}

/**
 * 获取执行计划里所有课程对应的学分
 * 部分限选、任选课的学分信息暂时无法获取
 * @returns {Promise<Object>} 课程名称 -> 学分
 */
async function fetchAllCourseCredits() {

    const courseCredits = {}; // 存储所有课程的学分信息

    // 依次获取三个执行计划表的学分信息
    const requestFns = [
        requestPlanPage,
        requestFxFPlanPage,
        requestWZYPlanPage
    ];

    for (const requestFn of requestFns) {
        const html = await requestFn();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const dataTable = doc.getElementById("dataList");

        const rows = Array.from(dataTable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

        // 如果rows的第一项内容只有“未查询到数据”文本，说明没有数据，跳过后续处理
        if (rows[0].querySelector('td').textContent.trim() === "未查询到数据") {
            continue;
        }

        rows.forEach((row) => {

            // 每一行的第四个单元格是课程名称，第六个单元格是学分
            const courseName = row.querySelector('td:nth-child(4)').textContent.trim();
            const credit = row.querySelector('td:nth-child(6)').textContent.trim();
            if (courseName && !(courseName in courseCredits)) {
                courseCredits[courseName] = parseFloat(credit);
            }
        });
    }

    return courseCredits;

}

/**
 * 获取某课程的学分
 * @param {string} courseName 课程名称 
 * @param {Object} courseCredits 学分信息对象
 * @returns {Promise<number|null>}
 */
async function fetchCourseCredit(courseName, courseCredits) {
    if (courseName in courseCredits) {
        return courseCredits[courseName];
    } else {
        window.shiguangBridge.showToast(`${courseName}的学分信息未找到！`);
        return null;
    }
}



// 配置保存

async function saveAppConfig(semesterStartDate, totalWeeks) {
    const config = {
        "semesterTotalWeeks": totalWeeks || 20,
        "firstDayOfWeek": 1,
        "defaultClassDuration": 50
    };
    if (semesterStartDate) {
        config.semesterStartDate = semesterStartDate;
    }
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 统一作息
 */
async function saveAppTimeSlots(semesterId) {
    // 基础时间段
    const baseTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:50" },
        { "number": 2, "startTime": "09:00", "endTime": "09:50" },
        { "number": 3, "startTime": "10:10", "endTime": "11:00" },
        { "number": 4, "startTime": "11:10", "endTime": "12:00" },
        { "number": 5, "startTime": "13:10", "endTime": "14:00" },
        { "number": 6, "startTime": "14:00", "endTime": "14:50" },
        { "number": 7, "startTime": "15:00", "endTime": "15:50" },
        { "number": 8, "startTime": "16:00", "endTime": "16:50" },
        { "number": 9, "startTime": "17:00", "endTime": "17:50" },
        { "number": 10, "startTime": "17:50", "endTime": "18:30" },
        { "number": 11, "startTime": "19:00", "endTime": "19:50" },
        { "number": 12, "startTime": "20:00", "endTime": "20:50" },
        { "number": 13, "startTime": "21:00", "endTime": "21:50" }
    ];

    // 创建当前学期的组合作息方案。注：T2时段（第10节）仅供参考（因为我没上过且没找到官方具体时间）
    // 根据semesterId获取此学期的信息
    const [startYear, endYear, semester] = semesterId.split("-");
    let comboSchedule = null;
    if (semester === "1") {
        // 秋冬学期
        comboSchedule = {
            name: `${startYear}秋组合作息方案`,
            publicSchedules: [
                {
                    name: `${startYear}春夏作息`,
                    startDate: `${startYear}-05-01`,
                    endDate: `${startYear}-09-30`,
                    timeSlots: [
                        { "number": 5, "startTime": "13:10", "endTime": "14:00" },
                        { "number": 6, "startTime": "14:00", "endTime": "14:50" },
                        { "number": 7, "startTime": "15:00", "endTime": "15:50" },
                        { "number": 8, "startTime": "16:00", "endTime": "16:50" },
                        { "number": 9, "startTime": "17:00", "endTime": "17:50" },
                        { "number": 10, "startTime": "17:50", "endTime": "18:30" },
                        { "number": 11, "startTime": "19:00", "endTime": "19:50" },
                        { "number": 12, "startTime": "20:00", "endTime": "20:50" },
                        { "number": 13, "startTime": "21:00", "endTime": "21:50" }
                    ]
                },
                {
                    name: `${startYear}秋冬作息`,
                    startDate: `${startYear}-10-01`,
                    endDate: `${endYear}-04-30`,
                    timeSlots: [
                        { "number": 5, "startTime": "12:40", "endTime": "13:30" },
                        { "number": 6, "startTime": "13:30", "endTime": "14:20" },
                        { "number": 7, "startTime": "14:30", "endTime": "15:20" },
                        { "number": 8, "startTime": "15:30", "endTime": "16:20" },
                        { "number": 9, "startTime": "16:30", "endTime": "17:20" },
                        { "number": 10, "startTime": "17:20", "endTime": "18:00" },
                        { "number": 11, "startTime": "18:30", "endTime": "19:20" },
                        { "number": 12, "startTime": "19:30", "endTime": "20:20" },
                        { "number": 13, "startTime": "20:30", "endTime": "21:20" }
                    ]
                }
            ]
        };
    } else if (semester === "2") {
        // 春夏学期
        comboSchedule = {
            name: `${endYear}春组合作息方案`,
            publicSchedules: [
                {
                    name: `${startYear}秋冬作息`,
                    startDate: `${startYear}-10-01`,
                    endDate: `${endYear}-04-30`,
                    timeSlots: [
                        { "number": 5, "startTime": "12:40", "endTime": "13:30" },
                        { "number": 6, "startTime": "13:30", "endTime": "14:20" },
                        { "number": 7, "startTime": "14:30", "endTime": "15:20" },
                        { "number": 8, "startTime": "15:30", "endTime": "16:20" },
                        { "number": 9, "startTime": "16:30", "endTime": "17:20" },
                        { "number": 10, "startTime": "17:20", "endTime": "18:00" },
                        { "number": 11, "startTime": "18:30", "endTime": "19:20" },
                        { "number": 12, "startTime": "19:30", "endTime": "20:20" },
                        { "number": 13, "startTime": "20:30", "endTime": "21:20" }
                    ]
                },
                {
                    name: `${endYear}春夏作息`,
                    startDate: `${endYear}-05-01`,
                    endDate: `${endYear}-09-30`,
                    timeSlots: [
                        { "number": 5, "startTime": "13:10", "endTime": "14:00" },
                        { "number": 6, "startTime": "14:00", "endTime": "14:50" },
                        { "number": 7, "startTime": "15:00", "endTime": "15:50" },
                        { "number": 8, "startTime": "16:00", "endTime": "16:50" },
                        { "number": 9, "startTime": "17:00", "endTime": "17:50" },
                        { "number": 10, "startTime": "17:50", "endTime": "18:30" },
                        { "number": 11, "startTime": "19:00", "endTime": "19:50" },
                        { "number": 12, "startTime": "20:00", "endTime": "20:50" },
                        { "number": 13, "startTime": "21:00", "endTime": "21:50" }
                    ]
                }
            ]
        };
    }

    // 保存作息方案
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(baseTimeSlots));
        await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(comboSchedule));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("作息方案导入失败: " + error.message);
        return false;
    }
}

// 流程编排

async function runImportFlow() {
    try {
        // 1. 用户确认
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示", "请确保已成功登录教务系统。是否开始导入？", "开始"
        );
        if (!confirmed) return;

        // 2. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期列表...");
        const { list: semesters, defaultIndex } = await fetchSemesterList();
        if (!semesters || semesters.length === 0) {
            window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
            return;
        }

        // 3. 用户选择学期
        const labels = semesters.map(s => s.label);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(labels), defaultIndex
        );
        if (selectedIndex === null) return;
        const semesterId = semesters[selectedIndex].value;

        // 4. 获取开学日期
        window.shiguangBridge.showToast("正在获取学期信息...");
        const { startDate: semesterStartDate, totalWeeks } = await fetchSemesterInfo(semesterId);

        // 5. 获取课程
        window.shiguangBridge.showToast("正在请求课程数据...");
        const finalCourses = await fetchCourses(semesterId);
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        // 6. 保存配置（含开学日期 + 最大周次（最大限制为 20））/ 作息 / 课程
        await saveAppConfig(semesterStartDate, Math.min(totalWeeks, 20));
        await saveAppTimeSlots(semesterId);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        // 7. 完成
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动
runImportFlow();