/**
 * 中国地质大学（武汉）研究生教务系统 拾光课程表适配脚本
 *
 * 数据来源：研究生教务课表查询页（DOM 表格 id = ctl00_contentParent_dgData）
 *   列：时间 | 节次 | 星期一 … 星期日
 *   行：上午(1-4节) 下午(5-8节) 晚上(9-12节)，共 12 行
 *   日程格使用 rowspan 表示 “连续占据多个节次” 对应一个课程条目
 *
 * 课程单元格文案格式：
 *   课程名｛第几周[教师:教师名,地点:教室名]｝，多个课程用；分隔
 *   周数为区间/顿号写法，例如：2-5、7-11 或 7 或 1-19
 *
 * 与本科版（cug01.js）保持一致：导入前让用户选择校区作息，
 * 导入后保存作息时段与课表配置，全程提供 Toast/弹窗反馈。
 */

// ============================================================================
// 作息方案（与中国地质大学本科共用三套，见 cug01.js）
// ============================================================================

/** 南望山校区 · 秋冬季作息（共12节） */
const CUG_NANWANGSHAN_AUTUMN = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:05", endTime: "10:50" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:50", endTime: "17:35" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:50", endTime: "20:35" },
    { number: 11, startTime: "20:40", endTime: "21:25" },
    { number: 12, startTime: "21:30", endTime: "22:15" }
];

/** 南望山校区 · 春夏季作息（5月1日后执行，下午推迟30分钟，共12节） */
const CUG_NANGSHAN_SUMMER = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:05", endTime: "10:50" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:35", endTime: "17:20" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:20", endTime: "21:05" },
    { number: 11, startTime: "21:10", endTime: "21:55" },
    { number: 12, startTime: "22:00", endTime: "22:45" }
];

/** 未来城校区 · 标准作息（全年统一，共12节） */
const CUG_FUTURE_CITY = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:15", endTime: "11:00" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "15:45", endTime: "16:30" },
    { number: 8, startTime: "16:35", endTime: "17:20" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:20", endTime: "20:05" },
    { number: 11, startTime: "20:15", endTime: "21:00" },
    { number: 12, startTime: "21:05", endTime: "21:50" }
];

/** 作息方案选项 */
const SCHEDULE_OPTIONS = [
    { name: "南望山校区 · 秋冬季作息（下午 14:00 上课）", slots: CUG_NANWANGSHAN_AUTUMN },
    { name: "南望山校区 · 春夏季作息（5月1日后，下午 14:30 上课）", slots: CUG_NANGSHAN_SUMMER },
    { name: "未来城校区 · 标准作息（上午 08:30 上课，全天12节）", slots: CUG_FUTURE_CITY }
];

// ============================================================================
// 表格解析
// ============================================================================

