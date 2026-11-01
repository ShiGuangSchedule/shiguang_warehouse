// 广东交通职业技术学院强智教务拾光适配脚本
// 适配作者：小漫君
// 接口与字段参考拾光 HNIU/hniu_01.js、HHTC/hhtc.js；悬浮详情处理参考 NJFU/njfu_01.js。
// 周次与教学周历解析、合并去重沿用 QFNU/qfnu_01.js（Yumu-banxia）及官方 Wiki。
// 校区选择、按教学楼设置课程独立时间参考 GDOU/gdou.js（Mccurtain）。
// 上游：https://github.com/ShiGuangSchedule/shiguang_warehouse/tree/pending/resources
// 以上参考实现按上游 MIT 许可复用；本校使用已确认的 xskb_list.do 接口与详表结构。

const GDCP_TIMETABLE_URL = 'https://jw.gdcp.edu.cn/jsxsd/xskb/xskb_list.do';
const GDCP_CALENDAR_URL = 'https://jw.gdcp.edu.cn/jsxsd/jxzl/jxzl_query';

// 来源：学校《各校区上课作息时间表（新）》（用户提供）。
// 第 7～8、9～10、11～12 节各为 80 分钟连堂，网格按每小节 40 分钟连续排列；课程保留整段实际时间。
const GDCP_TIME_SLOTS = [
    { number: 1, startTime: '08:30', endTime: '09:10' },
    { number: 2, startTime: '09:15', endTime: '09:55' },
    { number: 3, startTime: '10:10', endTime: '10:50' },
    { number: 4, startTime: '10:55', endTime: '11:35' },
    { number: 5, startTime: '14:15', endTime: '14:55' },
    { number: 6, startTime: '15:00', endTime: '15:40' },
    { number: 7, startTime: '15:55', endTime: '16:35' },
    { number: 8, startTime: '16:35', endTime: '17:15' },
    { number: 9, startTime: '18:05', endTime: '18:45' },
    { number: 10, startTime: '18:45', endTime: '19:25' },
    { number: 11, startTime: '19:40', endTime: '20:20' },
    { number: 12, startTime: '20:20', endTime: '21:00' }
];
const GDCP_LATE_MORNING = [
    { number: 3, startTime: '10:30', endTime: '11:10' },
    { number: 4, startTime: '11:15', endTime: '11:55' }
];
const GDCP_CAMPUSES = [
    // 轨道楼（16#）未列入原表；用户明确确认第 3、4 节使用 10:10 起的作息。
    { name: '天河校区', early: ['9号楼', '10号楼', '12号楼', '图书馆', '公路楼', '汽车实训楼', '轨道楼'], late: ['2号楼', '运动场'] },
    { name: '花都校区', early: ['1号楼', '图书馆'], late: ['10号楼', '15号楼', '16号楼', '运动场'] },
    { name: '国际校区', early: ['教学楼', '运动场'], late: [] },
    { name: '清远校区', early: ['厚德楼', '明德楼', '立业楼', '创新楼', '求是楼', '笃实楼'], late: ['融新楼', '融创楼', '运动场', '体育馆'] }
];

function applyCampusTimes(courses, campus) {
    return courses.map(function ({ building, ...course }) {
        if (course.startSection < 1 || course.endSection > GDCP_TIME_SLOTS.length) {
            throw new Error('学校作息表只提供第 1～12 节，课程“' + course.name + '”的节次超出范围。');
        }
        const slots = GDCP_TIME_SLOTS.slice();
        if (course.startSection <= 4 && course.endSection >= 3) {
            // 教务实测楼名含【】、编号前导零与校区后缀；操场对应学校作息表的运动场。
            const venue = building.replace(/[【】]/g, '').replace(/（(?:天河|花都|国际|清远)）$/, '')
                .replace(/^0+(\d+号楼)$/, '$1').replace(/^操场$/, '运动场');
            const matches = function (name) { return venue === name || venue.startsWith(name + '（'); };
            if (!campus.early.some(matches)) {
                // 国际校区的“其他区域”是学校表格明确规定的第二套作息。
                if (!campus.late.some(matches) && campus.name !== '国际校区') {
                    throw new Error(campus.name + '的“' + building + '”未列入学校作息表，无法确定第 3、4 节时间。');
                }
                slots[2] = GDCP_LATE_MORNING[0];
                slots[3] = GDCP_LATE_MORNING[1];
            }
        }
        // 学校将这三组小节分别视为一个完整时间块，不能按普通课间拆开。
        const startTime = course.startSection === 8 ? '15:55'
            : course.startSection === 10 ? '18:05'
            : course.startSection === 12 ? '19:40' : slots[course.startSection - 1].startTime;
        const endTime = course.endSection === 7 ? '17:15'
            : course.endSection === 9 ? '19:25'
            : course.endSection === 11 ? '21:00' : slots[course.endSection - 1].endTime;
        return {
            ...course,
            isCustomTime: true,
            customStartTime: startTime,
            customEndTime: endTime
        };
    });
}

