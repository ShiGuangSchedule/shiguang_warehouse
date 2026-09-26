// resources/SUEP/SUEP_03.js
// 上海电力大学 本科教务系统（eams / 上海树维）拾光课程表适配脚本 —— 接口探测版
//
// 本脚本改自本仓库中天津农学院 (TJAU) 的适配脚本（作者：星河欲转）。
// 两者是同一套「树维 eams」系统，因此沿用它的整体思路：
//   - 用接口探测 ids / tagId，不依赖用户先打开「我的课表」页面；
//   - 用「按周建矩阵、再切连续节次块」的算法合并课程，能正确处理
//     「同一门课不同周次占用不同节次」这种不规则情况。
// 只把 URL、解析规则和节次时间换成了上海电力大学的实际情况。
//
// 导入页（adapters.yaml 的 import_url）：https://jw.shiep.edu.cn/eams/index.action
//
// 前置条件：**只需登录**，不需要打开课表页。
//
// 与 SUEP_01.js / SUEP_02.js 的差别：
//   SUEP_01 读当前页面内联脚本；SUEP_02 已登录后调接口、但参数取自当前页面；
//   本脚本连参数都由接口探测，因此对页面状态没有要求。

const EAMS_BASE = "https://jw.shiep.edu.cn/eams";

/**
 * 同一接口在短时间内被连续请求时，服务端会返回一个约 4 KB 的「精简版」页面
 * （不含工具栏，也不含 ids / tagId 等标记），间隔约 1 秒再请求就恢复正常。
 * 实测：14 次连发只有第 1 次完整；间隔 2 秒的 4 次请求则全部完整。
 * 这不是登录失效，所以收到这种响应应当退避重试，而不是直接报错。
 */
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1000;

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        let char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== '\\')) {
            if (!inQuote) { inQuote = true; quoteChar = char; }
            else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
            if (char === '(' || char === '[' || char === '{') depth++;
            if (char === ')' || char === ']' || char === '}') depth--;
        }
        if (char === ',' && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current));
    return args;
}

