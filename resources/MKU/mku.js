// 闽南科技学院(mku.edu.cn) 轻屿课表适配脚本
// 教务平台：强智教务系统（新版 layui UI）
// 数据来源：个人课表 /jsxsd/xskb/xskb_list.do（默认渲染当前学期，可用 xnxq01id 切换学期）
// 解析逻辑参考本仓库 HYNU / ZHKU 两个强智适配的实现，按 MKU 新版 DOM 重写
// 非该校在校开发者适配，出现问题请提交 issue 或 PR

// ===== 基础常量 =====

const MKU_BASE_URL = "https://jwgl.mku.edu.cn";
const MKU_TIMETABLE_URL = MKU_BASE_URL + "/jsxsd/xskb/xskb_list.do";
const MKU_WEEK_AJAX_URL = MKU_BASE_URL + "/jsxsd/xskb/jxzlzc_xnxq_ajax";
const MKU_HOME_URL = MKU_BASE_URL + "/jsxsd/framework/xsMainV.htmlx";

// 默认总周数；实际值优先取自教务周次接口 jxzlzc_xnxq_ajax
const MKU_DEFAULT_TOTAL_WEEKS = 20;

// 每小节课 45 分钟、课间 10 分钟（与课表页大节时间 08:00~09:40 等标注一致）
const MKU_SECTION_MINUTES = 45;
const MKU_BREAK_MINUTES = 10;

// 兜底作息（按 2026-2027-1 学期课表页标注的大节时间推导）
const MKU_FALLBACK_TIME_SLOTS = [
  { number: 1, startTime: "08:00", endTime: "08:45" },
  { number: 2, startTime: "08:55", endTime: "09:40" },
  { number: 3, startTime: "10:00", endTime: "10:45" },
  { number: 4, startTime: "10:55", endTime: "11:40" },
  { number: 5, startTime: "14:00", endTime: "14:45" },
  { number: 6, startTime: "14:55", endTime: "15:40" },
  { number: 7, startTime: "15:50", endTime: "16:35" },
  { number: 8, startTime: "16:45", endTime: "17:30" },
  { number: 9, startTime: "18:30", endTime: "19:15" },
  { number: 10, startTime: "19:25", endTime: "20:10" },
  { number: 11, startTime: "20:20", endTime: "21:05" },
  { number: 12, startTime: "21:15", endTime: "22:00" }
];

// ===== 通用工具 =====

// HH:mm 转当天分钟数
function mkuTimeToMinutes(hhmm) {
  const parts = hhmm.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

// 当天分钟数转 HH:mm
function mkuMinutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Date 转 YYYY-MM-DD
function mkuFormatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// ===== 周次与节次解析 =====

// 将周次片段（"1,3,5" / "1-16" / "1-8,10-16"）展开为去重排序的数字数组
function mkuExpandWeeks(weekPart) {
  const weeks = [];
  (weekPart.match(/\d+(?:\s*[-~]\s*\d+)?/g) || []).forEach((seg) => {
    const m = seg.match(/(\d+)\s*(?:[-~]\s*(\d+))?/);
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    for (let w = start; w <= end; w++) weeks.push(w);
  });
  return [...new Set(weeks)].sort((a, b) => a - b);
}

// 解析"时间"字段，如 "1,3,5,7,9,11,13,15周[1-2节]"
function mkuParseTimeText(timeText) {
  if (!timeText) return null;
  const weekMatch = timeText.match(/^([^周]+)周/);
  const secMatch = timeText.match(/\[\s*(\d+)\s*(?:[-~]\s*(\d+))?\s*节\s*\]/);
  if (!weekMatch && !secMatch) return null;

  let weeks = weekMatch ? mkuExpandWeeks(weekMatch[1]) : null;
  if (weeks) {
    // 兼容"单周/双周"标注
    if (/单\s*周/.test(timeText)) weeks = weeks.filter((w) => w % 2 === 1);
    if (/双\s*周/.test(timeText)) weeks = weeks.filter((w) => w % 2 === 0);
  }

  return {
    weeks,
    startSection: secMatch ? Number(secMatch[1]) : null,
    endSection: secMatch ? (secMatch[2] ? Number(secMatch[2]) : Number(secMatch[1])) : null
  };
}

// ===== 课表解析 =====

// 将表格展开为 grid[row][col]，正确处理 rowspan / colspan
function mkuBuildGrid(table) {
  const grid = [];
  Array.from(table.rows).forEach((tr, r) => {
    if (!grid[r]) grid[r] = [];
    let col = 0;
    Array.from(tr.cells).forEach((td) => {
      while (grid[r][col]) col++;
      const rowSpan = td.rowSpan || 1;
      const colSpan = td.colSpan || 1;
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (!grid[r + dr]) grid[r + dr] = [];
          grid[r + dr][col + dc] = td;
        }
      }
      col += colSpan;
    });
  });
  return grid;
}

