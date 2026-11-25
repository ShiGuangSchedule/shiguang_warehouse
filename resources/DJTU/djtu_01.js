// 大连交通大学 综合教务系统（jw.djtu.edu.cn）课程导入脚本
// 用法：在软件内打开教务登录页手动登录（含验证码），登录成功后点“执行导入”
// 数据来源：
//   currcourse.jsdo            本学期课程安排（课程、上课时间地点、上课大节名称）
//   showTimetable.do           个人课表逐节作息（仅沙河口校区）
//   studentWeeklyTimetable.do  学期总周数；周课表日期列反推第 1 周周一（教务无校历入口）
// 旅顺口校区作息使用内置表（第 1-11 节）

const DJTU_ORIGIN = 'http://jw.djtu.edu.cn';
const DJTU_URL_CURRCOURSE = '/academic/student/currcourse/currcourse.jsdo';
const DJTU_URL_TIMETABLE = '/academic/manager/coursearrange/showTimetable.do';
const DJTU_URL_WEEKLY = '/academic/manager/coursearrange/studentWeeklyTimetable.do';

// 学期：秋=2（第一学期）、春=1（第二学期）
const DJTU_TERMS = [
    { id: '2', name: '秋（第一学期）' },
    { id: '1', name: '春（第二学期）' }
];
const DJTU_CAMPUS_NAMES = ['沙河口校区', '旅顺口校区'];

const DJTU_CAMPUS_TIME_SLOTS = {
    '沙河口校区': [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:50', endTime: '09:35' },
        { number: 3, startTime: '10:00', endTime: '10:45' },
        { number: 4, startTime: '10:50', endTime: '11:35' },
        { number: 5, startTime: '13:30', endTime: '14:15' },
        { number: 6, startTime: '14:20', endTime: '15:05' },
        { number: 7, startTime: '15:25', endTime: '16:10' },
        { number: 8, startTime: '16:15', endTime: '17:00' },
        { number: 9, startTime: '18:00', endTime: '18:45' },
        { number: 10, startTime: '18:46', endTime: '19:30' },
        { number: 11, startTime: '19:35', endTime: '20:20' }
    ],
    '旅顺口校区': [
        { number: 1, startTime: '08:25', endTime: '09:10' },
        { number: 2, startTime: '09:15', endTime: '10:00' },
        { number: 3, startTime: '10:25', endTime: '11:10' },
        { number: 4, startTime: '11:15', endTime: '12:00' },
        { number: 5, startTime: '13:35', endTime: '14:20' },
        { number: 6, startTime: '14:25', endTime: '15:10' },
        { number: 7, startTime: '15:25', endTime: '16:10' },
        { number: 8, startTime: '16:15', endTime: '17:00' },
        { number: 9, startTime: '18:00', endTime: '18:45' },
        { number: 10, startTime: '18:45', endTime: '19:30' },
        { number: 11, startTime: '19:35', endTime: '20:20' }
    ]
};

// 合并空白（含全角空格、不换行空格）
function djtuClean(text) {
    return String(text || '').replace(/[\u00a0\u3000\s]+/g, ' ').trim();
}

// 取页面并按 GBK 解码
async function djtuFetchDoc(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
    return new DOMParser().parseFromString(text, 'text/html');
}

// 周次文本 -> 周次数组，支持“5,7-16周”“5-15(单)周”
function djtuParseWeeks(text) {
    const weeks = [];
    djtuClean(text).replace(/[周第]/g, '').split(/[,，]/).forEach(function (seg) {
        const range = seg.match(/^(\d+)(?:\s*-\s*(\d+))?/);
        if (!range) return;
        const onlyOdd = /单/.test(seg);
        const onlyEven = /双/.test(seg);
        for (let w = +range[1]; w <= +(range[2] || range[1]); w++) {
            if (onlyOdd && w % 2 === 0) continue;
            if (onlyEven && w % 2 === 1) continue;
            weeks.push(w);
        }
    });
    return weeks;
}

// “星期三” -> 3
function djtuParseDay(text) {
    const match = djtuClean(text).match(/[一二三四五六日天]/);
    const days = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    return match ? days[match[0]] : 0;
}

