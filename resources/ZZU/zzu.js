// 郑州大学 拾光课程表适配脚本
// 适配系统：树维新一代智慧教务系统（jwxt.zzu.edu.cn）

(async function () {
    // 郑州大学标准 12 节作息时间（第 1-4 节上午，第 5-8 节下午，第 9-12 节晚上）
    const presetTimeSlots = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:10", endTime: "10:55" },
        { number: 4, startTime: "11:05", endTime: "11:50" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "16:00", endTime: "16:45" },
        { number: 8, startTime: "16:55", endTime: "17:40" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" },
        { number: 11, startTime: "20:50", endTime: "21:35" },
        { number: 12, startTime: "21:40", endTime: "22:25" }
    ];

    function showToast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        }
    }

    /**
     * 获取学期下拉列表
     */
    async function fetchSemesters() {
        try {
            const res = await fetch("/student/for-std/course-table", {
                headers: {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "x-requested-with": "XMLHttpRequest"
                },
                method: "GET",
                credentials: "include"
            });
            if (!res.ok) return null;

            const htmlText = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");
            const select = doc.getElementById("allSemesters");
            if (!select) return null;

            const options = Array.from(select.querySelectorAll("option")).map(opt => ({
                label: opt.textContent.trim(),
                value: opt.value.trim(),
                selected: opt.hasAttribute("selected") || opt.selected
            })).filter(o => o.value && o.label);

            return options;
        } catch (e) {
            return null;
        }
    }

    /**
     * 获取学期开学日期与结束日期
     */
    async function fetchSemesterMetadata(semesterId) {
        try {
            const res = await fetch(`/student/ws/semester/get/${semesterId}`, {
                headers: {
                    "accept": "*/*",
                    "x-requested-with": "XMLHttpRequest"
                },
                method: "GET",
                credentials: "include"
            });
            if (!res.ok) return null;
            const data = await res.json();
            return {
                startDate: data.startDate || null,
                endDate: data.endDate || null
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * 获取并解析课程表数据
     */
    async function fetchAndParseCourses(semesterId) {
        try {
            const url = `/student/for-std/course-table/semester/${semesterId}/print-data?semesterId=${semesterId}&hasExperiment=true`;
            const res = await fetch(url, {
                headers: {
                    "accept": "*/*",
                    "x-requested-with": "XMLHttpRequest"
                },
                method: "GET",
                credentials: "include"
            });

            if (!res.ok) return null;
            const data = await res.json();
            if (!data) return null;

            const rawActivities = (data.studentTableVms && data.studentTableVms[0] ? data.studentTableVms[0].activities : (data.studentTableVm ? data.studentTableVm.activities : (data.activities || []))) || [];
            if (!Array.isArray(rawActivities) || rawActivities.length === 0) return null;

            const parsedCourses = [];
            for (const act of rawActivities) {
                if (!act.courseName || !act.weekday || !act.startUnit || !act.endUnit || !Array.isArray(act.weekIndexes)) {
                    continue;
                }

                const teacherName = Array.isArray(act.teachers) && act.teachers.length > 0
                    ? act.teachers.map(t => String(t).replace(/\(\d+\)/g, "").replace(/\[\d+\]/g, "").trim()).filter(Boolean).join(",")
                    : (typeof act.teachers === "string" ? act.teachers.replace(/\(\d+\)/g, "").trim() : "");

                const weeks = act.weekIndexes.map(Number).filter(w => Number.isInteger(w) && w > 0).sort((a, b) => a - b);
                if (weeks.length === 0) continue;

                const startSection = Number(act.startUnit);
                const endSection = Number(act.endUnit);
                const sections = [];
                for (let s = startSection; s <= endSection; s++) sections.push(s);

                parsedCourses.push({
                    name: String(act.courseName).trim(),
                    teacher: teacherName,
                    position: String(act.room || act.building || "未知地点").trim(),
                    day: Number(act.weekday),
                    startSection: startSection,
                    endSection: endSection,
                    sections: sections,
                    weeks: weeks
                });
            }

            return parsedCourses.length > 0 ? parsedCourses : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * 计算学期总周数
     */
    function calculateTotalWeeks(startDate, endDate) {
        if (!startDate || !endDate) return 20;
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffMs = end.getTime() - start.getTime();
        if (diffMs <= 0) return 20;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return Math.min(Math.max(Math.ceil(diffDays / 7), 16), 30);
    }

    /**
     * 流程主入口
     */
    async function runImportFlow() {
        showToast("正在拉取学期列表...");

        const semesters = await fetchSemesters();
        if (!semesters || semesters.length === 0) {
            showToast("获取学期列表失败，请确认已进入教务课表页面");
            return;
        }

        const labels = semesters.map(s => s.label);
        let defaultIndex = semesters.findIndex(s => s.selected);
        if (defaultIndex < 0) defaultIndex = 0;

        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(labels),
            defaultIndex
        );

        if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= semesters.length) {
            showToast("操作已取消");
            return;
        }

        const selectedSemester = semesters[selectedIndex];
        showToast("正在拉取课表数据...");

        const [meta, courses] = await Promise.all([
            fetchSemesterMetadata(selectedSemester.value),
            fetchAndParseCourses(selectedSemester.value)
        ]);

        if (!courses || courses.length === 0) {
            showToast("未查询到有效课程数据");
            return;
        }

        let totalWeeks = 20;
        if (meta && meta.startDate && meta.endDate) {
            totalWeeks = calculateTotalWeeks(meta.startDate, meta.endDate);
        } else {
            const allWeeks = courses.flatMap(c => c.weeks || []);
            if (allWeeks.length > 0) totalWeeks = Math.max(...allWeeks);
        }

        const configData = {
            semesterStartDate: meta && meta.startDate ? meta.startDate : "",
            semesterTotalWeeks: Math.max(totalWeeks, 18),
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        }

        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            const saveOk = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
            if (!saveOk) {
                showToast("课程保存失败");
                return;
            }
        }

        showToast(`成功导入 ${courses.length} 门课程及作息时间！`);
        if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }

    runImportFlow();
})();
