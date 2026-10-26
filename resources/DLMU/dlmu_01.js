// 文件: school.js
// 功能：从大连海事大学教务系统获取课程表，通过桥接 API 导入到拾光课程表

// ---------- 常量配置 ----------
const BASE_URL = "http://jw.xpaas.dlmu.edu.cn";
const ENDPOINTS = {
  DATA_QUERY: `${BASE_URL}/eams/dataQuery.action?sf_request_type=ajax`,
  COURSE_TABLE_FOR_STD: `${BASE_URL}/eams/courseTableForStd.action`,
  COURSE_TABLE: `${BASE_URL}/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`,
  HOME_EXT: `${BASE_URL}/eams/homeExt.action`,
};

const UNIT_COUNT = 10; // 每天的课程节数

// ---------- 全局验证函数 ----------
/**
 * 验证学年输入格式
 * @param {string} input - 用户输入的年份
 * @returns {false|string} 验证通过返回 false，否则返回错误信息
 */
function validateYearInput(input) {
  if (/^\d{4}$/.test(input)) {
    return false; // 验证通过
  }
  return "请输入四位数字的年份（例如 2024）";
}

// ---------- 工具函数 ----------

/**
 * 解析课程数据
 * @param {string} jsCode - 包含课程数据的 JavaScript 代码字符串
 * @returns {Array} 课程对象数组
 */
function parseCourses(jsCode) {
  /**
   * 默认在一个 TaskActivity 中只涉及该课程某一天的信息，且课程每节默认为连续 | 参考：(星期&节次解析器)[parseIndices()]
   */
  const unitCount = UNIT_COUNT;

  // 主正则：捕获 TaskActivity 参数 + 后续所有代码直到下一个 activity
  const mainRegex =
    /var\s*teachers\s*=\s*\[([^;]+?)\];(?:[\s\S]*?)activity\s*=\s*new\s*TaskActivity\(([^;]+?)\);([\s\S]*?)(?=(?:varteachers\s*=)|(?:<\/script>))/g;

  const courses = [];
  let match;

  while ((match = mainRegex.exec(jsCode)) !== null) {
    console.warn(match);
    // 第1组：教师信息
    const teachers = match[1].split("}").map((s) => s.trim());
    const teacherNames = extractTeacherNames(teachers);
    const teachersNameStr = teacherNames.join();
    // 第2组：TaskActivity 参数
    const args = match[2]
      .replaceAll(/\.join\(.*?\)/g, "")
      .split(",")
      .map((s) => s.trim());
    const courseName = extractCourseName(args[3]);
    const position = stripQuotes(args[5]);
    const weekStr = stripQuotes(args[6]);

    // 第3组：后续代码，提取所有 index
    const followingCode = match[3];
    const indexRegex =
      /index\s*=\s*(\d+(?:\s*\*\s*unitCount\s*\+\s*\d+)?)\s*;/g;

    const indices = [];
    let idxMatch;
    while ((idxMatch = indexRegex.exec(followingCode)) !== null) {
      indices.push(evalIndex(idxMatch[1], unitCount));
    }

    // 计算时间信息
    const timeInfo = parseIndices(indices, unitCount);

    courses.push({
      name: courseName,
      teacher: teachersNameStr,
      position: position,
      day: timeInfo.day,
      startSection: timeInfo.startSection,
      endSection: timeInfo.endSection,
      weeks: parseWeeks(weekStr),
      isCustomTime: false,
    });
  }

  return courses;
}

/**
 * 计算 index 表达式的值（安全版本）
 * @param {string} expr - 表达式字符串
 * @param {number} unitCount - 每天的课程节数
 * @returns {number} 计算结果
 */
function evalIndex(expr, unitCount) {
  // 替换 unitCount 为实际值并移除空格
  const cleanExpr = expr.replace(/unitCount/g, unitCount).replace(/\s+/g, "");

  // 使用 Function 构造器替代 eval，仅允许数字和基本运算符
  try {
    const fn = new Function("return " + cleanExpr);
    return fn();
  } catch (error) {
    console.error("计算表达式失败:", expr, error);
    return 0;
  }
}

