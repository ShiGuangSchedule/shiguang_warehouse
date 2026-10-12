// =============================================================================
// 中国地质大学（北京） CUGB · 拾光课程表 教务适配脚本
// -----------------------------------------------------------------------------
// 系统类型：新版教务管理信息系统（URL 路径 /academic/，2020 后）
//   门户入口：https://jwglxt.cugb.edu.cn
//   统一身份认证（CAS）：https://cas.cugb.edu.cn/login?service=...
//   登录入口：https://jwglxt.cugb.edu.cn/academic/login/cugb/loginIds6Valid.jsp
//
// 取数策略（依次尝试，取第一个成功的）：
//   A. 接口取数（首选）
//      1) GET  /academic/student/currcourse/currcourse.jsdo
//         解析 <eduaffair:CTRT studentid=.. year=.. term=..> 拿到当前学年/学期/学号
//      2) GET  /academic/manager/coursearrange/showTimetable.do?id=&yearid=&termid=&timetableType=STUDENT&sectionType=BASE
//         解析 id=timetable 的周课表网格
//      3) POST /academic/manager/coursearrange/studentWeeklyTimetable.do（whichWeek=1）
//         解析开学日期与学期总周数
//   B. 页面取数（兜底）
//      直接解析当前 WebView 页面（含 iframe）中 id=timetable 的网格课表
//
// 作息时间：优先从课表表头（第X节 + 起止时间）动态读取；
//           读不到时回退到内置作息（14 节，来源见下方常量注释）。
//           CUGB 课表网格为 第1–14 节（中午、傍晚分段），
//           学校 2024–2025 校历公布的 11 节作息已过时，故不采用。
//
// 说明：本脚本基于公开可访问的登录入口与 /academic/ 标准接口实现，
//       接口参数沿用同款 /academic/ 系统已验证适配（如 IMUT）的调用形态，
//       使用时请确保已登录教务系统。若学校做过改版，可按照脚本末尾「诊断输出」反馈。
// =============================================================================

/** 允许的教务域名后缀（登录后会落在 jwglxt.cugb.edu.cn） */
const CUGB_HOST_SUFFIX = "cugb.edu.cn";

/** 默认学期总周数 */
const DEFAULT_TOTAL_WEEKS = 20;

/**
 * CUGB 现行作息（14 节）。来源：CUGB 在校生常用的「泥地课表」小程序内置作息，
 * 与教务系统课表网格「第 1–14 节 + 中午/傍晚分段」完全一致；
 * 学校公布的《2024—2025 校历》只有 11 节、已过时，故不采用。
 *
 * 第 3/4/5 节按楼栋错峰约 10 分钟：
 *   综合楼 / 教五楼 → 第 3 节 10:00 起（CUGB_SLOTS_ZONGHE）
 *   其他教室        → 第 3 节 09:50 起（CUGB_SLOTS_OTHER）
 */

/** 作息 · 综合楼 / 教五楼（第 3/4/5 节 10:00 / 10:50 / 11:40 起） */
const CUGB_SLOTS_ZONGHE = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "10:00", endTime: "10:45" },
  { number: 4,  startTime: "10:50", endTime: "11:35" },
  { number: 5,  startTime: "11:40", endTime: "12:25" },
  { number: 6,  startTime: "13:30", endTime: "14:15" },
  { number: 7,  startTime: "14:20", endTime: "15:05" },
  { number: 8,  startTime: "15:20", endTime: "16:05" },
  { number: 9,  startTime: "16:10", endTime: "16:55" },
  { number: 10, startTime: "17:10", endTime: "17:55" },
  { number: 11, startTime: "18:00", endTime: "18:45" },
  { number: 12, startTime: "19:00", endTime: "19:45" },
  { number: 13, startTime: "19:50", endTime: "20:35" },
  { number: 14, startTime: "20:40", endTime: "21:25" }
];

