// 南阳理工学院(nyist.edu.cn)拾光课程表适配脚本
// 教务系统：超星教务（https://ngjw.nyist.edu.cn，dbname = nyist），统一身份认证走 CAS
//
// 使用流程：在应用内打开教务系统 → 用 CAS 账号密码登录 → 停留在教务系统任意页面 → 点击“执行导入”
//           （不必手动进“信息查询/学生课表”，脚本会自己抓课表页，所以从首页直接执行也能导入）
//
// 接口说明（2026-2027-1 学期实测，ret 均为 0）：
//   GET  /admin/pkgl/xskb/queryKbForXsd                              学生课表页 HTML（内含 #xhid / #xqdm / #xnxq1）
//   GET  /admin/api/jcsj/xqsj/getXqList                              校区列表（item.id = 校区代码，item.xqmc = 名称）
//   GET  /admin/api/getZclistByXnxq?xnxq=<学年-学期>&xqid=<校区代码>  周次表 data.zclist + 节次时间 data.jcsjszList
//   GET  /admin/xsd/pkgl/xskb/sdpkkbList?xnxq=&xhid=&xqdm=&xskbxslx=0 课程数据 JSON（data[]）
//
// 已实测的南阳理工细节：
//   1. 校区有两个：校本部（42BE4B65...）与东校区（E9A24945...）。
//      实测两者的学生课表与作息完全一致（接口按学号返回，不按校区过滤），
//      因此【不再让用户选择校区】，固定使用「校本部」；接口异常时退回课表页里的 #xqdm。
//   2. 课时时间取自接口（1~10 节，上午 8:00 开始、晚上 19:00 开始），接口异常时回退到内置作息。
//   3. 课程按“单节”返回（djc = 第几节），需把连续节次合并；同一门课还会拆成多个周次段
//      （如 1,2,3,4 与 5,6,7,8），需按“同课同节”合并周次，单双周才不会被拆成两条。
//      实测 2026-2027-1：52 条原始记录 -> 26 条课程，节次×周次单元 448 个，无丢失。
//   4. kcmc / tmc / croommc 都是 <a> 包裹的 HTML 片段，需要抽文本；其中 tmc 可能含多位教师
//      （如“赵正阳、张霄”，字符串里还夹着分隔符文本节点），必须把所有 <a> 都取出来，
//      只取第一个会丢教师，不过滤分隔符会拼出“张三、,、李四”。
//   5. 【重要】教务首页 /admin 里也有一个 id="xhid"，但值是 32 位 UUID；
//      课表页 queryKbForXsd 里的 #xhid 才是 86 位加密串，用错会返回 ret=-1「功能暂时停用，请联系管理员」。
//      所以本脚本【始终从课表页取参数】，不依赖用户当前停留的页面。
//   6. 开学日期与总周数都取自 getZclistByXnxq 的 zclist（2026-2027-1 为 19 周，第 1 周 2026-09-07 起）。
//
// 维护者：阿巴怪

// 学期选择：默认弹出单选列表，并把教务标记的“当前学期”作为默认项。
// 常用场景直接确认即可；学期还没开始时也可以在这里改选下学期提前导入。
const ASK_SEMESTER = true;

// 校区：不再弹窗选择。优先使用该名称的校区，找不到则用课表页的 #xqdm。
// （实测两校区返回的课表与作息完全相同，选择校区没有任何意义）
const PREFERRED_CAMPUS_NAME = "校本部";

// 接口异常时的兜底作息（2026-2027-1 实测值，正常情况不会用到）
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:15", endTime: "16:00" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:15", endTime: "18:00" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

// 兜底总周数（接口返回 zclist 时以接口为准，南阳理工实测 19 周）
const FALLBACK_TOTAL_WEEKS = 20;

// 教务系统主机名
const JW_HOST = "ngjw.nyist.edu.cn";

// 课表页地址：服务端渲染的 #xhid / #xqdm / #xnxq1 只在这里才是正确值
const KB_PAGE_URL = "/admin/pkgl/xskb/queryKbForXsd";

// 出错时附在提示里的诊断信息
let diagnoseInfo = "";

// =========================================================================
// 桥接封装：应用内一定有 shiguangBridge，浏览器调试时降级为 console
// =========================================================================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
        window.shiguangBridge.showToast(message);
    } else {
        console.log("[NYIST] " + message);
    }
}

