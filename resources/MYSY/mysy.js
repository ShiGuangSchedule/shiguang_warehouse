// 绵阳师范学院正方教务系统课表适配脚本
// 页面为 frameset 结构，课表主体在 iframe[name="Frame1"] 的 #kbtable 中。

function showToast(message) {
  try {
    const bridge = window.shiguangBridge;
    if (bridge && typeof bridge.showToast === 'function') {
      bridge.showToast(message);
    }
  } catch (error) {
    console.error('[MYSY] showToast failed:', error);
  }
}

function getScheduleDocument() {
  if (document.querySelector && document.querySelector('#kbtable')) {
    return document;
  }

  const frames = [
    document.querySelector('iframe[name="Frame1"]'),
    document.querySelector('frame[name="Frame1"]')
  ];

  for (const frame of frames) {
    if (!frame) continue;
    try {
      const doc = frame.contentDocument || frame.contentWindow.document;
      if (doc && doc.querySelector('#kbtable')) return doc;
    } catch (error) {
      console.warn('[MYSY] Unable to access Frame1 document:', error);
    }
  }

  try {
    const namedFrame = window.frames && window.frames['Frame1'];
    if (namedFrame && namedFrame.document && namedFrame.document.querySelector('#kbtable')) {
      return namedFrame.document;
    }
  } catch (error) {
    console.warn('[MYSY] Unable to access named Frame1:', error);
  }

  return null;
}

function waitForScheduleTable(timeoutMs) {
  const timeout = timeoutMs || 15000;
  const start = Date.now();

  return new Promise((resolve) => {
    const check = () => {
      const doc = getScheduleDocument();
      if (doc && doc.querySelector('#kbtable')) {
        resolve(doc);
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve(getScheduleDocument());
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

function parseWeeks(weekStr) {
  if (!weekStr) return [];

  const cleaned = String(weekStr)
    .replace(/\[[^\]]*节[^\]]*\]/g, '')
    .replace(/\s+/g, '');

  const weeks = [];
  const parts = cleaned.split(/[,，]/).filter(Boolean);

  for (const part of parts) {
    const parityMatch = part.match(/[（(](单|双)[）)]/);
    const parity = parityMatch ? parityMatch[1] : null;
    const numeric = part
      .replace(/[（(](单|双)[）)]/g, '')
      .replace(/[（(]周[）)]/g, '')
      .replace(/周/g, '');
    const match = numeric.match(/^(\d+)(?:[-~到](\d+))?$/);

    if (!match) continue;

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    for (let week = start; week <= end; week++) {
      if (parity === '单' && week % 2 === 0) continue;
      if (parity === '双' && week % 2 === 1) continue;
      weeks.push(week);
    }
  }

  return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

function parseSectionRange(text) {
  const match = String(text || '').match(/\[(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?节\]/);
  if (!match) return null;

  return {
    start: Number(match[1]),
    end: Number(match[2] || match[1])
  };
}

function getDirectText(element) {
  const parts = [];

  for (const node of element.childNodes) {
    if (node.nodeType !== 3) continue;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }

  return parts.join(' ').trim();
}

function getTitledText(element, title) {
  const target = element.querySelector(`font[title="${title}"]`);
  if (!target) return '';
  return (target.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseCourseDiv(div) {
  const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const idParts = (div.getAttribute('id') || '').split('_');
  const day = Number(idParts[1]) || 0;
  const name = getDirectText(div);
  const teacher = getTitledText(div, '老师') || '待定';
  const position = getTitledText(div, '教室') || '待定';
  const timeText = getTitledText(div, '周次(节次)');
  const weeks = parseWeeks(timeText);

  if (!name || weeks.length === 0 || day < 1 || day > 7) return null;

  const section = parseSectionRange(timeText);
  const course = {
    name: name,
    teacher: teacher,
    position: position,
    day: day,
    startSection: section ? section.start : 0,
    endSection: section ? section.end : 0,
    weeks: weeks
  };

  return course;
}

function extractCourses(doc) {
  const table = doc.querySelector('#kbtable');
  if (!table) return [];

  const courses = [];
  const seen = new Set();

  table.querySelectorAll('div.kbcontent').forEach((div) => {
    const course = parseCourseDiv(div);
    if (!course) return;

    const key = JSON.stringify(course);
    if (seen.has(key)) return;
    seen.add(key);
    courses.push(course);
  });

  courses.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    if (a.startSection !== b.startSection) return a.startSection - b.startSection;
    return a.name.localeCompare(b.name);
  });

  return courses;
}

function toMinutes(hhmm) {
  const parts = String(hhmm).split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function toHHMM(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function generateTimeSlots(doc) {
  const fallback = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:50', endTime: '09:35' },
    { number: 3, startTime: '09:55', endTime: '10:40' },
    { number: 4, startTime: '10:45', endTime: '11:30' },
    { number: 5, startTime: '11:35', endTime: '12:20' },
    { number: 6, startTime: '14:00', endTime: '14:45' },
    { number: 7, startTime: '14:50', endTime: '15:35' },
    { number: 8, startTime: '15:55', endTime: '16:40' },
    { number: 9, startTime: '16:45', endTime: '17:30' },
    { number: 10, startTime: '17:35', endTime: '18:20' },
    { number: 11, startTime: '19:00', endTime: '19:45' },
    { number: 12, startTime: '19:50', endTime: '20:35' },
    { number: 13, startTime: '20:40', endTime: '21:25' }
  ];

  const table = doc.querySelector('#kbtable');
  if (!table) return fallback;

  const blocks = [];
  table.querySelectorAll('tr th[rowspan]').forEach((th) => {
    const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
    if (!match) return;

    const rowspan = Number(th.getAttribute('rowspan')) || 1;
    blocks.push({
      rowspan: rowspan,
      start: `${match[1]}:${match[2]}`,
      end: `${match[3]}:${match[4]}`
    });
  });

  if (blocks.length === 0) return fallback;

  const slots = [];
  let number = 1;
  const classDuration = 45;
  const breakDuration = 5;

  for (const block of blocks) {
    const count = Math.max(1, block.rowspan);
    let cursor = toMinutes(block.start);

    for (let i = 0; i < count; i++) {
      const start = cursor;
      const end = start + classDuration;
      slots.push({
        number: number,
        startTime: toHHMM(start),
        endTime: toHHMM(end)
      });
      number++;
      cursor = end + (i < count - 1 ? breakDuration : 0);
    }
  }

  return slots.length > 0 ? slots : fallback;
}

async function saveCourses(courses) {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.saveImportedCourses !== 'function') {
      throw new Error('saveImportedCourses bridge not found');
    }
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    return true;
  } catch (error) {
    console.error('[MYSY] save courses failed:', error);
    showToast(`课表保存失败: ${error.message}`);
    return false;
  }
}

async function saveTimeSlots(slots) {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.savePresetTimeSlots !== 'function') {
      throw new Error('savePresetTimeSlots bridge not found');
    }
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    return true;
  } catch (error) {
    console.error('[MYSY] save time slots failed:', error);
    showToast(`时间模板保存失败: ${error.message}`);
    return false;
  }
}

async function saveCourseConfig() {
  try {
    if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.saveCourseConfig !== 'function') {
      return;
    }
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks: 20,
      defaultClassDuration: 45,
      defaultBreakDuration: 5,
      firstDayOfWeek: 1
    }));
  } catch (error) {
    console.warn('[MYSY] save course config failed:', error);
  }
}

