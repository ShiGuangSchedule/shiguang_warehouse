// 西安石油大学(jiaowu.xsyu.edu.cn) 拾光课程表适配脚本
// 教务系统：超星综合教学管理系统（dbname = xasydx）
// 使用流程：登录教务系统 → 停留在任意教务页面 → 点击“执行导入”
//
// 接口：
//   GET /admin/pkgl/xskb/queryKbForXsd                              课表页 HTML（#xhid / #xqdm / #xnxq1）
//   GET /admin/api/getZclistByXnxq?xnxq=<学期>&xqid=<校区代码>        周次表 zclist + 节次时间 jcsjszList
//   GET /admin/xsd/pkgl/xskb/sdpkkbList?xnxq=&xhid=&xqdm=&xskbxslx=0 课程数据（每行自带 xqid / xqmc）
//
// 要点：
//   1. 课程按“小节”返回（djc 1~10，jcsjszList 同为 10 条），先按小节建课再合并连续节次与周次。
//   2. kcmc / tmc / croommc 均为 <a> 包裹的 HTML；tmc 可能含多个 <a>，需整体取文本。
//   3. sdpkkbList 的 xqdm 不生效（传任何校区都返回同一批课），课程行自带的 xqid / xqmc 才是上课校区；
//      getZclistByXnxq 的 xqid 生效，而三校区作息不同，故作息校区由课程数据推导。
//   4. #xhid 必须取自课表页（86 字符加密串）；首页 /admin 的同名元素是用户 ID，误用返回 ret=-1。
//
// 维护者：dr1am1

// 学期选择：true = 弹窗选择（默认当前学期）；false = 直接用当前学期
const ASK_SEMESTER = true;

const KB_PAGE_URL = '/admin/pkgl/xskb/queryKbForXsd';

// 兜底作息（接口异常时使用），键为教务返回的校区名
const FALLBACK_SLOTS = {
    '雁塔校区': ['08:00-08:50', '09:00-09:50', '10:20-11:00', '11:10-12:00', '14:30-15:20',
                 '15:30-16:20', '16:40-17:30', '17:40-18:30', '19:30-20:20', '20:30-21:20'],
    '明德校区': ['08:00-08:50', '09:00-09:50', '10:10-11:00', '11:10-12:00', '14:30-15:20',
                 '15:30-16:20', '16:40-17:30', '17:40-18:30', '19:30-20:20', '20:30-21:20'],
    '鄠邑校区': ['08:20-09:05', '09:15-10:00', '10:20-11:05', '11:15-12:00', '14:00-14:45',
                 '14:55-15:40', '16:00-16:45', '16:55-17:40', '19:00-19:45', '19:55-20:40']
};
FALLBACK_SLOTS['默认校区'] = FALLBACK_SLOTS['鄠邑校区'];

function fallbackSlots(campusName) {
    const list = FALLBACK_SLOTS[campusName] || FALLBACK_SLOTS['雁塔校区'];
    return list.map((item, i) => {
        const [startTime, endTime] = item.split('-');
        return { number: i + 1, startTime, endTime };
    });
}

// ============================== 桥接 ==============================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[XSYU] ' + message);
    }
}

async function alertUser(title, content) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        return await window.shiguangBridgePromise.showAlert(title, content, '确定');
    }
    console.warn('[XSYU] ' + title + ' - ' + content);
    return true;
}

// ============================== 解析 ==============================

// 取出 <a>包裹字段中的纯文本，如 <a ...>数字图像处理Ⅰ</a>
function extractAnchorText(htmlStr) {
    if (!htmlStr) return '';
    const match = String(htmlStr).match(/>([^<]+)</);
    return match ? match[1].trim() : String(htmlStr).trim();
}

// 教师名可能是"<a>张三</a>,<a>李四</a>"或畸形串"<a>张三</a>,(,<a>李四</a>,)"，
// 后者括号内是有效教师而非备注，因此先取出括号内容再清括号，最后去重拼接
function cleanTeacherName(htmlStr) {
    if (!htmlStr) return '';
    let text = String(htmlStr).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

    const inner = [];
    text.replace(/[(（]([^()（）]*)[)）]/g, (whole, group) => {
        group.split(/[,，、;；]/).forEach(t => {
            const name = t.trim();
            if (name && name.length <= 12) inner.push(name);
        });
        return whole;
    });
    text = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');

    const parts = [...text.split(/[,，、;；]/), ...inner].map(t => t.trim()).filter(Boolean);
    return [...new Set(parts)].join(',');
}

// zcstr 为逗号分隔的周次，如 "1,2,3,10,11"
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return String(weekStr).split(',')
        .map(w => Number(String(w).trim()))
        .filter(w => w > 0)
        .sort((a, b) => a - b);
}

