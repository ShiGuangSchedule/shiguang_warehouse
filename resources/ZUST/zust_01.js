// 浙江科技大学（zust.edu.cn）正方 V9 教务适配
// 适配作者 / 维护者：小漫君
// 接口及桥接选择参考 resources/JSEI/jsei_01.js（星河欲转）；保留原 CJLU（ying-ck、salt-fishes）方案来源。
// 本文件沿用仓库 MIT 许可证。

function zustToast(message) {
    window.shiguangBridge.showToast(message);
}

function zustConfirmed(value) {
    return value === true || value === 'true';
}

function zustText(value) {
    return String(value == null ? '' : value).trim();
}

function zustBaseUrl() {
    const host = window.location.hostname;
    if (host !== 'https-newjwxt-zust-edu-cn-443.webvpn.zust.edu.cn' && host !== 'newjwxt.zust.edu.cn') {
        throw new Error('请登录 WebVPN，点击“教务系统”，进入教学管理信息服务平台后再导入。');
    }
    return window.location.origin + '/jwglxt/';
}

async function zustRequest(path, params, json = true) {
    const url = new URL(zustBaseUrl() + path);
    for (const key in params) url.searchParams.set(key, params[key]);
    const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: json ? 'application/json' : 'text/html' }
    });
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '），请稍后重试。');
    const text = await response.text();
    if (/authserver\/|login_slogin|site-nav\//i.test(response.url || '') || /<title[^>]*>\s*统一身份认证/.test(text)) {
        throw new Error('登录已过期，请通过 WebVPN 重新进入教务系统。');
    }
    if (!json) return text;
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error('教务未返回有效数据，请确认已经进入教务系统并重新登录。');
    }
}

async function zustSelect(title, entries, defaultIndex) {
    const labels = [];
    for (const entry of entries) labels.push(entry.label);
    const value = await window.shiguangBridgePromise.showSingleSelection(title, JSON.stringify(labels), defaultIndex);
    if (value === null || value === undefined || value === 'null' || value === -1 || value === '-1') return null;
    if (!/^\d+$/.test(String(value)) || !entries[Number(value)]) throw new Error('学期或校区选择无效，请重新导入。');
    return entries[Number(value)];
}

async function zustFetchAcademicOptions() {
    const html = await zustRequest('kbcx/xskbcx_cxXskbcxIndex.html', { gnmkdm: 'N2151', layout: 'default' }, false);
    const responseDoc = new DOMParser().parseFromString(html, 'text/html');
    const read = function (selector) {
        const entries = [];
        for (const option of responseDoc.querySelectorAll(selector + ' option')) {
            if (!option.disabled && option.value.trim()) entries.push({ value: option.value.trim(), label: option.textContent.trim(), selected: option.selected });
        }
        if (entries.length === 0) throw new Error('未取得教务返回的学年学期列表，请确认登录状态。');
        return entries;
    };
    return { years: read('#xnm'), terms: read('#xqm') };
}

async function zustFetchCourses(semester) {
    const params = { gnmkdm: 'N2151', xnm: semester.year, xqm: semester.term, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' };
    return zustRequest('kbcx/xskbcx_cxXsgrkb.html', params);
}

async function zustChooseSemester() {
    const options = await zustFetchAcademicOptions();
    let yearIndex = 0, termIndex = 0;
    for (let i = 0; i < options.years.length; i++) if (options.years[i].selected) yearIndex = i;
    for (let i = 0; i < options.terms.length; i++) if (options.terms[i].selected) termIndex = i;
    const make = function (year, term) { return { year: year.value, term: term.value, label: year.label + ' 第 ' + term.label + ' 学期' }; };
    const defaultSelection = make(options.years[yearIndex], options.terms[termIndex]);
    const action = await zustSelect('选择导入学期', [
        { label: defaultSelection.label, value: 'current' },
        { label: '更换学年、学期', value: 'change' }
    ], 0);
    if (!action) return null;
    if (action.value === 'current') return defaultSelection;
    const year = await zustSelect('选择学年', options.years, yearIndex);
    if (!year) return null;
    const term = await zustSelect('选择学期', options.terms, termIndex);
    return term ? make(year, term) : null;
}

function zustParseWeeks(value) {
    const text = zustText(value).replace(/[第周\s]/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[，、]/g, ',');
    const weeks = new Set();
    for (const part of text.split(',')) {
        const match = part.match(/^(\d+)(?:-(\d+))?(?:\(([单双])\))?$/);
        if (!match) throw new Error('无法识别课程周次，请核对教务课表。');
        const start = Number(match[1]), end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > 60) throw new Error('课程周次超出有效范围。');
        for (let week = start; week <= end; week++) {
            if (match[3] === '单' && week % 2 === 0) continue;
            if (match[3] === '双' && week % 2 === 1) continue;
            weeks.add(week);
        }
    }
    if (weeks.size === 0) throw new Error('课程周次为空。');
    return Array.from(weeks).sort((a, b) => a - b);
}

