// 华北电力大学（保定）强智教务系统 拾光课程表适配脚本
// 适配开发：星河欲转
// 出现问题请提交issues或联系开发者

const BASE_URL = "https://jwxt.ncepu.edu.cn";
const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;
const URL_COURSE = `${BASE_URL}/jsxsd/xskb/xskb_list.do`;

// 华北电力大学保定校区使用5个大节，每大节2小节
const MAJOR_PERIODS = [
  { major: 1, sections: [1, 2], time: "08:00-09:40" },
  { major: 2, sections: [3, 4], time: "10:00-11:40" },
  { major: 3, sections: [5, 6], time: "14:30-16:10" },
  { major: 4, sections: [7, 8], time: "16:30-18:10" },
  { major: 5, sections: [9, 10], time: "19:30-21:10" }
];

// 工具函数

/**
 * 解析周次字符串，支持 "1-12(周)" "7-18(单)" "2-9(双)" 格式
 */
function parseWeeks(weekStr) {
  const weeks = [];
  if (!weekStr) return weeks;

  const pureWeekData = weekStr.split('(')[0].trim();
  const modifier = weekStr.match(/\((单|双|周)\)/)?.[1];

  pureWeekData.split(/[,，]/).forEach(seg => {
    seg = seg.trim();
    if (seg.includes('-')) {
      const [s, e] = seg.split('-').map(Number);
      if (!isNaN(s) && !isNaN(e)) {
        for (let i = s; i <= e; i++) {
          if (modifier === '单' && i % 2 === 1) weeks.push(i);
          else if (modifier === '双' && i % 2 === 0) weeks.push(i);
          else if (!modifier || modifier === '周') weeks.push(i);
        }
      }
    } else {
      const w = parseInt(seg);
      if (!isNaN(w)) weeks.push(w);
    }
  });

  return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
  if (!Array.isArray(courses) || courses.length <= 1) return courses;

  const list = courses.map(c => ({
    ...c,
    name: c.name || '',
    teacher: c.teacher || '',
    position: c.position || '',
    weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
  }));

  // 阶段 1：合并连续节次与完全重复记录
  list.sort((a, b) => {
    return a.name.localeCompare(b.name) ||
      a.teacher.localeCompare(b.teacher) ||
      a.position.localeCompare(b.position) ||
      (a.day || 0) - (b.day || 0) ||
      a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
      (a.startSection || 0) - (b.startSection || 0);
  });

  const step1Merged = [];
  let current = list[0];

  for (let i = 1; i < list.length; i++) {
    const next = list[i];
    const isSameCourseAndWeeks =
      current.name === next.name &&
      current.teacher === next.teacher &&
      current.position === next.position &&
      current.day === next.day &&
      current.weeks.join(',') === next.weeks.join(',');

    const isContinuous = current.endSection + 1 === next.startSection;
    const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

    if (isSameCourseAndWeeks && isContinuous) {
      current.endSection = next.endSection;
    } else if (isSameCourseAndWeeks && isDuplicate) {
      continue;
    } else {
      step1Merged.push(current);
      current = next;
    }
  }
  step1Merged.push(current);

  // 阶段 2：合并同节次的周次
  step1Merged.sort((a, b) => {
    return a.name.localeCompare(b.name) ||
      a.teacher.localeCompare(b.teacher) ||
      a.position.localeCompare(b.position) ||
      (a.day || 0) - (b.day || 0) ||
      (a.startSection || 0) - (b.startSection || 0) ||
      (a.endSection || 0) - (b.endSection || 0);
  });

  const step2Merged = [];
  let cur = step1Merged[0];

  for (let i = 1; i < step1Merged.length; i++) {
    const nxt = step1Merged[i];
    const isSameCourseAndSection =
      cur.name === nxt.name &&
      cur.teacher === nxt.teacher &&
      cur.position === nxt.position &&
      cur.day === nxt.day &&
      cur.startSection === nxt.startSection &&
      cur.endSection === nxt.endSection;

    if (isSameCourseAndSection) {
      cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
    } else {
      step2Merged.push(cur);
      cur = nxt;
    }
  }
  step2Merged.push(cur);

  return step2Merged;
}

/**
 * 从大节号获取对应的小节范围
 */
function getSectionsFromMajorPeriod(majorPeriodLabel) {
  const match = majorPeriodLabel.match(/第([一二三四五])大节/);
  if (!match) return null;

  const chineseNums = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
  const majorNum = chineseNums[match[1]];
  const period = MAJOR_PERIODS.find(p => p.major === majorNum);

  return period ? period.sections : null;
}

// 核心解析逻辑

/**
 * 解析课表DOM为课程模型
 */
