// 适配目标：武汉商学院-超星综合教学管理系统
//
// 逻辑概览：
// 0) 询问导出学期：可选学期来自页面下拉框 #xnxq1（服务端渲染）；学期很多时分页展示
//    （每页 4 个 + “更多…”翻页 + “上一页”返回）；选非当前学期时用页面已有的
//    xhid/xqdm 直接请求该学期 sdpkkbList JSON 并解析，无需跳转
// 1) 统一走接口：sdpkkbList 拉课程 JSON，getZclistByXnxq 取时间段/开学日期；
//    不在课表页（首页/选课页等）时先抓课表页 HTML 拿 xhid/xqdm/学期列表，任意页面都能导
// 2) 课程 JSON 复刻页面逻辑：同格同课程合并周次 -> 相邻节次同内容合并（rowspan）
// 3) 接口失败且当前在课表页时，回退解析页面已渲染的 DOM（td.cell + <a onclick> 链接）
// 4) 教师姓名带工号（如“王老师（20240999）”）时，弹窗询问是否去除，默认保留
// 5) 按 课程/教师/教室/星期/周次 合并连续节次，经 shiguangBridgePromise 保存课程与时间段
// 6) 从 /admin/api/getZclistByXnxq 取周次列表：导出开学日期（第 1 周开始日）与总周数到 config
// 7) 任意弹窗步骤用户点“取消”：立即终止，不解析、不保存、不触发下载
// 8) 检测重复课程（同课程/同教室/同节次/同周次）：完全相同→弹“只保留一门”，
//    多教师→弹“合并教师”（选项与标题随类型变化），取消即终止

