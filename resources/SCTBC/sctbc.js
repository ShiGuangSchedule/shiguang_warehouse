// 四川工商职业技术学院（sctbc.edu.cn） 拾光课表适配脚本
//
// 教务系统：正方教务 V9（前端 zftal-ui-v5-1.0.2），http://jw.sctbc.edu.cn 根路径部署
// 登录方式：正方直登 /xtgl/login_slogin.html，或统一身份认证 cas.sctbc.edu.cn
//
// 全部数据通过接口获取，登录后停在任意教务页面即可导入，无需进入课表查询页。
// 以下接口均为本校实测通过：
//   GET  kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151   学年学期选项
//   POST kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151          课程数据（kbList）
//   POST kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154  校历（开学日期 / 总周数）
//   POST kbcx/xskbcx_cxRjc.html?gnmkdm=N2151           节次作息
//
// 字段映射：kcmc=课程名 xm=教师 cdmc=地点 xqj/xqjmc=星期 jcs=节次 zcd=周次 xf=学分

const BASE = "http://jw.sctbc.edu.cn";
const GNMKDM_KB = "N2151"; // 课表相关模块号
const GNMKDM_XL = "N2154"; // 校历模块号

/** 接口地址 */
function apiUrl(path, gnmkdm) {
    return `${BASE}/${path}?gnmkdm=${gnmkdm}`;
}

/**
 * 带登录态发起 POST 请求并解析 JSON。
 * 登录态由 App 内置浏览器复用，脚本不处理登录。
 */
