// 西华师范大学（cwnu.edu.cn）拾光课程表适配脚本
// 适配系统：树维新一代智慧教务系统（jwxt.cwnu.edu.cn/student）
//
// 【为什么不需要账号密码】
//   本校教务系统不直接登录，走学校统一身份认证（Apereo CAS）：
//   信息门户 authserver.cwnu.edu.cn（账号=学号）→ 门户内点「教务系统」→ 免密进入 jwxt。
//   教务系统 Cookie 只能由门户跳转下发，本脚本不处理账密。
//   adapters.yaml 的 import_url 已内置 SSO 深链，登录后会直接落到课表页。
//
// 【接口链路：与课表页 course-table 的真实 JS 完全一致】
//   1. GET  /student/for-std/course-table
//        a) 解析 #allSemesters 学期下拉框（value=学期 id）
//        b) 解析页面内嵌 var semesters = JSON.parse('...') 取 startDate / endDate
//        c) 解析 data['stdPersonId'] = 148740 取学生 id（服务端按登录用户渲染）
//   2. GET  /student/for-std/course-table/get-data?bizTypeId=2&semesterId={id}
//        → timeTableLayoutId / lessonIds / weeks / lessonId2Flag
//        （timeTableLayoutId 只在这里出现，页面里是 var timeTableLayoutId = null）
//   3. POST /student/ws/schedule-table/datum
//        body: {lessonIds, studentId:null, stdPersonId, weekIndex:null}
//        → result.lessonList（课程）/ result.scheduleList（逐周排课）
//   4. POST /student/ws/schedule-table/timetable-layout
//        body: {timeTableLayoutId}
//        → result.courseUnitList（学校实际作息节次）
//
// 【刻意不使用 print-data】
//   该接口是其他树维学校的路径，西华师大课表页代码里并不存在，调用会 404。
//   本脚本严格按本校页面实际请求走 get-data + datum。

"use strict";