function cleanArg(s) {
    s = s.trim();
    if (s === "null") return null;
    return s.replace(/^["']|["']$/g, "");
}

/**
 * 去掉课程名末尾的课程序号。
 * 教务返回的课程名形如 "高等数学A(1)(2800001.32)"，末尾括号里是课程序号，
 * 展示时应去掉；课程名自带的括号要保留，例如 "体育1(篮球)"、
 * "大学英语C读写（1）"（全角括号）。
 * 注意不能简单地 split('(')[0] —— 那会把 "体育1(篮球)" 变成 "体育1"。
 */
function stripCourseNo(courseName) {
    return String(courseName).replace(/\s*\(\s*\d+(?:\.\d+)?\s*\)\s*$/, "").trim();
}

/**
 * 全局课程合并逻辑（沿用 TJAU 脚本的算法）。
 * 按 (课程名|教师|地点|星期) 分组，再把课表打散成「每一周各占哪些节」的矩阵，
 * 最后把矩阵里形状相同的连续节次块聚合成一条课程，因此能正确处理
 * 例如「第 1-9 周上 1-2 节、第 10 周只上第 2 节」这类不规则安排。
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                // 最多按 50 周预留：第 N 周对应哪些节次的矩阵
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        }
        // 按「周」填入对应的「节」，Set 自动去重
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });

    const merged = [];

    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;

        // 记录相同的「连续节次块」出现在哪些周
        // 例如 blockMap["1-2"] = [1, 2, 3, ...]；blockMap["2-2"] = [10]
        const blockMap = {};

        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            let start = sections[0];
            let prev = sections[0];

            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr;
                } else {
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    start = curr;
                    prev = curr;
                }
            }
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey],
                isCustomTime: false,
                customStartTime: null,
                customEndTime: null
            });
        }
    }

    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

/**
 * 解析课表 HTML。
 *
 * 上海电力的响应结构与天津农学院不同：**没有** `var teachers =` / `actTeachers`
 * 那套结构，教师姓名直接就在 TaskActivity 的参数里。所以这里改成按
 * 「activity = new TaskActivity」切块，教师取第 2 个参数。
 *
 * TaskActivity 七个参数（名称取自系统自己的 TaskActivity_New.js）：
 *   teacherId, teacherName, courseId, courseName, roomId, roomName, vaildWeeks
 */
function parseTaskActivities(html) {
    const rawResults = [];

    const unitCountMatch = html.match(/unitCount\s*=\s*(\d+)/);
    const unitCount = unitCountMatch ? parseInt(unitCountMatch[1], 10) : 13;

    const blocks = html.split(/activity\s*=\s*new\s+TaskActivity/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        const argsMatch = block.match(/^\s*\(([\s\S]*?)\)\s*;/);
        if (!argsMatch) continue;

        const args = powerSplit(argsMatch[1]);
        if (args.length < 7) continue;

        const name = stripCourseNo(args[3] || "未知课程");
        const teacher = (args[1] || "").trim() || "未知教师";
        const position = (args[5] || "").trim() || "未知地点";
        const weeksBitmap = args[6] || "";

        // 周次位图：第 i 个字符（i 从 1 开始）为 "1" 表示第 i 周有课，
        // 第 0 位是占位符，恒为 "0"，不能当成第 1 周。
        const weeks = [];
        for (let j = 1; j < weeksBitmap.length; j++) {
            if (weeksBitmap[j] === "1") weeks.push(j);
        }
        if (weeks.length === 0) continue;

        // index = 星期索引 * unitCount + 节次索引，反推即各自 +1
        const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)\s*;/g;
        let m;
        while ((m = idxRegex.exec(block)) !== null) {
            const section = parseInt(m[2], 10) + 1;
            rawResults.push({
                name: name,
                teacher: teacher,
                position: position,
                day: parseInt(m[1], 10) + 1,
                startSection: section,
                endSection: section,
                weeks: weeks
            });
        }
    }

    return mergeContinuousLessons(rawResults);
}

async function request(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) throw new Error(`网络请求失败: ${res.status}`);
    return await res.text();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeLoginPage(html) {
    return /authserver|统一身份认证|应用未注册/.test(html);
}

/**
 * 带退避重试的请求：只有通过 validate 的响应才算拿到完整内容。
 * 传输错误和「响应不完整」都会重试，因为这个接口确实会间歇性地返回精简版页面。
 */
async function requestValidated(url, options, validate, label) {
    let incompleteLength = -1;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const text = await request(url, options);
            if (looksLikeLoginPage(text)) {
                throw new Error("请求被重定向到统一身份认证，请先登录教务系统");
            }
            if (validate(text)) return text;
            incompleteLength = text.length;
            lastError = null;
        } catch (error) {
            lastError = error;
        }

        if (attempt < MAX_ATTEMPTS) {
            console.log(`[拾光] ${label} 第 ${attempt} 次未拿到完整响应，${RETRY_DELAY_MS}ms 后重试`);
            await sleep(RETRY_DELAY_MS);
        }
    }

    if (lastError) throw lastError;
    throw new Error(`${label}连续 ${MAX_ATTEMPTS} 次响应都不完整（最后一次 ${incompleteLength} 字节），请稍后重试`);
}

/**
 * 探测调用课表接口所需的参数。
 * 课表页把 ids（学生内部编号）写在 bg.form.addInput(form,"ids","...") 里，
 * 学期组件的 id 形如 semesterBarXXXSemester，当前学期的编号则写在
 * semesterCalendar({...value:"424"}) 里。
 */
