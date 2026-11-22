// 南阳理工学院（nyist.edu.cn）超星教务适配
// 教务 ngjw.nyist.edu.cn，统一身份认证走 CAS；课程/作息均为超星同一套接口
//
// 实测要点：
//   1. 课表页 #xhid 是 86 位加密串，首页 /admin 的同名 #xhid 是 32 位用户 ID，用错接口返回 ret=-1
//      → 始终先抓课表页取参数，不依赖用户当前页面
//   2. 校本部/东校区课表与作息完全一致，校区只作作息接口的 xqid，固定用课表页 #xqdm
//   3. tmc 常为 <a>赵正阳</a>,<a>张霄</a> 多教师格式，需取全部 <a> 并过滤锚点间的分隔符文本
//   4. 超星按单节返回：先合并连续节次，再合并同课同节的周次段（1,3,5,7 + 2,4,6,8 → 1-8 周）

const KB_PAGE_URL = "/admin/pkgl/xskb/queryKbForXsd";

// 作息接口异常时的兜底（2026-2027-1 实测值）
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

function toast(message) {
    window.shiguangBridge.showToast(message);
}

async function alertUser(title, content) {
    return await window.shiguangBridgePromise.showAlert(title, content, "确定");
}

// 取 HTML 片段里的全部文本（多 <a> 场景必须全取），过滤纯分隔符文本节点
function extractTexts(htmlStr, joiner) {
    if (!htmlStr) return "";
    const str = String(htmlStr);
    const texts = [];
    const reg = />([^<>]+)</g;
    let m;
    while ((m = reg.exec(str)) !== null) {
        const text = m[1].trim();
        if (/[A-Za-z0-9\u4e00-\u9fa5]/.test(text)) texts.push(text);
    }
    if (texts.length === 0) return str.replace(/<[^>]*>/g, "").trim();
    return Array.from(new Set(texts)).join(joiner || "");
}

function parseTeachers(htmlStr) {
    return extractTexts(htmlStr, "、")
        .split("、")
        .map(name => name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim())
        .filter(Boolean)
        .join("、");
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return String(weekStr)
        .split(",")
        .map(w => Number(String(w).trim()))
        .filter(w => !isNaN(w) && w > 0)
        .sort((a, b) => a - b);
}

function formatTime(timeStr) {
    if (typeof timeStr !== "string") return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function getJson(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    const json = await response.json();
    if (json.ret !== 0) throw new Error(`接口返回 ret=${json.ret}：${json.msg || "未知错误"}`);
    return json;
}

// 课表页参数：xhid / xqdm / 学年学期下拉
async function loadKbPage() {
    let response;
    try {
        response = await fetch(KB_PAGE_URL, { credentials: "include" });
    } catch (e) {
        throw new Error("无法读取课表页，请确认已登录教务系统");
    }
    if (!response.ok) throw new Error(`课表页请求失败（${response.status}）`);
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const xhid = (doc.querySelector("#xhid")?.value || "").trim();
    const xqdm = (doc.querySelector("#xqdm")?.value || "").trim();
    const select = doc.querySelector("#xnxq1");
    if (!xhid || !xqdm || !select) throw new Error("课表页参数不完整，请确认登录状态");
    return { xhid, xqdm, select };
}

async function chooseSemester(select) {
    const options = Array.from(select.querySelectorAll("option")).filter(o => (o.value || "").trim());
    const labels = options.map(o => (o.textContent || o.value).trim());
    const values = options.map(o => o.value.trim());
    let defaultIndex = options.findIndex(o => o.selected);
    if (defaultIndex < 0) defaultIndex = 0;

    const index = await window.shiguangBridgePromise.showSingleSelection("选择学年学期", JSON.stringify(labels), defaultIndex);
    if (index === null || index === undefined || index < 0) return null;
    return values[index];
}

// 同课同节合并周次，再合并连续节次
function mergeCourses(list) {
    const bySection = new Map();
    for (const c of list) {
        const key = [c.name, c.teacher, c.position, c.day, c.startSection].join("\u0001");
        const item = bySection.get(key);
        if (item) item.weeks.push(...c.weeks);
        else bySection.set(key, { ...c, weeks: [...c.weeks] });
    }

    const rows = Array.from(bySection.values())
        .map(c => ({ ...c, weeks: Array.from(new Set(c.weeks)).sort((a, b) => a - b) }))
        .sort((a, b) =>
            a.day - b.day ||
            a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            a.startSection - b.startSection);

    const result = [];
    for (const row of rows) {
        const prev = result[result.length - 1];
        const mergeable = prev &&
            prev.day === row.day &&
            prev.name === row.name &&
            prev.teacher === row.teacher &&
            prev.position === row.position &&
            prev.weeks.join(",") === row.weeks.join(",") &&
            prev.endSection + 1 === row.startSection;
        if (mergeable) prev.endSection = row.startSection;
        else result.push({ ...row, endSection: row.startSection });
    }
    return result;
}

function parseCourses(json) {
    const raw = [];
    for (const item of json.data || []) {
        const name = extractTexts(item.kcmc, "");
        const day = Number(item.xingqi);
        const section = Number(item.djc);
        const weeks = parseWeeks(item.zcstr);
        if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeks.length === 0) continue;
        raw.push({
            name,
            teacher: parseTeachers(item.tmc),
            position: extractTexts(item.croommc, " ") || "待定",
            day,
            startSection: section,
            weeks
        });
    }
    return mergeCourses(raw);
}

