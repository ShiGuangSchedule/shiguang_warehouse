// 德州学院（dzu.edu.cn）拾光课程表适配脚本
// 基于正方教务 jwglxt 接口适配，已于 2026-09-04 在德州学院教务系统实测通过
// 2026-09-06 按 review 意见修订：采用官方 Wiki《课程合并与去重函数》替换简单去重
// 2026-09-08 修正作息：按德院助手《德院校历|作息表》对齐为 13 节制（下午从第 6 节起）
// 作息时间来源：德院助手《德院校历|作息表》 https://www.yuque.com/deyuanzhushou/enoc41/pgw3sfnopsf6avpy
//
// 使用方式：进入教务系统登录后，在任意页面点击"执行导入"，
// 自动读取学年学期供选择，自动获取开学日期与总周数，自动写入德州学院作息时间。

const COURSE_API_URL = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";
const WEEK_API_URL = "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
const INDEX_API_URL = "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151";

// 德州学院作息时间表（全年统一，不分夏季冬季）
// 第 5 节为 25 分钟短节（11:50-12:15），上午（含实验连排）统一 12:15 结束：
// 实验 3 小节（第 3-5 节）10:00-12:15 = 第3节45分 + 课间10 + 第4节45分 + 课间10 + 第5节25分。
const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "11:50", endTime: "12:15" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:55", endTime: "16:40" },
    { number: 9, startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "18:20", endTime: "19:05" },
    { number: 11, startTime: "19:10", endTime: "19:55" },
    { number: 12, startTime: "20:05", endTime: "20:50" },
    { number: 13, startTime: "20:55", endTime: "21:40" }
];

