/**
 * 广州医科大学强智教务，适配作者：小漫君。
 * 请求和课表字段解析参考拾光仓库 GDCP/gdcp_01.js，周历参考
 * ZHKU/zhku_lc6464.js（lc6464）；保留原作者贡献及仓库 MIT License。
 * GDCP 所记载的 HNIU、HHTC、NJFU、QFNU（Yumu-banxia）贡献一并保留。
 * Copyright (c) 2025 星河欲转；上述文件的贡献历史保留在仓库中。
 * 作息：https://jwc.gzhmu.edu.cn/info/1118/5748.htm（2018-2019-2 起执行）。
 * 不保存账号密码；所有响应先校验，再通过官方 bridge 提交。
 */

function gzhmuText(value) {
    return String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
}

function gzhmuNormalize(value) {
    return gzhmuText(value).replace(/\s+/g, '').replace(/[（]/g, '(')
        .replace(/[）]/g, ')').replace(/[［【]/g, '[').replace(/[］】]/g, ']')
        .replace(/[，、]/g, ',').replace(/[－–—~～]/g, '-');
}

function gzhmuTimeSlots() {
    return [
        { number: 1, startTime: '08:30', endTime: '09:10' },
        { number: 2, startTime: '09:15', endTime: '09:55' },
        { number: 3, startTime: '10:05', endTime: '10:45' },
        { number: 4, startTime: '10:50', endTime: '11:30' },
        { number: 5, startTime: '11:35', endTime: '12:15' },
        { number: 6, startTime: '12:20', endTime: '13:00' },
        { number: 7, startTime: '13:00', endTime: '13:40' },
        { number: 8, startTime: '14:00', endTime: '14:40' },
        { number: 9, startTime: '14:45', endTime: '15:25' },
        { number: 10, startTime: '15:35', endTime: '16:15' },
        { number: 11, startTime: '16:20', endTime: '17:00' },
        { number: 12, startTime: '17:05', endTime: '17:45' },
        { number: 13, startTime: '17:45', endTime: '18:25' },
        { number: 14, startTime: '18:30', endTime: '19:10' },
        { number: 15, startTime: '19:15', endTime: '19:55' },
        { number: 16, startTime: '20:00', endTime: '20:40' }
    ];
}

function gzhmuBaseUrl() {
    const host = window.location.hostname;
    const path = window.location.pathname.match(/^(.*?\/jsxsd)(?:\/|$)/);
    if (!path || !(host === 'jwgl.gzhmu.edu.cn' || host === 'webvpn.gzhmu.edu.cn'
        || host.endsWith('.webvpn.gzhmu.edu.cn'))) {
        throw new Error('请先登录广州医科大学教务。校外请在学校 WebVPN 内进入教务系统，再点击导入。');
    }
    // 保留 WebVPN 的 /https/<代理标识>/ 前缀，不能跳回校内域名。
    return window.location.origin + path[1] + '/';
}

function gzhmuCheckLogin(doc) {
    if (doc.querySelector('input[type="password"]') || /登录|统一身份认证|Login/i.test(doc.title)) {
        throw new Error('教务登录已失效，请通过学校 WebVPN 重新进入教务系统后再导入。');
    }
}

async function gzhmuFetchDoc(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    if (!response.ok) throw new Error('教务请求失败：HTTP ' + response.status);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    gzhmuCheckLogin(doc);
    return doc;
}

function gzhmuTerms(doc) {
    const select = doc.querySelector('#xnxq01id');
    if (!select) throw new Error('未找到学期列表，请确认已进入教务系统。');
    const terms = [];
    const ids = new Set();
    let selectedIndex = -1;
    for (const option of select.options) {
        const id = gzhmuText(option.value);
        if (!id || option.disabled) continue;
        if (ids.has(id)) throw new Error('教务返回了重复的学期标识，已停止导入。');
        ids.add(id);
        if (option.selected) selectedIndex = terms.length;
        terms.push({ id, name: gzhmuText(option.textContent) || id });
    }
    if (!terms.length) throw new Error('教务没有返回可选学期。');
    return { terms, selectedIndex };
}

function gzhmuCheckTerm(doc, termId) {
    const select = doc.querySelector('#xnxq01id');
    if (!select || gzhmuText(select.value) !== termId) {
        throw new Error('教务返回的学期与所选学期不一致，已停止导入。');
    }
}

function gzhmuParseWeeks(value, max) {
    const label = '课程周次';
    const text = gzhmuNormalize(value).replace(/第/g, '').replace(/\(周\)/g, '')
        .replace(/\((单|双)周\)/g, '($1)').replace(/周/g, '');
    const numbers = new Set();
    for (const part of text.split(',')) {
        const match = part.match(/^(\d+)(?:-(\d+))?(?:\((单|双)\))?$/);
        if (!match) throw new Error(label + '格式无法识别，已停止导入。');
        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > max) throw new Error(label + '超出范围，已停止导入。');
        for (let number = start; number <= end; number++) {
            if (!match[3] || number % 2 === (match[3] === '单' ? 1 : 0)) numbers.add(number);
        }
    }
    if (!numbers.size) throw new Error(label + '为空，已停止导入。');
    return Array.from(numbers).sort((a, b) => a - b);
}