function zustParseCourses(data, semester) {
    if (!data || !Array.isArray(data.kbList) || !data.xsxx ||
        zustText(data.xsxx.XNM) !== semester.year || zustText(data.xsxx.XQM) !== semester.term) {
        throw new Error('课表响应与所选学期不一致，请重新进入教务系统。');
    }
    const courses = [], campuses = new Map();
    // 接口已返回连续节次，保留每条记录的周次与地点，不合并换教室后的课程。
    for (const row of data.kbList) {
        const name = zustText(row.kcmc), day = Number(row.xqj);
        const section = zustText(row.jcs).match(/^(\d+)(?:-(\d+))?$/);
        const campusId = zustText(row.xqh_id), campusName = zustText(row.xqmc);
        if (!name || !Number.isInteger(day) || day < 1 || day > 7 || !section || !campusId || !campusName) {
            throw new Error('课程名称、星期、节次或校区缺失，请核对教务课表。');
        }
        const startSection = Number(section[1]), endSection = Number(section[2] || section[1]);
        if (startSection < 1 || endSection < startSection || endSection > 30) throw new Error('课程节次无效。');
        const course = {
            name: name,
            teacher: zustText(row.xm),
            position: campusName + (zustText(row.cdmc) ? ' ' + zustText(row.cdmc) : ''),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: zustParseWeeks(row.zcd)
        };
        if (zustText(row.xf) !== '') {
            const credit = Number(row.xf);
            if (!Number.isFinite(credit) || credit < 0) throw new Error('课程学分无效。');
            course.credit = credit;
        }
        courses.push({ course: course, campusId: campusId });
        campuses.set(campusId, campusName);
    }
    if (courses.length === 0) throw new Error('该学期没有固定时间的课程，请更换学期或等待排课。');
    if (!Array.isArray(data.sjkList)) throw new Error('教务未返回完整的未排课信息，请重试。');
    return { courses: courses, campuses: campuses, unscheduled: data.sjkList };
}

function zustParseCalendar(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('未取得所选学期的校历。');
    const weeks = [];
    for (const row of rows) {
        if (!/^\d+$/.test(zustText(row.zs))) throw new Error('校历周次格式异常。');
        const match = zustText(row.rq).match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
        if (!match) throw new Error('校历日期格式异常。');
        weeks.push({ number: Number(row.zs), start: match[1], end: match[2] });
    }
    weeks.sort((a, b) => a.number - b.number);
    if (weeks.length > 60) throw new Error('校历周数超出有效范围。');
    let firstDate = null;
    for (let i = 0; i < weeks.length; i++) {
        const week = weeks[i], start = new Date(week.start + 'T00:00:00Z'), end = new Date(week.end + 'T00:00:00Z');
        if (week.number !== i + 1 || isNaN(start.getTime()) || isNaN(end.getTime()) ||
            start.toISOString().slice(0, 10) !== week.start || end.toISOString().slice(0, 10) !== week.end ||
            start.getUTCDay() !== 1 || end < start || end - start > 6 * 86400000 ||
            (i < weeks.length - 1 && end - start !== 6 * 86400000)) throw new Error('校历周次或日期不连续。');
        if (i === 0) firstDate = start;
        if (start - firstDate !== i * 7 * 86400000) throw new Error('校历日期与教学周不对应。');
    }
    // 校历接口的范围包含假期；如实保存，不从课程最大周次猜测总周数。
    return { semesterStartDate: weeks[0].start, semesterTotalWeeks: weeks.length, firstDayOfWeek: 1 };
}

function zustClock(value) {
    const match = zustText(value).match(/^(\d{2}):(\d{2})(?::00)?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('作息时间格式异常。');
    return match[1] + ':' + match[2];
}

function zustParseTimeSlots(rows, campusId) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('未取得课程所属校区的作息。');
    const slots = [], numbers = new Map();
    for (const row of rows) {
        if (zustText(row.xqh_id) !== campusId || !/^\d+$/.test(zustText(row.jcmc))) throw new Error('作息校区或节次与请求不一致。');
        const slot = { number: Number(row.jcmc), startTime: zustClock(row.qssj), endTime: zustClock(row.jssj) };
        const previous = numbers.get(slot.number);
        if (previous) {
            if (previous.startTime !== slot.startTime || previous.endTime !== slot.endTime) throw new Error('同一节次返回了不同作息。');
            continue;
        }
        numbers.set(slot.number, slot);
        slots.push(slot);
    }
    slots.sort((a, b) => a.number - b.number);
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.number !== i + 1 || slot.number > 30 || slot.startTime >= slot.endTime ||
            (i > 0 && slot.startTime < slots[i - 1].endTime)) throw new Error('作息编号不连续或时间重叠。');
    }
    // 安吉第 5 节在接口中保留为 12:10-13:10，校方说明其为午休，不删除或压缩编号。
    return slots;
}

