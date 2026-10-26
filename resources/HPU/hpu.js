// 文件: hpu.js
// 河南理工大学 树维教务系统课程表导入脚本
// 适配目标: zhjw.hpu.edu.cn (树维教务系统, Struts2 .action, /eams/ 路径) + uia.hpu.edu.cn 统一身份认证(CAS)
// 数据链路(已对 HPU 线上服务器实测):
//   1. GET  courseTableForStd.action?sf_request_type=ajax        → 解析 ids(学生) + tagId(学期栏)
//   2. POST dataQuery.action (dataType=semesterCalendar)          → 学期列表
//   3. POST courseTableForStd!courseTable.action (semester.id)    → 课表 HTML
//      课表 HTML 内课程以 TaskActivity JS 块内嵌(unitCount=11, bitmap周次), 表格骨架含节次/时间
//   4. 解析 TaskActivity → 课程; 解析 #manualArrangeCourseTable 节次格 → 时间段
// 兜底: 若当前页面已是渲染后的课表页(#manualArrangeCourseTable + .infoTitle), 直接解析 DOM
// 解析参考: HIIT/hiit_01.js (同款 eams 架构系统)
(function () {
    function showToast(message) {
        if (typeof window.shiguangBridge !== "undefined" && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(String(message || ""));
        } else {
            console.log("[HPU适配]", message);
        }
    }

    async function request(url, options) {
        const res = await fetch(url, { credentials: "include", ...(options || {}) });
        if (!res.ok) throw new Error("网络请求失败(" + res.status + "): " + url);
        return await res.text();
    }

    // ================= 通用小工具 =================
    const CN_DIGIT = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
    function cnDigit(c) { return CN_DIGIT[c] || 0; }
    function cnToInt(s) {
        if (!s) return 0;
        if (s === "十") return 10;
        const i = s.indexOf("十");
        if (i >= 0) {
            const tens = i > 0 ? cnDigit(s.charAt(0)) : 1;
            const ones = s.length > i + 1 ? cnDigit(s.charAt(i + 1)) : 0;
            return tens * 10 + ones;
        }
        return cnDigit(s);
    }

    function splitJsArgs(argsText) {
        const args = [];
        let current = "";
        let quote = "";
        let escaped = false;
        for (let i = 0; i < argsText.length; i++) {
            const ch = argsText[i];
            if (escaped) { current += ch; escaped = false; continue; }
            if (ch === "\\") { current += ch; escaped = true; continue; }
            if (quote) { current += ch; if (ch === quote) quote = ""; continue; }
            if (ch === "'" || ch === "\"") { current += ch; quote = ch; continue; }
            if (ch === ",") { args.push(current.trim()); current = ""; continue; }
            current += ch;
        }
        if (current.trim()) args.push(current.trim());
        return args;
    }

    function unquoteJsLiteral(token) {
        const text = String(token || "").trim();
        if (!text || text === "null" || text === "undefined") return "";
        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            const quote = text[0];
            return text.slice(1, -1)
                .replace(/\\\\/g, "\\")
                .replace(new RegExp("\\\\" + quote, "g"), quote)
                .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
        }
        return text;
    }

    function parseValidWeeksBitmap(bitmap) {
        const weeks = [];
        const text = String(bitmap || "");
        for (let i = 0; i < text.length; i++) {
            if (text[i] === "1" && i >= 1) weeks.push(i);
        }
        return weeks;
    }

    function normalizeWeeks(weeks) {
        return Array.from(new Set((weeks || []).filter(function (w) { return Number.isInteger(w) && w > 0; }))).sort(function (a, b) { return a - b; });
    }

    function cleanCourseName(name) {
        return String(name || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
    }

    function resolveTeachersForTaskActivityBlock(fullText, blockStartIndex) {
        const start = Math.max(0, blockStartIndex - 2500);
        const segment = fullText.slice(start, blockStartIndex);
        const teachersRegex = /var\s+teachers\s*=\s*\[([^]*?)\];/g;
        let lastTeachersBlock = "";
        let match;
        while ((match = teachersRegex.exec(segment)) !== null) lastTeachersBlock = match[1] || "";
        if (!lastTeachersBlock) return "";
        const names = [];
        const nameRegex = /name\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
        let nameMatch;
        while ((nameMatch = nameRegex.exec(lastTeachersBlock)) !== null) {
            const name = (nameMatch[1] || nameMatch[2] || "").trim();
            if (name) names.push(name);
        }
        return Array.from(new Set(names)).join(",");
    }

    // ================= 课程解析 (TaskActivity, 从 AJAX HTML) =================
    function parseCoursesFromTaskActivityScript(htmlText) {
        const text = String(htmlText || "");
        const unitCountMatch = text.match(/\bvar\s+unitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? Number(unitCountMatch[1]) : 0;
        if (!unitCount) return [];

        const courses = [];
        const blockRegex = /activity\s*=\s*new\s+TaskActivity\(([^]*?)\)\s*;([\s\S]*?)(?=activity\s*=\s*new\s+TaskActivity\(|table\d+\.marshalTable|$)/g;
        let match;
        while ((match = blockRegex.exec(text)) !== null) {
            const args = splitJsArgs(match[1] || "");
            if (args.length < 7) continue;

            let teacher = unquoteJsLiteral(args[1]);
            if (/join\s*\(/.test(String(args[1] || ""))) {
                teacher = resolveTeachersForTaskActivityBlock(text, match.index) || teacher;
            }
            const name = cleanCourseName(unquoteJsLiteral(args[3]));
            const position = String(unquoteJsLiteral(args[5]) || "").replace(/\s+/g, " ").trim();
            const weeks = normalizeWeeks(parseValidWeeksBitmap(unquoteJsLiteral(args[6])));
            if (!name) continue;

            const indexBlock = match[2] || "";
            const indexRegex = /index\s*=\s*(?:(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)|(\d+))\s*;/g;
            let indexMatch;
            while ((indexMatch = indexRegex.exec(indexBlock)) !== null) {
                let linearIndex = -1;
                if (indexMatch[1] != null && indexMatch[2] != null) {
                    linearIndex = Number(indexMatch[1]) * unitCount + Number(indexMatch[2]);
                } else if (indexMatch[3] != null) {
                    linearIndex = Number(indexMatch[3]);
                }
                if (linearIndex < 0) continue;
                const day = Math.floor(linearIndex / unitCount) + 1;
                const section = (linearIndex % unitCount) + 1;
                if (day < 1 || day > 7) continue;
                courses.push({
                    name: name,
                    teacher: teacher || "未知教师",
                    position: position || "待定",
                    day: day,
                    startSection: section,
                    endSection: section,
                    weeks: weeks
                });
            }
        }
        return mergeContiguousSections(courses);
    }

    function mergeContiguousSections(courses) {
        const normalized = (courses || []).map(function (c) {
            return { ...c, weeks: normalizeWeeks(c.weeks) };
        });
        normalized.sort(function (a, b) {
            const keyA = a.name + "|" + a.teacher + "|" + a.position + "|" + a.day + "|" + a.weeks.join(",");
            const keyB = b.name + "|" + b.teacher + "|" + b.position + "|" + b.day + "|" + b.weeks.join(",");
            if (keyA < keyB) return -1;
            if (keyA > keyB) return 1;
            return a.startSection - b.startSection;
        });
        const merged = [];
        normalized.forEach(function (course) {
            const previous = merged[merged.length - 1];
            const canMerge = previous
                && previous.name === course.name
                && previous.teacher === course.teacher
                && previous.position === course.position
                && previous.day === course.day
                && previous.weeks.join(",") === course.weeks.join(",")
                && previous.endSection + 1 >= course.startSection;
            if (canMerge) {
                previous.endSection = Math.max(previous.endSection, course.endSection);
            } else {
                merged.push({ ...course });
            }
        });
        return merged;
    }

    // ================= 时间段解析 (从 HTML 表格骨架) =================
    function parseTimeSlotsFromHtml(htmlText) {
        const doc = new DOMParser().parseFromString(String(htmlText || ""), "text/html");
        const slots = [];
        const slotMap = {};
        const table = doc.querySelector("#manualArrangeCourseTable");
        if (!table) return slots;
        table.querySelectorAll("tbody tr").forEach(function (row) {
            const cells = Array.from(row.querySelectorAll("td"));
            cells.forEach(function (cell) {
                const txt = (cell.textContent || "").replace(/\s+/g, "");
                const m = txt.match(/第([一二三四五六七八九十]+)节/);
                if (!m) return;
                const tm = txt.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
                if (!tm) return;
                const num = cnToInt(m[1]);
                if (num && !slotMap[num]) {
                    slotMap[num] = { number: num, startTime: tm[1], endTime: tm[2] };
                }
            });
        });
        Object.keys(slotMap).map(Number).sort(function (a, b) { return a - b; })
            .forEach(function (k) { slots.push(slotMap[k]); });
        return slots;
    }

    // ================= 兜底: DOM 解析(已渲染的课表页) =================
    function parseCourseCellFromInfoTitle(raw) {
        const clean = String(raw || "").replace(/;;;/g, " ")
            .replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
        const m = clean.match(/^(.+?)\(\d[\d.]*\)\s*\(([^)]*)\)\s*\(([^)]+)\)\s*$/);
        if (!m) return null;
        const info = m[3];
        const comma = info.indexOf(",");
        if (comma < 0) return null;
        // 周次字符串(可能含"单3-17"式样)直接转为 bitmap 语义
        const weekStr = info.substring(0, comma).trim();
        const weeks = [];
        const segs = weekStr.replace(/周/g, "").split(/[,，;；]/);
        segs.forEach(function (seg) {
            const isEven = seg.indexOf("双") >= 0;
            const isOdd = seg.indexOf("单") >= 0;
            const cleanSeg = seg.replace(/[单双]/g, "").trim();
            if (cleanSeg.indexOf("-") >= 0) {
                const p = cleanSeg.split("-");
                const s = parseInt(p[0], 10), e = parseInt(p[1], 10);
                if (!isNaN(s) && !isNaN(e)) {
                    for (let w = s; w <= e; w++) {
                        if (isEven && w % 2 !== 0) continue;
                        if (isOdd && w % 2 === 0) continue;
                        weeks.push(w);
                    }
                }
            } else {
                const n = parseInt(cleanSeg, 10);
                if (!isNaN(n) && n > 0) weeks.push(n);
            }
        });
        const finalWeeks = Array.from(new Set(weeks)).sort(function (a, b) { return a - b; });
        if (!finalWeeks.length) return null;
        return {
            name: m[1].trim(),
            teacher: m[2].trim() || "未知教师",
            position: info.substring(comma + 1).replace(/\s+/g, " ").trim() || "待定",
            weeks: finalWeeks
        };
    }

    function parseCoursesFromCurrentDom() {
        const table = document.querySelector("#manualArrangeCourseTable");
        if (!table) return [];
        const courses = [];
        const seen = {};
        table.querySelectorAll("tbody tr").forEach(function (tr) {
            const tds = Array.from(tr.querySelectorAll("td"));
            let labelIdx = -1, section = 0;
            tds.forEach(function (td, i) {
                const txt = (td.textContent || "").replace(/\s+/g, "");
                const m = txt.match(/第([一二三四五六七八九十]+)节/);
                if (m) { labelIdx = i; section = cnToInt(m[1]); }
            });
            if (labelIdx < 0) return;
            tds.forEach(function (td, i) {
                if (i <= labelIdx) return;
                if ((td.className || "").indexOf("infoTitle") < 0) return;
                const raw = td.getAttribute("title") || td.textContent || "";
                if (!raw.trim()) return;
                const day = i - labelIdx - 1;
                if (day < 0 || day > 6) return;
                const parsed = parseCourseCellFromInfoTitle(raw);
                if (!parsed) return;
                const rowspan = td.rowSpan > 1 ? td.rowSpan : 1;
                const key = [day, section, rowspan, parsed.name, parsed.teacher, parsed.position, parsed.weeks.join(",")].join("|");
                if (seen[key]) return;
                seen[key] = 1;
                courses.push({
                    name: parsed.name, teacher: parsed.teacher, position: parsed.position,
                    day: day + 1, startSection: section, endSection: section + rowspan - 1,
                    weeks: parsed.weeks
                });
            });
        });
        return courses;
    }

    // ================= AJAX 链路 =================
    async function detectParams() {
        if (/cas\/login|loginExt/i.test(window.location.href)) throw new Error("请先登录教务系统后再执行导入");
        const html = await request(window.location.origin + "/eams/courseTableForStd.action?sf_request_type=ajax", {
            headers: { "x-requested-with": "XMLHttpRequest" }
        });
        const idsM = html.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
        const tagM = html.match(/id="(semesterBar\d+Semester)"/);
        return (idsM && tagM) ? { ids: idsM[1], tagId: tagM[1] } : null;
    }

    async function fetchSemesters(tagId) {
        const raw = await request(window.location.origin + "/eams/dataQuery.action?sf_request_type=ajax", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: "tagId=" + encodeURIComponent(tagId) + "&dataType=semesterCalendar"
        });
        const data = Function("return (" + String(raw).trim() + ");")();
        const list = [];
        if (data && data.semesters && typeof data.semesters === "object") {
            Object.keys(data.semesters).forEach(function (k) {
                (data.semesters[k] || []).forEach(function (s) {
                    if (!s || !s.id) return;
                    const term = String(s.name || "").trim();
                    const termName = term === "1" ? "第一学期" : term === "2" ? "第二学期" : "第" + term + "学期";
                    list.push({
                        id: String(s.id),
                        schoolYear: String(s.schoolYear || "").trim(),
                        term: term,
                        name: (String(s.schoolYear || "") + "学年" + termName).trim()
                    });
                });
            });
        }
        return list;
    }

    // 按当前日期猜测所在学期(用于默认选中): 8-12月→该学年第一学期; 2-7月→上学年第二学期; 1月→上学年第一学期
    function guessCurrentSemesterIndex(semesters) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        let targetYear, targetTerm;
        if (m >= 8) { targetYear = y; targetTerm = "1"; }
        else if (m >= 2) { targetYear = y - 1; targetTerm = "2"; }
        else { targetYear = y - 1; targetTerm = "1"; }
        for (let i = 0; i < semesters.length; i++) {
            const s = semesters[i];
            if (s.schoolYear === targetYear + "-" + (targetYear + 1) && s.term === targetTerm) return i;
        }
        return semesters.length - 1;
    }

    async function fetchCourseHtml(params, semesterId) {
        return await request(window.location.origin + "/eams/courseTableForStd!courseTable.action?sf_request_type=ajax", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: "ignoreHead=1&setting.kind=std&startWeek=&semester.id=" + encodeURIComponent(semesterId) + "&ids=" + encodeURIComponent(params.ids)
        });
    }

    // ================= 保存 =================
    async function save(courses, timeSlots) {
        const okCourses = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (okCourses !== true) throw new Error("课程保存失败: " + String(okCourses));
        if (timeSlots && timeSlots.length) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
    }

    // ================= 主流程 =================
    async function runImportFlow() {
        // ① 已在渲染后的课表页 → DOM 直解
        let courses = parseCoursesFromCurrentDom();
        let timeSlots = [];
        if (courses.length) {
            showToast("已从当前课表页解析到 " + courses.length + " 门课");
        } else {
            // ② AJAX(可自选学期)
            showToast("正在识别课表参数...");
            const params = await detectParams();
            if (!params) throw new Error("未能自动识别课表参数，请登录后在任意教务页面重试");
            showToast("正在获取学期列表...");
            const semesters = await fetchSemesters(params.tagId);
            if (!semesters.length) throw new Error("未获取到学期列表");
            const showList = semesters.slice(-12); // 只展示最近6年, 避免列表过长
            const defaultIdx = Math.min(guessCurrentSemesterIndex(semesters), semesters.length - 1);
            const showDefault = Math.max(0, defaultIdx - (semesters.length - showList.length));
            const picked = await window.shiguangBridgePromise.showSingleSelection(
                "选择要导入的学期",
                JSON.stringify(showList.map(function (s) { return s.name; })),
                showDefault
            );
            if (picked === null || picked < 0 || picked >= showList.length) throw new Error("已取消导入");
            showToast("正在获取 " + showList[picked].name + " 课表...");
            const html = await fetchCourseHtml(params, showList[picked].id);
            courses = parseCoursesFromTaskActivityScript(html);
            timeSlots = parseTimeSlotsFromHtml(html);
            if (!courses.length) throw new Error("该学期未解析到课程，请确认有课或尝试其他学期");
        }
        await save(courses, timeSlots);
        showToast("导入成功，共 " + courses.length + " 门课程");
        if (typeof window.shiguangBridge !== "undefined" && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }

    (async function bootstrap() {
        try {
            await runImportFlow();
        } catch (e) {
            console.error("[HPU适配]", e);
            showToast("导入失败：" + (e && e.message ? e.message : String(e)));
        }
    })();
})();
