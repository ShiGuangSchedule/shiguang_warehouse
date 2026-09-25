// 许昌学院正方 V9 课表导入
// 参考：resources/JSEI/jsei_01.js（星河欲转）。

function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/　/g, ' ').replace(/[~—–]/g, '-');
}

function normalizeTime(value) {
    const m = normalizeText(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m || +m[1] > 23 || +m[2] > 59 || (m[3] && +m[3] > 59)) throw new Error('无法识别时间：' + value);
    return m[1].padStart(2, '0') + ':' + m[2];
}

// WebVPN 地址可能在 /jwglxt/ 前带代理路径。
function getBaseUrl() {
    const current = new URL(window.location.href);
    const index = current.pathname.indexOf('/jwglxt/');
    if (index < 0) throw new Error('请先登录并进入教务系统（WebVPN 需先打开教务系统应用）');
    return current.origin + current.pathname.slice(0, index) + '/jwglxt/';
}

function parseSemesterConfig(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('校历接口未返回周次列表');
    let first = null;
    const weeks = new Set();
    for (const row of rows) {
        const m = normalizeText(row.zs == null ? row.zsmc : row.zs).trim().match(/^(?:第)?(\d+)(?:周)?$/);
        if (!m || +m[1] < 1) continue;
        const week = +m[1];
        weeks.add(week);
        if (week === 1) first = row;
    }
    const config = {};
    // 连续的校历周次用于计算总周数；开学日期仍取第 1 周。
    const sortedWeeks = Array.from(weeks).sort((a, b) => a - b);
    const max = sortedWeeks[sortedWeeks.length - 1];
    let continuous = sortedWeeks.length > 0;
    for (let i = 1; i < sortedWeeks.length; i++) {
        if (sortedWeeks[i] - sortedWeeks[i - 1] !== 1) { continuous = false; break; }
    }
    if (continuous && max >= 10 && max <= 60) config.semesterTotalWeeks = max;
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

// 默认值：页面变量 → URL 参数 → selected → 第一项。
function getDefaultOptionIndex(options, key) {
    const match = value => {
        if (typeof value !== 'string' && typeof value !== 'number') return -1;
        const text = String(value).trim();
        if (!text) return -1;
        return options.findIndex(option => option.value === text);
    };
    let index = match(window[key]);
    if (index >= 0) return index;
    index = match(new URL(window.location.href).searchParams.get(key));
    if (index >= 0) return index;
    index = options.findIndex(option => option.selected);
    return index >= 0 ? index : 0;
}

function assertNotLoginPage(text) {
    if (/login_slogin|用户登录|统一身份认证/i.test(text)) {
        throw new Error('登录已过期，请重新登录教务系统后再导入');
    }
}

// 学年学期从请求结果读取，不读当前页面的表单。
function parseAcademicOptions(doc) {
    const read = selector => Array.from(doc.querySelectorAll(selector))
        .filter(option => !option.disabled && String(option.value).trim() !== '')
        .map(option => ({ value: String(option.value).trim(), text: option.textContent.trim(), selected: option.selected }));
    const allYears = read('#xnm option');
    const semesterOptions = read('#xqm option');
    if (!allYears.length || !semesterOptions.length) {
        // 正常教务页也可能带登录链接。
        const html = doc.documentElement ? doc.documentElement.outerHTML : '';
        assertNotLoginPage(html || (doc.body ? doc.body.textContent : '') || '');
        throw new Error('未获取到学年学期选项，请确认已登录教务系统后重试');
    }
    const selectedYear = getDefaultOptionIndex(allYears, 'xnm');
    const start = Math.max(0, selectedYear - 2);
    const yearOptions = allYears.slice(start, selectedYear + 3);
    const selectedSemester = getDefaultOptionIndex(semesterOptions, 'xqm');
    return { yearOptions, semesterOptions, defaultYearIndex: selectedYear - start, defaultSemesterIndex: selectedSemester };
}

async function fetchAcademicOptions() {
    const response = await fetch(getBaseUrl() + 'kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default', {
        method: 'GET', credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('获取学年学期失败（HTTP ' + response.status + '）');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return parseAcademicOptions(doc);
}

async function selectAcademicYearAndSemester(bridge) {
    const options = await fetchAcademicOptions();
    const select = async (title, entries, defaultIndex) => {
        const result = await bridge.showSingleSelection(title, JSON.stringify(entries.map(item => item.text)), defaultIndex);
        if (result == null) return null;
        const index = String(result).trim();
        if (!/^\d+$/.test(index)) return null;
        return entries[+index] || null;
    };
    const makeSelection = (year, semester) => ({ xnm: year.value, xqm: semester.value, label: year.text + ' / ' + semester.text });
    const defaultSelection = makeSelection(options.yearOptions[options.defaultYearIndex], options.semesterOptions[options.defaultSemesterIndex]);
    const action = await select('确认导入学期', [
        { value: 'default', text: '导入：' + defaultSelection.label },
        { value: 'change', text: '更换学年、学期' }
    ], 0);
    if (!action) return null;
    if (action.value === 'default') return defaultSelection;
    const year = await select('选择学年', options.yearOptions, options.defaultYearIndex);
    if (!year) return null;
    const semester = await select('选择学期', options.semesterOptions, options.defaultSemesterIndex);
    if (!semester) return null;
    return makeSelection(year, semester);
}

// 许昌学院已实测：此接口无需 xqh_id。
async function fetchTimeSlots(xnm, xqm) {
    let data;
    try {
        data = await requestXcu('jzgl/skxxMobile_cxRsdjc.html', { xnm, xqm }, 'N2154');
    } catch (error) {
        const serverError = String(error.message || error).match(/HTTP 5\d\d\b/);
        if (serverError) throw new Error('教务作息接口异常（' + serverError[0] + '），请稍后重试或联系维护者');
        throw new Error('获取教务作息失败：' + error.message + '。请检查登录状态，或将该作息请求的响应提供给维护者核对');
    }
    try { return parseTimeSlots(data); }
    catch (error) { throw new Error('作息数据无法解析：' + error.message + '。本次尚未保存，请将此提示或作息接口响应提供给维护者核对'); }
}

// 先按周合并节次，再合并节次相同的周次。
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses)) return courses;
    if (courses.length <= 1) return courses.map(c => ({ ...c, weeks: [...(c.weeks || [])] }));
    const groups = new Map();
    for (const course of courses) {
        const key = JSON.stringify([course.name, course.teacher, course.position, course.day]);
        if (!groups.has(key)) groups.set(key, { course, byWeek: new Map() });
        const group = groups.get(key);
        for (const week of new Set(course.weeks)) {
            if (!group.byWeek.has(week)) group.byWeek.set(week, []);
            group.byWeek.get(week).push({ start: course.startSection, end: course.endSection });
        }
    }
    const result = [];
    for (const group of groups.values()) {
        const bySection = new Map();
        for (const [week, intervals] of group.byWeek) {
            intervals.sort((a, b) => a.start - b.start || a.end - b.end);
            const merged = [];
            for (const interval of intervals) {
                const previous = merged[merged.length - 1];
                if (previous && interval.start <= previous.end + 1) previous.end = Math.max(previous.end, interval.end);
                else merged.push({ ...interval });
            }
            for (const interval of merged) {
                const key = interval.start + '-' + interval.end;
                if (!bySection.has(key)) bySection.set(key, { ...group.course, startSection: interval.start, endSection: interval.end, weeks: [] });
                bySection.get(key).weeks.push(week);
            }
        }
        for (const course of bySection.values()) {
            course.weeks.sort((a, b) => a - b);
            result.push(course);
        }
    }
    return result;
}

