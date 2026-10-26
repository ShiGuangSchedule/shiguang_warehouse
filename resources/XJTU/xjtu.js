// 西安交通大学本科教务系统 (jwxt.xjtu.edu.cn / ehall.xjtu.edu.cn) 课表导入适配

// -------- 配置常量 ---------

// XJTU 作息时间（11节, 50分钟制）
// 5月1日 - 10月1日: 夏季作息
const SUMMER_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:30", endTime: "16:20" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:40", endTime: "18:30" },
    { number: 9, startTime: "19:40", endTime: "20:30" },
    { number: 10, startTime: "20:40", endTime: "21:30" },
    { number: 11, startTime: "21:40", endTime: "22:30" }
];

// 10月1日 - 次年5月1日: 冬季作息
const WINTER_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:50" },
    { number: 6, startTime: "15:00", endTime: "15:50" },
    { number: 7, startTime: "16:10", endTime: "17:00" },
    { number: 8, startTime: "17:10", endTime: "18:00" },
    { number: 9, startTime: "19:10", endTime: "20:00" },
    { number: 10, startTime: "20:10", endTime: "21:00" },
    { number: 11, startTime: "21:10", endTime: "22:00" }
];

// 周参数
const FIRST_DAY_OF_WEEK = 1; // 每周第一天是 1
const WEEK_DAYS = 7; // 一周有 7 天

// 教学或总周数参数
const DEFAULT_NUM_OF_WEEKS = 16;
const MAX_NUM_OF_WEEKS = 32;

// 课程参数
const TOTAL_SECTION = SUMMER_TIME_SLOTS.length; // 根据作息表推断每天课程数
const CLASS_DURATION = 50; // 每节课50分钟
const BREAK_DURATION = 10; // 课间休息10分钟
// 课程参数自检断言
if (SUMMER_TIME_SLOTS.length !== WINTER_TIME_SLOTS.length) {
    throw new Error(":( 配置错误: 夏/冬作息表节数不一致, 请联系开发者"); // 开发用断言, 裸错误
}
// -------- 用户交互 --------

/**
 * 生成学期选项列表 (用于兜底: 接口 xnxqcx 失败时使用)
 * 学期代码: 1=第一学期, 2=第二学期, 3=夏季小学期, 4=暑假
 * 范围: 当前学年前1年到后1年, 按新到旧排序, 与接口时间顺序一致
 * displayName 附带原始学期代码, 便于排错
 */
function generateSemesterOptions(currentYear) {
    const semesterNames = { "1": "第一学期", "2": "第二学期", "3": "夏季小学期", "4": "暑假" };
    const semesterCodes = ["1", "2", "3", "4"];
    const options = [];

    const startYear = parseInt(currentYear.split("-")[0], 10) - 1;
    const endYear = parseInt(currentYear.split("-")[0], 10) + 1;

    for (let y = endYear; y >= startYear; y--) {
        const yearCode = `${y}-${y + 1}`;
        for (const semCode of semesterCodes) {
            const xnxqdm = `${yearCode}-${semCode}`;
            const displayName = `${yearCode}学年 ${semesterNames[semCode] || semCode} (${xnxqdm})`;
            options.push({ xnxqdm, displayName });
        }
    }
    return options;
}

/**
 * 从教务系统动态获取学期列表 (裁剪到当前学年起前3个学年后1个学年, 共5学年)
 * 拿到后显式按 DM 倒序 (时间倒序, 同学年内: 暑假->小学期->第二学期->第一学期)
 * 返回 [{xnxqdm, displayName}], 失败时回退到手写列表
 */
