const BASE = window.location.origin;
const SCHEDULE_PATHS = [
  '/Schedule/Schedule_getUserSchedume.action?item=0207',
  '/Schedule/Schedule_getUserSchedume.action?item=0205',
  '/Schedule/Schedule_getUserSchedume.action'
];

const TIME_SLOTS = [
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:55', endTime: '09:40' },
  { number: 3, startTime: '10:05', endTime: '10:50' },
  { number: 4, startTime: '10:55', endTime: '11:40' },
  { number: 5, startTime: '14:30', endTime: '15:15' },
  { number: 6, startTime: '15:25', endTime: '16:10' },
  { number: 7, startTime: '16:40', endTime: '17:25' },
  { number: 8, startTime: '17:35', endTime: '18:20' },
  { number: 9, startTime: '19:00', endTime: '19:45' },
  { number: 10, startTime: '19:55', endTime: '20:40' },
];

function cleanText(value) {
  return String(value || '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .trim();
}

function parseWeeks(weekStr) {
  const weeks = [];
  String(weekStr || '')
    .replace(/\s+/g, '')
    .split(/[,，]/)
    .forEach((part) => {
      if (!part) return;
      const isSingle = part.includes('单');
      const isDouble = part.includes('双');
      const rangeMatch = part.match(/(\d+)-(\d+)/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let i = start; i <= end; i++) {
          if (isSingle && i % 2 === 0) continue;
          if (isDouble && i % 2 !== 0) continue;
          weeks.push(i);
        }
      } else {
        const num = parseInt(part.replace(/[^\d]/g, ''), 10);
        if (!Number.isNaN(num)) weeks.push(num);
      }
    });
  return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseSections(sectionStr) {
  const sections = String(sectionStr || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !Number.isNaN(n));
  if (!sections.length) return null;
  return {
    startSection: sections[0],
    endSection: sections[sections.length - 1]
  };
}

function parseTeacherPosition(line) {
  const raw = cleanText(line);
  const atIndex = raw.indexOf('@');
  if (atIndex === -1) {
    return { teacher: raw, position: '' };
  }
  return {
    teacher: cleanText(raw.slice(0, atIndex)),
    position: cleanText(raw.slice(atIndex + 1))
  };
}

function parseCourseLines(lines, day) {
  const items = [];
  for (let i = 2; i < lines.length; i++) {
    const line = cleanText(lines[i]);
    const match = line.match(/^([\d,，\-单双()]+)\s+(\d+(?:,\d+)*)$/);
    if (!match) continue;

    const name = cleanText(lines[i - 2]);
    const teacherPosition = parseTeacherPosition(lines[i - 1]);
    const weekText = match[1];
    const sectionText = match[2];
    const weeks = parseWeeks(weekText);
    const sections = parseSections(sectionText);

    if (!name || !weeks.length || !sections) continue;

    items.push({
      name,
      teacher: teacherPosition.teacher || '未知教师',
      position: teacherPosition.position || '未排地点',
      day,
      startSection: sections.startSection,
      endSection: sections.endSection,
      weeks
    });
  }
  return items;
}

function mergeCourses(rawItems) {
  const groupMap = new Map();
  rawItems.forEach((item) => {
    const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
    if (!groupMap.has(key)) groupMap.set(key, {});
    const weekMap = groupMap.get(key);
    item.weeks.forEach((week) => {
      if (!weekMap[week]) weekMap[week] = new Set();
      for (let section = item.startSection; section <= item.endSection; section++) {
        weekMap[week].add(section);
      }
    });
  });

  const finalCourses = [];
  groupMap.forEach((weekMap, key) => {
    const [name, teacher, position, day] = key.split('|');
    const patternMap = new Map();

    Object.keys(weekMap).forEach((weekStr) => {
      const week = parseInt(weekStr, 10);
      const sections = Array.from(weekMap[week]).sort((a, b) => a - b);
      if (!sections.length) return;
      let start = sections[0];
      for (let i = 0; i < sections.length; i++) {
        if (i === sections.length - 1 || sections[i + 1] !== sections[i] + 1) {
          const pKey = `${start}-${sections[i]}`;
          if (!patternMap.has(pKey)) patternMap.set(pKey, []);
          patternMap.get(pKey).push(week);
          if (i < sections.length - 1) start = sections[i + 1];
        }
      }
    });

    patternMap.forEach((weeks, patternKey) => {
      const [startSection, endSection] = patternKey.split('-').map(Number);
      finalCourses.push({
        name,
        teacher,
        position,
        day: parseInt(day, 10),
        startSection,
        endSection,
        weeks: weeks.sort((a, b) => a - b)
      });
    });
  });

  return finalCourses.sort((a, b) => (
    a.day - b.day
    || a.startSection - b.startSection
    || a.name.localeCompare(b.name, 'zh-CN')
  ));
}

function parseScheduleTable(doc) {
  const table = doc.getElementById('courseSche');
  if (!table) return [];

  const rows = Array.from(table.rows);
  if (rows.length < 2) return [];

  const rawItems = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = Array.from(rows[r].cells);
    if (cells.length < 2) continue;

    const dayCells = cells.slice(1, 8);
    dayCells.forEach((cell, index) => {
      const rawText = cleanText(cell.innerText);
      if (!rawText || !rawText.includes('@')) return;
      const lines = cell.innerText
        .split(/\n+/)
        .map(cleanText)
        .filter(Boolean);
      rawItems.push(...parseCourseLines(lines, index + 1));
    });
  }

  return mergeCourses(rawItems);
}

