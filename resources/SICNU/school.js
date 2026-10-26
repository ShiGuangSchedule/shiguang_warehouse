// school.js - 教务系统适配
//
// 适配说明：
//   此脚本通过调用教务系统已有的 AJAX 接口获取课程数据，
//   解析 scheduleText 文本字段提取排课信息，
//   然后转换为拾光 App 所需的格式并导出。
//
// 使用方式：
//   1. 登录教务系统，进入课表页面
//   2. 点击扩展图标 → "开始测试"
//   3. 等待数据采集完成，弹出下载

const CONTEXT_PATH = window.CONTEXT_PATH || '/student';
const BIZ_TYPE_ID = window.bizTypeId || 2;

// ============================================================
// 工具函数
// ============================================================

/**
 * 从页面全局变量中获取当前学期信息
 */
function getCurrentSemesterInfo() {
    if (window.currentSemester) {
        const cs = window.currentSemester;
        const startDate = cs.startDate
            ? `${cs.startDate.year}-${String(cs.startDate.monthOfYear).padStart(2, '0')}-${String(cs.startDate.dayOfMonth).padStart(2, '0')}`
            : null;
        const endDate = cs.endDate
            ? `${cs.endDate.year}-${String(cs.endDate.monthOfYear).padStart(2, '0')}-${String(cs.endDate.dayOfMonth).padStart(2, '0')}`
            : null;
        return {
            id: cs.id,
            name: cs.nameZh || cs.name,
            startDate: startDate,
            endDate: endDate,
            weekStartOnSunday: cs.weekStartOnSunday || false,
            schoolYear: cs.schoolYear,
        };
    }

    if (window.semesters && window.semesters.length > 0) {
        const semesterId = document.getElementById('allSemesters')?.value;
        const sem = semesterId
            ? window.semesters.find(s => s.id == semesterId)
            : window.semesters[0];
        if (sem) {
            return {
                id: sem.id,
                name: sem.nameZh || sem.name,
                startDate: sem.startDate,
                endDate: sem.endDate,
                weekStartOnSunday: sem.weekStartOnSunday || false,
                schoolYear: sem.schoolYear,
            };
        }
    }

    return null;
}

/**
 * 计算学期总周数
 */
function calculateTotalWeeks(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return 20;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.ceil(diffDays / 7);
}

// 星期映射
const DAY_MAP = {
    '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4,
    '星期五': 5, '星期六': 6, '星期日': 7,
};

// ============================================================
// 核心：解析 scheduleText 文本
// ============================================================

/**
 * 解析周次字符串，如 "2~15" → [2,3,...,15], "1" → [1]
 */
function parseWeekRange(weekStr) {
    const weeks = [];
    if (weekStr.includes('~')) {
        const parts = weekStr.split('~');
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        for (let i = start; i <= end; i++) {
            weeks.push(i);
        }
    } else {
        weeks.push(parseInt(weekStr, 10));
    }
    return weeks;
}

/**
 * 解析单条排课文本行
 *
 * 格式示例 (有教室):
 *   "1周 星期三 8~9节 成龙 1-A407"
 *   "2~15周 星期三 1~2节 成龙 1-B214"
 * 格式示例 (无教室，如网课/讲座):
 *   "11~12周 星期三 3~4节"
 */
function parseScheduleLine(line, lesson) {
    if (!line || !line.trim()) return [];

    // 正则匹配:
    //   (\d+(?:~\d+)?)周          - 周次 (如 "1" 或 "2~15")
    //   (星期[一二三四五六日])       - 星期几
    //   (\d+)~(\d+)节              - 节次范围
    //   (?:\s+(\S+))?(?:\s+(\S+))? - 可选的校区和教室 (有些课没有)
    const pattern = /(\d+(?:~\d+)?)周\s+(星期[一二三四五六日])\s+(\d+)~(\d+)节(?:\s+(\S+))?(?:\s+(\S+))?/;
    const match = line.match(pattern);

    if (!match) {
        console.warn('[教务适配] 无法解析排课行:', line);
        return [];
    }

    const weekStr = match[1];
    const dayText = match[2];
    const startSection = parseInt(match[3], 10);
    const endSection = parseInt(match[4], 10);
    const campus = match[5] || '';      // 可选
    const classroom = match[6] || '';   // 可选

    const weeks = parseWeekRange(weekStr);
    const day = DAY_MAP[dayText] || 1;

    // 课程名: lesson.course.nameZh
    const courseName = (lesson.course && lesson.course.nameZh) || lesson.nameZh || '未知课程';

    // 教师: lesson.teacherAssignmentString
    const teacher = lesson.teacherAssignmentString || '';

    // 教室位置
    const position = [campus, classroom].filter(Boolean).join(' ');

    return [{
        name: courseName,
        teacher: teacher,
        position: position,
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks,
        isCustomTime: false,
    }];
}

