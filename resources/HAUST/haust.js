// resources/HAUST/haust.js
// 河南科技大学 - 新版树维教务

async function promptUserToStart() {
    try {
        var confirmed = await window.shiguangBridgePromise.showAlert(
            "教务系统课表导入",
            "请按以下步骤操作：\n\n1. 先在浏览器中登录VPN\n2. 进入教务系统\n3. 点击【我的课表】\n4. 确保课表已完整显示\n5. 然后点击下方按钮开始导入",
            "我已进入课表页面，开始导入"
        );
        return confirmed === true;
    } catch (error) {
        console.error("显示弹窗出错:", error);
        return false;
    }
}

async function getSemesterList() {
    try {
        var response = await fetch("/eams/dataQuery.action", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "dataType=semesterCalendar&tagId=semesterBar&empty=true",
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error("请求失败: " + response.status);
        }

        var text = await response.text();
        var data = eval("(" + text + ")");

        if (!data || !data.semesters) {
            throw new Error("未找到学期数据");
        }

        var allSemesters = [];
        for (var key in data.semesters) {
            if (key.startsWith("y") && Array.isArray(data.semesters[key])) {
                for (var i = 0; i < data.semesters[key].length; i++) {
                    allSemesters.push(data.semesters[key][i]);
                }
            }
        }

        if (allSemesters.length === 0) {
            throw new Error("学期列表为空");
        }

        allSemesters.sort(function(a, b) {
            var yearA = a.schoolYear.split("-")[0];
            var yearB = b.schoolYear.split("-")[0];
            if (yearB !== yearA) return parseInt(yearB) - parseInt(yearA);
            return parseInt(b.name) - parseInt(a.name);
        });

        var semesterTexts = allSemesters.map(function(sem) {
            return sem.schoolYear + "学年第" + sem.name + "学期";
        });

        var selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesterTexts),
            0
        );

        if (selectedIndex !== null && selectedIndex >= 0) {
            window.shiguangBridge.showToast("已选择: " + semesterTexts[selectedIndex]);
            return allSemesters[selectedIndex];
        }

        return null;
    } catch (error) {
        console.error("获取学期出错:", error);
        window.shiguangBridge.showToast("获取学期出错: " + error.message);
        return null;
    }
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    var cleaned = weekStr.replace(/周/g, "").trim();
    if (!cleaned) return [];

    var weeks = [];
    var parts = cleaned.split(",");

    for (var p = 0; p < parts.length; p++) {
        var trimmed = parts[p].trim();
        if (!trimmed) continue;

        var isOdd = trimmed.charAt(0) === "单";
        var isEven = trimmed.charAt(0) === "双";
        var rangeStr = isOdd || isEven ? trimmed.substring(1) : trimmed;

        var ranges = rangeStr.split(/\s+/);
        for (var r = 0; r < ranges.length; r++) {
            var range = ranges[r];
            var rangeMatch = range.match(/^(\d+)\s*[-~]\s*(\d+)$/);
            if (rangeMatch) {
                var start = parseInt(rangeMatch[1], 10);
                var end = parseInt(rangeMatch[2], 10);
                for (var w = start; w <= end; w++) {
                    if (isOdd && w % 2 === 0) continue;
                    if (isEven && w % 2 === 1) continue;
                    weeks.push(w);
                }
            } else {
                var num = parseInt(range, 10);
                if (!isNaN(num)) {
                    if (isOdd && num % 2 === 0) continue;
                    if (isEven && num % 2 === 1) continue;
                    weeks.push(num);
                }
            }
        }
    }

    weeks.sort(function(a, b) { return a - b; });
    var unique = [];
    var seen = {};
    for (var i = 0; i < weeks.length; i++) {
        if (!seen[weeks[i]]) {
            unique.push(weeks[i]);
            seen[weeks[i]] = true;
        }
    }
    return unique;
}

function parsePeriod(periodStr) {
    if (!periodStr) return null;
    var match = periodStr.match(/(\d+)\s*[-~]\s*(\d+)/);
    if (match) {
        return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
    }
    return null;
}

function stripHtml(html) {
    if (!html) return "";
    return html.replace(/<[^>]+>/g, "").trim();
}

function parseTitle(title) {
    if (!title) return [];
    var courses = [];
    var cleanTitle = stripHtml(title);

    // 格式: "课程名(课程号) (教师);;;(周次,节次,教室)"
    // 先提取课程名、课程号、教师
    var nameMatch = cleanTitle.match(/^(.+?)\(([^)]+)\)\s*\(([^)]+)\)/);
    if (!nameMatch) return [];

    var courseName = nameMatch[1].trim();
    var teacher = nameMatch[3].trim();

    // 提取周次、节次、教室 - 找到含"周"的括号内容，手动提取到最后一个")"
    var detailStart = cleanTitle.search(/\(\d+[-~]\d+周/);
    if (detailStart === -1) return [];

    var lastParen = cleanTitle.lastIndexOf(")");
    if (lastParen <= detailStart) return [];

    var details = cleanTitle.substring(detailStart + 1, lastParen);
    var parts = details.split(",");

    var weeksStr = parts.length >= 1 ? parts[0].trim() : "";
    var periodStr = parts.length >= 2 ? parts[1].trim() : "";
    var room = parts.length >= 3 ? parts.slice(2).join(",").trim() : "";

    var weeks = parseWeeks(weeksStr);
    var period = parsePeriod(periodStr);

    if (weeks.length > 0 && period) {
        courses.push({
            courseName: courseName,
            teacher: teacher,
            weeks: weeks,
            startSection: period.start,
            endSection: period.end,
            room: room
        });
    }

    return courses;
}

