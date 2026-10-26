// 天津科技大学(tust.edu.cn)拾光课程表适配脚本

// 解析 classWeek 字符串 (支持不定长度)
function parseWeekString(weekStr) {
    let weeks = [];
    if (!weekStr) return weeks;
    for (let i = 0; i < weekStr.length; i++) {
        if (weekStr[i] === '1') weeks.push(i + 1);
    }
    return weeks;
}

// 格式化时间 (0800 -> 08:00)
function formatTime(timeStr) {
    if (timeStr && timeStr.length === 4) {
        return timeStr.substring(0, 2) + ":" + timeStr.substring(2);
    }
    return timeStr;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确认您已经在课表界面",
        "好的，开始导入"
    );
}

/**
 * 拉取课程数据并解析
 */
async function fetchCourses() {
    // 随机码，每次页面刷新都会变
    const randomCodeRegExpExec = /\/student\/courseSelect\/thisSemesterCurriculum\/([0-9a-zA-Z]+)\/ajaxStudentSchedule\/curr\/callback/.exec(document.head.innerHTML);
    const randomCode = randomCodeRegExpExec[1];

    // 拉取课程数据
    const response = await fetch(`http://jwxtxs.tust.edu.cn:46110/student/courseSelect/thisSemesterCurriculum/${randomCode}/ajaxStudentSchedule/curr/callback`, {
        "headers": { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        "method": "POST",
        "credentials": "include"
    });

    const data = await response.json();

    if (!data) throw new Error("服务器未返回任何数据");
    if (!data.dateList || !Array.isArray(data.dateList)) {
        console.error("教务返回数据异常:", data);
        throw new Error("未能获取到课程列表，请检查是否已登录或该学期是否有课");
    }

    // 从中解析出课程
    const courses = [];
    data.dateList.forEach(plan => {
        // 修正：确保 selectCourseList 存在且是数组
        if (plan && plan.selectCourseList && Array.isArray(plan.selectCourseList)) {
            plan.selectCourseList.forEach(c => {
                const teacher = (c.attendClassTeacher || "").replace(/\* /g, "").trim();
                if (c.timeAndPlaceList && Array.isArray(c.timeAndPlaceList)) {
                    c.timeAndPlaceList.forEach(tp => {
                        courses.push({
                            name: c.courseName,
                            teacher: teacher,
                            position: (tp.teachingBuildingName || "") + (tp.classroomName || ""),
                            day: tp.classDay,
                            startSection: tp.classSessions,
                            endSection: tp.classSessions + tp.continuingSession - 1,
                            weeks: parseWeekString(tp.classWeek),
                            isCustomTime: false
                        });
                    });
                }
            });
        }
    });

    if (courses.length === 0) {
        throw new Error("该学期暂无排课数据");
    }

    console.log('courses:', courses);

    return courses;
}

async function fetchTimeSections() {
    const response = await fetch("http://jwxtxs.tust.edu.cn:46110/ajax/getSectionAndTime", {
        "headers": { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        "method": "POST",
        "credentials": "include",
        "body": "planNumber=&ff=f"
    });

    const data = await response.json();

    if (!data) throw new Error("服务器未返回任何数据");
    if (!data.sectionTime || !Array.isArray(data.sectionTime)) {
        console.error("时间段数据异常:", data);
        throw new Error("未能获取到时间段数据，这不应该发生，请联系维护者");
    }

    // 解析时间段
    const timeSlots = (data.sectionTime || []).map((item, index) => ({
        number: index + 1,
        startTime: formatTime(item.startTime),
        endTime: formatTime(item.endTime),
    }));

    console.log('timeSlots:', timeSlots);

    return timeSlots;
}

/**
 * 网络请求和数据解析
 */
async function fetchAndParseJwData() {
    try {
        window.shiguangBridge.showToast("正在获取教务数据...");

        const [courses, timeSlots] = await Promise.all([fetchCourses(), fetchTimeSections()]);
        return { courses, timeSlots };
    } catch (e) {
        window.shiguangBridge.showToast("同步失败: " + e.message);
        console.error(e);
        return null;
    }
}

/**
 * 保存数据到应用
 */
async function saveToApp(result) {
    const courseSuccess = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
    if (!courseSuccess) return false;

    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(result.timeSlots));

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterTotalWeeks: 20
    }));

    return true;
}

/**
 * 流程控制
 */
async function runImportFlow() {
    // 公告
    const alertResult = await promptUserToStart();
    if (!alertResult) return;

    // 请求与解析
    const result = await fetchAndParseJwData();
    if (!result || result.courses.length === 0) return;

    // 保存并结束
    if (await saveToApp(result)) {
        window.shiguangBridge.showToast(`成功导入 ${result.courses.length} 个课程时段`);
        window.shiguangBridge.notifyTaskCompletion();
    }
}

// 启动
runImportFlow();