// 解析行标签（第 0 列）：大节范围与时间，如 "1-2" + "08:00~09:40"
function mkuParseRowInfos(table) {
  const rowInfos = new Map();
  Array.from(table.rows).forEach((tr, r) => {
    const labelCell = tr.cells[0];
    if (!labelCell) return;
    const titleText = labelCell.querySelector(".index-title")
      ? labelCell.querySelector(".index-title").textContent.trim()
      : "";
    const range = titleText.match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
    if (!range) return;
    const timeMatch = labelCell.textContent.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
    rowInfos.set(r, {
      startSection: Number(range[1]),
      endSection: range[2] ? Number(range[2]) : Number(range[1]),
      blockStart: timeMatch ? mkuTimeToMinutes(timeMatch[1]) : null,
      blockEnd: timeMatch ? mkuTimeToMinutes(timeMatch[2]) : null
    });
  });
  return rowInfos;
}

// 从"老师:xx;时间:..周[..节];地点:yy"详情串中按标签取字段
function mkuParseInfoField(text, label) {
  const m = text.match(new RegExp(label + "[:：]\\s*([^;；]*)"));
  return m ? m[1].trim() : "";
}

// 解析课表文档中的全部课程（同一单元格可能含多条课程，逐 li 解析）
function mkuParseCourses(doc) {
  const sampleTd = doc.querySelector('td[name="kbDataTd"]');
  if (!sampleTd) return { courses: [], rowInfos: new Map() };
  const table = sampleTd.closest("table");
  const grid = mkuBuildGrid(table);
  const rowInfos = mkuParseRowInfos(table);

  const courses = [];
  const seenTds = new Set();

  for (const [row, rowInfo] of rowInfos) {
    for (let day = 1; day <= 7; day++) {
      const td = grid[row] && grid[row][day];
      // rowspan 跨行的大格只在首行解析一次
      if (!td || seenTds.has(td)) continue;
      seenTds.add(td);

      Array.from(td.querySelectorAll("li")).forEach((li) => {
        const nameEl = li.querySelector(".qz-hasCourse-title");
        const infoEl = li.querySelector(".qz-hasCourse-abbrinfo");
        if (!nameEl || !infoEl) return;
        const name = nameEl.textContent.trim();
        const infoText = infoEl.textContent.trim();
        if (!name || !infoText) return;

        const teacher = mkuParseInfoField(infoText, "老师") || "未知教师";
        const position = mkuParseInfoField(infoText, "地点") || "未知地点";
        const timeInfo = mkuParseTimeText(mkuParseInfoField(infoText, "时间"));

        // 节次以"时间"字段为准，缺失时回退到大节行标签
        const startSection = timeInfo && timeInfo.startSection
          ? timeInfo.startSection
          : rowInfo.startSection;
        const endSection = timeInfo && timeInfo.endSection
          ? timeInfo.endSection
          : rowInfo.endSection;
        const weeks = timeInfo && timeInfo.weeks && timeInfo.weeks.length
          ? timeInfo.weeks
          : null;
        // 无周次信息则跳过，避免导入错误数据
        if (!weeks) return;

        courses.push({
          name,
          teacher,
          position,
          day,
          startSection,
          endSection,
          weeks
        });
      });
    }
  }

  // 完全重复的条目去重（同名/同师/同地/同天/同节次/同周次）
  const deduped = [];
  const seenKeys = new Set();
  for (const course of courses) {
    const key = [
      course.name, course.teacher, course.position, course.day,
      course.startSection, course.endSection, course.weeks.join(",")
    ].join("|");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(course);
  }

  return { courses: deduped, rowInfos };
}

// 由课表页大节时间推导小节作息；推导失败时回退兜底配置
function mkuBuildTimeSlots(rowInfos) {
  const slots = [];
  const rows = [...rowInfos.values()].sort((a, b) => a.startSection - b.startSection);
  for (const info of rows) {
    if (info.blockStart == null || info.blockEnd == null) return MKU_FALLBACK_TIME_SLOTS;
    const count = info.endSection - info.startSection + 1;
    const span = info.blockEnd - info.blockStart;
    if (span !== MKU_SECTION_MINUTES * count + MKU_BREAK_MINUTES * (count - 1)) {
      return MKU_FALLBACK_TIME_SLOTS;
    }
    for (let i = 0; i < count; i++) {
      const start = info.blockStart + i * (MKU_SECTION_MINUTES + MKU_BREAK_MINUTES);
      slots.push({
        number: info.startSection + i,
        startTime: mkuMinutesToTime(start),
        endTime: mkuMinutesToTime(start + MKU_SECTION_MINUTES)
      });
    }
  }
  return slots.length ? slots : MKU_FALLBACK_TIME_SLOTS;
}

// ===== 教务数据获取 =====

// 拉取个人课表页面（不传学期则渲染教务当前学期）
async function mkuFetchTimetableDoc(semesterId) {
  let url = MKU_TIMETABLE_URL + "?viweType=0&zc=&cj0701id=";
  if (semesterId) url += "&xnxq01id=" + encodeURIComponent(semesterId);
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) throw new Error("获取课表页面失败：HTTP " + resp.status);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.querySelector("#xnxq01id") && !doc.querySelector('td[name="kbDataTd"]')) {
    throw new Error("未获取到课表数据，请先在浏览器登录教务系统");
  }
  return doc;
}