function getCurrentTermInfo(doc) {
  const select = doc.querySelector('#term');
  if (!select) return null;
  const selected = select.querySelector('option:checked') || select.options[select.selectedIndex];
  return {
    value: String(select.value || '').trim(),
    text: selected ? cleanText(selected.textContent) : ''
  };
}

function isScheduleDoc(doc) {
  return !!(doc && (doc.getElementById('courseSche') || doc.querySelector('#term')));
}

function findScheduleDoc(win) {
  try {
    if (isScheduleDoc(win.document)) return win.document;
  } catch (_) {}
  for (let i = 0; i < win.frames.length; i++) {
    try {
      const found = findScheduleDoc(win.frames[i]);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

async function fetchScheduleDoc() {
  for (const path of SCHEDULE_PATHS) {
    try {
      const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
      if (!res.ok) continue;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (isScheduleDoc(doc)) return doc;
    } catch (_) {}
  }
  return null;
}

async function loadScheduleDoc() {
  const currentDoc = findScheduleDoc(window);
  if (currentDoc && currentDoc.getElementById('courseSche')) return currentDoc;
  const fetched = await fetchScheduleDoc();
  if (fetched) return fetched;
  throw new Error('未找到课表页面，请先登录后进入“我的课表/个人课表”页面');
}

async function runImportFlow() {
  try {
    const confirmed = await window.shiguangBridgePromise.showAlert(
      '华东交通大学教务导入',
      '请确认你已经登录教务系统；如需导入其他学期，请先在页面上切换到目标学期后再导入。',
      '确定，开始导入'
    );
    if (!confirmed) return;

    const doc = await loadScheduleDoc();
    const termInfo = getCurrentTermInfo(doc);
    window.shiguangBridge.showToast(termInfo?.text ? `正在导入 ${termInfo.text} 课表...` : '正在解析课表数据...');

    const courses = parseScheduleTable(doc);
    if (!courses.length) {
      throw new Error('未解析到课程，请确认当前课表已正常显示');
    }

    const allWeeks = courses.flatMap(course => course.weeks);
    const semesterTotalWeeks = allWeeks.length ? Math.max(...allWeeks) : 20;

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks,
      semesterStartDate: null,
      firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
    window.shiguangBridge.notifyTaskCompletion();
  } catch (error) {
    console.error(error);
    window.shiguangBridge.showToast(`导入失败: ${error.message}`);
  }
}

runImportFlow();
