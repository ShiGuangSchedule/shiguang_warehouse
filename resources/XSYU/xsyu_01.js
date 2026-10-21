// 西安石油大学(jiaowu.xsyu.edu.cn) 拾光课程表适配脚本
// 教务系统：超星综合教学管理系统（dbname = xasydx）
// 使用流程：登录教务系统（账密登录或统一认证）→ 停留在任意教务页面 → 点击"执行导入"
//
// 接口说明（2026-2027-1 学期实测，返回 ret 均为 0）：
//   GET /admin/pkgl/xskb/queryKbForXsd                                  课表页 HTML（内含 #xhid / #xqdm / #xnxq1）
//   GET /admin/api/jcsj/xqsj/getXqList                                  校区列表（item.id = 校区代码，item.xqmc = 名称）
//   GET /admin/api/getZclistByXnxq?xnxq=<学年-学期>&xqid=<校区代码>      周次表 data.zclist + 节次时间 data.jcsjszList
//   GET /admin/xsd/pkgl/xskb/sdpkkbList?xnxq=&xhid=&xqdm=&xskbxslx=0     课程数据 JSON（data[]）
//
// 细节说明：
//   1. 课程数据按"小节"返回（djc = 第几小节，1~10），节次时间表 jcsjszList 也按小节给出
//      （共 10 条，每条一个 jc）。因此脚本直接以小节为单位建课，再交给合并函数处理：
//      连续小节合并（1 + 2 → 1-2）、单双周合并（1,3,5 + 2,4,6 → 1-6）、完全重复去重。
//      这与教务课表页面把"1(1小节~2小节)"显示为一行的结果一致。
//   2. 接口另带 djs 字段（大节序号 1~5，每大节固定含 2 小节），仅用于校验，
//      不参与建模——因为时间点必须落到具体小节上才不丢信息。
//   3. kcmc / tmc / croommc 都是 <a> 包裹的 HTML 片段，需要抽文本。
//   4. 教务系统的 #xnxq1 会把"当前学期"标为 selected，脚本把它作为学期单选列表的默认项；
//      校区默认沿用页面校区、不弹窗（本校学生课程基本集中在同一校区）。
//   5. 作息时间与开学日期都从教务接口读取，不写死；仅在接口异常时回退到内置作息表。
//   6. 本校第 1 周 minrq 即周一，与拾光 semesterStartDate 的语义一致（实测 2026-08-31）。
//   7. 取参必须用课表页的 #xhid（86 字符加密串）。教务首页 /admin 也有 id="xhid"，
//      但值是用户 ID（32 字符）；误用时 sdpkkbList 返回 ret=-1
//      「功能暂时停用，请联系管理员」（HTTP 仍是 200），容易被误判为系统故障。
//
// 维护者：dr1am1

// 学期选择：默认【弹出单选列表】，并把教务系统标记的"当前学期"作为默认选中项。
//   常用场景直接确认即可；学期尚未开始时，也可在这里改选下学期，提前导入课表。
//   若希望完全不弹窗、始终使用当前学期，改为 false。
const ASK_SEMESTER = true;

// 校区选择：默认沿用当前页面校区、不弹窗（本校学生通常只在一个校区上课）。
//   若希望每次手动选择校区，改为 true。
const ASK_CAMPUS = false;

// 接口异常时的兜底作息（2026-2027-1 雁塔校区实测值），正常情况不会用到
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:20", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:30", endTime: "16:20" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:40", endTime: "18:30" },
    { number: 9, startTime: "19:30", endTime: "20:20" },
    { number: 10, startTime: "20:30", endTime: "21:20" }
];

// 兜底总周数（接口返回 zclist 长度时以接口为准）
const FALLBACK_TOTAL_WEEKS = 20;

// 课表页地址。其服务端渲染的 #xhid（86 字符加密串）/ #xqdm / #xnxq1 才是正确参数。
// 注意：教务首页 /admin 里也存在一个 id="xhid" 的元素，但值是用户 ID（32 字符），
// 误用时 sdpkkbList 会返回 ret=-1「功能暂时停用，请联系管理员」（HTTP 仍是 200），
// 该提示看起来像系统故障或权限问题，实际只是参数传错。
// 因此这里【始终优先采用课表页里的值】，只有抓取失败才退回当前页面 DOM。
const KB_PAGE_URL = '/admin/pkgl/xskb/queryKbForXsd';