function tryFindCourseTable() {
    // 方法1: 当前页面直接查找
    var cells = document.querySelectorAll("td[title]");
    if (cells.length === 0) cells = document.querySelectorAll("td[id^='TD']");
    if (cells.length > 0) {
        return { doc: document, cells: cells, source: "current" };
    }

    // 方法2: iframe
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
        try {
            var iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
            if (!iframeDoc) continue;

            cells = iframeDoc.querySelectorAll("td[title]");
            if (cells.length === 0) cells = iframeDoc.querySelectorAll("td[id^='TD']");
            if (cells.length > 0) {
                return { doc: iframeDoc, cells: cells, source: "iframe" };
            }

            // 方法3: iframe的iframe
            var innerIframes = iframeDoc.querySelectorAll("iframe");
            for (var j = 0; j < innerIframes.length; j++) {
                try {
                    var innerDoc = innerIframes[j].contentDocument || innerIframes[j].contentWindow.document;
                    if (!innerDoc) continue;

                    cells = innerDoc.querySelectorAll("td[title]");
                    if (cells.length === 0) cells = innerDoc.querySelectorAll("td[id^='TD']");
                    if (cells.length > 0) {
                        return { doc: innerDoc, cells: cells, source: "inner-iframe" };
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    return null;
}

function parseCoursesFromTable(tableData) {
    var allCourses = [];
    var seenKeys = {};
    var cells = tableData.cells;

    for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var title = cell.getAttribute("title");
        if (!title || !title.trim()) continue;

        var row = cell.parentElement;
        if (!row) continue;

        var rowCells = Array.from(row.cells);
        var colIndex = rowCells.indexOf(cell);

        var day = colIndex;
        if (day < 1 || day > 7) continue;

        var parsed = parseTitle(title);

        for (var j = 0; j < parsed.length; j++) {
            var course = parsed[j];
            if (course.weeks.length === 0 || course.startSection === 0) continue;

            var key = course.courseName + "_" + day + "_" + course.startSection + "_" + course.weeks.join(",");
            if (seenKeys[key]) continue;
            seenKeys[key] = true;

            allCourses.push({
                name: course.courseName,
                teacher: course.teacher,
                position: course.room,
                day: day,
                startSection: course.startSection,
                endSection: course.endSection,
                weeks: course.weeks
            });
        }
    }

    return allCourses;
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    window.shiguangBridge.showToast("开始导入...");

    var alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return;
    }

    window.shiguangBridge.showToast("正在查找课表...");

    var tableData = tryFindCourseTable();
    if (!tableData) {
        window.shiguangBridge.showToast("未找到课表，请确保已进入【我的课表】页面");
        return;
    }

    window.shiguangBridge.showToast("找到课表 (" + tableData.source + ")，共 " + tableData.cells.length + " 个单元格");

    // 调试：输出前几个单元格信息
    var debugInfo = [];
    for (var d = 0; d < Math.min(5, tableData.cells.length); d++) {
        var dc = tableData.cells[d];
        var dt = dc.getAttribute("title") || "";
        var dr = dc.parentElement;
        var dci = -1;
        if (dr) {
            var drc = Array.from(dr.cells);
            dci = drc.indexOf(dc);
        }
        debugInfo.push(dc.id + "|col:" + dci + "|day:" + dci + "|title:" + dt.substring(0, 80));
    }
    console.log("HAUST调试: " + debugInfo.join(" || "));

    var courses = parseCoursesFromTable(tableData);
    if (courses.length === 0) {
        // 输出解析失败的调试信息
        var failDebug = [];
        for (var f = 0; f < Math.min(3, tableData.cells.length); f++) {
            var fc = tableData.cells[f];
            var ft = fc.getAttribute("title") || "";
            var fr = fc.parentElement;
            var fci = -1;
            if (fr) {
                var frc = Array.from(fr.cells);
                fci = frc.indexOf(fc);
            }
            var parsed = parseTitle(ft);
            failDebug.push("col:" + fci + "|parsed:" + parsed.length + "|raw:" + ft.substring(0, 60));
        }
        window.shiguangBridge.showToast("解析失败: " + failDebug[0]);
    }
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程，请检查课表是否完整显示");
        return;
    }

    var saveResult = await saveCourses(courses);
    if (!saveResult) return;

    window.shiguangBridge.showToast("导入成功！共 " + courses.length + " 门课程");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