/** 展开周数区间："2-5、7-11" → [2,3,4,5,7,8,9,10,11] */
function expandWeeks(weekText) {
    const weeks = new Set();
    weekText.split(/[、，,]/).forEach(part => {
        part = part.trim();
        if (!part) return;
        const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (m) {
            let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
            if (a > b) { const t = a; a = b; b = t; }
            for (let i = a; i <= b; i++) weeks.add(i);
        } else if (/^\d+$/.test(part)) {
            weeks.add(parseInt(part, 10));
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

/** 解析单个课程条目文本，返回 {name, teacher, position, weeks} */
function parseCourseText(text) {
    text = text.trim();
    // 兼容全角｛｝与半角{}；课程名后可能直接跟周数，也可能带括号前缀
    const m = text.match(/^(.+?)[{}｛｝]\s*(.+?)\s*[}｝]$/);
    if (!m) return null;
    const name = m[1].trim();
    const meta = m[2];

    let weeks = [];
    let teacher = "", position = "";

    const weekMatch = meta.match(/第?\s*([0-9、，,\-]+)\s*周?/);
    if (weekMatch) weeks = expandWeeks(weekMatch[1]);

    const teacherMatch = meta.match(/教师[:：]\s*([^,\],；;。]+)/);
    if (teacherMatch) teacher = teacherMatch[1].trim();

    const posMatch = meta.match(/地点[:：]\s*([^,\]，；;。]+)/);
    if (posMatch) position = posMatch[1].trim();

    return { name, className: name, teacher, position, weeks };
}

/** 解析一个日程格（可能含多个课程，用分号分隔），返回课程对象数组，day 为 1-7（周一~周日） */
function parseDayCell(cellText, day, startSection, endSection) {
    if (!cellText) return [];
    const result = [];
    cellText.split(/[；;]/).forEach(part => {
        part = part.trim();
        if (!part) return;
        const c = parseCourseText(part);
        if (c) result.push(Object.assign(c, { day, startSection, endSection }));
    });
    return result;
}

/**
 * 从标准课表表格还原二维课程格 grid[12][7]（节次 × 星期）。
 * 关键：表格中每日格用 rowspan 表示占用连续节次；被覆盖的行不再出现该列的单元格，
 * 因此需要用“列占用计数器 occ[]”把 DOM 单元格映射回（节次 × 星期）网格位置。
 */
function parseScheduleTable(table) {
    const grid = Array.from({ length: 12 }, () => new Array(7).fill(""));
    const rows = Array.from(table.rows);
    const occ = new Array(9).fill(0); // 时间、节次、星期一..星期日：9 列各自的剩余占用行数

    let lesson = 0;
    rows.forEach((tr, ri) => {
        if (ri === 0) return; // 表头
        lesson++;
        if (lesson > 12) return;

        let nextCol = 0;
        Array.from(tr.cells).forEach(cell => {
            // 跳过本行被上方 rowspan 覆盖而未出现的列
            while (nextCol < 9 && occ[nextCol] > 0) {
                occ[nextCol]--;
                nextCol++;
            }
            if (nextCol >= 9) return;

            const col = nextCol;
            const rs = cell.rowSpan || 1;
            const text = (cell.textContent || "").replace(/\s+/g, "").trim();
            if (col >= 2 && col <= 8) {
                const day = col - 2;
                for (let k = 0; k < rs && lesson - 1 + k < 12; k++) {
                    grid[lesson - 1 + k][day] = text;
                }
            }
            occ[col] += rs - 1;
            nextCol++;
        });
    });

    return grid;
}

/** 依据还原的网格生成课程列表（相邻节走文案相同视为同一课程的连续时段） */
function buildCourses(table) {
    const grid = parseScheduleTable(table);
    const courses = [];
    const seenSpan = Array.from({ length: 12 }, () => new Array(7).fill(false));

    grid.forEach((lessonRow, li) => {
        const section = li + 1;
        lessonRow.forEach((text, di) => {
            if (!text || seenSpan[li][di]) return;
            const day = di + 1;

            // 计算该课程在 (节走列, 星期列) 连续占用的末节
            let end = li;
            while (end + 1 < 12 && grid[end + 1][di] === text) end++;
            parseDayCell(text, day, section, end + 1).forEach(c => courses.push(c));

            for (let k = li; k <= end; k++) seenSpan[k][di] = true;
        });
    });

    return courses;
}

/** 在主体文档及 iframe 中查找课表，合并去重（沿用 fetchCourses 对 iframe 的过滤写法） */
function parseAllDocuments() {
    const docs = [];
    if (document) docs.push(document);

    document.querySelectorAll("iframe").forEach(iframe => {
        if (iframe.contentDocument && iframe.contentDocument.getElementById) {
            const iframeDoc = iframe.contentDocument.documentURI;
            if (iframeDoc.includes("Course/StuCourseQuery")) {
                docs.push(iframe.contentDocument);
            }
        }
    });
    if (docs.length > 0) {
        const all = [];
        docs.forEach(doc => {
            const table =
                doc.querySelector("#ctl00_contentParent_dgData") ||
                doc.querySelector("table.Grid_Line") ||
                doc.querySelector("table[id*=dgData]");
            if (!table) return;
            all.push(...buildCourses(table));
        });
        console.log("获取到课程：" + all);

        // 去重
        const key = c =>
            [c.className, c.teacher, c.position, c.day, c.startSection, c.endSection, c.weeks.join(",")].join("|");
        const seen = new Set(), uniq = [];
        all.forEach(c => {
            const k = key(c);
            if (!seen.has(k)) { seen.add(k); uniq.push(c); }
        });

        uniq.sort((a, b) => a.day - b.day || a.startSection - b.startSection);
        return uniq;
    } else {
        console.log("docs为空");
    }
}

/** 智能推测默认作息索引（按教室是否含校区关键字；否则按季节） */
function inferDefaultScheduleIndex(courses) {
    if (!courses || !courses.length) return 0;
    let future = 0, nwn = 0;
    courses.forEach(c => {
        const p = c.position || "";
        if (p.includes("未来城") || /未来城|future/.test(p)) future++;
        if (p.includes("南望山") || /南望山|nws/.test(p)) nwn++;
    });
    if (future > nwn) return 2;
    const month = new Date().getMonth() + 1;
    if (month >= 5 && month <= 9) return 1;
    return 0;
}

async function runImportFlow() {
    window.shiguangBridge && window.shiguangBridge.showToast("正在解析课表...");

    let courses = [];
    try {
        courses = parseAllDocuments();
    } catch (e) {
        console.error("解析课表失败：", e);
        window.shiguangBridge && window.shiguangBridge.showToast("解析课表失败：" + e.message);
        window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion();
        return;
    }

    console.log("解析到课程数：", courses.length);
    console.table(courses);

    if (!courses.length) {
        await window.shiguangBridgePromise.showAlert(
            "未找到课表数据",
            "未在当前页面解析到任何课程。\n\n可能原因：\n1. 尚未打开课表查询页面（学期课表信息查询）；\n2. 页面正在加载或发生异常。\n\n请刷新并进入课表查询页面后重试。",
            "我知道了"
        );
        window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion();
        return;
    }

    // 选择校区与作息
    const defaultIdx = inferDefaultScheduleIndex(courses);
    const optionsLabels = SCHEDULE_OPTIONS.map(opt => opt.name);
    let selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
        `识别到 ${courses.length} 门课程\n请选择您的校区与作息时间：`,
        JSON.stringify(optionsLabels),
        defaultIdx
    );

    if (selectedIdx === null || selectedIdx === undefined || selectedIdx < 0) {
        selectedIdx = defaultIdx;
        window.shiguangBridge.showToast("已使用推荐作息: " + SCHEDULE_OPTIONS[selectedIdx].name);
    }
    const chosenSchedule = SCHEDULE_OPTIONS[selectedIdx];

    // 2. 保存课程
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast("课程导入成功！");
    } catch (error) {
        console.error("保存课程失败:", error);
        await window.shiguangBridgePromise.showAlert("导入失败", "课程保存失败：" + error.message, "知道了");
        window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion();
        return;
    }

    // 3. 保存作息时间段
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(chosenSchedule.slots));
    } catch (error) {
        console.error("保存作息时间段失败:", error);
    }

    // 4. 保存课表配置
    const courseConfig = {
        semesterTotalWeeks: 20,
        firstDayOfWeek: 1
    };
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));
    } catch (error) {
        console.error("保存课表配置失败:", error);
    }

    // 5. 完成提示
    await window.shiguangBridgePromise.showAlert(
        "导入成功",
        `已成功导入 ${courses.length} 门课程！\n作息已设为：${chosenSchedule.name}`,
        "完成"
    );

    window.shiguangBridge.showToast(`导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();