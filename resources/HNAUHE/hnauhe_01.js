// resources/HNAUHE/hnauhe_01.js
// 河南牧业经济学院 · 超星教务（jw.chaoxing.com）课程表适配脚本
// 本校在校生维护（河南牧业经济学院），接口与校区情况直接在本校教务实测
// ---------------------------------------------------------------------------
// 适用系统：超星教务管理系统学生端（/admin/pkgl/xskb/queryKbForXsd 课表页）
// 使用方式：登录教务 → 进入「我的课表」页面 → 在拾光中点击「执行导入」
// 数据来源：全部取自已登录会话的站内接口，脚本内不含账号、密码或固定 Token
// 参考实现：resources/chaoxing_jiaowu/chaoxing.js（通用超星适配）
//           resources/SXGCXY/sxgcxy_01.js（wiki「超星教务」参考案例）
// 本校在校生维护：学校若升级超星版本导致接口变动，会第一时间跟进；其他同学发现问题也欢迎提 Issue 或 PR
//
// 实测记录（2026-11-09，英才校区 / 2026-2027-1）：
//   GET  /admin/api/jcsj/xqsj/getXqList?xnxq=             → {ret:0,data:[{id,xqmc}...]}，5 个校区
//   GET  /admin/api/getZclistByXnxq?xnxq=&xqid=           → {ret:0,data:{jcsjszList[12],zclist[20],jsxq,dqzc,kbxssj}}
//   GET  /admin/pkgl/xskb/sdpkkbList?xnxq=&xhid=&xqdm=    → {ret:0,data:[49 行]}，一行 = 一门课的一天一节
//   行内字段：kcmc/tmc/croommc 是带 <a> 的 HTML；xingqi、djc 为数字；zcstr 为逗号周次；xf 为学分字符串
//   #xhid 为 86 位哈希、#xqdm 为 32 位哈希（不是学号），#xnxq1 为 select，校区为 #xqSelect
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    var ADAPTER = {
        id: 'HNAUHE_01',
        name: '河南牧业经济学院教务系统',
        loginUrl: 'https://hnuahe.jw.chaoxing.com/admin/login?logout=1',
        timetablePath: '/admin/pkgl/xskb/queryKbForXsd'
    };

    /**
     * 河南牧业经济学院教学作息时间（教务处公布，12 节制）。
     * 仅当 /admin/api/getZclistByXnxq 取不到节次时间时兜底使用；
     * 接口正常时一律以接口数据为准，不覆盖学校后续调整。
     */
    var DEFAULT_TIME_SLOTS = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:00', endTime: '10:45' },
        { number: 4, startTime: '10:55', endTime: '11:40' },
        { number: 5, startTime: '11:50', endTime: '12:35' },
        { number: 6, startTime: '14:30', endTime: '15:15' },
        { number: 7, startTime: '15:25', endTime: '16:10' },
        { number: 8, startTime: '16:30', endTime: '17:15' },
        { number: 9, startTime: '17:25', endTime: '18:10' },
        { number: 10, startTime: '19:00', endTime: '19:45' },
        { number: 11, startTime: '19:55', endTime: '20:40' },
        { number: 12, startTime: '20:50', endTime: '21:35' }
    ];

    function cloneDefaultTimeSlots() {
        return DEFAULT_TIME_SLOTS.map(function (slot) {
            return { number: slot.number, startTime: slot.startTime, endTime: slot.endTime };
        });
    }

    // ======================= 0. 宿主 Bridge =======================

    /**
     * 宿主（拾光 App）会注入 window.shiguangBridge / shiguangBridgePromise。
     * 在纯浏览器控制台里测试时这两个对象不存在，这里补一个控制台替身，
     * 让脚本可以脱离 App 直接跑通并打印数据结构。App 内运行时本函数直接返回。
     */
    function ensureBridge() {
        var hasPromise = !!window.shiguangBridgePromise;
        var hasSync = !!window.shiguangBridge;

        if (!hasSync) {
            window.shiguangBridge = {
                showToast: function (message) { console.log('[toast] ' + message); },
                notifyTaskCompletion: function () { console.log('[bridge] notifyTaskCompletion()'); }
            };
        }

        if (!hasPromise) {
            window.shiguangBridgePromise = {
                showAlert: function (title, content) {
                    console.log('[alert] ' + title + '\n' + content);
                    return Promise.resolve(true);
                },
                showPrompt: function (title, tip, defaultText) {
                    var input = window.prompt(title + '\n' + tip, defaultText == null ? '' : String(defaultText));
                    return Promise.resolve(input);
                },
                showSingleSelection: function (title, itemsJsonString, defaultSelectedIndex) {
                    var items;
                    try { items = JSON.parse(itemsJsonString); } catch (e) { items = []; }
                    console.log('[selection] ' + title, items);
                    var fallback = (typeof defaultSelectedIndex === 'number' && defaultSelectedIndex >= 0) ? defaultSelectedIndex : 0;
                    var lines = items.map(function (text, index) { return (index + 1) + '. ' + text; }).join('\n');
                    var raw = window.prompt(title + '\n' + lines + '\n\n输入序号：', String(fallback + 1));
                    if (raw === null) return Promise.resolve(null);
                    var picked = parseInt(raw, 10);
                    if (!isFinite(picked) || picked < 1 || picked > items.length) {
                        console.warn('[selection] 序号无效，回退到默认项 ' + (fallback + 1));
                        return Promise.resolve(fallback);
                    }
                    return Promise.resolve(picked - 1);
                },
                saveImportedCourses: function (coursesJsonString) {
                    var list = JSON.parse(coursesJsonString);
                    console.log('[bridge] saveImportedCourses → ' + list.length + ' 门课程');
                    if (console.table) console.table(list);
                    return Promise.resolve(true);
                },
                savePresetTimeSlots: function (timeSlotsJsonString) {
                    var list = JSON.parse(timeSlotsJsonString);
                    console.log('[bridge] savePresetTimeSlots → ' + list.length + ' 个时间段');
                    if (console.table) console.table(list);
                    return Promise.resolve(true);
                },
                saveCourseConfig: function (configJsonString) {
                    console.log('[bridge] saveCourseConfig → ' + configJsonString);
                    return Promise.resolve(true);
                },
                saveComboSchedule: function (comboJsonString) {
                    console.log('[bridge] saveComboSchedule → ' + comboJsonString);
                    return Promise.resolve(true);
                }
            };
            console.warn('[HNAUHE] 未检测到宿主 Bridge，已启用控制台调试替身（仅用于脱离 App 的接口验证）。');
        }
    }

    function toast(message) {
        try { window.shiguangBridge.showToast(message); } catch (e) { console.log('[toast] ' + message); }
    }

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[HNAUHE]');
        console.log.apply(console, args);
    }

    // ======================= 1. 通用工具 =======================

    function pick(source, keys) {
        if (!source || typeof source !== 'object') return undefined;
        for (var i = 0; i < keys.length; i++) {
            var value = source[keys[i]];
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return undefined;
    }

    /** 超星部分字段返回 HTML（如 <a ...>课程名</a>），这里取出纯文本。 */
    function extractText(value) {
        if (value === null || value === undefined) return '';
        var text = String(value);
        if (text.indexOf('<') >= 0) {
            var match = text.match(/>([^<>]+)</);
            if (match) text = match[1];
            else text = text.replace(/<[^>]*>/g, '');
        }
        return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    }

    /** 去掉教师名后面的职称/括号备注。 */
    function cleanTeacher(value) {
        return extractText(value)
            .replace(/（[^）]*）/g, '')
            .replace(/\([^)]*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * 周次解析，兼容以下写法：
     *   "1,2,3" / "1-8,10" / "1-16周" / "1-8(单)" / "1~16" / [1,2,3]
     */
    function parseWeeks(value) {
        if (value === null || value === undefined) return [];
        if (Array.isArray(value)) {
            var fromArray = value.map(function (item) { return Number(item); })
                .filter(function (num) { return !isNaN(num) && num >= 1 && num <= 40; });
            return fromArray.filter(function (num, index, self) { return self.indexOf(num) === index; })
                .sort(function (a, b) { return a - b; });
        }

        var text = extractText(value);
        if (!text) return [];

        var onlyOdd = /单/.test(text) && !/双/.test(text);
        var onlyEven = /双/.test(text) && !/单/.test(text);

        text = text
            .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
            .replace(/周/g, '')
            .replace(/[，、；;]/g, ',');

        var weeks = {};
        text.split(',').forEach(function (chunk) {
            chunk = chunk.trim();
            if (!chunk) return;
            var range = chunk.match(/^(\d+)\s*[-~至]\s*(\d+)$/);
            if (range) {
                var start = Number(range[1]);
                var end = Number(range[2]);
                if (start > end) { var tmp = start; start = end; end = tmp; }
                for (var week = start; week <= end; week++) weeks[week] = true;
                return;
            }
            var single = chunk.match(/\d+/);
            if (single) weeks[Number(single[0])] = true;
        });

        var list = Object.keys(weeks).map(Number)
            .filter(function (week) { return week >= 1 && week <= 40; })
            .sort(function (a, b) { return a - b; });

        if (onlyOdd) list = list.filter(function (week) { return week % 2 === 1; });
        if (onlyEven) list = list.filter(function (week) { return week % 2 === 0; });
        return list;
    }

    /**
     * 节次解析，兼容 "1" / "3-4" / "0102"（超星四位编码，01=第1节,02=第2节）/
     * "1,2" / {start:1,end:2} 等返回 { start, end }。
     */
    function parseSectionRange(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'object' && value.startSection !== undefined) {
            var start = Number(value.startSection);
            var end = Number(value.endSection !== undefined ? value.endSection : value.startSection);
            return isFinite(start) ? { start: start, end: isFinite(end) ? end : start } : null;
        }

        var text = String(value).trim();
        if (!text) return null;

        var range = text.match(/^(\d{1,2})\s*[-~至]\s*(\d{1,2})$/);
        if (range) {
            var a = Number(range[1]);
            var b = Number(range[2]);
            if (a > b) { var tmp = a; a = b; b = tmp; }
            return { start: a, end: b };
        }

        // 四位数字编码：0102 → 1..2，0304 → 3..4
        if (/^\d{4}$/.test(text)) {
            var first = Number(text.slice(0, 2));
            var last = Number(text.slice(2));
            if (first >= 1 && last >= first) return { start: first, end: last };
        }

        var parts = text.split(/[,，、\s]+/).map(Number).filter(function (num) { return !isNaN(num) && num > 0; });
        if (parts.length === 0) return null;
        parts.sort(function (x, y) { return x - y; });
        return { start: parts[0], end: parts[parts.length - 1] };
    }

    function formatTime(value) {
        if (typeof value !== 'string') return null;
        var match = value.trim().match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
        if (!match) return null;
        var hour = Number(match[1]);
        var minute = Number(match[2]);
        if (hour > 24 || minute > 59) return null;
        return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
    }

    function toDateString(value) {
        if (!value) return null;
        var text = String(value).trim();
        var direct = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (direct) {
            return direct[1] + '-' + ('0' + Number(direct[2])).slice(-2) + '-' + ('0' + Number(direct[3])).slice(-2);
        }
        var slash = text.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
        if (slash) {
            return slash[1] + '-' + ('0' + Number(slash[2])).slice(-2) + '-' + ('0' + Number(slash[3])).slice(-2);
        }
        return null;
    }

    // ======================= 2. 接口定义与请求 =======================

    /**
     * 学校实际只有三个校区。接口 getXqList 会额外返回「北校区」「驻马店校区」这类
     * 历史/合并前的条目，它们恒无课程数据（实测 data 为 null），
     * 这里按白名单过滤，避免用户在下拉里误选到空校区。
     */
    var SCHOOL_CAMPUSES = ['龙子湖校区', '英才校区', '北林校区'];

    /** 校区列表。实测（HNAUHE 2026-11-09）：仅 jcsj 路径有效 */
    var CAMPUS_URLS = [
        '/admin/api/jcsj/xqsj/getXqList',
        '/admin/xsd/api/getXqList'
    ];

    /** 周次 + 节次时间（开学日期也在这里）。实测 role/userId 可省略 */
    function weekUrls(xnxq, xqdm) {
        var query = 'xnxq=' + encodeURIComponent(xnxq) + '&xqid=' + encodeURIComponent(xqdm || '');
        return [
            '/admin/api/getZclistByXnxq?' + query,
            '/admin/api/jcsj/getZclistByXnxq?' + query
        ];
    }

    /** 学生课表明细。实测 /admin/pkgl/... 与 /admin/xsd/pkgl/... 均可用 */
    function courseUrls(xnxq, xhid, xqdm) {
        var query = 'xnxq=' + encodeURIComponent(xnxq) +
            '&xhid=' + encodeURIComponent(xhid) +
            '&xqdm=' + encodeURIComponent(xqdm || '') +
            '&xskbxslx=0';
        return [
            '/admin/pkgl/xskb/sdpkkbList?' + query,
            '/admin/xsd/pkgl/xskb/sdpkkbList?' + query
        ];
    }

    function requestJson(url) {
        return fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            }
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        }).then(function (text) {
            var trimmed = (text || '').trim();
            if (!trimmed) throw new Error('响应为空');
            if (trimmed.charAt(0) === '<') throw new Error('返回了 HTML（可能登录已失效）');
            try {
                return JSON.parse(trimmed);
            } catch (e) {
                // 兼容 JSONP 包裹
                var jsonp = trimmed.match(/^[\w$.]+\(([\s\S]*)\);?$/);
                if (jsonp) return JSON.parse(jsonp[1]);
                throw new Error('响应不是合法 JSON');
            }
        });
    }

    /** 依次尝试多个候选地址，返回第一个成功（且能取到数组）的结果。 */
    async function requestFirstUsable(urls, pickArray) {
        var errors = [];
        for (var i = 0; i < urls.length; i++) {
            try {
                var data = await requestJson(urls[i]);
                // 超星不同部署版本的包装字段：ret / code / success，或直接返回数组
                var accepted = data && (
                    Number(data.ret) === 0 ||
                    Number(data.code) === 0 ||
                    data.success === true ||
                    Array.isArray(data) ||
                    data.rows ||
                    data.data
                );
                if (accepted) {
                    var rows = pickArray(data);
                    if (rows) {
                        log('接口命中：' + urls[i]);
                        return { url: urls[i], data: data, rows: rows };
                    }
                }
                errors.push(urls[i] + ' → 结构不符');
            } catch (error) {
                errors.push(urls[i] + ' → ' + error.message);
            }
        }
        log('接口全部未命中：\n  ' + errors.join('\n  '));
        return null;
    }

    function rowsFrom(data, keys) {
        if (!data) return null;
        if (Array.isArray(data)) return data;
        for (var i = 0; i < keys.length; i++) {
            var node = data;
            var path = keys[i].split('.');
            for (var j = 0; j < path.length && node; j++) node = node[path[j]];
            if (Array.isArray(node)) return node;
        }
        return null;
    }

    // ======================= 3. 页面参数 =======================

    function isLoginPage() {
        var href = window.location.href;
        if (/\/admin\/login/i.test(href) || /slogin/i.test(href) || /[?&]logout=1/i.test(href)) return true;
        // 登录页常见特征：有密码框但没有课表容器
        var hasPassword = !!document.querySelector('input[type="password"]');
        var hasTimetable = !!document.querySelector('#xhid, #xqdm, #xnxq1');
        return hasPassword && !hasTimetable;
    }

    function readHiddenValue(selectors) {
        for (var i = 0; i < selectors.length; i++) {
            var element = document.querySelector(selectors[i]);
            if (element && String(element.value || '').trim()) return String(element.value).trim();
        }
        return '';
    }

    /**
     * 取 xhid / xqdm / 学年学期下拉框。
     * 课表页没有隐藏域时，抓一次课表页 HTML 再解析（同源 fetch 复用会话）。
     */
    async function getPageParams() {
        var xhid = readHiddenValue(['#xhid', 'input[name="xhid"]', '#xh_id', 'input[name="xh"]']);
        var xqdm = readHiddenValue(['#xqdm', 'input[name="xqdm"]', '#xq_id']);
        var semesterSelect = document.querySelector('#xnxq1, select[name="xnxq"]');
        var semesterHtml = semesterSelect ? semesterSelect.outerHTML : '';

        if (!xhid || !xqdm || !semesterHtml) {
            log('页面缺少隐藏域，尝试抓取课表页 ' + ADAPTER.timetablePath);
            try {
                var html = await fetch(ADAPTER.timetablePath, { credentials: 'include' }).then(function (res) { return res.text(); });
                var doc = new DOMParser().parseFromString(html, 'text/html');
                xhid = xhid || (doc.querySelector('#xhid') || {}).value || '';
                xqdm = xqdm || (doc.querySelector('#xqdm') || {}).value || '';
                var docSelect = doc.querySelector('#xnxq1') || doc.querySelector('select[name="xnxq"]');
                semesterHtml = semesterHtml || (docSelect ? docSelect.outerHTML : '');
            } catch (error) {
                log('抓取课表页失败：' + error.message);
            }
        }

        // 兜底：从当前 URL 查询串取
        try {
            var search = new URLSearchParams(window.location.search);
            xhid = xhid || (search.get('xhid') || '');
            xqdm = xqdm || (search.get('xqdm') || '');
        } catch (e) { /* 忽略 */ }

        // 日志里只打长度，避免把会话内的哈希标识写进控制台历史
        log('页面参数：xhid=' + (xhid ? xhid.length + '位' : '空') + '，xqdm=' + (xqdm ? xqdm.length + '位' : '空') + '，学期下拉=' + (semesterHtml ? '有' : '无'));
        return { xhid: xhid, xqdm: xqdm, semesterHtml: semesterHtml };
    }

    // ======================= 4. 学年学期 / 校区 =======================

    function semesterOptionsFromHtml(html) {
        if (!html) return null;
        try {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var select = doc.querySelector('#xnxq1') || doc.querySelector('select[name="xnxq"]') || doc.querySelector('select');
            if (!select) return null;
            var options = Array.prototype.slice.call(select.querySelectorAll('option'))
                .filter(function (option) { return String(option.value || '').trim() !== ''; });
            if (options.length === 0) return null;
            return {
                labels: options.map(function (option) { return extractText(option.textContent || option.value); }),
                values: options.map(function (option) { return String(option.value).trim(); }),
                defaultIndex: Math.max(0, options.findIndex(function (option) { return option.selected; }))
            };
        } catch (error) {
            log('解析学期下拉失败：' + error.message);
            return null;
        }
    }

    function fallbackSemesterOptions() {
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth() + 1;
        var labels = [];
        var values = [];
        var defaultIndex = 0;
        for (var offset = -2; offset <= 1; offset++) {
            var startYear = year + offset;
            for (var term = 1; term <= 2; term++) {
                labels.push(startYear + '-' + (startYear + 1) + '学年 ' + (term === 1 ? '第一学期' : '第二学期'));
                values.push(startYear + '-' + (startYear + 1) + '-' + term);
                var wantedYear = month < 9 ? year - 1 : year;
                var wantedTerm = month < 9 ? 2 : 1;
                if (startYear === wantedYear && term === wantedTerm) defaultIndex = values.length - 1;
            }
        }
        return { labels: labels, values: values, defaultIndex: defaultIndex };
    }

    async function chooseSemester(semesterHtml) {
        var options = semesterOptionsFromHtml(semesterHtml) || fallbackSemesterOptions();
        var index = await window.shiguangBridgePromise.showSingleSelection(
            '选择学年学期',
            JSON.stringify(options.labels),
            options.defaultIndex
        );
        if (index === null || index === undefined || index < 0) return null;
        var value = options.values[index];
        log('选择学年学期：' + options.labels[index] + '（' + value + '）');
        return value;
    }

    /**
     * 选择校区。返回 { code, list }，list 用于「所选校区无课时」的自动切换兜底。
     */
    async function chooseCampus(defaultXqdm) {
        var result = await requestFirstUsable(CAMPUS_URLS, function (data) {
            return rowsFrom(data, ['data', 'rows', 'result']);
        });

        if (!result || !result.rows.length) {
            log('校区接口不可用，沿用页面 xqdm=' + (defaultXqdm || '空'));
            return { code: defaultXqdm || '', list: [] };
        }

        var campuses = result.rows.map(function (item) {
            return {
                code: String(pick(item, ['id', 'xqdm', 'xqid', 'code']) || '').trim(),
                name: extractText(pick(item, ['xqmc', 'name', 'xqname']) || '')
            };
        }).filter(function (item) { return item.code; });

        // 只保留学校实际存在的三个校区；若一个都没匹配上（学校改了名字），回退用全量
        var kept = campuses.filter(function (item) { return SCHOOL_CAMPUSES.indexOf(item.name) >= 0; });
        if (kept.length > 0) {
            if (kept.length !== campuses.length) {
                var dropped = campuses.filter(function (item) { return SCHOOL_CAMPUSES.indexOf(item.name) < 0; })
                    .map(function (item) { return item.name; });
                log('已过滤非本校区的历史条目：' + dropped.join('、'));
            }
            campuses = kept;
        }

        if (campuses.length === 0) return { code: defaultXqdm || '', list: [] };
        if (campuses.length === 1) {
            log('仅一个校区，自动选择：' + campuses[0].name + '（' + campuses[0].code + '）');
            return { code: campuses[0].code, list: campuses };
        }

        // 默认项 = 课表页当前显示的校区（#xqdm），避免默认落到无课的校区
        var defaultIndex = campuses.findIndex(function (item) { return item.code === defaultXqdm; });
        var index = await window.shiguangBridgePromise.showSingleSelection(
            '选择校区',
            JSON.stringify(campuses.map(function (item) { return item.name; })),
            defaultIndex >= 0 ? defaultIndex : 0
        );
        if (index === null || index === undefined || index < 0) return null;
        log('选择校区：' + campuses[index].name + '（' + campuses[index].code + '）');
        return { code: campuses[index].code, list: campuses };
    }

    // ======================= 5. 时间 / 开学日期 =======================

    /** 节次时间必须从 1 开始连续，否则宿主会拒绝，这里做一次规范化。 */
    function sanitizeTimeSlots(rows) {
        if (!Array.isArray(rows)) return [];
        var map = {};
        rows.forEach(function (item) {
            var number = Number(pick(item, ['jc', 'jcmc', 'number', 'section']));
            var start = formatTime(pick(item, ['kssj', 'startTime', 'start']) || '');
            var end = formatTime(pick(item, ['jssj', 'endTime', 'end']) || '');
            if (!isFinite(number) || number < 1 || !start || !end) return;
            if (map[number]) return;
            map[number] = { number: number, startTime: start, endTime: end };
        });

        var sorted = Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (number) { return map[number]; });
        if (sorted.length === 0) return [];

        var consecutive = sorted.every(function (slot, index) { return slot.number === index + 1; });
        if (!consecutive) {
            log('节次编号不连续（' + sorted.map(function (slot) { return slot.number; }).join(',') + '），按顺序重排为 1..' + sorted.length);
            sorted = sorted.map(function (slot, index) { return { number: index + 1, startTime: slot.startTime, endTime: slot.endTime }; });
        }
        return sorted;
    }

    /** 对比接口作息与内置 12 节作息表，返回差异描述（供 probe 联调使用）。 */
    function diffWithDefault(apiSlots) {
        var diffs = [];
        cloneDefaultTimeSlots().forEach(function (def) {
            var hit = apiSlots.filter(function (slot) { return slot.number === def.number; })[0];
            if (!hit) {
                diffs.push('第' + def.number + '节：接口未返回');
                return;
            }
            if (hit.startTime !== def.startTime || hit.endTime !== def.endTime) {
                diffs.push('第' + def.number + '节：接口 ' + hit.startTime + '-' + hit.endTime +
                    '，内置 ' + def.startTime + '-' + def.endTime);
            }
        });
        return diffs;
    }

    function semesterStartFrom(zclist) {
        if (!Array.isArray(zclist) || zclist.length === 0) return null;
        var firstWeek = zclist.filter(function (item) { return Number(pick(item, ['zc', 'week', 'zcid'])) === 1; })[0];
        if (!firstWeek) return null;
        return toDateString(pick(firstWeek, ['minrq', 'ksrq', 'startDate', 'rq']));
    }

    async function fetchScheduleConfig(xnxq, xqdm) {
        var result = await requestFirstUsable(weekUrls(xnxq, xqdm), function (data) {
            if (data && data.data && typeof data.data === 'object') {
                if (data.data.jcsjszList || data.data.zclist) return [1];
            }
            return null;
        });

        if (!result) {
            log('作息接口不可用，改用内置 12 节作息表（开学日期仍需接口，本次为空）');
            toast('作息接口未取到，已使用内置作息表');
            return { timeSlots: cloneDefaultTimeSlots(), semesterStartDate: null, fromApi: false };
        }

        var payload = result.data.data || result.data;
        var timeSlots = sanitizeTimeSlots(payload.jcsjszList || payload.jcsjsjList || payload.jcsjList || []);
        var semesterStartDate = semesterStartFrom(payload.zclist || payload.zclistList || []);

        var fromApi = timeSlots.length > 0;
        if (!fromApi) {
            log('接口未返回节次时间，改用内置 12 节作息表');
            timeSlots = cloneDefaultTimeSlots();
        }

        log('作息时间 ' + timeSlots.length + ' 节（' + (fromApi ? '接口' : '内置') + '），开学日期 ' + (semesterStartDate || '未取到'));
        return { timeSlots: timeSlots, semesterStartDate: semesterStartDate, fromApi: fromApi };
    }

    // ======================= 6. 课程解析 =======================

    /**
     * 把接口原始行转成宿主课程对象：
     * { name, teacher, position, day, startSection, endSection, weeks, credit }
     * 一条原始行可能带多个节次（如 djc="1,2"），会拆成多个段。
     */
    function parseCourseRows(rows) {
        var lessons = [];

        rows.forEach(function (row) {
            var name = extractText(pick(row, ['kcmc', 'courseName', 'kcmcstr']) || '');
            var teacher = cleanTeacher(pick(row, ['tmc', 'teacher', 'skjs', 'jsxm']) || '');
            var position = extractText(pick(row, ['croommc', 'room', 'jsmc', 'cdmc', 'skdd']) || '');
            var day = Number(pick(row, ['xingqi', 'xqj', 'week', 'day']));
            var weeks = parseWeeks(pick(row, ['zcstr', 'zcd', 'zcs', 'zc', 'weeks']));
            var creditRaw = pick(row, ['xf', 'credit', 'xuefen']);
            var credit = creditRaw === undefined ? undefined : Number(creditRaw);

            var sections = parseSectionRange(pick(row, ['djc', 'jc', 'jcs', 'djcstr', 'section']));

            if (!name || !isFinite(day) || day < 1 || day > 7 || !sections || weeks.length === 0) {
                if (name) log('跳过异常行：' + name + '（星期=' + day + '，节次=' + JSON.stringify(sections) + '，周次=' + weeks.length + '）');
                return;
            }

            var lesson = {
                name: name,
                teacher: teacher || '',
                position: position || '待定',
                day: day,
                startSection: sections.start,
                endSection: sections.end,
                weeks: weeks
            };
            if (isFinite(credit)) lesson.credit = credit;
            lessons.push(lesson);
        });

        return mergeAdjacent(lessons);
    }

    /** 合并同一天、同周次、同课程、同教师、同地点且节次相邻/重叠的条目。 */
    function mergeAdjacent(lessons) {
        var buckets = {};
        lessons.forEach(function (lesson) {
            var key = [lesson.day, lesson.weeks.join(','), lesson.name, lesson.teacher, lesson.position].join('|');
            (buckets[key] = buckets[key] || []).push(lesson);
        });

        var merged = [];
        Object.keys(buckets).forEach(function (key) {
            var list = buckets[key].sort(function (a, b) { return a.startSection - b.startSection || a.endSection - b.endSection; });
            var current = null;
            list.forEach(function (lesson) {
                if (current && lesson.startSection <= current.endSection + 1) {
                    current.endSection = Math.max(current.endSection, lesson.endSection);
                    return;
                }
                if (current) merged.push(current);
                current = {
                    name: lesson.name,
                    teacher: lesson.teacher,
                    position: lesson.position,
                    day: lesson.day,
                    startSection: lesson.startSection,
                    endSection: lesson.endSection,
                    weeks: lesson.weeks.slice()
                };
                if (lesson.credit !== undefined) current.credit = lesson.credit;
            });
            if (current) merged.push(current);
        });

        merged.sort(function (a, b) {
            return a.day - b.day ||
                a.startSection - b.startSection ||
                a.weeks.length - b.weeks.length ||
                a.name.localeCompare(b.name, 'zh-Hans-CN');
        });

        log('解析完成：' + merged.length + ' 条课程（已合并相邻节次）');
        return merged;
    }

    async function fetchCourses(xnxq, xhid, xqdm) {
        var result = await requestFirstUsable(courseUrls(xnxq, xhid, xqdm), function (data) {
            return rowsFrom(data, ['data', 'rows', 'result', 'data.list']);
        });

        // 空结果不弹提示：主流程会在试完所有校区后再统一提示
        if (!result || !result.rows.length) {
            log('校区 ' + xqdm + ' 未返回课程行');
            return [];
        }

        log('课程原始行数：' + result.rows.length + '（校区 ' + xqdm + '）');
        if (result.rows.length > 0) log('原始字段样例：', result.rows[0]);
        return parseCourseRows(result.rows);
    }

    // ======================= 7. 写入 =======================

    async function saveCourses(courses) {
        try {
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
            return true;
        } catch (error) {
            toast('课程保存失败：' + (error && error.message ? error.message : error));
            return false;
        }
    }

    async function saveTimeSlots(timeSlots) {
        if (!Array.isArray(timeSlots) || timeSlots.length === 0) return false;
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            return true;
        } catch (error) {
            toast('作息时间保存失败：' + (error && error.message ? error.message : error));
            return false;
        }
    }

    async function saveConfig(semesterStartDate) {
        if (!semesterStartDate) return false;
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterStartDate: semesterStartDate }));
            return true;
        } catch (error) {
            toast('课表配置保存失败：' + (error && error.message ? error.message : error));
            return false;
        }
    }

    // ======================= 8. 主流程 =======================

    async function runImport() {
        ensureBridge();

        if (isLoginPage()) {
            toast('请先登录教务系统，并进入「我的课表」页面后再执行导入');
            return;
        }

        var confirmed = await window.shiguangBridgePromise.showAlert(
            ADAPTER.name + ' 课表导入',
            '将自动读取当前学期的作息时间、开学日期与课程数据。\n请确认已在课表页面（登录状态有效）。',
            '开始导入'
        );
        if (!confirmed) {
            toast('已取消导入');
            return;
        }

        var params = await getPageParams();
        if (!params.xhid) {
            toast('未能读取学号参数，请在课表页面执行，或重新登录后再试');
            return;
        }

        var xnxq = await chooseSemester(params.semesterHtml);
        if (!xnxq) {
            toast('未选择学年学期，导入结束');
            return;
        }

        var campusSel = await chooseCampus(params.xqdm);
        if (!campusSel) {
            toast('未选择校区，导入结束');
            return;
        }
        var xqdm = campusSel.code;

        var config = await fetchScheduleConfig(xnxq, xqdm);

        var courses = await fetchCourses(xnxq, params.xhid, xqdm);

        // 校区兜底：所选校区取不到课程时，自动试其它校区（各校区课表数据不共享）
        if (courses.length === 0 && campusSel.list && campusSel.list.length > 1) {
            var others = campusSel.list.filter(function (item) { return item.code !== xqdm; });
            for (var i = 0; i < others.length && courses.length === 0; i++) {
                log('试其它校区：' + others[i].name);
                var probeCourses = await fetchCourses(xnxq, params.xhid, others[i].code);
                if (probeCourses.length > 0) {
                    courses = probeCourses;
                    xqdm = others[i].code;
                    toast('所选校区无课程，已自动切换为「' + others[i].name + '」');
                }
            }
        }

        if (courses.length === 0) {
            toast('该学期在所有校区都没有取到课程数据');
            return;
        }

        var saved = await saveCourses(courses);
        if (!saved) return;

        // 宿主要求：包含组合作息方案的导入必须先提交基础时间段
        await saveTimeSlots(config.timeSlots);
        await saveConfig(config.semesterStartDate);

        toast('导入成功：' + courses.length + ' 条课程' + (config.timeSlots.length ? '、' + config.timeSlots.length + ' 节作息' : ''));
        window.shiguangBridge.notifyTaskCompletion();
        log('导入流程结束', { courses: courses.length, timeSlots: config.timeSlots.length, semesterStartDate: config.semesterStartDate });
    }

    // ======================= 9. 调试入口（联调用，App 内不影响） =======================

    /**
     * 只探测不写入：打印页面参数、各接口命中情况、原始字段样例。
     * 控制台执行：await window.HNAUHE.probe()
     */
    async function probe() {
        ensureBridge();
        var report = {
            url: window.location.href,
            onLoginPage: isLoginPage(),
            params: null,
            campus: null,
            schedule: null,
            courses: null
        };

        report.params = await getPageParams();

        var campus = await requestFirstUsable(CAMPUS_URLS, function (data) {
            return rowsFrom(data, ['data', 'rows', 'result']);
        });
        report.campus = campus ? { url: campus.url, count: campus.rows.length, sample: campus.rows[0] } : '未命中';

        var xnxq = null;
        var options = semesterOptionsFromHtml(report.params.semesterHtml) || fallbackSemesterOptions();
        xnxq = options.values[options.defaultIndex];
        report.params.semesterGuess = xnxq;

        if (xnxq) {
            var xqdm = report.params.xqdm || (campus && campus.rows[0] ? String(pick(campus.rows[0], ['id', 'xqdm']) || '') : '');
            var week = await requestFirstUsable(weekUrls(xnxq, xqdm), function (data) {
                if (data && data.data && (data.data.jcsjszList || data.data.zclist)) return [1];
                return null;
            });
            var payload = (week && week.data && week.data.data) || {};
            var apiSlots = sanitizeTimeSlots(payload.jcsjszList || payload.jcsjsjList || payload.jcsjList || []);
            report.schedule = week ? {
                url: week.url,
                keys: Object.keys(payload),
                slotsFromApi: apiSlots,
                slotsDiffWithBuiltin: apiSlots.length ? diffWithDefault(apiSlots) : '接口未返回节次时间，导入时会用内置 12 节表',
                semesterStartDate: semesterStartFrom(payload.zclist || [])
            } : '未命中';

            if (report.params.xhid) {
                var course = await requestFirstUsable(courseUrls(xnxq, report.params.xhid, xqdm), function (data) {
                    return rowsFrom(data, ['data', 'rows', 'result', 'data.list']);
                });
                report.courses = course ? { url: course.url, count: course.rows.length, sample: course.rows[0] } : '未命中';
            }
        }

        console.log('[HNAUHE] 探测报告', report);
        return report;
    }

    window.HNAUHE = {
        adapter: ADAPTER,
        defaultTimeSlots: cloneDefaultTimeSlots(),
        probe: probe,
        run: runImport,
        parseWeeks: parseWeeks,
        parseSectionRange: parseSectionRange
    };

    // App 内进入适配即执行；控制台里粘贴也会直接跑一遍（保存动作由替身接管，不写入真实数据）
    runImport().catch(function (error) {
        console.error('[HNAUHE] 导入异常', error);
        toast('导入异常：' + (error && error.message ? error.message : error));
    });
})();
