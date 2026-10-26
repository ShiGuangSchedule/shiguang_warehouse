// 哈尔滨工程大学(hrbeu.edu.cn) 本科课表适配脚本
// 金智教务(Wisedu EMAP)平台，参考官方金智适配案例
// 支持：学期选择、实验课、调课/停课、API作息时间、开学日期

var HEU_API = {
    semesterList: "/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do",
    currentTerm:  "/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do",
    course:       "/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do",
    experiment:   "/jwapp/sys/wdkb/modules/syjxkcb/cxsyjxxskb.do",
    change:       "/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do",
    timeSlots:    "/jwapp/sys/wdkb/modules/jshkcb/jc.do",
    config:       "/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do"
};

var DEFAULT_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:25", endTime: "16:10" },
    { number: 9, startTime: "16:15", endTime: "17:00" },
    { number: 10, startTime: "17:05", endTime: "17:50" },
    { number: 11, startTime: "18:30", endTime: "19:15" },
    { number: 12, startTime: "19:20", endTime: "20:05" },
    { number: 13, startTime: "20:10", endTime: "20:55" }
];

var HEADERS = {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest"
};

async function postApi(url, body) {
    var options = { headers: HEADERS, method: "POST", credentials: "include" };
    if (body) options.body = body;
    var resp = await fetch(url, options);
    if (!resp.ok) throw new Error("请求失败: " + resp.status);
    return await resp.json();
}

function getRows(data, key) {
    return (data && data.datas && data.datas[key] && Array.isArray(data.datas[key].rows))
        ? data.datas[key].rows : [];
}

