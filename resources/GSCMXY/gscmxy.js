// 甘肃财贸职业学院教务系统(gscmxy.edu.cn) 拾光课程表适配脚本

function parseWeeksFromSkzc(skzc) {
    const weeks = [];
    const rawSkzc = skzc || '';
    for (let i = 0; i < rawSkzc.length; i++) {
        if (rawSkzc[i] === '1') {
            weeks.push(i + 1);
        }
    }
    return weeks;
}

function parseSingleCourse(rawCourse) {
    const courseName = rawCourse.KCM;
    const teacherName = rawCourse.SKJS ? rawCourse.SKJS.split('/')[0] : '';
    const position = rawCourse.JASMC;
    const day = rawCourse.SKXQ;
    const startSection = rawCourse.KSJC;
    const endSection = rawCourse.JSJC;
    const weeks = parseWeeksFromSkzc(rawCourse.SKZC);

    if (!courseName || !day || !startSection || !endSection || weeks.length === 0) {
        return null;
    }

    const campus = rawCourse.XXXQDM_DISPLAY ? String(rawCourse.XXXQDM_DISPLAY).trim() : "";
    const classroom = position ? String(position).trim() : "";
    const finalPosition = campus && classroom ? `${classroom}(${campus})` : (classroom || '待定');

    const course = {
        "name": courseName,
        "teacher": teacherName,
        "position": finalPosition,
        "day": parseInt(day),
        "startSection": parseInt(startSection),
        "endSection": parseInt(endSection),
        "weeks": weeks
    };

    course._kbId = rawCourse.KBID;
    course._day = course.day;
    course._startSection = course.startSection;
    course._endSection = course.endSection;
    course._position = classroom;
    course._campus = campus;

    return course;
}

function applyCourseChanges(parsedCourses, rawChanges) {
    let successCount = 0;

    for (const change of rawChanges) {
        const kbID = change.KBID;
        const originalTeacher = change.YSKJS ? change.YSKJS.split('/')[0] : '';

        const weeksToRemove = parseWeeksFromSkzc(change.SKZC);

        let changeApplied = false;

        const affectedOriginalCourses = parsedCourses.filter(c =>
            c._kbId === kbID &&
            c._day === parseInt(change.SKXQ) &&
            c._startSection === parseInt(change.KSJC) &&
            c._endSection === parseInt(change.JSJC)
        );

        if (affectedOriginalCourses.length === 0) {
            continue;
        }

        if (weeksToRemove.length > 0) {
            affectedOriginalCourses.forEach(originalCourse => {
                const beforeLength = originalCourse.weeks.length;
                originalCourse.weeks = originalCourse.weeks.filter(w => !weeksToRemove.includes(w));
                if (originalCourse.weeks.length < beforeLength) {
                    changeApplied = true;
                }
            });
        }

        const isTimeLocationChange = (change.TKLXDM === '01' || change.TKLXDM === '03');

        if (isTimeLocationChange && change.XSKZC && change.XSKXQ && change.XKSJC && change.XJSJC) {
            const newWeeks = parseWeeksFromSkzc(change.XSKZC);

            if (newWeeks.length > 0) {
                const newCampus = change.XXXQDM_DISPLAY ? String(change.XXXQDM_DISPLAY).trim() : "";
                const newClassroom = change.XJASMC ? String(change.XJASMC).trim() : (change.JASMC ? String(change.JASMC).trim() : "");
                const newPosition = newCampus && newClassroom ? `${newClassroom}(${newCampus})` : (newClassroom || '待定');

                const newCourse = {
                    "name": change.KCM,
                    "teacher": change.XSKJS ? change.XSKJS.split('/')[0] : originalTeacher,
                    "position": newPosition,
                    "day": parseInt(change.XSKXQ),
                    "startSection": parseInt(change.XKSJC),
                    "endSection": parseInt(change.XJSJC),
                    "weeks": newWeeks,
                    "_kbId": kbID,
                    "_day": parseInt(change.XSKXQ),
                    "_startSection": parseInt(change.XKSJC),
                    "_endSection": parseInt(change.XJSJC)
                };
                parsedCourses.push(newCourse);
                changeApplied = true;
            }
        }

        if (changeApplied) {
            successCount++;
        }
    }

    if (successCount > 0) {
        window.shiguangBridge.showToast(`已应用 ${successCount} 条调课/停课变更，获得实际课表。`);
    }

    return parsedCourses.map(c => {
        delete c._kbId;
        delete c._day;
        delete c._startSection;
        delete c._endSection;
        delete c._position;
        delete c._campus;
        return c;
    }).filter(c => c.weeks.length > 0);
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input) && parseInt(input) > 2000) {
        return false;
    } else {
        return "请输入有效的四位数字学年（例如：2026）！";
    }
}

