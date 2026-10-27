// NCEPU Baoding undergraduate timetable. No credential reads or HTML persistence.
// Structure references (retain attribution when reusing this adapter):
// ShiGuangSchedule/shiguang_warehouse: YSSDUFE, XJIE and HNU (MIT).
(function (root, factory) {
  const adapter = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = adapter;
    return;
  }
  if (root.__ncepuBaodingImportRunning) {
    root.shiguangBridge.showToast("华电保定课表正在读取，请勿重复点击。");
    return;
  }
  root.__ncepuBaodingImportRunning = true;
  root.ncepuValidateWeeks = adapter.validateTotalWeeks;
  root.ncepuValidateMonday = adapter.validateMonday;
  root.ncepuInspectTimetable = () =>
    adapter.inspectTimetablePage(root.document);
  adapter.run(root).finally(function () {
    root.__ncepuBaodingImportRunning = false;
  });
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const PERIODS = ["第一大节", "第二大节", "第三大节", "第四大节", "第五大节"];
  // Five major periods, retained from the original ClassTable adaptation.
  const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "09:40" },
    { number: 2, startTime: "10:00", endTime: "11:40" },
    { number: 3, startTime: "14:30", endTime: "16:10" },
    { number: 4, startTime: "16:30", endTime: "18:10" },
    { number: 5, startTime: "19:30", endTime: "21:10" },
  ];

  function clean(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isSchoolUrl(value) {
    try {
      const url = new URL(value);
      return (
        /^https?:$/.test(url.protocol) &&
        (url.hostname === "ncepu.edu.cn" ||
          url.hostname.endsWith(".ncepu.edu.cn"))
      );
    } catch (_) {
      return false;
    }
  }

  function periodOf(value) {
    return PERIODS.findIndex((label) => clean(value).includes(label)) + 1;
  }

  function rowsOf(table) {
    return Array.from(table.querySelectorAll("tr")).filter(
      (row) =>
        table.tagName?.toLowerCase() !== "table" ||
        row.closest("table") === table,
    );
  }

  // Use logical columns rather than td indexes when a heading spans rows/columns.
  function tableGrid(table) {
    const rows = rowsOf(table);
    const grid = [];
    rows.forEach((row, rowIndex) => {
      grid[rowIndex] ||= [];
      let column = 0;
      for (const cell of row.children) {
        if (!/^(TD|TH)$/.test(cell.tagName)) continue;
        while (grid[rowIndex][column]) column++;
        const height = Number(cell.getAttribute("rowspan") || 1);
        const width = Number(cell.getAttribute("colspan") || 1);
        if (
          !Number.isInteger(height) ||
          !Number.isInteger(width) ||
          height < 1 ||
          height > 100 ||
          width < 1 ||
          width > 20
        )
          throw new Error("课表包含无法识别的合并单元格");
        const entry = { cell, row: rowIndex, column, height, width };
        for (let r = rowIndex; r < rowIndex + height; r++) {
          grid[r] ||= [];
          for (let c = column; c < column + width; c++) {
            if (grid[r][c]) throw new Error("课表合并单元格发生重叠");
            grid[r][c] = entry;
          }
        }
        column += width;
      }
    });
    return { rows, grid };
  }

  function weekdayOf(value) {
    const match = /(?:星期|周)([一二三四五六日天])/.exec(clean(value));
    return match
      ? { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[1]]
      : null;
  }

  function weekdayColumns(grid) {
    const result = new Map();
    for (const entries of grid) {
      if (!entries) continue;
      if (entries.some((entry) => entry && periodOf(entry.cell.textContent)))
        break;
      entries.forEach((entry, column) => {
        if (!entry) return;
        const day = weekdayOf(entry.cell.textContent);
        if (!day) return;
        if (
          entry.width !== 1 ||
          (result.has(column) && result.get(column) !== day)
        )
          throw new Error("无法确定课表的星期表头");
        result.set(column, day);
      });
    }
    if (
      result.size &&
      (result.size !== 7 || new Set(result.values()).size !== 7)
    )
      throw new Error("星期表头不完整，请显示完整学期的周一至周日课表");
    return result;
  }

  function timetableCandidates(doc) {
    return Array.from(doc.querySelectorAll("table"))
      .filter(
        (table) =>
          !table.closest('[hidden],[aria-hidden="true"]') &&
          !/display\s*:\s*none/i.test(table.getAttribute("style") || ""),
      )
      .map((table) => {
        const rows = rowsOf(table);
        const hasPeriod = rows.some((row) =>
          Array.from(row.children).some(
            (cell) =>
              !cell.querySelector("table") && periodOf(cell.textContent),
          ),
        );
        const nodes = table.querySelectorAll(".kbcontent,.kbcontent1").length;
        return {
          table,
          score:
            hasPeriod && nodes
              ? (["kbtable", "timetable"].includes(table.id) ? 100000 : 0) +
                nodes
              : -1,
        };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);
  }

  function timetableRoot(doc) {
    const candidates = timetableCandidates(doc);
    if (candidates.length) {
      const best = candidates[0];
      if (
        candidates.some(
          (other, index) =>
            index &&
            other.score === best.score &&
            !other.table.contains(best.table) &&
            !best.table.contains(other.table),
        )
      )
        throw new Error("发现多个同等匹配的课表，请只显示要导入的完整学期课表");
      return best.table;
    }
    // Retain support for isolated tbody fragments used by the existing adapter.
    if (
      !doc.querySelector("table") &&
      doc.querySelector("tr .kbcontent,tr .kbcontent1")
    )
      return doc;
    throw new Error(
      "没有找到华电保定完整课表。请自行登录数字华电／WebVPN，进入教务系统 → 学生课表查询，选择整个学期后再次执行导入。若课表位于无法读取的跨域框架中，请直接打开该课表页面。",
    );
  }

  function inspectTimetablePage(doc) {
    const topDocument = doc;
    try {
      doc = findTimetableDocument(topDocument);
    } catch (_) {
      // Retain top-page counts when no supported timetable can be selected.
    }
    return {
      inFrame: doc !== topDocument,
      trustedSchoolPage: isSchoolUrl(doc.location?.href),
      kbtable: doc.querySelectorAll("table#kbtable").length,
      timetable: doc.querySelectorAll("table#timetable").length,
      weeklyTable: doc.querySelectorAll("table.qz-weeklyTable").length,
      courseNodes: doc.querySelectorAll(".kbcontent,.kbcontent1").length,
      candidateCount: timetableCandidates(doc).length,
      hasSemesterSelector: !!doc.querySelector(
        "select#xnxq01id,select[name=xnxq01id]",
      ),
      hasCalendarLink: !!calendarLink(doc),
    };
  }

  function findTimetableDocument(topDocument) {
    const documents = [];
    function visit(doc, depth) {
      if (!doc || documents.includes(doc)) return;
      documents.push(doc);
      if (depth >= 3) return;
      for (const frame of doc.querySelectorAll("iframe,frame")) {
        try {
          visit(frame.contentDocument, depth + 1);
        } catch (_) {
          // Cross-origin frames must be opened directly by the user.
        }
      }
    }
    function score(doc) {
      try {
        if (!isSchoolUrl(doc.location.href)) return -1;
        return timetableCandidates(doc)[0]?.score ?? -1;
      } catch (_) {
        return -1;
      }
    }
    visit(topDocument, 0);
    const candidates = documents.map((doc) => ({ doc, score: score(doc) }));
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 0) {
      throw new Error(
        "没有找到华电保定完整课表。请自行登录数字华电／WebVPN，进入教务系统 → 学生课表查询，选择整个学期后再次执行导入。若课表位于无法读取的跨域框架中，请直接打开该课表页面。",
      );
    }
    return candidates[0].doc;
  }

  function validateTotalWeeks(value) {
    return /^\d+$/.test(clean(value)) &&
      Number(value) >= 1 &&
      Number(value) <= 60
      ? false
      : "请输入 1–60 之间的学期总周数";
  }

  function validateMonday(value) {
    value = clean(value);
    if (!value) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      return "请使用 YYYY-MM-DD 格式，或留空稍后设置";
    const date = new Date(value + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value ||
      date.getUTCDay() !== 1
    )
      return "请输入真实的学期首周周一日期";
    return false;
  }

  function parseWeeks(input, totalWeeks) {
    if (validateTotalWeeks(String(totalWeeks)))
      throw new Error("学期总周数无效");
    let normalized = clean(input)
      .toLowerCase()
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/[～~—–]/g, "-")
      .replace(/[，、]/g, ",")
      .replace(/星期|周/g, "")
      .replace(/\s+/g, "");
    if (!normalized) throw new Error("缺少上课周次");
    // A single trailing parenthesized parity marker applies to the whole list.
    const parityMarkers = normalized.match(/单|双|odd|even/g) || [];
    const suffix = /\((单|双|odd|even)\)$/.exec(normalized);
    const globalParity = parityMarkers.length === 1 && suffix ? suffix[1] : "";
    if (globalParity) normalized = normalized.slice(0, suffix.index);
    const result = new Set();
    for (let part of normalized.split(",")) {
      if (!part) throw new Error("周次包含空项");
      const odd = /单|odd/.test(part + globalParity);
      const even = /双|even/.test(part + globalParity);
      if (odd && even) throw new Error("同一周次片段同时标记了单周和双周");
      part = part.replace(/单|双|odd|even/g, "").replace(/\(\)/g, "");
      if (part === "每" || part === "all" || !part) part = "1-" + totalWeeks;
      const match = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!match) throw new Error("无法识别周次：" + input);
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start < 1 || end > totalWeeks || start > end) {
        throw new Error(
          "周次范围须在 1–" + totalWeeks + " 内且不能倒序：" + input,
        );
      }
      for (let week = start; week <= end; week++) {
        if ((!odd || week % 2 === 1) && (!even || week % 2 === 0))
          result.add(week);
      }
    }
    if (!result.size) throw new Error("没有可用的上课周次：" + input);
    return Array.from(result).sort((a, b) => a - b);
  }

  function parseBlock(element) {
    const segments = [[]];
    let buffer = "";
    let activeTitle = "";
    function flush() {
      const value = clean(buffer);
      if (/^-{5,}$/.test(value)) {
        if (segments[segments.length - 1].length) segments.push([]);
      } else if (value) {
        segments[segments.length - 1].push({ value, title: activeTitle });
      }
      buffer = "";
      activeTitle = "";
    }
    function visit(node, inheritedTitle) {
      if (node.nodeType === 3) {
        // Formatting whitespace between tags must not swallow the next field's title.
        if (clean(node.textContent)) {
          if (clean(buffer) && activeTitle !== (inheritedTitle || "")) flush();
          activeTitle = inheritedTitle || "";
          buffer += node.textContent;
        }
      } else if (node.nodeType === 1) {
        if (node.tagName.toLowerCase() === "br") {
          flush();
          return;
        }
        const title = node.getAttribute("title") || inheritedTitle;
        for (const child of node.childNodes) visit(child, title);
      }
    }
    visit(element, "");
    flush();
    return segments
      .filter((lines) => lines.length)
      .map((lines) => {
        const normalizedTitle = (title) =>
          clean(title)
            .replace(/（/g, "(")
            .replace(/）/g, ")")
            .replace(/[:：\s]/g, "");
        const field = (...titles) => {
          const line = lines.find((item) =>
            titles.includes(normalizedTitle(item.title)),
          );
          return line ? line.value : "";
        };
        const plain = lines
          .filter(
            (line) =>
              ![
                "老师",
                "教师",
                "任课教师",
                "周次(节次)",
                "教室",
                "分组名称",
              ].includes(normalizedTitle(line.title)) &&
              !/课堂派|分组名称/.test(line.value),
          )
          .map((line) => line.value);
        const code = plain.find((line) => /^[A-Za-z0-9]+-\d+$/.test(line));
        return {
          name: plain.find((line) => line !== code) || "",
          teacher: field("老师", "教师", "任课教师").replace(
            /^(?:任课教师|老师|教师)[:：]\s*/,
            "",
          ),
          weeks: field("周次(节次)"),
          position: field("教室"),
        };
      });
  }

  function detailBlocks(cell) {
    const nodes = (name) =>
      [
        ...(cell.classList.contains(name) ? [cell] : []),
        ...cell.querySelectorAll("." + name),
      ].filter((node) => clean(node.textContent));
    const detailed = (node) =>
      Array.from(node.querySelectorAll("[title]")).some((field) =>
        /周次[（(]节次[）)]/.test(field.getAttribute("title") || ""),
      );
    const primary = nodes("kbcontent");
    const fallback = nodes("kbcontent1");
    const richPrimary = primary.filter(detailed);
    const richFallback = fallback.filter(detailed);
    const selected = richPrimary.length
      ? richPrimary
      : richFallback.length
        ? richFallback
        : primary.length
          ? primary
          : fallback;
    return selected.filter(
      (node) =>
        !selected.some((other) => other !== node && node.contains(other)),
    );
  }

  function weekAndPeriods(value, rowPeriod, coveredPeriods) {
    const normalized = clean(value).replace(/［/g, "[").replace(/］/g, "]");
    const match = /^(.*?)\s*\[([^\]]+)节\]\s*$/.exec(normalized);
    if (!match)
      return {
        weeks: normalized,
        periods: coveredPeriods.length ? coveredPeriods : [rowPeriod],
      };
    const sections = parseWeeks(match[2], 10);
    const periods = [
      ...new Set(sections.map((section) => Math.ceil(section / 2))),
    ];
    // Small-period details must consist of complete pairs matching their major rows.
    // A partial major period needs the school's actual small-period times, not a guess.
    if (
      periods.some(
        (period) =>
          !sections.includes(period * 2 - 1) || !sections.includes(period * 2),
      )
    )
      throw new Error("课程只占部分大节，需先确认小节作息，不能按完整大节导入");
    const expected = coveredPeriods.length ? coveredPeriods : [rowPeriod];
    if (
      periods.length !== expected.length ||
      periods.some((period) => !expected.includes(period))
    )
      throw new Error("周次中的小节与课表大节位置不一致，请核对页面结构");
    return { weeks: match[1], periods };
  }

  function parseDocument(doc, totalWeeks) {
    const courses = [];
    const errors = [];
    const notes = [];
    const seen = new Set();
    let table, layout, days;
    try {
      table = timetableRoot(doc);
      layout = tableGrid(table);
      days = weekdayColumns(layout.grid);
    } catch (error) {
      return { courses, errors: [error.message], notes };
    }
    const rowPeriods = layout.rows.map((row) => {
      const heading = Array.from(row.children).find((cell) =>
        periodOf(cell.textContent),
      );
      return heading ? periodOf(heading.textContent) : 0;
    });
    const processedCells = new Set();
    for (const [rowIndex, row] of layout.rows.entries()) {
      const heading =
        Array.from(row.children).find(
          (cell) =>
            periodOf(cell.textContent) ||
            /备注|第.+大节/.test(clean(cell.textContent)),
        ) || row.querySelector("th");
      const label = heading ? clean(heading.textContent) : "";
      const period = rowPeriods[rowIndex];
      if (label.includes("备注")) {
        const note = clean(
          Array.from(row.children)
            .filter((cell) => cell !== heading)
            .map((cell) => cell.textContent)
            .join("\n"),
        );
        if (note) notes.push(note);
        continue;
      }
      if (!period) {
        if (
          Array.from(row.querySelectorAll(".kbcontent,.kbcontent1")).some(
            (node) => clean(node.textContent),
          )
        ) {
          errors.push("无法识别课程所在大节：" + (label || "缺少大节表头"));
        }
        continue;
      }
      const logicalRow = layout.grid[rowIndex];
      const headingEntry = logicalRow.find((entry) => entry?.cell === heading);
      const fallbackStart = headingEntry
        ? headingEntry.column + headingEntry.width
        : 1;
      const entries = [...new Set(logicalRow.filter(Boolean))];
      for (const entry of entries) {
        const cell = entry.cell;
        if (cell === heading || processedCells.has(cell)) continue;
        const blocks = detailBlocks(cell);
        if (!blocks.length) continue;
        processedCells.add(cell);
        if (!days.size && fallbackStart !== 1) {
          errors.push("缺少星期表头且存在额外表头列，无法确定课程星期");
          continue;
        }
        const cellDays = [];
        for (let col = entry.column; col < entry.column + entry.width; col++) {
          const day = days.size ? days.get(col) : col - fallbackStart + 1;
          if (day >= 1 && day <= 7) cellDays.push(day);
          else errors.push("课程单元格超出已识别的星期列");
        }
        const coveredPeriods = [
          ...new Set(
            rowPeriods
              .slice(entry.row, entry.row + entry.height)
              .filter(Boolean),
          ),
        ];
        for (const block of blocks) {
          for (const parsed of parseBlock(block)) {
            if (!parsed.name) {
              if (parsed.weeks || parsed.teacher || parsed.position)
                errors.push("课程名称缺失，请检查完整课表");
              continue;
            }
            try {
              const detail = weekAndPeriods(
                parsed.weeks,
                period,
                coveredPeriods,
              );
              const weeks = parseWeeks(detail.weeks, totalWeeks);
              for (const day of cellDays) {
                for (const major of detail.periods) {
                  const course = {
                    name: parsed.name,
                    teacher: parsed.teacher,
                    position: parsed.position,
                    day,
                    startSection: major,
                    endSection: major,
                    weeks,
                  };
                  const key = JSON.stringify(course);
                  if (!seen.has(key)) {
                    seen.add(key);
                    courses.push(course);
                  }
                }
              }
            } catch (error) {
              errors.push(parsed.name + "：" + error.message);
            }
          }
        }
      }
    }
    if (!courses.length && !errors.length)
      errors.push("没有识别到课程，请确认课表已加载且选择了完整学期");
    return { courses, errors, notes };
  }

  function selectedSemester(doc) {
    const select = doc.querySelector("select#xnxq01id,select[name=xnxq01id]");
    const value = clean(select?.value);
    const match = /^(\d{4})-(\d{4})-([12])$/.exec(value);
    return match && Number(match[2]) === Number(match[1]) + 1 ? value : null;
  }

  function calendarLink(doc) {
    if (!isSchoolUrl(doc.location?.href)) return null;
    for (const anchor of doc.querySelectorAll("a[href]")) {
      try {
        const url = new URL(anchor.getAttribute("href"), doc.location.href);
        if (
          url.origin === new URL(doc.location.href).origin &&
          /\/jxzl\/jxzl_query\/?$/.test(url.pathname)
        )
          return url.href;
      } catch (_) {
        /* Ignore malformed links. */
      }
    }
    return null;
  }

  function readSemesterInfo(doc, expectedSemester) {
    const semester = selectedSemester(doc);
    const result = {
      semester,
      totalWeeks: null,
      startDate: null,
      calendarUrl: calendarLink(doc),
    };
    if (expectedSemester && semester !== expectedSemester) return result;
    const valueOf = (selector, attribute) => {
      const node = doc.querySelector(selector);
      return clean(
        node?.getAttribute(attribute) || node?.value || node?.textContent,
      );
    };
    const explicitWeeks = valueOf(
      '[name="semesterTotalWeeks"],#semesterTotalWeeks,[data-semester-total-weeks]',
      "data-semester-total-weeks",
    );
    const explicitDate = valueOf(
      '[name="semesterStartDate"],#semesterStartDate,[data-semester-start-date]',
      "data-semester-start-date",
    );
    if (explicitWeeks && !validateTotalWeeks(explicitWeeks))
      result.totalWeeks = Number(explicitWeeks);
    if (explicitDate && !validateMonday(explicitDate))
      result.startDate = explicitDate;
    // Calendar dates need an explicit matching semester and Monday column.
    if (!semester) return result;
    for (const table of doc.querySelectorAll("table#kbtable,table#dataTable")) {
      try {
        const { rows, grid } = tableGrid(table);
        const days = weekdayColumns(grid);
        const mondayColumn = [...days].find(([, day]) => day === 1)?.[0];
        if (mondayColumn === undefined) continue;
        const weeks = new Map();
        rows.forEach((row, index) => {
          const first = row.querySelector("td,th");
          const match = /^(?:第\s*)?(\d+)(?:\s*周)?$/.exec(
            clean(first?.textContent),
          );
          if (match && Number(match[1]) >= 1 && Number(match[1]) <= 60)
            weeks.set(Number(match[1]), index);
        });
        const maximum = Math.max(0, ...weeks.keys());
        if (!maximum || weeks.size !== maximum || !weeks.has(1)) continue;
        result.totalWeeks ??= maximum;
        const cell = grid[weeks.get(1)]?.[mondayColumn]?.cell;
        const dateValue = clean(
          cell?.getAttribute("title") ||
            cell?.getAttribute("data-date") ||
            cell?.textContent,
        );
        const dateMatch = /^(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?$/.exec(
          dateValue,
        );
        if (dateMatch) {
          const iso =
            dateMatch[1] +
            "-" +
            dateMatch[2].padStart(2, "0") +
            "-" +
            dateMatch[3].padStart(2, "0");
          const year = Number(dateMatch[1]);
          const [firstYear, lastYear] = semester.split("-").map(Number);
          if (year >= firstYear && year <= lastYear && !validateMonday(iso))
            result.startDate ??= iso;
        }
      } catch (_) {
        /* Ambiguous calendars fall back to manual input. */
      }
    }
    return result;
  }

  async function completeSemesterInfo(root, doc, current) {
    if (
      !current.semester ||
      !current.calendarUrl ||
      (current.totalWeeks && current.startDate)
    )
      return current;
    const pageWindow = doc.defaultView;
    const fetcher =
      typeof pageWindow?.fetch === "function"
        ? pageWindow.fetch.bind(pageWindow)
        : root.fetch?.bind(root);
    if (!fetcher) return current;
    const Controller = pageWindow?.AbortController || root.AbortController;
    const controller = Controller ? new Controller() : null;
    let timer;
    try {
      const response = await Promise.race([
        fetcher(current.calendarUrl, {
          method: "GET",
          credentials: "same-origin",
          signal: controller?.signal,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller?.abort();
            reject(new Error("教学周历读取超时"));
          }, 8000);
        }),
      ]);
      if (
        !response.ok ||
        !response.url ||
        new URL(response.url).origin !== new URL(doc.location.href).origin
      )
        return current;
      const Parser = pageWindow?.DOMParser || root.DOMParser;
      if (!Parser) return current;
      const calendar = new Parser().parseFromString(
        await response.text(),
        "text/html",
      );
      const details = readSemesterInfo(calendar, current.semester);
      if (details.semester !== current.semester) return current;
      return {
        ...current,
        totalWeeks: current.totalWeeks ?? details.totalWeeks,
        startDate: current.startDate ?? details.startDate,
      };
    } catch (_) {
      return current;
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(root) {
    const bridge = root.shiguangBridgePromise;
    const native = root.shiguangBridge;
    let wroteData = false;
    try {
      const doc = findTimetableDocument(root.document);
      let semesterInfo = readSemesterInfo(doc);
      if (
        semesterInfo.calendarUrl &&
        semesterInfo.semester &&
        !(semesterInfo.totalWeeks && semesterInfo.startDate)
      )
        semesterInfo = await completeSemesterInfo(root, doc, semesterInfo);
      const weeksInput = await bridge.showPrompt(
        "学期总周数",
        (semesterInfo.semester
          ? "当前页面学期：" + semesterInfo.semester + "。"
          : "") +
          (semesterInfo.totalWeeks
            ? "已读取总周数，请核对后确认。"
            : "请输入当前所选学期的总周数。不会自动推测开学日期。"),
        String(semesterInfo.totalWeeks || 20),
        "ncepuValidateWeeks",
      );
      if (weeksInput === null) return;
      if (validateTotalWeeks(weeksInput)) throw new Error("学期总周数无效");
      const totalWeeks = Number(weeksInput);
      const draft = parseDocument(doc, totalWeeks);
      if (draft.errors.length) throw new Error(draft.errors.join("\n"));
      const monday = await bridge.showPrompt(
        "学期首周周一",
        (semesterInfo.startDate ? "已读取首周周一，请核对。" : "") +
          "填写 YYYY-MM-DD；留空则清空开学日期，稍后在课表设置中填写。",
        semesterInfo.startDate || "",
        "ncepuValidateMonday",
      );
      if (monday === null) return;
      if (validateMonday(monday)) throw new Error("学期首周周一日期无效");
      const summary =
        "识别到 " +
        draft.courses.length +
        " 条课程安排。\n" +
        "将替换所选课表的课程、学期设置和作息。五大节默认时间：08:00–09:40、10:00–11:40、14:30–16:10、16:30–18:10、19:30–21:10（可在导入后调整）。\n" +
        "总周数：" +
        totalWeeks +
        "；首周周一：" +
        (clean(monday) || "稍后设置") +
        "。\n" +
        (draft.notes.length
          ? "以下未排课备注不生成有时间的课程，请另行记录：\n" +
            draft.notes.join("\n")
          : "") +
        "\n请确认当前显示的是完整学期课表；建议导入到新建课表。";
      if (
        !(await bridge.showAlert("确认导入华电保定课表", summary, "确认导入"))
      )
        return;
      async function save(method, payload) {
        // Native writes are separate operations: any failure may leave a partial import.
        wroteData = true;
        if ((await bridge[method](JSON.stringify(payload))) !== true) {
          throw new Error("保存未完成：" + method);
        }
      }
      await save("savePresetTimeSlots", TIME_SLOTS);
      await save("saveCourseConfig", {
        semesterStartDate: clean(monday) || null,
        semesterTotalWeeks: totalWeeks,
        defaultClassDuration: 100,
        defaultBreakDuration: 20,
        firstDayOfWeek: 1,
      });
      await save("saveImportedCourses", draft.courses);
      native.showToast("华电保定课表导入成功，请核对课程、作息和开学日期。");
      native.notifyTaskCompletion();
    } catch (error) {
      const message = error.message || "请返回完整学期课表后重试";
      const suffix = wroteData
        ? "\n部分设置可能已写入，请核对所选课表并重新执行导入。"
        : "\n尚未写入课程或设置。";
      await bridge.showAlert(
        "华电保定课表导入未完成",
        message + suffix,
        "知道了",
      );
    }
  }

  return {
    TIME_SLOTS,
    isSchoolUrl,
    findTimetableDocument,
    inspectTimetablePage,
    readSemesterInfo,
    completeSemesterInfo,
    validateTotalWeeks,
    validateMonday,
    parseWeeks,
    parseDocument,
    run,
  };
});
