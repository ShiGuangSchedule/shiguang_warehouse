// 中山大学教务系统课表导入器
// 功能：获取教务系统课表 -> 转换为目标 JSON -> 通过时光课程表 V2 Bridge 导入

const API_URL = "/jwxt/timetable-search/stuTimeTabPrint/studentQuery";
const CALENDAR_API_URL = "/jwxt/base-info/school-calender";
let ACAD_YEAR = "2026-1";

function validateYearInput(input) {
    return /^[0-9]{4}$/.test(String(input).trim())
        ? false
        : "请输入四位数字的学年！";
}

async function getAcademicYear() {
    const defaultYear = ACAD_YEAR.split("-")[0];

    const yearSelection = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的学年（如 2026）：",
        defaultYear || "2026",
        "validateYearInput"
    );

    return yearSelection;
}

async function selectSemester() {
    if (!window.shiguangBridgePromise) {
        throw new Error(
            "shiguangBridgePromise 不可用，请在时光课程表 App 内运行此适配器。"
        );
    }

    if (typeof window.shiguangBridgePromise.showPrompt !== "function") {
        throw new Error(
            "shiguangBridgePromise.showPrompt 不可用，请在时光课程表 App 内运行此适配器。"
        );
    }

    if (typeof window.shiguangBridgePromise.showSingleSelection !== "function") {
        throw new Error(
            "shiguangBridgePromise.showSingleSelection 不可用，请在时光课程表 App 内运行此适配器。"
        );
    }

    // 先输入学年
    const yearSelection = await getAcademicYear();

    if (yearSelection === null) {
        return null;
    }

    const year = String(yearSelection).trim();

    // 再选择学期
    const semesters = [
        "1（第一学期）",
        "2（第二学期）"
    ];

    const [, defaultSemester] = ACAD_YEAR.split("-");

    const semesterIndex =
        await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesters),
            defaultSemester === "2" ? 1 : 0
        );

    if (
        semesterIndex === null ||
        semesterIndex < 0 ||
        semesterIndex >= semesters.length
    ) {
        return null;
    }

    ACAD_YEAR = `${year}-${semesterIndex + 1}`;

    return ACAD_YEAR;
}


// ========================================
// 目标课表时间段
// ========================================

const TIME_SLOTS = [
    {
        number: 1,
        startTime: "08:00",
        endTime: "08:45"
    },
    {
        number: 2,
        startTime: "08:55",
        endTime: "09:40"
    },
    {
        number: 3,
        startTime: "10:10",
        endTime: "10:55"
    },
    {
        number: 4,
        startTime: "11:05",
        endTime: "11:50"
    },
    {
        number: 5,
        startTime: "14:20",
        endTime: "15:05"
    },
    {
        number: 6,
        startTime: "15:15",
        endTime: "16:00"
    },
    {
        number: 7,
        startTime: "16:30",
        endTime: "17:15"
    },
    {
        number: 8,
        startTime: "17:25",
        endTime: "18:10"
    },
    {
        number: 9,
        startTime: "19:00",
        endTime: "19:45"
    },
    {
        number: 10,
        startTime: "19:55",
        endTime: "20:40"
    },
    {
        number: 11,
        startTime: "20:50",
        endTime: "21:35"
    }
];


// ========================================
// 课表配置
// ========================================

const CONFIG_BASE = {
    semesterTotalWeeks: 20,
    defaultClassDuration: 45,
    defaultBreakDuration: 10
};


// ========================================
// 自动获取学期实际开学日期
// ========================================

async function fetchSemesterStartDate() {
    const url =
        `${CALENDAR_API_URL}?academicYear=${encodeURIComponent(ACAD_YEAR)}` +
        `&weekly=1&_t=${Math.floor(Date.now() / 1000)}`;

    const response = await fetch(url, {
        method: "GET",
        credentials: "include"
    });

    if (!response.ok) {
        throw new Error(
            `获取学期开始日期失败：HTTP ${response.status}`
        );
    }

    const json = await response.json();
    const startDate = json?.data?.startTime;

    if (!startDate) {
        throw new Error(
            `教务系统未返回 ${ACAD_YEAR} 第 1 周的开始日期。`
        );
    }

    return startDate;
}


async function buildCourseConfig() {
    const semesterStartDate =
        await fetchSemesterStartDate();

    return {
        semesterStartDate,
        ...CONFIG_BASE
    };
}


// 请求课程数据

async function fetchCourses() {
    const url = `${API_URL}?_t=${Date.now()}`;
    const payload = {
        acadYear: ACAD_YEAR,
        submitFlag: "1",
        nothroughCourseFlag: "1"
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `API 请求失败：HTTP ${response.status}\n${responseText}`
        );
    }

    let json;

    try {
        json = JSON.parse(responseText);
    } catch {
        throw new Error("教务系统返回的课程数据不是有效的 JSON。\n");
    }

    if (json?.code !== 200) {
        throw new Error(
            `API 返回异常 code：${json?.code}`
        );
    }

    const timetable = json?.data?.timetable;

    if (
        !timetable ||
        typeof timetable !== "object" ||
        Array.isArray(timetable)
    ) {
        throw new Error(
            "API 返回中不存在有效的 data.timetable"
        );
    }

    const courses = [];

    // timetable 的 key：
    // 第一位 = 星期
    // 后两位 = 起始节次
    //
    // 例如：
    // 11 -> 周一第1节
    // 13 -> 周一第3节
    // 21 -> 周二第1节

    for (const entries of Object.values(timetable)) {
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }

        for (const item of entries) {
            const course = normalizeCourse(item);

            if (course) {
                courses.push(course);
            }
        }
    }

    // 自动获取学期配置
    const config = await buildCourseConfig();

    const result = {
        courses,
        timeSlots: TIME_SLOTS,
        config
    };

    return result;
}