// 出错时附在弹窗里的诊断信息（便于用户反馈时定位）
let diagnoseInfo = '';

// =========================================================================
// 桥接封装
// =========================================================================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[XSYU] ' + message);
    }
}

async function alertUser(title, content) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        return await window.shiguangBridgePromise.showAlert(title, content, "确定");
    }
    console.warn('[XSYU] ' + title + ' - ' + content);
    return true;
}

// =========================================================================
// 文本与周次解析
// =========================================================================

// 超星返回的字段带有 <a> 标签，取出其中的纯文本
function extractAnchorText(htmlStr) {
    if (!htmlStr) return '';
    const match = String(htmlStr).match(/>([^<]+)</);
    return match ? match[1].trim() : String(htmlStr).trim();
}

/**
 * 提取字段内的"全部"文本（用于教师这类可能包含多个 <a> 的字段）。
 * 本校实测 tmc 有多种形态：
 *   1) 单教师：            <a>宋汐瑾</a>
 *   2) 多教师，逗号分隔：  <a>高建邦</a>,<a>李长星</a>
 *   3) 畸形串（重修复刻）：<a>党博</a>,(,<a>杨玲</a>,)
 * 只取第一个 <a> 会丢掉后续教师，因此这里把标签去掉后整体取文本再清洗。
 */
function extractAllText(htmlStr) {
    if (!htmlStr) return '';
    return String(htmlStr)
        .replace(/<[^>]*>/g, '')   // 去掉所有标签，保留标签之间的文本（含逗号等分隔符）
        .replace(/&nbsp;/g, ' ')
        .trim();
}

// 清理教师名：
//   1) 本校多教师字段会返回 "<a>高建邦</a>,<a>李长星</a>" 或畸形串 "<a>党博</a>,(,<a>杨玲</a>,)"，
//      因此先整体去标签再清洗（不能只取第一个 <a>，否则会丢掉后续教师）；
//   2) 畸形串里的括号"包住"的是有效教师名而非备注，所以先把括号内容提取出来，
//      再删除剩余括号，避免把"杨玲"误当成括号备注删掉；
//   3) 拆分 → 去空 → 去重 → 用中文逗号连接。
function cleanTeacherName(name) {
    if (!name) return '';
    let s = extractAllText(name);

    // 2a. 先把括号"内部"的文本取出（畸形串如 "党博,(,杨玲,)"）
    //     只保留形似人名/工号的内容：中文姓名或字母数字工号，长度合理
    const innerNames = [];
    s.replace(/[(（]([^()（）]*)[)）]/g, (whole, inner) => {
        inner.split(/[,，、;；]/).forEach(t => {
            const v = t.trim();
            if (v && v.length <= 12) innerNames.push(v);
        });
        return whole;
    });

    // 2b. 去掉括号备注（如"（外聘）"）。此时 2a 已抢救出括号内的有效教师名
    s = s.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');

    // 2c. 主串 + 抢救出的括号内教师名
    const parts = [...s.split(/[,，、;；]/), ...innerNames]
        .map(t => t.trim())
        .filter(t => t.length > 0);

    const unique = Array.from(new Set(parts));

    return unique.join(',');
}

// 超星的 zcstr 直接是逗号分隔的周次数字，例如 "1,2,3,10,11"
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return String(weekStr).split(',')
        .map(w => Number(String(w).trim()))
        .filter(w => !isNaN(w) && w > 0)
        .sort((a, b) => a - b);
}

function formatTime(timeStr) {
    if (typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// =========================================================================
// 网络请求封装
// =========================================================================

async function getJson(url) {
    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest'
        }
    });
    if (!response.ok) throw new Error(`网络请求失败，状态码 ${response.status}（${url.split('?')[0]}）`);
    const json = await response.json();
    if (json.ret !== 0) {
        throw new Error(`${url.split('?')[0]} 返回 ret=${json.ret}：${json.msg || '未知错误'}`);
    }
    return json;
}