/**
 * 从 lesson 的 scheduleText 中解析所有排课条目
 */
function parseLessonScheduleText(lesson) {
    const courses = [];

    const scheduleText = lesson.scheduleText;
    if (!scheduleText) return courses;

    let rawText = '';
    if (scheduleText.dateTimePlaceText && scheduleText.dateTimePlaceText.text) {
        rawText = scheduleText.dateTimePlaceText.text;
    } else if (scheduleText.dateTimePlacePersonText && scheduleText.dateTimePlacePersonText.text) {
        rawText = scheduleText.dateTimePlacePersonText.text;
    } else if (scheduleText.dateTimeText && scheduleText.dateTimeText.text) {
        rawText = scheduleText.dateTimeText.text;
    }

    if (!rawText) return courses;

    // 按 "; \n" 或 ";\n" 拆分各行
    const lines = rawText.split(/;\s*\n\s*/).filter(line => line.trim());

    for (const line of lines) {
        const parsed = parseScheduleLine(line.trim(), lesson);
        courses.push(...parsed);
    }

    return courses;
}

// ============================================================
// 合并相同课程
// ============================================================

/**
 * 合并相同课程的周次
 */
function mergeCourseWeeks(courses) {
    const map = new Map();

    for (const course of courses) {
        const key = JSON.stringify({
            name: course.name,
            teacher: course.teacher,
            position: course.position,
            day: course.day,
            startSection: course.startSection,
            endSection: course.endSection,
        });

        if (map.has(key)) {
            const existing = map.get(key);
            const mergedWeeks = new Set([...existing.weeks, ...course.weeks]);
            existing.weeks = Array.from(mergedWeeks).sort((a, b) => a - b);
        } else {
            map.set(key, { ...course });
        }
    }

    return Array.from(map.values());
}

// ============================================================
// 数据获取
// ============================================================

/**
 * 通过 AJAX 获取课程数据
 */
function fetchCourseData(semesterId) {
    return new Promise((resolve, reject) => {
        const url = CONTEXT_PATH + '/for-std/course-table/get-data';
        const data = {
            bizTypeId: BIZ_TYPE_ID,
            semesterId: semesterId,
            dataId: window.studentIds ? window.studentIds[0] : window.personId,
        };

        console.log('[教务适配] 正在请求课程数据...', { url, data });

        $.ajax({
            url: url,
            type: 'GET',
            data: data,
            success: function (res) {
                console.log('[教务适配] 成功获取课程数据，包含 ' + (res.lessons?.length || 0) + ' 门课程');
                resolve(res);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                console.error('[教务适配] 获取课程数据失败:', textStatus, errorThrown);
                reject(new Error('获取课程数据失败: ' + textStatus));
            },
        });
    });
}

// ============================================================
// 时间段配置 (狮子山|成龙校区课表)
// ============================================================

/**
 * 获取上课时间段配置
 */
function getDefaultTimeSlots() {
    return [
        { number: 1,  startTime: "08:10", endTime: "08:55" },
        { number: 2,  startTime: "09:00", endTime: "09:45" },
        { number: 3,  startTime: "10:10", endTime: "10:55" },
        { number: 4,  startTime: "11:05", endTime: "11:45" },
        { number: 5,  startTime: "11:50", endTime: "12:35" },
        { number: 6,  startTime: "12:40", endTime: "13:25" },
        { number: 7,  startTime: "13:30", endTime: "14:10" },
        { number: 8,  startTime: "14:10", endTime: "14:55" },
        { number: 9,  startTime: "15:00", endTime: "15:45" },
        { number: 10,  startTime: "16:10", endTime: "16:55" },
        { number: 11, startTime: "17:00", endTime: "17:45" },
        { number: 12, startTime: "18:00", endTime: "18:45" },
        { number: 13, startTime: "19:10", endTime: "19:55" },
        { number: 14, startTime: "20:00", endTime: "20:45" },
        { number: 15, startTime: "20:50", endTime: "21:35" },
    ];
}

// ============================================================
// 课表配置
// ============================================================

