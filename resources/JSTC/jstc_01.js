// 江苏旅游职业学院（jstc.edu.cn） 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速



// 不确定是否还有效的数据 仅保留代码内部不做调用
const presetTimeSlots_oldFunction = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:55", endTime: "16:40" },
    { number: 9, startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "19:00", endTime: "19:45" },
    { number: 11, startTime: "19:50", endTime: "20:35" }
];




const presetTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:40" },
    { number: 2, startTime: "08:50", endTime: "09:30" },
    { number: 3, startTime: "09:50", endTime: "10:30" },
    { number: 4, startTime: "10:40", endTime: "11:20" },
    { number: 5, startTime: "11:30", endTime: "12:10" },
    { number: 6, startTime: "14:00", endTime: "14:40" },
    { number: 7, startTime: "14:50", endTime: "15:30" },
    { number: 8, startTime: "15:50", endTime: "16:30" },
    { number: 9, startTime: "16:40", endTime: "17:20" },
    { number: 10, startTime: "19:00", endTime: "19:40" },
    { number: 11, startTime: "19:50", endTime: "20:30" }
];


/**
 * 获取学期下拉列表选项
 */
async function fetchSemesters() {
    try {
        const res = await fetch("https://jwxt.jstc.edu.cn/student/for-std/course-table", {
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
            value: opt.value.trim()
        }));

        return options;
    } catch (e) {
        console.error("Fetch semesters failed:", e);
        return null;
    }
}

/**
 * 获取学期开学时间元数据
 */
async function fetchSemesterMetadata(semesterId) {
    try {
        const res = await fetch(`https://jwxt.jstc.edu.cn/student/ws/semester/get/${semesterId}`, {
            headers: {
                "accept": "*/*",
                "x-requested-with": "XMLHttpRequest"
            },
            method: "GET",
            credentials: "include"
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.startDate || null;
    } catch (e) {
        console.error("Fetch semester metadata failed:", e);
        return null;
    }
}

/**
 * 获取并解析课表原数据
 */
async function fetchAndParseCourses(semesterId) {
    try {
        const url = `https://jwxt.jstc.edu.cn/student/for-std/course-table/semester/${semesterId}/print-data?semesterId=${semesterId}&hasExperiment=true`;
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
        
        if (!data || !Array.isArray(data.studentTableVms) || data.studentTableVms.length === 0) {
            return null;
        }

        const rawActivities = data.studentTableVms[0].activities || [];
        const parsedCourses = [];

        for (const act of rawActivities) {
            if (!act.courseName || !act.weekday || !act.startUnit || !act.endUnit || !Array.isArray(act.weekIndexes)) {
                continue;
            }

            const teacherName = Array.isArray(act.teachers) && act.teachers.length > 0
                ? act.teachers.map(t => t.replace(/\(\d+\)/g, '')).join(',')
                : '';

            parsedCourses.push({
                name: act.courseName.trim(),
                teacher: teacherName.trim(),
                position: (act.room || '').trim(),
                day: Number(act.weekday),
                startSection: Number(act.startUnit),
                endSection: Number(act.endUnit),
                weeks: act.weekIndexes.map(Number).sort((a, b) => a - b)
            });
        }

        return parsedCourses;
    } catch (e) {
        console.error("Fetch course data failed:", e);
        return null;
    }
}

/**
 * 流程控制
 */
async function runImportFlow() {
    window.shiguangBridge.showToast("开始拉取学期列表...");

    // 获取学期列表
    const semesters = await fetchSemesters();
    if (!semesters || semesters.length === 0) {
        window.shiguangBridge.showToast("获取学期列表失败，请检查登录状态或网络");
        return;
    }

    const labels = semesters.map(s => s.label);
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(labels),
        -1
    );

    if (selectedIndex === null || selectedIndex < 0) {
        window.shiguangBridge.showToast("操作已取消");
        return;
    }

    const selectedSemester = semesters[selectedIndex];

    // 并行获取元数据与课程表
    window.shiguangBridge.showToast("正在拉取课表数据...");
    const [startDate, courses] = await Promise.all([
        fetchSemesterMetadata(selectedSemester.value),
        fetchAndParseCourses(selectedSemester.value)
    ]);

    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未查询到有效课程数据");
        return;
    }

    // 保存学期配置
    const configData = {
        semesterStartDate: startDate,
        semesterTotalWeeks: 20
    };

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
    } catch (e) {
        window.shiguangBridge.showToast("配置保存异常: " + e.message);
        return;
    }

    // 保存课程列表
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
        window.shiguangBridge.showToast("课程保存异常: " + e.message);
        return;
    }

    // 保存预设作息时间
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
    } catch (e) {
        window.shiguangBridge.showToast("作息时间保存异常: " + e.message);
    }

    window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程及作息时间！`);

    // 任务完成通知
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();