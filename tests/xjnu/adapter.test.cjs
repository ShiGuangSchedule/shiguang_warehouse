const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { parseSchedule, parseTimetable, parseCalendar, timeSlots, prepareTiming, runImportFlow } = require("../../resources/XJNU/xjnu.js");

const semester = "2026-2027-1";
const semesterSelect = value => `<select id="xnxq01id"><option value="${value}" selected>${value}</option></select>`;
const modeSelect = '<select id="kbjcmsid"><option value="mode-test">默认节次模式</option></select>';
const days = ["一", "二", "三", "四", "五", "六", "日"];
const parse = html => new JSDOM(html).window.document;
function block(name = "测试课程甲", schedule = "1-18(周)[01-02-03节]", position = "测试教学楼101") {
    return `${name}<br><font title="教师">测试教师</font><br><font title="周次(节次)">${schedule}</font><br><font title="教室">${position}</font>`;
}
function cell(detail) {
    return `<td><div class="kbcontent1">测试课程甲<br>1-18(周)</div><div class="kbcontent" style="display:none">${detail}</div><div class="kbcontent" style="display:none"></div></td>`;
}
function timetable({ value = semester, detail = block(), duplicate = true, sunday = false, unscheduled = true } = {}) {
    const contentRow = `<tr><th>第1-2节</th>${days.map((_, i) => (sunday ? i === 6 : i === 0) ? cell(detail) : '<td><div class="kbcontent">&nbsp;</div></td>').join("")}</tr>`;
    return `<title>学期理论课表</title>${semesterSelect(value)}${modeSelect}<table id="timetable"><tr><th></th>${days.map(day => `<th>星期${day}</th>`).join("")}</tr>${contentRow}${duplicate ? contentRow : ""}</table>` +
        (unscheduled ? '<table id="dataTables"><tr><th colspan="3">无课表课程</th></tr><tr><th>序号</th><th>课程名称</th><th>授课教师</th></tr><tr><th>1</th><td>测试待排课</td><td>测试教师</td></tr></table>' : "");
}
function calendar(value = semester) {
    return `${semesterSelect(value)}<table id="kbtable"><tr><th></th>${days.map(day => `<th>星期${day}</th>`).join("")}</tr>` +
        '<tr><td>1</td><td title="2026年08月31">31</td></tr><tr><td>20</td><td title="2027年01月11">11</td></tr></table>';
}

test("three-section lessons and explicit odd/even weeks", () => {
    assert.deepEqual(parseSchedule("1-18(单周)[01-02-03节]"), { weeks: [1,3,5,7,9,11,13,15,17], ranges: [{ startSection: 1, endSection: 3 }] });
    assert.deepEqual(parseSchedule("2-8(双周)[05-06节]").weeks, [2,4,6,8]);
    assert.deepEqual(parseSchedule("1,3,5,10-12(周)[07-08-09节]").weeks, [1,3,5,10,11,12]);
    assert.deepEqual(parseSchedule("1-4（周）【01-02节】").weeks, [1,2,3,4]);
});

test("nonconsecutive section lists stay separate; a two-endpoint range expands", () => {
    assert.deepEqual(parseSchedule("1-3(周)[01-03-05节]").ranges, [1,3,5].map(n => ({ startSection: n, endSection: n })));
    assert.deepEqual(parseSchedule("1-3(周)[01-03节]").ranges, [{ startSection: 1, endSection: 3 }]);
});

test("invalid schedules fail instead of silently dropping a lesson", () => {
    for (const bad of ["1-18(周)", "待定(周)[01-02节]", "18-1(周)[01-02节]", "0-2(周)[01节]", "1-2(周)[99节]"]) {
        assert.throws(() => parseSchedule(bad));
    }
});

