// 哈尔滨工程大学(yjs.hrbeu.edu.cn) 研究生课表适配脚本
// 研究生教育管理信息系统

var HEU_YJS_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:50", endTime: "11:35" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:25", endTime: "16:10" },
    { number: 9, startTime: "16:20", endTime: "17:05" },
    { number: 10, startTime: "17:05", endTime: "17:50" },
    { number: 11, startTime: "18:30", endTime: "19:15" },
    { number: 12, startTime: "19:25", endTime: "20:10" },
    { number: 13, startTime: "20:10", endTime: "20:55" }
];

var DAY_FIELDS = [
    { field: "Monday", day: 1 },
    { field: "Tuesday", day: 2 },
    { field: "Wednesday", day: 3 },
    { field: "Thursday", day: 4 },
    { field: "Friday", day: 5 },
    { field: "Saturday", day: 6 },
    { field: "Sunday", day: 7 }
];

function findTimetableRequest() {
    var resources = performance.getEntriesByType("resource");
    var matches = resources.map(function(r) { return r.name; })
        .filter(function(url) { return url.indexOf("GetTimeTableByStudent") !== -1; });
    return matches.length ? matches[matches.length - 1] : null;
}

function parseWeeks(text) {
    if (!text) return [];
    var weeks = {};
    var parts = text.split(/[;；]/);
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/\([^)]*\)/g, "").trim();
        if (!part) continue;
        var segs = part.split(/[,，]/);
        for (var j = 0; j < segs.length; j++) {
            var seg = segs[j].trim();
            var rangeMatch = seg.match(/(\d+)\s*[-~]\s*(\d+)/);
            if (rangeMatch) {
                for (var w = parseInt(rangeMatch[1]); w <= parseInt(rangeMatch[2]); w++) {
                    weeks[w] = true;
                }
            } else {
                var num = parseInt(seg);
                if (!isNaN(num) && num > 0) weeks[num] = true;
            }
        }
    }
    return Object.keys(weeks).map(Number).sort(function(a, b) { return a - b; });
}

function parseMultiTeacherWeeks(weekText) {
    // 格式: "1-5(张翼飞);7-9(张翼飞);10-17(郝龙)"
    var result = [];
    var re = /([\d,\-~]+)\(([^)]+)\)/g;
    var match;
    while ((match = re.exec(weekText)) !== null) {
        result.push({ weeks: parseWeeks(match[1]), teacher: match[2].trim() });
    }
    return result;
}

function parseSections(text) {
    if (!text) return null;
    var match = text.match(/(\d+)/g);
    if (!match || !match.length) return null;
    var nums = match.map(Number);
    return { start: Math.min.apply(null, nums), end: Math.max.apply(null, nums) };
}

function parseCourseCell(cellStr, day, sections) {
    if (!cellStr || typeof cellStr !== "string") return [];
    var courses = [];
    var text = cellStr.replace(/\\r\\n/g, "\r\n");
    var blocks = text.split(/\r?\n\r?\n/).filter(function(b) { return b.trim(); });

    for (var i = 0; i < blocks.length; i++) {
        var lines = blocks[i].split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l; });
        if (lines.length < 2) continue;

        var name = lines[0];
        var teacherLine = lines[1] || "";
        var defaultTeacher = teacherLine.split(/\s+/)[0] || "未知";

        var weekText = "", position = "";
        for (var j = 0; j < lines.length; j++) {
            var wm = lines[j].match(/^周次[:：]\s*(.+)/);
            if (wm) weekText = wm[1].trim();
            var pm = lines[j].match(/^地点[:：]\s*(.+)/);
            if (pm) position = pm[1].trim();
        }

        if (!weekText) continue;

        var secInfo = null;
        for (var k = 0; k < lines.length; k++) {
            var sm = lines[k].match(/^节次[:：]\s*(.+)/);
            if (sm) { secInfo = parseSections(sm[1]); break; }
        }
        var startSection = secInfo ? secInfo.start : sections.start;
        var endSection = secInfo ? secInfo.end : sections.end;

        // 一班多师: "1-5(张翼飞);7-9(张翼飞);10-17(郝龙)"
        var multiTeacher = parseMultiTeacherWeeks(weekText);
        if (multiTeacher.length > 0) {
            for (var m = 0; m < multiTeacher.length; m++) {
                courses.push({
                    name: name,
                    teacher: multiTeacher[m].teacher,
                    position: position || "待定",
                    day: day,
                    startSection: startSection,
                    endSection: endSection,
                    weeks: multiTeacher[m].weeks
                });
            }
        } else {
            var weeks = parseWeeks(weekText);
            if (!weeks.length) continue;
            courses.push({
                name: name,
                teacher: defaultTeacher,
                position: position || "待定",
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }
    return courses;
}

function parseScheduleData(data) {
    var allCourses = [];
    if (!Array.isArray(data)) return allCourses;

    for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var sections = parseSections(row.JieCi);
        if (!sections) continue;

        for (var j = 0; j < DAY_FIELDS.length; j++) {
            var cellStr = row[DAY_FIELDS[j].field];
            if (!cellStr) continue;
            var courses = parseCourseCell(cellStr, DAY_FIELDS[j].day, sections);
            allCourses.push.apply(allCourses, courses);
        }
    }
    return allCourses;
}

function dedup(courses) {
    var index = {};
    var result = [];
    for (var i = 0; i < courses.length; i++) {
        var c = courses[i];
        var key = c.day + "|" + c.startSection + "|" + c.endSection + "|" + c.name + "|" + c.teacher + "|" + c.position;
        if (index[key] === undefined) {
            index[key] = result.length;
            result.push(c);
        } else {
            var ex = result[index[key]];
            c.weeks.forEach(function(w) { if (ex.weeks.indexOf(w) === -1) ex.weeks.push(w); });
        }
    }
    result.forEach(function(c) { c.weeks.sort(function(a, b) { return a - b; }); });
    return result;
}

async function fetchSchedule() {
    // 方案1: 拦截已有请求
    var url = findTimetableRequest();
    if (url) {
        console.log("HEU研: 拦截到课表请求 " + url);
        var resp = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
        });
        if (resp.ok) return await resp.json();
    }
    throw new Error("未找到课表请求，请先在页面上查询课表后再点击导入");
}

async function runImportFlow() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
        "哈工程研究生课表导入",
        "请确保已登录研究生系统，并已打开课表查询页面，等待课表加载完成后点击确定。",
        "确定，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return;
    }

    window.shiguangBridge.showToast("正在获取课表数据...");
    var data = await fetchSchedule();

    console.log("HEU研: 获取到 " + data.length + " 行数据");
    var courses = dedup(parseScheduleData(data));
    console.log("HEU研: 解析出 " + courses.length + " 门课程");

    if (courses.length === 0) {
        await window.shiguangBridgePromise.showAlert("导入提示", "未解析到课程数据，请确认课表页面已加载完成。", "知道了");
        return;
    }

    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(HEU_YJS_TIME_SLOTS));
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterStartDate: null,
        semesterTotalWeeks: 20,
        defaultClassDuration: 45,
        defaultBreakDuration: 5,
        firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast("研究生课表导入成功，共 " + courses.length + " 门课程");
    window.shiguangBridge.notifyTaskCompletion();
}

(async function() {
    try {
        await runImportFlow();
    } catch (error) {
        console.error("HEU研究生课表导入失败:", error);
        if (window.shiguangBridgePromise) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "错误: " + error.message + "\n\n请确认：\n1. 已登录研究生系统\n2. 已打开课表查询页面并加载完成\n3. 处于校园网或VPN环境",
                "确定"
            );
        }
    }
})();
