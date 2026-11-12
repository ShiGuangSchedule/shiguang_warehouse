// resources/HNUST_PG/hnust_pg.js
// 湖南科技大学 研究生管理信息系统 拾光课程表适配脚本
// 入口：https://yjsjw.hnust.edu.cn/gmis/home/stulogin （学生版登录页）
//
// 本脚本的接口与数据结构已在真实账号上抓包核对（2026-2027第一学期, termcode=48）。
//
// ===== 两条必须保留的硬约束 =====
// 1) 本系统的 Scripts/rajax.js 篡改了 $.ajax：接口响应体是 AES 密文，
//    只有页面自带的 jQuery $.ajax 会被自动解密。所以本脚本只用 $.ajax，禁止改用 fetch。
// 2) 本系统是 ASP.NET 无 Cookie 会话，会话 id 写在 URL 的 (S(...)) 段里，
//    且每个静态资源请求都会各自拿到一个新会话 id。因此必须用 getAppBase() 取当前
//    页面的会话前缀来拼地址；写死 /gmis/xxx 绝对路径会开启新会话从而丢登录态。
//
// ===== 已核对接口 =====
//   GET  {base}student/default/bindterm        → [{termcode, termname}]        学期列表
//   POST {base}student/pygl/py_kbcx_ew         → {rows:[{mc, z1..z7}], week}   二维课表
//        参数：kblx=xs & termcode=<termcode>
//
// ===== 已核对数据格式 =====
//   rows[i].mc : 行标签 "无节次" / "上午1".."上午4" / "下午5".."下午8" / "晚上9".."晚上11"，
//                标签里的数字就是标准节次（1~11），无需换算。
//   rows[i].z1..z7 : 周一..周日的单元格。同格多门课用 <br/> 分隔，每条形如
//                课程名[周次]教师[地点]（地点可缺省，如 "...[17-17周]胡勇华"）。
//  连堂语义：服务端会把同一门课的文本在它占据的**每一节**里重复，页面端
//            mergeCells_table() 仅在**相邻行文本完全相同且非空**时合并。故本脚本
//            同样按「相邻行同列原始文本相同」合并出起止节次。

