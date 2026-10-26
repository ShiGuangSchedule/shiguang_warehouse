// 课表以空 HTML 表格返回，课程数据通过 JavaScript 脚本动态注入
// 脚本中包含 `new TaskActivity(...)` 构造函数调用来定义课程
// 需要从脚本文本中直接提取课程信息，而不是解析 DOM

(function () {
    const BASE = "https://jwc3-yangtzeu-edu-cn-s.atrust.yangtzeu.edu.cn";
    function extractCourseHtmlDebugInfo(courseHtml) {
        const text = String(courseHtml || "");
        const hasTaskActivity = /new\s+TaskActivity\s*\(/i.test(text);
        const hasUnitCount = /\bvar\s+unitCount\s*=\s*\d+/i.test(text);
        return {
            responseLength: text.length,
            hasTaskActivity,
            hasUnitCount
        };
    }
    async function requestText(url, options) {
        const requestOptions = {
            credentials: "include",
            ...options
        };
        const res = await fetch(url, requestOptions);
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`网络请求失败: ${res.status}`);
        }
        return text;
    }

    // 从入口页提取学生 ID 和学期组件 tagId
    function parseEntryParams(entryHtml) {
        const idsMatch = entryHtml.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
        const tagIdMatch = entryHtml.match(/id="(semesterBar\d+Semester)"/);
        return {
            studentId: idsMatch ? idsMatch[1] : "",
            tagId: tagIdMatch ? tagIdMatch[1] : ""
        };
    }

    // 学期接口返回对象字面量，这里按脚本文本解析
    function parseSemesterResponse(rawText) {
        let data;
        try {
            data = Function(`return (${String(rawText || "").trim()});`)();
        } catch (_) {
            throw new Error("学期数据解析失败");
        }
        const semesters = [];
        if (!data || !data.semesters || typeof data.semesters !== "object") {
            return semesters;
        }
        Object.keys(data.semesters).forEach((k) => {
            const arr = data.semesters[k];
            if (!Array.isArray(arr)) return;
            arr.forEach((s) => {
                if (!s || !s.id) return;
                semesters.push({
                    id: String(s.id),
                    name: `${s.schoolYear || ""} 第${s.name || ""}学期`.trim()
                });
            });
        });
        return semesters;
    }

    // 清除课程名后面的课程序号
    function cleanCourseName(name) {
        return String(name || "").replace(/\([\d.]+\)\s*$/, "").trim();
    }

    // 解析周次位图字符串
    function parseValidWeeksBitmap(bitmap) {
        if (!bitmap || typeof bitmap !== "string") return [];
        const weeks = [];
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === "1" && i >= 1) weeks.push(i);
        }
        return weeks;
    }
    function normalizeWeeks(weeks) {
        const list = Array.from(new Set((weeks || []).filter((w) => Number.isInteger(w) && w > 0)));
        list.sort((a, b) => a - b);
        return list;
    }

    // 节次编号与 TimeSlots 编号映射
    function mapSectionToTimeSlotNumber(section) {
        const mapping = {
            1: 1,
            2: 2,
            3: 4,
            4: 5,
            5: 7,
            6: 8,
            7: 3,
            8: 6
        };
        return mapping[section] || section;
    }

    // 反引号化 JavaScript 字面量字符串，处理转义字符
    function unquoteJsLiteral(token) {
        const text = String(token || "").trim();
        if (!text) return "";
        if (text === "null" || text === "undefined") return "";
        if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
            const quote = text[0];
            let inner = text.slice(1, -1);
            inner = inner
                .replace(/\\\\/g, "\\")
                .replace(new RegExp(`\\\\${quote}`, "g"), quote)
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t");
            return inner;
        }
        return text;
    }

    // 分割 JavaScript 函数参数字符串，正确处理引号和转义
    function splitJsArgs(argsText) {
        const args = [];
        let curr = "";
        let inQuote = "";
        let escaped = false;
        for (let i = 0; i < argsText.length; i++) {
            const ch = argsText[i];
            if (escaped) {
                curr += ch;
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                curr += ch;
                escaped = true;
                continue;
            }
            if (inQuote) {
                curr += ch;
                if (ch === inQuote) inQuote = "";
                continue;
            }
            if (ch === "\"" || ch === "'") {
                curr += ch;
                inQuote = ch;
                continue;
            }
            if (ch === ",") {
                args.push(curr.trim());
                curr = "";
                continue;
            }
            curr += ch;
        }
        if (curr.trim() || argsText.endsWith(",")) {
            args.push(curr.trim());
        }
        return args;
    }

    // 读取构造参数，避免教师表达式或课程名中的括号提前结束匹配。
    function readTaskActivityArgs(text, start) {
        let depth = 1;
        let quote = "";
        let escaped = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (quote) {
                if (escaped) escaped = false;
                else if (ch === "\\") escaped = true;
                else if (ch === quote) quote = "";
                continue;
            }
            if (ch === "\"" || ch === "'") quote = ch;
            else if (ch === "(") depth++;
            else if (ch === ")" && --depth === 0) {
                return { argsText: text.slice(start, i), end: i + 1 };
            }
        }
        return null;
    }

    // 每个 TaskActivity 可以分配到多个节次，先划分课程声明，再读取其全部 index。
    function parseCoursesFromTaskActivityScript(htmlText) {
        const text = String(htmlText || "");
        if (!text) return [];
        const unitCountMatch = text.match(/\bvar\s+unitCount\s*=\s*(\d+)\s*;/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 0;
        if (!Number.isInteger(unitCount) || unitCount <= 0) return [];
        const courses = [];
        const activities = [];
        const activityRe = /\bactivity\s*=\s*new\s+TaskActivity\s*\(/g;
        let match;
        while ((match = activityRe.exec(text)) !== null) {
            const call = readTaskActivityArgs(text, activityRe.lastIndex);
            if (!call) continue;
            activities.push({ ...call, start: match.index });
            activityRe.lastIndex = call.end;
        }
        for (let i = 0; i < activities.length; i++) {
            const activity = activities[i];
            const args = splitJsArgs(activity.argsText);
            if (args.length < 7) continue;
            let teacher = unquoteJsLiteral(args[1]);
            // 教师值为 JS 表达式时，尝试解析或置空以触发兜底
            if (teacher && /\.join\s*\(/.test(teacher)) {
                const resolved = resolveTeachersForTaskActivityBlock(text, activity.start, teacher);
                teacher = resolved || "";
            }
            const name = cleanCourseName(unquoteJsLiteral(args[3]));
            const position = unquoteJsLiteral(args[5]);
            const weekBitmap = unquoteJsLiteral(args[6]);
            const weeks = normalizeWeeks(parseValidWeeksBitmap(weekBitmap));
            if (!name) continue;
            const end = i + 1 < activities.length ? activities[i + 1].start : text.length;
            const assignments = text.slice(activity.end, end);
            const indexRe = /\bindex\s*=\s*(?:(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)|(\d+))\s*;\s*table\d+\.activities\[index\]/g;
            let indexMatch;
            while ((indexMatch = indexRe.exec(assignments)) !== null) {
                const indexValue = indexMatch[3] != null
                    ? parseInt(indexMatch[3], 10)
                    : parseInt(indexMatch[1], 10) * unitCount + parseInt(indexMatch[2], 10);
                if (!Number.isInteger(indexValue) || indexValue < 0) continue;
                const day = Math.floor(indexValue / unitCount) + 1;
                const section = mapSectionToTimeSlotNumber((indexValue % unitCount) + 1);
                if (day < 1 || day > 7 || section < 1 || section > 16) continue;
                courses.push({
                    name,
                    teacher,
                    position,
                    day,
                    startSection: section,
                    endSection: section,
                    weeks
                });
            }
        }
        return mergeContiguousSections(courses);
    }

    // 当教师名为表达式时，尝试在附近代码中回溯真实教师名
    function resolveTeachersForTaskActivityBlock(fullText, blockStartIndex, teacherExpr) {
        const start = Math.max(0, blockStartIndex - 2200);
        const segment = fullText.slice(start, blockStartIndex);
        // 从表达式中提取变量名（如 actTeacherName.join(',') → actTeacherName）
        let varName = "actTeachers";
        const varMatch = String(teacherExpr || "").match(/^(\w+)\.join/);
        if (varMatch) varName = varMatch[1];
        const varNames = [varName];
        if (varName !== "actTeachers") varNames.push("actTeachers");
        for (const vn of varNames) {
            const re = new RegExp(`var\\s+${vn}\\s*=\\s*\\[([^]*?)\\]\\s*;`, "g");
            let m;
            let last = null;
            while ((m = re.exec(segment)) !== null) {
                last = m[1];
            }
            if (!last) continue;
            const names = [];
            const nameRe = /name\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
            let nm;
            while ((nm = nameRe.exec(last)) !== null) {
                const name = (nm[1] || nm[2] || "").trim();
                if (name) names.push(name);
            }
            if (names.length > 0) return Array.from(new Set(names)).join(",");
        }
        return "";
    }

    // 合并同一课程的连续节次
    function mergeContiguousSections(courses) {
        const list = (courses || [])
            .filter((c) => c && c.name && Number.isInteger(c.day) && Number.isInteger(c.startSection) && Number.isInteger(c.endSection))
            .map((c) => ({
                ...c,
                weeks: normalizeWeeks(c.weeks)
            }));
        list.sort((a, b) => {
            const ak = `${a.name}|${a.teacher}|${a.position}|${a.day}|${a.weeks.join(",")}`;
            const bk = `${b.name}|${b.teacher}|${b.position}|${b.day}|${b.weeks.join(",")}`;
            if (ak < bk) return -1;
            if (ak > bk) return 1;
            return a.startSection - b.startSection;
        });
        const merged = [];
        for (const item of list) {
            const prev = merged[merged.length - 1];
            const sameCourse = prev
                && prev.name === item.name
                && prev.teacher === item.teacher
                && prev.position === item.position
                && prev.day === item.day
                && JSON.stringify(prev.weeks) === JSON.stringify(item.weeks);
            const isContiguous = sameCourse && prev.endSection + 1 === item.startSection;

            if (isContiguous) {
                prev.endSection = Math.max(prev.endSection, item.endSection);
            } else {
                merged.push({ ...item });
            }
        }
        return merged;
    }
    function getPresetTimeSlots() {
        return [
            { number: 1, startTime: "08:00", endTime: "09:35" },
            { number: 2, startTime: "10:05", endTime: "11:40" },
            { number: 3, startTime: "12:00", endTime: "13:35" }, // 午间课
            { number: 4, startTime: "14:00", endTime: "15:35" },
            { number: 5, startTime: "16:05", endTime: "17:40" },
            { number: 6, startTime: "17:45", endTime: "18:30" }, // 晚间课，部分课程为 18:00-18:45
            { number: 7, startTime: "19:00", endTime: "20:35" },
            { number: 8, startTime: "20:45", endTime: "22:20" }
        ];
    }


    async function runImportFlow() {
        if (!window.shiguangBridgePromise) {
            throw new Error("AndroidBridgePromise 不可用，无法进行导入交互。");
        }

        // 探测学生 ID 和学期组件
        const entryUrl = `${BASE}/eams/courseTableForStd.action?&sf_request_type=ajax`;
        const entryHtml = await requestText(entryUrl, {
            method: "GET",
            headers: { "x-requested-with": "XMLHttpRequest" }
        });
        const params = parseEntryParams(entryHtml);
        if (!params.studentId || !params.tagId) {
            await window.shiguangBridgePromise.showAlert(
                "参数探测失败",
                "未能识别学生 ID 或学期组件 tagId，请确认已登录后重试。",
                "确定"
            );
            return;
        }

        // 学期选择
        const semesterRaw = await requestText(`${BASE}/eams/dataQuery.action?sf_request_type=ajax`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `tagId=${encodeURIComponent(params.tagId)}&dataType=semesterCalendar`
        });
        const allSemesters = parseSemesterResponse(semesterRaw);
        if (allSemesters.length === 0) {
            throw new Error("学期列表为空，无法继续导入。");
        }
        const recentSemesters = allSemesters.slice(-8);
        const selectIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择导入学期",
            JSON.stringify(recentSemesters.map((s) => s.name || s.id)),
            -1
        );
        if (selectIndex === null) {
            window.shiguangBridge.showToast("已取消导入");
            return;
        }
        const selectedSemester = recentSemesters[selectIndex];
        window.shiguangBridge.showToast("正在获取课表数据...");

        // 拉取并解析课表
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
        const courses = parseCoursesFromTaskActivityScript(courseHtml);
        if (courses.length === 0) {
            const debugInfo = extractCourseHtmlDebugInfo(courseHtml);
            await window.shiguangBridgePromise.showAlert(
                "解析失败",
                `未能从课表响应中识别到课程。\n响应长度: ${debugInfo.responseLength}\n包含 TaskActivity: ${debugInfo.hasTaskActivity}\n包含 unitCount: ${debugInfo.hasUnitCount}`,
                "确定"
            );
            return;
        }
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(getPresetTimeSlots()));
        window.shiguangBridge.showToast(`导入成功，共 ${courses.length} 条课程`);
        window.shiguangBridge.notifyTaskCompletion();
    }
    (async function bootstrap() {
        try {
            await runImportFlow();
        } catch (error) {
            console.error("导入流程失败:", error);
            window.shiguangBridge.showToast(`导入失败：${error && error.message ? error.message : "请检查教务连接"}`);
        }
    })();
})();
