// 肇庆学院(zqu.edu.cn) 拾光课程表适配脚本
// 教务系统：URP 系（Struts2，形如 xxx!yyy.action）
// 适用范围：校外经 WebVPN 访问、或校内直连，两种渠道均支持。
// 渠道由当前页面 URL 自动识别（见 siteBase），无需分别提供脚本。
// 维护者：NoobLLiu
//
// 课表数据直接取自后台 JSON 接口，不做 HTML 表格解析：
//     GET xsgrkbcx!getKbRq.action?xnxqdm=<学年学期>&zc=<周次>&xsdm=
// zc 传空即不限周次，一次可取回整学期排课记录；每条记录自带 zc 字段
// 标明该门课的上课周次，因此无需逐周请求，也无需读取页面 DOM。
//
// 使用前提：用户已在弹窗打开的网页中登录教务系统，
// 停留在教务系统内的任意页面即可，无需打开课表查询页。

// ---------------------------------------------------------------- 常量

// 「我的课表」内容页，本脚本只用它取服务端渲染的学期下拉框 #xnxqdm
const KB_LIST_PAGE = 'xsgrkbcx!getXsgrbkList.action';
// 课表数据接口（返回 JSON）
const KB_DATA = 'xsgrkbcx!getKbRq.action';

// 肇庆学院作息时间（每天 14 节），依据学校实际作息表。
// 教务系统不提供作息数据，导入时按此预设写入。
const PRESET_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:40' },
    { number: 2, startTime: '08:50', endTime: '09:30' },
    { number: 3, startTime: '09:50', endTime: '10:30' },
    { number: 4, startTime: '10:40', endTime: '11:20' },
    { number: 5, startTime: '11:30', endTime: '12:10' },
    { number: 6, startTime: '14:30', endTime: '15:10' },
    { number: 7, startTime: '15:20', endTime: '16:00' },
    { number: 8, startTime: '16:15', endTime: '16:55' },
    { number: 9, startTime: '17:05', endTime: '17:45' },
    { number: 10, startTime: '17:55', endTime: '18:35' },
    { number: 11, startTime: '19:00', endTime: '19:40' },
    { number: 12, startTime: '19:50', endTime: '20:30' },
    { number: 13, startTime: '20:40', endTime: '21:20' },
    { number: 14, startTime: '21:30', endTime: '22:10' }
];

// 教室字段为空时的占位文本（教务系统尚未给出教室信息）
const UNKNOWN_POSITION = '未获取到教室';

// ---------------------------------------------------------------- 工具函数

/**
 * 推算教务系统的站点根路径。
 *
 * 两种登录渠道下页面地址形如：
 *   校外 WebVPN：https://webvpn.zqu.edu.cn/https/<加密串>/xsgrkbcx!getXsgrbkList.action
 *   校内直连：    https://jwgl.zqu.edu.cn/xsgrkbcx!getXsgrbkList.action
 *
 * 二者只是站点根不同，其余完全一致。因此这里不判断渠道，
 * 只按教务内部页面的路径特征截断：取到 xsgrkbcx! 之前的一段即为站点根
 * （WebVPN 场景会自然带上 <加密串>/ 这一层），后续所有接口都基于它拼接。
 */
