// 贵州机电职业技术学院（gztcme.cn）正方 V9 教务适配
// 入口：登录后进入「个人课表查询」，再执行导入。

function gztcmeText(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function gztcmeConfirmed(value) {
    return value === true || value === 'true';
}

function gztcmeCheckPage() {
    if (window.location.pathname.indexOf('/jwglxt/') < 0) {
        throw new Error('请先在教务系统（jwxt.gztcme.cn）登录并进入“个人课表查询”，再执行导入。');
    }
}

async function gztcmeFetchText(path, body) {
    const init = { method: body ? 'POST' : 'GET', credentials: 'include' };
    if (body) {
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
        init.body = body;
    }
    let response;
    try {
        response = await fetch('/jwglxt/' + path, init);
    } catch (error) {
        throw new Error('请求教务失败，请确认网络通畅并且已经登录教务系统。');
    }
    const text = await response.text();
    if ((response.url || '').indexOf('login_slogin') >= 0 || text.indexOf('login_slogin') >= 0) {
        throw new Error('登录已过期，请重新登录教务系统后再导入。');
    }
    if (!response.ok) throw new Error('教务返回异常（HTTP ' + response.status + '），请稍后重试。');
    return text;
}

async function gztcmeFetchJson(path, body) {
    const text = await gztcmeFetchText(path, body);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error('教务未返回有效数据，请重新登录后重试。');
    }
}

function gztcmeOptions(doc, selector) {
    const list = [];
    const nodes = doc.querySelectorAll(selector + ' option');
    for (let i = 0; i < nodes.length; i++) {
        const value = gztcmeText(nodes[i].getAttribute('value'));
        if (!value) continue;
        list.push({
            value: value,
            label: gztcmeText(nodes[i].textContent) || value,
            selected: nodes[i].selected === true || nodes[i].hasAttribute('selected')
        });
    }
    return list;
}

async function gztcmePick(title, items, defaultIndex) {
    const labels = [];
    for (let i = 0; i < items.length; i++) labels.push(items[i].label);
    const picked = await window.shiguangBridgePromise.showSingleSelection(title, JSON.stringify(labels), defaultIndex);
    if (picked === null || picked === undefined) return null;
    const text = String(picked).toLowerCase();
    if (text === 'null' || text === '') return null;
    const index = Number(picked);
    if (!(index >= 0 && index < items.length)) throw new Error('所选项目无效，请重新导入。');
    return items[index];
}