function gzhmuSectionRanges(numbers) {
    const ranges = [];
    for (const number of numbers) {
        const last = ranges[ranges.length - 1];
        if (last && number === last.endSection + 1) last.endSection = number;
        else ranges.push({ startSection: number, endSection: number });
    }
    return ranges;
}

function gzhmuCourses(doc, totalWeeks) {
    const table = doc.querySelector('#timetable');
    if (!table || !table.rows.length) throw new Error('未找到学期课表 #timetable。');
    const headers = Array.from(table.rows[0].cells).slice(1).map(cell => gzhmuText(cell.textContent));
    if (headers.join(',') !== '星期一,星期二,星期三,星期四,星期五,星期六,星期日') {
        throw new Error('课表星期列顺序无法识别，已停止导入。');
    }
    const grouped = new Map();
    for (const row of table.rows) {
        const cells = row.querySelectorAll(':scope > td');
        if (cells.length !== 7) continue; // 表头与页脚不是课程行。
        for (let column = 0; column < cells.length; column++) {
            for (const original of cells[column].querySelectorAll('.kbcontent')) {
                const content = original.cloneNode(true);
                content.querySelectorAll('.item-box').forEach(item => item.remove());
                for (const html of content.innerHTML.split(/-{10,}\s*<br\s*\/?>/i)) {
                    const block = new DOMParser().parseFromString(html, 'text/html');
                    if (!gzhmuText(block.body.textContent)) continue;
                    const name = gzhmuText(block.querySelector('font:not([title])')?.textContent);
                    const teacher = block.querySelector('font[title="教师"]');
                    const position = block.querySelector('font[title="教室"]');
                    const time = block.querySelector('font[title="周次(节次)"]');
                    const match = time && gzhmuNormalize(time.textContent).match(/^(.*?)\[(\d+(?:-\d+)*)节\]$/);
                    if (!name || !teacher || !position || !match) throw new Error('课程字段不完整，已停止导入。');
                    const weeks = gzhmuParseWeeks(match[1], totalWeeks);
                    // 接口逐项列举节次，例如 01-02-03-04；不能将 01-03 擅自补为三节。
                    const sections = match[2].split('-').map(Number);
                    if (sections.some(section => section < 1 || section > 16)) throw new Error('课程节次超出作息范围。');
                    const day = column + 1;
                    const fields = { day, name, teacher: gzhmuText(teacher.textContent), position: gzhmuText(position.textContent) };
                    const key = JSON.stringify(fields);
                    if (!grouped.has(key)) grouped.set(key, { ...fields, occurrences: new Map() });
                    const occurrences = grouped.get(key).occurrences;
                    for (const week of weeks) {
                        if (!occurrences.has(week)) occurrences.set(week, new Set());
                        for (const section of sections) occurrences.get(week).add(section);
                    }
                }
            }
        }
    }
    const courses = [];
    for (const course of grouped.values()) {
        const ranges = new Map();
        for (const [week, sections] of course.occurrences) {
            for (const range of gzhmuSectionRanges(Array.from(sections).sort((a, b) => a - b))) {
                const key = JSON.stringify(range);
                if (!ranges.has(key)) ranges.set(key, { name: course.name, teacher: course.teacher, position: course.position,
                    day: course.day, weeks: [], isCustomTime: false, ...range });
                ranges.get(key).weeks.push(week);
            }
        }
        for (const range of ranges.values()) courses.push({ ...range, weeks: range.weeks.sort((a, b) => a - b) });
    }
    if (!courses.length) throw new Error('所选学期没有可识别的固定课程，未保存任何数据。');
    return courses;
}

function gzhmuDate(value) {
    const match = gzhmuText(value).match(/(\d{4})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})(?:日)?/);
    if (!match) throw new Error('周历缺少完整日期，已停止导入。');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error('周历日期无效，已停止导入。');
    }
    return date;
}

function gzhmuApplyTimeDifferences(doc, courses, slots) {
    for (const row of doc.querySelector('#timetable').rows) {
        if (row.querySelectorAll(':scope > td').length !== 7) continue;
        const header = gzhmuNormalize(row.querySelector(':scope > th')?.textContent);
        const match = header.match(/\((\d+(?:,\d+)*)小节\)(\d{2}:\d{2})-(\d{2}:\d{2})$/);
        if (!match) throw new Error('课表缺少节次时钟，无法核对作息。');
        const sections = match[1].split(',').map(Number);
        const first = sections[0], last = sections[sections.length - 1];
        if (!slots[first - 1] || !slots[last - 1]) throw new Error('课表时段超出公开作息范围。');
        const changedStart = match[2] !== slots[first - 1].startTime;
        const changedEnd = match[3] !== slots[last - 1].endTime;
        if (!changedStart && !changedEnd) continue;
        // 实测历史学期第 6–7 节为 12:20–13:45；保留教务明确给出的整段时钟。
        // 若课程只占发生差异的部分，不能从整段时长反推单节时间。
        for (const course of courses) {
            const touches = section => course.startSection <= section && course.endSection >= section;
            if (!(changedStart && touches(first)) && !(changedEnd && touches(last))) continue;
            if (course.startSection > first || course.endSection < last) {
                throw new Error('教务时段 ' + first + '–' + last + ' 节与公开作息不同，无法确定其中单节时间。');
            }
            course.customStartTime = course.startSection === first ? match[2]
                : course.customStartTime || slots[course.startSection - 1].startTime;
            course.customEndTime = course.endSection === last ? match[3]
                : course.customEndTime || slots[course.endSection - 1].endTime;
            course.isCustomTime = true;
        }
    }
}

