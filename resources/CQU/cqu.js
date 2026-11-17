const getStudentId = () => document.querySelector('.trigger-user-name')?.innerText.match(/\[(.*?)\]/)?.[1];

const checkLogin = () => window.location.hostname === 'my.cqu.edu.cn' && getStudentId() !== undefined;

const getAccessToken = () => localStorage.getItem('cqu_edu_ACCESS_TOKEN')?.replaceAll('"', '');

const formatTime = (time) => time?.match(/(\d{1,2}):(\d{2})/)?.slice(1, 3).map((s) => s.padStart(2, '0')).join(':');

const baseFetch = async (endpoint, accessToken, method, body, description) => {
    const response = await fetch(
        `https://my.cqu.edu.cn/api/${endpoint}`,
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
        throw new Error(`获取${description}失败: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

const getTermId = async (accessToken) => (await baseFetch('resourceapi/session/info-detail', accessToken, 'GET', null, '学期信息')).curSessionId;

const getStartDate = async (termId, accessToken) => new Date((await baseFetch(`resourceapi/session/info/${termId}`, accessToken, 'GET', null, '学期详情')).data.beginDate).toLocaleDateString('sv-SE');

const getMaxWeek = async (termId, accessToken) => (await baseFetch(`timetable/course/maxWeek/${termId}`, accessToken, 'GET', null, '最大周数')).data;

const getTimeSlots = async (accessToken) => (await baseFetch('workspace/time-pattern/session-time-pattern', accessToken, 'GET', null, '时间段配置')).data.classPeriodVOS;

const getSchedule = async (termId, accessToken, studentId) => (await baseFetch(`timetable/class/timetable/student/my-table-detail?sessionId=${termId}`, accessToken, 'POST', JSON.stringify([studentId]), '课程表')).classTimetableVOList;

const getExams = async (accessToken) => (await baseFetch('exam/examTask/get-student-exam-list', accessToken, 'GET', null, '考试列表')).data.content;

const parseCourse = (course) => {
    const day = Number(course.weekDay);
    const weeks = (course.teachingWeek ?? '').split('').map((char, index) => (char === '1' ? index + 1 : null)).filter(week => week !== null);
    if (!day || weeks.length === 0) return [];

    const base = {
        name: course.courseName ?? '',
        teacher: (course.instructorName ?? '').split(';').map(s => s.replace(/\[.*?\]/g, '').split('-')[0].trim()).filter(Boolean).join(','),
        position: course.position || course.roomName || course.hourType || '',
        day,
        weeks,
        credit: course.credit != null ? Number(course.credit) : undefined,
    };

    const ranges = [...(course.period ?? '').matchAll(/1+/g)];
    if (ranges.length > 0) {
        return ranges.map(match => ({
            ...base,
            startSection: match.index + 1,
            endSection: match.index + match[0].length,
        }));
    }

    const [rawStart, rawEnd] = course.timeIn?.split('~') ?? [course.startTime, course.endTime];
    const customStartTime = formatTime(rawStart);
    const customEndTime = formatTime(rawEnd);
    return customStartTime && customEndTime
        ? [{ ...base, isCustomTime: true, customStartTime, customEndTime }]
        : [];
};

const parseExams = (termId, exams) => (exams ?? [])
    .filter(exam => String(exam.sessionId) === String(termId) && exam.week && exam.weekDay && exam.startTime && exam.endTime)
    .map(exam => ({
        name: `[考试] ${exam.courseName ?? ''}`,
        teacher: [...(exam.simpleChiefinvigilatorVOS ?? []), ...(exam.simpleAssistantInviVOS ?? [])].map(i => i.instructor).filter(Boolean).join(','),
        position: [exam.roomName, exam.seatNum ? `${exam.seatNum}号座` : ''].filter(Boolean).join(' '),
        day: Number(exam.weekDay),
        weeks: [Number(exam.week)],
        isCustomTime: true,
        customStartTime: formatTime(exam.startTime),
        customEndTime: formatTime(exam.endTime),
    }));

const parseSchedule = (termId, startDate, maxWeek, timeSlots, schedule, exams) => {
    const courses = [...(schedule ?? []).flatMap(parseCourse), ...parseExams(termId, exams)];
    return {
        courseConfig: {
            semesterStartDate: startDate,
            semesterTotalWeeks: Math.max(maxWeek ?? 0, ...courses.flatMap(c => c.weeks)),
        },
        timeSlots: timeSlots.map((timeSlot, index) => ({
            number: timeSlot.periodOrder ?? index + 1,
            startTime: formatTime(timeSlot.startTime) ?? '',
            endTime: formatTime(timeSlot.endTime) ?? '',
        })),
        courses,
    };
};

const saveSchedule = (parsedSchedule) => Promise.all([
    window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(parsedSchedule.courseConfig)),
    window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsedSchedule.timeSlots)),
    window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedSchedule.courses)),
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

    await saveSchedule(parseSchedule(termId, ...(await Promise.all([getStartDate(termId, accessToken), getMaxWeek(termId, accessToken), getTimeSlots(accessToken), getSchedule(termId, accessToken, studentId), getExams(accessToken)]))));

    window.shiguangBridge.notifyTaskCompletion();
})();
