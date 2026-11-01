// 北京师范大学珠海校区（金智/青果 KINGOSOFT 教务）拾光课程表适配脚本
//
// 方案参考：wiki《常见教务系统适配案例参考》青果教务案例（resources/WZZY），
// 全部数据通过带会话的网络请求获取，不依赖课表页面 DOM，支持开学日期导入。
//
// 本校实测接口：
//   学期列表    POST /frame/droplist/getDropLists.action
//               body: comboBoxName=Ms_KBBP_FBXKJGXNXQ&...（参数见请求体）
//               → JSON [{"code":"2026,0","name":"2026-2027学年秋季学期"},...]
//               注：本校 code 以逗号分隔（案例为 "-"），解析时已区分
//   课表数据    GET  /wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=<base64(xn=..&xq=..)>
//               → GBK 编码 HTML 列表表格（网络数据源，非课表页面）
//               注：案例使用 student/wsxk.xskcb10319.jsp（周×节矩阵视图），
//                   本校同族接口的列表视图字段更稳定，故用本接口，数据同源
//   开学日期    POST /frame/desk/showLessonScheduleInfosV14.action?xn=..&xq=..&jxz=1
//               → 第一周课表 HTML，表头形如 <label>一</label><br>09-07，
//                 正则与青果案例一致；年份按学期推算（春季学期为 xn+1）
//   作息时间    GET  /public/SchoolTimetable.show.jsp → 制表符分隔节次表
//               （案例为写死作息，本校教务提供公布接口，优先动态获取）
//   当前学期    POST /jw/common/showYearTerm.action（getDropLists 失败时的回退默认值）
//
// 学年学期编码：xn=学年前年份（2026 即 2026-2027 学年），xq=0 秋季 / 1 春季

const HOST = 'https://jwxt.bnuzh.edu.cn';
const DROPLIST_URL = HOST + '/frame/droplist/getDropLists.action';
const YEARTERM_URL = HOST + '/jw/common/showYearTerm.action';
const KB_DATA_URL = HOST + '/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp';
const LESSON_INFO_URL = HOST + '/frame/desk/showLessonScheduleInfosV14.action';
const TIMETABLE_URL = HOST + '/public/SchoolTimetable.show.jsp';

const DROPLIST_BODY =
    'comboBoxName=Ms_KBBP_FBXKJGXNXQ&paramValue=&isYXB=0&isCDDW=0&isPYCC=0' +
    '&isPYCCNJ=0&zyPyccFiled=&isKBLB=0&isXQ=0&isBJ=0&isSXJD=0&isDJKSLB=0';

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

// 教务未公布作息时的兜底（2026-2027 学年秋季学期）
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:00', endTime: '10:45' },
    { number: 4, startTime: '10:55', endTime: '11:40' },
    { number: 5, startTime: '13:30', endTime: '14:15' },
    { number: 6, startTime: '14:25', endTime: '15:10' },
    { number: 7, startTime: '15:30', endTime: '16:15' },
    { number: 8, startTime: '16:25', endTime: '17:10' },
    { number: 9, startTime: '18:00', endTime: '18:45' },
    { number: 10, startTime: '18:55', endTime: '19:40' },
    { number: 11, startTime: '19:50', endTime: '20:35' },
    { number: 12, startTime: '20:45', endTime: '21:30' }
];

function validateYearInput(input) {
    if (/^\d{4}$/.test(String(input).trim())) return false;
    return '请输入四位数字学年，如 2026';
}

function validateDateInput(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(input).trim())) return false;
    return '请输入正确格式的日期，如 2026-09-07';
}

async function fetchGbk(url, options) {
    const resp = await fetch(url, options);
    return new TextDecoder('gbk').decode(await resp.arrayBuffer());
}

// ---------- 学期 ----------

// 案例同款：网络请求获取学期列表（含默认值逻辑，与课表页面解耦）
async function fetchSemesterList() {
    try {
        const resp = await fetch(DROPLIST_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: DROPLIST_BODY,
            credentials: 'include'
        });
        const list = await resp.json();
        if (Array.isArray(list) && list.length > 0 && list[0].code) return list;
    } catch (e) { /* 回退到默认值方案 */ }
    return null;
}

// getDropLists 不可用时：以教务返回的当前学期为默认值生成候选列表
function buildSemesterList(current) {
    const list = [];
    let xn = parseInt(current.xn, 10);
    let xq = current.xq === '1' ? 1 : 0;
    for (let i = 0; i < 8; i++) {
        list.push({
            code: xn + ',' + xq,
            name: xn + '-' + (xn + 1) + '学年' + (xq === 0 ? '秋季' : '春季') + '学期'
        });
        if (xq === 0) { xn -= 1; xq = 1; } else { xq = 0; }
    }
    return list;
}