async function runImportFlow() {
  console.log('[MYSY] 开始导入绵阳师范学院课表...');
  showToast('正在检查课表页面...');

  const doc = await waitForScheduleTable(15000);
  if (!doc || !doc.querySelector('#kbtable')) {
    showToast('未找到课表，请先打开“学期理论课表”并确认已加载');
    return;
  }

  const courses = extractCourses(doc);
  if (courses.length === 0) {
    showToast('未找到已安排上课时间的课程');
    return;
  }

  try {
    const confirmed = await window.shiguangBridgePromise.showAlert(
      '教务系统课表导入',
      `检测到 ${courses.length} 门课程，是否导入？`,
      '确认导入'
    );
    if (!confirmed) {
      showToast('已取消导入');
      return;
    }
  } catch (error) {
    console.warn('[MYSY] confirmation dialog unavailable:', error);
  }

  if (!(await saveCourses(courses))) return;

  const timeSlots = generateTimeSlots(doc);
  if (!(await saveTimeSlots(timeSlots))) return;

  await saveCourseConfig();

  showToast(`课表导入成功，共导入 ${courses.length} 门课程`);
  console.log(`[MYSY] 成功导入 ${courses.length} 门课程`);

  try {
    if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
      window.shiguangBridge.notifyTaskCompletion();
    }
  } catch (error) {
    console.warn('[MYSY] notifyTaskCompletion failed:', error);
  }
}

if (/mtc\.edu\.cn$/i.test(window.location.hostname)) {
  setTimeout(runImportFlow, 800);
} else {
  showToast('请先在绵阳师范学院教务系统打开课表页面');
}
