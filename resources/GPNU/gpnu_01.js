// ===================== 工具函数 =====================

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

/**
 * 解析周次字符串，例如 "1-16周"、"1-8周,10-16周"、"1-16周(单)"、"1-16周(双)" 等。
 * @param {string} weekStr - 周次描述字符串
 * @returns {number[]} 周次数字数组（升序）
 */
function parseWeeks(weekStr) {
    if (typeof weekStr !== 'string') {
        weekStr = String(weekStr || '');
    }
    if (!weekStr) return [];

    let cleanStr = weekStr.replace(/周/g, '').replace(/\s+/g, '');
    const weeks = new Set();
    const parts = cleanStr.split(',');

    for (let rawPart of parts) {
        if (!rawPart) continue;

        // ========== 改进点 1：先判断单双标记，再提取数字 ==========
        const hasDan = /单/.test(rawPart);
        const hasShuang = /双/.test(rawPart);
        // 仅含“单”不含“双” → 单周（奇数）
        let oddOnly = hasDan && !hasShuang;
        // 仅含“双”不含“单” → 双周（偶数）
        let evenOnly = hasShuang && !hasDan;
        // 若同时包含“单”和“双”，视为不限制奇偶（每周都上）
        // 无需额外处理，因为 oddOnly 和 evenOnly 已经为 false

        // 提取片段中的数字和连字符（忽略括号、单双等非数字字符）
        const numericPart = rawPart.replace(/[^\d\-]/g, '');
        if (!numericPart) {
            console.warn(`JS: 解析周次时忽略非法片段: ${rawPart}`);
            continue;
        }

        if (!/^[\d\-]+$/.test(numericPart)) {
            console.warn(`JS: 解析周次时忽略非法片段: ${rawPart}`);
            continue;
        }

        // 解析范围或单个数字
        if (numericPart.includes('-')) {
            const [startStr, endStr] = numericPart.split('-');
            const start = Number(startStr);
            const end = Number(endStr);
            if (!isNaN(start) && !isNaN(end) && start <= end) {
                for (let w = start; w <= end; w++) {
                    if (oddOnly && w % 2 !== 1) continue;   // 单周只保留奇数
                    if (evenOnly && w % 2 !== 0) continue;   // 双周只保留偶数
                    weeks.add(w);
                }
            }
        } else {
            const w = Number(numericPart);
            if (!isNaN(w)) {
                if (oddOnly && w % 2 !== 1) continue;
                if (evenOnly && w % 2 !== 0) continue;
                weeks.add(w);
            }
        }
    }

    // 备用解析：如果正常解析为空，尝试用正则直接提取所有数字和范围
    if (weeks.size === 0) {
        // ========== 改进点 2：备用解析使用一致的奇偶判断逻辑 ==========
        const hasDanOverall = /单/.test(weekStr);
        const hasShuangOverall = /双/.test(weekStr);
        let oddOnlyOverall = hasDanOverall && !hasShuangOverall;
        let evenOnlyOverall = hasShuangOverall && !hasDanOverall;

        const rangePattern = /(\d+)\s*-\s*(\d+)/g;
        let match;
        let matched = false;
        while ((match = rangePattern.exec(weekStr)) !== null) {
            const start = Number(match[1]);
            const end = Number(match[2]);
            if (start <= end) {
                for (let w = start; w <= end; w++) {
                    if (oddOnlyOverall && w % 2 === 0) continue;   // 单周跳过偶数
                    if (evenOnlyOverall && w % 2 !== 0) continue;   // 双周跳过奇数
                    weeks.add(w);
                }
                matched = true;
            }
        }
        if (!matched) {
            const singlePattern = /(\d+)周/g;
            while ((match = singlePattern.exec(weekStr)) !== null) {
                const w = Number(match[1]);
                if (!isNaN(w)) {
                    if (oddOnlyOverall && w % 2 === 0) continue;
                    if (evenOnlyOverall && w % 2 !== 0) continue;
                    weeks.add(w);
                }
            }
        }
    }

    return Array.from(weeks).sort((a, b) => a - b);
}
/**
 * 解析 API 返回的 JSON 数据，提取课程信息。
 * 保持与旧版完全一致的课程解析行为。
 * @param {Object} jsonData - 教务系统返回的 JSON 对象
 * @returns {Array} 解析后的课程数组
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 旧版严格非空校验，包含 cdmc
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        // 旧版节次解析：整体去除“节”字，按 '-' 分割取首尾
        const jcs = String(rawCourse.jcs).replace(/节/g, '');
        const sectionParts = jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        finalCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    // 旧版排序规则
    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    const merged = mergeAndDistinctCourses(finalCourseList);
    window.shiguangBridge.showToast(`去重前：${finalCourseList.length} 门，去重后：${merged.length} 门`);
    return merged;
}
/**
 * 根据课程周次数组推断学期总周数。
 * @param {Array} courses - 课程数组
 * @returns {number} 推断出的最大周次，至少为1
 */
