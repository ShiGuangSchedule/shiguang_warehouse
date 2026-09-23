// 许昌学院正方 V9：依据本校实际课表、作息响应适配。
// 参考 resources/JSEI/jsei_01.js（星河欲转）的网络请求方案。
// 登录后进入个人课表页面，选择学年、学期后导入。


function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/　/g, ' ').replace(/[～~—–]/g, '-');
}

function normalizeTime(value) {
    const m = normalizeText(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m || +m[1] > 23 || +m[2] > 59 || (m[3] && +m[3] > 59)) throw new Error('无法识别时间：' + value);
    return m[1].padStart(2, '0') + ':' + m[2];
}

// 保留当前教务页面的代理路径前缀，避免从 WebVPN 跳回校内地址。
function getBaseUrl() {
    const current = new URL(window.location.href);
    const index = current.pathname.indexOf('/jwglxt/');
    if (index < 0) throw new Error('请进入教务系统个人课表页面后导入（WebVPN 需先打开教务系统）');
    return current.origin + current.pathname.slice(0, index) + '/jwglxt/';
}

function parseSemesterConfig(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('校历接口未返回周次列表');
    let first = null, max = 0;
    const weeks = new Set();
    for (const row of rows) {
        const m = normalizeText(row.zs == null ? row.zsmc : row.zs).trim().match(/^(?:第)?(\d+)(?:周)?$/);
        if (!m || +m[1] < 1 || +m[1] > 60) continue;
        const week = +m[1]; weeks.add(week); max = Math.max(max, week);
        if (week === 1) first = row;
    }
    const config = {};
    // 只有完整的连续周次列表才能作为学期总周数，不能以最后一门课代替。
    if (max && weeks.size === max) config.semesterTotalWeeks = max;
    if (first) {
        for (const key of ['rq', 'zcrq', 'ksrq']) {
            const m = normalizeText(first[key]).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[\s/至~\-])/);
            if (!m) continue;
            const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
            if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) continue;
            config.semesterStartDate = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
            break;
        }
    }
    return config;
}

async function fetchSemesterConfig(xnm, xqm, warnings) {
    let config = {};
    try { config = parseSemesterConfig(await requestXcu('kbcx/xskbcxZccx_cxZcByXnxq.html', { xnm, xqm }, 'N2154')); }
    catch (error) { warnings.push('校历获取失败：' + error.message); }
    if (!config.semesterStartDate) warnings.push('开学日期未获取，请在软件内手动设置');
    if (!config.semesterTotalWeeks) warnings.push('学期总周数未确认，请在软件内手动设置');
    return config;
}

async function resolveTimeSlots(data, xnm, xqm, bridge) {
    const ids = [];
    const add = value => {
        const id = normalizeText(value).trim();
        if (id && id !== '-1' && id !== '0' && ids.indexOf(id) < 0) ids.push(id);
    };
    for (const row of data.kbList) { if (row) add(row.xqh_id); }
    const campus = document.querySelector('#xqh_id');
    if (campus) add(campus.value);
    if (!ids.length && campus && campus.options) {
        const choices = Array.from(campus.options).filter(o => o.value && o.value !== '-1' && o.value !== '0');
        if (choices.length) {
            const selected = await bridge.showSingleSelection('选择作息校区', JSON.stringify(choices.map(o => o.text)), 0);
            if (selected == null || !choices[selected]) return null;
            add(choices[selected].value);
        }
    }
    if (!ids.length) throw new Error('课程和页面均未提供校区编号，请先在课表页面选择校区后重试');
    const results = await Promise.all(ids.map(async id => parseTimeSlots(await requestXcu('kbcx/xskbcx_cxRjc.html', { xnm, xqm, xqh_id: id }))));
    for (let i = 1; i < results.length; i++) {
        const a = results[0], b = results[i];
        let equal = a.length === b.length;
        for (let n = 0; equal && n < a.length; n++) equal = a[n].number === b[n].number && a[n].startTime === b[n].startTime && a[n].endTime === b[n].endTime;
        if (!equal) throw new Error('校区 ' + ids.join('、') + ' 的作息不同，无法合用同一套作息，本次未保存');
    }
    return { slots: results[0], campusName: '校区（' + ids.join('、') + '）', note: '' };
}

function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
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
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}


