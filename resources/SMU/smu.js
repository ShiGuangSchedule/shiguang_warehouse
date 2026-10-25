// 南方医科大学（广州乘方科技智慧教务）拾光课表适配脚本
// 适配页面：https://zhjw.smu.edu.cn/new/student/xsgrkb/week.page
// 入口路径：信息查询 - 课表查询 - 我的课表
//
// 实现说明：
// 1. 页面本身使用 fullCalendar，通过 POST /new/student/xsgrkb/getCalendarWeekDatas
//    取得 JSON 课程数据；本脚本直接复用该接口，一次拉取整学期，避免解析 DOM。
// 2. zc 为空时接口返回整个学期的逐周记录，每条记录自带 zc（周次）与 qsrq（上课日期），
//    因此开学日期可由「上课日期 - (周次-1)*7 - (星期-1)」反推，无需手工填写。
// 3. 学校分「校本部」与「顺德校区」两套作息，节次时间逐 5 分钟错开。脚本先按节次
//    起始时间投票判定校区，再用接口返回的真实上下课时间校正各节次，最后才回落到
//    学校公布的时间对照表。

(function () {
    var SECTION_LENGTH_MINUTES = 40; // 每小节 40 分钟
    var SECTION_STRIDE_MINUTES = 45; // 同一大节内相邻小节间隔 45 分钟（40 上课 + 5 课间）
    var MAX_SECTION = 14;

    // 大节分组：同一大节内相邻小节相差 45 分钟，跨大节还有更长的课间，
    // 因此只能在组内递推，不能用一个固定步长跨组推算。
    var SECTION_GROUPS = [[1, 2], [3, 4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14]];

    // 学校公布的《课表时间对照表》各节次起始时间，仅用于接口未覆盖到的节次。
    var CAMPUS_TIMETABLES = {
        shunde: {
            label: "顺德校区",
            starts: {
                1: "08:30", 2: "09:15", 3: "10:20", 4: "11:05", 5: "11:50",
                6: "14:00", 7: "14:45", 8: "15:45", 9: "16:30",
                10: "19:30", 11: "20:15", 12: "21:00", 13: "21:45", 14: "22:30"
            }
        },
        main: {
            label: "校本部",
            starts: {
                1: "08:00", 2: "08:45", 3: "09:50", 4: "10:35", 5: "11:20",
                6: "14:30", 7: "15:15", 8: "16:15", 9: "17:00",
                10: "19:30", 11: "20:15", 12: "21:00", 13: "21:45", 14: "22:30"
            }
        }
    };

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log(message);
        }
    }

    async function alertUser(title, message) {
        var bridge = window.shiguangBridgePromise;
        if (bridge && bridge.showAlert) {
            return await bridge.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    async function chooseSemester(options, defaultIndex) {
        var bridge = window.shiguangBridgePromise;
        if (bridge && bridge.showSingleSelection) {
            var labels = options.map(function (option) {
                return option.label + "（" + option.value + "）";
            });
            var index = await bridge.showSingleSelection("选择要导入的学期", labels, defaultIndex);
            if (typeof index !== "number" || index < 0 || index >= options.length) return null;
            return options[index];
        }
        return options[defaultIndex >= 0 && defaultIndex < options.length ? defaultIndex : 0];
    }

    function pad2(value) {
        return (value < 10 ? "0" : "") + value;
    }

    function normalizeText(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/<[^>]*>/g, "")
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/[０-９]/g, function (ch) {
                return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
            })
            .replace(/\s+/g, " ")
            .trim();
    }

    /** 把 "8:30:00" / "08:30" 统一成 "08:30"。 */
    function normalizeClock(value) {
        var match = normalizeText(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match) return null;
        return pad2(parseInt(match[1], 10)) + ":" + pad2(parseInt(match[2], 10));
    }

    function clockToMinutes(clock) {
        var parts = clock.split(":");
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }

    function minutesToClock(totalMinutes) {
        var normalized = ((totalMinutes % 1440) + 1440) % 1440;
        return pad2(Math.floor(normalized / 60)) + ":" + pad2(normalized % 60);
    }

    function shiftClock(clock, minutes) {
        return minutesToClock(clockToMinutes(clock) + minutes);
    }

    function shiftDate(dateText, days) {
        var match = normalizeText(dateText).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!match) return null;
        var date = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
        date.setDate(date.getDate() + days);
        return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    }

    /** 在同一文档或其同源子 iframe 中查找课表页面（#xnxqdm 是学期下拉框）。 */
    function findScheduleDocument() {
        var queue = [document];
        var visited = 0;
        while (queue.length > 0 && visited < 24) {
            var doc = queue.shift();
            visited++;
            if (doc && doc.querySelector && doc.querySelector("#xnxqdm")) return doc;
            var frames = doc && doc.querySelectorAll ? doc.querySelectorAll("iframe") : [];
            for (var index = 0; index < frames.length; index++) {
                try {
                    var child = frames[index].contentDocument;
                    if (child && child.body) queue.push(child);
                } catch (error) {
                    // 跨域 iframe 无法读取，忽略。
                }
            }
        }
        return null;
    }

    function readSemesterOptions(doc) {
        var select = doc.querySelector("#xnxqdm");
        if (!select || !select.options) return null;
        var options = [];
        var defaultIndex = 0;
        for (var index = 0; index < select.options.length; index++) {
            var option = select.options[index];
            var value = normalizeText(option.value);
            if (!/^\d{6}$/.test(value)) continue;
            if (option.selected) defaultIndex = options.length;
            options.push({ value: value, label: normalizeText(option.textContent) || value });
        }
        return options.length > 0 ? { options: options, defaultIndex: defaultIndex } : null;
    }

    /**
     * 学期总周数：优先取课表页「周次」下拉框的最大周（含无课周），
     * 否则回落到已排课周次的最大值。门户只渲染有课的周，但下拉框是完整的。
     */
    function readTotalWeeksFromPage(doc) {
        var select = doc.querySelector("#zc");
        if (!select || !select.options) return 0;
        var max = 0;
        for (var index = 0; index < select.options.length; index++) {
            var numbers = normalizeText(select.options[index].value).match(/^(\d+)$/);
            if (!numbers) continue;
            var week = parseInt(numbers[1], 10);
            if (week > max && week <= 60) max = week;
        }
        return max;
    }

    /** 兼容 "3"、"1,3,5"、"1-16"、"1-16单" 等写法。 */
    function parseWeekField(value) {
        var weeks = [];
        normalizeText(value)
            .replace(/周/g, "")
            .replace(/[，、；;]/g, ",")
            .replace(/[－–—~～至到]/g, "-")
            .split(",")
            .forEach(function (part) {
                var text = part.replace(/\s/g, "");
                if (!text) return;
                var isOdd = /单/.test(text);
                var isEven = /双/.test(text);
                var numbers = text.match(/\d+/g) || [];
                if (numbers.length === 0) return;
                var start = parseInt(numbers[0], 10);
                var end = numbers.length > 1 ? parseInt(numbers[1], 10) : start;
                if (!start || !end || start > end) return;
                for (var week = start; week <= end; week++) {
                    if (isOdd && week % 2 === 0) continue;
                    if (isEven && week % 2 !== 0) continue;
                    if (weeks.indexOf(week) === -1) weeks.push(week);
                }
            });
        return weeks.sort(function (a, b) { return a - b; });
    }

    /** 星期：优先用 xq（周一=1），否则由 qsxq（周日=1）换算。 */
    function resolveWeekday(row) {
        var weekday = parseInt(row.xq, 10);
        if (weekday >= 1 && weekday <= 7) return weekday;
        var sundayFirst = parseInt(row.qsxq, 10);
        if (sundayFirst >= 1 && sundayFirst <= 7) return sundayFirst === 1 ? 7 : sundayFirst - 1;
        return 0;
    }

    async function fetchSemesterRows(semesterCode) {
        return await postCalendar(semesterCode, "", yearWindow(semesterCode));
    }

    /** 该学期的宽松日期窗口；接口实际按 zc 过滤，窗口只作兜底。 */
    function yearWindow(semesterCode) {
        var year = parseInt(semesterCode.substring(0, 4), 10);
        return [year + "-01-01 00:00:00", (year + 1) + "-12-31 23:59:59"];
    }

    async function postCalendar(semesterCode, zc, dateRange) {
        var body = "xnxqdm=" + encodeURIComponent(semesterCode)
            + "&zc=" + encodeURIComponent(zc)
            + "&d1=" + encodeURIComponent(dateRange[0])
            + "&d2=" + encodeURIComponent(dateRange[1]);
        var response = await fetch("/new/student/xsgrkb/getCalendarWeekDatas", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: body
        });
        if (!response.ok) throw new Error("课表接口返回 HTTP " + response.status);
        var text = await response.text();
        var result;
        try {
            result = JSON.parse(text);
        } catch (error) {
            throw new Error("课表接口返回的不是课程数据，可能登录状态已失效，请重新登录后再试");
        }
        if (!result) throw new Error("课表接口没有返回内容");
        if (result.code !== undefined && Number(result.code) < 0) {
            throw new Error(normalizeText(result.message) || "教务系统拒绝返回课表");
        }
        var rows = Array.isArray(result.data) ? result.data : [];
        return rows.filter(function (row) { return row && typeof row === "object"; });
    }

    /** 按节次起始时间投票判定校区，两校区仅起始时间不同。 */
    function detectCampus(rows) {
        var scores = { shunde: 0, main: 0 };
        rows.forEach(function (row) {
            var section = parseInt(row.ps, 10);
            var clock = normalizeClock(row.qssj);
            if (!section || !clock) return;
            Object.keys(CAMPUS_TIMETABLES).forEach(function (campus) {
                if (CAMPUS_TIMETABLES[campus].starts[section] === clock) scores[campus]++;
            });
        });
        if (scores.main > scores.shunde) return "main";
        // 打平时按顺德校区处理：两校区第十节以后作息完全一致，且在校生主体在顺德。
        return "shunde";
    }

    function groupOf(section) {
        for (var index = 0; index < SECTION_GROUPS.length; index++) {
            if (SECTION_GROUPS[index].indexOf(section) !== -1) return SECTION_GROUPS[index];
        }
        return [section];
    }

    /**
     * 计算各节次开始时间：先用接口返回的真实上下课时间投票，再用学校对照表补空。
     * 课程块只在同一大节内按 45 分钟递推；跨大节的块只采信它的起始节次。
     */
    function buildSectionStarts(rows, campus) {
        var votes = {};
        var addVote = function (section, clock) {
            if (!votes[section]) votes[section] = {};
            votes[section][clock] = (votes[section][clock] || 0) + 1;
        };
        rows.forEach(function (row) {
            var startSection = parseInt(row.ps, 10);
            var endSection = parseInt(row.pe, 10);
            var clock = normalizeClock(row.qssj);
            if (!startSection || !clock) return;
            addVote(startSection, clock);
            if (!endSection || endSection <= startSection) return;
            var group = groupOf(startSection);
            if (group.indexOf(endSection) === -1) return; // 跨大节，不能按固定步长线性递推
            var startIndex = group.indexOf(startSection);
            for (var step = 1; step <= group.length - 1 - startIndex; step++) {
                var section = group[startIndex + step];
                if (section > endSection) break;
                addVote(section, shiftClock(clock, step * SECTION_STRIDE_MINUTES));
            }
        });

        var starts = {};
        for (var section = 1; section <= MAX_SECTION; section++) {
            var tally = votes[section];
            var best = null;
            var bestCount = 0;
            if (tally) {
                Object.keys(tally).forEach(function (clock) {
                    if (tally[clock] > bestCount) { best = clock; bestCount = tally[clock]; }
                });
            }
            starts[section] = best || CAMPUS_TIMETABLES[campus].starts[section];
        }
        return starts;
    }

    function parseCourseRows(rows) {
        var map = {};
        rows.forEach(function (row) {
            var name = normalizeText(row.kcmc);
            if (!name) return;

            var weekday = resolveWeekday(row);
            if (!weekday) return;

            var startSection = parseInt(row.ps, 10);
            if (!startSection || startSection < 1 || startSection > MAX_SECTION) return;
            var endSection = parseInt(row.pe, 10);
            if (!endSection || endSection < startSection) endSection = startSection;
            if (endSection > MAX_SECTION) endSection = MAX_SECTION;

            var weeks = parseWeekField(row.zc);
            if (weeks.length === 0) return;

            var teacher = normalizeText(row.teaxms);
            var position = normalizeText(row.jxcdmc);
            if (!position && String(row.bapjxcd) === "1") position = "不用场地";

            var key = [name, teacher, position, weekday, startSection, endSection].join("|");
            var existing = map[key];
            if (!existing) {
                map[key] = {
                    name: name,
                    teacher: teacher,
                    position: position,
                    day: weekday,
                    startSection: startSection,
                    endSection: endSection,
                    weeks: weeks.slice()
                };
                return;
            }
            weeks.forEach(function (week) {
                if (existing.weeks.indexOf(week) === -1) existing.weeks.push(week);
            });
        });

        return Object.keys(map).map(function (key) {
            var course = map[key];
            course.weeks.sort(function (a, b) { return a - b; });
            return course;
        }).sort(function (a, b) {
            return a.day - b.day
                || a.startSection - b.startSection
                || a.name.localeCompare(b.name, "zh-Hans-CN");
        });
    }

    /**
     * 用「指定周次」查询真正的上课日期，反推第 1 周周一。
     *
     * 不能在「全部」结果上推算：那个模式下 zc 可能为 0（页面用
     * getWeekSummary4Lock 把 0 显示成「全部」），单行又是多周合并值，
     * qsrq 到底对应其中哪一周没有可靠约定。指定 zc 时接口返回的每条
     * 记录都属于该周，qsrq 就是该周真实的某一天，含义确定。
     *
     * 传入的 row 只用来找一行「有星期、有日期」的记录，周次以查询参数为准。
     */
    function startDateFromWeekRows(rows, week) {
        for (var index = 0; index < rows.length; index++) {
            var row = rows[index];
            var weekday = resolveWeekday(row);
            if (!weekday) continue;
            var date = normalizeText(row.qsrq).match(/^(\d{4}-\d{1,2}-\d{1,2})/);
            if (!date) continue;
            var candidate = shiftDate(date[1], -((week - 1) * 7 + (weekday - 1)));
            if (candidate) return candidate;
        }
        return null;
    }

    /** 依次试第 1、2、3 周……直到拿到日期；有课的周才可能返回记录。 */
    async function detectSemesterStartDate(semesterCode, probeWeeks) {
        var tried = [];
        for (var index = 0; index < probeWeeks.length; index++) {
            var week = probeWeeks[index];
            if (tried.indexOf(week) !== -1) continue;
            tried.push(week);
            var rows;
            try {
                rows = await postCalendar(semesterCode, String(week), yearWindow(semesterCode));
            } catch (error) {
                continue;
            }
            if (!rows || rows.length === 0) continue;
            var candidate = startDateFromWeekRows(rows, week);
            if (candidate) return candidate;
        }
        return null;
    }

    function buildTimeSlots(sectionStarts, maxSection) {
        var slots = [];
        for (var section = 1; section <= maxSection; section++) {
            var start = sectionStarts[section];
            if (!start) return null;
            slots.push({
                number: section,
                startTime: start,
                endTime: shiftClock(start, SECTION_LENGTH_MINUTES)
            });
        }
        return slots;
    }

    async function saveToApp(courses, timeSlots, config) {
        var bridge = window.shiguangBridgePromise;
        if (!bridge || !bridge.saveImportedCourses) {
            console.log("SMU parsed courses:", JSON.stringify(courses, null, 2));
            console.log("SMU parsed time slots:", JSON.stringify(timeSlots, null, 2));
            return true;
        }
        await bridge.saveCourseConfig(JSON.stringify(config));
        await bridge.savePresetTimeSlots(JSON.stringify(timeSlots));
        return await bridge.saveImportedCourses(JSON.stringify(courses));
    }

    function summarizeWeeks(courses) {
        var weeks = [];
        courses.forEach(function (course) {
            course.weeks.forEach(function (week) {
                if (weeks.indexOf(week) === -1) weeks.push(week);
            });
        });
        return weeks.sort(function (a, b) { return a - b; });
    }

    async function runImportFlow() {
        try {
            var doc = findScheduleDocument();
            if (!doc) {
                await alertUser(
                    "未找到课表页面",
                    "请先进入「信息查询 - 课表查询 - 我的课表」，等课表加载出来后再点击导入。\n"
                    + "直接在本系统首页导入无法确定学期。"
                );
                return;
            }

            var semesterInfo = readSemesterOptions(doc);
            if (!semesterInfo) {
                await alertUser("未识别到学期", "课表页面的学期下拉框没有可用的学期，请刷新页面后重试。");
                return;
            }

            var semester = semesterInfo.options.length === 1
                ? semesterInfo.options[0]
                : await chooseSemester(semesterInfo.options, semesterInfo.defaultIndex);
            if (!semester) {
                toast("已取消导入");
                return;
            }

            toast("正在读取 " + semester.label + " 的课表…");
            var rows = await fetchSemesterRows(semester.value);
            if (rows.length === 0) {
                await alertUser(
                    "该学期没有课程",
                    semester.label + " 没有查询到任何课程。如果你确实有课，请确认学期是否选对，"
                    + "或先在教务系统页面确认课表能正常显示。"
                );
                return;
            }

            var courses = parseCourseRows(rows);
            if (courses.length === 0) {
                await alertUser(
                    "未解析到课程",
                    "接口返回了数据，但没有解析出可用的课程条目。请把这个问题反馈给适配维护者。"
                );
                return;
            }

            var campus = detectCampus(rows);
            var sectionStarts = buildSectionStarts(rows, campus);
            var maxSection = courses.reduce(function (max, course) {
                return Math.max(max, course.endSection);
            }, 1);
            var timeSlots = buildTimeSlots(sectionStarts, maxSection);
            if (!timeSlots) {
                await alertUser("节次时间不完整", "无法确定完整作息时间，请稍后重试或反馈给适配维护者。");
                return;
            }

            // 先用有课的周探测真实上课日期，再反推第 1 周周一。
            var probeWeeks = summarizeWeeks(courses).slice(0, 4);
            if (probeWeeks.length === 0) probeWeeks = [1];
            var startDate = await detectSemesterStartDate(semester.value, probeWeeks);
            var allWeeks = summarizeWeeks(courses);
            // 门户下拉框给出完整周数（含无课周）；接口只返回有课的周，取两者较大值。
            var pageWeeks = readTotalWeeksFromPage(doc);
            var totalWeeks = Math.max(pageWeeks, allWeeks[allWeeks.length - 1]);

            var lines = [
                "学期：" + semester.label + "（" + semester.value + "）",
                "作息：" + CAMPUS_TIMETABLES[campus].label + "，共 " + maxSection + " 节",
                startDate
                    ? "开学日期：" + startDate + "（第 1 周周一，按上课日期自动推算）"
                    : "开学日期：未推算出来，请在预览中补填",
                "课程：" + courses.length + " 个时间段，覆盖第 "
                    + allWeeks[0] + "-" + allWeeks[allWeeks.length - 1] + " 周"
                    + (totalWeeks > allWeeks[allWeeks.length - 1] ? "（学期共 " + totalWeeks + " 周）" : ""),
                "",
                "接下来会打开预览，请核对课程、周次和节次无误后再确认写入。"
            ];
            var confirmed = await alertUser("南方医科大学课表导入", lines.join("\n"));
            if (!confirmed) return;

            var config = {
                semesterStartDate: startDate || null,
                semesterTotalWeeks: totalWeeks,
                defaultClassDuration: SECTION_LENGTH_MINUTES,
                defaultBreakDuration: SECTION_STRIDE_MINUTES - SECTION_LENGTH_MINUTES,
                firstDayOfWeek: 1
            };

            var saved = await saveToApp(courses, timeSlots, config);
            if (!saved) {
                toast("课程保存失败，请重试");
                return;
            }

            toast("导入成功：" + courses.length + " 个课程时间段");
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("SMU import failed:", error);
            await alertUser("导入失败", error && error.message ? error.message : String(error));
        }
    }

    runImportFlow();
})();