async function alertUser(title, content) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === "function") {
        return await window.shiguangBridgePromise.showAlert(title, content, "确定");
    }
    console.warn("[NYIST] " + title + " - " + content);
    return true;
}

async function chooseFromList(title, labels, defaultIndex) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showSingleSelection === "function") {
        return await window.shiguangBridgePromise.showSingleSelection(
            title,
            JSON.stringify(labels),
            defaultIndex
        );
    }
    // 调试环境：直接返回默认项
    return defaultIndex;
}

// =========================================================================
// 文本解析
// =========================================================================

// 超星返回的字段是 <a> 包裹的 HTML 片段，取出其中全部文本。
// tmc 可能含多位教师（<a>赵正阳</a>,<a>张霄</a>），所以这里取全部并去重拼接。
// 注意：锚点之间还会有纯分隔符文本节点（如单个“,”），必须过滤掉，否则会拼出“张三、,、李四”。
function extractAllAnchorTexts(htmlStr, joiner) {
    if (!htmlStr) return "";
    const str = String(htmlStr);
    const matches = [];
    const reg = />([^<>]+)</g;
    let m;
    while ((m = reg.exec(str)) !== null) {
        const text = m[1].trim();
        if (!text) continue;
        // 至少含一个中英文/数字字符才认为是有意义的内容
        if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(text)) continue;
        matches.push(text);
    }
    if (matches.length === 0) {
        // 没有标签：直接返回去空白后的原文
        return str.replace(/<[^>]*>/g, "").trim();
    }
    // 去重，避免同一个教师出现两次
    const unique = Array.from(new Set(matches));
    return unique.join(joiner || "");
}

// 去掉教师名里的括号备注，如“张三(讲师)”“李四（外聘）”
function cleanTeacherName(name) {
    if (!name) return "";
    return String(name)
        .replace(/（[^）]*）/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim();
}

// 教师字段：多教师用“、”连接，并清理括号备注
function parseTeachers(htmlStr) {
    const raw = extractAllAnchorTexts(htmlStr, "、");
    if (!raw) return "";
    return raw
        .split("、")
        .map(cleanTeacherName)
        .filter(name => name)
        .join("、");
}

// 超星的 zcstr 直接是逗号分隔的周次数字，如 "1,2,3,10,11"
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return String(weekStr)
        .split(",")
        .map(w => Number(String(w).trim()))
        .filter(w => !isNaN(w) && w > 0)
        .sort((a, b) => a - b);
}

// 时间格式化："8:00" / "08:00:00" -> "08:00"
function formatTime(timeStr) {
    if (typeof timeStr !== "string") return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// =========================================================================
// 网络请求封装
// =========================================================================

async function getJson(url) {
    const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        }
    });
    if (!response.ok) {
        throw new Error(`网络请求失败，状态码 ${response.status}（${url.split("?")[0]}）`);
    }
    const json = await response.json();
    if (json.ret !== 0) {
        // 带上接口名与 ret，便于用户反馈时快速定位
        throw new Error(`${url.split("?")[0]} 返回 ret=${json.ret}：${json.msg || "未知错误"}`);
    }
    return json;
}

async function getText(url) {
    const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
            "Accept": "text/html,application/xhtml+xml"
        }
    });
    if (!response.ok) {
        throw new Error(`网络请求失败，状态码 ${response.status}（${url.split("?")[0]}）`);
    }
    return await response.text();
}

// =========================================================================
// 课表页参数：xhid / xqdm / 学年学期下拉
// =========================================================================

function pickKbParams(doc) {
    const xhid = doc.querySelector("#xhid")?.value || "";
    const xqdm = doc.querySelector("#xqdm")?.value || "";
    const select = doc.querySelector("#xnxq1") || doc.querySelector('select[name="xnxq"]');
    return { xhid: xhid.trim(), xqdm: xqdm.trim(), xnxqSelectHtml: select ? select.outerHTML : null };
}

