// 河南科技学院（青果 / KINGOSOFT 教务系统） 拾光课程表适配脚本
//
// 教务系统入口：http://jwgl.hist.edu.cn/cas/login.action
// 课程表数据接口：/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp?params=<base64(xn=..&xq=..)>
//   说明：params 为 Base64，内容是 "xn=2025&xq=0"；xh(学号/uid) 可省略，服务端用会话即可。
//   xn = 学年（如 2025 表示 2025-2026 学年）；xq = 0 第一学期(秋季) / 1 第二学期(春季)。
//
// 适配者：@星河欲转 社区贡献（河南科技学院）
// 说明：本脚本按青果课表接口进行解析，若学校变更菜单编号(10319)或表格结构，
//       请参照文档在“更多→开发者功能”中打开源码调试。

const HOST = 'http://jwgl.hist.edu.cn';
const KB_DATA_URL = HOST + '/wsxk/xkjg.ckdgxsxdkchj_data10319.jsp';

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

function base64Encode(str) {
    return btoa(str);
}

function isLoginPage() {
    const url = window.location.href;
    if (url.indexOf('/cas/') !== -1) return true;
    if (url.indexOf('jwgl.hist.edu.cn') !== -1 && /login\.action|login\.jsp|\/cas\//i.test(url)) return true;
    return false;
}

// ---------- token 解析 ----------

function matchDay(text) {
    // 兼容 "星期四[1-2]" / "周四[1-2]" / "二[7-8]"（青果导出常为单个汉字）
    let m = text.match(/(?:星期|周)([一二三四五六日天])/);
    if (m) return { day: DAY_MAP[m[1]] || 7, str: m[1] };
    m = text.match(/([一二三四五六日天])\s*\[/);
    if (m) return { day: DAY_MAP[m[1]] || 7, str: m[1] };
    return null;
}

function matchSection(text) {
    // 优先匹配方括号内的节次（青果：星期一[7-8] / 二[7-8]）；方括号里的数字必为节次。
    let m = text.match(/\[(\d{1,2})\s*[-—～]\s*(\d{1,2})\]/);
    if (m) {
        const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
        if (s >= 1 && e >= s && e <= 30) return { start: s, end: e, str: m[0] };
    }
    m = text.match(/(\d{1,2})\s*[-—～]\s*(\d{1,2})\s*节/);
    if (m) {
        const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
        if (s >= 1 && e >= s && e <= 30) return { start: s, end: e, str: m[0] };
    }
    m = text.match(/(?:第)?\s*(\d{1,2})\s*节/);
    if (m) {
        const s = parseInt(m[1], 10);
        if (s >= 1 && s <= 30) return { start: s, end: s, str: m[0] };
    }
    return null;
}

function matchWeeks(text) {
    let flag = 0;
    if (text.includes('单')) flag = 1;
    else if (text.includes('双')) flag = 2;
    let clean = text.replace(/单/g, '').replace(/双/g, '').replace(/[()（）]/g, '');
    const m = clean.match(/([\d,，\-—～]+)\s*周/);
    if (!m) return [];
    const weeks = [];
    for (const part of m[1].split(/[,，]/)) {
        const p = part.trim();
        if (!p) continue;
        const range = p.match(/^(\d{1,3})[\-—～](\d{1,3})$/);
        if (range) {
            const s = parseInt(range[1], 10), e = parseInt(range[2], 10);
            for (let i = s; i <= e; i++) {
                if (flag === 1 && i % 2 !== 0) weeks.push(i);
                else if (flag === 2 && i % 2 === 0) weeks.push(i);
                else if (flag === 0) weeks.push(i);
            }
        } else if (/^\d{1,3}$/.test(p)) {
            const i = parseInt(p, 10);
            if (flag === 1 && i % 2 !== 0) weeks.push(i);
            else if (flag === 2 && i % 2 === 0) weeks.push(i);
            else if (flag === 0) weeks.push(i);
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseTimePlaceCell(text) {
    const items = [];
    if (!text) return items;
    const normalized = text
        .replace(/／/g, '/').replace(/，/g, ',').replace(/；/g, ';')
        .replace(/\u3000/g, ' ').replace(/<[^>]+>/g, '');

    // 每个时段形如：周次 星期[节次] 地点；多个时段用逗号分隔。
    // 用“周次 + 星期[节次]”为锚点整体捕获，避免把周次列表里的逗号（如 6-8,10周）误当成时段分隔。
    const re = /(\S*周[^\s\[\]]*)\s*([一二三四五六日天])\s*\[(\d{1,2})\s*[-—～]\s*(\d{1,2})\]\s*([^,，;；\n]*)/g;
    let m;
    while ((m = re.exec(normalized)) !== null) {
        const day = DAY_MAP[m[2]] || 7;
        const start = parseInt(m[3], 10), end = parseInt(m[4], 10);
        if (!(start >= 1 && end >= start && end <= 30)) continue;
        const weeks = matchWeeks(m[1]);
        if (weeks.length === 0) continue;
        let position = (m[5] || '')
            .replace(/\((\d+)\)\s*$/, '') // 去掉结尾教室容量 "(98)"
            .replace(/[\[\]()（）]/g, ' ')
            .replace(/[,，;；\/]/g, ' ')
            .replace(/单|双/g, ' ')
            .replace(/\s+/g, ' ').trim();
        if (position === '' || /^\d+$/.test(position)) position = '';
        items.push({ day, startSection: start, endSection: end, weeks, position });
    }

    // 兜底：若某时段缺地点，而同行后面的时段有地点，则继承该地点
    const lastPos = items.map(i => i.position).filter(p => p).slice(-1)[0] || '';
    if (lastPos) {
        for (const it of items) if (!it.position) it.position = lastPos;
    }
    return items;
}

// ---------- HTML 解析 ----------

// 清理教师串：格式 "[工号]姓名 [工号]姓名 …" → "姓名 & 姓名"
function cleanTeacher(t) {
    const name = t.split('[').map(part => {
        const idx = part.indexOf(']');
        return idx >= 0 ? part.slice(idx + 1).replace(/&ensp;|&nbsp;/g, ' ').trim() : '';
    }).filter(Boolean).join(' & ');
    return name || t.trim();
}

function findNameAndTeacher(cells, dataIdx) {
    let name = '', teacher = '', nameIdx = -1;
    // 课程名：形如 [xxx]课程名
    for (let i = 0; i < cells.length; i++) {
        if (i === dataIdx) continue;
        const t = (cells[i]?.textContent || '').trim();
        if (/^\s*\[[^\]]*\]\s*\S/.test(t)) {
            name = t.replace(/^\s*\[[^\]]*\]\s*/g, '').trim();
            nameIdx = i;
            break;
        }
    }
    // 教师：形如 [工号]姓名 …（含 [工号] 且不是课程名）
    for (let i = 0; i < cells.length; i++) {
        if (i === dataIdx || i === nameIdx) continue;
        const t = (cells[i]?.textContent || '').trim();
        if (/\d/.test(t) && /\[[^\]]*\]\s*/.test(t)) {
            const ct = cleanTeacher(t);
            if (ct) { teacher = ct; break; }
        }
    }
    return { name, teacher };
}

function parseScheduleHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr');
    const courses = [];

    for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (cells.length < 3) continue;

        let dataCell = null;
        let dataIdx = -1;
        for (let i = cells.length - 1; i >= 0; i--) {
            const t = cells[i].textContent || '';
            // 时间地点单元格特征：含“周”（周次）或方括号节次 [N-M]，或“星期X[”/“X[”
            if (/周/.test(t) || /\[(\d{1,2})\s*[-—～]\s*(\d{1,2})\]/.test(t) || /[一二三四五六日天]\s*\[/.test(t)) {
                dataCell = t;
                dataIdx = i;
                break;
            }
        }
        if (dataCell === null) continue;

        // 课程名与教师采用“按内容识别”，对导出/接口两种列布局都健壮：
        //   课程名单元格形如 "[2500T0002]大学生心理健康教育"
        //   教师单元格形如 "[201201059]贾普君 [202201013]李金璐"
        const info = findNameAndTeacher(cells, dataIdx);
        let name = info.name;
        if (!name) name = (cells[2]?.textContent || '').trim() || (cells[1]?.textContent || '').trim() || (cells[0]?.textContent || '').trim();
        name = name.replace(/^\s*\[[^\]]*\]\s*/g, '').trim();
        if (!name) continue;
        const teacher = info.teacher;

        const items = parseTimePlaceCell(String(dataCell));
        for (const it of items) {
            courses.push({
                name: name, teacher: teacher, position: it.position,
                day: it.day, startSection: it.startSection, endSection: it.endSection, weeks: it.weeks
            });
        }
    }
    return mergeCourses(courses);
}

