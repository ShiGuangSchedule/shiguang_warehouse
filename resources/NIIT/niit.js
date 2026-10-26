// 文件: courseImportApi.js
// 南京工业职业技术大学(jwxt.niit.edu.cn)「我的课表」API 方案适配脚本（金智教育 WIS 平台）
// 全自动：自动确定当前学期，直接调用教务后端接口获取课表并导入，无任何人工输入。

const SCHOOL = {
    api: "https://jwxt.niit.edu.cn/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do"
};

// 本校作息时间表（11 节）
const PRESET_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:25", endTime: "17:10" },
    { number: 9, startTime: "18:15", endTime: "19:00" },
    { number: 10, startTime: "19:10", endTime: "19:55" },
    { number: 11, startTime: "20:05", endTime: "20:50" }
];

// 自动确定当前学期，优先取页面学期标签，其次取当前日期
function currentTerm() {
    try {
        var t = document.querySelector("#dqxnxq2");
        if (t && t.getAttribute("value")) return t.getAttribute("value");
    } catch (e) { }
    var y = new Date().getFullYear();
    return (new Date().getMonth() >= 1 && new Date().getMonth() <= 6)
        ? (y - 1) + "-" + y + "-2"
        : y + "-" + (y + 1) + "-1";
}

// POST 请求教务接口（复用登录 Cookie）
async function fetchCourseRows() {
    var resp = await fetch(SCHOOL.api, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        },
        body: "XNXQDM=" + currentTerm(),
        credentials: "include"
    });
    return (await resp.json()).datas;
}

// 从 datas 中定位课程 rows（键名可能不同，做兜底）
function pluckRows(datas) {
    for (var k in datas) {
        var v = datas[k];
        if (v && Array.isArray(v.rows)) return v.rows;
        if (Array.isArray(v)) return v;
    }
    return [];
}

// 解析一条排课；周次串"111...000..."逐位为1即在第i+1周上课
function parseCourse(r) {
    var day = parseInt(r.SKXQ, 10);
    var startSection = parseInt(r.KSJC, 10);
    var endSection = parseInt(r.JSJC, 10);
    if (!r.KCM || isNaN(day) || isNaN(startSection) || isNaN(endSection)) return null;
    var weeks = [];
    (r.SKZC || "").split("").forEach(function (c, i) { if (c === "1") weeks.push(i + 1); });
    if (!weeks.length) return null;
    var name = r.KCM;
    var teacher = (r.SKJS || "待定").split("/")[0];
    var position = r.JASMC || "待定";
    // 去重 key：星期+节次+课程+教师+教室；并合并同 key 的周次
    var key = day + "|" + startSection + "|" + endSection + "|" + name + "|" + teacher + "|" + position;
    return { key: key, course: { name: name, teacher: teacher, position: position, day: day, startSection: startSection, endSection: endSection, weeks: weeks } };
}

// 主流程
(async function () {
    if (!(window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses)) return;

    var datas = await fetchCourseRows();
    var rows = pluckRows(datas);
    console.log("[课程API导入] 接口返回行数:", rows.length, rows);
    var index = {}, courses = [];

    for (var i = 0; i < rows.length; i++) {
        var p = parseCourse(rows[i]);
        if (!p) continue; // 只识别完整学期课表，不做调课/补课/停课过滤
        if (index[p.key] === undefined) {
            index[p.key] = courses.length;
            courses.push(p.course);
        } else {
            var ex = courses[index[p.key]];
            p.course.weeks.forEach(function (w) { if (ex.weeks.indexOf(w) === -1) ex.weeks.push(w); });
        }
    }
    courses.forEach(function (c) { c.weeks.sort(function (a, b) { return a - b; }); });

    if (!courses.length) return;
    var totalWeeks = 0;
    for (var j = 0; j < rows.length; j++) totalWeeks = Math.max(totalWeeks, String(rows[j].SKZC || "").length);

    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(PRESET_TIME_SLOTS));
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterStartDate: null, semesterTotalWeeks: totalWeeks || 20, firstDayOfWeek: 1 }));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    try { window.shiguangBridge.notifyTaskCompletion(); } catch (e) { }
})();