/** 作息 · 其他教室（第 3/4/5 节 09:50 / 10:40 / 11:30 起） */
const CUGB_SLOTS_OTHER = [
  { number: 1,  startTime: "08:00", endTime: "08:45" },
  { number: 2,  startTime: "08:50", endTime: "09:35" },
  { number: 3,  startTime: "09:50", endTime: "10:35" },
  { number: 4,  startTime: "10:40", endTime: "11:25" },
  { number: 5,  startTime: "11:30", endTime: "12:15" },
  { number: 6,  startTime: "13:30", endTime: "14:15" },
  { number: 7,  startTime: "14:20", endTime: "15:05" },
  { number: 8,  startTime: "15:20", endTime: "16:05" },
  { number: 9,  startTime: "16:10", endTime: "16:55" },
  { number: 10, startTime: "17:10", endTime: "17:55" },
  { number: 11, startTime: "18:00", endTime: "18:45" },
  { number: 12, startTime: "19:00", endTime: "19:45" },
  { number: 13, startTime: "19:50", endTime: "20:35" },
  { number: 14, startTime: "20:40", endTime: "21:25" }
];

const WEEKDAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function cugbLog() {
  try { console.log.apply(console, ["[CUGB]"].concat([].slice.call(arguments))); } catch (e) {}
}

function cugbPadTime(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  return ("0" + m[1]).slice(-2) + ":" + m[2];
}

/** HH:mm 加上若干分钟 */
function cugbAddMinutes(hhmm, mins) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let total = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + mins;
  total = ((total % 1440) + 1440) % 1440;
  return ("0" + Math.floor(total / 60)).slice(-2) + ":" + ("0" + (total % 60)).slice(-2);
}

/** 日期字符串加减天数（YYYY-MM-DD） */
function cugbAddDays(dateStr, delta) {
  const m = String(dateStr || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 取某日期所在周的周一（不依赖页面文字，避免编码问题） */
function cugbMondayOfDate(dateStr) {
  const m = String(dateStr || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  const dow = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))).getUTCDay();
  const offset = (dow === 0) ? 6 : dow - 1; // 距周一天数
  return cugbAddDays(dateStr, -offset);
}

/** 取课程涉及到的最大节次 */
function maxSectionOf(courses) {
  let max = 0;
  (courses || []).forEach(function (c) {
    if (c.endSection > max) max = c.endSection;
    if (c.startSection > max) max = c.startSection;
  });
  return max;
}

/**
 * 保证作息覆盖所有课程节次。
 * 注意：CUGB 教务系统课表有 15 个节次行，而学校公布作息仅有 11 节，
 *       当出现 >11 节的课程（如晚间/在线课）时，按"上一节结束 +10 分钟课间、
 *       每节 45 分钟"续接，属尽力而为，若有官方作息请以官方为准。
 */
function ensureSlotsCover(slots, maxSection) {
  const out = (slots || []).slice();
  if (!out.length) return out;
  let last = out[out.length - 1];
  while (out.length < maxSection) {
    const start = cugbAddMinutes(last.endTime, 10);
    const end = cugbAddMinutes(start, 45);
    const s = { number: out.length + 1, startTime: start, endTime: end };
    out.push(s);
    last = s;
  }
  return out;
}

/** 解析周次字符串："1-16周" / "1-16周(单)" / "3周" / "1-4,6-8周" */
function parseWeeks(weekStr) {
  const set = new Set();
  if (!weekStr) return [];
  let text = String(weekStr)
    .replace(/周/g, "")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
    .replace(/[，,;；、]/g, ",");
  text.split(",").forEach(function (seg) {
    seg = seg.trim();
    if (!seg) return;
    const isOdd = /单/.test(seg);
    const isEven = /双/.test(seg);
    seg = seg.replace(/[单双全]/g, "").replace(/[^0-9\-–~—]/g, " ").trim();
    const range = seg.match(/(\d+)\s*[-–~—]\s*(\d+)/);
    if (range) {
      let a = parseInt(range[1], 10), b = parseInt(range[2], 10);
      if (a > b) { const t = a; a = b; b = t; }
      for (let w = a; w <= b; w++) {
        if (isOdd && w % 2 === 0) continue;
        if (isEven && w % 2 !== 0) continue;
        set.add(w);
      }
    } else {
      const n = seg.match(/\d+/);
      if (n) {
        const w = parseInt(n[0], 10);
        if (w > 0) {
          if (isOdd && w % 2 === 0) return;
          if (isEven && w % 2 !== 0) return;
          set.add(w);
        }
      }
    }
  });
  return Array.from(set).sort(function (a, b) { return a - b; });
}