/**
 * 星期&节次解析器，根据 indices 计算 day 和 sections
 * @param {Array<number>} indices - 索引数组
 * @param {number} unitCount - 每天的课程节数
 * @returns {Object} 包含 day、startSection、endSection 的对象
 */
function parseIndices(indices, unitCount) {
  /**
   *| index 范围 | 含义        |
   *| -------- | --------- |
   *| `0-9`    | 周一 第1-10节 |
   *| `10-19`  | 周二 第1-10节 |
   *| `20-29`  | 周三 第1-10节 |
   *| ...      | ...       |
   */
  if (indices.length === 0) return { day: 1, startSection: 1, endSection: 1 };

  // 所有 index 应该在同一天
  const days = [...new Set(indices.map((i) => Math.floor(i / unitCount) + 1))];
  const day = days[0]; // 取第一天（理论上应该只有一天）

  const sections = indices
    .map((i) => (i % unitCount) + 1)
    .sort((a, b) => a - b);

  return {
    day: day,
    startSection: sections[0],
    endSection: sections[sections.length - 1],
  }; // 默认解析为同天连堂课，所以仅返回一个 SectionModel
}

/**
 * 提取教师姓名
 * @param {Array<string>} teachers - 教师信息数组
 * @returns {Array<string>} 教师姓名数组
 */
