// 广东交通职业技术学院(gdcp.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请联系开发者或者提交pr更改,这更加快速

const BASE_URL = "https://jw.gdcp.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;   // 教学周历（学期列表 + 开学日期 + 最大周次）
const URL_COURSE   = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; // 课表查询

//  公共变量与校区基准作息定义

// 1. 抽取全校通用的 5-12 节下午及晚上基准作息（所有校区完全一致）
const COMMON_AFTERNOON_EVENING_SLOTS = [
    { "number": 5,  "startTime": "14:15", "endTime": "14:55" },
    { "number": 6,  "startTime": "15:00", "endTime": "15:40" },
    { "number": 7,  "startTime": "15:55", "endTime": "16:35" },
    { "number": 8,  "startTime": "16:35", "endTime": "17:15" },
    { "number": 9,  "startTime": "18:05", "endTime": "18:45" },
    { "number": 10, "startTime": "18:45", "endTime": "19:25" },
    { "number": 11, "startTime": "19:40", "endTime": "20:20" },
    { "number": 12, "startTime": "20:20", "endTime": "21:00" }
];

// 2. 各校区配置
const CAMPUS_LIST = [
    {
        index: 0,
        name: "天河校区",  // 9号楼、10号楼、12号楼、图书馆、公路楼、汽车实训楼
        timeSlots: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:10", "endTime": "10:50" },
            { "number": 4, "startTime": "10:55", "endTime": "11:35" },
            ...COMMON_AFTERNOON_EVENING_SLOTS
        ]
    },
    {
        index: 1,
        name: "花都校区",   // 10号楼、15号楼、16号楼、运动场
        timeSlots: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:30", "endTime": "11:10" },
            { "number": 4, "startTime": "11:15", "endTime": "11:55" },
            ...COMMON_AFTERNOON_EVENING_SLOTS
        ]
    },
    {
        index: 2,
        name: "国际校区",   // 教学楼、运动场
        timeSlots: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:10", "endTime": "10:50" },
            { "number": 4, "startTime": "10:55", "endTime": "11:35" },
            ...COMMON_AFTERNOON_EVENING_SLOTS
        ]
    },
    {
        index: 3,
        name: "清远校区",   // 厚德楼（14#）、明德楼（15#）、立业楼（16#）、创新楼（17#）、求是楼（18#）、笃实楼（19#）
        timeSlots: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:10", "endTime": "10:50" },
            { "number": 4, "startTime": "10:55", "endTime": "11:35" },
            ...COMMON_AFTERNOON_EVENING_SLOTS
        ]
    }
];

/**
 * 根据校区索引获取对应的基准作息时间段
 * @param {number} campusIndex 校区索引
 */
function getTimeSlotsByIndex(campusIndex) {
    const campus = CAMPUS_LIST.find(c => c.index === campusIndex);
    return campus ? campus.timeSlots : CAMPUS_LIST[0].timeSlots;
}

/**
 * 通用错峰注入逻辑：命中错峰时间表的节次端点用错峰时间，未命中的端点读该校区基准作息
 * @param {Object} course 课程对象（会被直接修改）
 * @param {number} campusIndex 校区索引（用于查基准作息）
 * @param {Object<number, {start: string, end: string}>} PEAK 错峰时间表，如 { 3: {...}, 4: {...} }
 */
function applyPeakOverride(course, campusIndex, PEAK) {
    if (!course.startSection || !course.endSection) return;

    // 读取该校区基准作息，转成 节次 -> {start, end} 映射
    const baseSlots = {};
    getTimeSlotsByIndex(campusIndex).forEach(slot => {
        baseSlots[slot.number] = { start: slot.startTime, end: slot.endTime };
    });

    const s = course.startSection, e = course.endSection;
    // 至少一个端点命中错峰表才处理，两端都不命中则不修改
    if (PEAK[s] || PEAK[e]) {
        const startStr = PEAK[s] ? PEAK[s].start : (baseSlots[s] ? baseSlots[s].start : null);
        const endStr   = PEAK[e] ? PEAK[e].end   : (baseSlots[e] ? baseSlots[e].end   : null);
        if (startStr && endStr) {
            course.isCustomTime = true;
            course.customStartTime = startStr;
            course.customEndTime = endStr;
        }
    }
}

/**
 * 核心：各校区特殊错峰教室/教学楼的微调函数
 * 在课程合并去重完成后执行，基于校区索引与教室（position）精准注入自定义时间
 * @param {Array<Object>} courses 合并去重后的课程数组
 * @param {number} campusIndex 校区索引
 */
