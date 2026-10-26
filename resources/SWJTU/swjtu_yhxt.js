// 西南交通大学新教务系统课表导入脚本
// 适配页面：https://yhxt.swjtu.edu.cn/study/teach/course/stu-course-list

(() => {
  const SWJTU_SCHEDULE_API =
    "https://yhxt.swjtu.edu.cn/yethan/common/course-schedule/student-course-schedule";
  const SWJTU_SEMESTER_TOTAL_WEEKS = 19;
  const MAX_CLASS_TIME_FIELDS = 40;

  const SWJTU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:50", endTime: "10:35" },
    { number: 4, startTime: "10:40", endTime: "11:25" },
    { number: 5, startTime: "11:30", endTime: "12:15" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:40", endTime: "16:25" },
    { number: 9, startTime: "16:40", endTime: "17:25" },
    { number: 10, startTime: "17:30", endTime: "18:15" },
    { number: 11, startTime: "19:30", endTime: "20:15" },
    { number: 12, startTime: "20:20", endTime: "21:05" },
    { number: 13, startTime: "21:10", endTime: "21:55" },
  ];

  const SWJTU_COURSE_CONFIG = {
    semesterStartDate: null,
    semesterTotalWeeks: SWJTU_SEMESTER_TOTAL_WEEKS,
    defaultClassDuration: 45,
    firstDayOfWeek: 1,
  };

  const DAY_MAP = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/[\t\r\n]+/g, " ")
      .replace(/ +/g, " ")
      .trim();
  }

  function cleanValue(value) {
    const text = normalizeText(value);
    if (!text || text.toLowerCase() === "null" || text === "无") return "";
    return text;
  }

  function getBridge() {
    return {
      bridge: window.AndroidBridge || window.shiguangBridge,
      promise: window.AndroidBridgePromise || window.shiguangBridgePromise,
    };
  }

  function showToast(message) {
    const { bridge } = getBridge();
    if (bridge?.showToast) {
      bridge.showToast(message);
    } else {
      console.log(message);
    }
  }

  async function showAlert(title, message) {
    const { promise } = getBridge();
    if (promise?.showAlert) {
      await promise.showAlert(title, message, "确定");
    } else {
      console.warn(`${title}: ${message}`);
    }
  }

  function getCookieValue(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : "";
  }

  function getStorageValue(name) {
    try {
      return localStorage.getItem(name) || sessionStorage.getItem(name) || "";
    } catch (error) {
      console.warn("读取本地登录态失败：", error);
      return "";
    }
  }

  function getYToken() {
    const candidates = [
      getCookieValue("ytoken"),
      getStorageValue("ytoken"),
      getStorageValue("YToken"),
      getStorageValue("token"),
      getStorageValue("TOKEN"),
    ];
    return candidates.map(cleanValue).find(Boolean) || "";
  }

  async function fetchSemesterSchedule() {
    const ytoken = getYToken();
    if (!ytoken) {
      throw new Error("未找到 ytoken，请确认已登录西南交通大学新教务系统。");
    }

    const response = await fetch(SWJTU_SCHEDULE_API, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        ytoken,
      },
    });

    if (!response.ok) {
      throw new Error(`课表接口请求失败：HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.code !== "00000") {
      throw new Error(payload.message || `课表接口返回异常：${payload.code}`);
    }

    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.data?.list)) return payload.data.list;
    throw new Error("课表接口返回结构异常：data 不是课程数组。");
  }

  function parseWeeks(weekText) {
    const weeks = [];
    const text = normalizeText(weekText)
      .replace(/第/g, "")
      .replace(/[[【]/g, "(")
      .replace(/[\]】]/g, ")");
    const parity = text.includes("单") ? "单" : text.includes("双") ? "双" : "";
    const cleanedText = text
      .replace(/[单双]/g, "")
      .replace(/[()（）]/g, "")
      .replace(/周/g, "");

    cleanedText.split(/[,，、;]/).forEach((segment) => {
      const match = normalizeText(segment).match(
        /^(\d+)(?:\s*[-~—至]\s*(\d+))?$/,
      );
      if (!match) return;

      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
        return;

      for (let week = start; week <= end; week++) {
        if (parity === "单" && week % 2 !== 1) continue;
        if (parity === "双" && week % 2 !== 0) continue;
        if (!weeks.includes(week)) weeks.push(week);
      }
    });

    return weeks.sort((a, b) => a - b);
  }

  function parseClassTime(classTime) {
    const text = cleanValue(classTime);
    if (!text) return [];

    const results = [];
    const pattern =
      /((?:第?\d+(?:\s*[-~—至]\s*\d+)?(?:\s*[,，、]\s*第?\d+(?:\s*[-~—至]\s*\d+)?)*\s*周(?:\s*[（(]?\s*[单双]\s*[）)]?\s*周?)?))\s*(?:星期|周)([一二三四五六日天])\s*第?\s*(\d+)(?:\s*[-~—至]\s*(\d+))?\s*节/g;
    let match = pattern.exec(text);

    while (match !== null) {
      const weeks = parseWeeks(match[1]);
      const day = DAY_MAP[match[2]];
      const startSection = Number(match[3]);
      const endSection = match[4] ? Number(match[4]) : startSection;

      if (
        weeks.length > 0 &&
        day &&
        Number.isFinite(startSection) &&
        Number.isFinite(endSection) &&
        startSection <= endSection
      ) {
        results.push({ weeks, day, startSection, endSection });
      }

      match = pattern.exec(text);
    }

    return results;
  }

  function buildTeacher(item) {
    const names = [item.staffName, item.staffNameOther]
      .flatMap((value) => cleanValue(value).split(/[,，、;；]/))
      .map(cleanValue)
      .filter(Boolean);
    return Array.from(new Set(names)).join(",") || "未指定";
  }

  function buildCourses(apiCourses) {
    const courses = [];
    const skipped = [];

    apiCourses.forEach((item) => {
      const name = cleanValue(item.courseName || item.name || item.kcmc);
      if (!name) return;

      const teacher = buildTeacher(item);
      let hasSpecificSchedule = false;
      let hasAnySchedule = false;

      for (let index = 1; index <= MAX_CLASS_TIME_FIELDS; index++) {
        const classTime = cleanValue(item[`classTime${index}`]);
        const classPlace = cleanValue(item[`classPlace${index}`]);
        if (!classTime) continue;

        hasAnySchedule = true;
        const parsedTimes = parseClassTime(classTime);
        if (parsedTimes.length === 0) continue;

        hasSpecificSchedule = true;
        parsedTimes.forEach((time) => {
          courses.push({
            name,
            teacher,
            position: classPlace || cleanValue(item.campusName) || "未指定",
            day: time.day,
            startSection: time.startSection,
            endSection: time.endSection,
            weeks: time.weeks,
          });
        });
      }

      if (hasAnySchedule && !hasSpecificSchedule) {
        skipped.push(name);
      }
    });

    return { courses, skipped };
  }

  async function saveImportResult(courses, skipped) {
    const { bridge, promise } = getBridge();
    if (!promise?.saveImportedCourses) {
      throw new Error(
        "未找到保存课表的 Bridge，请在拾光 App 或测试插件中执行。",
      );
    }

    await promise.saveCourseConfig(JSON.stringify(SWJTU_COURSE_CONFIG));
    await promise.savePresetTimeSlots(JSON.stringify(SWJTU_TIME_SLOTS));
    await promise.saveImportedCourses(JSON.stringify(courses));

    if (skipped.length > 0) {
      showToast(
        `成功导入 ${courses.length} 条课程，另有 ${skipped.length} 门无具体节次课程已跳过`,
      );
    } else {
      showToast(`成功导入 ${courses.length} 条课程`);
    }

    bridge?.notifyTaskCompletion?.();
  }

  async function importSwjtuSchedule() {
    try {
      showToast("正在通过西南交通大学新教务接口获取课表...");

      const apiCourses = await fetchSemesterSchedule();
      const { courses, skipped } = buildCourses(apiCourses);
      if (courses.length === 0) {
        throw new Error(
          `接口返回 ${apiCourses.length} 门课程，但没有解析到带星期和节次的上课安排。`,
        );
      }

      await saveImportResult(courses, skipped);
      return true;
    } catch (error) {
      console.error("SWJTU 新教务课表导入失败：", error);
      await showAlert("导入失败", `解析或保存课表失败：${error.message}`);
      return false;
    }
  }

  void importSwjtuSchedule();
})();
