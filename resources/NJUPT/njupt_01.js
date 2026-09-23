// 南京邮电大学正方教务（V9）拾光课程表适配脚本
// 通过正方 API 获取课程与学期第一周日期

const NJUPT_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:50", endTime: "10:35" },
    { number: 4, startTime: "10:40", endTime: "11:25" },
    { number: 5, startTime: "11:30", endTime: "12:15" },
    { number: 6, startTime: "13:45", endTime: "14:30" },
    { number: 7, startTime: "14:35", endTime: "15:20" },
    { number: 8, startTime: "15:35", endTime: "16:20" },
    { number: 9, startTime: "16:25", endTime: "17:10" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:25", endTime: "20:10" },
    { number: 12, startTime: "20:20", endTime: "21:05" }
];

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(course => ({
        ...course,
        name: course.name || "",
        teacher: course.teacher || "",
        position: course.position || "",
        weeks: Array.isArray(course.weeks)
            ? [...course.weeks].sort((a, b) => a - b)
            : []
    }));

    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        a.day - b.day ||
        a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
        a.startSection - b.startSection
    );

    const sectionMerged = [];
    let current = list[0];
    for (let index = 1; index < list.length; index++) {
        const next = list[index];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");
        const continuous = current.endSection + 1 === next.startSection;
        const duplicate =
            current.startSection === next.startSection &&
            current.endSection === next.endSection;

        if (sameCourseAndWeeks && continuous) {
            current.endSection = next.endSection;
        } else if (!sameCourseAndWeeks || !duplicate) {
            sectionMerged.push(current);
            current = next;
        }
    }
    sectionMerged.push(current);

    sectionMerged.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.endSection - b.endSection
    );

    const result = [];
    let merged = sectionMerged[0];
    for (let index = 1; index < sectionMerged.length; index++) {
        const next = sectionMerged[index];
        const sameCourseAndSections =
            merged.name === next.name &&
            merged.teacher === next.teacher &&
            merged.position === next.position &&
            merged.day === next.day &&
            merged.startSection === next.startSection &&
            merged.endSection === next.endSection;

        if (sameCourseAndSections) {
            merged.weeks = [...new Set([...merged.weeks, ...next.weeks])]
                .sort((a, b) => a - b);
        } else {
            result.push(merged);
            merged = next;
        }
    }
    result.push(merged);
    return result;
}

