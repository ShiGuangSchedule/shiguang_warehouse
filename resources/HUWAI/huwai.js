// 湖南外国语职业学院 (huwai.edu.cn) 拾光课程表适配脚本
// 正方教务 V9，接口：
//   课表 POST /jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151  xnm=&xqm=&kzlx=ck&xsdm=&kclbdm=&kclxdm=
//   校历 POST /jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154  xnm=&xqm=  (rq/zs，数组长度即总周数)
// zcd 形态：4-18周 / 第4周 / 1-8周(单) / 1-8周(双) / 1-4,6-8周

// 作息时间：第 1-8 节 45 分钟，第 9-10 节连排 18:30-20:00
const HUWAI_TIME_SLOTS = [
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

// 周次："4-18周" / "第4周" / "1-8周(单)" / "1-8周(双)" / "1-4,6-8周"
// 按逗号分段，单双标记是段内标记，逐段各自判断
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

// kbList：kcmc 课程名、xm 教师、cdmc 教室、xqj 星期(1-7)、jcs 节次("1-4")、zcd 周次
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const courses = [];
    for (const c of jsonData.kbList) {
        if (!c.kcmc || !c.xqj || !c.jcs || !c.zcd) continue;
        const weeks = parseWeeks(c.zcd);
        if (!weeks.length) continue;
        const parts = String(c.jcs).split("-");
        const startSection = Number(parts[0]);
        const endSection = Number(parts[parts.length - 1]);
        const day = Number(c.xqj);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) continue;
        courses.push({
            name: String(c.kcmc).trim(),
            teacher: String(c.xm || "").trim(),
            position: String(c.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        });
    }
    return courses;
}

// 学年学期兜底：9 月及以后算当年第一学期，1 月算上一年第一学期，2~7 月算上一年第二学期
function termByDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 8) return { academicYear: String(year), semesterCode: "3" };
    if (month === 1) return { academicYear: String(year - 1), semesterCode: "3" };
    return { academicYear: String(year - 1), semesterCode: "12" };
}

// 从课表查询页读取默认选中的学年学期
async function fetchAcademicOptions() {
    try {
        const resp = await fetch("/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151",
            { method: "GET", credentials: "include" });
        if (!resp.ok) return null;
        const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
        const year = doc.querySelector("#xnm option[selected]");
        const term = doc.querySelector("#xqm option[selected]");
        if (!year || !term) return null;
        return {
            academicYear: year.getAttribute("value"),
            semesterCode: term.getAttribute("value")
        };
    } catch (e) {
        return null;
    }
}

// 优先取当前课表页下拉框，其次查询页默认值，最后按日期推断
async function resolveAcademicTerm() {
    const yearEl = document.querySelector("#xnm");
    const termEl = document.querySelector("#xqm");
    if (yearEl && yearEl.value && termEl && termEl.value) {
        return { academicYear: yearEl.value, semesterCode: termEl.value };
    }
    return (await fetchAcademicOptions()) || termByDate();
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");
    const resp = await fetch("/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`,
        credentials: "include"
    });
    if (!resp.ok) throw new Error("状态码 " + resp.status);
    const text = await resp.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        throw new Error("未登录或登录已过期");
    }
    return parseJsonData(json);
}

// 校历：rq="2026-08-31/2026-09-06"，数组长度即总周数
async function fetchSemesterConfig(academicYear, semesterCode) {
    try {
        const resp = await fetch("/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });
        if (!resp.ok) return null;
        const json = JSON.parse(await resp.text());
        if (!Array.isArray(json) || !json.length) return null;
        const first = json.find(i => Number(i.zs) === 1) || json[0];
        const startDate = String(first.rq || "").split("/")[0].trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
        return { semesterStartDate: startDate, semesterTotalWeeks: json.length };
    } catch (e) {
        return null;
    }
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "湖南外国语职业学院课表导入",
        "请先登录教务系统并打开「我的课表」页面，再执行导入。",
        "开始导入"
    );
    if (!confirmed) { window.shiguangBridge.showToast("已取消导入。"); return; }

    try {
        const term = await resolveAcademicTerm();
        const courses = await fetchAndParseCourses(term.academicYear, term.semesterCode);
        if (!courses.length) throw new Error("未获取到课程数据，请确认当前学期是否有课");
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        const config = await fetchSemesterConfig(term.academicYear, term.semesterCode);
        if (config) {
            try {
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            } catch (e) {
                console.error("JS: 保存课表配置失败", e);
            }
        } else {
            window.shiguangBridge.showToast("未取到开学日期，已跳过课表配置，请在应用内手动设置。");
        }

        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(HUWAI_TIME_SLOTS));
        } catch (e) {
            console.error("JS: 保存作息时间失败", e);
        }

        window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        console.error("JS: Import Error", e);
        window.shiguangBridge.showToast("导入失败：" + e.message);
    }
}

runImportFlow();
