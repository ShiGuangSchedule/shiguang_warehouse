/**
 * 广东海洋大学教务课表导入适配
 * @date 2026-08-27
 * @author Mccurtain
 * @version 2.2
 * 
 * 特别鸣谢 @mei-iem 提供真机实测
 * 
 */

(function () {

// ==================== 常量 ====================

// 特殊作息（指定楼/室外场地作息）匹配规则：
// 前提：节次处于特殊时间段（3-4、7-8 节，见 SPECIAL_TIME_BLOCKS）；
// 上课地点命中以下任意一种情况即打标特殊时间：
//   1. 楼名包含匹配（venues，如 "实验楼" 命中 "实验楼301"、"网球场（实验楼东面）"），
//      另支持简写正则（venuePatterns，如海滨 "实"+房间号 = 实验楼简写，实506-1计算机（2）室）；
//   2. 含方位词（东面/南面/西面/北面，如 "XX（实验楼东面）"）；
//   3. 含运动场（"场"字，覆盖 网球场/匹克场/足球场/篮球场/田径场 等各类场地）。
// 均未命中的其他教室（教学楼等）使用 TimeSlots 全校统一作息。
const CAMPUS_CONFIGS = [
    {
        id: "huguang",
        label: "湖光校区",
        venues: ["广学楼", "明德楼"],
        venuePatterns: [],
        outdoorKeywords: []
    },
    {
        id: "haibin",
        label: "海滨校区",
        venues: ["实验楼"],
        venuePatterns: [{ name: "实验楼简写", pattern: /^实\d/ }],
        // 室外场地关键词："场"通用覆盖 网球场/篮球场/排球场/匹克场/田径场 等各类场地（含简写）；
        // 方向词覆盖 "XX（实验楼东面）" 这类括号方位写法
        outdoorKeywords: ["场", "东面", "南面", "西面", "北面"]
    }
];

// 全校统一作息时间（1-10 节），未指定特殊作息的教室使用
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:00", endTime: "09:45" },
    { number: 3, startTime: "10:15", endTime: "11:00" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:20", endTime: "18:05" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

// 指定楼/室外场地的特殊作息时间块（连堂）
const SPECIAL_TIME_BLOCKS = [
    { startSection: 3, endSection: 4, startTime: "10:05", endTime: "11:35" },
    { startSection: 7, endSection: 8, startTime: "16:25", endTime: "17:50" }
];

// ==================== 解析函数 ====================

/**
 * 将周次字符串展开为具体周次数组
 * 支持范围（如 1-16周）、单周（如 6周）、单双周（如 1-8周(单)）、
 * 以及逗号分隔的多种写法混合，全角逗号也会被兼容
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const groups = String(weekStr).replace(/，/g, ',').split(',');
    const weeks = [];

    for (const group of groups) {
        const item = group.trim();

        // 先尝试匹配 "起-止周"，再尝试匹配单个周次
        // 兼容"第1-8周"、"1-8周"、"第3周"、"3周"格式
        const rangeMatch = item.match(/第?(\d+)\s*-\s*(\d+)\s*周?/);
        const singleMatch = item.match(/第?(\d+)\s*周?/);

        let start = 0;
        let end = 0;
        let matched = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            matched = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            matched = true;
        }

        if (matched && start >= 1 && end >= start) {
            const isOddOnly = item.includes('(单)');
            const isEvenOnly = item.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isOddOnly && w % 2 === 0) continue; // 单周：跳过偶数周
                if (isEvenOnly && w % 2 !== 0) continue; // 双周：跳过奇数周
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析节次字段，如 "1-2"、"3"、"1-2节"，得到起止节次
 * 格式无法识别或数值不合法时返回 null
 */
function parseSectionRange(sectionStr) {
    const text = sectionStr == null ? '' : String(sectionStr);
    const match = text.match(/^\s*(?:第)?(\d+)\s*(?:-\s*(\d+))?\s*节?\s*$/);

    if (!match) return null;

    const startSection = Number(match[1]);
    const endSection = Number(match[2] || match[1]);

    if (!Number.isInteger(startSection) || !Number.isInteger(endSection) ||
        startSection < 1 || endSection < startSection) {
        return null;
    }

    return { startSection, endSection };
}

// 提前公选课课程名
function normalizeCourseName(rawName) {
    const name = String(rawName).trim();
    if (!name) return name;

    const match = name.match(/^[（(]([^（）()]+)[）)]\s*/);
    if (!match) return name;

    const rest = name.slice(match[0].length);
    if (!rest) return name;

    return `${rest}(${match[1]})`;
}

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 规范化数据，周次统一排序，便于比较
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 第一步：按课程、周次排序后合并连续节次，同时剔除完全重复项
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    const step1 = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourse =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        if (isSameCourse && current.endSection + 1 === next.startSection) {
            // 节次紧邻，延长结束节次：1-2 节 + 3-4 节 -> 1-4 节
            current.endSection = next.endSection;
        } else if (isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection) {
            // 完全重复的记录，跳过
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    // 第二步：按课程、节次排序后合并相同节次的周次
    step1.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const step2 = [];
    let cur = step1[0];

    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];

        const isSameSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameSection) {
            // 周次取并集：1-8 周 + 9-16 周 -> 1-16 周
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);

    return step2;
}

// ==================== 特殊作息处理 ====================

/**
 * 判断位置是否命中特殊场地（指定楼或室外场地），返回命中的类型与关键词
 * 楼名与室外关键词取并集，包含任一即可；命中者打标特殊作息
 * @returns {{type: 'venue'|'outdoor', key: string}|null}
 */
function matchesSpecialVenue(positionText, campusConfig) {
    const venueHit = campusConfig.venues.find(venue => positionText.includes(venue));
    if (venueHit) return { type: 'venue', key: venueHit };
    const patternHit = (campusConfig.venuePatterns || []).find(p => p.pattern.test(positionText));
    if (patternHit) return { type: 'venue', key: patternHit.name };
    const outdoorHit = campusConfig.outdoorKeywords.find(keyword => positionText.includes(keyword));
    if (outdoorHit) return { type: 'outdoor', key: outdoorHit };
    return null;
}

/**
 * 判断课程是否命中特殊作息（正向策略）
 * 命中指定楼/室外场地的课程，在节次恰为特殊时间块（3-4/7-8 节）时打标特殊时间；
 * 其他普通教室不打标，使用 TimeSlots 全校统一作息。
 * 返回对象附带 reason 判定原因，供内部诊断与本地验证脚本使用（不写入导出课程）。
 */
function getCustomTime(position, startSection, endSection, campusConfig) {
    const positionText = position == null ? '' : String(position);
    const hit = matchesSpecialVenue(positionText, campusConfig);
    if (!hit) return { marked: false, reason: 'no-block' };

    const block = SPECIAL_TIME_BLOCKS.find(
        b => b.startSection === startSection && b.endSection === endSection
    );
    if (block) return { marked: true, startTime: block.startTime, endTime: block.endTime, reason: `special-${hit.type}:${hit.key}` };
    return { marked: false, reason: `special-${hit.type}:${hit.key}-no-block` };
}

// ==================== 数据解析 ====================

/**
 * 解析正方 v9 课表接口返回的 JSON，提取有效课程
 * 数据位于 kbList 字段；课程名/星期/节次/周次缺失或不合法的记录会被跳过，
 * 教师、教室允许为空
 */
function parseJsonData(jsonData, campusConfig) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];

    const courses = [];

    for (const raw of jsonData.kbList) {
        if (!raw || typeof raw !== 'object') continue;
        if (!raw.kcmc || raw.xqj == null || raw.jcs == null || raw.zcd == null) continue;

        const weeks = parseWeeks(raw.zcd);
        if (weeks.length === 0) continue;

        const sectionRange = parseSectionRange(raw.jcs);
        if (!sectionRange) continue;

        const day = Number(raw.xqj); // 1=周一 ... 7=周日
        if (isNaN(day) || day < 1 || day > 7) continue;

        // 直接基于原始接口字段 cdmc 构造课程位置
        const position = raw.cdmc == null ? '' : String(raw.cdmc).trim();

        const course = {
            name: normalizeCourseName(raw.kcmc),
            teacher: raw.xm == null ? '' : String(raw.xm).trim(),
            position,
            day,
            startSection: sectionRange.startSection,
            endSection: sectionRange.endSection,
            weeks
        };

        // 边解析边判断：直接对原始教室字段 cdmc 判断是否命中特殊作息，
        // 命中则在写入课程对象的同时打好 isCustomTime 标记，App 将优先显示自定义时间
        const customTime = getCustomTime(position, course.startSection, course.endSection, campusConfig);
        if (customTime.marked) {
            course.isCustomTime = true;
            course.customStartTime = customTime.startTime;
            course.customEndTime = customTime.endTime;
        }

        courses.push(course);
    }

    const mergedCourses = mergeAndDistinctCourses(courses);

    // 合并可能改变节次区间（如 1-2 节 + 3-4 节 -> 1-4 节），对已打标课程做最终校验：
    // 合并后的区间不再精确命中特殊时间块时，撤销打标，避免特殊时间被错误扩散
    return mergedCourses.map(course => {
        if (!course.isCustomTime) return course;
        const customTime = getCustomTime(course.position, course.startSection, course.endSection, campusConfig);
        if (!customTime.marked) {
            const plain = { ...course };
            delete plain.isCustomTime;
            delete plain.customStartTime;
            delete plain.customEndTime;
            return plain;
        }
        return course;
    });
}

