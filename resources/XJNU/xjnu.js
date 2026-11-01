// 新疆师范大学本科教务适配 — CkYtxwz
(function (root) {
    "use strict";

    const ORIGIN = "https://jwxt.xjnu.edu.cn";
    const TIMETABLE_PATH = "/jsxsd/xskb/xskb_list.do";
    const CALENDAR_PATH = "/jsxsd/jxzl/jxzl_query";
    // 2025 年春季起的官方作息：https://www.xjnu.edu.cn/info/1080/38891.htm
    const TIME_PROFILES = [
        { id: "wq-other", label: "温泉：1号教学楼及其他楼宇", morning: ["10:00-10:45", "10:50-11:35", "12:00-12:45", "12:50-13:35"] },
        { id: "wq-2", label: "温泉：2号教学楼", morning: ["10:00-10:45", "10:50-11:35", "11:50-12:35", "12:40-13:25"] },
        { id: "wq-3", label: "温泉：3号教学楼", morning: ["10:00-10:45", "10:50-11:35", "12:10-12:55", "13:00-13:45"] },
        { id: "kl-wenshi", label: "昆仑：文史楼", morning: ["10:00-10:45", "10:55-11:40", "12:00-12:45", "12:55-13:40"] },
        { id: "kl-other", label: "昆仑：其他楼宇", morning: ["10:00-10:45", "10:55-11:40", "12:10-12:55", "13:05-13:50"] }
    ];
    const COMMON_AFTERNOON = ["15:30-16:15", "16:25-17:10", "17:30-18:15", "18:25-19:10", "20:00-20:45", "20:55-21:40"];
    const DAY_NAMES = ["", "一", "二", "三", "四", "五", "六", "日"];
    const text = node => (node?.textContent || "").replace(/\s+/g, " ").trim();
    function cells(row) {
        const result = [];
        for (const element of row.children) if (/^(TD|TH)$/.test(element.tagName)) result.push(element);
        return result;
    }

    function timeProfile(id) {
        for (const profile of TIME_PROFILES) if (profile.id === id) return profile;
        throw new Error("未能识别学校作息方案。");
    }

    function timeSlots(profileId) {
        const result = [];
        for (const range of [...timeProfile(profileId).morning, ...COMMON_AFTERNOON]) {
            const [startTime, endTime] = range.split("-");
            result.push({ number: result.length + 1, startTime, endTime });
        }
        return result;
    }

    function courseTimes(course, profileId) {
        const slots = timeSlots(profileId);
        if (!slots[course.startSection - 1] || !slots[course.endSection - 1]) throw new Error("官方作息仅公布了第 1—10 节。");
        return { start: slots[course.startSection - 1].startTime, end: slots[course.endSection - 1].endTime };
    }

    function buildingKey(position) {
        const value = position.replace(/\s/g, "");
        return value.match(/^.*?(?:楼|体育馆|运动场|操场)/)?.[0] || value;
    }

    function exactTimeProfile(position) {
        const value = buildingKey(position);
        // 官方楼名与校区：https://jwc.xjnu.edu.cn/info/1682/14003.htm
        // 文育楼：https://db.xjnu.edu.cn/info/1191/1992.htm
        // 行知、行远楼：https://www.xjnu.edu.cn/info/1081/71732.htm
        const wenquanName = value.replace(/^温泉(?:校区)?[：:（(]?/, "");
        if (wenquanName === "齐学楼") return "wq-2";
        if (wenquanName === "治学楼") return "wq-3";
        if (/^(?:正学楼|笃学楼|文育楼|行知楼|行远楼)$/.test(wenquanName)) return "wq-other";
        // 无校区的楼号仍不能确定作息；明确标注其他校区的同名楼宇也不套用温泉映射。
        if (/^温泉(?:校区)?[（(]?2号教学楼$/.test(value)) return "wq-2";
        if (/^温泉(?:校区)?[（(]?3号教学楼$/.test(value)) return "wq-3";
        if (/^温泉(?:校区)?[（(]?1号教学楼$/.test(value)) return "wq-other";
        if (/^(?:昆仑(?:校区)?[（(]?)?文史楼$/.test(value)) return "kl-wenshi";
        return null;
    }

    async function prepareTiming(api, courses, semester) {
        const preserve = reason => ({ courses, slots: null, description: reason + "按节次导入，保留目标课表已有作息时间。" });
        const parts = semester.split("-");
        const year = Number(parts[0]), term = Number(parts[2]);
        if (year < 2024 || (year === 2024 && term === 1)) return preserve("该学期早于官方 2025 年春季作息的实施时间。\n");
        for (const course of courses) {
            if (course.endSection > 10) return preserve("课表含第 10 节以后的课程，官方作息未公布对应时间，无法完整校准。\n");
        }
        const options = [];
        for (const profile of TIME_PROFILES) options.push({ value: profile.id, label: profile.label + "（第3节 " + profile.morning[2].split("-")[0] + "）" });
        const base = await choose(api, "选择课表默认作息（2025年春季起）", [...options, { value: "keep", label: "保留目标课表现有作息" }]);
        if (base === null) return null;
        if (base === "keep") return preserve("");
        if (typeof api.savePresetTimeSlots !== "function") throw new Error("当前拾光版本不支持导入作息，请更新后重试。");
        const assignments = new Map();
        const confirmations = new Set();
        const converted = [];
        let customCount = 0;
        for (const course of courses) {
            const defaultTimes = courseTimes(course, base);
            // 第一节单节以及下午、晚间等在全部方案中相同，无需追问楼宇。
            let differs = false;
            for (const profile of TIME_PROFILES) {
                const times = courseTimes(course, profile.id);
                if (times.start !== defaultTimes.start || times.end !== defaultTimes.end) { differs = true; break; }
            }
            let profileId = base;
            if (differs) {
                const key = buildingKey(course.position);
                // 只有带校区的楼名可以复用确认；空地点、未注明校区的楼名逐条确认。
                const cacheable = /^(?:温泉|昆仑)(?:校区)?/.test(key);
                profileId = exactTimeProfile(course.position) || (cacheable ? assignments.get(key) : null);
                const context = course.name + "（周" + DAY_NAMES[course.day] + "，第" + course.startSection + "—" + course.endSection + "节，第" + course.weeks.join("、") + "周；" + (course.position || "未注明教室") + "）";
                if (!profileId) {
                    const choices = [];
                    for (const option of options) choices.push({ ...option, selected: option.value === base });
                    profileId = await choose(api, "确认作息：" + context, choices);
                    if (profileId === null) return null;
                }
                if (cacheable) assignments.set(key, profileId);
                confirmations.add((cacheable || exactTimeProfile(course.position) ? key : context) + " → " + timeProfile(profileId).label);
            }
            const actual = courseTimes(course, profileId);
            const result = { ...course };
            if (actual.start !== defaultTimes.start || actual.end !== defaultTimes.end) {
                // 保留原节次，另给错峰课程设置精确时间，避免一套默认作息误改跨楼课程。
                result.isCustomTime = true;
                result.customStartTime = actual.start;
                result.customEndTime = actual.end;
                customCount++;
            }
            converted.push(result);
        }
        const slots = timeSlots(base);
        const slotLines = [];
        for (const slot of slots) slotLines.push(slot.number + "节 " + slot.startTime + "—" + slot.endTime);
        const lines = ["采用学校 2025 年春季起作息：" + timeProfile(base).label + "。将更新目标课表的第 1—10 节时间。", slotLines.join("\n")];
        if (confirmations.size) lines.push("作息对应：\n" + Array.from(confirmations).join("\n"));
        if (customCount) lines.push(customCount + " 条错峰安排将使用独立起止时间，原节次保留。");
        return { courses: converted, slots, description: lines.join("\n\n") };
    }

    function numberList(value, maximum) {
        const expression = value.replace(/[，、]/g, ",").replace(/[－—–~～至]/g, "-").replace(/\s/g, "");
        if (!/^\d+(?:-\d+)*(?:,\d+(?:-\d+)*)*$/.test(expression)) {
            throw new Error("无法识别周次或节次：" + value);
        }
        const result = new Set();
        for (const part of expression.split(",")) {
            const values = [];
            for (const token of part.split("-")) {
                const n = Number(token);
                if (n < 1 || n > maximum) throw new Error("周次或节次超出范围：" + value);
                values.push(n);
            }
            if (values.length === 2) {
                if (values[0] > values[1]) throw new Error("周次或节次顺序错误：" + value);
                for (let n = values[0]; n <= values[1]; n++) result.add(n);
            } else {
                // 强智使用 01-02-03 表示逐节列举；非连续的枚举不可扩成连堂。
                for (const n of values) result.add(n);
            }
        }
        return Array.from(result).sort((a, b) => a - b);
    }

    function parseSchedule(value) {
        const normalized = value.replace(/（/g, "(").replace(/）/g, ")")
            .replace(/【/g, "[").replace(/】/g, "]").replace(/[，；]/g, ch => ch === "，" ? "," : ";");
        const schedules = [];
        let cursor = 0;
        for (const match of normalized.matchAll(/\[([^\[\]]+?)节\]/g)) {
            const weekPart = normalized.slice(cursor, match.index).replace(/^[,;、\s]+/, "");
            // 教务周次列表可在末尾的单双全周标记前多一个逗号；仅去掉这一个，仍校验空项。
            const weekExpression = weekPart.replace(/,(?=\([全单双]周?\)\s*$)/, "").replace(/[()全单双周第\s]/g, "");
            if ((weekPart.includes("单") && weekPart.includes("双")) || (weekPart.includes("全") && /[单双]/.test(weekPart))) throw new Error("无法识别周次限定：" + value);
            const weeks = [];
            for (const week of numberList(weekExpression, 60)) {
                if (weekPart.includes("单") && week % 2 !== 1) continue;
                if (weekPart.includes("双") && week % 2 !== 0) continue;
                weeks.push(week);
            }
            if (!weeks.length) throw new Error("课程没有有效周次：" + value);
            const ranges = [];
            for (const section of numberList(match[1], 30)) {
                const last = ranges[ranges.length - 1];
                if (last && last.endSection + 1 === section) last.endSection = section;
                else ranges.push({ startSection: section, endSection: section });
            }
            schedules.push({ weeks, ranges });
            cursor = match.index + match[0].length;
        }
        if (!schedules.length) throw new Error("课程缺少具体节次：" + value);
        if (!/^[,;、\s]*$/.test(normalized.slice(cursor))) throw new Error("课程排课信息未能完整解析：" + value);
        return schedules;
    }

    function weekday(value) {
        const match = value.match(/^(?:星期|周)([一二三四五六日天1-7])$/);
        if (!match) return null;
        return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[match[1]] || Number(match[1]);
    }

    function weekdayColumns(table) {
        for (const row of table.querySelectorAll("tr")) {
            const days = [], found = new Set();
            for (const cell of cells(row)) {
                const day = weekday(text(cell));
                days.push(day);
                if (day) found.add(day);
            }
            if (found.size === 7) return days;
        }
        throw new Error("未识别到星期表头，教务页面结构可能已变化。");
    }

    function courseName(block) {
        let name = "";
        let node = block.firstChild;
        for (; node && node.nodeName !== "BR"; node = node.nextSibling) {
            name += node.textContent || "";
        }
        // 课程模块、教学班可另起一行；只追加紧随标题的纯文本括号行，遇到元数据或普通文字即止。
        while (node?.nodeName === "BR") {
            let line = "", next = node.nextSibling;
            while (next?.nodeType === 3) {
                line += next.textContent || "";
                next = next.nextSibling;
            }
            line = line.trim();
            if ((next && next.nodeName !== "BR") || !/^(?:\([^()]+\)|（[^（）]+）)$/.test(line)) break;
            name += line;
            node = next;
        }
        return name.replace(/\s+/g, " ").trim();
    }

    function courseField(block, selector, name, label) {
        const values = new Set();
        for (const field of block.querySelectorAll(selector)) values.add(text(field));
        if (values.size > 1) throw new Error("课程“" + name + "”包含多组" + label + "，无法确认与上课时间的对应关系，已停止导入。");
        return values.values().next().value || "";
    }

    function unscheduledCourses(doc) {
        const table = doc.getElementById("dataTables");
        if (!table) return [];
        let nameColumn = -1;
        const names = new Set();
        for (const row of table.querySelectorAll("tr")) {
            const values = [];
            for (const cell of cells(row)) values.push(text(cell));
            const header = values.indexOf("课程名称");
            if (header >= 0) { nameColumn = header; continue; }
            if (nameColumn >= 0 && /^\d+$/.test(values[0]) && values[nameColumn]) names.add(values[nameColumn]);
        }
        return Array.from(names);
    }

    function assertLoggedIn(doc) {
        if (doc.querySelector('#userAccount, #userPassword, form[action*="LoginToXk"]') || /登录/.test(doc.title || "")) {
            throw new Error("尚未登录或登录已失效，请在教务页面重新登录后执行导入。");
        }
    }

    // 按官方 Wiki 的逐周合并思路处理重叠和相邻节次；在转换错峰时间前执行。
    // https://github.com/ShiGuangSchedule/shiguangschedule/wiki/课程合并与去重函数
    function mergeCourses(courses) {
        const groups = new Map();
        for (const course of courses) {
            const { name, teacher, position, day } = course;
            const key = JSON.stringify([name, teacher, position, day]);
            if (!groups.has(key)) groups.set(key, { name, teacher, position, day, byWeek: new Map() });
            const group = groups.get(key);
            for (const week of course.weeks) {
                if (!group.byWeek.has(week)) group.byWeek.set(week, new Set());
                for (let section = course.startSection; section <= course.endSection; section++) group.byWeek.get(week).add(section);
            }
        }
        const result = [];
        for (const { name, teacher, position, day, byWeek } of groups.values()) {
            const ranges = new Map();
            for (const week of Array.from(byWeek.keys()).sort((a, b) => a - b)) {
                const sections = Array.from(byWeek.get(week)).sort((a, b) => a - b);
                for (let i = 0; i < sections.length; i++) {
                    const startSection = sections[i];
                    while (i + 1 < sections.length && sections[i + 1] === sections[i] + 1) i++;
                    const endSection = sections[i], key = startSection + ":" + endSection;
                    if (!ranges.has(key)) ranges.set(key, { name, teacher, position, day, startSection, endSection, weeks: [] });
                    ranges.get(key).weeks.push(week);
                }
            }
            result.push(...ranges.values());
        }
        return result.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name) || a.endSection - b.endSection);
    }

    function parseTimetable(doc) {
        assertLoggedIn(doc);
        const table = doc.getElementById("timetable");
        if (!table) throw new Error("未找到学期理论课表，请确认登录成功；若仍失败，教务页面结构可能已变化。");
        const days = weekdayColumns(table);
        const courses = [];
        const unscheduled = new Set(unscheduledCourses(doc));
        for (const row of table.querySelectorAll("tr")) {
            const rowCells = cells(row);
            for (let column = 0; column < rowCells.length; column++) {
                const cell = rowCells[column];
                const details = [];
                for (const div of cell.querySelectorAll(".kbcontent")) if (text(div)) details.push(div);
                if (!details.length) {
                    for (const div of cell.querySelectorAll(".kbcontent1")) {
                        if (text(div)) throw new Error("课表仅包含简略信息，无法确认具体节次，请重新加载教务页面。");
                    }
                    continue;
                }
                if (!days[column] || rowCells.length !== days.length) throw new Error("课程星期列不匹配，已停止导入以避免错位。");
                for (const detail of details) {
                    for (const html of detail.innerHTML.split(/-{5,}|─{5,}|<hr\b[^>]*>/i)) {
                        const block = doc.createElement("div");
                        block.innerHTML = html;
                        if (!text(block)) continue;
                        // 分隔线前后可能有空行，不把首个空 <br> 误当课程名称。
                        while (block.firstChild && (block.firstChild.nodeName === "BR" || !text(block.firstChild))) block.firstChild.remove();
                        const name = courseName(block);
                        if (!name) throw new Error("有课程缺少名称，已停止导入，请检查学期理论课表。");
                        const weekFields = block.querySelectorAll('font[title="周次(节次)"]');
                        if (!weekFields.length) {
                            if (/(?:尚未排课|未排课|待排课|未安排时间|时间待定)/.test(text(block).slice(name.length))) { unscheduled.add(name); continue; }
                            throw new Error("课程“" + name + "”缺少排课信息，已停止导入，请检查学期理论课表。");
                        }
                        let metadata;
                        for (const field of weekFields) {
                            const weekInfo = text(field);
                            if (/^(?:未排课|尚未排课|待排课|未安排|待定|时间待定|暂无安排)$/.test(weekInfo)) { unscheduled.add(name); continue; }
                            if (!metadata) metadata = {
                                teacher: courseField(block, 'font[title="教师"], font[title="老师"]', name, "教师信息"),
                                position: courseField(block, 'font[title="教室"]', name, "教室信息")
                            };
                            for (const schedule of parseSchedule(weekInfo)) {
                                for (const range of schedule.ranges) courses.push({ name, ...metadata, day: days[column], ...range, weeks: schedule.weeks });
                            }
                        }
                    }
                }
            }
        }
        return { courses: mergeCourses(courses), unscheduled: Array.from(unscheduled) };
    }

    function selectOptions(doc, id) {
        const select = doc.getElementById(id);
        const options = [];
        if (select) {
            for (const option of select.querySelectorAll("option")) {
                if (option.value && !option.disabled) options.push({ value: option.value, label: text(option), selected: option.selected });
            }
        }
        return options;
    }

    function selectedValue(doc, id) {
        const options = selectOptions(doc, id);
        for (const option of options) if (option.selected) return option.value;
        return options[0]?.value;
    }

    function parseCalendar(doc, semester) {
        assertLoggedIn(doc);
        if (selectedValue(doc, "xnxq01id") !== semester) throw new Error("教学周历的学期与选择不一致。");
        const table = doc.getElementById("kbtable");
        if (!table) throw new Error("没有读取到教学周历。");
        const columns = weekdayColumns(table);
        let firstColumn = 0;
        while (!columns[firstColumn]) firstColumn++;
        const firstDayOfWeek = columns[firstColumn];
        let startDate = null;
        let totalWeeks = 0;
        for (const row of table.querySelectorAll("tr")) {
            const rowCells = cells(row);
            if (!/^\d+$/.test(text(rowCells[0]))) continue;
            const week = Number(text(rowCells[0]));
            if (week < 1 || week > 60) throw new Error("教学周历周次异常。");
            totalWeeks = Math.max(totalWeeks, week);
            if (week === 1) {
                const title = rowCells[firstColumn]?.getAttribute("title") || "";
                const match = title.match(/^(\d{4})年(\d{1,2})月(\d{1,2})(?:日)?$/);
                if (match) {
                    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
                    const iso = match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
                    if (date.toISOString().slice(0, 10) === iso && (date.getUTCDay() || 7) === firstDayOfWeek) startDate = iso;
                }
            }
        }
        if (!startDate || !totalWeeks) throw new Error("教学周历缺少有效的第一周日期或总周数。");
        return { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek };
    }

    function bridges(env) {
        return { async: env.shiguangBridgePromise || env.AndroidBridgePromise, sync: env.shiguangBridge || env.AndroidBridge };
    }

    async function requestDocument(env, path, params) {
        const options = { credentials: "same-origin", cache: "no-store" };
        if (params) {
            options.method = "POST";
            options.headers = { "Content-Type": "application/x-www-form-urlencoded" };
            options.body = new URLSearchParams(params).toString();
        }
        const controller = new env.AbortController();
        options.signal = controller.signal;
        const timeout = env.setTimeout(() => controller.abort(), 30000);
        try {
            const response = await env.fetch(ORIGIN + path, options);
            if (!response.ok) throw new Error("教务系统请求失败（HTTP " + response.status + "），请稍后重试。");
            if (response.url && new URL(response.url).origin !== ORIGIN) throw new Error("教务登录已失效，请重新登录。");
            const doc = new env.DOMParser().parseFromString(await response.text(), "text/html");
            assertLoggedIn(doc);
            return doc;
        } catch (error) {
            if (error.name === "AbortError") throw new Error("教务系统响应超时，请稍后重试。");
            throw error;
        } finally { env.clearTimeout(timeout); }
    }

    async function choose(api, title, options) {
        let preferred = 0;
        const labels = [];
        for (let i = 0; i < options.length; i++) {
            labels.push(options[i].label);
            if (options[i].selected) preferred = i;
        }
        const index = await api.showSingleSelection(title, JSON.stringify(labels), preferred);
        if (index === null || index === undefined || index === -1) return null;
        if (!Number.isInteger(index) || !options[index]) throw new Error("未能识别选择结果，请更新拾光后重试。");
        return options[index].value;
    }

    async function runImportFlow(env) {
        const bridge = bridges(env);
        const api = bridge.async;
        if (!api) throw new Error("请通过拾光课程表的教务导入或适配测试入口运行此脚本。");
        if (env.location.origin !== ORIGIN) throw new Error("请先打开 https://jwxt.xjnu.edu.cn/jsxsd/ 并登录教务系统，再执行导入。");
        const initial = await requestDocument(env, TIMETABLE_PATH);
        const semesters = [];
        for (const option of selectOptions(initial, "xnxq01id")) {
            if (/^\d{4}-\d{4}-[12]$/.test(option.value)) semesters.push(option);
        }
        if (!semesters.length) throw new Error("未找到可选学期，请确认已进入学生教务系统。");
        const semester = await choose(api, "选择导入学期", semesters);
        if (semester === null) return { status: "cancelled" };
        const modes = selectOptions(initial, "kbjcmsid");
        if (!modes.length) throw new Error("没有读取到学校的节次模式。");
        const mode = modes.length === 1 ? modes[0].value : await choose(api, "选择节次模式", modes);
        if (mode === null) return { status: "cancelled" };
        const doc = await requestDocument(env, TIMETABLE_PATH, {
            xnxq01id: semester, kbjcmsid: mode, zc: "", sfFD: "1", wkbkc: "1"
        });
        if (selectedValue(doc, "xnxq01id") !== semester) throw new Error("返回课表的学期与选择不一致，已停止导入。");
        if (selectedValue(doc, "kbjcmsid") !== mode) throw new Error("返回课表的节次模式与选择不一致，已停止导入。");
        const parsed = parseTimetable(doc);
        if (!parsed.courses.length) throw new Error("所选学期没有已排定时间的课程。无课表课程暂时无法导入。");
        const config = parseCalendar(await requestDocument(env, CALENDAR_PATH, { xnxq01id: semester }), semester);
        for (const course of parsed.courses) {
            for (const week of course.weeks) {
                if (week > config.semesterTotalWeeks) throw new Error("课程“" + course.name + "”排到第" + week + "周，但所选学期的教学周历只有" + config.semesterTotalWeeks + "周。请核对教务课表与校历，本次未写入任何数据。");
            }
        }
        const timing = await prepareTiming(api, parsed.courses, semester);
        if (timing === null) return { status: "cancelled" };
        const calendarDescription = "第一周开始日期 " + config.semesterStartDate + "，共 " + config.semesterTotalWeeks + " 周，每周从周" + DAY_NAMES[config.firstDayOfWeek] + "开始";
        const configMode = await choose(api, "学期设置：" + calendarDescription, [
            { value: "keep", label: "保留已有学期和默认时长，稍后手动核对" },
            { value: "sync", label: "同步上述校历；默认单节设为45分钟、课间10分钟" }
        ]);
        if (configMode === null) return { status: "cancelled" };
        const syncConfig = configMode === "sync";
        if (syncConfig && typeof api.saveCourseConfig !== "function") throw new Error("当前拾光版本不支持导入学期设置，请更新后重试。");
        const names = new Set();
        for (const course of parsed.courses) names.add(course.name);
        const count = names.size;
        const summary = [semester + "：" + count + " 门课程，" + parsed.courses.length + " 条上课安排。",
            timing.description, "教学周历：" + calendarDescription + "。",
            syncConfig ? "将同步学期设置；默认单节时长设为45分钟、课间10分钟，用于以后手动生成作息，不改变本次逐节时间。" : "本次保留已有学期和默认时长；请在课表设置中核对上述校历，避免周次错位。"];
        if (parsed.unscheduled.length) summary.push("以下课程还有未排定时间的记录；未排定的安排不导入，已排定的安排仍正常导入：\n" + parsed.unscheduled.join("、"));
        const confirmed = await api.showAlert("核对导入内容", summary.join("\n\n"), "确认导入");
        if (!confirmed) return { status: "cancelled" };
        if (await api.saveImportedCourses(JSON.stringify(timing.courses)) !== true) {
            throw new Error("课程未保存，导入已取消或失败。");
        }
        if (timing.slots) {
            try {
                if (await api.savePresetTimeSlots(JSON.stringify(timing.slots)) !== true) throw new Error("作息保存失败");
            } catch (error) {
                throw new Error("课程已保存，但学校作息未能写入。请重新执行导入或在课表设置中手动修改时间；不要沿用未校准的时间提醒。");
            }
        }
        if (syncConfig) {
            try {
                if (await api.saveCourseConfig(JSON.stringify({ ...config, defaultClassDuration: 45, defaultBreakDuration: 10 })) !== true) throw new Error("学期设置保存失败");
            } catch (error) {
                throw new Error((timing.slots ? "课程和作息已保存" : "课程已保存") + "，但学期设置未能写入。请在课表设置中核对：" + calendarDescription + "；默认时长也需检查。可重新执行导入。");
            }
        }
        await api.showAlert("导入完成", "已导入 " + count + " 门课程，" + parsed.courses.length + " 条上课安排。" +
            (timing.slots ? "已更新学校第 1—10 节作息，错峰课程请在课程详情中核对起止时间。" : timing.description) +
            "\n\n教学周历：" + calendarDescription + "。" + (syncConfig ? "已同步学期设置。" : "本次未修改学期设置，请手动核对。"), "完成");
        bridge.sync?.notifyTaskCompletion?.();
        return { status: "imported", courseCount: count, arrangementCount: parsed.courses.length, calendar: config, configSynced: syncConfig };
    }

    runImportFlow(root).catch(async error => {
        const bridge = bridges(root);
        const message = error?.message || "导入失败，请检查网络和登录状态后重试。";
        if (bridge.async?.showAlert) await bridge.async.showAlert("导入未完成", message, "知道了");
        else if (bridge.sync?.showToast) bridge.sync.showToast(message);
        else root.alert(message);
    });
})(window);
