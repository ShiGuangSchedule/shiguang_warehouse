// 中山大学研究生教务系统拾光课表适配脚本
// 适配系统：cms.sysu.edu.cn /mk/student-web/（研究生课表查询）
// 直接调用课表查询接口 selectStudentClassTable 抓取课表（同源 fetch，自动携带登录会话），不解析页面 DOM

(function () {
    "use strict";

    // ---------- 通用工具 ----------

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log("[SYSU]", message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    // ---------- 作息时间(中山大学研究生, 11 节) ----------

    const TIME_SLOTS = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:10", endTime: "10:55" },
        { number: 4, startTime: "11:05", endTime: "11:50" },
        { number: 5, startTime: "14:20", endTime: "15:05" },
        { number: 6, startTime: "15:15", endTime: "16:00" },
        { number: 7, startTime: "16:30", endTime: "17:15" },
        { number: 8, startTime: "17:25", endTime: "18:10" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" },
        { number: 11, startTime: "20:50", endTime: "21:35" }
    ];

    // ================================================================
    // 主路径: 接口直取
    // ================================================================

    const SCHEDULE_API = "/start-class/classTableInfo/selectStudentClassTable";
    const CALENDAR_API = "/base-info/school-calender"; // 校历
    const MENU_CODE = "byytxsd_xskbcx_week_query"; // 学生课表查询菜单 code

    // 响应 JSON 里的星期字段名 -> 拾光 day(1=周一..7=周日)
    const DAY_KEYS = {
        monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
        friday: 5, saturday: 6, sunday: 7
    };

    /** 从当前页面自动探测学年学期, 如 "2026-1"; 找不到返回 null */
    function detectAcademicYear() {
        // 1) URL 参数
        const urlMatch = location.href.match(/academicYear=([^&]+)/);
        if (urlMatch) return decodeURIComponent(urlMatch[1]);
        // 2) 页面标题, 如 <p class="title">2026-1学期课程</p>
        const text = document.body ? document.body.innerText : "";
        const titleMatch = text.match(/(\d{4}-\d)\s*学期/);
        if (titleMatch) return titleMatch[1];
        // 3) 页面上的学年学期下拉框(已选中项)
        const selects = document.querySelectorAll("select");
        for (let i = 0; i < selects.length; i++) {
            const opt = selects[i].selectedOptions && selects[i].selectedOptions[0];
            if (opt) {
                const m = opt.value.match(/^\d{4}-\d$/);
                if (m) return opt.value;
            }
        }
        // 4) 页面任意文本中形如 2026-1 / 2026-2027-1 的学期串
        const anyMatch = text.match(/(20\d{2}-\d)(?![\d-])/);
        if (anyMatch) return anyMatch[1];
        return null;
    }

    /** 从当前日期推算学年候选列表(登录后系统默认停在上学期, 假期导课表时要用新学期) */
    function buildSemesterCandidates(detected) {
        let baseYear = null;
        const dm = String(detected || "").match(/^(\d{4})-(\d)$/);
        if (dm) {
            baseYear = parseInt(dm[1], 10);
        } else {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1; // 1..12
            // 学年 Y 覆盖 当年9月 ~ 次年8月; 9月(含)前属于上学年
            baseYear = month >= 9 ? year : year - 1;
        }
        const out = [];
        for (let y = baseYear - 1; y <= baseYear + 1; y++) {
            out.push(y + "-1");
            out.push(y + "-2");
        }
        return out;
    }

    /** 弹出学期选择, 返回选中的学年学期; 取消返回 null */
    async function selectSemester(detected) {
        const candidates = buildSemesterCandidates(detected);
        let defaultIndex = 0;
        if (detected) {
            const idx = candidates.indexOf(detected);
            if (idx >= 0) defaultIndex = idx;
            else candidates.unshift(detected);
        }
        const selected = await window.shiguangBridgePromise.showSingleSelection(
            "选择学年学期",
            JSON.stringify(candidates),
            defaultIndex
        );
        if (selected === null || selected === undefined) return null;
        return candidates[parseInt(selected, 10)];
    }

    async function fetchSchedule(academicYear) {
        const url = SCHEDULE_API +
            "?code=" + MENU_CODE +
            "&academicYear=" + encodeURIComponent(academicYear) +
            "&weekly=0&_t=" + Date.now();
        const resp = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        if (!resp.ok) throw new Error("接口请求失败: HTTP " + resp.status);
        const json = await resp.json();
        if (json.code !== 200) {
            throw new Error("接口返回异常: code=" + json.code + (json.message ? " " + json.message : ""));
        }
        if (!Array.isArray(json.data)) {
            throw new Error("接口返回的 data 不是数组");
        }
        return json.data;
    }

    /** 拉第 1 周周一作为开学日 */
    async function fetchSemesterStartDate(academicYear) {
        const url = CALENDAR_API +
            "?academicYear=" + encodeURIComponent(academicYear) +
            "&weekly=1&_t=" + Date.now();
        const resp = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const json = await resp.json();
        const start = json && json.data && json.data.startTime;
        if (json.code !== 200 || !start || !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) {
            throw new Error("校历未返回有效 startTime");
        }
        return String(start);
    }

    /**
     * 解析接口返回的字段串。
     * 接口每个星期字段(如 tuesday)的值是若干 "键:值" 对用 ";;" 连接的字符串,
     * 例如: "kcmc:课程名;;rkjs:教师;;skdd:地点;;zs:1-12周;;js:周二 2-4节;;..."。
     * weekly 是该条记录的实际上课周次, 优先于课程总体范围 zs/sksj。
     * 本函数按 ";;" 切分后提取各键值, 返回 { name, teacher, position, weeks, startSection, endSection }。
     */
    function parseCourseField(fieldText, weekly) {
        const fields = {};
        String(fieldText).split(";;").forEach(function (part) {
            const idx = part.indexOf(":");
            if (idx <= 0) return;
            fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
        });

        const name = fields.kcmc;
        if (!name) return null;

        // weekly=0 的请求返回逐周实际排课。不能把 zs 总体范围展开到每条记录,
        // 否则调休补课会被复制到每周, 放假停课的周次也会被重新补上。
        const actualWeek = Number(weekly);
        const weeks = [];
        if (Number.isInteger(actualWeek) && actualWeek > 0) {
            weeks.push(actualWeek);
        } else {
            // 兼容没有有效 weekly 的汇总记录, 才回退到 zs/sksj 总体范围。
            const zsText = String(fields.zs || fields.sksj || "");
            const zsMatch = zsText.match(/(\d+)\s*-\s*(\d+)\s*每?周/) || zsText.match(/(\d+)\s*每?周/);
            if (!zsMatch) {
                console.warn("[SYSU] 无法解析周次:", zsText || "(空)", "字段:", fieldText);
                return null;
            }
            const weekStart = parseInt(zsMatch[1], 10);
            const weekEnd = zsMatch[2] ? parseInt(zsMatch[2], 10) : weekStart;
            for (let w = weekStart; w <= weekEnd; w++) weeks.push(w);
            if (!weeks.length) {
                console.warn("[SYSU] 周次区间为空:", zsText);
                return null;
            }
        }

        // 节次: js 形如 "周二 2-4节" 或 "周二 3节"; 星期由外层 JSON 键决定。
        const jsText = String(fields.js || "");
        const jsMatch = jsText.match(/(\d+)\s*-\s*(\d+)\s*节/) || jsText.match(/(\d+)\s*节/);
        if (!jsMatch) {
            console.warn("[SYSU] 无法解析节次:", jsText || "(空)", "字段:", fieldText);
            return null;
        }
        const startSection = parseInt(jsMatch[1], 10);
        const endSection = jsMatch[2] ? parseInt(jsMatch[2], 10) : startSection;
        if (!startSection || !endSection || endSection < startSection) {
            console.warn("[SYSU] 节次区间无效:", jsText);
            return null;
        }

        return {
            name: name,
            teacher: fields.rkjs || "未知教师",
            position: fields.skdd || "未知地点",
            weeks: weeks,
            startSection: startSection,
            endSection: endSection
        };
    }

    /** 遍历逐周排课, 按实际星期提取课程, 合并相同时段的周次并去重 */
    function buildCoursesFromApi(data) {
        const meetings = [];
        let maxWeek = 0;

        data.forEach(function (entry) {
            if (!entry) return;
            const weekly = Number(entry.weekly);
            if (Number.isInteger(weekly) && weekly > maxWeek) maxWeek = weekly;
            Object.keys(DAY_KEYS).forEach(function (dayKey) {
                const field = entry[dayKey];
                if (!field || typeof field !== "string" || field.length < 4) return;
                // 官方前端用 ",," 分隔同一单元格内的多门课程。
                field.split(",,").forEach(function (courseField) {
                    const course = parseCourseField(courseField, entry.weekly);
                    if (!course) return;
                    course.weeks.forEach(function (w) {
                        if (w > maxWeek) maxWeek = w;
                    });
                    meetings.push({
                        name: course.name,
                        teacher: course.teacher,
                        position: course.position,
                        day: DAY_KEYS[dayKey],
                        startSection: course.startSection,
                        endSection: course.endSection,
                        weeks: course.weeks
                    });
                });
            });
        });

        return { meetings: dedupe(meetings), maxWeek: maxWeek };
    }

    function dedupe(meetings) {
        const seen = {};
        const out = [];
        meetings.forEach(function (m) {
            // 同一课程可能按节次重复出现, 也可能分布在不连续的周次。
            // 身份键不包含 weeks, 只合并实际出现过的周次, 不填补中间的空周。
            const key = JSON.stringify([m.day, m.startSection, m.endSection, m.name, m.teacher, m.position]);
            if (seen[key]) {
                seen[key].weeks = Array.from(new Set(seen[key].weeks.concat(m.weeks)));
                return;
            }
            seen[key] = m;
            out.push(m);
        });
        out.forEach(function (m) {
            m.weeks.sort(function (a, b) { return a - b; });
        });
        return out.sort(function (a, b) {
            return a.day - b.day || a.startSection - b.startSection;
        });
    }

    // ---------- 保存 ----------

    async function saveToApp(courses, timeSlots, maxWeek, startDate) {
        const config = {
            semesterTotalWeeks: maxWeek > 0 ? maxWeek : 17,
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };
        if (startDate) config.semesterStartDate = startDate;
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveCourseConfig) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }
        if (timeSlots.length && window.shiguangBridgePromise && window.shiguangBridgePromise.savePresetTimeSlots) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.saveImportedCourses) {
            return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        }
        console.log("[SYSU] parsed courses:", JSON.stringify(courses, null, 2));
        return true;
    }

    // ---------- 主流程 ----------

    async function runImportFlow() {
        try {
            // 1. 确定学年学期: 自动探测 + 弹窗让用户确认/修改
            //    (假期登录时系统默认是上学期, 必须允许用户选到目标学期)
            let academicYear = detectAcademicYear();
            if (window.shiguangBridgePromise && window.shiguangBridgePromise.showSingleSelection) {
                const picked = await selectSemester(academicYear);
                if (picked === null) return; // 用户取消
                academicYear = picked;
            } else if (!academicYear) {
                // 无 bridge 且页面也识别不到学期: 无法继续
                await alertUser("未识别到学年学期", "请先进入目标学期的「课表查询」页面再执行导入。");
                return;
            }

            // 2. 接口直取(主路径)
            let courses = null, maxWeek = 0;
            try {
                toast("正在从教务接口获取 " + academicYear + " 课表...");
                const data = await fetchSchedule(academicYear);
                const result = buildCoursesFromApi(data);
                if (result.meetings.length) {
                    courses = result.meetings;
                    maxWeek = result.maxWeek;
                    toast("接口获取成功, 共 " + courses.length + " 个课程时段");
                } else {
                    console.warn("[SYSU] 接口返回空数据: academicYear=" + academicYear);
                }
            } catch (e) {
                console.warn("[SYSU] 接口获取失败:", e);
            }

            if (!courses || !courses.length) {
                await alertUser(
                    "未解析到课程",
                    "所选学期 " + academicYear + " 没有返回课程。\n\n可能原因:\n" +
                    "1. 该学期课程尚未排课/选课(假期导入新学期时常见, 可等开学前选课后重试);\n" +
                    "2. 学期代码不对(请重新执行导入, 在选择学期时核对);\n" +
                    "3. 登录状态失效或接口异常(请重新进入课表页面登录后再试; 若仍失败, 请向适配维护者反馈)。"
                );
                return;
            }

            // 3. 校历
            let startDate = null;
            try {
                startDate = await fetchSemesterStartDate(academicYear);
                toast("已获取开学日 " + startDate);
            } catch (e) {
                console.warn("[SYSU] 校历获取失败, 跳过开学日:", e);
            }

            // 4. 保存
            const saved = await saveToApp(courses, TIME_SLOTS, maxWeek, startDate);
            if (!saved) { toast("课程保存失败, 请重试"); return; }

            toast("导入成功: " + courses.length + " 个课程时段" +
                (startDate ? ", 开学日 " + startDate : "") +
                ", 已同步作息时间");
            if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
                window.shiguangBridge.notifyTaskCompletion();
            }
        } catch (error) {
            console.error("[SYSU] import failed:", error);
            await alertUser("导入失败", error && error.message ? error.message : String(error));
        }
    }

    runImportFlow();
})();
