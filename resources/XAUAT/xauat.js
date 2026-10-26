// 西安建筑科技大学（XAUAT）拾光课程表适配脚本 · 树维教务平台 · 本科
"use strict";
(function () {
  // bizTypeId=2：本科课表（接口约定，勿改）
  const BIZ_TYPE_ID = 2;
  // datum 接口要求 studentId 传字符串 "null"（接口约定，勿改）
  const DATUM_STUDENT_ID = "null";

  const LIMITS = { timeout: 15000, minWeeks: 16, maxWeeks: 25, fallbackWeeks: 20 };
  const MS_PER_DAY = 86400000;
  const DAYS_PER_WEEK = 7;
  const ENABLE_LOG = false; // release：关闭普通日志，仅保留 error

  const API = {
    courseTablePage: "/student/for-std/course-table",
    lessonIds: (s) => "/student/for-std/course-table/get-data?bizTypeId=" + BIZ_TYPE_ID + "&semesterId=" + encodeURIComponent(s) + "&dataId=",
    datum: "/student/ws/schedule-table/datum",
    semester: (s) => "/student/ws/semester/get/" + encodeURIComponent(s),
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
      if (timer) clearTimeout(timer);
    }
  }

  const requestJson = async (url, options) => JSON.parse(await requestText(url, options));

  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (hhmm) => pad2(Math.floor(hhmm / 100)) + ":" + pad2(hhmm % 100);
  const toDateString = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  const weekdayOf = (dateStr) => { const d = new Date(dateStr).getDay(); return d === 0 ? 7 : d; };
  const clampWeeks = (w) => Math.min(Math.max(w, LIMITS.minWeeks), LIMITS.maxWeeks);

  // 周次去重升序：值域有界，用桶排序
  function uniqueSortedWeeks(weeks) {
    const seen = new Array(LIMITS.maxWeeks + 1).fill(false);
    for (const w of weeks) if (w >= 1 && w <= LIMITS.maxWeeks) seen[w] = true;
    const out = [];
    for (let w = 1; w <= LIMITS.maxWeeks; w++) if (seen[w]) out.push(w);
    return out;
  }

  function calculateTotalWeeks(start, end) {
    if (!start || !end) return LIMITS.fallbackWeeks;
    return Math.ceil(Math.ceil((new Date(end) - new Date(start)) / MS_PER_DAY) / DAYS_PER_WEEK);
  }

  // 由最早上课日期反推开学日（所在周周一）。局限：假设最早上课日在第一周。
  function deriveSemesterStartDate(scheduleList) {
    let minDate = null;
    for (const it of scheduleList) if (it.date && (minDate === null || it.date < minDate)) minDate = it.date;
    if (!minDate) return null;
    const d = new Date(minDate);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toDateString(d);
  }

  function getMaxCourseWeek(courses) {
    let max = 0;
    for (const c of courses) for (const w of c.weeks || []) if (w > max) max = w;
    return max;
  }

  function readPosition(room) {
    if (!room) return "未知地点";
    return (typeof room === "object" ? room.nameZh : room) || "未知地点";
  }

  function convertCourses(lessonList, scheduleList, semesterStartDate) {
    const names = new Map(lessonList.map((l) => [l.id, l.courseName]));
    const startMs = new Date(semesterStartDate).getTime(); // 预计算，避免循环内重复解析
    const groups = new Map();
    for (const it of scheduleList) {
      if (!it.date || typeof it.startTime !== "number" || typeof it.endTime !== "number") continue;
      const diffDays = Math.floor((new Date(it.date).getTime() - startMs) / MS_PER_DAY);
      if (diffDays < 0) continue;
      const week = Math.floor(diffDays / DAYS_PER_WEEK) + 1;
      const day = weekdayOf(it.date);
      const key = it.lessonId + "|" + day + "|" + it.startTime + "|" + it.endTime;
      if (!groups.has(key)) {
        groups.set(key, {
          name: names.get(it.lessonId) || "未知课程",
          teacher: it.personName || "未知教师",
          position: readPosition(it.room),
          day, startTime: it.startTime, endTime: it.endTime, weeks: [],
        });
      }
      groups.get(key).weeks.push(week);
    }
    const courses = [];
    for (const g of groups.values()) {
      courses.push({
        name: g.name, teacher: g.teacher, position: g.position, day: g.day,
        weeks: uniqueSortedWeeks(g.weeks), isCustomTime: true,
        customStartTime: formatTime(g.startTime), customEndTime: formatTime(g.endTime),
      });
    }
    log.info("转换完成，共 " + courses.length + " 条课程");
    return courses;
  }

  async function getSemesters() {
    log.info("获取学期列表...");
    const select = new DOMParser().parseFromString(await requestText(API.courseTablePage), "text/html")
      .querySelector("#allSemesters, #semesters");
    if (!select) throw new Error("未找到学期选择框，请确认已登录教务系统");
    const semesters = [];
    for (const opt of select.querySelectorAll("option")) {
      const id = opt.getAttribute("value");
      const name = opt.textContent.trim();
      if (id && id !== "all" && name) semesters.push({ id, name });
    }
    if (!semesters.length) throw new Error("学期列表为空");
    return semesters;
  }

  async function fetchLessonIds(semesterId) {
    const json = await requestJson(API.lessonIds(semesterId));
    if (!json || !Array.isArray(json.lessonIds)) throw new Error("课程数据异常，请稍后重试");
    return json.lessonIds;
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

  // 学期日期仅作辅助，失败降级为空，不中断主流程
  async function fetchSemesterInfo(semesterId) {
    try {
      const json = await requestJson(API.semester(semesterId));
      return { startDate: json.startDate || null, endDate: json.endDate || null };
    } catch (e) {
      log.warn("学期信息获取失败: " + e.message);
      return { startDate: null, endDate: null };
    }
  }

  async function saveConfig(config) {
    try { await ui.saveConfig(JSON.stringify(config)); }
    catch (e) { throw new Error("保存配置失败，请重试"); }
    ui.toast("课表配置导入成功");
  }

  async function saveCourses(courses) {
    try { await ui.saveCourses(JSON.stringify(courses)); }
    catch (e) { throw new Error("保存课程失败，请重试"); }
    ui.toast("成功导入 " + courses.length + " 条课程");
  }

  async function chooseSemester(semesters) {
    const names = semesters.map((s) => s.name);
    for (;;) {
      const index = await ui.select("选择学期", names, 0);
      if (index === null || index < 0 || index >= semesters.length) return null;
      const semester = semesters[index];
      let lessonIds = [];
      try { lessonIds = await fetchLessonIds(semester.id); }
      catch (e) { log.warn("获取 " + semester.name + " 课程失败: " + e.message); }
      if (lessonIds.length) return { semester, lessonIds };
      if (!(await ui.alert("无课程数据", "「" + semester.name + "」没有课程数据，请选择其他学期。", "重新选择"))) return null;
    }
  }

  async function runImportFlow() {
    try {
      if (!(await ui.alert("西安建筑科技大学课表导入", "请确保已登录教务系统（swjw.xauat.edu.cn）。\n本适配将自动获取学期与课程数据。", "开始导入"))) {
        ui.toast("导入已取消"); return;
      }
      ui.toast("正在获取学期列表...");
      const chosen = await chooseSemester(await getSemesters());
      if (!chosen) { ui.toast("导入已取消"); return; }

      // 课程详情与学期信息无依赖，并行请求
      ui.toast("正在获取课程数据...");
      const [datum, semesterInfo] = await Promise.all([
        fetchScheduleDatum(chosen.lessonIds),
        fetchSemesterInfo(chosen.semester.id),
      ]);

      const startDate = deriveSemesterStartDate(datum.scheduleList) || semesterInfo.startDate;
      if (!startDate) throw new Error("无法确定开学日期，请重试");
      log.info("推算开学日期: " + startDate);

      const courses = convertCourses(datum.lessonList, datum.scheduleList, startDate);
      if (!courses.length) {
        await ui.alert("无课程数据", "未能转换出有效课程。", "确定");
        return;
      }

      // 优先用课程实际最大周次，回退到日期差计算
      const totalWeeks = clampWeeks(getMaxCourseWeek(courses) || calculateTotalWeeks(startDate, semesterInfo.endDate));

      await saveConfig({ semesterStartDate: startDate, semesterTotalWeeks: totalWeeks });
      await saveCourses(courses);
      ui.toast("课表导入完成！");
      ui.done();
    } catch (e) {
      log.error("导入异常: " + (e.stack || e.message));
      await ui.alert("导入失败", e.message || "未知错误，请重试", "确定");
    }
  }

  runImportFlow();
})();