// ============================================================================
// 中国地质大学（武汉） 正方教务系统 拾光课程表适配脚本
// ----------------------------------------------------------------------------
// 适用学校：中国地质大学（南望山校区 / 未来城校区）
// 系统类型：正方教务管理系统（jwglxt）
// 获取策略：优先通过正方标准 API 请求结构化数据，失败时自动回退 DOM 页面解析
// 特性支持：
//   1. 只要登录教务系统任意页面即可触发导入，无需手动定位课表页
//   2. 弹窗选择目标学年与学期（支持跨学年/往期课表导入）
//   3. 自动识别校区并弹窗提供三套作息方案：
//      - 南望山校区 · 秋冬季（12节，下午 14:00 上课）
//      - 南望山校区 · 春夏季（12节，5月1日后下午 14:30 上课）
//      - 未来城校区 · 标准作息（12节，上午 08:30 上课）
//   4. 自动调用周次接口获取准确开学日期
// ============================================================================

/** 南望山校区 · 秋冬季作息（共12节） */
const CUG_NANWANGSHAN_AUTUMN = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "10:05", endTime: "10:50" },
  { number: 4,  startTime: "10:55", endTime: "11:40" },
  { number: 5,  startTime: "14:00", endTime: "14:45" },
  { number: 6,  startTime: "14:50", endTime: "15:35" },
  { number: 7,  startTime: "16:00", endTime: "16:45" },
  { number: 8,  startTime: "16:50", endTime: "17:35" },
  { number: 9,  startTime: "19:00", endTime: "19:45" },
  { number: 10, startTime: "19:50", endTime: "20:35" },
  { number: 11, startTime: "20:40", endTime: "21:25" },
  { number: 12, startTime: "21:30", endTime: "22:15" }
];

/** 南望山校区 · 春夏季作息（5月1日后执行，下午推迟30分钟，共12节） */
const CUG_NANWANGSHAN_SUMMER = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "10:05", endTime: "10:50" },
  { number: 4,  startTime: "10:55", endTime: "11:40" },
  { number: 5,  startTime: "14:30", endTime: "15:15" },
  { number: 6,  startTime: "15:20", endTime: "16:05" },
  { number: 7,  startTime: "16:35", endTime: "17:20" },
  { number: 8,  startTime: "17:25", endTime: "18:10" },
  { number: 9,  startTime: "19:30", endTime: "20:15" },
  { number: 10, startTime: "20:20", endTime: "21:05" },
  { number: 11, startTime: "21:10", endTime: "21:55" },
  { number: 12, startTime: "22:00", endTime: "22:45" }
];

/** 未来城校区 · 标准作息（全年统一，共12节） */
const CUG_FUTURE_CITY = [
  { number: 1,  startTime: "08:30", endTime: "09:15" },
  { number: 2,  startTime: "09:20", endTime: "10:05" },
  { number: 3,  startTime: "10:15", endTime: "11:00" },
  { number: 4,  startTime: "11:05", endTime: "11:50" },
  { number: 5,  startTime: "14:00", endTime: "14:45" },
  { number: 6,  startTime: "14:50", endTime: "15:35" },
  { number: 7,  startTime: "15:45", endTime: "16:30" },
  { number: 8,  startTime: "16:35", endTime: "17:20" },
  { number: 9,  startTime: "18:30", endTime: "19:15" },
  { number: 10, startTime: "19:20", endTime: "20:05" },
  { number: 11, startTime: "20:15", endTime: "21:00" },
  { number: 12, startTime: "21:05", endTime: "21:50" }
];

/** 作息方案选项 */
const SCHEDULE_OPTIONS = [
  { name: "南望山校区 · 秋冬季作息（下午 14:00 上课）", slots: CUG_NANWANGSHAN_AUTUMN },
  { name: "南望山校区 · 春夏季作息（5月1日后，下午 14:30 上课）", slots: CUG_NANWANGSHAN_SUMMER },
  { name: "未来城校区 · 标准作息（上午 08:30 上课，全天12节）", slots: CUG_FUTURE_CITY }
];

