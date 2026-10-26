// 南方科技大学 TIS 教学管理与服务平台 课表导入适配器
//
// 依赖的 TIS 接口（均为登录后同域请求，凭证由 WebView 自动携带）：
//   POST /component/querydangqianxnxq        当前学年学期 { XN, XQ, XNXQ }
//   POST /cjgl/grcjcx/grcjcx                 历年课程记录（用于生成可选学期列表）
//   POST /xszykb/queryxszykbzong             整学期课表（xn, xq）
//   POST /component/queryKbjg                作息时间（xn, xq, zc）
//   POST /component/querydangqianzc          当前教学周（纯数字文本）
//
// 课表条目关键字段（2026 秋实测）：
//   KEY   "xq1_jc5"  -> 星期 1（周一），jc 为课表网格行号（非节次）
//   KSJC / JSJC      起始 / 结束节次（真正的节次）
//   ZC               0/1 位图，下标即周次（下标 0 未使用）
//   SKSJ             多行文本：课程名 / [教师] / [班级] / [周次][地点][节次]
//   KCWZSM / SKFS 等 实测为 null，仅作兜底

// ========================================
// 常量
// ========================================

// 教务系统未返回作息时间时的兜底节次时间（南科大常规作息）
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:20", endTime: "11:10" },
    { number: 4, startTime: "11:20", endTime: "12:10" },
    { number: 5, startTime: "14:00", endTime: "14:50" },
    { number: 6, startTime: "15:00", endTime: "15:50" },
    { number: 7, startTime: "16:20", endTime: "17:10" },
    { number: 8, startTime: "17:20", endTime: "18:10" },
    { number: 9, startTime: "19:00", endTime: "19:50" },
    { number: 10, startTime: "20:00", endTime: "20:50" },
    { number: 11, startTime: "21:20", endTime: "22:10" },
    { number: 12, startTime: "22:20", endTime: "23:10" }
];

const CONFIG_BASE = {
    semesterTotalWeeks: 18,
    defaultClassDuration: 50,
    defaultBreakDuration: 10
};

// ========================================
// 网络请求
// ========================================

async function postFormRaw(path, params) {
    const body = new URLSearchParams();

    Object.keys(params || {}).forEach(function (key) {
        const value = params[key];
        body.append(key, value === null || value === undefined ? "" : String(value));
    });

    const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString()
    });

    if (!response.ok) {
        throw new Error(`请求 ${path} 失败：HTTP ${response.status}`);
    }

    return await response.text();
}

async function postForm(path, params) {
    const text = await postFormRaw(path, params);
    return parseJsonSafely(text, path);
}

async function postJson(path, payload) {
    const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify(payload || {})
    });

    if (!response.ok) {
        throw new Error(`请求 ${path} 失败：HTTP ${response.status}`);
    }

    return parseJsonSafely(await response.text(), path);
}

function parseJsonSafely(text, path) {
    const trimmed = (text || "").trim();

    if (!trimmed) {
        return null;
    }

    if (trimmed.charAt(0) === "<") {
        throw new Error("登录状态已失效，请重新登录本科教务系统后再导入。");
    }

    // 会话失效时 TIS 会返回登录提示页（HTML 或带"登录"字样的 JSON）
    if (/重新登录|请登录|用户认证|登录已过期/.test(trimmed)) {
        throw new Error("登录状态已失效，请重新登录教务系统后再导入。");
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        throw new Error(
            `教务系统返回了非 JSON 内容，请确认已登录本科教务系统（${path}）。`
        );
    }
}

// 取数组型数据：接口可能直接返回数组，也可能包在 content / data 里
function toArray(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (data && Array.isArray(data.content)) {
        return data.content;
    }

    if (data && Array.isArray(data.data)) {
        return data.data;
    }

    return [];
}

// ========================================
// 学期信息
// ========================================

async function fetchCurrentSemester() {
    const data = await postForm("/component/querydangqianxnxq", {});

    if (!data || !data.XN || !data.XQ) {
        throw new Error("未能获取学年学期，请确认已登录本科教务系统。");
    }

    return {
        xn: String(data.XN),
        xq: String(data.XQ),
        label: data.XNXQ || `${data.XN}学年第${data.XQ}学期`
    };
}

// 通过成绩/选课接口拿到该学生有记录的所有学期，作为可选列表
async function fetchSemesterOptions() {
    const options = [];
    const seen = {};

    try {
        const data = await postJson("/cjgl/grcjcx/grcjcx", {
            xn: null,
            xq: null,
            kcmc: null,
            cxbj: "-1",
            pylx: "1",
            current: 1,
            pageSize: 500
        });

        const rows = (data && data.content && data.content.list) || [];

        rows.forEach(function (row) {
            addSemesterOption(options, seen, row && row.xnxq, row && row.xnxqmc);
        });
    } catch (error) {
        // 拿不到历史学期列表时不阻塞流程，调用方会退回"仅当前学期"
        return options;
    }

    return options;
}