function siteBase() {
    try {
        const u = new URL(window.location.href);
        const path = u.pathname;
        // 本脚本只请求 xsgrkbcx! 下两个接口，取该段之前的一段即为站点基址。
        // 停留在别的页面时匹配不到，退回按最后一段斜杠截断，效果相同。
        const i = path.indexOf('xsgrkbcx!');
        if (i > 0) return u.origin + path.slice(0, i);
        const j = path.lastIndexOf('/');
        return u.origin + (j > 0 ? path.slice(0, j + 1) : '/');
    } catch (e) {
        const href = window.location.href.split(/[?#]/)[0];
        const i = href.lastIndexOf('/');
        return i > 0 ? href.slice(0, i + 1) : href;
    }
}

/**
 * 读取某个 document 里的下拉框选项（跳过空值项）。
 * 目前只用于解析学期下拉框 #xnxqdm。
 * @returns {{cur: string, opts: Array<{value: string, text: string}>}|null}
 */
function readSelectOptions(doc, id) {
    let sel;
    try {
        sel = doc.querySelector('#' + id);
    } catch (e) {
        return null;
    }
    if (!sel || !sel.options) return null;

    const opts = [];
    for (let i = 0; i < sel.options.length; i++) {
        const v = String(sel.options[i].value).trim();
        if (v === '') continue;
        opts.push({ value: v, text: (sel.options[i].textContent || '').trim() });
    }
    if (opts.length === 0) return null;
    return { cur: String(sel.value).trim(), opts: opts };
}

/**
 * 解析节次字段，返回节号数组。
 * jcdm2 形如 "01,02,03"；jcdm 形如 "0102"（连写）。
 */
function parseSections(jcdm2, jcdm) {
    const txt = String(jcdm2 || jcdm || '').trim();
    const nums = [];
    const push = n => { if (n > 0 && nums.indexOf(n) === -1) nums.push(n); };
    for (const raw of txt.split(/[,\s]+/)) {
        const part = raw.trim();
        if (!part || !/^\d+$/.test(part)) continue;
        if (part.length <= 2) {
            push(parseInt(part, 10));
        } else {
            for (let i = 0; i < part.length; i += 2) {
                push(parseInt(part.slice(i, i + 2), 10));
            }
        }
    }
    return nums.sort((a, b) => a - b);
}

/**
 * 解析课程记录自带的周次字段，返回周号数组。
 *
 * 教务系统在不同部署下 zc 字段有多种写法，故一并兼容：
 *   "1-8,10-17周"      区间（URP 系最常见）
 *   "1,3,5周"          逗号分隔
 *   "1111111100000000" 位串（正方形教务 classWeek 写法，第 i 位为 1 表示第 i+1 周）
 *   "1-16(单)"         带单双周后缀
 * 返回值已去重并升序。
 */
function parseWeekText(zc) {
    const txt = String(zc === null || zc === undefined ? '' : zc).trim();
    if (!txt) return [];

    // 位串：只由 0/1 组成且长度 >= 4，视为「第 i+1 周」标记
    if (/^[01]{4,}$/.test(txt)) {
        const out = [];
        for (let i = 0; i < txt.length; i++) {
            if (txt[i] === '1') out.push(i + 1);
        }
        return out;
    }

    // 区间 / 列表：先去掉「周、单、双、(单)、(双)」等修饰再切分
    const cleaned = txt
        .replace(/周|星期/g, '')
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/[单双]/g, '');
    const out = [];
    for (const raw of cleaned.split(/[,，\s]+/)) {
        const part = raw.trim();
        if (!part) continue;
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
        if (range) {
            const a = parseInt(range[1], 10);
            const b = parseInt(range[2], 10);
            if (a > 0 && b >= a) {
                for (let i = a; i <= b; i++) out.push(i);
            }
            continue;
        }
        if (/^\d+$/.test(part)) {
            const n = parseInt(part, 10);
            if (n > 0) out.push(n);
        }
    }
    return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重函数（摘自拾光课程表官方 wiki 的参考实现）。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
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
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// ---------------------------------------------------------------- 数据获取

/**
 * 读取学期下拉框。
 *
 * 学期下拉框由服务端随页面一起下发，所以请求一次内容页并解析返回的 HTML 即可。
 */
async function fetchTermOptions(base) {
    const resp = await fetch(base + KB_LIST_PAGE, { method: 'GET', credentials: 'include' });
    if (!resp.ok) throw new Error('学期列表请求失败（HTTP ' + resp.status + '）');

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const terms = readSelectOptions(doc, 'xnxqdm');
    if (!terms) throw new Error('未找到学期列表，请确认已登录并进入教务系统');
    return terms;
}

/**
 * 请求整个学期的课表原始数据（一次请求）。
 *
 * zc 传空字符串表示不限周次，服务端会返回整学期数据，
 * 每条记录自带的 zc 字段即该门课上课的周次，无需逐周请求。
 *
 * 注意：不限周次时服务端不返回日期数组，学期开始日期需另行获取（见 fetchFirstWeekStart）。
 * @returns {Array|null} 课程记录数组，取不到返回 null
 */
async function fetchTermData(base, termCode) {
    const url = base + KB_DATA +
        '?xnxqdm=' + encodeURIComponent(termCode) +
        '&zc=&xsdm=';

    const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!resp.ok) return null;

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        // 未登录/被拦截时会返回 HTML，交由上层统一提示
        return null;
    }
    if (!Array.isArray(data) || data.length < 2) return null;
    return data[0] || [];
}

