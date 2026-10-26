// 济南工程职业技术学院(jngcxy.edu.cn) 拾光课程表适配脚本
// 维护者：西郊有密林(@xianzhaowang0-code)，有问题请提 Issue 或 @ 我
// 教务系统：正方新一代教务（jwglxt）+ 金智统一身份认证(authserver)
//
// 网络说明：教务入口 vpnxt.jngcxy.edu.cn 位于学校深信服 aTrust 零信任网关之后。
// 校内可直接访问；校外必须先连接学校的 aTrust 客户端（或校园网 VPN），
// 否则连教务页面都打不开，本脚本也无从发起请求。
//
// 使用方式：登录教务系统后，停在教务系统内任意页面（如首页）直接执行导入即可，
// 无需进入"学生课表查询"页面。脚本先读取教务页的学年/学期下拉选项供选择，
// 再通过 xskbcx_cxXsgrkb 拉取个人课表 JSON（kbList），并从 cxRjc 读取真实节次作息。
//
// 参照实现：resources/HUALIXY/hualixy.js、resources/SCEMI、resources/JUST

// 正方新一代教务的接口模块号，各校略有差异，按顺序尝试
const GNMKDMS = ["N2151", "N253508"];

const CONFIG = {
    // 教务系统站点。页面本身就在教务域时优先用当前 origin（可保留 aTrust/WebVPN 的路径前缀）
    JW_ORIGIN: "http://vpnxt.jngcxy.edu.cn",
    // 兜底：读不到页面下拉选项时，用这些学期编码尝试（正方新版 3=第一学期，12=第二学期，16=第三学期）
    FALLBACK_XQM: ["3", "12", "16"],
    // 兜底：读不到 cxRjc 接口时使用的本校作息（1-10 节，取自教务系统 cxRjc 实测返回）
    FALLBACK_TIME_SLOTS: [
        { number: 1, startTime: "08:30", endTime: "09:15" },
        { number: 2, startTime: "09:20", endTime: "10:05" },
        { number: 3, startTime: "10:20", endTime: "11:05" },
        { number: 4, startTime: "11:10", endTime: "11:55" },
        { number: 5, startTime: "13:30", endTime: "14:15" },
        { number: 6, startTime: "14:20", endTime: "15:05" },
        { number: 7, startTime: "15:15", endTime: "16:00" },
        { number: 8, startTime: "16:05", endTime: "16:50" },
        { number: 9, startTime: "19:00", endTime: "19:50" },
        { number: 10, startTime: "20:00", endTime: "20:50" }
    ],
    // 兜底：总周数下限
    MIN_TOTAL_WEEKS: 20
};

/* ======================= 通用工具 ======================= */

// 正方页面自带的 zftal / jquery.extends.contact-min.js 会改写 Array.prototype.filter/map/every，
// 把回调的第一个实参换成数组下标。适配脚本是在页面脚本之后注入的，此时"原生实现"已被替换，
// 因此这里完全不依赖 Array.prototype 上的高阶方法，一律用显式循环实现。
function arrayFilter(list, fn) {
    const out = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
        if (fn(list[i], i)) out.push(list[i]);
    }
    return out;
}

function arrayMap(list, fn) {
    const out = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) {
        out.push(fn(list[i], i));
    }
    return out;
}

function arrayEvery(list, fn) {
    if (!list || list.length === 0) return true;
    for (let i = 0; i < list.length; i++) {
        if (!fn(list[i], i)) return false;
    }
    return true;
}

/** 取第一个满足条件的下标，没有则返回 -1（替代可能被改写的 findIndex） */
function arrayFindIndex(list, fn) {
    if (!list) return -1;
    for (let i = 0; i < list.length; i++) {
        if (fn(list[i], i)) return i;
    }
    return -1;
}

/** 依比较函数排序（插入排序，避免依赖可能被页面改写的 Array.prototype.sort） */
function sortBy(list, compare) {
    const out = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) out.push(list[i]);
    for (let i = 1; i < out.length; i++) {
        const current = out[i];
        let j = i - 1;
        while (j >= 0 && compare(out[j], current) > 0) {
            out[j + 1] = out[j];
            j--;
        }
        out[j + 1] = current;
    }
    return out;
}