// =========================================================================
// 页面参数提取
// =========================================================================

function pickKbParams(doc) {
    return {
        xhid: doc.querySelector('#xhid')?.value || '',
        xqdm: doc.querySelector('#xqdm')?.value || '',
        xnxqSelectHtml: doc.querySelector('#xnxq1')?.outerHTML || null
    };
}

async function extractPageParams() {
    let pageHtml = null;
    try {
        const response = await fetch(KB_PAGE_URL, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
        });
        if (response.ok) {
            pageHtml = await response.text();
        } else {
            console.warn(`JS: 抓取课表页失败，状态码 ${response.status}`);
        }
    } catch (error) {
        console.warn('JS: 抓取课表页异常:', error.message);
    }

    let params = { xhid: '', xqdm: '', xnxqSelectHtml: null };
    let source = '';

    if (pageHtml) {
        const fromPage = pickKbParams(new DOMParser().parseFromString(pageHtml, 'text/html'));
        if (fromPage.xhid && fromPage.xqdm) {
            params = fromPage;
            source = '课表页';
        }
    }
    if (!params.xhid || !params.xqdm) {
        const fromDom = pickKbParams(document);
        if (fromDom.xhid && fromDom.xqdm) {
            params = fromDom;
            source = '当前页面';
        }
    }

    if (!params.xhid || !params.xqdm) {
        throw new Error('无法获取课表页参数（#xhid / #xqdm），请确认已登录教务系统');
    }
    // 本校课表页的 xhid 为 86 字符；若拿到 32 字符说明误用了首页的用户 ID，
    // 此时 sdpkkbList 会返回 ret=-1「功能暂时停用，请联系管理员」（HTTP 200），
    // 所以这里提前告警，避免把参数问题误判成系统故障。
    if (params.xhid.length < 60) {
        console.warn(`JS: xhid 长度异常（${params.xhid.length}，正常为 86）——` +
            `可能误用了首页的用户 ID，届时课程接口会返回 ret=-1「功能暂时停用，请联系管理员」`);
    }
    console.log(`JS: 参数来源=${source}，xhid=${params.xhid.length} 字符，xqdm=${params.xqdm.length} 字符`);
    return params;
}

// 解析 #xnxq1 下拉：labels / values / 当前选中索引
function parseSemesterOptions(selectHtml) {
    if (!selectHtml) return null;
    const doc = new DOMParser().parseFromString(selectHtml, 'text/html');
    const select = doc.querySelector('#xnxq1') || doc.querySelector('select[name="xnxq"]');
    if (!select) return null;

    const options = Array.from(select.querySelectorAll('option')).filter(o => (o.value || '').trim() !== '');
    if (options.length === 0) return null;

    const labels = options.map(o => (o.textContent || o.value || '').trim());
    const values = options.map(o => (o.value || '').trim());

    // 当前选中项（教务系统会把当前学期标为 selected）
    let selectedIndex = options.findIndex(o => o.selected);
    if (selectedIndex < 0) selectedIndex = -1;

    return { labels, values, selectedIndex: selectedIndex, defaultIndex: selectedIndex >= 0 ? selectedIndex : 0 };
}

// =========================================================================
// 学期 / 校区选择
// =========================================================================

async function chooseSemester(selectHtml) {
    const options = parseSemesterOptions(selectHtml);
    if (!options) {
        throw new Error('未能读取学年学期下拉，请确认已登录教务系统');
    }

    if (!ASK_SEMESTER && options.selectedIndex >= 0) {
        const picked = options.values[options.selectedIndex];
        console.log(`JS: 自动使用当前学期 ${picked}`);
        return picked;
    }

    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年学期", JSON.stringify(options.labels), options.defaultIndex
    );
    if (index === null || index === -1) return null;
    return options.values[index];
}

