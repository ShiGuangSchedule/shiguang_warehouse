// 文件: gdit.js
// 广东科学技术职业学院 课程表导入适配脚本

if (typeof Strings === 'undefined') {
    var Strings = {
        BASE_URL: "https://wbdt.gdit.edu.cn",
        GET_STUDENT_SCHEDULE_URL: "front/extraCard/queryStudentSchedule"
    };
}

async function stepDescriptionAlert() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示",
            "即将执行导入课程操作。请确保你已处于登录状态，并已打开课程表页面。",
            "确认"
        );
        return confirmed;
    } catch (error) {
        console.error("显示弹窗时发生错误:", error);
        return false;
    }
}

async function selectSemesterSelection() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentSemester = currentMonth >= 9 || currentMonth <= 2 ? 1 : 2;

    const presetSemesters = [];
    const presetSemestersName = [];

    for (let year = currentYear; year >= currentYear - 3; year--) {
        for (let semester = (year === currentYear ? currentSemester : 2); semester >= 1; semester--) {
            const semesterName = `${year}-${year + 1}学年 第${semester}学期`;
            presetSemesters.push({
                name: semesterName,
                schoolYear: `${year}-${year + 1}`,
                semester: String(semester)
            });
            presetSemestersName.push(semesterName);
        }
    }

    try {
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择要导入的学期",
            JSON.stringify(presetSemestersName),
            0
        );

        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < presetSemesters.length) {
            const selected = presetSemesters[selectedIndex];
            console.log("用户选择了: " + selected.name);
            return selected;
        } else {
            console.log("用户取消了选择。");
            return null;
        }
    } catch (error) {
        console.error("显示单选列表弹窗时发生错误:", error);
        window.shiguangBridge.showToast("显示列表出错！" + error.message);
        return null;
    }
}

async function fetchCourses(schoolYear, semester) {
    try {
        console.log(`正在获取 ${schoolYear} 第${semester}学期 的课程数据...`);

        const timestamp = Date.now();
        const url = `${Strings.BASE_URL}/${Strings.GET_STUDENT_SCHEDULE_URL}?_t=${timestamp}&semester=${semester}&schoolYear=${schoolYear}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        const result = await response.json();
        console.log("API 返回数据:", result);

        if (!result.meta || !result.meta.success) {
            throw new Error(result.meta ? result.meta.message : "请求失败");
        }

        if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
            throw new Error("该学期没有课程数据");
        }

        const courses = parseCourses(result.data);
        return courses;
    } catch (error) {
        console.error('获取课程数据失败:', error);
        window.shiguangBridge.showToast("获取课程失败: " + error.message);
        return null;
    }
}

function parseCourses(rawCourses) {
    console.log(`正在解析课程数据，共 ${rawCourses.length} 条原始记录...`);

    const courses = [];

    for (const raw of rawCourses) {
        try {
            const name = raw.courseName || "";
            const teacher = raw.userName || "";
            const position = raw.placeName || "";

            const day = Number(raw.weekDay);
            if (isNaN(day) || day < 1 || day > 7) continue;

            const sectionStr = raw.festivals || "";
            const sectionMatch = sectionStr.match(/(\d+)-(\d+)/);
            if (!sectionMatch) continue;
            const startSection = Number(sectionMatch[1]);
            const endSection = Number(sectionMatch[2]);

            const startWeek = Number(raw.startWeek);
            const endWeek = Number(raw.endWeek);
            if (isNaN(startWeek) || isNaN(endWeek)) continue;

            const singleDoubleWeek = raw.singleDoubleWeek || "0";
            const weeks = [];
            for (let w = startWeek; w <= endWeek; w++) {
                if (singleDoubleWeek === "1" && w % 2 === 0) continue;
                if (singleDoubleWeek === "2" && w % 2 !== 0) continue;
                weeks.push(w);
            }

            if (name && weeks.length > 0) {
                courses.push({
                    name: name.trim(),
                    teacher: teacher.trim(),
                    position: position.trim(),
                    day: day,
                    startSection: startSection,
                    endSection: endSection,
                    weeks: weeks,
                    isCustomTime: false
                });
            }
        } catch (e) {
            console.warn("解析单条课程数据失败:", e, raw);
        }
    }

    console.log(`成功解析 ${courses.length} 门课程`);
    return courses;
}

async function saveCourses(courses) {
    try {
        console.log("正在尝试导入课程...");
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result === true) {
            console.log("课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            window.shiguangBridge.showToast("课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
    }
}

async function setPresetTimeSlots() {
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:10", "endTime": "08:55" },
        { "number": 2, "startTime": "09:05", "endTime": "09:50" },
        { "number": 3, "startTime": "10:10", "endTime": "10:55" },
        { "number": 4, "startTime": "11:05", "endTime": "11:50" },
        { "number": 5, "startTime": "14:30", "endTime": "15:15" },
        { "number": 6, "startTime": "15:25", "endTime": "16:10" },
        { "number": 7, "startTime": "16:30", "endTime": "17:15" },
        { "number": 8, "startTime": "17:25", "endTime": "18:10" },
        { "number": 9, "startTime": "19:10", "endTime": "19:55" },
        { "number": 10, "startTime": "20:05", "endTime": "20:50" },
        { "number": 11, "startTime": "21:00", "endTime": "21:45" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
    }
}

async function runImportFlow() {
    const confirmed = await stepDescriptionAlert();
    if (!confirmed) {
        console.log("用户取消了操作。");
        return;
    }

    const semester = await selectSemesterSelection();
    if (!semester) {
        console.log("用户取消了学期选择。");
        return;
    }

    const courses = await fetchCourses(semester.schoolYear, semester.semester);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未找到课程数据，请确认选择了正确的学期");
        return;
    }

    await saveCourses(courses);
    await setPresetTimeSlots();

    window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