function inferTotalWeeks(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        const weekNums = course.weeks;
        if (weekNums.length > 0) {
            maxWeek = Math.max(maxWeek, ...weekNums);
        }
    }
    // 返回至少1周，若无法推断则使用默认20
    return Math.max(1, maxWeek || 20);
}

/**
 * 从周次数据数组中解析第 1 周的开学日期。
 * @param {Array} weekList - 教务系统返回的周次数据数组
 * @returns {string|null} 开学日期字符串（YYYY-MM-DD），解析失败返回 null
 */
function parseSchoolStartDate(weekList) {
    if (!Array.isArray(weekList) || weekList.length === 0) {
        return null;
    }

    // 找到第 1 周
    let firstWeek = weekList.find(item => String(item.zs) === '1');

    if (!firstWeek) {
        firstWeek = weekList.find(item => Number(item.zs) === 1);
    }

    // 如果还是没有，就按周次排序，取最小周次
    if (!firstWeek) {
        const sorted = [...weekList].sort((a, b) => Number(a.zs) - Number(b.zs));
        firstWeek = sorted[0];
    }

    if (!firstWeek) {
        return null;
    }

    // 优先从 rq 字段取开始日期
    const rq = String(firstWeek.rq || '');
    const rqMatch = rq.match(/\d{4}-\d{1,2}-\d{1,2}/);
    if (rqMatch) {
        return rqMatch[0];
    }

    // 兼容从 zcrq 字段取开始日期
    const zcrq = String(firstWeek.zcrq || '');
    const zcrqMatch = zcrq.match(/\d{4}-\d{1,2}-\d{1,2}/);
    if (zcrqMatch) {
        return zcrqMatch[0];
    }

    return null;
}

/**
 * 从教务系统周次数据中提取最大周次。
 * @param {Array} weekList - 教务系统周次数据数组
 * @returns {number|null} 最大周次，解析失败返回 null
 */
function getMaxWeekFromSchoolWeekList(weekList) {
    if (!Array.isArray(weekList) || weekList.length === 0) {
        return null;
    }
    let max = 0;
    for (const item of weekList) {
        const week = Number(item.zs);
        if (!isNaN(week) && week > max) {
            max = week;
        }
    }
    return max > 0 ? max : null;
}

function getDefaultSemesterDate(academicYear, semesterIndex) {
    const year = Number(academicYear);
    if (isNaN(year)) return "2026-02-01";
    if (semesterIndex === 0) {
        return `${year}-09-01`;
    } else {
        return `${year + 1}-02-01`;
    }
}

// ===================== 全局常量 =====================

const BASE_URL = 'https://jwglxt.gpnu.edu.cn';

// ===================== 全局验证函数 =====================

/**
 * 判断一个字符串是否为有效的日期（YYYY-MM-DD），并检查日期是否真实存在。
 * @param {string} dateStr - 日期字符串
 * @returns {boolean} 是否有效
 */
