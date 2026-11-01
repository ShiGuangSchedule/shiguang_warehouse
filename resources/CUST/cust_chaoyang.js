// 文件: cust_chaoyang.js
// 长春理工大学朝阳校区 kbpro 课程表导入脚本
//
// 适用校区：朝阳校区；沿用现有第 1～12 节作息配置。
// 导入学生个人课表，课程地点仍按接口返回的校区、教学楼和教室显示。
// 导入流程：判断页面 → 获取学期和课程 → 合并课程 → 保存课程 → 保存每节作息 → 通知完成。
// 数据分开保存：课程包含星期、周次和起止节次；作息表包含各节次的开始、结束时间。
// 本脚本使用 V2 的 window.shiguangBridge / window.shiguangBridgePromise。

// 课表页面用于建立当前登录会话；两个接口请求均使用该会话的 Cookie。
const SCHEDULE_PAGE_URL = 'https://kbpro.cust.edu.cn/Schedule/';
const SCHEDULE_INFO_API = 'https://kbpro.cust.edu.cn/Schedule/scheduleInfo';
const SCHEDULE_JSON_API = 'https://kbpro.cust.edu.cn/Schedule/getSchedulejson';

// 判断当前是否已经进入新版课表页面
function isOnSchedulePage() {
    try {
        const url = new URL(window.location.href);
        return url.hostname.toLowerCase() === 'kbpro.cust.edu.cn'
            && url.pathname.toLowerCase().startsWith('/schedule');
    } catch (error) {
        return false;
    }
}

// 直接进入新版课表页面，不再进入旧教务系统 Student 页面
// 跳转只负责打开目标页面；当前执行不会在跳转后接着请求数据，需要在新页面执行脚本。
function redirectToSchedulePage() {
    console.log('当前不在新版课表页面，正在跳转:', SCHEDULE_PAGE_URL);
    window.shiguangBridge.showToast('正在打开课程表...');
    window.location.replace(SCHEDULE_PAGE_URL);
}

