(async () => {
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    const maxWeeks = 60;
    const defaultWeeks = 20;
    const fallbackTimesByCampus = {
        "开发区": [
            ["08:00", "08:45"], ["08:55", "09:40"],
            ["10:00", "10:45"], ["10:55", "11:40"],
            ["13:30", "14:15"], ["14:25", "15:10"],
            ["15:20", "16:05"], ["16:15", "17:00"],
            ["18:00", "18:45"], ["18:55", "19:40"],
            ["20:00", "20:45"], ["20:55", "21:40"]
        ],
        "金石滩": [
            ["08:30", "09:10"], ["09:20", "10:00"],
            ["10:20", "11:00"], ["11:10", "11:50"],
            ["13:30", "14:10"], ["14:20", "15:00"],
            ["15:20", "16:00"], ["16:10", "16:50"],
            ["18:30", "19:10"], ["19:20", "20:00"],
            ["20:10", "20:50"], ["21:00", "21:40"]
        ]
    };
    const asText = value => String(value ?? "").trim();

    if (window.__dlnuImportRunning) return;
    window.__dlnuImportRunning = true;

    function readToken() {
        for (const storage of [sessionStorage, localStorage]) {
            for (const key of ["Token", "token", "access_token", "Access-Token"]) {
                const token = asText(storage.getItem(key));
                if (token) return token;
            }
        }
        throw new Error("请先登录学校教务系统，再点击导入。");
    }

    async function request(token, route, params, label, { allowMissingData = false } = {}) {
        const url = new URL(`/njwhd/${route}`, location.origin);
        const failure = `${label}读取失败，请稍后重试。`;
        let response;
        try {
            response = await fetch(url, {
                method: "POST",
                credentials: "same-origin",
                redirect: "error",
                headers: { token, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                body: new URLSearchParams(params)
            });
        } catch {
            throw new Error(failure);
        }
        if (response.status === 401 || response.status === 403) {
            throw new Error("登录已失效，请重新登录教务系统。");
        }
        if (!response.ok) throw new Error(failure);

        const result = await response.json().catch(() => null);
        const code = asText(result?.code);
        const message = asText(result?.Msg || result?.msg || result?.message);
        if (["401", "403", "-1"].includes(code) || (code !== "1" && /登录|未授权|过期|token/i.test(message))) {
            throw new Error("登录已失效，请重新登录教务系统。");
        }
        if (Array.isArray(result)) return result;
        if (code && code !== "1") throw new Error(failure);
        if (Array.isArray(result?.data)) return result.data;
        if (allowMissingData && code === "1" && result.data == null) return [];
        throw new Error(failure);
    }

    async function choose(label, options, defaultIndex = 0) {
        if (!options.length) throw new Error(`教务系统未返回可选${label}。`);
        if (options.length === 1) return options[0];
        const names = options.map(option => option.name);
        const index = await bridge.showSingleSelection(`选择${label}`, JSON.stringify(names), defaultIndex);
        if (index === null || index === -1) return null;
        if (!Number.isInteger(index) || !options[index]) throw new Error("所选项目无效，请重新导入。");
        return options[index];
    }

    function parseWeeks(item) {
        const weeks = new Set();
        const expression = asText(item.classWeekDetails) || asText(item.classWeek);
        for (const part of expression.split(/[,，、;；]/).map(asText).filter(Boolean)) {
            const match = part.match(/^(?:第\s*)?(\d+)\s*周?(?:\s*[-~～–—至]\s*(?:第\s*)?(\d+)\s*周?)?\s*(?:[（(]?\s*([单双])\s*周?\s*[)）]?)?$/);
            if (!match) throw new Error("课表包含无法识别的课程周次。");
            const first = Number(match[1]);
            const last = Number(match[2] ?? first);
            const parity = match[3];
            if (first < 1 || last < first || last > maxWeeks) throw new Error("课表包含无效的课程周次。");
            for (let week = first; week <= last; week++) {
                if (!parity || week % 2 === (parity === "单" ? 1 : 0)) weeks.add(week);
            }
        }
        return [...weeks].sort((a, b) => a - b);
    }

    function readSectionCodes(item) {
        const details = asText(item.weekNoteDetail).split(/[,，]/).map(asText).filter(Boolean);
        const explicit = details.filter(code => /^[1-7](?:0[1-9]|1[0-2])$/.test(code));
        if (explicit.length && explicit.length === details.length) return explicit.map(Number);

        const code = asText(item.classTime);
        if (!/^[1-7](?:0[1-9]|1[0-2])+$/.test(code)) return [];
        const day = Number(code[0]);
        const sections = code.slice(1).match(/\d{2}/g).map(Number);
        if (sections.length === 2 && sections[0] < sections[1]) {
            return Array.from({ length: sections[1] - sections[0] + 1 }, (_, i) => day * 100 + sections[0] + i);
        }
        return sections.map(section => day * 100 + section);
    }

    function readTime(value) {
        const match = asText(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function formatTime(minutes) {
        return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }

    function parseCourse(item) {
        const name = asText(item?.courseName);
        if (!name) throw new Error("课表包含缺少课程名的排课记录。");
        const weeks = parseWeeks(item);
        const codes = [...new Set(readSectionCodes(item))].sort((a, b) => a - b);
        if (!codes.length || !weeks.length) throw new Error("课表包含缺少节次或周次的排课记录。");

        const runs = [];
        for (const code of codes) {
            const day = Math.floor(code / 100);
            const section = code % 100;
            const last = runs[runs.length - 1];
            if (last?.day === day && last.endSection + 1 === section) {
                last.endSection = section;
            } else {
                runs.push({ day, startSection: section, endSection: section });
            }
        }

        const start = readTime(item.startTime);
        const end = readTime(item.endTIme) ?? readTime(item.endTime);
        const time = runs.length === 1 && start !== null && end !== null && start < end ? [start, end] : null;
        return runs.map(run => ({ name, teacher: asText(item.teacherName), position: asText(item.location), ...run, weeks, time }));
    }

    function exportCourses(courses) {
        const merged = new Map();
        for (const { weeks, time, ...entry } of courses) {
            if (time) {
                const [start, end] = time.map(formatTime);
                Object.assign(entry, { isCustomTime: true, customStartTime: start, customEndTime: end });
            }
            const key = JSON.stringify(entry);
            if (!merged.has(key)) merged.set(key, { entry, weeks: new Set() });
            for (const week of weeks) merged.get(key).weeks.add(week);
        }
        return [...merged.values()]
            .map(({ entry, weeks }) => ({ ...entry, weeks: [...weeks].sort((a, b) => a - b) }))
            .sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, "zh-CN"));
    }

    function startOfSemester(firstWeek) {
        const dates = firstWeek.flatMap(block => Array.isArray(block?.date) ? block.date : [])
            .map(day => asText(day?.mxrq).match(/^\d{4}-\d{2}-\d{2}/)?.[0])
            .filter(Boolean)
            .sort();
        for (const value of dates) {
            const date = new Date(`${value}T00:00:00Z`);
            if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) continue;
            date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
            return date.toISOString().slice(0, 10);
        }
        return null;
    }

    async function save(method, data, label) {
        try {
            if (await bridge[method](JSON.stringify(data)) === true) return;
        } catch {
            // 保存失败由导入弹窗统一反馈。
        }
        throw new Error(`${label}保存失败，请重新导入。`);
    }

    let saving = false;
    try {
        if (location.hostname !== "jwyd.dlnu.edu.cn" || location.port || !["http:", "https:"].includes(location.protocol)) {
            throw new Error("请打开大连民族大学教务系统，并在登录后导入。");
        }
        const token = readToken();
        const get = (route, params, label, options) => request(token, route, params, label, options);
        const terms = (await get("getXnxqList", {}, "学期列表"))
            .filter(term => asText(term?.xnxq01id))
            .map(term => ({ id: asText(term.xnxq01id), name: asText(term.xqmc) || asText(term.xnxq01id), current: asText(term.isdqxq) === "1" }));
        const term = await choose("学期", terms, Math.max(0, terms.findIndex(option => option.current)));
        if (!term) return;

        const campuses = new Map();
        for (const mode of await get("Get_sjkbms", {}, "校区列表")) {
            const id = asText(mode?.kbjcmsid);
            if (id && !campuses.has(id)) campuses.set(id, { id, name: asText(mode.kbjcmsmc || mode.kbjcmc) || id });
        }
        const campus = await choose("校区", [...campuses.values()]);
        if (!campus) return;

        native.showToast("正在读取教务课表…");
        const query = { xnxq01id: term.id, kbjcmsid: campus.id };
        const calendarOptions = { allowMissingData: true };
        const [timetable, firstWeek, calendar] = await Promise.all([
            get("student/curriculum", { ...query, week: "all" }, "整学期课表"),
            get("student/curriculum", { ...query, week: "1" }, "第一周日期", calendarOptions),
            get("teachingWeek", { semester: term.id }, "教学周", calendarOptions)
        ]);
        const courses = timetable.flatMap(block => {
            if (!block || (block.item != null && !Array.isArray(block.item))) throw new Error("教务课表数据格式异常。");
            return (block.item ?? []).flatMap(parseCourse);
        });
        if (!courses.length) throw new Error("所选学期和校区没有可导入的排课记录。");

        const numberedWeeks = calendar.map(row => Number(row?.week ?? row)).filter(Number.isInteger);
        const teachingWeeks = Math.max(calendar.length, ...numberedWeeks);
        const totalWeeks = courses.reduce((latest, { weeks }) => Math.max(latest, weeks[weeks.length - 1]), teachingWeeks || defaultWeeks);
        if (totalWeeks > maxWeeks) throw new Error("教务系统返回的教学周数无效。");
        const semesterStartDate = startOfSemester(firstWeek);
        const config = { semesterStartDate, semesterTotalWeeks: totalWeeks, firstDayOfWeek: 1 };
        const imported = exportCourses(courses);
        const fallbackTimes = courses.some(course => !course.time)
            ? Object.entries(fallbackTimesByCampus).find(([name]) => campus.name.includes(name))?.[1]
            : undefined;
        const fallbackSlots = fallbackTimes?.map(([startTime, endTime], index) => ({
            number: index + 1, startTime, endTime
        }));
        const weeksSummary = teachingWeeks ? `学期共 ${totalWeeks} 周。` : `教学周数待确认，本次按 ${totalWeeks} 周导入。`;
        const summary = [
            `${term.name} · ${campus.name}`,
            `共 ${imported.length} 条排课记录。${weeksSummary}`,
            semesterStartDate ? `第一周周一为 ${semesterStartDate}。` : "导入后请在课表设置中确认开学日期。"
        ];
        if (fallbackSlots) summary.push("缺少明确钟点的课程按所选校区的默认作息显示。");
        if (!await bridge.showAlert("确认导入课表", summary.join("\n"), "导入")) return;

        saving = true;
        if (fallbackSlots) await save("savePresetTimeSlots", fallbackSlots, "校区作息");
        await save("saveCourseConfig", config, "学期配置");
        await save("saveImportedCourses", imported, "课程");
        native.showToast(`已导入 ${imported.length} 条排课记录。`);
        native.notifyTaskCompletion();
    } catch (error) {
        const detail = saving ? "\n目标课表可能已部分更新。" : "";
        await bridge.showAlert("导入失败", `${error.message}${detail}`, "确定");
    } finally {
        delete window.__dlnuImportRunning;
    }
})();