async function selectSemester() {
    // 当前学期作为默认选中值（案例 dqxnxq.do 的默认值逻辑，本校由 showYearTerm 提供）
    let current = null;
    try {
        const resp = await fetch(YEARTERM_URL, { method: 'POST' });
        const data = JSON.parse(await resp.text());
        if (data && data.xn) current = { xn: data.xn, xq: String(data.xqM) };
    } catch (e) { /* 列表仍可用时不影响主流程 */ }

    let list = await fetchSemesterList();
    if (!list && current) list = buildSemesterList(current);

    if (!list) {
        // 列表与当前学期均不可得时，手动输入
        const year = await window.shiguangBridgePromise.showPrompt(
            '选择学年', '请输入学年的前年份，如 2026 表示 2026-2027 学年：', '2026', 'validateYearInput'
        );
        if (year === null) return null;
        const xq = await window.shiguangBridgePromise.showSingleSelection(
            '选择学期', JSON.stringify(['秋季学期', '春季学期']), 0
        );
        if (xq === null) return null;
        return { xn: String(year).trim(), xq: String(xq) };
    }

    let defaultIndex = 0;
    if (current) {
        const idx = list.findIndex(
            item => String(item.code).replace(/\s/g, '') === current.xn + ',' + current.xq
        );
        if (idx >= 0) defaultIndex = idx;
    }

    const names = list.slice(0, 10).map(item => item.name);
    const index = await window.shiguangBridgePromise.showSingleSelection(
        '选择导入学期', JSON.stringify(names), defaultIndex
    );
    if (index === null || index < 0 || index >= list.length) return null;
    // 本校 code 形如 "2026,0"（逗号），案例为 "2026-0"，两种分隔符都兼容
    const parts = String(list[index].code).split(/[,\-]/);
    const xn = parts[0].trim();
    const xq = (parts[1] || '0').trim();
    if (!/^\d{4}$/.test(xn)) return null;
    return { xn, xq };
}

// ---------- 课表数据 ----------

async function fetchCourseHtml(xn, xq) {
    const params = btoa('xn=' + xn + '&xq=' + xq);
    const html = await fetchGbk(KB_DATA_URL + '?params=' + params, { credentials: 'include' });
    if (!html || html.includes('凭证已失效')) return null;
    return html;
}

function expandWeeks(start, end, parity) {
    const weeks = [];
    for (let w = start; w <= end; w++) {
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 === 1) continue;
        weeks.push(w);
    }
    return weeks;
}

// 单个时间段，如 "1-16周 三[7-8] 丽泽楼C202(140)"
function parseTimeBlock(block) {
    const m = block.match(
        /^(\d+)\s*[-—~－]\s*(\d+)周(?:\((单|双)\))?\s*([一二三四五六日天])\s*\[\s*(\d{1,2})(?:\s*[-—~－]\s*(\d{1,2}))?\s*\]\s*(.+)$/
    );
    if (!m) return null;
    const day = DAY_MAP[m[4]];
    if (!day) return null;
    const startSection = parseInt(m[5], 10);
    const endSection = m[6] ? parseInt(m[6], 10) : startSection;
    const weeks = expandWeeks(parseInt(m[1], 10), parseInt(m[2], 10), m[3]);
    if (weeks.length === 0 || endSection < startSection) return null;
    // 去掉地点末尾的教室容量，如 "丽泽楼C202(140)" → "丽泽楼C202"
    const position = m[7].trim().replace(/\(\d+\)$/, '');
    return { day, startSection, endSection, weeks, position };
}

function parseCourses(html) {
    const courses = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');
    for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) continue;
        const nameMatch = cells[0].textContent.trim().match(/^\[[^\]]+\]\s*(.+)$/);
        if (!nameMatch) continue;
        const name = nameMatch[1].trim();
        const teacher = cells[4].textContent.trim().replace(/;/g, '、');
        const timeText = cells[5].textContent.trim();
        if (!timeText) continue;

        for (const block of timeText.split(',')) {
            const parsed = parseTimeBlock(block.trim());
            if (!parsed) continue;
            const course = {
                name: name,
                teacher: teacher,
                position: parsed.position,
                day: parsed.day,
                startSection: parsed.startSection,
                endSection: parsed.endSection,
                weeks: parsed.weeks
            };
            courses.push(course);
        }
    }
    return courses;
}

// 节次与周次两阶段合并去重（与青果案例 mergeAndDistinctCourses 同逻辑）：
// 阶段 1 合并同课程同周次的连续节次、去除完全重复记录；
// 阶段 2 合并同课程同节次的周次（如 1-8 周 + 9-16 周 → 1-16 周）
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...new Set(c.weeks)].sort((a, b) => a - b) : []
    }));

    const byKey = (a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0);

    list.sort((a, b) =>
        byKey(a, b) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0));

    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameGroup =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;
        if (sameGroup && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameGroup && isDuplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    step1.sort((a, b) =>
        byKey(a, b) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0));

    const step2 = [];
    let cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameGroup =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;
        if (sameGroup) {
            cur.weeks = [...new Set([...cur.weeks, ...nxt.weeks])].sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);
    return step2;
}

