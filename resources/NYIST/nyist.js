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

/**
 * 节次与周次合并去重函数（供开发者参考）
 * 将原始课程数组按周次拆解，逐周合并节次，再按相同节次结构重组，最终输出合并去重后的课程数组。
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 按天、课程名、教师、地点将课程分组，相同课程的记录归入同一组
    const grouped = {};
    courses.forEach(c => {
        const name = c.name || '';
        const teacher = c.teacher || '';
        const position = c.position || '';
        const day = c.day || 0;
        
        // 构造唯一标识，用于识别是否为同一门课
        const key = `${day}|${name}|${teacher}|${position}`;
        
        if (!grouped[key]) {
            grouped[key] = {
                name, teacher, position, day,
                // 记录每周对应的节次段，结构如 { 8: [ {start: 5, end: 6}, {start: 7, end: 8} ] }
                weeksMap: {}
            };
        }
        
        // 将该记录覆盖的所有周次拆开，分别记录对应周的节次段
        const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
        weeksArr.forEach(w => {
            if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
            grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
        });
    });

    const finalResult = [];

    // 逐组处理每门课程
    Object.values(grouped).forEach(group => {
        // 获取该课程有课的所有周次，升序排列
        const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);
        
        // 记录每周合并后的最终节次段，结构如 { 8: [ {start: 5, end: 8} ] }
        const processedWeeksMap = {};
        
        sortedWeeks.forEach(w => {
            let parts = group.weeksMap[w];
            
            // 按开始节次和结束节次排序，确保合并顺序正确
            parts.sort((a, b) => a.start - b.start || a.end - b.end);
            
            // 合并该周内连续或重叠的节次段
            const mergedParts = [];
            let cur = parts[0];
            for (let i = 1; i < parts.length; i++) {
                // 如果当前节次段与下一段相邻或重叠，则延长当前段
                if (cur.end + 1 >= parts[i].start) {
                    cur.end = Math.max(cur.end, parts[i].end);
                } else {
                    mergedParts.push(cur);
                    cur = parts[i];
                }
            }
            mergedParts.push(cur);
            processedWeeksMap[w] = mergedParts;
        });

        // 将节次结构完全相同的周次归为一组
        // 结构如 { "节次签名字符串": { sections: [...], weeks: [] } }
        const sectionsMap = {};
        
        sortedWeeks.forEach(w => {
            const parts = processedWeeksMap[w];
            // 将当前周的所有节次段组合成字符串签名，如 "1-2|5-6"
            const sig = parts.map(p => `${p.start}-${p.end}`).join('|');
            
            if (!sectionsMap[sig]) {
                sectionsMap[sig] = { sections: parts, weeks: [] };
            }
            sectionsMap[sig].weeks.push(w);
        });

        // 将每组相同节次结构的周次生成对应的课程对象
        Object.values(sectionsMap).forEach(secGroup => {
            secGroup.sections.forEach(sec => {
                finalResult.push({
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection: sec.start,
                    endSection: sec.end,
                    weeks: secGroup.weeks
                });
            });
        });
    });

    // 按星期、开始节次、课程名、起始周排序，保证输出结果顺序稳定
    finalResult.sort((a, b) => {
        return (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               a.name.localeCompare(b.name) ||
               a.weeks[0] - b.weeks[0];
    });

    return finalResult;
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
            endSection: section,
            weeks
        });
    }
    return mergeAndDistinctCourses(raw);
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
