const getStudentId = () => document.querySelector('.trigger-user-name').innerText.match(/\[(.*?)\]/)?.[1];

const checkLogin = () => window.location.hostname === 'my.cqu.edu.cn' && getStudentId() !== undefined;

const getAccessToken = () => localStorage.getItem('cqu_edu_ACCESS_TOKEN').replaceAll('"', '');

const baseFetch = async (url, accessToken, method, body, description) => {
    const response = await fetch(
        url,
        {
            method,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body,
        }
    );
    if (!response.ok) {
        window.shiguangBridge.showToast(`获取${description}失败，请退出重试`);
        throw new Error(`获取${description}失败: ${termResponse.status} ${termResponse.statusText}`);
    }
    return await response.json();
}

const getTermId = async (accessToken) => (await baseFetch('https://my.cqu.edu.cn/api/resourceapi/session/info-detail', accessToken, 'GET', null, '学期信息')).curSessionId;

const getStartDate = async (termId, accessToken) => (new Date((await baseFetch(`https://my.cqu.edu.cn/api/resourceapi/session/info/${termId}`, accessToken, 'GET', null, '学期详情')).data.beginDate).toISOString().split('T')[0]);

const getMaxWeek = async (termId, accessToken) => (await baseFetch(`https://my.cqu.edu.cn/api/timetable/course/maxWeek/${termId}`, accessToken, 'GET', null, '最大周数')).data;

const getTimeSlots = async (accessToken) => (await baseFetch('https://my.cqu.edu.cn/api/workspace/time-pattern/session-time-pattern', accessToken, 'GET', null, '时间段配置')).data.classPeriodVOS;

const getSchedule = async (termId, accessToken, studentId) => (await baseFetch(`https://my.cqu.edu.cn/api/timetable/class/timetable/student/my-table-detail?sessionId=${termId}`, accessToken, 'POST', JSON.stringify([studentId]), '课程表')).classTimetableVOList;

const parseSchedule = (startDate, maxWeek, timeSlots, schedule) => ({
    courseConfig: {
        semesterStartDate: startDate,
        totalWeeks: maxWeek,
    },
    timeSlots: timeSlots.map((timeSlot, index) => ({
        number: timeSlot.periodOrder ?? index + 1,
        startTime: timeSlot.startTime ?? '',
        endTime: timeSlot.endTime ?? '',
    })),
    courses: schedule.map((course) => ({
        name: course.courseName ?? '',
        teacher: course.instructorName?.slice(0, course.instructorName?.indexOf('-')) ?? '',
        position: course.position ?? course.roomName ?? '',
        day: course.weekDay ?? 0,
        startSection: (course.periodFormat?.indexOf('-') ?? 0) > 0 ? (Number(course.periodFormat?.split('-')[0])) : (Number(course.periodFormat)) ?? 0,
        endSection: (course.periodFormat?.indexOf('-') ?? 0) > 0 ? (Number(course.periodFormat?.split('-')[1])) : (Number(course.periodFormat)) ?? 0,
        weeks: (course.teachingWeek ?? '').split('').map((char, index) => (char === '1' ? index + 1 : null)).filter(week => week !== null),
    })),
});

const saveSchedule = (parsedSchedule) => Promise.allSettled([
    window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(parsedSchedule?.courseConfig)),
    window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedSchedule?.courses)),
    window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsedSchedule?.timeSlots)),
]);


(async () => {
    if (!checkLogin()) {
        window.shiguangBridge.showToast("尚未登录重庆大学教务系统，请先登录！");
        throw new Error("未检测到登录状态");
    }
    
    const studentId = getStudentId();
    
    const accessToken = getAccessToken();

    if (!accessToken) {
        window.shiguangBridge.showToast("尚未登录");
        throw new Error("未找到访问令牌，请确保已登录 my.cqu.edu.cn");
    }

    const termId = await getTermId(accessToken);

    await saveSchedule(parseSchedule(...(await Promise.allSettled([getStartDate(termId, accessToken), getMaxWeek(termId, accessToken), getTimeSlots(accessToken), getSchedule(termId, accessToken, studentId)])).map(result => result.value)));

    window.shiguangBridge.notifyTaskCompletion();
})();