// 服务端渲染的课表页才是正确参数来源。
// 注意：/admin 首页也有 #xhid，但那是 32 位用户 ID，用它调 sdpkkbList 会 ret=-1，
// 所以这里【永远先抓课表页】，抓不到才退回当前页面（并要求 xhid 长度像样）。
async function extractPageParams() {
    let fromPage = null;
    let fetchError = null;

    try {
        const htmlText = await getText(KB_PAGE_URL);
        const doc = new DOMParser().parseFromString(htmlText, "text/html");
        fromPage = pickKbParams(doc);
        if (!fromPage.xhid || !fromPage.xqdm) {
            // 典型情况：会话过期，课表页被重定向到登录页
            fetchError = "课表页里没有 #xhid/#xqdm（可能是登录状态已失效）";
            fromPage = null;
        }
    } catch (error) {
        fetchError = error.message;
        console.warn("[NYIST] 抓取课表页失败：" + error.message);
    }

    if (fromPage) {
        return { ...fromPage, source: "课表页" };
    }

    // 退路：当前页面若本身就是课表页，直接用它（xhid 必须是长加密串，不能是 32 位 UUID）
    const fromDom = pickKbParams(document);
    if (fromDom.xhid && fromDom.xqdm && fromDom.xhid.length > 40) {
        return { ...fromDom, source: "当前页面" };
    }

    throw new Error(
        (fetchError ? fetchError + "；" : "") +
        "无法获取课表页参数，请确认已登录教务系统（ngjw.nyist.edu.cn）后再执行导入"
    );
}

// 解析 #xnxq1 下拉：labels / values / 当前选中项
function parseSemesterOptions(doc) {
    const select = doc.querySelector("#xnxq1") || doc.querySelector('select[name="xnxq"]');
    if (!select) return null;

    const options = Array.from(select.querySelectorAll("option"))
        .filter(opt => (opt.value || "").trim() !== "");
    if (options.length === 0) return null;

    const labels = options.map(opt => (opt.textContent || opt.value || "").trim());
    const values = options.map(opt => (opt.value || "").trim());
    let defaultIndex = options.findIndex(opt => opt.hasAttribute("selected") || opt.selected);
    if (defaultIndex < 0) defaultIndex = 0;

    return { labels, values, defaultIndex };
}

// 页面解析失败时，按“当前时间前后”兜底生成学年学期选项
function buildSemesterOptionsFallback() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const defaultSemester = currentMonth >= 9 ? 1 : 2;
    const defaultYear = currentMonth >= 9 ? currentYear : currentYear - 1;

    const labels = [];
    const values = [];
    let defaultIndex = -1;

    for (const startYear of [currentYear - 1, currentYear, currentYear + 1]) {
        for (const code of ["1", "2"]) {
            const yearStr = `${startYear}-${startYear + 1}`;
            labels.push(`${yearStr} 学年 第${code === "1" ? "一" : "二"}学期`);
            values.push(`${yearStr}-${code}`);
            if (startYear === defaultYear && Number(code) === defaultSemester) {
                defaultIndex = labels.length - 1;
            }
        }
    }
    return { labels, values, defaultIndex: Math.max(defaultIndex, 0) };
}

async function chooseSemester(xnxqSelectHtml) {
    let options = null;
    if (xnxqSelectHtml) {
        const doc = new DOMParser().parseFromString(xnxqSelectHtml, "text/html");
        options = parseSemesterOptions(doc);
    }
    if (!options) {
        console.warn("[NYIST] 页面学年学期下拉解析失败，使用兜底选项。");
        options = buildSemesterOptionsFallback();
    }

    if (!ASK_SEMESTER) {
        return options.values[options.defaultIndex];
    }

    const index = await chooseFromList("选择学年学期", options.labels, options.defaultIndex);
    if (index === null || index === undefined || index < 0) return null;
    return options.values[index];
}

// =========================================================================
// 校区
// =========================================================================

async function fetchCampusList() {
    const json = await getJson("/admin/api/jcsj/xqsj/getXqList");
    if (!Array.isArray(json.data)) throw new Error("校区列表数据格式错误");

    const list = json.data
        .map(item => ({
            xqdm: String(item.id || "").trim(),
            xqmc: String(item.xqmc || item.id || "").trim()
        }))
        .filter(item => item.xqdm && item.xqmc);

    if (list.length === 0) throw new Error("未获取到有效校区信息");
    return list;
}