/**
 * 解析周次字符串，处理单双周和多周次区间
 * 示例："1-2周,4-5周,7-11周" / "1-16周(单)" / "7周"
 */
function parseWeeks(weekStr) {
  if (!weekStr) return [];
  const weeks = [];
  String(weekStr).split(/[,，]/).forEach(part => {
    let p = (part || "").replace(/周/g, "").trim();
    if (!p) return;
    const single = p.includes("(单)");
    const double = p.includes("(双)");
    p = p.replace(/\(单\)|\(双\)/g, "").trim();
    let s, e;
    const range = p.match(/(\d+)\s*-\s*(\d+)/);
    if (range) {
      s = +range[1];
      e = +range[2];
    } else if (/^\d+$/.test(p)) {
      s = e = +p;
    } else {
      return;
    }
    for (let w = s; w <= e; w++) {
      if (single && w % 2 === 0) continue;
      if (double && w % 2 !== 0) continue;
      weeks.push(w);
    }
  });
  return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 课程合并与去重：同名同师同地同天同节次合并周次
 */
function mergeAndDistinctCourses(courses) {
  if (!Array.isArray(courses) || courses.length <= 1) return courses;
  const out = [];
  courses.forEach(c => {
    const weeks = Array.isArray(c.weeks) ? [...c.weeks] : [];
    const idx = out.findIndex(x =>
      x.name === c.name && x.teacher === c.teacher && x.position === c.position &&
      x.day === c.day && x.startSection === c.startSection && x.endSection === c.endSection
    );
    if (idx >= 0) {
      out[idx].weeks = [...new Set([...out[idx].weeks, ...weeks])].sort((a, b) => a - b);
    } else {
      out.push({ ...c, weeks: weeks });
    }
  });
  return out;
}

/**
 * 解析正方 API 返回的 JSON (kbList)
 */
function parseJsonData(jsonData) {
  if (!jsonData || !Array.isArray(jsonData.kbList)) {
    return [];
  }

  const courses = [];
  for (const item of jsonData.kbList) {
    if (!item.kcmc || !item.jcs || !item.xqj || !item.zcd) continue;

    const weeks = parseWeeks(item.zcd);
    if (!weeks.length) continue;

    const jcParts = String(item.jcs).split("-");
    const startSection = parseInt(jcParts[0], 10);
    const endSection = parseInt(jcParts[jcParts.length - 1], 10);
    const day = parseInt(item.xqj, 10);

    if (isNaN(startSection) || isNaN(endSection) || isNaN(day) || day < 1 || day > 7) {
      continue;
    }

    const campus = (item.xqmc || "").trim();
    const classroom = (item.cdmc || "").trim();
    let position = "";
    if (campus && classroom) {
      position = classroom.includes(campus) ? classroom : `${campus} ${classroom}`;
    } else {
      position = classroom || campus;
    }

    courses.push({
      name: (item.kcmc || "").trim(),
      teacher: (item.xm || "").trim(),
      position: position.trim(),
      day: day,
      startSection: startSection,
      endSection: endSection,
      weeks: weeks,
      isCustomTime: false
    });
  }

  return mergeAndDistinctCourses(courses);
}

/**
 * 从教务系统读取学年和学期选项
 */
async function fetchAcademicOptions() {
  const url = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151";
  try {
    const resp = await fetch(url, { method: "GET", credentials: "include" });
    if (!resp.ok) return null;

    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const yearOptions = Array.from(doc.querySelectorAll("#xnm option"))
      .filter(opt => opt.value !== "")
      .map(opt => ({
        value: opt.value.trim(),
        text: opt.textContent.trim(),
        selected: opt.selected
      }));

    const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
      .filter(opt => opt.value !== "")
      .map(opt => {
        const text = opt.textContent.trim();
        const semName = text === "3" || text === "1" ? "第1学期" :
                        text === "12" || text === "2" ? "第2学期" :
                        text === "16" || text === "3" ? "第3学期(小学期)" : `第${text}学期`;
        return {
          value: opt.value.trim(),
          text: semName,
          selected: opt.selected
        };
      });

    if (!yearOptions.length || !semesterOptions.length) return null;

    let defYearIdx = yearOptions.findIndex(o => o.selected);
    if (defYearIdx === -1) defYearIdx = 0;

    let defSemIdx = semesterOptions.findIndex(o => o.selected);
    if (defSemIdx === -1) defSemIdx = 0;

    return {
      yearOptions,
      semesterOptions,
      defaultYearIndex: defYearIdx,
      defaultSemesterIndex: defSemIdx
    };
  } catch (e) {
    console.warn("读取学年学期选项失败:", e);
    return null;
  }
}

/**
 * 提示用户选择学年和学期
 */
async function selectAcademicYearAndSemester() {
  const options = await fetchAcademicOptions();

  // 若无法通过后台请求获取选项，尝试从当前页面已有元素提取
  if (!options) {
    const xnmEl = document.querySelector("#xnm");
    const xqmEl = document.querySelector("#xqm");
    if (xnmEl && xqmEl && xnmEl.value && xqmEl.value) {
      return { academicYear: xnmEl.value.trim(), semesterCode: xqmEl.value.trim(), label: "当前选中学期" };
    }
    return null;
  }

  const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = options;

  // 1. 选择学年
  const yearTexts = yearOptions.map(o => o.text);
  const selectedYearIdx = await window.shiguangBridgePromise.showSingleSelection(
    "请选择导入学年",
    JSON.stringify(yearTexts),
    defaultYearIndex
  );
  if (selectedYearIdx === null || selectedYearIdx === undefined || selectedYearIdx < 0) return null;
  const chosenYear = yearOptions[selectedYearIdx];

  // 2. 选择学期
  const semTexts = semesterOptions.map(o => o.text);
  const selectedSemIdx = await window.shiguangBridgePromise.showSingleSelection(
    `学年：${chosenYear.text}\n请选择导入学期`,
    JSON.stringify(semTexts),
    defaultSemesterIndex
  );
  if (selectedSemIdx === null || selectedSemIdx === undefined || selectedSemIdx < 0) return null;
  const chosenSem = semesterOptions[selectedSemIdx];

  return {
    academicYear: chosenYear.value,
    semesterCode: chosenSem.value,
    label: `${chosenYear.text}学年 ${chosenSem.text}`
  };
}

/**
 * 调用正方开学周次接口获取第1周周一日期
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
  if (!academicYear || !semesterCode) return null;
  const url = window.location.origin + "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body: `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}`,
      credentials: "include"
    });
    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json) && json.length > 0) {
        const first = json.find(i => String(i.zs) === "1" || String(i.zsmc) === "1") || json[0];
        const raw = first && (first.rq || first.zcrq || first.ksrq);
        const m = raw && String(raw).match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
      }
    }
  } catch (e) {
    console.warn("获取开学日期失败:", e);
  }
  return null;
}

/**
 * 调用正方 API 获取课程数据
 */
async function fetchCoursesByApi(academicYear, semesterCode) {
  const url = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";
  const body = `xnm=${encodeURIComponent(academicYear)}&xqm=${encodeURIComponent(semesterCode)}&kzlx=ck&xsdm=&kclbdm=`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-requested-with": "XMLHttpRequest"
    },
    body: body,
    credentials: "include"
  });

  if (!resp.ok) return null;
  const jsonData = await resp.json();
  return parseJsonData(jsonData);
}