async function fetchTermOptions(currentTerm) {
    const currentYear = `${currentTerm.split("-")[0]}-${currentTerm.split("-")[1]}`;
    const yearStart = parseInt(currentTerm.split("-")[0], 10);

    let rows = null;
    try {
        const res = await api("/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do", { data: "*order=-DM" });
        rows = res?.datas?.xnxqcx?.rows;
    } catch (e) {
        console.warn("获取学期列表失败, 使用兜底列表:", e.message);
    }

    if (Array.isArray(rows) && rows.length > 0) {
        // 显式按 DM 字符串倒序 (YYYY-YYYY-N 格式下等价于时间倒序), 不依赖接口
        rows.sort((a, b) => (b?.DM || "").localeCompare(a?.DM || ""));
        const options = [];
        for (const row of rows) {
            const dm = row?.DM ? String(row.DM) : "";
            if (!dm) continue;
            const y = parseInt(dm.split("-")[0], 10);
            // 裁剪: 保留当前学年起前3个学年后1个学年 (共5学年)
            if (!Number.isInteger(y) || y < yearStart - 3 || y > yearStart + 1) continue;
            const mc = row?.MC ? String(row.MC).trim() : "";
            options.push({ xnxqdm: dm, displayName: `${mc || dm} (${dm})` });
        }
        if (options.length > 0) {
            console.log(`获取到 ${options.length} 个学期选项 (5学年范围内)`);
            return options;
        }
    } else {
        console.warn("学期列表为空, 使用兜底列表");
    }
    return generateSemesterOptions(currentYear);
}

/**
 * 让用户选择学年学期
 * 学期列表从教务系统动态获取 (失败回退手写列表)
 * 返回所选学期代码, 用户取消时返回 null
 */
async function selectTerm(currentTerm) {
    const options = await fetchTermOptions(currentTerm);
    const displayNames = options.map(o => o.displayName);

    // 默认选中当前学期, 找不到时 clamp 到 0
    let defaultIndex = options.findIndex(o => o.xnxqdm === currentTerm);
    if (defaultIndex < 0) defaultIndex = 0;

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(displayNames),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= options.length) {
        window.shiguangBridge.showToast("'_? 用户取消了导入");
        return null;
    }
    return options[selectedIndex].xnxqdm;
}

/**
 * 显示导入确认提示
 */
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "导入确认",
        "即将从教务系统导入课表, 请确保您已登录教务系统\n导入完成后请在App中仔细核对每门课程的时间, 地点和周次是否与教务系统一致, 勿漏为要",
        "我会确认, 开始吧"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("'_? 用户取消了导入");
        return false;
    }
    return true;
}

// -------- 请求工具 --------

async function api(url, options = {}) {
    const headers = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        ...(options.data && { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }),
        ...options.headers
    };
    let res;
    try {
        res = await fetch(url, {
            method: options.data ? "POST" : "GET",
            headers: headers,
            body: options.data || null,
            credentials: "include"
        });
    } catch (e) {
        throw new Error(`:( 网络请求失败 (${url}), 请检查网络连接`);
    }
    if (!res.ok) {
        throw new Error(`:( 请求失败 (HTTP ${res.status}), 请确认已登录教务系统`);
    }
    try {
        return await res.json();
    } catch (e) {
        console.error(":( 响应内容无法解析为 JSON:", url, e);
        throw new Error(":( 教务系统返回了无法解析的数据, 请确认已登录教务系统");
    }
}

// -------- 1. 获取学期信息 --------