/** 升序排序（插入排序，避免依赖可能被页面改写的 Array.prototype.sort） */
function sortAscending(list, pick) {
    const out = [];
    if (!list) return out;
    for (let i = 0; i < list.length; i++) out.push(list[i]);
    for (let i = 1; i < out.length; i++) {
        const current = out[i];
        const currentKey = pick ? pick(current) : current;
        let j = i - 1;
        while (j >= 0) {
            const prevKey = pick ? pick(out[j]) : out[j];
            if (prevKey <= currentKey) break;
            out[j + 1] = out[j];
            j--;
        }
        out[j + 1] = current;
    }
    return out;
}

/**
 * 拼接教务接口地址。
 * 正方部署在 /jwglxt 子路径；经 WebVPN 访问时路径还带 /http/<hex> 或 /https/<hex> 前缀，需保留。
 */
function buildApiUrl(modulePath, gnmkdm) {
    const path = String(window.location.pathname || "");
    const prefixMatch = path.match(/^\/(?:https?|webvpn)\/[0-9a-z]+/i);
    const webvpnPrefix = prefixMatch ? prefixMatch[0] : "";
    const onJwPage = /\/jwglxt\//i.test(path);
    const origin = onJwPage ? window.location.origin : CONFIG.JW_ORIGIN;
    const query = gnmkdm ? "?gnmkdm=" + gnmkdm : "";
    return origin + webvpnPrefix + "/jwglxt" + modulePath + query;
}

/** 页面是不是还停在统一认证（金智 authserver / 门户） */
function isOnSsoPage() {
    const host = String(window.location.hostname || "");
    const path = String(window.location.pathname || "");
    return /^uap\./i.test(host) || /\/authserver\//i.test(path) || /\/lyuapServer\//i.test(path);
}

/** 正方返回登录页时，排除"会话失效"以外的正常 HTML（课表接口正常只返回 JSON） */
function looksLikeHtml(text) {
    const head = String(text).slice(0, 500).trim();
    return /^</.test(head) || /<html|<!doctype/i.test(head);
}

/**
 * POST 表单请求并解析 JSON。
 * 未登录/会话失效时正方返回登录页 HTML 而不是 JSON，这里统一抛 SESSION_LOST。
 */
async function postFormJson(modulePath, gnmkdm, body) {
    const response = await fetch(buildApiUrl(modulePath, gnmkdm), {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
        },
        body: body
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const text = await response.text();
    if (looksLikeHtml(text)) throw new Error("SESSION_LOST");
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error("返回内容不是 JSON");
    }
}

/** 接口返回可能是纯数组，也可能包一层 {data}/{zc: []}，统一取数组 */
function pickArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    for (const key of ["data", "zc", "zclist", "rows", "list"]) {
        if (Array.isArray(data[key])) return data[key];
    }
    return [];
}

/**
 * 解析正方周次描述，如 "1-16周"、"1-16周(单)"、"1-16周（双）"、"2-4周,9-13周,16周"。
 * 全角括号、逗号、顿号、分号一并兼容。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const text = String(weekStr)
        .replace(/（/g, "(")
        .replace(/）/g, ")")
        .replace(/[，、；;]/g, ",");
    const weeks = [];

    for (const raw of text.split(",")) {
        const seg = raw.trim();
        if (!seg) continue;

        const isOdd = /\(单/.test(seg) || /单周/.test(seg);
        const isEven = /\(双/.test(seg) || /双周/.test(seg);
        const range = seg.match(/(\d+)\s*[-~至]\s*(\d+)/);
        const single = seg.match(/(\d+)/);

        let start = 0;
        let end = 0;
        if (range) {
            start = Number(range[1]);
            end = Number(range[2]);
        } else if (single) {
            start = end = Number(single[1]);
        } else {
            continue;
        }
        if (!(start > 0) || !(end >= start)) continue;

        for (let w = start; w <= end; w++) {
            if (isOdd && w % 2 === 0) continue;
            if (isEven && w % 2 !== 0) continue;
            weeks.push(w);
        }
    }

    const unique = [];
    const seenWeeks = new Set();
    for (let i = 0; i < weeks.length; i++) {
        if (seenWeeks.has(weeks[i])) continue;
        seenWeeks.add(weeks[i]);
        unique.push(weeks[i]);
    }
    return sortAscending(unique);
}

/** "1-2" / "3-4节" / "1~2" / "0102" -> [1,2]；多段时取最小与最大节次 */
function parseSections(jcs) {
    if (!jcs) return null;
    const raw = String(jcs).trim();

    // 部分学校把节次写成补零的四位数字，如 "0102" 表示 1-2 节
    if (/^\d{4}$/.test(raw)) {
        const startSection = Number(raw.slice(0, 2));
        const endSection = Number(raw.slice(2));
        return (startSection > 0 && endSection >= startSection) ? [startSection, endSection] : null;
    }

    const nums = raw.match(/\d+/g);
    if (!nums || nums.length === 0) return null;
    const numList = [];
    for (let i = 0; i < nums.length; i++) {
        const value = Number(nums[i]);
        if (value > 0) numList.push(value);
    }
    if (!numList.length) return null;
    const startSection = Math.min.apply(null, numList);
    const endSection = Math.max.apply(null, numList);
    return startSection <= endSection ? [startSection, endSection] : null;
}

