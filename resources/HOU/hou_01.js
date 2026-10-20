// 河北东方学院 · 强智教务；适配作者：小漫君
// 接口路线参考本仓库 HNPTC/hnptc_01.js、QFNU/qfnu_01.js（MIT，见根 LICENSE）。
// 本校返回详细课表 #timetable 与教学周历 #kbtable，不解析门户的当前周课表。
// 作息依据：2026-10-20 用户提供并确认的十节作息，与教务五组大节边界一致。
// 先写入学校作息，课程只提交教务原节次，不附带课程独立时间。
// 未排时间的课程仅提示，不生成课程时段。
(async function () {
    'use strict';

    const ORIGIN = 'http://219.148.95.56:10000';
    const TIMETABLE = '/jsxsd/xskb/xskb_list.do';
    const CALENDAR = '/jsxsd/jxzl/jxzl_query';
    const TIME_SLOTS = [
        { number: 1, startTime: '08:10', endTime: '08:55' },
        { number: 2, startTime: '09:05', endTime: '09:50' },
        { number: 3, startTime: '10:10', endTime: '10:55' },
        { number: 4, startTime: '11:05', endTime: '11:50' },
        { number: 5, startTime: '14:00', endTime: '14:45' },
        { number: 6, startTime: '14:55', endTime: '15:40' },
        { number: 7, startTime: '16:00', endTime: '16:45' },
        { number: 8, startTime: '16:55', endTime: '17:40' },
        { number: 9, startTime: '19:00', endTime: '19:45' },
        { number: 10, startTime: '19:55', endTime: '20:40' }
    ];
    const bridge = window.shiguangBridge;
    const ui = window.shiguangBridgePromise;

    function text(element) {
        return element ? element.textContent.trim() : '';
    }

    function successful(value) {
        return value === true || value === 'true';
    }

    async function requestDoc(path, params) {
        const response = await fetch(ORIGIN + path, {
            credentials: 'include',
            ...(params ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params).toString()
            } : {})
        });
        if (!response.ok) throw new Error('教务请求失败（HTTP ' + response.status + '）');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (doc.querySelector('#userAccount, #userPassword')) {
            throw new Error('登录已失效，请重新登录教务系统后导入。');
        }
        return doc;
    }

    function semesters(doc) {
        const select = doc.querySelector('select[name="xnxq01id"]');
        if (!select) throw new Error('未读取到学期列表，请确认已登录教务系统。');
        return Array.from(select.options).filter(o => o.value.trim()).map(o => ({
            value: o.value.trim(), label: text(o), selected: o.selected
        }));
    }

    function requireSemester(doc, value) {
        const selected = semesters(doc).find(o => o.selected);
        if (!selected || selected.value !== value) {
            throw new Error('教务返回的学期与所选学期不一致，已停止导入。');
        }
    }

    function expandWeeks(source) {
        const result = new Set();
        // 单双周按各片段分别处理，不能用一个片段的标记过滤整个周次串。
        for (const part of source.split(/[,，、;；]/)) {
            const match = part.trim().match(/^(\d+)(?:\s*[-~～–—至]\s*(\d+))?\s*(?:[（(]?(单|双)(?:周)?[）)]?)?$/);
            if (!match) throw new Error('发现无法识别的课程周次，请核对教务课表。');
            const start = Number(match[1]);
            const end = match[2] ? Number(match[2]) : start;
            if (start < 1 || end < start || end > 60) throw new Error('课程周次范围异常。');
            for (let week = start; week <= end; week++) {
                if (!match[3] || week % 2 === (match[3] === '单' ? 1 : 0)) result.add(week);
            }
        }
        if (!result.size) throw new Error('课程缺少有效周次。');
        return Array.from(result).sort((a, b) => a - b);
    }

    function parseTime(source) {
        const match = source.match(/^(.+?)\s*[（(]周[）)]\s*\[\s*(\d+)(?:\s*[-~～–—]\s*(\d+))?\s*节\s*\]$/);
        if (!match) throw new Error('课程周次或节次格式异常，请核对教务课表。');
        const start = Number(match[2]);
        const end = match[3] ? Number(match[3]) : start;
        if (start < 1 || end < start || end > TIME_SLOTS.length) {
            throw new Error('课程节次超出学校作息范围，请核对教务课表。');
        }
        return { weeks: expandWeeks(match[1]), start, end };
    }

    function parseTimetable(doc) {
        const table = doc.querySelector('#timetable');
        if (!table) throw new Error('未读取到整学期课表，请确认登录状态。');
        const headings = Array.from(table.rows[0].cells).slice(1).map(text);
        if (headings.join(',') !== '星期一,星期二,星期三,星期四,星期五,星期六,星期日') {
            throw new Error('课表星期列结构发生变化，已停止导入。');
        }
        const merged = new Map();
        for (const row of Array.from(table.rows).slice(1)) {
            const blocks = row.querySelectorAll('div.kbcontent');
            if (!Array.from(blocks).some(block => text(block))) continue;
            if (row.cells.length !== 8) throw new Error('课表星期列结构发生变化，已停止导入。');
            for (let day = 1; day <= 7; day++) {
                // 只读取详细版，忽略同格的 kbcontent1 简表，保留教师与完整节次。
                for (const block of row.cells[day].querySelectorAll('div.kbcontent')) {
                    if (!text(block)) continue;
                    for (const html of block.innerHTML.split(/[-—–]{6,}\s*(?:<br\s*\/?>)?/i)) {
                        if (!html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '')) continue;
                        // DOMParser 创建惰性文档，不执行教务页面中的脚本。
                        const item = new DOMParser().parseFromString(html, 'text/html');
                        const name = text(item.querySelector('font:not([title]):not([name])'));
                        const time = parseTime(text(item.querySelector('font[title="周次(节次)"]')));
                        if (!name) throw new Error('课表中存在没有名称的课程。');
                        const course = {
                            name,
                            teacher: text(item.querySelector('font[title="教师"]')),
                            position: text(item.querySelector('font[title="教室"]')),
                            day, startSection: time.start, endSection: time.end,
                            weeks: time.weeks
                        };
                        const key = JSON.stringify([
                            course.name, course.teacher, course.position, day,
                            time.start, time.end
                        ]);
                        const previous = merged.get(key);
                        if (previous) {
                            previous.weeks = Array.from(new Set(previous.weeks.concat(course.weeks))).sort((a, b) => a - b);
                        } else {
                            merged.set(key, course);
                        }
                    }
                }
            }
        }
        return Array.from(merged.values());
    }

    function parseCalendar(doc, semester) {
        requireSemester(doc, semester);
        const table = doc.querySelector('#kbtable');
        if (!table) throw new Error('未读取到所选学期的教学周历。');
        const rows = Array.from(table.rows).filter(row => /^\d+$/.test(text(row.cells[0])));
        const weeks = rows.map(row => Number(text(row.cells[0])));
        if (!weeks.length || weeks.some((week, i) => week !== i + 1)) {
            throw new Error('教学周历周次不连续，已停止导入。');
        }
        let startDate;
        for (let i = 0; i < rows.length; i++) {
            const title = rows[i].cells[1] ? rows[i].cells[1].getAttribute('title') : '';
            const match = String(title || '').match(/^(\d{4})年(\d{2})月(\d{2})(?:日)?$/);
            if (!match) throw new Error('教学周历未提供完整的周一日期。');
            const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
            const formatted = date.toISOString().slice(0, 10);
            if (formatted !== match[1] + '-' + match[2] + '-' + match[3] || date.getUTCDay() !== 1) {
                throw new Error('教学周历日期异常。');
            }
            if (i === 0) startDate = date;
            if (date.getTime() !== startDate.getTime() + i * 7 * 86400000) {
                throw new Error('教学周历日期与周次不一致。');
            }
        }
        return {
            semesterStartDate: startDate.toISOString().slice(0, 10),
            semesterTotalWeeks: weeks.length,
            firstDayOfWeek: 1
        };
    }

    function unscheduledNames(doc) {
        const table = doc.querySelector('#dataTables');
        if (!table) return [];
        const header = Array.from(table.rows).find(row => Array.from(row.cells).some(cell => text(cell) === '课程名称'));
        if (!header) throw new Error('无课表课程清单结构发生变化。');
        const index = Array.from(header.cells).findIndex(cell => text(cell) === '课程名称');
        return Array.from(new Set(Array.from(table.rows).slice(header.rowIndex + 1)
            .filter(row => row.cells.length === header.cells.length)
            .map(row => text(row.cells[index])).filter(Boolean)));
    }

    async function runImport() {
        if (window.location.origin !== ORIGIN || !/^\/jsxsd(?:\/|$)/.test(window.location.pathname)) {
            throw new Error('请在河北东方学院教务系统登录后执行导入。');
        }
        bridge.showToast('正在读取学期信息…');
        const initial = await requestDoc(TIMETABLE);
        const options = semesters(initial);
        if (!options.length) throw new Error('教务未提供可导入的学期。');
        const picked = await ui.showSingleSelection('选择学期', JSON.stringify(options.map(o => o.label)),
            Math.max(0, options.findIndex(o => o.selected)));
        if (picked === null || picked === undefined || picked === 'null') return;
        const index = Number(picked);
        if (!Number.isInteger(index) || index < 0 || index >= options.length) return;
        const semester = options[index].value;
        const mode = initial.querySelector('select[name="kbjcmsid"]');
        if (!mode || !mode.value) throw new Error('课表未提供节次模式。');
        bridge.showToast('正在读取整学期课表与教学周历…');
        // 对照实际 Form1；zc 留空以取全部周次，节次模式从当前会话取得。
        const doc = await requestDoc(TIMETABLE, {
            cj0701id: '', zc: '', demo: '', xnxq01id: semester, kbjcmsid: mode.value, sfFD: '1'
        });
        requireSemester(doc, semester);
        const courses = parseTimetable(doc);
        if (!courses.length) throw new Error('所选学期没有已排上课时间的课程。');
        const config = {
            ...parseCalendar(await requestDoc(CALENDAR, { xnxq01id: semester }), semester),
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };
        if (courses.some(course => course.weeks.some(week => week > config.semesterTotalWeeks))) {
            throw new Error('课程周次超出所选学期教学周历，已停止导入。');
        }
        const unscheduled = unscheduledNames(doc);
        if (unscheduled.length && !successful(await ui.showAlert('以下课程尚无上课时间',
            unscheduled.join('、') + '\n教务未提供这些课程的上课时间，本次仅导入已排课课程。', '继续导入'))) return;
        // 全部请求、解析与校验通过后再提交；任一步保存失败均不通知成功。
        if (!successful(await ui.saveCourseConfig(JSON.stringify(config)))) throw new Error('课表配置保存失败。');
        if (!successful(await ui.savePresetTimeSlots(JSON.stringify(TIME_SLOTS)))) throw new Error('学校作息保存失败。');
        if (!successful(await ui.saveImportedCourses(JSON.stringify(courses)))) throw new Error('课程保存失败。');
        bridge.showToast('导入成功：' + semester + '，共 ' + courses.length + ' 条课程时段');
        bridge.notifyTaskCompletion();
    }

    try {
        await runImport();
    } catch (error) {
        const message = error instanceof Error ? error.message : '教务导入失败，请稍后重试。';
        await ui.showAlert('导入失败', message, '知道了');
    }
})();