function isValidDateString(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [year, month, day] = dateStr.split('-').map(Number);
    if (year < 2000 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    const daysInMonth = new Date(year, month, 0).getDate();
    return day >= 1 && day <= daysInMonth;
}

/**
 * 校验学年输入：必须为四位数字，且在合理范围内（2000-2100）。
 * @param {string|null|undefined} input - 用户输入
 * @returns {string|false} 校验失败返回提示字符串，通过返回 false
 */
function validateYearInput(input) {
    console.log("JS:  validateYearInput被调用，输入: " + input);
    if (input === null || input === undefined) {
        return "请输入四位数字的学年喵~";
    }
    if (/^[0-9]{4}$/.test(input)) {
        const year = Number(input);
        if (year >= 2000 && year <= 2100) {
            return false;
        } else {
            return "学年需在 2000 到 2100 之间喵~";
        }
    } else {
        return "请输入四位数字的学年喵~";
    }
}

/**
 * 校验日期输入：允许空值，格式必须为 YYYY-MM-DD，且日期有效。
 * @param {string|null|undefined} input - 用户输入
 * @returns {string|false} 校验失败返回提示字符串，通过返回 false
 */
function validateDateInput(input) {
    if (input === null || input === undefined || input.trim() === '') {
        return false;
    }
    if (isValidDateString(input.trim())) {
        return false;
    }
    return "日期格式应为 YYYY-MM-DD，且为有效日期喵~";
}

/**
 * 校验学期总周数输入：必须为 1~30 的整数。
 * @param {string|null|undefined} input - 用户输入
 * @returns {string|false} 校验失败返回提示字符串，通过返回 false
 */
function validateWeeksInput(input) {
    if (input === null || input === undefined || input.trim() === '') {
        return "请输入学期总周数（1-30）喵~";
    }
    const num = Number(input.trim());
    if (Number.isInteger(num) && num >= 1 && num <= 30) {
        return false;
    }
    return "周数必须是 1 到 30 之间的整数喵~";
}

// ===================== 与原生交互的异步封装 =====================

/**
 * 询问用户是否退出当前导入流程。
 * @returns {Promise<boolean>} true=退出，false=留在页面
 */
async function promptUserToExit() {
    console.log("JS: 询问用户是否退出。");
    const options = ["退出", "留在页面"];
    const rawIndex = await window.shiguangBridgePromise.showSingleSelection(
        "导入流程已结束",
        JSON.stringify(options),
        0  // 默认选中“退出”
    );

    // 用户取消选择（返回 null/undefined/''）时，默认不退出
    if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
        console.log("JS: 用户取消退出选择，默认留在页面。");
        return false;
    }
    const index = Number(rawIndex);
    if (isNaN(index) || index < 0 || index >= options.length) {
        console.warn("JS: 退出选择索引无效，默认留在页面。");
        return false;
    }
    return index === 0;
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入喵~",
        "Ciallo~ 导入前请确保您已成功登录教务系统哦喵~",
        "好的"
    );
}

/**
 * 显示课程导入成功的弹窗公告。
 * @param {number} length - 导入的课程数量
 */
async function promptUserToSUCCESS(length) {
    console.log("JS: SUCCESS：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "SUCCESS",
        `成功了喵~ 共导入 ${length} 门课程！`,
        "好的"
    );
}

const SCHOOL_START_MONTH = 8; // 默认

async function getAcademicYear() {
    const now = new Date();
    let academicYear = now.getFullYear();
    if (now.getMonth() + 1 < SCHOOL_START_MONTH) {
        academicYear -= 1;
    }
    const defaultYear = academicYear.toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年喵~（Auto value）",
        "请输入要导入课程的起始学年喵~:",
        defaultYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    console.log("JS: 提示用户选择学期。");
    const rawIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期喵~",
        JSON.stringify(semesters),
        0
    );

    if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
        console.log("JS: 用户取消选择学期。");
        return null;
    }
    const index = Number(rawIndex);
    if (isNaN(index) || index < 0 || index >= semesters.length) {
        console.warn("JS: 学期索引无效，返回 null。");
        return null;
    }
    return index;
}

async function selectArea() {
    const areas = ["东/西/北校区", "白云校区", "河源校区"];
    console.log("JS: 提示用户选择校区。");
    const rawIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区喵~",
        JSON.stringify(areas),
        0
    );

    if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
        console.log("JS: 用户取消选择校区。");
        return null;
    }
    const index = Number(rawIndex);
    if (isNaN(index) || index < 0 || index >= areas.length) {
        console.warn("JS: 校区索引无效，返回 null。");
        return null;
    }
    return index;
}