function parseTimetableToModel(doc) {
  const timetable = doc.getElementById('kbtable');
  if (!timetable) return [];

  let rawCourses = [];
  const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

  rows.forEach((row, rowIndex) => {
    const rowHeader = row.querySelector('th');
    const majorPeriodLabel = rowHeader ? rowHeader.textContent.trim() : '';
    const sections = getSectionsFromMajorPeriod(majorPeriodLabel);

    if (!sections) return;

    const startSection = sections[0];
    const endSection = sections[sections.length - 1];

    const cells = row.querySelectorAll('td');
    cells.forEach((cell, dayIndex) => {
      const day = dayIndex + 1;
      const detailDivs = cell.querySelectorAll('div.kbcontent');

      detailDivs.forEach(div => {
        const rawHtml = div.innerHTML.trim();
        if (!rawHtml || rawHtml === "&nbsp;" || div.innerText.trim().length < 2) return;

        const blocks = rawHtml.split(/---------------------|---------------------/);

        blocks.forEach(block => {
          if (!block.trim()) return;

          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = block;

          const lines = block.split(/<br\s*\/?>/i);
          let courseName = "";
          let foundFirstValidLine = false;

          // 华电课表格式：第一行是课程编号（如 21010602-22），第二行是课程名称
          for (let i = 0; i < lines.length; i++) {
            const cleanLine = lines[i].replace(/<[^>]*>/g, '').trim();
            if (!cleanLine || cleanLine.includes('课堂派') || cleanLine.includes('分组')) continue;

            // 第一个有效行：判断是否为课程编号格式（数字-数字）
            if (!foundFirstValidLine) {
              foundFirstValidLine = true;
              if (/^\d+-\d+$/.test(cleanLine)) {
                // 这是课程编号，跳过，读取下一个有效行作为课程名称
                continue;
              }
            }

            // 找到课程名称
            courseName = cleanLine;
            break;
          }

          const teacherFont = tempDiv.querySelector('font[title="老师"], font[title="教师"]');
          const teacher = teacherFont ? teacherFont.innerText.trim() : "未知教师";

          const roomFont = tempDiv.querySelector('font[title="教室"]');
          const position = roomFont ? roomFont.innerText.trim() : "未知地点";

          const weekFont = tempDiv.querySelector('font[title="周次(节次)"]');
          const weekStr = weekFont ? weekFont.innerText.trim() : "";

          if (courseName && weekStr) {
            rawCourses.push({
              "name": courseName,
              "teacher": teacher,
              "weeks": parseWeeks(weekStr),
              "position": position,
              "day": day,
              "startSection": startSection,
              "endSection": endSection
            });
          }
        });
      });
    });
  });

  return mergeAndDistinctCourses(rawCourses);
}

// 网络请求封装

/**
 * GET 教学周历页面（用于获取学期列表）
 */
async function requestSemesterPage() {
  const response = await fetch(URL_SEMESTER, {
    method: "GET",
    credentials: "include"
  });
  return await response.text();
}

/**
 * POST 教学周历页面（用于获取指定学期的开学日期与最大周次）
 * @param {string} semesterId 形如 "2025-2026-2"
 */
async function requestSemesterDetailPage(semesterId) {
  const response = await fetch(URL_SEMESTER, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `xnxq01id=${semesterId}`,
    credentials: "include"
  });
  return await response.text();
}

/**
 * POST 课表页面（用于获取课程数据）
 * @param {string} semesterId 形如 "2025-2026-2"
 */