// ==================== 日期工具 ====================

/**
 * 把教务返回的日期字段规范为 yyyy-MM-dd
 * 兼容 "-"、"."、"/" 以及中文"年月日"等分隔写法
 */
function normalizeStartDate(value) {
    const match = String(value || "").match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/**
 * 在校历响应中查找第 1 周开学日期
 * 兼容顶层数组、data/list/rows 等包装对象，以及 zrq/zcrq/rq/ksrq 字段
 */
function findSemesterStartDate(value) {
    if (value == null) return null;

    if (typeof value !== "object") return normalizeStartDate(value);

    if (Array.isArray(value)) {
        const firstWeek = value.find(item =>
            item && typeof item === "object" &&
            (String(item.zs) === "1" || String(item.zsmc) === "1")
        ) || value[0];
        const found = findSemesterStartDate(firstWeek);
        if (found) return found;

        for (const item of value) {
            const date = findSemesterStartDate(item);
            if (date) return date;
        }
        return null;
    }

    for (const field of ["zrq", "zcrq", "rq", "ksrq"]) {
        const date = normalizeStartDate(value[field]);
        if (date) return date;
    }

    for (const item of Object.values(value)) {
        const date = findSemesterStartDate(item);
        if (date) return date;
    }

    return null;
}

// ==================== 接口地址推导 ====================

/**
 * 推导教务系统接口前缀，兼容两条入口通道：
 *   GDOU_01 内网直连：pathname 形如 /kbcx/xskbcx_cxXsgrkb.html                    → 前缀为 ""
 *   反代·拼接态：      pathname 形如 /https://jw.gdou.edu.cn/kbcx/xskbcx_...html   → 前缀为 "/https://jw.gdou.edu.cn"
 *   反代·哈希态：      pathname 形如 /http/<hash>/kbcx/xskbcx_...html              → 前缀为 "/http/<hash>"
 * 以 "/kbcx/" 为锚点即可同时覆盖以上三种情况。
 */
function getScheduleBase() {
    const path = (window.location && window.location.pathname) || "";

    const kbIndex = path.indexOf("/kbcx/");
    if (kbIndex >= 0) return path.slice(0, kbIndex);

    // 兜底：停留在教务系统非课表页（例如首页）时，直接识别反代前缀。
    const proxyPrefix = path.match(/^\/(?:https?:\/\/[^/]+|(?:http|https|https-443)\/[^/]+)/i);
    return proxyPrefix ? proxyPrefix[0] : "";
}

/**
 * 拼接教务系统接口地址，自动带上直连/反代前缀
 * @param {string} modulePath 接口文件名，例如 "xskbcx_cxXsgrkb.html"
 * @param {string} query 可选查询串，例如 "gnmkdm=N2151"
 */
function buildScheduleUrl(modulePath, query) {
    const base = getScheduleBase();
    const queryString = query ? `?${query}` : "";
    return `${window.location.origin}${base}/kbcx/${modulePath}${queryString}`;
}

// ==================== 教务接口 ====================

/**
 * 从 select 元素解析学年和学期选项。
 * 默认索引优先使用当前 select.value，确保跟随用户在页面上的实际选择。
 */
function parseSelectOptions(selectElement) {
    if (!selectElement || typeof selectElement.querySelectorAll !== "function") {
        return { options: [], defaultIndex: 0 };
    }

    const options = [];
    let defaultIndex = 0;
    Array.from(selectElement.querySelectorAll("option")).forEach(option => {
        const value = String(option.value || "").trim();
        if (!value) return;

        const text = String(option.textContent || "").trim() || value;
        if (option.selected) defaultIndex = options.length;
        options.push({ value, text });
    });

    const currentValue = String(selectElement.value || "").trim();
    const currentIndex = options.findIndex(option => option.value === currentValue);
    if (currentIndex !== -1) defaultIndex = currentIndex;

    return { options, defaultIndex };
}

/**
 * 读取课表查询页里的学年/学期下拉选项
 * 成功返回 { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex }；
 * 读取失败返回 null，由调用方回退到默认值
 */
async function fetchAcademicOptions() {
    const url = buildScheduleUrl("xskbcx_cxXskbcxIndex.html", "gnmkdm=N2151&layout=default");

    try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) return null;

        const doc = new DOMParser().parseFromString(await response.text(), "text/html");

        const yearData = parseSelectOptions(doc.querySelector("#xnm"));
        const semesterData = parseSelectOptions(doc.querySelector("#xqm"));
        if (yearData.options.length === 0 || semesterData.options.length === 0) return null;

        return {
            yearOptions: yearData.options,
            semesterOptions: semesterData.options,
            defaultYearIndex: yearData.defaultIndex,
            defaultSemesterIndex: semesterData.defaultIndex
        };
    } catch (e) {
        return null;
    }
}