async function getTermInfo() {
    // 1. 当前学期代码, 如 "2025-2026-1" (作为默认选项 + 兜底校验)
    const termRes = await api("/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do");
    const rows = termRes?.datas?.dqxnxq?.rows || [];
    const currentTerm = rows[0]?.DM;
    if (!currentTerm) {
        throw new Error(":( 无法获取当前学期代码, 请确认已登录教务系统");
    }
    console.log("检测到当前学期:", currentTerm);

    // 2. 让用户选择学期 (默认当前学期), 取消则整体终止
    const term = await selectTerm(currentTerm);
    if (!term) return null;
    console.log(">>> 已选择学期:", term);

    // 3. 所选学期的开学日期与周数 (失败提示, 非致命错误)
    let semesterStartDate = null;
    let termWeeks = null;
    try {
        // term 格式为 "学年1-学年2-学期序号", 如 "2026-2027-1"
        const [xn, xn2, xq] = term.split("-");
        const params = `XN=${xn}-${xn2}&XQ=${xq}`;
        console.log("查询学期开始日期参数:", params);
        const startRes = await api("/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do", {
            data: params
        });
        const row = startRes?.datas?.cxjcs?.rows?.[0];
        // 严格解析 YYYY-MM-DD, 兼容可能的 "2026-09-14 00:00:00" 及 ISO 格式
        // 不匹配置 null 走非致命路径
        const dateMatch = row?.XQKSRQ ? String(row.XQKSRQ).match(/^\d{4}-\d{2}-\d{2}/) : null;
        if (dateMatch) {
            semesterStartDate = dateMatch[0];
        }
        // ZJXZC: 教学周数(首选); ZZC: 学期总周数(含考试周, 次选)
        const parseWeeksField = (v) => {
            const s = String(v ?? "");
            if (!/^\d+$/.test(s)) return null;
            const n = parseInt(s, 10);
            return (n >= 1 && n <= MAX_NUM_OF_WEEKS) ? n : null;
        };
        termWeeks = parseWeeksField(row?.ZJXZC) || parseWeeksField(row?.ZZC) || null;
    } catch (e) {
        console.warn("获取学期开始日期失败(不影响导入):", e.message);
    }
    if (!semesterStartDate) {
        console.warn("未获取到学期开始日期(警告将在导入结果中提示)");
    }
    console.log("学期信息:", { semesterStartDate, termWeeks });

    return { term, semesterStartDate, termWeeks };
}

// -------- 2. 获取课表原始数据 --------

async function getCourseRows(term) {
    const res = await api("/jwapp/sys/wdkb/modules/xskcb/xskcb.do", {
        data: `XNXQDM=${encodeURIComponent(term)}`
    });
    const rows = res?.datas?.xskcb?.rows;
    console.log(`获取到 ${Array.isArray(rows) ? rows.length : 0} 条课表原始数据`);
    if (!Array.isArray(rows) || rows.length === 0) {
        // 已保证 `rows.length > 0`
        throw new Error(":( 该学期暂无课程数据(可能尚未排课)");
    }
    return rows;
}

// -------- 3. 解析与合并 --------

/**
 * 解析周次位图字符串, 如 "1111111111111111000" -> [1,2,...,16]
 * 格式校验: 仅允许 0/1 字符, 非法格式panic
 */
function parseWeekBitmap(name, bitmap) {
    if (!bitmap || typeof bitmap !== "string" || !/^[01]+$/.test(bitmap)) {
        throw new Error(`:( 课程 ${name} 数据异常: 周次格式非法 (${bitmap})`);
    }
    const weeks = [];
    for (let i = 0; i < bitmap.length; i++) {
        if (bitmap[i] === "1") {
            weeks.push(i + 1);
        }
    }
    return weeks;
}

/**
 * 检查上课日期(星期几), 开始/结束节次是否为整数, 若教务修改接口返回非纯`Int`字段, 应当panic
 * 格式校验: 仅允许数字传入
 */
function parseStrictUnsizedInt(name, field, value) {
    const s = String(value ?? "");
    if (!/^\d+$/.test(s)) {
        throw new Error(`:( 课程 ${name} 数据异常: ${field}非法 (${value})`);
    }
    const result = parseInt(s, 10);
    if (result < 1) {
        throw new Error(`:( 课程 ${name} 数据异常: ${field} 中 ${value} 不能小于 1`);
    }
    return result;
}

/**
 * 统一教师字段格式: 拆分, 去空白, 排序后重组
 * 避免 "张三,李四" 与 "李四,张三" 因顺序不同而漏合并
 */
function normalizeTeacher(teacher) {
    if (!teacher) return "未知教师";
    return teacher
        .split(/[,，、]/)
        .map(name => name.trim())
        .filter(name => name.length > 0)
        .sort()
        .join(",");
}

/**
 * 将单条原始数据映射为课程片段
 * 校验: 课程名, 星期(1-7), 周次任一非法即panic
 * 节次处理: 1-11 正常, 出现第12节即非法, panic
 */