(function () {
    function toast(message) {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
            window.shiguangBridge.showToast(message);
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // 用户点击“取消”时的统一返回值：任意流程取消即终止整个导入
    const CANCELED = "CANCELED";

    // 桥接端是否支持单选弹窗
    function canShowSingleSelection() {
        return !!(
            window.shiguangBridgePromise &&
            typeof window.shiguangBridgePromise.showSingleSelection === "function"
        );
    }

    async function getTargetDocument() {
        if (location.href.includes("queryKbForXsd")) {
            return document;
        }

        const iframe = document.querySelector("iframe[src*='queryKbForXsd']");
        if (!iframe) return null;

        for (let i = 0; i < 20; i += 1) {
            try {
                const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                if (doc && doc.readyState && doc.readyState !== "loading") {
                    return doc;
                }
            } catch (e) {
                // ignore
            }
            await sleep(500);
        }
        return null;
    }

    async function waitForScheduleData(doc, timeoutMs = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const cells = Array.from(doc.querySelectorAll("td.cell, td[id^='Cell']"));
            const filled = cells.filter((cell) => {
                const text = (cell.innerText || cell.textContent || "").trim();
                return text.length > 0 && /周/.test(text);
            });
            if (filled.length > 0) {
                return true;
            }
            await sleep(500);
        }
        return false;
    }

    function uniqueSortedNumbers(nums) {
        const set = new Set(nums.filter((n) => Number.isFinite(n)));
        return Array.from(set).sort((a, b) => a - b);
    }

    function parseWeekText(weekText) {
        if (!weekText) return [];
        let text = String(weekText).trim();
        if (!text) return [];

        let oddOnly = false;
        let evenOnly = false;
        if (text.includes("单")) oddOnly = true;
        if (text.includes("双")) evenOnly = true;

        text = text.replace(/周/g, "");
        text = text.replace(/\s+/g, "");
        text = text.replace(/\(.*?\)/g, "");
        text = text.replace(/（.*?）/g, "");
        // 兼容接口 zc 的写法：1-19(单)/2-18(双)/裸“单”“双”/“改”后缀
        text = text.replace(/[（(]?单[）)]?/g, "");
        text = text.replace(/[（(]?双[）)]?/g, "");
        text = text.replace(/改$/g, "");

        const weeks = [];
        const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
        segments.forEach((seg) => {
            if (!seg) return;
            const rangeMatch = seg.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (!Number.isFinite(start) || !Number.isFinite(end)) return;
                for (let w = start; w <= end; w += 1) {
                    weeks.push(w);
                }
                return;
            }
            const single = parseInt(seg, 10);
            if (Number.isFinite(single)) weeks.push(single);
        });

        let filtered = weeks;
        if (oddOnly && !evenOnly) {
            filtered = weeks.filter((w) => w % 2 === 1);
        } else if (evenOnly && !oddOnly) {
            filtered = weeks.filter((w) => w % 2 === 0);
        }

        return uniqueSortedNumbers(filtered);
    }

    // 接口行周次：优先 zcstr（逗号列表），回退 zc（parseWeekText 已兼容范围/单双/改）
    function parseWeeksFromRow(row) {
        const zcstr = String(row.zcstr || "").trim();
        if (zcstr) {
            const weeks = parseWeekText(zcstr + "周");
            if (weeks.length) return weeks;
        }
        return parseWeekText(String(row.zc || "") + "周");
    }

    function stripHtmlText(text) {
        return String(text || "").replace(/<[^>]+>/g, "").trim();
    }

    function splitCourseBlocks(cellText) {
        const text = cellText.replace(/\r/g, "").trim();
        if (!text) return [];
        return text
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);
    }

    function extractWeeksTextFromLine(line) {
        if (!line) return { weeksText: "", rest: line || "" };
        const match = line.match(/(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)\s*(?:\((单|双)\))?\s*周/);
        if (!match) return { weeksText: "", rest: line };
        const weeksCore = match[1];
        const oddEven = match[2] ? `(${match[2]})` : "";
        const weeksText = `${weeksCore}${oddEven}周`;
        const rest = line.replace(match[0], "").trim();
        return { weeksText, rest };
    }

    // 从单元格里的 <a> 链接按语义提取文本（武汉商学院课表把课程名/教师/教室渲染成链接）
    function extractAnchorText(cell, onclickKeyword, blockText) {
        if (!cell) return "";
        const anchors = Array.from(
            cell.querySelectorAll('a[onclick*="' + onclickKeyword + '"]')
        ).sort((a, b) => (b.textContent || "").length - (a.textContent || "").length);
        for (const anchor of anchors) {
            const text = (anchor.textContent || "").trim();
            if (text && blockText.includes(text)) {
                return text;
            }
        }
        return "";
    }

    function parseCourseBlock(cell, block) {
        const lines = block
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (!lines.length) return null;

        // 优先用单元格内的链接解析，避免把“校区名”当成课程名、把“课程名”当成教师。
        // 武商院课表单元格文本顺序为：校区 -> 课程名 -> 教师 周次 -> 教室。
        const anchorName = extractAnchorText(cell, "openKckb", block);
        const anchorTeacher = extractAnchorText(cell, "openJskb", block);
        const anchorPosition = extractAnchorText(cell, "openCrkb", block);

        const name = anchorName || lines[0] || "";
        let teacher = "";
        let weeksText = "";
        let position = "";

        const weekLineIndex = lines.findIndex((l) => /周/.test(l));
        if (weekLineIndex >= 0) {
            const { weeksText: extractedWeeks, rest } = extractWeeksTextFromLine(
                lines[weekLineIndex]
            );
            weeksText = extractedWeeks;
            if (weekLineIndex === 1) {
                teacher = rest || lines[1];
            }
        }

        if (!teacher && lines.length > 1) {
            teacher = lines[1];
            const { weeksText: extractedWeeks, rest } = extractWeeksTextFromLine(teacher);
            if (extractedWeeks) {
                weeksText = weeksText || extractedWeeks;
                teacher = rest;
            }
        }

        if (!weeksText) {
            for (const line of lines) {
                const { weeksText: extractedWeeks } = extractWeeksTextFromLine(line);
                if (extractedWeeks) {
                    weeksText = extractedWeeks;
                    break;
                }
            }
        }

        if (!position) {
            if (weekLineIndex >= 0 && weekLineIndex + 1 < lines.length) {
                position = lines[weekLineIndex + 1];
            }
            if (!position) {
                position =
                    lines.find((l) => l !== name && l !== teacher && !/周/.test(l)) || "";
            }
        }

        return {
            name: anchorName || name || "未知课程",
            teacher: anchorTeacher || teacher || "",
            weeksText,
            position: anchorPosition || position || "",
        };
    }

    function padTime(value) {
        const text = String(value || "").trim();
        const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
        if (!match) return text;
        const h = match[1].padStart(2, "0");
        const m = match[2].padStart(2, "0");
        return `${h}:${m}`;
    }

    function randomColor() {
        return Math.floor(Math.random() * 12) + 1;
    }

    function createId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    function mergeCourses(courses) {
        const byKey = new Map();
        courses.forEach((course) => {
            const weeksKey = (course.weeks || []).join(",");
            const key = [course.name, course.teacher, course.position, course.day, weeksKey].join("|");
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push({ ...course });
        });

        const merged = [];
        byKey.forEach((items) => {
            items.sort((a, b) => a.startSection - b.startSection);
            let current = null;
            items.forEach((item) => {
                if (!current) {
                    current = { ...item };
                    return;
                }
                if (item.startSection === current.endSection + 1) {
                    current.endSection = Math.max(current.endSection, item.endSection);
                } else {
                    merged.push(current);
                    current = { ...item };
                }
            });
            if (current) merged.push(current);
        });

        return merged;
    }


    // 官方参考：节次与周次合并去重函数
    // 来源：拾光课程表适配教程《课程合并与去重函数》
    // 放在现有去重/合并流程之后，作为最后一道清洗，确保单双周、连续节次、完全重复都收敛。
    function mergeAndDistinctCourses(courses) {
        if (!Array.isArray(courses) || courses.length <= 1) return courses;

        // 1. 深拷贝并规范周次数据，过滤无效项
        const list = courses.map(c => ({
            ...c,
            name: c.name || '',
            teacher: c.teacher || '',
            position: c.position || '',
            weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
        }));

        // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
        list.sort((a, b) => {
            return a.name.localeCompare(b.name) ||
                   a.teacher.localeCompare(b.teacher) ||
                   a.position.localeCompare(b.position) ||
                   (a.day || 0) - (b.day || 0) ||
                   a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
                   (a.startSection || 0) - (b.startSection || 0);
        });

        const step1Merged = [];
        let current = list[0];

        for (let i = 1; i < list.length; i++) {
            const next = list[i];

            const isSameCourseAndWeeks =
                current.name === next.name &&
                current.teacher === next.teacher &&
                current.position === next.position &&
                current.day === next.day &&
                current.weeks.join(',') === next.weeks.join(',');

            const isContinuous = current.endSection + 1 === next.startSection;
            const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

            if (isSameCourseAndWeeks && isContinuous) {
                // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
                current.endSection = next.endSection;
            } else if (isSameCourseAndWeeks && isDuplicate) {
                // 完全重复：跳过
                continue;
            } else {
                step1Merged.push(current);
                current = next;
            }
        }
        step1Merged.push(current);

        // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
        step1Merged.sort((a, b) => {
            return a.name.localeCompare(b.name) ||
                   a.teacher.localeCompare(b.teacher) ||
                   a.position.localeCompare(b.position) ||
                   (a.day || 0) - (b.day || 0) ||
                   (a.startSection || 0) - (b.startSection || 0) ||
                   (a.endSection || 0) - (b.endSection || 0);
        });

        const step2Merged = [];
        let cur = step1Merged[0];

        for (let i = 1; i < step1Merged.length; i++) {
            const nxt = step1Merged[i];

            const isSameCourseAndSection =
                cur.name === nxt.name &&
                cur.teacher === nxt.teacher &&
                cur.position === nxt.position &&
                cur.day === nxt.day &&
                cur.startSection === nxt.startSection &&
                cur.endSection === nxt.endSection;

            if (isSameCourseAndSection) {
                // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
                cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
            } else {
                step2Merged.push(cur);
                cur = nxt;
            }
        }
        step2Merged.push(cur);

        return step2Merged;
    }

    function parseScheduleFromDocument(doc) {
        const cells = Array.from(doc.querySelectorAll("td.cell"));
        const fallbackCells = cells.length ? [] : Array.from(doc.querySelectorAll("td[id^='Cell']"));
        const targetCells = cells.length ? cells : fallbackCells;
        const courses = [];
        const seen = new Set();

        targetCells.forEach((cell) => {
            const id = cell.getAttribute("id") || "";
            const match = id.match(/^Cell(\d)(\d{1,2})$/);
            if (!match) return;

            const day = parseInt(match[1], 10);
            const startSection = parseInt(match[2], 10);
            const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);
            const endSection = startSection + Math.max(rowspan, 1) - 1;

            const blocks = splitCourseBlocks(cell.innerText || "");
            blocks.forEach((blockText) => {
                const parsed = parseCourseBlock(cell, blockText);
                if (!parsed) return;
                const weeks = parseWeekText(parsed.weeksText);
                if (!weeks.length) return;

                const key = [
                    parsed.name,
                    parsed.teacher,
                    parsed.position,
                    day,
                    startSection,
                    endSection,
                    weeks.join(","),
                ].join("|");
                if (seen.has(key)) return;
                seen.add(key);

                courses.push({
                    id: createId(),
                    name: parsed.name,
                    teacher: parsed.teacher,
                    position: parsed.position,
                    day,
                    startSection,
                    endSection,
                    color: randomColor(),
                    weeks,
                });
            });
        });

        return mergeCourses(courses);
    }

    function parseTimeSlots(doc) {
        const slots = [];
        const seenNumbers = new Set();
        const timeRegex = /(\d{1,2}:\d{2})/g;

        const timeCells = Array.from(
            doc.querySelectorAll("td[data-jcindex], td[data-jcIndex]")
        );

        timeCells.forEach((cell) => {
            const text = (cell.innerText || cell.textContent || "").trim();
            if (!text) return;

            const indexAttr = cell.getAttribute("data-jcindex") || cell.getAttribute("data-jcIndex");
            const numberMatch = text.match(/^(\d{1,2})/);
            const number = parseInt(indexAttr || (numberMatch && numberMatch[1]) || "", 10);
            if (!Number.isFinite(number)) return;

            const times = text.match(timeRegex) || [];
            if (times.length < 2) return;

            if (seenNumbers.has(number)) return;
            seenNumbers.add(number);

            slots.push({
                number,
                startTime: padTime(times[0]),
                endTime: padTime(times[1]),
            });
        });

        return slots.sort((a, b) => a.number - b.number);
    }

    // ===== 教师工号处理 =====
    // 匹配“姓名（工号）”/“姓名(工号)”结尾的教师名
    const TEACHER_ID_RE = /^(.+?)\s*[（(](\d{4,})[）)]$/;

    function hasTeacherId(teacher) {
        return TEACHER_ID_RE.test(teacher || "");
    }

    function stripTeacherId(teacher) {
        const match = TEACHER_ID_RE.exec(teacher || "");
        return match ? match[1].trim() : teacher;
    }

    // 若检测到教师姓名带工号，弹窗询问是否保留（参考 school.bak.js 的单选弹窗用法，
    // 选项里同时展示“保留”和“去除”后的样子，方便核对脚本解析是否正确）
    async function askKeepTeacherId(courses) {
        const withId = courses.filter((c) => hasTeacherId(c.teacher));
        if (!withId.length) return "keep";
        if (!canShowSingleSelection()) {
            console.warn("shiguangBridgePromise.showSingleSelection 不可用，教师工号默认保留");
            return "keep";
        }

        const example = withId[0].teacher;
        const stripped = stripTeacherId(example);
        const options = [
            `保留工号（如：${example}）`,
            `去除工号（如：${stripped}）`,
        ];

        console.log(`检测到 ${withId.length} 门课的教师姓名带工号，即将弹出询问...`);
        try {
            const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                `教师姓名带工号（共 ${withId.length} 门课）`,
                JSON.stringify(options),
                0
            );
            if (selectedIndex === null) {
                console.log("用户取消工号询问，终止导入");
                return CANCELED;
            }
            if (selectedIndex === 1) {
                console.log("用户选择去除工号，例如：" + example + " -> " + stripped);
                return "strip";
            }
            console.log("用户选择保留工号，保持原样");
            return "keep";
        } catch (error) {
            console.error("教师工号询问失败，默认保留工号:", error);
            return "keep";
        }
    }

    // ===== 重复/冲突课程处理 =====
    // 系统有时会把同一门课拆成多条（同名/同教室/同周次/同节次）：
    // - 完全相同：教师也相同 -> 只需“只保留一门”
    // - 多教师：教师不同（如两位老师同上一门课）-> 用“合并教师”并列成一条
    function findDuplicateCourseGroups(courses) {
        const groups = new Map();
        courses.forEach((c) => {
            const key = [
                c.name,
                c.position,
                c.day,
                c.startSection,
                c.endSection,
                (c.weeks || []).join(","),
            ].join("|");
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(c);
        });
        return Array.from(groups.values())
            .filter((g) => g.length > 1)
            .map((g) => ({
                courses: g,
                type: new Set(g.map((c) => c.teacher).filter(Boolean)).size > 1
                    ? "multiTeacher"
                    : "identical",
            }));
    }

    // 弹窗询问重复课程处理。选项随重复类型变化：
    // 完全相同 -> 显示“只保留一门”；多教师 -> 显示“合并教师”；两类都有则都显示。
    // 取消返回 CANCELED 终止导入。
    async function askHandleDuplicateCourses(courses) {
        const groups = findDuplicateCourseGroups(courses);
        if (!groups.length) return "keep";
        if (!canShowSingleSelection()) {
            console.warn("shiguangBridgePromise.showSingleSelection 不可用，重复课程默认全部保留");
            return "keep";
        }

        const total = groups.reduce((n, g) => n + g.courses.length, 0);
        const hasIdentical = groups.some((g) => g.type === "identical");
        const hasMulti = groups.some((g) => g.type === "multiTeacher");

        const exampleGroup = groups.find((g) => g.type === "multiTeacher") || groups[0];
        const example = exampleGroup.courses[0];
        const teacherText = Array.from(
            new Set(exampleGroup.courses.map((c) => c.teacher).filter(Boolean))
        ).join("、");

        const options = [`全部保留（${total} 门）`];
        let dedupeIndex = -1;
        let mergeIndex = -1;
        if (hasIdentical) {
            dedupeIndex = options.length;
            options.push(`只保留一门（去重：如 ${example.name} 只留 1 门）`);
        }
        if (hasMulti) {
            mergeIndex = options.length;
            options.push(`合并教师（如：${example.name} -> ${teacherText}）`);
        }

        let title;
        if (hasIdentical && hasMulti) {
            title = `重复课程处理（${groups.length} 组 / ${total} 门，含相同课程与多教师）`;
        } else if (hasMulti) {
            title = `多教师重复课程处理（${groups.length} 组 / ${total} 门）`;
        } else {
            title = `完全相同的重复课程处理（${groups.length} 组 / ${total} 门）`;
        }

        console.log(
            "检测到重复课程:",
            groups.map((g) => g.type + "x" + g.courses.length).join(", "),
            "即将弹出询问..."
        );
        try {
            const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                title,
                JSON.stringify(options),
                0
            );
            if (selectedIndex === null) {
                console.log("用户取消重复课程处理，终止导入");
                return CANCELED;
            }
            if (selectedIndex === dedupeIndex) {
                // 只保留每组第一门（去重）
                groups.forEach((g) => {
                    g.courses.slice(1).forEach((c) => {
                        const idx = courses.indexOf(c);
                        if (idx >= 0) courses.splice(idx, 1);
                    });
                });
                console.log("已去重，剩余课程:", courses.length);
                return "dedupe";
            }
            if (selectedIndex === mergeIndex) {
                // 合并：每组保留一门；多教师组教师并列
                const removeIds = new Set();
                groups.forEach((g) => {
                    const first = g.courses[0];
                    if (g.type === "multiTeacher") {
                        first.teacher = Array.from(
                            new Set(g.courses.map((c) => c.teacher).filter(Boolean))
                        ).join("、");
                    }
                    g.courses.slice(1).forEach((c) => removeIds.add(c.id));
                });
                for (let i = courses.length - 1; i >= 0; i -= 1) {
                    if (removeIds.has(courses[i].id)) courses.splice(i, 1);
                }
                console.log("已合并，剩余课程:", courses.length);
                return "merge";
            }
            console.log("用户选择全部保留");
            return "keep";
        } catch (error) {
            console.error("重复课程处理失败，默认全部保留:", error);
            return "keep";
        }
    }


    // ===== 学期选择与跨学期数据获取 =====
    // 页面下拉框 #xnxq1 的 <option> 就是可选学期（服务端渲染，无需额外接口）
    function getCurrentXnxq(doc) {
        const fromUrl = new URLSearchParams(location.search).get("xnxq");
        if (fromUrl) return fromUrl;
        const root = doc || document;
        const el = root.querySelector("#xnxq") || document.querySelector("#xnxq");
        return ((el && (el.value || el.textContent)) || "").trim();
    }

    function readSemesterOptions(doc) {
        const options = [];
        doc.querySelectorAll("#xnxq1 option").forEach((opt) => {
            const value = (opt.getAttribute("value") || "").trim();
            const text = (opt.textContent || "").trim();
            if (value && text) options.push({ value, text });
        });
        return options;
    }

    // 学期很多时分页选择：每页最多 SEMESTER_PAGE_SIZE 个学期，
    // 末尾放“更多…”翻下一页（最后一页不显示），并支持“上一页”返回
    const SEMESTER_PAGE_SIZE = 4;

    // 弹窗选择学期（参考 school.bak.js 单选弹窗）。
    // 取消返回 CANCELED（终止导入）；弹窗不可用/出错时返回 null（用当前学期）。
    async function askChooseSemester(doc) {
        let options = [];
        for (let i = 0; i < 10 && !options.length; i += 1) {
            options = readSemesterOptions(doc);
            if (!options.length && document !== doc) options = readSemesterOptions(document);
            if (!options.length) await sleep(300);
        }
        if (!options.length) {
            console.warn("未找到可选学期下拉框 #xnxq1，跳过学期选择");
            return null;
        }
        if (!canShowSingleSelection()) {
            console.warn("shiguangBridgePromise.showSingleSelection 不可用，跳过学期选择");
            return null;
        }

        const current = getCurrentXnxq(doc);

        // 按页切分（保持页面原有顺序：最近的学期在前）
        const pages = [];
        for (let i = 0; i < options.length; i += SEMESTER_PAGE_SIZE) {
            pages.push(options.slice(i, i + SEMESTER_PAGE_SIZE));
        }

        let pageIndex = 0;
        while (pageIndex >= 0 && pageIndex < pages.length) {
            const page = pages[pageIndex];
            const isLastPage = pageIndex === pages.length - 1;
            const labels = page.map((o) => o.text);

            let moreIndex = -1;
            let backIndex = -1;
            if (!isLastPage) {
                moreIndex = labels.length;
                labels.push("更多…");
            }
            if (pageIndex > 0) {
                backIndex = labels.length;
                labels.push("上一页");
            }

            const defaultIndex =
                pageIndex === 0
                    ? Math.max(0, page.findIndex((o) => o.value === current))
                    : 0;

            console.log(
                "弹出学期选择（第 " + (pageIndex + 1) + " 页，共 " + pages.length + " 页）..."
            );
            let selectedIndex;
            try {
                selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                    pageIndex === 0
                        ? "请选择要导出的学年学期"
                        : "更多学期（第 " + (pageIndex + 1) + " 页 / 共 " + pages.length + " 页）",
                    JSON.stringify(labels),
                    defaultIndex
                );
            } catch (error) {
                console.error("学期选择失败，使用当前学期:", error);
                return null;
            }
            if (selectedIndex === null) {
                console.log("用户取消学期选择，终止导入");
                return CANCELED;
            }
            if (selectedIndex === moreIndex) {
                pageIndex += 1;
                continue;
            }
            if (selectedIndex === backIndex) {
                pageIndex -= 1;
                continue;
            }
            const chosen = page[selectedIndex];
            if (!chosen) return null;
            console.log("用户选择学期:", chosen.value);
            return chosen.value;
        }
        return null;
    }


    // 用页面已有的 xhid/xqdm 直接请求指定学期的课表 JSON（同源，无需跳转）。
    // xqdmOverride：多校区场景指定校区；缺省用页面默认校区
    async function fetchScheduleRows(doc, xnxq, xqdmOverride) {
        const root = doc || document;
        const xhidEl = root.querySelector("#xhid") || document.querySelector("#xhid");
        const xqdmEl = root.querySelector("#xqdm") || document.querySelector("#xqdm");
        const xhid = xhidEl ? (xhidEl.value || "") : "";
        const xqdm = xqdmOverride || (xqdmEl ? (xqdmEl.value || "") : "");
        if (!xhid || !xqdm) {
            console.warn("页面缺少 xhid/xqdm，无法请求课表数据");
            return null;
        }
        const params = new URLSearchParams({
            xnxq: xnxq,
            xhid: xhid,
            xqdm: xqdm,
            zdzc: "",
            zxzc: "",
            xskbxslx: "0",
        });
        const url = "/admin/xsd/pkgl/xskb/sdpkkbList?" + params.toString();
        console.log("请求课表数据:", url);
        try {
            const resp = await fetch(url, {
                credentials: "same-origin",
                headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            if (!resp.ok) return null;
            const json = await resp.json();
            if (json.ret !== 0) return null;
            return json.data || [];
        } catch (error) {
            console.error("请求课表数据失败:", error);
            return null;
        }
    }

    // 把接口返回的课表 JSON 行解析为课程
    // 复刻页面逻辑：同格同课程合并周次 -> 相邻节次同内容合并（rowspan）
    function parseCoursesFromRows(rows) {
        const byCell = new Map();
        rows.forEach((row) => {
            const name = stripHtmlText(row.kcmc);
            const teacher = stripHtmlText(row.tmc);
            const position = stripHtmlText(row.croommc);
            const day = parseInt(row.xingqi, 10);
            const djc = parseInt(row.djc, 10);
            const weeks = parseWeeksFromRow(row);
            if (!name || !Number.isFinite(day) || !Number.isFinite(djc) || !weeks.length) return;
            const cellKey = day + "-" + djc;
            if (!byCell.has(cellKey)) byCell.set(cellKey, new Map());
            const cell = byCell.get(cellKey);
            const courseKey = [name, teacher, position].join("|");
            if (!cell.has(courseKey)) {
                cell.set(courseKey, { name, teacher, position, weeks: new Set(weeks) });
            } else {
                weeks.forEach((w) => cell.get(courseKey).weeks.add(w));
            }
        });

        let maxDjc = 0;
        rows.forEach((row) => {
            const djc = parseInt(row.djc, 10);
            if (Number.isFinite(djc)) maxDjc = Math.max(maxDjc, djc);
        });

        const courses = [];
        for (let day = 1; day <= 7; day += 1) {
            let runStart = null;
            let runSig = "";
            const flushRun = (endSection) => {
                if (runStart === null || !runSig) return;
                const cell = byCell.get(day + "-" + runStart);
                if (cell) {
                    cell.forEach((it) => {
                        courses.push({
                            id: createId(),
                            name: it.name,
                            teacher: it.teacher,
                            position: it.position,
                            day,
                            startSection: runStart,
                            endSection,
                            color: randomColor(),
                            weeks: Array.from(it.weeks).sort((a, b) => a - b),
                        });
                    });
                }
                runStart = null;
                runSig = "";
            };
            for (let s = 1; s <= maxDjc + 1; s += 1) {
                const cell = byCell.get(day + "-" + s);
                let sig = "";
                if (cell) {
                    sig = Array.from(cell.values())
                        .map((it) => [
                            it.name,
                            it.teacher,
                            it.position,
                            Array.from(it.weeks).sort((a, b) => a - b).join(","),
                        ].join("|"))
                        .sort()
                        .join("\u0001");
                }
                const ended = s === maxDjc + 1;
                if (runStart !== null && (ended || !sig || sig !== runSig)) {
                    flushRun(s - 1);
                }
                if (!ended && sig && runStart === null) {
                    runStart = s;
                    runSig = sig;
                }
            }
        }

        return mergeCourses(courses);
    }

    // ===== 学期配置（开学日期、总周数、时间段）=====
    // 数据来自 /admin/api/getZclistByXnxq：
    // - zclist 每周 minrq/maxrq，第 1 周的开始日期即开学日期
    // - jcsjszList 是各节次时间，可在“不在课表页”时生成时间段
    function parseTimeSlotsFromJcsjsz(jcsjszList) {
        const slots = [];
        (jcsjszList || []).forEach((j) => {
            const number = parseInt(j.jc, 10);
            if (!Number.isFinite(number)) return;
            slots.push({
                number,
                startTime: padTime(j.kssj),
                endTime: padTime(j.jssj),
            });
        });
        return slots.sort((a, b) => a.number - b.number);
    }

    function parseSemesterConfigFromZclist(json) {
        const data = (json && json.data) || {};
        const zclist = data.zclist || [];
        if (!zclist.length) return null;
        const sorted = zclist
            .slice()
            .sort((a, b) => parseInt(a.zc, 10) - parseInt(b.zc, 10));
        const weeks = sorted
            .map((w) => parseInt(w.zc, 10))
            .filter((n) => Number.isFinite(n));
        const semesterTotalWeeks = weeks.length ? Math.max(...weeks) : sorted.length;
        const first = sorted[0];
        const startDate = first && first.minrq ? String(first.minrq).slice(0, 10) : "";
        const timeSlots = parseTimeSlotsFromJcsjsz(data.jcsjszList);
        return { semesterStartDate: startDate, semesterTotalWeeks, timeSlots };
    }

    async function fetchSemesterConfig(doc, xnxq, xqidOverride) {
        const root = doc || document;
        const xqidEl = root.querySelector("#xqdm") || document.querySelector("#xqdm");
        const xqid = xqidOverride || (xqidEl ? (xqidEl.value || "") : "");
        const params = new URLSearchParams({
            xnxq: xnxq,
            role: "",
            userId: "",
            xqid: xqid,
        });
        const url = "/admin/api/getZclistByXnxq?" + params.toString();
        console.log("请求学期配置:", url);
        try {
            const resp = await fetch(url, {
                credentials: "same-origin",
                headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            if (!resp.ok) return null;
            const json = await resp.json();
            const config = parseSemesterConfigFromZclist(json);
            if (config) console.log("学期配置:", config);
            return config;
        } catch (error) {
            console.error("请求学期配置失败:", error);
            return null;
        }
    }

    // ===== 校区（学区）处理 =====
    // 只有开学日期/时间段可能随校区变化；若多个校区且结果不一致才询问，一致则直接用默认校区
    async function fetchCampusList() {
        const url = "/admin/api/jcsj/xqsj/getXqList";
        console.log("请求校区列表:", url);
        try {
            const resp = await fetch(url, {
                credentials: "same-origin",
                headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            if (!resp.ok) return [];
            const json = await resp.json();
            if (json.ret !== 0) return [];
            return (json.data || [])
                .map((c) => ({ id: c.id, name: c.xqmc }))
                .filter((c) => c.id);
        } catch (error) {
            console.error("请求校区列表失败:", error);
            return [];
        }
    }

    // 两个校区配置是否一致（开学日期/总周数/时间段）。
    // maxSection：只比较“课程实际用到的节次范围”内的作息，超出的节次差异忽略
    function sameSemesterConfig(a, b, maxSection) {
        if (!a || !b) return false;
        if (a.semesterStartDate !== b.semesterStartDate) return false;
        if (a.semesterTotalWeeks !== b.semesterTotalWeeks) return false;
        const limit = Number.isFinite(maxSection) && maxSection > 0 ? maxSection : Infinity;
        const t1 = (a.timeSlots || []).filter((s) => s.number <= limit);
        const t2 = (b.timeSlots || []).filter((s) => s.number <= limit);
        if (t1.length !== t2.length) return false;
        return t1.every(
            (s, i) =>
                s.number === t2[i].number &&
                s.startTime === t2[i].startTime &&
                s.endTime === t2[i].endTime
        );
    }

    // 决定要使用的校区 id：
    // - 1 个校区：直接用默认，不询问
    // - 多个校区：逐个取配置对比（只在 maxSection 范围内比较），一致则不询问；
    //   不一致才弹窗选择（取消返回 CANCELED 终止）
    async function resolveCampusId(doc, xnxq, maxSection) {
        const root = doc || document;
        const xqdmEl = root.querySelector("#xqdm") || document.querySelector("#xqdm");
        const defaultId = xqdmEl ? (xqdmEl.value || "") : "";
        const campuses = await fetchCampusList();
        if (campuses.length <= 1) {
            console.log("校区数:", campuses.length, "，使用默认校区:", defaultId);
            return defaultId;
        }

        // 多校区：逐个拉配置对比
        const configs = [];
        for (const c of campuses) {
            const cfg = await fetchSemesterConfig(doc, xnxq, c.id);
            configs.push({ campus: c, cfg });
            console.log("校区", c.name, "配置:", cfg);
        }
        const firstCfg = configs[0].cfg;
        const allSame = configs.every((x) => sameSemesterConfig(x.cfg, firstCfg, maxSection));
        if (allSame) {
            console.log("各校区开学日期/时间段一致，无需选择校区，使用默认:", defaultId);
            return defaultId;
        }

        console.log("各校区作息不一致，弹出校区选择...");
        if (!canShowSingleSelection()) {
            console.warn("shiguangBridgePromise.showSingleSelection 不可用，使用默认校区");
            return defaultId;
        }
        const labels = campuses.map((c) => c.name);
        const defaultIndex = Math.max(0, campuses.findIndex((c) => c.id === defaultId));
        let selectedIndex;
        try {
            selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                "检测到多个校区且作息不同，请选择要导出的校区",
                JSON.stringify(labels),
                defaultIndex
            );
        } catch (error) {
            console.error("校区选择失败，使用默认校区:", error);
            return defaultId;
        }
        if (selectedIndex === null) {
            console.log("用户取消校区选择，终止导入");
            return CANCELED;
        }
        const chosen = campuses[selectedIndex];
        if (!chosen) return defaultId;
        console.log("用户选择校区:", chosen.name, chosen.id);
        return chosen.id;
    }

    // 课程实际用到的最大节次
    function maxSectionFromRows(rows) {
        let max = 0;
        rows.forEach((r) => {
            const d = parseInt(r.djc, 10);
            if (Number.isFinite(d)) max = Math.max(max, d);
        });
        return max;
    }

    function maxSectionFromCourses(courses) {
        let max = 0;
        courses.forEach((c) => {
            if (Number.isFinite(c.endSection)) max = Math.max(max, c.endSection);
        });
        return max;
    }

    // ===== 不在课表页时的自动处理 =====
    // 首页/选课页等没有课表 DOM：抓一次课表页 HTML 拿 xhid/xqdm/当前学期/学期列表，
    // 后续全部走接口，无需跳转
    function parseSchedulePageSessionFromHtml(html) {
        const inputVal = (id) => {
            const m = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*value="([^"]*)"'));
            return m ? m[1].trim() : "";
        };
        const xhid = inputVal("xhid");
        const xqdm = inputVal("xqdm");
        const xnxq = inputVal("xnxq");
        const semesterOptions = [];
        const selMatch = html.match(/<select[^>]*id="xnxq1"[^>]*>([\s\S]*?)<\/select>/);
        if (selMatch) {
            const optRe = /<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g;
            let m;
            while ((m = optRe.exec(selMatch[1]))) {
                const value = m[1].trim();
                const text = m[3].trim();
                if (value && text) semesterOptions.push({ value, text });
            }
        }
        if (!xhid || !xqdm || !semesterOptions.length) return null;
        return { xhid, xqdm, xnxq, semesterOptions };
    }

    // 首页上没有“当前学年学期”输入框时，从校区接口拿到当前学年学期（dataXnxq）。
    // 直接请求无参 queryKbForXsd 时，若当前学期未发布会返回“当前学年学期课表未发布”，
    // 但加上 xnxq 参数后仍能打开课表页并拿到 xhid/xqdm/历史学期下拉框。
    async function fetchCurrentDataXnxq() {
        try {
            const resp = await fetch("/admin/api/jcsj/xqsj/getXqList", {
                credentials: "same-origin",
                headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            if (!resp.ok) return "";
            const json = await resp.json();
            if (json.ret !== 0) return "";
            const xnxq = (json.data || [])
                .map((c) => c && c.dataXnxq)
                .find(Boolean) || "";
            if (xnxq) console.log("从校区接口获取当前学年学期:", xnxq);
            return xnxq;
        } catch (error) {
            console.warn("获取当前学年学期失败:", error);
            return "";
        }
    }

    async function fetchSchedulePageSession() {
        const base = "/admin/xsd/pkgl/xskb/queryKbForXsd";
        const candidates = [];
        const urlXnxq = new URLSearchParams(location.search).get("xnxq");
        if (urlXnxq) candidates.push(base + "?xnxq=" + encodeURIComponent(urlXnxq));

        const currentXnxq = await fetchCurrentDataXnxq();
        if (currentXnxq) {
            candidates.push(base + "?xnxq=" + encodeURIComponent(currentXnxq));
        }
        // 最后兜底尝试无参（若本学期已发布，无参页面也能正常打开）
        candidates.push(base);

        const seen = new Set();
        for (const url of candidates) {
            if (seen.has(url)) continue;
            seen.add(url);
            console.log("自动抓取课表页参数:", url);
            try {
                const resp = await fetch(url, { credentials: "same-origin" });
                if (!resp.ok) continue;
                const html = await resp.text();
                const session = parseSchedulePageSessionFromHtml(html);
                if (session) {
                    console.log(
                        "已获取课表页参数: 当前学期=",
                        session.xnxq,
                        "学期数=",
                        session.semesterOptions.length
                    );
                    return session;
                }
            } catch (error) {
                console.error("自动抓取课表页参数失败:", url, error);
            }
        }
        return null;
    }

    // 用抓取到的参数构造一个最小“页面对象”，复用现有读学期/读 xhid/xqdm 的逻辑
    function makeSessionDoc(session) {
        return {
            querySelectorAll: (sel) =>
                sel === "#xnxq1 option"
                    ? session.semesterOptions.map((o) => ({
                          getAttribute: (a) => (a === "value" ? o.value : null),
                          textContent: o.text,
                      }))
                    : [],
            querySelector: (sel) => {
                if (sel === "#xnxq") return { value: session.xnxq, textContent: session.xnxq };
                if (sel === "#xhid") return { value: session.xhid };
                if (sel === "#xqdm") return { value: session.xqdm };
                return null;
            },
        };
    }

    // 收尾：教师工号询问 -> 重复课程询问 -> 保存（任一步取消即终止）
    async function finalizeAndSave(courses, timeSlots, semesterConfig) {
        // 教师姓名带工号时，弹窗询问是否去除（默认保留）
        const teacherIdChoice = await askKeepTeacherId(courses);
        if (teacherIdChoice === CANCELED) {
            toast("已取消，终止导入");
            return;
        }
        if (teacherIdChoice === "strip") {
            courses.forEach((course) => {
                course.teacher = stripTeacherId(course.teacher);
            });
        }

        // 内容完全一致的重复/冲突课程：弹窗询问如何处理（全部保留/去重/合并教师）
        const dupChoice = await askHandleDuplicateCourses(courses);
        if (dupChoice === CANCELED) {
            toast("已取消，终止导入");
            return;
        }
        if (dupChoice === "dedupe") {
            toast("已去除重复课程");
        } else if (dupChoice === "merge") {
            toast("已合并重复课程的教师");
        }

        // 最后走一层官方参考的合并去重函数：
        // 合并连续节次、合并同节次单双周、清理完全重复记录。
        courses = mergeAndDistinctCourses(courses);
        console.log("官方合并去重后课程数:", courses.length);

        try {
            const result = await window.shiguangBridgePromise.saveImportedCourses(
                JSON.stringify(courses)
            );
            if (result === true) {
                if (timeSlots.length) {
                    await window.shiguangBridgePromise.savePresetTimeSlots(
                        JSON.stringify(timeSlots)
                    );
                }
                if (
                    semesterConfig &&
                    window.shiguangBridgePromise &&
                    typeof window.shiguangBridgePromise.saveCourseConfig === "function"
                ) {
                    await window.shiguangBridgePromise.saveCourseConfig(
                        JSON.stringify({
                            semesterStartDate: semesterConfig.semesterStartDate,
                            semesterTotalWeeks: semesterConfig.semesterTotalWeeks,
                            firstDayOfWeek: 1,
                        })
                    );
                }
                toast("课表导出成功");
                window.shiguangBridge.notifyTaskCompletion();
            } else {
                toast("课表导出失败，请查看控制台日志");
            }
        } catch (error) {
            toast("导出失败: " + error.message);
        }
    }

    async function run() {
        let doc = await getTargetDocument();
        let session = null;

        if (!doc) {
            // 不在“我的课表”页面（首页/选课页等）：自动抓课表页参数（xhid/xqdm/学期列表），全程走接口
            session = await fetchSchedulePageSession();
            if (!session) {
                toast("未找到课表页面，请手动打开“我的课表”后重试");
                return;
            }
        } else if (!doc.querySelector("#xnxq1")) {
            // 当前课表页无学期下拉框（例如无参打开时报“当前学年学期课表未发布”）：
            // 自动带 xnxq 参数重新抓一份含历史学期列表的课表页，改用接口导出。
            session = await fetchSchedulePageSession();
            if (session) {
                console.log("当前课表页无学期下拉框，改用自动抓取的课表页参数（含历史学期）");
                doc = null;
            }
        }

        // 获取课表前先询问要导出的学期（不在课表页时用抓取到的学期列表）
        const semDoc = doc || makeSessionDoc(session);
        const chosenXnxq = await askChooseSemester(semDoc);
        if (chosenXnxq === CANCELED) {
            toast("已取消，终止导入");
            return;
        }
        const currentXnxq = getCurrentXnxq(semDoc);
        const exportXnxq = chosenXnxq || currentXnxq;

        // 统一走接口拿课程（xqdm 不影响课程列表，先用默认校区）
        const rows = await fetchScheduleRows(semDoc, exportXnxq);
        if (rows && rows.length) {
            const maxSection = maxSectionFromRows(rows);
            const campusId = await resolveCampusId(semDoc, exportXnxq, maxSection);
            if (campusId === CANCELED) {
                toast("已取消，终止导入");
                return;
            }
            const courses = parseCoursesFromRows(rows);
            if (!courses.length) {
                toast("未解析到课程，请确认课表已加载完成");
                return;
            }
            const semesterConfig = await fetchSemesterConfig(semDoc, exportXnxq, campusId);
            // 时间段：优先接口 jcsjszList；课表页时间列作补充
            let timeSlots = (semesterConfig && semesterConfig.timeSlots) || [];
            if (!timeSlots.length && doc) timeSlots = parseTimeSlots(doc);
            toast("已获取 " + exportXnxq + " 的课表");
            await finalizeAndSave(courses, timeSlots, semesterConfig);
            return;
        }

        // 接口拿不到且当前就在课表页：回退解析页面已渲染的 DOM
        if (doc) {
            await waitForScheduleData(doc);
            const courses = parseScheduleFromDocument(doc);
            if (courses.length) {
                const maxSection = maxSectionFromCourses(courses);
                const campusId = await resolveCampusId(semDoc, exportXnxq, maxSection);
                if (campusId === CANCELED) {
                    toast("已取消，终止导入");
                    return;
                }
                const semesterConfig = await fetchSemesterConfig(semDoc, exportXnxq, campusId);
                let timeSlots = parseTimeSlots(doc);
                if (!timeSlots.length) {
                    timeSlots = (semesterConfig && semesterConfig.timeSlots) || [];
                }
                toast("已获取 " + exportXnxq + " 的课表（页面数据）");
                await finalizeAndSave(courses, timeSlots, semesterConfig);
                return;
            }
        }

        toast("所选学期没有可导出的课表数据（" + exportXnxq + "）");
    }
    run();
})();
