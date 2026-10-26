const BASE = `${window.location.origin}/jwglxt`;
const INDEX_PATH = '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
const COURSE_API_PATH = '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';

const TIME_SLOTS = [
  { number: 1, startTime: '08:10', endTime: '08:50' },
  { number: 2, startTime: '09:00', endTime: '09:40' },
  { number: 3, startTime: '09:50', endTime: '10:30' },
  { number: 4, startTime: '10:40', endTime: '11:20' },
  { number: 5, startTime: '11:30', endTime: '12:10' },
  { number: 6, startTime: '14:10', endTime: '14:50' },
  { number: 7, startTime: '15:00', endTime: '15:40' },
  { number: 8, startTime: '15:50', endTime: '16:30' },
  { number: 9, startTime: '16:40', endTime: '17:20' },
  { number: 10, startTime: '18:30', endTime: '19:10' },
  { number: 11, startTime: '19:20', endTime: '20:00' },
  { number: 12, startTime: '20:10', endTime: '20:50' },
  { number: 13, startTime: '21:00', endTime: '21:40' },
];

async function req(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      'accept': '*/*'
    },
    body
  });
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return await res.text();
}

function isOnTimetablePage() {
  return window.location.pathname === '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html';
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
  const html = await fetch(`${BASE}${INDEX_PATH}`, { credentials: 'include' }).then(res => {
    if (!res.ok) throw new Error(`课表页请求失败: ${res.status}`);
    return res.text();
  });
  return new DOMParser().parseFromString(html, 'text/html');
}

async function selectTermByUserFromDoc(doc) {
  const { yearData, semesterData } = parseTermOptionsFromDoc(doc);

  const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
    '选择学年',
    JSON.stringify(yearData.options.map(item => item.text)),
    yearData.defaultIndex
  );
  if (yearIndex === null || yearIndex === -1) throw new Error('已取消学年选择');

  const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
    '选择学期',
    JSON.stringify(semesterData.options.map(item => item.text)),
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
  String(zcd).replace(/\s+/g, '').split(/[,，]/).forEach((seg) => {
    const odd = seg.includes('单');
    const even = seg.includes('双');
    const normalized = seg.replace(/周|\(|\)|单|双/g, '');
    const match = normalized.match(/(\d+)(?:-(\d+))?/);
    if (!match) return;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    for (let week = start; week <= end; week++) {
      if (odd && week % 2 === 0) continue;
      if (even && week % 2 !== 0) continue;
      result.add(week);
    }
  });
  return [...result].sort((a, b) => a - b);
}

function parseCourses(data) {
  if (!data || !Array.isArray(data.kbList)) {
    return { courses: [], xqhId: '1' };
  }

  const courses = [];
  let xqhId = '1';

  data.kbList.forEach((course) => {
    if (course.xqh_id) xqhId = String(course.xqh_id).trim() || xqhId;

    const day = Number(course.xqj);
    const secRaw = String(course.jcs || course.jc || '').replace(/节/g, '').trim();
    const sectionNums = (secRaw.match(/\d+/g) || []).map(Number).filter(n => !Number.isNaN(n));
    const weeks = parseWeeks(course.zcd);

    if (!course.kcmc || !sectionNums.length || !weeks.length || !(day >= 1 && day <= 7)) return;

    courses.push({
      name: String(course.kcmc).trim(),
      teacher: String(course.xm || '未知').trim(),
      position: String(course.cdmc || course.cdbh || '未排地点').trim(),
      day,
      startSection: sectionNums[0],
      endSection: sectionNums[sectionNums.length - 1],
      weeks
    });
  });

  const deduped = new Map();
  courses.forEach((course) => {
    const key = `${course.name}|${course.teacher}|${course.position}|${course.day}|${course.startSection}|${course.endSection}|${course.weeks.join(',')}`;
    if (!deduped.has(key)) deduped.set(key, course);
  });

  return { courses: [...deduped.values()], xqhId };
}

async function fetchCourses(xnm, xqm) {
  const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
  const text = await req(`${BASE}${COURSE_API_PATH}`, 'POST', body);
  return JSON.parse(text);
}

async function run() {
  try {
    const { xnm, xqm } = await resolveTerm();
    window.shiguangBridge.showToast('正在解析课表数据...');

    const rawData = await fetchCourses(xnm, xqm);
    const { courses } = parseCourses(rawData);
    if (!courses.length) throw new Error('未获取到课表数据');

    const allWeeks = courses.flatMap(course => course.weeks);
    const semesterTotalWeeks = allWeeks.length ? Math.max(...allWeeks) : 20;

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterTotalWeeks,
      semesterStartDate: null,
      firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    window.shiguangBridge.showToast(`导入成功：${courses.length} 门`);
    window.shiguangBridge.notifyTaskCompletion();
  } catch (error) {
    console.error(error);
    window.shiguangBridge.showToast(`导入失败: ${error.message}`);
  }
}

run();
