// 文件: nwafu.js
// ---------------------------------------------------------------------------
// 学校：西北农林科技大学（NWAFU）
// 系统：ehall 新版教务（金智 jwapp）→「我的本研课表」
// 入口：https://newehall.nwafu.edu.cn/（登录后进入「我的本研课表」再执行导入）
//
// 规范：拾光课程表《适配脚本开发指南 v2》
//   · 数据：courses / timeSlots / config / comboSchedule
//   · 桥接：window.shiguangBridgePromise（异步）/ window.shiguangBridge（同步）
//   · 流程：runImportFlow() 编排，成功后才 notifyTaskCompletion()

// 作息：按学校作息时间表硬编码（第 1-4 节冬夏相同，第 5 节起不同）
//   夏令：当年 05.01 — 当年 10.01；冬令：当年 10.01 — 次年 05.01
// ---------------------------------------------------------------------------

// ==================== 常量 ====================

const APP_CODE = 'wdkbby';
const URL_TERM = '/modules/jshkcb/dqxnxq.do';
const URL_TERM_LIST = '/modules/jshkcb/xnxqcx.do';
const URL_COURSE = '/modules/xskcb/cxxszhxqkb.do';
const URL_CALENDAR = '/modules/xskcb/cxxljc.do';
const URL_SECTIONS = '/modules/jshkcb/cxjcs.do';
const ACTION_TERM = 'dqxnxq';
const ACTION_TERM_LIST = 'xnxqcx';
const ACTION_COURSE = 'cxxszhxqkb';
const ACTION_CALENDAR = 'cxxljc';
const ACTION_SECTIONS = 'cxjcs';
const PORTAL_HINT = 'newehall.nwafu.edu.cn 新门户 →「我的本研课表」';

const DEFAULT_TOTAL_WEEKS = 20;
const MAX_TOTAL_WEEKS = 30;

// ==================== 作息（学校作息时间表） ====================

const SLOTS_WINTER = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:10', endTime: '10:55' },
    { number: 4, startTime: '11:05', endTime: '11:50' },
    { number: 5, startTime: '14:00', endTime: '14:45' },
    { number: 6, startTime: '14:55', endTime: '15:40' },
    { number: 7, startTime: '16:00', endTime: '16:45' },
    { number: 8, startTime: '16:55', endTime: '17:40' },
    { number: 9, startTime: '19:00', endTime: '19:45' },
    { number: 10, startTime: '19:50', endTime: '20:35' },
    { number: 11, startTime: '20:40', endTime: '21:25' }
];

const SLOTS_SUMMER = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:10', endTime: '10:55' },
    { number: 4, startTime: '11:05', endTime: '11:50' },
    { number: 5, startTime: '14:30', endTime: '15:15' },
    { number: 6, startTime: '15:25', endTime: '16:10' },
    { number: 7, startTime: '16:30', endTime: '17:15' },
    { number: 8, startTime: '17:25', endTime: '18:10' },
    { number: 9, startTime: '19:30', endTime: '20:15' },
    { number: 10, startTime: '20:20', endTime: '21:05' },
    { number: 11, startTime: '21:10', endTime: '21:55' }
];

// ==================== 工具 ====================

function toast(message) {
    try {
        window.shiguangBridge.showToast(String(message));
    } catch (e) {
        console.warn('[NWAFU] showToast 不可用:', e && e.message);
    }
}

function log(message) {
    try {
        console.log('[NWAFU 课表适配] ' + message);
    } catch (e) { /* ignore */ }
}

function textOf(value) {
    if (value === null || value === undefined) return '';
    const result = String(value).replace(/\u00a0/g, ' ').trim();
    if (result === 'null' || result === 'undefined') return '';
    return result;
}

function uniqueSorted(numbers) {
    return Array.from(new Set(numbers.filter((n) => typeof n === 'number' && !isNaN(n) && n > 0)))
        .sort((a, b) => a - b);
}

/** 教师字段去重 **/
function cleanTeacher(value) {
    const raw = textOf(value);
    if (!raw) return '';
    const names = raw.split(/[,，、;；]/).map((item) => textOf(item)).filter((item) => item !== '');
    return Array.from(new Set(names)).join(',') || raw;
}

// ==================== 教务接口 ====================

