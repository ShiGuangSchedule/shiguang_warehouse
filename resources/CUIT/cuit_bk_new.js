// == 成都信息工程大学（CUIT）课表适配脚本（Fetch API）==
// 适用页面：https://sjjx.cuit.edu.cn:56443/labms/#/course/my
// 适配实际 API 返回的扁平数组结构

(async function () {
  "use strict";

  function showToast(msg) {
    if (typeof window.shiguangBridge !== "undefined" && window.shiguangBridge.showToast) {
      window.shiguangBridge.showToast(msg);
    } else {
      console.log("[Toast]", msg);
    }
  }

  async function showAlert(title, content, confirmText = "确定") {
    if (typeof window.shiguangBridgePromise !== "undefined") {
      return await window.shiguangBridgePromise.showAlert(
        title,
        content,
        confirmText,
      );
    } else {
      alert(`${title}\n${content}`);
      return true;
    }
  }

  // ---------- 从页面提取用户信息 ----------
  function getUserInfoFromPage() {
    try {
      const initialState = window.__INITIAL_STATE__ || window.g_initialState;
      if (initialState?.info?.userCode) {
        return {
          status: 200,
          data: {
            userCode: initialState.info.userCode,
            nickName: initialState.info.nickName || "",
          },
        };
      }

      const usernameSpan = document.querySelector(".username___LBEmQ");
      if (usernameSpan) {
        const text = usernameSpan.textContent.trim();
        const idMatch = text.match(/^\d+/);
        if (idMatch) {
          return {
            status: 200,
            data: { userCode: idMatch[0], nickName: text },
          };
        }
      }
      return null;
    } catch (e) {
      console.warn("提取页面用户信息失败", e);
      return null;
    }
  }

  async function fetchUserInfo() {
    const pageInfo = getUserInfoFromPage();
    if (pageInfo) {
      console.log("从页面全局变量获取用户信息成功");
      return pageInfo;
    }

    const baseUrl = window.location.origin;
    const url = `${baseUrl}/labms/user/info?sf_request_type=ajax`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "include",
    });
    if (!resp.ok) throw new Error(`获取用户信息失败: ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 200)
      throw new Error(data.message || "获取用户信息失败");
    return data;
  }

  // ---------- 获取当前学期 ----------
  function getCurrentSemester() {
    const selectItem = document.querySelector(
      ".ant-select-selection-item[title]",
    );
    if (selectItem) {
      const title = selectItem.getAttribute("title");
      if (title?.includes("学年")) return title;
    }
    try {
      const state = window.__INITIAL_STATE__ || window.g_initialState;
      if (state?.semester?.current?.name) return state.semester.current.name;
    } catch (e) {}
    return "2025-2026学年第二学期";
  }

  // ---------- 请求课表数据 ----------
  async function fetchCourseSchedule(studentId, semester) {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/labms/course/schedule/list/type?sf_request_type=ajax`;

    const requestBody = {
      studentIds: [studentId],
      labIds: [],
      classIds: [],
      teacherIds: [studentId],
      status: 2,
      semester: semester,
      week: null,
      showMode: "table",
      toBeDeleted: 0,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "include",
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) throw new Error(`课表接口请求失败: ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 200) throw new Error(data.message || "获取课表失败");
    return data.data; // 直接返回数组
  }

  // ---------- 解析课表数据（扁平数组结构）----------
  function convertApiDataToCourses(apiData) {
    const courses = [];
    if (!Array.isArray(apiData)) return courses;

    for (const item of apiData) {
      // 必须的字段校验
      if (!item.courseName || !item.weeks || item.weeks.length === 0) continue;

      const startSection =
        item.sections && item.sections.length > 0 ? item.sections[0] : 1;
      const endSection =
        item.sections && item.sections.length > 0
          ? item.sections[item.sections.length - 1]
          : 1;

      // 解析时间（去除秒）
      let startTime = item.startTime ? item.startTime.substring(0, 5) : "";
      let endTime = item.endTime ? item.endTime.substring(0, 5) : "";

      courses.push({
        name: item.courseName,
        teacher: item.teacherName || "",
        position: item.location || "",
        day: item.weekDay, // 1=周一 ... 7=周日
        startSection: startSection,
        endSection: endSection,
        weeks: item.weeks, // 数字数组，例如 [2,3,4,...]
        isCustomTime: !!(startTime && endTime),
        customStartTime: startTime,
        customEndTime: endTime,
      });
    }

    return courses;
  }

  // ---------- 导入预设时间段 ----------
  async function importTimeSlots() {
    const timeSlots = [
      { number: 1, startTime: "08:20", endTime: "09:05" },
      { number: 2, startTime: "09:15", endTime: "10:00" },
      { number: 3, startTime: "10:20", endTime: "11:05" },
      { number: 4, startTime: "11:15", endTime: "12:00" },
      { number: 5, startTime: "14:00", endTime: "14:45" },
      { number: 6, startTime: "14:55", endTime: "15:40" },
      { number: 7, startTime: "15:50", endTime: "16:35" },
      { number: 8, startTime: "16:45", endTime: "17:30" },
      { number: 9, startTime: "17:40", endTime: "18:25" },
      { number: 10, startTime: "19:30", endTime: "20:15" },
      { number: 11, startTime: "20:25", endTime: "21:10" },
      { number: 12, startTime: "21:20", endTime: "22:05" },
    ];
    await window.shiguangBridgePromise.savePresetTimeSlots(
      JSON.stringify(timeSlots),
    );
  }

  // ---------- 导入学期配置 ----------
  async function importConfig(semester) {
    let startDate = "2026-02-23";
    if (semester.includes("2025-2026") && semester.includes("第一学期")) {
      startDate = "2025-09-01";
    }
    const config = {
      semesterStartDate: startDate,
      semesterTotalWeeks: 20,
      defaultClassDuration: 45,
      defaultBreakDuration: 10,
      firstDayOfWeek: 1,
    };
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
  }

  // ---------- 主流程 ----------
  async function runImportFlow() {
    try {
      showToast("正在获取用户信息...");
      const userInfo = await fetchUserInfo();
      const studentId = userInfo.data.userCode;
      const semester = getCurrentSemester();

      if (!studentId) throw new Error("无法获取学号");

      showToast(`正在获取 ${semester} 课表...`);
      const apiData = await fetchCourseSchedule(studentId, semester);

      showToast("正在解析课程数据...");
      const courses = convertApiDataToCourses(apiData);
      if (courses.length === 0) throw new Error("未解析到任何课程");

      showToast(`解析到 ${courses.length} 门课程，正在保存...`);
      await window.shiguangBridgePromise.saveImportedCourses(
        JSON.stringify(courses),
      );

      await importTimeSlots();
      await importConfig(semester);

      showToast(`导入完成！共 ${courses.length} 门课程`);
      if (
        typeof window.shiguangBridge !== "undefined" &&
        window.shiguangBridge.notifyTaskCompletion
      ) {
        window.shiguangBridge.notifyTaskCompletion();
      }
    } catch (error) {
      console.error(error);
      showToast(`导入失败: ${error.message}`);
      await showAlert("导入失败", error.message);
    }
  }

  setTimeout(runImportFlow, 800);
})();
