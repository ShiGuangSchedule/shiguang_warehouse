// ===== 登录检查 =====
const checkLogin = () => {
  const hostnameOk = window.location.hostname === "jwgln.cqjtu.edu.cn";
  const nameEl = document.querySelector(".userInfo span:last-child");
  const nameOk = nameEl && nameEl.innerText.trim().length > 0;
  return hostnameOk && nameOk;
};

const getUserName = () => {
  const el = document.querySelector(".userInfo span:last-child");
  return el ? el.innerText.trim() : "";
};

// ===== 工具函数 =====

// 周次展开: "1-9,11-16(单周)" → [1,3,5,7,9,11,13,15]
function parseWeeks(weekStr) {
  weekStr = weekStr.replace(/\[\d+(?:-\d+)?节\]$/, "");
  const typeMatch = weekStr.match(/\(([^)]+)\)$/);
  const weekType = typeMatch ? typeMatch[1] : "周";
  const pureWeekStr = weekStr.replace(/\([^)]+\)$/, "");
  const weekRanges = pureWeekStr.split(",");

  let weeks = [];
  for (const range of weekRanges) {
    const parts = range.split("-");
    const start = Number(parts[0]);
    const end = parts.length > 1 ? Number(parts[1]) : start;
    for (let i = start; i <= end; i++) {
      weeks.push(i);
    }
  }

  if (weekType === "单周") {
    weeks = weeks.filter((w) => w % 2 === 1);
  } else if (weekType === "双周") {
    weeks = weeks.filter((w) => w % 2 === 0);
  }

  return weeks;
}

