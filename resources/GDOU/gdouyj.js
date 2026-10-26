/**
 * 广东海洋大学阳江校区教务适配
 * @date 2026-7-30
 * @author Mccurtain (原始 GDOU 适配)
 * @adapted-by Yihe-ng (阳江校区作息与适配)
 * @version 1.2
 *
 * @note 教务系统已关闭外网直连，现行入口为学校提供的零信任地址
 *       （https://wfw.gdou.edu.cn/https://jw.gdou.edu.cn/），校内外均可访问。
 *       接口地址改为运行时推导，
 */

(function () {

/**
 * 节次与周次合并去重函数。
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(course => ({
        ...course,
        name: course.name || '',
        teacher: course.teacher || '',
        position: course.position || '',
        weeks: Array.isArray(course.weeks) ? [...course.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并相同课程、星期、周次下的连续节次和重复记录。
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    const sectionMerged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection &&
            current.endSection === next.endSection;

        if (sameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            sectionMerged.push(current);
            current = next;
        }
    }
    sectionMerged.push(current);

    // 阶段 2：合并相同节次下分段返回的周次。
    sectionMerged.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const result = [];
    let currentCourse = sectionMerged[0];

    for (let i = 1; i < sectionMerged.length; i++) {
        const nextCourse = sectionMerged[i];
        const sameCourseAndSection =
            currentCourse.name === nextCourse.name &&
            currentCourse.teacher === nextCourse.teacher &&
            currentCourse.position === nextCourse.position &&
            currentCourse.day === nextCourse.day &&
            currentCourse.startSection === nextCourse.startSection &&
            currentCourse.endSection === nextCourse.endSection;

        if (sameCourseAndSection) {
            currentCourse.weeks = Array.from(new Set([
                ...currentCourse.weeks,
                ...nextCourse.weeks
            ])).sort((a, b) => a - b);
        } else {
            result.push(currentCourse);
            currentCourse = nextCourse;
        }
    }
    result.push(currentCourse);

    return result;
}

/**
 * 解析周次字符串，处理单双周和周次范围。
 * 兼容格式："1-16周"、"6周"、"第6周"、"1-8周(单)"、"1-10周(双)"、"1-5周,9周"
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const normalizedWeekStr = String(weekStr).replace(/，/g, ',');
    const weekSets = normalizedWeekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)\s*-\s*(\d+)\s*周?/);
        const singleMatch = trimmedSet.match(/^(?:第\s*)?(\d+)\s*周?/); // 匹配单个周次，包括调课返回的“第N周”

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed && start >= 1 && end >= start) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析节次字符串，例如 "1-2"、"1-2节" 或单节 "3"。
 * 返回 null 表示接口返回了无法识别的节次格式。
 */
function parseSectionRange(sectionStr) {
    const sectionText = sectionStr == null ? '' : String(sectionStr);
    const sectionMatch = sectionText.match(/^\s*(?:第)?(\d+)\s*(?:-\s*(\d+))?\s*节?\s*$/);

    if (!sectionMatch) {
        return null;
    }

    const startSection = Number(sectionMatch[1]);
    const endSection = Number(sectionMatch[2] || sectionMatch[1]);

    if (!Number.isInteger(startSection) || !Number.isInteger(endSection) ||
        startSection < 1 || endSection < startSection) {
        return null;
    }

    return { startSection, endSection };
}

/**
 * 阳江校区其他场地（非慎思楼）的作息。
 * 只有第 3、4 节在校区作息表中是不同的连续时间块，使用自定义时间表示。
 */
const OTHER_VENUE_SECTION_3_4_TIME = { startTime: "10:10", endTime: "11:40" };

function getOtherVenueCustomTime(position, startSection, endSection) {
    const positionText = position == null ? '' : String(position);
    if (!positionText || positionText.includes("慎思楼")) {
        return null;
    }

    if (startSection !== 3 || endSection !== 4) {
        return null;
    }

    return OTHER_VENUE_SECTION_3_4_TIME;
}

function applyOtherVenueCustomTime(courses) {
    return courses.map(course => {
        const customTime = getOtherVenueCustomTime(
            course.position,
            course.startSection,
            course.endSection
        );
        if (!customTime) return course;

        return {
            ...course,
            isCustomTime: true,
            customStartTime: customTime.startTime,
            customEndTime: customTime.endTime
        };
    });
}

/**
 * 学分允许小数和零；缺失或非法值保持未知，不影响课程导入。
 */
function parseCredit(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const credit = Number(value);
    return Number.isFinite(credit) && credit >= 0 ? credit : null;
}

/**
 * 解析正方 v9 课表查询接口返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    // 正方 v9 个人课表数据放在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const initialCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse || typeof rawCourse !== 'object') {
            continue;
        }

        // 课程名、星期、节次和周次是解析所必需的；教师或教室为空时仍保留课程。
        if (!rawCourse.kcmc || rawCourse.xqj == null ||
            rawCourse.jcs == null || rawCourse.zcd == null) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionRange = parseSectionRange(rawCourse.jcs);
        if (!sectionRange) {
            console.warn(`JS: 跳过无法解析节次的课程：${rawCourse.kcmc}`);
            continue;
        }

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || day < 1 || day > 7) {
            continue;
        }

        initialCourseList.push({
            name: String(rawCourse.kcmc).trim(),
            teacher: rawCourse.xm == null ? '' : String(rawCourse.xm).trim(),
            position: rawCourse.cdmc == null ? '' : String(rawCourse.cdmc).trim(),
            day: day,
            startSection: sectionRange.startSection,
            endSection: sectionRange.endSection,
            weeks: weeksArray,
            credit: parseCredit(rawCourse.xf)
        });
    }

    const mergedCourses = mergeAndDistinctCourses(initialCourseList);
    const finalCourseList = applyOtherVenueCustomTime(mergedCourses);

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析与合并完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "广东海洋大学阳江校区教务系统课表导入",
        "请确认页面上的学年和学期，再按提示导入课程。\n\n如果登录后页面显示不全，下次登录前可点右上角菜单，选择“电脑模式”。",
        "好的，开始导入"
    );
}

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

function parseAcademicOptionsFromDocument(doc) {
    if (!doc || typeof doc.querySelector !== "function") return null;

    const yearData = parseSelectOptions(doc.querySelector("#xnm"));
    const semesterData = parseSelectOptions(doc.querySelector("#xqm"));
    if (yearData.options.length === 0 || semesterData.options.length === 0) return null;

    return {
        yearOptions: yearData.options,
        semesterOptions: semesterData.options,
        defaultYearIndex: yearData.defaultIndex,
        defaultSemesterIndex: semesterData.defaultIndex
    };
}

function isOnTimetablePage() {
    const pathname = typeof window !== "undefined" && window.location
        ? window.location.pathname
        : "";
    return typeof pathname === "string" && pathname.includes("xskbcx_cxXskbcxIndex.html");
}

function getCurrentPageAcademicOptions() {
    const frame = typeof document !== "undefined"
        ? document.getElementById("gdouyj-timetable-frame")
        : null;
    if (frame) {
        try {
            return parseAcademicOptionsFromDocument(frame.contentDocument);
        } catch (error) {
            return null;
        }
    }
    if (!isOnTimetablePage() || typeof document === "undefined" || !document.querySelector) {
        return null;
    }

    return parseAcademicOptionsFromDocument(document);
}

/**
 * WFW 移动门户生成的代理前缀会使页面资源跳转到登录页。
 * 只修正本校 WFW 前缀，保留学校原页面和原查询逻辑。
 */
function normalizeWfwPageHtml(html, origin) {
    const prefix = `${origin}/https://jw.gdou.edu.cn`;
    const escapedPrefix = prefix.replace(/\//g, "\\/");
    const escapedOrigin = origin.replace(/\//g, "\\/");
    return html.split(prefix).join(origin).split(escapedPrefix).join(escapedOrigin);
}

async function prepareWfwTimetableHtml(html, origin) {
    const page = new DOMParser().parseFromString(normalizeWfwPageHtml(html, origin), "text/html");
    for (const existing of Array.from(page.querySelectorAll("base"))) existing.remove();
    const base = page.createElement("base");
    base.href = `${origin}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;
    page.head.prepend(base);
    // 顺序获取原站依赖，避免 WFW 同时加载大量资源时返回 503 后留下半成品页面。
    for (const script of Array.from(page.querySelectorAll("script[src]"))) {
        const url = new URL(script.getAttribute("src"), `${origin}/`);
        if (url.origin !== origin) throw new Error("课表页包含非同源脚本，已停止打开");
        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
            response = await fetch(url.href, { credentials: "include", cache: "no-store" });
            if (response.status !== 503) break;
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!response.ok) throw new Error(`页面资源加载失败：${url.pathname}，HTTP ${response.status}`);
        const type = response.headers.get("content-type") || "";
        if (!/(?:javascript|ecmascript)/i.test(type)) {
            throw new Error("页面资源未返回脚本，请重新登录");
        }
        const code = normalizeWfwPageHtml(await response.text(), origin);
        script.removeAttribute("src");
        script.removeAttribute("async");
        script.removeAttribute("defer");
        script.textContent = code.replace(/<\/script/gi, "<\\/script");
    }
    return `<!doctype html>\n${page.documentElement.outerHTML}`;
}

async function openTimetableFromMobilePortal() {
    if (window.location.hostname !== "wfw.gdou.edu.cn" ||
        window.location.pathname !== "/xtgl/index_cxAllApp.html" ||
        document.getElementById("gdouyj-timetable-frame")) {
        return false;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        "打开课表",
        "这里暂时看不到课表。点“打开课表”后，请确认页面上的学年和学期，再点一次拾光的“导入”按钮保存课程。",
        "打开课表"
    );
    if (!confirmed) return true;

    try {
        const url = buildScheduleUrl("xskbcx_cxXskbcxIndex.html", "gnmkdm=N2151&layout=default");
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, "text/html");
        if (!parseAcademicOptionsFromDocument(parsed)) {
            throw new Error("未取得个人课表页面，请重新登录；必要时在登录前切换电脑模式");
        }
        window.shiguangBridge.showToast("正在加载个人课表页面，请稍候...");
        const preparedHtml = await prepareWfwTimetableHtml(html, window.location.origin);

        const panel = document.createElement("div");
        panel.id = "gdouyj-timetable-panel";
        panel.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;background:white";
        const toolbar = document.createElement("div");
        toolbar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#087ebc;color:white;font:16px sans-serif";
        const label = document.createElement("span");
        label.textContent = "确认学年学期后，再点“导入”";
        const close = document.createElement("button");
        close.textContent = "返回";
        close.type = "button";
        const previousTitle = document.title;
        close.onclick = () => {
            panel.remove();
            document.title = previousTitle;
        };
        toolbar.append(label, close);
        const frame = document.createElement("iframe");
        frame.id = "gdouyj-timetable-frame";
        frame.title = "广东海洋大学个人课表查询";
        frame.style.cssText = "flex:1;min-height:0;width:100%;border:0;background:white";
        frame.srcdoc = preparedHtml;
        panel.append(toolbar, frame);
        document.body.appendChild(panel);
        document.title = "个人课表查询";
    } catch (error) {
        window.shiguangBridge.showToast(`打开课表页面失败：${error.message}`);
    }
    return true;
}

/**
 * 推导教务系统接口前缀：
 *   直接访问：pathname 形如 /kbcx/xskbcx_cxXsgrkb.html                    → 前缀为 ""
 *   反代·拼接态：pathname 形如 /https://jw.gdou.edu.cn/kbcx/xskbcx_...html → 前缀为 "/https://jw.gdou.edu.cn"
 *   反代·哈希态：pathname 形如 /http/<hash>/kbcx/xskbcx_...html            → 前缀为 "/http/<hash>"
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
 * 拼接教务系统接口地址，自动带上直连/反代前缀。
 * @param {string} modulePath 接口文件名，例如 "xskbcx_cxXsgrkb.html"
 * @param {string} query 可选查询串，例如 "gnmkdm=N2151"
 */
function buildScheduleUrl(modulePath, query) {
    const base = getScheduleBase();
    const queryString = query ? `?${query}` : "";
    return `${window.location.origin}${base}/kbcx/${modulePath}${queryString}`;
}

/**
 * 从正方课表页读取学年和学期选项。
 * 学期码直接使用教务系统返回的 value，例如第一学期为 3、第二学期为 12。
 */
async function fetchAcademicOptions() {
    const currentPageOptions = getCurrentPageAcademicOptions();
    if (currentPageOptions) {
        console.log("JS: 使用当前课表页的学年学期选项。");
        return currentPageOptions;
    }

    const url = buildScheduleUrl("xskbcx_cxXskbcxIndex.html", "gnmkdm=N2151&layout=default");

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });
        if (!response.ok) return null;

        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, "text/html");
        const optionsData = parseAcademicOptionsFromDocument(doc);
        if (!optionsData) return null;

        const selectedYearIndex = optionsData.defaultYearIndex;
        const start = Math.max(0, selectedYearIndex - 2);
        const end = Math.min(optionsData.yearOptions.length, selectedYearIndex + 3);

        return {
            ...optionsData,
            yearOptions: optionsData.yearOptions.slice(start, end),
            defaultYearIndex: selectedYearIndex - start
        };
    } catch (error) {
        console.warn("JS: 读取学年学期选项失败:", error);
        return null;
    }
}

/**
 * 使用教务系统返回的选项让用户选择学年和学期。
 * 学年和学期码直接使用 option 的 value，避免本地手动映射。
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();
    if (!optionsData) {
        window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保登录状态。");
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;
    const yearTexts = yearOptions.map(option => option.text);
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearTexts),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1 || !yearOptions[yearIndex]) return null;
    const selectedYearCode = yearOptions[yearIndex].value;

    const semesterTexts = semesterOptions.map(option => option.text);
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterTexts),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1 || !semesterOptions[semesterIndex]) return null;
    const selectedSemesterCode = semesterOptions[semesterIndex].value;

    return {
        academicYear: selectedYearCode,
        semesterCode: selectedSemesterCode
    };
}

/**
 * 将正方返回的日期字段规范为 yyyy-MM-dd。
 */
function normalizeStartDate(value) {
    const match = String(value || "").match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
    if (!match) return null;

    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/**
 * 从正方校历响应中查找第一周日期。
 * 兼容顶层数组、data/list/rows 等包装对象，以及 zrq/zcrq/rq/ksrq 字段。
 */
function findSemesterStartDate(value) {
    if (value == null) return null;

    if (typeof value !== "object") {
        return normalizeStartDate(value);
    }

    if (Array.isArray(value)) {
        const firstWeek = value.find(item =>
            item && typeof item === "object" &&
            (String(item.zs) === "1" || String(item.zsmc) === "1")
        ) || value[0];
        const firstWeekDate = findSemesterStartDate(firstWeek);
        if (firstWeekDate) return firstWeekDate;

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

/**
 * 获取所选学期的第一周开学日期。
 * 日期接口失败时返回 null，不阻断课表导入。
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = buildScheduleUrl("xskbcxZccx_cxZcByXnxq.html", "gnmkdm=N2154");
    const requestBody = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) {
            console.warn(`JS: 开学日期接口请求失败：HTTP ${response.status}`);
            return null;
        }

        const responseText = await response.text();
        let json;
        try {
            json = JSON.parse(responseText);
        } catch (error) {
            console.warn("JS: 开学日期接口未返回 JSON，可能登录已过期。", error);
            return null;
        }

        const startDate = findSemesterStartDate(json);
        if (!startDate) console.warn("JS: 校历响应中未找到第 1 周开学日期。");
        return startDate;
    } catch (error) {
        console.warn("JS: 获取学期开学日期失败:", error);
    }

    return null;
}

/**
 * 请求正方 v9 课表接口并解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}&kzlx=ck&xsdm=&kclbdm=`;

    // 广东海洋大学正方教务 v9 个人课表查询接口
    const targetUrl = buildScheduleUrl("xskbcx_cxXsgrkb.html", "gnmkdm=N2151");

    try {
        // 课表和校历互不依赖，并行请求以减少导入等待时间。
        const [courseResponse, semesterStartDate] = await Promise.all([
            fetch(targetUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                },
                body: requestBody,
                credentials: "include"
            }),
            fetchSemesterStartDate(academicYear, semesterCode)
        ]);

        if (!courseResponse.ok) {
            window.shiguangBridge.showToast(`课表请求失败：HTTP ${courseResponse.status}`);
            console.error(`JS: 接口返回非 200 状态码：${courseResponse.status}`);
            return null;
        }

        const jsonText = await courseResponse.text();
        const jsonData = JSON.parse(jsonText);

        if (!jsonData || !Array.isArray(jsonData.kbList) || jsonData.kbList.length === 0) {
            window.shiguangBridge.showToast("未查询到课表数据，请检查学年/学期是否选择正确，或确认已登录教务系统。");
            return null;
        }

        const parsedCourses = parseJsonData(jsonData);
        if (parsedCourses.length === 0) {
            window.shiguangBridge.showToast("课表数据为空或解析失败，请确认所选学年学期。");
            return null;
        }

        return {
            courses: parsedCourses,
            // CourseConfigJsonModel（wiki 1.3）：所有字段可选，未提供则用默认值。
            // GDOU 各节课间隔不统一，因此用 TimeSlot 节次表达时间。
            config: {
                semesterStartDate,
                semesterTotalWeeks: 20
            }
        };
    } catch (e) {
        console.error("JS: 获取课表失败:", e);
        window.shiguangBridge.showToast("获取课表失败：请确认已在教务系统登录并停留在个人课表页，且登录状态未过期。");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 阳江校区慎思楼上课时间（根据用户提供的校区作息表）
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:20", endTime: "17:05" },
    { number: 8, startTime: "17:10", endTime: "17:55" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    // 首次在异常移动门户执行时只打开查询页，保留用户核对与选择学期的机会。
    if (await openTimetableFromMobilePortal()) return;
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        console.log("JS: 用户取消了导入流程。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("导入已取消。");
        console.log("JS: 获取学年学期失败/取消，流程终止。");
        return;
    }
    const { academicYear, semesterCode } = selection;
    console.log(`JS: 已确定学年学期：${academicYear}，学期码：${semesterCode}`);

    const result = await fetchAndParseCourses(academicYear, semesterCode);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        const configMessage = config.semesterStartDate
            ? `课表配置更新成功！总周数：${config.semesterTotalWeeks}周，开学日期：${config.semesterStartDate}。`
            : `课表配置更新成功！总周数：${config.semesterTotalWeeks}周，未获取到开学日期，已继续导入。`;
        window.shiguangBridge.showToast(configMessage);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
        return;
    }

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 脚本执行入口
runImportFlow();
})();

