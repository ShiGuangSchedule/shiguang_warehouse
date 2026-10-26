// 新疆工程学院(xjie.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速


const BASE_URL = "https://jwxt.xjie.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;   // 教学周历（学期列表 + 开学日期 + 最大周次）
const URL_COURSE   = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; // 课表查询

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
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

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

function parseTimetableToModel(doc) {
    const timetable = doc.getElementById('timetable');
    if (!timetable) return [];

    const results = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).slice(1);

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) return;

        // 遍历周一到周日
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDiv = cell.querySelector('div.kbcontent[style*="none"]');

            if (detailDiv) {
                const rawHtml = detailDiv.innerHTML.trim();
                if (rawHtml === "" || rawHtml === "&nbsp;") return;

                // 拆分可能存在的多个课程块
                const courseBlocks = rawHtml.split(/---------------------|----------------------/);

                courseBlocks.forEach(block => {
                    if (block.replace(/&nbsp;|<br\/?>/g, '').trim() === "") return;

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    // 提取课程名
                    let name = "";
                    for (let node of tempDiv.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        } else if (node.tagName === "BR" && name !== "") {
                            break;
                        } else if (node.nodeType === 3) {
                            name += node.textContent.trim();
                        }
                    }

                    // 提取教师、周次(节次)、地点
                    const teacherRaw = tempDiv.querySelector('font[title="教师"], font[title="老师"]')?.innerText || "未知教师";
                    const teacher = teacherRaw.replace("任课教师:", "").trim();
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText || "";
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText || "未知地点";

                    let startSection = 0, endSection = 0;
                    if (weekStr) {
                        const secMatch = weekStr.match(/\[([\d\-,\s]+?)节\]/);
                        if (secMatch && secMatch[1]) {
                            const nums = secMatch[1]
                                .split(/[^\d]+/)
                                .map(Number)
                                .filter(n => !isNaN(n) && n > 0);
                            if (nums.length > 0) {
                                startSection = Math.min(...nums);
                                endSection = Math.max(...nums);
                            }
                        }
                    }

                    if (name && weekStr && startSection > 0) {
                        results.push({
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
            }
        });
    });

    return mergeAndDistinctCourses(results);
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
    const html = await requestCoursePage(semesterId);
    return parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));
}

// 配置保存

async function saveAppConfig(semesterStartDate, totalWeeks) {
    const config = {
        "semesterTotalWeeks": totalWeeks || 20,
        "firstDayOfWeek": 1
    };
    if (semesterStartDate) {
        config.semesterStartDate = semesterStartDate;
    }
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 统一作息（新疆工程学院）
 */
async function saveAppTimeSlots() {
    const unifiedSlots = [
        { "number": 1,  "startTime": "10:00", "endTime": "10:45" },
        { "number": 2,  "startTime": "10:55", "endTime": "11:40" },
        { "number": 3,  "startTime": "11:55", "endTime": "12:40" },
        { "number": 4,  "startTime": "12:50", "endTime": "13:35" },
        { "number": 5,  "startTime": "13:45", "endTime": "14:30" },
        { "number": 6,  "startTime": "16:00", "endTime": "16:45" },
        { "number": 7,  "startTime": "16:55", "endTime": "17:40" },
        { "number": 8,  "startTime": "17:55", "endTime": "18:40" },
        { "number": 9,  "startTime": "18:50", "endTime": "19:35" },
        { "number": 10, "startTime": "19:50", "endTime": "20:35" },
        { "number": 11, "startTime": "20:45", "endTime": "21:30" }
    ];

    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(unifiedSlots));
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

        // 4. 获取开学日期 + 最大周次
        window.shiguangBridge.showToast("正在获取学期信息...");
        const { startDate: semesterStartDate, totalWeeks } = await fetchSemesterInfo(semesterId);

        // 5. 获取课程
        window.shiguangBridge.showToast("正在请求课程数据...");
        const finalCourses = await fetchCourses(semesterId);
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        // 6. 保存配置（含开学日期 + 最大周次）/ 作息 / 课程
        await saveAppConfig(semesterStartDate, totalWeeks);
        await saveAppTimeSlots();
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        // 7. 完成
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动导入流程
runImportFlow();