// 湖北文理学院(hbuas.edu.cn) 拾光课程表适配脚本
// 教务系统：超星教务（hbuas.jw.chaoxing.com，dbname = hbuas）
// 使用流程：登录教务系统（账密登录或学习通扫码均可）→ 停留在任意教务页面 → 点击“执行导入”
//
// 接口说明（2026-2027-1 学期实测，返回 ret 均为 0）：
//   GET /admin/pkgl/xskb/queryKbForXsd                                  课表页 HTML（内含 #xhid / #xqdm / #xnxq1）
//   GET /admin/api/jcsj/xqsj/getXqList                                  校区列表（item.id = 校区代码，item.xqmc = 名称）
//   GET /admin/api/getZclistByXnxq?xnxq=<学年-学期>&xqid=<校区代码>      周次表 data.zclist + 节次时间 data.jcsjszList
//   GET /admin/xsd/pkgl/xskb/sdpkkbList?xnxq=&xhid=&xqdm=&xskbxslx=0     课程数据 JSON（data[]）
//
// 细节说明：
//   1. 课程数据按“单节”返回（djc = 第几节），脚本先逐节转成课程块，
//      再交给 wiki 教程《课程合并与去重函数》中的合并去重函数处理：
//      连续节次合并（1-2 + 3-4 → 1-4）、单双周合并（1,3,5 + 2,4,6 → 1-6）、完全重复去重。
//      实测 60 条原始记录 → 26 条，节次×周次单元 472 → 472，无数据丢失。
//   2. kcmc / tmc / croommc 都是 <a> 包裹的 HTML 片段，需要抽文本。
//   3. 教务系统的 #xnxq1 会把“当前学期”标为 selected，脚本把它作为学期单选列表的默认项：
//      常用场景一键确认；学期未开始时也可改选下学期提前导入。校区则默认沿用页面校区、不弹窗。
//   4. 作息时间与开学日期都从教务接口读取，不写死；仅在接口异常时回退到内置的北校区作息表。
//
// 维护者：salt-fishes

// 学期选择：默认【弹出单选列表】，并把教务系统标记的“当前学期”作为默认选中项。
//   常用场景直接确认即可；学期尚未开始时，也可在这里改选下学期，提前导入课表。
//   若希望完全不弹窗、始终使用当前学期，改为 false。
const ASK_SEMESTER = true;

// 校区选择：默认沿用当前页面校区、不弹窗（同一学生通常只在一个校区上课）。
//   若希望每次手动选择校区，改为 true。
const ASK_CAMPUS = false;

// 接口异常时的兜底作息（2026-2027-1 北校区实测值），正常情况不会用到
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:15", endTime: "20:00" }
];

// 兜底总周数（接口返回 zclist 长度时以接口为准）
const FALLBACK_TOTAL_WEEKS = 20;

// 出错时附在弹窗里的诊断信息（便于用户反馈时定位）
let diagnoseInfo = '';

// =========================================================================
// 桥接封装
// =========================================================================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[HBUAS] ' + message);
    }
}

async function alertUser(title, content) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        return await window.shiguangBridgePromise.showAlert(title, content, "确定");
    }
    console.warn('[HBUAS] ' + title + ' - ' + content);
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

// 去掉教师名里的括号备注
function cleanTeacherName(name) {
    if (!name) return '';
    return name.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
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
        // 带上接口名与 ret，便于用户反馈时快速定位（例如 xhid 无效时 sdpkkbList 会返回 ret=-1）
        throw new Error(`${url.split('?')[0]} 返回 ret=${json.ret}：${json.msg || '未知错误'}`);
    }
    return json;
}

// =========================================================================
// 页面参数提取
// =========================================================================

// 课表页地址。其服务端渲染的 #xhid（86 字符加密串）/ #xqdm / #xnxq1 才是正确参数。
// 注意：教务首页 /admin 里也存在一个 id="xhid" 的元素，但值是用户 ID（32 字符）。
// 若误用它调 sdpkkbList，服务端会返回 ret=-1「功能暂时停用，请联系管理员」。
// 因此这里【始终优先采用课表页里的值】，只有当课表页抓取失败时才退回当前页面 DOM。
const KB_PAGE_URL = '/admin/pkgl/xskb/queryKbForXsd';

function pickKbParams(doc) {
    return {
        xhid: doc.querySelector('#xhid')?.value || '',
        xqdm: doc.querySelector('#xqdm')?.value || '',
        xnxqSelectHtml: doc.querySelector('#xnxq1')?.outerHTML || null
    };
}

// 提取 #xhid（学号加密串）/ #xqdm（校区代码）/ #xnxq1（学期下拉）
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

    // 默认静默采用教务系统标记的当前学期（可改为始终询问，见 ASK_SEMESTER）
    if (!ASK_SEMESTER && options.selectedIndex >= 0) {
        const picked = options.values[options.selectedIndex];
        console.log(`JS: 自动使用当前学期 ${picked}`);
        return picked;
    }

    // 弹出单选列表，并把“当前学期”作为默认选中项：
    // 常用场景直接确认即可；学期未开始时，也可在此改选下学期提前导入课表
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

    // 节次时间
    let timeSlots = null;
    if (Array.isArray(data.jcsjszList) && data.jcsjszList.length > 0) {
        timeSlots = data.jcsjszList
            .map(item => ({ number: Number(item.jc), startTime: formatTime(item.kssj), endTime: formatTime(item.jssj) }))
            .filter(item => item.number > 0 && item.startTime && item.endTime)
            .sort((a, b) => a.number - b.number);
        if (timeSlots.length === 0) timeSlots = null;
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

    // 超星按“单节”返回（djc = 第几节）：先逐节转成课程块（startSection = endSection = 节次），
    // 再交给 mergeAndDistinctCourses 处理连续节次、单双周与重复记录
    const rawCourses = [];

    for (const raw of jsonData.data) {
        const name = extractAnchorText(raw.kcmc);
        const teacher = cleanTeacherName(extractAnchorText(raw.tmc));
        const position = extractAnchorText(raw.croommc) || '待定';
        const day = Number(raw.xingqi);
        const section = Number(raw.djc);
        const weeks = parseWeeks(raw.zcstr);

        if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeks.length === 0) {
            continue;
        }

        rawCourses.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: section,
            endSection: section,
            weeks: weeks
        });
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
            "湖北文理学院教务系统课表导入",
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
        await alertUser("导入失败", `${error.message}\n\n请确认：\n1. 已在教务系统中成功登录；\n2. 网络可以正常访问 hbuas.jw.chaoxing.com。${tail}`);
    }
}

runImportFlow();
