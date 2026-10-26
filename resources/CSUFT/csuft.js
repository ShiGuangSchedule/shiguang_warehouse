// 中南林业科技大学(csuft.edu.cn) 拾光课程表适配脚本
// 强智教务系统（新版 qz- 周历表界面），通过 WebVPN 访问
//
// 2026-09 页面改版同步：
//   1. 教务域名由 jwgl 变更为 jwxt：http-jwgl-... -> http-jwxt-...
//   2. 课表表格由 #kbtable 改为 table.qz-weeklyTable（layui 周历表）
//      课程结构：td[name=kbDataTd] > ul.courselists > li.courselists-item
//      课程名 .qz-hasCourse-title，其余信息在 .qz-hasCourse-abbrinfo
//      （形如 "老师:张三;时间:1-8周[1-2节];地点:树人楼(树人楼北502)"）
//   3. 请求方式由 POST 改为 GET，新增 时间模式(kbjcmsid) 等参数
//   4. 跨大节的课会用 rowspan 合并单元格，必须还原网格才能定位星期
//   5. 2026-09 按官方《适配脚本开发指南 v2》迁移桥接 API：
//      window.shiguangBridgePromise（异步）+ window.shiguangBridge（同步）
//      notifyTaskCompletion 仅在整条流程成功后调用
//   6. 2026-09-30 通过 /jsxsd/jxzl/jxzl_query（教学周历）自动获取开学日期，
//      传入 saveCourseConfig 的 semesterStartDate；失败时静默降级

var JWXT_BASE = "https://http-jwxt-csuft-edu-cn-80.webvpn.csuft.edu.cn/jsxsd";
var KB_URL = JWXT_BASE + "/xskb/xskb_list.do";
var JXZL_URL = JWXT_BASE + "/jxzl/jxzl_query"; // 教学周历（校历），用于推算开学日期

var WEEK_DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

var TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

function trimText(s) {
    return (s || '').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
}

function uniqueSort(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) {
        if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
}

// 解析周次：支持 "1-8周"、"2,4,6,8周"、"14周"、"1-8周(单)"、"1-8周(双)"
function parseWeeks(timeStr) {
    var weeks = [];
    if (!timeStr) return weeks;
    var s = String(timeStr).split('[')[0];
    var odd = null;
    if (/[（(]\s*单\s*[）)]/.test(s)) odd = true;
    else if (/[（(]\s*双\s*[）)]/.test(s)) odd = false;
    s = s.replace(/[（(][^（()）]*[）)]/g, '').replace(/周/g, '').replace(/\s/g, '');

    var segs = s.split(/[,，]/);
    for (var i = 0; i < segs.length; i++) {
        var m = segs[i].match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
        if (!m) continue;
        var a = parseInt(m[1], 10);
        var b = m[2] ? parseInt(m[2], 10) : a;
        if (isNaN(a) || isNaN(b) || b < a) continue;
        for (var w = a; w <= b; w++) {
            if (odd === true && w % 2 === 0) continue;
            if (odd === false && w % 2 === 1) continue;
            weeks.push(w);
        }
    }
    return uniqueSort(weeks);
}

// 把带 rowspan/colspan 的表格还原成二维网格
function buildGrid(table) {
    var grid = [];
    var trs = table.getElementsByTagName('tr');
    for (var r = 0; r < trs.length; r++) {
        if (!grid[r]) grid[r] = [];
        var cells = trs[r].children;
        var c = 0;
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            while (grid[r][c]) c++;
            var rs = parseInt(cell.getAttribute('rowspan'), 10);
            var cs = parseInt(cell.getAttribute('colspan'), 10);
            if (!rs || rs < 1) rs = 1;
            if (!cs || cs < 1) cs = 1;
            for (var dr = 0; dr < rs; dr++) {
                if (!grid[r + dr]) grid[r + dr] = [];
                for (var dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = cell;
            }
            c += cs;
        }
    }
    return grid;
}

// 去掉地点中重复的楼栋名，如 "树人楼(树人楼北508)" -> "树人楼(北508)"
function dedupePosition(pos) {
    if (!pos) return pos;
    var m = pos.match(/^(.+?)\s*[（(]\s*\1\s*(.+?)[）)]\s*$/);
    return m ? m[1] + '(' + m[2] + ')' : pos;
}