function rootPath() {
    const config = window._JW_INIT_CONFIG || {};
    let root = config.path || config.ROOT_PATH || config.contextPath || '/jwapp';
    root = String(root);
    if (root.charAt(0) !== '/') root = '/' + root;
    return root.replace(/\/+$/, '');
}

function encodeForm(data) {
    const pairs = [];
    Object.keys(data || {}).forEach((key) => {
        const value = data[key];
        if (value === null || value === undefined) return;
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return pairs.join('&');
}

/** 与教务页面自身（BH_UTILS.doSyncAjax）等价的表单 POST：同源、带 Cookie */
async function api(modulePath, data) {
    const response = await fetch(rootPath() + '/sys/' + APP_CODE + modulePath, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest'
        },
        body: encodeForm(data || {})
    });

    if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : '?'));

    const raw = await response.text();
    let json;
    try {
        json = JSON.parse(raw);
    } catch (e) {
        throw new Error('返回内容不是 JSON（很可能登录已失效）');
    }
    if (json && json.loginURL) throw new Error('登录状态已失效，请重新登录');
    return json;
}

/** 取出 {datas:{<action>:{rows:[...]}}} 中的 rows */
function rowsOf(response, action) {
    if (!response || !response.datas) return null;
    const node = response.datas[action];
    if (!node || !node.rows || typeof node.rows.length !== 'number') return null;
    if (node.rows.length === 0 && node.extParams && String(node.extParams.code) !== '1') return null;
    return node.rows;
}

function messageOf(response) {
    if (!response || !response.datas) return '';
    const keys = Object.keys(response.datas);
    for (let i = 0; i < keys.length; i++) {
        const node = response.datas[keys[i]];
        if (node && node.extParams && node.extParams.msg) return String(node.extParams.msg);
    }
    return '';
}

// ==================== 学年学期 ====================

/** 当前学年学期（dqxnxq.do），用于学期列表的默认选中项 */
async function fetchTerm() {
    const response = await api(URL_TERM, {});
    const rows = rowsOf(response, ACTION_TERM);
    if (!rows || !rows.length) {
        throw new Error('未能获取当前学年学期' + (messageOf(response) ? '：' + messageOf(response) : ''));
    }
    const dm = textOf(rows[0].DM);
    if (!dm) throw new Error('学年学期接口未返回学期代码');
    return { dm: dm, mc: textOf(rows[0].MC) };
}

/** 学期列表（xnxqcx.do，按学期代码降序 = 最新在前） */
async function fetchTermList() {
    const response = await api(URL_TERM_LIST, { '*order': '-DM' });
    const rows = rowsOf(response, ACTION_TERM_LIST);
    if (!rows || !rows.length) return [];
    return sortTermsDesc(rows);
}

/** 规整学期行并降序排列 */
function sortTermsDesc(rows) {
    return (rows || [])
        .map((row) => ({ dm: textOf(row && row.DM), mc: textOf(row && row.MC) }))
        .filter((term) => term.dm)
        .sort((a, b) => b.dm.localeCompare(a.dm));
}

/** 学期显示文本 */
function termText(term) {
    const mc = textOf(term && term.mc);
    return mc || textOf(term && term.dm);
}

/** 默认选中当前学期；列表中找不到则选第一条 */
function defaultTermIndex(list, currentDm) {
    if (!Array.isArray(list) || !list.length) return -1;
    const key = textOf(currentDm);
    if (!key) return 0;
    const index = list.findIndex((term) => term.dm === key);
    return index >= 0 ? index : 0;
}

/**
 * 让用户选择要导入的学期（官方 API：showSingleSelection）。
 * 返回 { dm, mc }；用户取消返回 null。
 */
async function selectTerm() {
    let list = [];
    try {
        list = await fetchTermList();
    } catch (e) {
        log('学期列表接口失败，退回当前学期: ' + e.message);
    }

    let currentDm = '';
    try {
        const current = await fetchTerm();
        currentDm = current.dm;
        if (!list.length) list = [current];
    } catch (e) {
        log('当前学期接口失败: ' + e.message);
    }

    if (!list.length) throw new Error('未能获取学期列表，请先登录教务并打开「我的本研课表」');
    if (list.length === 1) return list[0];

    const labels = list.map((term) => termText(term));
    const selected = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期',
        JSON.stringify(labels),
        defaultTermIndex(list, currentDm)
    );
    if (selected === null || selected === undefined) return null;

    const index = Number(selected);
    if (!(index >= 0 && index < list.length)) return null;
    return list[index];
}