// "8:00" / "08:00:00" → "08:00"
function formatTime(timeStr) {
    if (typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
}

// ============================== 网络 ==============================

async function getJson(url) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!response.ok) throw new Error(`网络请求失败，状态码 ${response.status}（${url.split('?')[0]}）`);
    const json = await response.json();
    if (json.ret !== 0) throw new Error(`${url.split('?')[0]} 返回 ret=${json.ret}：${json.msg || '未知错误'}`);
    return json;
}

// 参数一律取自课表页：首页 /admin 的 #xhid 是用户 ID（32 字符），误用会返回 ret=-1
async function extractPageParams() {
    const response = await fetch(KB_PAGE_URL, {
        credentials: 'include',
        headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
    });
    if (!response.ok) throw new Error(`抓取课表页失败（${response.status}），请确认已登录教务系统`);

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const xhid = doc.querySelector('#xhid')?.value || '';
    const xqdm = doc.querySelector('#xqdm')?.value || '';
    if (!xhid || !xqdm) throw new Error('课表页缺少 #xhid / #xqdm，请确认已登录教务系统');

    return { xhid, xqdm, xnxqSelectHtml: doc.querySelector('#xnxq1')?.outerHTML || null };
}

async function chooseSemester(selectHtml) {
    const select = selectHtml ? new DOMParser().parseFromString(selectHtml, 'text/html').querySelector('#xnxq1') : null;
    const options = select ? [...select.options].filter(o => o.value.trim()) : [];
    if (!options.length) throw new Error('未能读取学年学期下拉，请确认已登录教务系统');

    const current = Math.max(options.findIndex(o => o.selected), 0);
    if (!ASK_SEMESTER) return options[current].value.trim();

    const index = await window.shiguangBridgePromise.showSingleSelection(
        '选择学年学期', JSON.stringify(options.map(o => (o.textContent || o.value).trim())), current
    );
    if (index === null || index === -1) return null;
    return options[index].value.trim();
}

// sdpkkbList 的 xqdm 不过滤，只能靠课程行的 xqid / xqmc 判定上课校区；
// 极少数跨校区选课的情况取课程最多者，作息以其为准
function deriveCampus(rawRows, pageXqdm) {
    const tally = new Map();
    for (const raw of rawRows) {
        const xqdm = String(raw.xqid || '').trim();
        const xqmc = String(raw.xqmc || '').trim();
        if (!xqdm && !xqmc) continue;
        const item = tally.get(xqdm || xqmc) || { xqdm, xqmc, rows: 0 };
        item.rows += 1;
        tally.set(xqdm || xqmc, item);
    }

    const list = [...tally.values()].sort((a, b) => b.rows - a.rows);
    if (!list.length) return { xqdm: pageXqdm, xqmc: '' };
    if (list.length > 1) {
        console.warn(`JS: 本学期课程跨校区：${list.map(c => `${c.xqmc || c.xqdm}(${c.rows})`).join('、')}`);
    }
    return list[0];
}

// 节次时间必须从 1 连续且不重叠，否则返回 null 交由调用方回退内置作息
function buildTimeSlots(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const slots = list
        .map(item => ({ number: Number(item.jc), startTime: formatTime(item.kssj), endTime: formatTime(item.jssj) }))
        .filter(s => s.number > 0 && s.startTime && s.endTime)
        .sort((a, b) => a.number - b.number);
    const valid = slots.length > 0 && slots.every((s, i) => s.number === i + 1 && (i === 0 || s.startTime >= slots[i - 1].endTime));
    return valid ? slots : null;
}

async function fetchTimeAndWeekData(xnxq, xqdm) {
    const data = (await getJson(
        `/admin/api/getZclistByXnxq?xnxq=${encodeURIComponent(xnxq)}&xqid=${encodeURIComponent(xqdm)}`
    )).data || {};

    const zclist = Array.isArray(data.zclist) ? data.zclist : [];
    const firstWeek = zclist.find(z => Number(z.zc) === 1);
    return {
        timeSlots: buildTimeSlots(data.jcsjszList),
        // 第 1 周 minrq 即周一，与 semesterStartDate 语义一致
        semesterStartDate: firstWeek?.minrq ? String(firstWeek.minrq).split(' ')[0] : null,
        semesterTotalWeeks: zclist.length || 20
    };
}

// ============================== 课程 ==============================