function getCourseConfig(semesterInfo) {
    const totalWeeks = semesterInfo?.startDate && semesterInfo?.endDate
        ? calculateTotalWeeks(semesterInfo.startDate, semesterInfo.endDate)
        : 20;

    return {
        semesterStartDate: semesterInfo?.startDate || null,
        semesterTotalWeeks: totalWeeks,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1,
    };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
    try {
        console.log('========================================');
        console.log('[教务适配] 开始执行 SICNU 教务系统适配');
        console.log('========================================');

        // 1. 获取学期信息
        const semesterInfo = getCurrentSemesterInfo();
        if (!semesterInfo) {
            throw new Error('无法获取学期信息，请确认已在课表页面');
        }
        console.log('[教务适配] 当前学期:', semesterInfo.name, '(id=' + semesterInfo.id + ')');
        console.log('[教务适配] 学期日期:', semesterInfo.startDate, '~', semesterInfo.endDate);

        // 2. 获取课程数据
        window.shiguangBridge.showToast('正在采集课程数据...');
        const data = await fetchCourseData(semesterInfo.id);

        if (!data || !data.lessons || data.lessons.length === 0) {
            throw new Error('未获取到课程数据，请确认已登录并选择了正确的学期');
        }

        // 3. 解析每门课的 scheduleText
        console.log('[教务适配] 开始解析 ' + data.lessons.length + ' 门课程...');
        let allCourses = [];

        for (const lesson of data.lessons) {
            const courses = parseLessonScheduleText(lesson);
            if (courses.length > 0) {
                const courseName = (lesson.course && lesson.course.nameZh) || lesson.nameZh;
                console.log('[教务适配] ' + courseName + ': 解析出 ' + courses.length + ' 条排课记录');
                allCourses.push(...courses);
            } else {
                const courseName = (lesson.course && lesson.course.nameZh) || lesson.nameZh || '(未知)';
                console.warn('[教务适配] ' + courseName + ' (id=' + lesson.id + '): 未能解析出排课记录');
                // 输出 lesson 的 scheduleText 原始内容供调试
                if (lesson.scheduleText) {
                    console.log('  scheduleText 内容:', JSON.stringify(lesson.scheduleText));
                } else {
                    console.log('  lesson 没有 scheduleText 字段, keys:', Object.keys(lesson));
                }
            }
        }

        console.log('[教务适配] 解析得到 ' + allCourses.length + ' 条课程记录');

        // 4. 合并相同课程的周次
        allCourses = mergeCourseWeeks(allCourses);
        console.log('[教务适配] 合并后共 ' + allCourses.length + ' 条课程记录');

        if (allCourses.length === 0) {
            throw new Error('未能解析出任何课程数据。请查看控制台日志。');
        }

        // 输出课程样本
        console.log('[教务适配] 课程样本 (前5条):');
        allCourses.slice(0, 5).forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.name} | ${c.teacher} | ${c.position} | 周${c.day} | ${c.startSection}-${c.endSection}节 | 周次:${c.weeks.join(',')}`);
        });

        // 5. 时间段配置
        const timeSlots = getDefaultTimeSlots();

        // 6. 课表配置
        const config = getCourseConfig(semesterInfo);

        console.log('[教务适配] 准备导入:');
        console.log('  - 课程数:', allCourses.length);
        console.log('  - 时间段数:', timeSlots.length);
        console.log('  - 学期总周数:', config.semesterTotalWeeks);
        console.log('  - 开学日期:', config.semesterStartDate);

        // 7. 导入数据
        window.shiguangBridge.showToast(`正在导入 ${allCourses.length} 门课程...`);

        const courseResult = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(allCourses)
        );
        console.log('[教务适配] 课程导入结果:', courseResult);

        const timeSlotResult = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(timeSlots)
        );
        console.log('[教务适配] 时间段导入结果:', timeSlotResult);

        const configResult = await window.shiguangBridgePromise.saveCourseConfig(
            JSON.stringify(config)
        );
        console.log('[教务适配] 配置导入结果:', configResult);

        // 8. 触发下载
        console.log('[教务适配] ✅ 所有数据导入完成，触发下载...');
        window.shiguangBridge.showToast('课程数据采集完成！请保存下载的文件。');
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error('[教务适配] ❌ 执行失败:', error.message);
        console.error(error.stack);
        window.shiguangBridge.showToast('采集失败: ' + error.message);
    }
}

// 启动
main();