async function fetchCourses(xnxq, xhid, xqdm) {
    const url = "/admin/xsd/pkgl/xskb/sdpkkbList" +
        `?xnxq=${encodeURIComponent(xnxq)}&xhid=${encodeURIComponent(xhid)}` +
        `&xqdm=${encodeURIComponent(xqdm)}&xskbxslx=0`;
    return parseCourses(await getJson(url));
}

async function fetchTimeAndWeekData(xnxq, xqdm) {
    const json = await getJson(`/admin/api/getZclistByXnxq?xnxq=${encodeURIComponent(xnxq)}&xqid=${encodeURIComponent(xqdm)}`);
    const data = json.data || {};

    let timeSlots = null;
    if (Array.isArray(data.jcsjszList) && data.jcsjszList.length > 0) {
        timeSlots = data.jcsjszList
            .map(item => ({ number: Number(item.jc), startTime: formatTime(item.kssj), endTime: formatTime(item.jssj) }))
            .filter(item => item.number > 0 && item.startTime && item.endTime)
            .sort((a, b) => a.number - b.number);
        if (timeSlots.length === 0 || timeSlots[0].number !== 1) timeSlots = null;
    }

    const weeks = Array.isArray(data.zclist) ? data.zclist : [];
    const firstWeek = weeks.find(z => Number(z.zc) === 1);
    return {
        timeSlots,
        semesterStartDate: firstWeek && firstWeek.minrq ? String(firstWeek.minrq).split(" ")[0] : null,
        semesterTotalWeeks: weeks.length || null
    };
}

async function runImportFlow() {
    try {
        if ((window.location.href || "").includes("cas.nyist.edu.cn")) {
            await alertUser("导入失败", "请先完成统一身份认证登录，再执行导入。");
            return;
        }

        const confirmed = await alertUser(
            "南阳理工学院教务系统课表导入",
            "将自动读取当前学年学期、作息时间与开学日期。\n导入前请确认已登录教务系统。",
            "开始导入"
        );
        if (confirmed !== true && confirmed !== "true") {
            toast("用户取消了导入。");
            return;
        }

        const { xhid, xqdm, select } = await loadKbPage();
        const xnxq = await chooseSemester(select);
        if (!xnxq) {
            toast("导入已取消：未选择学年学期。");
            return;
        }

        toast(`正在导入 ${xnxq} ...`);
        const courses = await fetchCourses(xnxq, xhid, xqdm);
        if (courses.length === 0) {
            await alertUser("未找到课程", `${xnxq} 学期未获取到课程数据，请确认学期是否已排课。`);
            return;
        }
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        try {
            const { timeSlots, semesterStartDate, semesterTotalWeeks } = await fetchTimeAndWeekData(xnxq, xqdm);
            const config = {};
            if (semesterStartDate) config.semesterStartDate = semesterStartDate;
            if (semesterTotalWeeks) config.semesterTotalWeeks = semesterTotalWeeks;
            if (Object.keys(config).length > 0) {
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            }
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots || FALLBACK_TIME_SLOTS));
        } catch (error) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(FALLBACK_TIME_SLOTS));
            toast("作息时间获取失败，已使用内置作息表。");
        }

        toast(`导入成功！共导入 ${courses.length} 条课程。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        await alertUser("导入失败", error.message);
    }
}

runImportFlow();
