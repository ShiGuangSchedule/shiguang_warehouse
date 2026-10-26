// 三明学院 (fjsmu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统V9标准接口适配（CAS SSO版）

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;
    const list = courses.map(c => ({
        ...c, name: c.name || '', teacher: c.teacher || '', position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));
    list.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) || (a.startSection || 0) - (b.startSection || 0));
    const step1 = [];
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
        const nxt = list[i];
        const same = cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.weeks.join(',') === nxt.weeks.join(',');
        if (same && cur.endSection + 1 === nxt.startSection) cur.endSection = nxt.endSection;
        else if (same && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) continue;
        else { step1.push(cur); cur = nxt; }
    }
    step1.push(cur);
    step1.sort((a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) || (a.endSection || 0) - (b.endSection || 0));
    const step2 = [];
    cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        if (cur.name === nxt.name && cur.teacher === nxt.teacher && cur.position === nxt.position &&
            cur.day === nxt.day && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else { step2.push(cur); cur = nxt; }
    }
    step2.push(cur);
    return step2;
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = [];
    for (const set of weekStr.split(',')) {
        const s = set.trim();
        const rangeM = s.match(/(\d+)-(\d+)周/);
        const singleM = s.match(/^(\d+)周/);
        let start = 0, end = 0, ok = false;
        if (rangeM) { start = Number(rangeM[1]); end = Number(rangeM[2]); ok = true; }
        else if (singleM) { start = end = Number(singleM[1]); ok = true; }
        if (ok) {
            const isSingle = s.includes('(单)'), isDouble = s.includes('(双)');
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
    const list = [];
    for (const c of jsonData.kbList) {
        if (!c.kcmc || !c.xm || !c.cdmc || !c.xqj || !c.jcs || !c.zcd) continue;
        const weeks = parseWeeks(c.zcd);
        if (!weeks.length) continue;
        const parts = c.jcs.split('-');
        const start = Number(parts[0]), end = Number(parts[parts.length - 1]);
        const day = Number(c.xqj);
        if (isNaN(day) || isNaN(start) || isNaN(end) || day < 1 || day > 7 || start > end) continue;
        list.push({ name: c.kcmc.trim(), teacher: c.xm.trim(), position: c.cdmc.trim(),
            day, startSection: start, endSection: end, weeks });
    }
    return mergeAndDistinctCourses(list);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入", "导入前请确保您已在浏览器中成功登录教务系统", "好的，开始导入");
}

async function fetchAcademicOptions() {
    const url = "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151";
    try {
        const resp = await fetch(url, { method: "GET", credentials: "include" });
        if (!resp.ok) return null;
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const years = Array.from(doc.querySelectorAll("#xnm option")).filter(o => o.value !== "")
            .map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.hasAttribute("selected") }));
        const semesters = Array.from(doc.querySelectorAll("#xqm option")).filter(o => o.value !== "")
            .map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.hasAttribute("selected") }));
        if (!years.length || !semesters.length) return null;
        const selIdx = years.findIndex(o => o.selected);
        const start = Math.max(0, (selIdx === -1 ? 0 : selIdx) - 2);
        const end = Math.min(years.length, (selIdx === -1 ? 0 : selIdx) + 3);
        return { yearOptions: years.slice(start, end), semesterOptions: semesters,
            defaultYearIndex: selIdx === -1 ? 0 : selIdx - start,
            defaultSemesterIndex: semesters.findIndex(o => o.selected) !== -1 ? semesters.findIndex(o => o.selected) : 0 };
    } catch (e) { return null; }
}

async function selectAcademicYearAndSemester() {
    const data = await fetchAcademicOptions();
    if (!data) { window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保已登录。"); return null; }
    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = data;
    const yearIdx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(yearOptions.map(o => o.text)), defaultYearIndex);
    if (yearIdx === null || yearIdx === -1) return null;
    const semIdx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(semesterOptions.map(o => o.text)), defaultSemesterIndex);
    if (semIdx === null || semIdx === -1) return null;
    return { academicYear: yearOptions[yearIdx].value, semesterCode: semesterOptions[semIdx].value };
}

async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: { "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest" },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });
        if (resp.ok) {
            const json = await resp.json();
            if (Array.isArray(json) && json.length > 0) {
                const first = json.find(i => String(i.zs) === "1" || String(i.zsmc) === "1") || json[0];
                if (first.rq) { const d = first.rq.split('/')[0]; if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
                if (first.zcrq) { const m = first.zcrq.match(/(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; }
            }
        }
    } catch (e) {}
    return null;
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";
    const [resp, startDate] = await Promise.all([
        fetch(url, { method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`,
            credentials: "include" }),
        fetchSemesterStartDate(academicYear, semesterCode)
    ]);
    try {
        if (resp.ok) {
            const json = await resp.json();
            if (json && json.kbList) {
                const courses = parseJsonData(json);
                if (courses.length > 0) return { courses, config: { semesterStartDate: startDate, semesterTotalWeeks: 20 } };
            }
        }
    } catch (e) {}
    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
}

async function saveCourses(courses) {
    try { await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses)); return true; }
    catch (e) { window.shiguangBridge.showToast("课程保存失败: " + e.message); return false; }
}

async function runImportFlow() {
    const ok = await promptUserToStart();
    if (!ok) { window.shiguangBridge.showToast("用户取消了导入。"); return; }
    const sel = await selectAcademicYearAndSemester();
    if (!sel) { window.shiguangBridge.showToast("未选择学年学期，导入终止。"); return; }
    const result = await fetchAndParseCourses(sel.academicYear, sel.semesterCode);
    if (!result) return;
    const saved = await saveCourses(result.courses);
    if (!saved) return;
    try { await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(result.config)); } catch (e) {}
    window.shiguangBridge.showToast("课程导入成功，共导入 " + result.courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