// 整体包在 IIFE 里：App 会用 evaluateJavascript 在同一个页面作用域内反复执行本脚本
// （例如用户中途取消后再点一次「执行导入」）。顶层的 const/let 第二次执行会抛
// "Identifier 'xxx' has already been declared" 导致整个脚本解析失败、界面毫无反应，
// 包一层即可重复执行；同时也不会往教务系统页面塞全局变量。
(function () {
    // ==========================================
    // 0. 接口路径与可调配置
    // ==========================================

    const API_PATH = {
        TERMS: 'student/default/bindterm',
        TIMETABLE: 'student/pygl/py_kbcx_ew'
    };

    // 研究生作息时间：分冬季/夏季两套，上午相同，下午与晚上夏季整体后移 30 分钟。
    // 节次：上午 1-4、下午 5-8、晚上 9-11，**共 11 节**（教务系统课表网格就是 11 行，实际有课排在第 11 节）。
    // 依据学校官方作息表：
    //   冬季：《湖南科技大学 2026 年秋（冬）季教学作息时间表》（10 月 1 日起执行）
    //         第五节课 14:00—14:45、第八节 16:55—17:40、第九/十节 19:00/19:55，自习 19:00—22:00
    //   夏季：《湖南科技大学 2026 年夏季作息时间表》（5 月 6 日起执行）
    //         第五节课 14:30—15:15、第八节 17:25—18:10、第九/十节 19:30/20:25，自习 19:30—22:30
    // 官方表只编号到第十节；第 11 节官方写作「自习」，这里按与其他节次相同的
    // 「45 分钟上课 + 10 分钟课间」规则推出，保证 9-11 连堂的下课时间有明确值。
    const WINTER_TIME_SLOTS = [
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
    ];

    const SUMMER_TIME_SLOTS = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:00', endTime: '10:45' },
        { number: 4, startTime: '10:55', endTime: '11:40' },
        { number: 5, startTime: '14:30', endTime: '15:15' },
        { number: 6, startTime: '15:25', endTime: '16:10' },
        { number: 7, startTime: '16:30', endTime: '17:15' },
        { number: 8, startTime: '17:25', endTime: '18:10' },
        { number: 9, startTime: '19:30', endTime: '20:15' },
        { number: 10, startTime: '20:25', endTime: '21:10' },
        { number: 11, startTime: '21:20', endTime: '22:05' }
    ];

    // 学校按日历切换冬/夏作息：5 月 6 日转夏季（2026 年官方表约定）、10 月 1 日转冬季。
    const DEFAULT_SEASON_SWITCH = { summerStart: '05-06', winterStart: '10-01' };

    // 官方编号到第十节；第 11 节是教务系统网格里的最后一节，按实际数据保留。
    const MAX_SECTION = WINTER_TIME_SLOTS.length;

    const COURSE_CONFIG = {
        semesterTotalWeeks: 20, // 数据里出现更大周次时自动上调
        firstDayOfWeek: 1,      // 周一为一周第一天
        defaultClassDuration: 45,
        defaultBreakDuration: 10
    };

    const inBridge = () => typeof window.shiguangBridgePromise !== 'undefined';
    const toast = (msg) => {
        if (inBridge() && window.shiguangBridge) window.shiguangBridge.showToast(msg);
        else console.log('[HNUST_PG] ' + msg);
    };

    // ==========================================
    // 1. 地址与会话
    // ==========================================

    /** 取应用基路径，保留 (S(...)) 会话段，例如 /gmis/(S(xxx))/ */
    function getAppBase() {
        const m = location.pathname.match(/^(\/gmis\/(?:\(S\([^)]*\)\)\/)?)/i);
        return m ? m[1] : '/gmis/';
    }

    /** 拼出带会话的应用内地址 */
    function gmisUrl(relativePath) {
        return getAppBase() + String(relativePath).replace(/^\//, '');
    }

    /** 统一走 jQuery.ajax（GMIS 已为其打上 AES 解密补丁） */
    function gmisAjax(options) {
        if (typeof window.$ === 'undefined' || !window.$.ajax) {
            return Promise.reject(new Error('未检测到 jQuery 环境，请在教务系统页面内执行导入。'));
        }
        return new Promise((resolve, reject) => {
            window.$.ajax({
                type: options.type || 'GET',
                url: options.url,
                data: options.data,
                dataType: 'json',
                cache: false,
                success: (data) => resolve(data),
                error: (xhr, status, error) => {
                    const code = xhr && xhr.status;
                    reject(new Error('请求失败(' + options.url + ')：HTTP ' + code + ' ' + error +
                        (code === 302 || code === 401 || code === 403 ? '（登录可能已失效，请重新登录）' : '')));
                }
            });
        });
    }

    // ==========================================
    // 2. 解析工具
    // ==========================================

    /** 由行标签取标准节次："上午1" → 1；"无节次" → null */
    function sectionFromLabel(label) {
        const m = String(label == null ? '' : label).match(/(\d+)/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return isNaN(n) ? null : n;
    }

    /** 去掉残留方括号并压缩空白 */
    function cleanField(s) {
        return String(s == null ? '' : s)
            .replace(/[\[\]]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** 解析 "13-16周" / "1-18" / "单周1-11" / "1,3,5" / "2-16双周" 之类 */
    function parseWeeks(weekStr) {
        const out = [];
        if (!weekStr) return out;
        const isOdd = weekStr.indexOf('单') >= 0;
        const isEven = weekStr.indexOf('双') >= 0;
        const matches = String(weekStr).match(/\d+\s*-\s*\d+|\d+/g);
        if (!matches) return out;
        matches.forEach((m) => {
            if (m.indexOf('-') >= 0) {
                const p = m.split('-').map((x) => parseInt(x.trim(), 10));
                for (let i = p[0]; i <= p[1]; i++) {
                    if (isOdd && i % 2 === 0) continue;
                    if (isEven && i % 2 !== 0) continue;
                    out.push(i);
                }
            } else {
                const w = parseInt(m, 10);
                if (isNaN(w)) return;
                if (isOdd && w % 2 === 0) return;
                if (isEven && w % 2 !== 0) return;
                out.push(w);
            }
        });
        return [...new Set(out)].sort((a, b) => a - b);
    }

    /**
     * 解析单条课程文本：课程名[周次]教师[地点]
     * 地点可缺省。返回 {name, teacher, position, weeks} 或 null
     */
    function parseCellText(text) {
        const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        if (!t) return null;

        const m = t.match(/^(.*?)\[(.*?)\]\s*(.*?)(?:\s*\[(.*?)\])?\s*$/);
        if (!m) return null;

        const name = cleanField(m[1]);
        const weeks = parseWeeks(cleanField(m[2]));
        if (!name || !weeks.length) return null;

        return {
            name: name,
            teacher: cleanField(m[3]) || '未知',
            position: cleanField(m[4]) || '待定',
            weeks: weeks
        };
    }

    /** 把一个单元格按 <br/> 拆成多条课程 */
    function parseCellEntries(rawCell) {
        return String(rawCell == null ? '' : rawCell)
            .split(/<br\s*\/?>|\r?\n/i)
            .map((part) => parseCellText(part.replace(/<[^>]*>/g, ' ')))
            .filter((e) => e !== null);
    }

    /**
     * 二次合并：把「同一天、同课、同教师、同地点、同周次、节次首尾相接」的相邻条目接回去。
     *
     * 为什么需要：课表接口的合并粒度是「相邻行同列文本完全相同」。若某列中途课程集合发生变化
     * （例如星期四 下午5-6 有 {学术论文写作, 云计算, 综合英语}，下午7-8 只剩 {学术论文写作, 云计算}），
     * 一门实际横跨 5~8 节的课会被拆成 5~6 与 7~8 两条。接回去后与系统「选课结果查询」
     * 声明的 `星期四 下午5-下午8` 一致。
     */
    function mergeAdjacentCourses(courses) {
        const sorted = courses.slice().sort((a, b) => (a.day - b.day) || (a.startSection - b.startSection));
        const out = [];
        const open = Object.create(null); // 标识 → 该课已输出的条目（同一格会有多门课交错，不能只比"上一条"）

        sorted.forEach((c) => {
            const key = [c.day, c.name, c.teacher, c.position, JSON.stringify(c.weeks)].join('|');
            const prev = open[key];

            if (prev && prev.endSection + 1 === c.startSection) {
                prev.endSection = c.endSection;
                return;
            }

            const entry = {
                name: c.name,
                teacher: c.teacher,
                position: c.position,
                day: c.day,
                startSection: c.startSection,
                endSection: c.endSection,
                weeks: c.weeks.slice()
            };
            out.push(entry);
            open[key] = entry;
        });

        return out.sort((a, b) => (a.day - b.day) || (a.startSection - b.startSection));
    }

    /**
     * 核心解析：rows → 课程数组
     * 先按「相邻行同一列原始文本相同」合并出连堂，再做二次合并。
     */
    function parseCoursesFromRows(rows) {
        const courses = [];
        const openByDay = {}; // day → { raw, startSection, endSection, entries }

        const flush = (day) => {
            const blk = openByDay[day];
            if (!blk) return;
            blk.entries.forEach((e) => {
                courses.push({
                    name: e.name,
                    teacher: e.teacher,
                    position: e.position,
                    day: day,
                    startSection: blk.startSection,
                    endSection: blk.endSection,
                    weeks: e.weeks
                });
            });
            delete openByDay[day];
        };

        (rows || []).forEach((row) => {
            const section = sectionFromLabel(row && row.mc);
            for (let day = 1; day <= 7; day++) {
                const raw = String((row && row['z' + day]) == null ? '' : row['z' + day]).trim();

                // 行标签无节次（如"无节次"）：视为中断
                if (section === null) {
                    flush(day);
                    continue;
                }

                const open = openByDay[day];
                // 与上一行同列文本完全一致 → 连堂，延长结束节次
                if (open && raw !== '' && raw === open.raw) {
                    open.endSection = section;
                    continue;
                }

                flush(day);
                if (raw === '') continue;

                const entries = parseCellEntries(raw);
                if (entries.length) {
                    openByDay[day] = { raw: raw, startSection: section, endSection: section, entries: entries };
                }
            }
        });

        for (let day = 1; day <= 7; day++) flush(day);
        return clipToMaxSection(mergeAdjacentCourses(courses));
    }

    // 上一次解析中因超出节次上限（第 11 节）而被丢弃 / 截断的课程，供导入流程告警用
    let lastSectionWarnings = { dropped: [], clipped: [] };

    /**
     * 防呆：若课表出现超出第 11 节的数据（说明作息表需要更新），按以下方式处理：
     *  - 整条都落在上限之外 → 丢弃（记入 dropped）
     *  - 从上限内跨到上限外 → 截断到上限（记入 clipped）
     * 两种情况都会在导入结束时提示用户，避免静默丢课。
     */
    function clipToMaxSection(courses) {
        const dropped = [];
        const clipped = [];
        const out = [];

        courses.forEach((c) => {
            if (c.startSection > MAX_SECTION) {
                dropped.push(c.name + '（第' + c.startSection + '-' + c.endSection + '节）');
                return;
            }
            if (c.endSection > MAX_SECTION) {
                clipped.push(c.name + '（第' + c.startSection + '-' + c.endSection +
                    '节 → 截断为第' + c.startSection + '-' + MAX_SECTION + '节）');
                out.push({
                    name: c.name,
                    teacher: c.teacher,
                    position: c.position,
                    day: c.day,
                    startSection: c.startSection,
                    endSection: MAX_SECTION,
                    weeks: c.weeks.slice()
                });
                return;
            }
            out.push(c);
        });

        lastSectionWarnings = { dropped: dropped, clipped: clipped };
        return out;
    }

    /** 某年某月的第一个周一（YYYY-MM-DD） */
    function firstMondayOf(year, month) {
        const d = new Date(Date.UTC(year, month - 1, 1));
        const add = (1 - d.getUTCDay() + 7) % 7; // getUTCDay: 周日=0 … 周六=6
        d.setUTCDate(d.getUTCDate() + add);
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return d.getUTCFullYear() + '-' + mm + '-' + dd;
    }

    /**
     * 由学期名猜开学日期（第 1 周周一），仅作为输入框默认值。
     * 经验规律：第一学期≈9 月第一个周一，第二学期≈3 月第一个周一。
     * 已知：2026-2027第一学期 → 2026-09-07（与教务系统实际第 1 周一致）。
     */
    function guessSemesterStartDate(termName) {
        const m = String(termName == null ? '' : termName).match(/(\d{4})\s*[-–~]\s*(\d{4})\s*.*?第?\s*([一二1-2])\s*学期/);
        if (!m) return '';
        return (m[3] === '二' || m[3] === '2')
            ? firstMondayOf(parseInt(m[2], 10), 3)
            : firstMondayOf(parseInt(m[1], 10), 9);
    }

    function validateDateInput(input) {
        if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(String(input).trim())) return false;
        return '请输入正确的日期格式，例如: 2026-09-01';
    }

    // ==========================================
    // 3. 流程步骤
    // ==========================================

    async function promptUserToStart() {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            '重要通知',
            '导入前请确认已成功登录研究生管理信息系统，并选定正确的学期。\n\n导入过程只读取课表数据，不会修改任何教务信息。',
            '好的，开始'
        );
        return confirmed === true;
    }

    /** 取学期列表并让用户选择，返回 {termcode, termname} */
    async function getTerm() {
        const data = await gmisAjax({ type: 'GET', url: gmisUrl(API_PATH.TERMS) });
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('未能获取到学期列表，请确认已登录后再试。');
        }

        const labels = [];
        const values = [];
        let defaultIndex = 0;

        data.forEach((item, index) => {
            labels.push(item.termname || String(item.termcode));
            values.push(item.termcode);
            if (item.selected === true || item.selected === 'true') defaultIndex = index;
        });

        const picked = await window.shiguangBridgePromise.showSingleSelection(
            '选择导入学期',
            JSON.stringify(labels),
            defaultIndex
        );
        if (picked === null || picked < 0) return null;

        return { termcode: values[picked], termname: labels[picked] };
    }

    /** 拉取二维课表原始行 */
    async function fetchTimetableRows(termcode) {
        const data = await gmisAjax({
            type: 'POST',
            url: gmisUrl(API_PATH.TIMETABLE),
            data: { kblx: 'xs', termcode: termcode }
        });

        const rows = Array.isArray(data) ? data : (data && data.rows);
        if (!Array.isArray(rows)) {
            throw new Error('课表接口返回格式异常，请把控制台报错反馈给适配作者。');
        }
        if (rows.length === 0) {
            throw new Error('该学期没有查询到课表数据。');
        }
        return rows;
    }

    // ==========================================
    // 4. 数据保存
    // ==========================================

    async function saveCourses(courses) {
        if (!courses.length) {
            throw new Error('未能解析出任何课程，请检查该学期是否已排课。');
        }
        if (!inBridge()) {
            console.log('[HNUST_PG] 测试模式，解析到 ' + courses.length + ' 条课程：');
            console.table(courses);
            return;
        }
        const ok = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (ok !== true) throw new Error('课程保存失败，请查看日志。');
    }

    // ==========================================
    // 4. 作息：按日期切换（组合作息）
    // ==========================================

    const DAY_MS = 86400000;

    function parseYmd(s) {
        const m = String(s == null ? '' : s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!m) return null;
        return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    function toYmd(ms) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    /** 某一天用夏季还是冬季作息（switchCfg 为 {summerStart:'MM-DD', winterStart:'MM-DD'}） */
    function seasonOf(dateStr, switchCfg) {
        const sw = switchCfg || DEFAULT_SEASON_SWITCH;
        const md = String(dateStr).slice(5); // 'MM-DD'
        if (sw.summerStart < sw.winterStart) {
            return (md >= sw.summerStart && md < sw.winterStart) ? 'summer' : 'winter';
        }
        // 跨年配置：[summerStart, 12-31] ∪ [01-01, winterStart)
        return (md >= sw.summerStart || md < sw.winterStart) ? 'summer' : 'winter';
    }

    // 基础时间段（骨架）固定提交冬季 10 节。
    // 按 wiki 1.4 的差量合并规则：模板只需提交与骨架不同的节次，其余由骨架补齐。
    // 上午 1-4 两套作息完全相同，所以夏季模板只需覆盖第 5-10 节，冬季模板可以留空。
    const COMBO_SKELETON = WINTER_TIME_SLOTS;
    const SUMMER_DIFF_SLOTS = SUMMER_TIME_SLOTS.filter((s) => s.number >= 5);
    const cloneSlots = (list) => list.map((s) => ({
        number: s.number, startTime: s.startTime, endTime: s.endTime
    }));

    /**
     * 把学期切成若干连续日期段，每段绑定夏季或冬季作息，生成"组合作息方案"。
     * 段与段之间连续、不重叠，完整覆盖 [第1周周一, 第N周周日]。
     */
    function buildComboSchedule(startDate, totalWeeks, switchCfg) {
        const sw = switchCfg || DEFAULT_SEASON_SWITCH;
        const startMs = parseYmd(startDate);
        if (startMs === null) throw new Error('开学日期格式不正确：' + startDate);

        const weeks = Math.max(1, parseInt(totalWeeks, 10) || COURSE_CONFIG.semesterTotalWeeks);
        const endMs = startMs + (weeks * 7 - 1) * DAY_MS;

        // 学期内的所有切换点（每年 5/6 与 10/1）
        const edges = [];
        const yearFrom = new Date(startMs).getUTCFullYear();
        const yearTo = new Date(endMs).getUTCFullYear();
        for (let y = yearFrom - 1; y <= yearTo + 1; y++) {
            [sw.summerStart, sw.winterStart].forEach((md) => {
                const ms = parseYmd(y + '-' + md);
                if (ms !== null && ms > startMs && ms <= endMs) edges.push(ms);
            });
        }
        edges.sort((a, b) => a - b);

        const rules = [];
        let cursor = startMs;
        for (let i = 0; i <= edges.length; i++) {
            const segStart = cursor;
            const segEnd = i < edges.length ? edges[i] - DAY_MS : endMs;
            if (segEnd < segStart) continue;

            const season = seasonOf(toYmd(segStart), sw);
            rules.push({
                name: season === 'summer' ? '夏季作息' : '冬季作息',
                startDate: toYmd(segStart),
                endDate: toYmd(segEnd),
                defaultClassDuration: COURSE_CONFIG.defaultClassDuration,
                defaultBreakDuration: COURSE_CONFIG.defaultBreakDuration,
                // 差量：与冬季骨架相同的部分不重复提交
                timeSlots: season === 'summer' ? cloneSlots(SUMMER_DIFF_SLOTS) : []
            });

            cursor = segEnd + DAY_MS;
        }

        return {
            name: '湖南科技大学研究生作息',
            publicSchedules: rules
        };
    }

    // 作息切换规则是学校制度性的（5 月 6 日转夏、10 月 1 日转冬），不让用户选。
    // 整个导入流程只保留一个输入框（开学日期）——App 的 PromptHost 用无 key 的
    // rememberSaveable 保存输入内容，连续弹两个输入框会把上一个的内容带进来。

    /** 当前 App 是否支持组合作息（v2.1.0 起才提供） */
    const supportsComboSchedule = () =>
        inBridge() && typeof window.shiguangBridgePromise.saveComboSchedule === 'function';

    /** 导入组合作息方案 */
    async function saveComboSchedule(combo) {
        if (!inBridge()) {
            console.log('[HNUST_PG] 测试模式，组合作息：', combo);
            return;
        }
        const ok = await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(combo));
        if (ok !== true) throw new Error('组合作息导入失败，请查看日志。');
    }

    /** 导入时间段 */
    async function saveTimeSlots(slots) {
        if (!inBridge()) {
            console.log('[HNUST_PG] 测试模式，作息时间：', slots);
            return;
        }
        const ok = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        if (ok !== true) throw new Error('时间段导入失败，请查看日志。');
    }

    /** 询问开学日期与总周数，返回 { startDate, totalWeeks } */
    async function askConfig(courses, termname) {
        let startDate = guessSemesterStartDate(termname);
        if (inBridge()) {
            const input = await window.shiguangBridgePromise.showPrompt(
                '输入开学日期',
                '请输入本学期第 1 周的周一日期（格式 YYYY-MM-DD），用于把周次换算成日期：',
                startDate,
                'validateDateInput'
            );
            if (input === null) throw new Error('导入已取消：未填写开学日期。');
            startDate = String(input).trim().replace(/[/.]/g, '-');
        }

        let totalWeeks = COURSE_CONFIG.semesterTotalWeeks;
        courses.forEach((c) => c.weeks.forEach((w) => { if (w > totalWeeks) totalWeeks = w; }));

        return { startDate: startDate || null, totalWeeks: totalWeeks };
    }

    /** 保存课表配置 */
    async function saveConfig(cfg) {
        const configData = {
            semesterStartDate: cfg.startDate || null,
            semesterTotalWeeks: cfg.totalWeeks,
            defaultClassDuration: COURSE_CONFIG.defaultClassDuration,
            defaultBreakDuration: COURSE_CONFIG.defaultBreakDuration,
            firstDayOfWeek: COURSE_CONFIG.firstDayOfWeek
        };

        if (!inBridge()) {
            console.log('[HNUST_PG] 测试模式，课表配置：', configData);
            return;
        }
        const ok = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        if (ok !== true) throw new Error('课表配置保存失败，请查看日志。');
    }

    // ==========================================
    // 5. 流程编排
    // ==========================================

    async function runImportFlow() {
        try {
            if (getAppBase().indexOf('(S(') < 0) {
                console.warn('[HNUST_PG] 当前地址不含 (S(...)) 会话段，可能已丢失登录态。');
            }

            toast('正在获取课表数据，请稍候...');

            if (inBridge()) {
                const go = await promptUserToStart();
                if (!go) return;
            }

            const term = await getTerm();
            if (term === null) {
                toast('已取消导入。');
                return;
            }

            const rows = await fetchTimetableRows(term.termcode);
            const courses = parseCoursesFromRows(rows);

            // 全流程唯一的输入框：开学日期（默认值按所选学期推算，可改）
            const cfg = await askConfig(courses, term.termname);

            // 组合作息：按 5/6、10/1 切成连续日期段（规则固定，不让用户选）
            const useCombo = supportsComboSchedule() && !!cfg.startDate;
            const combo = useCombo
                ? buildComboSchedule(cfg.startDate, cfg.totalWeeks, DEFAULT_SEASON_SWITCH)
                : null;

            // 基础时间段（骨架）固定用冬季 10 节，模板按差量覆盖
            const baseSlots = cloneSlots(COMBO_SKELETON);

            // 顺序按 wiki v2「适配脚本开发流程建议」：
            // 配置 → 课程 → 预设时间段 → 组合作息。
            // App 侧有强校验：saveComboSchedule 必须在 savePresetTimeSlots 成功之后。
            await saveConfig(cfg);
            await saveCourses(courses);
            await saveTimeSlots(baseSlots);
            if (useCombo) await saveComboSchedule(combo);

            if (inBridge()) {
                let msg = '成功导入 ' + courses.length + ' 条课程！';
                if (useCombo) {
                    msg += '作息已按日期切换（' + combo.publicSchedules.length + ' 段）。';
                } else if (!supportsComboSchedule()) {
                    msg += '当前 App 版本不支持按日期切换作息，已按开学日期使用单一作息。';
                } else {
                    msg += '未填写开学日期，已跳过作息切换。';
                }
                if (lastSectionWarnings.dropped.length || lastSectionWarnings.clipped.length) {
                    msg += ' 另有 ' + lastSectionWarnings.dropped.length + ' 条超出 ' + MAX_SECTION +
                        ' 节被丢弃、' + lastSectionWarnings.clipped.length + ' 条被截断。';
                    console.warn('[HNUST_PG] 超出 ' + MAX_SECTION + ' 节的课程：', lastSectionWarnings);
                }
                toast(msg);
                window.shiguangBridge.notifyTaskCompletion();
            } else {
                alert('解析成功！共 ' + courses.length + ' 条课程' +
                    (combo ? '，作息分 ' + combo.publicSchedules.length + ' 段' : '') +
                    '，详情见控制台。');
            }
        } catch (error) {
            const message = (error && error.message) || '导入流程执行失败。';
            console.error('[HNUST_PG] runImportFlow error:', error);
            if (inBridge()) {
                // 失败时不发 notifyTaskCompletion，让用户能看到提示
                toast(message);
            } else {
                alert(message);
            }
        }
    }

    // App 的 showPrompt 需要按名字解析校验函数，所以这些必须挂到全局
    // （App dev 分支的 wrapAdapterScript 会用 eval 把全局函数回挂一次）
    window.validateDateInput = validateDateInput;

    runImportFlow();
})();
