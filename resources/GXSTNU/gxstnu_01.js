// 广西科技师范学院(jw.gxstnu.edu.cn) 拾光课程表适配脚本
// 强智2020后版本，结构与 HNU_01 相同：课表数据位于 class='qz-weeklyTable' 的表格中（表格无 id）
//   - 学期列表 / 开学日期 / 总周数：教学周历 /jsxsd/jxzl/jxzl_query
//   - 课程：学期理论课表 /jsxsd/xskb/xskb_list.do?viweType=0&xnxq01id=…
//   - 作息：教务处《广西科技师范学院课表节次时间对应表》，硬编码
// 出现问题请提交 issue / PR 反馈。

// 整体包在 IIFE 里：部分客户端直接把脚本 eval 进页面全局作用域，
// 同一页面再次执行导入时，顶层 const 会因重复声明而报错
(function () {
    const BASE_URL = "https://jw.gxstnu.edu.cn";
    const URL_SEMESTER = `${BASE_URL}/jsxsd/jxzl/jxzl_query`; // 教学周历（学期列表 + 开学日期 + 最大周次）
    const URL_COURSE = `${BASE_URL}/jsxsd/xskb/xskb_list.do`; // 学期理论课表

    // 小节作息（教务处《广西科技师范学院课表节次时间对应表》）
    const TIME_SLOTS = [
        { "number": 1, "startTime": "08:20", "endTime": "09:00" },
        { "number": 2, "startTime": "09:05", "endTime": "09:45" },
        { "number": 3, "startTime": "09:55", "endTime": "10:35" },
        { "number": 4, "startTime": "10:45", "endTime": "11:25" },
        { "number": 5, "startTime": "11:30", "endTime": "12:10" },
        { "number": 6, "startTime": "14:30", "endTime": "15:10" },
        { "number": 7, "startTime": "15:15", "endTime": "15:55" },
        { "number": 8, "startTime": "16:10", "endTime": "16:50" },
        { "number": 9, "startTime": "16:55", "endTime": "17:35" },
        { "number": 10, "startTime": "19:30", "endTime": "20:10" },
        { "number": 11, "startTime": "20:15", "endTime": "20:55" },
        { "number": 12, "startTime": "21:00", "endTime": "21:40" }
    ];

    const WEEKDAY = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 };

    // 教师字段带职称（如「张三讲师（高校）」「李四（校企）工程师」），只保留姓名；长的放前面
    const TEACHER_TITLES = [
        "助理研究员", "高级工程师", "高级实验师", "助理实验师", "副研究员",
        "研究员", "实验师", "工程师", "副教授", "教授", "讲师", "助教", "其他", "其它"
    ];

    // 工具函数

    function text(node) {
        return node ? (node.textContent || "").replace(/\s+/g, " ").trim() : "";
    }

    function parseHtml(html) {
        return new DOMParser().parseFromString(html, "text/html");
    }

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    // "1-8,10-13" "11" "1-15(单)" "2-16双" → 周次数组
    function parseWeeks(weekStr) {
        const weeks = new Set();
        String(weekStr || "").replace(/\s+/g, "").split(/[,，、]/).forEach(seg => {
            const m = seg.match(/(\d+)(?:-(\d+))?/);
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
        return [...weeks].sort((a, b) => a - b);
    }

    // 「时间：1-8,10-13周[1-3节]」→ [{ weeks, startSection, endSection }]（兼容一条里多段）
    function parseTimeText(timeStr) {
        const result = [];
        const re = /([^\[\]]*?)\[([^\]]*)\]/g;
        let m;
        while ((m = re.exec(timeStr)) !== null) {
            const weeks = parseWeeks(m[1]);
            const nums = m[2].split(/[^\d]+/).map(Number).filter(n => n > 0);
            if (weeks.length && nums.length) {
                result.push({ weeks: weeks, startSection: Math.min(...nums), endSection: Math.max(...nums) });
            }
        }
        return result;
    }

    function cleanTeacher(raw) {
        const names = String(raw || "").split(/[,，、]+/).map(part => {
            const original = part.trim();
            let name = original.replace(/[（(][^（）()]*[)）]/g, "").trim();
            for (const title of TEACHER_TITLES) {
                if (name.endsWith(title) && name.length - title.length >= 2) {
                    name = name.slice(0, -title.length).trim();
                    break;
                }
            }
            return name || original;
        }).filter(Boolean);
        return [...new Set(names)].join(",");
    }

    // "科教楼(西3-201-计算机基础实验室（12）)" → "科教楼西3-201-计算机基础实验室（12）"（与教务首页写法一致）
    function cleanPosition(raw) {
        const str = String(raw || "").trim();
        const m = str.match(/^([^()]*)\((.*)\)$/);
        if (!m) return str;
        const building = m[1].trim();
        const room = m[2].trim();
        if (!room) return building;
        if (!building || room.startsWith(building)) return room;
        return building + room;
    }

    /**
     * 节次与周次合并去重函数（wiki「课程合并与去重函数」参考实现）
     * 教务会把一门课拆成「1-10周[1-3节]」「11周[1-2节]」「11周[3节]」「12-16周[1-3节]」，合并后为「1-16周 1-3节」
     */
    function mergeAndDistinctCourses(courses) {
        if (!Array.isArray(courses) || courses.length <= 1) return courses;

        const grouped = {};
        courses.forEach(c => {
            const name = c.name || '';
            const teacher = c.teacher || '';
            const position = c.position || '';
            const day = c.day || 0;
            const key = `${day}|${name}|${teacher}|${position}`;
            if (!grouped[key]) {
                grouped[key] = { name, teacher, position, day, weeksMap: {} };
            }
            const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
            weeksArr.forEach(w => {
                if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
                grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
            });
        });

        const finalResult = [];
        Object.values(grouped).forEach(group => {
            const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);
            const processedWeeksMap = {};
            sortedWeeks.forEach(w => {
                const parts = group.weeksMap[w];
                parts.sort((a, b) => a.start - b.start || a.end - b.end);
                const mergedParts = [];
                let cur = { ...parts[0] };
                for (let i = 1; i < parts.length; i++) {
                    if (cur.end + 1 >= parts[i].start) {
                        cur.end = Math.max(cur.end, parts[i].end);
                    } else {
                        mergedParts.push(cur);
                        cur = { ...parts[i] };
                    }
                }
                mergedParts.push(cur);
                processedWeeksMap[w] = mergedParts;
            });

            const sectionsMap = {};
            sortedWeeks.forEach(w => {
                const parts = processedWeeksMap[w];
                const sig = parts.map(p => `${p.start}-${p.end}`).join('|');
                if (!sectionsMap[sig]) sectionsMap[sig] = { sections: parts, weeks: [] };
                sectionsMap[sig].weeks.push(w);
            });

            Object.values(sectionsMap).forEach(secGroup => {
                secGroup.sections.forEach(sec => {
                    finalResult.push({
                        name: group.name,
                        teacher: group.teacher,
                        position: group.position,
                        day: group.day,
                        startSection: sec.start,
                        endSection: sec.end,
                        weeks: [...secGroup.weeks]
                    });
                });
            });
        });

        finalResult.sort((a, b) => {
            return (a.day || 0) - (b.day || 0) ||
                (a.startSection || 0) - (b.startSection || 0) ||
                a.name.localeCompare(b.name) ||
                a.weeks[0] - b.weeks[0];
        });
        return finalResult;
    }

    // 核心解析逻辑

    // 按 rowspan / colspan 把表格摊平，返回每个单元格的真实列号
    function layoutRows(rows) {
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
                cells.push({ cell: cell, row: r, col: col });
                col += colSpan;
            });
        });
        return cells;
    }

    // 表头「星期一」…「星期日」→ { 列号: 星期 }
    function parseHeaderDays(table) {
        const dayByCol = {};
        const headRow = table.tHead && table.tHead.rows[0];
        if (!headRow) return dayByCol;
        layoutRows([headRow]).forEach(item => {
            const m = text(item.cell).replace(/\s/g, "").match(/(?:星期|周)([一二三四五六日天])/);
            if (m) dayByCol[item.col] = WEEKDAY[m[1]];
        });
        return dayByCol;
    }

    // 读取一条课程：悬浮提示里的课程名与「老师：… / 时间：… / 地点：…」
    function readCourseItem(tip) {
        const info = {};
        tip.querySelectorAll(".qz-tooltipContent-detailitem").forEach(item => {
            const m = text(item).match(/^(老师|时间|地点)\s*[:：]\s*(.*)$/);
            if (m) info[m[1]] = m[2].trim();
        });
        return {
            name: text(tip.querySelector(".qz-tooltipContent-title")),
            teacher: cleanTeacher(info["老师"]),
            position: cleanPosition(info["地点"]),
            time: info["时间"] || ""
        };
    }

    function parseTimetableToModel(doc) {
        const table = doc.querySelector("table.qz-weeklyTable");
        if (!table) return [];

        const dayByCol = parseHeaderDays(table);
        const bodyRows = Array.from(table.tBodies).flatMap(tbody => Array.from(tbody.rows));
        const results = [];

        layoutRows(bodyRows).forEach(item => {
            if (item.cell.classList.contains("qz-weeklyTable-label")) return;
            const day = dayByCol[item.col];
            if (!day) return;

            item.cell.querySelectorAll(".qz-tooltip li.qz-toolitiplists").forEach(tip => {
                const course = readCourseItem(tip);
                if (!course.name) return;
                parseTimeText(course.time).forEach(seg => {
                    results.push({
                        name: course.name,
                        teacher: course.teacher,
                        position: course.position,
                        day: day,
                        startSection: seg.startSection,
                        endSection: seg.endSection,
                        weeks: seg.weeks
                    });
                });
            });
        });

        return mergeAndDistinctCourses(results);
    }

    // 网络请求封装

    async function requestText(url) {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
        return await response.text();
    }

    // 教学周历的学期下拉框是无 method 的表单，按 GET 提交
    async function requestSemesterPage(semesterId) {
        const query = semesterId ? `?xnxq01id=${encodeURIComponent(semesterId)}` : "";
        return parseHtml(await requestText(`${URL_SEMESTER}${query}`));
    }

    async function requestCoursePage(semesterId) {
        const params = new URLSearchParams({ viweType: "0", xnxq01id: semesterId });
        return parseHtml(await requestText(`${URL_COURSE}?${params.toString()}`));
    }

    // 业务逻辑

    /**
     * 获取学期列表，以 selected 为原点上下各取 3 个
     * @returns {{list: Array<{value:string,label:string}>, defaultIndex:number}}
     */
    function parseSemesterList(doc) {
        const select = doc.getElementById("xnxq01id");
        if (!select) return { list: [], defaultIndex: -1 };

        const allOptions = Array.from(select.querySelectorAll("option"))
            .map(opt => ({
                value: (opt.getAttribute("value") || "").trim(),
                label: opt.textContent.trim(),
                selected: opt.hasAttribute("selected")
            }))
            .filter(opt => opt.value);
        if (allOptions.length === 0) return { list: [], defaultIndex: -1 };

        let selectedIndex = allOptions.findIndex(o => o.selected);
        if (selectedIndex === -1) selectedIndex = 0;
        const start = Math.max(0, selectedIndex - 3);
        const end = Math.min(allOptions.length, selectedIndex + 4);
        return { list: allOptions.slice(start, end), defaultIndex: selectedIndex - start };
    }

    /**
     * 从教学周历解析开学日期 + 最大周次 + 每周第一天
     * 该校周历只有周末格子带月份（工作日为「07」，周末为「09月12日」），
     * 因此取第1周行内第一个「MM月DD日」，按列倒推到该行第一天；
     * 周历第一列有的学期是星期一，有的是星期日（如 2024-2025-2），每周第一天以第一列为准
     */
    function parseSemesterInfo(doc, semesterId) {
        const table = doc.getElementById("dataTable");
        if (!table) return { startDate: null, totalWeeks: null, firstDayOfWeek: null };

        const dayByCol = parseHeaderDays(table);
        const firstCol = Math.min(...Object.keys(dayByCol).map(Number));
        const rows = Array.from(table.tBodies).flatMap(tbody => Array.from(tbody.rows));
        const layout = layoutRows(rows);

        let totalWeeks = null;
        let week1Row = -1;
        layout.forEach(item => {
            if (!item.cell.classList.contains("qz-weeklyTable-label")) return;
            const m = text(item.cell).match(/^第(\d+)周$/);
            if (!m) return;
            const n = Number(m[1]);
            if (totalWeeks === null || n > totalWeeks) totalWeeks = n;
            if (n === 1) week1Row = item.row;
        });

        // 学期 ID 形如「2024-2025-1」：第1学期在第一个年份开学，第2学期在第二个年份开学
        const [firstYear, secondYear, term] = semesterId.split("-").map(Number);
        const year = term === 1 ? firstYear : secondYear;

        let startDate = null;
        for (const item of layout) {
            if (item.row !== week1Row || !dayByCol[item.col]) continue;
            const m = text(item.cell).match(/(\d{1,2})月(\d{1,2})日/);
            if (!m) continue;
            const date = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2])));
            date.setUTCDate(date.getUTCDate() - (item.col - firstCol));
            startDate = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
            break;
        }

        return { startDate, totalWeeks, firstDayOfWeek: dayByCol[firstCol] || null };
    }

    async function fetchCourses(semesterId) {
        return parseTimetableToModel(await requestCoursePage(semesterId));
    }

    // 配置保存

    async function saveAppConfig(semesterStartDate, totalWeeks, firstDayOfWeek) {
        const config = {
            "semesterTotalWeeks": totalWeeks || 20,
            "firstDayOfWeek": firstDayOfWeek || 1
        };
        if (semesterStartDate) config.semesterStartDate = semesterStartDate;
        return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    }

    async function saveAppTimeSlots() {
        return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    }

    // 流程编排

    async function runImportFlow() {
        try {
            const confirmed = await window.shiguangBridgePromise.showAlert(
                "提示", "请确保已成功登录教务系统。是否开始导入？", "开始"
            );
            if (!confirmed) return;

            window.shiguangBridge.showToast("正在获取学期列表...");
            const { list: semesters, defaultIndex } = parseSemesterList(await requestSemesterPage());
            if (semesters.length === 0) {
                window.shiguangBridge.showToast("未获取到学期列表，请检查登录状态。");
                return;
            }

            const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期", JSON.stringify(semesters.map(s => s.label)), defaultIndex
            );
            if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return;
            const semesterId = semesters[selectedIndex].value;

            window.shiguangBridge.showToast("正在获取学期信息...");
            const { startDate, totalWeeks, firstDayOfWeek } = parseSemesterInfo(await requestSemesterPage(semesterId), semesterId);

            window.shiguangBridge.showToast("正在请求课程数据...");
            const finalCourses = await fetchCourses(semesterId);
            if (finalCourses.length === 0) {
                window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
                return;
            }

            await saveAppConfig(startDate, totalWeeks, firstDayOfWeek);
            await saveAppTimeSlots();
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

            window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 条课程安排`);
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            window.shiguangBridge.showToast("异常: " + (error && error.message ? error.message : error));
        }
    }

    runImportFlow();
})();