function mergeCourses(courses) {
    const map = new Map();
    for (const c of courses) {
        const key = [c.name, c.teacher, c.position, c.day, c.startSection, c.endSection].join('|');
        if (!map.has(key)) map.set(key, { ...c, weeks: [] });
        const entry = map.get(key);
        entry.weeks = [...new Set([...entry.weeks, ...c.weeks])].sort((a, b) => a - b);
    }
    return Array.from(map.values());
}

// ---------- 流程 ----------

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return '请输入四位数字的学年！';
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '教务系统课表导入',
        '导入前请确认已在本页面登录教务系统（登录成功后无需再点登录）。',
        '好的，开始导入'
    );
}

async function selectYear() {
    const now = new Date();
    const month = now.getMonth() + 1;
    let year = now.getFullYear();
    if (month < 7) year -= 1;
    const input = await window.shiguangBridgePromise.showPrompt(
        '选择学年',
        '请输入要导入课程的起始学年（例如 2025-2026 学年输入 2025）：',
        String(year), 'validateYearInput'
    );
    if (input === null) return null;
    return parseInt(input, 10);
}

async function selectSemester() {
    const semesters = ['第一学期（秋季）', '第二学期（春季）'];
    return await window.shiguangBridgePromise.showSingleSelection('选择学期', JSON.stringify(semesters), 0);
}