test("hidden detailed lessons are read once; repeated table cells are deduplicated", () => {
    const result = parseTimetable(parse(timetable()));
    assert.equal(result.courses.length, 1);
    assert.deepEqual(result.courses[0], { name: "测试课程甲", teacher: "测试教师", position: "测试教学楼101", day: 1, startSection: 1, endSection: 3, weeks: Array.from({ length: 18 }, (_, i) => i + 1) });
    assert.deepEqual(result.unscheduled, ["测试待排课"]);
});

test("weekday headers determine Monday and Sunday correctly", () => {
    assert.equal(parseTimetable(parse(timetable({ sunday: true }))).courses[0].day, 7);
    const html = timetable({ sunday: true }).replace("星期日", "星期一").replace("星期一</th><th>星期二", "星期日</th><th>星期二");
    assert.equal(parseTimetable(parse(html)).courses[0].day, 1);
});

test("separated lessons in one cell, HTML course names, and disjoint weeks", () => {
    const detail = block("<font>测试课程甲</font>", "1,3,5(周)[01-02节]") + "<br>---------------------<br>" +
        block("测试课程甲", "2,4,6(周)[01-02节]") + "<br>---------------------<br>" + block("测试课程乙", "1-6(周)[03节]");
    const result = parseTimetable(parse(timetable({ detail })));
    assert.equal(result.courses.length, 2);
    assert.deepEqual(result.courses[0].weeks, [1,2,3,4,5,6]);
    assert.equal(result.courses[1].name, "测试课程乙");
});

test("different rooms are not merged", () => {
    const detail = block("测试课程甲", "1-3(周)[01-02节]", "测试教室甲") + "<br>---------------------<br>" + block("测试课程甲", "4-6(周)[01-02节]", "测试教室乙");
    assert.equal(parseTimetable(parse(timetable({ detail }))).courses.length, 2);
});

test("a scheduled course without a room is preserved with an empty location", () => {
    const detail = block().replace('<font title="教室">测试教学楼101</font>', '');
    const result = parseTimetable(parse(timetable({ detail })));
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0].position, "");
});

test("login pages and malformed timetable structures are rejected", () => {
    assert.throws(() => parseTimetable(parse('<title>登录</title><input id="userAccount">')), /登录/);
    assert.throws(() => parseTimetable(parse('<title>错误提示页面</title>')), /未找到/);
    assert.throws(() => parseTimetable(parse(timetable().replaceAll('class="kbcontent"', 'class="other"'))), /简略/);
    assert.throws(() => parseTimetable(parse(timetable({ detail: "课程<br>缺少时间" }))), /排课信息/);
});

test("calendar uses the selected semester, actual Monday, and real week count", () => {
    assert.deepEqual(parseCalendar(parse(calendar()), semester), { semesterStartDate: "2026-08-31", semesterTotalWeeks: 20, firstDayOfWeek: 1 });
    assert.throws(() => parseCalendar(parse(calendar("2025-2026-2")), semester), /学期/);
    assert.throws(() => parseCalendar(parse(calendar().replace("2026年08月31", "2026年09月01")), semester), /日期/);
});

function environment({ choose = 0, confirmed = true, saveResult = true, saveThrows = false, timeResult = true, timeThrows = false, calendarFails = false, wrongSemester = false, oldBridge = false } = {}) {
    const dom = new JSDOM("", { url: "https://jwxt.xjnu.edu.cn/jsxsd/framework/xsMain.htmlx" });
    const calls = { requests: [], alerts: [], selections: [], courses: [], configs: [], slots: [], completed: 0, times: 0 };
    const env = { location: dom.window.location, DOMParser: dom.window.DOMParser, AbortController, setTimeout, clearTimeout };
    const api = {
        showSingleSelection: async (...args) => { calls.selections.push(args); return Array.isArray(choose) ? choose.shift() : choose; },
        showAlert: async (...args) => { calls.alerts.push(args); return confirmed; },
        saveImportedCourses: async value => { if (saveThrows) throw new Error("模拟保存失败"); calls.courses.push(JSON.parse(value)); return saveResult; },
        saveCourseConfig: async value => { calls.configs.push(JSON.parse(value)); throw new Error("must not replace config"); },
        savePresetTimeSlots: async value => { calls.times++; calls.slots.push(JSON.parse(value)); if (timeThrows) throw new Error("模拟作息保存失败"); return timeResult; }
    };
    env[oldBridge ? "AndroidBridgePromise" : "shiguangBridgePromise"] = api;
    env[oldBridge ? "AndroidBridge" : "shiguangBridge"] = { notifyTaskCompletion: () => calls.completed++ };
    env.fetch = async (url, options) => {
        calls.requests.push({ url, options });
        if (url.includes("jxzl") && calendarFails) return { ok: false, status: 503 };
        return { ok: true, url, text: async () => url.includes("jxzl") ? calendar() : timetable({ value: options.method && wrongSemester ? "2025-2026-2" : semester }) };
    };
    return { env, calls };
}

