(async function () {
  function toast(msg) {
    try {
      if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
        window.shiguangBridge.showToast(String(msg));
      }
    } catch (_) {}
  }

  async function fail(message, error) {
    var detail = String(message || "导入失败");
    if (error) {
      detail += "\n" + (error.stack || error.message || String(error));
    }
    try {
      console.error(detail, error || "");
    } catch (_) {}
    try {
      if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === "function") {
        await window.shiguangBridgePromise.showAlert("提示", detail, "确定");
      }
    } catch (_) {}
    throw new Error(detail);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function waitFor(cond, timeout, interval) {
    var start = Date.now();
    timeout = timeout || 15000;
    interval = interval || 300;
    while (Date.now() - start < timeout) {
      try {
        var value = await cond();
        if (value) return value;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ ]+\n/g, "\n")
      .replace(/\n[ ]+/g, "\n")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getAccessibleDocuments() {
    var docs = [];
    function pushDoc(doc) {
      if (doc && docs.indexOf(doc) === -1) docs.push(doc);
    }
    function scoreDoc(doc) {
      try {
        var score = 0;
        var href = String((doc.location && doc.location.href) || "");
        var title = normalizeText(doc.title || "");
        var text = normalizeText((doc.body && doc.body.innerText) || "");
        if (/\/xskb\/xskb_list\.do/i.test(href)) score += 100;
        if (/学期理论课表/.test(title)) score += 50;
        if (/学期理论课表/.test(text)) score += 30;
        if (doc.querySelector("#xnxq01id")) score += 20;
        if (doc.querySelector("#zc")) score += 10;
        if (getCourseTable(doc)) score += 10;
        return score;
      } catch (_) {
        return 0;
      }
    }
    pushDoc(document);
    Array.from(document.querySelectorAll("iframe")).forEach(function (iframe) {
      try {
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (doc) pushDoc(doc);
      } catch (_) {}
    });
    docs.sort(function (a, b) { return scoreDoc(b) - scoreDoc(a); });
    return docs;
  }

  function getCourseTable(doc) {
    return doc.querySelector("#kbtable") ||
      doc.querySelector("#tab1") ||
      doc.querySelector("table.kb_table") ||
      doc.querySelector("table.kbtable") ||
      doc.querySelector("table");
  }

  function isScheduleDoc(doc) {
    try {
      var text = normalizeText((doc.body && doc.body.innerText) || "");
      if (/登录|用户名|密码/.test(text) && !/课表/.test(text)) return false;
      if (/学期理论课表|我的课表/.test(text) && getCourseTable(doc)) return true;
      if (doc.querySelector("#xnxq01id") && getCourseTable(doc)) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function parseDayFromHeader(text) {
    var m = normalizeText(text).match(/星期([一二三四五六日天])/);
    if (!m) return 0;
    return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[m[1]] || 0;
  }

  function parseWeekText(weekText) {
    var text = normalizeText(weekText);
    if (!text) return [];
    text = text.replace(/（/g, "(").replace(/）/g, ")");
    text = text.replace(/\s+/g, "");
    text = text.replace(/周次[:：]?/g, "");
    var odd = /单/.test(text);
    var even = /双/.test(text);
    text = text.replace(/\((?:单|双)\)/g, "");
    text = text.replace(/[单双]/g, "");
    text = text.replace(/\(周\)/g, "");
    text = text.replace(/周/g, "");
    text = text.replace(/[;；]/g, ",");
    var result = [];
    var seen = {};
    text.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (part) {
      var range = part.match(/^(\d+)-(\d+)$/);
      if (range) {
        var start = parseInt(range[1], 10);
        var end = parseInt(range[2], 10);
        if (start > end) {
          var t = start;
          start = end;
          end = t;
        }
        for (var i = start; i <= end; i++) {
          if (odd && i % 2 === 0) continue;
          if (even && i % 2 !== 0) continue;
          if (!seen[i]) {
            seen[i] = true;
            result.push(i);
          }
        }
        return;
      }
      var single = part.match(/^(\d+)$/);
      if (single) {
        var w = parseInt(single[1], 10);
        if (odd && w % 2 === 0) return;
        if (even && w % 2 !== 0) return;
        if (!seen[w]) {
          seen[w] = true;
          result.push(w);
        }
      }
    });
    result.sort(function (a, b) { return a - b; });
    return result;
  }

  function parseSectionText(text) {
    var raw = normalizeText(text).replace(/（/g, "(").replace(/）/g, ")");
    if (!raw) return null;
    var m = raw.match(/\[(\d+(?:-\d+)*)节\]/) || raw.match(/\[(\d+(?:[-,，]\d+)*)小节\]/);
    if (!m) return null;
    var nums = (m[1].match(/\d+/g) || []).map(function (x) { return parseInt(x, 10); }).filter(function (n) { return !isNaN(n); });
    if (!nums.length) return null;
    return {
      startSection: Math.min.apply(null, nums),
      endSection: Math.max.apply(null, nums)
    };
  }

  function extractWeekAndSectionLine(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (/\(周\)/.test(lines[i]) && /\[\d+(?:-\d+)*节\]/.test(lines[i])) {
        return { index: i, text: lines[i] };
      }
    }
    return null;
  }

  function isMeaninglessLine(line) {
    var text = normalizeText(line);
    if (!text) return true;
    if (/^(学期理论课表|理论课表|实践课表|课表查询|筛选|放大|时间模式[:：]?.*|周次[:：]?.*)$/.test(text)) return true;
    return false;
  }

  function splitCoursesInCell(doc, cell) {
    function getCellLines() {
      var text = normalizeText(cell.innerText || cell.textContent || "");
      if (!text) return [];
      return text.split("\n").map(function (x) { return normalizeText(x); }).filter(Boolean).filter(function (line) {
        return !isMeaninglessLine(line) && !/^[-]{3,}$/.test(line);
      });
    }

    function splitByParagraphs() {
      var ps = Array.from(cell.querySelectorAll("p"));
      if (!ps.length) return [];
      return ps.map(function (p) {
        return normalizeText(p.innerText || p.textContent || "");
      }).filter(Boolean).filter(function (t) {
        return /\(周\)/.test(t) && /\[(?:\d+(?:[-,，]\d+)*)节\]/.test(t);
      });
    }

    function splitBySequentialLines(lines) {
      var blocks = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];
        if (!line) {
          i++;
          continue;
        }
        if (!/\(周\)/.test(line) || !/\[(?:\d+(?:[-,，]\d+)*)节\]/.test(line)) {
          i++;
          continue;
        }

        var parts = [];
        if (i - 2 >= 0) {
          parts.push(lines[i - 2]);
          parts.push(lines[i - 1]);
        } else if (i - 1 >= 0) {
          parts.push(lines[i - 1]);
        }
        parts.push(line);
        if (i + 1 < lines.length) parts.push(lines[i + 1]);

        var cleaned = [];
        parts.forEach(function (p) {
          p = normalizeText(p);
          if (!p) return;
          if (/^[-]{3,}$/.test(p)) return;
          cleaned.push(p);
        });

        if (cleaned.length) {
          var last = cleaned[cleaned.length - 1];
          if (/\(周\)/.test(last) && i + 1 < lines.length) cleaned.push(lines[i + 1]);
          blocks.push(cleaned.join("\n"));
        }
        i += 2;
      }
      return blocks;
    }

    function splitCompactText(text) {
      var lines = text.split("\n").map(function (x) { return normalizeText(x); }).filter(Boolean);
      if (!lines.length) return [];
      return splitBySequentialLines(lines);
    }

    var byP = splitByParagraphs();
    if (byP.length) return byP;

    var text2 = normalizeText(cell.innerText || cell.textContent || "");
    if (!text2) return [];

    var lineBlocks = splitBySequentialLines(getCellLines());
    if (lineBlocks.length) return lineBlocks;

    var normalized = text2
      .replace(/([\u4e00-\u9fa5A-Za-z0-9（）()《》·,，、\-\s]+?)\s+([0-9]+(?:-[0-9]+)?(?:[,，][0-9]+(?:-[0-9]+)?)*(?:\((?:单|双)\))?\(周\)\[[0-9\-,，]+节\])/g, function (_, a, b) {
        return normalizeText(a) + "\n" + normalizeText(b);
      })
      .replace(/(\[[0-9\-,，]+节\])\s*([^\n\[]+)/g, function (_, a, b) {
        return a + "\n" + normalizeText(b);
      })
      .replace(/\s{2,}/g, "\n");

    var compactBlocks = splitCompactText(normalized);
    if (compactBlocks.length) return compactBlocks;

    return [];
  }

  function parseCourseBlock(text, day) {
    var raw = normalizeText(text);
    if (!raw) return null;
    raw = raw.replace(/（/g, "(").replace(/）/g, ")");
    if (!/\(周\)/.test(raw) || !/\[(?:\d+(?:[-,，]\d+)*)节\]/.test(raw)) return null;

    var lines = raw.split("\n").map(function (x) { return normalizeText(x); }).filter(Boolean);
    if (!lines.length) return null;

    var wsIndex = -1;
    for (var li = 0; li < lines.length; li++) {
      if (/\(周\)/.test(lines[li]) && /\[(?:\d+(?:[-,，]\d+)*)节\]/.test(lines[li])) {
        wsIndex = li;
        break;
      }
    }

    if (wsIndex <= 0) {
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!/\(周\)/.test(line)) continue;
        var weekPartMatch = line.match(/([0-9,，\-]+(?:\((?:单|双)\))?\(周\))/);
        var sectionPartMatch = line.match(/(\[(?:\d+(?:[-,，]\d+)*)节\])/);
        if (weekPartMatch && sectionPartMatch) {
          var prefix = normalizeText(line.slice(0, line.indexOf(weekPartMatch[1])));
          var suffix = normalizeText(line.slice(line.indexOf(sectionPartMatch[1]) + sectionPartMatch[1].length));
          var rebuilt = [];
          if (prefix) rebuilt.push(prefix);
          rebuilt.push(weekPartMatch[1] + sectionPartMatch[1]);
          if (suffix) rebuilt.push(suffix);
          lines.splice.apply(lines, [i, 1].concat(rebuilt));
          wsIndex = prefix ? i + 1 : i;
          break;
        }
      }
    }

    if (wsIndex <= 0) return null;

    var wsLine = lines[wsIndex];
    var weekMatch = wsLine.match(/([0-9,，\-]+(?:\((?:单|双)\))?\(周\))/);
    if (!weekMatch) return null;
    var weeks = parseWeekText(weekMatch[1]);
    if (!weeks.length) return null;

    var section = parseSectionText(wsLine);
    if (!section) return null;

    var name = lines[0] || "";
    if (!name) return null;
    if (/^[\d,\-，()\[\]单双周节小节]+$/.test(name)) return null;

    var courseNature = "";
    var natureMatch = name.match(/\[(必修|选修)\]/);
    if (natureMatch) {
      courseNature = natureMatch[1] === "必修" ? "required" : "elective";
      name = name.replace(/\[(必修|选修)\]/g, "").trim();
    }
    name = name.replace(/\[(\d+)\]/g, "").trim();
    if (!name) return null;

    var beforeWeek = lines.slice(1, wsIndex);
    var teacher = "";
    var noteParts = [];

    if (beforeWeek.length) {
      if (beforeWeek.length === 1) {
        teacher = beforeWeek[0];
      } else {
        teacher = beforeWeek[beforeWeek.length - 1] || "";
        noteParts = beforeWeek.slice(0, -1);
      }
    }

    if (/^\[[0-9]+(?:-[0-9]+)?\]班$/.test(teacher) || /^\d+$/.test(teacher) || /\(周\)|\[(?:\d+(?:[-,，]\d+)*)节\]/.test(teacher)) {
      noteParts.push(teacher);
      teacher = "";
    }

    var position = "";
    for (var j = wsIndex + 1; j < lines.length; j++) {
      var nextLine = lines[j];
      if (!nextLine) continue;
      position = nextLine;
      break;
    }

    noteParts = noteParts.filter(Boolean).map(function (x) { return x.trim(); }).filter(Boolean);

    var course = {
      name: name,
      teacher: teacher || "",
      position: position || "",
      day: Number(day),
      startSection: section.startSection,
      endSection: section.endSection,
      weeks: weeks
    };

    course.location = course.position;
    course.dayOfWeek = course.day;
    course.startWeek = weeks[0];
    course.endWeek = weeks[weeks.length - 1];
    if (courseNature) course.courseNature = courseNature;
    if (weeks.length && weeks.every(function (w) { return w % 2 === 1; })) course.isOddWeek = true;
    if (weeks.length && weeks.every(function (w) { return w % 2 === 0; })) course.isEvenWeek = true;
    if (noteParts.length) course.note = noteParts.join(" ");

    return course;
  }

  function dedupeCourses(courses) {
    var map = {};
    var result = [];
    courses.forEach(function (c) {
      var key = [
        c.name, c.teacher, c.position, c.day, c.startSection, c.endSection, (c.weeks || []).join(",")
      ].join("||");
      if (!map[key]) {
        map[key] = true;
        result.push(c);
      }
    });
    return result;
  }

  function parseTimeSlots(doc) {
    var table = getCourseTable(doc);
    if (!table) return [];
    var rows = Array.from(table.querySelectorAll("tr"));
    var result = [];
    var seen = {};
    function toMin(v) {
      var p = String(v).split(":");
      return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    }
    function toHHMM(mins) {
      mins = Math.round(mins);
      var h = Math.floor(mins / 60);
      var m = mins % 60;
      return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }
    rows.forEach(function (row, idx) {
      if (idx === 0) return;
      var firstCell = row.cells && row.cells[0];
      if (!firstCell) return;
      var txt = normalizeText(firstCell.innerText || firstCell.textContent || "");
      var secMatch = txt.match(/(\d+(?:,\d+)*)节/);
      var timeMatch = txt.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (!secMatch || !timeMatch) return;
      var nums = secMatch[1].split(",").map(function (x) { return parseInt(x, 10); }).filter(function (n) { return !isNaN(n); });
      if (!nums.length) return;
      var start = timeMatch[1].padStart(5, "0");
      var end = timeMatch[2].padStart(5, "0");
      var startMin = toMin(start);
      var endMin = toMin(end);
      var step = (endMin - startMin) / nums.length;
      nums.forEach(function (num, index) {
        if (seen[num]) return;
        var item = {
          number: num,
          section: num,
          startTime: toHHMM(startMin + step * index),
          endTime: toHHMM(index === nums.length - 1 ? endMin : (startMin + step * (index + 1)))
        };
        seen[num] = true;
        result.push(item);
      });
    });
    result.sort(function (a, b) { return a.number - b.number; });
    return result;
  }

  function parseCourseConfig(doc) {
    var config = {
      firstDayOfWeek: 1,
      semesterStartDate: null
    };

    var termSelect = doc.querySelector("#xnxq01id");
    if (termSelect) {
      var selectedOption = termSelect.options && termSelect.selectedIndex >= 0 ? termSelect.options[termSelect.selectedIndex] : null;
      var termValue = normalizeText((selectedOption && (selectedOption.value || selectedOption.text)) || termSelect.value || "");
      if (termValue) {
        config.term = termValue;
        var m = termValue.match(/^(\d{4})-(\d{4})-(\d)$/);
        if (m) {
          config.schoolYear = m[1] + "-" + m[2];
          config.termName = "第" + m[3] + "学期";
        }
      }
    }

    var weekSelect = doc.querySelector("#zc");
    if (weekSelect) {
      var maxWeek = 0;
      Array.from(weekSelect.options || []).forEach(function (opt) {
        var n = parseInt(opt.value, 10);
        if (!isNaN(n) && n > maxWeek) maxWeek = n;
      });
      if (maxWeek > 0) {
        config.totalWeeks = maxWeek;
        config.semesterTotalWeeks = maxWeek;
      }
    }

    config.defaultClassDuration = 45;
    config.defaultBreakDuration = 10;

    return config;
  }

  function parseFromTable(doc) {
    var table = getCourseTable(doc);
    if (!table) throw new Error("未找到课表表格");

    var rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length < 2) throw new Error("课表表格行数不足");

    var headerRow = rows[0];
    var headerCells = Array.from((headerRow && headerRow.cells) || []);
    if (headerCells.length < 8 && rows[0].querySelectorAll("th,td").length >= 8) {
      headerCells = Array.from(rows[0].querySelectorAll("th,td"));
    }
    if (headerCells.length < 8) throw new Error("课表表头异常");

    var dayMap = {};
    for (var i = 1; i < headerCells.length; i++) {
      var day = parseDayFromHeader(headerCells[i].innerText || headerCells[i].textContent || "");
      if (day) dayMap[i] = day;
    }
    if (Object.keys(dayMap).length < 7) throw new Error("星期列识别不完整");

    var courses = [];
    for (var r = 1; r < rows.length; r++) {
      var cells = Array.from(rows[r].cells || []);
      if (cells.length < 8) continue;
      for (var c = 1; c <= 7 && c < cells.length; c++) {
        var dayNum = dayMap[c];
        if (!dayNum) continue;
        var cell = cells[c];
        var cellText = normalizeText(cell.innerText || cell.textContent || "");
        if (!cellText || isMeaninglessLine(cellText)) continue;
        var blocks = splitCoursesInCell(doc, cell);
        blocks.forEach(function (block) {
          var parsed = parseCourseBlock(block, dayNum);
          if (parsed) courses.push(parsed);
        });
      }
    }

    return {
      courses: dedupeCourses(courses),
      timeSlots: parseTimeSlots(doc),
      config: parseCourseConfig(doc)
    };
  }

  function toFinalCourse(course) {
    var weeks = (course.weeks || []).map(function (x) { return Number(x); }).filter(function (x) { return !isNaN(x); }).sort(function (a, b) { return a - b; });
    var day = Number(course.day);
    var finalCourse = {
      name: String(course.name || "").trim(),
      teacher: String(course.teacher || "").trim(),
      position: String(course.position || "").trim(),
      day: day,
      startSection: Number(course.startSection),
      endSection: Number(course.endSection),
      weeks: weeks
    };
    finalCourse.location = finalCourse.position;
    finalCourse.dayOfWeek = day;
    finalCourse.startWeek = weeks.length ? weeks[0] : 0;
    finalCourse.endWeek = weeks.length ? weeks[weeks.length - 1] : 0;
    finalCourse.customWeeks = weeks.slice();
    if (course.courseNature) finalCourse.courseNature = course.courseNature;
    if (course.note) finalCourse.note = String(course.note).trim();
    if (course.isOddWeek) finalCourse.isOddWeek = true;
    if (course.isEvenWeek) finalCourse.isEvenWeek = true;
    return finalCourse;
  }

  async function main() {
    if (!window.shiguangBridgePromise || !window.shiguangBridge || typeof window.shiguangBridge.notifyTaskCompletion !== "function") {
      throw new Error("桥接接口不可用");
    }

    var targetDoc = await waitFor(function () {
      var docs = getAccessibleDocuments();
      for (var i = 0; i < docs.length; i++) {
        var doc = docs[i];
        try {
          var href = String((doc.location && doc.location.href) || "");
          if (/\/xskb\/xskb_list\.do/i.test(href) && getCourseTable(doc)) return doc;
        } catch (_) {}
      }
      for (var j = 0; j < docs.length; j++) {
        if (isScheduleDoc(docs[j])) return docs[j];
      }
      return null;
    }, 20000, 300);

    if (!targetDoc) {
      throw new Error("当前页面不是可解析的课表页，或课表 iframe 未加载完成");
    }

    var parsed = parseFromTable(targetDoc);

    if (!parsed || !parsed.courses || !parsed.courses.length) {
      throw new Error("未解析到任何课程，请确认当前学期课表已加载且不是空课表");
    }

    var finalCourses = parsed.courses.map(toFinalCourse).filter(function (c) {
      return c.name &&
        c.day >= 1 && c.day <= 7 &&
        c.startSection > 0 &&
        c.endSection >= c.startSection &&
        Array.isArray(c.weeks) &&
        c.weeks.length > 0;
    });

    if (!finalCourses.length) {
      throw new Error("课程字段转换后为空，无法保存");
    }

    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

    if (parsed.timeSlots && parsed.timeSlots.length) {
      await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsed.timeSlots));
    }

    if (parsed.config) {
      await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(parsed.config));
    }

    toast("课表导入成功，共" + finalCourses.length + "门课程");
    window.shiguangBridge.notifyTaskCompletion();
  }

  try {
    await main();
  } catch (error) {
    await fail("解析学期理论课表失败", error);
  }
})();
