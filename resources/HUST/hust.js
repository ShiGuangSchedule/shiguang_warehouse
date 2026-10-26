/**
 * 华中科技大学 HUB 系统课表适配器。
 *
 * 接口与解析规则参考 StayUP-Calendar 的 HUST importer：
 * https://github.com/Lucas04-nhr/StayUP-Calendar/blob/main/lib/src/pages/crawler/hust.dart
 */

const HUST_COURSE_API = new URL("/LsController/findNameCourse", location.origin).toString();
const HUST_DEFAULT_SEMESTER_WEEKS = 20;

function getDefaultTerm(now = new Date()) {
    return {
        academicYear: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
        semester: now.getMonth() >= 1 && now.getMonth() <= 6 ? 2 : 1
    };
}

/**
 * 生成与原 importer 相同范围的学期：当前年份前 4 年至后 1 年，共 12 个。
 * semester=1 为秋季，semester=2 为春季；倒序排列便于优先选择近期学期。
 */
function buildTermOptions(now = new Date()) {
    const currentYear = now.getFullYear();
    const terms = [];

    for (let year = currentYear + 1; year >= currentYear - 4; year--) {
        terms.push({ academicYear: year, semester: 1, label: `${year} 年秋季学期` });
        terms.push({ academicYear: year, semester: 2, label: `${year} 年春季学期` });
    }

    return terms;
}

async function selectTerm() {
    const terms = buildTermOptions();
    const defaultTerm = getDefaultTerm();
    const defaultIndex = Math.max(0, terms.findIndex((term) =>
        term.academicYear === defaultTerm.academicYear &&
        term.semester === defaultTerm.semester
    ));

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(terms.map((term) => term.label)),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= terms.length) {
        throw new Error("学期选择结果无效");
    }

    return terms[selectedIndex];
}

function parsePositiveInteger(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function expandWeeks(startWeek, endWeek) {
    const weeks = [];
    for (let week = startWeek; week <= endWeek; week++) {
        weeks.push(week);
    }
    return weeks;
}

/**
 * HUST 的一门课程可包含多个 tr 时段。本项目没有 extraSlots 字段，
 * 因此每个有效时段转换成一个标准课程块。
 */
function parseCourses(payload) {
    if (!payload || String(payload.code) !== "200" || !Array.isArray(payload.data)) {
        throw new Error(`课表接口返回异常（code: ${payload?.code ?? "未知"}）`);
    }

    const courses = [];

    for (const item of payload.data) {
        const name = String(item?.KCMC ?? "").trim();
        if (!name || !Array.isArray(item?.tr)) {
            continue;
        }

        for (const slot of item.tr) {
            if (slot?.XQS === "<待定>" || slot?.QSJC === "<待定>") {
                continue;
            }

            const day = parsePositiveInteger(slot?.XQS);
            const startSection = parsePositiveInteger(slot?.QSJC);
            const endSection = parsePositiveInteger(slot?.JSJC);
            const startWeek = parsePositiveInteger(slot?.QSZC);
            const endWeek = parsePositiveInteger(slot?.JSZC);

            if (
                day === null || day > 7 ||
                startSection === null || endSection === null || endSection < startSection ||
                startWeek === null || endWeek === null || endWeek < startWeek
            ) {
                console.warn("跳过无法解析的 HUST 课程时段:", name, slot);
                continue;
            }

            courses.push({
                name,
                teacher: String(slot?.XM ?? "").trim(),
                position: String(slot?.JSMC ?? "").trim(),
                day,
                startSection,
                endSection,
                weeks: expandWeeks(startWeek, endWeek)
            });
        }
    }

    return courses;
}

async function fetchCourses(term) {
    const termCode = `${term.academicYear}${term.semester}`;
    const response = await fetch(`${HUST_COURSE_API}?kcbxqh=${encodeURIComponent(termCode)}`, {
        method: "GET",
        credentials: "include",
        headers: {
            Accept: "application/json, text/plain, */*"
        }
    });

    if (!response.ok) {
        throw new Error(`课表请求失败（HTTP ${response.status}）`);
    }

    const raw = await response.text();
    if (!raw.trim() || raw.trim().startsWith("<")) {
        throw new Error("未读取到课表数据，请确认已登录 HUB 系统并选择了正确的学期");
    }

    try {
        return parseCourses(JSON.parse(raw));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error("课表接口未返回有效 JSON，请重新登录后再试");
        }
        throw error;
    }
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    const semesterTotalWeeks = courses.reduce((maximum, course) => {  
        const courseMaximum = course.weeks.length > 0 ? Math.max(...course.weeks) : 0;  
        return Math.max(maximum, courseMaximum);  
    }, HUST_DEFAULT_SEMESTER_WEEKS);  

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks }));  
}

async function runImportFlow() {
    try {
        const term = await selectTerm();
        if (term === null) {
            window.shiguangBridge.showToast("已取消导入");
            return;
        }

        window.shiguangBridge.showToast(`正在获取 ${term.label} 课表...`);
        const courses = await fetchCourses(term);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("该学期未查询到有效课程，请检查学期或登录状态");
            return;
        }

        await saveCourses(courses);
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程时段，请按校历设置开学日期`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("课表导入失败:", error);
        window.shiguangBridge.showToast(`导入失败：${error?.message ?? error}`);
    }
}

runImportFlow();
