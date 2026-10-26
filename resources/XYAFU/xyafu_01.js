// 文件: XYAFU_01.js
// 功能：从信阳农林学院青果教务系统获取课程表，解析后导入到拾光课程表
// 适配：信阳农林学院青果教务系统
// 维护者：glxgo

const BASE = `${window.location.origin}`;
const CONTROL_PAGE = '/student/xkjg.wdkb.jsp?menucode=S20301';
const TIMETABLE_PAGE = '/student/wsxk.xskcb10319.jsp?params=';
const TIME_SLOTS_SPRING_SUMMER = [
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:50', endTime: '09:35' },
  { number: 3, startTime: '10:00', endTime: '10:45' },
  { number: 4, startTime: '10:50', endTime: '11:35' },
  { number: 5, startTime: '14:30', endTime: '15:15' },
  { number: 6, startTime: '15:20', endTime: '16:05' },
  { number: 7, startTime: '16:30', endTime: '17:15' },
  { number: 8, startTime: '17:20', endTime: '18:05' },
  { number: 9, startTime: '19:00', endTime: '19:45' },
  { number: 10, startTime: '19:50', endTime: '20:35' }
];
const TIME_SLOTS_AUTUMN_WINTER = [
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:50', endTime: '09:35' },
  { number: 3, startTime: '10:00', endTime: '10:45' },
  { number: 4, startTime: '10:50', endTime: '11:35' },
  { number: 5, startTime: '14:00', endTime: '14:45' },
  { number: 6, startTime: '14:50', endTime: '15:35' },
  { number: 7, startTime: '16:00', endTime: '16:45' },
  { number: 8, startTime: '16:50', endTime: '17:35' },
  { number: 9, startTime: '19:00', endTime: '19:45' },
  { number: 10, startTime: '19:50', endTime: '20:35' }
];

