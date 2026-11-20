(async () => {
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    const origin = "https://cityjw.kust.edu.cn";
    const coursePage = "/for-std/course-table";
    const loginMessage = "请登录城市学院教务系统后再导入。";
    const maxWeeks = 60;
    const unitCount = 13;
    const dayMillis = 86_400_000;

    if (window.__kustImportRunning) return;
    window.__kustImportRunning = true;

    function integer(value) {
        if (typeof value === "string" && /^\d+$/.test(value.trim())) value = Number(value);
        return Number.isSafeInteger(value) ? value : NaN;
    }

    function text(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    async function request(path, label, body) {
        const init = { credentials: "same-origin", mode: "same-origin", redirect: "manual" };
        if (body !== undefined) {
            init.method = "POST";
            init.headers = { "Content-Type": "application/json; charset=UTF-8" };
            init.body = JSON.stringify(body);
        }
        const failure = `${label}读取失败，请稍后重试。`;
        let response;
        try {
            response = await fetch(`${origin}/integration${path}`, init);
        } catch {
            throw new Error(failure);
        }
        if (response.type === "opaqueredirect" || [301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
            throw new Error(loginMessage);
        }
        if (!response.ok) throw new Error(failure);
        return response.text().catch(() => { throw new Error(failure); });
    }

    async function requestJson(path, label, body) {
        const content = await request(path, label, body);
        let value;
        try {
            value = JSON.parse(content);
        } catch {
            if (/<title[^>]*>[^<]*(?:登录|登入)|\blogin-salt\b|统一身份认证/i.test(content)) throw new Error(loginMessage);
            throw new Error(`${label}返回的数据格式异常。`);
        }
        if ([401, 403].includes(integer(value?.code)) || /未登[录陆]|重新登录|请先登录|登录.{0,2}过期|会话.{0,2}过期/.test(text(value?.message))) {
            throw new Error(loginMessage);
        }
        if (!value || typeof value !== "object" || Array.isArray(value) || value.result === false) {
            throw new Error(`${label}读取失败，请稍后重试。`);
        }
        return value;
    }

    async function chooseSemester() {
        const html = await request(coursePage, "课表页面");
        const page = new DOMParser().parseFromString(html, "text/html");
        const select = page.getElementById("allSemesters");
        if (!select?.options) throw new Error(`教务页面未返回学期列表。${loginMessage}`);

        const semesters = Array.from(select.options, option => ({
            id: integer(option.value), name: text(option.label), selected: option.selected
        })).filter(semester => semester.id > 0);
        if (!semesters.length) throw new Error("教务系统未提供可选学期。");
        const defaultIndex = Math.max(0, semesters.findIndex(semester => semester.selected));
        const names = semesters.map(semester => semester.name || String(semester.id));
        const index = semesters.length === 1
            ? 0
            : await bridge.showSingleSelection("选择学期", JSON.stringify(names), defaultIndex);
        if (index === null || index === -1) return null;
        if (!Number.isInteger(index) || !semesters[index]) throw new Error("所选学期无效，请重新导入。");

        const bizType = html.match(/\b(?:var|let|const)\s+bizTypeId\s*=\s*["']?(\d+)\b/);
        return { ...semesters[index], bizTypeId: bizType ? integer(bizType[1]) : 2 };
    }

    function minutes(value) {
        const clock = integer(value);
        if (!(clock >= 0 && clock <= 2359 && clock % 100 < 60)) throw new Error("教务系统返回了无效的上课时间。");
        return Math.floor(clock / 100) * 60 + clock % 100;
    }

    function clockTime(value) {
        return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    }

    function readUnits(result) {
        const units = result?.courseUnitList;
        if (!Array.isArray(units) || units.length !== unitCount) throw new Error("教务系统未返回完整的 13 节作息。");
        const slots = units.map(unit => ({
            number: integer(unit?.indexNo), start: minutes(unit?.startTime), end: minutes(unit?.endTime)
        })).sort((a, b) => a.number - b.number);
        for (const [index, slot] of slots.entries()) {
            if (slot.number !== index + 1 || slot.start >= slot.end || slot.start < (slots[index - 1]?.end ?? 0)) {
                throw new Error("教务作息的节次或起止时间异常。");
            }
        }
        return slots;
    }

    function dayNumber(value) {
        const date = text(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
        const timestamp = Date.parse(`${date}T00:00:00Z`);
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return NaN;
        return timestamp / dayMillis;
    }

    function monday(day) {
        return day - (new Date(day * dayMillis).getUTCDay() + 6) % 7;
    }

    function readCalendar(raw, schedules) {
        const term = raw.lessons.find(lesson => lesson?.semester)?.semester ?? raw.semester;
        let first = monday(dayNumber(term?.startDate));
        if (!Number.isFinite(first)) {
            // 排课日期和所属周次可以回推第一周周一。
            for (const row of schedules) {
                const week = integer(row.weekIndex);
                const date = dayNumber(row.date);
                if (Number.isFinite(date) && week >= 1 && week <= maxWeeks) {
                    first = monday(date) - (week - 1) * 7;
                    break;
                }
            }
        }
        if (!Number.isFinite(first)) throw new Error("教务系统未提供有效的开学日期。");

        const indices = raw.weekIndices ?? [];
        if (!Array.isArray(indices)) throw new Error("教务系统返回的周次列表格式异常。");
        const weeks = [...new Set(indices.map(integer))].sort((a, b) => a - b);
        if (weeks.some((week, index) => week !== index + 1)) throw new Error("教务系统返回的教学周列表不连续。");
        const totalWeeks = weeks.length || Math.floor((dayNumber(term?.endDate) - first) / 7) + 1;
        if (!(totalWeeks >= 1 && totalWeeks <= maxWeeks)) throw new Error("教务系统未提供有效的教学周数。");
        return {
            semesterStartDate: new Date(first * dayMillis).toISOString().slice(0, 10),
            semesterTotalWeeks: totalWeeks,
            firstDayOfWeek: 1
        };
    }

    function readCourses(raw, datum, schedules, units, totalWeeks) {
        const names = new Map(raw.lessons.map(lesson => [integer(lesson?.id), text(lesson?.course?.nameZh)]));
        for (const lesson of datum.lessonList ?? []) {
            const name = text(lesson?.courseName);
            if (name) names.set(integer(lesson.id), name);
        }

        const grouped = new Map();
        for (const row of schedules) {
            const lessonId = integer(row.lessonId);
            const day = integer(row.weekday);
            const week = integer(row.weekIndex);
            const name = names.get(lessonId);
            if (!name || !(day >= 1 && day <= 7 && week >= 1 && week <= totalWeeks)) {
                throw new Error("教务课表包含缺少课程名、星期或周次的排课记录。");
            }
            const start = minutes(row.startTime);
            const end = minutes(row.endTime);
            const sections = units.filter(unit => unit.start >= start && unit.end <= end);
            if (!sections.length) throw new Error("有课程的上课时间未匹配到教务作息。");
            const first = sections[0];
            const last = sections[sections.length - 1];
            const campus = text(row.room?.building?.campus?.nameZh);
            const place = text(row.room?.nameZh) || text(row.customPlace);
            const position = [campus, place].filter(Boolean).join(" ");
            const teacher = text(row.personName);
            const groupId = String(row.scheduleGroupId ?? "");
            const key = JSON.stringify([lessonId, groupId, day, start, end, teacher, position]);
            if (!grouped.has(key)) {
                const course = { name, teacher, position, day, startSection: first.number, endSection: last.number };
                if (start !== first.start || end !== last.end) {
                    Object.assign(course, { isCustomTime: true, customStartTime: clockTime(start), customEndTime: clockTime(end) });
                }
                grouped.set(key, { course, weeks: new Set() });
            }
            grouped.get(key).weeks.add(week);
        }

        return [...grouped.values()].map(({ course, weeks }) => ({ ...course, weeks: [...weeks].sort((a, b) => a - b) }))
            .sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, "zh-CN"));
    }

    async function save(method, payload, label) {
        try {
            if (await bridge[method](JSON.stringify(payload)) === true) return;
        } catch {
            // 桥接保存失败由导入弹窗统一反馈。
        }
        throw new Error(`${label}保存失败，请重新导入。`);
    }

    let saving = false;
    try {
        if (location.origin !== origin) throw new Error(loginMessage);
        const semester = await chooseSemester();
        if (!semester) return;

        native.showToast("正在读取城市学院课表…");
        const query = new URLSearchParams({ bizTypeId: semester.bizTypeId, semesterId: semester.id });
        const raw = await requestJson(`${coursePage}/get-data?${query}`, "课程任务");
        if (!Array.isArray(raw.lessons) || (raw.lessonIds != null && !Array.isArray(raw.lessonIds))) {
            throw new Error("教务系统未返回完整的课程任务。");
        }
        const lessonIds = (raw.lessonIds?.length ? raw.lessonIds : raw.lessons.map(lesson => lesson?.id)).map(integer);
        if (lessonIds.some(id => !(id > 0))) throw new Error("教务系统返回了无效的课程任务编号。");
        const publishedIds = new Set(lessonIds.filter(id => raw.lessonId2Flag?.[id] !== "noPublish"));
        if (!publishedIds.size) throw new Error("所选学期暂无已发布的课程任务。");

        const layoutId = integer(raw.timeTableLayoutId);
        if (!(layoutId > 0)) throw new Error("教务系统未提供有效的作息表编号。");
        const [layoutResponse, datumResponse] = await Promise.all([
            requestJson("/ws/schedule-table/timetable-layout", "作息表", { timeTableLayoutId: layoutId }),
            requestJson("/ws/schedule-table/datum", "排课明细", {
                lessonIds: [...publishedIds], studentId: null, stdPersonId: null, weekIndex: null
            })
        ]);
        const units = readUnits(layoutResponse.result);
        const datum = datumResponse.result;
        if (!Array.isArray(datum?.scheduleList) || (datum.lessonList != null && !Array.isArray(datum.lessonList))) {
            throw new Error("教务系统未返回完整的排课明细。");
        }
        const schedules = datum.scheduleList.filter(row => {
            const id = integer(row?.lessonId);
            if (!(id > 0)) throw new Error("排课明细包含无效的课程任务编号。");
            return publishedIds.has(id);
        });
        if (!schedules.length) throw new Error("所选学期暂无可导入的已发布排课。");

        const config = readCalendar(raw, schedules);
        const courses = readCourses(raw, datum, schedules, units, config.semesterTotalWeeks);
        const slots = units.map(({ number, start, end }) => ({ number, startTime: clockTime(start), endTime: clockTime(end) }));
        const unscheduled = publishedIds.size - new Set(schedules.map(row => integer(row.lessonId))).size;
        const summary = [
            `${semester.name || semester.id} · 城市学院`,
            `共 ${courses.length} 条排课记录、${slots.length} 节作息，第一周周一为 ${config.semesterStartDate}，共 ${config.semesterTotalWeeks} 周。`
        ];
        if (unscheduled) summary.push(`另有 ${unscheduled} 门课程尚未排时间。`);
        if (!await bridge.showAlert("确认导入课表", summary.join("\n"), "导入")) return;

        saving = true;
        await save("saveCourseConfig", config, "学期配置");
        await save("savePresetTimeSlots", slots, "作息表");
        await save("saveImportedCourses", courses, "课程");
        native.showToast(`已导入 ${courses.length} 条排课记录。`);
        native.notifyTaskCompletion();
    } catch (error) {
        const detail = saving ? "\n目标课表可能已部分更新。" : "";
        await bridge.showAlert("导入失败", `${error.message}${detail}`, "确定");
    } finally {
        delete window.__kustImportRunning;
    }
})();