// 固定使用「校本部」，不再询问用户：
//   实测两个校区的学生课表与作息完全一致（接口按学号返回，不按校区过滤），
//   弹窗只是多一步点击，所以这里静默取用。
//   取不到校区列表 / 名称不匹配时，退回课表页里的 #xqdm，保证流程不中断。
async function pickCampus(pageXqdm) {
    try {
        const campusList = await fetchCampusList();
        const byName = campusList.find(item => item.xqmc.indexOf(PREFERRED_CAMPUS_NAME) >= 0);
        if (byName) return byName;

        const byCode = campusList.find(item => item.xqdm === pageXqdm);
        if (byCode) return byCode;

        return campusList[0];
    } catch (error) {
        console.warn("[NYIST] 获取校区列表失败，沿用课表页校区：" + error.message);
        return { xqdm: pageXqdm, xqmc: "" };
    }
}

// =========================================================================
// 作息时间与开学日期
// =========================================================================

async function fetchTimeAndWeekData(xnxq, xqdm) {
    const json = await getJson(
        `/admin/api/getZclistByXnxq?xnxq=${encodeURIComponent(xnxq)}&xqid=${encodeURIComponent(xqdm)}`
    );
    const data = json.data || {};

    // 节次时间
    let timeSlots = null;
    if (Array.isArray(data.jcsjszList) && data.jcsjszList.length > 0) {
        timeSlots = data.jcsjszList
            .map(item => ({
                number: Number(item.jc),
                startTime: formatTime(item.kssj),
                endTime: formatTime(item.jssj)
            }))
            .filter(item => item.number > 0 && item.startTime && item.endTime)
            .sort((a, b) => a.number - b.number);
        // 节次编号必须从 1 开始连续，否则应用会错位
        if (timeSlots.length === 0 || timeSlots[0].number !== 1) timeSlots = null;
    }

    // 开学日期 = 第 1 周的周一
    let semesterStartDate = null;
    if (Array.isArray(data.zclist)) {
        const firstWeek = data.zclist.find(z => Number(z.zc) === 1);
        if (firstWeek && firstWeek.minrq) {
            semesterStartDate = String(firstWeek.minrq).split(" ")[0];
        }
    }

    const semesterTotalWeeks = Array.isArray(data.zclist) && data.zclist.length > 0
        ? data.zclist.length
        : FALLBACK_TOTAL_WEEKS;

    return { timeSlots, semesterStartDate, semesterTotalWeeks };
}

// =========================================================================
// 课程解析与合并
// =========================================================================

// 阶段 1：合并连续节次 + 去掉完全重复记录
// 阶段 2：合并同课同节的周次（1-8 周 + 9-16 周 -> 1-16 周，单双周 -> 连续周）
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length === 0) return [];

    const list = courses.map(c => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // ---- 阶段 1 ----
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    const step1 = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate =
            current.startSection === next.startSection &&
            current.endSection === next.endSection;

        if (sameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    // ---- 阶段 2 ----
    step1.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const step2 = [];
    let cur = step1[0];

    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (sameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);

    return step2;
}

function parseCourseData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.data)) return [];

    const rawCourses = [];

    for (const raw of jsonData.data) {
        const name = extractAllAnchorTexts(raw.kcmc, "");
        const teacher = parseTeachers(raw.tmc);
        const position = extractAllAnchorTexts(raw.croommc, " ") || "待定";
        const day = Number(raw.xingqi);
        const section = Number(raw.djc);
        const weeks = parseWeeks(raw.zcstr);

        // 超星按“单节”返回：先逐节转成课程块，再交给合并函数处理
        if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeks.length === 0) {
            continue;
        }

        rawCourses.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: section,
            endSection: section,
            weeks: weeks
        });
    }

    console.log(`[NYIST] 原始课程记录 ${jsonData.data.length} 条，有效 ${rawCourses.length} 条`);
    return mergeAndDistinctCourses(rawCourses);
}

async function fetchCourses(xnxq, xhid, xqdm) {
    const url = "/admin/xsd/pkgl/xskb/sdpkkbList" +
        `?xnxq=${encodeURIComponent(xnxq)}` +
        `&xhid=${encodeURIComponent(xhid)}` +
        `&xqdm=${encodeURIComponent(xqdm)}` +
        "&xskbxslx=0";
    return parseCourseData(await getJson(url));
}

