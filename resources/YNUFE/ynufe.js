// 云南财经大学(xjwis.ynufe.edu.cn) 拾光课程表适配脚本

// 整体包一层 IIFE：App 每次点「执行导入」都会在同一页面重新 evaluate 本文件而不刷新，
// 顶层直接写 const 会与上一次执行冲突（Identifier '...' has already been declared）
(function () {
    const URL_SEMESTER = "/jsxsd/jxzl/jxzl_query";   // 教学周历：学期列表 / 开学日期 / 最大周次
    const URL_COURSE = "/jsxsd/xskb/xskb_list.do";   // 课表查询

    const clean = (s = "") => s.replace(/[\s\u00a0]+/g, " ").trim();
    const parseDoc = html => new DOMParser().parseFromString(html, "text/html");

    // ========== 解析 ==========

    /** 周次："1-16(周)[01-02节]" / "1-6,7-13周(单)" → [1..16]；单双周按整串判断 */
    function parseWeeks(text = "") {
        const weeks = new Set();
        const fallback = /单/.test(text) ? 1 : /双/.test(text) ? 0 : -1;   // -1 = 不区分单双
        for (const seg of text.split("[")[0].match(/\d+(?:\s*-\s*\d+)?[^,\d]*/g) || []) {
            const [start, end = start] = (seg.match(/\d+/g) || []).map(Number);
            if (!start) continue;
            const parity = /单/.test(seg) ? 1 : /双/.test(seg) ? 0 : fallback;
            for (let w = start; w <= end; w++) if (parity < 0 || w % 2 === parity) weeks.add(w);
        }
        return [...weeks].sort((a, b) => a - b);
    }

    /** 节次："...[06-07节]" → { startSection: 6, endSection: 7 } */
    function parseSections(text = "") {
        const nums = ((text.match(/\[([^\]]*)\]/) || [])[1] || "").match(/\d+/g)?.map(Number);
        return nums ? { startSection: Math.min(...nums), endSection: Math.max(...nums) } : null;
    }

    /** 单个课程块；字段不全返回 null */
    function parseBlock(html, day) {
        const box = document.createElement("div");
        box.innerHTML = html;
        // 强智把节次/周次提示藏在 display:none 的 font 里，先剔除再取文本
        const hidden = box.querySelectorAll('[style*="display:none"],[style*="display: none"]');
        hidden.forEach(node => node.remove());
        const text = selector => clean(box.querySelector(selector)?.textContent);

        // 课程名 = 首个非空文本行（去掉调课标记 span）
        const lines = html.split(/<br\s*\/?>/i);
        const name = lines.map(line => clean(line.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "").replace(/<[^>]*>/g, ""))).find(Boolean);
        const weekText = text('font[title="周次(节次)"]');
        const sections = parseSections(weekText);
        const weeks = parseWeeks(weekText);
        if (!name || !sections || weeks.length === 0) return null;

        // 少数页面没有 title="教室"，教室名和隐藏的节次提示挤在同一行
        const room = hidden.length === 0 ? "" : lines
            .filter(line => /display:\s*none/.test(line))
            .map(line => clean(line.replace(/<font[^>]*display:\s*none[^>]*>[\s\S]*?<\/font>/gi, "").replace(/<[^>]*>/g, "")))
            .find(item => item && item !== name);

        return {
            name,
            teacher: text('font[title="老师"],font[title="教师"]').replace(/^任课教师[:：]/, "") || "未知教师",
            position: text('font[title="教室"]').replace(/^[\d\-\s]+/, "") || room || "未知地点",
            day,
            startSection: sections.startSection,
            endSection: sections.endSection,
            weeks
        };
    }

    /** 同课、同师、同地、同星期、同节次 → 合并周次 */
    function mergeCourses(list) {
        const map = new Map();
        for (const course of list) {
            const key = [course.name, course.teacher, course.position, course.day, course.startSection, course.endSection].join("|");
            const exist = map.get(key);
            if (exist) exist.weeks = [...new Set([...exist.weeks, ...course.weeks])].sort((a, b) => a - b);
            else map.set(key, course);
        }
        return [...map.values()];
    }

    /** 课表 HTML → 课程数组；td[0] 是周一，div.kbcontent 的 name 属性（hash-星期-序）优先校正星期 */
    function parseTimetable(doc) {
        const table = doc.getElementById("kbtable");
        if (!table) return [];
        const courses = [];
        for (const row of table.querySelectorAll("tr")) {
            [...row.querySelectorAll("td")].forEach((cell, index) =>
                [...cell.querySelectorAll("div.kbcontent")].forEach(div => {
                    const fromName = Number((div.getAttribute("name") || "").split("-")[1]);
                    const day = fromName >= 1 && fromName <= 7 ? fromName : index + 1;
                    // 一格多门课，用 ----- 分隔
                    div.innerHTML.split(/-{5,}/).forEach(block => courses.push(parseBlock(block, day)));
                }));
        }
        return mergeCourses(courses.filter(Boolean));
    }

    // ========== 网络 ==========

    /** 同源请求：有 body 走 POST，否则 GET，统一返回 HTML 文本 */
    const request = (url, body) => fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "include"
    }).then(response => response.text());

    /** 学期列表；只保留最近 5 个学年 */
    async function fetchSemesterList() {
        const html = await request(URL_COURSE);
        const all = [...parseDoc(html).querySelectorAll("#xnxq01id option")].map(opt => ({
            value: opt.value, label: clean(opt.textContent), current: opt.hasAttribute("selected") || opt.selected
        }));
        if (all.length === 0) return { list: [], defaultIndex: -1, html };
        const startYear = opt => Number(String(opt.value).slice(0, 4));
        const years = all.map(startYear).filter(year => year > 2000);
        const list = (years.length ? all.filter(opt => startYear(opt) >= Math.max(...years) - 4) : all)
            .map(opt => ({ ...opt, label: opt.current ? `${opt.label}（当前学期）` : opt.label }));
        return { list, defaultIndex: Math.max(0, list.findIndex(opt => opt.current)), html };
    }

    /** 开学日期 + 最大周次 */
    async function fetchSemesterInfo(semesterId) {
        const doc = parseDoc(await request(URL_SEMESTER, `xnxq01id=${semesterId}`));
        const rows = [...doc.querySelectorAll("#kbtable tr")].filter(row => row.querySelector("td"));
        const match = (rows[0]?.querySelector("td[title]")?.title || "").match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
        const totalWeeks = rows.reduce((max, row) => Math.max(max, parseInt(row.querySelector("td")?.textContent, 10) || 0), 0) || null;
        return {
            startDate: match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null,
            totalWeeks
        };
    }

    /** 按“时间模式”（作息/校区）取下拉框 value */
    function getTimeModeValue(html, matcher) {
        const option = [...parseDoc(html).querySelectorAll("#kbjcmsid option")].find(opt => matcher(clean(opt.textContent)));
        return option ? option.value : "";
    }

    /** 课表页面；mode 未指定时用“全部”模式 */
    async function fetchSchedule(semesterId, pageHtml, mode) {
        const params = { jx0404id: "", cj0701id: "", zc: "", demo: "", xnxq01id: semesterId };
        params.kbjcmsid = mode === undefined ? getTimeModeValue(pageHtml, text => text === "全部") : mode;
        return await request(URL_COURSE, new URLSearchParams(params).toString());
    }

    // ========== 作息 ==========

    // 只写早/中/晚的参数，节次时间由 buildTimeSlots 推出（参考 resources/ZHKU）
    // start/end：该段首节上课与末节下课；count：节数；longBreak/longBreakAfter：第几节后放大课间（0 = 无）
    // empty：教务系统里有节次编号但不排课的时段（如晚饭），只占位，时间仅供参考
    const CLASS_MINUTES = 40;
    const SHORT_BREAK_MINUTES = 10;
    const TIME_CONFIG = {
        longquan: {
            morning:   { start: "08:00", end: "12:20", count: 5, longBreak: 30, longBreakAfter: 2 },
            afternoon: { start: "14:30", end: "18:00", count: 4, longBreak: 30, longBreakAfter: 2 },
            evening:   { start: "19:00", end: "22:20", count: 4, longBreak: 20, longBreakAfter: 2 },
            empty: [{ number: 10, start: "18:10", end: "18:30" }]   // 第 10 节：晚饭时间
        },
        anning: {
            morning:   { start: "08:20", end: "12:30", count: 5, longBreak: 20, longBreakAfter: 2 },
            afternoon: { start: "14:00", end: "18:10", count: 5, longBreak: 20, longBreakAfter: 3 },
            evening:   { start: "19:00", end: "21:20", count: 3, longBreak: 0, longBreakAfter: 0 }
        }
    };

    const toMinutes = hhmm => hhmm.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    const toClock = minutes => [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, "0")).join(":");

    /** 生成节次表；withSegment 时附带早/中/晚标记（跨大节判定用） */
    function buildTimeSlots(campus, withSegment = false) {
        const config = TIME_CONFIG[campus];
        const slots = [];
        for (const segment of ["morning", "afternoon", "evening"]) {
            const rule = config[segment];
            let cursor = toMinutes(rule.start);
            for (let i = 1; i <= rule.count; i++) {
                const end = cursor + CLASS_MINUTES;
                slots.push({ startTime: toClock(cursor), endTime: toClock(end), segment });
                cursor = end + (i < rule.count ? (rule.longBreakAfter === i ? rule.longBreak : SHORT_BREAK_MINUTES) : 0);
            }
        }
        // 空节按声明位置插入，保证节次编号与教务系统一致（后面的节次顺延）
        for (const slot of config.empty ?? []) slots.splice(slot.number - 1, 0, { startTime: slot.start, endTime: slot.end, segment: "empty" });
        return slots.map((slot, index) => {
            const item = { number: index + 1, startTime: slot.startTime, endTime: slot.endTime };
            return withSegment ? { ...item, segment: slot.segment } : item;
        });
    }

    /**
     * 跨大节连堂课：大课间其实不休息，仍按「40 分钟 + 10 分钟课间」连着上，所以下课早于公共时间段。
     * 只处理同一早/中/晚时段内的连堂，跨午休/晚饭（含空节）的保持公共时间段。
     */
    function applyCrossBlockTimes(courses, campus) {
        const slots = buildTimeSlots(campus, true);
        for (const course of courses) {
            const span = slots.slice(course.startSection - 1, course.endSection);
            if (!span.length || span[0].segment === "empty") continue;
            if (!span.every(slot => slot.segment === span[0].segment)) continue;

            const customEnd = toClock(toMinutes(span[0].startTime) + span.length * CLASS_MINUTES + (span.length - 1) * SHORT_BREAK_MINUTES);
            if (customEnd !== span[span.length - 1].endTime) {
                Object.assign(course, { isCustomTime: true, customStartTime: span[0].startTime, customEndTime: customEnd });
            }
        }
        return courses;
    }

    // ========== 主流程 ==========

    async function runImportFlow() {
        if (!window.shiguangBridge || !window.shiguangBridgePromise) return false;
        const bridge = window.shiguangBridge;
        const fail = message => {
            bridge.showToast(message);
            return false;
        };

        if (window.location.href.includes("login") || document.querySelector('input[type="password"]')) return fail("请先登录教务系统！");

        try {
            bridge.showToast("正在获取学期列表...");
            const { list, defaultIndex, html } = await fetchSemesterList();
            if (list.length === 0) return fail("未获取到学期列表，请检查登录状态。");

            const selected = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期", JSON.stringify(list.map(item => item.label)), defaultIndex
            );
            if (selected === null || selected === -1 || !list[selected]) return fail("已取消导入");

            const semesterId = list[selected].value;
            const { startDate, totalWeeks } = await fetchSemesterInfo(semesterId);
            const page = await fetchSchedule(semesterId, html);

            // 课表页同时带两校区作息模式，安宁模式有课说明该学期在安宁校区
            const anningMode = getTimeModeValue(page, text => text.includes("安宁校区"));
            const onAnning = Boolean(anningMode)
                && parseTimetable(parseDoc(await fetchSchedule(semesterId, page, anningMode))).length > 0;
            const campusKey = onAnning ? "anning" : "longquan";

            const courses = applyCrossBlockTimes(parseTimetable(parseDoc(page)), campusKey);
            if (courses.length === 0) return fail("所选学期课表为空，请检查学期或登录状态。");

            // 学期配置：总周数 + 开学日期（取不到开学日期就不写，避免覆盖已有值）
            const config = { semesterTotalWeeks: totalWeeks || 20, firstDayOfWeek: 1, defaultClassDuration: CLASS_MINUTES };
            if (startDate) config.semesterStartDate = startDate;
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(buildTimeSlots(campusKey)));
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

            bridge.showToast(`成功导入 ${courses.length} 门课程！（${onAnning ? "安宁校区" : "龙泉校区"}）`);
            return true;
        } catch (error) {
            return fail("导入失败: " + error.message);
        }
    }

    runImportFlow()
        .then(ok => ok && window.shiguangBridge.notifyTaskCompletion())
        .catch(error => window.shiguangBridge.showToast("导入失败: " + error.message));
})();
