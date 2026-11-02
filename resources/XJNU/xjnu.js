// 新疆师范大学本科教务适配 — CkYtxwz
// 结构参考：新疆工程学院 XJIE 强智案例；学校解析与错峰作息按 XJNU 实际数据处理。
// https://github.com/ShiGuangSchedule/shiguang_warehouse/tree/main/resources/XJIE
(function () {
    "use strict";

    const BASE_URL = "https://jwxt.xjnu.edu.cn";
    const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`;
    const URL_COURSE = `${BASE_URL}/jsxsd/xskb/xskb_list.do`;
    // 2025 年春季起的官方作息：https://www.xjnu.edu.cn/info/1080/38891.htm
    const TIME_PROFILES = [
        { id: "wq-other", label: "温泉：1号教学楼及其他楼宇", morning: ["10:00-10:45", "10:50-11:35", "12:00-12:45", "12:50-13:35"] },
        { id: "wq-2", label: "温泉：2号教学楼", morning: ["10:00-10:45", "10:50-11:35", "11:50-12:35", "12:40-13:25"] },
        { id: "wq-3", label: "温泉：3号教学楼", morning: ["10:00-10:45", "10:50-11:35", "12:10-12:55", "13:00-13:45"] },
        { id: "kl-wenshi", label: "昆仑：文史楼", morning: ["10:00-10:45", "10:55-11:40", "12:00-12:45", "12:55-13:40"] },
        { id: "kl-other", label: "昆仑：其他楼宇", morning: ["10:00-10:45", "10:55-11:40", "12:10-12:55", "13:05-13:50"] }
    ];
    const COMMON_AFTERNOON = ["15:30-16:15", "16:25-17:10", "17:30-18:15", "18:25-19:10", "20:00-20:45", "20:55-21:40"];
    const PROFILE_SLOTS = new Map();
    for (const profile of TIME_PROFILES) {
        const slots = [];
        for (const range of [...profile.morning, ...COMMON_AFTERNOON]) {
            const [startTime, endTime] = range.split("-");
            slots.push({ number: slots.length + 1, startTime, endTime });
        }
        PROFILE_SLOTS.set(profile.id, slots);
    }
    const DAY_NAMES = ["", "一", "二", "三", "四", "五", "六", "日"];

    // 工具函数

    const text = node => (node?.textContent || "").replace(/\s+/g, " ").trim();

    function cells(row) {
        const result = [];
        for (const element of row.children) if (/^(TD|TH)$/.test(element.tagName)) result.push(element);
        return result;
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

    // 保留全周、单双周限制；输入已由 parseSchedule 统一标点和空白。
    function parseWeeks(weekPart) {
        // 教务周次列表可在末尾的单双全周标记前多一个逗号，仅允许这一个空项例外。
        weekPart = weekPart.replace(/,(?=\([全单双]周?\)$)/, "");
        const match = weekPart.match(/^第?(\d+(?:-\d+)*(?:,\d+(?:-\d+)*)*)(?:\((?:[全单双]周?|周)\)|[全单双]?周)?$/);
        if (!match) throw new Error("无法识别周次或节次：" + weekPart);
        const weeks = [];
        for (const week of numberList(match[1], 60)) {
            if (weekPart.includes("单") && week % 2 !== 1) continue;
            if (weekPart.includes("双") && week % 2 !== 0) continue;
            weeks.push(week);
        }
        if (!weeks.length) throw new Error("课程没有有效周次：" + weekPart);
        return weeks;
    }

    function parseSchedule(value) {
        const normalized = value.replace(/（/g, "(").replace(/）/g, ")")
            .replace(/【/g, "[").replace(/】/g, "]").replace(/[，、]/g, ",").replace(/；/g, ";")
            .replace(/[－—–~～至]/g, "-").replace(/\s/g, "");
        const schedules = [];
        let cursor = 0;
        for (const match of normalized.matchAll(/\[([^\[\]]+?)节\]/g)) {
            let weekPart = normalized.slice(cursor, match.index);
            if (cursor) weekPart = weekPart.replace(/^[,;]/, "");
            const weeks = parseWeeks(weekPart);
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

    // 按实际周次合并重叠、相邻节次，再合并相同节次的周次；先于错峰时间转换。
    // https://github.com/ShiGuangSchedule/shiguangschedule/wiki/课程合并与去重函数
    function mergeAndDistinctCourses(courses) {
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

    function weekday(value) {
        const match = value.match(/^(?:星期|周)([一二三四五六日天1-7])$/);
        if (!match) return null;
        return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[match[1]] || Number(match[1]);
    }

    function weekdayColumns(table) {
        for (const row of table.rows) {
            const days = [], found = new Set();
            let dayCount = 0;
            for (const cell of cells(row)) {
                const day = weekday(text(cell));
                days.push(day);
                if (day) { found.add(day); dayCount++; }
            }
            if (found.size === 7 && dayCount === 7) return days;
        }
        throw new Error("未识别到星期表头，教务页面结构可能已变化。");
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

    function timeProfile(id) {
        for (const profile of TIME_PROFILES) if (profile.id === id) return profile;
        throw new Error("未能识别学校作息方案。");
    }

    function timeSlots(profileId) {
        return PROFILE_SLOTS.get(profileId);
    }

    function courseTimes(course, profileId) {
        const slots = timeSlots(profileId);
        if (!slots[course.startSection - 1] || !slots[course.endSection - 1]) throw new Error("官方作息仅公布了第 1—10 节。");
        return { start: slots[course.startSection - 1].startTime, end: slots[course.endSection - 1].endTime };
    }

    function buildingKey(position) {
        const value = position.replace(/\s/g, "");
        const building = value.match(/^.*?(?:楼|体育馆|运动场|操场)/)?.[0] || value;
        // 校区可能写在楼名后；保留这类地点，避免确认缓存忽略后缀中的冲突。
        return /温泉|昆仑|校区/.test(value.slice(building.length)) ? value : building;
    }

    function exactTimeProfile(position) {
        const full = position.replace(/\s/g, "");
        const campuses = new Set(full.match(/温泉|昆仑/g) || []);
        const withoutCampus = full.replace(/(?:温泉|昆仑)(?:校区)?/g, "");
        if (campuses.size > 1 || withoutCampus.includes("校区")) return null;
        const campus = campuses.values().next().value;
        const value = buildingKey(withoutCampus).replace(/^[：:（）()]+/, "");
        // 官方楼名与校区：https://jwc.xjnu.edu.cn/info/1682/14003.htm
        // 文育楼：https://db.xjnu.edu.cn/info/1191/1992.htm
        // 行知、行远楼：https://www.xjnu.edu.cn/info/1081/71732.htm
        if (campus !== "昆仑") {
            if (value === "齐学楼") return "wq-2";
            if (value === "治学楼") return "wq-3";
            if (/^(?:正学楼|笃学楼|文育楼|行知楼|行远楼)$/.test(value)) return "wq-other";
        }
        // 无校区的楼号仍不能确定作息；明确标注其他校区的同名楼宇也不套用温泉映射。
        if (campus === "温泉") {
            if (value === "2号教学楼") return "wq-2";
            if (value === "3号教学楼") return "wq-3";
            if (value === "1号教学楼") return "wq-other";
        }
        if (campus !== "温泉" && value === "文史楼") return "kl-wenshi";
        return null;
    }

    function assertLoggedIn(doc) {
        if (doc.querySelector('#userAccount, #userPassword, form[action*="LoginToXk"]') || /登录/.test(doc.title || "")) {
            throw new Error("尚未登录或登录已失效，请在教务页面重新登录后执行导入。");
        }
    }

    // 核心解析逻辑

    function isCourseQualifier(value) {
        if (!/^[（(]/.test(value)) return false;
        const closing = [];
        for (const character of value) {
            if (character === "(" || character === "（") closing.push(character === "(" ? ")" : "）");
            else if (character === ")" || character === "）") {
                if (closing.pop() !== character) throw new Error("课程名称的括号补充不配对，已停止导入。");
            } else if (!closing.length && !/\s/.test(character)) return false;
        }
        if (closing.length) throw new Error("课程名称的括号补充不完整，已停止导入。");
        return true;
    }

    function courseName(block) {
        let name = "";
        let node = block.firstChild;
        for (; node && node.nodeName !== "BR"; node = node.nextSibling) {
            if (node.nodeType === 8) continue;
            // 带 title 的 font 是教务元数据；缺标题时不能拿教师、周次或教室当课程名。
            if (node.nodeType === 1 && (node.matches("font[title]") || node.querySelector("font[title]"))) break;
            name += node.textContent || "";
        }
        // 课程模块、教学班可另起一行；只追加紧随标题的纯文本括号行，遇到元数据或普通文字即止。
        while (node?.nodeName === "BR") {
            let line = "", next = node.nextSibling;
            while (next && (next.nodeType === 3 || next.nodeType === 8)) {
                if (next.nodeType === 3) line += next.textContent || "";
                next = next.nextSibling;
            }
            line = line.trim();
            if ((next && next.nodeName !== "BR") || !isCourseQualifier(line)) break;
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

    function courseBlocks(detail) {
        const blocks = [];
        let block = detail.ownerDocument.createElement("div");
        for (const node of detail.childNodes) {
            // 只将独立分隔线视为课程边界，不拆分课程名、教师名或属性中的连字符。
            if (node.nodeName === "HR" || (node.nodeType === 3 && /^\s*(?:-{5,}|─{5,})\s*$/.test(node.textContent))) {
                if (text(block)) blocks.push(block);
                block = detail.ownerDocument.createElement("div");
            } else {
                block.appendChild(node.cloneNode(true));
            }
        }
        if (text(block)) blocks.push(block);
        return blocks;
    }

    function parseTimetableToModel(doc) {
        assertLoggedIn(doc);
        const table = doc.getElementById("timetable");
        if (!table) throw new Error("未找到学期理论课表，请确认登录成功；若仍失败，教务页面结构可能已变化。");
        const days = weekdayColumns(table);
        const courses = [];
        const unscheduled = new Set(unscheduledCourses(doc));
        for (const row of table.rows) {
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
                    for (const block of courseBlocks(detail)) {
                        // 分隔线前后可能有空行，不把首个空 <br> 误当课程名称。
                        while (block.firstChild && (block.firstChild.nodeName === "BR" || block.firstChild.nodeType === 8 || !text(block.firstChild))) block.firstChild.remove();
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
        return { courses: mergeAndDistinctCourses(courses), unscheduled: Array.from(unscheduled) };
    }

    function parseSemesterInfo(doc, semester) {
        assertLoggedIn(doc);
        if (selectedValue(doc, "xnxq01id") !== semester) throw new Error("教学周历的学期与选择不一致。");
        const table = doc.getElementById("kbtable");
        if (!table) throw new Error("没有读取到教学周历。");
        const columns = weekdayColumns(table);
        // 学校实际页面在七个日期列后还有备注列；备注不参与日期校验。
        if (![8, 9].includes(columns.length) || columns[0] !== null || (columns.length === 9 && columns[8] !== null)) throw new Error("教学周历星期列不完整。");
        const firstDayOfWeek = columns[1];
        for (let column = 1; column <= 7; column++) {
            if (columns[column] !== (firstDayOfWeek + column - 2) % 7 + 1) throw new Error("教学周历星期顺序异常。");
        }
        let startDate;
        let totalWeeks = 0;
        for (const row of table.rows) {
            const rowCells = cells(row);
            if (!/^\d+$/.test(text(rowCells[0]))) {
                for (let column = 1; column < Math.min(rowCells.length, 8); column++) {
                    if (rowCells[column].getAttribute("title")) throw new Error("教学周历日期行缺少有效周次。");
                }
                continue;
            }
            const week = Number(text(rowCells[0]));
            if (week !== totalWeeks + 1 || week > 60 || rowCells.length !== columns.length) throw new Error("教学周历周次缺失、重复或日期列不完整。");
            for (let column = 1; column <= 7; column++) {
                const title = rowCells[column].getAttribute("title") || "";
                const match = title.match(/^(\d{4})年(\d{1,2})月(\d{1,2})(?:日)?$/);
                if (!match) throw new Error("教学周历缺少有效日期。");
                const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
                const iso = match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
                if (date.toISOString().slice(0, 10) !== iso || (date.getUTCDay() || 7) !== columns[column]) throw new Error("教学周历日期与星期不一致。");
                if (!startDate) startDate = date;
                const expected = startDate.getTime() + ((week - 1) * 7 + column - 1) * 86400000;
                if (date.getTime() !== expected) throw new Error("教学周历日期不连续。");
            }
            totalWeeks = week;
        }
        if (!startDate || !totalWeeks) throw new Error("教学周历缺少有效的第一周日期或总周数。");
        return { semesterStartDate: startDate.toISOString().slice(0, 10), semesterTotalWeeks: totalWeeks, firstDayOfWeek };
    }

    // 网络请求封装

    async function requestDocument(url, params) {
        const options = { credentials: "same-origin", cache: "no-store" };
        if (params) {
            options.method = "POST";
            options.headers = { "Content-Type": "application/x-www-form-urlencoded" };
            options.body = new URLSearchParams(params).toString();
        }
        const controller = new window.AbortController();
        options.signal = controller.signal;
        const timeout = window.setTimeout(() => controller.abort(), 30000);
        try {
            const response = await window.fetch(url, options);
            if (!response.ok) throw new Error("教务系统请求失败（HTTP " + response.status + "），请稍后重试。");
            if (response.url && new URL(response.url).origin !== BASE_URL) throw new Error("教务登录已失效，请重新登录。");
            const doc = new window.DOMParser().parseFromString(await response.text(), "text/html");
            assertLoggedIn(doc);
            return doc;
        } catch (error) {
            if (error.name === "AbortError") throw new Error("教务系统响应超时，请稍后重试。");
            throw error;
        } finally { window.clearTimeout(timeout); }
    }

    // XJNU 的节次模式 kbjcmsid 位于课表页，初始 GET 同时读取学期列表和模式。
    async function requestSemesterPage() {
        return requestDocument(URL_COURSE);
    }

    async function requestSemesterDetailPage(semesterId) {
        return requestDocument(URL_SEMESTER, { xnxq01id: semesterId });
    }

    async function requestCoursePage(semesterId, mode) {
        return requestDocument(URL_COURSE, {
            xnxq01id: semesterId, kbjcmsid: mode, zc: "", sfFD: "1", wkbkc: "1"
        });
    }

    // 业务逻辑

    async function fetchSemesterList() {
        const doc = await requestSemesterPage();
        const list = [];
        for (const option of selectOptions(doc, "xnxq01id")) {
            if (/^\d{4}-\d{4}-[12]$/.test(option.value)) list.push({ ...option, label: option.value });
        }
        if (!list.length) throw new Error("未找到可选学期，请确认已进入学生教务系统。");
        return { list, modes: selectOptions(doc, "kbjcmsid") };
    }

    async function fetchSemesterInfo(semesterId) {
        return parseSemesterInfo(await requestSemesterDetailPage(semesterId), semesterId);
    }

    async function fetchCourses(semesterId, mode) {
        const doc = await requestCoursePage(semesterId, mode);
        if (selectedValue(doc, "xnxq01id") !== semesterId) throw new Error("返回课表的学期与选择不一致，已停止导入。");
        if (selectedValue(doc, "kbjcmsid") !== mode) throw new Error("返回课表的节次模式与选择不一致，已停止导入。");
        const parsed = parseTimetableToModel(doc);
        if (!parsed.courses.length) throw new Error("所选学期没有已排定时间的课程。无课表课程暂时无法导入。");
        const names = new Set();
        for (const course of parsed.courses) names.add(course.name);
        return { ...parsed, courseCount: names.size };
    }

    function validateCourseWeeks(courses, config) {
        for (const course of courses) {
            for (const week of course.weeks) {
                if (week > config.semesterTotalWeeks) throw new Error("课程“" + course.name + "”排到第" + week + "周，但所选学期的教学周历只有" + config.semesterTotalWeeks + "周。请核对教务课表与校历，本次未写入任何数据。");
            }
        }
    }

    async function choose(title, options) {
        let preferred = 0;
        const labels = [];
        for (let i = 0; i < options.length; i++) {
            labels.push(options[i].label);
            if (options[i].selected) preferred = i;
        }
        const index = await window.shiguangBridgePromise.showSingleSelection(title, JSON.stringify(labels), preferred);
        if (index === null || index === undefined || index === -1) return null;
        if (!Number.isInteger(index) || !options[index]) throw new Error("未能识别选择结果，请更新拾光后重试。");
        return options[index].value;
    }

    async function prepareAppTimeSlots(courses, semester) {
        const preserve = reason => ({ courses, slots: null, description: reason + "按节次导入，保留目标课表已有作息时间。" });
        const parts = semester.split("-");
        const year = Number(parts[0]), term = Number(parts[2]);
        if (year < 2024 || (year === 2024 && term === 1)) return preserve("该学期早于官方 2025 年春季作息的实施时间。\n");
        for (const course of courses) {
            if (course.endSection > 10) return preserve("课表含第 10 节以后的课程，官方作息未公布对应时间，无法完整校准。\n");
        }
        const options = [];
        for (const profile of TIME_PROFILES) options.push({ value: profile.id, label: profile.label + "（第3节 " + profile.morning[2].split("-")[0] + "）" });
        const base = await choose("选择课表默认作息（2025年春季起）", [...options, { value: "keep", label: "保留目标课表现有作息" }]);
        if (base === null) return null;
        if (base === "keep") return preserve("");
        if (typeof window.shiguangBridgePromise.savePresetTimeSlots !== "function") throw new Error("当前拾光版本不支持导入作息，请更新后重试。");
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
                const knownProfile = exactTimeProfile(course.position);
                profileId = knownProfile || (cacheable ? assignments.get(key) : null);
                const context = course.name + "（周" + DAY_NAMES[course.day] + "，第" + course.startSection + "—" + course.endSection + "节，第" + course.weeks.join("、") + "周；" + (course.position || "未注明教室") + "）";
                if (!profileId) {
                    const choices = [];
                    for (const option of options) choices.push({ ...option, selected: option.value === base });
                    profileId = await choose("确认作息：" + context, choices);
                    if (profileId === null) return null;
                }
                if (cacheable) assignments.set(key, profileId);
                confirmations.add((cacheable || knownProfile ? key : context) + " → " + timeProfile(profileId).label);
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

    function calendarDescription(config) {
        return "第一周开始日期 " + config.semesterStartDate + "，共 " + config.semesterTotalWeeks + " 周，每周从周" + DAY_NAMES[config.firstDayOfWeek] + "开始";
    }

    async function confirmImport(semester, data, timing, syncConfig) {
        const summary = [semester + "：" + data.courseCount + " 门课程，" + data.courses.length + " 条上课安排。",
            timing.description, "教学周历：" + calendarDescription(data.config) + "。",
            syncConfig ? "将同步学期设置；默认单节时长设为45分钟、课间10分钟，用于以后手动生成作息，不改变本次逐节时间。" : "本次保留已有学期和默认时长；请在课表设置中核对上述校历，避免周次错位。"];
        if (data.unscheduled.length) summary.push("以下课程还有未排定时间的记录；未排定的安排不导入，已排定的安排仍正常导入：\n" + data.unscheduled.join("、"));
        return await window.shiguangBridgePromise.showAlert("核对导入内容", summary.join("\n\n"), "确认导入");
    }

    // 配置保存

    async function saveAppConfig(config, timeSlotsSaved) {
        try {
            const value = { ...config, defaultClassDuration: 45, defaultBreakDuration: 10 };
            if (await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(value)) !== true) throw new Error("学期设置保存失败");
        } catch {
            throw new Error((timeSlotsSaved ? "课程和作息已保存" : "课程已保存") + "，但学期设置未能写入。请在课表设置中核对：" + calendarDescription(config) + "；默认时长也需检查。可重新执行导入。");
        }
    }

    async function saveAppTimeSlots(slots) {
        try {
            if (await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)) !== true) throw new Error("作息保存失败");
        } catch {
            throw new Error("课程已保存，但学校作息未能写入。请重新执行导入或在课表设置中手动修改时间；不要沿用未校准的时间提醒。");
        }
    }

    async function saveCourses(courses) {
        if (await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses)) !== true) {
            throw new Error("课程未保存，导入已取消或失败。");
        }
    }

    // 流程编排

    async function runImportFlow() {
        try {
            // 1. 检查 V2 导入环境和当前教务地址。
            for (const method of ["showAlert", "showSingleSelection", "saveImportedCourses"]) {
                if (typeof window.shiguangBridgePromise?.[method] !== "function") throw new Error("请通过新版拾光课程表的教务导入或适配测试入口运行此脚本。");
            }
            for (const method of ["showToast", "notifyTaskCompletion"]) {
                if (typeof window.shiguangBridge?.[method] !== "function") throw new Error("请更新拾光课程表后重新进入教务导入。");
            }
            if (window.location.origin !== BASE_URL) throw new Error("请先打开 https://jwxt.xjnu.edu.cn/jsxsd/ 并登录教务系统，再执行导入。");

            // 2. 获取并选择学期、学校节次模式。
            const { list: semesters, modes } = await fetchSemesterList();
            const semesterId = await choose("选择导入学期", semesters);
            if (semesterId === null) return;
            if (!modes.length) throw new Error("没有读取到学校的节次模式。");
            const mode = modes.length === 1 ? modes[0].value : await choose("选择节次模式", modes);
            if (mode === null) return;

            // 3. 获取课程，再获取校历；空课表会在请求校历前退出。
            const data = await fetchCourses(semesterId, mode);
            const config = await fetchSemesterInfo(semesterId);
            validateCourseWeeks(data.courses, config);

            // 4. 确认校区、楼宇作息和学期设置；取消时不保存。
            const timing = await prepareAppTimeSlots(data.courses, semesterId);
            if (timing === null) return;
            const configMode = await choose("学期设置：" + calendarDescription(config), [
                { value: "keep", label: "保留已有学期和默认时长，稍后手动核对" },
                { value: "sync", label: "同步上述校历；默认单节设为45分钟、课间10分钟" }
            ]);
            if (configMode === null) return;
            const syncConfig = configMode === "sync";
            if (syncConfig && typeof window.shiguangBridgePromise.saveCourseConfig !== "function") throw new Error("当前拾光版本不支持导入学期设置，请更新后重试。");
            if (!await confirmImport(semesterId, { ...data, config }, timing, syncConfig)) return;

            // 5. 先保存课程，再保存作息和配置，后续失败会说明已完成部分。
            await saveCourses(timing.courses);
            if (timing.slots) await saveAppTimeSlots(timing.slots);
            if (syncConfig) await saveAppConfig(config, Boolean(timing.slots));

            // 6. 全部保存成功后通知完成。
            window.shiguangBridge.showToast("已导入 " + data.courseCount + " 门课程，" + data.courses.length + " 条上课安排。" + (syncConfig ? "已同步学期设置。" : ""));
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            const message = error?.message || "导入失败，请检查网络和登录状态后重试。";
            try {
                if (typeof window.shiguangBridgePromise?.showAlert !== "function") throw error;
                await window.shiguangBridgePromise.showAlert("导入未完成", message, "知道了");
            } catch {
                console.error(message);
            }
        }
    }

    // 启动导入流程
    runImportFlow();
})();