function addSemesterOption(options, seen, xnxq, label) {
    const matched = String(xnxq || "").match(/^(\d{4}-\d{4})(\d)$/);

    if (!matched) {
        return;
    }

    const xn = matched[1];
    const xq = matched[2];
    const key = `${xn}-${xq}`;

    if (seen[key]) {
        return;
    }

    seen[key] = true;
    options.push({ xn: xn, xq: xq, key: key, label: label || key });
}

function mergeCurrentSemester(options, current) {
    const key = `${current.xn}-${current.xq}`;
    const exists = options.some(function (item) {
        return item.key === key;
    });

    if (!exists) {
        options.push({
            xn: current.xn,
            xq: current.xq,
            key: key,
            label: current.label
        });
    }

    options.sort(function (a, b) {
        return b.key < a.key ? -1 : 1;
    });

    return options;
}

// ========================================
// 用户交互
// ========================================

function validateDateInput(input) {
    const text = String(input || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return "请输入 YYYY-MM-DD 格式的日期！";
    }

    const date = new Date(`${text}T00:00:00`);

    if (isNaN(date.getTime())) {
        return "请输入有效的日期！";
    }

    return false;
}

async function confirmStart() {
    return await window.shiguangBridgePromise.showAlert(
        "导入说明",
        "本适配用于导入南方科技大学 TIS 本科教务系统的课表。\n请先完成 CAS 登录并停留在教务系统页面内，再点击确认开始导入。",
        "开始导入"
    );
}

async function selectSemester(options, current) {
    if (!options.length) {
        return { xn: current.xn, xq: current.xq, key: `${current.xn}-${current.xq}` };
    }

    const labels = options.map(function (item) {
        return `${item.label}（${item.xn}学年第${item.xq}学期）`;
    });

    const defaultIndex = options.findIndex(function (item) {
        return item.key === `${current.xn}-${current.xq}`;
    });

    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(labels),
        defaultIndex >= 0 ? defaultIndex : 0
    );

    if (index === null || index < 0 || index >= options.length) {
        return null;
    }

    return options[index];
}

async function askSemesterStartDate(defaultValue) {
    const input = await window.shiguangBridgePromise.showPrompt(
        "学期开始日期",
        "该学期不是当前学期，无法自动推算周次。\n请输入该学期第 1 周星期一的日期：",
        defaultValue,
        "validateDateInput"
    );

    if (input === null) {
        return null;
    }

    return String(input).trim();
}

// ========================================
// 课表数据与作息时间
// ========================================

async function fetchTimeSlots(xn, xq) {
    try {
        const data = await postForm("/component/queryKbjg", { xn: xn, xq: xq, zc: "1" });
        const slots = toArray(data).map(function (item) {
            const number = toNumber(item.xj);
            const startTime = normalizeTime(item.kssj);
            const endTime = normalizeTime(item.jssj);

            if (!number || !startTime || !endTime) {
                return null;
            }

            return { number: number, startTime: startTime, endTime: endTime };
        }).filter(Boolean);

        if (slots.length) {
            slots.sort(function (a, b) {
                return a.number - b.number;
            });
            return slots;
        }
    } catch (error) {
        // 忽略，使用兜底作息
    }

    return FALLBACK_TIME_SLOTS.slice();
}

async function fetchCourses(xn, xq) {
    const data = await postForm("/xszykb/queryxszykbzong", { xn: xn, xq: xq });
    const rows = toArray(data);

    if (!rows.length) {
        throw new Error("教务系统未返回课表数据，请确认该学期已选课。");
    }

    return parseCourses(rows);
}

function parseCourses(rows) {
    const courses = [];
    const seen = {};

    rows.forEach(function (row) {
        const course = parseCourse(row);

        if (!course) {
            return;
        }

        const identity = [
            course.name,
            course.day,
            course.startSection,
            course.endSection,
            course.weeks.join(","),
            course.teacher,
            course.position
        ].join("|");

        // 同一节课会在课表网格中占多行（KEY 的 jc 不同），需要去重
        if (seen[identity]) {
            return;
        }

        seen[identity] = true;
        courses.push(course);
    });

    return courses;
}