/** "2026-2027-1" → { xn: "2026-2027", xq: "1" } */
function termCodes(dm) {
    const parts = textOf(dm).split('-');
    if (parts.length < 3) return null;
    const xn = parts[0] + '-' + parts[1];
    const xq = parts[2];
    if (!/^\d{4}-\d{4}$/.test(xn) || !/^\d+$/.test(xq)) return null;
    return { xn: xn, xq: xq };
}

/**
 * 校历：所选学期的开学日期 + 校历总周数
 *   POST {ROOT}/sys/wdkbby/modules/xskcb/cxxljc.do  { XN, XQ }
 *   rows[0].XQKSRQ → 开学日期；rows[0].ZZC → 校历总周数
 * 取不到返回 null（不影响课程导入）。
 */
async function fetchTermCalendar(dm) {
    const codes = termCodes(dm);
    if (!codes) return null;

    const response = await api(URL_CALENDAR, { XN: codes.xn, XQ: codes.xq });
    const rows = rowsOf(response, ACTION_CALENDAR);
    if (!rows || !rows.length) return null;

    const rawDate = textOf(rows[0].XQKSRQ);
    const startDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.substring(0, 10) : '';
    const totalWeeks = parseInt(textOf(rows[0].ZZC), 10);

    if (!startDate && !(totalWeeks > 0)) return null;
    return {
        startDate: startDate,
        totalWeeks: totalWeeks > 0 ? Math.min(totalWeeks, MAX_TOTAL_WEEKS) : 0
    };
}

// ==================== 周次解析 ====================

/** 周次位串，例如 "0000111111111111110000"（第 5-18 周）→ [5..18] */
function parseWeekBitString(value) {
    const raw = textOf(value);
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, '');
    if (!/^[01]+$/.test(compact)) return null;
    if (compact.length < 1 || compact.length > 60) return null;
    const weeks = [];
    for (let i = 0; i < compact.length; i++) {
        if (compact.charAt(i) === '1') weeks.push(i + 1);
    }
    return weeks;
}

// 周次表达式：6-18周 / 4周 / 7-17周(单) / 4-6周(双),8-13周 / 5-16周,18周
const WEEK_GROUP = '\\d+\\s*(?:[-~至]\\s*\\d+)?\\s*(?:[（(]\\s*[单双]\\s*[)）])?\\s*周\\s*(?:[（(]\\s*[单双]\\s*[)）])?';
const WEEK_EXPRESSION = '(?:' + WEEK_GROUP + '\\s*[,，、]?\\s*)+';

/** 解析一段周次内容（可含逗号分隔的多组、单双周标记） */
function parseWeekSegments(expression) {
    const raw = textOf(expression);
    if (!raw) return [];

    const weeks = [];
    raw.split(/[,，、]/).forEach((segment) => {
        if (!segment) return;
        let parity = 0; // 0=全部 1=单周 2=双周
        if (segment.indexOf('单') !== -1) parity = 1;
        if (segment.indexOf('双') !== -1) parity = 2;

        const rangePattern = /(\d+)\s*(?:[-~至]\s*(\d+))?/g;
        let match;
        while ((match = rangePattern.exec(segment)) !== null) {
            const start = parseInt(match[1], 10);
            let end = match[2] ? parseInt(match[2], 10) : start;
            if (isNaN(start) || start <= 0) continue;
            if (isNaN(end) || end < start) end = start;
            if (end - start > 60) end = start;
            for (let week = start; week <= end; week++) {
                if (parity === 1 && week % 2 === 0) continue;
                if (parity === 2 && week % 2 === 1) continue;
                weeks.push(week);
            }
        }
    });
    return uniqueSorted(weeks);
}

/** 只截取周次表达式，避免把「第3节-第4节」当周次 */
function matchWeekExpression(raw) {
    const match = new RegExp(WEEK_EXPRESSION).exec(raw);
    if (!match || !match[0]) return null;

    let start = match.index;
    const back = /(?:\d+\s*(?:[-~至]\s*\d+)?\s*[,，、]\s*)+$/.exec(raw.substring(0, start));
    if (back) start -= back[0].length;

    return { index: start, text: raw.substring(start, match.index + match[0].length) };
}