// 本次解析中被跳过的记录数（无星期/节次/周次的集中实践课），用于导入完成提示
let lastSkippedCount = 0;

/** 解析 kbList -> 课程数组（App 导入格式）；字段说明见 scripts/types/shiguang-bridge.d.ts */
function parseKbList(json) {
    const list = (json && Array.isArray(json.kbList)) ? json.kbList : [];
    const courses = [];
    const seen = new Set();
    lastSkippedCount = 0;

    for (const row of list) {
        if (!row || typeof row !== "object") continue;

        const name = String(row.kcmc || "").trim();
        const day = Number(row.xqj);
        const weeks = parseWeeks(row.zcd);
        const sections = parseSections(row.jcs);

        // 集中实践课（军训、毕业设计等）没有星期/节次，直接跳过，不伪造时间
        if (!name || !(day >= 1 && day <= 7) || !weeks.length || !sections) {
            lastSkippedCount++;
            console.log(`JS: 跳过无法排入课表的记录：${name || "(无课程名)"} / 星期${row.xqj} / 节次${row.jcs} / 周次${row.zcd}`);
            continue;
        }

        const course = {
            name: name,
            teacher: String(row.xm || "").trim(),
            position: String(row.cdmc || "").trim(),
            day: day,
            startSection: sections[0],
            endSection: sections[1],
            weeks: weeks
        };

        const credit = Number(row.xf);
        if (Number.isFinite(credit) && credit > 0) course.credit = credit;

        // 同一门课可能因分班/教室拆成多行，完全重复的行只保留一条
        const key = [course.name, course.teacher, course.position, course.day,
            course.startSection, course.endSection, course.weeks.join("-")].join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        courses.push(course);
    }

    const sortedCourses = sortBy(courses, (a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name, "zh")
    );
    courses.length = 0;
    for (let i = 0; i < sortedCourses.length; i++) courses.push(sortedCourses[i]);

    console.log(`JS: 课表解析完成，共 ${courses.length} 条课程记录`);
    return courses;
}

/* ======================= 学年 / 学期 ======================= */

/** 从课表查询页读取学年、学期下拉选项；失败返回 null */
async function fetchAcademicOptions() {
    for (const gnmkdm of GNMKDMS) {
        try {
            const response = await fetch(buildApiUrl("/kbcx/xskbcx_cxXskbcxIndex.html", gnmkdm), {
                method: "GET",
                credentials: "include"
            });
            if (!response.ok) continue;

            const html = await response.text();
            if (!html || /\/authserver\/|name="password"/i.test(html)) continue;

            const doc = new DOMParser().parseFromString(html, "text/html");
            const readOptions = (selector) => {
                const nodes = Array.from(doc.querySelectorAll(selector + " option"));
                const options = [];
                for (let i = 0; i < nodes.length; i++) {
                    const opt = nodes[i];
                    const value = String(opt.getAttribute("value") || "").trim();
                    if (!value) continue;
                    options.push({
                        value: value,
                        text: (opt.textContent || "").trim(),
                        selected: opt.hasAttribute("selected")
                    });
                }
                return options;
            };

            const yearOptions = readOptions("#xnm");
            const termOptions = readOptions("#xqm");
            if (!yearOptions.length || !termOptions.length) continue;

            console.log(`JS: 读取到 ${yearOptions.length} 个学年、${termOptions.length} 个学期选项(gnmkdm=${gnmkdm})`);
            return { yearOptions, termOptions };
        } catch (e) {
            console.warn(`JS: 读取学年学期选项失败(gnmkdm=${gnmkdm})：`, e);
        }
    }
    return null;
}