// ---------- 开学日期 ----------

// 取第一周课表表头的 MM-DD（形如 <label>一</label><br>09-07），推算完整日期
async function fetchSemesterStartDate(xn, xq) {
    try {
        const html = await fetchGbk(
            LESSON_INFO_URL + '?xn=' + xn + '&xq=' + xq + '&jxz=1',
            {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'include'
            }
        );
        const match = html.match(/<br\s*\/?>\s*(\d{2})-(\d{2})/);
        if (match) {
            const year = xq === '1' ? String(parseInt(xn, 10) + 1) : xn;
            return year + '-' + match[1] + '-' + match[2];
        }
    } catch (e) { /* 返回 null 由用户手动填写 */ }
    return null;
}

// ---------- 作息时间 ----------

async function fetchTimeSlots() {
    try {
        const text = await fetchGbk(TIMETABLE_URL, { credentials: 'include' });
        const slots = [];
        const re = /(\d{1,2})\t(\d{2}:\d{2})\t(\d{2}:\d{2})/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const number = parseInt(m[1], 10);
            if (number >= 1) {
                slots.push({ number: number, startTime: m[2], endTime: m[3] });
            }
        }
        slots.sort((a, b) => a.number - b.number);
        if (slots.length > 0 && slots[0].number === 1) return slots;
    } catch (e) { /* 回退内置 */ }
    return FALLBACK_TIME_SLOTS;
}

// ---------- 导入流程 ----------

async function runImportFlow() {
    // 脚本必须在教务站点域内执行，登录会话才会随请求携带
    if (!window.location.hostname.endsWith('bnuzh.edu.cn')) {
        await window.shiguangBridgePromise.showAlert(
            '无法导入',
            '当前不在教务系统页面内，请先完成教务系统登录再执行导入。',
            '我知道了'
        );
        return;
    }

    const confirmed = await window.shiguangBridgePromise.showAlert(
        '导入课表',
        '即将从教务系统获取课表、作息与开学日期。请确保当前页面已登录教务系统。',
        '开始导入'
    );
    if (!confirmed) {
        window.shiguangBridge.showToast('已取消导入。');
        return;
    }

    // 1. 选择学期（列表来自网络请求，默认选中最新学期）
    const semester = await selectSemester();
    if (!semester) {
        window.shiguangBridge.showToast('已取消导入。');
        return;
    }
    const { xn, xq } = semester;

    // 2. 网络请求获取课表数据
    window.shiguangBridge.showToast('正在获取课表数据...');
    let html = null;
    try {
        html = await fetchCourseHtml(xn, xq);
    } catch (e) {
        html = null;
    }
    if (!html) {
        await window.shiguangBridgePromise.showAlert(
            '获取失败',
            '未能获取课表数据，可能尚未登录或会话已过期，请确认登录后重试。',
            '确定'
        );
        return;
    }
    const courses = mergeAndDistinctCourses(parseCourses(html));
    if (courses.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            '没有课程',
            '已连接教务系统，但该学期没有解析到课程记录。',
            '确定'
        );
        return;
    }

    // 3. 开学日期（教务第一周课表）并让用户确认
    window.shiguangBridge.showToast('正在获取开学日期...');
    const startDate = await fetchSemesterStartDate(xn, xq);
    const confirmedDate = await window.shiguangBridgePromise.showPrompt(
        '确认开学日期',
        '请确认本学期第一周周一的日期（格式 YYYY-MM-DD）：',
        startDate || '',
        'validateDateInput'
    );
    if (confirmedDate === null) {
        window.shiguangBridge.showToast('导入已取消。');
        return;
    }

    // 4. 总周数按课程周次最大值推算
    let maxWeek = 0;
    for (const c of courses) {
        for (const w of c.weeks) if (w > maxWeek) maxWeek = w;
    }
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: String(confirmedDate).trim(),
            semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        }));
    } catch (e) {
        window.shiguangBridge.showToast('课表配置保存失败：' + e.message);
    }

    // 5. 作息时间（教务公布优先，失败回退内置）
    const timeSlots = await fetchTimeSlots();
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (e) {
        window.shiguangBridge.showToast('作息时间保存失败：' + e.message);
    }

    // 6. 提交课程
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
        await window.shiguangBridgePromise.showAlert('导入失败', '课程数据保存失败：' + e.message, '确定');
        return;
    }

    await window.shiguangBridgePromise.showAlert(
        '导入成功',
        '已导入 ' + courses.length + ' 条课程记录、作息时间与开学日期 ' + String(confirmedDate).trim() + '。',
        '确定'
    );
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
