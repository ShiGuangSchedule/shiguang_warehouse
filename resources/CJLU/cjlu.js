// 中国计量大学(cjlu.edu.cn) 拾光课程表适配脚本
// 教务系统：正方教务（新版 UI zftal-ui-v5），部署在根路径 /xtgl/
// 登录：正方统一身份认证 https://authserver.cjlu.edu.cn/authserver/login?service=https://jwxt.cjlu.edu.cn/sso/jziotlogin
// 数据全部通过接口获取，不读取当前页面 DOM，登录后停留在任意教务页面即可导入
// 参考：《常见教务系统适配案例参考》正方教务 v9 方案（resources/HAUE、resources/JSEI）
// 原适配脚本作者：ying-ck   维护者：salt-fishes

var CJLU_OPTIONS_URL = 'kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';

// 正方模块目录：模块根地址 = 当前路径中最早出现的模块目录之前的部分
// 兼容根路径(/xtgl)、/jwglxt 子路径与 WebVPN(/http/<hex>/...) 形态
var CJLU_MODULE_MARKERS = ['/xtgl/', '/kbcx/', '/jzgl/'];

// 返回以斜杠结尾的模块根地址，便于拼接 'kbcx/xxx.html'
function getBaseUrl() {
    const path = window.location.pathname || '';
    let cut = -1;
    CJLU_MODULE_MARKERS.forEach(function (marker) {
        const index = path.indexOf(marker);
        if (index >= 0 && (cut < 0 || index < cut)) cut = index;
    });
    return window.location.origin + (cut >= 0 ? path.slice(0, cut) : '') + '/';
}

// ==================== 文本 / 时间 ====================

function normalizeText(value) {
    return String(value == null ? '' : value)
        .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
        .replace(/\u3000/g, ' ')
        .replace(/[～~—–]/g, '-');
}

function normalizeTime(value) {
    const match = normalizeText(value).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) throw new Error('无法识别时间：' + value);
    return String(match[1]).padStart(2, '0') + ':' + match[2];
}

// ==================== 桥接封装 ====================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    }
}

async function alertUser(title, message, confirmText) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        const confirmed = await window.shiguangBridgePromise.showAlert(title, message, confirmText || '知道了');
        return confirmed === true || confirmed === 'true';
    }
    alert(title + '\n' + message);
    return true;
}

// ==================== 请求 ====================

async function requestHaue(path, params, moduleId) {
    const response = await fetch(getBaseUrl() + path + '?gnmkdm=' + encodeURIComponent(moduleId), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）');
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        if (/login_slogin|用户登录|统一身份认证/i.test(text)) {
            throw new Error('登录已过期，请重新登录教务系统后再导入');
        }
        throw new Error('教务未返回 JSON 数据，请重新登录后重试');
    }
}

// ==================== 校历：开学日期 + 总周数 ====================

function parseSemesterConfig(rows) {
    const config = {};
    if (!Array.isArray(rows) || rows.length === 0) return config;
    let first = null, max = 0;
    const weeks = new Set();
    rows.forEach(function (row) {
        const match = normalizeText(row.zs == null ? row.zsmc : row.zs).trim().match(/^(?:第)?(\d+)(?:周)?$/);
        if (!match || +match[1] < 1) return;
        const week = +match[1];
        weeks.add(week);
        max = Math.max(max, week);
        if (week === 1) first = row;
    });
    const sorted = Array.from(weeks).sort(function (a, b) { return a - b; });
    let continuous = sorted.length > 0;
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] !== 1) { continuous = false; break; }
    }
    // 仅接受连续且最大周次在 10~60 的校历，避免把整年周历当成学期
    if (continuous && max >= 10 && max <= 60) config.semesterTotalWeeks = max;
    if (first) {
        // 注意：正方部分页面重写了 Array.prototype.filter/some/every，这里一律用普通循环
        const keys = ['rq', 'zcrq', 'ksrq'];
        for (let i = 0; i < keys.length; i++) {
            const match = normalizeText(first[keys[i]]).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (match) {
                config.semesterStartDate = match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
                break;
            }
        }
    }
    return config;
}

