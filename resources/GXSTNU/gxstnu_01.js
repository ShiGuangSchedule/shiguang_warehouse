// 广西科技师范学院(jw.gxstnu.edu.cn) 拾光课程表适配脚本
// 强智教务「新版界面」(assets_newL)，与旧版 #kbtable / div.kbcontent 结构不同：
//   - 学期理论课表：/jsxsd/xskb/xskb_list.do?viweType=0 → table.qz-weeklyTable，
//     每条课程安排是一个 li.courselists-item，文本形如
//     「老师:张三讲师（高校）;时间:1-8,10-13周[1-3节];地点:科教楼(西3-201-计算机基础实验室（12）)」，
//     周次与小节都在「时间」里，不依赖格子所在的大节行；星期由列推出（需处理 rowspan 合并格）。
//   - 学期周次范围：/jsxsd/xskb/jxzlzc_xnxq_ajax?xnxq01id=… → [{"qszc":1,"jszc":19}]
//   - 开学日期：/jsxsd/framework/mainV_index_loadkb.htmlx?zc=1&… 首页周课表表头「周一 09-07」
// 出现问题请提交 issue / PR 反馈。

// 整体包在 IIFE 里：App 直接把脚本 eval 进页面全局作用域，同一页面再次点「导入」时
// 顶层 const 会重复声明报错，也避免和教务页面自己的全局变量冲突
(function () {
    const GXSTNU_DEFAULT_BASE = "https://jw.gxstnu.edu.cn/jsxsd";

    // 课表左侧大节时间解析失败时的兜底作息：
    // 第一大节(1-2) 08:20~09:45 / 第二大节(3) 09:55~10:35 / 第三大节(4-5) 10:45~12:10
    // 第四大节(6-7) 14:30~15:55 / 第五大节(8-9) 16:10~17:35 / 第六大节(10-12) 19:30~21:40
    // 单节 40 分钟，大节内课间 5 分钟
    const GXSTNU_FALLBACK_TIME_SLOTS = [
        { number: 1, startTime: "08:20", endTime: "09:00" },
        { number: 2, startTime: "09:05", endTime: "09:45" },
        { number: 3, startTime: "09:55", endTime: "10:35" },
        { number: 4, startTime: "10:45", endTime: "11:25" },
        { number: 5, startTime: "11:30", endTime: "12:10" },
        { number: 6, startTime: "14:30", endTime: "15:10" },
        { number: 7, startTime: "15:15", endTime: "15:55" },
        { number: 8, startTime: "16:10", endTime: "16:50" },
        { number: 9, startTime: "16:55", endTime: "17:35" },
        { number: 10, startTime: "19:30", endTime: "20:10" },
        { number: 11, startTime: "20:15", endTime: "20:55" },
        { number: 12, startTime: "21:00", endTime: "21:40" }
    ];

    const GXSTNU_WEEKDAY = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

    // 教师字段带职称（如「张三讲师（高校）」「李四（校企）工程师」），只保留姓名；长的放前面，先匹配「副教授」再匹配「教授」
    const GXSTNU_TEACHER_TITLES = [
        "助理研究员", "高级工程师", "高级实验师", "助理实验师", "副研究员",
        "研究员", "实验师", "工程师", "副教授", "教授", "讲师", "助教", "其他", "其它"
    ];

    // ── 通用工具 ────────────────────────────────────────────────────

    function gxstnuToast(message) {
        const bridge = window.shiguangBridge || window.AndroidBridge;
        if (bridge && bridge.showToast) bridge.showToast(message);
    }

    function gxstnuText(node) {
        return node ? (node.textContent || "").replace(/\s+/g, " ").trim() : "";
    }

    function gxstnuParseHtml(html) {
        return new DOMParser().parseFromString(html, "text/html");
    }

    function gxstnuPad2(n) {
        return String(n).padStart(2, "0");
    }

    function gxstnuToMinutes(hhmm) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
        return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
    }

    function gxstnuFromMinutes(total) {
        return `${gxstnuPad2(Math.floor(total / 60))}:${gxstnuPad2(total % 60)}`;
    }

    // 教务部署在 /jsxsd 下；走 WebVPN 等反代时路径前缀可能变化，优先按当前页面推断，保证同源请求带上会话
    function gxstnuResolveBase() {
        try {
            if (/^https?:$/.test(location.protocol)) {
                const m = location.pathname.match(/^(.*?\/[^/]*jsxsd)(?:\/|$)/);
                if (m) return location.origin + m[1];
            }
        } catch (e) {
            // 忽略，走默认地址
        }
        return GXSTNU_DEFAULT_BASE;
    }

    async function gxstnuFetchText(url, init) {
        const response = await fetch(url, Object.assign({ credentials: "include" }, init || {}));
        if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
        return await response.text();
    }

    // ── 周次 / 节次解析 ──────────────────────────────────────────────

    // "1-8,10-13" "11" "1-15(单)" "2-16双" → 周次数组
    function gxstnuParseWeeks(text) {
        const weeks = new Set();
        String(text || "").replace(/\s+/g, "").split(/[,，、]/).forEach(seg => {
            const m = seg.match(/(\d+)(?:[-~～至](\d+))?/);
            if (!m) return;
            const a = Number(m[1]);
            const b = m[2] ? Number(m[2]) : a;
            const parity = /单/.test(seg) ? 1 : (/双/.test(seg) ? 2 : 0);
            for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
                if (w <= 0) continue;
                if (parity === 1 && w % 2 === 0) continue;
                if (parity === 2 && w % 2 === 1) continue;
                weeks.add(w);
            }
        });
        return [...weeks].sort((x, y) => x - y);
    }

    // "1-3节" "3节" "01~03" "01、02小节" → 小节数组
    function gxstnuParseSections(text) {
        const sections = new Set();
        String(text || "").replace(/\s+/g, "").split(/[,，、]/).forEach(seg => {
            const m = seg.match(/(\d+)(?:[-~～至](\d+))?/);
            if (!m) return;
            const a = Number(m[1]);
            const b = m[2] ? Number(m[2]) : a;
            for (let s = Math.min(a, b); s <= Math.max(a, b); s++) {
                if (s > 0) sections.add(s);
            }
        });
        return [...sections].sort((x, y) => x - y);
    }

    // "1-10周[1-3节]"、"1-8,10-13周[1-3节]"、"11周[3节]"（也兼容一条里多段 "…[..],…[..]"）
    function gxstnuParseTimeSpec(text) {
        const result = [];
        const re = /([^\[\]]*?)\[([^\]]*)\]/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const weeks = gxstnuParseWeeks(m[1]);
            if (weeks.length) result.push({ weeks: weeks, sections: gxstnuParseSections(m[2]) });
        }
        if (result.length === 0) {
            const weeks = gxstnuParseWeeks(text);
            if (weeks.length) result.push({ weeks: weeks, sections: [] });
        }
        return result;
    }

    // 「老师:…;时间:…;地点:…」→ { 老师, 时间, 地点 }；只在「;键:」处切分，值里出现分号也不会被拆开
    function gxstnuParseInfo(text) {
        const info = {};
        String(text || "")
            .split(/[;；](?=\s*(?:老师|教师|时间|地点|教室|上课地点|周次|节次)\s*[:：])/)
            .forEach(part => {
                const m = part.match(/^\s*([^:：]+?)\s*[:：]\s*([\s\S]*)$/);
                if (m) info[m[1]] = m[2].trim();
            });
        return info;
    }

    function gxstnuCleanTeacher(raw) {
        const names = String(raw || "")
            .split(/[,，、]+/)
            .map(part => {
                const original = part.trim();
                let name = original.replace(/[（(][^（）()]*[)）]/g, "").trim();
                for (const title of GXSTNU_TEACHER_TITLES) {
                    if (name.endsWith(title) && name.length - title.length >= 2) {
                        name = name.slice(0, -title.length).trim();
                        break;
                    }
                }
                return name || original;
            })
            .filter(Boolean);
        return [...new Set(names)].join(",");
    }

    // "科教楼(西3-201-计算机基础实验室（12）)" → "科教楼西3-201-计算机基础实验室（12）"
    // "校外实践场地（来）(校外实践场地（来）)" → "校外实践场地（来）"
    function gxstnuCleanPosition(raw) {
        const text = String(raw || "").trim();
        const m = text.match(/^([^()]*)\((.*)\)$/);
        if (!m) return text;
        const building = m[1].trim();
        const room = m[2].trim();
        if (!room) return building;
        if (!building || room.startsWith(building)) return room;
        return building + room;
    }

    // ── 课表页解析 ──────────────────────────────────────────────────

    // 按 rowspan / colspan 把表格摊平，返回每个单元格的真实行列坐标
    function gxstnuLayoutRows(rows) {
        const occupied = [];
        const cells = [];
        rows.forEach((row, r) => {
            occupied[r] = occupied[r] || [];
            let col = 0;
            Array.from(row.cells).forEach(cell => {
                while (occupied[r][col]) col++;
                const rowSpan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10) || 1);
                const colSpan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
                for (let dr = 0; dr < rowSpan; dr++) {
                    occupied[r + dr] = occupied[r + dr] || [];
                    for (let dc = 0; dc < colSpan; dc++) occupied[r + dr][col + dc] = true;
                }
                cells.push({ cell: cell, row: r, col: col, rowSpan: rowSpan, colSpan: colSpan });
                col += colSpan;
            });
        });
        return cells;
    }

    function gxstnuIsLabelCell(cell) {
        return cell.classList.contains("qz-weeklyTable-label");
    }

    // 左侧节次列「第一大节(1-2) (01、02小节) 08:20~09:45」→ { sections, start, end }
    function gxstnuParseRowLabel(cell) {
        const text = gxstnuText(cell);
        let sections = [];
        const small = text.match(/[(（]([^()（）]*?)小节[)）]/);
        if (small) sections = gxstnuParseSections(small[1]);
        if (sections.length === 0) {
            const big = text.match(/大节\s*[(（]([\d\s,，、~～-]+)[)）]/);
            if (big) sections = gxstnuParseSections(big[1]);
        }
        const time = text.match(/(\d{1,2}:\d{2})\s*[~～-]\s*(\d{1,2}:\d{2})/);
        return {
            sections: sections,
            start: time ? time[1] : null,
            end: time ? time[2] : null
        };
    }

    function gxstnuGetTimetable(doc) {
        return doc.querySelector("table.qz-weeklyTable");
    }

    function gxstnuBodyRows(table) {
        return Array.from(table.tBodies).flatMap(tbody => Array.from(tbody.rows));
    }

    // 由表头推出「列号 → 星期」，兼容「星期一」和「周一 11-09」两种写法
    function gxstnuColumnDays(table) {
        const dayByCol = {};
        const headRow = table.tHead && table.tHead.rows[0];
        if (!headRow) return dayByCol;
        gxstnuLayoutRows([headRow]).forEach(item => {
            const m = gxstnuText(item.cell).replace(/\s/g, "").match(/(?:星期|周)([一二三四五六日天])/);
            if (m) dayByCol[item.col] = GXSTNU_WEEKDAY[m[1]];
        });
        return dayByCol;
    }

    // 由左侧大节时间切出每一小节的时间段：n 节共 T 分钟，按「节内课间 5/10/0/15 分钟、单节 30~60 分钟」反推
    function gxstnuSplitBlock(sections, start, end) {
        const begin = gxstnuToMinutes(start);
        const total = gxstnuToMinutes(end) - begin;
        const n = sections.length;
        if (!n || isNaN(begin) || !(total > 0)) return null;
        if (n === 1) return [{ number: sections[0], startTime: start, endTime: end }];
        for (const gap of [5, 10, 0, 15]) {
            const len = (total - gap * (n - 1)) / n;
            if (!Number.isInteger(len) || len < 30 || len > 60) continue;
            return sections.map((number, i) => {
                const s = begin + i * (len + gap);
                return { number: number, startTime: gxstnuFromMinutes(s), endTime: gxstnuFromMinutes(s + len) };
            });
        }
        return null;
    }

    function gxstnuParseTimeSlots(doc) {
        const table = gxstnuGetTimetable(doc);
        if (!table) return null;
        const slots = [];
        for (const row of gxstnuBodyRows(table)) {
            const labelCell = Array.from(row.cells).find(gxstnuIsLabelCell);
            if (!labelCell) continue;
            const label = gxstnuParseRowLabel(labelCell);
            if (!label.sections.length || !label.start || !label.end) continue;
            const part = gxstnuSplitBlock(label.sections, label.start, label.end);
            if (!part) return null;
            slots.push(...part);
        }
        slots.sort((a, b) => a.number - b.number);
        // 契约：从 1 开始连续递增、互不重叠
        for (let i = 0; i < slots.length; i++) {
            if (slots[i].number !== i + 1) return null;
            if (gxstnuToMinutes(slots[i].startTime) >= gxstnuToMinutes(slots[i].endTime)) return null;
            if (i > 0 && gxstnuToMinutes(slots[i - 1].endTime) > gxstnuToMinutes(slots[i].startTime)) return null;
        }
        return slots.length ? slots : null;
    }

    // 节次之间间隔 ≥ 40 分钟（午休、晚饭）视为不同时段，合并相邻小节时不跨过去
    function gxstnuSessionBreaks(timeSlots) {
        const breaks = new Set();
        for (let i = 1; i < timeSlots.length; i++) {
            const gap = gxstnuToMinutes(timeSlots[i].startTime) - gxstnuToMinutes(timeSlots[i - 1].endTime);
            if (gap >= 40) breaks.add(timeSlots[i - 1].number);
        }
        return breaks;
    }

    function gxstnuReadCourseItem(li, tooltip) {
        const name = gxstnuText(li.querySelector(".qz-hasCourse-title"));
        const info = gxstnuParseInfo(gxstnuText(li.querySelector(".qz-hasCourse-abbrinfo")));
        // 缩略信息缺字段时，用同序号的悬浮提示补齐（「老师：…」「时间：…」「地点：…」各占一行）
        if (tooltip && (!info["时间"] || !info["老师"] || !info["地点"])) {
            tooltip.querySelectorAll(".qz-tooltipContent-detailitem").forEach(item => {
                const m = gxstnuText(item).match(/^(老师|教师|时间|地点)\s*[:：]\s*(.*)$/);
                if (m && !info[m[1]]) info[m[1]] = m[2].trim();
            });
        }
        return {
            name: name,
            teacher: gxstnuCleanTeacher(info["老师"] || info["教师"] || ""),
            position: gxstnuCleanPosition(info["地点"] || info["教室"] || info["上课地点"] || ""),
            time: info["时间"] || ""
        };
    }

    function gxstnuParseRawCourses(doc) {
        const table = gxstnuGetTimetable(doc);
        if (!table) return [];

        const dayByCol = gxstnuColumnDays(table);
        const hasHeaderDays = Object.keys(dayByCol).length > 0;
        const rows = gxstnuBodyRows(table);
        const layout = gxstnuLayoutRows(rows);

        // 每一行对应的小节（时间里缺「[x-y节]」时按格子覆盖的行兜底）
        const rowSections = {};
        layout.forEach(item => {
            if (gxstnuIsLabelCell(item.cell)) rowSections[item.row] = gxstnuParseRowLabel(item.cell).sections;
        });

        const raw = [];
        layout.forEach(item => {
            if (gxstnuIsLabelCell(item.cell)) return;
            const day = hasHeaderDays ? dayByCol[item.col] : item.col;
            if (!day || day < 1 || day > 7) return;

            const tooltips = Array.from(item.cell.querySelectorAll(".qz-tooltip li.qz-toolitiplists"));
            item.cell.querySelectorAll("li.courselists-item").forEach((li, index) => {
                const course = gxstnuReadCourseItem(li, tooltips[index]);
                if (!course.name) return;

                let fallbackSections = [];
                for (let r = item.row; r < item.row + item.rowSpan; r++) {
                    fallbackSections = fallbackSections.concat(rowSections[r] || []);
                }

                gxstnuParseTimeSpec(course.time).forEach(spec => {
                    const sections = spec.sections.length ? spec.sections : fallbackSections;
                    if (!sections.length) return;
                    raw.push({
                        name: course.name,
                        teacher: course.teacher,
                        position: course.position,
                        day: day,
                        weeks: spec.weeks,
                        sections: sections
                    });
                });
            });
        });
        return raw;
    }

    /**
     * 同一门课（课程名 + 教师 + 地点 + 星期）的多条安排先摊成「周 × 小节」占用格，再重新切段：
     *   - 同一周内相邻的小节连成一段（不跨午休 / 晚饭）；
     *   - 起止小节相同的段合并周次。
     * 教务会把一门课拆成「1-10周[1-3节]」「11周[1-2节]」「11周[3节]」「12-16周[1-3节]」，
     * 合并后就是一条「1-16周 第1-3节」。
     */
    function gxstnuMergeCourses(raw, sessionBreaks) {
        const groups = new Map();
        raw.forEach(c => {
            const key = [c.name, c.teacher, c.position, c.day].join("\u0001");
            if (!groups.has(key)) groups.set(key, { base: c, cells: new Map() });
            const cells = groups.get(key).cells;
            c.weeks.forEach(w => {
                if (!cells.has(w)) cells.set(w, new Set());
                c.sections.forEach(s => cells.get(w).add(s));
            });
        });

        const result = [];
        groups.forEach(group => {
            const byRange = new Map();
            group.cells.forEach((sectionSet, week) => {
                const sections = [...sectionSet].sort((a, b) => a - b);
                let start = sections[0];
                let prev = sections[0];
                const flush = end => {
                    const key = `${start}-${end}`;
                    if (!byRange.has(key)) byRange.set(key, { start: start, end: end, weeks: [] });
                    byRange.get(key).weeks.push(week);
                };
                for (let i = 1; i < sections.length; i++) {
                    const s = sections[i];
                    if (s === prev + 1 && !sessionBreaks.has(prev)) {
                        prev = s;
                        continue;
                    }
                    flush(prev);
                    start = s;
                    prev = s;
                }
                flush(prev);
            });
            byRange.forEach(range => {
                result.push({
                    name: group.base.name,
                    teacher: group.base.teacher,
                    position: group.base.position,
                    day: group.base.day,
                    startSection: range.start,
                    endSection: range.end,
                    weeks: range.weeks.sort((a, b) => a - b)
                });
            });
        });

        result.sort((a, b) => a.day - b.day || a.startSection - b.startSection ||
            a.weeks[0] - b.weeks[0] || a.name.localeCompare(b.name));
        return result;
    }

    // ── 学期 / 日期 ─────────────────────────────────────────────────

    function gxstnuParseSemesters(doc) {
        const select = doc.getElementById("xnxq01id");
        if (!select) return [];
        return Array.from(select.querySelectorAll("option"))
            .map(opt => ({
                value: (opt.getAttribute("value") || "").trim(),
                selected: opt.hasAttribute("selected")
            }))
            .filter(opt => opt.value);
    }

    function gxstnuSelectedSemester(doc) {
        const select = doc.getElementById("xnxq01id");
        if (!select) return null;
        const opt = select.querySelector("option[selected]");
        return opt ? (opt.getAttribute("value") || "").trim() : null;
    }

    function gxstnuSemesterLabel(value) {
        const m = /^(\d{4})-(\d{4})-(\d)$/.exec(value);
        if (!m) return value;
        const term = { "1": "第一学期", "2": "第二学期", "3": "第三学期" }[m[3]] || `第${m[3]}学期`;
        return `${m[1]}-${m[2]} 学年 ${term}`;
    }

    function gxstnuTimeModeId(doc) {
        const select = doc.getElementById("kbjcmsid");
        if (!select) return "";
        const opt = select.querySelector("option[selected]") || select.querySelector("option");
        return opt ? (opt.getAttribute("value") || "").trim() : "";
    }

    async function gxstnuLoadCoursePage(base, semesterId, timeModeId) {
        if (!semesterId) {
            return gxstnuParseHtml(await gxstnuFetchText(`${base}/xskb/xskb_list.do?viweType=0`));
        }

        // 新版页面的查询表单没有 method，按 GET 提交
        const query = new URLSearchParams({ viweType: "0", xnxq01id: semesterId, zc: "", kbjcmsid: timeModeId || "" });
        const doc = gxstnuParseHtml(await gxstnuFetchText(`${base}/xskb/xskb_list.do?${query}`));
        const selected = gxstnuSelectedSemester(doc);
        if (gxstnuGetTimetable(doc) && (selected === semesterId || selected === null)) return doc;

        // 兜底：旧版强智的 POST 表单参数
        const body = new URLSearchParams({ viweType: "0", xnxq01id: semesterId, zc: "", kbjcmsid: timeModeId || "" });
        const postDoc = gxstnuParseHtml(await gxstnuFetchText(`${base}/xskb/xskb_list.do?viweType=0`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString()
        }));
        if (gxstnuGetTimetable(postDoc) && gxstnuSelectedSemester(postDoc) === semesterId) return postDoc;
        throw new Error(`教务系统没有返回 ${semesterId} 学期的课表`);
    }

    async function gxstnuFetchWeekRange(base, semesterId) {
        try {
            const text = await gxstnuFetchText(`${base}/xskb/jxzlzc_xnxq_ajax?xnxq01id=${encodeURIComponent(semesterId)}`);
            const data = JSON.parse(text);
            const item = Array.isArray(data) ? data[0] : data;
            const first = parseInt(item && item.qszc, 10);
            const last = parseInt(item && item.jszc, 10);
            if (!(last > 0)) return null;
            return { first: first > 0 ? first : 1, last: last };
        } catch (e) {
            return null;
        }
    }

    // 学年 "2026-2027-1"：第一学期 7 月及以后算前一年，其余算后一年
    function gxstnuInferYear(semesterId, month) {
        const m = /^(\d{4})-(\d{4})-(\d)$/.exec(semesterId);
        if (!m) return new Date().getFullYear();
        const startYear = Number(m[1]);
        const endYear = Number(m[2]);
        if (m[3] === "1") return month >= 7 ? startYear : endYear;
        return endYear;
    }

    // 首页周课表的表头「周一 09-07」→ 第一教学周周一的日期
    async function gxstnuFetchStartDate(base, semesterId, timeModeId, firstWeek) {
        try {
            const query = new URLSearchParams({
                zc: String(firstWeek || 1),
                kbjcmsid: timeModeId || "",
                xnxq01id: semesterId,
                xswk: "false"
            });
            const doc = gxstnuParseHtml(await gxstnuFetchText(`${base}/framework/mainV_index_loadkb.htmlx?${query}`));
            for (const th of doc.querySelectorAll("th")) {
                const m = gxstnuText(th).replace(/\s/g, "").match(/(?:星期|周)([一二三四五六日天])(\d{1,2})[-/月.](\d{1,2})/);
                if (!m) continue;
                const weekday = GXSTNU_WEEKDAY[m[1]];
                const month = Number(m[2]);
                const day = Number(m[3]);
                const date = new Date(Date.UTC(gxstnuInferYear(semesterId, month), month - 1, day));
                date.setUTCDate(date.getUTCDate() - (weekday - 1) - ((firstWeek || 1) - 1) * 7);
                return `${date.getUTCFullYear()}-${gxstnuPad2(date.getUTCMonth() + 1)}-${gxstnuPad2(date.getUTCDate())}`;
            }
        } catch (e) {
            // 拿不到开学日期不影响课程导入
        }
        return null;
    }

    // ── 主流程 ──────────────────────────────────────────────────────

    async function gxstnuChooseSemester(entryDoc) {
        const semesters = gxstnuParseSemesters(entryDoc);
        if (semesters.length === 0) return null;
        let defaultIndex = semesters.findIndex(s => s.selected);
        if (defaultIndex < 0) defaultIndex = 0;
        const labels = semesters.map((s, i) => gxstnuSemesterLabel(s.value) + (i === defaultIndex ? "（当前）" : ""));
        const picked = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(labels),
            defaultIndex
        );
        if (picked === null || picked === undefined || picked < 0 || picked >= semesters.length) return null;
        // 入口页就是默认学期的课表，选它时不必再请求一次
        return { value: semesters[picked].value, isEntry: semesters[picked].selected };
    }

    async function runImportFlow() {
        try {
            const confirmed = await window.shiguangBridgePromise.showAlert(
                "广西科技师范学院",
                "请确认已在内置浏览器中登录教务系统（看到教务首页即可）。\n\n" +
                "将读取「学期理论课表」中的全部课程，并同步开学日期、总周数和作息时间。",
                "开始导入"
            );
            if (!confirmed) return;

            const base = gxstnuResolveBase();
            gxstnuToast("正在获取学期列表...");
            const entryDoc = await gxstnuLoadCoursePage(base, null, "");
            if (!entryDoc.getElementById("xnxq01id") || !gxstnuGetTimetable(entryDoc)) {
                await window.shiguangBridgePromise.showAlert(
                    "未登录",
                    "没有获取到课表页面，请先在内置浏览器中登录教务系统，再点击导入。",
                    "好的"
                );
                return;
            }

            const semester = await gxstnuChooseSemester(entryDoc);
            if (!semester) return;
            const timeModeId = gxstnuTimeModeId(entryDoc);

            gxstnuToast("正在获取课表...");
            const courseDoc = semester.isEntry
                ? entryDoc
                : await gxstnuLoadCoursePage(base, semester.value, timeModeId);

            const timeSlots = gxstnuParseTimeSlots(courseDoc) || GXSTNU_FALLBACK_TIME_SLOTS;
            const courses = gxstnuMergeCourses(gxstnuParseRawCourses(courseDoc), gxstnuSessionBreaks(timeSlots));
            if (courses.length === 0) {
                gxstnuToast("该学期没有解析到课程，请确认学期是否选对。");
                return;
            }

            gxstnuToast("正在获取教学周与开学日期...");
            const weekRange = await gxstnuFetchWeekRange(base, semester.value);
            const startDate = await gxstnuFetchStartDate(base, semester.value, timeModeId, weekRange ? weekRange.first : 1);
            const maxCourseWeek = Math.max(...courses.map(c => c.weeks[c.weeks.length - 1]));

            const config = {
                semesterTotalWeeks: Math.max(weekRange ? weekRange.last : 20, maxCourseWeek),
                firstDayOfWeek: 1,
                defaultClassDuration: 40,
                defaultBreakDuration: 5
            };
            if (startDate) config.semesterStartDate = startDate;
            try {
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            } catch (e) {
                gxstnuToast("学期配置导入失败，已跳过。");
            }

            try {
                await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            } catch (e) {
                gxstnuToast("作息时间导入失败，已跳过。");
            }

            const saved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
            if (saved !== true) {
                gxstnuToast("课程保存失败，请重试。");
                return;
            }

            gxstnuToast(`成功导入 ${courses.length} 条课程安排`);
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            gxstnuToast("导入失败：" + (error && error.message ? error.message : error));
        }
    }

    runImportFlow();
})();