// 学期下拉选项（value 与显示文本一致，如 2026-2027-1）
function mkuGetSemesterOptions(doc) {
  const select = doc.querySelector("#xnxq01id");
  if (!select) return [];
  return Array.from(select.options)
    .filter((o) => o.value)
    .map((o) => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
}

// 学期总周数（接口返回如 [{"qszc":1,"jszc":20}]）
async function mkuFetchTotalWeeks(semesterId) {
  try {
    const resp = await fetch(MKU_WEEK_AJAX_URL + "?xnxq01id=" + encodeURIComponent(semesterId), {
      credentials: "include"
    });
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0 && Number(data[0].jszc) > 0) {
      return Number(data[0].jszc);
    }
  } catch (error) {
    console.warn("获取学期总周数失败，使用默认值：", error);
  }
  return MKU_DEFAULT_TOTAL_WEEKS;
}

// 学期第一周周一日期：仅当所选学期是教务"当前学期"时可信
// 首页 #headerShowTime 形如 "2026-2027-1 第1周"，结合本地今天日期反推开学日
async function mkuFetchSemesterStartDate(semesterId) {
  try {
    const resp = await fetch(MKU_HOME_URL, { credentials: "include" });
    if (!resp.ok) return null;
    const html = await resp.text();
    const m = html.match(/id="headerShowTime"[^>]*>\s*([^<]+?)\s*</);
    if (!m) return null;
    const currentSemester = m[1].split(/\s+/)[0];
    const weekMatch = m[1].match(/第\s*(\d+)\s*周/);
    if (currentSemester !== semesterId || !weekMatch) return null;
    const currentWeek = Number(weekMatch[1]);
    if (!(currentWeek >= 1)) return null;

    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7; // 周一记 0
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - mondayOffset - (currentWeek - 1) * 7
    );
    return mkuFormatDate(start);
  } catch (error) {
    console.warn("获取学期开始日期失败：", error);
    return null;
  }
}

// ===== 主流程 =====

async function mkuRunImportFlow() {
  const bridge = window.shiguangBridge;
  const bridgePromise = window.shiguangBridgePromise;

  const confirmed = await bridgePromise.showAlert(
    "导入说明",
    "将读取闽南科技学院教务系统\"个人课表\"数据并导入轻屿课表。\n请确保已在当前浏览器登录教务系统（jwgl.mku.edu.cn）。\n是否继续？",
    "确认已登录"
  );
  if (!confirmed) {
    bridge.showToast("导入已取消");
    return;
  }

  bridge.showToast("正在读取课表页面...");
  const firstDoc = await mkuFetchTimetableDoc();

  // 让用户选择学期（默认为教务当前学期）
  const options = mkuGetSemesterOptions(firstDoc);
  const defaultOption = options.find((o) => o.selected) || null;
  let semesterId = defaultOption ? defaultOption.value : null;
  if (options.length > 0) {
    const defaultIndex = Math.max(0, options.findIndex((o) => o.selected));
    const labels = options.map((o) => o.text + (o.selected ? "（当前学期）" : ""));
    const index = await bridgePromise.showSingleSelection(
      "选择要导入的学期",
      JSON.stringify(labels),
      defaultIndex
    );
    if (index == null || index < 0 || index >= options.length) {
      bridge.showToast("导入已取消");
      return;
    }
    semesterId = options[index].value;
  }

  // 所选学期与默认渲染学期一致时直接复用首次页面
  const doc = defaultOption && semesterId === defaultOption.value
    ? firstDoc
    : await mkuFetchTimetableDoc(semesterId);

  const { courses, rowInfos } = mkuParseCourses(doc);
  if (courses.length === 0) {
    bridge.showToast("未解析到课程，请确认所选学期有课且已登录");
    return;
  }

  bridge.showToast("正在获取学期配置...");
  const totalWeeks = await mkuFetchTotalWeeks(semesterId);
  const startDate = await mkuFetchSemesterStartDate(semesterId);

  const timeSlots = mkuBuildTimeSlots(rowInfos);
  const config = {
    defaultClassDuration: MKU_SECTION_MINUTES,
    defaultBreakDuration: MKU_BREAK_MINUTES,
    semesterTotalWeeks: totalWeeks,
    firstDayOfWeek: 1
  };
  // 仅当前学期能可靠推算开学日期，历史学期留给 App 端处理
  if (startDate) config.semesterStartDate = startDate;

  await bridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
  await bridgePromise.saveCourseConfig(JSON.stringify(config));
  await bridgePromise.saveImportedCourses(JSON.stringify(courses));

  bridge.showToast("导入成功：共 " + courses.length + " 条课程");
  bridge.notifyTaskCompletion();
}

// 启动导入流程
(async () => {
  try {
    await mkuRunImportFlow();
  } catch (error) {
    console.error("课表导入失败：", error);
    try {
      window.shiguangBridge.showToast(
        "导入失败：" + (error && error.message ? error.message : error)
      );
    } catch (e) {
      /* 桥接不可用时仅保留控制台日志 */
    }
  }
})();
