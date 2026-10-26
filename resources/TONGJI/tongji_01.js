(() => {
  const BASE = "https://1.tongji.edu.cn/api";
  const ENDPOINTS = {
    authId: () => `${BASE}/sessionservice/session/currentAuthId`,
    termList: () =>
      `${BASE}/baseresservice/schoolCalendar/list?_t=${Date.now()}`,
    currTerm: () =>
      `${BASE}/baseresservice/schoolCalendar/currentTermCalendar?_t=${Date.now()}`,
    termMetaData: (tid) =>
      `${BASE}/baseresservice/schoolCalendar/detail?id=${tid}&_t=${Date.now()}`,
    courseInfo: (tid) =>
      `${BASE}/electionservice/reportManagement/findStudentTimetab?calendarId=${tid}&_t=${Date.now()}`,
  };

  async function checkAuthStatus() {
    const response = await fetch(ENDPOINTS.authId(), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ authId: Math.round(Math.random() * 9000) + 1000 }),
    });
    if (!response.ok) throw new Error("请先登录");
  }

  function interpretTimeSlot(termMetaDataResponse) {
    const { noWeekendWorkTimes } = termMetaDataResponse.data;
    return noWeekendWorkTimes.map((slot, index) => ({
      number: index + 1,
      startTime: slot.beginTime,
      endTime: slot.endTime,
    }));
  }

  function interpretSemesterStartDate(courseInfoResponse) {
    const { data } = courseInfoResponse;
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(data.beginDay)).replaceAll("/", "-");
  }

  async function determineTerm() {
    const currTermResponse = await fetch(ENDPOINTS.currTerm()).then((res) =>
      res.json(),
    );
    const currTermId = currTermResponse.data.schoolCalendar.id;
    const useOtherTerm = await window.shiguangBridgePromise.showSingleSelection(
      "是否使用当前学期",
      JSON.stringify([
        `使用当前学期\n(${currTermResponse.data.simpleName})`,
        "选择其他学期",
      ]),
    );
    let termId = currTermId;
    if (useOtherTerm === null)
      window.shiguangBridge.showToast("未选择学期，使用当前学期");
    else if (useOtherTerm === 1) {
      window.shiguangBridge.showToast("正在加载学期列表");
      const termListResponse = await fetch(ENDPOINTS.termList()).then((res) =>
        res.json(),
      );
      const index = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(termListResponse.data.map((term) => term.fullName)),
      );
      const selectedId = termListResponse.data[index]?.id;
      if (selectedId) termId = selectedId;
      else window.shiguangBridge.showToast("未选择学期，使用当前学期");
    }
    const termMetaDataResponse = await fetch(
      ENDPOINTS.termMetaData(termId),
    ).then((res) => res.json());
    const timeSlots = interpretTimeSlot(termMetaDataResponse);
    const semesterStartDate = interpretSemesterStartDate(termMetaDataResponse);
    return { termId, timeSlots, semesterStartDate };
  }

  async function fetchCourseInfo(termId) {
    const { data } = await fetch(ENDPOINTS.courseInfo(termId)).then((res) =>
      res.json(),
    );
    const removeId = (str) =>
      str.replace(/\(\d+\)$/, "").replace(/\(\d+\),/g, ", ");
    return data.flatMap((c) =>
      c.timeTableList.map((t) => ({
        name: c.courseName,
        teacher: removeId(t.teacherName),
        position: t.roomIdI18n || t.roomLable, // typo in API
        day: t.dayOfWeek,
        startSection: t.timeStart,
        endSection: t.timeEnd,
        weeks: t.weeks,
      })),
    );
  }

  async function main() {
    await checkAuthStatus();
    const { termId, timeSlots, semesterStartDate } = await determineTerm();
    const courseInfo = await fetchCourseInfo(termId);
    const semesterTotalWeeks = Math.max(
      ...courseInfo.map((c) => Math.max(...c.weeks)),
    );
    const result = await Promise.allSettled([
      window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courseInfo)),
      window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots)),
      window.shiguangBridgePromise.saveCourseConfig(
        JSON.stringify({ semesterStartDate, semesterTotalWeeks }),
      ),
    ]);
    const rejected = [];
    if (!result[0].value) rejected.push("课程信息");
    if (!result[1].value) rejected.push("预设时间段");
    if (!result[2].value) rejected.push("课表配置");
    if (rejected.length > 0) throw new Error(`${rejected.join(", ")} 保存失败`);
  }

  main()
    .catch((e) => {
      window.shiguangBridge.showToast(`错误: ${e.message ?? e}`);
      console.error(e);
    })
    .finally(() => {
      window.shiguangBridge.notifyTaskCompletion();
    });
})();