function parseCourse(row) {
    if (!row || typeof row !== "object") {
        return null;
    }

    const keyMatch = String(row.KEY || "").match(/xq(\d+)_jc(\d+)/i);
    const day = keyMatch ? toNumber(keyMatch[1]) : null;

    if (!day || day < 1 || day > 7) {
        return null;
    }

    const detail = parseScheduleText(row.SKSJ || row.SKSJ_EN);

    // 真实数据中 KCWZSM 为 null，课程信息以 SKSJ 为准
    const name = firstText(detail.name, row.KCMC, row.KCWZSM);

    if (!name) {
        return null;
    }

    // jc 只是网格行号，真实节次用 KSJC / JSJC
    const slotIndex = keyMatch ? toNumber(keyMatch[2]) : null;
    const startSection = toNumber(row.KSJC) || slotIndex;
    const endSection = toNumber(row.JSJC) || startSection;
    const weeks = parseWeekBitmap(row.ZC, detail.declaredWeeks);

    if (!startSection || !endSection || endSection < startSection || !weeks.length) {
        return null;
    }

    return {
        name: name,
        teacher: firstText(detail.teacher, row.SKJS, row.JSXM, row.DGJSMC),
        position: firstText(detail.position, row.SKDD, row.JXCDMC, row.SKDDMC),
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

// ZC 是 0/1 位图，实测下标即周次（下标 0 未使用）。
// 为兼容不同学期的差异，同时算出两种解释，用 SKSJ 里声明的周次（如 [1-16周]）校准。
function parseWeekBitmap(value, declaredWeeks) {
    const bitmap = String(value || "");

    if (!/^[01]+$/.test(bitmap)) {
        return declaredWeeks || [];
    }

    function build(shift) {
        const weeks = [];

        for (let index = 0; index < bitmap.length; index += 1) {
            if (bitmap[index] === "1") {
                const week = index + 1 - shift;

                if (week > 0) {
                    weeks.push(week);
                }
            }
        }

        return weeks;
    }

    // shift=1：周次 = 下标（教务实际使用的口径）；shift=0：周次 = 下标 + 1
    const candidates = [build(1), build(0)];

    if (!declaredWeeks || !declaredWeeks.length) {
        return candidates[0];
    }

    let best = candidates[0];
    let bestScore = -1;

    candidates.forEach(function (weeks) {
        const set = {};
        weeks.forEach(function (week) {
            set[week] = true;
        });

        const score = declaredWeeks.filter(function (week) {
            return set[week];
        }).length;

        if (score > bestScore) {
            bestScore = score;
            best = weeks;
        }
    });

    return best;
}

const WEEK_PATTERN = /\d[\d,\-]*(单|双)?周/;      // 1-16周 / 1-15单周 / 1-9,11周
const SECTION_PATTERN = /\d+\s*(-\s*\d+)?\s*节/;  // 9-10节 / 3节

// 详情行：含周次或节次的那些行，如 [1-16周][一教110][1-2节]、[3-16周]、[教室][1-4节]
function isDetailLine(line) {
    return WEEK_PATTERN.test(line) || SECTION_PATTERN.test(line);
}

// 解析 "1-16周" / "1-9,11,13-15周" / "1-15单周" 形式的周次声明
function parseWeekExpression(text) {
    const matched = String(text).match(WEEK_PATTERN);

    if (!matched) {
        return [];
    }

    // 去掉末尾的 "单周" / "双周" / "周"，剩下的就是周次表达式
    const expression = matched[0].replace(/(单|双)?周$/, "");
    const parity = /单周$/.test(matched[0]) ? "单" : (/双周$/.test(matched[0]) ? "双" : "");
    const weeks = [];

    expression.split(",").forEach(function (part) {
        const range = part.match(/^(\d+)(?:-(\d+))?$/);

        if (!range) {
            return;
        }

        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : start;

        for (let week = start; week <= end && week <= 36; week += 1) {
            weeks.push(week);
        }
    });

    const filtered = weeks.filter(function (week) {
        if (parity === "单") {
            return week % 2 === 1;
        }

        if (parity === "双") {
            return week % 2 === 0;
        }

        return true;
    });

    return uniqueSorted(filtered);
}

// SKSJ 形如：
//   思想道德与法治
//   [兰美荣]
//   [思想道德与法治-09班-中文]
//   [1-16周][智华楼207][9-10节]
function parseScheduleText(value) {
    const lines = String(value || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "\n")
        .split("\n")
        .map(function (line) {
            return line.trim();
        })
        .filter(Boolean);

    const result = { name: "", teacher: "", position: "", declaredWeeks: [] };

    if (!lines.length) {
        return result;
    }

    result.name = unwrap(lines[0]);

    lines.slice(1).forEach(function (line) {
        const groups = bracketGroups(line);

        // 详情行：[1-16周][智华楼207][9-10节]
        // 注意：不能用 "含周/含节" 判断，课程名或教师名里可能有"周"字（如"某单周课"）
        if (isDetailLine(line)) {
            if (!result.declaredWeeks.length) {
                result.declaredWeeks = parseWeekExpression(line);
            }

            if (!result.position) {
                const place = firstMatch(groups, function (part) {
                    return part && !WEEK_PATTERN.test(part) && !SECTION_PATTERN.test(part) &&
                        !/班/.test(part) && part !== result.name &&
                        part.indexOf(result.name) < 0 && result.name.indexOf(part) < 0;
                });

                if (place) {
                    result.position = unwrap(place);
                }
            }

            return;
        }

        const text = unwrap(line);

        // 教师行：课程名的下一行，排除班级行（含"班"）与课程名本身
        if (!result.teacher && text && text !== result.name && !/班/.test(text)) {
            result.teacher = text;
        }
    });

    return result;
}

// ========================================
// 课表配置（学期开始日期 / 总周数）
// ========================================

async function fetchCurrentWeek() {
    try {
        const text = (await postFormRaw("/component/querydangqianzc", {})).trim();

        if (/^\d+$/.test(text)) {
            return Number(text);
        }
    } catch (error) {
        // 学期未开始时该接口返回空内容
    }

    return null;
}

// 本周周一往前推 (当前周 - 1) 周，即为第 1 周周一
function computeSemesterStart(currentWeek) {
    if (!currentWeek || currentWeek < 1) {
        return "";
    }

    const now = new Date();
    const monday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - ((now.getDay() + 6) % 7)
    );

    monday.setDate(monday.getDate() - (currentWeek - 1) * 7);

    return formatDate(monday);
}

async function buildCourseConfig(semester, current, courses) {
    const maxWeek = courses.reduce(function (max, course) {
        return Math.max(max, course.weeks[course.weeks.length - 1] || 0);
    }, 0);

    const config = Object.assign({}, CONFIG_BASE, {
        semesterTotalWeeks: Math.max(CONFIG_BASE.semesterTotalWeeks, maxWeek)
    });

    const isCurrent = semester && current && semester.key === `${current.xn}-${current.xq}`;
    let startDate = isCurrent ? computeSemesterStart(await fetchCurrentWeek()) : "";

    if (!startDate) {
        startDate = await askSemesterStartDate(computeSemesterStart(1));

        if (!startDate) {
            return null;
        }
    }

    config.semesterStartDate = startDate;

    return config;
}

// ========================================
// 工具函数
// ========================================

function firstText() {
    for (let index = 0; index < arguments.length; index += 1) {
        const value = arguments[index];

        if (value !== null && value !== undefined && String(value).trim() !== "") {
            return String(value).trim();
        }
    }

    return "";
}

// 去掉一对包裹的中括号：[兰美荣] -> 兰美荣
function unwrap(value) {
    return String(value || "").trim()
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .trim();
}

// 提取一行里所有 [xxx] 的内容
function bracketGroups(line) {
    const groups = [];
    const pattern = /\[([^\]]*)\]/g;
    let matched = pattern.exec(String(line));

    while (matched !== null) {
        groups.push(matched[1].trim());
        matched = pattern.exec(String(line));
    }

    return groups;
}