// 自动判断响应编码：UTF-8 与 GBK 二选一（谁替换字符少、中文多就用谁）
function decodeBest(buf) {
    const utf8 = (() => { try { return new TextDecoder('utf-8').decode(buf); } catch (e) { return ''; } })();
    const gbk = (() => { try { return new TextDecoder('gbk').decode(buf); } catch (e) { return null; } })();
    const repl = s => (s.match(/\uFFFD/g) || []).length;
    const cjk = s => (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (gbk == null) return utf8;
    if (repl(utf8) === 0 && repl(gbk) > 0) return utf8;
    if (repl(gbk) === 0 && repl(utf8) > 0) return gbk;
    if (cjk(gbk) > cjk(utf8)) return gbk;
    return repl(gbk) < repl(utf8) ? gbk : utf8;
}

async function fetchScheduleHtml(academicYear, semesterIndex) {
    const xq = semesterIndex === 0 ? 0 : 1;
    const params = base64Encode(`xn=${academicYear}&xq=${xq}`);
    const url = `${KB_DATA_URL}?params=${encodeURIComponent(params)}`;
    window.shiguangBridge.showToast('正在请求课表数据…');
    console.log('HIST: fetch ->', url);

    const resp = await fetch(url, { method: 'GET', credentials: 'include' });
    const buf = await resp.arrayBuffer();
    const text = decodeBest(buf);
    if (text.includes('凭证已失效') || text.includes('请重新登录')) {
        window.shiguangBridge.showToast('请先登录教务系统！');
        return null;
    }
    return text;
}

// 内置备用作息：key 0=第一学期(2026-2027实测), 1=第二学期(旧版兜底，仅抓取失败时用)
const FALLBACK_TIMES = {
    0: [
        { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:10', endTime: '10:55' }, { number: 4, startTime: '11:05', endTime: '11:50' },
        { number: 5, startTime: '15:00', endTime: '15:45' }, { number: 6, startTime: '15:55', endTime: '16:40' },
        { number: 7, startTime: '17:10', endTime: '17:55' }, { number: 8, startTime: '18:05', endTime: '18:50' },
        { number: 9, startTime: '20:00', endTime: '20:45' }, { number: 10, startTime: '20:55', endTime: '21:40' }
    ],
    1: [
        { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
        { number: 3, startTime: '10:10', endTime: '10:55' }, { number: 4, startTime: '11:05', endTime: '11:50' },
        { number: 5, startTime: '14:30', endTime: '15:15' }, { number: 6, startTime: '15:25', endTime: '16:10' },
        { number: 7, startTime: '16:40', endTime: '17:25' }, { number: 8, startTime: '17:35', endTime: '18:20' },
        { number: 9, startTime: '19:30', endTime: '20:15' }, { number: 10, startTime: '20:25', endTime: '21:10' }
    ]
};

// 解析教务作息页表格：节次行形如 ["1","08:00","08:45"] 或 ["上午","1","08:00","08:45"]
function parseTimetableHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
        const cells = Array.from(tr.querySelectorAll('td,th'))
            .map(c => (c.textContent || '').trim()).filter(c => c !== '');
        let num = parseInt(cells[0] || '', 10);
        if (isNaN(num)) num = parseInt(cells[1] || '', 10);
        let start = '', end = '';
        for (let i = 1; i < cells.length; i++) {
            if (/^\d{2}:\d{2}$/.test(cells[i])) {
                if (!start) start = cells[i];
                else if (!end) { end = cells[i]; break; }
            }
        }
        if (num >= 1 && num <= 30 && start && end) out.push({ number: num, startTime: start, endTime: end });
    }
    const map = new Map();
    out.forEach(s => { if (!map.has(s.number)) map.set(s.number, s); });
    return Array.from(map.values()).sort((a, b) => a.number - b.number);
}

// 动态抓取教务公布的当学期作息（公开同源接口，免登录）
async function fetchTermTimeSlots(year, xq) {
    const url = HOST + '/public/SchoolTimetable.show.jsp';
    const body = 'xn=' + year + '&xq_m=' + xq + '&menucode=&is_ssxq=0&axq=&ssxq=';
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body,
        credentials: 'include'
    });
    const buf = await resp.arrayBuffer();
    const text = decodeBest(buf);
    if (text.includes('未设置') || text.includes('未设定') || text.includes('未发布')) return null;
    const slots = parseTimetableHtml(text);
    return slots.length ? slots : null;
}

