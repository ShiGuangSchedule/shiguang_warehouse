// 福州英华职业学院（fzacc.com）青果教务适配
// 接口取数，不解析页面 DOM；当前学期自动识别，无需手动选学期
(function () {
  'use strict';

  var LOGIN_TIP = '请先在教务系统完成登录，再点击"执行导入"';

  // 2021-05-31 起执行的教学作息时间（教务处通知），共 11 节
  var TIME_SLOTS = [
    { number: 1, startTime: '08:30', endTime: '09:10' },
    { number: 2, startTime: '09:20', endTime: '10:00' },
    { number: 3, startTime: '10:15', endTime: '10:55' },
    { number: 4, startTime: '11:05', endTime: '11:45' },
    { number: 5, startTime: '14:00', endTime: '14:40' },
    { number: 6, startTime: '14:50', endTime: '15:30' },
    { number: 7, startTime: '15:40', endTime: '16:20' },
    { number: 8, startTime: '16:30', endTime: '17:10' },
    { number: 9, startTime: '17:20', endTime: '18:00' },
    { number: 10, startTime: '19:00', endTime: '19:40' },
    { number: 11, startTime: '19:50', endTime: '20:30' },
  ];

  var bridge = window.shiguangBridge || window.AndroidBridge || {};
  var bridgeP = window.shiguangBridgePromise || window.AndroidBridgePromise || {};

  function toast(msg) {
    try { bridge.showToast(msg); } catch (e) {}
  }

  // 项目根，形如 https://jwxt.fzacc.com/fzyhjw/
  function webRoot() {
    var m = location.pathname.match(/^(\/[^\/]+\/)/);
    return location.origin + (m ? m[1] : '/');
  }

  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function getText(url, options) {
    var res = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
  }

  // 当前学年学期 + 内部学号
  async function fetchTerm(root) {
    var res = await fetch(root + 'jw/common/showYearTerm.action', { credentials: 'include' });
    var data = await res.json();
    if (!data || !data.xn || data.xqM === undefined || !data.userCode) {
      throw new Error('NOT_LOGIN');
    }
    return {
      xn: String(data.xn),
      xq: String(data.xqM),
      xh: String(data.userCode),
      name: data.xqName || '',
    };
  }

  // 校历：返回第 1 周周一日期
  async function fetchStartDate(root, term) {
    try {
      var body = 'menucode=&xn=' + term.xn + '&xq_m=' + term.xq + '&rad=1' +
        '&sel_xn_xq=' + term.xn + '-' + term.xq + '&btnQry=' + encodeURIComponent('检索');
      var html = await getText(root + 'public/SchoolCalendar.show.jsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body,
      });
      var doc = new DOMParser().parseFromString(stripCharset(html), 'text/html');
      var month = '';
      var rows = doc.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        var cells = rows[i].cells;
        if (cells.length < 2) continue;
        var c0 = (cells[0].textContent || '').trim();
        if (c0 === '月份') {
          month = (cells[1].textContent || '').trim();
          continue;
        }
        if (!/^\d{1,2}$/.test(c0)) continue;
        if (parseInt(c0, 10) !== 1) continue;
        for (var j = 1; j < cells.length && j <= 7; j++) {
          var day = (cells[j].textContent || '').trim();
          if (/^\d{1,2}$/.test(day) && /^\d{4}-\d{2}$/.test(month)) {
            return month + '-' + (day.length < 2 ? '0' + day : day);
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function stripCharset(html) {
    return html.replace(/charset\s*=\s*["']?gbk["']?/gi, 'charset=utf-8');
  }

  // DOMParser 文档不在渲染树里，innerText 不可用，用 <br> 切行 + textContent
  function linesOf(el, doc) {
    var html = (el.innerHTML || '').replace(/<br\s*\/?>/gi, '\n');
    var box = doc.createElement('div');
    box.innerHTML = html;
    return (box.textContent || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function parseWeeks(str) {
    var weeks = [];
    var single = /单/.test(str);
    var double = /双/.test(str);
    var clean = str.replace(/[（(][^)）]*[)）]/g, '');
    clean.split(/[,，]/).forEach(function (part) {
      part = part.trim();
      var range = part.match(/(\d+)\s*-\s*(\d+)/);
      if (range) {
        for (var w = parseInt(range[1], 10); w <= parseInt(range[2], 10); w++) {
          if (single && w % 2 === 0) continue;
          if (double && w % 2 === 1) continue;
          weeks.push(w);
        }
      } else {
        var n = parseInt(part.replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) weeks.push(n);
      }
    });
    return weeks.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
  }

  function cellBlocks(cell, doc) {
    var blocks = [];
    var divs = cell.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var lines = linesOf(divs[i], doc);
      if (!lines.length || lines.join('').indexOf('[') === -1) continue;
      for (var k = 0; k < lines.length; k++) {
        var m = lines[k].match(/^([\d,，\-\s单双（）()]*)\[(\d+)\s*-\s*(\d+)\]\s*$/);
        if (!m) continue;
        var name = lines[k - 2] || lines[k - 1] || '';
        var teacher = k >= 2 ? (lines[k - 1] || '') : '';
        var position = lines[k + 1] || '';
        blocks.push({
          name: name,
          teacher: teacher,
          position: position,
          startSection: parseInt(m[2], 10),
          endSection: parseInt(m[3], 10),
          weeks: parseWeeks(m[1]),
        });
        break;
      }
    }
    return blocks;
  }

  function parseSchedule(html) {
    var doc = new DOMParser().parseFromString(stripCharset(html), 'text/html');
    var tables = doc.querySelectorAll('table');
    var table = null;
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].textContent.indexOf('星期一') !== -1) { table = tables[i]; break; }
    }
    if (!table) return [];

    var raw = [];
    var rows = table.rows;
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].cells;
      if (cells.length < 8) continue;
      var offset = cells.length - 7;
      for (var d = 0; d < 7; d++) {
        var blocks = cellBlocks(cells[offset + d], doc);
        blocks.forEach(function (b) {
          b.day = d + 1;
          raw.push(b);
        });
      }
    }

    // 同一门课拆成多个周次的块合并回一条
    var map = {};
    raw.forEach(function (b) {
      var key = [b.name, b.teacher, b.position, b.day, b.startSection, b.endSection].join('|');
      if (!map[key]) map[key] = { b: b, weeks: {} };
      b.weeks.forEach(function (w) { map[key].weeks[w] = 1; });
    });

    var courses = [];
    Object.keys(map).forEach(function (key) {
      var item = map[key];
      var weeks = Object.keys(item.weeks).map(Number).sort(function (a, b) { return a - b; });
      if (!weeks.length) return;
      courses.push({
        name: item.b.name,
        teacher: item.b.teacher,
        position: item.b.position,
        day: item.b.day,
        startSection: item.b.startSection,
        endSection: item.b.endSection,
        weeks: weeks,
      });
    });
    courses.sort(function (a, b) {
      return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return courses;
  }

  async function importSchedule() {
    var root = webRoot();
    toast('正在读取学期信息…');

    var term;
    try {
      term = await fetchTerm(root);
    } catch (e) {
      if (e.message === 'NOT_LOGIN') {
        toast(LOGIN_TIP);
        return;
      }
      toast('读取学期失败，请确认已登录');
      return;
    }

    toast('正在获取课表…');
    var params = b64('xn=' + term.xn + '&xq=' + term.xq + '&xh=' + term.xh);
    var url = root + 'student/wsxk.xskcb10319.jsp?params=' + encodeURIComponent(params);
    var html;
    try {
      html = await getText(url);
    } catch (e) {
      toast('课表请求失败，请确认已登录');
      return;
    }
    if (html.indexOf('凭证已失效') !== -1) {
      toast(LOGIN_TIP);
      return;
    }

    var courses = parseSchedule(html);
    if (!courses.length) {
      console.warn('[FZACC] 未解析到课程，课表 HTML 长度 ' + html.length);
      toast('未解析到课程，可能本学期暂无排课');
      return;
    }

    var startDate = await fetchStartDate(root, term);
    if (startDate) {
      try {
        await bridgeP.saveCourseConfig(JSON.stringify({ semesterStartDate: startDate }));
      } catch (e) {}
    }
    try {
      await bridgeP.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    } catch (e) {}

    try {
      await bridgeP.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
      toast('保存课程失败：' + (e.message || e));
      return;
    }

    var names = {};
    var maxWeek = 0;
    var minWeek = 99;
    courses.forEach(function (c) {
      names[c.name] = 1;
      c.weeks.forEach(function (w) {
        if (w > maxWeek) maxWeek = w;
        if (w < minWeek) minWeek = w;
      });
    });
    var nameCount = Object.keys(names).length;

    var lines = [
      '课程：' + nameCount + ' 门（' + courses.length + ' 个课块）',
      '学期：' + term.xn + '-' + (parseInt(term.xn, 10) + 1) + ' 学年' + (term.xq === '0' ? '第一' : '第二') + '学期',
      '周次：第 ' + minWeek + '-' + maxWeek + ' 周',
    ];
    if (startDate) lines.push('开学：' + startDate);
    lines.push('作息时间：已导入 ' + TIME_SLOTS.length + ' 节');

    if (bridgeP.showAlert) {
      await bridgeP.showAlert('导入完成', lines.join('\n'), '确定');
    } else {
      toast('导入完成：' + nameCount + ' 门课程');
    }
    try { bridge.notifyTaskCompletion(); } catch (e) {}
  }

  importSchedule().catch(function (e) {
    console.error('[FZACC] 导入异常', e);
    toast('导入出错：' + (e.message || e));
  });
})();