function parseWeeks(value) {
    const weeks = new Set();
    const text = normalizeText(value).replace(/周/g, '').replace(/、/g, ',');
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

function joinField(value) {
    return Array.isArray(value) ? value.join('、') : String(value || '').trim();
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
        courses.push({ name, day, weeks: parseWeeks(row.zcd), teacher: joinField(row.xm), position: joinField(row.cdmc), startSection, endSection });
      } catch (error) { warnings.push('跳过课程 ' + String(row && row.kcmc || '未命名') + '：' + error.message); }
    }
    return mergeAndDistinctCourses(courses);
}

function parseTimeSlots(data) {
    if (!Array.isArray(data) || !data.length) throw new Error('未收到有效的作息列表');
    const byNumber = new Map();
    const describe = value => String(value == null ? '缺失' : value).slice(0, 60);
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || typeof row !== 'object') throw new Error('第 ' + (i + 1) + ' 条作息不是有效记录');
        const section = normalizeText(row.jcmc).trim();
        const number = +section;
        if (!/^\d+$/.test(section) || number < 1 || number > 30) {
            throw new Error('第 ' + (i + 1) + ' 条作息的节次无法识别（jcmc=' + describe(row.jcmc) + '）');
        }
        let startTime, endTime;
        try { startTime = normalizeTime(row.qssj); endTime = normalizeTime(row.jssj); }
        catch (_) { throw new Error('第 ' + number + ' 节时间无法识别（qssj=' + describe(row.qssj) + '，jssj=' + describe(row.jssj) + '）'); }
        if (startTime >= endTime) throw new Error('第 ' + number + ' 节起止时间异常：' + startTime + '–' + endTime);
        const existing = byNumber.get(number);
        if (existing) {
            // 相同作息去重，时间不同则报错。
            if (existing.startTime === startTime && existing.endTime === endTime) continue;
            throw new Error('第 ' + number + ' 节返回不同时间：' + existing.startTime + '–' + existing.endTime + ' 与 ' + startTime + '–' + endTime);
        }
        byNumber.set(number, { number, startTime, endTime });
    }
    const slots = Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
    for (let i = 1; i < slots.length; i++) {
        if (slots[i].startTime < slots[i - 1].endTime) throw new Error('第 ' + slots[i - 1].number + ' 节与第 ' + slots[i].number + ' 节作息时间重叠');
    }
    return slots;
}

