// 北京邮电大学本科教务管理系统拾光课表适配脚本
// 适配页面：https://jwgl.bupt.edu.cn/jsxsd/xskb/xskb_list.do
// 当前版本只解析已打开的“学期理论课表”页面，不主动请求接口。

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

    function extractCourseName(courseDiv) {
        const clone = courseDiv.cloneNode(true);

        Array.from(clone.querySelectorAll("font[title], span[title], div[title]")).forEach(function (node) {
            node.remove();
        });
        Array.from(clone.querySelectorAll("span")).forEach(function (node) {
            const text = normalizeText(node.textContent);
            if (/^[A-Z]$/.test(text) || /^[●★○]+$/.test(text)) node.remove();
        });

        const holder = document.createElement("div");
        holder.innerHTML = clone.innerHTML.replace(/<br\s*\/?>/gi, "\n");
        const lines = holder.textContent
            .split(/\n+/)
            .map(normalizeText)
            .filter(function (line) {
                return line && line !== "-" && !/^\(\d+\)$/.test(line);
            });

        return normalizeText((lines[0] || "").replace(/[●★○]/g, ""));
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

    function parseCourseDiv(courseDiv, fallbackDay) {
        const rawText = normalizeText(courseDiv.textContent);
        if (!rawText || rawText === "&nbsp;" || rawText.length < 2) return null;

        const name = extractCourseName(courseDiv);
        const teacher = getTitleText(courseDiv, "老师") || getTitleText(courseDiv, "教师");
        const weekText = getTitleText(courseDiv, "周次(节次)");
        const position = getTitleText(courseDiv, "教室") || "未知地点";
        const weeks = parseWeeks(weekText);
        const sections = parseSections(weekText);
        const day = parseDay(courseDiv, fallbackDay);

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
                    const course = parseCourseDiv(courseDiv, fallbackDay);
                    if (course) courses.push(course);
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

    function parseTimeSlots(doc) {
        const table = doc.querySelector("#kbtable");
        if (!table) return [];

        const map = new Map();
        Array.from(table.querySelectorAll("tr")).forEach(function (row) {
            const header = row.querySelector("th");
            if (!header) return;

            const text = normalizeText(header.textContent);
            const match = text.match(/^(\d+).*?(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
            if (!match) return;

            const number = parseInt(match[1], 10);
            if (!number || map.has(number)) return;

            map.set(number, {
                number: number,
                startTime: match[2].padStart(5, "0"),
                endTime: match[3].padStart(5, "0")
            });
        });

        return Array.from(map.values()).sort(function (a, b) { return a.number - b.number; });
    }

    async function saveToApp(courses, timeSlots) {
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
        if (timeSlots.length > 0 && window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        }

        console.log("BUPT parsed courses:", JSON.stringify(courses, null, 2));
        console.log("BUPT parsed time slots:", JSON.stringify(timeSlots, null, 2));
        return true;
    }

    async function runImportFlow() {
        try {
            const doc = findScheduleDocument();
            if (!doc) {
                await alertUser(
                    "未找到课表",
                    "请不要在教务系统主页直接导入。请先进入“学期理论课表”页面，并等待课表加载完成后再点击导入。"
                );
                return;
            }

            const confirmed = await alertUser(
                "北邮课表导入",
                "请确认当前不是教务系统主页，而是已经进入“学期理论课表”页面。脚本将直接解析当前页面显示的课表，请确认学期正确且页面已加载完成。"
            );
            if (!confirmed) return;

            const courses = parseCourses(doc);
            const timeSlots = parseTimeSlots(doc);

            if (courses.length === 0) {
                await alertUser(
                    "未解析到课程",
                    "当前页面没有解析到有效课程。请确认课表页面中存在课程块，或把一段 kbcontent HTML 发给我继续微调。"
                );
                return;
            }

            const saved = await saveToApp(courses, timeSlots);
            if (!saved) {
                toast("课程保存失败，请重试");
                return;
            }

            toast(`导入成功：${courses.length} 个课程时段${timeSlots.length ? "，已同步作息时间" : ""}`);
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("BUPT import failed:", error);
            await alertUser("导入失败", error && error.message ? error.message : String(error));
        }
    }

    runImportFlow();
})();
