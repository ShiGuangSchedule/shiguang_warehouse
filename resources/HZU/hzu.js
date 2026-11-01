// 菏泽学院强智教务：新版学期理论课表（viweType=0）。
// 参考仓库 CSUFT/MKU 的新版强智 DOM 结构，按本站实测重写。
// 不保存登录凭据；所有请求沿用当前 WebView 的会话与协议。

const HZU_SUMMER_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:30", endTime: "16:20" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:40", endTime: "18:30" },
    { number: 9, startTime: "19:30", endTime: "20:20" },
    { number: 10, startTime: "20:30", endTime: "21:20" }
];

// 冬季仅下午第5至8节提前半小时，上午和晚课保持不变。
const HZU_WINTER_TIME_SLOTS = HZU_SUMMER_TIME_SLOTS.map(slot => {
    if (slot.number < 5 || slot.number > 8) return { ...slot };
    const earlier = time => {
        const [hour, minute] = time.split(":").map(Number);
        const minutes = hour * 60 + minute - 30;
        return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
            String(minutes % 60).padStart(2, "0");
    };
    return { ...slot, startTime: earlier(slot.startTime), endTime: earlier(slot.endTime) };
});

function hzuComboSchedule(semesterId) {
    const term = semesterId.match(/^(\d{4})-(\d{4})-([12])$/);
    if (!term || Number(term[2]) !== Number(term[1]) + 1) {
        throw new Error("无法识别作息所属学年。");
    }
    const firstYear = Number(term[1]);
    const lastYear = Number(term[2]);
    const summerYear = term[3] === "1" ? firstYear : lastYear;
    const publicSchedules = [
        {
            name: "菏泽学院夏季作息",
            startDate: summerYear + "-05-01",
            endDate: summerYear + "-10-04",
            defaultClassDuration: 50,
            defaultBreakDuration: 10,
            timeSlots: HZU_SUMMER_TIME_SLOTS.filter(slot => slot.number >= 5 && slot.number <= 8)
        }
    ];
    // App 在夏季规则之外回退到冬季基础作息，边界日期均为闭区间。
    return { name: "菏泽学院冬夏季作息", publicSchedules };
}

function hzuUrl(path) {
    const pathname = window.location.pathname;
    const index = pathname.indexOf("/jsxsd/");
    if (index < 0 && !pathname.endsWith("/jsxsd")) {
        throw new Error("请先登录菏泽学院教务系统，再开始导入。");
    }
    const prefix = index >= 0 ? pathname.slice(0, index) : pathname.slice(0, -6);
    return window.location.origin + prefix + "/jsxsd" + path;
}

async function hzuFetchDocument(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(hzuUrl(path), {
            credentials: "include",
            signal: controller.signal
        });
        if (!response.ok) throw new Error("教务请求失败：HTTP " + response.status);
        return new DOMParser().parseFromString(await response.text(), "text/html");
    } finally {
        clearTimeout(timer);
    }
}

function hzuSemesters(doc) {
    const select = doc.querySelector("#xnxq01id");
    if (!select) throw new Error("登录已失效或未获取到课表页面，请重新登录。");
    return Array.from(select.options).filter(option => option.value).map(option => ({
        value: option.value,
        text: option.textContent.trim(),
        selected: option.selected
    }));
}

function hzuCheckSemester(doc, semesterId) {
    const value = doc.querySelector("#xnxq")?.value || doc.querySelector("#xnxq01id")?.value;
    if (value !== semesterId) throw new Error("教务返回的学期与所选学期不一致，请重新查询。");
}

function hzuNumbers(text, limit) {
    const numbers = [];
    const parts = text.replace(/\s/g, "").split(/[,，、]/);
    for (const part of parts) {
        const match = part.match(/^(\d+)(?:[-~～—至](\d+))?$/);
        if (!match) throw new Error("无法识别周次或节次：" + text);
        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > limit) throw new Error("周次或节次超出范围：" + text);
        for (let number = start; number <= end; number++) numbers.push(number);
    }
    return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function hzuParseTime(text) {
    const sectionMatch = text.match(/[\[［]([^[\]［］]+)节[\]］]/);
    if (!sectionMatch || !text.slice(0, sectionMatch.index).includes("周")) {
        throw new Error("课程缺少有效的周次或节次：" + text);
    }
    const weekText = text.slice(0, sectionMatch.index).replace(/第|周|\s/g, "");
    const weeks = [];
    for (const part of weekText.split(/[,，、]/)) {
        const parity = part.match(/[（(]?(单|双)[）)]?$/);
        const range = parity ? part.slice(0, parity.index) : part;
        weeks.push(...hzuNumbers(range, 100).filter(week =>
            !parity || week % 2 === (parity[1] === "单" ? 1 : 0)));
    }
    const sections = hzuNumbers(sectionMatch[1], 30);
    // 不连续的节次拆开，不能把未上课的小节填进连续区间。
    const ranges = [];
    for (const section of sections) {
        const last = ranges[ranges.length - 1];
        if (last && last.endSection + 1 === section) last.endSection = section;
        else ranges.push({ startSection: section, endSection: section });
    }
    const sortedWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
    if (!sortedWeeks.length) throw new Error("课程周次为空：" + text);
    return { weeks: sortedWeeks, ranges };
}

