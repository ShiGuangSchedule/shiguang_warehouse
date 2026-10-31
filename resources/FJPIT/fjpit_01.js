// 福建信息职业技术学院（福信智慧教务）课表导入适配脚本
// 前端 jw.fjpit.com · 接口 jw-api.fjpit.com/api · 鉴权头 ba-token + server: 1
// 取数直接请求接口，不解析页面 HTML；教师/教室按原文原样保留（空即空）

const FJPIT_API = 'https://jw-api.fjpit.com/api';
const FJPIT_HOST_KEY = 'fjpit.com';
const FJPIT_LOGIN_WAIT_MS = 5 * 60 * 1000;
const FJPIT_BREAK_RE = /中午|午休|午间|晚休|休息/;   // 作息表里的非上课行，需剔除

// ---------- 通用工具 ----------

function fjpitDelay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

function fjpitUuid() {
    try { return crypto.randomUUID(); } catch (e) { return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
}

/** 把日期对齐到所在周的周一（教务给的 startDate 不保证是周一）；用 UTC 运算避免时区挪日 */
function fjpitAlignToMonday(dateStr) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr == null ? '' : dateStr));
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (isNaN(d.getTime())) return '';
    const dow = d.getUTCDay();                                // 0 = 周日
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function fjpitSafeToast(msg) {
    try { window.shiguangBridge.showToast(msg); } catch (e) { console.log('JS[toast]: ' + msg); }
}

// ---------- 一、鉴权 ----------

/** 从 Pinia store 取 accessToken；取不到返回 null，由调用方走「请登录」引导 */
function fjpitGetAccessToken() {
    const root = document.querySelector('#app') || document.body.firstElementChild;
    const app = root && root.__vue_app__;
    const gp = app && app.config && app.config.globalProperties;
    const pinia = gp && gp.$pinia;
    if (!pinia || !(pinia._s instanceof Map)) return null;
    let fallback = null;
    for (const entry of pinia._s) {
        const store = entry[1];
        if (store && typeof store.accessToken === 'string' && store.accessToken) {
            if (String(entry[0]).indexOf('access') >= 0) return store.accessToken;
            if (!fallback) fallback = store.accessToken;
        }
    }
    return fallback;
}

/** 结构化接口用的头 —— 与移动端 m.fjpit.com 一致 */
function fjpitApiHeaders(token) {
    const h = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'server': '1',
        'unique-request-id': fjpitUuid(),
        'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    if (token) h['ba-token'] = token;
    return h;
}

// ---------- 二、取数（结构化 API） ----------

// 教务 WAF 有短时速率限制（连续快速请求会被成片拒绝），故加请求间隔 + 失败退避重试
// 一旦出现失败就把全局间隔翻倍（上限 800ms）自适应降速，宁可慢也要把数据取全
const FJPIT_REQ_GAP_MS = 90;        // 相邻请求最小间隔（起始值）
const FJPIT_GAP_MAX_MS = 800;       // 自适应间隔上限
const FJPIT_MAX_ATTEMPT = 3;        // 单个请求最多尝试次数
const FJPIT_RETRY_BASE_MS = 400;    // 退避基数（第 n 次重试等 n × 此值）
const FJPIT_WEEK_CONCURRENCY = 5;   // 逐周抓取的并发度

let FJPIT_CUR_GAP_MS = FJPIT_REQ_GAP_MS;
let FJPIT_LAST_REQ_AT = 0;

/** 请求节流：保证相邻请求之间有最小间隔（间隔随失败自适应放宽） */
async function fjpitPace() {
    const wait = FJPIT_CUR_GAP_MS - (Date.now() - FJPIT_LAST_REQ_AT);
    if (wait > 0) await fjpitDelay(wait);
    FJPIT_LAST_REQ_AT = Date.now();
}