function parseWeeksBitmap(skzc) {
    var weeks = [];
    var bits = String(skzc || "");
    for (var i = 0; i < bits.length; i++) {
        if (bits[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

function parseSingleCourse(raw) {
    var isExperiment = raw.SYXMMC !== undefined && raw.SYXMMC !== null;
    var name = isExperiment ? raw.KCM + " - " + raw.SYXMMC : raw.KCM;
    if (!isExperiment && raw.TYXMDM_DISPLAY) name += "(" + raw.TYXMDM_DISPLAY + ")";

    var day = parseInt(raw.SKXQ);
    var startSection = parseInt(raw.KSJC);
    var endSection = parseInt(raw.JSJC);
    var weeks = parseWeeksBitmap(raw.SKZC);

    if (!name || !day || !startSection || !endSection || weeks.length === 0) return null;

    return {
        name: name,
        teacher: raw.SKJS ? raw.SKJS.split("/")[0] : (raw.JSM || ""),
        position: raw.JASMC || "待定",
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks,
        _kbId: raw.KBID,
        _day: day,
        _startSection: startSection,
        _endSection: endSection
    };
}

function applyCourseChanges(courses, changes) {
    var count = 0;
    for (var i = 0; i < changes.length; i++) {
        var ch = changes[i];
        var kbId = ch.KBID;
        var weeksToRemove = parseWeeksBitmap(ch.SKZC);
        var applied = false;

        var affected = courses.filter(function(c) {
            return c._kbId === kbId &&
                c._day === parseInt(ch.SKXQ) &&
                c._startSection === parseInt(ch.KSJC) &&
                c._endSection === parseInt(ch.JSJC);
        });

        if (affected.length === 0) continue;

        if (weeksToRemove.length > 0) {
            affected.forEach(function(c) {
                var before = c.weeks.length;
                c.weeks = c.weeks.filter(function(w) { return weeksToRemove.indexOf(w) === -1; });
                if (c.weeks.length < before) applied = true;
            });
        }

        var isTimeChange = ch.TKLXDM === "01" || ch.TKLXDM === "03";
        if (isTimeChange && ch.XSKZC && ch.XSKXQ && ch.XKSJC && ch.XJSJC) {
            var newWeeks = parseWeeksBitmap(ch.XSKZC);
            if (newWeeks.length > 0) {
                var origTeacher = ch.YSKJS ? ch.YSKJS.split("/")[0] : "";
                courses.push({
                    name: ch.KCM,
                    teacher: ch.XSKJS ? ch.XSKJS.split("/")[0] : origTeacher,
                    position: ch.XJASMC || ch.JASMC || "待定",
                    day: parseInt(ch.XSKXQ),
                    startSection: parseInt(ch.XKSJC),
                    endSection: parseInt(ch.XJSJC),
                    weeks: newWeeks,
                    _kbId: kbId,
                    _day: parseInt(ch.XSKXQ),
                    _startSection: parseInt(ch.XKSJC),
                    _endSection: parseInt(ch.XJSJC)
                });
                applied = true;
            }
        }
        if (applied) count++;
    }
    if (count > 0) window.shiguangBridge.showToast("已应用 " + count + " 条调课/停课变更。");
    return courses;
}

function cleanAndMerge(courses) {
    var list = courses.map(function(c) {
        return {
            name: c.name || "",
            teacher: c.teacher || "",
            position: c.position || "",
            day: c.day,
            startSection: c.startSection,
            endSection: c.endSection,
            weeks: Array.isArray(c.weeks) ? c.weeks.slice().sort(function(a,b){return a-b;}) : []
        };
    }).filter(function(c) { return c.weeks.length > 0; });

    // 阶段1: 合并连续节次
    list.sort(function(a, b) {
        return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) || (a.day||0)-(b.day||0) ||
            a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
            (a.startSection||0)-(b.startSection||0);
    });

    var step1 = [];
    var cur = list[0];
    for (var i = 1; i < list.length; i++) {
        var nxt = list[i];
        var same = cur.name === nxt.name && cur.teacher === nxt.teacher &&
            cur.position === nxt.position && cur.day === nxt.day &&
            cur.weeks.join(",") === nxt.weeks.join(",");

        if (same && cur.endSection + 1 === nxt.startSection) {
            cur.endSection = nxt.endSection;
        } else if (same && cur.startSection === nxt.startSection && cur.endSection === nxt.endSection) {
            continue;
        } else {
            step1.push(cur);
            cur = nxt;
        }
    }
    step1.push(cur);

    // 阶段2: 合并同节次的周次
    step1.sort(function(a, b) {
        return a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) || (a.day||0)-(b.day||0) ||
            (a.startSection||0)-(b.startSection||0) || (a.endSection||0)-(b.endSection||0);
    });

    var step2 = [];
    cur = step1[0];
    for (var j = 1; j < step1.length; j++) {
        var n = step1[j];
        if (cur.name === n.name && cur.teacher === n.teacher && cur.position === n.position &&
            cur.day === n.day && cur.startSection === n.startSection && cur.endSection === n.endSection) {
            var set = {};
            cur.weeks.concat(n.weeks).forEach(function(w) { set[w] = true; });
            cur.weeks = Object.keys(set).map(Number).sort(function(a,b){return a-b;});
        } else {
            step2.push(cur);
            cur = n;
        }
    }
    step2.push(cur);
    return step2;
}

async function selectSemester() {
    var semesterList = [];
    try {
        var data = await postApi(HEU_API.semesterList, "*order=-DM");
        semesterList = getRows(data, "xnxqcx");
    } catch (e) {
        window.shiguangBridge.showToast("获取学期列表失败，请检查登录状态。");
        return null;
    }
    if (semesterList.length === 0) {
        window.shiguangBridge.showToast("未查询到学期数据。");
        return null;
    }

    var defaultDM = null;
    try {
        var dqData = await postApi(HEU_API.currentTerm);
        var dqRows = getRows(dqData, "dqxnxq");
        if (dqRows.length > 0) defaultDM = dqRows[0].DM;
    } catch (e) {}

    var top = semesterList.slice(0, 10);
    var names = top.map(function(s) { return s.MC || s.DM; });
    var defaultIdx = -1;
    if (defaultDM) {
        for (var i = 0; i < top.length; i++) {
            if (top[i].DM === defaultDM) { defaultIdx = i; break; }
        }
    }

    var idx = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期", JSON.stringify(names), defaultIdx
    );
    if (idx === null || idx === -1) return null;
    return top[idx];
}

async function importTimeSlots() {
    var slots = null;
    try {
        var data = await postApi(HEU_API.timeSlots);
        var rows = getRows(data, "jc");
        if (rows.length > 0) {
            slots = rows.map(function(r) {
                return { number: parseInt(r.DM), startTime: r.KSSJ, endTime: r.JSSJ };
            });
        }
    } catch (e) {}

    if (!slots || slots.length === 0) {
        slots = DEFAULT_TIME_SLOTS;
    }
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function fetchSemesterConfig(xn, xq) {
    try {
        var data = await postApi(HEU_API.config, "XN=" + xn + "&XQ=" + xq);
        var row = getRows(data, "cxjcs")[0];
        if (row) {
            var rawDate = row.XQKSRQ;
            return {
                semesterStartDate: rawDate ? rawDate.split(" ")[0] : null,
                semesterTotalWeeks: parseInt(row.ZZC) || 20
            };
        }
    } catch (e) {}
    return { semesterStartDate: null, semesterTotalWeeks: 20 };
}

async function runImportFlow() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
        "哈尔滨工程大学课表导入",
        "导入前请确保已登录教务系统。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return;
    }

    var semester = await selectSemester();
    if (!semester) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    var XNXQDM = semester.DM;

    window.shiguangBridge.showToast("正在获取作息时间...");
    await importTimeSlots();

    window.shiguangBridge.showToast("正在获取课表数据...");
    var courseData = await postApi(HEU_API.course, "XNXQDM=" + XNXQDM);
    var rawCourses = getRows(courseData, "cxxszhxqkb");

    // 获取实验课
    var rawExpCourses = [];
    try {
        var expData = await postApi(HEU_API.experiment, "XNXQDM=" + XNXQDM);
        rawExpCourses = getRows(expData, "cxsyjxxskb");
    } catch (e) {
        console.warn("HEU: 获取实验课失败:", e);
    }

    var allRaw = rawCourses.concat(rawExpCourses);
    if (allRaw.length === 0) {
        await window.shiguangBridgePromise.showAlert("导入提示", "该学期未查到课程数据。", "知道了");
        return;
    }

    if (rawExpCourses.length > 0) {
        window.shiguangBridge.showToast("获取到 " + rawCourses.length + " 门理论课和 " + rawExpCourses.length + " 门实验课");
    }

    var parsed = allRaw.map(parseSingleCourse).filter(function(c) { return c !== null; });

    // 获取调课数据
    try {
        var chData = await postApi(HEU_API.change, "XNXQDM=" + XNXQDM + "&*order=-SQSJ");
        var rawChanges = getRows(chData, "xsdkkc");
        if (rawChanges.length > 0) {
            parsed = applyCourseChanges(parsed, rawChanges);
        }
    } catch (e) {
        console.warn("HEU: 获取调课数据失败:", e);
    }

    var courses = cleanAndMerge(parsed);

    if (courses.length === 0) {
        window.shiguangBridge.showToast("课表解析结果为空");
        return;
    }

    var config = await fetchSemesterConfig(semester.XNDM, semester.XQDM);
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast(XNXQDM + " 课表导入成功，共 " + courses.length + " 门课程");
    window.shiguangBridge.notifyTaskCompletion();
}

(async function() {
    try {
        await runImportFlow();
    } catch (error) {
        console.error("HEU课表导入失败:", error);
        if (window.shiguangBridgePromise) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "错误: " + error.message + "\n\n请确认：\n1. 已登录教务系统\n2. 处于校园网或VPN环境",
                "确定"
            );
        }
    }
})();