function parseCourseRow(row) {
    if (!row || typeof row !== "object") {
        throw new Error(":( 课表数据异常: 课程条目格式非法");
    }
    const name = row.KCM ? String(row.KCM).trim() : "";
    if (!name) {
        throw new Error(":( 课表数据异常: 某条课程缺少课程名");
    }

    const day = parseStrictUnsizedInt(name, "SKXQ", row.SKXQ);
    // `parseStrictUnsizedInt`解析, 确保 day >= 1
    if (day > WEEK_DAYS) {
        throw new Error(`:( 课程 ${name} 数据异常: 星期值非法 (${row.SKXQ})`);
    }

    const startSection = parseStrictUnsizedInt(name, "KSJC", row.KSJC);
    const endSection = parseStrictUnsizedInt(name, "JSJC", row.JSJC);
    // 出现第12节或开始节次大于结束节次: 教务格式不可信, panic
    if (startSection > endSection || endSection > TOTAL_SECTION) {
        throw new Error(`:( 课程 ${name} 数据异常: 节次非法 (${row.KSJC}-${row.JSJC})`);
    }

    const weeks = parseWeekBitmap(name, String(row.SKZC ?? ""));
    // 全零位图（如 "0000..."）能通过格式校验但解析出空周次, 非法数据, panic
    if (weeks.length === 0) {
        throw new Error(`:( 课程 ${name} 数据异常: 周次信息缺失`);
    }

    const teacher = normalizeTeacher(row.SKJS);
    // 上课地点为空时用校区名
    const position = (row.JASMC && String(row.JASMC).trim() !== "")
        ? String(row.JASMC).trim()
        : (row.XXXQDM_DISPLAY || "未知地点");

    return {
        course: {
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        }
    };
}

/**
 * 合并去重: 课程名, 教师, 地点, 星期, 节次相同(仅周次不同)的片段合并为一条,
 * 周次取并集, 完全重复的行也在此步骤合并
 */
function mergeCourses(courseList) {
    const merged = new Map();
    for (const course of courseList) {
        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.startSection,
            course.endSection
        ].join("|");

        if (merged.has(key)) {
            const existing = merged.get(key);
            const union = [...new Set([...existing.weeks, ...course.weeks])].sort((a, b) => a - b);
            existing.weeks = union;
        } else {
            merged.set(key, { ...course, weeks: [...course.weeks] });
        }
    }
    const result = [...merged.values()];
    console.log(`合并去重: 原始 ${courseList.length} 条 -> 合并后 ${result.length} 条`);
    return result;
}

// -------- 4. 汇总解析 --------

function parseAllCourses(rows, termWeeks) {
    const courseList = [];
    for (const row of rows) {
        courseList.push(parseCourseRow(row).course);
    }
    const courses = mergeCourses(courseList);

    // 学期总周数: 取接口教学周数与课程最大周的较大者, 默认 16 兜底
    let maxCourseWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxCourseWeek) maxCourseWeek = week;
        }
    }
    const totalWeeks = Math.max(termWeeks || 0, maxCourseWeek) || DEFAULT_NUM_OF_WEEKS;
    console.log(`学期总周数: ${totalWeeks} (接口值: ${termWeeks}, 课程最大周: ${maxCourseWeek})`);

    // 作息时间: 按当前日期选择（5月-9月为夏季作息）
    const month = new Date().getMonth() + 1;
    const isSummer = month >= 5 && month <= 9;
    const timeSlots = isSummer ? SUMMER_TIME_SLOTS : WINTER_TIME_SLOTS;
    console.log(`当前为${isSummer ? "夏季" : "冬季"}作息`);

    return {
        courses,
        timeSlots,
        totalWeeks,
        seasonTip: isSummer ? "已按当前日期使用夏季作息 (5/1-10/1)" : "已按当前日期使用冬季作息 (10/1-次年5/1)"
    };
}

// -------- 5. 保存流程 --------