/** 统一请求入口：节流 + 失败退避 */
async function fjpitApiRequest(method, path, body, token) {
    let lastErr = null;
    for (let attempt = 1; attempt <= FJPIT_MAX_ATTEMPT; attempt++) {
        await fjpitPace();
        try {
            const init = {
                method: method,
                headers: fjpitApiHeaders(token),
                credentials: 'omit',
                mode: 'cors'
            };
            if (body !== undefined) init.body = JSON.stringify(body);
            const resp = await fetch(FJPIT_API + path, init);
            if (!resp.ok) throw new Error(path + ' HTTP ' + resp.status);
            const json = await resp.json();
            if (json.code !== 1) throw new Error(path + ' code=' + json.code + ' ' + (json.msg || ''));
            return json.data;
        } catch (e) {
            lastErr = e;
            // 出现失败说明很可能正在撞限流 → 全局间隔翻倍
            FJPIT_CUR_GAP_MS = Math.min(FJPIT_GAP_MAX_MS, FJPIT_CUR_GAP_MS * 2);
            if (attempt < FJPIT_MAX_ATTEMPT) {
                const back = FJPIT_RETRY_BASE_MS * attempt;
                console.warn('JS: ' + path + ' 第 ' + attempt + ' 次失败（' + e.message
                    + '），' + back + 'ms 后重试');
                await fjpitDelay(back);
            }
        }
    }
    throw lastErr;
}

async function fjpitApiGet(path, token) {
    return fjpitApiRequest('GET', path, undefined, token);
}

async function fjpitApiPost(path, body, token) {
    return fjpitApiRequest('POST', path, body, token);
}

/** 限并发遍历：最多同时执行 limit 个 worker，结果按原顺序返回 */
async function fjpitForEachLimit(items, limit, worker) {
    const results = new Array(items.length);
    const n = Math.max(1, Math.min(limit | 0, items.length));
    let next = 0;
    async function runner() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await worker(items[i], i);
        }
    }
    const runners = [];
    for (let k = 0; k < n; k++) runners.push(runner());
    await Promise.all(runners);
    return results;
}

/** 作息 → {slots, nodeMap}。午休/晚休不是正式节次，须剔除并把课程节次重编号 */
function fjpitParseTimeSlots(raw) {
    const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
    const ok = /^\d{1,2}:\d{2}$/;
    const all = arr.map(function (e) {
        return {
            node: Number(e && e.jcdm),
            name: String((e && e.jcmc) || ''),
            startTime: String((e && e.jcskkssj) || '').slice(0, 5),
            endTime: String((e && e.jcskjssj) || '').slice(0, 5)
        };
    }).filter(function (t) {
        return t.node >= 1 && ok.test(t.startTime) && ok.test(t.endTime);
    }).sort(function (a, b) { return a.node - b.node; });

    // 教务按「含休息行」的顺序给课程节点编号，故剔除休息行后必须同步重编号
    let kept = all.filter(function (t) { return !FJPIT_BREAK_RE.test(t.name); });
    if (!kept.length) kept = all;      // 名称识别不出节次时保持原样，避免误伤

    const nodeMap = {};
    const slots = kept.map(function (t, i) {
        nodeMap[t.node] = i + 1;
        return { number: i + 1, startTime: t.startTime, endTime: t.endTime };
    });
    return { slots: slots, nodeMap: nodeMap, dropped: all.length - kept.length };
}

/** 节次编号折算到重排后的编号；无对应项时原样返回 */
function fjpitMapNode(node, nodeMap) {
    const n = Number(node);
    return (nodeMap && nodeMap[n]) ? nodeMap[n] : n;
}

/** 单条课表记录 → entry；课程名/星期/节次非法的返回 null */
function fjpitParseEntry(rec, week, nodeMap) {
    if (!rec) return null;
    const name = String(rec.course == null ? '' : rec.course).trim();
    const day = Number(rec.DayIndex);
    const start = fjpitMapNode(rec.startNode, nodeMap);
    const end = fjpitMapNode(rec.endNode, nodeMap);
    if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(end >= start)) return null;
    return {
        week: week, day: day, date: '',
        start: start, end: end, name: name,
        teacher: rec.teacherName == null ? '' : String(rec.teacherName).trim(),
        room: rec.spaceName == null ? '' : String(rec.spaceName).trim()
    };
}

/** 走教务接口取全部数据，任一步失败直接抛错。
 *  并发编排：/semesters 串行 → 配置 + 作息并发 → 逐周限并发 FJPIT_WEEK_CONCURRENCY */
