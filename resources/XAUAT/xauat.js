// 西安建筑科技大学（XAUAT）拾光课程表适配脚本 · 树维教务平台 · 本科
// 原始适配：Alph4rc（拾光仓库）。周次、校历及作息修订：pu-007（SleepDown-Schedule #109）。
"use strict";
(function () {
  // bizTypeId=2：本科课表（接口约定，勿改）
  const BIZ_TYPE_ID = 2;
  // datum 接口要求 studentId 传字符串 "null"（接口约定，勿改）
  const DATUM_STUDENT_ID = "null";

  // minWeeks 仅作总周数下限；maxWeeks 是拾光配置允许的上限
  const LIMITS = { timeout: 15000, minWeeks: 16, maxWeeks: 60 };
  const MS_PER_DAY = 86400000;
  const ENABLE_LOG = false; // release：关闭普通日志，仅保留 error

  const API = {
    courseTablePage: "/student/for-std/course-table",
    lessonIds: (s) => "/student/for-std/course-table/get-data?bizTypeId=" + BIZ_TYPE_ID + "&semesterId=" + encodeURIComponent(s) + "&dataId=",
    datum: "/student/ws/schedule-table/datum",
    semester: (s) => "/student/ws/semester/get/" + encodeURIComponent(s),
    layout: "/student/ws/schedule-table/timetable-layout",
  };

  const log = {
    info: (m) => ENABLE_LOG && console.log("[XAUAT] " + m),
    warn: (m) => ENABLE_LOG && console.warn("[XAUAT] " + m),
    error: (m) => console.error("[XAUAT] " + m),
  };

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

  async function requestText(url, options) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), LIMITS.timeout) : null;
    try {
      const res = await fetch(url, Object.assign(
        { credentials: "include" },
        options,
        controller ? { signal: controller.signal } : {}
      ));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error("登录状态已失效，请重新登录教务系统后重试");
        throw new Error("网络请求失败，请稍后重试");
      }
      return await res.text();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("请求超时，请检查网络后重试");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const requestJson = async (url, options) => JSON.parse(await requestText(url, options));

  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (hhmm) => pad2(Math.floor(hhmm / 100)) + ":" + pad2(hhmm % 100);
  const isHhmm = (v) => Number.isInteger(v) && v >= 0 && v <= 2359 && v % 100 < 60;

  // 日期一律按 UTC 当天 0 点计算，避免本地时区与夏令时影响星期和天数差
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === "string" ? s : "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const toDateString = (ms) => new Date(ms).toISOString().slice(0, 10);
  const isoWeekdayOf = (ms) => { const d = new Date(ms).getUTCDay(); return d === 0 ? 7 : d; };
  // 星期（1=周一…7=周日）在所属周内是第几天（从 0 开始）；周日起算时周日为 0
  const offsetInWeek = (weekday, sundayFirst) => (sundayFirst ? weekday % 7 : weekday - 1);
  const weekStartOf = (ms, sundayFirst) => ms - offsetInWeek(isoWeekdayOf(ms), sundayFirst) * MS_PER_DAY;

  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // 不用 localeCompare，避免各 WebView 排序不一致
  const uniqueSorted = (arr) => Array.from(new Set(arr)).sort(byText);

  function readPosition(it) {
    const room = it.room;
    const name = room && typeof room === "object" ? room.nameZh : room;
    return String(name || it.customPlace || "").trim();
  }

  async function getSemesters() {
    log.info("获取学期列表...");
    const select = new DOMParser().parseFromString(await requestText(API.courseTablePage), "text/html")
      .querySelector("#allSemesters, #semesters");
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
    if (!lessonIds || !lessonIds.length) throw new Error("课程列表为空");
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

  async function fetchLayout(layoutId) {
    const json = await requestJson(API.layout, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeTableLayoutId: layoutId }),
    });
    const units = json && json.result && json.result.courseUnitList;
    if (!Array.isArray(units) || !units.length) throw new Error("无法获取作息时间，请稍后重试");
    return units;
  }

  // 教务作息 -> 拾光节次。节次必须互不重叠，否则拒绝，由课程自带时间兜底
  function buildTimeSlots(units) {
    const slots = [];
    for (const u of units) {
      if (!Number.isInteger(u.indexNo) || u.indexNo <= 0 || !isHhmm(u.startTime) || !isHhmm(u.endTime) || u.startTime >= u.endTime) continue;
      slots.push({ number: u.indexNo, startTime: formatTime(u.startTime), endTime: formatTime(u.endTime) });
    }
    slots.sort((a, b) => a.number - b.number);
    if (units.length && !slots.length) throw new Error("作息数据异常：没有有效节次");
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].number !== i + 1) throw new Error("作息数据异常：节次编号必须从 1 开始连续排列");
      if (i > 0 && slots[i].startTime < slots[i - 1].endTime) throw new Error("作息数据异常：节次时间重叠");
    }
    return slots;
  }

  /**
   * 把教务排课记录转换为拾光课程。
   * 周次直接采用记录自带的 weekIndex；缺失时才按学期开始日换算。
   * 同一课程、星期、时间的记录先按周合并（同周多个教室/老师），再把教室与老师完全相同的周归为一门课。
   */
  function convertCourses(lessonList, scheduleList, semester, slots) {
    const startWeek = weekStartOf(parseDate(semester.startDate), semester.sundayFirst);
    const lessons = new Map(lessonList.map((l) => [l.id, l]));
    const unitByStart = new Map(slots.map((s) => [s.startTime, s.number]));
    const unitByEnd = new Map(slots.map((s) => [s.endTime, s.number]));
    const cells = new Map();
    let skipped = 0;

    for (const it of scheduleList) {
      const dateMs = parseDate(it.date);
      if (dateMs === null || !isHhmm(it.startTime) || !isHhmm(it.endTime) || it.startTime >= it.endTime) { skipped++; continue; }
      const day = isoWeekdayOf(dateMs);
      if (it.weekday !== undefined && it.weekday !== null && it.weekday !== day) {
        throw new Error("教务数据的星期与日期不一致（" + it.date + "），已中止导入");
      }
      const calculated = Math.floor((dateMs - startWeek) / MS_PER_DAY / 7) + 1;
      let week = calculated;
      if (Number.isInteger(it.weekIndex) && it.weekIndex > 0) {
        week = it.weekIndex;
        // 教务自己的周次必须与学期开始日、周起始日吻合；不吻合说明换算依据有误，宁可中止
        if (week !== calculated) {
          throw new Error("教务周次与学期开始日不一致（" + it.date + " 为第 " + week + " 周，按开学日算为第 " + calculated + " 周），已中止导入");
        }
      } else if (calculated < 1) { skipped++; continue; }

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

    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.day - b.day || a.startTime - b.startTime || byText(a.name, b.name)
    );
    const courses = [];
    for (const g of sortedGroups) {
      const weeks = Array.from(new Set(g.weeks)).sort((a, b) => a - b);
      const startSection = unitByStart.get(formatTime(g.startTime));
      const endSection = unitByEnd.get(formatTime(g.endTime));
      const course = { name: g.name, teacher: g.teacher, position: g.position, day: g.day, weeks };
      if (startSection !== undefined && endSection !== undefined && startSection <= endSection) {
        course.isCustomTime = false;
        course.startSection = startSection;
        course.endSection = endSection;
      } else { // 不在教务节次网格内（如补课、考试周），保留真实起止时间
        course.isCustomTime = true;
        course.customStartTime = formatTime(g.startTime);
        course.customEndTime = formatTime(g.endTime);
      }
      courses.push(course);
    }
    log.info("转换完成，共 " + courses.length + " 条课程，跳过 " + skipped + " 条无效记录");
    return { courses, parallel: Array.from(parallel).sort(byText), skipped };
  }

  function getMaxCourseWeek(courses) {
    let max = 0;
    for (const c of courses) for (const w of c.weeks) if (w > max) max = w;
    return max;
  }

  async function saveConfig(config) {
    try { await ui.saveConfig(JSON.stringify(config)); }
    catch (e) { throw new Error("保存配置失败，请重试"); }
  }

  async function saveTimeSlots(slots) {
    try { await ui.saveTimeSlots(JSON.stringify(slots)); }
    catch (e) { throw new Error("保存作息失败，请重试"); }
  }

  async function saveCourses(courses) {
    try { await ui.saveCourses(JSON.stringify(courses)); }
    catch (e) { throw new Error("保存课程失败，请重试"); }
    ui.toast("成功导入 " + courses.length + " 条课程");
  }

  async function chooseSemester(semesters, defaultIndex) {
    const names = semesters.map((s) => s.name);
    let preset = defaultIndex;
    for (;;) {
      const index = await ui.select("选择学期", names, preset);
      if (index === null || index < 0 || index >= semesters.length) return null;
      preset = index;
      const semester = semesters[index];
      let table = null;
      try { table = await fetchCourseTable(semester.id); }
      catch (e) { log.warn("获取 " + semester.name + " 课程失败: " + e.message); }
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
      const layoutId = chosen.table.layoutId;
      const hasLayout = layoutId !== undefined && layoutId !== null;
      // 三个请求互不依赖，并行获取；作息缺失（学期没有作息配置）时课程退回自带的真实时间
      const [datum, semester, units] = await Promise.all([
        fetchScheduleDatum(chosen.table.lessonIds),
        fetchSemester(chosen.semester.id),
        hasLayout ? fetchLayout(layoutId) : Promise.resolve([]),
      ]);
      const slots = buildTimeSlots(units);

      const converted = convertCourses(datum.lessonList, datum.scheduleList, semester, slots);
      const courses = converted.courses;
      if (!courses.length) {
        await ui.alert("无课程数据", "未能转换出有效课程。", "确定");
        return;
      }

      const totalWeeks = Math.max(getMaxCourseWeek(courses), LIMITS.minWeeks);
      if (totalWeeks > LIMITS.maxWeeks) throw new Error("课程周次超过可导入的 60 周上限，已中止导入");
      await saveConfig({
        semesterStartDate: semester.startDate,
        semesterTotalWeeks: totalWeeks,
        firstDayOfWeek: semester.sundayFirst ? 7 : 1,
      });
      if (slots.length) await saveTimeSlots(slots);
      await saveCourses(courses);

      if (converted.parallel.length) {
        await ui.alert(
          "部分课程有多个教室",
          "以下课程在同一周的同一时间被安排在多个教室，教务系统未标明你所在的教室，已把教室合并显示，请按实际情况在课程中修改：\n" +
            converted.parallel.join("、"),
          "知道了"
        );
      }
      ui.toast("课表导入完成！");
      ui.done();
    } catch (e) {
      log.error("导入异常: " + (e.stack || e.message));
      await ui.alert("导入失败", e.message || "未知错误，请重试", "确定");
    }
  }

  runImportFlow();
})();