async function gztcmeChooseTerm() {
    const html = await gztcmeFetchText('kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const years = gztcmeOptions(doc, '#xnm');
    const terms = gztcmeOptions(doc, '#xqm');
    if (years.length === 0 || terms.length === 0) throw new Error('未取得学年学期列表，请确认已经登录教务系统。');

    let yearIndex = 0, termIndex = 0;
    for (let i = 0; i < years.length; i++) if (years[i].selected) yearIndex = i;
    for (let i = 0; i < terms.length; i++) if (terms[i].selected) termIndex = i;

    const year = await gztcmePick('选择学年', years, yearIndex);
    if (!year) return null;
    const term = await gztcmePick('选择学期', terms, termIndex);
    if (!term) return null;
    return { year: year.value, term: term.value, label: year.label + ' 第 ' + term.label + ' 学期' };
}

function gztcmeWeeks(value) {
    const text = gztcmeText(value).replace(/[第周\s]/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[，、]/g, ',');
    const weeks = [], seen = {};
    const parts = text.split(',');
    for (let i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        const match = parts[i].match(/^(\d+)(?:-(\d+))?(?:\(([单双])\))?$/);
        if (!match) throw new Error('无法识别上课周次「' + value + '」，请核对教务课表。');
        const from = Number(match[1]), to = Number(match[2] || match[1]);
        if (from < 1 || to < from || to > 60) throw new Error('上课周次超出有效范围。');
        for (let week = from; week <= to; week++) {
            if (match[3] === '单' && week % 2 === 0) continue;
            if (match[3] === '双' && week % 2 === 1) continue;
            if (!seen[week]) { seen[week] = true; weeks.push(week); }
        }
    }
    weeks.sort(function (a, b) { return a - b; });
    if (weeks.length === 0) throw new Error('课程周次为空，请核对教务课表。');
    return weeks;
}

function gztcmeCourses(data, term) {
    if (!data || !Array.isArray(data.kbList) || !data.xsxx) throw new Error('教务未返回课表数据，请重新进入个人课表页面。');
    if (gztcmeText(data.xsxx.XNM) !== term.year || gztcmeText(data.xsxx.XQM) !== term.term) {
        throw new Error('课表与所选学期不一致，请重新导入。');
    }
    const courses = [], campuses = [];
    for (let i = 0; i < data.kbList.length; i++) {
        const row = data.kbList[i];
        const name = gztcmeText(row.kcmc);
        if (!name) continue;
        const day = Number(row.xqj);
        const section = gztcmeText(row.jcs).replace(/节/g, '').match(/^(\d+)(?:-(\d+))?$/);
        if (!(day >= 1 && day <= 7) || !section) throw new Error('课程「' + name + '」的星期或节次异常，请核对教务课表。');
        const startSection = Number(section[1]), endSection = Number(section[2] || section[1]);
        if (startSection < 1 || endSection < startSection) throw new Error('课程「' + name + '」的节次异常，请核对教务课表。');
        courses.push({
            name: name,
            teacher: gztcmeText(row.xm),
            position: gztcmeText(row.cdmc),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: gztcmeWeeks(row.zcd)
        });
        const campusId = gztcmeText(row.xqh_id);
        if (campusId) {
            let known = false;
            for (let j = 0; j < campuses.length; j++) if (campuses[j].value === campusId) known = true;
            if (!known) campuses.push({ value: campusId, label: gztcmeText(row.xqmc) || '校区' });
        }
    }
    if (courses.length === 0) throw new Error('该学期没有可导入的课程，请确认所选学期。');
    return { courses: courses, campuses: campuses, unscheduled: Array.isArray(data.sjkList) ? data.sjkList : [] };
}

function gztcmeCalendar(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('未取得所选学期的校历，请确认学期选择。');
    const weeks = [];
    for (let i = 0; i < rows.length; i++) {
        const number = Number(rows[i].zs);
        const match = gztcmeText(rows[i].rq).match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
        if (!(number >= 1) || !match) throw new Error('校历格式异常，无法确定开学日期。');
        weeks.push({ number: number, start: match[1], end: match[2] });
    }
    weeks.sort(function (a, b) { return a.number - b.number; });
    if (weeks.length > 60) throw new Error('校历周数超出有效范围。');

    const first = new Date(weeks[0].start + 'T00:00:00Z');
    if (isNaN(first.getTime()) || first.getUTCDay() !== 1) throw new Error('校历第一周不是周一，无法确定开学日期。');
    for (let i = 0; i < weeks.length; i++) {
        const start = new Date(weeks[i].start + 'T00:00:00Z');
        const end = new Date(weeks[i].end + 'T00:00:00Z');
        if (weeks[i].number !== i + 1) throw new Error('校历周次不连续。');
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) throw new Error('校历日期格式异常。');
        if (start.getTime() - first.getTime() !== i * 7 * 86400000) throw new Error('校历日期与教学周不对应。');
    }
    return { semesterStartDate: weeks[0].start, semesterTotalWeeks: weeks.length, firstDayOfWeek: 1 };
}

function gztcmeClock(value) {
    const match = gztcmeText(value).match(/^(\d{1,2}):(\d{2})/);
    if (!match) throw new Error('作息时间格式异常。');
    return (match[1].length === 1 ? '0' + match[1] : match[1]) + ':' + match[2];
}

function gztcmeTimeSlots(rows) {
    const slots = [], seen = {};
    for (let i = 0; i < rows.length; i++) {
        const number = Number(rows[i].jcmc);
        if (!(number >= 1) || seen[number]) continue;
        seen[number] = true;
        slots.push({ number: number, startTime: gztcmeClock(rows[i].qssj), endTime: gztcmeClock(rows[i].jssj) });
    }
    slots.sort(function (a, b) { return a.number - b.number; });
    for (let i = 0; i < slots.length; i++) {
        if (slots[i].number !== i + 1) throw new Error('作息节次编号不连续，请核对教务作息。');
        if (slots[i].startTime >= slots[i].endTime) throw new Error('作息起止时间异常，请核对教务作息。');
    }
    return slots;
}