function cleanText(value) {
  return String(value || '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .trim();
}

function encodeParams(xn, xq, xh) {
  return btoa(`xn=${xn}&xq=${xq}&xh=${xh}`);
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

function decodeParams(encoded) {
  try {
    return atob(encoded);
  } catch (_) {
    return '';
  }
}

function parseXhFromEncodedParams(encoded) {
  const decoded = decodeParams(encoded);
  if (!decoded) return '';
  const search = new URLSearchParams(decoded);
  return String(search.get('xh') || '').trim();
}

function extractParamsFromHtml(html) {
  const match = String(html || '').match(/wsxk\.xskcb10319\.jsp\?params=([^"'&\s>]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function findControlFrame(win) {
  try {
    if (win.document.querySelector('#xnxq')) return win;
  } catch (_) {}
  for (let i = 0; i < win.frames.length; i++) {
    try {
      const found = findControlFrame(win.frames[i]);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

function findTimetableFrame(win) {
  try {
    if (win.document.getElementById('mytable')) return win;
  } catch (_) {}
  for (let i = 0; i < win.frames.length; i++) {
    try {
      const found = findTimetableFrame(win.frames[i]);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

async function fetchControlDoc() {
  const res = await fetch(`${BASE}${CONTROL_PAGE}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`课表控制页请求失败: ${res.status}`);
  const html = await res.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

async function fetchTimetableDoc(xn, xq, xh) {
  const params = encodeParams(xn, xq, xh);
  const res = await fetch(`${BASE}${TIMETABLE_PAGE}${encodeURIComponent(params)}`, {
    method: 'GET',
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`课表页面请求失败: ${res.status}`);
  const buffer = await res.arrayBuffer();
  let html = '';
  try {
    html = new TextDecoder('gbk').decode(buffer);
  } catch (_) {
    html = new TextDecoder('utf-8').decode(buffer);
  }
  return new DOMParser().parseFromString(html, 'text/html');
}

function parseSelectOptions(selectEl) {
  if (!selectEl) return { options: [], defaultIndex: 0 };
  const options = [];
  let defaultIndex = 0;
  Array.from(selectEl.querySelectorAll('option')).forEach((opt) => {
    const value = String(opt.value || '').trim();
    if (!value) return;
    const text = cleanText(opt.textContent) || value;
    if (opt.selected) defaultIndex = options.length;
    options.push({ value, text });
  });
  return { options, defaultIndex };
}

function isSpringSummerTerm(selectedText) {
  return /第二学期|春|夏/.test(selectedText || '');
}

async function resolveTermSelection() {
  let controlDoc = null;
  let controlFrame = findControlFrame(window);

  if (controlFrame) {
    controlDoc = controlFrame.document;
  } else {
    controlDoc = await fetchControlDoc();
  }

  const select = controlDoc.querySelector('#xnxq');
  if (!select) {
    throw new Error('未找到学期选择器，请先登录并打开“学生个人课表”页面');
  }

  const { options, defaultIndex } = parseSelectOptions(select);
  if (!options.length) {
    throw new Error('未读取到学期列表，请先进入“学生个人课表”页面');
  }

  const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
    '选择学期',
    JSON.stringify(options.map(item => item.text)),
    defaultIndex
  );
  if (selectedIndex === null || selectedIndex === -1) {
    throw new Error('已取消学期选择');
  }

  const selected = options[selectedIndex];
  const [xn, xq] = String(selected.value).split('-');
  if (!xn || typeof xq === 'undefined') {
    throw new Error(`学期值解析失败: ${selected.value}`);
  }

  let encodedParams = extractParamsFromHtml(controlDoc.documentElement.outerHTML);
  if (!encodedParams) {
    const timetableFrame = findTimetableFrame(window);
    if (timetableFrame) {
      const url = new URL(timetableFrame.location.href);
      encodedParams = url.searchParams.get('params') || '';
    }
  }

  const xh = parseXhFromEncodedParams(encodedParams);
  if (!xh) {
    throw new Error('未读取到学号参数，请先点击进入“学生个人课表”后再导入');
  }

  return {
    xn,
    xq,
    xh,
    selectedValue: selected.value,
    selectedText: selected.text,
    isSpringSummer: isSpringSummerTerm(selected.text)
  };
}

function findTable(doc) {
  return doc.getElementById('mytable')
    || Array.from(doc.querySelectorAll('table')).find(table => {
      const text = cleanText(table.innerText);
      return text.includes('星期一') && text.includes('[');
    })
    || null;
}

function parseCellByDivBlocks(cell, day) {
  const blocks = Array.from(cell.querySelectorAll('div[style*="padding-bottom:5px"], div[style*="padding-bottom: 5px"]'));
  if (!blocks.length) return [];

  const items = [];
  blocks.forEach((block) => {
    const lines = block.innerText
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean);
    const joined = lines.join('\n');
    const match = joined.match(/([\d,-单双]+)\[(\d+)-(\d+)\]/);
    if (!match) return;

    const before = joined.slice(0, match.index).split(/\n+/).map(cleanText).filter(Boolean);
    const after = joined.slice(match.index + match[0].length).split(/\n+/).map(cleanText).filter(Boolean);

    const name = before[0] || '';
    const teacher = before[1] || '';
    if (!name) return;

    const weeks = parseWeeks(match[1]);
    const startSection = parseInt(match[2], 10);
    const endSection = parseInt(match[3], 10);
    if (!weeks.length) return;

    items.push({
      name,
      teacher,
      position: after.join(' '),
      day,
      startSection,
      endSection,
      weeks
    });
  });
  return items;
}

function parseCellByTextFallback(cell, day) {
  const lines = cell.innerText
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);
  if (!lines.length) return [];

  const items = [];
  const textLines = lines.map(line => {
    const m = line.match(/^(.+?)\s+([\d,\-单双]+)\[(\d+)-(\d+)\]\s+(.+)$/);
    if (m) {
      return { raw: line, match: { nameTeacher: m[1], weeks: parseWeeks(m[2]), startSection: parseInt(m[3], 10), endSection: parseInt(m[4], 10), position: m[5] } };
    }
    return { raw: line, match: null };
  });

  const timeBlocks = textLines.filter(tl => tl.match);
  timeBlocks.forEach((tl) => {
    const m = tl.match;
    const name = cleanText(m.nameTeacher).replace(/\s+/g, '');
    items.push({
      name,
      teacher: '',
      position: m.position,
      day,
      startSection: m.startSection,
      endSection: m.endSection,
      weeks: m.weeks
    });
  });

  return items;
}

function parseAndMergeQingguoTable(doc) {
  const table = findTable(doc);
  if (!table) {
    throw new Error('未找到课表表格，请先进入“学生个人课表”页面');
  }

  const rawItems = [];
  Array.from(table.rows).forEach((row) => {
    const cells = Array.from(row.cells);
    if (cells.length < 7) return;

    cells.forEach((cell, colIndex) => {
      const distanceToLast = cells.length - 1 - colIndex;
      if (distanceToLast > 6) return;
      const day = 7 - distanceToLast;
      const rawText = cleanText(cell.innerText);
      if (!rawText.includes('[')) return;

      const divParsed = parseCellByDivBlocks(cell, day);
      if (divParsed.length) {
        rawItems.push(...divParsed);
        return;
      }

      const textParsed = parseCellByTextFallback(cell, day);
      if (textParsed.length) {
        rawItems.push(...textParsed);
        return;
      }
    });
  });

  const groupMap = new Map();
  rawItems.forEach((item) => {
    if (!item || !item.name || !item.weeks.length) return;
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

  return finalCourses;
}

async function loadTimetableDoc(term) {
  const currentTableFrame = findTimetableFrame(window);
  if (currentTableFrame && currentTableFrame.document.getElementById('mytable')) {
    const currentUrl = new URL(currentTableFrame.location.href);
    const currentParams = currentUrl.searchParams.get('params') || '';
    const decoded = decodeParams(currentParams);
    if (decoded.includes(`xn=${term.xn}`) && decoded.includes(`xq=${term.xq}`)) {
      return currentTableFrame.document;
    }
  }
  return await fetchTimetableDoc(term.xn, term.xq, term.xh);
}

async function runImportFlow() {
  try {
    const confirmed = await window.shiguangBridgePromise.showAlert(
      '信阳农林学院教务导入',
      '请确认你已登录教务系统，并且最好已经打开“学生个人课表”页面。',
      '确定，开始导入'
    );
    if (!confirmed) return;

    const term = await resolveTermSelection();
    window.shiguangBridge.showToast('正在提取青果课表数据...');

    const timeSlots = term.isSpringSummer ? TIME_SLOTS_SPRING_SUMMER : TIME_SLOTS_AUTUMN_WINTER;

    const doc = await loadTimetableDoc(term);
    const courses = parseAndMergeQingguoTable(doc);
    if (!courses.length) {
      throw new Error('未找到有效课程，请确认当前学期课表已正常显示');
    }

    const allWeeks = courses.flatMap(course => course.weeks);
    const semesterTotalWeeks = allWeeks.length ? Math.max(...allWeeks) : 20;

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks,
      semesterStartDate: null,
      firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
    window.shiguangBridge.notifyTaskCompletion();
  } catch (error) {
    console.error(error);
    window.shiguangBridge.showToast(`导入失败: ${error.message}`);
  }
}

runImportFlow();