async function fjpitCollectData(token) {
    const t0 = Date.now();

    // 1) 学期列表（必须最先，后续依赖它）
    const semData = await fjpitApiGet('/semesters', token);
    const semList = (semData && semData.semesters) || [];
    if (!semList.length) throw new Error('/semesters 无学期数据');
    const cur = semList.filter(function (s) { return s && s.isCurrent; })[0] || semList[0];
    const semester = cur.value;
    const showXxq = (cur.isCurrent && cur.isXxq) ? 1 : 0;

    // 2) 学期配置（关键，失败即中断）与作息（非关键）并发
    const slotPromise = fjpitApiPost('/scheduleTime', { dqz: 1 }, token).catch(function (e) {
        console.warn('JS: 作息读取失败（不影响课表）: ' + e.message);
        return null;
    });
    const cfgData = await fjpitApiPost('/semesterConfig', { semester: semester }, token);
    const sc = (cfgData && cfgData.semestersConfig) || cfgData || {};
    const totalWeeks = Number(sc.totalWeeks) || 0;
    if (!(totalWeeks >= 1)) throw new Error('/semesterConfig 未返回有效 totalWeeks');
    const startDate = fjpitAlignToMonday(sc.startDate);      // 教务给的不一定是周一
    const ts = fjpitParseTimeSlots(await slotPromise);
    console.log('JS: 作息 ' + ts.slots.length + ' 节（剔除休息行 ' + ts.dropped + '）');

    // 3) 逐周课表（限并发；单周失败只记账不中断）
    const weeks = [];
    for (let w = 1; w <= totalWeeks; w++) weeks.push(w);

    const results = await fjpitForEachLimit(weeks, FJPIT_WEEK_CONCURRENCY, async function (w) {
        try {
            const d = await fjpitApiPost('/schedule',
                { semester: semester, week: w, showxxq: showXxq }, token);
            return { week: w, list: Array.isArray(d && d.list) ? d.list : [], ok: true };
        } catch (e) {
            console.warn('JS: 第 ' + w + ' 周抓取失败: ' + e.message);
            return { week: w, list: [], ok: false };
        }
    });

    const entries = [];
    const failedWeeks = [];
    results.forEach(function (r) {
        if (!r.ok) { failedWeeks.push(r.week); return; }
        r.list.forEach(function (rec) {
            const e = fjpitParseEntry(rec, r.week, ts.nodeMap);
            if (e) entries.push(e);
        });
    });

    if (failedWeeks.length > Math.floor(totalWeeks / 2)) {
        throw new Error('过半周次抓取失败（' + failedWeeks.length + '/' + totalWeeks + '）：'
            + failedWeeks.join(','));
    }

    const elapsedMs = Date.now() - t0;
    console.log('JS: 取数完成 ' + elapsedMs + 'ms；失败周次 ' + failedWeeks.length
        + '；请求间隔 ' + FJPIT_CUR_GAP_MS + 'ms');

    return {
        entries: entries, timeSlots: ts.slots,
        semesterStartDate: startDate, totalWeeks: totalWeeks,
        failedWeeks: failedWeeks, elapsedMs: elapsedMs
    };
}

// ---------- 三、聚合（教师/教室原样透传） ----------