function parseWeeks(value) {
    const weeks = new Set();
    const text = normalizeText(value).replace(/（/g, '(').replace(/）/g, ')').replace(/周/g, '').replace(/[，、]/g, ',').replace(/[～~—–]/g, '-');
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

function parseCourses(data, warnings = []) {
    if (!data || !Array.isArray(data.kbList)) throw new Error('未收到课表数据，请确认登录状态及所在页面');
    const courses = [];
    for (const row of data.kbList) {
      try {
        const name = String(row.kcmc || '').trim();
        const section = normalizeText(row.jcs || row.jc).trim().match(/^(\d+)\s*(?:-\s*(\d+))?\s*节?$/);
        const day = +normalizeText(row.xqj);
        if (!name || !section || !/^[1-7]$/.test(normalizeText(row.xqj))) throw new Error('课程排课信息异常：' + (name || '未命名课程'));
        const startSection = +section[1], endSection = +(section[2] || section[1]);
        if (startSection < 1 || endSection < startSection || endSection > 30) throw new Error('节次异常：' + name);
        courses.push({ name, day, weeks: parseWeeks(row.zcd), teacher: String(row.xm || '').trim(), position: String(row.cdmc || '').trim(), startSection, endSection });
      } catch (error) { warnings.push('跳过课程 ' + String(row && row.kcmc || '未命名') + '：' + error.message); }
    }
    return mergeAndDistinctCourses(courses);
}

function parseTimeSlots(data) {
    if (!Array.isArray(data) || !data.length) throw new Error('未收到作息数据');
    const seen = new Set();
    const slots = data.map(row => {
        const number = +normalizeText(row.jcmc);
        const startTime = normalizeTime(row.qssj), endTime = normalizeTime(row.jssj);
        const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
        if (!/^\d+$/.test(normalizeText(row.jcmc)) || number < 1 || number > 30 || seen.has(number) || !timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime) throw new Error('教务返回的作息格式异常');
        seen.add(number);
        return { number, startTime, endTime };
    }).sort((a, b) => a.number - b.number);
    for (let i = 1; i < slots.length; i++) {
        if (slots[i].startTime < slots[i - 1].endTime) throw new Error('教务返回的作息时间重叠');
    }
    return slots;
}

async function requestXcu(path, params, moduleId = 'N2151') {
    const response = await fetch(getBaseUrl() + path + '?gnmkdm=' + encodeURIComponent(moduleId), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）');
    try { return await response.json(); }
    catch (_) { throw new Error('教务未返回 JSON 数据，请重新登录后重试'); }
}

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;
    let coursesSaved = false;
    let saveStage = '课程';
    try {
        const year = document.querySelector('#xnm');
        const semester = document.querySelector('#xqm');
        if (!year || !semester || !year.value || !semester.value) throw new Error('请先进入个人课表查询页面，选择学年和学期后再导入');
        const xnm = year.value, xqm = semester.value;
        const label = element => element.options && element.selectedIndex >= 0 ? element.options[element.selectedIndex].text : element.value;
        if (!await bridge.showAlert('许昌学院课表导入（接口增强版）', '将请求 ' + label(year) + ' / ' + label(semester) + ' 的课程及校区作息。将尝试获取校历，保存前请核对。', '开始获取')) return;
        window.shiguangBridge.showToast('正在获取课程和作息…');
        const data = await requestXcu('kbcx/xskbcx_cxXsgrkb.html', { xnm, xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' });
        const warnings = [];
        let courses = parseCourses(data, warnings);
        const config = await fetchSemesterConfig(xnm, xqm, warnings);
        if (!courses.length) throw new Error('没有可导入的有效课程，请核对学期。\n' + warnings.join('\n'));
        const resolved = await resolveTimeSlots(data, xnm, xqm, bridge);
        if (!resolved) return;
        const { slots, campusName, note } = resolved;
        const numbers = new Set(slots.map(slot => slot.number));
        courses = courses.filter(course => {
            for (let n = course.startSection; n <= course.endSection; n++) {
                if (!numbers.has(n)) { warnings.push('跳过课程 ' + course.name + '：第 ' + n + ' 节缺少作息'); return false; }
            }
            return true;
        });
        if (!courses.length) throw new Error('没有可导入的有效课程。\n' + warnings.join('\n'));
        if (config.semesterTotalWeeks) {
            for (const course of courses) {
                if (course.weeks[course.weeks.length - 1] > config.semesterTotalWeeks) {
                    delete config.semesterTotalWeeks;
                    warnings.push('校历总周数小于课程周次，未保存总周数，请手动核对');
                    break;
                }
            }
        }
        const practices = Array.isArray(data.sjkList) ? data.sjkList : [];
        const practiceNote = practices.length ? '\n\n以下实践课没有具体星期和节次，本次不导入，请另行核对安排：\n' + practices.map(row => String(row.kcmc || '未命名实践课') + '（' + String(row.qsjsz || '周次未定') + '）').join('\n') : '';
        const message = '共 ' + courses.length + ' 条排课记录。教务返回的' + campusName + '作息如下，请与实际作息核对；若不符请取消并联系维护者：\n' + slots.map(slot => '第' + slot.number + '节 ' + slot.startTime + '–' + slot.endTime).join('\n') + note + practiceNote + '\n\n开学日期：' + (config.semesterStartDate || '需手动设置') + '\n学期总周数：' + (config.semesterTotalWeeks || '需手动设置') + (warnings.length ? '\n\n注意：\n' + warnings.join('\n') : '');
        if (!await bridge.showAlert('核对课程与作息', message, '确认并保存')) return;
        await bridge.saveImportedCourses(JSON.stringify(courses));
        coursesSaved = true;
        saveStage = '作息';
        await bridge.savePresetTimeSlots(JSON.stringify(slots));
        if (Object.keys(config).length) {
            saveStage = '学期配置';
            await bridge.saveCourseConfig(JSON.stringify(config));
        }
        window.shiguangBridge.showToast('已导入 ' + courses.length + ' 条排课记录及校区作息，请核对开学日期');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await bridge.showAlert('导入未完成', (coursesSaved ? '课程已保存，但' + saveStage + '未保存成功，请重试并核对。\n' : '') + error.message, '确定');
    }
}

runImportFlow();

