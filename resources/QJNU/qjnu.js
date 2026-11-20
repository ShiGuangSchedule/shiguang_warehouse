(async () => {
    const origin = "https://jw.qjnu.edu.cn";
    const moduleRoot = "/jwapp/sys/wdkb/modules";
    const loginRequired = "请登录曲靖师范学院网页教务，打开「我的课表」后再导入。";
    const maxWeeks = 60;
    const defaultTimeSlots = [
        { number: 1, startTime: "08:30", endTime: "09:15" },
        { number: 2, startTime: "09:25", endTime: "10:10" },
        { number: 3, startTime: "10:30", endTime: "11:15" },
        { number: 4, startTime: "11:25", endTime: "12:10" },
        { number: 5, startTime: "14:30", endTime: "15:15" },
        { number: 6, startTime: "15:25", endTime: "16:10" },
        { number: 7, startTime: "16:30", endTime: "17:15" },
        { number: 8, startTime: "17:25", endTime: "18:10" },
        { number: 9, startTime: "19:30", endTime: "20:15" },
        { number: 10, startTime: "20:25", endTime: "21:10" }
    ];
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    const text = value => String(value ?? "").trim();

    if (location.origin !== origin || !location.pathname.startsWith("/jwapp/")) {
        native.showToast(loginRequired);
        return;
    }
    if (window.__qjnuWebImportRunning) return;
    window.__qjnuWebImportRunning = true;

    async function requestRows(action, label, params = {}, optional = false) {
        const response = await fetch(`${moduleRoot}/${action}.do`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: new URLSearchParams(params),
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "manual"
        }).catch(() => null);
        const result = response?.ok ? await response.json().catch(() => null) : null;
        const key = action.slice(action.lastIndexOf("/") + 1);
        const rows = result?.datas?.[key]?.rows;
        if (Array.isArray(rows)) return rows;
        if (optional) return null;

        const message = text(result?.msg || result?.message);
        if (response?.type === "opaqueredirect" || [401, 403].includes(response?.status) ||
            text(result?.code) === "401" || /未登[录陆]|请先登录|重新登录|登录.{0,2}过期/.test(message)) {
            throw new Error(loginRequired);
        }
        const status = response && !response.ok ? `，HTTP ${response.status}` : "";
        throw new Error(`${label}读取失败（${key}.do${status}）。${loginRequired}`);
    }

    async function chooseTerm() {
        const [terms, current] = await Promise.all([
            requestRows("jshkcb/xnxqcx", "学期列表", { "*order": "-DM" }),
            requestRows("jshkcb/dqxnxq", "当前学期", {}, true)
        ]);
        const choices = terms.filter(term => text(term?.DM)).slice(0, 10);
        if (!choices.length) throw new Error("教务系统未返回可选学期。");
        if (choices.length === 1) return choices[0];

        const names = choices.map(term => text(term.MC) || text(term.DM));
        const currentCode = text(current?.[0]?.DM);
        const selected = await bridge.showSingleSelection(
            "选择学期",
            JSON.stringify(names),
            Math.max(0, choices.findIndex(term => text(term.DM) === currentCode))
        );
        return Number.isInteger(selected) ? choices[selected] ?? null : null;
    }

    async function readCalendar(term) {
        const parts = text(term.DM).match(/^(\d{4}-\d{4})-(\d+)$/);
        const year = text(term.XNDM) || parts?.[1];
        const semester = text(term.XQDM) || parts?.[2];
        if (!year || !semester) return term;

        const query = { XN: year, XQ: semester };
        const rows = await requestRows("jshkcb/cxjcs", "校历", query, true);
        return { ...term, ...rows?.[0] };
    }

    function firstMonday(value) {
        const day = text(value).match(/^\d{4}-\d{2}-\d{2}(?=$|[ T])/)?.[0];
        if (!day) return null;
        const date = new Date(`${day}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
        return date.toISOString().slice(0, 10);
    }

    function clock(value) {
        const match = text(value).replace(/^(\d{1,2})(\d{2})$/, "$1:$2")
            .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
        return `${match[1].padStart(2, "0")}:${match[2]}`;
    }

    function readTimeSlots(rows) {
        const byNumber = new Map();
        for (const row of rows ?? []) {
            const number = Number(row?.DM);
            const startTime = clock(row?.KSSJ);
            const endTime = clock(row?.JSSJ);
            if (!Number.isInteger(number) || number < 1 || !startTime || !endTime || startTime >= endTime) continue;

            const existing = byNumber.get(number);
            if (existing && (existing.startTime !== startTime || existing.endTime !== endTime)) return [];
            byNumber.set(number, { number, startTime, endTime });
        }

        const slots = [...byNumber.values()].sort((a, b) => a.number - b.number);
        return slots.every((slot, index) => slot.number === index + 1 &&
            (index === 0 || slots[index - 1].endTime <= slot.startTime)) ? slots : [];
    }

    function readWeeks(value) {
        const mask = text(value);
        if (!/^[01]+$/.test(mask) || mask.length > maxWeeks) {
            throw new Error("网页教务返回的课程周次位图格式无效。");
        }
        return Array.from(mask, (bit, index) => bit === "1" ? index + 1 : 0).filter(Boolean);
    }

    function teacherName(value) {
        return text(value).split(/[,，、;；]/).map(teacher => teacher.split("/")[0].trim())
            .filter(Boolean).join("、");
    }

    function readCourse(row) {
        const day = Number(row?.SKXQ);
        const startSection = Number(row?.KSJC);
        const endSection = Number(row?.JSJC);
        if (!day && !startSection && !endSection) return null;

        const name = [text(row?.KCM), text(row?.SYXMMC)].filter(Boolean).join(" - ");
        if (!name || !Number.isInteger(day) || day < 1 || day > 7 ||
            !Number.isInteger(startSection) || !Number.isInteger(endSection) ||
            startSection < 1 || endSection < startSection) {
            throw new Error("网页教务返回了缺少课程名称或节次的排课记录。");
        }

        const weeks = readWeeks(row.SKZC);
        if (!weeks.length) return null;
        return {
            sourceId: text(row.KBID),
            name,
            teacher: teacherName(row.SKJS) || text(row.JSM),
            position: text(row.JASMC),
            day,
            startSection,
            endSection,
            weeks,
            startTime: clock(row.KSSJ),
            endTime: clock(row.JSSJ)
        };
    }

    function applyChanges(courses, rows) {
        // 接口按申请时间倒序返回，先应用较早的变更。
        for (const row of [...rows].reverse()) {
            const id = text(row?.KBID);
            const type = text(row?.TKLXDM);
            if (!id || !["01", "02", "03"].includes(type)) continue;

            const affected = courses.filter(course => course.sourceId === id &&
                course.day === Number(row.SKXQ) &&
                course.startSection === Number(row.KSJC) && course.endSection === Number(row.JSJC));
            if (!affected.length) continue;
            const oldWeeks = new Set(readWeeks(row.SKZC));
            const original = affected.find(course => course.weeks.some(week => oldWeeks.has(week)));
            if (!original) continue;

            if (type !== "02") {
                const replacement = readCourse({
                    KBID: id,
                    KCM: original.name,
                    SKJS: text(row.XSKJS) || text(row.YSKJS) || original.teacher,
                    JASMC: text(row.XJASMC) || text(row.JASMC) || original.position,
                    SKXQ: row.XSKXQ,
                    KSJC: row.XKSJC,
                    JSJC: row.XJSJC,
                    SKZC: row.XSKZC,
                    KSSJ: row.XKSSJ,
                    JSSJ: row.XJSSJ
                });
                if (!replacement) throw new Error("网页教务返回的调课记录缺少新课位。");
                courses.push(replacement);
            }
            for (const course of affected) {
                course.weeks = course.weeks.filter(week => !oldWeeks.has(week));
            }
        }
    }

    function mergeAdjacentSections(courses) {
        const groups = new Map();
        const result = [];
        for (const course of courses) {
            if (course.isCustomTime) {
                result.push(course);
                continue;
            }
            const key = JSON.stringify([course.name, course.teacher, course.position, course.day, course.weeks]);
            if (!groups.has(key)) groups.set(key, new Map());
            groups.get(key).set(JSON.stringify([course.startSection, course.endSection]), course);
        }

        for (const group of groups.values()) {
            const ordered = [...group.values()].sort((a, b) =>
                a.startSection - b.startSection || a.endSection - b.endSection);
            let previous;
            for (const course of ordered) {
                if (previous && previous.endSection + 1 === course.startSection) {
                    previous.endSection = course.endSection;
                } else {
                    previous = { ...course };
                    result.push(previous);
                }
            }
        }
        return result;
    }

    function exportCourses(courses, timeSlots) {
        const scheduled = [];
        for (const { sourceId, weeks, startTime, endTime, ...course } of courses) {
            if (!weeks.length) continue;
            const slotStart = timeSlots[course.startSection - 1]?.startTime;
            const slotEnd = timeSlots[course.endSection - 1]?.endTime;
            if (startTime && endTime && startTime < endTime && (startTime !== slotStart || endTime !== slotEnd)) {
                course.isCustomTime = true;
                course.customStartTime = startTime;
                course.customEndTime = endTime;
            }
            scheduled.push({ ...course, weeks });
        }

        const merged = new Map();
        for (const { weeks, ...course } of mergeAdjacentSections(scheduled)) {
            const key = JSON.stringify(course);
            if (!merged.has(key)) merged.set(key, { course, weeks: new Set() });
            for (const week of weeks) merged.get(key).weeks.add(week);
        }
        return [...merged.values()]
            .map(({ course, weeks }) => ({ ...course, weeks: [...weeks].sort((a, b) => a - b) }))
            .sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name, "zh-CN"));
    }

    let saving = false;
    try {
        const term = await chooseTerm();
        if (!term) return;
        native.showToast("正在读取曲靖师范学院网页课表…");

        const query = { XNXQDM: text(term.DM) };
        const [regular, experiments, changes, timeRows, calendar] = await Promise.all([
            requestRows("xskcb/cxxszhxqkb", "整学期课表", query),
            requestRows("syjxkcb/cxsyjxxskb", "实验课", query, true),
            requestRows("xskcb/xsdkkc", "调课记录", { ...query, "*order": "-SQSJ" }, true),
            requestRows("jshkcb/jc", "节次时间", {}, true),
            readCalendar(term)
        ]);

        const rawCourses = [...regular, ...(experiments ?? [])].map(readCourse).filter(Boolean);
        applyChanges(rawCourses, changes ?? []);
        const onlineTimeSlots = readTimeSlots(timeRows);
        const timeSlots = onlineTimeSlots.length ? onlineTimeSlots : defaultTimeSlots;
        const courses = exportCourses(rawCourses, timeSlots);
        if (!courses.length) throw new Error("所选学期没有可导入的排课记录。");

        const lastWeek = Math.max(...courses.map(course => course.weeks[course.weeks.length - 1]));
        const calendarWeeks = Number(calendar?.ZZC || calendar?.ZJXZC);
        const validCalendarWeeks = Number.isInteger(calendarWeeks) && calendarWeeks >= 1 && calendarWeeks <= maxWeeks;
        const startDate = firstMonday(calendar?.XQKSRQ);
        const config = {
            firstDayOfWeek: 1,
            semesterTotalWeeks: Math.max(validCalendarWeeks ? calendarWeeks : 20, lastWeek),
            ...(startDate ? { semesterStartDate: startDate } : {})
        };

        const missing = [];
        if (!experiments) missing.push("实验课");
        if (!changes) missing.push("调课记录");
        if (courses.some(course => !course.isCustomTime && course.endSection > timeSlots.length)) missing.push("部分节次钟点");
        if (!startDate) missing.push("开学日期");
        if (!validCalendarWeeks) missing.push("校历总周数");
        if (missing.length && !await bridge.showAlert(
            "部分教务信息未取得", `已读取 ${courses.length} 条排课记录。\n待核对：${missing.join("、")}。`, "导入"
        )) return;

        saving = true;
        if (await bridge.savePresetTimeSlots(JSON.stringify(timeSlots)) !== true ||
            await bridge.saveCourseConfig(JSON.stringify(config)) !== true ||
            await bridge.saveImportedCourses(JSON.stringify(courses)) !== true) {
            throw new Error("课表数据保存失败。");
        }
        const timeSlotsNote = onlineTimeSlots.length ? "" : "（采用教务处公布的默认作息）";
        native.showToast(`已导入曲靖师范学院课表，共 ${courses.length} 条排课记录${timeSlotsNote}。`);
        native.notifyTaskCompletion();
    } catch (error) {
        const message = error instanceof Error ? error.message : text(error) || "课表导入失败。";
        const detail = saving ? "\n目标课表可能已部分更新，请重新导入。" : "";
        await bridge.showAlert("导入失败", `${message}${detail}`, "确定");
    } finally {
        delete window.__qjnuWebImportRunning;
    }
})();