function textOf(el, selector) {
    var t = el.querySelector(selector);
    return t ? trimText(t.textContent) : '';
}

function parseSchedule(doc) {
    var table = doc.querySelector('table.qz-weeklyTable');
    if (!table) return [];

    var grid = buildGrid(table);

    // 1. 表头行：列号 -> 星期
    var colDay = {};
    var headerRow = -1;
    for (var r = 0; r < grid.length; r++) {
        var row = grid[r] || [];
        var hit = false;
        for (var c = 1; c < row.length; c++) {
            var txt = trimText(row[c] ? row[c].textContent : '').replace(/\s/g, '');
            var m = txt.match(/^星期([一二三四五六日天])/);
            if (m) { colDay[c] = WEEK_DAY_MAP[m[1]]; hit = true; }
        }
        if (hit) { headerRow = r; break; }
    }
    if (headerRow < 0) return [];

    // 2. 定位每个单元格的星期 与 行对应的节次（rowspan 合并的行会被正确填充）
    for (var r2 = headerRow + 1; r2 < grid.length; r2++) {
        var row2 = grid[r2] || [];
        var label = row2[0];
        var lm = label ? trimText(label.textContent).match(/第\s*(\d+)\s*[,，、]\s*(\d+)\s*节/) : null;
        var sec = lm ? [parseInt(lm[1], 10), parseInt(lm[2], 10)] : null;
        for (var c2 = 1; c2 < row2.length; c2++) {
            var cell = row2[c2];
            if (!cell || !colDay[c2]) continue;
            if (cell.__sgDay === undefined) cell.__sgDay = colDay[c2];
            if (cell.__sgSec === undefined) cell.__sgSec = sec;
        }
    }

    // 3. 逐单元格解析课程
    var raw = [];
    var cells = table.querySelectorAll('td[name="kbDataTd"]');
    for (var i = 0; i < cells.length; i++) {
        var td = cells[i];
        var day = td.__sgDay;
        if (!day) continue;

        var items = td.querySelectorAll('li.courselists-item') || [];
        for (var j = 0; j < items.length; j++) {
            var li = items[j];
            var name = textOf(li, '.qz-hasCourse-title');
            if (!name) continue;

            var abbr = textOf(li, '.qz-hasCourse-abbrinfo');
            var teacher = (abbr.match(/老师[:：]\s*([^;；]*)/) || [])[1] || '';
            var position = (abbr.match(/地点[:：]\s*([^;；]*)/) || [])[1] || '';
            if (teacher) teacher = trimText(teacher);
            if (position) position = trimText(dedupePosition(position));

            var weeks = [], start = 0, end = 0;
            var times = abbr.match(/时间[:：]\s*([^;；]*)/g) || [];
            for (var k = 0; k < times.length; k++) {
                var v = trimText(times[k].replace(/^时间[:：]/, ''));
                weeks = weeks.concat(parseWeeks(v));
                var sm = v.match(/[\[［]\s*(\d+)\s*[-~]\s*(\d+)\s*节\s*[\]］]/);
                if (sm) {
                    var s1 = parseInt(sm[1], 10), e1 = parseInt(sm[2], 10);
                    start = start ? Math.min(start, s1) : s1;
                    end = Math.max(end, e1);
                }
            }
            weeks = uniqueSort(weeks);

            // 时间字段缺失时，退回使用行首的节次标签
            if (!start && td.__sgSec) { start = td.__sgSec[0]; end = td.__sgSec[1]; }
            if (!start) continue;

            raw.push({
                name: name,
                teacher: teacher,
                weeks: weeks,
                position: position,
                day: day,
                startSection: start,
                endSection: end || start
            });
        }
    }
    return mergeCourses(raw);
}