async function requestXcu(path, params, moduleId = 'N2151') {
    const response = await fetch(getBaseUrl() + path + '?gnmkdm=' + encodeURIComponent(moduleId), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）');
    const text = await response.text();
    try { return JSON.parse(text); }
    catch (_) {
        // 先解析 JSON，避免课程名中的登录关键词被误判。
        assertNotLoginPage(text);
        throw new Error('教务未返回 JSON 数据，请重新登录后重试');
    }
}

async function saveWithConfirmation(bridge, method, data, label) {
    const result = await bridge[method](JSON.stringify(data));
    if (result !== true && result !== 'true') throw new Error(label + '保存未成功，请重试并核对');
}

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;
    let coursesSaved = false;
    let saveStage = '课程';
    try {
        const selection = await selectAcademicYearAndSemester(bridge);
        if (!selection) return;
        const { xnm, xqm } = selection;
        window.shiguangBridge.showToast('正在获取课程、校历和作息…');
        const warnings = [];
        const [data, config, slots] = await Promise.all([
            requestXcu('kbcx/xskbcx_cxXsgrkb.html', { xnm, xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' }),
            fetchSemesterConfig(xnm, xqm, warnings),
            fetchTimeSlots(xnm, xqm)
        ]);
        let courses = parseCourses(data, warnings);
        const numbers = new Set(slots.map(slot => slot.number));
        courses = courses.filter(course => {
            for (let n = course.startSection; n <= course.endSection; n++) {
                if (!numbers.has(n)) { warnings.push('跳过课程 ' + course.name + '：第 ' + n + ' 节缺少作息'); return false; }
            }
            return true;
        });
        if (!courses.length) throw new Error('没有可导入的有效课程，请核对学期。\n' + warnings.join('\n'));
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
        const message = selection.label + '\n共 ' + courses.length + ' 条排课记录。教务返回的作息如下，请核对：\n' + slots.map(slot => '第' + slot.number + '节 ' + slot.startTime + '–' + slot.endTime).join('\n') + practiceNote + '\n\n开学日期：' + (config.semesterStartDate || '需手动设置') + '\n学期总周数：' + (config.semesterTotalWeeks || '需手动设置') + (warnings.length ? '\n\n注意：\n' + warnings.join('\n') : '');
        const confirmed = await bridge.showAlert('核对课程与作息', message, '确认并保存');
        if (confirmed !== true && confirmed !== 'true') return;
        await saveWithConfirmation(bridge, 'saveImportedCourses', courses, '课程');
        coursesSaved = true;
        saveStage = '作息';
        await saveWithConfirmation(bridge, 'savePresetTimeSlots', slots, '作息');
        saveStage = '学期配置';
        await saveWithConfirmation(bridge, 'saveCourseConfig', config, '学期配置');
        window.shiguangBridge.showToast('已导入 ' + courses.length + ' 条排课记录及作息，请核对学期配置');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await bridge.showAlert('导入未完成', (coursesSaved ? '课程已保存，但' + saveStage + '未保存成功，请重试并核对。\n' : '') + error.message, '确定');
    }
}

runImportFlow();
