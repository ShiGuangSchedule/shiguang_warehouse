// 佛山职业技术学院综合教务管理系统（强智科技）拾光课表适配脚本
// 课表页：https://jwgl.fspt.edu.cn/jsxsd/xskb/xskb_list.do
// 读取学期下拉框，让用户选择学期后只读请求该学期课表并解析，不提交任何表单。

(function () {
    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log(message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    function normalizeText(text) {
        return String(text || "")
            .replace(/\u00a0/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/[０-９]/g, function (ch) {
                return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
            })
            .replace(/[，、]/g, ",")
            .replace(/[－–—~～至到]/g, "-")
            .replace(/[（）]/g, function (ch) {
                return ch === "（" ? "(" : ")";
            })
            .replace(/\s+/g, " ")
            .trim();
    }

    function findScheduleDocument() {
        if (document.querySelector("#kbtable")) return document;

        const frames = Array.from(document.querySelectorAll("iframe"));
        for (const frame of frames) {
            try {
                const frameDoc = frame.contentDocument || frame.contentWindow.document;
                if (frameDoc && frameDoc.querySelector("#kbtable")) return frameDoc;
            } catch (e) {
                // Ignore cross-origin or inaccessible frames.
            }
        }

        return null;
    }

    function getTitleText(container, title) {
        const node = container.querySelector(
            `font[title="${title}"], span[title="${title}"], div[title="${title}"]`
        );
        return normalizeText(node ? node.textContent : "");
    }

    function parseDay(courseDiv, fallbackDay) {
        const id = courseDiv.getAttribute("id") || "";
        const match = id.match(/-(\d)-\d$/);
        if (match) return parseInt(match[1], 10);
        return fallbackDay || 0;
    }

    function parseWeeks(weekText) {
        const text = normalizeText(weekText)
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\(周\)/g, "")
            .replace(/周/g, "")
            .replace(/\s/g, "");

        const weeks = new Set();
        text.split(/[;,；]/).forEach(function (part) {
            if (!part) return;
            const isOdd = /单/.test(part);
            const isEven = /双/.test(part);
            const ranges = part.match(/\d+(?:-\d+)?/g) || [];

            ranges.forEach(function (rangeText) {
                const range = rangeText.split("-").map(function (value) {
                    return parseInt(value, 10);
                });
                const start = range[0];
                const end = range.length > 1 ? range[1] : start;
                if (!start || !end || start > end) return;

                for (let week = start; week <= end; week++) {
                    if (isOdd && week % 2 === 0) continue;
                    if (isEven && week % 2 !== 0) continue;
                    weeks.add(week);
                }
            });
        });

        return Array.from(weeks).sort(function (a, b) { return a - b; });
    }

    function parseSections(weekText) {
        const text = normalizeText(weekText).replace(/\s/g, "");
        const match = text.match(/\[([^\]]+)\]/);
        if (!match) return [];

        const numbers = match[1].match(/\d+/g) || [];
        if (numbers.length === 0) return [];

        const start = parseInt(numbers[0], 10);
        const end = parseInt(numbers[numbers.length - 1], 10);
        if (!start || !end || start > end) return [];

        const sections = [];
        for (let section = start; section <= end; section++) {
            sections.push(section);
        }
        return sections;
    }

    function parseBlock(block, day) {
        const teacher = getTitleText(block, "老师") || getTitleText(block, "教师");
        const weekText = getTitleText(block, "周次(节次)");
        const roomText = getTitleText(block, "教室");

        // 强智此校的节次写在教室后面，如“教学楼A-205[01-02]节”
        const sections = parseSections(roomText + " " + weekText);
        const weeks = parseWeeks(weekText);
        const position = normalizeText(roomText.replace(/\[[^\]]*\]\s*节?/g, "")) || "未知地点";

        // 课程名取第一行文本（第二行重复，且 title 元素已移除）
        const clone = block.cloneNode(true);
        Array.from(clone.querySelectorAll("font[title], span[title], div[title]")).forEach(function (n) { n.remove(); });
        const lines = clone.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
            .split(/\n+/)
            .map(function (line) { return line.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim(); })
            .filter(function (line) { return line && !/^-+$/.test(line); });
        const name = (lines[0] || "").replace(/[●★○]/g, "").trim();

        if (!name || !day || weeks.length === 0 || sections.length === 0) return null;

        return {
            name: name,
            teacher: teacher || "未知教师",
            position: position,
            day: day,
            startSection: sections[0],
            endSection: sections[sections.length - 1],
            weeks: weeks
        };
    }

    // 一个格子里可能有多门课，课与课之间用 18 个以上的“-”分隔（课内的分隔线只有 16 个）
    function parseCourseDiv(courseDiv, fallbackDay) {
        if (normalizeText(courseDiv.textContent).length < 2) return [];
        const day = parseDay(courseDiv, fallbackDay);
        const parts = courseDiv.innerHTML.split(/-{18,}\s*(?:<br\s*\/?>)?/i);
        const result = [];
        parts.forEach(function (html) {
            const holder = document.createElement("div");
            holder.innerHTML = html;
            const course = parseBlock(holder, day);
            if (course) result.push(course);
        });
        return result;
    }

    function parseCourses(doc) {
        const table = doc.querySelector("#kbtable");
        if (!table) return [];

        const courses = [];
        Array.from(table.querySelectorAll("tr")).forEach(function (row) {
            const cells = Array.from(row.querySelectorAll("td"));
            cells.forEach(function (cell, index) {
                const fallbackDay = index + 1;
                Array.from(cell.querySelectorAll("div.kbcontent")).forEach(function (courseDiv) {
                    if (courseDiv.classList.contains("sykb2")) return;
                    parseCourseDiv(courseDiv, fallbackDay).forEach(function (c) { courses.push(c); });
                });
            });
        });

        return mergeCourses(courses);
    }

    function mergeCourses(courses) {
        const map = new Map();

        courses.forEach(function (course) {
            const key = [
                course.name,
                course.teacher,
                course.position,
                course.day,
                course.startSection,
                course.endSection
            ].join("|");

            if (!map.has(key)) {
                map.set(key, {
                    name: course.name,
                    teacher: course.teacher,
                    position: course.position,
                    day: course.day,
                    startSection: course.startSection,
                    endSection: course.endSection,
                    weeks: course.weeks.slice()
                });
                return;
            }

            const existing = map.get(key);
            existing.weeks = Array.from(new Set(existing.weeks.concat(course.weeks)));
        });

        return Array.from(map.values())
            .map(function (course) {
                course.weeks = course.weeks.sort(function (a, b) { return a - b; });
                return course;
            })
            .sort(function (a, b) {
                return a.day - b.day ||
                    a.startSection - b.startSection ||
                    a.name.localeCompare(b.name);
            });
    }

    async function saveToApp(courses) {
        const maxWeek = Math.max.apply(null, courses.flatMap(function (course) { return course.weeks; }));
        const config = {
            semesterTotalWeeks: Number.isFinite(maxWeek) && maxWeek > 0 ? maxWeek : 20,
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 5
        };

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        }

        console.log("FSPT parsed courses:", JSON.stringify(courses, null, 2));
        return true;
    }

    const SCHEDULE_PATH = "/jsxsd/xskb/xskb_list.do";

    async function fetchScheduleDoc(termId) {
        const url = location.origin + SCHEDULE_PATH + (termId ? "?xnxq01id=" + encodeURIComponent(termId) : "");
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) throw new Error("请求课表失败：HTTP " + resp.status);
        const html = await resp.text();
        return new DOMParser().parseFromString(html, "text/html");
    }

    async function chooseTerm(doc) {
        const select = doc.querySelector("#xnxq01id");
        if (!select) return null;
        const options = Array.from(select.options).filter(function (o) { return o.value; });
        if (options.length === 0) return null;
        if (!(window.shiguangBridgePromise && window.shiguangBridgePromise.showSingleSelection)) {
            return (options.find(function (o) { return o.selected; }) || options[0]).value;
        }
        const names = options.map(function (o) { return normalizeText(o.textContent); });
        let def = options.findIndex(function (o) { return o.selected; });
        if (def < 0) def = 0;
        const index = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), def);
        if (index === null || index === undefined || index < 0) return undefined;
        return options[index].value;
    }

    async function runImportFlow() {
        try {
            if (!/jwgl\.fspt\.edu\.cn$/.test(location.hostname)) {
                await alertUser("页面不正确", "请先登录佛山职业技术学院教务系统（jwgl.fspt.edu.cn），再点击导入。");
                return;
            }

            let doc = findScheduleDocument();
            if (!doc) doc = await fetchScheduleDoc("");

            const termId = await chooseTerm(doc);
            if (termId === undefined) return;
            if (termId) doc = await fetchScheduleDoc(termId);

            const courses = parseCourses(doc);
            if (courses.length === 0) {
                await alertUser("未解析到课程", "该学期没有解析到有效课程。请确认已登录且所选学期有课表，或换一个学期重试。");
                return;
            }

            const saved = await saveToApp(courses);
            if (!saved) {
                toast("课程保存失败，请重试");
                return;
            }

            toast("导入成功：" + courses.length + " 个课程时段。请在App内手动设置作息时间");
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("FSPT import failed:", error);
            await alertUser("导入失败", error && error.message ? error.message : String(error));
        }
    }

    runImportFlow();
})();