function applyCampusSpecialSchedule(courses, campusIndex) {
    return courses.map(course => {
        const pos = course.position || "";

        // 各校区错峰时间表（都是 3、4 节，只是时间不同）
        const PEAK_TABLES = {
            0: { // 天河校区：2号楼、运动场 3节 10:20~11:05，4节 11:10~11:55
                3: { start: "10:30", end: "11:10" },
                4: { start: "11:15", end: "11:55" }
            },
            1: { // 花都校区：1号楼、图书馆 3节 10:00~10:45，4节 10:50~11:35
                3: { start: "10:10", end: "10:50" },
                4: { start: "10:55", end: "11:35" }
            },
            2: { // 国际校区：教学楼外其他区域 3节 10:20~11:05，4节 11:10~11:55
                3: { start: "10:30", end: "11:10" },
                4: { start: "11:15", end: "11:55" }
            },
            3: { // 清远校区：融新楼、融创楼、运动场、体育馆 3节 10:40~11:25，4节 11:30~12:15
                3: { start: "10:30", end: "11:10" },
                4: { start: "11:15", end: "11:55" }
            }
        };

        // 各校区错峰地点匹配规则（返回 true 表示走错峰时间）
        const PEAK_ROOM_MATCHERS = {
            // 天河校区：教室格式如 厚德楼（14#）-503，匹配括号内 # 前数字为 2 的楼栋，以及操场
            0: pos => {
                const m = pos.match(/[(（](\d+)#[)）]/);
                return (m && m[1] === "2") || pos.includes("操场");
            },
            // 花都校区：教室格式如 1-404、15-3楼计算机综合应用实训室-1，
            // 取第一个 "-" 前面的编号匹配楼栋（1 = 1号楼），图书馆无编号直接文字匹配
            1: pos => pos.split("-")[0].trim() === "1" || pos.includes("图书馆"),
            // 国际校区：操场和教学楼走基准作息（数字-数字格式如 2-604、15-3），其他区域走错峰
            2: pos => !/\d+-\d+/.test(pos) && !pos.includes("操场"),
            // 清远校区：教室格式如 融新楼（12#）-503、融创楼（13#）C座-502_公共机房-8室，
            // 匹配括号内 # 前数字为 12 或 13 的楼栋，以及操场、体育馆
            3: pos => {
                const m = pos.match(/[(（](\d+)#[)）]/);
                return (m && (m[1] === "12" || m[1] === "13")) ||
                    pos.includes("操场") || pos.includes("体育馆");
            }
        };



        const peak = PEAK_TABLES[campusIndex];
        const matcher = PEAK_ROOM_MATCHERS[campusIndex];

        // 该校区配置了错峰规则、地点命中、且有对应错峰时间表时才处理
        if (peak && matcher && matcher(pos)) {
            applyPeakOverride(course, campusIndex, peak);
        }

        return course;
    });
}


// 工具函数

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const parenMatch = weekStr.match(/\(([^)]*)\)/);
    const paren = parenMatch ? parenMatch[1] : '';
    const isOdd = paren === '单周';
    const isEven = paren === '双周';
    const pureWeekData = weekStr.split('(')[0];
    pureWeekData.split(',').forEach(seg => {
        if (seg.includes('-')) {
            const [s, e] = seg.split('-').map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = s; i <= e; i++) {
                    if (isOdd && i % 2 === 0) continue;
                    if (isEven && i % 2 === 1) continue;
                    weeks.push(i);
                }
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
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const grouped = {};
    courses.forEach(c => {
        const name = c.name || '';
        const teacher = c.teacher || '';
        const position = c.position || '';
        const day = c.day || 0;
        
        const key = `${day}|${name}|${teacher}|${position}`;
        
        if (!grouped[key]) {
            grouped[key] = {
                name, teacher, position, day,
                weeksMap: {}
            };
        }
        
        const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
        weeksArr.forEach(w => {
            if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
            grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
        });
    });

    const finalResult = [];

    Object.values(grouped).forEach(group => {
        const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);
        const processedWeeksMap = {};
        
        sortedWeeks.forEach(w => {
            let parts = group.weeksMap[w];
            parts.sort((a, b) => a.start - b.start || a.end - b.end);
            
            const mergedParts = [];
            let cur = parts[0];
            for (let i = 1; i < parts.length; i++) {
                if (cur.end + 1 >= parts[i].start) {
                    cur.end = Math.max(cur.end, parts[i].end);
                } else {
                    mergedParts.push(cur);
                    cur = parts[i];
                }
            }
            mergedParts.push(cur);
            processedWeeksMap[w] = mergedParts;
        });

        const sectionsMap = {};
        sortedWeeks.forEach(w => {
            const parts = processedWeeksMap[w];
            const sig = parts.map(p => `${p.start}-${p.end}`).join('|');
            
            if (!sectionsMap[sig]) {
                sectionsMap[sig] = { sections: parts, weeks: [] };
            }
            sectionsMap[sig].weeks.push(w);
        });

        Object.values(sectionsMap).forEach(secGroup => {
            secGroup.sections.forEach(sec => {
                finalResult.push({
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection: sec.start,
                    endSection: sec.end,
                    weeks: secGroup.weeks
                });
            });
        });
    });

    finalResult.sort((a, b) => {
        return (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               a.name.localeCompare(b.name) ||
               a.weeks[0] - b.weeks[0];
    });

    return finalResult;
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

        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDivs = cell.querySelectorAll('div.kbcontent[style*="none"]');

            detailDivs.forEach(detailDiv => {
                const rawHtml = detailDiv.innerHTML.trim();
                if (rawHtml === "" || rawHtml === "&nbsp;") return;

                const courseBlocks = rawHtml.split(/-{10,}/);

                courseBlocks.forEach(block => {
                    if (block.replace(/&nbsp;|<br\/?>/g, '').trim() === "") return;

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    const nameFont = tempDiv.querySelector('font:not([title]):not([name])');
                    const name = nameFont ? nameFont.textContent.trim() : "";

                    const teacherRaw = tempDiv.querySelector('font[title="教师"]')?.innerText || "未知教师";
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
            });
        });
    });

    return mergeAndDistinctCourses(results);
}

// 网络请求封装

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
        body: `xnxq01id=${semesterId}`,
        credentials: "include"
    });
    return await response.text();
}

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
 * 弹窗让用户选择校区，并返回选中的校区索引（index）
 */