test("end-to-end import uses same-origin cookies, clears week filter, and saves official slots", async () => {
    const { env, calls } = environment();
    const result = await runImportFlow(env);
    assert.equal(result.status, "imported");
    assert.equal(calls.courses[0].length, 1);
    assert.equal(result.calendar.semesterStartDate, "2026-08-31");
    assert.equal(calls.configs.length, 0);
    assert.equal(calls.times, 1);
    assert.deepEqual(calls.slots[0], timeSlots("wq-other"));
    assert.equal(calls.completed, 1);
    assert.match(calls.alerts[0][1], /测试待排课/);
    assert.match(calls.alerts[0][1], /10:00—10:45/);
    assert.equal(new URLSearchParams(calls.requests[1].options.body).get("zc"), "");
    assert.ok(calls.requests.every(r => r.options.credentials === "same-origin"));
});

test("legacy Android bridge is supported", async () => {
    const { env, calls } = environment({ oldBridge: true });
    assert.equal((await runImportFlow(env)).status, "imported");
    assert.equal(calls.times, 1);
});

test("cancel selection or confirmation never saves anything", async () => {
    for (const options of [{ choose: null }, { choose: -1 }, { choose: [0, null] }, { choose: [0, 0, null] }, { confirmed: false }]) {
        const { env, calls } = environment(options);
        assert.equal((await runImportFlow(env)).status, "cancelled");
        assert.equal(calls.courses.length, 0);
        assert.equal(calls.configs.length, 0);
        assert.equal(calls.times, 0);
        assert.equal(calls.completed, 0);
    }
});

test("save failures never announce success or save config", async () => {
    for (const options of [{ saveResult: false }, { saveThrows: true }]) {
        const { env, calls } = environment(options);
        await assert.rejects(runImportFlow(env), /保存/);
        assert.equal(calls.configs.length, 0);
        assert.equal(calls.times, 0);
        assert.equal(calls.completed, 0);
        assert.ok(!calls.alerts.some(a => a[0] === "导入完成"));
    }
});

test("calendar failure is disclosed and does not block confirmed course import", async () => {
    const { env, calls } = environment({ calendarFails: true });
    assert.equal((await runImportFlow(env)).status, "imported");
    assert.equal(calls.configs.length, 0);
    assert.match(calls.alerts[0][1], /手动核对开学日期/);
});

test("calendar is shown for manual verification without replacing duration defaults", async () => {
    const { env, calls } = environment();
    const result = await runImportFlow(env);
    assert.equal(calls.courses.length, 1);
    assert.equal(calls.configs.length, 0);
    assert.equal(result.calendar.semesterTotalWeeks, 20);
    assert.match(calls.alerts.at(-1)[1], /2026-08-31/);
});

test("wrong semester or foreign origin cannot import", async () => {
    const { env, calls } = environment({ wrongSemester: true });
    await assert.rejects(runImportFlow(env), /学期/);
    assert.equal(calls.courses.length, 0);
    env.location = { origin: "https://example.com" };
    calls.requests.length = 0;
    await assert.rejects(runImportFlow(env), /先打开/);
    assert.equal(calls.requests.length, 0);
});

