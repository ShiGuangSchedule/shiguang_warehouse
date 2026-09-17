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

  // 四川托普作息：课时 45 分钟；普通节间休息 5 分钟。
  // 第 3/4 节 A 教学区与区外不同；其余节次两区相同。
  // 默认作息写入 A 教学区；非 A 区且落在第 3/4 节的课程使用 customTime。
  var SCETOP_TIME_SLOTS_A = [
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

  var SCETOP_TIME_SLOTS_NON_A = [
    { number: 1, startTime: '08:30', endTime: '09:15' },
    { number: 2, startTime: '09:20', endTime: '10:05' },
    { number: 3, startTime: '10:40', endTime: '11:25' },
    { number: 4, startTime: '11:30', endTime: '12:15' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:50', endTime: '15:35' },
    { number: 7, startTime: '15:50', endTime: '16:35' },
    { number: 8, startTime: '16:40', endTime: '17:25' },
    { number: 9, startTime: '18:30', endTime: '19:15' },
    { number: 10, startTime: '19:20', endTime: '20:05' }
  ];

  // 周五下午（第5–8节）两区相同，整体比平日下午提前 30 分钟，13:30 上课。
  var SCETOP_TIME_SLOTS_FRIDAY_PM = {
    5: { startTime: '13:30', endTime: '14:15' },
    6: { startTime: '14:20', endTime: '15:05' },
    7: { startTime: '15:20', endTime: '16:05' },
    8: { startTime: '16:10', endTime: '16:55' }
  };

  function isATeachingArea(position) {
    var p = String(position || '').trim();
    if (!p) return true;
    return /^A\d/i.test(p) || /^A-/i.test(p) || /^A区/i.test(p);
  }

  function slotAt(slots, section) {
    return slots[section - 1] || null;
  }

  function hasSpecificClassTime(course) {
    return Boolean(
      course &&
        course.startSection != null &&
        course.endSection != null &&
        course.startSection > 0 &&
        course.endSection >= course.startSection &&
        course.weeks &&
        course.weeks.length > 0
    );
  }

  function isFridayAfternoon(course) {
    return course.day === 5 && course.startSection >= 5 && course.startSection <= 8;
  }

  function slotForCourseSection(course, section) {
    if (isFridayAfternoon(course) && SCETOP_TIME_SLOTS_FRIDAY_PM[section]) {
      var fri = SCETOP_TIME_SLOTS_FRIDAY_PM[section];
      return { number: section, startTime: fri.startTime, endTime: fri.endTime };
    }
    var table = isATeachingArea(course.position) ? SCETOP_TIME_SLOTS_A : SCETOP_TIME_SLOTS_NON_A;
    return slotAt(table, section);
  }

  // 差异时段写 customTime：
  // 1) 非 A 区第 3/4 节
  // 2) 周五下午第 5–8 节（整体提前半小时）
  function applyCourseCustomTimes(courses) {
    return courses.map(function (course) {
      var startSlot = slotForCourseSection(course, course.startSection);
      var endSlot = slotForCourseSection(course, course.endSection);
      var defaultStart = slotAt(SCETOP_TIME_SLOTS_A, course.startSection);
      var defaultEnd = slotAt(SCETOP_TIME_SLOTS_A, course.endSection);
      if (!startSlot || !endSlot || !defaultStart || !defaultEnd) return course;
      if (startSlot.startTime === defaultStart.startTime && endSlot.endTime === defaultEnd.endTime) {
        return course;
      }
      return {
        name: course.name,
        teacher: course.teacher,
        position: course.position,
        day: course.day,
        weeks: course.weeks,
        startSection: course.startSection,
        endSection: course.endSection,
        isCustomTime: true,
        customStartTime: startSlot.startTime,
        customEndTime: endSlot.endTime
      };
    });
  }

  async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast('正在保存 ' + parsedCourses.length + ' 门课程...');
    await window.shiguangBridgePromise.saveImportedCourses(
      JSON.stringify(parsedCourses, null, 2)
    );
  }

  async function trySaveTimeSlots() {
    try {
      var result = await window.shiguangBridgePromise.savePresetTimeSlots(
        JSON.stringify(SCETOP_TIME_SLOTS_A)
      );
      return result === true;
    } catch (error) {
      console.warn('[SCETOP 作息时间设置失败]', error);
      return false;
    }
  }

  function buildCompletionMessage(courses, timeSlotsSaved) {
    var customCount = 0;
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].isCustomTime) customCount++;
    }
    var base =
      '已导入 ' +
      courses.length +
      ' 条课程记录（无具体上课时间的实践课已忽略）。\n' +
      '默认作息按 A 教学区平日写入；自定义时间 ' +
      customCount +
      ' 条（非A区第3/4节、周五下午提前半小时）。\n请在预览中核对后保存。';
    return timeSlotsSaved
      ? base + '\n学校作息时间写入成功。'
      : base + '\n作息时间写入失败，请在课表设置中手动填写。';
  }

  async function runImportFlow() {
    var alertConfirmed = await window.shiguangBridgePromise.showAlert(
      '四川托普 · 老正方课表导入',
      '请先登录教务系统，打开「学生个人课表」或「班级课表查询」，并确认页面已显示完整周课表格（含星期一~星期日）。\n\n' +
        '解析 id=Table6；无具体上课时间的实践课将忽略。\n' +
        '作息：A区第3节10:20/区外10:40；周五下午13:30起（提前半小时）。',
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

    var parsedAll = collectFromTable(table);
    var courses = applyCourseCustomTimes(parsedAll.filter(hasSpecificClassTime));
    if (!courses.length) {
      window.shiguangBridge.showToast('未解析到有具体上课时间的课程，请确认学年学期是否正确。');
      await window.shiguangBridgePromise.showAlert(
        '未找到课程',
        '课表格存在，但没有解析到带明确节次的课程数据。\n请检查所选学年/学期；无上课时间的实践课不会被导入。',
        '确定'
      );
      return;
    }

    await saveCourses(courses);
    var timeSlotsSaved = await trySaveTimeSlots();
    var message = buildCompletionMessage(courses, timeSlotsSaved);

    window.shiguangBridge.showToast('课程导入成功，共导入 ' + courses.length + ' 条！');
    await window.shiguangBridgePromise.showAlert('导入完成', message, '确定');
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
