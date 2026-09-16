// 湖北大学(HUBU) 拾光课程表适配脚本
// 教务系统: 强智教务 (jwxt.hubu.edu.cn/jsxsd)，登录走统一身份认证(SSO)
// 课表数据位于 kbtable 表格中每个 td 的 div.kbcontent 里
// 本校开发者适配，如有问题请提 issue 或提交 PR

(function () {
    "use strict";

    // 课表接口相对路径（与登录域名同源）
    var SCHEDULE_PATH = "/jsxsd/xskb/xskb_list.do";

    // 湖北大学作息时间（共 11 节）
    // 夏季作息：约 5 月 - 9 月执行，下午 14:30 开始上课
    // 秋季作息：约 10 月 - 次年 4 月执行，下午 14:00 开始上课
    var TIME_SLOTS = {
        summer: [
            { number: 1, startTime: "08:00", endTime: "08:45" },
            { number: 2, startTime: "08:55", endTime: "09:40" },
            { number: 3, startTime: "09:55", endTime: "10:40" },
            { number: 4, startTime: "10:50", endTime: "11:35" },
            { number: 5, startTime: "14:30", endTime: "15:15" },
            { number: 6, startTime: "15:25", endTime: "16:10" },
            { number: 7, startTime: "16:25", endTime: "17:10" },
            { number: 8, startTime: "17:20", endTime: "18:05" },
            { number: 9, startTime: "19:00", endTime: "19:45" },
            { number: 10, startTime: "19:55", endTime: "20:40" },
            { number: 11, startTime: "20:50", endTime: "21:35" }
        ],
        autumn: [
            { number: 1, startTime: "08:00", endTime: "08:45" },
            { number: 2, startTime: "08:55", endTime: "09:40" },
            { number: 3, startTime: "09:55", endTime: "10:40" },
            { number: 4, startTime: "10:50", endTime: "11:35" },
            { number: 5, startTime: "14:00", endTime: "14:45" },
            { number: 6, startTime: "14:55", endTime: "15:40" },
            { number: 7, startTime: "15:55", endTime: "16:40" },
            { number: 8, startTime: "16:50", endTime: "17:35" },
            { number: 9, startTime: "19:00", endTime: "19:45" },
            { number: 10, startTime: "19:55", endTime: "20:40" },
            { number: 11, startTime: "20:50", endTime: "21:35" }
        ]
    };

    var SCHEDULE_OPTIONS = ["夏季作息（约 5 月 - 9 月）", "秋季作息（约 10 月 - 次年 4 月）"];

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        }
    }

    // 清理教务页面文本中的空格与非断行空格
    function normalizeText(value) {
        return (value || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    }

    // 将周次文本解析为排序去重后的周次数组
    // 支持 "1-16周"、"1-9,11-16(单周)"、"1-16周[1-2节]" 等形式
    function parseWeeks(value) {
        var text = normalizeText(value);
        // 先去掉节次信息 "第[1-2节]" / "[01-02节]"
        text = text.replace(/第?\s*\[[^\]]*节\]/g, "");
        // 提取并记录单双周标记
        var typeMatch = text.match(/\(([^)]*)\)/);
        var weekType = typeMatch ? typeMatch[1] : "";
        text = text.replace(/\([^)]*\)/g, "");
        // 去掉 "周" 字样
        text = text.replace(/周/g, "").trim();

        var weeks = new Set();
        text.split(/[,，]/).forEach(function (part) {
            var seg = part.trim();
            if (!seg) return;
            var range = seg.split("-").map(function (n) { return parseInt(n, 10); });
            if (!Number.isFinite(range[0])) return;
            var end = Number.isFinite(range[1]) ? range[1] : range[0];
            for (var w = range[0]; w <= end; w++) weeks.add(w);
        });

        var result = Array.from(weeks).sort(function (a, b) { return a - b; });
        if (weekType.indexOf("单") !== -1) {
            result = result.filter(function (w) { return w % 2 === 1; });
        } else if (weekType.indexOf("双") !== -1) {
            result = result.filter(function (w) { return w % 2 === 0; });
        }
        return result;
    }

    // 将节次文本解析为 [开始节, 结束节]，如 "[1-2节]" -> [1, 2]
    function parsePeriods(value) {
        var match = normalizeText(value).match(/\[([^\]]+)\]/);
        if (!match) return null;
        var numbers = match[1].match(/\d+/g);
        if (!numbers || numbers.length === 0) return null;
        return [parseInt(numbers[0], 10), parseInt(numbers[numbers.length - 1], 10)];
    }

    // 查找主页面或同源 iframe 中包含课表(kbtable)的文档
    function findScheduleDocument() {
        if (document.querySelector("#kbtable")) return document;
        return Array.from(document.querySelectorAll("iframe")).reduce(function (found, frame) {
            if (found) return found;
            try {
                var frameDoc = frame.contentDocument || frame.contentWindow.document;
                return frameDoc && frameDoc.querySelector("#kbtable") ? frameDoc : null;
            } catch (error) {
                return null;
            }
        }, null);
    }

    // 解析单个课程块，生成应用需要的课程对象
    function parseCourseBlock(block) {
        var holder = document.createElement("div");
        holder.innerHTML = block;

        // 课程名：优先取 kbtc 弹出浮窗的 font 文本，否则取第一行文本
        var name = "";
        var nameFont = holder.querySelector('font[onmouseover*="kbtc"]');
        if (nameFont) {
            name = normalizeText(nameFont.textContent);
        } else {
            var firstLine = holder.innerHTML.split(/<br\s*\/?\s*>/i)[0];
            var nameHolder = document.createElement("div");
            nameHolder.innerHTML = firstLine;
            name = normalizeText(nameHolder.textContent);
        }

        var teacher = normalizeText(
            (holder.querySelector('font[title="老师"], font[title="教师"]') || {}).textContent || ""
        ).replace(/^(任课教师|任课老师)[:：]\s*/, "");

        var position = normalizeText(
            (holder.querySelector('font[title="教室"]') || {}).textContent || ""
        );

        var weekPeriod = normalizeText(
            (holder.querySelector('font[title="周次(节次)"]') || {}).textContent || ""
        );

        var periods = parsePeriods(weekPeriod);
        var weeks = parseWeeks(weekPeriod);

        if (!name || weeks.length === 0 || !periods) return null;

        return {
            name: name,
            teacher: teacher || "未知教师",
            position: position || "未指定",
            weeks: weeks,
            startSection: periods[0],
            endSection: periods[1]
        };
    }

    // 遍历课表单元格，解析课程并合并重复记录
    function parseCourses(doc) {
        var table = doc.querySelector("#kbtable");
        if (!table) return [];

        var courses = new Map();
        var rows = Array.from(table.querySelectorAll("tr")).filter(function (row) {
            return row.querySelector("td");
        });

        rows.forEach(function (row) {
            var cells = row.querySelectorAll("td");
            // 每行最多 7 个星期列（首个节次标签为 th，不计入 td）
            for (var day = 1; day <= 7 && day <= cells.length; day++) {
                var cell = cells[day - 1];
                Array.from(cell.querySelectorAll("div.kbcontent")).forEach(function (div) {
                    // 跳过隐藏的重复单元格
                    var style = (div.getAttribute("style") || "").replace(/\s+/g, "");
                    if (/display\s*:\s*none/i.test(style)) return;

                    // 同一单元格内多门课程之间以一行短横线分隔
                    var blocks = div.innerHTML.split(/[-—]{10,}/);
                    blocks.forEach(function (block) {
                        var course = parseCourseBlock(block);
                        if (!course) return;
                        course.day = day;
                        var key = [course.name, course.teacher, course.position, day, course.weeks.join(",")].join("|");
                        if (!courses.has(key)) {
                            courses.set(key, course);
                            return;
                        }
                        // 同一课程分块时合并节次范围
                        var existing = courses.get(key);
                        existing.startSection = Math.min(existing.startSection, course.startSection);
                        existing.endSection = Math.max(existing.endSection, course.endSection);
                    });
                });
            }
        });

        return Array.from(courses.values()).sort(function (a, b) {
            return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
        });
    }

    // 从当前页面获取已选择的学期编号
    function getSemesterId(doc) {
        var select = doc.querySelector("#xnxq01id");
        return select ? select.value : "";
    }

    // 请求指定学期的课表页面并解析为文档对象
    async function fetchScheduleDocument(semesterId) {
        var body = "jx0404id=&cj0701id=&zc=&demo=&xnxq01id=" + encodeURIComponent(semesterId);
        var response = await fetch(SCHEDULE_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            credentials: "include",
            body: body
        });
        if (!response.ok) throw new Error("课表请求失败：HTTP " + response.status);
        return new DOMParser().parseFromString(await response.text(), "text/html");
    }

    // 让用户选择当前执行的作息时间
    async function selectSchedule() {
        var selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择作息时间",
            JSON.stringify(SCHEDULE_OPTIONS),
            0
        );
        if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= SCHEDULE_OPTIONS.length) {
            toast("已取消导入");
            return null;
        }
        return selectedIndex;
    }

    // 保存课程配置、作息时间段和课程数据
    async function saveData(courses, scheduleIndex) {
        var maxWeek = courses.reduce(function (max, course) {
            return Math.max(max, Math.max.apply(null, course.weeks));
        }, 0);
        var config = {
            semesterTotalWeeks: Math.max(20, Number.isFinite(maxWeek) ? maxWeek : 0),
            firstDayOfWeek: 1
        };
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }
        var slots = scheduleIndex === 0 ? TIME_SLOTS.summer : TIME_SLOTS.autumn;
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        }
        return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    }

    // 编排确认、课表获取、解析和保存的完整导入流程
    async function runImport() {
        try {
            var confirmed = await window.shiguangBridgePromise.showAlert(
                "提示",
                "请确保已登录湖北大学教务系统，并切换到个人课表页面。是否开始导入？",
                "开始"
            );
            if (!confirmed) return;

            var scheduleIndex = await selectSchedule();
            if (scheduleIndex === null) return;

            // 优先直接解析当前已加载的课表页面，否则按当前学期重新请求
            var currentDoc = findScheduleDocument() || document;
            var semesterId = getSemesterId(currentDoc);
            var scheduleDoc = currentDoc.querySelector("#kbtable")
                ? currentDoc
                : await fetchScheduleDocument(semesterId);

            var courses = parseCourses(scheduleDoc);
            if (courses.length === 0) {
                toast("未解析到课程，请确认已登录且课表页面已加载完成");
                return;
            }

            var saved = await saveData(courses, scheduleIndex);
            if (!saved) {
                toast("课程导入失败");
                return;
            }
            toast("成功导入 " + courses.length + " 门课程");
            if (window.shiguangBridge.notifyTaskCompletion) window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            console.error("HUBU import failed:", error);
            toast("导入失败：" + error.message);
        }
    }

    // 检查桥接 API 可用后启动导入流程
    if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
        runImport();
    }
})();