function gzhmuCalendar(doc, termId) {
    gzhmuCheckTerm(doc, termId);
    const table = doc.querySelector('#kbtable');
    if (!table) throw new Error('未找到教学周历 #kbtable，无法确定所选学期的开学日期。');
    const weeks = new Map();
    for (const row of table.rows) {
        const numberText = gzhmuText(row.cells[0]?.textContent);
        if (!/^\d+$/.test(numberText)) continue;
        const week = Number(numberText);
        if (weeks.has(week)) throw new Error('周历出现重复周次，已停止导入。');
        const date = gzhmuDate(row.cells[1]?.getAttribute('title'));
        if (date.getUTCDay() !== 1) throw new Error('周历周一日期不正确，已停止导入。');
        weeks.set(week, date);
    }
    if (!weeks.has(1)) throw new Error('周历没有第一教学周的周一日期。');
    const start = weeks.get(1);
    let totalWeeks = 0;
    for (const [week, monday] of weeks) {
        if (monday.getTime() !== start.getTime() + (week - 1) * 7 * 86400000) {
            throw new Error('周历日期与周次不一致，已停止导入。');
        }
        totalWeeks = Math.max(totalWeeks, week);
    }
    if (weeks.size !== totalWeeks) throw new Error('周历存在缺失周次，已停止导入。');
    const term = termId.match(/^(\d{4})-(\d{4})-([12])$/);
    if (term && (Number(term[2]) !== Number(term[1]) + 1
        || start.getUTCFullYear() !== Number(term[term[3] === '1' ? 1 : 2]))) {
        throw new Error('周历年份与所选学期不一致，已停止导入。');
    }
    return { semesterStartDate: start.toISOString().slice(0, 10), semesterTotalWeeks: totalWeeks,
        defaultClassDuration: 40, defaultBreakDuration: 5, firstDayOfWeek: 1 };
}

async function gzhmuRunImport() {
    const bridge = window.shiguangBridgePromise;
    try {
        if (!bridge || !window.shiguangBridge) throw new Error('请在支持拾光教务桥接的应用或官方测试器中运行。');
        const base = gzhmuBaseUrl();
        window.shiguangBridge.showToast('正在获取广医学期列表…');
        const endpoint = base + 'xskb/xskb_list.do';
        const entry = await gzhmuFetchDoc(endpoint, { method: 'GET' });
        const { terms, selectedIndex } = gzhmuTerms(entry);
        const mode = entry.querySelector('#kbjcmsid')?.value;
        if (!mode) throw new Error('未获取到教务节次模式，已停止导入。');
        const choice = await bridge.showSingleSelection('选择导入学期', JSON.stringify(terms.map(term => term.name)), selectedIndex);
        if (choice == null) return;
        const index = Number(choice);
        if ((typeof choice !== 'number' && !/^\d+$/.test(choice))
            || !Number.isInteger(index) || index < 0 || index >= terms.length) throw new Error('未选择有效学期。');
        const term = terms[index];
        // 即使选中当前学期，也显式请求整学期，避免复用入口的周筛选结果。
        const schedule = await gzhmuFetchDoc(endpoint, { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ cj0701id: '', zc: '', demo: '', xnxq01id: term.id, sfFD: '1', kbjcmsid: mode }).toString() });
        gzhmuCheckTerm(schedule, term.id);
        const calendarDoc = await gzhmuFetchDoc(base + 'jxzl/jxzl_query', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ xnxq01id: term.id }).toString() });
        const config = gzhmuCalendar(calendarDoc, term.id);
        const courses = gzhmuCourses(schedule, config.semesterTotalWeeks);
        const slots = gzhmuTimeSlots();
        gzhmuApplyTimeDifferences(schedule, courses, slots);
        for (const [method, data] of [['saveCourseConfig', config], ['savePresetTimeSlots', slots], ['saveImportedCourses', courses]]) {
            const saved = await bridge[method](JSON.stringify(data));
            if (saved !== true && saved !== 'true') throw new Error('保存失败（' + method + '），导入未完成。');
        }
        window.shiguangBridge.showToast('已提交 ' + courses.length + ' 条课程，请在预览中核对后确认。');
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        const message = error instanceof Error ? error.message : '教务导入异常。';
        if (bridge) await bridge.showAlert('导入未完成', message, '知道了');
        else if (window.shiguangBridge) window.shiguangBridge.showToast(message);
        else console.error(message);
    }
}

gzhmuRunImport();