// =========================================================================
// 保存
// =========================================================================

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function saveTimeSlots(timeSlots) {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

async function saveConfig(semesterStartDate, semesterTotalWeeks) {
    const config = { semesterTotalWeeks: semesterTotalWeeks };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// =========================================================================
// 主流程
// =========================================================================

function isLoginPage() {
    const href = window.location.href || "";
    return href.includes("cas.nyist.edu.cn") || href.includes("/admin/login") || href.includes("slogin");
}

function isJwPage() {
    const host = window.location.hostname || "";
    return host === JW_HOST || host === "";
}

async function runImportFlow() {
    try {
        // 1. 环境检查
        if (isLoginPage()) {
            await alertUser(
                "导入失败",
                "当前是登录页面，请先完成登录并进入教务系统内部页面后再执行导入。"
            );
            return;
        }
        if (!isJwPage()) {
            await alertUser(
                "导入失败",
                `当前页面不是教务系统（${window.location.hostname}）。\n` +
                `请先在应用内登录 https://${JW_HOST} 并停留在教务系统页面，再执行导入。`
            );
            return;
        }

        const confirmed = await alertUser(
            "南阳理工学院教务系统课表导入",
            "将自动读取当前学年学期、校区、作息时间与开学日期。\n" +
            "导入前请确认已成功登录教务系统。",
            "开始导入"
        );
        if (confirmed !== true && confirmed !== "true") {
            toast("用户取消了导入。");
            return;
        }

        // 2. 课表页参数（xhid / xqdm / 学期下拉）
        toast("正在读取课表页参数...");
        const { xhid, xqdm: pageXqdm, xnxqSelectHtml, source } = await extractPageParams();
        diagnoseInfo = `参数来源=${source}；xhid ${xhid.length} 字符；xqdm ${pageXqdm.length} 字符`;
        console.log("[NYIST] " + diagnoseInfo);

        // 3. 学年学期
        const xnxq = await chooseSemester(xnxqSelectHtml);
        if (!xnxq) {
            toast("导入已取消：未选择学年学期。");
            return;
        }

        // 4. 校区（固定校本部，不询问用户）
        const campus = await pickCampus(pageXqdm);

        toast(`正在导入 ${xnxq}${campus.xqmc ? " · " + campus.xqmc : ""} ...`);

        // 5. 课程
        const courses = await fetchCourses(xnxq, xhid, campus.xqdm);
        if (courses.length === 0) {
            await alertUser(
                "未找到课程",
                `${xnxq} 学期未获取到任何课程数据。\n\n` +
                `请依次确认：\n` +
                `1. 学年学期是否选对；\n` +
                `2. 该学期是否已经排课。\n\n` +
                `诊断信息：${diagnoseInfo}`
            );
            return;
        }
        await saveCourses(courses);
        console.log(`[NYIST] 课程保存成功，共 ${courses.length} 条。`);

        // 6. 作息时间与开学日期（失败不阻塞课程导入）
        try {
            const { timeSlots, semesterStartDate, semesterTotalWeeks } =
                await fetchTimeAndWeekData(xnxq, campus.xqdm);

            await saveConfig(semesterStartDate, semesterTotalWeeks);

            if (timeSlots && timeSlots.length > 0) {
                await saveTimeSlots(timeSlots);
            } else {
                await saveTimeSlots(FALLBACK_TIME_SLOTS);
                toast("未获取到教务作息，已使用内置作息表。");
            }
            console.log(
                `[NYIST] 配置导入完成，开学日期 ${semesterStartDate}，总周数 ${semesterTotalWeeks}。`
            );
        } catch (error) {
            console.error("[NYIST] 作息/开学日期获取失败：", error);
            // 课程已经导入成功，这里只补一份内置作息，避免课表显示为空白
            try {
                await saveTimeSlots(FALLBACK_TIME_SLOTS);
            } catch (e) { /* 忽略 */ }
            toast("作息时间获取失败，已使用内置作息表。");
        }

        // 7. 完成
        toast(`导入成功！共导入 ${courses.length} 条课程。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("[NYIST] 导入流程异常：", error);
        await alertUser(
            "导入失败",
            `${error.message}\n\n` +
            `请确认已登录教务系统且网络正常。\n` +
            `诊断信息：${diagnoseInfo || "无"}`
        );
    }
}

// 执行主流程
runImportFlow();
