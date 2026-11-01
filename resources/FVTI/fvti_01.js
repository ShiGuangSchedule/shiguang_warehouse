// 福州职业技术大学（FVTI）课表导入
// 课表走移动端接口 POST /studentportal.php/Appusermobile/zkcb（optype=xszkcb&dqz=周次）
// 学期总周数与节次时间接口都不提供，从桌面周课表页读取（周次标签 + 行标题里的节次时间）
// 读取失败时：总周数退回"最后一个有课的周"，节次时间则不导入（课程导入不受影响）
// 合规：不使用自建 DOM 控件，交互全部走原生桥接；DOMParser 只解析接口返回的独立片段
(function () {
    'use strict';

    var Bridge = window.AndroidBridge || window.shiguangBridge || null;
    var BridgePromise = window.AndroidBridgePromise || window.shiguangBridgePromise || null;

    var P = '/studentportal.php';
    var API = P + '/Appusermobile/zkcb';
    var WEEK_TABS = P + '/Jxxx/xskbxx/optype/1';
    var CHUNK = 6;             // 每批并发周数（服务端按会话串行，分批只为降低突发）
    var SCAN_MAX_WEEK = 24;    // 拿不到周数时的扫描上限
    var TIMEOUT_MS = 12000;
    var MAX_RETRY = 2;

    // ---------- 基础工具 ----------

    function toast(msg) {
        try { Bridge && Bridge.showToast ? Bridge.showToast(msg) : console.log('[toast] ' + msg); } catch (e) {}
    }

    function delay(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    function norm(s) {
        return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    // 兼容校内直连与 WebVPN 代理：取 /studentportal.php 之前的部分作为前缀
    function url(path) {
        var i = location.href.indexOf(P);
        return (i >= 0 ? location.href.slice(0, i) : location.origin) + path;
    }

    // ---------- 请求 ----------

    // 通用请求：超时 + 自动重试
    async function request(path, options) {
        var lastError = null;
        for (var attempt = 1; attempt <= MAX_RETRY; attempt++) {
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
            try {
                var res = await fetch(url(path), Object.assign({ credentials: 'include', signal: controller ? controller.signal : undefined }, options || {}));
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return await res.text();
            } catch (e) {
                lastError = e;
            } finally {
                if (timer) clearTimeout(timer);
            }
            if (attempt < MAX_RETRY) await delay(300 * attempt);
        }
        throw lastError;
    }

    // 取一节课表：返回该周日期 + 表格
    async function fetchWeek(week) {
        var text = await request(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'optype=xszkcb&dqz=' + week,
        });
        var json = JSON.parse(text);
        if (String(json.Code) !== '1' || !json.Data) throw new Error('接口返回异常');
        return { week: week, title: json.Data.title || '', dates: (json.Data.kcbrq || []).map(function (x) { return x.rq; }), table: parseTable(json.Data.kcb) };
    }

    // 桌面周课表壳页：既给学期总周数（每周地址含 /dqz/N/），也给第 1 周的地址
    async function fetchWeekTabs() {
        try {
            var html = await request(WEEK_TABS, {});
            var max = 0;
            var re = /\/dqz\/(\d+)\//g;
            var m;
            while ((m = re.exec(html)) !== null) if (Number(m[1]) > max) max = Number(m[1]);
            var first = /attr\('src','([^']+)'\)/.exec(html);
            return { totalWeeks: max, firstWeekUrl: first ? first[1] : '' };
        } catch (e) {
            return { totalWeeks: 0, firstWeekUrl: '' };
        }
    }

    // 节次时间：接口只给节次序号，时间从周课表页行标题（"第1节<br>08:30-09:15"）读取
    async function fetchSectionTimes(firstWeekUrl) {
        if (!firstWeekUrl) return null;
        try {
            var html = await request(firstWeekUrl, {});
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var rows = Array.prototype.slice.call(doc.querySelectorAll('tr'));
            var slots = [];
            for (var i = 1; i < rows.length; i++) {
                var td = rows[i].querySelector('td');
                if (!td) continue;
                var sec = /第(\d+)节/.exec(norm(td.textContent));
                var time = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/.exec(td.innerHTML.replace(/<br\s*\/?>/gi, ' '));
                if (sec && time) slots.push({ number: Number(sec[1]), startTime: time[1], endTime: time[2] });
            }
            return slots.length ? slots : null;
        } catch (e) {
            return null;
        }
    }

    // ---------- 解析 ----------

    // 表格按 rowspan 展开；中午1/中午2 这类非上课行记为 null 行（会被跳过）
    function parseTable(html) {
        var doc = new DOMParser().parseFromString(html || '', 'text/html');
        var rows = Array.prototype.slice.call(doc.querySelectorAll('tr'));
        var sections = [];
        var grid = [];
        for (var r = 0; r < rows.length; r++) {
            var cells = Array.prototype.slice.call(rows[r].children);
            if (!cells.length) continue;
            var label = norm(cells[0].textContent);
            sections[r] = /^\d+$/.test(label) ? Number(label) : null;
            grid[r] = grid[r] || [];
            var day = 1;
            for (var k = 1; k < cells.length; k++) {
                while (grid[r][day] !== undefined) day++;
                var rowspan = Number(cells[k].getAttribute('rowspan') || 1);
                var cell = { text: norm(cells[k].textContent) };
                for (var m = 0; m < rowspan; m++) {
                    grid[r + m] = grid[r + m] || [];
                    grid[r + m][day] = cell;
                }
                day++;
            }
        }
        return { sections: sections, grid: grid };
    }

    // 格子文本 = 「课程名 地点 教师」：课程名在第一段，末段没括号就是教师，中间是地点
    function splitCell(text) {
        var parts = norm(text).split(' ').filter(Boolean);
        if (!parts.length) return null;
        var name = parts[0];
        var rest = parts.slice(1);
        var teacher = '';
        var position = '';
        if (rest.length) {
            var last = rest[rest.length - 1];
            if (last.indexOf('(') < 0 && last.indexOf('（') < 0) {
                teacher = last;
                position = rest.slice(0, -1).join(' ');
            } else {
                position = rest.join(' ');
            }
        }
        return { name: name, teacher: teacher, position: position };
    }

    // 连续相同的格子算一门连堂课，合并进课程表
    function addWeek(week, table, sink) {
        for (var day = 1; day <= 7; day++) {
            var block = null;
            var push = function () {
                if (!block) return;
                var key = [block.name, block.teacher, block.position, day, block.startSection, block.endSection].join('|');
                if (!sink[key]) sink[key] = { name: block.name, teacher: block.teacher || '未知教师', position: block.position, day: day, startSection: block.startSection, endSection: block.endSection, weeks: [] };
                if (sink[key].weeks.indexOf(week) < 0) sink[key].weeks.push(week);
            };
            for (var r = 0; r < table.sections.length; r++) {
                var section = table.sections[r];
                if (section === null) continue;
                var cell = (table.grid[r] || [])[day];
                var info = cell && cell.text ? splitCell(cell.text) : null;
                if (!info || !info.name) continue;
                if (block && block.name === info.name && block.teacher === info.teacher && block.position === info.position && r === block.endRow + 1) {
                    block.endRow = r;
                    block.endSection = section;
                } else {
                    push();
                    block = { name: info.name, teacher: info.teacher, position: info.position, startSection: section, endSection: section, endRow: r };
                }
            }
            push();
        }
    }

    // ---------- 取数主流程 ----------

    // 先并发首批 + 同时问周数，再用权威周数补齐剩余批次
    // 分批发请求：同一会话在服务端会排队，分批只是避免一次性打太多
    async function fetchChunks(list) {
        var out = [];
        for (var i = 0; i < list.length; i += CHUNK) {
            var batch = list.slice(i, i + CHUNK);
            var res = await Promise.all(batch.map(function (w) {
                return fetchWeek(w).catch(function () { return { week: w, error: true }; });
            }));
            out = out.concat(res);
        }
        return out;
    }

    async function fetchAll() {
        var started = Date.now();
        var sink = {};
        var weeks = [];
        var title = '';
        var firstDates = null;
        var failed = [];

        var weekTabsPromise = fetchWeekTabs();
        var first = [];
        for (var i = 1; i <= CHUNK; i++) first.push(i);
        var results = await fetchChunks(first);

        var weekTabs = await weekTabsPromise;
        var totalWeeks = weekTabs.totalWeeks;
        var scanCount = totalWeeks > 0 ? totalWeeks : SCAN_MAX_WEEK;
        var rest = [];
        for (var j = CHUNK + 1; j <= scanCount; j++) rest.push(j);
        if (rest.length) results = results.concat(await fetchChunks(rest));

        results.forEach(function (r) {
            if (r.error) {
                failed.push(r.week);
                return;
            }
            weeks.push(r.week);
            addWeek(r.week, r.table, sink);
            if (!title && r.title) title = r.title;
            if (r.week === 1 && r.dates.length) firstDates = r.dates;
            if (!firstDates && r.dates.length && (!weeks.length || r.week === Math.min.apply(null, weeks))) firstDates = r.dates;
        });
        if (failed.length) throw new Error('第 ' + failed.sort(function (a, b) { return a - b; }).join('、') + ' 周数据没取到，请重试');
        if (!weeks.length) throw new Error('接口没有返回任何周次的课表');

        var courses = Object.keys(sink).map(function (k) {
            sink[k].weeks.sort(function (a, b) { return a - b; });
            return sink[k];
        }).sort(function (a, b) {
            return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
        });
        if (!courses.length) throw new Error('本学期没有解析到任何课程');

        var maxCourseWeek = 0;
        courses.forEach(function (c) { maxCourseWeek = Math.max(maxCourseWeek, c.weeks[c.weeks.length - 1]); });

        return {
            courses: courses,
            timeSlots: (await fetchSectionTimes(weekTabs.firstWeekUrl)) || [],
            totalWeeks: totalWeeks > 0 ? totalWeeks : Math.max(maxCourseWeek, 20),
            title: title,
            startDate: firstDates ? alignToMonday(fullDate(firstDates[0])) : '',
            firstWeekText: firstDates ? fullDate(firstDates[0]) + ' ~ ' + fullDate(firstDates[6]) : '',
            elapsedMs: Date.now() - started,
        };
    }

    // ---------- 时间工具 ----------

    // 接口只给 MM-DD，按当前日期补年份（跨年学期也能算对）
    function fullDate(mmdd) {
        var m = /^(\d{2})-(\d{2})$/.exec(norm(mmdd));
        if (!m) return '';
        var now = new Date();
        var d = new Date(Date.UTC(now.getUTCFullYear(), Number(m[1]) - 1, Number(m[2])));
        if (d.getTime() - now.getTime() > 180 * 24 * 3600 * 1000) d = new Date(Date.UTC(now.getUTCFullYear() - 1, Number(m[1]) - 1, Number(m[2])));
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    function alignToMonday(dateStr) {
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || ''));
        if (!m) return '';
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        var dow = d.getUTCDay();
        d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    // ---------- 保存 ----------

    async function saveConfig(config) {
        await BridgePromise.saveCourseConfig(JSON.stringify(config));
    }

    async function saveCourses(courses) {
        await BridgePromise.saveImportedCourses(JSON.stringify(courses));
    }

    async function saveTimeSlots(slots) {
        if (slots && slots.length) await BridgePromise.savePresetTimeSlots(JSON.stringify(slots));
    }

    // ---------- 流程编排 ----------

    // 取数 → 保存 → 一次汇总弹窗；任何失败都直接弹出错误并终止
    async function runImportFlow() {
        if (!Bridge || !BridgePromise) {
            console.error('未找到桥接对象，请确认运行在拾光课程表的 WebView / 测试插件里。');
            return;
        }
        toast('正在获取课表…');
        try {
            var data = await fetchAll();

            await saveConfig({ semesterStartDate: data.startDate, semesterTotalWeeks: data.totalWeeks });
            await saveCourses(data.courses);
            try { await saveTimeSlots(data.timeSlots); } catch (e) {}

            var names = {};
            data.courses.forEach(function (c) { names[c.name] = 1; });
            await BridgePromise.showAlert(
                '导入完成',
                '账号：' + (data.title || '（未返回）') + '\n'
                    + '第 1 周：' + (data.firstWeekText || '（未返回日期）') + '\n'
                    + '学期：共 ' + data.totalWeeks + ' 周\n'
                    + '课程：' + data.courses.length + ' 条（' + Object.keys(names).length + ' 门）\n'
                    + '作息：' + (data.timeSlots.length ? data.timeSlots.length + ' 节' : '未取到（已跳过时间段导入）') + '\n'
                    + '用时：' + (data.elapsedMs / 1000).toFixed(1) + 's',
                '好的',
            );
            Bridge.notifyTaskCompletion();
        } catch (error) {
            var msg = String(error && error.message ? error.message : error);
            toast('导入失败：' + msg);
            await BridgePromise.showAlert('导入失败', msg, '知道了');
        }
    }

    runImportFlow();
})();
