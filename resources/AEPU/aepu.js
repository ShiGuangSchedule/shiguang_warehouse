// 安徽电气工程职业技术学院教务系统（zt.aepu.com.cn）拾光课表导入适配脚本
// 金智老版通用教务（jwapp/sys/wdkb 模块）：
//   cxxszhxqkb.do 综合课表（主） + xsdkkc.do 已选课（补充）
// 周次用 SKZC 位图（"000000000000000000100" 第19位为1表示第19周）
// 通过 webvpn 访问，接口前缀取自当前页面 URL。

// 预设作息时间（该校实际 10 节）
const AEPU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "15:45", endTime: "16:30" },
    { number: 8, startTime: "16:35", endTime: "17:20" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures and use the generic fallback below.
    }
    return "未知错误";
}

// 从当前页面 URL 提取 jwapp 之前的前缀（含 webvpn 哈希），用于拼接各接口地址
function getApiBase() {
    const m = window.location.href.match(/^(https?:\/\/[^/]+(?:[^?#]*)?)\/jwapp/);
    return m ? m[1] : window.location.origin;
}

const API_BASE = getApiBase();
const MODULES = {
    table: `${API_BASE}/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do?enlink-vpn`,
    selected: `${API_BASE}/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do?enlink-vpn`,
    semester: `${API_BASE}/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do?enlink-vpn`
};

// 从页面存储中提取 JWT 鉴权 token（金智常见 key + 全量扫描兜底）
function getAuthToken() {
    const keys = ["Authorization", "access_token", "token", "X-Access-Token", "x-token", "auth_token", "jwt", "user_token"];
    for (const k of keys) {
        try {
            const v = window.localStorage.getItem(k) || window.sessionStorage.getItem(k);
            if (v && v.includes("eyJ")) return v;
        } catch (_) {
            // Ignore storage access errors.
        }
    }
    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
        try {
            for (let i = 0; i < store.length; i++) {
                const raw = store.getItem(store.key(i));
                if (!raw) continue;
                if (raw.startsWith("eyJ")) return raw;
                const m = raw.match(/"([^"]*eyJ[^"]*)"/);
                if (m) return m[1];
            }
        } catch (_) {
            // Ignore storage access errors.
        }
    }
    return null;
}

async function postForm(url, params) {
    const token = getAuthToken();
    const headers = { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" };
    if (token) headers["Authorization"] = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
    const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
    return response.json();
}

// 解析 SKZC 位图："000000000000000000100" → [19]（第 i 位为 '1' 表示第 i+1 周）
function parseWeekBitmap(bitmap) {
    const weeks = [];
    const s = String(bitmap || "");
    for (let i = 0; i < s.length; i++) {
        if (s.charAt(i) === "1") weeks.push(i + 1);
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 清洗教师名："周锐\/2009021059" → "周锐"；"王磊,易庆" → "王磊、易庆"
function cleanTeacher(name) {
    const cleaned = String(name || "")
        .replace(/\/\d+$/i, "")
        .split(/[,，]/)
        .map(s => s.trim())
        .filter(Boolean)
        .join("、");
    return cleaned || "未知";
}

// 生成去重键（忽略位置，同一门课的多次调课合并到周次集合）
function courseKey(c, detailKey) {
    return `${detailKey}|1`;
}

// 从单个课表行构造课程（合并同名、同星期、同节次、同教师下的周次与教室）
// each() 收集原始行，随后按 (name|teacher|day|start|end) 合并周次
function feedRow(map, row) {
    const name = String(row.KCM || "").trim();
    if (!name) return;
    const teacher = cleanTeacher(row.SKJS);
    const day = Number(row.SKXQ);
    const startSection = Number(row.KSJC);
    const endSection = Number(row.JSJC);
    if (!day || day < 1 || day > 7) return;
    if (!startSection || !endSection || startSection > endSection) return;

    const weeks = parseWeekBitmap(row.SKZC);
    if (weeks.length === 0) return;

    const position = String(row.JASMC || row.JXLDM_DISPLAY || "待定").trim();
    // 去重键含位置，避免同一门课不同教室（不同周次）被错误合并
    const key = `${name}|${teacher}|${day}|${startSection}|${endSection}|${position}`;
    const holder = map.get(key);
    if (holder) {
        holder.weeks = Array.from(new Set([...holder.weeks, ...weeks])).sort((a, b) => a - b);
        if (position && position !== "待定" && !holder.position.includes(position)) {
            holder.position = position;
        }
    } else {
        map.set(key, {
            name,
            teacher,
            position: position || "待定",
            day,
            startSection,
            endSection,
            weeks
        });
    }
}

// 处理调课记录（xsdkkc）：按新时间生效——
// 从主课表移除"原时间"周次，再把"新时间"合并进对应条目（无则新建）
// 记录字段：原时间 SKZC/SKXQ/KSJC/JSJC（教师 SKJS 为 null），新时间 XSKZC/XSKXQ/XKSJC/XJSJC（教师 XSKJS，教室 XJASMC）
function feedAdjustment(map, row) {
    const name = String(row.KCM || "").trim();
    if (!name) return;
    const teacher = cleanTeacher(row.XSKJS || row.SKJS);

    const origDay = Number(row.SKXQ);
    const origStart = Number(row.KSJC);
    const origEnd = Number(row.JSJC);
    const origWeeks = parseWeekBitmap(row.SKZC);

    // 1) 从主课表移除原时间周次
    if (origDay >= 1 && origDay <= 7 && origStart && origEnd && origWeeks.length > 0) {
        const origPos = String(row.JASMC || "").trim();
        const removed = new Set(origWeeks);
        // 若存在"课名+星期+节次+原教室"精确条目则只删它，否则退化为删同课同时段所有条目
        let precise = false;
        for (const c of map.values()) {
            if (c.name === name && c.day === origDay && c.startSection === origStart &&
                c.endSection === origEnd && origPos && c.position === origPos) {
                precise = true;
                break;
            }
        }
        for (const c of map.values()) {
            if (c.name !== name || c.day !== origDay || c.startSection !== origStart || c.endSection !== origEnd) continue;
            if (!precise || (origPos && c.position === origPos)) {
                c.weeks = c.weeks.filter(w => !removed.has(w));
            }
        }
    }

    // 2) 合并新时间到课表
    const newDay = Number(row.XSKXQ);
    const newStart = Number(row.XKSJC);
    const newEnd = Number(row.XJSJC);
    const newWeeks = parseWeekBitmap(row.XSKZC);
    if (!(newDay >= 1 && newDay <= 7) || !newStart || !newEnd || newWeeks.length === 0) return;
    const newPosition = String(row.XJASMC || row.JASMC || "待定").trim();
    const key = `${name}|${teacher}|${newDay}|${newStart}|${newEnd}|${newPosition}`;
    const holder = map.get(key);
    if (holder) {
        holder.weeks = Array.from(new Set([...holder.weeks, ...newWeeks])).sort((a, b) => a - b);
    } else {
        map.set(key, {
            name,
            teacher: teacher || "未知",
            position: newPosition || "待定",
            day: newDay,
            startSection: newStart,
            endSection: newEnd,
            weeks: newWeeks
        });
    }
}

// 解析金智标准响应结构 datas.<key>.rows
function resolveRows(payload, key) {
    const ds = payload && payload.datas && payload.datas[key];
    return ds && Array.isArray(ds.rows) ? ds.rows : [];
}

// 从学期行提取开学配置（开学日期、总周数）
function semesterConfigOf(s) {
    const beginDate = String((s && s.XQKSRQ) || "").split(" ")[0];
    const totalWeeks = Number(s && s.ZZC) || Number(s && s.ZJXZC) || 0;
    return { beginDate, totalWeeks };
}

async function fetchCourses(xnxqdm) {
    // 理论课：cxxszhxqkb.do 不带 KCJBDM；实训课：带 KCJBDM=2；调课：xsdkkc.do
    const merged = new Map();

    window.shiguangBridge.showToast("正在请求课表数据...");
    const [theoryPayload, practicalPayload, adjustPayload] = await Promise.all([
        postForm(MODULES.table, { XNXQDM: xnxqdm }),
        postForm(MODULES.table, { XNXQDM: xnxqdm, KCJBDM: "2" }),
        postForm(MODULES.selected, { XNXQDM: xnxqdm, "*order": "-SQSJ" })
    ]);
    resolveRows(theoryPayload, "cxxszhxqkb").forEach(r => feedRow(merged, r));
    resolveRows(practicalPayload, "cxxszhxqkb").forEach(r => feedRow(merged, r));
    // 调课记录最后处理：按新时间生效，覆盖/合并主课表
    resolveRows(adjustPayload, "xsdkkc").forEach(r => feedAdjustment(merged, r));

    const courses = Array.from(merged.values());
    courses.sort((a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
    return courses;
}

async function saveCourseConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        console.log(`JS: 课表配置保存成功（开学 ${config.semesterStartDate}，共 ${config.semesterTotalWeeks} 周）`);
    } catch (error) {
        console.error("JS: 课表配置保存失败:", error);
    }
}

// 保存预设作息时间（失败仅告警，不阻断课程导入）
async function saveTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        console.log("JS: 作息时间保存成功");
    } catch (error) {
        console.error("JS: 作息时间保存失败:", error);
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已登录教务系统，建议在课表页面进行导入",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    try {
        let xnxqdm = "";

        window.shiguangBridge.showToast("正在获取学期信息...");
        const sessions = await postForm(MODULES.semester, {});

        // 学期列表按开学日期降序（最新学期排最前），弹出选择器默认选中第一个
        const rows = (resolveRows(sessions, "cxjcs") || [])
            .filter(s => s && s.XN && s.XQ !== undefined && s.XQ !== null)
            .sort((a, b) => {
                const da = new Date(String(a.XQKSRQ || "").split(" ")[0]).getTime();
                const db = new Date(String(b.XQKSRQ || "").split(" ")[0]).getTime();
                return (db || 0) - (da || 0);
            });
        if (rows.length === 0) throw new Error("未能获取到学期列表。");

        const names = rows.map(s => `${s.XN}年第${s.XQ}学期`);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择学期",
            JSON.stringify(names),
            0
        );
        if (selectedIndex === null || selectedIndex === undefined) {
            window.shiguangBridge.showToast("用户取消了导入。");
            return;
        }
        xnxqdm = `${rows[selectedIndex].XN}-${rows[selectedIndex].XQ}`;

        console.log(`JS: 使用学期 ${xnxqdm}`);
        const courses = await fetchCourses(xnxqdm);
        if (courses.length === 0) throw new Error("未获取到有效课程数据。");

        window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));

        // 开学日期/总周数直接取自用户选择的学期行（XQKSRQ / ZZC）
        const { beginDate, totalWeeks } = semesterConfigOf(rows[selectedIndex]);
        if (beginDate && totalWeeks) {
            await saveCourseConfig({ semesterStartDate: beginDate, semesterTotalWeeks: totalWeeks });
        }

        await saveTimeSlots(AEPU_TIME_SLOTS);

        window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error:", error);
    }
}

runImportFlow();