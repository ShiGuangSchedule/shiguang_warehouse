// 福州英华职业学院（fzacc.com）青果教务适配
// 接口取数，不解析页面 DOM；学期与作息均从接口读取
(function () {
  'use strict';

  var LOGIN_TIP = '请先在教务系统完成登录，再点击"执行导入"';

  var bridge = window.shiguangBridge || window.AndroidBridge || {};
  var bridgeP = window.shiguangBridgePromise || window.AndroidBridgePromise || {};

  function toast(msg) {
    try { bridge.showToast(msg); } catch (e) {}
  }

  function webRoot() {
    var m = location.pathname.match(/^(\/[^\/]+\/)/);
    return location.origin + (m ? m[1] : '/');
  }

  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // 课表页 GBK、首页组件 UTF-8
  async function getHtml(url, options) {
    var res = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var buf = await res.arrayBuffer();
    var m = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '');
    var enc = m ? m[1].toLowerCase() : 'gbk';
    try { return new TextDecoder(enc).decode(buf); } catch (e) { return new TextDecoder('gbk').decode(buf); }
  }

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
    };
  }

  // 首页课表组件：节次时间 + 学期首周一
  async function fetchDeskInfo(root, term) {
    var url = root + 'frame/desk/showLessonScheduleInfosV14.action?xn=' + term.xn +
      '&xq=' + term.xq + '&jxz=1';
    var html = await getHtml(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: '',
    });

    var slots = {};
    var re = />\s*(\d{1,2})\s*\(\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*\)\s*</g;
    var m;
    while ((m = re.exec(html))) {
      var n = parseInt(m[1], 10);
      slots[n] = { number: n, startTime: m[2], endTime: m[3] };
    }
    var list = Object.keys(slots).map(function (k) { return slots[k]; })
      .sort(function (a, b) { return a.number - b.number; });

    var startDate = null;
    var d = />\s*一\s*<br>\s*(\d{2})-(\d{2})\s*</.exec(html);
    if (d) {
      var mon = parseInt(d[1], 10);
      var year = mon >= 8 ? parseInt(term.xn, 10) : parseInt(term.xn, 10) + 1;
      startDate = year + '-' + d[1] + '-' + d[2];
    }
    return { slots: list, startDate: startDate };
  }

  async function fetchStartDateFromCalendar(root, term) {
    try {
      var body = 'menucode=&xn=' + term.xn + '&xq_m=' + term.xq + '&rad=1' +
        '&sel_xn_xq=' + term.xn + '-' + term.xq + '&btnQry=' + encodeURIComponent('检索');
      var html = await getHtml(root + 'public/SchoolCalendar.show.jsp', {
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
        if (parseInt(c0, 10) !== 1) continue;
        for (var j = 1; j <= 7 && j < cells.length; j++) {
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

  // DOMParser 文档无渲染树，innerText 不可用
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
      html = await getHtml(url);
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

    var desk = { slots: [], startDate: null };
    try { desk = await fetchDeskInfo(root, term); } catch (e) { console.warn('[FZACC] 作息接口失败', e); }
    if (!desk.startDate) desk.startDate = await fetchStartDateFromCalendar(root, term);

    if (desk.startDate) {
      try {
        await bridgeP.saveCourseConfig(JSON.stringify({ semesterStartDate: desk.startDate }));
      } catch (e) {}
    }
    if (desk.slots.length) {
      try {
        await bridgeP.savePresetTimeSlots(JSON.stringify(desk.slots));
      } catch (e) {}
    }

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

    var lines = [
      '课程：' + Object.keys(names).length + ' 门（' + courses.length + ' 个课块）',
      '学期：' + term.xn + '-' + (parseInt(term.xn, 10) + 1) + ' 学年' + (term.xq === '0' ? '第一' : '第二') + '学期',
      '周次：第 ' + minWeek + '-' + maxWeek + ' 周',
    ];
    if (desk.startDate) lines.push('开学：' + desk.startDate);
    if (desk.slots.length) {
      lines.push('作息：' + desk.slots.length + ' 节（第 1 节 ' + desk.slots[0].startTime + '）');
    }

    if (bridgeP.showAlert) {
      await bridgeP.showAlert('导入完成', lines.join('\n'), '确定');
    } else {
      toast('导入完成：' + Object.keys(names).length + ' 门课程');
    }
    try { bridge.notifyTaskCompletion(); } catch (e) {}
  }

  importSchedule().catch(function (e) {
    console.error('[FZACC] 导入异常', e);
    toast('导入出错：' + (e.message || e));
  });
})();