async function postJson(path, gnmkdm, params) {
    const response = await fetch(apiUrl(path, gnmkdm), {
        method: "POST",
        credentials: "include",
        referrer: apiUrl("kbcx/xskbcx_cxXskbcxIndex.html", gnmkdm),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json, text/javascript, */*; q=0.01"
        },
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) {
        throw new Error(`教务接口请求失败（HTTP ${response.status}）`);
    }
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error("登录状态可能已失效，请重新登录教务系统后再试");
    }
}

// ==================== 数据解析 ====================

/** 全角数字转半角（正方个别页面会返回全角字符） */
function halfWidth(text) {
    return String(text || "").replace(/[\uff10-\uff19]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 65248));
}

/** 周次解析："1-6周,9-18周" / "1-16周(单)" / "1,3,5" → [1,2,3...] */
function toWeeks(text) {
    const weeks = new Set();
    for (const seg of halfWidth(text).replace(/第|周/g, "").split(/[,，、]/)) {
        const range = seg.match(/(\d+)\s*-\s*(\d+)/);
        const single = seg.match(/\d+/);
        if (!range && !single) continue;

        const start = Number(range ? range[1] : single[0]);
        const end = Number(range ? range[2] : single[0]);
        const odd = seg.includes("单");
        const even = seg.includes("双");
        for (let week = start; week <= end; week++) {
            if (odd && week % 2 === 0) continue;
            if (even && week % 2 !== 0) continue;
            weeks.add(week);
        }
    }
    return [...weeks].sort((a, b) => a - b);
}

/** 节次解析："1-2" / "3" / "第1-2节" → { start, end }；无法识别返回 null */
function toSections(text) {
    const numbers = (halfWidth(text).match(/\d+/g) || []).map(Number).filter((n) => n > 0);
    if (!numbers.length) return null;
    return { start: Math.min(...numbers), end: Math.max(...numbers) };
}

/** 星期解析：优先数字 xqj，退回中文 xqjmc（两者都查，避免只认一个来源导致丢课） */
function toDay(xqj, xqjmc) {
    const day = Number(xqj);
    if (day >= 1 && day <= 7) return day;

    const names = ["一", "二", "三", "四", "五", "六", "日", "天"];
    const text = `${xqjmc || ""}${xqj || ""}`;
    const index = names.findIndex((name) => text.includes(name));
    return index < 0 ? 0 : (index === 7 ? 7 : index + 1);
}

/** 课表 JSON → 课程数组。集中实践类课程没有星期/节次，无法落到格子里，直接跳过 */
function toCourses(kbList) {
    if (!Array.isArray(kbList)) return [];

    const courses = [];
    for (const item of kbList || []) {
        if (!item || typeof item !== "object") continue;

        const sections = toSections(item.jcs);
        const weeks = toWeeks(item.zcd);
        const day = toDay(item.xqj, item.xqjmc);
        const name = String(item.kcmc || "").trim();
        if (!name || !sections || !weeks.length || !day) continue;

        const course = {
            name: name,
            teacher: String(item.xm || "").trim(),
            position: String(item.cdmc || "").trim(),
            day: day,
            startSection: sections.start,
            endSection: sections.end,
            weeks: weeks
        };
        const credit = Number(item.xf);
        if (credit > 0) course.credit = credit;
        courses.push(course);
    }
    return mergeAndDistinctCourses(courses);
}

/**
 * 节次与周次合并去重（取自官方 wiki《课程合并与去重函数》）
 * 连续节次 1-2 + 3-4 → 1-4；同节次单周 + 双周 → 全周；完全重复的记录去重。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses || [];

    const list = courses.map((c) => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
        (a.startSection || 0) - (b.startSection || 0));

    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameWeeks = current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(",") === next.weeks.join(",");

        if (sameWeeks && current.endSection + 1 === next.startSection) {
            current.endSection = next.endSection; // 连续节次，延长
        } else if (sameWeeks && current.startSection === next.startSection &&
            current.endSection === next.endSection) {
            continue; // 完全重复，丢弃
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    // 阶段 2：合并同一节次上的不同周次（如单周 + 双周 → 全周）
    step1.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0));

    const merged = [];
    let kept = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const next = step1[i];
        const sameSection = kept.name === next.name &&
            kept.teacher === next.teacher &&
            kept.position === next.position &&
            kept.day === next.day &&
            kept.startSection === next.startSection &&
            kept.endSection === next.endSection;

        if (sameSection) {
            kept.weeks = [...new Set([...kept.weeks, ...next.weeks])].sort((a, b) => a - b);
        } else {
            merged.push(kept);
            kept = next;
        }
    }
    merged.push(kept);
    return merged;
}

// ==================== 学年学期 / 作息 / 校历 ====================

/** 读取教务系统的学年学期选项（学年学期由教务提供，必须问系统要） */
async function fetchSemesterOptions() {
    const response = await fetch(apiUrl("kbcx/xskbcx_cxXskbcxIndex.html", GNMKDM_KB), {
        credentials: "include"
    });
    if (!response.ok) return null;

    const dom = new DOMParser().parseFromString(await response.text(), "text/html");
    const readSelect = (id) => {
        const select = dom.getElementById(id);
        const options = [];
        for (const option of (select ? select.options : [])) {
            if (option.value) {
                options.push({ value: option.value, text: option.text.trim(), selected: option.selected });
            }
        }
        return options;
    };

    const years = readSelect("xnm");
    const terms = readSelect("xqm");
    return years.length && terms.length ? { years: years, terms: terms } : null;
}

/** 默认选中项：教务当前选中的那个，没有就用第一项 */
function selectedIndexOf(options) {
    const index = options.findIndex((option) => option.selected);
    return index < 0 ? 0 : index;
}

/** 节次作息；接口不可用时返回空数组，不影响课程导入 */
async function fetchTimeSlots(xnm, xqm) {
    const data = await postJson("kbcx/xskbcx_cxRjc.html", GNMKDM_KB, {
        xnm: xnm, xqm: xqm, kzlx: "ck", xsdm: "", kclbdm: "", kclxdm: ""
    });
    const rows = Array.isArray(data) ? data : (data && data.data) || [];

    const slots = [];
    for (const item of rows) {
        const number = Number(item.jcdm || item.jcmc);
        const startTime = String(item.qssj || "").slice(0, 5);
        const endTime = String(item.jssj || "").slice(0, 5);
        if (number > 0 && startTime && endTime) {
            slots.push({ number: number, startTime: startTime, endTime: endTime });
        }
    }
    return slots.sort((a, b) => a.number - b.number);
}

/** 校历：开学日期与学期总周数；取不到就返回空对象 */
async function fetchConfig(xnm, xqm) {
    const rows = await postJson("kbcx/xskbcxZccx_cxZcByXnxq.html", GNMKDM_XL, { xnm: xnm, xqm: xqm });
    if (!Array.isArray(rows)) return {};

    const config = {};
    let maxWeek = 0;
    let firstWeek = null;
    for (const row of rows) {
        const week = Number(String(row.zs || row.zsmc || "").replace(/\D/g, ""));
        if (!(week >= 1)) continue;
        if (week > maxWeek) maxWeek = week;
        if (week === 1) firstWeek = row;
    }
    // 仅接受 10~30 周，避免把整年校历当成一个学期
    if (maxWeek >= 10 && maxWeek <= 30) config.semesterTotalWeeks = maxWeek;

    const row = firstWeek || {};
    const date = String(row.rq || row.zcrq || row.ksrq || "").match(/\d{4}-\d{1,2}-\d{1,2}/);
    if (date) config.semesterStartDate = date[0];
    return config;
}

// ==================== 主流程 ====================

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "四川工商职业技术学院课表导入",
        "请确认已登录教务系统。登录后停在任意教务页面即可开始导入，脚本会自动读取学年学期、课表、开学日期与节次作息。",
        "开始导入"
    );
    if (!confirmed) return;

    const options = await fetchSemesterOptions();
    if (!options) throw new Error("未能读取学年学期，请确认已登录教务系统");

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(options.years.map((o) => o.text)), selectedIndexOf(options.years));
    if (yearIndex === null || yearIndex < 0) return;

    const termIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(options.terms.map((o) => o.text)), selectedIndexOf(options.terms));
    if (termIndex === null || termIndex < 0) return;

    const xnm = options.years[yearIndex].value;
    const xqm = options.terms[termIndex].value;

    window.shiguangBridge.showToast("正在获取课表数据...");
    const data = await postJson("kbcx/xskbcx_cxXsKb.html", GNMKDM_KB, { xnm: xnm, xqm: xqm, kzlx: "ck" });
    const courses = toCourses(data.kbList);
    if (!courses.length) throw new Error("所选学期没有解析到课程，请确认学期是否正确");

    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    // 校历与作息属于附加信息，失败不影响课程导入
    const config = await fetchConfig(xnm, xqm).catch(() => ({}));
    const maxWeek = Math.max(...courses.map((course) => Math.max(...course.weeks)));
    if (config.semesterTotalWeeks && maxWeek > config.semesterTotalWeeks) {
        config.semesterTotalWeeks = maxWeek; // 总周数不得小于课程实际周次，否则课程会被截断
    }
    if (Object.keys(config).length) {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)).catch(() => {});
    }

    const slots = await fetchTimeSlots(xnm, xqm).catch(() => []);
    if (slots.length) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)).catch(() => {});
    }

    window.shiguangBridge.showToast(`导入成功，共 ${courses.length} 条课程安排`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow().catch((error) => {
    console.error("SCTBC 导入失败", error);
    window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
});