/**
 * 请求第 1 周的课表，取其中的周一日期作为学期开始日期。
 *
 * 不限周次的那次请求不返回日期数组，所以这里单独取一次第 1 周 ——
 * 一次请求即可确定开学日期，无需逐周探测。
 * @returns {string|null} "YYYY-MM-DD"，取不到返回 null
 */
async function fetchFirstWeekStart(base, termCode) {
    const url = base + KB_DATA +
        '?xnxqdm=' + encodeURIComponent(termCode) +
        '&zc=1&xsdm=';

    try {
        const resp = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!resp.ok) return null;

        const data = JSON.parse(await resp.text());
        if (!Array.isArray(data) || data.length < 2) return null;

        // dates 里取星期一的日期
        for (const d of (data[1] || [])) {
            if (!d) continue;
            if (parseInt(d.xqmc, 10) !== 1) continue;
            const rq = String(d.rq || '').trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(rq)) return rq;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 解析整学期数据，聚合成拾光课程表需要的课程数组。
 *
 * 服务端一次返回整学期的排课记录，每条自带 zc（该门课上课的周次），
 * 因此这里按「课程名+教师+教室+星期+起止节次」聚合出 weeks 数组，
 * 同一门课的多个周次会归并到同一条记录。
 */
function collectCourses(records) {
    const courses = [];

    for (const c of records) {
        if (!c || typeof c !== 'object') continue;

        const day = parseInt(c.xq, 10);
        if (!Number.isInteger(day) || day < 1 || day > 7) continue;

        const name = String(c.kcmc || '').trim();
        if (!name) continue;

        const sections = parseSections(c.jcdm2, c.jcdm);
        if (sections.length === 0) continue;

        const weeks = parseWeekText(c.zc);
        if (weeks.length === 0) continue;

        const teacher = String(c.teaxms || '').trim();
        const position = String(c.jxcdmc || '').trim() || UNKNOWN_POSITION;
        const startSection = sections[0];
        const endSection = sections[sections.length - 1];

        // 同一门课同一时段可能有多条记录（不同周次区间），按周次归并
        const exist = courses.find(x =>
            x.name === name && x.teacher === teacher && x.position === position &&
            x.day === day && x.startSection === startSection && x.endSection === endSection
        );
        if (exist) {
            exist.weeks = Array.from(new Set([...exist.weeks, ...weeks])).sort((a, b) => a - b);
        } else {
            courses.push({
                name: name,
                teacher: teacher,
                position: position,
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }

    // 总周数取所有课程周次的最大值；一条都取不到时保持 0，交给 App 默认值。
    // 这里用 reduce 而非 Math.max(...spread)，避免周次过多时参数展开爆栈。
    const totalWeeks = courses.reduce(
        (max, c) => c.weeks.reduce((m, w) => (w > m ? w : m), max),
        0
    );

    return {
        courses: mergeAndDistinctCourses(courses),
        totalWeeks: totalWeeks
    };
}

// ---------------------------------------------------------------- 交互

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '肇庆学院课表导入',
        '导入前请确认：\n1) 已进入教务系统（校外经 WebVPN、校内直连均可）；\n2) 停留在教务系统任意页面即可，无需打开课表查询。',
        '开始导入'
    );
}

/**
 * 开学日期输入框的校验函数（须挂在全局作用域，供原生侧调用）。
 * 返回 false 表示通过，返回字符串表示错误提示。
 */
function validateDate(input) {
    if (!input || !input.trim()) return '请输入开学日期';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return '格式应为 YYYY-MM-DD，例如 2026-08-31';
    return false;
}

/**
 * 让用户确认（必要时修正）开学日期。
 * 自动取到的值作为默认值；若未能取到，则由用户手动输入。
 */
async function confirmStartDate(defaultDate) {
    const tip = defaultDate
        ? '请确认本学期第 1 周的周一日期（如有误可直接修改）：'
        : '未能自动取到开学日期，请手动输入本学期第 1 周的周一日期：';
    return await window.shiguangBridgePromise.showPrompt(
        '确认开学日期',
        tip,
        defaultDate || '',
        'validateDate'
    );
}

async function selectTerm(terms) {
    const texts = terms.opts.map(o => o.text);
    let defIdx = terms.opts.findIndex(o => o.value === terms.cur);
    if (defIdx < 0) defIdx = 0;

    const idx = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期', JSON.stringify(texts), defIdx);
    if (idx === null || idx < 0 || idx >= terms.opts.length) return null;
    return terms.opts[idx];
}

async function importPresetTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast('导入时间段失败: ' + error.message);
    }
}