function extractTeacherNames(teachers) {
  const teacherNames = [];
  for (const teacherMsg of teachers) {
    if (!teacherMsg || teacherMsg.trim().length === 0) continue;
    const args = teacherMsg.split(",");
    teacherNames.push(
      args[1]
        .replaceAll(/['"]/g, "")
        .replace(/name\s*:\s*/gi, "")
        .trim(),
    );
  }
  return teacherNames;
}

/**
 * 提取课程名称
 * @param {string} str - 包含课程名称的字符串
 * @returns {string} 清理后的课程名称
 */
function extractCourseName(str) {
  return str.replace(/^["']|["']$/g, "").replace(/\([^)]+\)$/, "");
}

/**
 * 去除字符串两端的引号
 * @param {string} str - 输入字符串
 * @returns {string} 去除引号后的字符串
 */
function stripQuotes(str) {
  return str.replace(/^["']|["']$/g, "");
}

/**
 * 解析周数字符串
 * @param {string} weekStr - 周数字符串（如 "011010..."）
 * @returns {Array<number>} 周数数组
 */
function parseWeeks(weekStr) {
  const weeks = [];
  for (let i = 0; i < weekStr.length; i++) {
    if (weekStr[i] === "1") weeks.push(i);
  }
  return weeks;
}

/**
 * 获取时间段配置
 * @returns {Array<Object>} 时间段数组
 */
function getTimeSlots() {
  return [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:35" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:20", endTime: "15:05" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:20", endTime: "17:05" },
    { number: 9, startTime: "18:00", endTime: "18:45" },
    { number: 10, startTime: "18:50", endTime: "19:35" },
  ];
}

/**
 * 从HTML中解析学期ID
 * @param {string} html - HTML字符串
 * @param {string} schoolYear - 学年，如 "2025-2026"
 * @param {string} name - 学期序号，如 "1"(上学期) , "2"(下学期) , "3"(小学期)
 * @returns {number|null} 学期ID，未找到返回null
 */
function parseSemesterId(html, schoolYear, name) {
  if (!html || typeof html !== "string") {
    console.warn("HTML内容为空或格式错误");
    return null;
  }

  // 对输入值进行转义，防止正则注入
  const escapedSchoolYear = schoolYear.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 匹配: {id:数字,schoolYear:"学年",name:"学期序号"}
  const pattern = new RegExp(
    `\\{id:(\\d+),schoolYear:"${escapedSchoolYear}",name:"${escapedName}"\\}`,
  );

  const match = html.match(pattern);
  if (match) {
    const id = parseInt(match[1], 10);
    console.log(`匹配成功: 学年=${schoolYear}, 学期=${name}, ID=${id}`);
    return id;
  }

  console.warn(`未找到匹配: 学年=${schoolYear}, 学期=${name}`);
  return null;
}

/**
 * 从HTML解析学生ids
 * @param {string} html - HTML字符串
 * @returns {string|null} 学生ID，未找到返回null
 */
function parseStudentIds(html) {
  if (!html || typeof html !== "string") {
    console.warn("HTML内容为空或格式错误");
    return null;
  }

  // 匹配: `bg.form.addInput(form,"ids","待捕获的数字");`
  const pattern = new RegExp(`bg\\.form\\.addInput\\(form,"ids","(\\d+)"\\);`);

  const match = html.match(pattern);
  if (match) {
    const ids = match[1];
    console.log(`匹配成功: ids=${ids}`);
    return ids;
  }

  console.warn(`未找到匹配的ids`);
  return null;
}

// ---------- 网络请求 ----------

/**
 * 通用的 fetch 请求封装
 * @param {string} url - 请求 URL
 * @param {Object} options - fetch 选项
 * @returns {Promise<string>} 去除空白符后的 HTML 字符串
 */
async function fetchWithCleanup(url, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    return html.replace(/\s/g, "");
  } catch (error) {
    console.error("请求失败:", url, error);
    throw error;
  }
}

/**
 * 获取学期课程安排HTML数据
 * @param {Object} options - 请求配置
 * @param {string} [options.tagId] - 标签ID (可选)
 * @param {string} [options.dataType='semesterCalendar'] - 数据类型
 * @param {string|number} [options.value] - 值 (可选)
 * @param {boolean} [options.empty=false] - 空标志 (可选)
 * @returns {Promise<string>} HTML字符串
 */
async function fetchSemesterCalendar(options = {}) {
  const {
    tagId = "semesterBar20826294511Semester",
    dataType = "semesterCalendar",
    value = "223",
    empty = false,
  } = options;

  const url = ENDPOINTS.DATA_QUERY;

  // 构建表单数据
  const formData = new URLSearchParams();
  formData.append("tagId", tagId);
  formData.append("dataType", dataType);
  formData.append("value", value);
  formData.append("empty", empty);

  return fetchWithCleanup(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/plain, */*; q=0.01",
      "Accept-Language": "zh-CN,en-US;q=0.9,en;q=0.8",
      Origin: BASE_URL,
      Referer: ENDPOINTS.COURSE_TABLE_FOR_STD,
    },
    body: formData.toString(),
    credentials: "include",
  });
}

/**
 * 获取学生课表页面HTML
 * @returns {Promise<string>} HTML字符串
 */
async function fetchCourseTableForStd() {
  return fetchWithCleanup(ENDPOINTS.COURSE_TABLE_FOR_STD, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,en-US;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate",
      Referer: ENDPOINTS.HOME_EXT,
      "Upgrade-Insecure-Requests": "1",
      Priority: "u=4",
    },
    credentials: "include",
  });
}

/**
 * 获取课程表数据
 * @param {string} semesterId - 学期ID
 * @param {string} ids - 学生ID
 * @returns {Promise<string>} HTML字符串
 */
async function fetchCourseTableData(semesterId, ids) {
  const formData = new URLSearchParams();
  formData.append("ignoreHead", "1");
  formData.append("setting.kind", "std");
  formData.append("startWeek", "");
  formData.append("project.id", "1");
  formData.append("semester.id", semesterId);
  formData.append("ids", ids);

  return fetchWithCleanup(ENDPOINTS.COURSE_TABLE, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Accept-Language": "zh-CN,en-US;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE_URL,
      Referer: ENDPOINTS.COURSE_TABLE,
    },
    body: formData.toString(),
    credentials: "include",
  });
}

// ---------- 用户交互 ----------

/**
 * 提示用户确认开始导入
 * @returns {Promise<boolean>} 用户是否确认
 */
async function promptUserToStart() {
  return await window.shiguangBridgePromise.showAlert(
    "重要提醒",
    "请确保您已登录服务大厅，并进入海大教务系统内的任意页面(不用点开课表)。\n值得注意的是，教务课表与海大在线的课表并非完全同步，若后期学校调课不规范，可能导致教务课表滞后。\n\n点击确定继续。",
    "确定",
  );
}

/**
 * 获取用户输入的学年
 * @returns {Promise<string|null>} 用户输入的年份，取消返回null
 */
async function getAcademicYear() {
  return await window.shiguangBridgePromise.showPrompt(
    "学年设置",
    "请输入本学年开始的年份\n（例如 2024，代表 2024-2025 学年）",
    "2024",
    "validateYearInput", // 传入验证函数名
  );
}

/**
 * 让用户选择学期
 * @returns {Promise<number|null>} 选择的学期索引(0-2)，取消返回null
 */
async function selectSemester() {
  const semesterOptions = ["上学期", "下学期", "小学期"];
  const index = await window.shiguangBridgePromise.showSingleSelection(
    "选择学期",
    JSON.stringify(semesterOptions),
    0,
  );
  if (index === null || index < 0 || index >= semesterOptions.length) {
    return null;
  }
  return index;
}

// ---------- 主流程 ----------

/**
 * 主流程函数：协调整个课程表导入流程
 */
async function run() {
  try {
    // 1. 公告
    const confirmed = await promptUserToStart();
    if (!confirmed) {
      window.shiguangBridge.showToast("用户取消了导入流程。");
      return;
    }

    // 2. 获取学年
    const yearInput = await getAcademicYear();
    if (yearInput === null) {
      window.shiguangBridge.showToast("导入已取消。");
      return;
    }
    const yearNum = parseInt(yearInput);
    if (isNaN(yearNum) || yearNum <= 2000 || yearNum > 2100) {
      await window.shiguangBridgePromise.showAlert(
        "错误",
        "学年输入无效，请输入2001-2100之间的数字。",
        "确定",
      );
      return;
    }
    const schoolYear = `${yearNum}-${yearNum + 1}`;

    // 3. 获取学期
    const semesterIndex = await selectSemester();
    if (semesterIndex === null) {
      window.shiguangBridge.showToast("导入已取消。");
      return;
    }
    const termCode =
      semesterIndex === 0 ? "1" : semesterIndex === 1 ? "2" : "3";
    const semesterHtml = await fetchSemesterCalendar();
    const semesterId = parseSemesterId(semesterHtml, schoolYear, termCode);

    // 4. 请求课表
    window.shiguangBridge.showToast("正在获取课表，请稍候...");
    let courseTableDataHtml = "";
    try {
      const idsHtml = await fetchCourseTableForStd();
      const ids = parseStudentIds(idsHtml);
      courseTableDataHtml = await fetchCourseTableData(semesterId, ids);
    } catch (fetchErr) {
      await window.shiguangBridgePromise.showAlert(
        "网络请求失败",
        `请求教务系统失败：${fetchErr.message}\n\n请检查网络连接和登录状态。`,
        "确定",
      );
      return;
    }

    if (!courseTableDataHtml.length) {
      await window.shiguangBridgePromise.showAlert(
        "提示",
        "未获取到任何课程数据。请确认已登录教务系统并选择正确的学年学期。",
        "确定",
      );
      return;
    }

    // 5. 解析并转换
    const targetCourses = parseCourses(courseTableDataHtml);

    // 6. 保存课程
    try {
      await window.shiguangBridgePromise.saveImportedCourses(
        JSON.stringify(targetCourses),
      );
      window.shiguangBridge.showToast(
        `课程数据已导入（共 ${targetCourses.length} 条）`,
      );
    } catch (saveErr) {
      await window.shiguangBridgePromise.showAlert(
        "保存课程失败",
        saveErr.message,
        "确定",
      );
      return;
    }

    // 7. 保存时间段
    const timeSlots = getTimeSlots();
    try {
      await window.shiguangBridgePromise.savePresetTimeSlots(
        JSON.stringify(timeSlots),
      );
      window.shiguangBridge.showToast("时间段数据已导入");
    } catch (slotErr) {
      // 时间段保存失败不终止流程，只提示
      window.shiguangBridge.showToast(`时间段保存失败：${slotErr.message}`);
    }

    // 8. 完成通知
    window.shiguangBridge.showToast("导入完成！");
    window.shiguangBridge.notifyTaskCompletion();
  } catch (err) {
    // 捕获所有未预料的错误
    console.error("run error:", err);
    await window.shiguangBridgePromise.showAlert(
      "导入失败",
      `未知错误：${err.message || err}\n\n请联系开发者。`,
      "确定",
    );
    // 仍然通知完成，但可能不会生成有效文件
    window.shiguangBridge.notifyTaskCompletion();
  }
}

// 启动
run();