/**
 * 查询指定学期的周次安排，取出第 1 周的日期作为开学日期，并返回该学期总周数
 * 接口失败时返回 null，不影响主流程
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    const url = buildScheduleUrl("xskbcxZccx_cxZcByXnxq.html", "gnmkdm=N2154");
    const body = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body,
            credentials: "include"
        });

        if (!response.ok) return null;

        const weeks = await response.json();
        if (!Array.isArray(weeks) || weeks.length === 0) return null;

        return {
            startDate: findSemesterStartDate(weeks),
            totalWeeks: weeks.length
        };
    } catch (e) {
        return null;
    }
}

/**
 * 请求课表接口并解析课程，同时并行获取学期信息
 * 成功返回 { courses, config }，失败返回 null
 */
async function fetchAndParseCourses(academicYear, semesterCode, campusConfig) {
    const body = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}&kzlx=ck&xsdm=&kclbdm=`;
    const courseUrl = buildScheduleUrl("xskbcx_cxXsgrkb.html", "gnmkdm=N2151");

    try {
        const [courseResponse, semesterInfo] = await Promise.all([
            fetch(courseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body,
                credentials: "include"
            }),
            fetchSemesterInfo(academicYear, semesterCode)
        ]);

        if (!courseResponse.ok) {
            window.shiguangBridge.showToast(`课表请求失败：HTTP ${courseResponse.status}。如当前不在校园网内，请返回选择“广东海洋大学教务（校外通道）”重试。`);
            return null;
        }

        const courses = parseJsonData(JSON.parse(await courseResponse.text()), campusConfig);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未查询到课表数据，请检查学年/学期选择或登录状态。");
            return null;
        }

        // 总周数取接口返回值与课程最大周次中的较大者，保证不截断课表
        const maxCourseWeek = courses.reduce((max, c) => Math.max(max, ...c.weeks), 0);

        return {
            courses,
            config: {
                semesterStartDate: semesterInfo ? semesterInfo.startDate : null,
                semesterTotalWeeks: Math.max(maxCourseWeek, semesterInfo ? semesterInfo.totalWeeks : 20)
            }
        };
    } catch (e) {
        window.shiguangBridge.showToast("获取课表失败，请确认已登录且网络可访问 jw.gdou.edu.cn；如当前不在校园网内，请返回选择“广东海洋大学教务（校外通道）”重试。");
        return null;
    }
}

// ==================== 交互 ====================

/**
 * 按当前月份推断学年起始年份：9 月及以后属于新学年，其余月份沿用上一学年
 */
function getDefaultAcademicYear(date = new Date()) {
    const currentYear = date.getFullYear();
    return (date.getMonth() >= 8 ? currentYear : currentYear - 1).toString();
}

/**
 * 弹出导入确认提示，说明使用前提
 */
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "广东海洋大学教务系统课表导入",
        "导入前请确认已在浏览器中登录教务系统（jw.gdou.edu.cn）。\n脚本将通过接口直接获取课表，无需停留在特定页面。",
        "好的，开始导入"
    );
}

/**
 * 弹出校区选择框，决定使用哪套特殊作息规则
 * 取消返回 null，由调用方终止流程
 */
async function selectCampus() {
    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(CAMPUS_CONFIGS.map(item => item.label)),
        0
    );
    if (campusIndex === null || campusIndex === -1) return null;
    return CAMPUS_CONFIGS[campusIndex];
}

/**
 * 依次弹出学年、学期选择框
 * 选项优先来自教务系统；若读取失败，则按当前月份给出默认学年，
 * 学期码（3=第一学期，12=第二学期）
 */
async function selectAcademicYearAndSemester() {
    const options = await fetchAcademicOptions();

    let yearOptions;
    let semesterOptions;
    let defaultYearIndex;
    let defaultSemesterIndex;

    if (options) {
        ({ yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = options);
    } else {
        const year = getDefaultAcademicYear();
        const isFirstSemester = new Date().getMonth() >= 8;
        yearOptions = [{ value: year, text: `${year}-${Number(year) + 1}` }];
        semesterOptions = [
            { value: "3", text: "第一学期" },
            { value: "12", text: "第二学期" }
        ];
        defaultYearIndex = 0;
        defaultSemesterIndex = isFirstSemester ? 0 : 1;
        window.shiguangBridge.showToast("未读取到教务系统学年学期选项，已使用默认值，请核对。");
    }

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearOptions.map(item => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map(item => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

// ==================== 保存 ====================

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

/**
 * 将预设作息时间导入 App
 */
async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

// ==================== 主流程 ====================

async function runImportFlow() {
    // 1. 确认导入
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 2. 选择学年学期
    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    // 3. 选择校区（决定特殊作息规则）
    const campusConfig = await selectCampus();
    if (!campusConfig) {
        window.shiguangBridge.showToast("未选择校区，导入流程终止。");
        return;
    }

    // 4. 拉取并解析课程
    const result = await fetchAndParseCourses(selection.academicYear, selection.semesterCode, campusConfig);
    if (result === null) return;
    const { courses, config } = result;

    // 5. 保存课程
    if (!(await saveCourses(courses))) return;

    // 6. 保存课表配置（开学日期、总周数）
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        let msg = `课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`;
        if (config.semesterStartDate) msg += ` 开学日期：${config.semesterStartDate}`;
        window.shiguangBridge.showToast(msg);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    // 7. 导入预设作息时间
    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.showToast(`若课程时间有误，请提交issue或联系开发者！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
})();
