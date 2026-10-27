// 济南工程职业技术学院 — 正方新一代教务（jwglxt）
// 维护者：西郊有密林(@xianzhaowang0-code)

const GNMKDM = "N2151";
const JW_ORIGIN = "http://vpnxt.jngcxy.edu.cn";
const MIN_TOTAL_WEEKS = 20;

const DEFAULT_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:10", endTime: "11:55" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:20", endTime: "15:05" },
    { number: 7, startTime: "15:15", endTime: "16:00" },
    { number: 8, startTime: "16:05", endTime: "16:50" },
    { number: 9, startTime: "19:00", endTime: "19:50" },
    { number: 10, startTime: "20:00", endTime: "20:50" }
];


function sortBy(list, key) {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(list[i]);
    for (let i = 1; i < out.length; i++) {
        const current = out[i];
        const currentKey = key(current);
        let j = i - 1;
        while (j >= 0 && key(out[j]) > currentKey) {
            out[j + 1] = out[j];
            j--;
        }
        out[j + 1] = current;
    }
    return out;
}

function toList(data) {
    if (Array.isArray(data)) return data;
    return (data && (data.data || data.rows)) || [];
}

function buildApiUrl(modulePath) {
    const path = String(window.location.pathname || "");
    const prefix = (path.match(/^\/(?:https?|webvpn)\/[0-9a-z]+/i) || [""])[0];
    const origin = /\/jwglxt\//i.test(path) ? window.location.origin : JW_ORIGIN;
    return origin + prefix + "/jwglxt" + modulePath + "?gnmkdm=" + GNMKDM;
}

async function postForm(modulePath, body) {
    const response = await fetch(buildApiUrl(modulePath), {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: body
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const text = await response.text();
    if (text.trim().charAt(0) === "<") throw new Error("SESSION_LOST");
    return JSON.parse(text);
}

function isOnSsoPage() {
    const host = String(window.location.hostname || "");
    const path = String(window.location.pathname || "");
    return /^uap\./i.test(host) || /\/authserver\//i.test(path) || /\/lyuapServer\//i.test(path);
}

function parseWeeks(text) {
    const weeks = new Set();
    const parts = String(text || "")
        .replace(/[（]/g, "(")
        .replace(/[）]/g, ")")
        .replace(/[，、；;]/g, ",")
        .split(",");

    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i].trim();
        if (!seg) continue;

        const range = seg.match(/(\d+)\s*[-~至]\s*(\d+)/);
        const single = seg.match(/\d+/);
        const start = range ? Number(range[1]) : Number(single && single[0]);
        const end = range ? Number(range[2]) : start;
        if (!(start > 0) || !(end >= start)) continue;

        const odd = seg.indexOf("单") >= 0;
        const even = seg.indexOf("双") >= 0;
        for (let week = start; week <= end; week++) {
            if (odd && week % 2 === 0) continue;
            if (even && week % 2 !== 0) continue;
            weeks.add(week);
        }
    }
    return sortBy(Array.from(weeks), (week) => week);
}

function parseSections(text) {
    const nums = String(text || "").match(/\d+/g);
    if (!nums) return null;
    let start = 0;
    let end = 0;
    for (let i = 0; i < nums.length; i++) {
        const value = Number(nums[i]);
        if (!(value > 0)) continue;
        if (!start || value < start) start = value;
        if (value > end) end = value;
    }
    return start ? [start, end] : null;
}

function parseKbList(json) {
    const rows = (json && json.kbList) || [];
    const courses = [];
    const seen = new Set();
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const name = String(row.kcmc || "").trim();
        const day = Number(row.xqj);
        const weeks = parseWeeks(row.zcd);
        const sections = parseSections(row.jcs);

        if (!name || !(day >= 1 && day <= 7) || !weeks.length || !sections) {
            skipped++;
            continue;
        }

        const key = [name, row.xm, row.cdmc, day, sections[0], sections[1], weeks.join("-")].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        const course = {
            name: name,
            teacher: String(row.xm || "").trim(),
            position: String(row.cdmc || "").trim(),
            day: day,
            startSection: sections[0],
            endSection: sections[1],
            weeks: weeks
        };
        const credit = Number(row.xf);
        if (credit > 0) course.credit = credit;
        courses.push(course);
    }

    const sorted = sortBy(courses, (course) => course.day * 100 + course.startSection);
    console.log(`JS: 课表解析完成，共 ${sorted.length} 条课程记录，跳过 ${skipped} 条无固定时间的记录`);
    return sorted;
}