async function selectTotalWeeksSource(courseMaxWeeks, schoolMaxWeeks) {
    const options = [
        `课程最大周数（${courseMaxWeeks}周）`,
        schoolMaxWeeks ? `教务系统周数（${schoolMaxWeeks}周）` : "教务系统周数（无数据）",
        "手动输入"
    ];
    console.log("JS: 提示用户选择周数来源。");
    const rawIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期总周数来源喵~（已自动解析）",
        JSON.stringify(options),
        0
    );

    if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
        console.log("JS: 用户取消选择周数来源。");
        return null;
    }

    const index = Number(rawIndex);
    if (isNaN(index) || index < 0 || index > 2) {
        console.warn("JS: 周数来源选择无效，默认使用课程最大周数。");
        return 0;
    }
    return index;
}

/**
 * 获取学期开始日期。
 * 优先使用传入的周次数据解析开学日期；若未传入或数据无效，则向教务系统请求。
 * 解析成功后弹出对话框让用户确认或修改，用户可留空跳过（返回 null）。
 * @param {string} academicYear - 学年（四位数字）
 * @param {number} semesterIndex - 学期索引（0 第一学期，1 第二学期）
 * @param {Array|null} [weekList=null] - 可选的周次数据数组，若提供且非空则直接使用
 * @returns {Promise<string|null>} 用户确认的日期字符串（YYYY-MM-DD），取消或留空返回 null
 */
async function getSemesterStartDate(academicYear, semesterIndex, weekList = null) {
    console.log("JS: 正在获取学期周次数据以解析开学日期...");
    let defaultDate = getDefaultSemesterDate(academicYear, semesterIndex);

    // 1. 确定要使用的周次数据来源
    let data = weekList;
    if (!Array.isArray(data) || data.length === 0) {
        // 外部没有提供有效数据，尝试从教务系统获取
        try {
            data = await fetchSchoolWeekData(academicYear, getSemesterCode(semesterIndex));
        } catch (error) {
            console.warn("JS: 获取周次数据失败，将使用动态默认日期。", error);
            window.shiguangBridge.showToast("未能获取学期周次数据，开始日期可能需要手动填写。");
            data = null; // 确保后续不会使用无效数据
        }
    }

    // 2. 解析开学日期
    if (Array.isArray(data) && data.length > 0) {
        const parsedDate = parseSchoolStartDate(data);
        if (parsedDate) {
            defaultDate = parsedDate;
            console.log(`JS: 解析到的开学日期: ${defaultDate}`);
        } else {
            console.log("JS: 未能从周次数据解析出开学日期，使用动态默认值。");
        }
    } else {
        console.log("JS: 无可用周次数据，使用动态默认值。");
    }

    // 3. 弹出对话框让用户确认或修改日期（可留空跳过）
    console.log("JS: 提示用户输入学期开始日期（可留空跳过）。");
    const input = await window.shiguangBridgePromise.showPrompt(
        "学期开始日期喵~",
        "请输入学期第一天的日期喵~（YYYY-MM-DD）（已尝试自动解析）",
        defaultDate,
        "validateDateInput"
    );

    if (input === null || input === undefined) {
        console.log("JS: 用户取消了开始日期输入，继续流程。");
        return null;
    }
    if (input.trim() === '') {
        return null;
    }
    return input.trim();
}

async function getSemesterTotalWeeks(defaultWeeks) {
    console.log(`JS: 提示用户输入学期总周数，默认值：${defaultWeeks}`);
    const input = await window.shiguangBridgePromise.showPrompt(
        "设置学期总周数喵~",
        "请输入本学期的总周数喵~（1-30）",
        String(defaultWeeks),
        "validateWeeksInput"
    );
    if (input === null || input === undefined) {
        console.log("JS: 用户取消了总周数输入，流程继续使用默认值。");
        return defaultWeeks;
    }
    const weeks = Number(input.trim());
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 30) {
        console.warn("JS: 周数输入非法，使用默认值。");
        return defaultWeeks;
    }
    return weeks;
}

async function promptImportTimeSlots() {
    console.log("JS: 询问用户是否导入预设时间段。");
    return await window.shiguangBridgePromise.showAlert(
        "导入预设时间段喵~",
        "是否导入该校区对应的预设上课时间段喵~？",
        "导入"
    );
}