async function chooseCampus(pageXqdm) {
    let campusList = null;
    try {
        const json = await getJson('/admin/api/jcsj/xqsj/getXqList');
        campusList = (json.data || [])
            .map(item => ({ xqdm: String(item.id || '').trim(), xqmc: String(item.xqmc || item.id || '').trim() }))
            .filter(item => item.xqdm && item.xqmc);
    } catch (error) {
        console.warn('JS: 获取校区列表失败:', error.message);
    }

    if (!campusList || campusList.length === 0) {
        toast("未获取到校区列表，使用当前页面校区继续导入。");
        return { xqdm: pageXqdm, xqmc: "" };
    }

    const matched = campusList.findIndex(item => item.xqdm === pageXqdm);
    if (!ASK_CAMPUS && matched >= 0) {
        console.log(`JS: 自动使用页面校区 ${campusList[matched].xqmc}`);
        return campusList[matched];
    }

    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区", JSON.stringify(campusList.map(item => item.xqmc)), matched >= 0 ? matched : 0
    );
    if (index === null || index === -1) return null;
    return campusList[index];
}

// =========================================================================
// 作息时间与开学日期
// =========================================================================

// 返回 { timeSlots, semesterStartDate, semesterTotalWeeks }
async function fetchTimeAndWeekData(xnxq, xqdm) {
    const json = await getJson(`/admin/api/getZclistByXnxq?xnxq=${encodeURIComponent(xnxq)}&xqid=${encodeURIComponent(xqdm)}`);
    const data = json.data || {};

    // 节次时间（本校按小节返回，共 10 条）
    let timeSlots = null;
    if (Array.isArray(data.jcsjszList) && data.jcsjszList.length > 0) {
        timeSlots = data.jcsjszList
            .map(item => ({ number: Number(item.jc), startTime: formatTime(item.kssj), endTime: formatTime(item.jssj) }))
            .filter(item => item.number > 0 && item.startTime && item.endTime)
            .sort((a, b) => a.number - b.number);

        // 校验：节次必须从 1 开始连续，且时间不重叠，否则回退内置作息
        const numbers = timeSlots.map(s => s.number);
        const continuous = numbers.every((n, i) => n === i + 1);
        const noOverlap = timeSlots.every((s, i) => i === 0 || s.startTime >= timeSlots[i - 1].endTime);
        if (!continuous || !noOverlap || timeSlots.length === 0) {
            console.warn('JS: 教务作息数据不连续或有重叠，改用内置作息表');
            timeSlots = null;
        }
    }

    // 开学日期 = 第 1 周的周一
    let semesterStartDate = null;
    if (Array.isArray(data.zclist)) {
        const firstWeek = data.zclist.find(z => Number(z.zc) === 1);
        if (firstWeek && firstWeek.minrq) {
            semesterStartDate = String(firstWeek.minrq).split(' ')[0];
        }
    }

    const semesterTotalWeeks = Array.isArray(data.zclist) && data.zclist.length > 0
        ? data.zclist.length
        : FALLBACK_TOTAL_WEEKS;

    return { timeSlots, semesterStartDate, semesterTotalWeeks };
}

// =========================================================================
// 课程数据
// =========================================================================