function readOptions(doc, selector) {
    const nodes = doc.querySelectorAll(selector + " option");
    const options = [];
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const value = String(node.getAttribute("value") || "").trim();
        if (!value) continue;
        options.push({
            value: value,
            text: (node.textContent || "").trim(),
            selected: node.hasAttribute("selected")
        });
    }
    return options;
}

async function fetchAcademicOptions() {
    const response = await fetch(buildApiUrl("/kbcx/xskbcx_cxXskbcxIndex.html"), {
        method: "GET",
        credentials: "include"
    });
    if (!response.ok) throw new Error("HTTP " + response.status);

    const html = await response.text();
    if (/\/authserver\/|name="password"/i.test(html)) throw new Error("SESSION_LOST");

    const doc = new DOMParser().parseFromString(html, "text/html");
    const yearOptions = readOptions(doc, "#xnm");
    const termOptions = readOptions(doc, "#xqm");
    if (!yearOptions.length || !termOptions.length) throw new Error("未取到学年/学期选项");
    return { yearOptions: yearOptions, termOptions: termOptions };
}

async function chooseYearAndSemester() {
    const options = await fetchAcademicOptions();
    const { yearOptions, termOptions } = options;

    let defaultYear = 0;
    for (let i = 0; i < yearOptions.length; i++) {
        if (yearOptions[i].selected) defaultYear = i;
    }
    const yearTexts = [];
    for (let i = 0; i < yearOptions.length; i++) yearTexts.push(yearOptions[i].text);
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(yearTexts), defaultYear
    );
    if (!(yearIndex >= 0)) return null;

    let defaultTerm = 0;
    for (let i = 0; i < termOptions.length; i++) {
        if (termOptions[i].selected) defaultTerm = i;
    }
    const termTexts = [];
    for (let i = 0; i < termOptions.length; i++) termTexts.push(termOptions[i].text);
    const termIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(termTexts), defaultTerm
    );
    if (!(termIndex >= 0)) return null;

    return {
        xnm: yearOptions[yearIndex].value,
        xqm: termOptions[termIndex].value
    };
}