function parseWeeks(weekText) {
    if (!weekText) return [];

    const weeks = [];
    for (const segment of String(weekText).split(/[，,]/)) {
        const normalized = segment.trim().replace(/（/g, "(").replace(/）/g, ")");
        const match = normalized.match(/(\d+)(?:-(\d+))?\s*周?/);
        if (!match) continue;

        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : start;
        const oddOnly = normalized.includes("(单)");
        const evenOnly = normalized.includes("(双)");

        for (let week = start; week <= end; week++) {
            if (oddOnly && week % 2 === 0) continue;
            if (evenOnly && week % 2 !== 0) continue;
            weeks.push(week);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: API 数据中缺少 kbList。");
        return [];
    }

    const courses = [];
    for (const rawCourse of jsonData.kbList) {
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeks = parseWeeks(rawCourse.zcd);
        const sectionNumbers = String(rawCourse.jcs).match(/\d+/g)?.map(Number) || [];
        const day = Number(rawCourse.xqj);
        const startSection = sectionNumbers[0];
        const endSection = sectionNumbers[sectionNumbers.length - 1];

        if (
            weeks.length === 0 ||
            !Number.isInteger(day) || day < 1 || day > 7 ||
            !Number.isInteger(startSection) || !Number.isInteger(endSection) ||
            startSection < 1 || startSection > endSection
        ) {
            continue;
        }

        courses.push({
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day,
            startSection,
            endSection,
            weeks
        });
    }

    return mergeAndDistinctCourses(courses);
}

function getNjuptApiBasePath() {
    // 直接匹配路径，避免依赖教务页面可能改写的数组和字符串方法。
    const isTeachingSystemPage = /\/(?:kbcx|xtgl)\//.test(window.location.pathname);
    if (!isTeachingSystemPage) return null;

    // 南邮 WebVPN 会拦截并改写根相对请求。若传入已经带 WebVPN
    // 哈希前缀的完整 URL，会被二次改写成“当前页面.htm/kbcx/...”。
    return "";
}

async function postForm(url, requestBody) {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: requestBody,
        credentials: "include"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
}

async function fetchAcademicOptions(appBasePath) {
    const url = `${appBasePath}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;
    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });
        if (!response.ok) return null;

        const html = await response.text();
        const document = new DOMParser().parseFromString(html, "text/html");
        const readOptions = selector => {
            const nodes = document.querySelectorAll(selector);
            const options = [];
            for (let index = 0; index < nodes.length; index++) {
                const option = nodes[index];
                const value = String(option.value || "").trim();
                const text = String(option.textContent || "").trim();
                if (value === "" || text === "") continue;
                options.push({ value, text, selected: option.selected });
            }
            return options;
        };
        const allYearOptions = readOptions("#xnm option");
        const semesterOptions = readOptions("#xqm option");

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        const selectedYearIndex = allYearOptions.findIndex(option => option.selected);
        const start = selectedYearIndex === -1 ? 0 : Math.max(0, selectedYearIndex - 2);
        const end = selectedYearIndex === -1
            ? Math.min(allYearOptions.length, 5)
            : Math.min(allYearOptions.length, selectedYearIndex + 3);
        const yearOptions = allYearOptions.slice(start, end);
        const selectedSemesterIndex = semesterOptions.findIndex(option => option.selected);

        return {
            yearOptions,
            semesterOptions,
            defaultYearIndex: selectedYearIndex === -1 ? 0 : selectedYearIndex - start,
            defaultSemesterIndex: selectedSemesterIndex === -1 ? 0 : selectedSemesterIndex
        };
    } catch (error) {
        console.error("JS: 获取学年学期列表失败：", error);
        return null;
    }
}

async function selectAcademicYearAndSemester(appBasePath) {
    const options = await fetchAcademicOptions(appBasePath);
    if (!options) {
        await window.shiguangBridgePromise.showAlert(
            "无法读取学年学期",
            "请确认已登录教务系统，并重新尝试导入。",
            "确定"
        );
        return null;
    }

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(options.yearOptions.map(option => option.text)),
        options.defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1 || !options.yearOptions[yearIndex]) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(options.semesterOptions.map(option => option.text)),
        options.defaultSemesterIndex
    );
    if (
        semesterIndex === null ||
        semesterIndex === -1 ||
        !options.semesterOptions[semesterIndex]
    ) return null;

    return {
        academicYear: options.yearOptions[yearIndex].value,
        semesterCode: options.semesterOptions[semesterIndex].value
    };
}

async function fetchSemesterStartDate(appBasePath, academicYear, semesterCode) {
    const url = `${appBasePath}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`;
    try {
        const response = await postForm(url, `xnm=${academicYear}&xqm=${semesterCode}`);
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) return null;

        const firstWeek = data.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || data[0];
        if (firstWeek.rq) {
            const date = String(firstWeek.rq).split("/")[0];
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
        }
        if (firstWeek.zcrq) {
            const match = String(firstWeek.zcrq).match(/\d{4}-\d{2}-\d{2}/);
            if (match) return match[0];
        }
    } catch (error) {
        console.error("JS: 获取开学日期失败：", error);
    }
    return null;
}

async function fetchCourses(appBasePath, academicYear, semesterCode) {
    const url = `${appBasePath}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;
    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const response = await postForm(url, body);
    const data = await response.json();
    return parseJsonData(data);
}

async function saveImportResult(courses, semesterStartDate) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

    const config = { semesterTotalWeeks: 20 };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(NJUPT_TIME_SLOTS));
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "南京邮电大学课表导入",
        "请先登录智慧校园并进入教务系统，建议打开课表页面后再导入。",
        "好的，开始导入"
    );
    if (!confirmed) return;

    const appBasePath = getNjuptApiBasePath();
    if (appBasePath === null) {
        await window.shiguangBridgePromise.showAlert(
            "无法识别当前页面",
            "请先从智慧校园进入教务系统，并打开课表页面后重试。",
            "确定"
        );
        return;
    }

    try {
        const selection = await selectAcademicYearAndSemester(appBasePath);
        if (!selection) return;

        const { academicYear, semesterCode } = selection;
        window.shiguangBridge.showToast("正在从教务系统获取课表...");

        const [courses, semesterStartDate] = await Promise.all([
            fetchCourses(appBasePath, academicYear, semesterCode),
            fetchSemesterStartDate(appBasePath, academicYear, semesterCode)
        ]);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "未获取到课程",
                "请确认已登录教务系统，并检查所选学年、学期是否正确。",
                "确定"
            );
            return;
        }

        await saveImportResult(courses, semesterStartDate);
        const dateMessage = semesterStartDate ? `，开学日期 ${semesterStartDate}` : "";
        window.shiguangBridge.showToast(`导入成功：${courses.length} 门课程${dateMessage}`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("JS: API 课表导入失败：", error);
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            `无法从教务系统 API 获取或保存数据：${error.message}`,
            "确定"
        );
    }
}

runImportFlow();
