// 淮南师范学院 (xxmh.hnnu.edu.cn) 库表图融合门户 拾光课程表适配脚本

// ==================== 工具函数 ====================

// 解析周次字符串 -> 数字数组
function parseWeeks(weekStr) {
    const weeks = new Set();
    if (!weekStr) return [];
    const parts = weekStr.split(",");
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === "") continue;
        if (trimmed.includes("-")) {
            const [start, end] = trimmed.split("-").map(n => parseInt(n));
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    weeks.add(i);
                }
            }
        } else {
            const n = parseInt(trimmed);
            if (!isNaN(n) && n >= 1 && n <= 30) {
                weeks.add(n);
            }
        }
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

// 检查是否已登录
function isUserLoggedIn() {
    const token = localStorage.getItem("token");
    return token !== null && token !== "";
}

// 合并课程（相同课程合并周次）
function mergeCourses(allCourses) {
    const merged = {};
    for (const course of allCourses) {
        const key = `${course.day}-${course.startSection}-${course.name}`;
        if (merged[key]) {
            merged[key].weeks = Array.from(new Set([...merged[key].weeks, ...course.weeks])).sort((a, b) => a - b);
        } else {
            merged[key] = { ...course, weeks: [...course.weeks] };
        }
    }
    return Object.values(merged);
}

// ==================== 预设时间段 ====================

const presetTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:25", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:05" }
];

async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

// ==================== 主流程 ====================

async function runImportFlow() {
    try {
        // 1. 检查是否已登录
        if (!isUserLoggedIn()) {
            window.shiguangBridge.showToast("请先登录教务系统后再导入课程！");
            return;
        }

        // 2. 获取当前学期信息
        window.shiguangBridge.showToast("正在获取学期信息...");
        const nowTermRes = await fetch("/zhxyApi/term/rhptTerm/get/nowTerm", {
            method: "GET",
            headers: {
                "X-Access-Token": localStorage.getItem("token")
            }
        });
        const nowTermData = await nowTermRes.json();

        if (!nowTermData.success || !nowTermData.result) {
            window.shiguangBridge.showToast("获取学期信息失败，请重试！");
            return;
        }

        const { schoolYearKey, nowDate } = nowTermData.result;

        // 3. 让用户选择学期（因为API不返回termCode）
        const semesterOptions = ["第一学期 (autumn)", "第二学期 (spring)"];
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesterOptions),
            0
        );

        if (semesterIndex === null || semesterIndex === undefined) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }

        const termCode = semesterIndex === 0 ? "autumn" : "spring";

        // 4. 遍历所有周次（1-20周）获取课表
        window.shiguangBridge.showToast("正在遍历获取所有周次课表...");
        const allCourses = [];
        const totalWeeks = 20;

        for (let week = 1; week <= totalWeeks; week++) {
            try {
                const scheduleUrl = `/zhxyApi/workhall/api/weeklySchedule?_t=${Date.now()}&schoolYear=${schoolYearKey}&termCode=${termCode}&count=${week}`;
                const scheduleRes = await fetch(scheduleUrl, {
                    method: "GET",
                    headers: {
                        "X-Access-Token": localStorage.getItem("token")
                    }
                });
                const scheduleData = await scheduleRes.json();

                if (scheduleData.success && Array.isArray(scheduleData.result)) {
                    for (const item of scheduleData.result) {
                        const day = parseInt(item.WEEK);
                        if (isNaN(day) || day < 1 || day > 7) continue;

                        const startSection = parseInt(item.SESSION);
                        if (isNaN(startSection) || startSection < 1) continue;

                        const continuedSession = parseInt(item.continuedSession) || 1;
                        const endSection = startSection + continuedSession - 1;

                        const weeks = parseWeeks(item.count);
                        if (weeks.length === 0) continue;

                        allCourses.push({
                            name: item.courseName || "",
                            teacher: item.teacherName || "",
                            position: item.address || "",
                            day: day,
                            startSection: startSection,
                            endSection: endSection,
                            weeks: weeks
                        });
                    }
                }
            } catch (e) {
                console.warn(`第${week}周获取失败:`, e);
            }
        }

        // 5. 合并课程
        const mergedCourses = mergeCourses(allCourses);

        if (mergedCourses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据！");
            return;
        }

        // 6. 按星期和节次排序
        mergedCourses.sort((a, b) => a.day - b.day || a.startSection - b.startSection);

        // 7. 保存课程
        window.shiguangBridge.showToast(`共解析到${mergedCourses.length}门课程，正在导入...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(mergedCourses));

        await importPresetTimeSlots();

        window.shiguangBridge.showToast(`课程导入成功！共${mergedCourses.length}门课程`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("导入失败:", error);
        window.shiguangBridge.showToast("导入失败：" + error.message);
    }
}

// 启动
runImportFlow();