test("login expiration on the network response is surfaced", async () => {
    const { env, calls } = environment();
    env.fetch = async () => ({ ok: true, url: "https://jwxt.xjnu.edu.cn/jsxsd/", text: async () => '<title>登录</title><input id="userAccount">' });
    await assert.rejects(runImportFlow(env), /登录/);
    assert.equal(calls.courses.length, 0);
});

test("empty timetables cannot overwrite existing courses", async () => {
    const { env, calls } = environment();
    env.fetch = async url => ({ ok: true, url, text: async () => timetable().replace(/<div class="kbcontent" style="display:none">.*?<\/div>/g, '<div class="kbcontent"></div>').replace(/<div class="kbcontent1">.*?<\/div>/g, '') });
    await assert.rejects(runImportFlow(env), /没有已排定/);
    assert.equal(calls.courses.length, 0);
});

test("a returned mode mismatch cannot import", async () => {
    const { env, calls } = environment();
    env.fetch = async (url, options) => ({ ok: true, url, text: async () => options.method ? timetable().replace('value="mode-test"', 'value="different-mode"') : timetable() });
    await assert.rejects(runImportFlow(env), /节次模式/);
    assert.equal(calls.courses.length, 0);
});

test("browser script entrypoint invokes the new bridge without CommonJS globals", async () => {
    const { env, calls } = environment();
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    env.shiguangBridge.notifyTaskCompletion = () => { calls.completed++; finish(); };
    const source = fs.readFileSync(require.resolve("../../resources/XJNU/xjnu.js"), "utf8");
    vm.runInNewContext(source, { window: env, URLSearchParams, URL });
    await finished;
    assert.equal(calls.completed, 1);
    assert.equal(calls.courses[0].length, 1);
    assert.equal(calls.configs.length, 0);
    assert.equal(calls.times, 1);
});

test("all five official timetables contain ten ordered 45-minute sections", () => {
    const expectedMorning = {
        "wq-other": ["10:00-10:45", "10:50-11:35", "12:00-12:45", "12:50-13:35"],
        "wq-2": ["10:00-10:45", "10:50-11:35", "11:50-12:35", "12:40-13:25"],
        "wq-3": ["10:00-10:45", "10:50-11:35", "12:10-12:55", "13:00-13:45"],
        "kl-wenshi": ["10:00-10:45", "10:55-11:40", "12:00-12:45", "12:55-13:40"],
        "kl-other": ["10:00-10:45", "10:55-11:40", "12:10-12:55", "13:05-13:50"]
    };
    const afternoon = ["15:30-16:15", "16:25-17:10", "17:30-18:15", "18:25-19:10", "20:00-20:45", "20:55-21:40"];
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    for (const [id, morning] of Object.entries(expectedMorning)) {
        const slots = timeSlots(id);
        assert.deepEqual(slots.map(s => s.startTime + "-" + s.endTime), [...morning, ...afternoon]);
        slots.forEach((slot, i) => {
            assert.equal(slot.number, i + 1);
            assert.equal(minutes(slot.endTime) - minutes(slot.startTime), 45);
            if (i) assert.ok(minutes(slot.startTime) >= minutes(slots[i - 1].endTime));
        });
    }
});

test("user can preserve an existing timetable without saving times or config", async () => {
    const { env, calls } = environment({ choose: [0, 5] });
    assert.equal((await runImportFlow(env)).status, "imported");
    assert.equal(calls.times, 0);
    assert.equal(calls.configs.length, 0);
    assert.match(calls.alerts[0][1], /保留目标课表已有作息/);
    assert.equal(calls.courses[0][0].isCustomTime, undefined);
});

function timingApi(choices) {
    const questions = [];
    return { questions, savePresetTimeSlots() {}, async showSingleSelection(...args) {
        questions.push(args);
        assert.ok(choices.length, "unexpected location prompt");
        return choices.shift();
    } };
}
const timingCourse = (position, startSection = 3, endSection = 4) => ({ name: "测试课程", position, startSection, endSection, day: 1, teacher: "测试教师", weeks: [1, 3, 5] });