async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "甘肃财贸职业学院课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统，确认当前页面有显示课表。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return null;
    }
    return true;
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear();
    const yearSelection = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2026-2027 应输入2026）:",
        String(currentYear),
        "validateYearInput"
    );
    return yearSelection;
}

async function selectSemester() {
    const semesters = ["1 (秋季学期/上学期)", "2 (春季学期/下学期)"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );

    if (semesterIndex === null) return null;
    return String(semesterIndex + 1);
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    const XNXQDM = `${academicYear}-${parseInt(academicYear) + 1}-${semesterCode}`;
    const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
    };

    const courseUrl = "https://jwxt.gscmxy.edu.cn/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do";
    const courseBody = `XNXQDM=${XNXQDM}`;
    let rawCourseData;
    try {
        const response = await fetch(courseUrl, { "headers": headers, "body": courseBody, "method": "POST", "credentials": "include" });
        rawCourseData = JSON.parse(await response.text());
    } catch (e) {
        window.shiguangBridge.showToast("请求课表 API 失败，请检查网络和登录状态。");
        return null;
    }

    const rawCourses = rawCourseData?.datas?.cxxszhxqkb?.rows || [];
    if (rawCourses.length === 0) {
        window.shiguangBridge.showToast("该学期未查询到您的课程数据。");
        return null;
    }
    let parsedCourses = rawCourses.map(c => parseSingleCourse(c)).filter(c => c !== null);

    const changeUrl = "https://jwxt.gscmxy.edu.cn/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do";
    const changeBody = `XNXQDM=${XNXQDM}&*order=-SQSJ`;
    let rawChangeData;
    try {
        const response = await fetch(changeUrl, { "headers": headers, "body": changeBody, "method": "POST", "credentials": "include" });
        rawChangeData = JSON.parse(await response.text());
    } catch (e) {
        window.shiguangBridge.showToast("请求调课 API 失败，将使用未调整的课表数据。");
    }

    const rawChanges = rawChangeData?.datas?.xsdkkc?.rows || [];

    if (rawChanges.length > 0) {
        parsedCourses = applyCourseChanges(parsedCourses, rawChanges);
    }

    const courseConfig = {
        semesterTotalWeeks: 20
    };

    return {
        courses: parsedCourses,
        config: courseConfig
    };
}

async function saveCourses(parsedCourses) {
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("没有有效的课程数据可供保存。");
        return true;
    }
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 门课程！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存课程数据失败: ${error.message}`);
        return false;
    }
}

async function importPresetTimeSlots() {
    window.shiguangBridge.showToast("正在导入预设节次时间...");

    const presetTimeSlots = [
        { "number": 1, "startTime": "08:50", "endTime": "09:30" },
        { "number": 2, "startTime": "09:40", "endTime": "10:20" },
        { "number": 3, "startTime": "10:50", "endTime": "11:30" },
        { "number": 4, "startTime": "11:40", "endTime": "12:20" },
        { "number": 5, "startTime": "14:30", "endTime": "15:10" },
        { "number": 6, "startTime": "15:20", "endTime": "16:00" },
        { "number": 7, "startTime": "16:20", "endTime": "17:00" },
        { "number": 8, "startTime": "17:10", "endTime": "17:50" },
        { "number": 9, "startTime": "19:30", "endTime": "20:10" },
        { "number": 10, "startTime": "20:20", "endTime": "21:00" }
    ];

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

async function saveConfig(configData) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        window.shiguangBridge.showToast("课表配置更新成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    window.shiguangBridge.showToast("甘肃财贸职业学院课程导入流程启动...");

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;

    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterCode = await selectSemester();
    if (semesterCode === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    await importPresetTimeSlots();

    const courseData = await fetchAndParseCourses(academicYear, semesterCode);
    if (courseData === null) return;

    const configSaveResult = await saveConfig(courseData.config);
    if (!configSaveResult) return;

    const saveResult = await saveCourses(courseData.courses);
    if (!saveResult) return;

    window.shiguangBridge.showToast("所有任务已完成！课表导入成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