async function detectParameters() {
    // 精简版页面里没有这两个标记，所以必须校验后重试
    const validate = html => /bg\.form\.addInput\(form,"ids","\d+"\)/.test(html)
        && /id="semesterBar\d+Semester"/.test(html);

    const html = await requestValidated(
        `${EAMS_BASE}/courseTableForStd.action`, {}, validate, "探测课表参数"
    );

    const idsMatch = html.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    const currentSemesterMatch = html.match(/semesterCalendar\(\{[^}]*value:"(\d+)"/);
    return {
        ids: idsMatch[1],
        tagId: tagIdMatch[1],
        currentSemesterId: currentSemesterMatch ? currentSemesterMatch[1] : ""
    };
}

/**
 * 解析学期列表。
 * 响应是一段 JS 对象字面量（不是标准 JSON，键没有引号）：
 *   {yearDom:"...", termDom:"...",
 *    semesters:{y0:[{id:32,schoolYear:"2013-2014",name:"2"}], ...},
 *    yearIndex:"13", termIndex:"0", semesterId:"424"}
 * 这里不 eval 它（不执行服务端返回的代码），只用正则抽取值；顺序天然按学年排列。
 */
function parseSemesterList(text) {
    const pattern = /id:(\d+)\s*,\s*schoolYear:"([^"]*)"\s*,\s*name:"([^"]*)"/g;
    const list = [];
    let m;
    while ((m = pattern.exec(text)) !== null) {
        list.push({ id: m[1], name: `${m[2]}学年${m[3]}学期` });
    }
    return list;
}

async function getSelectedSemester(tagId, currentSemesterId) {
    const raw = await requestValidated(`${EAMS_BASE}/dataQuery.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar`
            + `&value=${encodeURIComponent(currentSemesterId)}&empty=false`
    }, text => parseSemesterList(text).length > 0, "获取学期列表");

    const list = parseSemesterList(raw);
    if (list.length === 0) throw new Error("未解析到学期列表");

    // 默认选中当前学期，避免默认停在最早的学期上
    let defaultIndex = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === currentSemesterId) defaultIndex = i;
    }

    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(list.map(s => s.name)), defaultIndex
    );
    return idx !== null ? list[idx] : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    // 真正的课表响应一定含 "new CourseTable"（哪怕是空课表），
    // 精简版页面没有它 —— 用它区分「响应不完整要重试」和「这个学期确实没课」
    const html = await requestValidated(`${EAMS_BASE}/courseTableForStd!courseTable.action`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `ignoreHead=1&setting.kind=std&semester.id=${semesterId}&ids=${ids}`
    }, text => /new CourseTable/.test(text), "获取课表数据");

    if (!/new TaskActivity/.test(html)) {
        throw new Error("该学期没有课程数据（课表为空），请换一个学期再试");
    }
    return parseTaskActivities(html);
}

/**
 * 上海电力大学各节次起止时间（共 13 节）。
 * eams 只给节次编号、不给时间，所以按学校作息表写死。
 * 时间整理自公开资料，请以教务处公布的最新作息为准；如有出入直接改这里。
 */
async function applyTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:20", "endTime": "09:05" },
        { "number": 2, "startTime": "09:10", "endTime": "09:55" },
        { "number": 3, "startTime": "10:10", "endTime": "10:55" },
        { "number": 4, "startTime": "11:00", "endTime": "11:45" },
        { "number": 5, "startTime": "11:50", "endTime": "12:30" },
        { "number": 6, "startTime": "13:20", "endTime": "14:05" },
        { "number": 7, "startTime": "14:10", "endTime": "14:55" },
        { "number": 8, "startTime": "15:10", "endTime": "15:55" },
        { "number": 9, "startTime": "16:00", "endTime": "16:45" },
        { "number": 10, "startTime": "16:50", "endTime": "17:30" },
        { "number": 11, "startTime": "18:15", "endTime": "19:00" },
        { "number": 12, "startTime": "19:05", "endTime": "19:50" },
        { "number": 13, "startTime": "19:55", "endTime": "20:35" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();

        const semester = await getSelectedSemester(params.tagId, params.currentSemesterId);
        if (!semester) return;

        window.shiguangBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);

        if (!courses || courses.length === 0) throw new Error("未解析到课程数据");

        await applyTimeSlots();
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        if (saveResult) {
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error(`[异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();