// 从教学周历页(jxzl_query)解析开学日期与总周数，返回 {startDate, totalWeeks}。
// 新版强智(qz-)校历每行形如 "第1周 | 07 | 08 | 09 | 10 | 11 | 09月12日 | 09月13日"：
// 周一~周五只显示日号，周末才有"月日"，所以取最早的带月份单元格作锚点，
// 用 (锚点日期 - 距第1周周一的天数) 反推第一周周一；年份由学期号推断。
function parseTermInfo(html, semId) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };

    var fullRe = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/;
    var mdRe = /(\d{1,2})\s*月\s*(\d{1,2})/;
    var anchors = [], maxWeek = 0;
    var table = null, tables = doc.getElementsByTagName('table');
    for (var i = 0; i < tables.length; i++) {
        if (/第\s*1\s*周/.test(tables[i].textContent)) { table = tables[i]; break; }
    }
    if (!table) return null;

    var rows = table.getElementsByTagName('tr');
    for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].getElementsByTagName('td');
        if (cells.length < 2) continue;
        var wm = trimText(cells[0].textContent).match(/第\s*(\d+)\s*周/);
        if (!wm) continue;
        var w = parseInt(wm[1], 10);
        if (w > maxWeek) maxWeek = w;
        for (var d = 0; d < 7 && d + 1 < cells.length; d++) {
            var t = trimText(cells[d + 1].textContent);
            var m = t.match(fullRe) || t.match(mdRe);
            if (!m) continue;
            anchors.push({
                idx: (w - 1) * 7 + d,
                year: m.length === 4 ? parseInt(m[1], 10) : null,
                month: parseInt(m[m.length - 2], 10),
                day: parseInt(m[m.length - 1], 10)
            });
        }
    }
    if (!anchors.length) return null;

    anchors.sort(function (a, b) { return a.idx - b.idx; });
    var a0 = anchors[0];
    var y0 = parseInt((String(semId).match(/^(\d{4})/) || [])[1], 10);
    var year = a0.year ||
        (a0.month >= 8 ? (y0 || new Date().getFullYear())
                        : (y0 ? y0 + 1 : new Date().getFullYear()));
    var start = new Date(year, a0.month - 1, a0.day - a0.idx); // Date 自动处理跨月/负数日
    if (isNaN(start.getTime())) return null;
    return {
        startDate: start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate()),
        totalWeeks: maxWeek || null
    };
}

// 按 YSSDUFE 标准姿势获取学期配置：POST 带 xnxq01id 请求所选学期的校历，
// 失败则退回 GET 带学期参数（ZHKU 姿势）→ GET 不带参数（仅当前学期）。
async function fetchTermInfo(semesterId) {
    var postUrl = JXZL_URL;
    var getUrl = JXZL_URL + (semesterId ? "?xnxq01id=" + encodeURIComponent(semesterId) : "");
    var attempts = [
        { url: postUrl, options: { method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "xnxq01id=" + encodeURIComponent(semesterId || "") } },
        { url: getUrl, options: { method: "GET" } }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            var resp = await fetch(attempts[i].url, Object.assign({ credentials: "include" }, attempts[i].options));
            if (!resp.ok) continue;
            var info = parseTermInfo(await resp.text(), semesterId);
            if (info && info.startDate) return info;
        } catch (e) { /* 尝试下一种方式 */ }
    }
    return null;
}

function mergeCourses(courses) {
    if (courses.length <= 1) return courses;
    courses.sort(function (a, b) {
        return a.name.localeCompare(b.name) || a.day - b.day || a.startSection - b.startSection;
    });
    var merged = [];
    var cur = courses[0];
    for (var i = 1; i < courses.length; i++) {
        var n = courses[i];
        var sameBase = cur.name === n.name && cur.teacher === n.teacher &&
            cur.position === n.position && cur.day === n.day;
        if (sameBase && cur.endSection + 1 === n.startSection) {
            // 同一天连续节次的同一门课，合并成一条
            cur.endSection = n.endSection;
            cur.weeks = uniqueSort(cur.weeks.concat(n.weeks));
        } else if (sameBase && cur.startSection === n.startSection && cur.endSection === n.endSection) {
            // 同一节次被拆成多段周次（如 14 周、15 周各一条），合并周次
            cur.weeks = uniqueSort(cur.weeks.concat(n.weeks));
        } else {
            merged.push(cur);
            cur = n;
        }
    }
    merged.push(cur);
    return merged;
}