/** 周次文本："6-18周" / "4周" / "1-16周(单)" / "1,3,5周" */
function parseWeeksDescription(value) {
    const raw = textOf(value);
    if (!raw) return [];

    const matched = matchWeekExpression(raw);
    if (matched) {
        const weeks = parseWeekSegments(matched.text);
        if (weeks.length) return weeks;
    }
    const head = raw.split('周')[0] || '';
    return parseWeekSegments(head.replace(/^[^\d]*/, ''));
}

// ==================== 接口数据 → 课程 ====================

function buildPosition(row) {
    const room = textOf(row.JASMC) || textOf(row.JAS);
    if (room) return room;
    const building = textOf(row.JXLDM_DISPLAY) || textOf(row.JXLMC);
    if (building) return building;
    return textOf(row.XXXQMC);
}

function parseCourseRow(row) {
    if (!row) return null;

    const day = parseInt(textOf(row.SKXQ), 10);
    if (!(day >= 1 && day <= 7)) return null;

    const baseName = textOf(row.KCM);
    if (!baseName) return null;
    const alias = textOf(row.TYXMDM_DISPLAY);
    const name = alias ? (baseName + '(' + alias + ')') : baseName;

    const startSection = parseInt(textOf(row.KSJC), 10);
    let endSection = parseInt(textOf(row.JSJC), 10);
    if (!(startSection > 0)) return null;
    if (isNaN(endSection) || endSection < startSection) endSection = startSection;

    let weeks = parseWeekBitString(row.SKZC);
    if (!weeks || !weeks.length) weeks = parseWeeksDescription(row.ZCMC);
    if (!weeks || !weeks.length) return null; // 周次无法确定：不完整课程，忽略

    return {
        name: name,
        teacher: cleanTeacher(row.SKJS),
        position: buildPosition(row),
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

async function fetchCourses(term) {
    const response = await api(URL_COURSE, { XNXQDM: term.dm });
    const rows = rowsOf(response, ACTION_COURSE);
    if (!rows) {
        const message = messageOf(response);
        throw new Error('课表接口未返回数据' + (message ? '：' + message : ''));
    }
    if (!rows.length) throw new Error('课表接口返回 0 条记录（该学期可能没有排课）');

    const courses = [];
    let maxWeekBits = 0;
    rows.forEach((row) => {
        const bits = textOf(row.SKZC).replace(/\s+/g, '');
        if (/^[01]+$/.test(bits) && bits.length > maxWeekBits) maxWeekBits = bits.length;
        const course = parseCourseRow(row);
        if (course) courses.push(course);
    });

    if (!courses.length) throw new Error('课表接口返回 ' + rows.length + ' 条记录，但均无法解析出课程');
    log('接口返回 ' + rows.length + ' 条排课记录，解析出 ' + courses.length + ' 条（忽略 ' + (rows.length - courses.length) + ' 条不完整记录）');
    return { courses: courses, maxWeekBits: maxWeekBits };
}

// ==================== 合并去重（官方参考实现） ====================

/**
 * 节次与周次合并去重函数
 * 来源：拾光课程表 wiki《课程合并与去重函数》
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses || [];

    const list = courses.map((c) => Object.assign({}, c, {
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? c.weeks.slice().sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
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

    // 阶段 2：合并同节次的周次
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
            cur.weeks = Array.from(new Set(cur.weeks.concat(nxt.weeks))).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// ==================== 作息方案 ====================

function pad2(value) {
    return value < 10 ? ('0' + value) : String(value);
}

/** 生成 "YYYY-MM-DD" */
function dateText(year, month, day) {
    return String(year) + '-' + pad2(month) + '-' + pad2(day);
}

/**
 * 生成「冬令 + 夏令」两段作息（区间为闭区间，结束日取下一段开始日前一天）：
 *   夏令 05-01 ~ 09-30；冬令 10-01 ~ 次年 04-30
 * 只生成「当前时段 + 下一时段」两条规则，避免同一日期命中多条。
 */
function buildComboSchedule(today, winterSlots, summerSlots) {
    const winter = winterSlots || SLOTS_WINTER;
    const summer = summerSlots || SLOTS_SUMMER;
    const date = today || new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    let rules;
    if (month >= 5 && month <= 9) {
        rules = [
            { name: '夏令作息', startDate: dateText(year, 5, 1), endDate: dateText(year, 9, 30), timeSlots: summer },
            { name: '冬令作息', startDate: dateText(year, 10, 1), endDate: dateText(year + 1, 4, 30), timeSlots: winter }
        ];
    } else if (month >= 10) {
        rules = [
            { name: '冬令作息', startDate: dateText(year, 10, 1), endDate: dateText(year + 1, 4, 30), timeSlots: winter },
            { name: '夏令作息', startDate: dateText(year + 1, 5, 1), endDate: dateText(year + 1, 9, 30), timeSlots: summer }
        ];
    } else {
        rules = [
            { name: '冬令作息', startDate: dateText(year - 1, 10, 1), endDate: dateText(year, 4, 30), timeSlots: winter },
            { name: '夏令作息', startDate: dateText(year, 5, 1), endDate: dateText(year, 9, 30), timeSlots: summer }
        ];
    }

    return { name: '西北农林科技大学作息（冬令/夏令）', publicSchedules: rules };
}

/** 分钟数 → "HH:mm" */
function hhmm(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    return pad2(hour) + ':' + pad2(minutes % 60);
}

/**
 * 课程节次超出作息表时补足（45 分钟上课 + 10 分钟课间）。
 * 正常学期不会触发（作息表 11 节），只有教务临时加节时兜底，避免课程引用不存在的节次。
 */
function extendSlots(base, maxSection) {
    const slots = (base || []).map((slot) => ({
        number: slot.number,
        startTime: slot.startTime,
        endTime: slot.endTime
    }));
    if (!slots.length) return slots;

    const target = Math.min(Math.max(parseInt(maxSection, 10) || slots.length, slots.length), 20);
    while (slots.length < target) {
        const last = slots[slots.length - 1];
        const parts = last.endTime.split(':');
        const startMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + 10;
        slots.push({
            number: slots.length + 1,
            startTime: hhmm(startMinutes),
            endTime: hhmm(startMinutes + 45)
        });
    }
    return slots;
}

/** 课程里出现的最大的结束节次 */
function maxSectionOf(courses) {
    let max = 0;
    (courses || []).forEach((course) => {
        const end = parseInt(course && course.endSection, 10);
        if (end > max) max = end;
    });
    return max;
}

/**
 * 节次结构（cxjcs.do）：上午 / 下午 / 晚上各几节。
 * 仅用于日志核对硬编码作息是否过期，取不到不影响导入。
 */
async function fetchSectionLayout(dm) {
    const codes = termCodes(dm);
    if (!codes) return null;

    const response = await api(URL_SECTIONS, { XN: codes.xn, XQ: codes.xq });
    const rows = rowsOf(response, ACTION_SECTIONS);
    if (!rows || !rows.length) return null;

    const row = rows[0];
    const morning = parseInt(textOf(row.SFJJ), 10) || 0;
    const afternoon = parseInt(textOf(row.XFJJ), 10) || 0;
    const evening = parseInt(textOf(row.WSJJ), 10) || 0;
    return { morning: morning, afternoon: afternoon, evening: evening, total: morning + afternoon + evening };
}

/** 课表配置：优先用校历给的开学日期与总周数 */
function buildCourseConfig(calendar, courseWeeks) {
    const totalWeeks = (calendar && calendar.totalWeeks > 0) ? calendar.totalWeeks : courseWeeks;
    const config = { semesterTotalWeeks: totalWeeks };
    if (calendar && calendar.startDate) config.semesterStartDate = calendar.startDate;
    return config;
}

// ==================== 保存 ====================

async function saveConfig(config) {
    try {
        return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        toast('保存课表配置失败: ' + error.message);
        return false;
    }
}

async function saveCourses(courses) {
    try {
        return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (error) {
        toast('保存课程失败: ' + error.message);
        return false;
    }
}

// ==================== 主导入流程 ====================

/** 前置确认 */
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        '导入确认',
        '将从西北农林科技大学「我的本研课表」导入课程与作息。\n'
        + '请先登录 ' + PORTAL_HINT + '，再点击开始导入；\n'
        + '导入时可选择要导入的学期（默认当前学期）。',
        '开始导入'
    );
    if (!confirmed) {
        toast('已取消导入');
        return false;
    }
    toast('正在读取课表数据…');
    return true;
}

function computeTotalWeeks(courses, maxWeekBits) {
    let maxWeek = 0;
    courses.forEach((course) => {
        (course.weeks || []).forEach((week) => {
            if (week > maxWeek) maxWeek = week;
        });
    });
    let total = Math.max(maxWeek, maxWeekBits || 0);
    if (!total) total = DEFAULT_TOTAL_WEEKS;
    return Math.min(Math.max(total, 1), MAX_TOTAL_WEEKS);
}

/** 编排整个导入流程：成功才发送结束信号 */
/**
 * 作息保存：先基础作息（冬令），再冬令/夏令组合方案。
 * 官方要求 savePresetTimeSlots 必须先成功，否则 saveComboSchedule 会被拒绝。
 */
async function saveSchedule(winterSlots, summerSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(winterSlots));
        await window.shiguangBridgePromise.saveComboSchedule(
            JSON.stringify(buildComboSchedule(new Date(), winterSlots, summerSlots))
        );
        return true;
    } catch (e) {
        log('作息导入失败（不影响课程）: ' + e.message);
        return false;
    }
}