async function zustSave(method, value, label) {
    const result = await window.shiguangBridgePromise[method](JSON.stringify(value));
    if (!zustConfirmed(result)) throw new Error(label + '保存未成功，请重新导入。');
}

async function zustRunImport() {
    let savedStage = '';
    try {
        zustBaseUrl();
        zustToast('正在读取学年学期列表…');
        const semester = await zustChooseSemester();
        if (!semester) { zustToast('导入已取消'); return; }
        zustToast('正在读取整学期课表、校历和校区作息…');
        const data = await zustFetchCourses(semester);
        const parsed = zustParseCourses(data, semester);
        const config = zustParseCalendar(await zustRequest('kbcx/xskbcxZccx_cxZcByXnxq.html', {
            gnmkdm: 'N2154', xnm: semester.year, xqm: semester.term
        }));
        const schedules = new Map(), campusOptions = [];
        for (const [id, name] of parsed.campuses) {
            schedules.set(id, zustParseTimeSlots(await zustRequest('jzgl/skxxMobile_cxRsdjc.html', {
                gnmkdm: 'N2154', xnm: semester.year, xqm: semester.term, xqh_id: id
            }), id));
            campusOptions.push({ value: id, label: name });
        }
        let campus = campusOptions[0];
        if (campusOptions.length > 1) {
            campus = await zustSelect('选择课表基础作息校区', campusOptions, 0);
            if (!campus) { zustToast('导入已取消'); return; }
        }
        const slots = schedules.get(campus.value), courses = [];
        let customCount = 0;
        for (const item of parsed.courses) {
            const course = item.course, ownSlots = schedules.get(item.campusId);
            let different = false;
            for (let n = course.startSection; n <= course.endSection; n++) {
                if (!ownSlots[n - 1]) throw new Error('课程节次超出所属校区作息，请核对教务课表。');
                if (!slots[n - 1] || ownSlots[n - 1].startTime !== slots[n - 1].startTime || ownSlots[n - 1].endTime !== slots[n - 1].endTime) different = true;
            }
            for (const week of course.weeks) if (week > config.semesterTotalWeeks) throw new Error('课程周次超出所选学期校历。');
            if (different) {
                course.isCustomTime = true;
                course.customStartTime = ownSlots[course.startSection - 1].startTime;
                course.customEndTime = ownSlots[course.endSection - 1].endTime;
                customCount++;
            }
            courses.push(course);
        }
        let note = semester.label + '\n' + courses.length + ' 条课程时段\n基础作息：' + campus.label + '，共 ' + slots.length + ' 节\n第一周周一：' + config.semesterStartDate +
            '\n教务校历：' + config.semesterTotalWeeks + ' 周（范围可能包含假期）';
        note += '\n\n作息时间：';
        for (const slot of slots) note += '\n第 ' + slot.number + ' 节 ' + slot.startTime + '-' + slot.endTime +
            (campus.value === '3' && slot.number === 5 ? '（午休预留，保留原编号）' : '');
        if (customCount) note += '\n另有 ' + customCount + ' 条跨校区课程按所属校区真实时间导入，并保留原节次。';
        if (parsed.unscheduled.length) {
            note += '\n\n以下课程尚无固定上课时间，本次不导入：';
            for (const row of parsed.unscheduled) note += '\n' + zustText(row.kcmc) + '（' + zustText(row.qsjsz) + '）';
        }
        const confirmed = await window.shiguangBridgePromise.showAlert('核对导入信息', note, '确认导入');
        if (!zustConfirmed(confirmed)) { zustToast('导入已取消'); return; }
        await zustSave('saveCourseConfig', config, '学期配置');
        savedStage = '学期配置';
        await zustSave('savePresetTimeSlots', slots, '作息');
        savedStage = '学期配置和作息';
        await zustSave('saveImportedCourses', courses, '课程');
        zustToast('已导入 ' + courses.length + ' 条课程时段及 ' + slots.length + ' 节作息');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await window.shiguangBridgePromise.showAlert('导入未完成',
            (savedStage ? savedStage + '已保存，后续步骤未完成，请重新导入。\n' : '') + (error && error.message ? error.message : String(error)), '知道了');
    }
}

zustRunImport();
