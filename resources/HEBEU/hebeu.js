// 河北工程大学 (hebeu.edu.cn) 拾光课程表适配脚本
// 教务系统：正方教务 v9（新版 UI zftal-ui-v5），根路径部署
// 与常见 /jwglxt 部署相比仅前缀不同：/xtgl，接口路径与页面结构一致
// 登录地址：https://jwglxxfwpt.hebeu.edu.cn/xtgl/login_slogin.html
// 课表、校历与作息均通过接口获取，不解析当前页面 DOM，登录后停留在任意教务页面即可导入
// 参考 resources/JSEI/jsei_01.js（正方 v9 案例）、resources/CJLU/cjlu.js

var HEBEU_OPTIONS_URL = 'kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';

// 正方 v9 根路径部署：仅将 /jwglxt 换成 /xtgl，其余接口与页面结构一致
function getBaseUrl() {
    return window.location.origin + '/';
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
        return !!confirmed;
    }
    alert(title + '\n' + message);
    return true;
}

// ==================== 请求 ====================

async function requestJw(path, params, moduleId) {
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
        return parseSemesterConfig(await requestJw('kbcx/xskbcxZccx_cxZcByXnxq.html', { xnm: year, xqm: term }, 'N2154'));
    } catch (error) {
        warnings.push('校历获取失败：' + error.message);
        return {};
    }
}

// ==================== 作息 ====================

// 兜底作息（2026-2027 学年第 1 学期自教务作息接口实测，xqh_id=108）
var HEBEU_FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:30', endTime: '09:15' },
    { number: 2, startTime: '09:20', endTime: '10:05' },
    { number: 3, startTime: '10:25', endTime: '11:10' },
    { number: 4, startTime: '11:15', endTime: '12:00' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:50', endTime: '15:35' },
    { number: 7, startTime: '15:55', endTime: '16:40' },
    { number: 8, startTime: '16:45', endTime: '17:30' },
    { number: 9, startTime: '19:00', endTime: '19:45' },
    { number: 10, startTime: '19:50', endTime: '20:35' }
];

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
        return parseTimeSlots(await requestJw('jzgl/skxxMobile_cxRsdjc.html', params, 'N2154'));
    } catch (error) {
        warnings.push('作息获取失败：' + error.message);
        return null;
    }
}

// ==================== 周次 / 课程解析 ====================

function parseWeeks(value) {
    const weeks = new Set();
    // 清理 "第" 与 "共 N 周" 等修饰，统一全角标点和分隔符
    const text = normalizeText(value)
        .replace(/周数[:：]/g, '')
        .replace(/第/g, '')
        .replace(/周/g, '')
        .replace(/共\s*\d+\s*.*$/g, '')
        .replace(/（/g, '(').replace(/）/g, ')')
        .replace(/[，、;；]/g, ',');
    text.split(',').forEach(function (part) {
        // 段内可能混合多种写法（如 "5-7(单)8-15"），逐段扫描而非整段匹配
        const segment = part.trim();
        if (!segment) return;
        const segmentRegex = /(\d+)(?:\s*[-~]\s*(\d+))?\s*(?:\(?\s*([单双])\s*周?\s*\)?)?/g;
        let match;
        while ((match = segmentRegex.exec(segment)) !== null) {
            if (match[0] === '') { segmentRegex.lastIndex++; continue; }
            const start = +match[1], end = +(match[2] || match[1]);
            if (start < 1 || end < start || end > 60) continue;
            for (let week = start; week <= end; week++) {
                if (match[3] === '单' && week % 2 === 0) continue;
                if (match[3] === '双' && week % 2 === 1) continue;
                weeks.add(week);
            }
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
            const credit = parseFloat(row.xf);
            const course = {
                name: name,
                teacher: String(row.xm || '').trim(),
                position: String(row.cdmc || '').trim(),
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            };
            if (!isNaN(credit) && credit > 0) course.credit = credit;
            courses.push(course);
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
    const response = await fetch(getBaseUrl() + HEBEU_OPTIONS_URL, { method: 'GET', credentials: 'same-origin' });
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
    if (!result) throw new Error(label + '保存未成功，请重试');
}

// ==================== 流程编排 ====================

async function runImportFlow() {
    const bridge = window.shiguangBridgePromise;
    let coursesSaved = false;
    let saveStage = '课程';
    try {
        if (!/hebeu\.edu\.cn$/i.test(window.location.hostname)) {
            await alertUser('请先进入教务系统', '请登录河北工程大学教务系统后，停留在任意教务页面再执行导入。');
            return;
        }

        const startAlert = await alertUser('河北工程大学课表导入', '导入前请确保已登录教务系统。', '开始导入');
        if (!startAlert) { toast('导入已取消'); return; }

        const selection = await selectAcademicYearAndSemester(bridge);
        if (!selection) { toast('导入已取消'); return; }

        const warnings = [];
        toast('正在获取课程、校历和作息…');
        const kbData = await requestJw('kbcx/xskbcx_cxXsgrkb.html', {
            xnm: selection.year, xqm: selection.term, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: ''
        }, 'N2151');

        // 先判空：未排课的学期（含尚未开放的未来学期）直接提示，不再拉作息
        const kbList = Array.isArray(kbData.kbList) ? kbData.kbList : [];
        if (kbList.length === 0) {
            await alertUser('该学期暂无课程', selection.label + ' 未查询到课程数据。\n\n如该学期尚未选课或课表未发布，请稍后再试或更换学期。', '确定');
            return;
        }

        let campusId = '';
        for (let i = 0; i < kbList.length; i++) {
            if (kbList[i].xqh_id) { campusId = kbList[i].xqh_id; break; }
        }

        const configResult = await Promise.all([
            fetchSemesterConfig(selection.year, selection.term, warnings),
            fetchTimeSlots(selection.year, selection.term, campusId, warnings)
        ]);
        const config = configResult[0];
        let slots = configResult[1];
        if (!slots || !slots.length) {
            slots = HEBEU_FALLBACK_TIME_SLOTS;
            warnings.push('已使用内置作息，如与本校实际作息不符请反馈');
        }

        let courses = parseCourses(kbData, warnings);

        // 校验节次覆盖，缺作息的节次在 App 里排不下，先剔除并提示（用普通循环，避开被改写的 filter）
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
        if (courses.length === 0) throw new Error('课程解析后为空，请核对学期或联系适配维护者。' + (warnings.length ? '\n' + warnings.join('\n') : ''));

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
        if (!confirmed) { toast('导入已取消'); return; }

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