// 仅在拿到开学日期时调用
// 原因: saveCourseConfig 是整体覆盖语义, bridge 会把缺失字段补成默认值写入,
// 不带开学日期调用会清空用户原有配置, 而开学日期是周次推算的起点, 丢失可能导致周次全错
async function saveConfig(semesterStartDate, totalWeeks) {
    const configData = {
        semesterStartDate: semesterStartDate,
        semesterTotalWeeks: totalWeeks || DEFAULT_NUM_OF_WEEKS,
        defaultClassDuration: CLASS_DURATION,
        defaultBreakDuration: BREAK_DURATION,
        firstDayOfWeek: FIRST_DAY_OF_WEEK
    };
    const success = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
    if (!success) {
        throw new Error(":( 学期配置保存失败");
    }
    console.log("课表配置保存成功:", configData);
}

async function saveTimeSlots(timeSlots) {
    const success = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    if (!success) {
        throw new Error(":( 时间段保存失败");
    }
    console.log("时间段保存成功:", timeSlots);
}

async function saveCourses(courses) {
    const success = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (!success) {
        throw new Error(":( 课程数据保存失败");
    }
    console.log(`课程数据保存成功, 共 ${courses.length} 条`);
}

// -------- 主导入流程 --------

/**
 * 单次导入尝试
 * 返回值:
 *   "success" - 导入成功 (已通知App)
 *   "cancel"  - 用户主动取消或无需重试的流程终止 (静默结束)
 *   "retry"   - 导入失败且用户选择重试
 */
async function importOnce() {
    try {
        const termInfo = await getTermInfo();
        // 用户在学期选择弹窗取消: 静默退出, 不走 catch 的失败提示
        if (!termInfo) return "cancel";

        const rows = await getCourseRows(termInfo.term);

        const { courses, timeSlots, totalWeeks, seasonTip } = parseAllCourses(rows, termInfo.termWeeks);

        // saveCourseConfig 为整体覆盖语义: 无开学日期时跳过写入, 避免清空用户已有配置
        // (开学日期是周次推算的起点, 不应错误, 由用户在App中手动设置)
        // 警告并入最终成功提示, 避免被后续 toast 顶掉
        let configSkipTip = "";
        if (termInfo.semesterStartDate) {
            await saveConfig(termInfo.semesterStartDate, totalWeeks);
        } else {
            console.warn("跳过学期配置写入(无开学日期)");
            const semCode = termInfo.term.split("-")[2];
            const isUnconventional = semCode === "3" || semCode === "4";
            configSkipTip = isUnconventional
                ? ". 注意: 未获取到开学日期, 未写入学期配置, 请在App中手动设置开学日期并仔细核对周次"
                : ". 注意: 未获取到开学日期, 未写入学期配置, 请在App中手动设置开学日期并核对周次";
        }
        await saveTimeSlots(timeSlots);
        await saveCourses(courses);

        window.shiguangBridge.showToast(`>_ 导入成功! 共 ${courses.length} 条课程 (${seasonTip})${configSkipTip}`);
        window.shiguangBridge.notifyTaskCompletion();
        return "success";

    } catch (error) {
        console.error(":( 主流程异常:", error);
        // 失败后提供重试入口, 无需刷新网页 (脚本在本页持续等待用户操作)
        // 弹窗关闭/取消即视为放弃重试, 天然不会死循环
        try {
            const wantsRetry = await window.shiguangBridgePromise.showAlert(
                "导入失败",
                `${error.message}\n\n可点击重试, 无需刷新网页`,
                "重试导入"
            );
            return wantsRetry ? "retry" : "cancel";
        } catch (alertError) {
            // 重试弹窗自身异常(如bridge故障): 降级为放弃重试, 避免未处理的Promise rejection
            console.error(":( 重试弹窗显示失败:", alertError);
            return "cancel";
        }
    }
}

async function runImportFlow() {
    let isReady;
    try {
        isReady = await promptUserToStart();
    } catch (err) {
        console.error(":( 确认弹窗异常:", err);
        return; // bridge 不通, 放弃
    }
    // 开始确认仅询问一次, 重试时跳过
    if (!isReady) return;

    while (true) {
        const result = await importOnce();
        if (result !== "retry") break;
        window.shiguangBridge.showToast(">>> 重试导入");
    }
}

// 启动导入流程
runImportFlow();