function firstMatch(list, predicate) {
    for (let index = 0; index < list.length; index += 1) {
        if (predicate(list[index])) {
            return list[index];
        }
    }

    return null;
}

function uniqueSorted(numbers) {
    const seen = {};
    const result = [];

    numbers.forEach(function (number) {
        if (!seen[number]) {
            seen[number] = true;
            result.push(number);
        }
    });

    return result.sort(function (a, b) {
        return a - b;
    });
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeTime(value) {
    const text = String(value || "").trim();

    return /^\d{1,2}:\d{2}$/.test(text) ? text : "";
}

function formatDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${date.getFullYear()}-${month}-${day}`;
}

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
        window.shiguangBridge.showToast(message);
    }
}

// ========================================
// 主流程
// ========================================

async function runImportFlow() {
    try {
        if (!window.shiguangBridgePromise) {
            throw new Error("当前环境不支持导入，请在时光课程表 App 内运行。");
        }

        const confirmed = await confirmStart();

        if (!confirmed) {
            toast("已取消导入。");
            return;
        }

        toast("正在获取学期信息...");

        const current = await fetchCurrentSemester();
        const options = mergeCurrentSemester(await fetchSemesterOptions(), current);
        const semester = await selectSemester(options, current);

        if (!semester) {
            toast("已取消导入。");
            return;
        }

        toast("正在获取课表...");

        const courses = await fetchCourses(semester.xn, semester.xq);

        if (!courses.length) {
            throw new Error("未解析到任何课程，请确认该学期课表已发布。");
        }

        const timeSlots = await fetchTimeSlots(semester.xn, semester.xq);
        const config = await buildCourseConfig(semester, current, courses);

        if (!config) {
            toast("已取消导入。");
            return;
        }

        toast(`正在导入 ${courses.length} 门课程...`);

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

        toast(`成功导入 ${courses.length} 门课程！`);

        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === "function") {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        toast(`导入失败：${error.message}`);
    }
}

runImportFlow();
