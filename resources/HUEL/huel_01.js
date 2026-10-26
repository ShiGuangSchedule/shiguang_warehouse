const BASE = 'https://xk.huel.edu.cn/jwglxt';

const TIME_SLOTS = [
  { number: 1, startTime: '08:00', endTime: '08:45' },
  { number: 2, startTime: '08:55', endTime: '09:40' },
  { number: 3, startTime: '09:55', endTime: '10:40' },
  { number: 4, startTime: '10:50', endTime: '11:35' },
  { number: 5, startTime: '11:45', endTime: '12:30' },
  { number: 6, startTime: '13:30', endTime: '14:15' },
  { number: 7, startTime: '14:25', endTime: '15:10' },
  { number: 8, startTime: '15:25', endTime: '16:10' },
  { number: 9, startTime: '16:20', endTime: '17:05' },
  { number: 10, startTime: '17:15', endTime: '18:00' },
  { number: 11, startTime: '19:00', endTime: '19:45' },
  { number: 12, startTime: '19:50', endTime: '20:35' },
  { number: 13, startTime: '20:40', endTime: '21:25' }
];

async function req(url, method, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest'
    },
    body
  });
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return await res.text();
}

function isOnTimetablePage() {
  const path = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html';
  return window.location.origin === 'https://xk.huel.edu.cn' && window.location.pathname === path;
}

function readCurrentPageTerm() {
  const xnmEl = document.querySelector('#xnm');
  const xqmEl = document.querySelector('#xqm');
  const xnm = xnmEl ? String(xnmEl.value || '').trim() : '';
  const xqm = xqmEl ? String(xqmEl.value || '').trim() : '';
  if (!xnm || !xqm) throw new Error('当前课表页未读到学年学期，请先选择后再导入');
  return { xnm, xqm };
}

function parseSelectOptions(selectEl) {
  if (!selectEl) return { options: [], defaultIndex: 0 };
  const options = [];
  let defaultIndex = 0;
  Array.from(selectEl.querySelectorAll('option')).forEach((opt) => {
    const value = String(opt.value || '').trim();
    if (!value) return;
    const text = String(opt.textContent || '').trim() || value;
    if (opt.selected) defaultIndex = options.length;
    options.push({ value, text });
  });
  return { options, defaultIndex };
}

function parseTermOptionsFromDoc(doc) {
  const yearData = parseSelectOptions(doc.querySelector('#xnm'));
  const semesterData = parseSelectOptions(doc.querySelector('#xqm'));
  if (!yearData.options.length || !semesterData.options.length) {
    throw new Error('课表页学年学期选项解析失败');
  }
  return { yearData, semesterData };
}

async function fetchIndexDoc() {
  const html = await req(`${BASE}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`, 'GET');
  return new DOMParser().parseFromString(html, 'text/html');
}

async function selectTermByUserFromDoc(doc) {
  const { yearData, semesterData } = parseTermOptionsFromDoc(doc);

  const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
    '选择学年',
    JSON.stringify(yearData.options.map(i => i.text)),
    yearData.defaultIndex
  );
  if (yearIndex === null || yearIndex === -1) throw new Error('已取消学年选择');

  const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
    '选择学期',
    JSON.stringify(semesterData.options.map(i => i.text)),
    semesterData.defaultIndex
  );
  if (semesterIndex === null || semesterIndex === -1) throw new Error('已取消学期选择');

  return {
    xnm: yearData.options[yearIndex].value,
    xqm: semesterData.options[semesterIndex].value
  };
}

async function resolveTerm() {
  if (isOnTimetablePage()) {
    return readCurrentPageTerm();
  }
  const doc = await fetchIndexDoc();
  return await selectTermByUserFromDoc(doc);
}

function parseWeeks(zcd) {
  if (!zcd) return [];
  const result = new Set();
  String(zcd).replace(/\s+/g, '').split(/[,，]/).forEach(seg => {
    const odd = seg.includes('单');
    const even = seg.includes('双');
    const m = seg.replace(/周|\(|\)|单|双/g, '').match(/(\d+)(?:-(\d+))?/);
    if (!m) return;
    const start = Number(m[1]);
    const end = Number(m[2] || m[1]);
    for (let w = start; w <= end; w++) {
      if (odd && w % 2 === 0) continue;
      if (even && w % 2 !== 0) continue;
      result.add(w);
    }
  });
  return [...result].sort((a, b) => a - b);
}

function parseCourses(data) {
  if (!data || !Array.isArray(data.kbList)) return [];
  const courses = [];

  data.kbList.forEach(c => {
    const day = Number(c.xqj);
    const secRaw = String(c.jcs || '').replace(/节/g, '').trim();
    const sectionNums = (secRaw.match(/\d+/g) || []).map(Number).filter(n => !Number.isNaN(n));
    const weeks = parseWeeks(c.zcd);
    if (!c.kcmc || !sectionNums.length || !weeks.length || !(day >= 1 && day <= 7)) return;
    const startSection = sectionNums[0];
    const endSection = sectionNums[sectionNums.length - 1];

    courses.push({
      name: String(c.kcmc).trim(),
      teacher: String(c.xm || '未知').trim(),
      position: String(c.cdmc || c.cdbh || '未排地点').trim(),
      day,
      startSection,
      endSection,
      weeks
    });
  });

  const map = new Map();
  courses.forEach(c => {
    const k = `${c.name}|${c.teacher}|${c.day}|${c.startSection}|${c.endSection}|${c.weeks.join(',')}|${c.position}`;
    if (!map.has(k)) map.set(k, c);
  });
  return [...map.values()];
}

function validateSemesterStartDateInput(input) {
  const v = String(input || '').trim();
  if (!v) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? false : '请输入 YYYY-MM-DD，例如 2026-02-24';
}

async function selectSemesterStartDate(xnm, xqm) {
  const defaultDate = xqm === '3' ? `${xnm}-09-01` : `${Number(xnm) + 1}-03-01`;
  const picked = await window.shiguangBridgePromise.showPrompt(
    '选择开学日期',
    '请输入开学日期（YYYY-MM-DD）',
    defaultDate,
    'validateSemesterStartDateInput'
  );
  if (picked === null) return null;
  const value = String(picked).trim();
  return value || null;
}

async function run() {
  try {
    const { xnm, xqm } = await resolveTerm();

    const body = `xnm=${xnm}&xqm=${xqm}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
    const text = await req(`${BASE}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`, 'POST', body);
    const data = JSON.parse(text);

    const courses = parseCourses(data);
    if (!courses.length) {
      window.shiguangBridge.showToast('导入失败: 未获取到课表数据');
      return;
    }

    const semesterStartDate = await selectSemesterStartDate(xnm, xqm);
    const allWeeks = courses.flatMap(c => c.weeks);
    const maxWeek = allWeeks.length ? Math.max(...allWeeks) : 20;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks: maxWeek,
      semesterStartDate: semesterStartDate,
      firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast(`导入成功：${courses.length} 门`);
    window.shiguangBridge.notifyTaskCompletion();
  } catch (e) {
    console.error(e);
    window.shiguangBridge.showToast(`导入失败: ${e.message}`);
  }
}

run();