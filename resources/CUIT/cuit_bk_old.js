/**
 * 成都信息工程大学（树维教务）课表导入适配脚本 Fetch API
 */
(function() {
    const BASE = "http://jwgl.cuit.edu.cn";

    // ==================== 工具函数 ====================
    function unquoteJsLiteral(token) {
        const text = String(token || "").trim();
        if (!text) return "";
        if (text === "null" || text === "undefined") return "";
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1);
        }
        return text;
    }

    function splitJsArgs(argsText) {
        const args = [];
        let curr = "";
        let inQuote = "";
        let escaped = false;
        for (let i = 0; i < argsText.length; i++) {
            const ch = argsText[i];
            if (escaped) { curr += ch; escaped = false; continue; }
            if (ch === "\\") { curr += ch; escaped = true; continue; }
            if (inQuote) { curr += ch; if (ch === inQuote) inQuote = ""; continue; }
            if (ch === '"' || ch === "'") { curr += ch; inQuote = ch; continue; }
            if (ch === ",") { args.push(curr.trim()); curr = ""; continue; }
            curr += ch;
        }
        if (curr.trim() || argsText.endsWith(",")) args.push(curr.trim());
        return args;
    }

    function parseValidWeeksBitmap(bitmap) {
        if (!bitmap || typeof bitmap !== "string") return [];
        const weeks = [];
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === "1") weeks.push(i + 1);
        }
        return weeks;
    }

    function cleanCourseName(name) {
        return String(name || "").replace(/\(\d{10}\.\d{2}\)\s*$/, "").trim();
    }

    // ==================== 核心解析 ====================
    function parseCoursesFromHtml(htmlText) {
        const text = String(htmlText || "");
        if (!text) return [];

        const unitCountMatch = text.match(/\bvar\s+unitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 12;

        // 第一步：提取所有 actTeachers 定义块（用于解析教师姓名）
        const teacherBlocks = [];
        const teacherBlockRe = /var\s+teachers\s*=\s*\[(.*?)\];\s*var\s+actTeachers\s*=\s*\[(.*?)\];/gs;
        let tbMatch;
        while ((tbMatch = teacherBlockRe.exec(text)) !== null) {
            const teachersArrStr = tbMatch[1];
            const actTeachersArrStr = tbMatch[2];
            const nameRe = /name\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
            const names = [];
            let nm;
            const searchStr = actTeachersArrStr || teachersArrStr;
            while ((nm = nameRe.exec(searchStr)) !== null) {
                const name = (nm[1] || nm[2] || "").trim();
                if (name) names.push(name);
            }
            if (names.length > 0) {
                teacherBlocks.push({
                    startIndex: tbMatch.index,
                    endIndex: tbMatch.index + tbMatch[0].length,
                    teacherNames: names.join(',')
                });
            }
        }

        // 第二步：解析 TaskActivity 及 index 赋值，收集每门课的所有节次
        // 使用 Map 键为 "name|teacher|position|day|weeks" 值，存储节次数组
        const courseSectionsMap = new Map();
        const blockRe = /activity\s*=\s*new\s+TaskActivity\(([^]*?)\)\s*;([\s\S]*?)(?=activity\s*=\s*new\s+TaskActivity|$)/g;
        let match;

        while ((match = blockRe.exec(text)) !== null) {
            const argsText = match[1];
            const afterBlock = match[2];
            const blockStart = match.index;

            const args = splitJsArgs(argsText);
            if (args.length < 7) continue;

            let teacherExpr = args[1];
            const courseFull = unquoteJsLiteral(args[2]);
            let courseNameRaw = unquoteJsLiteral(args[3]);
            const classroom = unquoteJsLiteral(args[5]);
            const weekBitmap = unquoteJsLiteral(args[6]);

            let courseName = courseNameRaw || courseFull.replace(/\(.*\)/, "");
            courseName = cleanCourseName(courseName);
            if (!courseName) continue;

            const weeks = parseValidWeeksBitmap(weekBitmap);
            if (weeks.length === 0) continue;

            // 解析教师姓名
            let teacherNames = "";
            const teacherExprStr = String(teacherExpr).trim();
            if (teacherExprStr.includes('join') || teacherExprStr.includes('actTeacherName')) {
                for (let i = teacherBlocks.length - 1; i >= 0; i--) {
                    const tb = teacherBlocks[i];
                    if (tb.startIndex < blockStart) {
                        teacherNames = tb.teacherNames;
                        break;
                    }
                }
            } else {
                teacherNames = unquoteJsLiteral(teacherExpr);
            }

            // 提取该 activity 被赋值的所有 index，得到 day 和 section
            const indexRe = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)\s*;/g;
            let idxMatch;
            while ((idxMatch = indexRe.exec(afterBlock)) !== null) {
                const dayIdx = parseInt(idxMatch[1], 10);
                const sectionIdx = parseInt(idxMatch[2], 10);
                const day = dayIdx + 1;
                const section = sectionIdx + 1;

                // 唯一键（不含节次）
                const baseKey = `${courseName}|${teacherNames}|${classroom}|${day}|${weeks.join(',')}`;

                if (!courseSectionsMap.has(baseKey)) {
                    courseSectionsMap.set(baseKey, {
                        name: courseName,
                        teacher: teacherNames,
                        position: classroom,
                        day: day,
                        weeks: weeks,
                        sections: new Set()
                    });
                }
                courseSectionsMap.get(baseKey).sections.add(section);
            }
        }

        // 第三步：将节次 Set 转换为连续区间，生成最终课程列表
        const courses = [];
        for (const [_, data] of courseSectionsMap) {
            const sections = Array.from(data.sections).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            // 分组连续节次
            let start = sections[0];
            let end = sections[0];
            for (let i = 1; i < sections.length; i++) {
                if (sections[i] === end + 1) {
                    end = sections[i];
                } else {
                    courses.push({
                        name: data.name,
                        teacher: data.teacher,
                        position: data.position,
                        day: data.day,
                        startSection: start,
                        endSection: end,
                        weeks: data.weeks,
                        isCustomTime: false
                    });
                    start = sections[i];
                    end = sections[i];
                }
            }
            // 最后一组
            courses.push({
                name: data.name,
                teacher: data.teacher,
                position: data.position,
                day: data.day,
                startSection: start,
                endSection: end,
                weeks: data.weeks,
                isCustomTime: false
            });
        }

        return courses;
    }

    // ==================== 学期与入口参数解析（同前）====================
    async function requestText(url, options) {
        const res = await fetch(url, { credentials: "include", ...options });
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return await res.text();
    }

    function parseEntryParams(entryHtml) {
        const idsMatch = entryHtml.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
        const tagIdMatch = entryHtml.match(/id="(semesterBar\d+Semester)"/);
        return {
            studentId: idsMatch ? idsMatch[1] : "",
            tagId: tagIdMatch ? tagIdMatch[1] : ""
        };
    }

    function parseSemesterResponse(rawText) {
        let data;
        try {
            data = Function(`return (${String(rawText).trim()});`)();
        } catch {
            throw new Error("学期数据解析失败");
        }
        const semesters = [];
        if (!data || !data.semesters) return semesters;
        Object.keys(data.semesters).forEach(k => {
            const arr = data.semesters[k];
            if (!Array.isArray(arr)) return;
            arr.forEach(s => {
                if (!s || !s.id) return;
                semesters.push({
                    id: String(s.id),
                    name: `${s.schoolYear || ""} ${s.name || ""}学期`.trim()
                });
            });
        });
        return semesters;
    }

    function getPresetTimeSlots() {
        return [
            { number: 1, startTime: "08:20", endTime: "09:05" },
            { number: 2, startTime: "09:15", endTime: "10:00" },
            { number: 3, startTime: "10:20", endTime: "11:05" },
            { number: 4, startTime: "11:15", endTime: "12:00" },
            { number: 5, startTime: "14:00", endTime: "14:45" },
            { number: 6, startTime: "14:55", endTime: "15:40" },
            { number: 7, startTime: "15:50", endTime: "16:35" },
            { number: 8, startTime: "16:45", endTime: "17:30" },
            { number: 9, startTime: "17:40", endTime: "18:25" },
            { number: 10, startTime: "19:30", endTime: "20:15" },
            { number: 11, startTime: "20:25", endTime: "21:10" },
            { number: 12, startTime: "21:20", endTime: "22:05" }
        ];
    }

    // ==================== 主导入流程 ====================
    async function runImportFlow() {
        if (!window.shiguangBridgePromise) throw new Error("AndroidBridgePromise 不可用");
        window.shiguangBridge.showToast("正在探测教务参数...");

        const entryHtml = await requestText(`${BASE}/eams/courseTableForStd.action?&sf_request_type=ajax`, {
            method: "GET",
            headers: { "x-requested-with": "XMLHttpRequest" }
        });
        const params = parseEntryParams(entryHtml);
        if (!params.studentId || !params.tagId) {
            await window.shiguangBridgePromise.showAlert("参数探测失败", "未能识别学生ID或学期组件", "确定");
            return;
        }

        const semesterRaw = await requestText(`${BASE}/eams/dataQuery.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `tagId=${encodeURIComponent(params.tagId)}&dataType=semesterCalendar`
        });
        const allSemesters = parseSemesterResponse(semesterRaw);
        if (allSemesters.length === 0) throw new Error("学期列表为空");
        const recentSemesters = allSemesters.slice(-8);
        const selectIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择导入学期",
            JSON.stringify(recentSemesters.map(s => s.name || s.id)),
            recentSemesters.length - 1
        );
        if (selectIndex === null) {
            window.shiguangBridge.showToast("已取消导入");
            return;
        }
        const selectedSemester = recentSemesters[selectIndex];
        window.shiguangBridge.showToast("正在获取课表数据...");

        const courseHtml = await requestText(`${BASE}/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: [
                "ignoreHead=1",
                "setting.kind=std",
                "startWeek=",
                `semester.id=${encodeURIComponent(selectedSemester.id)}`,
                `ids=${encodeURIComponent(params.studentId)}`
            ].join("&")
        });

        const courses = parseCoursesFromHtml(courseHtml);
        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert("解析失败", "未提取到课程数据", "确定");
            return;
        }

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程`);

        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(getPresetTimeSlots()));

        window.shiguangBridge.notifyTaskCompletion();
    }

    (async function bootstrap() {
        try {
            await runImportFlow();
        } catch (error) {
            console.error("导入流程失败:", error);
            window.shiguangBridge.showToast("导入失败: " + error.message);
        }
    })();
})();