// 武汉工程大学强智教务。接口与结构依据本校课表响应验证。
// 开发参考：拾光官方强智适配案例（YSSDUFE，星河欲转）。
(async function () {
    const lock = '__witImportRunning';
    if (window[lock]) return;
    window[lock] = true;
    const bridge = window.shiguangBridgePromise;
    const toast = message => window.shiguangBridge.showToast(message);
    const endpoint = '/jsxsd/xskb/xskb_list.do';
    async function semesterInfo(semester) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch('/jsxsd/jxzl/jxzl_query', {
                method: 'POST', credentials: 'same-origin', signal: controller.signal,
                body: new URLSearchParams({ xnxq01id: semester })
            });
            if (!response.ok) throw new Error('教学周历请求失败');
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            const selected = doc.querySelector('#xnxq01id');
            if (selected && selected.value !== semester) throw new Error('教学周历学期不匹配');
            const rows = [...doc.querySelectorAll('#kbtable tr')].filter(row => row.querySelector('td'));
            const match = rows[0]?.querySelector('td[title]')?.getAttribute('title')?.match(/^(\d{4})年(\d{2})月(\d{2})日?$/);
            const weeks = rows.map(row => parseInt(row.querySelector('td').textContent.trim(), 10)).filter(n => n > 0 && n <= 100);
            if (!match || !weeks.length) throw new Error('无法解析教学周历');
            const date = `${match[1]}-${match[2]}-${match[3]}`;
            const parsed = new Date(`${date}T00:00:00Z`);
            if (isNaN(parsed) || parsed.toISOString().slice(0, 10) !== date) throw new Error('教学周历日期无效');
            return { semesterStartDate: date, semesterTotalWeeks: Math.max(...weeks), firstDayOfWeek: 1 };
        } finally { clearTimeout(timer); }
    }
    const timeSlots = [
        ['08:00','08:45'], ['08:50','09:35'], ['09:55','10:40'], ['10:45','11:30'],
        ['11:35','12:20'], ['14:00','14:45'], ['14:50','15:35'], ['15:55','16:40'],
        ['16:45','17:30'], ['19:00','19:45'], ['19:50','20:35'], ['20:40','21:25']
    ].map(([startTime, endTime], i) => ({ number: i + 1, startTime, endTime }));
    async function request(options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(endpoint, { ...options, credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new Error(`教务请求失败：${response.status}`);
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (!doc.querySelector('#kbtable') || !doc.querySelector('#xnxq01id')) {
                throw new Error('登录已失效或课表结构不匹配，请重新进入教务课表页面');
            }
            return doc;
        } finally { clearTimeout(timer); }
    }
    function parseWeeks(text) {
        const odd = /单/.test(text), even = /双/.test(text);
        const source = text.replace(/（/g, '(').split('[')[0]
            .replace(/\([^)]*\)/g, '').replace(/[周单双\s]/g, '').replace(/，/g, ',');
        const weeks = new Set();
        for (const part of source.split(',')) {
            const match = part.match(/^(\d+)(?:-(\d+))?$/);
            if (!match) throw new Error('无法识别周次');
            const start = Number(match[1]), end = Number(match[2] || match[1]);
            if (start < 1 || end < start || end > 100) throw new Error('周次超出有效范围');
            for (let w = start; w <= end; w++) if ((!odd || w % 2 === 1) && (!even || w % 2 === 0)) weeks.add(w);
        }
        if (!weeks.size) throw new Error('周次为空');
        return [...weeks].sort((a, b) => a - b);
    }
    try {
        if (location.hostname !== 'jwxt.wit.edu.cn') throw new Error('请先进入武汉工程大学教务系统');
        const initial = await request();
        const select = initial.querySelector('#xnxq01id');
        const semesters = [...select.options].filter(option => option.value);
        const index = await bridge.showSingleSelection('选择学期', JSON.stringify(semesters.map(o => o.textContent.trim())), semesters.findIndex(o => o.selected));
        if (index === null) return;
        if (!semesters[index]) throw new Error('学期选择无效');
        const semester = semesters[index].value;
        const body = new URLSearchParams();
        for (const name of ['jx0404id', 'cj0701id', 'demo', 'kbjcmsid']) body.set(name, initial.querySelector(`[name="${name}"]`)?.value || '');
        body.set('xnxq01id', semester);
        body.set('zc', '');
        const detail = initial.querySelector('[name="sfFD"]');
        if (detail?.checked) body.set('sfFD', detail.value);
        const doc = await request({ method: 'POST', body });
        if (doc.querySelector('#xnxq01id').value !== semester || doc.querySelector('#zc')?.value) throw new Error('返回学期或周次与查询条件不一致');
        const table = doc.querySelector('#kbtable');
        const headers = [...table.rows[0].cells].map(c => c.textContent.trim());
        const days = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
        const courses = new Map();
        let invalid = 0;
        for (const row of [...table.rows].slice(1)) {
            for (let column = 0; column < row.cells.length; column++) {
                const cell = row.cells[column];
                for (const div of cell.querySelectorAll('div.kbcontent')) {
                    if (!div.textContent.trim()) continue;
                    for (const html of div.innerHTML.split(/(?:<br\s*\/?\s*>\s*)?-{5,}(?:\s*<br\s*\/?\s*>)?/i)) {
                        const block = doc.createElement('div'); block.innerHTML = html;
                        if (!block.textContent.trim()) continue;
                        try {
                            const day = days.indexOf(headers[column]) + 1;
                            const timing = block.querySelector('font[title="周次(节次)"]')?.textContent || '';
                            const section = timing.match(/\[([\d,，\-\s]+)节\]/);
                            const name = [...block.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).find(Boolean);
                            if (!name || !day || !section) throw new Error('课程信息不完整');
                            const weeks = parseWeeks(timing);
                            const teacher = block.querySelector('font[title="老师"],font[title="教师"]')?.textContent.trim() || '';
                            const position = block.querySelector('font[title="教室"]')?.textContent.trim() || '';
                            for (const part of section[1].replace(/，/g, ',').split(',')) {
                                const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
                                if (!match) throw new Error('节次无法识别');
                                const startSection = Number(match[1]), endSection = Number(match[2] || match[1]);
                                if (startSection < 1 || endSection < startSection || endSection > 50) throw new Error('节次无效');
                                const key = JSON.stringify([name, teacher, position, day, startSection, endSection]);
                                const old = courses.get(key);
                                courses.set(key, { name, teacher, position, day, startSection, endSection, weeks: [...new Set([...(old?.weeks || []), ...weeks])].sort((a,b) => a-b) });
                            }
                        } catch (_) { invalid++; }
                    }
                }
            }
        }
        if (invalid) throw new Error(`${invalid} 条课程无法完整解析，已停止导入，请反馈页面样本`);
        if (!courses.size) {
            await bridge.showAlert('该学期暂无课程', `${semester} 没有已排定时间的课程，本次未导入数据。可重新运行脚本选择其他学期。`, '知道了');
            return;
        }
        const remarks = [...table.rows].find(r => r.cells[0]?.textContent.includes('备注'))?.cells[1]?.textContent.trim();
        let config = null;
        try { config = await semesterInfo(semester); } catch (_) { /* 保留现有学期设置，提示用户核对。 */ }
        if (!await bridge.showAlert('导入前确认', `将导入 ${courses.size} 条课程安排，并写入学校作息。${config ? `教学周历：${config.semesterStartDate} 开始，共 ${config.semesterTotalWeeks} 周。` : '未能获取教学周历，请在 App 内手动核对开学日期和总周数。'}请核对节次作息。${remarks ? '\n课表含备注，请回教务核对其中未排定时间的课程并手动添加。' : ''}`, '确认导入')) return;
        if (config) await bridge.saveCourseConfig(JSON.stringify(config));
        await bridge.savePresetTimeSlots(JSON.stringify(timeSlots));
        await bridge.saveImportedCourses(JSON.stringify([...courses.values()]));
        toast(`成功导入 ${courses.size} 条课程安排`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) { toast(`导入停止：${error.message}`); }
    finally { window[lock] = false; }
})();
