// 西华师范大学（cwnu.edu.cn）拾光课程表适配脚本
// 适配系统：树维新一代智慧教务系统（jwxt.cwnu.edu.cn/student）
//
// 【重要】本校教务系统不直接使用账号密码登录，采用学校统一身份认证（CAS）：
//   信息门户 authserver.cwnu.edu.cn（账号为学号）→ 门户内点「教务系统」→ 免密进入 jwxt。
//   因此教务系统的 Cookie 只能由门户跳转下发，本脚本不处理账密录入。
//
// 接口链路（与教务课表页实际请求一致，均为同源相对路径）:
//   1. GET  /student/for-std/course-table
//        → 解析学期下拉框 #allSemesters，取学期 id
//   2. GET  /student/for-std/course-table/semester/{id}/print-data?semesterId={id}&hasExperiment=true
//        → studentTableVms[0].activities：courseName / weekday / startUnit / endUnit / weekIndexes / room / teachers
//   3. GET  /student/ws/semester/get/{id}
//        → 学期起止日期，用于推算第 1 周周一与总周数
//   4. POST /student/ws/schedule-table/timetable-layout
//        → courseUnitList：学校实际作息节次（取不到时回退内置作息表）
//
// 不使用 /student/ws/schedule-table/datum：该接口需要 lessonIds 与 stdPersonId，
// 而 print-data 已经给出完整且按周展开的排课，少一次请求、少一处失败点。

"use strict";

