(async () => {
    const loginRequired = "请登录滇西科技师范学院教务系统，打开「学生课表」或「我的课表」后再导入。";
    const maxWeeks = 60;
    const defaultTimeSlots = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "09:55", endTime: "10:40" },
        { number: 4, startTime: "10:55", endTime: "11:40" },
        { number: 5, startTime: "11:50", endTime: "12:35" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "14:55", endTime: "15:40" },
        { number: 8, startTime: "15:55", endTime: "16:40" },
        { number: 9, startTime: "16:55", endTime: "17:40" },
        { number: 10, startTime: "17:50", endTime: "18:35" },
        { number: 11, startTime: "19:30", endTime: "20:15" },
        { number: 12, startTime: "20:25", endTime: "21:10" },
        { number: 13, startTime: "21:20", endTime: "22:05" }
    ];
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    const text = value => typeof value === "string" ? value.trim() : "";
    if (!bridge || !native) return;

    const { hostname, origin, pathname } = window.location;
    const modulePath = pathname.match(/^(.*\/sys)\/(wdkb|kbapp)(?:\/|$)/);
    if (!/^(?:[a-z0-9-]+\.)*wynu\.edu\.cn$/i.test(hostname) || !modulePath) {
        native.showToast(loginRequired);
        return;
    }
    const [, systemRoot, moduleName] = modulePath;
    const root = new URL(origin);
    root.pathname = `${systemRoot}/`;

    function positiveInt(value) {
        if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return 0;
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : 0;
    }

    async function request(path, label, params) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const options = {
                mode: "same-origin",
                cache: "no-store",
                redirect: "error",
                signal: controller.signal,
                headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            };
            if (params !== undefined) options.method = "POST";
            if (params) options.body = new URLSearchParams(params);
            const response = await fetch(new URL(path, root), options);
            if (!response.ok) throw new Error("HTTP " + response.status);
            const data = await response.json();
            if (!data?.datas || (data.code != null && !["0", "200"].includes(String(data.code)))) {
                throw new Error("响应格式异常");
            }
            return data.datas;
        } catch {
            throw new Error(`${label}读取失败。${loginRequired}`);
        } finally {
            clearTimeout(timeout);
        }
    }

    function clock(value) {
        const input = String(value ?? "").trim();
        const normalized = /^\d{3,4}$/.test(input) ? input.padStart(4, "0").replace(/^(..)(..)$/, "$1:$2") : input;
        const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(normalized);
        return match ? match[1].padStart(2, "0") + ":" + match[2] : "";
    }

    function readTimeSlots(rows) {
        if (!Array.isArray(rows) || !rows.length) return null;
        const slots = rows.map(row => ({
            number: positiveInt(row?.number),
            startTime: clock(row?.startTime),
            endTime: clock(row?.endTime)
        })).sort((a, b) => a.number - b.number);
        return slots.every((slot, i) =>
            slot.number === i + 1 && slot.startTime && slot.startTime < slot.endTime
            && (i === 0 || slots[i - 1].endTime <= slot.startTime)
        ) ? slots : null;
    }

    function readConfig(date, weeks) {
        const start = text(date).slice(0, 10);
        const parsed = new Date(start + "T00:00:00Z");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(parsed.getTime())
            || parsed.toISOString().slice(0, 10) !== start || !weeks || weeks > maxWeeks) return null;
        return { semesterStartDate: start, semesterTotalWeeks: weeks, firstDayOfWeek: 1 };
    }

    function isWeekMask(mask) {
        return typeof mask === "string" && mask.length <= maxWeeks && /^[01]+$/.test(mask);
    }

    function readWeeks(mask) {
        if (!isWeekMask(mask)) return [];
        return Array.from(mask, (bit, index) => bit === "1" ? index + 1 : 0).filter(Boolean);
    }

    function readWeekDescription(description) {
        const parts = description.replace(/[（]/g, "(").replace(/[）]/g, ")")
            .replace(/[～~—]/g, "-").replace(/[周\s]/g, "").split(/[,，、]/);
        const weeks = [];
        for (const part of parts) {
            const range = /^(\d+)(?:-(\d+))?(?:\(([单双])\))?$/.exec(part);
            if (!range) continue;
            const start = positiveInt(range[1]);
            const end = positiveInt(range[2] ?? range[1]);
            if (!start || end < start || end > maxWeeks) continue;
            for (let week = start; week <= end; week++) {
                if (range[3] === "单" && week % 2 === 0 || range[3] === "双" && week % 2 !== 0) continue;
                weeks.push(week);
            }
        }
        return weeks;
    }

    function exportCourses(courses, slots) {
        const merged = new Map();
        for (const { sourceId, weeks, ...course } of courses) {
            if (!course.name || !course.day || course.day > 7 || !course.startSection
                || course.endSection < course.startSection || course.endSection > slots.length || !weeks.length) {
                throw new Error("课表包含无法识别的课程或节次，已停止导入。");
            }
            const key = JSON.stringify(course);
            if (!merged.has(key)) merged.set(key, { course, weeks: new Set() });
            for (const week of weeks) merged.get(key).weeks.add(week);
        }
        return [...merged.values()]
            .map(({ course, weeks }) => ({ ...course, weeks: [...weeks].sort((a, b) => a - b) }))
            .sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    }

    function course(name, teacher, position, day, start, end, weeks) {
        return {
            name: text(name), teacher: text(teacher), position: text(position),
            day: positiveInt(day), startSection: positiveInt(start), endSection: positiveInt(end), weeks
        };
    }

    async function requestRows(action, label, params = null, optional = false) {
        try {
            const data = await request(`wdkb/modules/${action}.do`, label, params);
            const key = action.slice(action.lastIndexOf("/") + 1);
            const rows = data[key]?.rows;
            if (!Array.isArray(rows)) throw new Error(`${label}回包缺少记录列表。`);
            return rows;
        } catch (error) {
            if (optional) return null;
            throw error;
        }
    }

    async function chooseTerm() {
        const [terms, current] = await Promise.all([
            requestRows("jshkcb/xnxqcx", "学期列表"),
            requestRows("jshkcb/dqxnxq", "当前学期", null, true)
        ]);
        const choices = terms.filter(term => text(term?.DM))
            .sort((a, b) => b.DM.localeCompare(a.DM))
            .slice(0, 10);
        if (!choices.length) throw new Error("教务没有返回可导入的学期。");
        const names = choices.map(term => text(term.MC) || term.DM);
        const index = await bridge.showSingleSelection(
            "选择学期", JSON.stringify(names),
            Math.max(0, choices.findIndex(term => term.DM === current?.[0]?.DM))
        );
        if (index === null || index === -1) return null;
        const term = choices[index];
        if (!term) throw new Error("请选择有效的学期。");
        return term;
    }

    async function readCalendar(term) {
        if (!term.XNDM || !term.XQDM) return null;
        const query = { XN: term.XNDM, XQ: term.XQDM };
        const rows = await requestRows("jshkcb/cxjcs", "学期设置", query, true);
        return rows?.[0] ?? null;
    }

    function readCourse(row) {
        const name = [text(row.KCM), text(row.SYXMMC)].filter(Boolean).join(" - ");
        const teacher = text(row.SKJS).split("/")[0] || row.JSM;
        return {
            sourceId: text(String(row.KBID ?? "")),
            ...course(name, teacher, row.JASMC, row.SKXQ, row.KSJC, row.JSJC, readWeeks(row.SKZC))
        };
    }

    function applyChanges(courses, changes, lastSection) {
        const adjustments = [];
        let unresolved = 0;
        for (const change of changes) {
            const matches = courses.filter(course => course.sourceId && course.sourceId === String(change.KBID)
                && course.day === Number(change.SKXQ)
                && course.startSection === Number(change.KSJC) && course.endSection === Number(change.JSJC));
            const removed = readWeeks(change.SKZC);
            const moved = readWeeks(change.XSKZC);
            const nextDay = positiveInt(change.XSKXQ);
            const nextStart = positiveInt(change.XKSJC);
            const nextEnd = positiveInt(change.XJSJC);
            if (!matches.length || !removed.length || !moved.length || !nextDay || nextDay > 7
                || !nextStart || nextEnd < nextStart || nextEnd > lastSection) {
                unresolved++;
                continue;
            }
            let applied = false;
            for (const value of matches) {
                if (!value.weeks.some(week => removed.includes(week))) continue;
                value.weeks = value.weeks.filter(week => !removed.includes(week));
                adjustments.push(course(
                    value.name, text(change.XSKJS).split("/")[0] || value.teacher, text(change.XJASMC) || value.position,
                    nextDay, nextStart, nextEnd, moved
                ));
                applied = true;
            }
            if (!applied) unresolved++;
        }
        courses.push(...adjustments);
        return unresolved;
    }

    async function loadLegacy() {
        const term = await chooseTerm();
        if (!term) return null;

        const query = { XNXQDM: term.DM };
        const [courseRows, changes, periods, calendar] = await Promise.all([
            requestRows("xskcb/cxxszhxqkb", "学生课表", query),
            requestRows("xskcb/xsdkkc", "调课记录", { ...query, "*order": "-SQSJ" }, true),
            requestRows("dzkz/jc", "节次表", null, true),
            readCalendar(term)
        ]);
        const onlineSlots = readTimeSlots(periods?.map(row => ({
            number: row?.DM, startTime: row?.KSSJ, endTime: row?.JSSJ
        })));
        const slots = onlineSlots ?? defaultTimeSlots;
        const rawCourses = courseRows.map(readCourse);
        const missingWeeks = rawCourses.filter(course => !course.weeks.length).length;
        const unresolved = applyChanges(rawCourses, changes ?? [], slots.length);
        const courses = rawCourses.filter(course => course.weeks.length);
        const latestWeek = courses.reduce((max, entry) => Math.max(max, ...entry.weeks), 0);
        const totalWeeks = positiveInt(calendar?.ZZC);

        const warnings = [];
        if (!changes) warnings.push("调课记录读取失败，请与教务核对调课。");
        if (missingWeeks) warnings.push(`有 ${missingWeeks} 条记录缺少有效周次，请与教务核对。`);
        if (unresolved) warnings.push(`有 ${unresolved} 条调课或停课记录需要对照教务确认。`);
        return {
            label: text(term.MC) || term.DM,
            courses,
            slots,
            usedDefaultTimeSlots: !onlineSlots,
            settings: totalWeeks ? readConfig(calendar.XQKSRQ, Math.max(totalWeeks, latestWeek)) : null,
            warnings
        };
    }

    function readCourseDetails(row, week) {
        const cells = row.cellWeekTeacherClassroomDetail;
        const title = row.multiCourseTitleDetail ?? row.titleDetail;
        const details = Array.isArray(cells) && cells.length
            ? cells.map(cell => cell?.text)
            : Array.isArray(title) ? title.slice(1) : [];
        const parsed = details.filter(value => text(value)).map(html => {
            const template = document.createElement("template");
            template.innerHTML = html;
            const plainText = text(template.content.textContent);
            const prefix = plainText.match(/^[\d,，、\s周单双()（）\-～~—]+/)?.[0] ?? "";
            const teacher = text(template.content.querySelector("a")?.textContent);
            const remainder = plainText.slice(prefix.length).trim();
            const position = teacher && remainder.startsWith(teacher) ? remainder.slice(teacher.length).trim() : "";
            return { teacher, position, weeks: readWeekDescription(prefix) };
        });
        const matching = parsed.filter(detail => detail.weeks.includes(week));
        if (matching.length) return matching;
        if (parsed.length === 1 && !parsed[0].weeks.length) return parsed;
        return [{}];
    }

    async function loadNew() {
        const home = "homeapp/api/home/";
        const timetable = "kbapp/api/wdkbcx/";
        const user = await request(home + "currentUser.do", "当前学期");
        const term = text(user.welcomeInfo?.xnxqdm);
        if (!term) throw new Error("教务未返回当前学期。");
        const params = { XNXQDM: term, XQDM: "01" };
        const [sections, termWeeks] = await Promise.all([
            request(timetable + "getMySectionList.do", "节次表", params).catch(() => null),
            request(home + "getTermWeeks.do", "教学周", { termCode: term })
        ]);
        const sectionRows = Array.isArray(sections?.getMySectionList) ? sections.getMySectionList : [];
        const onlineSlots = readTimeSlots(sectionRows.flatMap(row => {
            const number = text(row?.name).match(/^第\s*(\d+)\s*节?$/)?.[1];
            return number ? [{ number, startTime: row.startTime, endTime: row.endTime }] : [];
        }));
        const slots = onlineSlots ?? defaultTimeSlots;
        if (!Array.isArray(termWeeks) || !termWeeks.length || termWeeks.length > maxWeeks) {
            throw new Error("教务未返回有效的教学周。");
        }
        const weeks = [...termWeeks].sort((a, b) => Number(a.serialNumber) - Number(b.serialNumber));
        if (weeks.some((row, index) => Number(row.serialNumber) !== index + 1)) {
            throw new Error("教务返回的教学周不连续。");
        }
        const starts = new Map(slots.map(slot => [slot.startTime, slot.number]));
        const ends = new Map(slots.map(slot => [slot.endTime, slot.number]));
        const courses = [];
        for (let offset = 0; offset < weeks.length; offset += 3) {
            const batch = await Promise.all(weeks.slice(offset, offset + 3).map(async row => {
                const week = Number(row.serialNumber);
                const label = `第 ${week} 周课表`;
                const data = await request(timetable + "getMyScheduleDetail.do", label, { ...params, ZC: week });
                const items = data.getMyScheduleDetail?.arrangedList;
                if (!Array.isArray(items)) throw new Error(`${label}缺少排课列表。`);
                return items.flatMap(item => {
                    if (!item.dayOfWeek || !item.beginSection) return [];
                    if (isWeekMask(item.week) && item.week[week - 1] !== "1") return [];
                    const from = item.beginTime ? starts.get(clock(item.beginTime)) : item.beginSection;
                    const to = item.endTime ? ends.get(clock(item.endTime)) : item.endSection;
                    return readCourseDetails(item, week).map(detail => {
                        const campus = text(item.campusName);
                        const room = text(item.placeName) || text(detail.position);
                        const place = campus && !room.includes(campus) ? [campus, room].filter(Boolean).join(" ") : room;
                        return course(item.courseName, text(detail.teacher) || item.teacherName, place, item.dayOfWeek, from, to, [week]);
                    });
                });
            }));
            for (const rows of batch) courses.push(...rows);
        }
        return {
            label: term, courses, slots, usedDefaultTimeSlots: !onlineSlots,
            settings: readConfig(weeks[0].startDate, weeks.length), warnings: []
        };
    }

    const runKey = Symbol.for("shiguangschedule.wynu.activeImport");
    if (window[runKey]) {
        native.showToast("课表导入正在进行，请等待当前任务完成。");
        return;
    }
    window[runKey] = true;
    let timeSlotsSaved = false;
    try {
        native.showToast("正在读取滇西科技师范学院课表…");
        const result = moduleName === "wdkb" ? await loadLegacy() : await loadNew();
        if (!result) return;
        const { label, slots, usedDefaultTimeSlots, settings, warnings } = result;
        const courses = exportCourses(result.courses, slots);
        if (!courses.length) throw new Error("该学期没有可导入的排课。");
        const preview = [`${label}，${courses.length} 条课程，将替换所选课表。`, ...warnings];
        if (usedDefaultTimeSlots) preview.push("教务作息不可用，本次将使用学校的 13 节预设作息。");
        if (!settings) preview.push("请在导入后核对学期设置。");
        if (!await bridge.showAlert("确认导入课表", preview.join("\n"), "导入")) return;
        if (await bridge.savePresetTimeSlots(JSON.stringify(slots)) !== true) throw new Error("节次作息保存失败。");
        timeSlotsSaved = true;
        if (await bridge.saveImportedCourses(JSON.stringify(courses)) !== true) throw new Error("课程保存失败。");
        if (settings && await bridge.saveCourseConfig(JSON.stringify(settings)) !== true) throw new Error("学期设置保存失败。");
        native.showToast(`已导入 ${courses.length} 条课程。`);
        native.notifyTaskCompletion();
    } catch (error) {
        const detail = timeSlotsSaved ? "\n部分数据已更新，请核对课表后重试。" : "";
        await bridge.showAlert("导入失败", `${error.message}${detail}`, "关闭");
    } finally {
        delete window[runKey];
    }
})();