// 课程数据转换

function normalizeCourse(item) {
    if (!item || typeof item !== "object") {
        return null;
    }

    const name = cleanCourseName(item.courseName);
    const teacher = cleanText(item.teachingStaffName);
    const position = cleanText(item.classPlace);
    const day = toNumber(item.week);
    const startSection = toNumber(item.startClassTimes);
    const endSection = toNumber(item.endClassTimes);
    const startWeek = toNumber(item.startWeek);
    const weeks = parseWeeks(item.timeDetail, startWeek);

    if (
        !name ||
        !day ||
        !startSection ||
        !endSection ||
        weeks.length === 0
    ) {
        console.warn(
            "跳过字段不完整的课程记录：",
            item
        );

        return null;
    }

    return {
        id: crypto.randomUUID(),

        name,

        teacher,

        position,

        day,

        startSection,

        endSection,

        weeks
    };
}


// 清理课程名称

function cleanCourseName(value) {
    const text = cleanText(value);

    // 去掉中山大学 API 返回的课程类别前缀
    //
    // 本(专必)高等数学一（I）
    // ↓
    // 高等数学一（I）
    //
    // 本(公必)劳动教育
    // ↓
    // 劳动教育

    return text
        .replace(/^本\([^)]*\)/, "")
        .trim();
}


// 解析上课周次

function parseWeeks(
    timeDetail,
    startWeek = 1
) {
    const text =
        cleanText(timeDetail);

    if (!text) {
        return startWeek
            ? [startWeek]
            : [];
    }

    // 例如：
    // 1-17每周

    const rangeMatch =
        text.match(/(\d+)\s*-\s*(\d+)/);

    if (rangeMatch) {
        const start =
            Number(rangeMatch[1]);

        const end =
            Number(rangeMatch[2]);

        if (
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            end >= start
        ) {
            return Array.from(
                {
                    length:
                        end - start + 1
                },
                (_, index) =>
                    start + index
            );
        }
    }

    // 兼容：
    //
    // 1,3,5周
    // 1、3、5周

    const numbers =
        text
            .match(/\d+/g)
            ?.map(Number)
            .filter(Number.isFinite) || [];

    if (numbers.length > 0) {
        return [
            ...new Set(numbers)
        ].sort(
            (a, b) => a - b
        );
    }

    return startWeek
        ? [startWeek]
        : [];
}


// 清理字符串

function cleanText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).replace(/\/+$/g, "").trim();
}


// 数字转换

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}





// 主导入流程

async function runImportFlow() {
    try {
        // 提示用户选择学期

        if (
            window.shiguangBridge &&
            typeof window.shiguangBridge.showToast ===
                "function"
        ) {
            window.shiguangBridge.showToast(
                "请选择要导入的学期..."
            );
        }

        const selectedSemester =
            await selectSemester();

        if (!selectedSemester) {
            if (
                window.shiguangBridge &&
                typeof window.shiguangBridge.showToast ===
                    "function"
            ) {
                window.shiguangBridge.showToast(
                    "已取消导入。"
                );
            }

            return;
        }

        // 获取课程

        const data =
            await fetchCourses();

        if (
            !data ||
            !Array.isArray(data.courses)
        ) {
            throw new Error(
                "课程数据为空或格式不正确。"
            );
        }

        // 检查 V2 Bridge

        if (
            !window.shiguangBridgePromise
        ) {
            throw new Error(
                "shiguangBridgePromise 不可用，请在时光课程表 App 内运行此适配器。"
            );
        }

        if (
            typeof window.shiguangBridgePromise
                .saveImportedCourses !==
            "function"
        ) {
            throw new Error(
                "saveImportedCourses API 不可用。"
            );
        }

        if (
            typeof window.shiguangBridgePromise
                .savePresetTimeSlots !==
            "function"
        ) {
            throw new Error(
                "savePresetTimeSlots API 不可用。"
            );
        }

        if (
            typeof window.shiguangBridgePromise
                .saveCourseConfig !==
            "function"
        ) {
            throw new Error(
                "saveCourseConfig API 不可用。"
            );
        }

        // 开始导入

        if (
            window.shiguangBridge &&
            typeof window.shiguangBridge.showToast ===
                "function"
        ) {
            window.shiguangBridge.showToast(
                `正在导入 ${data.courses.length} 条课程记录...`
            );
        }

        // 保存课程

        await window.shiguangBridgePromise
            .saveImportedCourses(
                JSON.stringify(
                    data.courses
                )
            );

        // 保存时间段

        await window.shiguangBridgePromise
            .savePresetTimeSlots(
                JSON.stringify(
                    data.timeSlots
                )
            );

        // 保存课表配置

        await window.shiguangBridgePromise
            .saveCourseConfig(
                JSON.stringify(
                    data.config
                )
            );

        // 导入完成

        if (
            window.shiguangBridge &&
            typeof window.shiguangBridge.showToast ===
                "function"
        ) {
            window.shiguangBridge.showToast(
                `成功导入 ${data.courses.length} 条课程记录！`
            );
        }

        // 通知 App 导入流程结束

        if (
            window.shiguangBridge &&
            typeof window.shiguangBridge
                .notifyTaskCompletion ===
                "function"
        ) {
            window.shiguangBridge
                .notifyTaskCompletion();
        }

    } catch (error) {
        if (
            window.shiguangBridge &&
            typeof window.shiguangBridge.showToast ===
                "function"
        ) {
            window.shiguangBridge.showToast(
                `导入失败：${error.message}`
            );
        }
    }
}


// 启动

runImportFlow();