/** 从文本中解析节次，例如 "第3节" / "上午34节" / "第1-2节" / "晚9-11节" */
function parseSectionRange(text) {
  if (!text) return null;
  const t = String(text);
  const dashed = t.match(/(?:第|上午|下午|晚上|晚)?\s*(\d{1,2})\s*[-–~—至]\s*(\d{1,2})\s*节/);
  if (dashed) return { startSection: parseInt(dashed[1], 10), endSection: parseInt(dashed[2], 10) };
  const single = t.match(/(?:第|上午|下午|晚上|晚)\s*(\d{1,2})\s*节/);
  if (single) { const n = parseInt(single[1], 10); return { startSection: n, endSection: n }; }
  return null;
}

/** 从表头标签 "第1节 08:00 09:40" 中取行节次号 */
function rowSectionNumber(labelText) {
  if (!labelText) return null;
  const m = String(labelText).match(/第?\s*(\d{1,2})\s*节/);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** 从表头标签中取起止时间 */
function rowSectionTimes(labelText) {
  if (!labelText) return null;
  const times = String(labelText).match(/(\d{1,2}:\d{2})/g);
  if (times && times.length >= 2) {
    return { startTime: cugbPadTime(times[0]), endTime: cugbPadTime(times[1]) };
  }
  return null;
}

function weekdayFromText(t) {
  if (!t) return 0;
  const s = String(t).replace(/\s+/g, "").replace(/星期|礼拜|周/g, "");
  return WEEKDAY_MAP[s] || 0;
}

/** 判断文本是否像教学楼 / 场地 */
function looksLikePlace(t) {
  return /(楼|堂|馆|室|区|苑|操场|场|中心|基地|校区)/.test(t) || /[A-Za-z]{1,3}\s*\d{2,4}/.test(t);
}

/** innerHTML 按 <br> 拆行，去标签、解实体、去空 */
function brTextLines(html) {
  const out = [];
  String(html || "").split(/<br\s*\/?>/i).forEach(function (seg) {
    const clean = seg
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .trim();
    if (clean) out.push(clean);
  });
  return out;
}

/** 合并：同课/师/地/星期 + 同周次 的相邻节次，并为同节次合并周次 */
function mergeCourses(list) {
  const norm = (list || []).filter(function (c) {
    return c && c.name && c.day >= 1 && c.day <= 7 && c.weeks && c.weeks.length &&
      c.startSection > 0 && c.endSection >= c.startSection;
  }).map(function (c) {
    return {
      name: String(c.name).trim(),
      teacher: String(c.teacher || "").trim(),
      position: String(c.position || "").trim(),
      day: c.day,
      startSection: c.startSection,
      endSection: c.endSection,
      weeks: c.weeks.slice().sort(function (a, b) { return a - b; })
    };
  });

  const bySignature = {};
  norm.forEach(function (c) {
    const key = [c.name, c.teacher, c.position, c.day].join("|");
    (bySignature[key] = bySignature[key] || []).push(c);
  });

  const out = [];
  Object.keys(bySignature).forEach(function (key) {
    const byWeeks = {};
    bySignature[key].forEach(function (c) {
      const wk = c.weeks.join(",");
      (byWeeks[wk] = byWeeks[wk] || []).push(c);
    });
    Object.keys(byWeeks).forEach(function (wk) {
      const arr = byWeeks[wk].sort(function (a, b) { return a.startSection - b.startSection; });
      let cur = null;
      arr.forEach(function (c) {
        if (!cur) { cur = Object.assign({}, c); return; }
        if (c.startSection <= cur.endSection + 1) {
          cur.endSection = Math.max(cur.endSection, c.endSection);
        } else {
          out.push(cur);
          cur = Object.assign({}, c);
        }
      });
      if (cur) out.push(cur);
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 网络：带编码识别（教务页面多为 GBK）
// ---------------------------------------------------------------------------

function detectCharset(html, headerCt) {
  const ct = (headerCt || "").toLowerCase();
  let m = ct.match(/charset=([\w-]+)/);
  if (m) return m[1];
  m = String(html || "").match(/charset\s*=\s*["']?([\w-]+)/i);
  if (m) return m[1];
  return "utf-8";
}

async function fetchHtml(url, options) {
  const resp = await fetch(url, Object.assign({ credentials: "include" }, options || {}));
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const headerCt = (resp.headers && resp.headers.get && resp.headers.get("content-type")) || "";
  const buf = await resp.arrayBuffer();
  let bytes = new Uint8Array(buf);
  // 先按声明/latin1 探测 meta charset，再用正确编码解码
  let probe = "";
  try { probe = new TextDecoder("latin1").decode(bytes.slice(0, 2048)); } catch (e) {}
  let enc = detectCharset(probe, headerCt);
  if (!/^(gbk|gb2312|gb18030)$/i.test(enc) && !/^utf-?8$/i.test(enc)) enc = "utf-8";
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch (e) {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// 策略 A：接口取数
// ---------------------------------------------------------------------------

/** 读取当前学年/学期/学号 */
async function getSemesterInfo() {
  const url = window.location.origin + "/academic/student/currcourse/currcourse.jsdo";
  const html = await fetchHtml(url);
  const doc = new DOMParser().parseFromString(html, "text/html");

  let ctrt = null;
  try { ctrt = doc.querySelector("eduaffair\\:CTRT"); } catch (e) {}
  if (!ctrt) {
    try {
      const list = doc.getElementsByTagName("eduaffair:CTRT");
      if (list && list.length) ctrt = list[0];
    } catch (e) {}
  }

  const info = { studentid: "", year: "", term: "" };
  if (ctrt) {
    info.studentid = ctrt.getAttribute("studentid") || "";
    info.year = ctrt.getAttribute("year") || "";
    info.term = ctrt.getAttribute("term") || "";
  }
  // 兜底：从脚本/属性文本中提取
  if (!info.studentid) {
    const m = html.match(/studentid\s*[=:]\s*["']?([A-Za-z0-9]+)/i);
    if (m) info.studentid = m[1];
  }
  if (!info.year) {
    const m = html.match(/[^a-zA-Z]year\s*[=:]\s*["']?([A-Za-z0-9]+)/i);
    if (m) info.year = m[1];
  }
  if (!info.term) {
    const m = html.match(/[^a-zA-Z]term\s*[=:]\s*["']?([A-Za-z0-9]+)/i);
    if (m) info.term = m[1];
  }
  cugbLog("semester info:", info);
  return info;
}

/** 在文档中查找周课表网格表格 */
function findTimetableTable(doc) {
  let t = doc.getElementById("timetable");
  if (t) return t;
  t = doc.getElementById("kbtable");
  if (t) return t;
  t = doc.querySelector(".qz-weeklyTable");
  if (t) return t;
  // 兜底：含"周一..周日"且单元格较多的表
  const tables = doc.querySelectorAll("table");
  for (let i = 0; i < tables.length; i++) {
    const days = countWeekdayHeaders(tables[i]);
    if (days >= 5) return tables[i];
  }
  return null;
}

function countWeekdayHeaders(table) {
  let n = 0;
  const cells = table.querySelectorAll("th,td");
  for (let i = 0; i < cells.length; i++) {
    if (weekdayFromText(cells[i].textContent)) n++;
  }
  return n;
}

/** 解析一个课程单元格 → 课程块数组 */
function parseCellBlocks(cell, day, rowSection) {
  const html = cell.innerHTML || "";
  if (!html || /^(\s|&nbsp;|<br\s*\/?>|<\/?[a-z][^>]*>)*$/i.test(html)) return [];

  const results = [];

  // 结构 1：academic 单元格 —— 用 <br> 分隔的若干行，多门课用 <br><br> 分隔
  const rawBlocks = html.split(/<br\s*\/?>\s*<br\s*\/?>/i);
  rawBlocks.forEach(function (rb) {
    const lines = brTextLines(rb);
    if (!lines.length) return;
    splitCoursesInCell(lines, day, rowSection).forEach(function (c) { results.push(c); });
  });

  if (results.length) return results;

  // 结构 2：jsxsd 风格 —— div.kbcontent + <font title="教师/教室/周次(节次)">
  const kb = cell.querySelectorAll(".kbcontent");
  for (let i = 0; i < kb.length; i++) {
    const c = parseFontTitleBlock(kb[i], day, rowSection);
    if (c) results.push(c);
  }
  return results;
}

/** 把单元格里的多门课拆开（每遇到含 << >> 的行视为新课开始） */
function splitCoursesInCell(lines, day, rowSection) {
  const out = [];
  let cur = [];
  lines.forEach(function (line) {
    const isNameLine = /<<.*?>>/.test(line) || /[《].*?[》]/.test(line);
    if (isNameLine && cur.length) {
      const c = courseFromLines(cur, day, rowSection);
      if (c) out.push(c);
      cur = [];
    }
    cur.push(line);
  });
  if (cur.length) {
    const c = courseFromLines(cur, day, rowSection);
    if (c) out.push(c);
  }
  return out;
}

/** 由若干行文本构造一门课 */
function courseFromLines(lines, day, rowSection) {
  let name = "";
  let nameIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/<<(.*?)>>/) || lines[i].match(/[《](.*?)[》]/);
    if (m) { name = m[1]; nameIdx = i; break; }
  }
  if (!name) { name = lines[0].split(";")[0]; nameIdx = 0; }
  name = String(name).replace(/;\s*\d+\s*$/, "").replace(/^\s+|\s+$/g, "");
  if (!name) return null;

  let teacher = "", position = "", weeks = [], sec = null;

  for (let i = 0; i < lines.length; i++) {
    if (i === nameIdx) continue;
    const line = lines[i];
    const maybeSec = parseSectionRange(line);
    if (maybeSec) { sec = maybeSec; }
    if (/[0-9]+\s*周/.test(line) || /(单周|双周|全周)/.test(line)) {
      const w = parseWeeks(line);
      if (w.length) { weeks = w; continue; }
    }
    if (/(学时|讲课|实践|实验|备注|必修|选修|公选|任选)/.test(line)) continue;
    if (!position && looksLikePlace(line)) { position = line; continue; }
    if (!teacher && !/\d{1,2}:\d{2}/.test(line)) { teacher = line; continue; }
  }

  if (!weeks.length) return null;
  const startSection = sec ? sec.startSection : rowSection;
  const endSection = sec ? sec.endSection : rowSection;
  if (!startSection) return null;

  return {
    name: name,
    teacher: teacher.replace(/[,，]\s*$/, "").trim(),
    position: position.trim(),
    day: day,
    startSection: startSection,
    endSection: endSection,
    weeks: weeks,
    isCustomTime: false
  };
}

/** jsxsd 风格块解析 */
function parseFontTitleBlock(el, day, rowSection) {
  const html = el.innerHTML || "";
  const nameFromBracket = html.match(/<<(.*?)>>/);
  let name = "";
  if (nameFromBracket) name = nameFromBracket[1].split(";")[0];
  else {
    const firstLine = brTextLines(html)[0] || "";
    name = firstLine.split(";")[0];
  }
  name = String(name).replace(/^\s+|\s+$/g, "");
  if (!name) return null;

  const teacherEl = el.querySelector('font[title="教师"],font[title="老师"]');
  const roomEl = el.querySelector('font[title="教室"]');
  const weekEl = el.querySelector('font[title="周次(节次)"],font[title="周次"]');
  const teacher = teacherEl ? teacherEl.textContent.replace(/任课教师[:：]?/, "").trim() : "";
  const position = roomEl ? roomEl.textContent.trim() : "";
  const weekText = weekEl ? weekEl.textContent.trim() : "";
  const weeks = parseWeeks(weekText);
  if (!weeks.length) return null;
  const sec = parseSectionRange(weekText) || (rowSection ? { startSection: rowSection, endSection: rowSection } : null);
  if (!sec) return null;
  return {
    name: name, teacher: teacher, position: position, day: day,
    startSection: sec.startSection, endSection: sec.endSection, weeks: weeks, isCustomTime: false
  };
}

/** 解析周课表网格，返回 { courses, slotTimes } */
function parseGridTable(table) {
  const courses = [];
  const slotTimes = {};
  if (!table) return { courses: courses, slotTimes: slotTimes };

  const trs = table.querySelectorAll("tr");
  let sectionCarry = null;
  let headerSkipped = false;

  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const tds = tr.querySelectorAll("td");
    if (!tds.length) continue;

    // 首次遇到"含 5+ 个星期表头"的行视为表头，跳过
    if (!headerSkipped && countWeekdayHeaders(tr) >= 5) { headerSkipped = true; continue; }

    const ths = tr.querySelectorAll("th");
    let labelText = "";
    for (let k = 0; k < ths.length; k++) labelText += " " + ths[k].textContent;
    if (!labelText.trim() && tds.length > 7) labelText = tds[0].textContent;

    let section = rowSectionNumber(labelText);
    const times = rowSectionTimes(labelText);
    if (section && times) slotTimes[section] = times;
    if (!section) section = sectionCarry;
    else sectionCarry = section;

    // 取最后 7 个 td 作为周一到周日（标签列若存在会被排除在外）
    const dayCells = [];
    const start = tds.length >= 7 ? tds.length - 7 : 0;
    for (let d = 0; d < 7 && (start + d) < tds.length; d++) {
      dayCells.push({ cell: tds[start + d], day: d + 1 });
    }

    dayCells.forEach(function (dc) {
      const blocks = parseCellBlocks(dc.cell, dc.day, section);
      blocks.forEach(function (b) { courses.push(b); });
    });
  }

  return { courses: mergeCourses(courses), slotTimes: slotTimes };
}

function slotTimesToArray(map) {
  const arr = Object.keys(map).map(function (k) {
    const n = parseInt(k, 10);
    const t = map[k];
    return { number: n, startTime: t.startTime, endTime: t.endTime };
  }).filter(function (s) {
    return s.number > 0 && /^\d{1,2}:\d{2}$/.test(s.startTime || "") && /^\d{1,2}:\d{2}$/.test(s.endTime || "");
  }).sort(function (a, b) { return a.number - b.number; });
  // 必须是连续节次，否则丢弃（交给预设作息）
  for (let i = 0; i < arr.length; i++) if (arr[i].number !== i + 1) return null;
  return arr.length ? arr : null;
}

async function collectByApi() {
  const info = await getSemesterInfo();
  if (!info || !info.year || !info.term) {
    cugbLog("接口取数：未取到学年/学期，跳过");
    return null;
  }
  const url = window.location.origin +
    "/academic/manager/coursearrange/showTimetable.do?id=" + encodeURIComponent(info.studentid || "") +
    "&yearid=" + encodeURIComponent(info.year) +
    "&termid=" + encodeURIComponent(info.term) +
    "&timetableType=STUDENT&sectionType=BASE";
  const html = await fetchHtml(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = findTimetableTable(doc);
  if (!table) { cugbLog("接口取数：未找到课表网格"); return null; }
  const parsed = parseGridTable(table);
  const meta = await getSemesterMeta(info);
  return {
    courses: parsed.courses,
    slotTimes: parsed.slotTimes,
    startDate: meta.startDate,
    totalWeeks: meta.totalWeeks,
    label: (info.year ? info.year + "学年 " : "") + (info.term ? "第" + info.term + "学期" : "")
  };
}

/** 开学日期 + 总周数：studentWeeklyTimetable.do */
async function getSemesterMeta(info) {
  const meta = { startDate: null, totalWeeks: null };
  if (!info || !info.year || !info.term) return meta;
  const base = window.location.origin + "/academic/manager/coursearrange/studentWeeklyTimetable.do";
  try {
    const qs = "yearid=" + encodeURIComponent(info.year) + "&termid=" + encodeURIComponent(info.term);
    const body = qs + "&whichWeek=1";
    const html = await fetchHtml(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body: body
    });
    const doc = new DOMParser().parseFromString(html, "text/html");

    // 总周数：whichWeek 下拉框
    const sel = doc.querySelector('select[name="whichWeek"]');
    if (sel) {
      const opts = sel.querySelectorAll("option");
      let max = 0;
      for (let i = 0; i < opts.length; i++) {
        const n = parseInt(opts[i].value, 10);
        if (!isNaN(n) && n > max) max = n;
      }
      if (max > 0) meta.totalWeeks = max;
    }
    // 开学日期：本页是"按周课程明细"表（列含 日期/星期），
    // 取首个（日期+星期）反推第 1 周周一，作为课表学期起始日。
    let rawDate = null, rawWeekday = 0;
    const trs = doc.querySelectorAll("tr");
    for (let r = 0; r < trs.length; r++) {
      const tds = trs[r].querySelectorAll("td");
      let date = null, wd = 0;
      for (let c = 0; c < tds.length; c++) {
        const t = (tds[c].textContent || "").trim();
        if (!date) { const dm = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (dm) date = dm[0]; }
        if (!wd) { const w = weekdayFromText(t); if (w) wd = w; }
      }
      if (date) {
        if (!rawDate) { rawDate = date; rawWeekday = wd; }
        if (date && wd) { rawDate = date; rawWeekday = wd; break; }
      }
    }
    if (!rawDate) {
      const el = doc.querySelector('td[name="td0"]') || doc.querySelector("td[title]");
      if (el) {
        const m = ((el.getAttribute("title") || "") + " " + el.textContent).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (m) rawDate = m[0];
      }
    }
    if (rawDate) {
      // 用日期本身推算第 1 周周一（页面声明的编码与实际不一致，中文星期不可靠）
      meta.startDate = cugbMondayOfDate(rawDate);
    }
  } catch (e) {
    cugbLog("获取开学日期/周数失败:", e && e.message);
  }
  return meta;
}

// ---------------------------------------------------------------------------
// 策略 B：解析当前页面（含 iframe）
// ---------------------------------------------------------------------------

function allDocuments() {
  const docs = [];
  const seen = [];
  (function walk(doc) {
    if (!doc || seen.indexOf(doc) >= 0) return;
    seen.push(doc);
    docs.push(doc);
    try {
      const frames = doc.querySelectorAll("iframe, frame");
      for (let i = 0; i < frames.length; i++) {
        try { walk(frames[i].contentDocument); } catch (e) {}
      }
    } catch (e) {}
  })(document);
  return docs;
}

async function collectFromDocument() {
  const docs = allDocuments();
  for (let i = 0; i < docs.length; i++) {
    const table = findTimetableTable(docs[i]);
    if (table) {
      const parsed = parseGridTable(table);
      if (parsed.courses.length) {
        let meta = { startDate: null, totalWeeks: null };
        // 若当前课表页 URL 带 yearid/termid，则据此补全开学日期与周数
        try {
          const q = new URLSearchParams(window.location.search);
          const year = q.get("yearid") || q.get("year");
          const term = q.get("termid") || q.get("term");
          if (year && term) meta = await getSemesterMeta({ year: year, term: term });
        } catch (e) { cugbLog("页面 URL 取学期信息失败:", e && e.message); }
        return {
          courses: parsed.courses, slotTimes: parsed.slotTimes,
          startDate: meta.startDate, totalWeeks: meta.totalWeeks, label: "当前页面"
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 诊断
// ---------------------------------------------------------------------------

function collectDiagnostics() {
  const lines = [];
  const docs = allDocuments();
  let tables = 0, trs = 0, tds = 0, timetableFound = 0;
  docs.forEach(function (doc) {
    tables += doc.querySelectorAll("table").length;
    trs += doc.querySelectorAll("tr").length;
    tds += doc.querySelectorAll("td,th").length;
    if (findTimetableTable(doc)) timetableFound++;
  });
  lines.push("文档数=" + docs.length + " 表格=" + tables + " 行=" + trs + " 格=" + tds + " 含课表=" + timetableFound);
  lines.push("URL=" + String(window.location.href).slice(0, 120));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 作息选择
// ---------------------------------------------------------------------------

/** 按课程所在楼栋推测默认作息：综合楼/教五楼 → 0；否则 → 1 */
function inferScheduleIndex(courses) {
  let zong = 0, other = 0;
  (courses || []).forEach(function (c) {
    const p = c.position || "";
    if (p.indexOf("综合楼") >= 0 || p.indexOf("教五") >= 0) zong++; else other++;
  });
  return zong > other ? 0 : 1;
}

async function chooseTimeSlots(courses) {
  const options = [
    { name: "综合楼 / 教五楼（第3节 10:00 起）", slots: CUGB_SLOTS_ZONGHE },
    { name: "其他教室（第3节 09:50 起）", slots: CUGB_SLOTS_OTHER }
  ];
  const labels = options.map(function (o) { return o.name; });
  const def = inferScheduleIndex(courses);
  let idx = await window.shiguangBridgePromise.showSingleSelection(
    "未能从课表读取作息时间，请选择你的作息方案：\n（第 3–5 节综合楼/教五楼与其他教室错峰 10 分钟）",
    JSON.stringify(labels),
    def
  );
  if (idx === null || idx === undefined || idx < 0) idx = def;
  return options[idx];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function runImportFlow() {
  try {
    const isMock = !!window.__CUGB_MOCK__;
    const host = window.location.hostname || "";
    if (!isMock && !new RegExp(CUGB_HOST_SUFFIX + "$").test(host)) {
      await window.shiguangBridgePromise.showAlert(
        "请先登录教务系统",
        "当前不在中国地质大学（北京）教务系统页面。\n\n请通过统一身份认证登录教务系统后，再点击导入。",
        "好的"
      );
      return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
      "中国地质大学（北京）课表导入",
      "将读取你【当前学期】的个人课表。\n\n若需导入其它学期，请先在教务系统中切换学年/学期，再重新导入。",
      "开始导入"
    );
    if (!confirmed) return;

    window.shiguangBridge.showToast("正在读取课表数据...");

    let result = null;
    try {
      result = await collectByApi();
    } catch (e) { cugbLog("接口取数异常:", e && e.message); }

    if (!result || !result.courses.length) {
      cugbLog("回退到页面解析");
      result = await collectFromDocument();
    }

    if (!result || !result.courses.length) {
      await window.shiguangBridgePromise.showAlert(
        "未获取到课程数据",
        collectDiagnostics() +
        "\n\n请确认：\n1. 已成功登录教务系统；\n2. 处于【学生课表】页面（或稍后重试）；\n3. 该学期已排课。\n\n可将以上信息反馈给适配维护者。",
        "知道了"
      );
      return;
    }

    const courses = result.courses;
    cugbLog("解析到课程 " + courses.length + " 条", courses);

    // 作息时间
    let slots = slotTimesToArray(result.slotTimes || {});
    if (!slots) {
      const chosen = await chooseTimeSlots(courses);
      slots = chosen.slots.slice();
      window.shiguangBridge.showToast("作息已设为：" + chosen.name);
    }
    slots = ensureSlotsCover(slots, maxSectionOf(courses));

    // 保存课程
    try {
      await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
      window.shiguangBridge.showToast("课程保存失败：" + (e && e.message));
      return;
    }

    // 保存作息
    try {
      await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    } catch (e) {
      cugbLog("作息保存失败:", e && e.message);
    }

    // 课表配置
    const config = { semesterTotalWeeks: result.totalWeeks || DEFAULT_TOTAL_WEEKS, firstDayOfWeek: 1 };
    if (result.startDate) config.semesterStartDate = result.startDate;
    try {
      await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (e) {
      cugbLog("配置保存失败:", e && e.message);
    }

    const dateTip = result.startDate ? "，开学日期：" + result.startDate : "";
    await window.shiguangBridgePromise.showAlert(
      "导入成功",
      "已导入 " + courses.length + " 条课程安排（" + (result.label || "") + "）" + dateTip + "。",
      "完成"
    );
    window.shiguangBridge.notifyTaskCompletion();
  } catch (error) {
    cugbLog("导入流程异常:", error);
    try { window.shiguangBridge.showToast("导入失败：" + (error && error.message)); } catch (e) {}
  }
}

runImportFlow();