async function fetchTimetableDoc(parameters) {
    const options = { credentials: 'include' };
    if (parameters !== undefined) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        options.body = parameters.toString();
    }
    const response = await fetch(GDCP_TIMETABLE_URL, options);
    if (!response.ok) throw new Error('课表请求失败（HTTP ' + response.status + '）。');
    return new DOMParser().parseFromString(await response.text(), 'text/html');
}

// 来源：QFNU/qfnu_01.js，保留原实现。
function parseWeeksAndSections(text) {
    const result = { weeks: [], sections: [] };
    const content = String(text || '').trim();
    if (!content) return result;

    const parity = /双/.test(content) ? 2 : (/单/.test(content) ? 1 : 0);
    const bracketIndex = content.indexOf('[');
    const cleaned = (bracketIndex >= 0 ? content.slice(0, bracketIndex) : content)
        .replace(/第/g, '')
        .replace(/至|到|~/g, '-')
        .replace(/[（(][^（）()]*[）)]/g, '')
        .replace(/周/g, '');

    cleaned.split(/[,，、;；\s]+/).forEach(function (segment) {
        const item = segment.trim();
        const range = item.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (range) {
            for (let week = parseInt(range[1], 10); week <= parseInt(range[2], 10); week++) result.weeks.push(week);
        } else if (/^\d+$/.test(item)) {
            result.weeks.push(parseInt(item, 10));
        }
    });

    if (parity) {
        result.weeks = result.weeks.filter(function (week) { return week % 2 === (parity === 1 ? 1 : 0); });
    }
    result.weeks = Array.from(new Set(result.weeks)).sort(function (a, b) { return a - b; });

    const sectionMatch = content.match(/\[([^\]]*)\]/);
    if (sectionMatch) {
        (sectionMatch[1].match(/\d+/g) || []).forEach(function (number) {
            const section = parseInt(number, 10);
            if (result.sections.indexOf(section) < 0) result.sections.push(section);
        });
        result.sections.sort(function (a, b) { return a - b; });
    }
    return result;
}


function parseTimetable(doc) {
    const table = doc.getElementById('timetable');
    if (!table) throw new Error('未获取到课表，请确认已登录新教务系统。');
    const courses = [];
    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const cells = row.querySelectorAll('td');
        if (cells.length !== 7) return;
        cells.forEach(function (cell, index) {
            const detail = cell.querySelector('div.kbcontent');
            if (!detail) throw new Error('课表详表结构不匹配。');
            const content = detail.cloneNode(true);
            // NJFU 同样移除重复的悬浮信息，只解析详表中的课程字段。
            content.querySelectorAll('.item-box').forEach(function (node) { node.remove(); });
            if (!content.textContent.trim()) return;
            content.innerHTML.split(/-{10,}\s*<br\s*\/?>/i).forEach(function (html) {
                const block = doc.createElement('div');
                block.innerHTML = html;
                const name = block.querySelector('font:not([title])');
                const teacher = block.querySelector('font[title="教师"]');
                const time = block.querySelector('font[title="周次(节次)"]');
                const position = block.querySelector('font[title="教室"]');
                const building = block.querySelector('font[title="教学楼"]');
                if (!name || !teacher || !time || !position || !building) throw new Error('课程字段结构不匹配。');
                const parsed = parseWeeksAndSections(time.textContent);
                if (!name.textContent.trim() || parsed.weeks.length === 0 || parsed.sections.length === 0) {
                    throw new Error('课程名称、周次或节次为空。');
                }
                courses.push({
                    name: name.textContent.trim(),
                    teacher: teacher.textContent.trim(),
                    position: position.textContent.trim(),
                    building: building.textContent.trim(),
                    day: index + 1,
                    weeks: parsed.weeks,
                    startSection: parsed.sections[0],
                    endSection: parsed.sections[parsed.sections.length - 1]
                });
            });
        });
    });
    return courses;
}

// 来源：QFNU/qfnu_01.js / 官方 Wiki《课程合并与去重函数》，保留原实现。
// https://github.com/ShiGuangSchedule/shiguangschedule/wiki/课程合并与去重函数
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
            (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let merged = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const next = step1Merged[i];

        const isSameCourseAndSection =
            merged.name === next.name &&
            merged.teacher === next.teacher &&
            merged.position === next.position &&
            merged.day === next.day &&
            merged.startSection === next.startSection &&
            merged.endSection === next.endSection;

        if (isSameCourseAndSection) {
            merged.weeks = Array.from(new Set([...merged.weeks, ...next.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(merged);
            merged = next;
        }
    }
    step2Merged.push(merged);

    return step2Merged;
}


// 教学周历解析来源：QFNU/qfnu_01.js（Yumu-banxia），保留原实现。
function parseCalendar(doc) {
    const result = { semesterStartDate: null, totalWeeks: null };
    const table = doc.querySelector('table');
    if (!table) return result;

    const toDate = function (text) {
        const match = String(text || '').match(/(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})/);
        return match ? match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0') : null;
    };

    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const cells = Array.from(row.children);
        const first = cells.length > 0 ? String(cells[0].textContent).trim() : '';
        if (!/^\d+$/.test(first)) return;

        const week = parseInt(first, 10);
        result.totalWeeks = result.totalWeeks === null ? week : Math.max(result.totalWeeks, week);
        if (week === 1 && !result.semesterStartDate && cells.length > 1) {
            result.semesterStartDate = toDate(cells[1].getAttribute('title')) || toDate(cells[1].textContent);
        }
    });
    return result;
}