function buildQuery(params) {
    var parts = [];
    for (var k in params) {
        if (params.hasOwnProperty(k)) {
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
    }
    return parts.join('&');
}

function baseParams(semId) {
    var p = {
        viweType: "0",
        showallprint: "0",
        showkchprint: "0",
        showkink: "0",
        showfzmprint: "0",
        baseUrl: "/jsxsd",
        xsflMapListJsonStr: "讲课学时,实践学时,讲座学时,实验学时,上机学时,课内实践学时,课程实践学时,",
        zc: ""
    };
    if (semId) p.xnxq01id = semId;
    return p;
}

async function fetchPage(params) {
    var resp = await fetch(KB_URL + "?" + buildQuery(params), { credentials: "include" });
    return new DOMParser().parseFromString(await resp.text(), "text/html");
}

// "时间模式"参数，部分账号不带上就不会渲染课表
function getKbjcmsid(doc) {
    var opt = doc.querySelector('select#kbjcmsid option');
    return opt ? trimText(opt.getAttribute('value')) : '';
}

// 从页面表单里读取可选的学年学期列表（如 2025-2026-2），无需手工输入
async function loadTermList() {
    var doc = await fetchPage(baseParams(""));
    var sel = doc.querySelector('select#xnxq01id');
    var options = [];
    var selected = 0;
    if (sel) {
        var opts = sel.getElementsByTagName('option');
        for (var i = 0; i < opts.length; i++) {
            var v = trimText(opts[i].getAttribute('value')) || trimText(opts[i].textContent);
            if (!v) continue;
            if (opts[i].getAttribute('selected') !== null) selected = options.length;
            options.push(v);
        }
    }
    return { options: options, selected: selected, kbjcmsid: getKbjcmsid(doc) };
}

async function fetchScheduleDoc(semId, kbjcmsid) {
    var p = baseParams(semId);
    if (kbjcmsid) p.kbjcmsid = kbjcmsid;
    return await fetchPage(p);
}

// showPrompt 的输入校验：v2 约定为全局函数名，返回 false=通过，返回字符串=错误提示
function validateYearInput(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的起始学年！";
}

async function promptUserToStart() {
    return window.shiguangBridgePromise.showAlert(
        "提示", "导入前请确保已成功登录教务系统。", "开始导入");
}

// 优先从教务页面读取学年学期列表直接选择；取不到再退回"手输学年 + 选学期"
async function chooseTerm() {
    try {
        window.shiguangBridge.showToast("正在获取学年学期列表...");
        const info = await loadTermList();
        if (info.options.length) {
            const idx = await window.shiguangBridgePromise.showSingleSelection(
                "选择学年学期", JSON.stringify(info.options), info.selected);
            if (idx === null) return null;
            return { semId: info.options[idx], kbjcmsid: info.kbjcmsid };
        }
    } catch (e) { /* 列表获取失败，走手工输入兜底 */ }

    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年", "请输入要导入的起始学年（例如 2025-2026 应输入 2025）:", "", "validateYearInput");
    if (year === null) return null;

    const semesterIdx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(["第一学期", "第二学期"]), -1);
    if (semesterIdx === null) return null;

    return {
        semId: year + "-" + (parseInt(year, 10) + 1) + "-" + (semesterIdx + 1),
        kbjcmsid: ""
    };
}

async function fetchAndParseCourses(term) {
    window.shiguangBridge.showToast("正在获取课表数据...");
    const doc = await fetchScheduleDoc(term.semId, term.kbjcmsid);
    const courses = parseSchedule(doc);

    if (courses.length === 0) {
        // 区分"页面没拿到"和"页面拿到了但该学期确实没课"，后者不能覆盖已有课程
        window.shiguangBridge.showToast(!doc.querySelector('table.qz-weeklyTable')
            ? "未获取到课表页面，请检查登录状态或学年学期是否正确。"
            : "该学年学期暂无课表数据，已保留原有课程。");
        return null;
    }
    return courses;
}

async function saveAll(courses, termInfo) {
    try {
        var config = { semesterTotalWeeks: (termInfo && termInfo.totalWeeks) || 20, firstDayOfWeek: 1 };
        if (termInfo && termInfo.startDate) config.semesterStartDate = termInfo.startDate;
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const term = await chooseTerm();
    if (term === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const courses = await fetchAndParseCourses(term);
    if (courses === null) return; // 失败原因已在 fetchAndParseCourses 中提示

    const termInfo = await fetchTermInfo(term.semId);
    if (!(await saveAll(courses, termInfo))) return;

    // 整条流程成功后才发送结束信号
    window.shiguangBridge.showToast("成功导入 " + courses.length + " 门课程" +
        (termInfo && termInfo.startDate ? "，开学日期 " + termInfo.startDate : ""));
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
