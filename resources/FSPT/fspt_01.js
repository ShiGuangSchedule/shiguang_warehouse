// 佛山职业技术学院(jwgl.fspt.edu.cn) 综合教务管理系统(强智科技) 拾光课程表适配脚本
// 结构参考 YSSDUFE（强智2020前，数据位于 id='kbtable'）
// 登录教务系统后直接点击导入即可，无需先进入课表页面
// 作息时间为硬编码，学校调整作息后请提交 PR 更新 saveAppTimeSlots 中的数据

const BASE_URL = "https://jwgl.fspt.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;   // 教学周历（学期列表 + 开学日期 + 最大周次）
const URL_COURSE   = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; // 课表查询

// 工具函数

/**
 * 解析周次，如 "6-11,13-15周"、"1-17单周"
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const text = weekStr.replace(/\(周\)/g, "").replace(/周/g, "").replace(/\s/g, "");
    text.split(/[,，;；]/).forEach(seg => {
        if (!seg) return;
        const isOdd = /单/.test(seg);
        const isEven = /双/.test(seg);
        const m = seg.match(/(\d+)(?:-(\d+))?/);
        if (!m) return;
        const s = parseInt(m[1], 10);
        const e = m[2] ? parseInt(m[2], 10) : s;
        for (let i = s; i <= e; i++) {
            if (isOdd && i % 2 === 0) continue;
            if (isEven && i % 2 !== 0) continue;
            weeks.push(i);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重函数（来自仓库参考案例）
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

/**
 * 本校的节次写在教室后面，如 "教学楼A-205[01-02]节"，周次里只有 "6-10周"
 */
function parseSectionsFromRoom(roomStr) {
    const m = (roomStr || "").match(/\[([\d\-,，]+)\]\s*节?/);
    if (!m) return { startSection: 0, endSection: 0 };
    const nums = m[1].match(/\d+/g).map(Number);
    return { startSection: nums[0], endSection: nums[nums.length - 1] };
}

function parseTimetableToModel(doc) {
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return [];

    const rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDivs = cell.querySelectorAll('div.kbcontent');

            detailDivs.forEach(div => {
                const rawHtml = div.innerHTML.trim();
                if (!rawHtml || rawHtml === "&nbsp;" || div.textContent.trim().length < 2) return;

                // 同一格多门课之间用 21 个以上的 "-" 分隔（单门课内部的分隔线只有 16 个）
                const blocks = rawHtml.split(/-{18,}/);

                blocks.forEach(block => {
                    if (!block.replace(/<br\s*\/?>/gi, "").trim()) return;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let name = "";
                    for (const node of tempDiv.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        }
                    }

                    const teacher = (tempDiv.querySelector('font[title="老师"], font[title="教师"]')?.textContent || "")
                        .replace("任课教师:", "").trim();
                    const roomRaw = (tempDiv.querySelector('font[title="教室"]')?.textContent || "").trim();
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.textContent || "";

                    const { startSection, endSection } = parseSectionsFromRoom(roomRaw);
                    const position = roomRaw.replace(/\[[^\]]*\]\s*节?/g, "").trim() || "未知地点";
                    const weeks = parseWeeks(weekStr);

                    if (name && startSection > 0 && weeks.length > 0) {
                        rawCourses.push({
                            "name": name,
                            "teacher": teacher || "未知教师",
                            "weeks": weeks,
                            "position": position,
                            "day": day,
                            "startSection": startSection,
                            "endSection": endSection
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
 * @param {string} semesterId 形如 "2026-2027-1"
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
 * @param {string} semesterId 形如 "2026-2027-1"
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
 * @param {string} semesterId 形如 "2026-2027-1"
 * @returns {Promise<{startDate: string|null, totalWeeks: number|null}>}
 */
async function fetchSemesterInfo(semesterId) {
    const html = await requestSemesterDetailPage(semesterId);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const timetable = doc.getElementById("kbtable");
    if (!timetable) return { startDate: null, totalWeeks: null };

    const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    if (rows.length === 0) return { startDate: null, totalWeeks: null };

    // 第一周的周一，title 形如 "2026年08月31"
    const firstDateCell = rows[0].querySelector("td[title]");
    const title = firstDateCell?.getAttribute("title") || "";
    const match = title.match(/^(\d{4})年(\d{2})月(\d{2})/);
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
 * @param {string} semesterId 形如 "2026-2027-1"
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
        "firstDayOfWeek": 1,
        "defaultClassDuration": 40,
        "defaultBreakDuration": 5
    };
    if (semesterStartDate) {
        config.semesterStartDate = semesterStartDate;
    }
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 作息时间（硬编码，2026-2027 学年第一学期）
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1,  "startTime": "08:40", "endTime": "09:20" },
        { "number": 2,  "startTime": "09:25", "endTime": "10:05" },
        { "number": 3,  "startTime": "10:25", "endTime": "11:05" },
        { "number": 4,  "startTime": "11:10", "endTime": "11:50" },
        { "number": 5,  "startTime": "14:00", "endTime": "14:40" },
        { "number": 6,  "startTime": "14:45", "endTime": "15:25" },
        { "number": 7,  "startTime": "15:45", "endTime": "16:25" },
        { "number": 8,  "startTime": "16:30", "endTime": "17:10" },
        { "number": 9,  "startTime": "19:00", "endTime": "19:40" },
        { "number": 10, "startTime": "19:45", "endTime": "20:25" },
        { "number": 11, "startTime": "20:35", "endTime": "21:15" },
        { "number": 12, "startTime": "21:20", "endTime": "22:00" }
    ];

    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
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

// 启动
runImportFlow();
