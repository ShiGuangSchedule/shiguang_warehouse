// 福建师范大学研究生教务系统（gedu.fjnu.edu.cn）拾光课程表适配。
// 读取当前学期课表 DOM，不读取账号、密码、Cookie 或浏览器存储。
(function () {
    "use strict";

    // 福建师范大学作息时间，由本校使用者核对提供；每节课 45 分钟。
    const presetTimeSlots = [
        { number: 1, startTime: "08:20", endTime: "09:05" },
        { number: 2, startTime: "09:15", endTime: "10:00" },
        { number: 3, startTime: "10:20", endTime: "11:05" },
        { number: 4, startTime: "11:15", endTime: "12:00" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "15:50", endTime: "16:35" },
        { number: 8, startTime: "16:45", endTime: "17:30" },
        { number: 9, startTime: "18:30", endTime: "19:15" },
        { number: 10, startTime: "19:25", endTime: "20:10" },
        { number: 11, startTime: "20:20", endTime: "21:05" },
        { number: 12, startTime: "21:15", endTime: "22:00" }
    ];

    function text(element) {
        return (element ? element.textContent : "").replace(/\u00a0/g, " ").trim();
    }

    function parseWeeks(value, parity) {
        const normalized = value.replace(/第|周|\s/g, "")
            .replace(/[，、；;]/g, ",").replace(/[－—–~～至]/g, "-");
        const mode = parity.replace(/\s/g, "");
        if (!["全部", "单", "双", "单周", "双周"].includes(mode)) {
            throw new Error("无法识别单双周：" + parity);
        }
        const weeks = new Set();
        for (const part of normalized.split(",")) {
            const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
            if (!match) throw new Error("无法识别起始周：" + value);
            const start = Number(match[1]);
            const end = Number(match[2] || match[1]);
            if (start < 1 || end > 53 || end < start) {
                throw new Error("起始周超出有效范围：" + value);
            }
            for (let week = start; week <= end; week++) {
                if (mode.startsWith("单") && week % 2 === 0) continue;
                if (mode.startsWith("双") && week % 2 !== 0) continue;
                weeks.add(week);
            }
        }
        if (weeks.size === 0) throw new Error("起始周与单双周设置没有对应的上课周次。");
        return Array.from(weeks).sort((a, b) => a - b);
    }

    function readFields(block) {
        const fields = {};
        const details = block.querySelector("table");
        if (!details) throw new Error("课程详情结构已变化，请更新适配脚本。");
        for (const row of Array.from(details.rows)) {
            if (row.cells.length !== 2) throw new Error("课程详情字段结构异常。");
            const key = text(row.cells[0]).replace(/[\s：:]/g, "");
            if (Object.prototype.hasOwnProperty.call(fields, key)) {
                throw new Error("课程详情出现重复字段：" + key);
            }
            fields[key] = text(row.cells[1]);
        }
        for (const key of ["课程", "校区", "教室", "起始周", "单双周", "教师"]) {
            if (!Object.prototype.hasOwnProperty.call(fields, key)) {
                throw new Error("课程详情缺少字段：" + key);
            }
        }
        if (!fields["课程"]) throw new Error("课表中存在未命名课程。");
        return fields;
    }

    function parseTable(table) {
        const rows = Array.from(table.rows);
        const header = rows.shift();
        const weekdays = header ? Array.from(header.cells).slice(1).map(text) : [];
        if (weekdays.join(",") !== "周一,周二,周三,周四,周五,周六,周日,自定") {
            throw new Error("课表星期表头已变化，无法安全确定课程位置。");
        }
        const courses = [];
        const sections = rows.map(row => {
            const label = Array.from(row.cells).find(cell => /^第\d+节$/.test(text(cell)));
            return label ? Number(text(label).match(/\d+/)[0]) : null;
        });
        if (sections.filter(n => n !== null).join(",") !== "1,2,3,4,5,6,7,8,9,10,11,12") {
            throw new Error("课表节次结构已变化，请更新适配脚本。");
        }
        const occupied = Array.from({ length: 8 }, () => new Set());
        let blockCount = 0;
        rows.forEach((row, rowIndex) => {
            // 学校保留 rowspan 覆盖的 displaynone 占位格。不能过滤后再按列下标计算星期。
            const cells = Array.from(row.cells).filter(cell => cell.classList.contains("cellStyle"));
            if (cells.length !== 8) throw new Error("课表列数异常，请等待课表加载完成后重试。");
            cells.forEach((cell, dayIndex) => {
                const blocks = Array.from(cell.querySelectorAll(".tddiv"));
                blockCount += blocks.length;
                if (cell.classList.contains("displaynone")) {
                    if (blocks.length || !occupied[dayIndex].has(rowIndex)) {
                        throw new Error("课表隐藏单元格与连续节次不一致，请重新查询课表。");
                    }
                    return;
                }
                if (occupied[dayIndex].has(rowIndex)) throw new Error("课表连续节次重叠，无法确定排课位置。");
                if (!blocks.length) {
                    if (text(cell)) throw new Error("存在无法识别的课程内容，请更新适配脚本。");
                    return;
                }
                if (dayIndex === 7 || sections[rowIndex] === null) {
                    throw new Error("课表含自定时间课程，尚无明确星期或节次。请先确认排课后再导入，避免遗漏课程。");
                }
                const span = Number(cell.getAttribute("rowspan") || "1");
                if (!Number.isInteger(span) || span < 1 || rowIndex + span > sections.length ||
                    sections[rowIndex + span - 1] !== sections[rowIndex] + span - 1) {
                    throw new Error("课程连续节次无效。");
                }
                for (let offset = 1; offset < span; offset++) occupied[dayIndex].add(rowIndex + offset);
                for (const block of blocks) {
                    const fields = readFields(block);
                    courses.push({
                        name: fields["课程"],
                        teacher: fields["教师"],
                        position: [fields["校区"], fields["教室"]].filter(Boolean).join(" "),
                        day: dayIndex + 1,
                        startSection: sections[rowIndex],
                        endSection: sections[rowIndex] + span - 1,
                        weeks: parseWeeks(fields["起始周"], fields["单双周"])
                    });
                }
            });
        });
        if (blockCount !== table.querySelectorAll(".tddiv").length) {
            throw new Error("存在未能解析的课程块，已停止导入。");
        }
        if (!courses.length) throw new Error("当前学期课表为空，请选择有课程的学期并等待加载完成。");
        const merged = new Map();
        for (const course of courses) {
            const key = JSON.stringify([course.name, course.teacher, course.position,
                course.day, course.startSection, course.endSection]);
            if (merged.has(key)) {
                const previous = merged.get(key);
                previous.weeks = Array.from(new Set(previous.weeks.concat(course.weeks))).sort((a, b) => a - b);
            } else merged.set(key, course);
        }
        return Array.from(merged.values());
    }

    async function runImportFlow() {
        const bridge = window.shiguangBridgePromise;
        if (window.location.origin !== "https://gedu.fjnu.edu.cn" ||
            !/^#\/timeTable(?:[/?]|$)/.test(window.location.hash) ||
            window.location.pathname !== "/index") {
            throw new Error("请先登录福建师范大学研究生教务系统，进入“课程表”并选择目标学期，再执行导入。");
        }
        const table = document.querySelector("table#table1.timeTable");
        if (!table || document.querySelector(".el-loading-mask:not([style*='display: none'])")) {
            throw new Error("课表尚未加载完成，请稍后重试。");
        }
        const semester = document.querySelector('input[placeholder="学期"]');
        if (!semester || !semester.value.trim()) throw new Error("未识别到当前学期，请重新查询课表。");
        const snapshot = table.outerHTML;
        const semesterName = semester.value;
        const courses = parseTable(table);
        const lastWeek = Math.max(...courses.flatMap(course => course.weeks));
        const confirmed = await bridge.showAlert("福建师范大学研究生课表",
            "当前学期：" + semesterName + "\n识别到 " + courses.length +
            " 条课程安排，最晚上课周为第 " + lastWeek + " 周。将替换所选课表中的课程。" +
            "\n\n同时导入学校作息时间，共 12 节（08:20—22:00），替换所选课表的节次时间。" +
            "本页不提供第1周日期，导入后请在课表设置中核对学期开始日期和总周数。", "确认并导入");
        if (!confirmed) return;
        if (table.outerHTML !== snapshot || semester.value !== semesterName || !table.isConnected) {
            throw new Error("导入期间课表发生变化，请等待加载完成后重新导入。");
        }
        // saveCourseConfig 会重置未提供的日期/时长字段，因此保留用户手动设置的配置。
        await bridge.saveImportedCourses(JSON.stringify(courses));
        try {
            await bridge.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        } catch (error) {
            throw new Error("课程已保存，但作息时间导入失败，请重新执行导入：" + error.message);
        }
        window.shiguangBridge.showToast("福建师范大学研究生课表导入成功。");
        window.shiguangBridge.notifyTaskCompletion();
    }

    runImportFlow().catch(async function (error) {
        if (window.shiguangBridgePromise) {
            await window.shiguangBridgePromise.showAlert("导入未完成", error.message, "知道了");
        } else if (window.shiguangBridge) {
            window.shiguangBridge.showToast("请在拾光课程表内执行适配脚本。");
        }
    });
})();
