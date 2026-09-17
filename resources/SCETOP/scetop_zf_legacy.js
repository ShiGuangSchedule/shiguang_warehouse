// 四川托普信息技术职业学院 · 老版正方教务课表导入
//
// 一次导入会同时读取两个课表页并合并：
//   1. 学生个人课表 xskbcx.aspx（优先，格子格式「周一第1,2节{第1-17周}」）
//   2. 班级课表查询 tjkbcx.aspx（只用于补录，格子格式「1-14(1,2)」）
// 开学初期学生个人课表通常还没排出来，这时班级课表会把整份课表补全。
// 从任意一个课表页点导入都可以，脚本会自己去读另一个页面。
//
// 作息取自学校作息时间表：A 教学区的第 3/4 节与其它教学区不同，周五下午整体提前半小时。
// 没有固定上课时间的课程（实践、实训类）不导入，只在提示里告知数量。

(function () {
  'use strict';

  var DAY_BY_CHAR = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  // ---------------- 文本处理 ----------------

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); });
  }

  function cellText(html) {
    return decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
  }

  function normalize(raw) {
    return String(raw)
      .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
      .replace(/[，、；;]/g, ',')
      .replace(/[－–—]/g, '-')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 65248); })
      .replace(/\s+/g, '');
  }

  // ---------------- 作息时间（学校作息表） ----------------

  var TIME_SLOTS_DEFAULT = [
    { number: 1, startTime: '08:30', endTime: '09:15' },
    { number: 2, startTime: '09:20', endTime: '10:05' },
    { number: 3, startTime: '10:20', endTime: '11:05' },
    { number: 4, startTime: '11:10', endTime: '11:55' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:50', endTime: '15:35' },
    { number: 7, startTime: '15:50', endTime: '16:35' },
    { number: 8, startTime: '16:40', endTime: '17:25' },
    { number: 9, startTime: '18:30', endTime: '19:15' },
    { number: 10, startTime: '19:20', endTime: '20:05' }
  ];

  // A 教学区以外的第 3/4 节晚 20 分钟
  var TIME_SLOTS_OUTSIDE_A = TIME_SLOTS_DEFAULT.map(function (slot) {
    if (slot.number === 3) return { number: 3, startTime: '10:40', endTime: '11:25' };
    if (slot.number === 4) return { number: 4, startTime: '11:30', endTime: '12:15' };
    return slot;
  });

  // 周五下午整体提前半小时（学校作息表只对第 5-8 节做了说明）
  var TIME_SLOTS_FRIDAY_PM = {
    5: { startTime: '13:30', endTime: '14:15' },
    6: { startTime: '14:20', endTime: '15:05' },
    7: { startTime: '15:20', endTime: '16:05' },
    8: { startTime: '16:10', endTime: '16:55' }
  };

  function slotOf(table, section) {
    return table[section - 1] || null;
  }

  function isAreaA(position) {
    var p = String(position || '').trim();
    if (!p) return true;                       // 地点缺失时按默认作息处理
    return /^A\d/i.test(p) || /^A[-区]/i.test(p);
  }

  // 周五只在这门课整段都落在第 5-8 节时才提前半小时；
  // 跨到晚上（第 9、10 节）的课整体按默认作息处理，避免拼出不存在的时段。
  function useFridayAfternoon(course) {
    return (
      course.day === 5 &&
      course.startSection >= 5 &&
      course.endSection <= 8 &&
      Boolean(TIME_SLOTS_FRIDAY_PM[course.startSection]) &&
      Boolean(TIME_SLOTS_FRIDAY_PM[course.endSection])
    );
  }

  // ---------------- 周次 / 节次解析 ----------------

  function parseWeekList(str) {
    var weeks = [];
    str.split(',').forEach(function (seg) {
      var m = seg.match(/^(\d+)(?:[-~](\d+))?(单|双)?$/);
      if (!m) return;
      var from = parseInt(m[1], 10);
      var to = m[2] ? parseInt(m[2], 10) : from;
      var flag = m[3] || '';
      if (!(from > 0) || to < from) return;
      for (var w = from; w <= to; w++) {
        if (flag === '单' && w % 2 === 0) continue;
        if (flag === '双' && w % 2 === 1) continue;
        if (weeks.indexOf(w) === -1) weeks.push(w);
      }
    });
    return weeks.sort(function (a, b) { return a - b; });
  }

  function parseSectionList(str) {
    var out = [];
    str.split(',').forEach(function (seg) {
      var m = seg.match(/^(\d+)(?:[-~](\d+))?$/);
      if (!m) return;
      var from = parseInt(m[1], 10);
      var to = m[2] ? parseInt(m[2], 10) : from;
      if (!(from > 0) || to < from) return;
      for (var s = from; s <= to; s++) if (out.indexOf(s) === -1) out.push(s);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * 解析课程格里的「周次(节次)」那一行，兼容两个页面各自的格式：
   *   学生个人课表：周一第1,2节{第1-17周} / 周二第1,2节{第2-16周|双周}
   *   班级课表：    1-14(1,2) / 2-14双(1,2) / 18(1,2) / 1-8,10-16(1,2)
   * day 为 0 表示这一行没写星期几，星期由所在列决定。
   */
  function parseInfoLine(raw) {
    var text = normalize(raw);

    var student = text.match(/^周([一二三四五六日天])第([\d,\-~]+)节\{第([\d,\-~]+)周(?:\|(单|双)周?)?\}$/);
    if (student) {
      var weeks = parseWeekList(student[3] + (student[4] || ''));
      var sections = parseSectionList(student[2]);
      if (weeks.length && sections.length) {
        return { day: DAY_BY_CHAR[student[1]], weeks: weeks, sections: sections };
      }
      return null;
    }

    var classTable = text.match(/^([\d,\-~单双]+)\(([\d,\-~]+)\)$/);
    if (classTable) {
      var weeks2 = parseWeekList(classTable[1]);
      var sections2 = parseSectionList(classTable[2]);
      if (weeks2.length && sections2.length) {
        return { day: 0, weeks: weeks2, sections: sections2 };
      }
      return null;
    }

    return null;
  }

  /**
   * 一个格子里可能排了多门课，用空行分隔（班级课表里用 <br><br><br> 分隔）。
   * 以「周次(节次)」那一行为锚点：上一行是课程名，下面两行是教师和地点。
   */
  function parseCellBlocks(text, stats) {
    var lines = String(text).split('\n')
      .map(function (line) { return line.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean);

    var blocks = [];
    for (var i = 0; i < lines.length; i++) {
      var info = parseInfoLine(lines[i]);
      if (!info) continue;
      var name = lines[i - 1] || '';
      if (!name || parseInfoLine(name)) continue;
      var teacher = lines[i + 1] || '';
      var position = lines[i + 2] || '';
      if (parseInfoLine(teacher)) teacher = '';
      if (parseInfoLine(position)) position = '';
      if (!teacher || !position) stats.incomplete++;
      blocks.push({
        name: name,
        teacher: teacher,
        position: position,
        day: info.day,
        weeks: info.weeks,
        sections: info.sections
      });
    }

    if (!blocks.length && lines.length) {
      stats.unrecognized.push(lines.join(' / ').slice(0, 80));
    }
    return blocks;
  }

  // ---------------- 表格解析（对任意 Document 生效） ----------------

  /**
   * 把表格展开成网格，处理 rowspan / colspan，拿到每个格子的真实列号。
   * 必须用 table.rows / row.cells：用 querySelectorAll('td') 会把嵌套表格里的
   * 格子也算进来（页面里确实存在外层表格套课表的写法），导致列号整体错位。
   */
  function buildGrid(table) {
    var rows = [].slice.call(table.rows || table.querySelectorAll('tr'));
    var grid = [];
    var occupied = [];

    for (var r = 0; r < rows.length; r++) {
      grid[r] = grid[r] || [];
      occupied[r] = occupied[r] || [];
      var cells = [].slice.call(rows[r].cells || rows[r].querySelectorAll('td,th'));
      var column = 0;

      for (var i = 0; i < cells.length; i++) {
        while (occupied[r][column]) column++;
        var cell = cells[i];
        var colSpan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
        var rowSpan = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;

        for (var rr = r; rr < r + rowSpan; rr++) {
          occupied[rr] = occupied[rr] || [];
          for (var cc = column; cc < column + colSpan; cc++) {
            occupied[rr][cc] = true;
            if (rr === r && cc === column) grid[rr][cc] = cell;   // 合并格只认左上角
          }
        }
        column += colSpan;
      }
    }
    return grid;
  }

  /**
   * 找到写有「星期一…星期日」的表头行，并建立 列号 -> 星期 的对应关系。
   * 表头不一定在第一行（上面可能有标题行），所以往下找几行。
   */
  function findHeader(grid) {
    for (var r = 0; r < Math.min(grid.length, 6); r++) {
      var dayByColumn = {};
      for (var c = 0; c < (grid[r] || []).length; c++) {
        var cell = grid[r][c];
        if (!cell) continue;
        var text = cellText(cell.innerHTML).replace(/\s+/g, '');
        var m = text.match(/^星期([一二三四五六日天])$/);
        if (m) dayByColumn[c] = DAY_BY_CHAR[m[1]];
      }
      if (Object.keys(dayByColumn).length >= 5) return { row: r, dayByColumn: dayByColumn };
    }
    return null;
  }

  /** 在指定文档里依次尝试候选表格，取第一个能找到周课表的 */
  function findCourseTable(doc) {
    var candidates = [];
    ['Table6', 'Table1'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && el.tagName && el.tagName.toLowerCase() === 'table') candidates.push(el);
    });
    [].slice.call(doc.querySelectorAll('table.blacktab')).forEach(function (t) {
      if (candidates.indexOf(t) === -1) candidates.push(t);
    });

    for (var i = 0; i < candidates.length; i++) {
      var grid = buildGrid(candidates[i]);
      var header = findHeader(grid);
      if (header) return { grid: grid, header: header };
    }

    var tables = [].slice.call(doc.querySelectorAll('table'));
    for (var j = 0; j < tables.length; j++) {
      if (candidates.indexOf(tables[j]) !== -1) continue;
      var g = buildGrid(tables[j]);
      var h = findHeader(g);
      if (h) return { grid: g, header: h };
    }
    return null;
  }

  /** 统计「实践课(或无上课时间)」「未安排上课时间的课程」有多少条，只用于提示 */
  function countCoursesWithoutTime(doc) {
    var count = 0;
    ['DataGrid1', 'Datagrid2'].forEach(function (id) {
      var table = doc.getElementById(id);
      if (!table || !table.rows) return;
      for (var r = 1; r < table.rows.length; r++) {
        if (String(table.rows[r].textContent || '').trim()) count++;
      }
    });
    return count;
  }

  function collectCourses(doc, stats) {
    var found = findCourseTable(doc);
    if (!found) return [];
    var grid = found.grid;
    var courses = [];

    for (var r = found.header.row + 1; r < grid.length; r++) {
      for (var c = 0; c < (grid[r] || []).length; c++) {
        var columnDay = found.header.dayByColumn[c];
        var cell = grid[r][c];
        if (!columnDay || !cell) continue;

        parseCellBlocks(cellText(cell.innerHTML), stats).forEach(function (block) {
          // 学生个人课表的周次行自带「周一…」，以它为准（合并格会让后面的行少几个格子）；
          // 班级课表没有写星期几，用表头列对应。
          if (block.day && block.day !== columnDay) stats.dayMismatch++;
          courses.push({
            name: block.name,
            teacher: block.teacher,
            position: block.position,
            day: block.day || columnDay,
            weeks: block.weeks,
            startSection: block.sections[0],
            endSection: block.sections[block.sections.length - 1]
          });
        });
      }
    }

    // 同一门课、同一天、同节次、同地点、同周次只保留一条
    var seen = {};
    return courses.filter(function (course) {
      var key = [
        course.name, course.day, course.teacher, course.position,
        course.startSection, course.endSection, course.weeks.join(',')
      ].join('|');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /** 把与默认作息不同的课写成自定义时间，避免整份作息被搞乱 */
  function applyCustomTimes(courses, stats) {
    return courses.map(function (course) {
      var table = isAreaA(course.position) ? TIME_SLOTS_DEFAULT : TIME_SLOTS_OUTSIDE_A;
      var startSlot = slotOf(table, course.startSection);
      var endSlot = slotOf(table, course.endSection);
      var defaultStart = slotOf(TIME_SLOTS_DEFAULT, course.startSection);
      var defaultEnd = slotOf(TIME_SLOTS_DEFAULT, course.endSection);

      if (!startSlot || !endSlot || !defaultStart || !defaultEnd) {
        stats.sectionOverflow++;
        return course;
      }

      if (useFridayAfternoon(course)) {
        var fridayStart = TIME_SLOTS_FRIDAY_PM[course.startSection];
        var fridayEnd = TIME_SLOTS_FRIDAY_PM[course.endSection];
        return Object.assign({}, course, {
          isCustomTime: true,
          customStartTime: fridayStart.startTime,
          customEndTime: fridayEnd.endTime
        });
      }

      if (startSlot.startTime === defaultStart.startTime && endSlot.endTime === defaultEnd.endTime) {
        return course;    // 与默认作息一致，不用单独设置
      }

      return Object.assign({}, course, {
        isCustomTime: true,
        customStartTime: startSlot.startTime,
        customEndTime: endSlot.endTime
      });
    });
  }

  // ---------------- 两个课表页的取数 ----------------

  function getStudentId() {
    var m = String(window.location.search || '').match(/[?&]xh=([^&#]+)/);
    if (m) return decodeURIComponent(m[1]);
    var text = document.body ? String(document.body.textContent || '') : '';
    var m2 = text.match(/学号[：:]\s*([0-9A-Za-z]+)/);
    return m2 ? m2[1] : '';
  }

  /** 从页面里读出当前选中的学年 / 学期（两个页面的控件名分别是 xnd/xqd 与 xn/xq） */
  function readTerm(doc) {
    var yearSelect = doc.querySelector('select[name="xnd"], select[name="xn"]');
    var termSelect = doc.querySelector('select[name="xqd"], select[name="xq"]');
    if (!yearSelect || !termSelect) return null;
    return {
      yearField: yearSelect.name, year: yearSelect.value,
      termField: termSelect.name, term: termSelect.value
    };
  }

  async function fetchDocument(url) {
    var response = await fetch(url, { credentials: 'include' });
    if (response && response.ok === false) throw new Error('HTTP ' + response.status);
    var html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /** 页面上的学年/学期是下拉框，改了要回发一次才会重排；这里按页面自己的表单字段回发 */
  async function repostWithTerm(doc, url, term) {
    var form = doc.querySelector('form');
    if (!form) return null;

    var pairs = [];
    [].slice.call(form.querySelectorAll('input[type="hidden"]')).forEach(function (input) {
      if (input.name) pairs.push([input.name, input.value || '']);
    });
    [].slice.call(form.querySelectorAll('select[name]')).forEach(function (select) {
      pairs.push([select.name, select.value || '']);
    });

    function setPair(key, value) {
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === key) { pairs[i][1] = value; return; }
      }
      pairs.push([key, value]);
    }
    setPair(term.yearField, term.year);
    setPair(term.termField, term.term);
    setPair('__EVENTTARGET', term.yearField);
    setPair('__EVENTARGUMENT', '');

    var body = pairs.map(function (pair) {
      return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
    }).join('&');

    var response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (response && response.ok === false) throw new Error('HTTP ' + response.status);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  /** 读取一个课表页：先直接取；当前页选的学期和它不一致时再回发一次 */
  async function loadTimetable(kind, studentId, liveTerm) {
    var url = (kind === 'student' ? 'xskbcx.aspx' : 'tjkbcx.aspx') + '?xh=' + encodeURIComponent(studentId);
    var doc = await fetchDocument(url);

    var pageTerm = readTerm(doc);
    if (liveTerm && pageTerm && (pageTerm.year !== liveTerm.year || pageTerm.term !== liveTerm.term)) {
      var rerendered = await repostWithTerm(doc, url, {
        yearField: pageTerm.yearField, year: liveTerm.year,
        termField: pageTerm.termField, term: liveTerm.term
      });
      if (rerendered) doc = rerendered;
    }
    return doc;
  }

  /**
   * 合并：个人课表优先，班级课表只补录个人课表里没有的课程。
   * 判据用课程名——同一门课两个页面的周次/教室可能不一样，以个人课表为准。
   */
  function mergeWithPersonalPriority(personal, classCourses, stats) {
    var known = {};
    personal.forEach(function (course) { known[course.name] = true; });

    var added = classCourses.filter(function (course) {
      if (known[course.name]) { stats.supplementedSkip++; return false; }
      stats.supplementedAdd++;
      return true;
    });
    return personal.concat(added);
  }

  // ---------------- 主流程 ----------------

  async function runImportFlow() {
    var confirmed = await window.shiguangBridgePromise.showAlert(
      '四川托普课表导入',
      '请先登录教务系统，打开「学生个人课表」或「班级课表查询」中的任意一个，' +
        '等页面上显示出周课表（能看到「星期一」到「星期日」）再点下面的按钮。\n\n' +
        '导入会自动读取两个课表页：学生个人课表优先，班级课表只用来补齐个人课表里没有的课程；' +
        '开学初期个人课表还没排出来时，就完全按班级课表导入。\n\n' +
        '导入只读取课表，不会修改教务系统里的任何数据。',
      '开始导入'
    );
    if (!confirmed) {
      window.shiguangBridge.showToast('已取消导入。');
      return;
    }

    var studentId = getStudentId();
    if (!studentId) {
      await window.shiguangBridgePromise.showAlert(
        '导入失败',
        '没有识别出学号。\n请从教务系统里的「学生个人课表」或「班级课表查询」页面点导入。',
        '确定'
      );
      return;
    }

    var liveTerm = readTerm(document);
    var stats = {
      unrecognized: [], incomplete: 0, dayMismatch: 0, sectionOverflow: 0,
      supplementedAdd: 0, supplementedSkip: 0, failedPages: []
    };

    var personal = [];
    var classCourses = [];

    try {
      personal = collectCourses(await loadTimetable('student', studentId, liveTerm), stats);
    } catch (error) {
      stats.failedPages.push('学生个人课表');
      console.warn('[四川托普] 学生个人课表读取失败：', error);
    }

    try {
      classCourses = collectCourses(await loadTimetable('class', studentId, liveTerm), stats);
    } catch (error) {
      stats.failedPages.push('班级课表');
      console.warn('[四川托普] 班级课表读取失败：', error);
    }

    var courses = applyCustomTimes(mergeWithPersonalPriority(personal, classCourses, stats));
    var fromClassOnly = personal.length === 0 && courses.length > 0;

    if (!courses.length) {
      window.shiguangBridge.showToast('两个课表页都还没有排课。');
      await window.shiguangBridgePromise.showAlert(
        '没有读到课程',
        '学生个人课表和班级课表都是空的。\n\n' +
          '请确认教务系统里选的是本学期的学年和学期；开学初期课表可能还没排出来，过几天再试。',
        '确定'
      );
      return;
    }

    // 先写作息与课表设置，最后写课程：前面失败时不会白覆盖已有课表
    var timeSlotsSaved = true;
    try {
      timeSlotsSaved = (await window.shiguangBridgePromise.savePresetTimeSlots(
        JSON.stringify(TIME_SLOTS_DEFAULT)
      )) === true;
    } catch (error) {
      timeSlotsSaved = false;
      console.warn('[四川托普] 作息时间没有写入成功：', error);
    }

    try {
      if (typeof window.shiguangBridgePromise.saveCourseConfig === 'function') {
        var totalWeeks = courses.reduce(function (max, course) {
          return Math.max(max, course.weeks[course.weeks.length - 1] || 0);
        }, 0);
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
          semesterTotalWeeks: totalWeeks,
          defaultClassDuration: 45,
          firstDayOfWeek: 1
        }));
      }
    } catch (error) {
      console.warn('[四川托普] 课表设置没有写入成功：', error);
    }

    window.shiguangBridge.showToast('正在保存 ' + courses.length + ' 门课程...');
    var saveResult = await window.shiguangBridgePromise.saveImportedCourses(
      JSON.stringify(courses, null, 2)
    );
    if (saveResult !== true) {
      window.shiguangBridge.showToast('课程没有保存成功，请重试。');
      await window.shiguangBridgePromise.showAlert(
        '导入未完成',
        '课程没有保存成功，请重新导入一次。',
        '确定'
      );
      return;
    }

    var customCount = courses.filter(function (course) { return course.isCustomTime; }).length;
    var untimedCount = countCoursesWithoutTime(document);

    var message = [];
    if (fromClassOnly) {
      message.push('学生个人课表还没有排出来，本次按班级课表导入了 ' + courses.length + ' 门课程。');
      message.push('班级课表包含全班一起上的课程，你个人选的课可能不在其中，可以自己补充。');
    } else {
      message.push('已导入 ' + courses.length + ' 门课程。');
      message.push('其中学生个人课表 ' + personal.length + ' 门' +
        (stats.supplementedAdd ? '，另有 ' + stats.supplementedAdd + ' 门只在班级课表里，已经补上。' : '。'));
    }
    message.push(timeSlotsSaved ? '上课时间已按学校作息设置。' : '作息时间没有写进去，请在「课表设置」里手动填写。');
    if (customCount) {
      message.push('其中 ' + customCount + ' 门课的上课时间与默认作息不同，已经单独设置。');
    }
    if (untimedCount) {
      message.push('另有 ' + untimedCount + ' 门课程没有固定上课时间（实践、实训类），没有导入，可以自己手动添加。');
    }
    if (stats.failedPages.length) {
      message.push('（' + stats.failedPages.join('、') + '这次没有读到，课表可能不完整，可以重试一次。）');
    }
    if (stats.unrecognized.length) {
      message.push('有 ' + stats.unrecognized.length + ' 处内容没能识别，课表可能不完整。');
    }
    if (stats.sectionOverflow) {
      message.push('有 ' + stats.sectionOverflow + ' 门课的节次超出了作息表范围，时间可能不准。');
    }

    window.shiguangBridge.showToast('导入完成，共 ' + courses.length + ' 门课程。');
    await window.shiguangBridgePromise.showAlert('导入完成', message.join('\n'), '确定');
    if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
      window.shiguangBridge.notifyTaskCompletion();
    }

    console.log('[四川托普] 导入完成：' + courses.length + ' 门课程（学生个人课表 ' + personal.length +
      '，班级课表补录 ' + stats.supplementedAdd + '，班级课表被跳过的重复课 ' + stats.supplementedSkip + '）');
    if (stats.unrecognized.length) console.warn('[四川托普] 没能识别的内容：', stats.unrecognized);
    if (stats.dayMismatch) console.warn('[四川托普] 有 ' + stats.dayMismatch + ' 条课程的星期与所在列不一致，已按格内文字处理');
    if (stats.incomplete) console.warn('[四川托普] 有 ' + stats.incomplete + ' 条课程缺少教师或地点');
  }

  runImportFlow().catch(function (error) {
    console.error('[四川托普]', error);
    window.shiguangBridge.showToast('导入出错：' + (error && error.message ? error.message : error));
    if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
      window.shiguangBridgePromise
        .showAlert('导入出错', '导入过程中出错了：' + (error && error.message ? error.message : error) + '\n可以重试一次。', '确定')
        .catch(function () {});
    }
  });
})();
