// 文件: cqie_01.js
// 重庆工程学院(cqie.edu.cn)拾光课程表适配脚本
// 适配新教务系统（njw.cqie.edu.cn），登录门户 i.cqie.edu.cn 后进入教务系统页面执行导入
// 导入前可选择学期，默认最新学期
// 出现问题请提交 pr 更改，这更加快速

// 隔离所有声明，允许脚本在同一 WebView 中失败或取消后再次执行
(async () => {
const HOST = 'njw.cqie.edu.cn';
const RESOURCE_API = 'https://njw.cqie.edu.cn/api/resourceapi';
const TIMETABLE_API = 'https://njw.cqie.edu.cn/api/timetable';
const USER_API = 'https://njw.cqie.edu.cn/api/userserver';
const AUTH_API = 'https://njw.cqie.edu.cn/authserver';

// 注意：本校新教务平台的存储前缀沿用厂商默认的 "cqu_edu_"

// 读取前端存储的访问令牌（兼容 localStorage / sessionStorage，去除引号）
function getAccessToken() {
    const keys = ['cqu_edu_ACCESS_TOKEN', 'cqu_edu_CURRENT_TOKEN'];
    for (const store of [window.localStorage, window.sessionStorage]) {
        for (const key of keys) {
            const value = store.getItem(key);
            if (value) return value.replaceAll('"', '');
        }
    }
    return null;
}

// 从前端缓存的用户信息中读取学号
// 缓存位置：sessionStorage 裸键 "USER_INFO"（登录服务写入）及各存储中 "*_USER_INFO" 键
function getCachedStudentId() {
    for (const store of [window.localStorage, window.sessionStorage]) {
        for (const key of Object.keys(store)) {
            if (key !== 'USER_INFO' && !key.endsWith('_USER_INFO')) continue;
            try {
                const info = JSON.parse(store.getItem(key));
                if (!info || typeof info !== 'object') continue;
                const sid = info.code ?? info.userCode;
                if (isPlausibleStudentId(sid)) return String(sid);
            } catch (e) { /* 缓存内容不是合法 JSON，跳过 */ }
        }
    }
    return null;
}

// 过滤掉疑似响应状态码的值（200/404 等），避免把接口包装层的 code 误认成学号
function isPlausibleStudentId(value) {
    if (value === null || value === undefined) return false;
    const text = String(value).trim();
    if (text.length < 4) return false;
    return !['0', '200', '401', '403', '404', '500'].includes(text);
}

// 通过登录服务的用户信息接口获取学号（与前端 simple-user 接口一致）
async function fetchRemoteStudentId() {
    const json = await apiFetch(`${AUTH_API}/simple-user`, {}, "获取学号");
    for (const info of [json, unwrap(json)]) {
        if (!info || typeof info !== 'object') continue;
        const sid = info.code ?? info.userCode ?? info.account;
        if (isPlausibleStudentId(sid)) return String(sid);
    }
    return null;
}

// 学号获取：缓存 -> 登录服务接口 -> 手动输入兜底
async function getStudentId() {
    const cached = getCachedStudentId();
    if (cached) return cached;
    try {
        const remote = await fetchRemoteStudentId();
        if (remote) return remote;
    } catch (e) {
        console.warn("获取学号接口失败:", e);
    }
    return await promptStudentId();
}

// 学号输入校验（供 showPrompt 按名回调使用；桥接在页面全局作用域查找函数，必须挂到 window 上）
window.validateStudentId = function (studentId) {
    if (studentId === null || studentId.trim().length === 0) {
        return "学号不能为空！";
    }
    return false;
};

// 兜底：通过弹窗让用户手动输入学号
async function promptStudentId() {
    const input = await window.shiguangBridgePromise.showPrompt(
        "输入学号",
        "未能自动识别学号，请输入你的学号：",
        "",
        "validateStudentId"
    );
    if (input === null) throw new Error("用户取消了学号输入");
    return input.trim();
}

// 通用请求封装，携带登录令牌；响应体兼容 JSON/空体/非 JSON（如网关异常页）
async function apiFetch(url, options = {}, description = "数据") {
    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAccessToken()}`,
            ...(options.headers || {}),
        },
    });
    if (response.status === 401 || response.status === 403) {
        window.shiguangBridge.showToast(`${description}失败，登录已失效，请退出重试`);
        throw new Error(`${description}失败: 登录状态失效 (${response.status})`);
    }
    if (!response.ok) {
        window.shiguangBridge.showToast(`${description}失败，请稍后重试`);
        throw new Error(`${description}失败: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    if (!text || !text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn(`${description}：响应不是 JSON（前 120 字符）:`, text.slice(0, 120));
        return { raw: text };
    }
}

// 兼容两种响应结构：{code, data: {...}} 或扁平结构
const unwrap = (json) => (json && typeof json.data !== 'undefined' ? json.data : json);

// 获取学期列表（含系统当前学期 ID）
// 优先取"已发布课表"的学期（前端课表页的选择器即用此接口），避免列出全校全量学期；
// 该接口失败时回退到 info-detail 的 sessionFinder 全量列表。
// session/list 仅用于补充开始日期（排序用），失败不影响流程。
async function getSessionInfo() {
    const json = await apiFetch(`${RESOURCE_API}/session/info-detail`, {}, "获取学期信息");
    const data = unwrap(json) || {};
    let sessions = [];
    try {
        const releaseJson = await apiFetch(`${TIMETABLE_API}/optionFinder/session-release-schedule`, {}, "获取已发布课表的学期");
        const release = unwrap(releaseJson) ?? [];
        if (Array.isArray(release) && release.length > 0) {
            sessions = release
                .filter((session) => session && session.id != null)
                .map((session) => ({ id: String(session.id), name: session.name ?? String(session.id), beginDate: session.beginDate ?? null }));
        }
    } catch (e) {
        console.warn("获取已发布课表学期失败，回退全量学期列表:", e);
    }
    if (sessions.length === 0) {
        sessions = (json.sessionFinder ?? data.sessionFinder ?? [])
            .filter((session) => session && session.id != null && session.id !== '')
            .map((session) => ({ id: String(session.id), name: session.name ?? String(session.id), beginDate: null }));
    }
    try {
        const listJson = await apiFetch(`${RESOURCE_API}/session/list`, {}, "获取学期列表");
        const list = unwrap(listJson)?.sessionVOList ?? [];
        if (list.length > 0) {
            const byId = new Map(list.map((session) => [String(session.id), session]));
            sessions = sessions.map((session) => ({ ...session, beginDate: session.beginDate ?? byId.get(session.id)?.beginDate ?? null }));
        }
    } catch (e) {
        console.warn("获取学期列表失败，将按学期名称排序:", e);
    }
    const curSessionId = json.curSessionId ?? data.curSessionId ?? data.id ?? json.id;
    return { curSessionId: curSessionId == null ? null : String(curSessionId), sessions };
}

// 学期排序键（数值越大越新）：优先学期开始日期（兼容带时间的日期串），
// 否则解析名称中的学年与学期序号（如 "2025-2026学年第二学期"、"2026秋"）
const TERM_NUM = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "春": 1, "夏": 2, "秋": 3, "冬": 4 };
function sessionSortKey(session) {
    const dateMatch = session.beginDate ? String(session.beginDate).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    if (dateMatch) return Number(dateMatch[1] + dateMatch[2] + dateMatch[3]);
    const name = session.name || "";
    const year = Number((name.match(/\d{4}/) ?? ["0"])[0]);
    const termMatch = name.match(/第([一二三四五六七八\d]+)学期|([春夏秋冬])/);
    let term = 0;
    if (termMatch) {
        term = termMatch[1] !== undefined
            ? (TERM_NUM[termMatch[1]] ?? parseInt(termMatch[1], 10) ?? 0)
            : (TERM_NUM[termMatch[2]] ?? 0);
    }
    return year * 100 + term;
}

