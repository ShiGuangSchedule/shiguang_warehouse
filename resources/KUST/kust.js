(async () => {
    const campuses = {
        "https://jwctsp.kust.edu.cn": "呈贡校区",
        "https://cityjw.kust.edu.cn": "迎新校区"
    };
    const { origin, pathname } = window.location;
    const campus = campuses[origin];
    const basePath = "/integration";
    const tablePath = `${basePath}/for-std/course-table`;
    const schedulePath = `${basePath}/ws/schedule-table`;
    const loginRequired = "请先登录昆明理工大学本部或城市学院教务，再执行导入。";
    const defaultTimeSlots = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:50", endTime: "09:35" },
        { number: 3, startTime: "09:50", endTime: "10:35" },
        { number: 4, startTime: "10:40", endTime: "11:25" },
        { number: 5, startTime: "11:30", endTime: "12:15" },
        { number: 6, startTime: "13:30", endTime: "14:15" },
        { number: 7, startTime: "14:20", endTime: "15:05" },
        { number: 8, startTime: "15:10", endTime: "15:55" },
        { number: 9, startTime: "16:10", endTime: "16:55" },
        { number: 10, startTime: "17:00", endTime: "17:45" },
        { number: 11, startTime: "17:50", endTime: "18:35" },
        { number: 12, startTime: "19:30", endTime: "20:15" },
        { number: 13, startTime: "20:20", endTime: "21:05" }
    ];
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    const text = value => typeof value === "string" ? value.trim() : "";

    if (!bridge || !native) {
        console.error("请在拾光课程表或拾光适配测试插件中运行此脚本。");
        return;
    }
    if (!campus || isLoginPage(pathname)) {
        native.showToast(loginRequired);
        return;
    }

    // 可重复注入。旧任务在下一次桥接调用前检查是否已被新任务替代。
    const runKey = Symbol.for("shiguangschedule.kmust.activeImport");
    const run = {};
    window[runKey] = run;

    function assertCurrentRun() {
        if (window[runKey] !== run) throw new Error("导入已被后一次操作替代。");
    }

    function isLoginPage(path) {
        return path === `${basePath}/login` || path.startsWith(`${basePath}/login/`);
    }

    async function request(path, label, { payload, html = false, optional = false } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const options = {
                mode: "same-origin",
                cache: "no-store",
                headers: html
                    ? { Accept: "text/html" }
                    : { Accept: "application/json, */*;q=0.1", "X-Requested-With": "XMLHttpRequest" },
                signal: controller.signal
            };
            if (payload !== undefined) {
                options.method = "POST";
                options.headers["Content-Type"] = "application/json";
                options.body = JSON.stringify(payload);
            }
            const response = await fetch(new URL(path, origin), options);
            const finalUrl = new URL(response.url || path, origin);
            if (finalUrl.origin !== origin || response.status === 401 || response.status === 403 ||
                isLoginPage(finalUrl.pathname)) {
                throw new Error("教务登录已失效或无课表访问权限，请重新登录后再试。");
            }
            if (!response.ok) {
                const error = new Error(`${label}请求失败（HTTP ${response.status}）。`);
                error.status = response.status;
                throw error;
            }
            const body = await response.text();
            if (html) return body;
            try {
                const data = JSON.parse(body);
                return data?.data ?? data;
            } catch {
                throw new Error(`${label}未返回 JSON，请打开个人课表后重试。`);
            }
        } catch (error) {
            if (optional) return null;
            if (error.name === "AbortError") throw new Error(`${label}请求超时，请重试。`);
            if (error instanceof TypeError) {
                throw new Error(`无法读取${label}，请确认当前教务已登录且可以打开个人课表。`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    function readTerms(doc) {
        const selectors = "select#semesters, select#allSemesters, select[name='semesterId']";
        for (const select of doc.querySelectorAll(selectors)) {
            const terms = [...select.options].filter(option => !option.disabled).map(option => ({
                id: option.value.trim(),
                label: option.text.trim(),
                selected: option.selected
            })).filter(term => /^[1-9]\d*$/.test(term.id) && term.label);
            if (terms.length) return terms;
        }
        return [];
    }

    async function readTimetablePage() {
        let doc = document;
        const onTimetable = pathname === tablePath || pathname.startsWith(`${tablePath}/`);
        let terms = onTimetable ? readTerms(doc) : [];
        if (!terms.length) {
            const html = await request(tablePath, "个人课表页面", { html: true });
            doc = new DOMParser().parseFromString(html, "text/html");
            terms = readTerms(doc);
        }
        if (!terms.length) {
            throw new Error("未找到学期列表，请在教务里打开个人课表页面再执行导入。");
        }

        const declarations = Array.from(doc.scripts, script => script.textContent);
        const source = declarations.find(code => code.includes("/ws/schedule-table/datum"));
        const personIds = new Set(Array.from(
            (source ?? "").matchAll(/\bdata\s*\[\s*["']stdPersonId["']\s*\]\s*=\s*([1-9]\d*)\s*;/g),
            match => Number(match[1])
        ));
        const [personId] = personIds;
        if (personIds.size === 1 && Number.isSafeInteger(personId)) return { terms, personId };

        // 部分树维部署的打印接口会使用个人课表页提供的 dataId。
        const declaration = /\b(?:var|let|const)\s+dataId\s*=\s*(?:["']([1-9]\d*)["']|([1-9]\d*)\b)\s*(?=[;,\r\n]|$)/;
        const match = declarations.map(code => declaration.exec(code)).find(Boolean);
        return { terms, dataId: match?.[1] ?? match?.[2] };
    }

    async function chooseTerm(terms) {
        const selected = await bridge.showSingleSelection(
            `${campus} · 选择学期`,
            JSON.stringify(terms.map(term => term.label)),
            terms.findIndex(term => term.selected)
        );
        assertCurrentRun();
        if (selected === null || selected === -1) return null;
        const term = Number.isInteger(selected) ? terms[selected] : null;
        if (!term) throw new Error("未选到有效的学期。");
        return term;
    }

    async function requestPrintData(semesterId, dataId) {
        const path = `${tablePath}/semester/${semesterId}/print-data`;
        const query = `?semesterId=${semesterId}&hasExperiment=true`;
        try {
            return await request(`${path}${query}`, "课表数据");
        } catch (error) {
            if (!dataId || ![400, 404, 405, 422].includes(error.status)) throw error;
            return request(`${path}/${dataId}${query}`, "个人课表数据");
        }
    }

    async function readScheduledCourses(index, lessonIds, personId) {
        const payload = { lessonIds, studentId: null, stdPersonId: personId, weekIndex: null };
        const [datum, onlineTimeSlots] = await Promise.all([
            request(`${schedulePath}/datum`, "排课明细", { payload }),
            requestTimeSlots(index.timeTableLayoutId)
        ]);
        if (!Array.isArray(datum?.result?.lessonList) || !Array.isArray(datum.result.scheduleList)) {
            throw new Error("教务未返回有效的排课明细。");
        }
        const publishedIds = new Set(lessonIds.map(String));
        const { timeSlots, usedDefaultTimeSlots } = resolveTimeSlots(onlineTimeSlots);
        const { rows, skipped } = readScheduleRows(datum.result, timeSlots, publishedIds);
        return { rows, skipped, timeSlots, usedDefaultTimeSlots };
    }

    function readPublishedActivities(activities, index, publishedIds) {
        const indexedIds = new Set(index.lessonIds.map(String));
        const idsByCode = new Map();
        for (const lesson of Object.values(index.lessons ?? {})) {
            const id = String(lesson?.id);
            const code = text(lesson?.code);
            if (!code || !indexedIds.has(id)) continue;
            if (!idsByCode.has(code)) idsByCode.set(code, id);
            else if (idsByCode.get(code) !== id) idsByCode.set(code, null);
        }
        return activities.flatMap(activity => {
            const id = String(activity?.lessonId ?? activity?.lesson?.id);
            const code = text(activity?.lessonCode) || text(activity?.lesson?.code);
            const lessonId = indexedIds.has(id) ? id : idsByCode.get(code);
            if (!lessonId) throw new Error("打印课表缺少可核对的教学班编号，无法确认课程发布状态。");
            return publishedIds.has(lessonId) ? [{ ...activity, lessonId }] : [];
        });
    }

    async function readPrintedCourses(semesterId, dataId, index, lessonIds) {
        const data = await requestPrintData(semesterId, dataId);
        const table = data?.studentTableVms?.[0] ?? data?.studentTableVm ?? data;
        if (!Array.isArray(table?.activities)) throw new Error("教务返回的打印数据缺少课程列表。");

        const activities = readPublishedActivities(table.activities, index, new Set(lessonIds.map(String)));
        const rows = activities.map(readPrintCourse).filter(Boolean);
        const skipped = activities.length - rows.length;
        if (!rows.length) return { rows, skipped, timeSlots: null };

        const lastSection = rows.reduce((last, course) => Math.max(last, course.endSection), 0);
        const embeddedTimeSlots = readTimeSlots(table.timeTableLayout ?? data?.timeTableLayout);
        const onlineTimeSlots = embeddedTimeSlots?.length >= lastSection
            ? embeddedTimeSlots
            : await requestTimeSlots(index.timeTableLayoutId);
        return { rows, skipped, ...resolveTimeSlots(onlineTimeSlots, lastSection) };
    }

    async function readCourseData(semesterId, page) {
        if (!page.personId && origin === "https://cityjw.kust.edu.cn") {
            throw new Error("未能识别城院个人课表请求，请打开个人课表页面后重新执行导入。");
        }
        const index = await request(`${tablePath}/get-data?bizTypeId=2&semesterId=${semesterId}`, "课程发布状态");
        if (!Array.isArray(index?.lessonIds)) throw new Error("教务未返回有效的课程索引。");
        const flags = index.lessonId2Flag;
        if (index.lessonIds.length && (!flags || typeof flags !== "object" || Array.isArray(flags))) {
            throw new Error("教务未提供课程发布状态，无法确认哪些课程可以导入。");
        }
        // 教务的个人课表网格只渲染已发布的教学班。
        const lessonIds = index.lessonIds.filter(id => flags[id] === "publish");
        if (!lessonIds.length) return { rows: [], skipped: 0, timeSlots: null };
        assertCurrentRun();
        return page.personId
            ? readScheduledCourses(index, lessonIds, page.personId)
            : readPrintedCourses(semesterId, page.dataId, index, lessonIds);
    }

    function positiveInt(value) {
        if (typeof value !== "number" && !/^\d+$/.test(text(value))) return 0;
        const number = Number(value);
        return Number.isInteger(number) && number > 0 && number <= 2147483647 ? number : 0;
    }

    function readPrintCourse(activity) {
        const name = text(activity?.courseName);
        const day = positiveInt(activity?.weekday);
        const startSection = positiveInt(activity?.startUnit);
        const endSection = positiveInt(activity?.endUnit);
        const weeks = Array.isArray(activity?.weekIndexes) ? activity.weekIndexes.map(positiveInt).filter(Boolean) : [];
        if (!name || !day || day > 7 || !startSection || endSection < startSection || !weeks.length) return null;

        const teachers = Array.isArray(activity.teachers) ? activity.teachers : [activity.teachers];
        return {
            lessonId: activity.lessonId,
            name,
            teacher: teachers.map(value => text(value).replace(/\s*[（(]\d+[）)]\s*$/, "")).filter(Boolean).join("、"),
            position: [text(activity.campus), text(activity.room)].filter(Boolean).join(" "),
            day,
            startSection,
            endSection,
            weeks
        };
    }

    function readScheduleRows(datum, timeSlots, publishedIds) {
        const lessons = new Map(datum.lessonList
            .filter(lesson => publishedIds.has(String(lesson?.id)))
            .map(lesson => [String(lesson.id), lesson]));
        const startUnits = new Map(timeSlots.map(slot => [slot.startTime, slot.number]));
        const endUnits = new Map(timeSlots.map(slot => [slot.endTime, slot.number]));
        const sessions = new Map();
        let skipped = 0;

        for (const entry of datum.scheduleList) {
            const lessonId = String(entry?.lessonId);
            if (!publishedIds.has(lessonId)) continue;
            const lesson = lessons.get(lessonId);
            const name = text(lesson?.courseName) || text(lesson?.name);
            const day = positiveInt(entry?.weekday);
            const week = positiveInt(entry?.weekIndex);
            const startSection = startUnits.get(clock(entry?.startTime));
            const endSection = endUnits.get(clock(entry?.endTime));
            if (!name || !day || day > 7 || !week || !startSection || !endSection || startSection > endSection) {
                skipped++;
                continue;
            }
            const key = JSON.stringify([lessonId, day, week, startSection, endSection]);
            if (!sessions.has(key)) {
                sessions.set(key, { lessonId, name, day, week, startSection, endSection, teachers: new Set(), rooms: new Set() });
            }
            const session = sessions.get(key);
            const teacher = text(entry.personName);
            const room = text(entry.room?.nameZh) || text(entry.customPlace) || text(entry.room);
            if (teacher) session.teachers.add(teacher);
            if (room) session.rooms.add(room);
        }

        const rows = [...sessions.values()].map(session => {
            const { lessonId, name, day, week, startSection, endSection, teachers, rooms } = session;
            const assignments = lessons.get(lessonId)?.teacherAssignmentList;
            if (teachers.size === 0 && Array.isArray(assignments)) {
                for (const assignment of assignments) {
                    const teacher = text(assignment?.name);
                    if (teacher) teachers.add(teacher);
                }
            }
            return {
                lessonId, name, day, startSection, endSection, weeks: [week],
                teacher: [...teachers].sort().join("、"),
                position: [...rooms].sort().join(" / ")
            };
        });
        return { rows, skipped };
    }

    function exportCourses(rows) {
        const merged = new Map();
        for (const { lessonId, weeks, ...course } of rows) {
            const key = JSON.stringify([lessonId, course]);
            if (!merged.has(key)) merged.set(key, { course, weeks: new Set() });
            for (const week of weeks) merged.get(key).weeks.add(week);
        }
        return [...merged.values()].map(({ course, weeks }) => ({ ...course, weeks: [...weeks].sort((a, b) => a - b) }));
    }

    function clock(value) {
        let input = String(value ?? "").trim();
        if (/^\d{1,4}$/.test(input)) {
            input = input.padStart(4, "0");
            input = `${input.slice(0, 2)}:${input.slice(2)}`;
        }
        const match = /^(\d{1,2}):([0-5]\d)(?::00)?$/.exec(input);
        if (!match || Number(match[1]) > 23) return "";
        return `${match[1].padStart(2, "0")}:${match[2]}`;
    }

    function readTimeSlots(layout) {
        if (!Array.isArray(layout?.courseUnitList) || !layout.courseUnitList.length) return null;
        const slots = layout.courseUnitList.map(unit => ({
            number: positiveInt(unit?.indexNo),
            startTime: clock(unit?.startTime),
            endTime: clock(unit?.endTime)
        })).sort((a, b) => a.number - b.number);
        const valid = slots.every((slot, index) =>
            slot.number === index + 1 && slot.startTime && slot.endTime &&
            slot.startTime < slot.endTime && (index === 0 || slots[index - 1].endTime <= slot.startTime)
        );
        return valid ? slots : null;
    }

    async function requestTimeSlots(layoutId) {
        if (!layoutId) return null;
        const payload = { timeTableLayoutId: layoutId };
        const layout = await request(`${schedulePath}/timetable-layout`, "节次作息", { payload, optional: true });
        return readTimeSlots(layout?.result);
    }

    function resolveTimeSlots(onlineTimeSlots, lastSection = 1) {
        const usedDefaultTimeSlots = (onlineTimeSlots?.length ?? 0) < lastSection;
        const timeSlots = usedDefaultTimeSlots ? defaultTimeSlots : onlineTimeSlots;
        if (timeSlots.length < lastSection) throw new Error("课程节次超出了作息表，请核对该学期的课表。");
        return { timeSlots, usedDefaultTimeSlots };
    }

    function readDate(value) {
        const date = text(value).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const timestamp = Date.parse(`${date}T00:00:00Z`);
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
        return { date, timestamp };
    }

    function buildConfig(semester, courses) {
        const start = readDate(semester?.startDate);
        const end = readDate(semester?.endDate);
        if (!start || !end || end.timestamp < start.timestamp) return null;
        const firstDayOfWeek = [true, "true", 1, "1"].includes(semester.weekStartOnSunday) ? 7 : 1;
        const startWeekday = new Date(start.timestamp).getUTCDay();
        const firstWeekOffset = (startWeekday - firstDayOfWeek + 7) % 7;
        const days = (end.timestamp - start.timestamp) / 86_400_000 + 1;
        const lastClassWeek = courses.reduce((max, { weeks }) => Math.max(max, weeks[weeks.length - 1]), 0);
        return {
            semesterStartDate: start.date,
            semesterTotalWeeks: Math.max(Math.ceil((days + firstWeekOffset) / 7), lastClassWeek),
            firstDayOfWeek
        };
    }

    async function saveSemesterConfig(config) {
        if (!config) return false;
        try {
            return await bridge.saveCourseConfig(JSON.stringify(config)) === true;
        } catch {
            return false;
        }
    }

    let timeSlotsSaved = false;
    try {
        native.showToast(`正在读取${campus}教务的学期列表…`);
        const page = await readTimetablePage();
        assertCurrentRun();
        const term = await chooseTerm(page.terms);
        if (!term) return;

        native.showToast("正在读取课程和作息…");
        const [{ rows, skipped, timeSlots, usedDefaultTimeSlots }, semester] = await Promise.all([
            readCourseData(term.id, page),
            request(`${basePath}/ws/semester/get/${term.id}`, "学期信息", { optional: true })
        ]);
        assertCurrentRun();
        const courses = exportCourses(rows);
        if (courses.length === 0) {
            throw new Error(skipped
                ? "已发布课程无法匹配教务节次，请核对该学期的课表。"
                : "该学期没有可导入的已发布课程，请核对教务课表。");
        }
        const config = buildConfig(semester, courses);
        const preview = [
            `${campus} · ${term.label} · ${courses.length} 条课程安排`,
            "导入会替换拾光所选课表的已有课程和作息。",
            usedDefaultTimeSlots ? "本次使用校历预设作息，请核对节次时间。" : "",
            skipped ? `另有 ${skipped} 条排课记录缺少有效信息或无法匹配教务节次，已略过。` : "",
            !config ? "学期起止日期不可用，导入后请核对学期设置。" : ""
        ].filter(Boolean).join("\n");
        const confirmed = await bridge.showAlert("确认导入课表", preview, "导入");
        assertCurrentRun();
        if (!confirmed) return;

        if (await bridge.savePresetTimeSlots(JSON.stringify(timeSlots)) !== true) {
            throw new Error("拾光未能保存教务节次作息，请重试。");
        }
        timeSlotsSaved = true;
        assertCurrentRun();
        if (await bridge.saveImportedCourses(JSON.stringify(courses)) !== true) {
            throw new Error("拾光未能保存课程，请重试。");
        }
        assertCurrentRun();
        const configSaved = await saveSemesterConfig(config);
        assertCurrentRun();
        const hint = configSaved ? "" : "，请核对学期设置";
        native.showToast(`已导入 ${courses.length} 条课程安排${hint}。`);
        native.notifyTaskCompletion();
    } catch (error) {
        if (window[runKey] !== run) return;
        const message = error instanceof Error ? error.message : text(error) || "课表导入失败，请重试。";
        const detail = timeSlotsSaved ? "\n作息已保存，请重新导入完整课表。" : "";
        console.warn("[KMUST]", message);
        native.showToast(`${message}${detail}`);
        await bridge.showAlert("课表导入失败", `${message}${detail}`, "关闭").catch(() => {});
    } finally {
        if (window[runKey] === run) delete window[runKey];
    }
})();