function hzuGrid(table) {
    const grid = [];
    Array.from(table.rows).forEach((row, r) => {
        if (!grid[r]) grid[r] = [];
        let column = 0;
        Array.from(row.cells).forEach(cell => {
            while (grid[r][column]) column++;
            for (let dr = 0; dr < (cell.rowSpan || 1); dr++) {
                if (!grid[r + dr]) grid[r + dr] = [];
                for (let dc = 0; dc < (cell.colSpan || 1); dc++) {
                    grid[r + dr][column + dc] = cell;
                }
            }
            column += cell.colSpan || 1;
        });
    });
    return grid;
}

function hzuField(text, label) {
    return (text.match(new RegExp(label + "[:：]\\s*([^;；]*)")) || [])[1]?.trim() || "";
}

function hzuParseCourses(doc) {
    const table = doc.querySelector('td[name="kbDataTd"]')?.closest("table");
    if (!table) {
        if (doc.querySelector("#xnxq01id")) return [];
        throw new Error("未获取到课表，请重新登录教务系统。");
    }
    const grid = hzuGrid(table);
    const days = new Map();
    const dayNames = "一二三四五六日";
    for (const row of grid) {
        row.forEach((cell, column) => {
            if (cell.tagName !== "TH") return;
            const match = cell.textContent.trim().match(/^(?:星期|周)([一二三四五六日天])/);
            if (match) days.set(column, match[1] === "天" ? 7 : dayNames.indexOf(match[1]) + 1);
        });
    }
    if (days.size !== 7) throw new Error("无法识别课表的星期表头，已停止导入。");

    const seen = new Set();
    const merged = new Map();
    for (const row of grid) {
        for (const [column, day] of days) {
            const cell = row[column];
            if (!cell || seen.has(cell) || cell.getAttribute("name") !== "kbDataTd") continue;
            seen.add(cell);
            // 只读简表课程，跳过同一格内 tooltip 的重复详情。
            for (const item of cell.querySelectorAll("ul.courselists > li.courselists-item")) {
                const name = item.querySelector(".qz-hasCourse-title")?.textContent.trim();
                const info = item.querySelector(".qz-hasCourse-abbrinfo")?.textContent.trim() || "";
                if (!name) throw new Error("课表中有无法识别的课程名称，已停止导入。");
                const time = hzuParseTime(hzuField(info, "时间"));
                const teacher = hzuField(info, "老师");
                const location = hzuField(info, "地点");
                const position = /^[（(]\s*[）)]$/.test(location) ? "" : location;
                for (const range of time.ranges) {
                    const key = JSON.stringify([name, teacher, position, day, range.startSection, range.endSection]);
                    if (merged.has(key)) {
                        const course = merged.get(key);
                        course.weeks = Array.from(new Set(course.weeks.concat(time.weeks))).sort((a, b) => a - b);
                    } else {
                        merged.set(key, { name, teacher, position, day, ...range, weeks: time.weeks.slice() });
                    }
                }
            }
        }
    }
    return Array.from(merged.values());
}

function hzuCalendar(doc, semesterId) {
    hzuCheckSemester(doc, semesterId);
    const table = doc.querySelector("#dataTable");
    if (!table) throw new Error("未找到教学周历。");
    const anchors = [];
    let totalWeeks = 0;
    for (const row of table.rows) {
        const match = row.cells[0]?.textContent.match(/第\s*(\d+)\s*周/);
        if (!match) continue;
        const week = Number(match[1]);
        if (week < 1 || week > 100) throw new Error("教学周历周次异常。");
        totalWeeks = Math.max(totalWeeks, week);
        for (let day = 0; day < 7; day++) {
            const cell = row.cells[day + 1];
            const date = cell?.textContent.match(/(\d{1,2})月(\d{1,2})日/);
            if (date) anchors.push({ offset: (week - 1) * 7 + day, month: Number(date[1]), day: Number(date[2]) });
        }
    }
    if (!anchors.length || !totalWeeks) throw new Error("教学周历缺少日期。");
    anchors.sort((a, b) => a.offset - b.offset);
    const term = semesterId.match(/^(\d{4})-\d{4}-([12])$/);
    if (!term) throw new Error("无法识别校历学期。");
    const first = anchors[0];
    const year = Number(term[1]) + (term[2] === "2" || first.month < 7 ? 1 : 0);
    const dayMs = 86400000;
    const startMs = Date.UTC(year, first.month - 1, first.day) - first.offset * dayMs;
    if (new Date(startMs).getUTCDay() !== 1 || anchors.some(anchor => {
        const date = new Date(startMs + anchor.offset * dayMs);
        return date.getUTCMonth() + 1 !== anchor.month || date.getUTCDate() !== anchor.day;
    })) throw new Error("教学周历日期不一致，无法确定开学日期。");
    return { semesterStartDate: new Date(startMs).toISOString().slice(0, 10), semesterTotalWeeks: totalWeeks };
}