// ===================== 网络请求 =====================

async function fetchCourseData(academicYear, semesterIndex) {
    const semesterCode = getSemesterCode(semesterIndex);
    const requestBody = new URLSearchParams({
        gnmkdm: 'N2151',
        xnm: academicYear,
        xqm: semesterCode,
        kzlx: 'ck',
        xsdm: '',
        kclbdm: '',
        kclxdm: ''
    }).toString();

    const targetUrls = [
        `${BASE_URL}/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`,
    ];

    const errors = [];

    for (const url of targetUrls) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest"
                },
                body: requestBody,
                credentials: "include"
            });

            if (!response.ok) {
                const msg = `HTTP ${response.status} ${response.statusText}`;
                errors.push(`${url} -> ${msg}`);
                console.warn(`课表数据请求失败（${msg}）：${url}`);
                continue;
            }

            const jsonText = await response.text();
            if (jsonText.includes('<html')) {
                errors.push(`${url} -> 返回登录页面，可能登录已过期`);
                console.warn(`课表数据返回登录页面，可能未登录或会话过期：${url}`);
                continue;
            }

            let data;
            try {
                data = JSON.parse(jsonText);
            } catch (parseError) {
                errors.push(`${url} -> JSON 解析失败: ${parseError.message}`);
                console.warn(`课表数据 JSON 解析失败：${url}`, parseError);
                continue;
            }

            if (!data || !Array.isArray(data.kbList)) {
                errors.push(`${url} -> 返回数据缺少 kbList 数组`);
                console.warn(`课表数据缺少 kbList 字段：${url}`, data);
                continue;
            }

            return data;
        } catch (networkError) {
            errors.push(`${url} -> 网络异常: ${networkError.message}`);
            console.warn(`课表数据网络请求异常：${url}`, networkError);
        }
    }

    const errorMessage = errors.length > 0
        ? `课表数据获取失败，尝试了 ${targetUrls.length} 个地址：\n${errors.join('\n')}`
        : '课表数据获取失败，未配置任何请求地址';
    console.error(errorMessage);
    throw new Error(errorMessage);
}

async function fetchSchoolWeekData(xnm, xqm) {
    const targetUrls = [
        `${BASE_URL}/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`,
    ];

    const requestBody = new URLSearchParams({
        xnm: xnm,
        xqm: xqm
    }).toString();

    const errors = [];

    for (const url of targetUrls) {
        try {
            const response = await fetch(url, {
                headers: {
                    'accept': 'application/json, text/javascript, */*; q=0.01',
                    'accept-language': 'zh-CN,zh;q=0.9',
                    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'x-requested-with': 'XMLHttpRequest'
                },
                body: requestBody,
                method: 'POST',
                mode: 'cors',
                credentials: 'include'
            });

            if (!response.ok) {
                const msg = `HTTP ${response.status} ${response.statusText}`;
                errors.push(`${url} -> ${msg}`);
                console.warn(`周次数据请求失败（${msg}）：${url}`);
                continue;
            }

            const text = await response.text();
            if (text.includes('<html')) {
                errors.push(`${url} -> 返回登录页面，可能登录已过期`);
                console.warn(`周次数据返回登录页面，可能未登录或会话过期：${url}`);
                continue;
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                errors.push(`${url} -> JSON 解析失败: ${parseError.message}`);
                console.warn(`周次数据 JSON 解析失败：${url}`, parseError);
                continue;
            }

            if (!Array.isArray(data)) {
                const msg = '返回数据不是数组';
                errors.push(`${url} -> ${msg}`);
                console.warn(`周次数据格式错误（期望数组）：${url}`, data);
                continue;
            }

            return data;
        } catch (networkError) {
            errors.push(`${url} -> 网络异常: ${networkError.message}`);
            console.warn(`周次数据网络请求异常：${url}`, networkError);
        }
    }

    const errorMessage = errors.length > 0
        ? `周次数据获取失败，尝试了 ${targetUrls.length} 个地址：\n${errors.join('\n')}`
        : '周次数据获取失败，未配置任何请求地址';
    console.error(errorMessage);
    throw new Error(errorMessage);
}

