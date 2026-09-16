// ============================================================
// 江苏科技大学（just.edu.cn）拾光课程表适配脚本
// 教务系统：正方新一代教务（/jwglxt）
// 访问方式：校外经深信服 enlink WebVPN（统一身份认证 https://client.v.just.edu.cn/）
//   课表页示例：
//   https://client.v.just.edu.cn/http/webvpn<hex>/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default
//   其中 <hex> 与当前登录会话相关，不能写死，脚本从当前页面 URL 动态取前缀。
// 使用到的正方接口：
//   kbcx/xskbcx_cxXskbcxIndex.html  课表查询页（读学年 #xnm / 学期 #xqm 下拉）
//   kbcx/xskbcx_cxXsgrkb.html       个人课表 JSON（kbList 已排课、sjkList 未排课）
//   kbcx/xskbcxZccx_cxZcByXnxq.html 学期周次校历（开学日期、总周数）
//   kbcx/xskbcx_cxRjc.html          校区节次作息（按 xqh_id 取）
// 维护者：abyss-stars
// ============================================================
(async function () {
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    if (!bridge || !native) {
        console.error('JS: 请通过拾光课程表或适配测试器运行此脚本。');
        return;
    }
    if (window.__justImportRunning) {
        native.showToast('江苏科技大学课表正在导入，请勿重复点击。');
        return;
    }
    window.__justImportRunning = true;

    // 正方新一代教务的模块号，不同部署可能不同，依次尝试
    const GNMKDMS = ['N2151', 'N253508'];

    const text = (value) => String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');

    // ---------- 1. 接口地址：保留 WebVPN 前缀 ----------
    // 校内直连：https://<host>/jwglxt/...
    // WebVPN  ：https://client.v.just.edu.cn/http/webvpn<hex>/jwglxt/...（<hex> 会话相关，必须从当前页取）
    function resolveJwglxtBase() {
        const path = window.location.pathname || '';
        const byJwglxt = path.match(/^(.*?)\/jwglxt(?:\/|$)/i);
        if (byJwglxt) return byJwglxt[1] + '/jwglxt';

        // 当前页不在 /jwglxt 下（例如停在 WebVPN 门户页）时，从页面里指向教务的链接找前缀
        try {
            const anchors = document.querySelectorAll('a[href]');
            for (const anchor of anchors) {
                const match = String(anchor.getAttribute('href') || '')
                    .match(/^(\/(?:https?)\/(?:webvpn)?[0-9a-f]+\/jwglxt)(?:\/|$)/i);
                if (match) {
                    console.log(`JS: 从页面链接定位到教务入口前缀 ${match[1]}`);
                    return match[1];
                }
            }
        } catch (error) {
            console.warn('JS: 扫描页面教务链接失败：', error);
        }

        const byVpn = path.match(/^\/(?:https?)\/(?:webvpn)?[0-9a-f]+/i);
        return (byVpn ? byVpn[0] : '') + '/jwglxt';
    }

    const BASE = resolveJwglxtBase();
    // 深信服 enlink 网关下接口通常需要 enlink-vpn 标记（参考临沂大学等 enlink 适配），
    // 两种写法都准备好，依次尝试，谁的返回可用就用谁。
    function buildUrls(modulePath) {
        const urls = [];
        for (const gnmkdm of GNMKDMS) {
            const head = `${BASE}${modulePath}?gnmkdm=${gnmkdm}`;
            urls.push(`${head}&enlink-vpn`);
            urls.push(head);
        }
        return urls;
    }

    // 只认登录页的强特征，避免把正常教务页面的“退出登录”之类误判成掉线
    function looksLikeLoginPage(body) {
        if (body.length > 20000) return false;
        return /统一身份认证|login_slogin|name=["']password["']|请输入密码/.test(body);
    }

    function xhrHeaders(body) {
        const headers = {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        };
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        return headers;
    }

    function plainHeaders(body) {
        const headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };
        if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        return headers;
    }

    // 单次请求：任何失败都打印带 URL 的日志并返回 null，方便在控制台定位
    async function fetchOnce(url, init, validate) {
        const label = `${init.method} ${url}`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
        try {
            const response = await fetch(url, Object.assign({}, init, {
                signal: controller ? controller.signal : undefined
            }));
            if (!response.ok) {
                console.warn(`JS: ${label} → HTTP ${response.status}`);
                return null;
            }
            const raw = await response.text();
            if (!raw) {
                console.warn(`JS: ${label} → 空响应`);
                return null;
            }
            if (looksLikeLoginPage(raw)) {
                console.warn(`JS: ${label} → 被跳到登录页，会话可能已失效`);
                return null;
            }
            if (validate && !validate(raw)) {
                console.warn(`JS: ${label} → 内容不是预期数据（${raw.length} 字节），开头：${raw.slice(0, 120).replace(/\s+/g, ' ')}`);
                return null;
            }
            console.log(`JS: ${label} → 成功（${raw.length} 字节）`);
            return raw;
        } catch (error) {
            const reason = error && error.name === 'AbortError' ? '请求超时' : (error && error.message) || String(error);
            console.warn(`JS: ${label} → ${reason}`);
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function requestFirstUsable(urls, init, validate) {
        for (const url of urls) {
            const raw = await fetchOnce(url, init, validate);
            if (raw) return raw;
        }
        return null;
    }

    // 依次尝试：各模块号 × enlink-vpn 写法 ×（XHR 头 / 普通头）
    async function requestText(modulePath, options) {
        const opts = options || {};
        const method = opts.method || 'GET';
        const body = opts.body || undefined;
        const urls = buildUrls(modulePath);
        const headerSets = opts.preferPlainHeaders
            ? [plainHeaders(body), xhrHeaders(body)]
            : [xhrHeaders(body), plainHeaders(body)];

        for (const headers of headerSets) {
            const raw = await requestFirstUsable(urls, {
                method: method, credentials: 'include', headers: headers, body: body
            }, opts.validate);
            if (raw !== null) return raw;
        }
        throw new Error(opts.errorMessage || '教务系统请求失败，请查看控制台 JS: 开头的日志');
    }

    async function requestAbsoluteText(url, options) {
        const opts = options || {};
        const method = opts.method || 'GET';
        const body = opts.body || undefined;
        const headerSets = opts.preferPlainHeaders
            ? [plainHeaders(body), xhrHeaders(body)]
            : [xhrHeaders(body), plainHeaders(body)];
        for (const headers of headerSets) {
            const raw = await fetchOnce(url, {
                method: method, credentials: 'include', headers: headers, body: body
            }, opts.validate);
            if (raw !== null) return raw;
        }
        return null;
    }

    function formBody(params) {
        return Object.keys(params)
            .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] == null ? '' : params[key])}`)
            .join('&');
    }

    function looksLikeJson(raw) {
        const head = raw.replace(/^\s+/, '').charAt(0);
        return head === '{' || head === '[';
    }

    async function requestJson(modulePath, params) {
        const raw = await requestText(modulePath, {
            method: 'POST',
            body: formBody(params),
            validate: looksLikeJson,
            errorMessage: '课表接口请求失败（可能是登录已失效或接口地址变化），请查看控制台 JS: 开头的日志'
        });
        try {
            return JSON.parse(raw);
        } catch (error) {
            throw new Error('教务系统未返回 JSON（可能是登录已失效或接口地址变化）');
        }
    }

    // ---------- 2. 解析工具 ----------
    // 周次："1-16周"、"1-16周(单)"、"1,3,5-9周"、"1-16周(双)" 等
    function parseWeeks(value) {
        const normalized = text(value)
            .replace(/\s/g, '')
            .replace(/[，、；;]/g, ',')
            .replace(/（/g, '(')
            .replace(/）/g, ')');
        const weeks = new Set();
        for (const part of normalized.split(',')) {
            if (!part) continue;
            const odds = part.indexOf('单') !== -1;
            const evens = part.indexOf('双') !== -1;
            const digits = part.replace(/[^\d-]/g, '');
            const range = digits.match(/^(\d+)-(\d+)$/) || digits.match(/^(\d+)$/);
            if (!range) continue;
            const start = Number(range[1]);
            const end = Number(range[2] || range[1]);
            if (!(start > 0) || end < start) continue;
            for (let week = start; week <= end; week++) {
                if (odds && week % 2 === 0) continue;
                if (evens && week % 2 !== 0) continue;
                weeks.add(week);
            }
        }
        return [...weeks].sort((a, b) => a - b);
    }

    // 节次："1-2"、"1"、"0102"（部分部署补零写法）、"3-4节"
    function parseSections(value) {
        const raw = text(value);
        if (!raw) return null;
        const hyphen = raw.match(/(\d+)\s*[-~—－]\s*(\d+)/);
        if (hyphen) {
            const start = Number(hyphen[1]);
            const end = Number(hyphen[2]);
            return start > 0 && end >= start ? [start, end] : null;
        }
        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;
        if (digits.length === 4) {
            const start = Number(digits.slice(0, 2));
            const end = Number(digits.slice(2));
            if (start > 0 && end >= start) return [start, end];
        }
        const single = Number(digits);
        return single > 0 ? [single, single] : null;
    }

    function normalizeTime(value) {
        const match = String(value == null ? '' : value).match(/(\d{1,2}):(\d{2})/);
        if (!match) return '';
        const hour = Number(match[1]);
        if (hour > 23) return '';
        return `${hour < 10 ? '0' : ''}${hour}:${match[2]}`;
    }

    function toMinutes(value) {
        const match = String(value == null ? '' : value).match(/^(\d{1,2}):(\d{2})$/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
    }

    // 把一条接口记录转成排课条目；没有固定星期/节次的（实践、网络课程等）返回 null
    function toCourseEntry(raw) {
        const name = text(raw.kcmc);
        const day = Number(text(raw.xqj));
        const weeks = parseWeeks(raw.zcd);
        const sections = parseSections(text(raw.jcs) !== '' ? raw.jcs : raw.jc);
        if (!name || !(day >= 1 && day <= 7) || !weeks.length || !sections) return null;
        return {
            campusId: text(raw.xqh_id) || '0',
            campusName: text(raw.xqmc),
            course: {
                name: name,
                teacher: text(raw.xm) || '未知教师',
                position: text(raw.cdmc) || text(raw.cdbh) || '未排地点',
                day: day,
                startSection: sections[0],
                endSection: sections[1],
                weeks: weeks
            }
        };
    }

    // 解析一个课程列表（kbList / sjkList 通用）
    //   能排进课表的进 entries；排不了的进 unparsed，由调用方决定怎么提示
    function parseCourseList(list, label, quiet) {
        const entries = [];
        const unparsed = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            const entry = toCourseEntry(raw);
            if (entry) {
                entries.push(entry);
            } else {
                unparsed.push(raw);
                if (!quiet) console.warn(`JS: ${label} 里跳过无法解析的记录`, raw);
            }
        }
        return { entries: entries, unparsed: unparsed };
    }

    // 校区作息（xskbcx_cxRjc）：jcmc=节次，qssj/jssj=起止时间
    function parseTimeSlots(rows) {
        const slots = [];
        for (const row of (Array.isArray(rows) ? rows : [])) {
            if (!row || typeof row !== 'object') continue;
            const number = Number(text(row.jcmc != null ? row.jcmc : row.jcdm));
            let startTime = normalizeTime(row.qssj);
            let endTime = normalizeTime(row.jssj);
            if (!startTime || !endTime) {
                const match = text(row.sksj).match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
                if (match) {
                    startTime = normalizeTime(match[1]);
                    endTime = normalizeTime(match[2]);
                }
            }
            if (!(number > 0) || !startTime || !endTime || toMinutes(startTime) >= toMinutes(endTime)) continue;
            slots.push({ number: number, startTime: startTime, endTime: endTime });
        }
        slots.sort((a, b) => a.number - b.number);
        const continuous = slots.length > 0 && slots.every((slot, index) => slot.number === index + 1);
        return continuous ? slots : [];
    }

    // 学期周次校历：zs=周次，rq="起始日/结束日"
    function parseWeekCalendar(rows) {
        if (!Array.isArray(rows) || !rows.length) return null;
        const weeks = [];
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const number = Number(text(row.zs != null ? row.zs : row.zsmc));
            const start = text(row.rq || row.zcrq || row.ksrq).split('/')[0];
            if (!(number > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
            weeks.push({ number: number, start: start });
        }
        if (!weeks.length) return null;
        weeks.sort((a, b) => a.number - b.number);
        const first = weeks[0];
        const firstDayOfWeek = (new Date(`${first.start}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
        return { startDate: first.start, totalWeeks: weeks[weeks.length - 1].number, firstDayOfWeek: firstDayOfWeek };
    }

    // 教务处公布的作息时间表（cxRjc 接口不可用时兜底）
    const FALLBACK_TIME_SLOTS = {
        // 江苏科技大学（长山校区）教学作息时间表-202305
        changshan: [
            { number: 1, startTime: '08:30', endTime: '09:15' },
            { number: 2, startTime: '09:20', endTime: '10:05' },
            { number: 3, startTime: '10:25', endTime: '11:10' },
            { number: 4, startTime: '11:15', endTime: '12:00' },
            { number: 5, startTime: '14:00', endTime: '14:45' },
            { number: 6, startTime: '14:50', endTime: '15:35' },
            { number: 7, startTime: '15:55', endTime: '16:40' },
            { number: 8, startTime: '16:45', endTime: '17:30' },
            { number: 9, startTime: '18:30', endTime: '19:15' },
            { number: 10, startTime: '19:20', endTime: '20:05' }
        ],
        // 江苏科技大学（梦溪校区）教学作息时间表
        mengxi: [
            { number: 1, startTime: '08:00', endTime: '08:45' },
            { number: 2, startTime: '08:55', endTime: '09:40' },
            { number: 3, startTime: '10:00', endTime: '10:45' },
            { number: 4, startTime: '10:55', endTime: '11:40' },
            { number: 5, startTime: '14:00', endTime: '14:45' },
            { number: 6, startTime: '14:55', endTime: '15:40' },
            { number: 7, startTime: '15:50', endTime: '16:35' },
            { number: 8, startTime: '16:45', endTime: '17:30' },
            { number: 9, startTime: '19:00', endTime: '19:45' },
            { number: 10, startTime: '19:55', endTime: '20:40' },
            { number: 11, startTime: '20:50', endTime: '21:35' }
        ],
        // 张家港校区：取自 2026-2027 学年第 1 学期 xskbcx_cxRjc 接口实测返回（与梦溪不同，勿混用）
        zhangjiagang: [
            { number: 1, startTime: '08:00', endTime: '08:45' },
            { number: 2, startTime: '08:55', endTime: '09:40' },
            { number: 3, startTime: '10:00', endTime: '10:45' },
            { number: 4, startTime: '10:55', endTime: '11:40' },
            { number: 5, startTime: '14:00', endTime: '14:45' },
            { number: 6, startTime: '14:55', endTime: '15:40' },
            { number: 7, startTime: '16:00', endTime: '16:45' },
            { number: 8, startTime: '16:55', endTime: '17:40' },
            { number: 9, startTime: '19:00', endTime: '19:45' },
            { number: 10, startTime: '19:55', endTime: '20:40' },
            { number: 11, startTime: '20:50', endTime: '21:35' }
        ]
    };

    // 只对已知校区的作息兜底；其它校区不猜，宁可不导作息
    function fallbackSlotsByCampusName(campusName) {
        if (/张家港/.test(campusName)) return FALLBACK_TIME_SLOTS.zhangjiagang;
        if (/梦溪/.test(campusName)) return FALLBACK_TIME_SLOTS.mengxi;
        if (/长山/.test(campusName)) return FALLBACK_TIME_SLOTS.changshan;
        return null;
    }

    // 节次/周次合并去重（参考 wiki《课程合并与去重函数》）
    function mergeCourses(courses) {
        if (!Array.isArray(courses) || courses.length <= 1) return courses;

        const list = courses.map((course) => Object.assign({}, course, {
            name: course.name || '',
            teacher: course.teacher || '',
            position: course.position || '',
            weeks: Array.isArray(course.weeks) ? [...course.weeks].sort((a, b) => a - b) : []
        }));

        const sameCourse = (a, b) =>
            a.name === b.name && a.teacher === b.teacher && a.position === b.position && a.day === b.day &&
            !!a.isCustomTime === !!b.isCustomTime &&
            (!a.isCustomTime || (a.customStartTime === b.customStartTime && a.customEndTime === b.customEndTime));

        list.sort((a, b) =>
            a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
            (a.startSection || 0) - (b.startSection || 0));

        const step1 = [];
        let current = list[0];
        for (let i = 1; i < list.length; i++) {
            const next = list[i];
            const sameWeeks = current.weeks.join(',') === next.weeks.join(',');
            const mergeable = sameCourse(current, next) && sameWeeks && !current.isCustomTime;
            if (mergeable && current.endSection + 1 === next.startSection) {
                current.endSection = next.endSection;
            } else if (mergeable && current.startSection === next.startSection && current.endSection === next.endSection) {
                continue;
            } else {
                step1.push(current);
                current = next;
            }
        }
        step1.push(current);

        step1.sort((a, b) =>
            a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0));

        const step2 = [];
        let head = step1[0];
        for (let i = 1; i < step1.length; i++) {
            const next = step1[i];
            const sameRange = sameCourse(head, next) &&
                head.startSection === next.startSection && head.endSection === next.endSection;
            if (sameRange) {
                head.weeks = [...new Set([...head.weeks, ...next.weeks])].sort((a, b) => a - b);
            } else {
                step2.push(head);
                head = next;
            }
        }
        step2.push(head);
        return step2;
    }

    // ---------- 3. 交互与数据获取 ----------
    async function promptUserToStart() {
        return await bridge.showAlert(
            '江苏科技大学课表导入',
            '导入前请确保已登录教务系统。\n' +
            '校外需先经统一身份认证登录 WebVPN（client.v.just.edu.cn），' +
            '并在教务系统页面（如「信息查询-学生课表查询」）再执行导入。',
            '好的，开始导入'
        );
    }

    // ---------- 3. 学年学期：多路兜底 ----------
    // 正方各部署差异很大：老一点的把学年学期选项直接写在页面 HTML 里，
    // 新版（jqGrid 课表页）是页面脚本用 JS 动态填充下拉，
    // 所以「拉 HTML 找 option」不一定有效，必须优先读**当前页面的活动 DOM**。
    // 兜底顺序：活动 DOM → 当前页 URL 的 HTML → 课表查询页 HTML → 让用户手动输入。

    // 收集当前页面与其同源 iframe 的 document（正方常用 frameset/iframe 布局）
    function collectDocuments() {
        const docs = [];
        const walk = (doc, depth) => {
            if (!doc || depth > 3) return;
            docs.push(doc);
            let frames = [];
            try { frames = Array.from(doc.querySelectorAll('iframe, frame')); } catch (error) { frames = []; }
            for (const frame of frames) {
                try {
                    if (frame.contentDocument) walk(frame.contentDocument, depth + 1);
                } catch (error) { /* 跨域 iframe 直接跳过 */ }
            }
        };
        walk(document, 0);
        return docs;
    }

    function readTermOptionsFromDoc(doc) {
        if (!doc) return null;
        const findSelect = (id) => {
            try {
                return doc.getElementById(id) || doc.querySelector(`select[name="${id}"]`);
            } catch (error) {
                return null;
            }
        };
        const yearSelect = findSelect('xnm');
        const semesterSelect = findSelect('xqm');
        if (!yearSelect || !semesterSelect) return null;

        const readOptions = (select) => {
            let options = [];
            try { options = Array.from(select.options || []); } catch (error) { options = []; }
            return options
                .filter((option) => text(option.value) !== '')
                .map((option) => ({
                    value: text(option.value),
                    text: text(option.textContent) || text(option.value),
                    selected: option.selected === true
                }));
        };

        const yearOptions = readOptions(yearSelect);
        const semesterOptions = readOptions(semesterSelect);
        if (!yearOptions.length || !semesterOptions.length) return null;

        // 部分部署的课表返回里不带校区字段，这里顺手把课表页的校区下拉读出来备用
        const campusSelect = findSelect('xqh_id');
        const campusOptions = campusSelect ? readOptions(campusSelect) : [];

        const selectedYear = yearOptions.findIndex((option) => option.selected);
        const selectedSemester = semesterOptions.findIndex((option) => option.selected);
        return {
            yearOptions: yearOptions,
            semesterOptions: semesterOptions,
            campusOptions: campusOptions,
            campusDefaultValue: campusSelect ? text(campusSelect.value) : '',
            defaultYearIndex: selectedYear !== -1 ? selectedYear : Math.max(0, yearOptions.length - 1),
            defaultSemesterIndex: selectedSemester !== -1 ? selectedSemester : 0
        };
    }

    function readTermOptionsFromHtml(html) {
        if (!html) return null;
        try {
            return readTermOptionsFromDoc(new DOMParser().parseFromString(html, 'text/html'));
        } catch (error) {
            console.warn('JS: 解析课表页 HTML 失败：', error);
            return null;
        }
    }

    function readTermOptionsFromLiveDom() {
        for (const doc of collectDocuments()) {
            const options = readTermOptionsFromDoc(doc);
            if (options) return options;
        }
        return null;
    }

    // 给 showPrompt 用的全局校验函数（桥接层按函数名在 window 上查找）
    window.__justValidateYear = function (input) {
        return /^(19|20)\d{2}$/.test(text(input)) ? false : '请输入四位学年，例如 2025';
    };

    // 最后兜底：手动输入学年 + 选择学期（正方学期代码 3=第一学期 12=第二学期 16=第三学期）
    const SEMESTER_CODES = [
        { text: '1（第一学期）', code: '3' },
        { text: '2（第二学期）', code: '12' },
        { text: '3（第三学期/短学期）', code: '16' }
    ];

    async function askTermManually() {
        const now = new Date();
        const month = now.getMonth() + 1;
        const guessYear = month >= 9 ? now.getFullYear() : now.getFullYear() - 1;

        const yearInput = await bridge.showPrompt(
            '输入学年',
            '请输入学年起始年份（如 2025 表示 2025-2026 学年）：',
            String(guessYear),
            '__justValidateYear'
        );
        if (yearInput === null) return null;
        const xnm = text(yearInput);
        if (!/^(19|20)\d{2}$/.test(xnm)) return null;

        const defaultSemester = month >= 3 && month <= 8 ? 1 : 0;
        const semesterIndex = await bridge.showSingleSelection(
            '选择学期',
            JSON.stringify(SEMESTER_CODES.map((item) => item.text)),
            defaultSemester
        );
        if (semesterIndex === null || semesterIndex === -1) return null;
        const semester = SEMESTER_CODES[semesterIndex];

        return {
            xnm: xnm,
            xnmText: xnm,
            xqm: semester.code,
            xqmText: semester.text,
            campusOptions: [],
            campusDefaultValue: '',
            manual: true
        };
    }

    // 读取学年学期（多路兜底）
    async function fetchAcademicOptions() {
        // 1) 当前页面的活动 DOM —— 用户就在课表页上，这里最准
        const live = readTermOptionsFromLiveDom();
        if (live) {
            console.log('JS: 已从当前页面读取到学年/学期选项（活动 DOM）');
            return live;
        }
        console.warn('JS: 当前页面 DOM 里没有 #xnm / #xqm 下拉，尝试拉取页面 HTML…');

        // 2) 当前页 URL 的 HTML（带全部原始参数，最接近页面真实渲染）
        const currentUrl = window.location.href;
        if (/\/jwglxt\//i.test(currentUrl)) {
            const parsed = readTermOptionsFromHtml(await requestAbsoluteText(currentUrl, {
                method: 'GET', preferPlainHeaders: true
            }));
            if (parsed) {
                console.log('JS: 已从当前页 URL 的 HTML 读取到学年/学期选项');
                return parsed;
            }
        }

        // 3) 课表查询页 HTML
        try {
            const html = await requestText('/kbcx/xskbcx_cxXskbcxIndex.html', {
                method: 'GET',
                preferPlainHeaders: true,
                errorMessage: '课表查询页请求失败'
            });
            const parsed = readTermOptionsFromHtml(html);
            if (parsed) {
                console.log('JS: 已从课表查询页 HTML 读取到学年/学期选项');
                return parsed;
            }
        } catch (error) {
            console.warn('JS: 拉取课表查询页失败：', error);
        }
        return null;
    }

    async function selectAcademicYearAndSemester() {
        let optionsData = await fetchAcademicOptions();

        // 4) 都拿不到就让用户手动输入，不让流程卡死
        if (!optionsData) {
            console.warn('JS: 未能自动读取学年学期，改为手动输入');
            native.showToast('未能自动读取学年学期，请手动输入');
            const manual = await askTermManually();
            if (!manual) return null;
            console.log(`JS: 手动输入学年学期：xnm=${manual.xnm}, xqm=${manual.xqm}`);
            return manual;
        }

        const yearIndex = await bridge.showSingleSelection(
            '选择学年',
            JSON.stringify(optionsData.yearOptions.map((item) => item.text)),
            optionsData.defaultYearIndex
        );
        if (yearIndex === null || yearIndex === -1) return null;

        const semesterIndex = await bridge.showSingleSelection(
            '选择学期',
            JSON.stringify(optionsData.semesterOptions.map((item) => item.text)),
            optionsData.defaultSemesterIndex
        );
        if (semesterIndex === null || semesterIndex === -1) return null;

        return {
            xnm: optionsData.yearOptions[yearIndex].value,
            xnmText: optionsData.yearOptions[yearIndex].text,
            xqm: optionsData.semesterOptions[semesterIndex].value,
            xqmText: optionsData.semesterOptions[semesterIndex].text,
            campusOptions: optionsData.campusOptions,
            campusDefaultValue: optionsData.campusDefaultValue || ''
        };
    }

    async function fetchCourses(xnm, xqm, xqhId) {
        const params = { xnm: xnm, xqm: xqm, kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' };
        const data = await requestJson('/kbcx/xskbcx_cxXsgrkb.html', params);
        if (data && Array.isArray(data.kbList) && data.kbList.length) return data;
        // 个别部署必须带校区才返回数据，空结果时带上页面选中的校区重试一次
        if (xqhId) {
            console.warn(`JS: 课表返回为空，带上课区 xqh_id=${xqhId} 重试一次`);
            const retry = await requestJson('/kbcx/xskbcx_cxXsgrkb.html', Object.assign({}, params, { xqh_id: xqhId }));
            if (retry && Array.isArray(retry.kbList) && retry.kbList.length) return retry;
        }
        return data;
    }

    async function fetchWeekCalendar(xnm, xqm) {
        try {
            return parseWeekCalendar(await requestJson('/kbcx/xskbcxZccx_cxZcByXnxq.html', { xnm: xnm, xqm: xqm }));
        } catch (error) {
            console.warn('JS: 获取学期校历失败：', error);
            return null;
        }
    }

    // 返回 { slots: 数组或 null, real: 是否来自教务接口 }
    async function fetchTimeSlots(xnm, xqm, campusId, campusName) {
        const fallback = fallbackSlotsByCampusName(campusName);
        if (campusId && campusId !== '0') {
            try {
                const slots = parseTimeSlots(await requestJson('/kbcx/xskbcx_cxRjc.html', { xnm: xnm, xqm: xqm, xqh_id: campusId }));
                if (slots.length) return { slots: slots, real: true };
                console.warn(`JS: 校区作息接口没有返回可用数据(xqh_id=${campusId})`);
            } catch (error) {
                console.warn(`JS: 获取校区作息失败(xqh_id=${campusId})：`, error);
            }
        }
        if (fallback) {
            console.warn(`JS: 「${campusName || campusId}」改用教务处公布的作息表兜底`);
            return { slots: fallback, real: false };
        }
        console.warn(`JS: 「${campusName || campusId}」没有可用的作息兜底表（仅长山/梦溪有），将跳过作息导入`);
        return { slots: null, real: false };
    }

    // ---------- 4. 主流程 ----------
    try {
        if (!(await promptUserToStart())) {
            native.showToast('用户取消了导入。');
            return;
        }

        const selection = await selectAcademicYearAndSemester();
        if (!selection) {
            native.showToast('导入已取消。');
            return;
        }
        const { xnm, xnmText, xqm, xqmText } = selection;
        console.log(`JS: 已选择 ${xnmText} 学年，学期 ${xqmText}（xnm=${xnm}, xqm=${xqm}），接口基址 ${BASE}`);

        // 诊断信息：出问题时把这一整行发给维护者即可定位
        try {
            const liveYear = document.getElementById('xnm');
            const liveSemester = document.getElementById('xqm');
            console.log('JS: 诊断信息', {
                page: window.location.href,
                base: BASE,
                documents: collectDocuments().length,
                liveXnm: liveYear ? { value: liveYear.value, options: liveYear.options.length } : null,
                liveXqm: liveSemester ? { value: liveSemester.value, options: liveSemester.options.length } : null,
                hasXqh: !!document.getElementById('xqh_id'),
                campusFromPage: selection.campusDefaultValue || '(无)'
            });
        } catch (error) {
            console.warn('JS: 诊断信息输出失败：', error);
        }

        native.showToast('正在获取课表数据…');
        const [courseData, calendar] = await Promise.all([
            fetchCourses(xnm, xqm, selection.campusDefaultValue),
            fetchWeekCalendar(xnm, xqm)
        ]);

        if (!courseData || !Array.isArray(courseData.kbList)) {
            await bridge.showAlert('获取课表失败', '教务系统未返回课表数据，请确认登录状态与查询权限。', '知道了');
            return;
        }
        // 正方 v9 的 sjkList 是实践/集中教学安排：其中带星期与节次的同样能排进课表，
        // 真正"未排课"的（课程设计、网络课程、集中实践）才需要提示用户手动处理。
        const practiceCourses = Array.isArray(courseData.sjkList) ? courseData.sjkList : [];
        const kbParsed = parseCourseList(courseData.kbList, 'kbList', false);
        const sjParsed = parseCourseList(practiceCourses, 'sjkList', true);
        const entries = kbParsed.entries.concat(sjParsed.entries);

        if (!entries.length) {
            await bridge.showAlert('没有可导入的课程', '所选学期没有解析出已排课程（可能本学期无课，或课表数据格式有变化）。', '知道了');
            return;
        }

        // 校区作息：按课表里出现的校区逐个获取
        const campusStat = new Map();
        for (const entry of entries) {
            const key = entry.campusId;
            if (!campusStat.has(key)) campusStat.set(key, { id: key, name: entry.campusName, count: 0 });
            campusStat.get(key).count++;
        }
        let campuses = [...campusStat.values()].sort((a, b) => b.count - a.count);

        // 课表返回里没带校区（部分部署如此）时，退回用课表页的校区下拉，让用户指定
        if (campuses.length === 1 && campuses[0].id === '0') {
            const options = selection.campusOptions;
            if (options && options.length) {
                let campusIndex = 0;
                if (options.length > 1) {
                    const selectedCampus = options.findIndex((option) => option.selected);
                    const picked = await bridge.showSingleSelection(
                        '选择校区',
                        JSON.stringify(options.map((option) => option.text)),
                        selectedCampus !== -1 ? selectedCampus : 0
                    );
                    if (picked === null || picked === -1) {
                        native.showToast('导入已取消。');
                        return;
                    }
                    campusIndex = picked;
                }
                const chosen = options[campusIndex];
                for (const entry of entries) {
                    entry.campusId = chosen.value;
                    entry.campusName = chosen.text;
                }
                campuses = [{ id: chosen.value, name: chosen.text, count: entries.length }];
                console.log(`JS: 课表未返回校区信息，按用户选择使用「${chosen.text}」作息`);
            } else {
                console.warn('JS: 课表与课表页都没有校区信息；若作息接口取不到时间，将跳过作息导入');
            }
        }

        native.showToast('正在获取校区作息时间…');

        const scheduleMap = new Map();
        await Promise.all(campuses.map(async (campus) => {
            const result = await fetchTimeSlots(xnm, xqm, campus.id, campus.name);
            scheduleMap.set(campus.id, result);
        }));

        let presetIndex = 0;
        if (campuses.length > 1) {
            const picked = await bridge.showSingleSelection(
                '选择默认作息校区',
                JSON.stringify(campuses.map((campus) => (campus.name || campus.id) + `（${campus.count} 条）`)),
                0
            );
            if (picked === null || picked === -1) {
                native.showToast('导入已取消。');
                return;
            }
            presetIndex = picked;
        }
        const presetCampus = campuses[presetIndex];
        const presetResult = scheduleMap.get(presetCampus.id) || { slots: null, real: false };
        const presetSlots = presetResult.slots && presetResult.slots.length ? presetResult.slots : null;
        if (!presetSlots) {
            native.showToast('未能读取本校区节次作息，将跳过作息导入，请在应用内手动设置');
        }

        // 不同校区作息不一致的课程，改用自定义时间，避免节次被按错误作息渲染
        const courses = [];
        for (const entry of entries) {
            const result = scheduleMap.get(entry.campusId);
            const slots = result && result.slots && result.slots.length ? result.slots : presetSlots;
            const course = Object.assign({}, entry.course);
            if (presetSlots && slots && JSON.stringify(slots) !== JSON.stringify(presetSlots)) {
                const first = slots[course.startSection - 1];
                const last = slots[course.endSection - 1];
                if (first && last) {
                    course.isCustomTime = true;
                    course.customStartTime = first.startTime;
                    course.customEndTime = last.endTime;
                }
            }
            courses.push(course);
        }

        const merged = mergeCourses(courses);

        // 课表配置
        let maxWeek = 0;
        for (const course of merged) {
            for (const week of course.weeks) if (week > maxWeek) maxWeek = week;
        }
        const config = {};
        if (calendar) {
            config.semesterStartDate = calendar.startDate;
            config.firstDayOfWeek = calendar.firstDayOfWeek;
        }
        const rawFirstWeekday = Number(text(courseData.qsxqj));
        if (rawFirstWeekday >= 1 && rawFirstWeekday <= 7) config.firstDayOfWeek = rawFirstWeekday;
        const totalWeeks = Math.max(calendar ? calendar.totalWeeks : 0, maxWeek, 1);
        config.semesterTotalWeeks = totalWeeks;
        if (presetSlots) {
            const classDuration = toMinutes(presetSlots[0].endTime) - toMinutes(presetSlots[0].startTime);
            if (classDuration > 0) config.defaultClassDuration = classDuration;
            if (presetSlots.length > 1) {
                const breakDuration = toMinutes(presetSlots[1].startTime) - toMinutes(presetSlots[0].endTime);
                if (breakDuration > 0) config.defaultBreakDuration = breakDuration;
            }
        }

        // 保存
        await bridge.saveImportedCourses(JSON.stringify(merged));
        if (presetSlots) {
            await bridge.savePresetTimeSlots(JSON.stringify(presetSlots));
        } else {
            console.warn('JS: 已跳过作息导入（未取得本校区作息），请在应用内手动设置节次时间');
        }
        await bridge.saveCourseConfig(JSON.stringify(config));

        // 教务课表里"没有固定星期与节次"的安排（实践课程、网络课程、其他课程）：
        // kbList 与 sjkList 里都可能有，按名称+周次去重后一并提示，
        // 避免学生以为这些课"丢了"（它们本来就不在课表格子里）。
        const unplacedMap = new Map();
        kbParsed.unparsed.concat(sjParsed.unparsed).forEach((item) => {
            const name = text(item.kcmc);
            if (!name) return;
            const key = `${name}|${text(item.qsjsz)}`;
            if (!unplacedMap.has(key)) unplacedMap.set(key, item);
        });
        const unplaced = [...unplacedMap.values()];
        const importedNames = new Set(merged.map((course) => course.name));
        const sameNameCount = unplaced.filter((item) => importedNames.has(text(item.kcmc))).length;

        if (unplaced.length || !presetSlots) {
            const summary = [
                `${xnmText} 学年第 ${xqmText} 学期：已导入 ${merged.length} 条排课记录。`,
                presetSlots
                    ? `节次作息：${presetCampus.name || presetCampus.id}（${presetResult.real ? '教务系统实时数据' : '教务处公布作息表'}，共 ${presetSlots.length} 节）。`
                    : '未能读取本校区节次作息，已跳过作息导入，请在应用内手动设置节次时间。'
            ];
            if (unplaced.length) {
                summary.push(
                    `教务课表下方另有 ${unplaced.length} 项没有固定星期与节次的安排（实践/网络课程等），` +
                    '它们不会出现在课表格子里，完整清单请以教务课表页面为准。' +
                    (sameNameCount
                        ? `其中 ${sameNameCount} 项与已导入的课程同名，是同一门课的实践/其他环节，不影响上面已经导入的课表。`
                        : '')
                );
                const shown = unplaced.slice(0, 15).map((item) => {
                    const name = text(item.kcmc) || '未命名课程';
                    const span = text(item.qsjsz);
                    return span ? `· ${name}（${span}）` : `· ${name}`;
                });
                if (unplaced.length > shown.length) shown.push(`…（共 ${unplaced.length} 项）`);
                summary.push(shown.join('\n'));
            }
            await bridge.showAlert('导入完成', summary.join('\n\n'), '知道了');
        }

        native.showToast(presetSlots
            ? `导入成功：${merged.length} 条排课记录，作息校区「${presetCampus.name || presetCampus.id}」`
            : `导入成功：${merged.length} 条排课记录（作息未导入，请手动设置）`);
        console.log('JS: 导入完成', {
            courses: merged.length,
            presetSlots: presetSlots ? presetSlots.length : 0,
            unplaced: unplaced.map((item) => text(item.kcmc)).filter(Boolean),
            config: config
        });
        native.notifyTaskCompletion();
    } catch (error) {
        console.error('JS: 导入失败', error);
        try {
            await bridge.showAlert('江苏科技大学课表导入失败', (error && error.message) || String(error), '知道了');
        } catch (ignored) {
            native.showToast('导入失败：' + ((error && error.message) || String(error)));
        }
    } finally {
        delete window.__justImportRunning;
    }
})();