function fjpitAggregate(entries) {
    const SEP = '\u0001';
    const map = new Map();
    entries.forEach(function (e) {
        const key = [e.name, e.teacher, e.room, e.day, e.start, e.end].join(SEP);
        if (!map.has(key)) {
            map.set(key, {
                name: e.name,
                teacher: e.teacher,      // 可能为空字符串，原样保留
                position: e.room,        // 可能为空字符串，原样保留
                day: e.day,
                startSection: e.start,
                endSection: e.end,
                weeks: []
            });
        }
        const course = map.get(key);
        if (course.weeks.indexOf(e.week) < 0) course.weeks.push(e.week);
    });
    const list = Array.from(map.values());
    list.forEach(function (c) { c.weeks.sort(function (a, b) { return a - b; }); });
    list.sort(function (a, b) {
        return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
    return list;
}

// ---------- 四、保存 ----------

async function fjpitSaveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
}

/** 作息要求编号从 1 起连续，否则不导入（返回 false） */
async function fjpitSaveTimeSlots(timeSlots) {
    if (!timeSlots.length) return false;
    for (let i = 0; i < timeSlots.length; i++) {
        if (timeSlots[i].number !== i + 1) return false;
    }
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    return true;
}

async function fjpitSaveConfig(semesterStartDate, totalWeeks) {
    const config = { semesterTotalWeeks: totalWeeks };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// ---------- 五、等待登录 ----------

/** 轮询等待用户登录；页面被整页重载则提前返回 null */
async function fjpitWaitForLogin(deadlineTs) {
    const bodyRef = document.body;
    let lastTip = 0;
    while (Date.now() < deadlineTs) {
        if (document.body !== bodyRef) return null;
        const token = fjpitGetAccessToken();
        if (token) return token;
        if (Date.now() - lastTip > 60000) {      // 每分钟用原生 toast 提醒一次
            lastTip = Date.now();
            fjpitSafeToast('请在页面中登录教务账号，登录后会自动继续导入');
        }
        await fjpitDelay(700);
    }
    return null;
}

// ---------- 六、主流程（编排） ----------
// 按官方推荐的编排模式：只做顺序编排；任一步失败立即 return；
// notifyTaskCompletion() 只在完全成功后调用。

/** 确保已登录；未登录则用原生 toast 提示并等待 */
async function fjpitEnsureLogin() {
    let token = fjpitGetAccessToken();
    if (token) return token;

    fjpitSafeToast('未检测到登录状态，请在页面中登录教务账号');
    token = await fjpitWaitForLogin(Date.now() + FJPIT_LOGIN_WAIT_MS);
    if (!token) token = fjpitGetAccessToken();   // 兜底：前端可能刚把 token 写进 store
    return token;
}

/** 聚合 + 保存。课程保存失败会抛出（必须中断）；作息与配置尽力而为 */
async function fjpitSaveAll(data) {
    const courses = fjpitAggregate(data.entries);
    console.log('JS: 原始条目 ' + data.entries.length + '，聚合为 ' + courses.length
        + ' 条课程；开学日期 ' + data.semesterStartDate);

    await fjpitSaveCourses(courses);

    let timeSlotSaved = false;
    try {
        timeSlotSaved = await fjpitSaveTimeSlots(data.timeSlots || []);
    } catch (e) {
        console.warn('JS: 作息时间导入失败: ' + e.message);
    }
    try {
        await fjpitSaveConfig(data.semesterStartDate, data.totalWeeks);
    } catch (e) {
        console.warn('JS: 课表配置保存失败: ' + e.message);
    }

    return { courses: courses, timeSlotSaved: timeSlotSaved };
}

/** 汇总公告 —— 本脚本唯一的弹窗 */
async function fjpitReport(data, saved) {
    const courses = saved.courses;

    const nameSet = {};
    courses.forEach(function (c) { nameSet[c.name] = 1; });

    const summary = [
        '导入完成',
        '课程行数：' + courses.length + '（' + Object.keys(nameSet).length + ' 门课）',
        '学期周数：' + data.totalWeeks,
        '开学日期：' + (data.semesterStartDate || '未取到'),
        '作息时间：' + (saved.timeSlotSaved ? (data.timeSlots || []).length + ' 节' : '未导入'),
        '取数耗时：' + (data.elapsedMs ? ((data.elapsedMs / 1000).toFixed(1) + 's') : '未知'),
        (data.failedWeeks && data.failedWeeks.length)
            ? '失败周次：' + data.failedWeeks.join(',') : '全部周次抓取成功'
    ];
    console.log('JS: ' + summary.join(' | '));

    await window.shiguangBridgePromise.showAlert('导入完成', summary.join('\n'), '好的');
    fjpitSafeToast('导入成功，共 ' + courses.length + ' 条课程');
}

/** 编排入口；任一步失败或用户取消即 return */
async function runImportFlow() {
    console.log('JS: 福信智慧教务课表导入开始（v21）');

    // 0. 环境准备
    if (location.host.indexOf(FJPIT_HOST_KEY) < 0) {
        fjpitSafeToast('请先在福信智慧教务页面登录后再执行导入。');
        return;
    }
    const token = await fjpitEnsureLogin();
    if (!token) {
        fjpitSafeToast('未等到登录状态，请登录后重新点「执行导入」');
        return;
    }

    // 2. 取数（全部走教务接口，不解析页面 HTML）
    let data;
    try {
        data = await fjpitCollectData(token);
    } catch (e) {
        fjpitSafeToast('取数失败，请确认已登录教务系统后重试：' + e.message);
        return;
    }
    if (!data.entries.length) {
        fjpitSafeToast('未取到任何课程，请确认本学期是否有排课。');
        return;
    }

    // 3. 聚合 + 保存
    let saved;
    try {
        saved = await fjpitSaveAll(data);
    } catch (e) {
        fjpitSafeToast('课程保存失败：' + e.message);
        return;
    }

    // 4. 汇总
    await fjpitReport(data, saved);

    // 5. 完全成功，才发结束信号
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow().catch(function (e) {
    console.error('JS: 导入流程异常', e);
    try { window.shiguangBridge.showToast('导入失败: ' + (e && e.message)); } catch (x) { }
});