// ===================== 数据解析与配置构建 =====================

function buildCourseDataFromRaw(rawData, startDate) {
    console.log("JS: buildCourseDataFromRaw 开始解析原始数据...");

    if (!rawData || !Array.isArray(rawData.kbList)) {
        throw new Error('课表数据格式错误或缺少 kbList 字段');
    }

    const courses = parseJsonData(rawData);
    if (courses.length === 0) {
        throw new Error('未解析到有效课程，请检查课表数据');
    }

    const inferredWeeks = inferTotalWeeks(courses);
    const config = {
        semesterStartDate: startDate,
        semesterTotalWeeks: inferredWeeks
    };

    console.log(`JS: 解析成功，课程数：${courses.length}，推断总周数：${inferredWeeks}`);
    return { courses, config };
}

// ===================== 数据保存 =====================

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 准备导入 ${timeSlots.length} 个预设时间段。`);
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

// ===================== 三个校区的时间表 =====================

const TimeSlots_one = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:10", endTime: "09:50" },
    { number: 3, startTime: "10:00", endTime: "10:40" },
    { number: 4, startTime: "10:50", endTime: "11:30" },
    { number: 5, startTime: "13:30", endTime: "14:10" },
    { number: 6, startTime: "14:20", endTime: "15:00" },
    { number: 7, startTime: "15:10", endTime: "15:50" },
    { number: 8, startTime: "16:00", endTime: "16:40" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:30", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:00" }
];

const TimeSlots_two = [
    { number: 1, startTime: "08:30", endTime: "09:10" },
    { number: 2, startTime: "09:15", endTime: "09:55" },
    { number: 3, startTime: "10:05", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:30" },
    { number: 5, startTime: "13:30", endTime: "14:10" },
    { number: 6, startTime: "14:15", endTime: "14:55" },
    { number: 7, startTime: "15:05", endTime: "15:45" },
    { number: 8, startTime: "15:50", endTime: "16:30" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:25", endTime: "20:05" },
    { number: 11, startTime: "20:10", endTime: "20:50" }
];

const TimeSlots_three = [
    { number: 1, startTime: "08:20", endTime: "09:00" },
    { number: 2, startTime: "09:10", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "10:50" },
    { number: 4, startTime: "11:00", endTime: "11:40" },
    { number: 5, startTime: "13:50", endTime: "14:30" },
    { number: 6, startTime: "14:40", endTime: "15:20" },
    { number: 7, startTime: "15:40", endTime: "16:20" },
    { number: 8, startTime: "16:30", endTime: "17:10" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:30", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:00" }
];

// ===================== 索引 =====================

function getSemesterCode(semesterIndex) {
    return semesterIndex === 0 ? "3" : "12";
}

function getTimeSlotsByAreaIndex(areaIndex) {
    if (areaIndex === 0) return TimeSlots_one;
    if (areaIndex === 1) return TimeSlots_two;
    if (areaIndex === 2) return TimeSlots_three;
    return TimeSlots_one;
}

// ===================== 主流程 =====================

async function runImportFlow() {
    let shouldExit = false;          // 最终是否退出（由用户选择决定）
    let flowEnded = false;           // 标记流程是否已经走到需要询问退出的节点

    try {
        // ================= 流程开始 =================
        const alertConfirmed = await promptUserToStart();
        if (!alertConfirmed) {
            window.shiguangBridge.showToast("导入已取消。");
            console.log("JS: 用户取消了导入流程。");
            flowEnded = true;
            return; // 直接返回，但 finally 中会询问是否退出
        }

        // 获取学年
        const academicYear = await getAcademicYear();
        if (academicYear === null || academicYear === undefined) {
            window.shiguangBridge.showToast("导入已取消。");
            console.log("JS: 获取学年失败/取消，流程终止。");
            flowEnded = true;
            return;
        }
        console.log(`JS: 已选择学年: ${academicYear}`);

        // 选择学期
        const semesterIndex = await selectSemester();
        if (semesterIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            console.log("JS: 选择学期失败/取消，流程终止。");
            flowEnded = true;
            return;
        }
        console.log(`JS: 已选择学期索引: ${semesterIndex}`);

        // 选择校区
        const areaIndex = await selectArea();
        if (areaIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            console.log("JS: 选择校区失败/取消，流程终止。");
            flowEnded = true;
            return;
        }
        console.log(`JS: 已选择校区索引: ${areaIndex}`);

        // 获取周次数据（可选）
        let schoolWeekList = null;
        try {
            schoolWeekList = await fetchSchoolWeekData(academicYear, getSemesterCode(semesterIndex));
        } catch (error) {
            console.warn("JS: 获取周次数据失败，稍后周数来源可能缺少教务系统选项。", error);
            window.shiguangBridge.showToast("获取周次数据失败，将使用课程周数或手动输入。");
            schoolWeekList = [];
        }

        // 获取学期开始日期
        const startDate = await getSemesterStartDate(academicYear, semesterIndex, schoolWeekList);
        console.log(`JS: 学期开始日期输入结果: ${startDate}`);

        // 获取课表原始数据
        const rawData = await fetchCourseData(academicYear, semesterIndex);

        // 解析课程
        let courses, config;
        try {
            const parsedResult = buildCourseDataFromRaw(rawData, startDate);
            courses = parsedResult.courses;
            config = parsedResult.config;
        } catch (error) {
            window.shiguangBridge.showToast(error.message);
            console.error('JS: 课程解析失败:', error);
            flowEnded = true;
            return;
        }

        // 周数来源选择
        const courseMaxWeeks = config.semesterTotalWeeks;
        const schoolMaxWeeks = getMaxWeekFromSchoolWeekList(schoolWeekList);

        const weekSource = await selectTotalWeeksSource(courseMaxWeeks, schoolMaxWeeks);
        if (weekSource === null) {
            window.shiguangBridge.showToast("未选择周数来源，导入已取消。");
            console.log("JS: 用户取消周数来源选择，流程终止。");
            flowEnded = true;
            return;
        }

        let finalWeeks;
        if (weekSource === 0) {
            finalWeeks = courseMaxWeeks;
        } else if (weekSource === 1) {
            if (schoolMaxWeeks) {
                finalWeeks = schoolMaxWeeks;
            } else {
                window.shiguangBridge.showToast("教务系统周数不可用，已使用课程最大周数。");
                finalWeeks = courseMaxWeeks;
            }
        } else {
            finalWeeks = await getSemesterTotalWeeks(courseMaxWeeks);
        }
        config.semesterTotalWeeks = finalWeeks;

        // 保存课程
        const saveResult = await saveCourses(courses);
        if (!saveResult) {
            console.log("JS: 课程保存失败，流程终止。");
            flowEnded = true;
            return;
        }

        // 保存配置
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
        } catch (error) {
            window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
            console.error('JS: Save Config Error:', error);
        }

        // 导入预设时间段
        const timeSlots = getTimeSlotsByAreaIndex(areaIndex);
        const shouldImportTimeSlots = await promptImportTimeSlots();
        if (shouldImportTimeSlots) {
            await importPresetTimeSlots(timeSlots);
        } else {
            console.log("JS: 用户取消导入预设时间段，跳过。");
            window.shiguangBridge.showToast("已跳过导入时间段。");
        }

        await promptUserToSUCCESS(courses.length);
        console.log("JS: 整个导入流程执行完毕并成功。");
        flowEnded = true; // 成功结束

    } catch (e) {
        console.error('JS: 导入流程异常：', e);
        try {
            window.shiguangBridge.showToast('导入失败：' + (e && e.message ? e.message : e));
        } catch (_) {}
        flowEnded = true; // 异常结束
    } finally {
        // 无论成功、失败、取消，只要流程已经结束，就询问是否退出
        if (flowEnded) {
            shouldExit = await promptUserToExit();
            if (shouldExit) {
                console.log("JS: 用户选择退出，通知原生任务结束。");
                try {
                    window.shiguangBridge.notifyTaskCompletion();
                } catch (error) {
                    console.error("JS: 调用 notifyTaskCompletion 失败:", error);
                }
            } else {
                console.log("JS: 用户选择留在页面，不通知原生。");
                // 可在此处添加刷新页面或保持现状的逻辑
                window.location.reload();
            }
        }
    }
}
runImportFlow();