// 通用 GET JSON 请求。Cookie 由浏览器当前登录会话自动携带，不写死 JSESSIONID。
async function fetchJson(url, description) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        credentials: 'include',
        cache: 'no-store'
    });

    if (!response.ok) {
        throw new Error(`${description}失败，HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    // 登录失效时可能返回登录页 HTML，不能把它当作课程 JSON 继续导入。
    if (!contentType.toLowerCase().includes('application/json')) {
        throw new Error(`${description}返回的不是 JSON，可能登录状态已失效`);
    }

    return await response.json();
}

// 获取学期、开学日期、当前周以及周次日期映射
// 当前实现只将这些信息输出到日志，没有调用 saveCourseConfig 保存学期开始日期或总周数。
async function fetchScheduleInfo() {
    try {
        console.log('正在获取学期信息...');
        const data = await fetchJson(SCHEDULE_INFO_API, '获取学期信息');
        console.log('学期信息:', data);
        return data;
    } catch (error) {
        console.error('获取学期信息失败:', error);
        window.shiguangBridge.showToast('获取学期信息失败: ' + error.message);
        return null;
    }
}

// 获取课程明细
// 预期返回课程数组：courseName/teacherName 为课程和教师，dayOfWeek 为星期，
// beginSection/endSection 为节次，weekDescription 为周次位图，beginTime/endTime 为时刻。
async function fetchScheduleData() {
    try {
        console.log('正在获取课程明细...');
        const data = await fetchJson(SCHEDULE_JSON_API, '获取课程数据');

        if (!Array.isArray(data)) {
            throw new Error('课程接口返回格式异常');
        }

        console.log(`成功获取 ${data.length} 条课程明细`);
        console.log('课程接口原始数据:', data);
        return data;
    } catch (error) {
        console.error('获取课程数据失败:', error);
        window.shiguangBridge.showToast('获取课程失败: ' + error.message);
        return null;
    }
}

// weekDescription 是 25 位周次位图。
// 下标直接对应 scheduleInfo.dateList 中的 weekOrder：
// 第 0 位 = weekOrder 0（开学前一周），正式导入时忽略；第 1 位 = 第 1 周，以此类推。
// 例如 "0101..." 表示第 1、3 周有课；这是接口约定，不能把所有下标统一加 1。
function parseWeekDescription(weekDescription) {
    if (typeof weekDescription !== 'string') {
        return [];
    }

    const weeks = [];

    for (let index = 1; index < weekDescription.length; index++) {
        if (weekDescription[index] === '1') {
            weeks.push(index);
        }
    }

    return weeks;
}

// 教师显示名称：保持接口第一次出现的顺序，只把空格统一成“、”
// 重复姓名只保留一次，例如 "张老师 李老师 张老师" 显示为 "张老师、李老师"。
function normalizeTeacherDisplay(teacherName) {
    if (!teacherName) {
        return '';
    }

    const names = teacherName
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return [...new Set(names)].join('、');
}

// 教师比较键：忽略多人教师在不同周返回时的排列顺序
// "张老师 李老师" 与 "李老师 张老师" 可归为同一教师集合，显示名称仍保持首次顺序。
function normalizeTeacherKey(teacherName) {
    if (!teacherName) {
        return '';
    }

    const names = teacherName
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return [...new Set(names)].sort().join('、');
}

// 拼接完整上课地点
// 按校区、教学楼、教室依次拼接；空字段跳过，全部为空时显示“未指定”。
function buildPosition(item) {
    return [item.campus, item.buildingName, item.classroomName]
        .map(value => (value || '').trim())
        .filter(Boolean)
        .join(' ') || '未指定';
}

// 基于主仓库教程的 mergeAndDistinctCourses：先合并节次与重复记录，再合并同节次的周次。
// 来源：https://github.com/ShiGuangSchedule/shiguangschedule/wiki/课程合并与去重函数
// kbpro 补充：周次先去重、处理重叠节次，并在周次合并后继续处理新形成的连续节次。
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses)) {
        return [];
    }

    // 复制课程和周次数组，避免合并过程修改原始数据。
    let list = courses.map(course => ({
        ...course,
        name: course.name || '',
        teacher: course.teacher || '',
        position: course.position || '',
        weeks: Array.isArray(course.weeks)
            ? Array.from(new Set(course.weeks)).sort((a, b) => a - b)
            : []
    }));

    if (list.length <= 1) {
        return list;
    }

    let previousCount;

    do {
        previousCount = list.length;

        // 阶段 1：名称、教师、地点、星期、周次一致时合并连续节次，并去掉重复或重叠部分。
        list.sort((a, b) =>
            a.name.localeCompare(b.name)
            || a.teacher.localeCompare(b.teacher)
            || a.position.localeCompare(b.position)
            || a.day - b.day
            || a.weeks.join(',').localeCompare(b.weeks.join(','))
            || a.startSection - b.startSection
            || a.endSection - b.endSection
        );

        const step1Merged = [];
        let current = list[0];

        for (let index = 1; index < list.length; index++) {
            const next = list[index];
            const isSameCourseAndWeeks = current.name === next.name
                && current.teacher === next.teacher
                && current.position === next.position
                && current.day === next.day
                && current.weeks.join(',') === next.weeks.join(',');

            // 已按开始节次排序，因此该条件同时覆盖连续、完全重复和部分重叠的节次。
            if (isSameCourseAndWeeks && next.startSection <= current.endSection + 1) {
                current.endSection = Math.max(current.endSection, next.endSection);
            } else {
                step1Merged.push(current);
                current = next;
            }
        }
        step1Merged.push(current);

        // 阶段 2：名称、教师、地点、星期及起止节次一致时，合并并排序上课周次。
        step1Merged.sort((a, b) =>
            a.name.localeCompare(b.name)
            || a.teacher.localeCompare(b.teacher)
            || a.position.localeCompare(b.position)
            || a.day - b.day
            || a.startSection - b.startSection
            || a.endSection - b.endSection
        );

        const step2Merged = [];
        let cur = step1Merged[0];

        for (let index = 1; index < step1Merged.length; index++) {
            const next = step1Merged[index];
            const isSameCourseAndSection = cur.name === next.name
                && cur.teacher === next.teacher
                && cur.position === next.position
                && cur.day === next.day
                && cur.startSection === next.startSection
                && cur.endSection === next.endSection;

            if (isSameCourseAndSection) {
                cur.weeks = Array.from(new Set([...cur.weeks, ...next.weeks])).sort((a, b) => a - b);
            } else {
                step2Merged.push(cur);
                cur = next;
            }
        }
        step2Merged.push(cur);
        list = step2Merged;

        // 周次合并可能让相邻时段的周次变得一致；每轮有合并时再处理，记录数不再减少即停止。
    } while (list.length < previousCount);

    return list;
}

// 将 getSchedulejson 返回结果转换成时光课表格式
// 返回 { courses, timeSlots }：courses 用于课程导入，timeSlots 是接口给出的课程时段边界。
// timeSlots 不是完整的每节作息表，后续由 generateTimeSlots 补齐为第 1～12 节。
function convertScheduleData(apiData) {
    // 先解析为教程函数要求的标准课程数组，作息边界单独收集。
    const rawCourses = [];
    const teacherDisplaysMap = new Map();
    const timeSlotsMap = new Map();

    apiData.forEach(item => {
        const courseName = (item.courseName || '').trim();
        const teacherDisplay = normalizeTeacherDisplay(item.teacherName);
        const teacherKey = normalizeTeacherKey(item.teacherName);
        const position = buildPosition(item);
        // 接口字段可能是数字字符串，转为整数后再校验；星期 1～7 分别表示周一～周日。
        const day = Number(item.dayOfWeek);
        const startSection = Number(item.beginSection);
        const endSection = Number(item.endSection);
        const weeks = parseWeekDescription(item.weekDescription);

        // 无课程名称、无正式上课周次或星期/节次不合法的记录不导入。
        if (!courseName || weeks.length === 0) {
            return;
        }

        if (!Number.isInteger(day) || day < 1 || day > 7) {
            console.warn('忽略星期字段异常的课程:', item);
            return;
        }

        if (!Number.isInteger(startSection) || !Number.isInteger(endSection)
            || startSection <= 0 || endSection < startSection) {
            console.warn('忽略节次字段异常的课程:', item);
            return;
        }

        // 教程函数直接比较 teacher 字段，先使用排序后的教师集合，防止姓名顺序不同影响合并。
        // 显示名称另外保留，合并后还原为接口首次出现的顺序。
        const teacherDisplayKey = JSON.stringify([courseName, teacherKey, position, day]);
        if (!teacherDisplaysMap.has(teacherDisplayKey)) {
            teacherDisplaysMap.set(teacherDisplayKey, teacherDisplay);
        }

        rawCourses.push({
            name: courseName,
            teacher: teacherKey,
            position,
            day,
            startSection,
            endSection,
            weeks
        });

        // 收集 API 给出的时间范围，用于覆盖默认作息时间的起止边界
        // beginTime/endTime 表示整段课程的开始和结束，不能据此推算中间每节课的时间。
        const beginTime = (item.beginTime || '').trim();
        const endTime = (item.endTime || '').trim();

        if (beginTime && endTime) {
            const timeKey = `${startSection}-${endSection}-${beginTime}-${endTime}`;
            timeSlotsMap.set(timeKey, {
                startSection,
                endSection,
                startTime: beginTime,
                endTime
            });
        }
    });

    // 调用教程的合并去重函数，再还原教师显示名称，不向 App 输出内部比较字段。
    const courses = mergeAndDistinctCourses(rawCourses).map(course => ({
        ...course,
        teacher: teacherDisplaysMap.get(JSON.stringify([
            course.name, course.teacher, course.position, course.day
        ])) ?? course.teacher
    }));

    // 最终按星期、起止节次、课程名称排序，便于检查导入结果。
    courses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.endSection !== b.endSection) return a.endSection - b.endSection;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    console.log(`接口原始记录: ${apiData.length} 条`);
    console.log(`合并后的课程记录: ${courses.length} 条`);
    console.log('转换后的课程:', courses);

    return {
        courses,
        timeSlots: Array.from(timeSlotsMap.values())
    };
}

// 生成朝阳校区时间段配置
// 每节都有独立的 number、startTime、endTime；当前共配置 12 节，时刻格式为 HH:mm。
// 下表为现有朝阳校区的默认作息，不表示每一节都由本次接口返回。
// 本文件的作息只用于朝阳校区；春明湖校区需另行配置独立脚本和时间表。
// 课程记录只保存节次，App 使用这张作息表将节次对应到具体时间，不使用课程自定义时间模式。
function generateTimeSlots(timeSlotsFromAPI) {
    const defaultTimeSlots = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:55', endTime: '09:35' },
        { number: 3, startTime: '10:05', endTime: '10:50' },
        { number: 4, startTime: '11:00', endTime: '11:40' },
        { number: 5, startTime: '13:30', endTime: '14:15' },
        { number: 6, startTime: '14:25', endTime: '15:05' },
        { number: 7, startTime: '15:35', endTime: '16:20' },
        { number: 8, startTime: '16:30', endTime: '17:10' },
        { number: 9, startTime: '18:00', endTime: '18:45' },
        { number: 10, startTime: '18:45', endTime: '19:35' },
        { number: 11, startTime: '19:45', endTime: '20:30' },
        { number: 12, startTime: '20:30', endTime: '21:20' }
    ];

    if (Array.isArray(timeSlotsFromAPI)) {
        timeSlotsFromAPI.forEach(slot => {
            // 只覆盖首节的开始时间、末节的结束时间，其余节次继续使用默认值。
            // 例如接口返回 5-7 节 13:30～16:20：更新第 5 节开始、第 7 节结束，
            // 第 5 节结束、第 6 节起止、第 7 节开始仍按内置作息，不均分课程总时长。
            // 同一边界有多条不同时间时，后处理的记录覆盖先处理的记录。
            // 接口节次超出 1～12 时找不到对应作息，因此不会新增节次。
            const first = defaultTimeSlots.find(item => item.number === slot.startSection);
            const last = defaultTimeSlots.find(item => item.number === slot.endSection);

            if (first && slot.startTime) {
                first.startTime = slot.startTime;
            }

            if (last && slot.endTime) {
                last.endTime = slot.endTime;
            }
        });
    }

    return defaultTimeSlots;
}

// 主函数：获取并导入课程
// 所有数据保存都 await V2 Promise 接口；获取失败、没有课程或课程保存失败时退出。
async function importCourseSchedule() {
    try {
        console.log('开始导入朝阳校区 kbpro 课程表...');
        window.shiguangBridge.showToast('正在获取课程表...');

        // 1. 获取学期信息供日志查看；此处不修改 App 的学期配置。
        const scheduleInfo = await fetchScheduleInfo();
        if (!scheduleInfo) {
            return false;
        }

        console.log(
            `当前学期: ${scheduleInfo.termName || '未知'}，`
            + `开学日期: ${scheduleInfo.schoolStartTime || '未知'}，`
            + `当前周: ${scheduleInfo.weekNum ?? '未知'}`
        );

        // 2. 获取当前会话对应的课程数组，并转换为 App 需要的字段。
        const scheduleData = await fetchScheduleData();
        if (!scheduleData) {
            return false;
        }

        const { courses, timeSlots } = convertScheduleData(scheduleData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast('未找到可导入的课程');
            return false;
        }

        // 3. 先保存课程：name、teacher、position、day、startSection、endSection、weeks。
        // 起止时刻不直接放入课程对象，下一步单独保存每节作息。
        const coursesResult = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );

        if (coursesResult !== true) {
            console.error('课程导入失败，返回:', coursesResult);
            window.shiguangBridge.showToast('课程导入失败');
            return false;
        }

        console.log('课程导入成功');
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 条课程记录！`);

        // 4. 以朝阳校区 12 节默认作息为基础应用接口边界，再提交完整作息表。
        const finalTimeSlots = generateTimeSlots(timeSlots);
        console.log('朝阳校区时间段配置:', finalTimeSlots);

        const timeSlotsResult = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(finalTimeSlots)
        );

        if (timeSlotsResult === true) {
            console.log('时间段导入成功');
            window.shiguangBridge.showToast('朝阳校区作息配置成功！');
        } else {
            // 返回 false 时保留已导入课程，并提示作息失败；抛出异常时则进入下面的 catch。
            console.warn('时间段导入失败，返回:', timeSlotsResult);
            window.shiguangBridge.showToast('课程已导入，但时间段配置失败');
        }

        return true;
    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

// ========== 主执行逻辑 ==========

if (!isOnSchedulePage()) {
    redirectToSchedulePage();
} else {
    console.log('已进入长春理工大学朝阳校区新版课表导入流程');
    window.shiguangBridge.showToast('正在准备导入朝阳校区课程表...');

    // 等待页面和登录态稳定后请求接口
    setTimeout(async () => {
        const success = await importCourseSchedule();
        if (success) {
            // 完成信号用于通知 App 收尾；获取或课程保存失败时不发送。
            window.shiguangBridge.notifyTaskCompletion();
        }
    }, 1000);
}
