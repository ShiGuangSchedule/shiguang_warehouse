// 临沂大学(lyu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配（webvpn版）

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
        return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) || (a.startSection || 0) - (b.startSection || 0);
    });
    const step1Merged = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSame = current.name === next.name && current.teacher === next.teacher &&
            current.position === next.position && current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        if (isSame && current.endSection + 1 === next.startSection) {
            current.endSection = next.endSection;
        } else if (isSame && current.startSection === next.startSection && current.endSection === next.endSection) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) || (a.endSection || 0) - (b.endSection || 0);
    });
    const step2Merged = [];
    let cur = step1Merged[0];
    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        if (cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);
    return step2Merged;
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weekSets = weekStr.split(',');
    let weeks = [];
    for (const set of weekSets) {
        const trimmedSet = set.trim();
        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/);
        let start = 0, end = 0, processed = false;
        if (rangeMatch) { start = Number(rangeMatch[1]); end = Number(rangeMatch[2]); processed = true; }
        else if (singleMatch) { start = end = Number(singleMatch[1]); processed = true; }
        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');
            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const initialCourseList = [];
    for (const rawCourse of jsonData.kbList) {
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) continue;
        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) continue;
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);
        const day = Number(rawCourse.xqj);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) continue;
        initialCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }
    return mergeAndDistinctCourses(initialCourseList);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function fetchAcademicOptions() {
    const url = "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&enlink-vpn";
    try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) return null;
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.hasAttribute("selected") }));
        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.hasAttribute("selected") }));
        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;
        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);
        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5), semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex: semesterOptions.findIndex(opt => opt.selected) !== -1 ? semesterOptions.findIndex(opt => opt.selected) : 0
            };
        }
        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);
        return {
            yearOptions: allYearOptions.slice(start, end), semesterOptions,
            defaultYearIndex: selectedIndex - start,
            defaultSemesterIndex: semesterOptions.findIndex(opt => opt.selected) !== -1 ? semesterOptions.findIndex(opt => opt.selected) : 0
        };
    } catch (e) { return null; }
}

async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();
    if (!optionsData) {
        window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保登录状态。");
        return null;
    }
    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(yearOptions.map(item => item.text)), defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(semesterOptions.map(item => item.text)), defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;
    return { academicYear: yearOptions[yearIndex].value, semesterCode: semesterOptions[semesterIndex].value };
}

async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154&enlink-vpn";
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
        if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json) && json.length > 0) {
                const firstWeekObj = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
                if (firstWeekObj.rq) {
                    const startDateStr = firstWeekObj.rq.split('/')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return startDateStr;
                }
                if (firstWeekObj.zcrq) {
                    const match = firstWeekObj.zcrq.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match) return match[1];
                }
            }
        }
    } catch (e) {}
    return null;
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    const targetUrl = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151&enlink-vpn";
    const [courseResponse, semesterStartDate] = await Promise.all([
        fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`,
            credentials: "include"
        }),
        fetchSemesterStartDate(academicYear, semesterCode)
    ]);
    try {
        if (courseResponse.ok) {
            const jsonData = await courseResponse.json();
            if (jsonData && jsonData.kbList) {
                const parsedCourses = parseJsonData(jsonData);
                if (parsedCourses.length > 0) {
                    return { courses: parsedCourses, config: { semesterStartDate: semesterStartDate, semesterTotalWeeks: 20 } };
                }
            }
        }
    } catch (e) {}
    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) { window.shiguangBridge.showToast("用户取消了导入。"); return; }
    const selection = await selectAcademicYearAndSemester();
    if (!selection) { window.shiguangBridge.showToast("未选择学年学期，导入流程终止。"); return; }
    const { academicYear, semesterCode } = selection;
    const result = await fetchAndParseCourses(academicYear, semesterCode);
    if (result === null) return;
    const { courses, config } = result;
    const saveResult = await saveCourses(courses);
    if (!saveResult) return;
    try { await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)); } catch (e) {}
    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