/** showPrompt 的全局校验函数：返回 false 表示通过，返回字符串表示错误提示 */
function validateYearInput(input) {
    return /^\d{4}$/.test(String(input || "").trim())
        ? false
        : "请输入四位数字的学年起始年份，例如 2026";
}
// showPrompt 的第 4 个参数是「全局作用域里的函数名」，显式挂到 window 上确保能被找到
window.validateYearInput = validateYearInput;

function guessAcademicYear() {
    const now = new Date();
    return String(now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
}

/**
 * 让用户选择学年与学期。
 * 优先用教务页面上的真实下拉选项；读取失败时退回手动输入学年 + 常见学期编码。
 */
async function promptAcademicYearAndSemester() {
    const options = await fetchAcademicOptions();

    if (options) {
        const { yearOptions, termOptions } = options;
        const defaultYearIndex = Math.max(0, arrayFindIndex(yearOptions, opt => opt.selected));
        const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学年",
            JSON.stringify(arrayMap(yearOptions, opt => opt.text)),
            defaultYearIndex
        );
        if (yearIndex === null || yearIndex < 0) return null;

        const defaultTermIndex = Math.max(0, arrayFindIndex(termOptions, opt => opt.selected));
        const termIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(arrayMap(termOptions, opt => opt.text)),
            defaultTermIndex
        );
        if (termIndex === null || termIndex < 0) return null;

        return {
            xnm: yearOptions[yearIndex].value,
            xqm: termOptions[termIndex].value
        };
    }

    window.shiguangBridge.showToast("未能读取教务页的学年学期选项，改为手动选择。");

    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入学年起始年份（如 2026-2027 学年填 2026）：",
        guessAcademicYear(),
        "validateYearInput"
    );
    if (year === null) return null;

    const termNames = ["第一学期", "第二学期", "第三学期（短学期）"];
    const termIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(termNames),
        0
    );
    if (termIndex === null || termIndex < 0) return null;

    return {
        xnm: String(year).trim(),
        xqm: CONFIG.FALLBACK_XQM[termIndex] || CONFIG.FALLBACK_XQM[0]
    };
}

/* ======================= 课表 / 作息 / 开学日期 ======================= */

/** 拉取个人课表 JSON */
async function fetchCourseTable(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=`;
    let lastError = null;

    for (const gnmkdm of GNMKDMS) {
        try {
            const json = await postFormJson("/kbcx/xskbcx_cxXsgrkb.html", gnmkdm, body);
            console.log(`JS: 课表接口返回成功(gnmkdm=${gnmkdm})`);
            return json;
        } catch (e) {
            lastError = e;
            if (e && e.message === "SESSION_LOST") throw e;
            console.warn(`JS: 课表接口失败(gnmkdm=${gnmkdm})：${e && e.message}`);
        }
    }
    throw lastError || new Error("课表接口无响应");
}

/** 取所选学期的开学日期（第 1 周对应的日期）；失败返回 null */
async function fetchSemesterStartDate(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}`;
    for (const gnmkdm of GNMKDMS) {
        try {
            const json = await postFormJson("/kbcx/xskbcxZccx_cxZcByXnxq.html", gnmkdm, body);
            const weeks = pickArray(json);
            if (!weeks.length) continue;

            const first = weeks.find(item =>
                String(item.zs || item.zsmc || item.zcmc || "") === "1"
            ) || weeks[0];

            const raw = String(first.rq || first.zcrq || first.ksrq || first.qsrq || first.date || "");
            const match = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (match) {
                const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
                console.log(`JS: 开学日期 ${date}(gnmkdm=${gnmkdm})`);
                return date;
            }
        } catch (e) {
            console.warn(`JS: 获取开学日期失败(gnmkdm=${gnmkdm})：${e && e.message}`);
        }
    }
    return null;
}