async function requestCoursePage(semesterId) {
  const response = await fetch(URL_COURSE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `jx0404id=&cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
    credentials: "include"
  });
  return await response.text();
}

// 业务逻辑

/**
 * 获取学期列表，以 selected 为原点上下各取 3 个
 * @returns {Promise<{list: Array<{value:string,label:string}>, defaultIndex:number}>}
 */
async function fetchSemesterList() {
  const html = await requestSemesterPage();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const select = doc.getElementById("xnxq01id");
  if (!select) return { list: [], defaultIndex: -1 };

  const allOptions = Array.from(select.querySelectorAll("option")).map(opt => ({
    value: opt.value,
    label: opt.textContent.trim(),
    selected: opt.hasAttribute("selected")
  }));

  let selectedIndex = allOptions.findIndex(o => o.selected);
  if (selectedIndex === -1) selectedIndex = 0;

  const start = Math.max(0, selectedIndex - 3);
  const end = Math.min(allOptions.length, selectedIndex + 4);

  const list = allOptions.slice(start, end);
  const defaultIndex = selectedIndex - start;

  return { list, defaultIndex };
}

/**
 * 获取指定学期的开学日期 + 最大周次
 * @param {string} semesterId 形如 "2025-2026-2"
 * @returns {Promise<{startDate: string|null, totalWeeks: number|null}>}
 */
async function fetchSemesterInfo(semesterId) {
  const html = await requestSemesterDetailPage(semesterId);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const timetable = doc.getElementById("kbtable");
  if (!timetable) return { startDate: null, totalWeeks: null };

  const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
  if (rows.length === 0) return { startDate: null, totalWeeks: null };

  const firstDateCell = rows[0].querySelector("td[title]");
  const title = firstDateCell?.getAttribute("title") || "";
  const match = title.match(/^(\d{4})年(\d{1,2})月(\d{1,2})$/);
  const startDate = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;

  let totalWeeks = null;
  for (const row of rows) {
    const firstTd = row.querySelector("td");
    if (!firstTd) continue;
    const n = parseInt(firstTd.textContent.trim(), 10);
    if (!isNaN(n) && n > 0) {
      if (totalWeeks === null || n > totalWeeks) totalWeeks = n;
    }
  }

  return { startDate, totalWeeks };
}

/**
 * 获取并解析指定学期的课程
 * @param {string} semesterId 形如 "2025-2026-2"
 * @returns {Promise<Array<Object>>}
 */
async function fetchCourses(semesterId) {
  const html = await requestCoursePage(semesterId);
  return parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));
}

// 配置保存

async function saveAppConfig(semesterStartDate, totalWeeks) {
  const config = {
    "semesterTotalWeeks": totalWeeks || 20,
    "defaultClassDuration": 45,
    "defaultBreakDuration": 5,
    "firstDayOfWeek": 1
  };
  if (semesterStartDate) {
    config.semesterStartDate = semesterStartDate;
  }
  return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 统一作息（华北电力大学保定校区）
 */
async function saveAppTimeSlots() {
  const unifiedSlots = [
    { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
    { "number": 2,  "startTime": "08:50", "endTime": "09:35" },
    { "number": 3,  "startTime": "10:00", "endTime": "10:45" },
    { "number": 4,  "startTime": "10:50", "endTime": "11:35" },
    { "number": 5,  "startTime": "14:30", "endTime": "15:15" },
    { "number": 6,  "startTime": "15:20", "endTime": "16:05" },
    { "number": 7,  "startTime": "16:30", "endTime": "17:15" },
    { "number": 8,  "startTime": "17:20", "endTime": "18:05" },
    { "number": 9,  "startTime": "19:30", "endTime": "20:15" },
    { "number": 10, "startTime": "20:20", "endTime": "21:05" }
  ];

  return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(unifiedSlots));
}

// 流程编排

async function runImportFlow() {
  try {
    // 1. 用户确认
    const confirmed = await window.shiguangBridgePromise.showAlert(
      "提示", "请确保已成功登录教务系统。是否开始导入？", "开始"
    );
    if (!confirmed) return;

    // 2. 获取学期列表
    window.shiguangBridge.showToast("正在获取学期列表...");
    const { list: semesters, defaultIndex } = await fetchSemesterList();
    if (!semesters || semesters.length === 0) {
      window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
      return;
    }

    // 3. 用户选择学期
    const labels = semesters.map(s => s.label);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
      "选择学期", JSON.stringify(labels), defaultIndex
    );
    if (selectedIndex === null) {
      window.shiguangBridge.showToast("已取消导入");
      return;
    }
    const semesterId = semesters[selectedIndex].value;

    // 4. 获取开学日期 + 最大周次
    window.shiguangBridge.showToast("正在获取学期信息...");
    let { startDate: semesterStartDate, totalWeeks } = await fetchSemesterInfo(semesterId);

    // 5. 如果未获取到开学日期，让用户手动输入
    if (!semesterStartDate) {
      window.shiguangBridge.showToast("未能从系统获取开学日期，需要手动输入");
      const inputDate = await window.shiguangBridgePromise.showPrompt(
        "输入开学日期",
        "请输入本学期第一周星期一的日期\n格式：YYYY-MM-DD\n例如：2024-09-02",
        ""
      );
      if (inputDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(inputDate)) {
        window.shiguangBridge.showToast("开学日期格式不正确或已取消");
        return;
      }
      semesterStartDate = inputDate;
    }

    // 6. 如果未获取到总周数，让用户手动输入
    if (!totalWeeks) {
      const inputWeeks = await window.shiguangBridgePromise.showPrompt(
        "输入总周数",
        "请输入本学期总周数",
        "20"
      );
      if (inputWeeks !== null) {
        const weeks = parseInt(inputWeeks);
        if (!isNaN(weeks) && weeks > 0) {
          totalWeeks = weeks;
        }
      }
      if (!totalWeeks) totalWeeks = 20;
    }

    // 7. 获取课程
    window.shiguangBridge.showToast("正在请求课程数据...");
    const finalCourses = await fetchCourses(semesterId);
    if (finalCourses.length === 0) {
      window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
      return;
    }

    // 8. 保存配置（含开学日期 + 最大周次）/ 作息 / 课程
    await saveAppTimeSlots();
    await saveAppConfig(semesterStartDate, totalWeeks);
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

    // 9. 完成
    window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
    window.shiguangBridge.notifyTaskCompletion();
  } catch (error) {
    window.shiguangBridge.showToast("异常: " + error.message);
  }
}

// 启动导入流程
runImportFlow();