// 课程合并去重（参考 wiki《课程合并与去重函数》）
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({ ...c, weeks: [...c.weeks].sort((a, b) => a - b) }));
    const base = (a, b) => a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) || a.day - b.day;

    // 阶段 1：合并连续节次，剔除完全重复
    list.sort((a, b) => base(a, b) || a.weeks.join(',').localeCompare(b.weeks.join(',')) || a.startSection - b.startSection);
    const merged = [];
    let cur = list[0];
    for (const next of list.slice(1)) {
        const sameCourse = cur.name === next.name && cur.teacher === next.teacher &&
            cur.position === next.position && cur.day === next.day &&
            cur.weeks.join(',') === next.weeks.join(',');
        if (sameCourse && cur.endSection + 1 === next.startSection) {
            cur.endSection = next.endSection;
        } else if (sameCourse && cur.startSection === next.startSection && cur.endSection === next.endSection) {
            continue;
        } else {
            merged.push(cur);
            cur = next;
        }
    }
    merged.push(cur);

    // 阶段 2：合并同节次的周次
    merged.sort((a, b) => base(a, b) || a.startSection - b.startSection || a.endSection - b.endSection);
    const distinct = [];
    let prev = merged[0];
    for (const next of merged.slice(1)) {
        const sameSection = prev.name === next.name && prev.teacher === next.teacher &&
            prev.position === next.position && prev.day === next.day &&
            prev.startSection === next.startSection && prev.endSection === next.endSection;
        if (sameSection) {
            prev.weeks = [...new Set([...prev.weeks, ...next.weeks])].sort((a, b) => a - b);
        } else {
            distinct.push(prev);
            prev = next;
        }
    }
    distinct.push(prev);
    return distinct;
}

function parseCourseData(jsonData) {
    if (!Array.isArray(jsonData?.data)) return [];

    const list = [];
    for (const raw of jsonData.data) {
        const name = extractAnchorText(raw.kcmc);
        const day = Number(raw.xingqi);
        const section = Number(raw.djc);
        const weeks = parseWeeks(raw.zcstr);
        if (!name || !(day >= 1 && day <= 7) || !(section >= 1) || !weeks.length) continue;

        const course = {
            name,
            teacher: cleanTeacherName(raw.tmc),
            position: extractAnchorText(raw.croommc) || '待定',
            day,
            startSection: section,
            endSection: section,
            weeks
        };
        const credit = Number(raw.xf);
        if (credit > 0) course.credit = credit;
        list.push(course);
    }
    return mergeAndDistinctCourses(list);
}

async function fetchCourses(xnxq, xhid, xqdm) {
    const json = await getJson(
        `/admin/xsd/pkgl/xskb/sdpkkbList?xnxq=${encodeURIComponent(xnxq)}&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(xqdm)}&xskbxslx=0`
    );
    return { courses: parseCourseData(json), rawRows: Array.isArray(json.data) ? json.data : [] };
}

// ============================== 保存 ==============================

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function saveTimeSlots(timeSlots) {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

async function saveConfig(semesterStartDate, semesterTotalWeeks) {
    const config = { semesterTotalWeeks };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// ============================== 主流程 ==============================

function isLoginPage() {
    return window.location.href.includes('/admin/login') || window.location.href.includes('slogin');
}

async function runImportFlow() {
    try {
        if (isLoginPage()) {
            await alertUser('导入失败', '当前是登录页面，请先完成登录并进入教务系统内部页面后再执行导入。');
            return;
        }

        const confirmed = await alertUser(
            '西安石油大学教务系统课表导入',
            '将自动读取当前学期、上课校区、作息时间与开学日期。\n导入前请确认已成功登录教务系统。'
        );
        if (confirmed !== true && confirmed !== 'true') {
            toast('用户取消了导入。');
            return;
        }

        const { xhid, xqdm, xnxqSelectHtml } = await extractPageParams();
        const xnxq = await chooseSemester(xnxqSelectHtml);
        if (!xnxq) {
            toast('导入已取消：未选择学年学期。');
            return;
        }

        toast(`正在导入 ${xnxq} ...`);
        const { courses, rawRows } = await fetchCourses(xnxq, xhid, xqdm);
        if (!courses.length) {
            await alertUser('未找到课程', `${xnxq} 学期未获取到任何课程数据，请确认学期选择是否正确。`);
            return;
        }
        await saveCourses(courses);

        // 作息校区取自课程数据，页面 #xqdm 与课程所在校区无关
        const campus = deriveCampus(rawRows, xqdm);
        const campusName = campus.xqmc || campus.xqdm || '未知校区';

        // 作息与开学日期：接口失败也要写入内置作息，避免沿用上次导入的遗留时间
        let extra = null;
        try {
            extra = await fetchTimeAndWeekData(xnxq, campus.xqdm);
        } catch (error) {
            console.warn('JS: 作息/开学日期获取失败:', error.message);
            toast('未获取到教务作息，已使用内置作息表。');
        }
        if (extra) await saveConfig(extra.semesterStartDate, extra.semesterTotalWeeks);
        await saveTimeSlots(extra?.timeSlots || fallbackSlots(campus.xqmc));

        toast(`导入成功：${courses.length} 条课程、${xnxq} · ${campusName}。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error('JS: 导入流程异常:', error);
        await alertUser('导入失败', `${error.message}\n\n请确认：\n1. 已在教务系统中成功登录；\n2. 网络可以正常访问 jiaowu.xsyu.edu.cn。`);
    }
}

runImportFlow();
