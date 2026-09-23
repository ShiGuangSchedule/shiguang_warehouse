// 许昌学院正方 V9：依据本校实际课表、作息响应适配。
// 参考 resources/JSEI/jsei_01.js（星河欲转）的网络请求方案。
// 登录后进入个人课表页面，选择学年、学期后导入。

function parseWeeks(value) {
    const weeks = new Set();
    const text = String(value || '').replace(/（/g, '(').replace(/）/g, ')').replace(/周/g, '').replace(/[，、]/g, ',').replace(/[～~—–]/g, '-');
    for (const part of text.split(',')) {
        const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?\s*(?:\(([单双])\))?$/);
        if (!match) throw new Error('无法识别周次：' + value);
        const start = +match[1], end = +(match[2] || match[1]);
        if (start < 1 || end < start || end > 60) throw new Error('周次范围异常：' + value);
        for (let week = start; week <= end; week++) {
            if (match[3] === '单' && week % 2 === 0) continue;
            if (match[3] === '双' && week % 2 === 1) continue;
            weeks.add(week);
        }
    }
    if (!weeks.size) throw new Error('课程周次为空');
    return Array.from(weeks).sort((a, b) => a - b);
}

function parseCourses(data) {
    if (!data || !Array.isArray(data.kbList)) throw new Error('未收到课表数据，请确认登录状态及所在页面');
    return data.kbList.map(row => {
        const name = String(row.kcmc || '').trim();
        const section = String(row.jcs || row.jc || '').trim().match(/^(\d+)\s*(?:-\s*(\d+))?\s*节?$/);
        const day = +row.xqj;
        if (!name || !section || !/^[1-7]$/.test(String(row.xqj))) throw new Error('课程排课信息异常：' + (name || '未命名课程'));
        const startSection = +section[1], endSection = +(section[2] || section[1]);
        if (startSection < 1 || endSection < startSection || endSection > 30) throw new Error('节次异常：' + name);
        return { name, day, weeks: parseWeeks(row.zcd), teacher: String(row.xm || '').trim(), position: String(row.cdmc || '').trim(), startSection, endSection };
    });
}

function parseTimeSlots(data) {
    if (!Array.isArray(data) || !data.length) throw new Error('未收到作息数据');
    const seen = new Set();
    const slots = data.map(row => {
        const number = +row.jcmc;
        const startTime = String(row.qssj || '').trim(), endTime = String(row.jssj || '').trim();
        const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
        if (!/^\d+$/.test(String(row.jcmc)) || number < 1 || number > 30 || seen.has(number) || !timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime) throw new Error('教务返回的作息格式异常');
        seen.add(number);
        return { number, startTime, endTime };
    }).sort((a, b) => a.number - b.number);
    for (let i = 1; i < slots.length; i++) {
        if (slots[i].startTime < slots[i - 1].endTime) throw new Error('教务返回的作息时间重叠');
    }
    return slots;
}