async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast('请先登录教务系统，再点击导入！');
        return;
    }
    const confirmed = await promptUserToStart();
    if (!confirmed) return;
    const year = await selectYear();
    if (year === null) return;
    const semIdx = await selectSemester();
    if (semIdx === null || semIdx === -1) return;

    const html = await fetchScheduleHtml(year, semIdx);
    if (!html) return;
    if (html.includes('凭证已失效') || html.includes('请重新登录')) {
        window.shiguangBridge.showToast('登录已失效，请重新登录后重试。');
        return;
    }

    const courses = parseScheduleHtml(html);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast('未解析到课程，可能是本学期无课或页面结构已变化。');
        console.log('HIST: raw html head ->', (html || '').slice(0, 1200));
        return;
    }

    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
    window.shiguangBridge.showToast(`课程解析成功：${courses.length} 条`);

    // 作息与学年学期强相关：合并为一步，按所选学期自动抓取教务公布作息；失败用内置备用并提示
    const xq = semIdx === 0 ? 0 : 1;
    const termName = xq === 0 ? '第一学期' : '第二学期';
    let slots = null;
    try { slots = await fetchTermTimeSlots(year, xq); } catch (e) { slots = null; }
    if (slots && slots.length) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        window.shiguangBridge.showToast(`已按 ${year}-${year + 1} 学年${termName}作息导入`);
    } else {
        const fallback = FALLBACK_TIMES[xq] || FALLBACK_TIMES[0];
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(fallback));
        window.shiguangBridge.showToast(`未能获取学校${termName}作息（可能未发布），已用备用作息，请核对`);
    }
    window.shiguangBridge.showToast(`导入完成，共 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