async function fetchSemesterConfig(year, term, warnings) {
    try {
        return parseSemesterConfig(await requestHaue('kbcx/xskbcxZccx_cxZcByXnxq.html', { xnm: year, xqm: term }, 'N2154'));
    } catch (error) {
        warnings.push('校历获取失败：' + error.message);
        return {};
    }
}

// ==================== 作息 ====================

function parseTimeSlots(data) {
    if (!Array.isArray(data) || data.length === 0) throw new Error('未收到有效的作息列表');
    const byNumber = new Map();
    data.forEach(function (row) {
        const section = normalizeText(row.jcmc).trim();
        const number = +section;
        if (!/^\d+$/.test(section) || number < 1 || number > 30) return;
        const startTime = normalizeTime(row.qssj);
        const endTime = normalizeTime(row.jssj);
        const existing = byNumber.get(number);
        if (existing) {
            if (existing.startTime === startTime && existing.endTime === endTime) return;
            throw new Error('第 ' + number + ' 节返回不同时间：' + existing.startTime + '-' + existing.endTime + ' 与 ' + startTime + '-' + endTime);
        }
        byNumber.set(number, { number: number, startTime: startTime, endTime: endTime });
    });
    const slots = Array.from(byNumber.values()).sort(function (a, b) { return a.number - b.number; });
    if (slots.length === 0) throw new Error('作息列表无法解析');
    return slots;
}

async function fetchTimeSlots(year, term, campusId, warnings) {
    try {
        const params = { xnm: year, xqm: term };
        if (campusId) params.xqh_id = campusId;
        return parseTimeSlots(await requestHaue('jzgl/skxxMobile_cxRsdjc.html', params, 'N2154'));
    } catch (error) {
        warnings.push('教务作息获取失败：' + error.message);
        return null;
    }
}

// ==================== 周次 / 课程解析 ====================

function parseWeeks(value) {
    const weeks = new Set();
    const text = normalizeText(value).replace(/（/g, '(').replace(/）/g, ')').replace(/周/g, '').replace(/[，、]/g, ',');
    text.split(',').forEach(function (part) {
        const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?\s*(?:\(([单双])\))?$/);
        if (!match) return;
        const start = +match[1], end = +(match[2] || match[1]);
        if (start < 1 || end < start || end > 60) return;
        for (let week = start; week <= end; week++) {
            if (match[3] === '单' && week % 2 === 0) continue;
            if (match[3] === '双' && week % 2 === 1) continue;
            weeks.add(week);
        }
    });
    return Array.from(weeks).sort(function (a, b) { return a - b; });
}

// 节次与周次合并去重函数（官方 wiki 实现，逐字未改）
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