(function () {
    // ============================================================
    // 常量
    // ============================================================
    const BIZ_TYPE_ID = 2;            // 本科课表（树维接口约定，勿改）
    const REQUEST_TIMEOUT = 20000;    // 单次请求超时 20s
    const MIN_TOTAL_WEEKS = 16;       // 总周数下限，避免课表过短
    const MAX_TOTAL_WEEKS = 60;       // 总周数上限，超出视为数据异常
    const LOGIN_EXPIRED = "LOGIN_EXPIRED";

    const API = {
        courseTablePage: "/student/for-std/course-table",
        printData: (id) =>
            "/student/for-std/course-table/semester/" + encodeURIComponent(id) +
            "/print-data?semesterId=" + encodeURIComponent(id) + "&hasExperiment=true",
        semester: (id) => "/student/ws/semester/get/" + encodeURIComponent(id),
        layout: "/student/ws/schedule-table/timetable-layout",
    };

    // 西华师范大学作息表（冬季作息，10 月 1 日—次年 4 月 30 日执行）
    // 上午 1-5 节、下午 6-9 节、晚上 10-12 节，每节 40 分钟。
    // 仅在校务接口取不到作息时兜底；正常情况下以学校接口返回的作息为准。
    const FALLBACK_TIME_SLOTS = [
        { number: 1, startTime: "08:00", endTime: "08:40" },
        { number: 2, startTime: "08:50", endTime: "09:30" },
        { number: 3, startTime: "09:45", endTime: "10:25" },
        { number: 4, startTime: "10:35", endTime: "11:15" },
        { number: 5, startTime: "11:25", endTime: "12:05" },
        { number: 6, startTime: "14:30", endTime: "15:10" },
        { number: 7, startTime: "15:20", endTime: "16:00" },
        { number: 8, startTime: "16:10", endTime: "16:50" },
        { number: 9, startTime: "17:00", endTime: "17:40" },
        { number: 10, startTime: "19:00", endTime: "19:40" },
        { number: 11, startTime: "19:50", endTime: "20:30" },
        { number: 12, startTime: "20:40", endTime: "21:20" },
    ];

    // ============================================================
    // 桥接封装：其余代码不直接访问 window.shiguangBridge
    // ============================================================
    const ui = {
        toast: (m) => window.shiguangBridge.showToast(m),
        alert: (t, m, b) => window.shiguangBridgePromise.showAlert(t, m, b),
        select: (t, items, d) =>
            window.shiguangBridgePromise.showSingleSelection(t, JSON.stringify(items), d),
        saveConfig: (j) => window.shiguangBridgePromise.saveCourseConfig(j),
        saveTimeSlots: (j) => window.shiguangBridgePromise.savePresetTimeSlots(j),
        saveCourses: (j) => window.shiguangBridgePromise.saveImportedCourses(j),
        done: () => window.shiguangBridge.notifyTaskCompletion(),
    };

    const logError = (m) => console.error("[CWNU] " + m);

    // ============================================================
    // 通用工具
    // ============================================================
    const pad2 = (n) => String(n).padStart(2, "0");

    // 树维作息时间是 HHmm 整数（如 800 / 1340），转 "08:00" / "13:40"
    function formatHhmm(v) {
        if (v === null || v === undefined) return "";
        if (typeof v === "string" && v.indexOf(":") > 0) {
            const parts = v.split(":");
            return pad2(Number(parts[0])) + ":" + pad2(Number(parts[1]));
        }
        const n = Number(v);
        if (!Number.isFinite(n)) return "";
        return pad2(Math.floor(n / 100)) + ":" + pad2(Math.floor(n % 100));
    }

    const isHhmm = (v) => Number.isInteger(v) && v >= 0 && v <= 2359 && v % 100 < 60;

    function loginExpiredError() {
        const err = new Error("登录状态已失效，请重新登录教务系统后重试");
        err.code = LOGIN_EXPIRED;
        return err;
    }

    // fetch 跟随重定向后最终落在登录页 → 会话已失效
    function isLoginResponse(res) {
        try {
            const path = new URL(res.url, location.href).pathname;
            return path.indexOf("/student/login") === 0 || path.indexOf("/student/sso") === 0;
        } catch (e) {
            return false;
        }
    }

    async function requestText(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            const res = await fetch(url, Object.assign(
                { credentials: "include" },
                options || {},
                { signal: controller.signal }
            ));
            // 登录壳是 200 的 HTML，不能交给 JSON.parse，必须先判断
            if (isLoginResponse(res)) throw loginExpiredError();
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) throw loginExpiredError();
                throw new Error("网络请求失败（HTTP " + res.status + "），请稍后重试");
            }
            return await res.text();
        } catch (e) {
            if (e.name === "AbortError") throw new Error("请求超时，请检查网络后重试");
            if (e instanceof TypeError) {
                throw new Error("网络连接失败或登录状态异常，请检查网络并重新登录后重试");
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    async function requestJson(url, options) {
        const text = await requestText(url, options);
        try {
            return JSON.parse(text);
        } catch (e) {
            logError("接口返回非 JSON，可能登录已失效: " + text.slice(0, 200));
            throw new Error("接口返回异常（可能登录已失效），请重新登录教务系统后重试");
        }
    }

    // 日期统一按 UTC 当天 0 点计算，避免本地时区影响星期与天数差
    function parseDate(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === "string" ? s : "");
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
    }

    // ============================================================
    // 1. 学期列表
    // ============================================================
    async function getSemesters() {
        const html = await requestText(API.courseTablePage);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const select = doc.querySelector("#allSemesters, #semesters");
        if (!select) throw new Error("未找到学期选择框，请确认已登录教务系统并进入课表页面");

        const semesters = [];
        let current = -1;
        const options = select.querySelectorAll("option");
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const id = (opt.getAttribute("value") || "").trim();
            const name = (opt.textContent || "").trim();
            if (!id || id === "all" || !name) continue;
            if (current < 0 && (opt.hasAttribute("selected") || opt.selected)) {
                current = semesters.length;
            }
            semesters.push({ id: id, name: name });
        }
        if (!semesters.length) throw new Error("学期列表为空，请确认教务系统中存在学期数据");
        return { semesters: semesters, current: Math.max(current, 0) };
    }

    // ============================================================
    // 2. 课表原始数据
    // ============================================================
    async function fetchPrintData(semesterId) {
        const json = await requestJson(API.printData(semesterId));
        if (!json) throw new Error("课表数据为空，请稍后重试");

        // 兼容树维各版本的外层结构差异
        let activities = [];
        if (Array.isArray(json.studentTableVms) && json.studentTableVms.length) {
            activities = json.studentTableVms[0].activities || [];
        } else if (json.studentTableVm && Array.isArray(json.studentTableVm.activities)) {
            activities = json.studentTableVm.activities;
        } else if (Array.isArray(json.activities)) {
            activities = json.activities;
        }
        return activities;
    }

    // 教师名可能带工号括号，如「张三(12345)」，去掉括号部分
    function cleanTeachers(raw) {
        if (Array.isArray(raw)) {
            const names = raw
                .map((t) => String(t == null ? "" : t).replace(/[（(]\d+[)）]/g, "").trim())
                .filter(Boolean);
            return Array.from(new Set(names)).join(",");
        }
        if (typeof raw === "string") {
            return raw.replace(/[（(]\d+[)）]/g, "").trim();
        }
        return "";
    }

    // 把 activities 转成拾光课程格式
    function convertCourses(activities) {
        const groups = new Map();
        let skipped = 0;

        for (let i = 0; i < activities.length; i++) {
            const act = activities[i] || {};
            const name = String(act.courseName == null ? "" : act.courseName).trim();
            const day = Number(act.weekday);
            const startSection = Number(act.startUnit);
            const endSection = Number(act.endUnit);

            // 缺关键字段或节次非法的记录直接跳过（如无排课时间的课程）
            if (!name || !Number.isInteger(day) || day < 1 || day > 7) { skipped++; continue; }
            if (!Number.isInteger(startSection) || !Number.isInteger(endSection)) { skipped++; continue; }
            if (startSection < 1 || endSection < startSection) { skipped++; continue; }

            const rawWeeks = Array.isArray(act.weekIndexes)
                ? act.weekIndexes
                : (Array.isArray(act.weekIndex) ? act.weekIndex : []);
            const weeks = Array.from(new Set(
                rawWeeks
                    .map((w) => Number(w))
                    .filter((w) => Number.isInteger(w) && w > 0)
            )).sort((a, b) => a - b);
            if (!weeks.length) { skipped++; continue; }

            let position = act.room;
            if (position && typeof position === "object") position = position.nameZh || position.name || "";
            position = String(position == null ? "" : position).trim();
            if (!position) position = String(act.customPlace == null ? "" : act.customPlace).trim();

            const teacher = cleanTeachers(act.teachers != null ? act.teachers : act.teacher);

            // 同一课程/星期/节次/教室/教师，不同周次合并为一条
            const key = [name, day, startSection, endSection, position, teacher].join("|");
            const existing = groups.get(key);
            if (existing) {
                for (let k = 0; k < weeks.length; k++) existing.weekSet.add(weeks[k]);
            } else {
                groups.set(key, {
                    name: name,
                    teacher: teacher,
                    position: position,
                    day: day,
                    startSection: startSection,
                    endSection: endSection,
                    weekSet: new Set(weeks),
                });
            }
        }

        if (skipped) logError("已跳过 " + skipped + " 条无有效节次/周次的排课记录");

        const courses = [];
        groups.forEach((g) => {
            courses.push({
                name: g.name,
                teacher: g.teacher,
                position: g.position,
                day: g.day,
                startSection: g.startSection,
                endSection: g.endSection,
                weeks: Array.from(g.weekSet).sort((a, b) => a - b),
            });
        });

        courses.sort((a, b) =>
            a.day - b.day ||
            a.startSection - b.startSection ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        );
        return courses;
    }

    // ============================================================
    // 3. 学期日期
    // ============================================================
    async function fetchSemesterInfo(semesterId) {
        const json = await requestJson(API.semester(semesterId));
        if (!json) return null;
        return {
            startDate: parseDate(json.startDate) === null ? null : String(json.startDate).slice(0, 10),
            endDate: parseDate(json.endDate) === null ? null : String(json.endDate).slice(0, 10),
        };
    }

    // ============================================================
    // 4. 作息节次
    // ============================================================
    function normalizeSlots(units) {
        const slots = [];
        for (let i = 0; i < units.length; i++) {
            const u = units[i] || {};
            const no = Number(u.indexNo);
            const start = formatHhmm(u.startTime);
            const end = formatHhmm(u.endTime);
            if (!Number.isInteger(no) || no <= 0) continue;
            if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
            if (start >= end) continue;
            slots.push({ number: no, startTime: start, endTime: end });
        }
        slots.sort((a, b) => a.number - b.number);

        // 节次必须从 1 连续编号，否则拾光侧无法正确排布
        for (let i = 0; i < slots.length; i++) {
            if (slots[i].number !== i + 1) return null;
        }
        return slots.length ? slots : null;
    }

    // 作息是非关键数据：取不到就回退内置作息；但登录失效仍然要抛出
    async function fetchTimeSlots(layoutId) {
        const id = Number(layoutId);
        if (!Number.isInteger(id) || id <= 0) return FALLBACK_TIME_SLOTS;
        try {
            const json = await requestJson(API.layout, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ timeTableLayoutId: id }),
            });
            const units = json && json.result && json.result.courseUnitList;
            if (!Array.isArray(units) || !units.length) return FALLBACK_TIME_SLOTS;
            const slots = normalizeSlots(units);
            if (!slots) {
                logError("教务作息节次编号不连续，改用内置作息表");
                return FALLBACK_TIME_SLOTS;
            }
            return slots;
        } catch (e) {
            if (e.code === LOGIN_EXPIRED) throw e;
            logError("获取教务作息失败，改用内置作息表: " + e.message);
            return FALLBACK_TIME_SLOTS;
        }
    }

    // 课表页 HTML 里带有 timeTableLayoutId，用于取作息
    async function fetchLayoutId() {
        try {
            const html = await requestText(API.courseTablePage);
            const patterns = [
                /timeTableLayoutId\s*[:=]\s*["']?(\d+)["']?/,
                /"timeTableLayoutId"\s*:\s*"?(\d+)"?/,
            ];
            for (let i = 0; i < patterns.length; i++) {
                const m = patterns[i].exec(html);
                if (m) return Number(m[1]);
            }
            return null;
        } catch (e) {
            if (e.code === LOGIN_EXPIRED) throw e;
            return null;
        }
    }

    // ============================================================
    // 5. 保存
    // ============================================================
    async function save(fn, data, msg) {
        try {
            await fn(JSON.stringify(data));
        } catch (e) {
            throw new Error(msg);
        }
    }

    function calcTotalWeeks(semester, courses) {
        let fromDates = 0;
        let fromCourses = 0;

        // 优先用学期起止日期推算
        if (semester && semester.startDate && semester.endDate) {
            const start = parseDate(semester.startDate);
            const end = parseDate(semester.endDate);
            if (start !== null && end !== null && end > start) {
                const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
                const w = Math.ceil(days / 7);
                if (w > 0) fromDates = w;
            }
        }

        // 课程实际最大周次
        for (let i = 0; i < courses.length; i++) {
            const ws = courses[i].weeks;
            const last = ws[ws.length - 1];
            if (last > fromCourses) fromCourses = last;
        }

        // 学期日期可能未覆盖到实际排课（如含考试周），两者取大更稳妥
        let weeks = Math.max(fromDates, fromCourses);
        if (!weeks) weeks = 20;

        if (weeks < MIN_TOTAL_WEEKS) weeks = MIN_TOTAL_WEEKS;
        if (weeks > MAX_TOTAL_WEEKS) {
            throw new Error("推算出的总周数（" + weeks + "）超过上限 " + MAX_TOTAL_WEEKS + "，已中止导入");
        }
        return weeks;
    }

    // ============================================================
    // 6. 主流程
    // ============================================================
    async function runImportFlow() {
        try {
            const ok = await ui.alert(
                "西华师范大学课表导入",
                "本校教务系统需通过「信息门户」进入，教务系统与门户密码不同。\n\n" +
                "导入前请确认：\n" +
                "1. 已在浏览器中登录信息门户，并从门户进入教务系统；\n" +
                "2. 当前已打开教务系统课表页面，能看到自己的课表；\n" +
                "3. 如需导入其他学期，可稍后在列表中选择。\n\n" +
                "本脚本会自动读取学期、周次与学校作息。",
                "开始导入"
            );
            if (!ok) {
                ui.toast("导入已取消");
                return;
            }

            ui.toast("正在获取学期列表...");
            const listed = await getSemesters();
            const names = listed.semesters.map((s) => s.name);

            const index = await ui.select("选择学期", names, listed.current);
            if (!Number.isInteger(index) || index < 0 || index >= listed.semesters.length) {
                ui.toast("导入已取消");
                return;
            }
            const semester = listed.semesters[index];
            ui.toast("已选择：" + semester.name);

            ui.toast("正在获取课表数据...");
            const activities = await fetchPrintData(semester.id);
            if (!activities.length) {
                await ui.alert("没有课程", "「" + semester.name + "」未查询到课程排课数据。", "确定");
                return;
            }

            const courses = convertCourses(activities);
            if (!courses.length) {
                await ui.alert("解析失败", "课表数据中未能解析出有效课程，请确认该学期是否有排课。", "确定");
                return;
            }

            ui.toast("正在获取学期与作息信息...");
            const semesterInfo = await fetchSemesterInfo(semester.id);
            const layoutId = await fetchLayoutId();
            const timeSlots = await fetchTimeSlots(layoutId);

            const totalWeeks = calcTotalWeeks(semesterInfo, courses);
            const config = {
                semesterStartDate: semesterInfo && semesterInfo.startDate
                    ? semesterInfo.startDate
                    : null,
                semesterTotalWeeks: totalWeeks,
                defaultClassDuration: 40,   // 西华师大每节课 40 分钟
                defaultBreakDuration: 10,
                firstDayOfWeek: 1,
            };

            await save(ui.saveConfig, config, "保存课表配置失败，请重试");
            await save(ui.saveTimeSlots, timeSlots, "保存作息时间失败，请重试");
            await save(ui.saveCourses, courses, "保存课程数据失败，请重试");

            ui.toast("成功导入 " + courses.length + " 条课程！");
            ui.done();
        } catch (e) {
            logError("导入异常: " + (e && (e.stack || e.message)));
            const msg = (e && e.message) || "未知错误，请重试";
            try {
                if (e && e.code === LOGIN_EXPIRED) {
                    await ui.alert("登录已失效", msg, "确定");
                } else {
                    await ui.alert("导入失败", msg, "确定");
                }
            } catch (ignored) {
                // 弹窗本身失败时不再抛出，避免掩盖原始错误
            }
        }
    }

    runImportFlow();
})();