async function selectCampusIndex() {
    const campusNames = CAMPUS_LIST.map(c => c.name);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区", JSON.stringify(campusNames), -1
    );
    if (selectedIndex === null) return null;
    return selectedIndex;
}

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

async function fetchCourses(semesterId, campusIndex) {
    const html = await requestCoursePage(semesterId);
    const doc = new DOMParser().parseFromString(html, "text/html");
    
    // 1. 基础解析与合并去重
    let courses = parseTimetableToModel(doc);
    
    // 2. 基于校区索引匹配并注入各校区各教学楼的特殊错峰自定义时间
    courses = applyCampusSpecialSchedule(courses, campusIndex);
    
    return courses;
}

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

async function saveAppTimeSlots(campusIndex) {
    const slots = getTimeSlotsByIndex(campusIndex);
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

// 流程编排

async function runImportFlow() {
    try {
        // 1. 用户确认
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示", "请确保已成功登录教务系统。是否开始导入？", "开始"
        );
        if (!confirmed) return;

        // 2. 选择校区（返回纯数字索引）
        const campusIndex = await selectCampusIndex();
        if (campusIndex === null) return;
        const currentCampus = CAMPUS_LIST.find(c => c.index === campusIndex);

        // 3. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期列表...");
        const { list: semesters, defaultIndex } = await fetchSemesterList();
        if (!semesters || semesters.length === 0) {
            window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
            return;
        }

        // 4. 用户选择学期
        const labels = semesters.map(s => s.label);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(labels), defaultIndex
        );
        if (selectedIndex === null) return;
        const semesterId = semesters[selectedIndex].value;

        // 5. 获取开学日期 + 最大周次
        window.shiguangBridge.showToast("正在获取学期信息...");
        const { startDate: semesterStartDate, totalWeeks } = await fetchSemesterInfo(semesterId);

        // 6. 获取并处理课程（包含合并去重与按校区索引匹配特殊作息教室）
        window.shiguangBridge.showToast("正在请求与处理课程数据...");
        const finalCourses = await fetchCourses(semesterId, campusIndex);
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        // 7. 保存配置 / 对应校区基准作息 / 课程数据
        await saveAppConfig(semesterStartDate, totalWeeks);
        await saveAppTimeSlots(campusIndex);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        // 8. 完成
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程（${currentCampus.name}）`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动导入流程
runImportFlow();