/**
 * 节次与周次合并去重函数
 * 采用 wiki 教程《课程合并与去重函数》的参考实现，未做修改
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

function parseCourseData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.data)) return [];

    // 超星按"小节"返回（djc = 第几小节）：先逐节转成课程块（startSection = endSection = 小节号），
    // 再交给 mergeAndDistinctCourses 处理连续节次、单双周与重复记录
    const rawCourses = [];

    for (const raw of jsonData.data) {
        const name = extractAnchorText(raw.kcmc);
        const teacher = cleanTeacherName(raw.tmc);
        const position = extractAnchorText(raw.croommc) || '待定';
        const day = Number(raw.xingqi);
        const section = Number(raw.djc);
        const weeks = parseWeeks(raw.zcstr);

        if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeks.length === 0) {
            continue;
        }

        const course = {
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: section,
            endSection: section,
            weeks: weeks
        };

        // 学分：本校 xf 字段为字符串数字（如 "2"、"0.5"），无法解析时不带该字段
        const credit = Number(raw.xf);
        if (!isNaN(credit) && credit > 0) {
            course.credit = credit;
        }

        rawCourses.push(course);
    }

    return mergeAndDistinctCourses(rawCourses);
}

async function fetchCourses(xnxq, xhid, xqdm) {
    const url = `/admin/xsd/pkgl/xskb/sdpkkbList?xnxq=${encodeURIComponent(xnxq)}&xhid=${encodeURIComponent(xhid)}&xqdm=${encodeURIComponent(xqdm)}&xskbxslx=0`;
    const json = await getJson(url);
    return parseCourseData(json);
}

// =========================================================================
// 保存
// =========================================================================

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

async function saveTimeSlots(timeSlots) {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

async function saveConfig(semesterStartDate, semesterTotalWeeks) {
    const config = { semesterTotalWeeks: semesterTotalWeeks };
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// =========================================================================
// 主流程
// =========================================================================

function isLoginPage() {
    return window.location.href.includes('/admin/login') || window.location.href.includes('slogin');
}

async function runImportFlow() {
    try {
        if (isLoginPage()) {
            await alertUser("导入失败", "当前是登录页面，请先完成登录并进入教务系统内部页面后再执行导入。");
            return;
        }

        const confirmed = await alertUser(
            "西安石油大学教务系统课表导入",
            "将自动读取当前学期、校区、作息时间与开学日期。\n导入前请确认已成功登录教务系统。"
        );
        if (confirmed !== true && confirmed !== "true") {
            toast("用户取消了导入。");
            return;
        }

        // 1. 参数（来自课表页而非当前页面，见 extractPageParams 注释）
        const { xhid, xqdm: pageXqdm, xnxqSelectHtml } = await extractPageParams();
        diagnoseInfo = `xhid ${xhid.length} 字符 / xqdm ${pageXqdm.length} 字符`;

        // 2. 学期（默认取教务系统标记的当前学期）
        const xnxq = await chooseSemester(xnxqSelectHtml);
        if (xnxq === null) {
            toast("导入已取消：未选择学年学期。");
            return;
        }

        // 3. 校区（默认取当前页面校区）
        const campus = await chooseCampus(pageXqdm);
        if (campus === null) {
            toast("导入已取消：未选择校区。");
            return;
        }

        toast(`正在导入 ${xnxq}${campus.xqmc ? ' · ' + campus.xqmc : ''} ...`);

        // 4. 课程
        const courses = await fetchCourses(xnxq, xhid, campus.xqdm);
        if (courses.length === 0) {
            await alertUser("未找到课程", `${xnxq} 学期未获取到任何课程数据，请确认学期选择是否正确，或该学期暂无排课。`);
            return;
        }
        await saveCourses(courses);
        console.log(`JS: 课程保存成功，共 ${courses.length} 条。`);

        // 5. 作息时间与开学日期（失败不阻塞课程导入）
        try {
            const { timeSlots, semesterStartDate, semesterTotalWeeks } = await fetchTimeAndWeekData(xnxq, campus.xqdm);
            await saveConfig(semesterStartDate, semesterTotalWeeks);

            if (timeSlots && timeSlots.length > 0) {
                await saveTimeSlots(timeSlots);
            } else {
                await saveTimeSlots(FALLBACK_TIME_SLOTS);
                toast("未获取到教务作息，已使用内置作息表。");
            }
            console.log(`JS: 配置导入完成，开学日期 ${semesterStartDate}，总周数 ${semesterTotalWeeks}。`);
        } catch (error) {
            console.warn('JS: 作息/开学日期获取失败:', error.message);
            toast("作息时间与开学日期获取失败，课程已导入，可稍后重试。");
        }

        toast(`导入成功：${courses.length} 条课程、${xnxq}${campus.xqmc ? ' · ' + campus.xqmc : ''}。`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error('JS: 导入流程异常:', error);
        const tail = diagnoseInfo ? `\n\n[诊断] ${diagnoseInfo}` : '';
        await alertUser("导入失败", `${error.message}\n\n请确认：\n1. 已在教务系统中成功登录；\n2. 网络可以正常访问 jiaowu.xsyu.edu.cn。${tail}`);
    }
}

runImportFlow();
