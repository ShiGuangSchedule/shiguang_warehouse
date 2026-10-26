// 新疆政法学院教务系统课程表导入脚本
// 适配: jwxt.xjzfu.edu.cn

function isOnStudentPage() {
    return /jwxt\.xjzfu\.edu\.cn/i.test(window.location.href);
}

function parseWeekMask(mask) {
    if (!mask) return [];
    const weeks = [];
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === '1') weeks.push(i + 1);
    }
    return weeks;
}

function parseTeacher(str) {
    if (!str) return '';
    const names = [];
    const parts = str.split(';');
    for (const part of parts) {
        const sections = part.split('/');
        for (const section of sections) {
            const match = section.match(/([^[\]]+)\[主讲\]/);
            if (match) {
                names.push(match[1].trim());
            }
        }
    }
    return [...new Set(names)].join('、');
}

function generateTimeSlots(arrangedList) {
    const standardSchedule = [
        { number: 1, startTime: '10:00', endTime: '10:45' },
        { number: 2, startTime: '10:50', endTime: '11:35' },
        { number: 3, startTime: '11:50', endTime: '12:35' },
        { number: 4, startTime: '12:40', endTime: '13:25' },
        { number: 5, startTime: '13:30', endTime: '14:15' },
        { number: 6, startTime: '16:00', endTime: '16:45' },
        { number: 7, startTime: '16:50', endTime: '17:35' },
        { number: 8, startTime: '17:50', endTime: '18:35' },
        { number: 9, startTime: '18:40', endTime: '19:25' },
        { number: 10, startTime: '20:30', endTime: '21:15' },
        { number: 11, startTime: '21:20', endTime: '22:05' }
    ];

    const maxSection = Math.max(...arrangedList.map(c => c.endSection).filter(Boolean), 0);
    return standardSchedule.filter(s => s.number <= maxSection);
}

async function fetchScheduleData(termCode) {
    const body = new URLSearchParams();
    body.append('termCode', termCode);
    body.append('campusCode', '1');
    body.append('type', 'term');

    const res = await fetch(
        'https://jwxt.xjzfu.edu.cn/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'fetch-api': 'true'
            },
            credentials: 'include',
            body: body.toString()
        }
    );
    const data = await res.json();
    if (data.code !== '0') throw new Error(data.msg || '获取课表失败');
    return data.datas;
}

async function fetchTermWeeks(termCode) {
    const res = await fetch(
        `https://jwxt.xjzfu.edu.cn/jwapp/sys/homeapp/api/home/getTermWeeks.do?termCode=${encodeURIComponent(termCode)}`,
        {
            headers: { 'fetch-api': 'true' },
            credentials: 'include'
        }
    );
    const data = await res.json();
    if (data.code !== '0') throw new Error(data.msg || '获取学期信息失败');
    return data.datas;
}

async function fetchTermList() {
    const res = await fetch(
        'https://jwxt.xjzfu.edu.cn/jwapp/sys/homeapp/api/home/kb/xnxq.do',
        { headers: { 'fetch-api': 'true' }, credentials: 'include' }
    );
    const data = await res.json();
    if (data.code !== '0') throw new Error(data.msg || '获取学期列表失败');
    const datas = data.datas || [];
    if (datas.length === 0) throw new Error('学期列表为空');
    let defaultIndex = 0;
    const termNames = [];
    const termCodes = [];
    datas.forEach((d, i) => {
        termNames.push(d.itemName);
        termCodes.push(d.itemCode);
        if (d.selected === true) defaultIndex = i;
    });
    return { termNames, termCodes, defaultIndex };
}

async function importCourseSchedule() {
    try {
        window.shiguangBridge.showToast('正在获取学期列表...');

        const termList = await fetchTermList();

        let selectedIdx = termList.defaultIndex;
        if (typeof window.shiguangBridgePromise !== 'undefined') {
            const choice = await window.shiguangBridgePromise.showSingleSelection(
                '请选择要导入的学期',
                JSON.stringify(termList.termNames),
                termList.defaultIndex
            );
            if (choice === null) {
                window.shiguangBridge.showToast('已取消导入');
                return false;
            }
            selectedIdx = choice;
        }

        const termCode = termList.termCodes[selectedIdx];
        window.shiguangBridge.showToast('正在获取课表数据...');
        const datas = await fetchScheduleData(termCode);
        const arrangedList = datas.arrangedList || [];

        if (arrangedList.length === 0) {
            window.shiguangBridge.showToast('未找到课程数据');
            return false;
        }

        const courses = [];
        for (const item of arrangedList) {
            courses.push({
                name: item.courseName,
                teacher: parseTeacher(item.weeksAndTeachers),
                position: item.placeName || '',
                day: item.dayOfWeek,
                startSection: item.beginSection,
                endSection: item.endSection,
                weeks: parseWeekMask(item.week)
            });
        }

        courses.sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.startSection !== b.startSection) return a.startSection - b.startSection;
            return a.endSection - b.endSection;
        });

        console.log(`找到 ${courses.length} 门课程:`, courses);

        const courseResult = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );
        if (courseResult !== true) {
            window.shiguangBridge.showToast('课程导入失败');
            return false;
        }
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);

        const timeSlots = generateTimeSlots(arrangedList);
        console.log('时间段配置:', timeSlots);

        const slotResult = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(timeSlots)
        );
        if (slotResult === true) {
            window.shiguangBridge.showToast('时间段配置成功！');
        }

        const weeksData = await fetchTermWeeks(termCode);
        if (weeksData && weeksData.length > 0) {
            const semesterStartDate = weeksData[0].startDate.split(' ')[0];
            const config = {
                semesterStartDate: semesterStartDate,
                semesterTotalWeeks: weeksData.length,
                defaultClassDuration: 45,
                defaultBreakDuration: 10,
                firstDayOfWeek: 1
            };
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            console.log('学期配置已保存:', config);
        }

        window.shiguangBridge.showToast('课表导入完成！');
        window.shiguangBridge.notifyTaskCompletion();
        return true;

    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

if (isOnStudentPage()) {
    console.log('检测到新疆政法学院教务系统');
    setTimeout(() => { importCourseSchedule(); }, 1000);
} else {
    window.shiguangBridge.showToast('请先登录教务系统！');
}