async function gztcmeSave(method, value, label) {
    const result = await window.shiguangBridgePromise[method](JSON.stringify(value));
    if (!gztcmeConfirmed(result)) throw new Error(label + '保存未成功，请重新导入。');
}

async function gztcmeRunImport() {
    let savedStage = '';
    try {
        gztcmeCheckPage();
        window.shiguangBridge.showToast('正在读取学年学期…');
        const term = await gztcmeChooseTerm();
        if (!term) { window.shiguangBridge.showToast('导入已取消'); return; }

        window.shiguangBridge.showToast('正在读取课表、校历和作息…');
        const fetched = await Promise.all([
            gztcmeFetchJson('kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', 'xnm=' + term.year + '&xqm=' + term.term + '&kzlx=ck'),
            gztcmeFetchJson('kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154', 'xnm=' + term.year + '&xqm=' + term.term)
        ]);
        const parsed = gztcmeCourses(fetched[0], term);
        const config = gztcmeCalendar(fetched[1]);

        let campus = parsed.campuses.length > 0 ? parsed.campuses[0] : null;
        if (parsed.campuses.length > 1) {
            campus = await gztcmePick('选择课表作息校区', parsed.campuses, 0);
            if (!campus) { window.shiguangBridge.showToast('导入已取消'); return; }
        }

        let slots = [];
        if (campus) {
            const rows = await gztcmeFetchJson('kbcx/xskbcx_cxRjc.html?gnmkdm=N2151',
                'xnm=' + term.year + '&xqm=' + term.term + '&xqh_id=' + campus.value);
            slots = gztcmeTimeSlots(Array.isArray(rows) ? rows : []);
        }

        let maxSection = 0;
        const names = [];
        for (let i = 0; i < parsed.courses.length; i++) {
            const course = parsed.courses[i];
            if (course.endSection > maxSection) maxSection = course.endSection;
            for (let j = 0; j < course.weeks.length; j++) {
                if (course.weeks[j] > config.semesterTotalWeeks) {
                    throw new Error('课程「' + course.name + '」周次超出本学期校历（' + config.semesterTotalWeeks + ' 周）。');
                }
            }
            let known = false;
            for (let j = 0; j < names.length; j++) if (names[j] === course.name) known = true;
            if (!known) names.push(course.name);
        }
        if (slots.length > 0 && maxSection > slots.length) throw new Error('课表节次超出作息节数，请核对教务课表。');

        let note = term.label + '\n' +
            '课程时段：' + parsed.courses.length + ' 条 / ' + names.length + ' 门课\n' +
            '开学日期：' + config.semesterStartDate + '（第 1 周周一）\n' +
            '校历周数：' + config.semesterTotalWeeks + ' 周\n' +
            '作息节数：' + (slots.length > 0 ? slots.length + ' 节（' + (campus ? campus.label : '') + '）' : '未取到，使用应用默认作息');
        if (parsed.unscheduled.length > 0) {
            let pending = '';
            for (let i = 0; i < parsed.unscheduled.length; i++) {
                const row = parsed.unscheduled[i];
                pending += '\n· ' + (gztcmeText(row.kcmc) || '未命名课程') + '（' + (gztcmeText(row.qsjsz) || '周次未知') + '）';
            }
            note += '\n\n以下 ' + parsed.unscheduled.length + ' 门课尚未排定上课时间，本次不导入：' + pending;
        }

        const confirmed = await window.shiguangBridgePromise.showAlert('核对导入信息', note, '确认导入');
        if (!gztcmeConfirmed(confirmed)) { window.shiguangBridge.showToast('导入已取消'); return; }

        await gztcmeSave('saveCourseConfig', config, '学期配置');
        savedStage = '学期配置';
        if (slots.length > 0) {
            await gztcmeSave('savePresetTimeSlots', slots, '作息');
            savedStage = '学期配置和作息';
        }
        await gztcmeSave('saveImportedCourses', parsed.courses, '课程');
        window.shiguangBridge.showToast('已导入 ' + parsed.courses.length + ' 条课程时段');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        await window.shiguangBridgePromise.showAlert('导入未完成',
            (savedStage ? savedStage + '已保存，后续步骤未完成，请重新导入。\n' : '') + message, '知道了');
    }
}

gztcmeRunImport();