async function requestXcu(path, params) {
    const response = await fetch('/jwglxt/' + path + '?gnmkdm=N2151', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）');
    try { return await response.json(); }
    catch (_) { throw new Error('教务未返回 JSON 数据，请重新登录后重试'); }
}

// 校区缺字段时使用页面选择；仍无法识别时由用户确认已验证的校区参数。
async function resolveTimeSlots(data, xnm, xqm, bridge) {
    const ids = Array.from(new Set(data.kbList.map(row => String(row.xqh_id == null ? '' : row.xqh_id).trim()).filter(Boolean)));
    let missing = false;
    for (const row of data.kbList) {
        if (!String(row.xqh_id == null ? '' : row.xqh_id).trim()) missing = true;
    }
    const pageCampus = document.querySelector('#xqh_id');
    const pageId = pageCampus ? String(pageCampus.value || '').trim() : '';
    if (missing && pageId && !ids.includes(pageId)) ids.push(pageId);
    if (!ids.length) {
        const confirmed = await bridge.showAlert('确认作息校区', '本次课程没有返回校区编号，页面也未提供校区。此前已验证许昌学院校区参数 1 的作息。是否获取该作息供你核对？确认前不会保存课程。', '获取并核对');
        if (!confirmed) return null;
        ids.push('1');
    }
    const results = await Promise.all(ids.map(async id => ({ id, slots: parseTimeSlots(await requestXcu('kbcx/xskbcx_cxRjc.html', { xnm, xqm, xqh_id: id })) })));
    // 单校区不做跨校区比较；逐字段比较避免依赖宿主页的 some/toJSON 实现。
    const baseline = results[0].slots;
    for (let i = 1; i < results.length; i++) {
        const candidate = results[i].slots;
        let equal = candidate.length === baseline.length;
        for (let j = 0; equal && j < baseline.length; j++) {
            equal = candidate[j].number === baseline[j].number
                && candidate[j].startTime === baseline[j].startTime
                && candidate[j].endTime === baseline[j].endTime;
        }
        if (!equal) {
            throw new Error('涉及校区 ' + ids.join('、') + '，返回的作息不同，无法保存为同一套作息。请联系维护者；本次尚未保存。');
        }
    }
    const note = missing ? '\n部分课程未提供校区，以下作息来自校区参数 ' + ids.join('、') + '，请特别核对这些课程的时间。' : '';
    return { slots: results[0].slots, campusName: '校区（' + ids.join('、') + '）', note };
}

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;
    let coursesSaved = false;
    try {
        if (window.location.hostname !== 'jwglxt.xcu.edu.cn') throw new Error('请在许昌学院教务系统内导入');
        const year = document.querySelector('#xnm');
        const semester = document.querySelector('#xqm');
        if (!year || !semester || !year.value || !semester.value) throw new Error('请先进入个人课表查询页面，选择学年和学期后再导入');
        const xnm = year.value, xqm = semester.value;
        const label = element => element.options && element.selectedIndex >= 0 ? element.options[element.selectedIndex].text : element.value;
        if (!await bridge.showAlert('许昌学院课表导入（校区兼容修订版）', '将请求 ' + label(year) + ' / ' + label(semester) + ' 的课程及校区作息。开学日期请在软件内核对设置。', '开始获取')) return;
        window.shiguangBridge.showToast('正在获取课程和作息…');
        const data = await requestXcu('kbcx/xskbcx_cxXsgrkb.html', { xnm, xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
        const courses = parseCourses(data);
        if (!courses.length) throw new Error('所选学期没有已排定星期和节次的课程，请核对学期');
        const resolved = await resolveTimeSlots(data, xnm, xqm, bridge);
        if (!resolved) return;
        const { slots, campusName, note } = resolved;
        const numbers = new Set(slots.map(slot => slot.number));
        for (const course of courses) {
            for (let n = course.startSection; n <= course.endSection; n++) {
                if (!numbers.has(n)) throw new Error(course.name + ' 的第 ' + n + ' 节缺少作息，尚未保存');
            }
        }
        const practices = Array.isArray(data.sjkList) ? data.sjkList : [];
        const practiceNote = practices.length ? '\n\n以下实践课没有具体星期和节次，本次不导入，请另行核对安排：\n' + practices.map(row => String(row.kcmc || '未命名实践课') + '（' + String(row.qsjsz || '周次未定') + '）').join('\n') : '';
        const message = '共 ' + courses.length + ' 条排课记录。教务返回的' + campusName + '作息如下，请与实际作息核对；若不符请取消并联系维护者：\n' + slots.map(slot => '第' + slot.number + '节 ' + slot.startTime + '–' + slot.endTime).join('\n') + note + practiceNote;
        if (!await bridge.showAlert('核对课程与作息', message, '确认并保存')) return;
        await bridge.saveImportedCourses(JSON.stringify(courses));
        coursesSaved = true;
        await bridge.savePresetTimeSlots(JSON.stringify(slots));
        window.shiguangBridge.showToast('已导入 ' + courses.length + ' 条排课记录及校区作息，请核对开学日期');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await bridge.showAlert('导入未完成', (coursesSaved ? '课程已保存，但作息未保存成功，请重试并核对。\n' : '') + error.message, '确定');
    }
}

runImportFlow();