function parseCourses(data, warnings) {
    if (!data || !Array.isArray(data.kbList)) throw new Error('未收到课表数据，请确认登录状态');
    const courses = [];
    data.kbList.forEach(function (row) {
        try {
            const name = String(row.kcmc || '').trim();
            const section = normalizeText(row.jcs || row.jc).match(/^(\d+)\s*(?:-\s*(\d+))?\s*节?$/);
            const day = +normalizeText(row.xqj);
            if (!name || !section || !/^[1-7]$/.test(String(day))) throw new Error('排课信息异常');
            const weeks = parseWeeks(row.zcd);
            if (weeks.length === 0) throw new Error('周次为空');
            const startSection = +section[1], endSection = +(section[2] || section[1]);
            if (startSection < 1 || endSection < startSection) throw new Error('节次异常');
            courses.push({
                name: name,
                teacher: String(row.xm || '').trim(),
                position: String(row.cdmc || '').trim(),
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        } catch (error) {
            warnings.push('跳过课程 ' + String(row && row.kcmc || '未命名') + '：' + error.message);
        }
    });
    return mergeAndDistinctCourses(courses);
}

// ==================== 学年 / 学期选择 ====================

function getDefaultOptionIndex(options, key) {
    const match = function (value) {
        const text = String(value == null ? '' : value).trim();
        if (!text) return -1;
        for (let i = 0; i < options.length; i++) if (options[i].value === text) return i;
        return -1;
    };
    let index = match(window[key]);
    if (index >= 0) return index;
    try {
        index = match(new URL(window.location.href).searchParams.get(key));
        if (index >= 0) return index;
    } catch (e) { /* ignore */ }
    const selected = options.findIndex(function (option) { return option.selected; });
    return selected >= 0 ? selected : 0;
}

function parseAcademicOptions(doc) {
    const read = function (selector) {
        const list = [];
        const nodes = doc.querySelectorAll(selector);
        for (let i = 0; i < nodes.length; i++) {
            const value = String(nodes[i].value).trim();
            if (nodes[i].disabled || value === '') continue;
            list.push({ value: value, text: nodes[i].textContent.trim(), selected: nodes[i].selected });
        }
        return list;
    };
    const years = read('#xnm option');
    const terms = read('#xqm option');
    if (years.length === 0 || terms.length === 0) throw new Error('未获取到学年学期选项，请确认已登录教务系统后重试');
    const selectedYear = getDefaultOptionIndex(years, 'xnm');
    const start = Math.max(0, selectedYear - 2);
    const yearOptions = years.slice(start, selectedYear + 3);
    return {
        yearOptions: yearOptions,
        termOptions: terms,
        defaultYearIndex: selectedYear - start,
        defaultTermIndex: getDefaultOptionIndex(terms, 'xqm')
    };
}

async function fetchAcademicOptions() {
    const response = await fetch(getBaseUrl() + CJLU_OPTIONS_URL, { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) throw new Error('获取学年学期失败（HTTP ' + response.status + '）');
    const html = await response.text();
    return parseAcademicOptions(new DOMParser().parseFromString(html, 'text/html'));
}

async function selectAcademicYearAndSemester(bridge) {
    const options = await fetchAcademicOptions();
    const select = async function (title, entries, defaultIndex) {
        const result = await bridge.showSingleSelection(title, JSON.stringify(entries.map(function (item) { return item.text; })), defaultIndex);
        if (result === null || result === undefined || String(result).trim() === 'null') return null;
        const index = parseInt(result, 10);
        return entries[index] || null;
    };
    const make = function (year, term) { return { year: year.value, term: term.value, label: year.text + ' / ' + term.text }; };
    const defaultSelection = make(options.yearOptions[options.defaultYearIndex], options.termOptions[options.defaultTermIndex]);
    const action = await select('选择导入学期', [
        { value: 'default', text: '导入默认学期：' + defaultSelection.label },
        { value: 'change', text: '更换学年、学期' }
    ], 0);
    if (!action) return null;
    if (action.value === 'default') return defaultSelection;
    const year = await select('选择学年', options.yearOptions, options.defaultYearIndex);
    if (!year) return null;
    const term = await select('选择学期', options.termOptions, options.defaultTermIndex);
    if (!term) return null;
    return make(year, term);
}

// ==================== 保存 ====================

async function saveWithConfirmation(method, data, label) {
    const result = await window.shiguangBridgePromise[method](JSON.stringify(data));
    if (result !== true && result !== 'true') throw new Error(label + '保存未成功，请重试');
}

// 兜底作息（接口失败时使用；来自教务作息接口实测）
var CJLU_FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:50', endTime: '09:35' },
    { number: 3, startTime: '09:55', endTime: '10:40' },
    { number: 4, startTime: '10:45', endTime: '11:30' },
    { number: 5, startTime: '11:35', endTime: '12:20' },
    { number: 6, startTime: '13:30', endTime: '14:15' },
    { number: 7, startTime: '14:20', endTime: '15:05' },
    { number: 8, startTime: '15:15', endTime: '16:00' },
    { number: 9, startTime: '16:05', endTime: '16:50' },
    { number: 10, startTime: '18:00', endTime: '18:45' },
    { number: 11, startTime: '18:50', endTime: '19:35' },
    { number: 12, startTime: '19:40', endTime: '20:25' }
];

// ==================== 流程编排 ====================

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;
    let coursesSaved = false;
    let saveStage = '课程';
    try {
        if (!/cjlu\.edu\.cn$/i.test(window.location.hostname)) {
            await alertUser('请先进入教务系统', '请登录中国计量大学教务系统后，停留在任意教务页面再执行导入。');
            return;
        }

        const startAlert = await alertUser('中国计量大学课表导入', '导入前请确保已登录教务系统。', '开始导入');
        if (!startAlert) { toast('导入已取消'); return; }

        const selection = await selectAcademicYearAndSemester(bridge);
        if (!selection) { toast('导入已取消'); return; }

        const warnings = [];
        toast('正在获取课程、校历和作息…');
        const kbData = await requestHaue('kbcx/xskbcx_cxXsgrkb.html', {
            xnm: selection.year, xqm: selection.term, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
        }, 'N2151');
        let campusId = '';
        const kbList = Array.isArray(kbData.kbList) ? kbData.kbList : [];
        for (let i = 0; i < kbList.length; i++) {
            if (kbList[i].xqh_id) { campusId = kbList[i].xqh_id; break; }
        }

        const configResult = await Promise.all([
            fetchSemesterConfig(selection.year, selection.term, warnings),
            fetchTimeSlots(selection.year, selection.term, campusId, warnings)
        ]);
        const config = configResult[0];
        const slots = configResult[1] || CJLU_FALLBACK_TIME_SLOTS;
        if (!configResult[1]) warnings.push('已使用内置作息，如需请核对');

        let courses = parseCourses(kbData, warnings);

        // 课程的节次必须在作息里有对应节次，否则跳过并提示（用普通循环，避开被改写的 filter）
        const numbers = new Set();
        for (let i = 0; i < slots.length; i++) numbers.add(slots[i].number);
        const kept = [];
        for (let i = 0; i < courses.length; i++) {
            const course = courses[i];
            let ok = true;
            for (let n = course.startSection; n <= course.endSection; n++) {
                if (!numbers.has(n)) { warnings.push('跳过课程 ' + course.name + '：第 ' + n + ' 节缺少作息'); ok = false; break; }
            }
            if (ok) kept.push(course);
        }
        courses = kept;
        if (courses.length === 0) throw new Error('没有可导入的有效课程，请核对学期。' + (warnings.length ? '\n' + warnings.join('\n') : ''));

        // 总周数不能小于课程最大周次
        if (config.semesterTotalWeeks) {
            const maxWeek = Math.max.apply(null, courses.reduce(function (all, c) { return all.concat(c.weeks); }, [0]));
            if (maxWeek > config.semesterTotalWeeks) {
                warnings.push('校历总周数小于课程周次，未保存总周数');
                delete config.semesterTotalWeeks;
            }
        }

        const practices = Array.isArray(kbData.sjkList) ? kbData.sjkList : [];
        const practiceNote = practices.length
            ? '\n\n以下实践课无固定星期/节次，本次不导入：\n' + practices.map(function (row) { return String(row.kcmc || '未命名') + '（' + String(row.qsjsz || '周次未定') + '）'; }).join('\n')
            : '';
        const message = selection.label + '\n共 ' + courses.length + ' 条课程时段。\n\n作息：\n' +
            slots.map(function (s) { return '第' + s.number + '节 ' + s.startTime + '-' + s.endTime; }).join('\n') +
            '\n\n开学日期：' + (config.semesterStartDate || '需手动设置') +
            '\n学期总周数：' + (config.semesterTotalWeeks || '需手动设置') +
            practiceNote + (warnings.length ? '\n\n注意：\n' + warnings.join('\n') : '');
        const confirmed = await bridge.showAlert('核对课程与作息', message, '确认并保存');
        if (confirmed !== true && confirmed !== 'true') { toast('导入已取消'); return; }

        await saveWithConfirmation('saveImportedCourses', courses, '课程');
        coursesSaved = true;
        saveStage = '作息';
        await saveWithConfirmation('savePresetTimeSlots', slots, '作息');
        if (config.semesterStartDate || config.semesterTotalWeeks) {
            saveStage = '学期配置';
            await saveWithConfirmation('saveCourseConfig', Object.assign({ firstDayOfWeek: 1 }, config), '学期配置');
        }

        toast('已导入 ' + courses.length + ' 条课程时段及 ' + slots.length + ' 节作息');
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        await alertUser('导入未完成', (coursesSaved ? '课程已保存，但' + saveStage + '未保存成功，请重试。\n' : '') + (error && error.message ? error.message : String(error)), '确定');
    }
}

runImportFlow();
