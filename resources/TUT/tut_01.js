// 天津理工大学统一身份认证（ehall 门户），CAS 登录后请切换到电脑版再执行导入，导入后请在 App 中设置本学期开学日期，如果未显示课表 请手动设置周数即可解决。适配全过程采用Vibecoding，如有错误请提交issue
// 天津理工大学(tjut.edu.cn)拾光课程表适配脚本
// 数据来源：ehall 门户「课表」卡片（优先走卡片接口，失败回退桌面版 DOM）
// 说明：教务课表不提供授课教师，teacher 字段留空；导入后请在设置里确认开学日期。

// 预设节次时间（天津理工大学官方作息，第 1-11 节，每节 45 分钟）
(function () {
    'use strict';

    const TUT_TIME_SLOTS = [
        { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
        { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
        { "number": 3,  "startTime": "10:10", "endTime": "10:55" },
        { "number": 4,  "startTime": "11:05", "endTime": "11:50" },
        { "number": 5,  "startTime": "14:00", "endTime": "14:45" },
        { "number": 6,  "startTime": "14:55", "endTime": "15:40" },
        { "number": 7,  "startTime": "16:10", "endTime": "16:55" },
        { "number": 8,  "startTime": "17:05", "endTime": "17:50" },
        { "number": 9,  "startTime": "18:30", "endTime": "19:15" },
        { "number": 10, "startTime": "19:25", "endTime": "20:10" },
        { "number": 11, "startTime": "20:20", "endTime": "21:05" }
    ];

    const WEEKDAY_MAP = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };
    const CARD_ID = "CUS_CARD_CLASSTABLE";
    const WAIT_TIMEOUT_MS = 25000;
    const WAIT_INTERVAL_MS = 500;

    function getErrorMessage(error) {
        if (!error) return "未知错误";
        if (typeof error === "string") return error;
        return error.message || String(error);
    }

    function toast(msg) {
        try { window.shiguangBridge.showToast(msg); } catch (e) {}
    }

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    /**
     * 解析周次字符串，支持 `1-16周`、`1-8,10-16周`、`3-17周(单)`、`3-3周,6-6周,12-13周`
     * @param {string} raw 周次原串
     * @returns {number[]}
     */
    function parseWeeks(raw) {
        const weeks = [];
        const seen = {};
        if (!raw) return weeks;
        const oddOnly = raw.indexOf("单") >= 0;
        const evenOnly = raw.indexOf("双") >= 0;
        const body = String(raw).replace(/[（(][^)）]*[)）]/g, "");
        body.split(/[,，]/).forEach(function (seg) {
            const m = seg.match(/(\d+)\s*(?:-\s*(\d+))?/);
            if (!m) return;
            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : start;
            if (isNaN(start) || isNaN(end)) return;
            const from = Math.min(start, end);
            const to = Math.min(Math.max(start, end), from + 60);
            for (let week = from; week <= to; week++) {
                if (oddOnly && !evenOnly && week % 2 === 0) continue;
                if (evenOnly && !oddOnly && week % 2 === 1) continue;
                if (!seen[week]) { seen[week] = true; weeks.push(week); }
            }
        });
        return weeks.sort(function (a, b) { return a - b; });
    }

    /** 一个时段：周次串 + 星期X + 第A节-第B节 + 地点 */
    const SEGMENT_PATTERN = /((?:[0-9]+\s*(?:-\s*[0-9]+)?\s*周\s*(?:[（(]\s*[单双]\s*[)）])?\s*,?\s*)+)\s*星期\s*([一二三四五六日天])\s*第\s*(\d+)\s*节\s*[-~～至]\s*第?\s*(\d+)\s*节\s*([^,，]*)/;

    /**
     * 把 eventDesc 解析成课程时段数组
     * @param {string} name 课程名
     * @param {string} desc 例如 `3-17周(单) 星期四 第1节-第2节 28-A405,...`
     * @param {string} fallbackPos 备用地点
     * @returns {Array<Object>}
     */
    function parseEventDesc(name, desc, fallbackPos) {
        const out = [];
        if (!name || !desc) return out;
        // 一个完整时段以「星期」收尾，逗号只是分隔，需按「星期」切段
        const pieces = String(desc).split(/[,，]/);
        const segments = [];
        let buffer = "";
        pieces.forEach(function (p) {
            const part = p.trim();
            if (!part) return;
            buffer = buffer ? buffer + "," + part : part;
            if (part.indexOf("星期") >= 0) { segments.push(buffer); buffer = ""; }
        });
        if (buffer) segments.push(buffer);

        segments.forEach(function (seg) {
            const m = seg.match(SEGMENT_PATTERN);
            if (!m) return;
            const weeks = parseWeeks(m[1]);
            if (!weeks.length) return;
            const day = WEEKDAY_MAP[m[2]] || 0;
            if (!day) return;
            const startSection = parseInt(m[3], 10);
            const endSection = parseInt(m[4], 10);
            if (!(startSection > 0) || !(endSection >= startSection)) return;
            out.push({
                name: name,
                teacher: "",
                position: String(m[5] || "").trim() || fallbackPos || "",
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        });
        return out;
    }

    /**
     * 找到挂着 shell.execCardMethod 的 window（可能在同源 iframe 里）
     * @returns {Window|null}
     */
    function findShellWindow() {
        if (window.shell && window.shell.execCardMethod) return window;
        let frames = [];
        try { frames = document.querySelectorAll("iframe"); } catch (e) { return null; }
        for (let i = 0; i < frames.length; i++) {
            let w = null;
            try { w = frames[i].contentWindow; } catch (e) { w = null; }
            if (w && w.shell && w.shell.execCardMethod) return w;
        }
        return null;
    }

    /**
     * 从 Vue 组件里找出课表卡片的 cardWid
     * @param {Window} w 挂着 shell 的 window
     * @returns {string|null}
     */
    function findCardWid(w) {
        let d = null;
        try { d = w.document; } catch (e) { return null; }
        if (!d) return null;
        const all = d.querySelectorAll("*");
        for (let i = 0; i < all.length; i++) {
            const vm = all[i].__vue__ || all[i].__vueParentComponent;
            if (!vm) continue;
            let cur = vm, depth = 0;
            while (cur && depth < 12) {
                const router = (cur.$props && cur.$props.router) || (cur.$data && cur.$data.router);
                if (router && router.cardWid && String(router.cardId || "").indexOf("CLASSTABLE") >= 0) {
                    return router.cardWid;
                }
                cur = cur.$parent;
                depth++;
            }
        }
        return null;
    }

    /**
     * 通过卡片接口拉取整学期课程
     * @returns {Promise<Array<Object>|null>} null 表示环境不支持
     */
    async function fetchCoursesViaApi() {
        const w = findShellWindow();
        if (!w) return null;
        const cardWid = findCardWid(w);
        if (!cardWid) return null;

        const now = new Date();
        const start = new Date(now.getTime() - 150 * 24 * 3600 * 1000);
        const end = new Date(now.getTime() + 150 * 24 * 3600 * 1000);
        const fmt = function (dt) {
            const p = function (n) { return (n < 10 ? "0" : "") + n; };
            return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
        };
        const selectDate = fmt(now);

        const param = {
            startTime: fmt(start) + " 00:00:00",
            endTime: fmt(end) + " 23:59:59",
            selectDate: selectDate,
            cardWidOrigin: cardWid
        };

        const resp = await new Promise(function (resolve, reject) {
            try {
                w.shell.execCardMethod({
                    cardId: CARD_ID,
                    cardWid: cardWid,
                    method: "renderData",
                    param: param
                }, function (t) { resolve(t); }, function (e) { reject(e); });
            } catch (e) { reject(e); }
        });

        if (!resp || String(resp.errcode) !== "0") return null;
        const datas = (resp.data && resp.data.datas) || {};

        // 同一个 event 会在多天重复出现，按 eventId 去重
        const seenEvent = {};
        const courses = [];
        Object.keys(datas).forEach(function (day) {
            const list = datas[day] || [];
            list.forEach(function (ev) {
                const id = ev.eventId || (ev.eventTitle + "|" + ev.eventDesc);
                if (seenEvent[id]) return;
                seenEvent[id] = true;
                const parsed = parseEventDesc(ev.eventTitle, ev.eventDesc, ev.location);
                parsed.forEach(function (c) { courses.push(c); });
            });
        });
        return courses;
    }

    /** 桌面版 DOM 回退：`.wdkb_remark` 卡片 */
    function collectCards(doc, depth, out) {
        if (!doc || depth > 6) return out;
        let cards = [];
        try { cards = doc.querySelectorAll(".wdkb_remark"); } catch (e) { cards = []; }
        for (let i = 0; i < cards.length; i++) if (out.indexOf(cards[i]) < 0) out.push(cards[i]);
        let frames = [];
        try { frames = doc.querySelectorAll("iframe"); } catch (e) { frames = []; }
        for (let i = 0; i < frames.length; i++) {
            let inner = null;
            try { inner = frames[i].contentDocument; } catch (e) { inner = null; }
            if (inner) collectCards(inner, depth + 1, out);
        }
        return out;
    }

    function pickText(el, sel) {
        try {
            const n = el.querySelector(sel);
            return n ? String(n.textContent || "").replace(/\s+/g, " ").trim() : "";
        } catch (e) { return ""; }
    }

    function fetchCoursesViaDom() {
        const cards = collectCards(document, 0, []);
        const courses = [];
        cards.forEach(function (card) {
            const name = pickText(card, ".wdkb_remarkname");
            const desc = pickText(card, ".wdkb_iconadd");
            const room = pickText(card, ".wdkb_icontime");
            parseEventDesc(name, desc, room).forEach(function (c) { courses.push(c); });
        });
        return courses;
    }

    function dedupeCourses(courses) {
        const seen = {};
        const result = [];
        courses.forEach(function (c) {
            const key = [c.name, c.position, c.day, c.startSection, c.endSection, c.weeks.join(",")].join("|");
            if (seen[key]) return;
            seen[key] = true;
            result.push(c);
        });
        return result;
    }

    function describePage() {
        let frames = 0, readable = 0, cards = 0;
        try {
            const fs = document.querySelectorAll("iframe");
            frames = fs.length;
            for (let i = 0; i < fs.length; i++) { try { if (fs[i].contentDocument) readable++; } catch (e) {} }
        } catch (e) {}
        try { cards = document.querySelectorAll(".wdkb_remark").length; } catch (e) {}
        const href = String(location.href || "").split("?")[0].slice(0, 80);
        return "当前页面：" + href + "，课表卡片 " + cards + " 个（iframe " + frames + "，可读 " + readable + "）";
    }

    async function saveTimeSlots() {
        try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TUT_TIME_SLOTS)); }
        catch (e) { console.error("JS: 作息导入失败", e); }
    }

    async function runImportFlow() {
        if (!window.shiguangBridge || !window.shiguangBridgePromise) {
            console.error("JS: 拾光桥接未注入，可能不在拾光课程表内置浏览器中运行");
            return;
        }

        try {
            const host = location.hostname || "";
            if (/authserver/i.test(host)) {
                toast("请先登录统一身份认证，登录完成后再点击导入。");
                return;
            }
            if (!/ehall\.tjut\.edu\.cn$/i.test(host)) {
                toast("当前不在天津理工大学 ehall 页面，请登录后停留在门户首页。");
                return;
            }

            toast("正在读取课表，请稍候...");

            let courses = null;
            try { courses = await fetchCoursesViaApi(); } catch (e) { console.error("JS: 接口取数失败", e); }

            if (!courses || !courses.length) {
                // 回退到桌面版 DOM，并给页面一点渲染时间
                const deadline = Date.now() + WAIT_TIMEOUT_MS;
                while (Date.now() < deadline) {
                    courses = dedupeCourses(fetchCoursesViaDom());
                    if (courses.length) break;
                    await sleep(WAIT_INTERVAL_MS);
                }
            }

            courses = dedupeCourses(courses || []);

            if (!courses.length) {
                toast("未找到课表数据。" + describePage());
                return;
            }

            await saveTimeSlots();
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

            toast("课程导入成功，共导入 " + courses.length + " 条课程记录！");
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            toast("导入失败：" + getErrorMessage(error));
            console.error("JS: Import Error:", error);
        }
    }

    runImportFlow();

})();
