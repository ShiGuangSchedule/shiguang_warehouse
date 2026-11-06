// 广东科学技术职业学院珠海校区正方教务 V9 适配，适配作者：小漫君
// 页面课程读取参考拾光 resources/zhengfang_jiaowu/zhengfang_01.js，维护者星河欲转，MIT。
// 周次、合并与可选校历/作息保留 resources/SCTBC/sctbc.js，原作者 dclindev，MIT。
// 上游基线：174396aca3edaa0d2df72a55d28a93a2e71c8272。
// 保留已有 GDIT_01 网上办事大厅入口；此入口使用 /jwglxt。
// 按每张课程卡片的“节/周”标签读取范围，不使用合并后的单元格位置推算节次。

const BASE = `${window.location.origin}/jwglxt`;
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
    const match = halfWidth(text).trim().match(/^(?:第)?(\d+)(?:\s*[-－—–~～]\s*(\d+))?节?$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    return start > 0 && end >= start ? { start, end } : null;
}

/** 正方标签对应的可见文本；按语义标签取值，避免可选字段改变 p 元素顺序。 */
function cardField(card, title) {
    const label = [...card.querySelectorAll('p [title]')]
        .find((node) => node.getAttribute('title').trim() === title);
    // 图标标签内部也可能嵌套 font，正文是 p 的直接子节点。
    return label?.closest('p')?.querySelector(':scope > font')?.textContent.trim() || '';
}

/** 沿用拾光正方 HTML 案例读取已查询的课表；表格和列表并存时只读表格，避免重复。 */
function parseRenderedCourses(doc) {
    const cards = [...doc.querySelectorAll('table[id^="kbgrid_table_"] .timetable_con')];
    if (!cards.length) {
        throw new Error("请打开个人课表查询，选择学年学期并点击查询，等课表显示后再导入");
    }
    const courses = [];
    for (const [index, card] of cards.entries()) {
        const cellId = card.closest('td')?.id || '';
        const dayMatch = cellId.match(/^([1-7])-\d+$/);
        const name = (card.querySelector('.title')?.textContent || '').replace(/[●★○]/g, '').trim();
        const label = cardField(card, '节/周').replace(/\s/g, '');
        const time = label.match(/^[（(]([^()（）]+节)[)）](.+)$/);
        const sections = time ? toSections(time[1]) : null;
        const weeks = time ? toWeeks(time[2]) : [];
        // 不以 td.id / rowspan 补节次；同一格中的不同周课程可能有不同起止节次。
        if (!name || !dayMatch || !sections || !weeks.length) {
            throw new Error(`页面第 ${index + 1} 条课程的节次或周次不完整，已停止导入，请重新查询课表`);
        }
        courses.push({
            name,
            teacher: cardField(card, '教师'),
            position: cardField(card, '上课地点'),
            day: Number(dayMatch[1]),
            startSection: sections.start,
            endSection: sections.end,
            weeks
        });
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

// ==================== 可选作息 / 校历 ====================

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
    if (window.location.hostname !== "jw.gdit.edu.cn" || !window.location.pathname.startsWith("/jwglxt/")) {
        throw new Error("请先登录 jw.gdit.edu.cn 的正方教务系统，再点击导入");
    }
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "珠海校区 · 页面课表导入",
        "请先打开个人课表查询，选择学年学期并点击查询，等课表完整显示后再导入。\n\n本次读取页面课程卡片上的节次与周次，请在预览中核对连堂范围。",
        "开始导入"
    );
    if (!confirmed) return;

    const courses = parseRenderedCourses(document);
    const xnm = document.querySelector('#xnm')?.value;
    const xqm = document.querySelector('#xqm')?.value;

    const saved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (saved === false || saved === "false") throw new Error("课程校验未通过，未完成导入");

    // 校历与作息属于附加信息，失败不影响课程导入
    const config = xnm && xqm ? await fetchConfig(xnm, xqm).catch(() => ({})) : {};
    const maxWeek = Math.max(...courses.map((course) => Math.max(...course.weeks)));
    if (config.semesterTotalWeeks && maxWeek > config.semesterTotalWeeks) {
        config.semesterTotalWeeks = maxWeek; // 总周数不得小于课程实际周次，否则课程会被截断
    }
    if (Object.keys(config).length) {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)).catch(() => {});
    }

    const slots = xnm && xqm ? await fetchTimeSlots(xnm, xqm).catch(() => []) : [];
    if (slots.length) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)).catch(() => {});
    }

    window.shiguangBridge.showToast(`导入成功，共 ${courses.length} 条课程安排`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow().catch((error) => {
    console.error("GDIT 导入失败", error);
    window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
});