(function () {
    // ============================================================
    // 常量
    // ============================================================
    const BIZ_TYPE_ID = 2;            // 本科课表（页面中 bizTypeId = 2，勿改）
    const REQUEST_TIMEOUT = 20000;    // 单次请求超时 20s
    const MIN_TOTAL_WEEKS = 16;       // 总周数下限，避免课表过短
    const MAX_TOTAL_WEEKS = 60;       // 总周数上限，超出视为数据异常
    const LOGIN_EXPIRED = "LOGIN_EXPIRED";

    const API = {
        courseTablePage: "/student/for-std/course-table",
        getData: (semesterId) =>
            "/student/for-std/course-table/get-data?bizTypeId=" + BIZ_TYPE_ID +
            "&semesterId=" + encodeURIComponent(semesterId),
        datum: "/student/ws/schedule-table/datum",
        layout: "/student/ws/schedule-table/timetable-layout",
    };

    // 西华师范大学作息表（冬季作息，10 月 1 日—次年 4 月 30 日执行）
    // 上午 1-5 节、下午 6-9 节、晚上 10-12 节，每节 40 分钟。
    // 仅在教务作息接口取不到时兜底；正常以接口返回的 courseUnitList 为准。
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

    // 教务时间有两种形态：字符串 "08:00"，或整数 800 / 1340
    function formatHhmm(v) {
        if (v === null || v === undefined) return "";
        if (typeof v === "string" && v.indexOf(":") > 0) {
            const parts = v.split(":");
            return pad2(Number(parts[0])) + ":" + pad2(Number(parts[1]));
        }
        const n = Number(v);
        if (!Number.isFinite(n)) return "";
        if (n < 0 || n > 2359 || n % 100 > 59) return "";
        return pad2(Math.floor(n / 100)) + ":" + pad2(Math.floor(n % 100));
    }

    const HHMM_RE = /^\d{2}:\d{2}$/;

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
    // 1. 课表页：学期列表 / 学期日期 / stdPersonId
    // ============================================================
    async function fetchCourseTablePage() {
        return await requestText(API.courseTablePage);
    }

    // 解析 #allSemesters 下拉框
    function parseSemesters(html) {
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

    // 从页面内嵌的 var semesters = JSON.parse('...') 里取各学期起止日期。
    // 这段 JSON 在页面中每个学期对象都是扁平的，含 id / startDate / endDate。
    function parseSemesterDateMap(html) {
        const map = {};
        const start = html.indexOf("var semesters");
        if (start < 0) return map;
        const seg = html.slice(start, start + 200000);

        // 逐个学期对象取 id / startDate / endDate（对象内无嵌套花括号）
        const objRe = /\{[^{}]*\}/g;
        let m;
        while ((m = objRe.exec(seg))) {
            const body = m[0];
            const idM = /"id"\s*:\s*(\d+)/.exec(body);
            if (!idM) continue;
            const sd = /"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(body);
            const ed = /"endDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(body);
            const sunday = /"weekStartOnSunday"\s*:\s*(true|false)/.exec(body);
            if (!sd) continue;
            map[idM[1]] = {
                startDate: sd[1],
                endDate: ed ? ed[1] : null,
                sundayFirst: sunday ? sunday[1] === "true" : false,
            };
        }
        return map;
    }

    // 页面里每个登录用户都会渲染 data['stdPersonId'] = 148740;
    function parseStdPersonId(html) {
        const patterns = [
            /stdPersonId'\]\s*=\s*(\d+)/,
            /stdPersonId"\]\s*=\s*(\d+)/,
            /stdPersonId\s*[:=]\s*(\d+)/,
        ];
        for (let i = 0; i < patterns.length; i++) {
            const m = patterns[i].exec(html);
            if (m) return Number(m[1]);
        }
        return null;
    }

    // ============================================================
    // 2. get-data：lessonIds / timeTableLayoutId / weeks
    // ============================================================
    async function fetchGetData(semesterId) {
        const json = await requestJson(API.getData(semesterId));
        if (!json) throw new Error("课表数据为空，请稍后重试");
        return {
            lessonIds: Array.isArray(json.lessonIds) ? json.lessonIds : [],
            timeTableLayoutId: json.timeTableLayoutId,
            weekIndices: Array.isArray(json.weekIndices) ? json.weekIndices : [],
            lessonId2Flag: json.lessonId2Flag || null,
        };
    }

    // ============================================================
    // 3. datum：逐周排课明细
    // ============================================================
    async function fetchDatum(lessonIds, stdPersonId) {
        if (!lessonIds.length) return { lessonList: [], scheduleList: [] };
        const body = {
            lessonIds: lessonIds,
            studentId: null,
            stdPersonId: stdPersonId,
            weekIndex: null,   // null = 全部周次（与页面「全部周次」一致）
        };
        const json = await requestJson(API.datum, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const result = json && json.result;
        if (!result) throw new Error("排课数据异常（可能登录已失效），请重新登录后重试");
        return {
            lessonList: Array.isArray(result.lessonList) ? result.lessonList : [],
            scheduleList: Array.isArray(result.scheduleList) ? result.scheduleList : [],
        };
    }

    // ============================================================
    // 4. timetable-layout：学校实际作息
    // ============================================================
    function normalizeSlots(units) {
        const slots = [];
        for (let i = 0; i < units.length; i++) {
            const u = units[i] || {};
            const no = Number(u.indexNo);
            const start = formatHhmm(u.startTime);
            const end = formatHhmm(u.endTime);
            if (!Number.isInteger(no) || no <= 0) continue;
            if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) continue;
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

    // ============================================================
    // 5. 解析课程
    // ============================================================
    // 教室：页面弹窗里显示为「校区 教室名」，这里保持一致
    function readPosition(schedule) {
        const room = schedule.room;
        if (room && typeof room === "object") {
            const parts = [];
            const campus = room.building && room.building.campus && room.building.campus.nameZh;
            if (campus) parts.push(String(campus).trim());
            const name = room.nameZh || room.name;
            if (name) parts.push(String(name).trim());
            const text = parts.filter(Boolean).join(" ");
            if (text) return text;
        } else if (typeof room === "string" && room.trim()) {
            return room.trim();
        }
        const custom = schedule.customPlace;
        return custom == null ? "" : String(custom).trim();
    }

    // 教师：优先用排课记录里的 personName，其次课程上的教师任务列表
    function readTeacher(schedule, lesson) {
        if (schedule.personName && String(schedule.personName).trim()) {
            return String(schedule.personName).trim();
        }
        const list = lesson && lesson.teacherAssignmentList;
        if (Array.isArray(list)) {
            const names = list
                .map((t) => t && t.person && t.person.nameZh)
                .map((n) => (n == null ? "" : String(n).trim()))
                .filter(Boolean);
            return Array.from(new Set(names)).join(",");
        }
        return "";
    }

    // 课程名：页面显示 lesson.course.nameZh；兼容其他树维版本字段
    function readCourseName(lesson) {
        if (!lesson) return "";
        if (lesson.course && lesson.course.nameZh) return String(lesson.course.nameZh).trim();
        if (lesson.courseName) return String(lesson.courseName).trim();
        if (lesson.nameZh) return String(lesson.nameZh).trim();
        return "";
    }

    function convertCourses(lessonList, scheduleList, lessonId2Flag, slots) {
        const lessonsById = {};
        for (let i = 0; i < lessonList.length; i++) {
            const l = lessonList[i];
            if (l && l.id != null) lessonsById[String(l.id)] = l;
        }

        // 页面只渲染「已发布」的排课；未发布的不应导入
        const hasFlag = lessonId2Flag && typeof lessonId2Flag === "object";
        const isPublished = (lessonId) => {
            if (!hasFlag) return true;
            const flag = lessonId2Flag[String(lessonId)];
            if (flag == null) return true;      // 无标记时放行
            return flag === "publish";
        };

        // 节次精确匹配表
        const byStart = {}, byEnd = {};
        for (let i = 0; i < slots.length; i++) {
            byStart[slots[i].startTime] = slots[i].number;
            byEnd[slots[i].endTime] = slots[i].number;
        }

        const groups = new Map();
        let skipped = 0;

        for (let i = 0; i < scheduleList.length; i++) {
            const s = scheduleList[i] || {};
            const lesson = lessonsById[String(s.lessonId)];
            if (!lesson) { skipped++; continue; }
            if (!isPublished(s.lessonId)) { skipped++; continue; }

            const name = readCourseName(lesson);
            const day = Number(s.weekday);
            const week = Number(s.weekIndex);
            const startTime = formatHhmm(s.startTime);
            const endTime = formatHhmm(s.endTime);

            if (!name || !Number.isInteger(day) || day < 1 || day > 7) { skipped++; continue; }
            if (!Number.isInteger(week) || week < 1) { skipped++; continue; }
            if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime) || startTime >= endTime) {
                skipped++;
                continue;
            }

            const position = readPosition(s);
            const teacher = readTeacher(s, lesson);
            const key = [s.lessonId, day, startTime, endTime, position, teacher].join("|");

            let g = groups.get(key);
            if (!g) {
                g = {
                    name: name, teacher: teacher, position: position, day: day,
                    startTime: startTime, endTime: endTime, weeks: new Set(),
                };
                groups.set(key, g);
            }
            g.weeks.add(week);
        }

        if (skipped) logError("已跳过 " + skipped + " 条无效/未发布的排课记录");

        const courses = [];
        groups.forEach((g) => {
            const course = {
                name: g.name,
                teacher: g.teacher,
                position: g.position,
                day: g.day,
                weeks: Array.from(g.weeks).sort((a, b) => a - b),
            };

            const startSection = byStart[g.startTime];
            const endSection = byEnd[g.endTime];
            if (startSection && endSection && startSection <= endSection) {
                course.startSection = startSection;
                course.endSection = endSection;
                course.isCustomTime = false;
            } else {
                // 不在教务节次网格内（补课、临时调整等），保留真实起止时间
                course.isCustomTime = true;
                course.customStartTime = g.startTime;
                course.customEndTime = g.endTime;
            }
            courses.push(course);
        });

        courses.sort((a, b) =>
            a.day - b.day ||
            (a.isCustomTime ? a.customStartTime : a.startSection) - (b.isCustomTime ? b.customStartTime : b.startSection) ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        );
        return courses;
    }

    // ============================================================
    // 6. 保存
    // ============================================================
    async function save(fn, data, msg) {
        try {
            await fn(JSON.stringify(data));
        } catch (e) {
            throw new Error(msg);
        }
    }

    function calcTotalWeeks(semesterDates, weekIndices, courses) {
        let fromDates = 0;
        if (semesterDates && semesterDates.startDate && semesterDates.endDate) {
            const start = parseDate(semesterDates.startDate);
            const end = parseDate(semesterDates.endDate);
            if (start !== null && end !== null && end > start) {
                const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
                const w = Math.ceil(days / 7);
                if (w > 0) fromDates = w;
            }
        }

        let fromIndices = 0;
        for (let i = 0; i < weekIndices.length; i++) {
            const w = Number(weekIndices[i]);
            if (Number.isInteger(w) && w > fromIndices) fromIndices = w;
        }

        let fromCourses = 0;
        for (let i = 0; i < courses.length; i++) {
            const ws = courses[i].weeks;
            const last = ws[ws.length - 1];
            if (last > fromCourses) fromCourses = last;
        }

        // 学期日期可能含考试周，课程周次可能少于教学周，取较大值更稳妥
        let weeks = Math.max(fromDates, fromIndices, fromCourses);
        if (!weeks) weeks = 20;

        if (weeks < MIN_TOTAL_WEEKS) weeks = MIN_TOTAL_WEEKS;
        if (weeks > MAX_TOTAL_WEEKS) {
            throw new Error("推算出的总周数（" + weeks + "）超过上限 " + MAX_TOTAL_WEEKS + "，已中止导入");
        }
        return weeks;
    }

    // ============================================================
    // 7. 主流程
    // ============================================================
    async function runImportFlow() {
        try {
            const ok = await ui.alert(
                "西华师范大学课表导入",
                "本校教务系统需通过「信息门户」进入，教务系统与门户密码不同。\n\n" +
                "导入前请确认：\n" +
                "1. 已登录信息门户，并从门户进入了教务系统；\n" +
                "2. 当前已在教务系统课表页面，能看到自己的课表。\n\n" +
                "本脚本会自动读取学期、周次与学校作息。",
                "开始导入"
            );
            if (!ok) {
                ui.toast("导入已取消");
                return;
            }

            ui.toast("正在获取学期列表...");
            const html = await fetchCourseTablePage();
            const listed = parseSemesters(html);
            const dateMap = parseSemesterDateMap(html);
            const stdPersonId = parseStdPersonId(html);

            const names = listed.semesters.map((s) => s.name);
            const index = await ui.select("选择学期", names, listed.current);
            if (!Number.isInteger(index) || index < 0 || index >= listed.semesters.length) {
                ui.toast("导入已取消");
                return;
            }
            const semester = listed.semesters[index];
            ui.toast("已选择：" + semester.name);

            ui.toast("正在获取课表数据...");
            const getData = await fetchGetData(semester.id);
            if (!getData.lessonIds.length) {
                await ui.alert("没有课程", "「" + semester.name + "」未查询到课程数据。", "确定");
                return;
            }

            ui.toast("正在获取排课明细...");
            const datum = await fetchDatum(getData.lessonIds, stdPersonId);

            ui.toast("正在获取作息时间...");
            const timeSlots = await fetchTimeSlots(getData.timeTableLayoutId);

            const courses = convertCourses(
                datum.lessonList, datum.scheduleList, getData.lessonId2Flag, timeSlots
            );
            if (!courses.length) {
                await ui.alert("解析失败", "课表数据中未能解析出有效课程，请确认该学期是否有排课。", "确定");
                return;
            }

            const dates = dateMap[semester.id] || null;
            const totalWeeks = calcTotalWeeks(dates, getData.weekIndices, courses);
            const config = {
                semesterStartDate: dates && dates.startDate ? dates.startDate : null,
                semesterTotalWeeks: totalWeeks,
                defaultClassDuration: 40,   // 西华师大每节课 40 分钟
                defaultBreakDuration: 10,
                firstDayOfWeek: dates && dates.sundayFirst ? 7 : 1,
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