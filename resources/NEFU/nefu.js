/* 东北林业大学本部本科生院：强智个人课表导入。
 * 维护者：Chr0n0stasis。沿用已登录会话，不处理登录或保存凭据。
 * 桥接及合并规则参考拾光官方 Wiki，测试见 tests/NEFU。
 */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else void api.runImportFlow(window);
})(function () {
  'use strict';
  const ORIGIN = 'https://jwxt.nefu.edu.cn';
  const PATH = '/jsxsd/xskb/xskb_list.do';
  function fail(code, message) {
    const error = new Error(message); error.code = code; throw error;
  }
  const text = element => (element?.textContent || '').replace(/\s+/g, ' ').trim();
  function numbers(value, maximum, label) {
    const source = String(value).replace(/\s/g, '').replace(/[，、]/g, ',').replace(/[－–—~～]/g, '-');
    if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(source)) fail('INVALID_RANGE', `${label}格式不支持：${value}`);
    const result = new Set();
    for (const part of source.split(',')) {
      const [a, b = a] = part.split('-').map(Number);
      if (a < 1 || b < a || b > maximum) fail('INVALID_RANGE', `${label}越界或倒序：${value}`);
      for (let n = a; n <= b; n++) result.add(n);
    }
    return [...result].sort((a, b) => a - b);
  }
  function parseTime(value) {
    // 本校已观察到 1-5,7-8周[1-2节]；单双周分支只在 HTML 明确写出时采用。
    const match = String(value).replace(/\s/g, '').match(/^([\d,，、\-－–—~～]+)(单|双)?周(?:[（(](单|双)周?[)）])?\[([\d,，、\-－–—~～]+)节\]$/);
    if (!match) fail('INVALID_TIME', `课程时间格式不支持：${value}`);
    let weeks = numbers(match[1], 60, '周次');
    if (match[2] && match[3] && match[2] !== match[3]) fail('INVALID_TIME', '单双周标记相互矛盾');
    const parity = match[2] || match[3];
    if (parity) weeks = weeks.filter(w => w % 2 === (parity === '单' ? 1 : 0));
    if (!weeks.length) fail('INVALID_TIME', '单双周过滤后没有有效周次');
    const sections = numbers(match[4], 48, '节次');
    const ranges = [];
    for (const section of sections) {
      const last = ranges[ranges.length - 1];
      if (last && section === last[1] + 1) last[1] = section;
      else ranges.push([section, section]);
    }
    return { weeks, ranges };
  }
  function metadata(doc) {
    if (doc.querySelector('#userAccount, #userPassword') || /登录/.test(doc.title || '')) fail('LOGIN_REQUIRED', '请先在教务系统中登录；登录页不是空课表');
    const options = id => {
      const select = doc.querySelector(`#${id}`);
      if (!select) fail('NOT_TIMETABLE', `缺少 ${id}，可能是外层框架、登录页或错误页面`);
      return { selected: select.value, items: [...select.options].map(o => ({ value: o.value, label: text(o) })) };
    };
    return { semesters: options('xnxq01id'), modes: options('kbjcmsid'), weeks: options('zc') };
  }
  function headerMap(table) {
    const headers = [...(table.tHead?.rows[0]?.cells || [])];
    const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    const days = headers.map(cell => {
      const m = text(cell).match(/^(?:星期|周)([一二三四五六日天])$/);
      return m ? digits[m[1]] : null;
    });
    if (headers.length !== 8 || days[0] !== null || new Set(days.slice(1)).size !== 7 || days.slice(1).some(d => !d)) fail('BAD_HEADER', '课表必须能明确识别星期一至星期日');
    if (headers.some(h => h.colSpan !== 1 || h.rowSpan !== 1)) fail('BAD_HEADER', '暂不支持合并表头');
    return days;
  }
  function parseDocument(doc, expected = {}) {
    const meta = metadata(doc);
    for (const [key, actual] of [['semesterId', meta.semesters.selected], ['modeId', meta.modes.selected], ['week', meta.weeks.selected]]) {
      if (expected[key] !== undefined && String(expected[key]) !== actual) fail('QUERY_MISMATCH', `服务器返回的 ${key} 与请求不一致`);
    }
    const tables = [...doc.querySelectorAll('table.qz-weeklyTable')];
    if (tables.length !== 1) fail('NOT_TIMETABLE', '未发现唯一的正式周课表，不能按空课表处理');
    const table = tables[0], days = headerMap(table);
    const rows = [...table.tBodies].flatMap(body => [...body.rows]);
    if (!rows.length) fail('BAD_GRID', '缺少节次行');
    const grid = rows.map(() => Array(8));
    const teachingBlocks = [], allSections = new Set(), cells = [];
    let cardCount = 0;
    rows.forEach((row, rowIndex) => {
      let column = 0;
      // row.cells 只含当前 tr 的实际子单元格；rowspan 占位仅写入 grid。
      // 下方行跳过占位，不会再次遍历或统计同一个 td。
      for (const cell of row.cells) {
        while (column < 8 && grid[rowIndex][column]) column++;
        const height = cell.rowSpan, width = cell.colSpan;
        if (height < 1 || rowIndex + height > rows.length || column + width > 8) fail('BAD_GRID', '课表单元格跨行或跨列越界');
        for (let r = rowIndex; r < rowIndex + height; r++) for (let c = column; c < column + width; c++) {
          if (grid[r][c]) fail('BAD_GRID', '课表合并单元格重叠');
          grid[r][c] = cell;
        }
        if (column === 0) {
          if (cell.getAttribute('name') !== 'timeTd' || width !== 1 || height !== 1) fail('BAD_GRID', '节次标签结构已变化');
          const label = text(cell), sectionMatch = label.match(/[（(]([\d、,，\s]+)小节[)）]/);
          if (!sectionMatch) fail('BAD_GRID', '无法读取行标签中的小节编号');
          const sections = numbers(sectionMatch[1], 48, '节次行');
          sections.forEach(s => allSections.add(s));
          const clock = label.match(/(\d{2}:\d{2})\s*[~～\-]\s*(\d{2}:\d{2})/);
          teachingBlocks.push({ sections, startTime: clock?.[1] || null, endTime: clock?.[2] || null });
        } else {
          if (cell.getAttribute('name') !== 'kbDataTd' || width !== 1) fail('BAD_GRID', '课程单元格类型或跨列发生变化');
          const lists = [...cell.querySelectorAll('ul[name="kbdataUl"]')];
          if (lists.length !== 1) fail('BAD_GRID', '缺少唯一课程列表');
          const items = [...lists[0].children];
          if (items.some(e => !e.matches('li.courselists-item'))) fail('BAD_CARD', '出现未知课程卡片结构');
          const declaredText = lists[0].getAttribute('kbdatasize');
          if (declaredText !== null && (!/^\d+$/.test(declaredText) || Number(declaredText) !== items.length)) fail('BAD_CARD', '页面课程计数与卡片数不一致');
          cardCount += items.length;
          cells.push({ day: days[column], items });
        }
        column += width;
      }
      if (grid[rowIndex].filter(Boolean).length !== 8) fail('BAD_GRID', '课表行不完整，禁止猜测星期');
    });
    const courses = [], seen = new Set();
    for (const { day, items } of cells) for (const item of items) {
      const name = text(item.querySelector('.qz-hasCourse-title'));
      const detail = text(item.querySelector('.qz-hasCourse-abbrinfo'));
      const fields = detail.match(/^老师[:：](.*?)[;；]时间[:：](.*?)[;；]地点[:：](.*)$/);
      if (!name || !fields) fail('BAD_CARD', '课程名称或老师/时间/地点字段结构不完整');
      const { weeks, ranges } = parseTime(fields[2]);
      for (const [startSection, endSection] of ranges) {
        for (let s = startSection; s <= endSection; s++) if (!allSections.has(s)) fail('BAD_CARD', '课程节次不在所选作息模式中');
        const course = { name, teacher: fields[1].trim(), position: fields[3].trim(), day, weeks: [...weeks], startSection, endSection };
        const key = JSON.stringify(course);
        if (!seen.has(key)) { seen.add(key); courses.push(course); }
      }
    }
    const remarks = [...table.querySelectorAll('tfoot .qz-weeklyTable-detailtext')].map(text).filter(Boolean);
    return {
      status: courses.length ? 'ok' : 'scheduled-empty',
      semesterId: meta.semesters.selected, modeId: meta.modes.selected, week: meta.weeks.selected,
      metadata: meta, courses, remarks, teachingBlocks,
      statistics: { sourceCards: cardCount, courseRecords: courses.length, distinctCourseNames: new Set(courses.map(c => c.name)).size },
      warnings: [
        ...(remarks.length ? ['存在未排具体星期/节次的备注项目；未伪造课程时间，请另行核对。'] : []),
        '仅导入课程，保留原有作息和学期设置。'
      ]
    };
  }
  function parseHTML(html, expected = {}) {
    if (typeof DOMParser === 'undefined') fail('NO_DOM', 'HTML 解析需要浏览器 DOMParser');
    return parseDocument(new DOMParser().parseFromString(html, 'text/html'), expected);
  }
  // 按周合并同名、同教师、同地点、同星期的连续节次，再汇总相同时段的周次。
  // 先按周拆分，避免把部分周次的调课扩展到整个学期。
  function mergeCourses(courses) {
    const groups = new Map();
    for (const course of courses) {
      const key = JSON.stringify([course.name, course.teacher, course.position, course.day]);
      if (!groups.has(key)) groups.set(key, { course, weeks: new Map() });
      const group = groups.get(key);
      for (const week of new Set(course.weeks)) {
        if (!group.weeks.has(week)) group.weeks.set(week, []);
        group.weeks.get(week).push([course.startSection, course.endSection]);
      }
    }
    const result = [];
    for (const { course, weeks } of groups.values()) {
      const ranges = new Map();
      for (const [week, intervals] of [...weeks].sort((a, b) => a[0] - b[0])) {
        intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const merged = [];
        for (const [start, end] of intervals) {
          const last = merged[merged.length - 1];
          if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
          else merged.push([start, end]);
        }
        for (const [startSection, endSection] of merged) {
          const key = startSection + ':' + endSection;
          if (!ranges.has(key)) ranges.set(key, {
            name: course.name, teacher: course.teacher, position: course.position,
            day: course.day, startSection, endSection, weeks: []
          });
          ranges.get(key).weeks.push(week);
        }
      }
      result.push(...ranges.values());
    }
    return result.sort((a, b) => a.day - b.day || a.startSection - b.startSection ||
      a.endSection - b.endSection || a.name.localeCompare(b.name) ||
      a.teacher.localeCompare(b.teacher) || a.position.localeCompare(b.position) ||
      a.weeks[0] - b.weeks[0]);
  }

  function createClient(environment) {
    const env = environment || globalThis;
    if (env.location?.origin !== ORIGIN) fail('WRONG_ORIGIN', '请在东北林业大学教务系统中执行导入');
    async function getHTML(params) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await env.fetch(PATH + '?' + new URLSearchParams(params), {
          method: 'GET', credentials: 'same-origin', signal: controller.signal
        });
        if (!response.ok) fail('HTTP_ERROR', '教务响应 HTTP ' + response.status);
        if (new URL(response.url, ORIGIN).origin !== ORIGIN) fail('LOGIN_REQUIRED', '登录已失效，请重新登录');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        metadata(doc);
        return doc;
      } catch (error) {
        if (error.name === 'AbortError') fail('TIMEOUT', '教务请求超时，请稍后重试');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return Object.freeze({
      async options() { return metadata(await getHTML({ viweType: '0' })); },
      async load({ semesterId, modeId, week = '' } = {}, available) {
        const meta = available || await this.options();
        const semester = semesterId ?? meta.semesters.selected;
        const mode = modeId ?? meta.modes.items.find(o => o.label === '本部')?.value ?? meta.modes.selected;
        if (!meta.semesters.items.some(o => o.value === semester)) fail('BAD_SELECTION', '学期不在教务返回的选项内');
        if (!meta.modes.items.some(o => o.value === mode)) fail('BAD_SELECTION', '作息模式不在教务返回的选项内');
        if (String(week) !== '' && !/^(?:[1-9]|[1-5]\d|60)$/.test(String(week))) fail('BAD_SELECTION', '周次必须为空或 1 到 60 的整数');
        const doc = await getHTML({ viweType: '0', xnxq01id: semester, kbjcmsid: mode, zc: String(week) });
        return parseDocument(doc, { semesterId: semester, modeId: mode, week: String(week) });
      }
    });
  }

  async function runImportFlow(env) {
    const bridge = env.shiguangBridgePromise;
    const ui = env.shiguangBridge;
    try {
      const client = createClient(env);
      const meta = await client.options();
      const index = await bridge.showSingleSelection(
        '选择学期（本部本科生院）',
        JSON.stringify(meta.semesters.items.map(item => item.label)),
        meta.semesters.items.findIndex(item => item.value === meta.semesters.selected)
      );
      if (index === null) return { status: 'cancelled' };
      if (!Number.isInteger(index) || index < 0 || index >= meta.semesters.items.length) {
        fail('BAD_SELECTION', '学期选择无效');
      }
      ui.showToast('正在读取课程；本次保留原有作息和学期设置。');
      const result = await client.load({ semesterId: meta.semesters.items[index].value }, meta);
      const courses = mergeCourses(result.courses);
      if (result.remarks.length) ui.showToast('教务另有未排具体时间的备注项目，请在教务课表中查看。');
      // 沿用 App 的目标课表选择和覆盖流程。正常空课表也按完整查询结果提交。
      if (await bridge.saveImportedCourses(JSON.stringify(courses)) !== true) {
        fail('SAVE_FAILED', '课程保存失败，请重试');
      }
      ui.showToast(courses.length ? '已导入 ' + courses.length + ' 条排课记录。' : '该学期没有已排时间的课程，已导入空课表。');
      ui.notifyTaskCompletion();
      return { status: 'saved', count: courses.length };
    } catch (error) {
      const message = error.code ? error.message : '网络或导入操作失败，请检查登录状态后重试';
      if (ui) ui.showToast('导入失败：' + message);
      return { status: 'error', code: error.code || 'IMPORT_FAILED' };
    }
  }
  return Object.freeze({ numbers, parseTime, metadata, parseDocument, parseHTML, mergeCourses, createClient, runImportFlow });
});