/**
 * 从 cxRjc 读取本校真实节次作息。
 * 只在结果从 1 开始连续时才采用（App 要求节次编号连续），否则退回内置作息。
 */
async function fetchTimeSlots(xnm, xqm) {
    const body = `xnm=${encodeURIComponent(xnm)}&xqm=${encodeURIComponent(xqm)}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
    for (const gnmkdm of GNMKDMS) {
        try {
            const json = await postFormJson("/kbcx/xskbcx_cxRjc.html", gnmkdm, body);
            const rows = pickArray(json);
            if (!rows.length) continue;

            const slots = [];
            for (const item of rows) {
                if (!item || typeof item !== "object") continue;
                const number = Number(item.jcdm != null ? item.jcdm : item.jcmc);
                let startTime = "";
                let endTime = "";

                if (item.qssj != null && item.jssj != null) {
                    startTime = String(item.qssj).trim();
                    endTime = String(item.jssj).trim();
                } else if (item.sksj) {
                    const parts = String(item.sksj).split(/[~\-—至到]/);
                    if (parts.length >= 2) {
                        startTime = parts[0].trim();
                        endTime = parts[1].trim();
                    }
                }

                startTime = startTime.slice(0, 5);
                endTime = endTime.slice(0, 5);
                if (!(number > 0) || !startTime || !endTime) continue;
                slots.push({ number: number, startTime: startTime, endTime: endTime });
            }

            const sortedSlots = sortBy(slots, (a, b) => a.number - b.number);
            slots.length = 0;
            for (let i = 0; i < sortedSlots.length; i++) slots.push(sortedSlots[i]);
            const consecutive = slots.length > 0 && arrayEvery(slots, (slot, index) => slot.number === index + 1);
            if (!consecutive) {
                console.warn(`JS: 节次作息编号不连续(gnmkdm=${gnmkdm})，改用内置作息`);
                continue;
            }

            console.log(`JS: 读取到真实节次作息 ${slots.length} 节，第 1 节 ${slots[0].startTime}-${slots[0].endTime}`);
            return slots;
        } catch (e) {
            console.warn(`JS: 读取节次作息失败(gnmkdm=${gnmkdm})：${e && e.message}`);
        }
    }
    return null;
}

/* ======================= 保存 ======================= */

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (e) {
        window.shiguangBridge.showToast("课程保存失败：" + (e && e.message));
        console.error("JS: 保存课程失败：", e);
        return false;
    }
}

async function saveTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (e) {
        window.shiguangBridge.showToast("作息时间保存失败：" + (e && e.message));
        console.error("JS: 保存作息失败：", e);
        return false;
    }
}

/**
 * 保存课表配置（开学日期 / 总周数 / 一周起始日 / 单节时长）。
 *
 * 注意：应用侧的 saveCourseConfig 是「整体覆盖」而不是字段级合并——没有传入的字段会被写成
 * 模型默认值，其中 semesterStartDate 默认是 null，会把用户已经设好的开学日期清空。
 * 因此这里在拿不到开学日期时完全不调用该接口，只提示用户手动设置。
 */
async function saveConfig(courses, startDate, firstDayOfWeek, timeSlots) {
    if (!startDate) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表设置，请在应用内手动设置第一周开始日期。");
        console.warn("JS: 未取到开学日期，跳过 saveCourseConfig 以免覆盖用户已设置的开学日期");
        return false;
    }

    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) maxWeek = week;
        }
    }

    const config = {
        semesterStartDate: startDate,
        semesterTotalWeeks: Math.max(maxWeek, CONFIG.MIN_TOTAL_WEEKS),
        firstDayOfWeek: firstDayOfWeek,
        defaultClassDuration: 45,
        defaultBreakDuration: 10
    };

    // 有真实作息时，用第 1 节时长与第 1→2 节间隔推算单节时长与课间时长
    const slots = Array.isArray(timeSlots) ? timeSlots : [];
    if (slots.length >= 2) {
        const toMinutes = (t) => {
            const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
            return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
        };
        const classMinutes = toMinutes(slots[0].endTime) - toMinutes(slots[0].startTime);
        const breakMinutes = toMinutes(slots[1].startTime) - toMinutes(slots[0].endTime);
        if (classMinutes >= 20 && classMinutes <= 120) config.defaultClassDuration = classMinutes;
        if (breakMinutes >= 0 && breakMinutes <= 60) config.defaultBreakDuration = breakMinutes;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (e) {
        window.shiguangBridge.showToast("课表配置保存失败：" + (e && e.message));
        console.error("JS: 保存课表配置失败：", e);
        return false;
    }
}

/* ======================= 主流程 ======================= */

async function runImportFlow() {
    if (isOnSsoPage()) {
        await window.shiguangBridgePromise.showAlert(
            "还停在统一认证页",
            "当前页面是统一认证（uap.jngcxy.edu.cn），请先完成登录，再从门户进入「教务系统」，" +
            "等地址栏变成 vpnxt.jngcxy.edu.cn/jwglxt/... 之后再执行导入。",
            "知道了"
        );
        return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        "济南工程职业技术学院课表导入",
        "开始前请确认：\n" +
        "1. 已登录教务系统，且当前页面在教务系统内（地址带 /jwglxt/）；\n" +
        "2. 校外访问需先连接学校的 aTrust 客户端，否则教务页面无法打开；\n" +
        "3. 导入会覆盖应用内现有课表，请先备份需要保留的课程。\n\n" +
        "点击「开始导入」后请依次选择学年和学期。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入。");
        return;
    }

    const selection = await promptAcademicYearAndSemester();
    if (selection === null) {
        window.shiguangBridge.showToast("已取消导入。");
        return;
    }
    console.log(`JS: 已选择学年学期：${selection.xnm} / ${selection.xqm}`);

    window.shiguangBridge.showToast("正在拉取课表...");

    let json;
    let courses;
    let startDate;
    try {
        json = await fetchCourseTable(selection.xnm, selection.xqm);

        // 课表里带了学年信息时，提示是否与所选学年一致（不一致多半是选错了学期）
        const termHint = json && json.xsxx && json.xsxx.XNM ? String(json.xsxx.XNM) : "";
        if (termHint && String(selection.xnm).slice(0, 4) !== termHint.slice(0, 4)) {
            console.warn(`JS: 课表返回的学年(${termHint})与所选学年(${selection.xnm})不一致，请确认是否选错学期`);
        }

        courses = parseKbList(json);
        startDate = await fetchSemesterStartDate(selection.xnm, selection.xqm);
    } catch (e) {
        if (e && e.message === "SESSION_LOST") {
            await window.shiguangBridgePromise.showAlert(
                "未登录或会话已失效",
                "教务系统返回的是登录页。请先在页面中重新登录教务，再执行导入。",
                "知道了"
            );
        } else {
            await window.shiguangBridgePromise.showAlert(
                "请求失败",
                "错误信息：" + (e && e.message) + "\n\n请确认：\n" +
                "1. 已连接校园网，或已先打开学校的 aTrust 客户端；\n" +
                "2. 已登录教务系统；\n" +
                "3. 所选学年/学期正确。",
                "知道了"
            );
        }
        return;
    }

    if (!courses || courses.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            "没有取到课程",
            "接口返回了空课表。请确认所选学年/学期是否正确；" +
            "若确认无误，可能是本学期尚未排课。",
            "知道了"
        );
        return;
    }

    window.shiguangBridge.showToast(`解析到 ${courses.length} 条课程记录，正在保存...`);

    const saved = await saveCourses(courses);
    if (!saved) return;

    const apiSlots = await fetchTimeSlots(selection.xnm, selection.xqm);
    if (!apiSlots) {
        window.shiguangBridge.showToast("未能读取真实作息，改用内置的本校作息（1-10 节）。");
    }
    const slots = apiSlots || CONFIG.FALLBACK_TIME_SLOTS;
    await saveTimeSlots(slots);

    const rawFirstDay = Number(json && json.qsxqj);
    const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;
    await saveConfig(courses, startDate, firstDayOfWeek, slots);

    const skippedNote = lastSkippedCount > 0
        ? `，另有 ${lastSkippedCount} 条集中实践课（无固定时间）未导入`
        : "";
    window.shiguangBridge.showToast(`导入完成，共 ${courses.length} 条课程${skippedNote}`);
    console.log(`JS: 导入完成，共 ${courses.length} 条课程，跳过 ${lastSkippedCount} 条，开学日期 ${startDate || "(未取到)"}`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
