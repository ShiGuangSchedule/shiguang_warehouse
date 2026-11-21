// 西华师范大学拾光课程表适配脚本 · 树维 · 本科
// 不能直接进入教务系统，而是要先登录信息门户再进入教务系统。教务系统和信息门户账密不一样，import_url 已内置 SSO 深链。
// 学校冬夏令两套作息，用 saveComboSchedule 按日期给两段方案。

"use strict";

(function () {
    const BIZ_TYPE_ID = 2;
    const LOGIN_EXPIRED = "LOGIN_EXPIRED";
    const MIN_WEEKS = 16;
    const MAX_WEEKS = 60;

    const API = {
        page: "/student/for-std/course-table",
        getData: (s) => "/student/for-std/course-table/get-data?bizTypeId=" + BIZ_TYPE_ID + "&semesterId=" + encodeURIComponent(s),
        datum: "/student/ws/schedule-table/datum",
    };

    // 夏令 05-01~09-30 / 冬令 10-01~次年 04-30，上午相同，下午与晚上整体后移半个小时
    const SLOTS_WINTER = [
        [1, "08:00", "08:40"], [2, "08:50", "09:30"], [3, "09:45", "10:25"],
        [4, "10:35", "11:15"], [5, "11:25", "12:05"], [6, "14:30", "15:10"],
        [7, "15:20", "16:00"], [8, "16:10", "16:50"], [9, "17:00", "17:40"],
        [10, "19:00", "19:40"], [11, "19:50", "20:30"], [12, "20:40", "21:20"],
    ].map(([number, startTime, endTime]) => ({ number, startTime, endTime }));

    const SLOTS_SUMMER = [
        [1, "08:00", "08:40"], [2, "08:50", "09:30"], [3, "09:45", "10:25"],
        [4, "10:35", "11:15"], [5, "11:25", "12:05"], [6, "15:00", "15:40"],
        [7, "15:50", "16:30"], [8, "16:40", "17:20"], [9, "17:30", "18:10"],
        [10, "19:30", "20:10"], [11, "20:20", "21:00"], [12, "21:10", "21:50"],
    ].map(([number, startTime, endTime]) => ({ number, startTime, endTime }));

    const ui = {
        toast: (m) => window.shiguangBridge.showToast(m),
        alert: (t, m, b) => window.shiguangBridgePromise.showAlert(t, m, b),
        select: (t, items, d) => window.shiguangBridgePromise.showSingleSelection(t, JSON.stringify(items), d),
        saveConfig: (j) => window.shiguangBridgePromise.saveCourseConfig(j),
        saveTimeSlots: (j) => window.shiguangBridgePromise.savePresetTimeSlots(j),
        saveCombo: (j) => window.shiguangBridgePromise.saveComboSchedule(j),
        saveCourses: (j) => window.shiguangBridgePromise.saveImportedCourses(j),
        done: () => window.shiguangBridge.notifyTaskCompletion(),
    };

    const log = (m) => console.error("[CWNU] " + m);
    const pad2 = (n) => String(n).padStart(2, "0");

    // 教务时间可能是 "08:00"，也可能是整数 800
    function hhmm(v) {
        if (typeof v === "string" && v.indexOf(":") > 0) {
            const p = v.split(":");
            return pad2(Number(p[0])) + ":" + pad2(Number(p[1]));
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 2359 || n % 100 > 59) return "";
        return pad2(Math.floor(n / 100)) + ":" + pad2(Math.floor(n % 100));
    }

    function expired() {
        const e = new Error("登录状态已失效，请重新登录教务系统后重试");
        e.code = LOGIN_EXPIRED;
        return e;
    }

    async function request(url, options) {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
        try {
            const init = Object.assign({ credentials: "include" }, options || {});
            if (ctl) init.signal = ctl.signal;
            const res = await fetch(url, init);
            // 登录页是 200 的 HTML，不能交给 JSON.parse
            let path = "";
            try { path = new URL(res.url || "", location.href).pathname; } catch (e) { path = ""; }
            if (path.indexOf("/student/login") === 0 || path.indexOf("/student/sso") === 0) throw expired();
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) throw expired();
                throw new Error("网络请求失败（HTTP " + res.status + "）");
            }
            return await res.text();
        } catch (e) {
            if (e.name === "AbortError") throw new Error("请求超时，请检查网络");
            if (e instanceof TypeError) throw new Error("网络异常或登录状态失效，请重新登录后重试");
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function json(url, options) {
        const t = await request(url, options);
        try { return JSON.parse(t); } catch (e) {
            log("接口返回非 JSON: " + t.slice(0, 200));
            throw new Error("接口返回异常，可能登录已失效");
        }
    }

    function parseSemesters(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const sel = doc.querySelector("#allSemesters, #semesters");
        if (!sel) throw new Error("未找到学期选择框，请确认已进入教务课表页");
        const list = [];
        let current = -1;
        Array.from(sel.querySelectorAll("option")).forEach((opt) => {
            const id = (opt.getAttribute("value") || "").trim();
            const name = (opt.textContent || "").trim();
            if (!id || id === "all") return;
            if (current < 0 && (opt.hasAttribute("selected") || opt.selected)) current = list.length;
            list.push({ id, name });
        });
        if (!list.length) throw new Error("学期列表为空");
        return { list, current: Math.max(current, 0) };
    }

    // 页面内嵌 var semesters = JSON.parse('[{\"id\":261,...}]')，取各学期起止日期
    function parseDates(html) {
        const out = {};
        const at = html.indexOf("var semesters");
        if (at < 0) return out;
        // 页面里的 JSON 以单引号字符串内嵌，引号都带反斜杠，先还原成标准 JSON
        const seg = html.slice(at, at + 400000).replace(/\\"/g, '"').replace(/\\'/g, "'");
        const re = /\{[^{}]*\}/g;
        let m;
        while ((m = re.exec(seg))) {
            const b = m[0];
            const id = /"id"\s*:\s*(\d+)/.exec(b);
            const sd = /"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(b);
            if (!id || !sd) continue;
            const ed = /"endDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(b);
            const sun = /"weekStartOnSunday"\s*:\s*(true|false)/.exec(b);
            out[id[1]] = { startDate: sd[1], endDate: ed ? ed[1] : null, sundayFirst: sun ? sun[1] === "true" : false };
        }
        return out;
    }

    function parseStdPersonId(html) {
        const m = /stdPersonId'?\]?\s*[:=]\s*(\d+)/.exec(html);
        return m ? Number(m[1]) : null;
    }

    async function fetchGetData(semesterId) {
        const j = await json(API.getData(semesterId));
        if (!j) throw new Error("课表数据为空");
        return {
            lessonIds: Array.isArray(j.lessonIds) ? j.lessonIds : [],
            weekIndices: Array.isArray(j.weekIndices) ? j.weekIndices : [],
            flags: j.lessonId2Flag || null,
        };
    }

    async function fetchDatum(lessonIds, stdPersonId) {
        const j = await json(API.datum, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lessonIds, studentId: null, stdPersonId, weekIndex: null }),
        });
        const r = j && j.result;
        if (!r) throw new Error("排课数据异常，请重新登录后重试");
        return { lessons: r.lessonList || [], schedules: r.scheduleList || [] };
    }

    function buildCombo() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const d = (yy, mm, dd) => yy + "-" + pad2(mm) + "-" + pad2(dd);
        let rules;
        if (m >= 5 && m <= 9) {
            rules = [
                { name: "夏令作息", startDate: d(y, 5, 1), endDate: d(y, 9, 30), timeSlots: SLOTS_SUMMER },
                { name: "冬令作息", startDate: d(y, 10, 1), endDate: d(y + 1, 4, 30), timeSlots: SLOTS_WINTER },
            ];
        } else if (m >= 10) {
            rules = [
                { name: "冬令作息", startDate: d(y, 10, 1), endDate: d(y + 1, 4, 30), timeSlots: SLOTS_WINTER },
                { name: "夏令作息", startDate: d(y + 1, 5, 1), endDate: d(y + 1, 9, 30), timeSlots: SLOTS_SUMMER },
            ];
        } else {
            rules = [
                { name: "冬令作息", startDate: d(y - 1, 10, 1), endDate: d(y, 4, 30), timeSlots: SLOTS_WINTER },
                { name: "夏令作息", startDate: d(y, 5, 1), endDate: d(y, 9, 30), timeSlots: SLOTS_SUMMER },
            ];
        }
        return { name: "西华师范大学作息（冬令/夏令）", publicSchedules: rules };
    }

    const roomOf = (s) => {
        const r = s.room;
        if (r && typeof r === "object") {
            const campus = r.building && r.building.campus && r.building.campus.nameZh;
            const name = r.nameZh || r.name;
            return [campus, name].filter(Boolean).map((x) => String(x).trim()).join(" ");
        }
        if (typeof r === "string" && r.trim()) return r.trim();
        return s.customPlace == null ? "" : String(s.customPlace).trim();
    };

    const teacherOf = (s, lesson) => {
        if (s.personName && String(s.personName).trim()) return String(s.personName).trim();
        const list = lesson && lesson.teacherAssignmentList;
        if (!Array.isArray(list)) return "";
        return Array.from(new Set(list.map((t) => (t && (t.name || (t.person && t.person.nameZh))) || "").filter(Boolean))).join(",");
    };

    const nameOf = (lesson) => {
        if (!lesson) return "";
        return String(lesson.courseName || (lesson.course && lesson.course.nameZh) || "").trim();
    };

    function convertCourses(lessons, schedules, flags) {
        const byId = new Map(lessons.map((l) => [String(l.id), l]));
        const byStart = {};
        const byEnd = {};
        [SLOTS_WINTER, SLOTS_SUMMER].forEach((list) => list.forEach((s) => {
            byStart[s.startTime] = s.number;
            byEnd[s.endTime] = s.number;
        }));

        const map = new Map();
        for (const s of schedules) {
            const lesson = byId.get(String(s.lessonId));
            if (!lesson) continue;
            const flag = flags && flags[String(s.lessonId)];
            if (flag && flag !== "publish") continue;

            const name = nameOf(lesson);
            const day = Number(s.weekday);
            const week = Number(s.weekIndex);
            const st = hhmm(s.startTime);
            const et = hhmm(s.endTime);
            if (!name || !(day >= 1 && day <= 7) || !(week >= 1) || !st || !et || st >= et) continue;

            const ss = byStart[st];
            const es = byEnd[et];
            const custom = !(ss && es && ss <= es);
            const pos = roomOf(s);
            const teacher = teacherOf(s, lesson);
            const key = [name, teacher, pos, day, custom ? st : ss, custom ? et : es].join("|");

            let c = map.get(key);
            if (!c) {
                c = { name, teacher, position: pos, day, weeks: new Set(), custom };
                if (custom) {
                    c.customStartTime = st;
                    c.customEndTime = et;
                } else {
                    c.startSection = ss;
                    c.endSection = es;
                }
                map.set(key, c);
            }
            c.weeks.add(week);
        }

        return Array.from(map.values()).map((c) => {
            const o = {
                name: c.name, teacher: c.teacher, position: c.position, day: c.day,
                weeks: Array.from(c.weeks).sort((a, b) => a - b), isCustomTime: c.custom,
            };
            if (c.custom) {
                o.customStartTime = c.customStartTime;
                o.customEndTime = c.customEndTime;
            } else {
                o.startSection = c.startSection;
                o.endSection = c.endSection;
            }
            return o;
        }).sort((a, b) => a.day - b.day || (a.startSection || 0) - (b.startSection || 0));
    }

    function totalWeeks(weekIndices, courses) {
        let w = 0;
        weekIndices.forEach((x) => { const n = Number(x); if (n > w) w = n; });
        if (!w) courses.forEach((c) => { const n = c.weeks[c.weeks.length - 1]; if (n > w) w = n; });
        if (!w) w = 20;
        if (w > MAX_WEEKS) throw new Error("总周数（" + w + "）超过上限 " + MAX_WEEKS);
        return Math.max(w, MIN_WEEKS);
    }

    async function save(fn, data, msg) {
        try { await fn(JSON.stringify(data)); } catch (e) { throw new Error(msg); }
    }

    async function runImportFlow() {
        try {
            if (!await ui.alert("西华师范大学课表导入",
                "本校教务系统需通过「信息门户」进入，与教务系统密码不同。\n\n" +
                "请确认已登录信息门户并进入教务系统，当前停留在课表页面。",
                "开始导入")) {
                ui.toast("导入已取消");
                return;
            }

            ui.toast("正在获取学期列表...");
            const html = await request(API.page);
            const { list, current } = parseSemesters(html);
            const dates = parseDates(html);
            const stdPersonId = parseStdPersonId(html);

            const idx = await ui.select("选择学期", list.map((s) => s.name), current);
            if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
                ui.toast("导入已取消");
                return;
            }
            const semester = list[idx];

            ui.toast("正在获取课表数据...");
            const gd = await fetchGetData(semester.id);
            if (!gd.lessonIds.length) {
                await ui.alert("没有课程", "「" + semester.name + "」未查询到课程。", "确定");
                return;
            }

            const datum = await fetchDatum(gd.lessonIds, stdPersonId);
            const courses = convertCourses(datum.lessons, datum.schedules, gd.flags);
            if (!courses.length) {
                await ui.alert("解析失败", "未能从课表数据中解析出课程。", "确定");
                return;
            }

            const meta = dates[semester.id] || null;
            const config = {
                semesterStartDate: meta ? meta.startDate : null,
                semesterTotalWeeks: totalWeeks(gd.weekIndices, courses),
                defaultClassDuration: 40,
                defaultBreakDuration: 10,
                firstDayOfWeek: meta && meta.sundayFirst ? 7 : 1,
            };

            // savePresetTimeSlots 须先成功，否则 saveComboSchedule 会被拒绝
            await save(ui.saveConfig, config, "保存课表配置失败");
            await save(ui.saveTimeSlots, SLOTS_WINTER, "保存作息失败");
            try {
                await ui.saveCombo(JSON.stringify(buildCombo()));
            } catch (e) {
                log("组合作息保存失败（不影响课程）: " + (e && e.message));
            }
            await save(ui.saveCourses, courses, "保存课程失败");

            ui.toast("成功导入 " + courses.length + " 条课程");
            ui.done();
        } catch (e) {
            log("导入异常: " + (e && (e.stack || e.message)));
            const msg = (e && e.message) || "未知错误";
            try {
                await ui.alert(e && e.code === LOGIN_EXPIRED ? "登录已失效" : "导入失败", msg, "确定");
            } catch (ignored) { }
        }
    }

    runImportFlow();
})();