// 提取节次: "1-9,11-16(周)[01-02节]" → { start: 1, end: 2 }
function parseSections(weekStr) {
  const match = weekStr.match(/\[(\d+)(?:-(\d+))?节\]/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return { start, end };
}

// 格式化分钟为 HH:MM
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 计算时间槽
function calculateTimeSlots(sectionNumbers, startH, startM, endH, endM) {
  const n = sectionNumbers.length;
  const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
  const rawDuration = Math.floor(totalMinutes / n);
  const z = Math.floor(rawDuration / 5) * 5;
  const interval = n > 1 ? Math.floor((totalMinutes - z * n) / (n - 1)) : 0;

  return sectionNumbers.map((num, idx) => {
    const offset = idx * (z + interval);
    const start = startH * 60 + startM + offset;
    const end = start + z;
    return {
      number: num,
      startTime: formatTime(start),
      endTime: formatTime(end),
    };
  });
}

// 根据学期值计算开学日期, 就是个简单计算，谁还不能自己手动调了，鬼知道教务处要怎么安排后续的学期
function getSemesterStartDate(semesterValue) {
  const year = parseInt(semesterValue.substring(0, 4));
  const termType = semesterValue.slice(-1);
  if (termType === "1") {
    return `${year}-09-08`;
  } else {
    return `${year + 1}-03-02`;
  }
}

// 从timeSlots计算课程配置
function getSemesterConfig(timeSlots) {
  if (timeSlots.length === 0) {
    return {};
  }

  const [sH, sM] = timeSlots[0].startTime.split(":").map(Number);
  const [eH, eM] = timeSlots[0].endTime.split(":").map(Number);
  const classDuration = eH * 60 + eM - (sH * 60 + sM);
  const defaultClassDuration = Math.round(classDuration / 5) * 5;

  let defaultBreakDuration = 5;
  if (timeSlots.length >= 2) {
    const [e1H, e1M] = timeSlots[0].endTime.split(":").map(Number);
    const [s2H, s2M] = timeSlots[1].startTime.split(":").map(Number);
    defaultBreakDuration = s2H * 60 + s2M - (e1H * 60 + e1M);
  }

  return {
    defaultClassDuration,
    defaultBreakDuration,
    semesterTotalWeeks: 18,
    firstDayOfWeek: 1,
  };
}

// 在主文档和frames中查找元素
function findElementInFrames(selector) {
  let el = document.querySelector(selector);
  if (el) return el;

  for (let i = 0; i < window.frames.length; i++) {
    try {
      const frameDoc = window.frames[i].document;
      if (frameDoc) {
        el = frameDoc.querySelector(selector);
        if (el) return el;
      }
    } catch (e) {}
  }
  return null;
}

// ===== 主解析函数 =====

function parseSchedule() {
  let table = findElementInFrames("#timetable");

  if (!table) {
    window.shiguangBridge.showToast("请去往学期理论课表界面");
    return [];
  }

  const courses = [];
  const timeSlots = [];
  const tbody = table.querySelector("tbody");
  if (!tbody) {
    const rows = table.querySelectorAll("tr");
    if (rows.length > 0) {
      return parseRowsDirectly(rows);
    }
    window.shiguangBridge.showToast("课表结构异常");
    return [];
  }

  const rows = tbody.querySelectorAll("tr");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const th = row.querySelector("th");
    if (!th) continue;

    const thMatch = th.innerText.match(/\(([\d,]+)小节\)/);
    if (!thMatch) continue;

    const sectionNumbers = thMatch[1].split(",").map(Number);
    const baseStart = sectionNumbers[0];
    const baseEnd = sectionNumbers[sectionNumbers.length - 1];

    // 提取时间范围并计算时间槽
    const timeMatch = th.innerText.match(/(\d+):(\d+)-(\d+):(\d+)/);
    if (timeMatch) {
      const startH = Number(timeMatch[1]);
      const startM = Number(timeMatch[2]);
      const endH = Number(timeMatch[3]);
      const endM = Number(timeMatch[4]);
      const slots = calculateTimeSlots(
        sectionNumbers,
        startH,
        startM,
        endH,
        endM,
      );
      timeSlots.push(...slots);
    }

    const tds = row.querySelectorAll("td");

    for (let day = 1; day <= 7 && day <= tds.length; day++) {
      const td = tds[day - 1];
      const allKbDivs = td.querySelectorAll("div.kbcontent");
      const kbDivs = Array.from(allKbDivs).filter((div) => {
        const style = div.getAttribute("style") || "";
        return !style.includes("display:none");
      });

      if (kbDivs.length === 0) continue;

      for (const kbDiv of kbDivs) {
        const html = kbDiv.innerHTML;
        const parts = html.split("</font>---------------------<br>");

        for (const part of parts) {
          const firstFontMatch = part.match(
            /<font onmouseover="kbtc\(this\)" onmouseout="kbot\(this\)">([^<]*)<\/font>/,
          );
          if (!firstFontMatch) continue;

          const name = firstFontMatch[1].trim();
          if (!name) continue;

          const teacherMatch = part.match(
            /<font title="教师"[^>]*>([^<]*)<\/font>/,
          );
          const teacher = teacherMatch ? teacherMatch[1].trim() : "未知";

          const weeksMatch = part.match(
            /<font title="周次\(节次\)"[^>]*>([^<]*)<\/font>/,
          );
          if (!weeksMatch) continue;

          const weeksStr = weeksMatch[1].trim();
          const posMatch = part.match(
            /<font title="教室"[^>]*>([^<]*)<\/font>/,
          );
          const position = posMatch ? posMatch[1].trim() : "";

          let startSection = baseStart;
          let endSection = baseEnd;
          const sectionInfo = parseSections(weeksStr);
          if (sectionInfo) {
            startSection = sectionInfo.start;
            endSection = sectionInfo.end;
          }

          const weeks = parseWeeks(weeksStr);
          if (weeks.length === 0) continue;

          courses.push({
            name,
            teacher,
            position,
            day,
            startSection,
            endSection,
            weeks,
          });
        }
      }
    }
  }

  return { courses, timeSlots };
}