test("mixed campus and building schedules use precise overrides without losing sections or weeks", async () => {
    const api = timingApi([0]);
    const courses = [timingCourse("温泉校区2号教学楼101"), timingCourse("温泉校区3号教学楼202"), timingCourse("昆仑校区文史楼303"), timingCourse("温泉校区1号教学楼404")];
    const before = JSON.stringify(courses);
    const timing = await prepareTiming(api, courses, semester);
    assert.equal(api.questions.length, 1);
    assert.deepEqual(timing.courses.map(c => [c.customStartTime, c.customEndTime]), [["11:50", "13:25"], ["12:10", "13:45"], ["12:00", "13:40"], [undefined, undefined]]);
    assert.equal(timing.courses[0].isCustomTime, true);
    assert.equal(timing.courses[0].startSection, 3);
    assert.equal(timing.courses[0].endSection, 4);
    assert.deepEqual(timing.courses[0].weeks, [1, 3, 5]);
    assert.equal(JSON.stringify(courses), before);
    assert.match(timing.description, /3 条错峰安排/);
});

test("unknown aliases are confirmed once per building and afternoon classes need no extra prompt", async () => {
    const api = timingApi([0, 2]);
    const timing = await prepareTiming(api, [timingCourse("测试楼101"), timingCourse("测试楼202", 1, 3), timingCourse("测试操场", 5, 6)], semester);
    assert.equal(api.questions.length, 2);
    assert.match(api.questions[1][0], /测试楼/);
    assert.deepEqual(timing.courses.map(c => c.customEndTime), ["13:45", "12:55", undefined]);
    assert.match(timing.description, /测试楼 → 温泉：3号教学楼/);
});

test("ambiguous numbered buildings and unknown classrooms are not silently guessed", async () => {
    const api = timingApi([4, 1, 4]);
    const timing = await prepareTiming(api, [timingCourse("2号教学楼101"), timingCourse("")], semester);
    assert.equal(api.questions.length, 3);
    assert.match(api.questions[1][0], /2号教学楼/);
    assert.match(api.questions[2][0], /未注明教室/);
    assert.equal(timing.courses[0].customStartTime, "11:50");
    assert.equal(timing.courses[1].isCustomTime, undefined);
});

test("historical semesters and unsupported sections keep times without inventing slots", async () => {
    for (const [term, courses, warning] of [
        ["2024-2025-1", [timingCourse("测试楼")], /早于/],
        ["2023-2024-2", [timingCourse("测试楼")], /早于/],
        [semester, [timingCourse("测试楼", 11, 12)], /未公布/]
    ]) {
        const api = timingApi([]);
        const timing = await prepareTiming(api, courses, term);
        assert.equal(timing.slots, null);
        assert.deepEqual(timing.courses, courses);
        assert.match(timing.description, warning);
    }
    assert.equal((await prepareTiming(timingApi([0]), [timingCourse("温泉校区1号教学楼101")], "2024-2025-2")).slots.length, 10);
});

test("time save failures disclose partial success and never announce completion", async () => {
    for (const options of [{ timeResult: false }, { timeThrows: true }]) {
        const { env, calls } = environment(options);
        await assert.rejects(runImportFlow(env), /课程已保存，但学校作息未能写入/);
        assert.equal(calls.courses.length, 1);
        assert.equal(calls.times, 1);
        assert.equal(calls.configs.length, 0);
        assert.equal(calls.completed, 0);
        assert.ok(!calls.alerts.some(a => a[0] === "导入完成"));
    }
});

test("missing time bridge fails before saving any course", async () => {
    const { env, calls } = environment();
    delete env.shiguangBridgePromise.savePresetTimeSlots;
    await assert.rejects(runImportFlow(env), /不支持导入作息/);
    assert.equal(calls.courses.length, 0);
});