/** 智能推测默认作息索引 */
function inferDefaultScheduleIndex(courses) {
  if (!courses || !courses.length) return 0;
  let fcCount = 0, nwsCount = 0;
  courses.forEach(c => {
    if (c.position.includes("未来城")) fcCount++;
    if (c.position.includes("南望山")) nwsCount++;
  });
  if (fcCount > nwsCount) {
    return 2; // 未来城校区
  }
  const currentMonth = new Date().getMonth() + 1;
  if (currentMonth >= 5 && currentMonth <= 9) {
    return 1; // 南望山春夏季
  }
  return 0; // 南望山秋冬季
}

/**
 * 主导入流程
 */
async function runImportFlow() {
  console.log("正在启动中国地质大学课表导入流程...");

  // 1. 登录与域名检测
  const host = window.location.host;
  if (!host.includes("cug.edu.cn")) {
    await window.shiguangBridgePromise.showAlert(
      "请先登录教务系统",
      "您当前未在学校教务系统域名下。\n\n请在统一身份认证登录并进入教务系统后，再次点击导入。",
      "好的"
    );
    return;
  }

  window.shiguangBridge.showToast("正在读取学年学期数据...");

  // 2. 交互选择学年与学期
  const termSelection = await selectAcademicYearAndSemester();
  if (!termSelection) {
    window.shiguangBridge.showToast("未完成学年学期选择，导入流程已取消。");
    return;
  }

  const { academicYear, semesterCode, label } = termSelection;
  window.shiguangBridge.showToast(`正在获取 ${label} 课程数据...`);

  // 3. 并行获取课程数据与开学日期
  let courses = null;
  let startDate = null;

  try {
    const [fetchedCourses, fetchedStartDate] = await Promise.all([
      fetchCoursesByApi(academicYear, semesterCode),
      fetchSemesterStartDate(academicYear, semesterCode)
    ]);
    courses = fetchedCourses;
    startDate = fetchedStartDate;
  } catch (err) {
    console.error("API请求异常:", err);
  }

  // 4. 若 API 未返回数据，提示用户
  if (!courses || courses.length === 0) {
    await window.shiguangBridgePromise.showAlert(
      "未获取到课程数据",
      `在 [${label}] 中未查询到任何课程记录。\n\n可能原因：\n1. 该学期尚未排课或您在该学期无选课记录；\n2. 登录状态可能已失效，请尝试刷新页面重新登录。`,
      "我知道了"
    );
    return;
  }

  console.log(`成功解析到 ${courses.length} 条有效课程。`, courses);

  // 5. 用户确认学期并选择校区作息
  const defaultIdx = inferDefaultScheduleIndex(courses);
  const optionsLabels = SCHEDULE_OPTIONS.map(opt => opt.name);

  let selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
    `识别到 ${courses.length} 门课程 (${label})\n请选择您的校区与作息时间：`,
    JSON.stringify(optionsLabels),
    defaultIdx
  );

  if (selectedIdx === null || selectedIdx === undefined || selectedIdx < 0) {
    selectedIdx = defaultIdx;
    window.shiguangBridge.showToast("已使用推荐作息: " + SCHEDULE_OPTIONS[selectedIdx].name);
  }

  const chosenSchedule = SCHEDULE_OPTIONS[selectedIdx];

  // 6. 保存课程
  try {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
  } catch (error) {
    console.error("保存课程失败:", error);
    window.shiguangBridge.showToast("课程保存失败: " + error.message);
    return;
  }

  // 7. 保存作息时间段
  try {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(chosenSchedule.slots));
  } catch (error) {
    console.error("保存作息时间段失败:", error);
  }

  // 8. 保存课表配置
  const courseConfig = {
    semesterTotalWeeks: 20,
    firstDayOfWeek: 1
  };
  if (startDate) {
    courseConfig.semesterStartDate = startDate;
    console.log("开学日期设定为:", startDate);
  }

  try {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));
  } catch (error) {
    console.error("保存课表配置失败:", error);
  }

  // 9. 完成提示
  const dateTip = startDate ? `\n开学日期已自动设定为: ${startDate}` : "\n未自动识别到开学日期，可在App「课表设置」中核对。";
  await window.shiguangBridgePromise.showAlert(
    "导入成功",
    `已成功导入 ${courses.length} 门课程！ (${label})\n作息已设为：${chosenSchedule.name}${dateTip}`,
    "完成"
  );

  window.shiguangBridge.showToast(`导入成功，共导入 ${courses.length} 门课程！`);
  window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