// “3、4节” / “1-3节” -> 起止节次；“上午”等大节名由 bigSections 映射
function djtuParseSections(text, bigSections) {
    const numbers = (djtuClean(text).match(/\d+/g) || []).map(Number);
    if (numbers.length > 0) {
        return { startSection: Math.min.apply(null, numbers), endSection: Math.max.apply(null, numbers) };
    }
    return bigSections[djtuClean(text)] || null;
}

// 上课大节表（列序：序号、名称、包含小节、时间）-> {名称: {startSection, endSection}}
function djtuParseBigSections(doc) {
    const map = {};
    const table = doc.querySelectorAll('table.infolist_tab')[1];
    Array.prototype.slice.call(table.querySelectorAll(':scope > tbody > tr, :scope > tr'), 1).forEach(function (row) {
        const cells = row.querySelectorAll(':scope > td');
        const section = djtuParseSections(cells[2].textContent, {});
        if (section) map[djtuClean(cells[1].textContent)] = section;
    });
    return map;
}

// 课程表（列序：课程号、课程序号、课程名称、任课教师、学分、…、上课时间地点在第 10 列）
function djtuParseCourses(doc, bigSections) {
    const courses = [];
    const skipped = [];
    const table = doc.querySelectorAll('table.infolist_tab')[0];
    Array.prototype.slice.call(table.querySelectorAll(':scope > tbody > tr, :scope > tr'), 1).forEach(function (row) {
        const cells = row.querySelectorAll(':scope > td');
        const name = djtuClean(cells[2].textContent);
        const teacher = Array.prototype.map.call(cells[3].querySelectorAll('a'), function (a) {
            return djtuClean(a.textContent);
        }).join('/') || djtuClean(cells[3].textContent);
        const credit = parseFloat(djtuClean(cells[4].textContent)) || 0;

        // “上课时间、地点”为内嵌子表，每行：周次 / 星期 / 节次 / 地点
        const blocks = Array.prototype.map.call(cells[9].querySelectorAll('table tr'), function (tr) {
            const c = tr.querySelectorAll(':scope > td');
            return {
                weeks: djtuParseWeeks(c[0].textContent),
                day: djtuParseDay(c[1].textContent),
                section: djtuParseSections(c[2].textContent, bigSections),
                position: djtuClean(c[3].textContent)
            };
        }).filter(function (b) { return b.weeks.length && b.day && b.section; });

        if (blocks.length === 0) {
            skipped.push(name);
            return;
        }
        blocks.forEach(function (b) {
            courses.push({
                name: name, teacher: teacher, position: b.position, day: b.day,
                startSection: b.section.startSection, endSection: b.section.endSection,
                weeks: b.weeks, credit: credit
            });
        });
    });
    return { courses: courses, skipped: skipped };
}

// 课程合并与去重：原样采用 wiki《课程合并与去重函数》参考实现（保留 credit 字段由调用方补回）
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 按天、课程名、教师、地点将课程分组，相同课程的记录归入同一组
    const grouped = {};
    courses.forEach(c => {
        const name = c.name || '';
        const teacher = c.teacher || '';
        const position = c.position || '';
        const day = c.day || 0;

        // 构造唯一标识，用于识别是否为同一门课
        const key = `${day}|${name}|${teacher}|${position}`;

        if (!grouped[key]) {
            grouped[key] = {
                name, teacher, position, day,
                // 记录每周对应的节次段，结构如 { 8: [ {start: 5, end: 6}, {start: 7, end: 8} ] }
                weeksMap: {},
                credit: c.credit
            };
        }

        // 将该记录覆盖的所有周次拆开，分别记录对应周的节次段
        const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
        weeksArr.forEach(w => {
            if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
            grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
        });
    });

    const finalResult = [];

    // 逐组处理每门课程
    Object.values(grouped).forEach(group => {
        // 获取该课程有课的所有周次，升序排列
        const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);

        // 记录每周合并后的最终节次段，结构如 { 8: [ {start: 5, end: 8} ] }
        const processedWeeksMap = {};

        sortedWeeks.forEach(w => {
            let parts = group.weeksMap[w];

            // 按开始节次和结束节次排序，确保合并顺序正确
            parts.sort((a, b) => a.start - b.start || a.end - b.end);

            // 合并该周内连续或重叠的节次段
            const mergedParts = [];
            let cur = parts[0];
            for (let i = 1; i < parts.length; i++) {
                // 如果当前节次段与下一段相邻或重叠，则延长当前段
                if (cur.end + 1 >= parts[i].start) {
                    cur.end = Math.max(cur.end, parts[i].end);
                } else {
                    mergedParts.push(cur);
                    cur = parts[i];
                }
            }
            mergedParts.push(cur);
            processedWeeksMap[w] = mergedParts;
        });

        // 将节次结构完全相同的周次归为一组
        // 结构如 { "节次签名字符串": { sections: [...], weeks: [] } }
        const sectionsMap = {};

        sortedWeeks.forEach(w => {
            const parts = processedWeeksMap[w];
            // 将当前周的所有节次段组合成字符串签名，如 "1-2|5-6"
            const sig = parts.map(p => `${p.start}-${p.end}`).join('|');

            if (!sectionsMap[sig]) {
                sectionsMap[sig] = { sections: parts, weeks: [] };
            }
            sectionsMap[sig].weeks.push(w);
        });

        // 将每组相同节次结构的周次生成对应的课程对象
        Object.values(sectionsMap).forEach(secGroup => {
            secGroup.sections.forEach(sec => {
                finalResult.push({
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection: sec.start,
                    endSection: sec.end,
                    weeks: secGroup.weeks,
                    credit: group.credit
                });
            });
        });
    });

    // 按星期、开始节次、课程名、起始周排序，保证输出结果顺序稳定
    finalResult.sort((a, b) => {
        return (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               a.name.localeCompare(b.name) ||
               a.weeks[0] - b.weeks[0];
    });

    return finalResult;
}