// 直接解析table的rows（无tbody的情况）
function parseRowsDirectly(rows) {
  const courses = [];
  const timeSlots = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const th = row.querySelector("th");
    if (!th) continue;

    const thMatch = th.innerText.match(/\(([\d,]+)小节\)/);
    if (!thMatch) continue;

    const sectionNumbers = thMatch[1].split(",").map(Number);
    const baseStart = sectionNumbers[0];
    const baseEnd = sectionNumbers[sectionNumbers.length - 1];

    const timeMatch = th.innerText.match(/(\d+):(\d+)-(\d+):(\d+)/);
    if (timeMatch) {
      const startH = Number(timeMatch[1]);
      const startM = Number(timeMatch[2]);
      const endH = Number(timeMatch[3]);
      const endM = Number(timeMatch[4]);
      const slots = calculateTimeSlots(
        sectionNumbers,
        startH,
        startM,
        endH,
        endM,
      );
      timeSlots.push(...slots);
    }

    const tds = row.querySelectorAll("td");

    for (let day = 1; day <= 7 && day <= tds.length; day++) {
      const td = tds[day - 1];
      const allKbDivs = td.querySelectorAll("div.kbcontent");
      const kbDivs = Array.from(allKbDivs).filter((div) => {
        const style = div.getAttribute("style") || "";
        return !style.includes("display:none");
      });

      if (kbDivs.length === 0) continue;

      for (const kbDiv of kbDivs) {
        const html = kbDiv.innerHTML;
        const parts = html.split("</font>---------------------<br>");

        for (const part of parts) {
          const firstFontMatch = part.match(
            /<font onmouseover="kbtc\(this\)" onmouseout="kbot\(this\)">([^<]*)<\/font>/,
          );
          if (!firstFontMatch) continue;

          const name = firstFontMatch[1].trim();
          if (!name) continue;

          const teacherMatch = part.match(
            /<font title="教师"[^>]*>([^<]*)<\/font>/,
          );
          const teacher = teacherMatch ? teacherMatch[1].trim() : "未知";

          const weeksMatch = part.match(
            /<font title="周次\(节次\)"[^>]*>([^<]*)<\/font>/,
          );
          if (!weeksMatch) continue;

          const weeksStr = weeksMatch[1].trim();
          const posMatch = part.match(
            /<font title="教室"[^>]*>([^<]*)<\/font>/,
          );
          const position = posMatch ? posMatch[1].trim() : "";

          let startSection = baseStart;
          let endSection = baseEnd;
          const sectionInfo = parseSections(weeksStr);
          if (sectionInfo) {
            startSection = sectionInfo.start;
            endSection = sectionInfo.end;
          }

          const weeks = parseWeeks(weeksStr);
          if (weeks.length === 0) continue;

          courses.push({
            name,
            teacher,
            position,
            day,
            startSection,
            endSection,
            weeks,
          });
        }
      }
    }
  }

  return { courses, timeSlots };
}

// ===== 保存函数 =====

async function saveCourses(courses) {
  await window.shiguangBridgePromise.saveImportedCourses(
    JSON.stringify(courses),
  );
}

async function saveTimeSlots(timeSlots) {
  await window.shiguangBridgePromise.savePresetTimeSlots(
    JSON.stringify(timeSlots),
  );
}

async function saveConfig(config) {
  await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// ===== 主流程 =====

(async () => {
  if (!checkLogin()) {
    window.shiguangBridge.showToast("尚未登录，请先登录！");
    return;
  }

  const { courses, timeSlots } = parseSchedule();

  if (courses.length === 0) {
    window.shiguangBridge.showToast("未解析到任何课程");
    return;
  }

  // 获取学期配置
  const semesterSelect = findElementInFrames("#xnxq01id");
  const courseConfigData = getSemesterConfig(timeSlots);

  if (semesterSelect) {
    courseConfigData.semesterStartDate = getSemesterStartDate(
      semesterSelect.value,
    );
  }

  console.log("准备保存课程:", courses.length, "门");
  console.log("准备保存时间槽:", timeSlots.length, "个");
  console.log("准备保存配置:", JSON.stringify(courseConfigData));

  await saveCourses(courses);
  await saveTimeSlots(timeSlots);
  await saveConfig(courseConfigData);

  window.shiguangBridge.showToast(`导入成功！${courses.length}门课程`);
  window.shiguangBridge.notifyTaskCompletion();
})();
