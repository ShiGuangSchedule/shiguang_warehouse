// 西安建筑科技大学（XAUAT）拾光课程表适配脚本 · 树维教务平台 · 本科
// 周次、开学日、周起始日和作息全部取自教务接口，不由上课日期反推。
"use strict";
(function () {
  const BIZ_TYPE_ID = 2; // 本科课表（接口约定，勿改）
  const DATUM_STUDENT_ID = "null"; // datum 接口要求字符串 "null"（接口约定，勿改）
  const LIMITS = { timeout: 15000, minWeeks: 16, maxWeeks: 60 };
  const MS_PER_DAY = 86400000;
  const LOGIN_EXPIRED = "LOGIN_EXPIRED";

  const API = {
    courseTablePage: "/student/for-std/course-table",
    lessonIds: (s) => "/student/for-std/course-table/get-data?bizTypeId=" + BIZ_TYPE_ID + "&semesterId=" + encodeURIComponent(s) + "&dataId=",
    datum: "/student/ws/schedule-table/datum",
    semester: (s) => "/student/ws/semester/get/" + encodeURIComponent(s),
    layout: "/student/ws/schedule-table/timetable-layout",
  };

  const logError = (m) => console.error("[XAUAT] " + m);

  // 桥接调用统一封装，其余代码不直接访问 window.shiguangBridge
  const ui = {
    toast: (m) => window.shiguangBridge.showToast(m),
    alert: (t, m, b) => window.shiguangBridgePromise.showAlert(t, m, b),
    select: (t, items, d) => window.shiguangBridgePromise.showSingleSelection(t, JSON.stringify(items), d),
    saveConfig: (j) => window.shiguangBridgePromise.saveCourseConfig(j),
    saveTimeSlots: (j) => window.shiguangBridgePromise.savePresetTimeSlots(j),
    saveCourses: (j) => window.shiguangBridgePromise.saveImportedCourses(j),
    done: () => window.shiguangBridge.notifyTaskCompletion(),
  };

  async function save(fn, data, msg) {
    try { await fn(JSON.stringify(data)); }
    catch (e) { throw new Error(msg); }
  }

  // fetch 跟随重定向后的最终 URL 落在登录页，说明 swjw 会话已失效
  function isLoginResponse(res) {
    try {
      const path = new URL(res.url, location.href).pathname;
      return path.startsWith("/student/login") || path.startsWith("/student/sso/login");
    } catch (e) { return false; }
  }

  function loginExpiredError() {
    const err = new Error("登录状态已失效，请重新登录教务系统后重试");
    err.code = LOGIN_EXPIRED;
    return err;
  }

  async function requestText(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.timeout);
    try {
      const res = await fetch(url, Object.assign({ credentials: "include" }, options, { signal: controller.signal }));
      if (isLoginResponse(res)) throw loginExpiredError(); // 登录壳是 200 HTML，不能交给 JSON.parse
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw loginExpiredError();
        throw new Error("网络请求失败，请稍后重试");
      }
      return await res.text();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("请求超时，请检查网络后重试");
      if (e instanceof TypeError) throw new Error("网络连接失败或登录状态异常，请检查网络并重新登录后重试");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestJson(url, options) {
    const text = await requestText(url, options);
    try { return JSON.parse(text); }
    catch (e) {
      logError("接口返回非 JSON，可能登录已失效: " + text.slice(0, 200));
      throw new Error("接口返回异常（可能登录已失效），请重新登录后重试");
    }
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (hhmm) => pad2(Math.floor(hhmm / 100)) + ":" + pad2(hhmm % 100);
  const isHhmm = (v) => Number.isInteger(v) && v >= 0 && v <= 2359 && v % 100 < 60;

  // 日期一律按 UTC 当天 0 点计算，避免本地时区与夏令时影响星期和天数差
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === "string" ? s : "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const isoWeekdayOf = (ms) => new Date(ms).getUTCDay() || 7; // 1=周一…7=周日
  const offsetInWeek = (weekday, sundayFirst) => (sundayFirst ? weekday % 7 : weekday - 1);
  const weekStartOf = (ms, sundayFirst) => ms - offsetInWeek(isoWeekdayOf(ms), sundayFirst) * MS_PER_DAY;
  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // 不用 localeCompare，避免各 WebView 排序不一致
  const uniqueSorted = (arr) => Array.from(new Set(arr)).sort(byText);

  const readPosition = (it) => {
    const room = it.room;
    return String((room && typeof room === "object" ? room.nameZh : room) || it.customPlace || "").trim();
  };

  async function getSemesters() {
    const html = await requestText(API.courseTablePage);
    const select = new DOMParser().parseFromString(html, "text/html").querySelector("#allSemesters, #semesters");
    if (!select) throw new Error("未找到学期选择框，请确认已登录教务系统");
    const semesters = [];
    let current = -1;
    for (const opt of select.querySelectorAll("option")) {
      const id = opt.getAttribute("value");
      const name = opt.textContent.trim();
      if (id && id !== "all" && name) {
        if (opt.hasAttribute("selected") && current < 0) current = semesters.length;
        semesters.push({ id, name });
      }
    }
    if (!semesters.length) throw new Error("学期列表为空");
    return { semesters, current: Math.max(current, 0) };
  }

  async function fetchCourseTable(semesterId) {
    const json = await requestJson(API.lessonIds(semesterId));
    if (!json || !Array.isArray(json.lessonIds)) throw new Error("课程数据异常，请稍后重试");
    return { lessonIds: json.lessonIds, layoutId: json.timeTableLayoutId };
  }

  async function fetchScheduleDatum(lessonIds) {
    if (!lessonIds.length) throw new Error("课程列表为空");
    const json = await requestJson(API.datum, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: DATUM_STUDENT_ID, lessonIds }),
    });
    if (!json || !json.result) throw new Error("课程详情数据异常，请稍后重试");
    return { lessonList: json.result.lessonList || [], scheduleList: json.result.scheduleList || [] };
  }

  // 学期开始日与周起始日是周次换算的依据，取不到就中止，不用猜测值导入错误数据
  async function fetchSemester(semesterId) {
    const json = await requestJson(API.semester(semesterId));
    if (!json || parseDate(json.startDate) === null) throw new Error("无法获取学期开始日期，请稍后重试");
    return { startDate: json.startDate.slice(0, 10), sundayFirst: json.weekStartOnSunday === true };
  }

  // 教务作息 -> 拾光节次。节次必须从 1 连续编号且互不重叠，否则拒绝
  function buildTimeSlots(units) {
    const slots = [];
    for (const u of units) {
      if (!Number.isInteger(u.indexNo) || u.indexNo <= 0 || !isHhmm(u.startTime) || !isHhmm(u.endTime) || u.startTime >= u.endTime) continue;
      slots.push({ number: u.indexNo, startTime: formatTime(u.startTime), endTime: formatTime(u.endTime) });
    }
    slots.sort((a, b) => a.number - b.number);
    if (!slots.length) throw new Error("作息数据异常：没有有效节次");
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].number !== i + 1) throw new Error("作息数据异常：节次编号必须从 1 开始连续排列");
      if (i > 0 && slots[i].startTime < slots[i - 1].endTime) throw new Error("作息数据异常：节次时间重叠");
    }
    return slots;
  }

  // 作息是非关键数据：取不到/格式异常时回退课程自带时间；登录失效仍然抛出
  async function fetchTimeSlots(layoutId) {
    const id = Number(layoutId);
    if (!Number.isInteger(id) || id <= 0) return [];
    try {
      const json = await requestJson(API.layout, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeTableLayoutId: id }),
      });
      const units = json && json.result && json.result.courseUnitList;
      if (!Array.isArray(units) || !units.length) throw new Error("无法获取作息时间");
      return buildTimeSlots(units);
    } catch (e) {
      if (e.code === LOGIN_EXPIRED) throw e;
      return [];
    }
  }

  /**
   * 周次直接采用记录自带的 weekIndex，并与开学日换算结果交叉校验，不吻合宁可中止。
   * 同一课程、星期、时间的记录先按周合并（同周多个教室/老师），再把教室与老师完全相同的周归为一门课。
   */
  function convertCourses(lessonList, scheduleList, semester, slots) {
    const startWeek = weekStartOf(parseDate(semester.startDate), semester.sundayFirst);
    const lessons = new Map(lessonList.map((l) => [l.id, l]));
    const unitByStart = new Map(slots.map((s) => [s.startTime, s.number]));
    const unitByEnd = new Map(slots.map((s) => [s.endTime, s.number]));

    const cells = new Map();
    for (const it of scheduleList) {
      const dateMs = parseDate(it.date);
      if (dateMs === null || !isHhmm(it.startTime) || !isHhmm(it.endTime) || it.startTime >= it.endTime) continue;
      const day = isoWeekdayOf(dateMs);
      if (it.weekday != null && it.weekday !== day) {
        throw new Error("教务数据的星期与日期不一致（" + it.date + "），已中止导入");
      }
      const calculated = Math.floor((dateMs - startWeek) / MS_PER_DAY / 7) + 1;
      const week = Number.isInteger(it.weekIndex) && it.weekIndex > 0 ? it.weekIndex : calculated;
      if (week < 1) continue;
      if (week !== calculated) {
        throw new Error("教务周次与学期开始日不一致（" + it.date + " 为第 " + week + " 周，按开学日算为第 " + calculated + " 周），已中止导入");
      }
      const key = [it.lessonId, day, it.startTime, it.endTime, week].join("|");
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = { it, day, week, rooms: [], teachers: [] }));
      const room = readPosition(it);
      if (room) cell.rooms.push(room);
      if (it.personName) cell.teachers.push(String(it.personName));
    }

    const groups = new Map();
    const parallel = new Set(); // 同一周同一时间有多个教室的课程名
    for (const cell of cells.values()) {
      const it = cell.it;
      const lesson = lessons.get(it.lessonId) || {};
      const name = lesson.courseName || lesson.name || "未知课程";
      const rooms = uniqueSorted(cell.rooms);
      if (rooms.length > 1) parallel.add(name);
      let teachers = uniqueSorted(cell.teachers);
      if (!teachers.length && Array.isArray(lesson.teacherAssignmentList)) {
        teachers = uniqueSorted(lesson.teacherAssignmentList.map((t) => t && t.name).filter(Boolean));
      }
      const position = rooms.join("/");
      const teacher = teachers.join(",");
      const key = [it.lessonId, cell.day, it.startTime, it.endTime, position, teacher].join("|");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name, teacher, position, day: cell.day, startTime: it.startTime, endTime: it.endTime, weeks: [] }));
      g.weeks.push(cell.week);
    }

    const courses = Array.from(groups.values())
      .sort((a, b) => a.day - b.day || a.startTime - b.startTime || byText(a.name, b.name))
      .map((g) => {
        const course = {
          name: g.name, teacher: g.teacher, position: g.position, day: g.day,
          weeks: Array.from(new Set(g.weeks)).sort((a, b) => a - b),
        };
        const startSection = unitByStart.get(formatTime(g.startTime));
        const endSection = unitByEnd.get(formatTime(g.endTime));
        if (startSection && endSection && startSection <= endSection) {
          Object.assign(course, { isCustomTime: false, startSection, endSection });
        } else { // 不在教务节次网格内（如补课、考试周），保留真实起止时间
          Object.assign(course, { isCustomTime: true, customStartTime: formatTime(g.startTime), customEndTime: formatTime(g.endTime) });
        }
        return course;
      });
    return { courses, parallel: Array.from(parallel).sort(byText) };
  }

  async function chooseSemester(semesters, defaultIndex) {
    const names = semesters.map((s) => s.name);
    let preset = defaultIndex;
    for (;;) {
      const index = await ui.select("选择学期", names, preset);
      if (!Number.isInteger(index) || index < 0 || index >= semesters.length) return null;
      preset = index;
      const semester = semesters[index];
      let table = null;
      try { table = await fetchCourseTable(semester.id); }
      catch (e) {
        if (e.code === LOGIN_EXPIRED) throw e;
        logError("获取「" + semester.name + "」课程失败: " + e.message);
        throw e;
      }
      if (table && table.lessonIds.length) return { semester, table };
      if (!(await ui.alert("无课程数据", "「" + semester.name + "」没有课程数据，请选择其他学期。", "重新选择"))) return null;
    }
  }

  async function runImportFlow() {
    try {
      if (!(await ui.alert("西安建筑科技大学课表导入", "请确保已登录教务系统（swjw.xauat.edu.cn）。\n本适配将自动获取学期、周次与作息数据。", "开始导入"))) {
        ui.toast("导入已取消"); return;
      }
      ui.toast("正在获取学期列表...");
      const listed = await getSemesters();
      const chosen = await chooseSemester(listed.semesters, listed.current);
      if (!chosen) { ui.toast("导入已取消"); return; }

      ui.toast("正在获取课程数据...");
      const [datum, semester, slots] = await Promise.all([
        fetchScheduleDatum(chosen.table.lessonIds),
        fetchSemester(chosen.semester.id),
        fetchTimeSlots(chosen.table.layoutId),
      ]);
      const { courses, parallel } = convertCourses(datum.lessonList, datum.scheduleList, semester, slots);
      if (!courses.length) {
        await ui.alert("无课程数据", "未能转换出有效课程。", "确定");
        return;
      }
      // weeks 已升序排列，取每门课最后一周的最大值
      const totalWeeks = Math.max(LIMITS.minWeeks, ...courses.map((c) => c.weeks[c.weeks.length - 1]));
      if (totalWeeks > LIMITS.maxWeeks) throw new Error("课程周次超过可导入的 " + LIMITS.maxWeeks + " 周上限，已中止导入");

      await save(ui.saveConfig, {
        semesterStartDate: semester.startDate,
        semesterTotalWeeks: totalWeeks,
        firstDayOfWeek: semester.sundayFirst ? 7 : 1,
      }, "保存配置失败，请重试");
      if (slots.length) await save(ui.saveTimeSlots, slots, "保存作息失败，请重试");
      await save(ui.saveCourses, courses, "保存课程失败，请重试");
      ui.toast("成功导入 " + courses.length + " 条课程");

      if (parallel.length) {
        await ui.alert("部分课程有多个教室",
          "以下课程在同一周的同一时间被安排在多个教室，教务系统未标明你所在的教室，已把教室合并显示，请按实际情况在课程中修改：\n" + parallel.join("、"),
          "知道了");
      }
      ui.toast("课表导入完成！");
      ui.done();
    } catch (e) {
      logError("导入异常: " + (e.stack || e.message));
      if (e.code === LOGIN_EXPIRED) await ui.alert("登录已失效", e.message, "确定");
      else await ui.alert("导入失败", e.message || "未知错误，请重试", "确定");
    }
  }

  runImportFlow();
})();