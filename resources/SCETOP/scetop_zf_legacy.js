// 四川托普信息技术职业学院 · 老正方教务（zf.scetop.com）课表适配
// 目标页面：学生个人课表 xskbcx.aspx / 班级课表查询 tjkbcx.aspx
// 依赖：页面存在 id="Table6" 的 blacktab 周课表格

(function () {
  'use strict';

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function (_, n) {
        return String.fromCharCode(Number(n));
      });
  }

  function stripTags(html) {
    return decodeEntities(String(html).replace(/<[^>]+>/g, ''));
  }

  function parseWeeksAndSections(infoStr) {
    // 10-17(1,2) | 11-17单(1,2) | 2(7,8) | 1-16双(9,10)
    var m = String(infoStr).trim().match(/^(\d+)(?:-(\d+))?([单双])?\(([\d,\s]+)\)$/);
    if (!m) return null;
    var start = parseInt(m[1], 10);
    var end = m[2] ? parseInt(m[2], 10) : start;
    var flag = m[3] || '';
    var sections = m[4]
      .split(',')
      .map(function (x) { return parseInt(String(x).trim(), 10); })
      .filter(function (n) { return Number.isFinite(n); });
    if (!sections.length || start > end) return null;
    var weeks = [];
    for (var i = start; i <= end; i++) {
      if (flag === '单' && i % 2 === 0) continue;
      if (flag === '双' && i % 2 !== 0) continue;
      if (weeks.indexOf(i) === -1) weeks.push(i);
    }
    weeks.sort(function (a, b) { return a - b; });
    return { weeks: weeks, sections: sections };
  }

  function parseCourseBlocks(cellHtml) {
    var text = String(cellHtml)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    text = decodeEntities(text).replace(/\r/g, '');
    return text
      .split(/\n{2,}/)
      .map(function (b) {
        return b
          .split('\n')
          .map(function (l) { return l.trim(); })
          .filter(Boolean);
      })
      .filter(function (b) { return b.length >= 4; });
  }

  function findTable6() {
    var el = document.getElementById('Table6');
    if (el && el.tagName && el.tagName.toLowerCase() === 'table') return el;
    var tables = document.querySelectorAll('table.blacktab, table[id="Table6"], table#Table6');
    for (var i = 0; i < tables.length; i++) {
      var html = tables[i].innerHTML || '';
      if (/星期[一二三四五六日天]/.test(html)) return tables[i];
    }
    // last resort: largest table containing 星期
    var all = document.querySelectorAll('table');
    var best = null;
    var bestLen = 0;
    for (var j = 0; j < all.length; j++) {
      var h = all[j].innerHTML || '';
      if (h.indexOf('星期') !== -1 && h.length > bestLen) {
        best = all[j];
        bestLen = h.length;
      }
    }
    return best;
  }

  function collectFromTable(table) {
    var rows = table.querySelectorAll('tr');
    if (!rows.length) return [];

    var headerCells = rows[0].querySelectorAll('td,th');
    var hasWeekdayHeader = false;
    for (var i = 0; i < headerCells.length; i++) {
      if (/星期[一二三四五六日天]/.test(stripTags(headerCells[i].innerHTML))) {
        hasWeekdayHeader = true;
        break;
      }
    }
    if (!hasWeekdayHeader) return [];

    var labelRe = /^(早晨|上午|下午|晚上|第[0-9一二三四五六七八九十]+节)$/;
    var courses = [];

    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('td');
      if (!cells.length) continue;

      var labelCount = 0;
      for (var c0 = 0; c0 < cells.length; c0++) {
        var compact = stripTags(cells[c0].innerHTML).replace(/\s+/g, '');
        if (labelRe.test(compact)) labelCount++;
        else break;
      }

      for (var c = 0; c < cells.length; c++) {
        var blocks = parseCourseBlocks(cells[c].innerHTML);
        if (!blocks.length) continue;
        var dayIndex = c - labelCount;
        if (dayIndex < 0 || dayIndex > 6) continue;
        var day = dayIndex + 1;
        for (var b = 0; b < blocks.length; b++) {
          var lines = blocks[b];
          if (lines.length < 4) continue;
          var name = lines[0];
          var info = lines[1];
          var teacher = lines[2];
          var position = lines[3];
          var parsed = parseWeeksAndSections(info);
          if (!parsed || !parsed.weeks.length) continue;
          courses.push({
            name: name,
            day: day,
            weeks: parsed.weeks,
            teacher: teacher,
            position: position,
            startSection: parsed.sections[0],
            endSection: parsed.sections[parsed.sections.length - 1]
          });
        }
      }
    }

    var seen = {};
    var unique = [];
    for (var k = 0; k < courses.length; k++) {
      var course = courses[k];
      var key = [
        course.name,
        course.day,
        course.teacher,
        course.position,
        course.startSection,
        course.endSection,
        course.weeks.join(',')
      ].join('|');
      if (seen[key]) continue;
      seen[key] = true;
      unique.push(course);
    }
    return unique;
  }

  function collectPracticeCourses() {
    // 实践课(或无上课时间)信息 DataGrid1: 课程名称 教师 学分 起止周 上课时间 上课地点
    var grid = document.getElementById('DataGrid1');
    if (!grid) return [];
    var rows = grid.querySelectorAll('tr');
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var tds = rows[i].querySelectorAll('td');
      if (tds.length < 4) continue;
      var name = stripTags(tds[0].innerHTML).trim();
      var teacher = stripTags(tds[1].innerHTML).trim();
      var weekRange = stripTags(tds[3].innerHTML).trim();
      var position = tds.length > 5 ? stripTags(tds[5].innerHTML).trim() : '';
      if (!name || name === '课程名称') continue;
      out.push({ name: name, teacher: teacher, weekRange: weekRange, position: position });
    }
    return out;
  }

  async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast('正在保存 ' + parsedCourses.length + ' 门课程...');
    await window.shiguangBridgePromise.saveImportedCourses(
      JSON.stringify(parsedCourses, null, 2)
    );
  }

  async function runImportFlow() {
    var alertConfirmed = await window.shiguangBridgePromise.showAlert(
      '四川托普 · 老正方课表导入',
      '请先登录教务系统，打开「学生个人课表」或「班级课表查询」，并确认页面已显示完整周课表格（含星期一~星期日）。\n\n本适配解析 id=Table6 的周课表；实践课若无上课时间，可能需导入后手动添加。',
      '好的，开始导入'
    );
    if (!alertConfirmed) {
      window.shiguangBridge.showToast('用户取消了导入。');
      return;
    }

    var url = String(window.location.href || '');
    var isSchedulePage =
      /xskbcx\.aspx|tjkbcx\.aspx|xskb\.aspx|xs_kb\.aspx|kbcx/i.test(url) ||
      /学生个人课表|班级课表|课表查询|个人课表/.test(document.body ? document.body.innerText : '');

    if (!isSchedulePage) {
      await window.shiguangBridgePromise.showAlert(
        '导入失败',
        '当前页面似乎不是课表页。\n请进入：课表查询 → 学生个人课表（或班级课表查询），确认周课表已显示后再点导入。',
        '确定'
      );
      return;
    }

    var table = findTable6();
    if (!table) {
      await window.shiguangBridgePromise.showAlert(
        '导入失败',
        '未找到周课表格（Table6）。\n请确认课表已查询出来，并尽量使用网页版「学生个人课表」页面。',
        '确定'
      );
      return;
    }

    var courses = collectFromTable(table);
    if (!courses.length) {
      window.shiguangBridge.showToast('未解析到课程，请确认学年学期是否正确，或本学期是否无课。');
      await window.shiguangBridgePromise.showAlert(
        '未找到课程',
        '课表格存在，但没有解析到课程数据。\n请检查所选学年/学期，或确认页面已显示本周课程。',
        '确定'
      );
      return;
    }

    await saveCourses(courses);

    var practice = collectPracticeCourses();
    var extra = '';
    if (practice.length) {
      extra =
        '\n\n另检测到 ' +
        practice.length +
        ' 条实践课/无固定时间课程：\n' +
        practice
          .map(function (p) {
            return '- ' + p.name + '（' + (p.weekRange || '周次未知') + '）';
          })
          .join('\n') +
        '\n这些课程通常没有网格时间，导入后请手动补充。';
    }

    window.shiguangBridge.showToast('课程导入成功，共导入 ' + courses.length + ' 条！');
    await window.shiguangBridgePromise.showAlert(
      '导入完成',
      '已导入 ' + courses.length + ' 条课程记录。\n请在预览中核对周次、节次与教室，确认无误后保存。' + extra,
      '确定'
    );
    if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
      window.shiguangBridge.notifyTaskCompletion();
    }
  }

  runImportFlow().catch(function (error) {
    console.error('[SCETOP adapter]', error);
    if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
      window.shiguangBridgePromise
        .showAlert('导入异常', String(error && error.message ? error.message : error), '确定')
        .catch(function () {});
    }
  });
})();