// 个人课表作息：表头形如“第1节 08:00 - 08:45”
function djtuParseTimeSlots(doc) {
    const slots = [];
    doc.querySelectorAll('#timetable tr').forEach(function (row) {
        const head = row.querySelector('th');
        if (!head) return;
        const text = djtuClean(head.textContent);
        const section = text.match(/第\s*(\d+)\s*节/);
        const times = text.match(/\d{1,2}:\d{2}/g);
        if (section && times && times.length >= 2) {
            slots.push({ number: +section[1], startTime: times[0].padStart(5, '0'), endTime: times[1].padStart(5, '0') });
        }
    });
    return slots.sort(function (a, b) { return a.number - b.number; });
}

// 周课表日期列（td[name="td0"]）的首个日期 + 所在周次 -> 第 1 周周一（YYYY-MM-DD）
function djtuStartDateFromWeek(doc, week) {
    const match = djtuClean(doc.querySelector('td[name="td0"]').textContent).match(/(\d{4})-(\d{2})-(\d{2})/);
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() || 7) - 1) - (week - 1) * 7);
    return date.toISOString().slice(0, 10);
}

// 日期是否合法（挡掉 2026-02-30 这类不存在的日期）
function djtuIsValidDate(text) {
    const d = new Date(text + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// 学年输入校验（全局函数，供 showPrompt 调用）
function djtuValidateYear(input) {
    return /^\d{4}$/.test(String(input).trim()) ? false : '请输入四位数字的学年！';
}

// 日期输入校验（全局函数，供 showPrompt 调用）
function djtuValidateDate(input) {
    return djtuIsValidDate(djtuClean(input)) ? false : '请输入正确的日期，示例：2026-08-24';
}

// 学年输入：返回 yearid；取消返回 null
async function djtuAskYear(yearid) {
    const input = await window.shiguangBridgePromise.showPrompt(
        '选择学年', '请输入要导入课程的学年（例如 2026-2027 学年请输入 2026）：',
        String(+yearid + 1980), 'djtuValidateYear');
    return input === null ? null : String(parseInt(input, 10) - 1980);
}

// 学期选择：返回 termid；取消返回 null
async function djtuAskTerm(termid) {
    const index = await window.shiguangBridgePromise.showSingleSelection(
        '请选择学期', JSON.stringify(DJTU_TERMS.map(function (t) { return t.name; })),
        DJTU_TERMS.findIndex(function (t) { return t.id === termid; }));
    return index === null ? null : DJTU_TERMS[index].id;
}

// 开始日期无法推算时询问，返回 YYYY-MM-DD；取消返回 null
async function djtuAskStartDate() {
    const input = await window.shiguangBridgePromise.showPrompt(
        '请填写学期开始日期', '未能自动推算学期开始日期，请填写第 1 周的周一（格式：YYYY-MM-DD）：',
        '', 'djtuValidateDate');
    return input === null ? null : djtuClean(input);
}

async function runImportFlow() {
    window.shiguangBridge.showToast('正在读取教务系统数据，请稍候…');

    // 1. 当前登录学期；未登录时提示并停止
    const currentDoc = await djtuFetchDoc(DJTU_ORIGIN + DJTU_URL_CURRCOURSE);
    if (currentDoc.querySelector('input[name="j_username"]')) {
        await window.shiguangBridgePromise.showAlert('请先登录',
            '请先在本页面登录教务系统（需输入验证码），登录成功后再点击“执行导入”。', '知道了');
        return;
    }
    const ctrt = currentDoc.querySelector('[studentid][year][term]');
    const studentid = ctrt.getAttribute('studentid');
    let yearid = ctrt.getAttribute('year');
    let termid = ctrt.getAttribute('term');

    // 2. 导入范围：当前学期 / 其它学年学期（取消即停止）
    const scope = await window.shiguangBridgePromise.showSingleSelection('请选择要导入的学期',
        JSON.stringify(['导入当前学期（' + (+yearid + 1980) + ' 年 ' +
            DJTU_TERMS.filter(function (t) { return t.id === termid; })[0].name + '）', '选择其它学年学期']), 0);
    if (scope === null) return window.shiguangBridge.showToast('导入已取消。');
    if (scope === 1) {
        yearid = await djtuAskYear(yearid);
        if (yearid === null) return window.shiguangBridge.showToast('导入已取消。');
        termid = await djtuAskTerm(termid);
        if (termid === null) return window.shiguangBridge.showToast('导入已取消。');
    }

    // 3. 校区（决定作息时间）；取消即停止
    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        '请选择校区（两校区作息时间不同）', JSON.stringify(DJTU_CAMPUS_NAMES), 0);
    if (campusIndex === null) return window.shiguangBridge.showToast('导入已取消。');
    const campus = DJTU_CAMPUS_NAMES[campusIndex];

    // 4. 课程
    const doc = await djtuFetchDoc(DJTU_ORIGIN + DJTU_URL_CURRCOURSE + '?year=' + yearid + '&term=' + termid);
    const parsed = djtuParseCourses(doc, djtuParseBigSections(doc));
    if (parsed.courses.length === 0) {
        return window.shiguangBridge.showToast('该学期没有可导入的课程。');
    }
    if (parsed.skipped.length > 0) {
        window.shiguangBridge.showToast('以下教学环节没有上课时间，未导入：' + parsed.skipped.join('、'));
    }
    const courses = mergeAndDistinctCourses(parsed.courses);

    // 5. 作息：沙河口取教务页面数据，旅顺口用内置表
    let timeSlots = DJTU_CAMPUS_TIME_SLOTS[campus];
    if (campus === DJTU_CAMPUS_NAMES[0]) {
        const pageSlots = djtuParseTimeSlots(await djtuFetchDoc(DJTU_ORIGIN + DJTU_URL_TIMETABLE +
            '?id=' + studentid + '&yearid=' + yearid + '&termid=' + termid + '&timetableType=STUDENT&sectionType=BASE'));
        if (pageSlots.length > 0) timeSlots = pageSlots;
    }

    // 6. 周数与开始日期：周课表默认显示当前周，日期列反推第 1 周周一
    const weekDoc = await djtuFetchDoc(DJTU_ORIGIN + DJTU_URL_WEEKLY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'yearid=' + yearid + '&termid=' + termid
    });
    const select = weekDoc.querySelector('select[name="whichWeek"]');
    const totalWeeks = Math.max.apply(null, Array.prototype.map.call(select.querySelectorAll('option'), function (o) {
        return +o.value || 0;
    }));
    const currentWeek = +select.querySelector('option[selected]').getAttribute('value');
    let startDate = djtuStartDateFromWeek(weekDoc, currentWeek);
    if (!startDate) startDate = await djtuAskStartDate();
    if (startDate === null) return window.shiguangBridge.showToast('导入已取消。');

    // 7. 保存：配置 -> 课程 -> 时间段（时间段失败不阻断）
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterTotalWeeks: totalWeeks, semesterStartDate: startDate
    }));
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast('时间段导入失败：' + error.message);
    }

    window.shiguangBridge.showToast('导入完成：' + courses.length + ' 个上课时段，共 ' + totalWeeks + ' 周。');
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow().catch(function (error) {
    window.shiguangBridge.showToast('导入失败：' + error.message);
});