function parseSections(rawText) {
    const match = String(rawText || "").match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
    if (!match) return [];

    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) {
        return [];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseWeeks(rawText) {
    const weeks = new Set();
    const normalized = String(rawText || "")
        .replace(/周数[:：]?/g, "")
        .replace(/第/g, "")
        .replace(/[，、；;]/g, ",")
        .replace(/（/g, "(")
        .replace(/）/g, ")");

    normalized.split(",").forEach((segment) => {
        const cleanSegment = segment.replace(/周/g, "").trim();
        if (!cleanSegment) return;

        const isOdd = cleanSegment.includes("单");
        const isEven = cleanSegment.includes("双");
        const rangeMatch = cleanSegment.match(/(\d+)(?:\s*[-~至]\s*(\d+))?/);
        if (!rangeMatch) return;

        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2] || rangeMatch[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > end) return;

        for (let week = start; week <= end; week += 1) {
            if (isOdd && week % 2 === 0) continue;
            if (isEven && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });

    return Array.from(weeks).sort((left, right) => left - right);
}

/**
 * 节次与周次合并去重函数
 * 来源：官方 Wiki《课程合并与去重函数》
 * https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
 * 功能：连续节次合并（1-2节+3-4节→1-4节）、同节次周次合并（单双周→全周）、完全去重、周次排序
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

function parseApiData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        throw new Error("教务系统返回的数据格式发生变化，请联系适配器维护者。");
    }

    const courses = jsonData.kbList.flatMap((rawCourse) => {
        const name = String(rawCourse.kcmc || "").trim();
        const teacher = String(rawCourse.xm || "未知").trim() || "未知";
        const position = String(rawCourse.cdmc || "待定").trim() || "待定";
        const day = Number(rawCourse.xqj);
        const sections = parseSections(rawCourse.jcs);
        const weeks = parseWeeks(rawCourse.zcd);

        if (!name || !Number.isInteger(day) || day < 1 || day > 7 || !sections.length || !weeks.length) {
            return [];
        }

        return [{
            name,
            teacher,
            position,
            day,
            startSection: sections[0],
            endSection: sections[sections.length - 1],
            weeks
        }];
    });

    return mergeAndDistinctCourses(courses).sort((left, right) =>
        left.day - right.day ||
        left.startSection - right.startSection ||
        left.name.localeCompare(right.name)
    );
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "德州学院课表导入",
        "请先登录德州学院教务系统。登录成功后可在教务系统任意页面开始导入。",
        "开始导入"
    );
}

/**
 * 从教务系统读取学年学期选项（已实测：#xnm 为学年下拉框，#xqm 为学期下拉框，
 * 学期码 3=第一学期、12=第二学期）
 */
async function fetchAcademicOptions() {
    try {
        const response = await fetch(INDEX_API_URL, { method: "GET", credentials: "include" });
        if (!response.ok) return null;

        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        // 默认选中项：优先教务系统自带的 selected，否则按当前日期推算
        const now = new Date();
        const defaultYear = String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
        const defaultSemester = (now.getMonth() >= 7 || now.getMonth() === 0) ? "3" : "12";

        const sysYearIndex = allYearOptions.findIndex(opt => opt.selected);
        const calcYearIndex = allYearOptions.findIndex(opt => opt.value === defaultYear);
        const defaultYearIndex = sysYearIndex !== -1 ? sysYearIndex
            : (calcYearIndex !== -1 ? calcYearIndex : 0);

        const sysSemIndex = semesterOptions.findIndex(opt => opt.selected);
        const calcSemIndex = semesterOptions.findIndex(opt => opt.value === defaultSemester);
        const defaultSemesterIndex = sysSemIndex !== -1 ? sysSemIndex
            : (calcSemIndex !== -1 ? calcSemIndex : 0);

        return { allYearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex };
    } catch (e) {
        return null;
    }
}

async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        // 读取失败不阻断流程：退化为手动输入
        window.shiguangBridge.showToast("自动读取学年学期失败，改为手动输入。");
        return await manualSelectAcademicYearAndSemester();
    }

    const { allYearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(allYearOptions.map(item => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;
    const academicYear = allYearOptions[yearIndex].value;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map(item => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;
    const semesterCode = semesterOptions[semesterIndex].value;

    return { academicYear, semesterCode };
}

/** 兜底：手动输入学年起始年 + 选择学期 */
async function manualSelectAcademicYearAndSemester() {
    const now = new Date();
    const defaultYear = String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
    const academicYear = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入学年的起始年份，例如 2026-2027 学年请输入 2026。",
        defaultYear,
        "validateYearInput"
    );
    if (academicYear === null) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(["第一学期", "第二学期"]),
        now.getMonth() >= 7 || now.getMonth() === 0 ? 0 : 1
    );
    if (semesterIndex === null || semesterIndex === -1) return null;
    return { academicYear: String(academicYear).trim(), semesterCode: semesterIndex === 0 ? "3" : "12" };
}

function validateYearInput(input) {
    return /^\d{4}$/.test(String(input || "").trim())
        ? false
        : "请输入四位数字的起始学年，例如 2026。";
}

/**
 * 获取学期开学日期与总周数
 * 已实测：返回数组每项含 rq（如 "2026-09-07/2026-09-13"）与 zs（周序号）
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    try {
        const response = await fetch(WEEK_API_URL, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });

        if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json) && json.length > 0) {
                const firstWeek = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
                let semesterStartDate = null;
                if (firstWeek.rq) {
                    const startDateStr = String(firstWeek.rq).split('/')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) semesterStartDate = startDateStr;
                }
                return { semesterStartDate, semesterTotalWeeks: json.length };
            }
        }
    } catch (e) {
        // 获取失败不影响主流程
    }
    return { semesterStartDate: null, semesterTotalWeeks: null };
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在获取课表数据...");

    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;

    const [courseResponse, semesterInfo] = await Promise.all([
        fetch(COURSE_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: requestBody,
            credentials: "include"
        }),
        fetchSemesterInfo(academicYear, semesterCode)
    ]);

    if (!courseResponse.ok) {
        throw new Error(`请求课表失败（HTTP ${courseResponse.status}）。`);
    }

    const responseText = await courseResponse.text();
    if (courseResponse.redirected || /login_slogin|用户登录|德州学院教学综合信息服务平台/.test(responseText)) {
        throw new Error("登录状态已失效，请重新登录教务系统后再试。");
    }

    let jsonData;
    try {
        jsonData = JSON.parse(responseText);
    } catch (error) {
        throw new Error("教务系统未返回有效课表数据，请确认已经登录。");
    }

    const courses = parseApiData(jsonData);
    if (!courses.length) {
        throw new Error("所选学期未查询到课程，请检查学年和学期是否正确。");
    }

    return { courses, semesterInfo };
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error("DZU: Save courses error", error);
        await window.shiguangBridgePromise.showAlert("保存失败", `课程保存失败：${error.message}`, "确定");
        return false;
    }
}

async function saveOptionalSettings(courses, semesterInfo) {
    // 总周数：优先用教务系统返回的周数，否则按课表最大周推断
    const config = {
        semesterStartDate: semesterInfo.semesterStartDate,
        semesterTotalWeeks: semesterInfo.semesterTotalWeeks || Math.max(...courses.flatMap(c => c.weeks)),
        firstDayOfWeek: 1
    };

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        let msg = "课表配置更新成功！";
        if (config.semesterStartDate) msg += ` 开学日期：${config.semesterStartDate}`;
        if (config.semesterTotalWeeks) msg += ` 共${config.semesterTotalWeeks}周`;
        window.shiguangBridge.showToast(msg);
    } catch (error) {
        console.error("DZU: Save config error", error);
        window.shiguangBridge.showToast(`课表配置保存失败：${error.message}`);
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        window.shiguangBridge.showToast("德州学院作息时间写入成功！");
    } catch (error) {
        console.error("DZU: Save time slots error", error);
        window.shiguangBridge.showToast(`作息时间保存失败：${error.message}`);
    }
}

async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    const { academicYear, semesterCode } = selection;

    let result;
    try {
        result = await fetchAndParseCourses(academicYear, semesterCode);
    } catch (error) {
        console.error("DZU: Fetch or parse error", error);
        await window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
        return;
    }

    const saved = await saveCourses(result.courses);
    if (!saved) return;

    await saveOptionalSettings(result.courses, result.semesterInfo);
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${result.courses.length} 条课程安排。`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