// 弹窗选择学期，返回选中学期；列表已按新到旧排序，默认选中第一项（最新学期）
async function selectSession(sessions, curSessionId) {
    const labels = sessions.map((session) =>
        session.id === curSessionId ? `${session.name}（当前学期）` : session.name
    );
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择要导入的学期",
        JSON.stringify(labels),
        0
    );
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= sessions.length) {
        return null; // 用户取消
    }
    return sessions[selectedIndex];
}

// 切换服务端当前学期：课表接口按服务端会话学期返回数据，忽略 sessionId 参数。
// 注意：前端调用此接口用的是普通 post（表单格式）而非 postJson（JSON），
// body 必须是 urlencoded 的 curSessionId，发 JSON 会被后端静默忽略（返回 200 但不切换）
async function switchSession(sessionId) {
    const json = await apiFetch(`${USER_API}/user-switch-session`, {
        method: 'POST',
        body: `curSessionId=${encodeURIComponent(sessionId)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, "切换学期");
    if (json && json.status === 'error') {
        window.shiguangBridge.showToast(`切换学期失败（${json.msg ?? '未知错误'}），请重试`);
        throw new Error(`切换学期失败: ${json.msg ?? '未知错误'}`);
    }
}

// 获取学期开始日期（规范化为 yyyy-MM-dd，App 无法解析带时间的日期串）
async function getStartDate(sessionId) {
    const json = await apiFetch(`${RESOURCE_API}/session/detail/${sessionId}`, {}, "获取学期起止信息");
    const data = unwrap(json) || {};
    const raw = data.beginDate ?? json.beginDate ?? null;
    const matched = raw ? String(raw).match(/^(\d{4}-\d{2}-\d{2})/) : null;
    return matched ? matched[1] : null;
}

// 获取学期最大周数
async function getMaxWeek(sessionId) {
    const json = await apiFetch(`${TIMETABLE_API}/course/maxWeek/${sessionId}`, {}, "获取最大周数");
    const maxWeek = Number(unwrap(json));
    return Number.isFinite(maxWeek) && maxWeek > 0 ? maxWeek : null;
}

// 获取大节时间配置（periodList 内字段为 smallPeriod/startTime/endTime）
async function getTimeSlots() {
    const json = await apiFetch(`${RESOURCE_API}/timePattern/get-large-period`, {}, "获取时间段配置");
    const groups = unwrap(json) || [];
    let periods = (groups[0] && groups[0].periodList) || [];
    if (periods.length === 0 && groups.length > 0) {
        periods = groups.flatMap((group) => group.periodList || []);
    }
    return periods.map((period, index) => ({
        number: period.smallPeriod ?? index + 1,
        startTime: period.startTime ?? '',
        endTime: period.endTime ?? '',
    }));
}

// 获取指定学期、指定学号的课表原始数据
// 优先 stu/schedule-detail（我的课表页使用），为空或失败时回退 student/my-table-detail，
// 两个接口参数与返回结构一致（classTimetableVOList）
async function fetchScheduleList(url, studentId, description) {
    const json = await apiFetch(url, { method: 'POST', body: JSON.stringify([studentId]) }, description);
    const payload = unwrap(json) || {};
    return payload.classTimetableVOList ?? json.classTimetableVOList ?? [];
}

async function getSchedule(sessionId, studentId) {
    const primary = `${TIMETABLE_API}/class/timetable/stu/schedule-detail?sessionId=${sessionId}`;
    const fallback = `${TIMETABLE_API}/class/timetable/student/my-table-detail?sessionId=${sessionId}`;
    try {
        const list = await fetchScheduleList(primary, studentId, "获取课程表");
        if (list.length > 0) return list;
        console.warn("stu/schedule-detail 返回为空，尝试备用接口");
    } catch (e) {
        console.warn("stu/schedule-detail 查询失败，尝试备用接口:", e);
    }
    return await fetchScheduleList(fallback, studentId, "获取课程表(备用)");
}

// 解析周次字符串，与前端逻辑一致：支持 "1-16"、"1,3,5"、"1-8,10-16" 等
function parseWeeks(weekFormat) {
    const weeks = [];
    if (!weekFormat) return weeks;
    const parts = String(weekFormat).replace(/，/g, ',').split(',');
    for (const part of parts) {
        const range = part.split('-');
        const start = parseInt(range[0], 10);
        const end = parseInt(range[1], 10);
        if (range.length > 1) {
            if (isNaN(start) || isNaN(end)) continue;
            const [from, to] = start > end ? [end, start] : [start, end];
            for (let week = from; week <= to; week++) {
                if (week > 0) weeks.push(week);
            }
        } else if (range[0] !== '' && !isNaN(start) && start > 0) {
            weeks.push(start);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 兼容旧版二进制周次串（如 "101010..."）
function parseBinaryWeeks(binary) {
    if (typeof binary !== 'string' || !/^[01]+$/.test(binary)) return [];
    return [...binary].reduce((weeks, char, index) => {
        if (char === '1') weeks.push(index + 1);
        return weeks;
    }, []);
}

// 解析节次字符串（如 "1-2" 或 "3"）
function parsePeriodFormat(periodFormat) {
    if (!periodFormat) return null;
    const parts = String(periodFormat).trim().split('-');
    const start = parseInt(parts[0], 10);
    const end = parts.length > 1 ? parseInt(parts[1], 10) : start;
    if (isNaN(start) || isNaN(end)) return null;
    return { start, end };
}

// 清理教师名：去掉工号与 "[主讲];" 等标记（如 "罗桓-03068[主讲];" -> "罗桓"）
function cleanTeacher(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    const names = text.split(/[;,，；]/)
        .map((part) => part.replace(/\[[^\]]*\]/g, '').replace(/-\d+$/, '').trim())
        .filter(Boolean);
    return names.length > 0 ? names.join(',') : text;
}

// 将课表数据转换为拾光课程表格式
function parseSchedule(schedule) {
    const courses = [];
    for (const item of schedule) {
        if (!item || !item.courseName) continue;
        const period = parsePeriodFormat(item.periodFormat);
        let weeks = parseWeeks(item.teachingWeekFormat);
        if (weeks.length === 0) weeks = parseBinaryWeeks(item.teachingWeek);
        if (!period || weeks.length === 0) continue;
        const day = Number(item.weekDay) || 0;
        if (day < 1 || day > 7) continue;
        const [startSection, endSection] = period.start <= period.end
            ? [period.start, period.end]
            : [period.end, period.start];
        courses.push({
            name: item.courseName,
            teacher: cleanTeacher(item.instructorName),
            position: item.position || item.roomName || '',
            day,
            startSection,
            endSection,
            weeks,
        });
    }
    return courses;
}

// 保存课表数据到拾光课程表
async function saveSchedule(parsedSchedule) {
    const tasks = [];
    const config = {};
    if (parsedSchedule.startDate) config.semesterStartDate = parsedSchedule.startDate;
    if (parsedSchedule.maxWeek) config.semesterTotalWeeks = parsedSchedule.maxWeek;
    if (Object.keys(config).length > 0) {
        tasks.push(window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)));
    }
    if (parsedSchedule.timeSlots.length > 0) {
        tasks.push(window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parsedSchedule.timeSlots)));
    }
    tasks.push(window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedSchedule.courses)));
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
        console.error("保存过程出现错误:", failed.map((result) => result.reason));
        window.shiguangBridge.showToast("部分数据保存失败，请查看日志后重试");
        return false;
    }
    return true;
}

async function main() {
    if (window.location.hostname !== HOST) {
        window.shiguangBridge.showToast("请先登录并进入重庆工程学院新教务系统页面，再执行导入！");
        return;
    }
    if (!getAccessToken()) {
        window.shiguangBridge.showToast("尚未登录新教务系统，请先登录！");
        throw new Error("未检测到登录状态");
    }

    // 获取学期列表，按新到旧排序后弹窗选择，默认最新学期
    const { curSessionId, sessions } = await getSessionInfo();
    if (sessions.length === 0) {
        window.shiguangBridge.showToast("未获取到学期列表，请稍后重试");
        throw new Error("学期列表为空");
    }
    sessions.sort((a, b) => sessionSortKey(b) - sessionSortKey(a));
    const chosen = await selectSession(sessions, curSessionId);
    if (!chosen) return;

    const confirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        `将导入「${chosen.name}」学期的课表`,
        "好的，开始导入"
    );
    if (!confirmed) return;

    // 先切换服务端当前学期，否则课表接口会返回系统默认学期的数据
    await switchSession(chosen.id);

    const studentId = await getStudentId();
    const sessionId = chosen.id;
    const [startDate, maxWeek, timeSlots, schedule] = await Promise.all([
        getStartDate(sessionId),
        getMaxWeek(sessionId),
        getTimeSlots(),
        getSchedule(sessionId, studentId),
    ]);

    const courses = parseSchedule(schedule);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程数据，请确认所选学期有课表后再试");
        throw new Error("课表数据为空");
    }

    const success = await saveSchedule({ startDate, maxWeek, timeSlots, courses });
    if (success) {
        window.shiguangBridge.showToast(`「${chosen.name}」导入成功，共 ${courses.length} 条课程记录！`);
        window.shiguangBridge.notifyTaskCompletion();
    }
}

// 兜底捕获所有未处理异常，避免导入失败时无任何提示
main().catch((e) => {
    console.error("导入过程出现错误:", e);
    try {
        window.shiguangBridge.showToast(`导入失败：${e?.message ?? e}`);
    } catch (_) { /* 桥不可用时仅记录日志 */ }
});
})();