async function hzuRunImportFlow() {
    const bridge = window.shiguangBridge;
    const api = window.shiguangBridgePromise;
    if (!bridge || !api) throw new Error("未检测到拾光桥接接口，请在软件或测试插件中运行。");
    const requiredMethods = ["showAlert", "showSingleSelection", "saveCourseConfig",
        "savePresetTimeSlots", "saveComboSchedule", "saveImportedCourses"];
    if (requiredMethods.some(method => typeof api[method] !== "function") ||
        typeof bridge.showToast !== "function" || typeof bridge.notifyTaskCompletion !== "function") {
        throw new Error("桥接接口不完整，请使用时光课程表 2.1.0 或新版测试插件后重试。");
    }
    if (!await api.showAlert("菏泽学院课表导入", "请确认已登录教务系统。将读取所选学期的全部周课程。", "开始导入")) return;

    bridge.showToast("正在读取学期列表...");
    const firstDoc = await hzuFetchDocument("/xskb/xskb_list.do?viweType=0&zc=");
    const semesters = hzuSemesters(firstDoc);
    if (!semesters.length) throw new Error("教务未提供可导入的学期。");
    const index = await api.showSingleSelection("选择学期",
        JSON.stringify(semesters.map(semester => semester.text)),
        Math.max(0, semesters.findIndex(semester => semester.selected)));
    if (index === null) return;
    if (!Number.isInteger(index) || !semesters[index]) throw new Error("学期选择无效。");
    const semesterId = semesters[index].value;
    const params = new URLSearchParams({ viweType: "0", zc: "", xnxq01id: semesterId });
    const modeSelect = firstDoc.querySelector("#kbjcmsid");
    const mode = modeSelect && "value" in modeSelect ? modeSelect.value : null;
    if (typeof mode === "string" && mode) params.set("kbjcmsid", mode);
    const doc = await hzuFetchDocument("/xskb/xskb_list.do?" + params);
    hzuCheckSemester(doc, semesterId);
    const courses = hzuParseCourses(doc);
    if (!courses.length) {
        bridge.showToast("该学期暂无已排课课程，未修改原有课表。");
        return;
    }

    let config = null;
    try {
        config = hzuCalendar(await hzuFetchDocument("/jxzl/jxzl_query?xnxq01id=" +
            encodeURIComponent(semesterId)), semesterId);
        if (courses.some(course => course.weeks.some(week => week > config.semesterTotalWeeks))) {
            throw new Error("课程周次超出教学周历。");
        }
    } catch (_) {
        config = null;
        if (!await api.showAlert("教学周历不可用",
            "无法确定所选学期的开学日期与总周数。继续导入后，请在课表设置中核对学期配置。", "继续导入")) return;
    }

    const comboSchedule = hzuComboSchedule(semesterId);

    // 只在全部读取和确认完成后写入；保存失败不能发出完成信号。
    if (config) {
        config.firstDayOfWeek = 1;
        config.defaultClassDuration = 50;
        config.defaultBreakDuration = 10;
        if (await api.saveCourseConfig(JSON.stringify(config)) !== true) throw new Error("学期配置保存失败。");
    }
    if (await api.savePresetTimeSlots(JSON.stringify(HZU_WINTER_TIME_SLOTS)) !== true) {
        throw new Error("作息时间保存失败。");
    }
    // App 要求先保存基础节次，成功后再绑定组合作息，之后不能重存基础节次。
    if (await api.saveComboSchedule(JSON.stringify(comboSchedule)) !== true) {
        throw new Error("冬夏季作息保存失败。");
    }
    if (await api.saveImportedCourses(JSON.stringify(courses)) !== true) throw new Error("课程保存失败。");
    bridge.showToast("成功导入 " + courses.length + " 条上课记录");
    bridge.notifyTaskCompletion();
}

// Start import.
hzuRunImportFlow().catch(error => {
    console.error("HZU import failed:", error);
    if (typeof window.shiguangBridge?.showToast === "function") {
        window.shiguangBridge.showToast("导入失败：" + (error?.message || String(error)));
    }
});
