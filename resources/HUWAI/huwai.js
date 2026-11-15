// 湖南外国语职业学院 (huwai.edu.cn) 拾光课程表适配脚本
// 基于正方教务 V9 接口适配
// 非该大学开发者适配，开发者无法及时发现问题，出现问题请提 issues 或提交 pr
//
// 使用接口：
//   学年学期 GET  {base}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151
//   课表     POST {base}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151
//   校历     POST {base}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154
//   作息     POST {base}/jzgl/skxxMobile_cxRsdjc.html?gnmkdm=N2154
// zcd 形态：4-18周 / 第4周 / 1-8周(单) / 1-8周(双) / 1-4,6-8周

// 教务系统基础地址
const BASE_URL = "https://jw.huwai.edu.cn:8010/jwglxt";

// 内置保底作息：第 1-8 节 45 分钟，第 9-10 节连排 90 分钟
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:25", endTime: "10:10" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:15", endTime: "20:00" }
];

/**
 * 解析周次字符串，按逗号分段处理周次范围与单双周
 * 例："4-18周" / "第4周" / "1-8周(单)" / "1-4,6-8周"
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = [];
    for (const set of String(weekStr).replace(/\s+/g, "").split(",")) {
        const isOdd = /单/.test(set);
        const isEven = /双/.test(set);
        const range = set.match(/(\d+)-(\d+)/);
        const single = set.match(/(\d+)/);
        let start = 0;
        let end = 0;
        if (range) {
            start = Number(range[1]);
            end = Number(range[2]);
        } else if (single) {
            start = end = Number(single[1]);
        } else {
            continue;
        }
        for (let w = start; w <= end; w++) {
            if (isOdd && w % 2 === 0) continue;
            if (isEven && w % 2 !== 0) continue;
            weeks.push(w);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 课程合并去重
 * 阶段 1：名称/教师/地点/星期/周次一致时，合并连续节次并去掉完全重复项
 * 阶段 2：名称/教师/地点/星期/节次一致时，合并周次
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
            (a.startSection || 0) - (b.startSection || 0);
    });

    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");
        const continuous = current.endSection + 1 === next.startSection;
        const duplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (sameCourseAndWeeks && continuous) {
            current.endSection = next.endSection;
        } else if (sameCourseAndWeeks && duplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    step1.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0);
    });

    const step2 = [];
    let cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (sameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);

    return step2;
}

/**
 * 解析课表接口返回：kcmc 课程名、xm 教师、cdmc 教室、xqj 星期、jcs/jcor 节次、zcd 周次
 */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];

    const courses = [];
    for (const raw of jsonData.kbList) {
        if (!raw.kcmc || !raw.xqj || !raw.zcd) continue;

        const sectionText = raw.jcs || raw.jcor || "";
        if (!sectionText) continue;

        const weeks = parseWeeks(raw.zcd);
        if (weeks.length === 0) continue;

        const parts = String(sectionText).split("-");
        const startSection = Number(parts[0]);
        const endSection = Number(parts[parts.length - 1]);
        const day = Number(raw.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection < 1 || startSection > endSection) {
            continue;
        }

        courses.push({
            name: String(raw.kcmc).trim(),
            teacher: String(raw.xm || "").trim(),
            position: String(raw.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        });
    }

    return mergeAndDistinctCourses(courses);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

/**
 * 读取学年学期下拉选项：学年以选中项为中心取前后共 5 项
 */
async function fetchAcademicOptions() {
    const url = `${BASE_URL}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;

    try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) return null;

        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));
        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);
        const semesterDefault = semesterOptions.findIndex(opt => opt.selected);
        const defaultSemesterIndex = semesterDefault !== -1 ? semesterDefault : 0;

        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex
            };
        }

        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);

        return {
            yearOptions: allYearOptions.slice(start, end),
            semesterOptions,
            defaultYearIndex: selectedIndex - start,
            defaultSemesterIndex
        };
    } catch (e) {
        return null;
    }
}

/**
 * 提示用户选择学年和学期
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();
    if (!optionsData) {
        window.shiguangBridge.showToast("读取学年学期失败，请确认已登录教务系统。");
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

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

/**
 * 读取开学日期与总周数（校历：rq="2026-08-31/2026-09-06"，数组长度即总周数）
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    const url = `${BASE_URL}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });
        if (!response.ok) return null;

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) return null;

        const firstWeek = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
        let startDate = String(firstWeek.rq || "").split("/")[0].trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            const match = String(firstWeek.zcrq || "").match(/(\d{4}-\d{2}-\d{2})/);
            startDate = match ? match[1] : "";
        }
        if (!startDate) return null;

        return {
            semesterStartDate: startDate,
            semesterTotalWeeks: json.length
        };
    } catch (e) {
        return null;
    }
}

/**
 * 读取作息时间：jcmc 节次、qssj/jssj 起止时间
 */
async function fetchTimeSlots(academicYear, semesterCode) {
    const url = `${BASE_URL}/jzgl/skxxMobile_cxRsdjc.html?gnmkdm=N2154`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}&xqh_id=1`,
            credentials: "include"
        });
        if (!response.ok) return null;

        const json = await response.json();
        if (!Array.isArray(json)) return null;

        const timeSlots = json
            .filter(item => item.jcmc && item.qssj && item.jssj)
            .map(item => ({
                number: Number(item.jcmc),
                startTime: String(item.qssj).substring(0, 5),
                endTime: String(item.jssj).substring(0, 5)
            }))
            .sort((a, b) => a.number - b.number);

        return timeSlots.length > 0 ? timeSlots : null;
    } catch (e) {
        return null;
    }
}

/**
 * 并行获取课表、校历与作息
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const [courseResponse, semesterInfo, timeSlots] = await Promise.all([
        fetch(`${BASE_URL}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`,
            credentials: "include"
        }).catch(() => null),
        fetchSemesterInfo(academicYear, semesterCode),
        fetchTimeSlots(academicYear, semesterCode)
    ]);

    if (courseResponse && courseResponse.ok) {
        try {
            const jsonData = JSON.parse(await courseResponse.text());
            const courses = parseJsonData(jsonData);
            if (courses.length > 0) {
                return { courses, semesterInfo, timeSlots };
            }
        } catch (e) {
            // 未登录时返回的是登录页 HTML
        }
    }

    window.shiguangBridge.showToast("未能获取课表数据，请检查登录状态或网络环境。");
    return null;
}

async function importPresetTimeSlots(timeSlots) {
    const usedFallback = !timeSlots || timeSlots.length === 0;
    const finalTimeSlots = usedFallback ? FALLBACK_TIME_SLOTS : timeSlots;

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalTimeSlots));
        if (usedFallback) {
            window.shiguangBridge.showToast("未获取到教务系统作息，已使用内置保底作息时间导入。");
        }
    } catch (error) {
        window.shiguangBridge.showToast("导入作息时间失败：" + error.message);
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
        window.shiguangBridge.showToast("未选择学年学期或因故终止导入。");
        return;
    }

    const { academicYear, semesterCode } = selection;
    const result = await fetchAndParseCourses(academicYear, semesterCode);
    if (result === null) return;

    const { courses, semesterInfo, timeSlots } = result;

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败：" + error.message);
        return;
    }

    if (semesterInfo) {
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(semesterInfo));
            window.shiguangBridge.showToast(`课表配置更新成功！开学日期：${semesterInfo.semesterStartDate}`);
        } catch (error) {
            window.shiguangBridge.showToast("课表配置保存失败：" + error.message);
        }
    }

    await importPresetTimeSlots(timeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