/** 校历与会话信息：失败都不影响课程导入 */
async function loadExtras(dm) {
    let calendar = null;
    try {
        calendar = await fetchTermCalendar(dm);
    } catch (e) {
        log('校历接口失败（不影响导入）: ' + e.message);
    }

    let layout = null;
    try {
        layout = await fetchSectionLayout(dm);
    } catch (e) {
        log('节次结构接口失败: ' + e.message);
    }
    if (layout && layout.total > 0) {
        log('教务节次结构：上午 ' + layout.morning + ' / 下午 ' + layout.afternoon
            + ' / 晚上 ' + layout.evening + ' 节（合计 ' + layout.total + '）');
    }
    return calendar;
}

/** 编排整个导入流程（只做流程控制）：成功才发送结束信号 */
async function runImportFlow() {
    try {
        if (!(await promptUserToStart())) return;

        // 1) 选择学期（默认当前学期；已结束且下学期已公布时可选下学期）
        const term = await selectTerm();
        if (!term) {
            toast('已取消导入');
            return;
        }
        log('选中学期: ' + term.dm + ' / ' + termText(term));

        // 2) 该学期课程 + 校历
        const fetched = await fetchCourses(term);
        const courses = mergeAndDistinctCourses(fetched.courses);
        const calendar = await loadExtras(term.dm);

        // 3) 配置 → 课程
        const config = buildCourseConfig(calendar, computeTotalWeeks(courses, fetched.maxWeekBits));
        if (!(await saveConfig(config))) {
            toast('课表配置保存失败，导入终止');
            return;
        }
        if (!(await saveCourses(courses))) {
            toast('课程保存失败，导入终止');
            return;
        }

        // 4) 作息（节次超出作息表时自动补足）→ 组合作息
        const maxSection = maxSectionOf(courses);
        if (maxSection > SLOTS_WINTER.length) {
            log('课程出现第 ' + maxSection + ' 节，作息自动补足到 ' + maxSection + ' 节');
        }
        const winterSlots = extendSlots(SLOTS_WINTER, maxSection);
        const summerSlots = extendSlots(SLOTS_SUMMER, maxSection);
        const scheduleImported = await saveSchedule(winterSlots, summerSlots);

        // 5) 完成
        toast(
            '导入成功：' + courses.length + ' 门课程'
            + (scheduleImported ? '，已写入冬令/夏令作息' : '，作息导入失败')
            + (calendar && calendar.startDate ? '，开学 ' + calendar.startDate : '')
            + '（' + termText(term) + '）'
        );
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await reportFailure(error);
    }
}

/** 失败提示：优先弹窗，弹窗不可用时退回 toast */
async function reportFailure(error) {
    const message = '导入失败：' + (error && error.message ? error.message : String(error));
    console.error('[NWAFU 课表适配] ' + message);
    try {
        await window.shiguangBridgePromise.showAlert(
            '导入失败',
            message + '\n\n请先登录 ' + PORTAL_HINT + '，打开课表页面后重试。',
            '知道了'
        );
    } catch (e) {
        toast(message);
    }
}
// 启动导入流程
runImportFlow();