async function fetchCourseTable(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=`;
    return postForm("/kbcx/xskbcx_cxXsgrkb.html", body);
}

async function fetchStartDate(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}`;
    const rows = toList(await postForm("/kbcx/xskbcxZccx_cxZcByXnxq.html", body));

    let first = rows[0];
    for (let i = 0; i < rows.length; i++) {
        const item = rows[i] || {};
        if (String(item.zs || item.zcmc || "") === "1") first = item;
    }
    const match = String((first && (first.rq || first.zcrq)) || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) throw new Error("未取到本学期开学日期");
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

async function fetchTimeSlots(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
    let rows;
    try {
        rows = toList(await postForm("/kbcx/xskbcx_cxRjc.html", body));
    } catch (e) {
        console.warn("JS: 读取节次作息失败：" + (e && e.message));
        return [];
    }

    const slots = [];
    for (let i = 0; i < rows.length; i++) {
        const item = rows[i] || {};
        const number = Number(item.jcdm);
        const sksj = String(item.sksj || "").split(/[~\-—至到]/);
        const startTime = String(item.qssj || sksj[0] || "").trim().slice(0, 5);
        const endTime = String(item.jssj || sksj[1] || "").trim().slice(0, 5);
        if (!(number > 0) || !startTime || !endTime) continue;
        slots.push({ number: number, startTime: startTime, endTime: endTime });
    }
    return sortBy(slots, (slot) => slot.number);
}

function toMinutes(time) {
    const match = String(time || "").match(/(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function buildCourseConfig(courses, startDate, firstDayOfWeek, slots) {
    let maxWeek = 0;
    for (let i = 0; i < courses.length; i++) {
        const weeks = courses[i].weeks;
        for (let j = 0; j < weeks.length; j++) {
            if (weeks[j] > maxWeek) maxWeek = weeks[j];
        }
    }
    return {
        semesterStartDate: startDate,
        semesterTotalWeeks: Math.max(maxWeek, MIN_TOTAL_WEEKS),
        firstDayOfWeek: firstDayOfWeek,
        defaultClassDuration: toMinutes(slots[0].endTime) - toMinutes(slots[0].startTime),
        defaultBreakDuration: toMinutes(slots[1].startTime) - toMinutes(slots[0].endTime)
    };
}

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;

    if (isOnSsoPage()) {
        await bridge.showAlert(
            "还停在统一认证页",
            "当前页面是统一认证或门户，请先完成登录，并进入「教务系统」，" +
            "等地址栏变成教务系统的 /jwglxt/ 页面之后再执行导入。",
            "知道了"
        );
        return;
    }

    const confirmed = await bridge.showAlert(
        "济南工程职业技术学院课表导入",
        "开始前请确认：\n" +
        "1. 已登录教务系统，且当前页面在教务系统内（地址带 /jwglxt/）；\n" +
        "2. 校外访问需先连接学校的 aTrust 客户端，否则教务页面无法打开；\n" +
        "3. 导入会覆盖应用内现有课表，请先备份需要保留的课程。\n\n" +
        "点击「开始导入」后请依次选择学年和学期。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入。");
        return;
    }

    window.shiguangBridge.showToast("正在拉取课表...");

    let courses;
    let startDate;
    let slots;
    let firstDayOfWeek;
    try {
        const selection = await chooseYearAndSemester();
        if (selection === null) {
            window.shiguangBridge.showToast("已取消导入。");
            return;
        }

        const json = await fetchCourseTable(selection.xnm, selection.xqm);
        courses = parseKbList(json);
        if (!courses.length) {
            await bridge.showAlert(
                "没有取到课程",
                "接口返回了空课表。请确认所选学年/学期是否正确；若确认无误，可能是本学期尚未排课。",
                "知道了"
            );
            return;
        }

        startDate = await fetchStartDate(selection.xnm, selection.xqm);
        slots = await fetchTimeSlots(selection.xnm, selection.xqm);
        if (slots.length < 2) {
            slots = DEFAULT_TIME_SLOTS;
            console.warn("JS: 未取到节次作息，使用内置的本校作息");
            window.shiguangBridge.showToast("未取到真实作息，改用内置的本校作息。");
        }

        const qsxqj = Number(json.qsxqj);
        firstDayOfWeek = (qsxqj >= 1 && qsxqj <= 7) ? qsxqj : 1;

        window.shiguangBridge.showToast(`解析到 ${courses.length} 条课程记录，正在保存...`);
        await bridge.saveImportedCourses(JSON.stringify(courses));
        await bridge.savePresetTimeSlots(JSON.stringify(slots));
        await bridge.saveCourseConfig(JSON.stringify(
            buildCourseConfig(courses, startDate, firstDayOfWeek, slots)
        ));
    } catch (e) {
        const message = e && e.message;
        if (message === "SESSION_LOST") {
            await bridge.showAlert(
                "未登录或会话已失效",
                "教务系统返回的是登录页。请先在页面中重新登录教务，再执行导入。",
                "知道了"
            );
        } else {
            await bridge.showAlert(
                "导入失败",
                "错误信息：" + message + "\n\n请确认：\n" +
                "1. 已连接校园网，或已先打开学校的 aTrust 客户端；\n" +
                "2. 已登录教务系统且页面在 /jwglxt/ 内；\n" +
                "3. 所选学年/学期正确。",
                "知道了"
            );
        }
        return;
    }

    window.shiguangBridge.showToast(`导入完成，共 ${courses.length} 条课程`);
    console.log(`JS: 导入完成，共 ${courses.length} 条课程，作息 ${slots.length} 节，开学日期 ${startDate}`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