async function fetchCourseConfig(semesterValue) {
    const response = await fetch(GDCP_CALENDAR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ xnxq01id: semesterValue }).toString(),
        credentials: 'include'
    });
    if (!response.ok) throw new Error('教学周历请求失败（HTTP ' + response.status + '）。');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.getElementById('xnxq01id')?.value !== semesterValue) throw new Error('返回周历与所选学期不一致。');
    const calendar = parseCalendar(doc);
    if (!calendar.semesterStartDate || !Number.isInteger(calendar.totalWeeks) || calendar.totalWeeks < 1) {
        throw new Error('教学周历未提供完整的首周日期或总周数。');
    }
    const monday = new Date(calendar.semesterStartDate + 'T00:00:00Z');
    if (Number.isNaN(monday.getTime()) || monday.toISOString().slice(0, 10) !== calendar.semesterStartDate || monday.getUTCDay() !== 1) {
        throw new Error('教学周历第 1 周的星期一日期无效。');
    }
    return {
        semesterStartDate: calendar.semesterStartDate,
        semesterTotalWeeks: calendar.totalWeeks,
        firstDayOfWeek: 1,
        defaultClassDuration: 40,
        defaultBreakDuration: 5
    };
}

async function runImportFlow() {
    try {
        if (window.location.origin !== 'https://jw.gdcp.edu.cn') {
            await window.shiguangBridgePromise.showAlert('请进入新教务系统', '请先登录融合门户，打开“新教务系统”后再导入。', '知道了');
            return;
        }
        window.shiguangBridge.showToast('正在获取学期信息…');
        const initialDoc = await fetchTimetableDoc();
        const semesterSelect = initialDoc.getElementById('xnxq01id');
        const modeSelect = initialDoc.getElementById('kbjcmsid');
        if (!semesterSelect || semesterSelect.options.length === 0 || !modeSelect || !modeSelect.value) {
            throw new Error('未获取到学期或节次模式，请确认教务登录状态。');
        }
        const semesters = Array.from(semesterSelect.options);
        const picked = await window.shiguangBridgePromise.showSingleSelection(
            '选择学期', JSON.stringify(semesters.map(function (option) { return option.textContent.trim(); })), semesterSelect.selectedIndex
        );
        if (picked === null) return;
        if (!Number.isInteger(picked) || picked < 0 || picked >= semesters.length) throw new Error('学期选择无效。');

        const parameters = new URLSearchParams({
            cj0701id: '', zc: '', demo: '', xnxq01id: semesters[picked].value, sfFD: '1', kbjcmsid: modeSelect.value
        });
        window.shiguangBridge.showToast('正在获取整学期课表…');
        const doc = await fetchTimetableDoc(parameters);
        if (doc.getElementById('xnxq01id')?.value !== semesters[picked].value) throw new Error('返回课表与所选学期不一致。');
        const parsedCourses = mergeAndDistinctCourses(parseTimetable(doc));
        if (parsedCourses.length === 0) {
            await window.shiguangBridgePromise.showAlert('该学期暂无课程', '所选学期没有已排定上课时间的课程。', '知道了');
            return;
        }
        const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
            '选择上课校区', JSON.stringify(GDCP_CAMPUSES.map(function (campus) { return campus.name; })), 0
        );
        if (campusIndex === null) return;
        if (!Number.isInteger(campusIndex) || campusIndex < 0 || campusIndex >= GDCP_CAMPUSES.length) throw new Error('校区选择无效。');
        const courses = applyCampusTimes(parsedCourses, GDCP_CAMPUSES[campusIndex]);
        window.shiguangBridge.showToast('正在获取所选学期的教学周历…');
        const config = await fetchCourseConfig(semesters[picked].value);
        if (!await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config))) throw new Error('课表配置保存失败。');
        if (!await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(GDCP_TIME_SLOTS))) throw new Error('作息时间保存失败。');
        if (!await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses))) throw new Error('课程保存失败。');
        window.shiguangBridge.showToast('已获取 ' + courses.length + ' 条课程时段，请校对上课时间。');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert('导入失败', error.message, '知道了');
    }
}

runImportFlow();