// ---------------------------------------------------------------- 主流程

async function runImportFlow() {
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast('用户取消了导入。');
        return;
    }

    const base = siteBase();

    let terms;
    try {
        window.shiguangBridge.showToast('正在读取学期列表 ...');
        terms = await fetchTermOptions(base);
    } catch (error) {
        window.shiguangBridge.showToast('读取学期失败：' + error.message);
        return;
    }

    const term = await selectTerm(terms);
    if (term === null) {
        window.shiguangBridge.showToast('未选择学期，导入流程终止。');
        return;
    }

    window.shiguangBridge.showToast('正在读取课表 ...');
    const records = await fetchTermData(base, term.value);
    if (!records) {
        window.shiguangBridge.showToast('课表接口未返回数据，请检查登录状态或稍后重试。');
        return;
    }

    const result = collectCourses(records);
    if (result.courses.length === 0) {
        window.shiguangBridge.showToast('未获取到课表数据，请确认该学期已选课。');
        return;
    }

    // 开学日期：额外取一次第 1 周的周一日期，再让用户确认/修正。
    // 取不到也不阻塞流程，用户可自行输入。
    window.shiguangBridge.showToast('正在确认开学日期 ...');
    const startDate = await fetchFirstWeekStart(base, term.value);

    const input = await confirmStartDate(startDate);
    if (input === null) {
        window.shiguangBridge.showToast('用户取消了导入。');
        return;
    }
    const semesterStartDate = String(input).trim();

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
    } catch (error) {
        window.shiguangBridge.showToast('课程保存失败: ' + error.message);
        return;
    }

    try {
        // 只在取到值时才写这两个可选字段，否则交给 App 侧沿用已有设置
        const config = {};
        if (result.totalWeeks > 0) config.semesterTotalWeeks = result.totalWeeks;
        if (semesterStartDate) config.semesterStartDate = semesterStartDate;
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        window.shiguangBridge.showToast('课表配置保存失败: ' + error.message);
    }

    await importPresetTimeSlots(PRESET_TIME_SLOTS);

    window.shiguangBridge.showToast('导入完成，共 ' + result.courses.length + ' 个课程时段。');
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
