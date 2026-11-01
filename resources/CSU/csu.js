// 中南大学 拾光课程表适配脚本（强智 jsxsd，与 CSUFT 同厂但页面结构不同）
//
// 四个坑：
//   ① 表头列序为「星期日、星期一…」，星期日在第 0 列，需映射为 day=7
//   ② 节次表头是全角连字符「1－2」
//   ③ 格内 kbcontent1 是隐藏旧数据，必须精确取 div.kbcontent，否则课程翻倍
//   ④ 课表页有两个 id=kbtable：第一个是课程表，第二个是页脚周次表
//
// 数据全部走同源请求，不读当前页面。整体包在 IIFE 里：App 每次点导入都会重新
// evaluate 本文件，顶层直接写 const 会让第二次抛 "already been declared" 而崩掉。

(function () {

const KB_PATH = "/jsxsd/xskb/xskb_list.do";
const JXZL_PATH = "/jsxsd/jxzl/jxzl_query";   // 教学周历：学期列表 + 开学日期 + 总周次

// 网络请求：与适配案例一一对应，返回 HTML 文本，解析交给调用方

// 同源请求：有 body 走 POST，否则 GET
async function requestPage(path, body) {
    const opt = { method: body ? "POST" : "GET", credentials: "include" };
    if (body) {
        opt.headers = { "Content-Type": "application/x-www-form-urlencoded" };
        opt.body = body;
    }
    const resp = await fetch(location.origin + path, opt);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.text();
}

// 三个入口与适配案例同名，便于对照
function requestSemesterPage() {
    return requestPage(JXZL_PATH);
}

function requestSemesterDetailPage(semesterId) {
    return requestPage(JXZL_PATH, "xnxq01id=" + encodeURIComponent(semesterId));
}

function requestCoursePage(semesterId) {
    return requestPage(KB_PATH, "cj0701id=&zc=&demo=&xnxq01id=" + encodeURIComponent(semesterId));
}

// 中南共 9 个学期，全列；案例的「上下各 3 个」会选不到更早的学期
async function fetchSemesterList() {
    const doc = parseDoc(await requestSemesterPage());
    const select = doc.getElementById("xnxq01id");
    const all = select ? Array.from(select.querySelectorAll("option"))
        .map(o => ({
            value: o.value,
            label: (o.textContent || "").trim(),
            selected: o.hasAttribute("selected")
        }))
        .filter(o => o.value) : [];
    if (all.length === 0) return { list: [], defaultIndex: 0 };

    let idx = all.findIndex(o => o.selected);
    if (idx < 0) idx = 0;
    return { list: all, defaultIndex: idx };
}

// 开学日期、总周次、周起始日。
// 教务不同学期的周起始并不一致：周日列有日期就从周日起算（firstDayOfWeek=7），
// 该列留空则第 1 周从周一开始（=1）。取第 1 行第一个日期格，按它自己的星期判断。
async function fetchSemesterInfo(semesterId) {
    const doc = parseDoc(await requestSemesterDetailPage(semesterId));
    const table = doc.getElementById("kbtable");
    const rows = table
        ? Array.from(table.querySelectorAll("tr")).filter(r => r.querySelector("td"))
        : [];
    if (rows.length === 0) return { startDate: null, totalWeeks: null, firstDayOfWeek: 7 };

    let startDate = null;
    let firstDayOfWeek = 7;
    const cell = rows[0].querySelector("td[title]");
    const m = /^(\d{4})年(\d{2})月(\d{2})/.exec(cell ? (cell.getAttribute("title") || "") : "");
    if (m) {
        startDate = m[1] + "-" + m[2] + "-" + m[3];
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        firstDayOfWeek = d.getDay() === 0 ? 7 : 1;
    }

    let totalWeeks = null;
    for (const row of rows) {
        const first = row.querySelector("td");
        const n = parseInt(first ? first.textContent.trim() : "", 10);
        if (!isNaN(n) && n > 0 && (totalWeeks === null || n > totalWeeks)) totalWeeks = n;
    }
    return { startDate, totalWeeks, firstDayOfWeek };
}

async function fetchCourses(semesterId) {
    const doc = parseDoc(await requestCoursePage(semesterId));
    // 教学周历页同样有 table#kbtable，用 kbcontent 判断是不是真正的课表
    if (!doc.querySelector("div.kbcontent")) throw new Error("返回页面里没有课程，请确认已登录");
    return parseSchedule(doc);
}

const WEEKDAY_MAP = {
    '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4,
    '星期五': 5, '星期六': 6, '星期日': 7, '星期天': 7
};

// 中南作息：校历「上课时间」，2024-2025 起三学年一致，共 10 节。
// 第九节前 17:40-19:00 为晚餐不排课，故第九节不接第八节。
const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" }
];

function parseDoc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
}

// 两个 id=kbtable（课程格子 / 页脚周次表），按「含星期表头」筛出课程表
function findCourseTable(doc) {
    const tables = doc.querySelectorAll('table#kbtable');
    for (const t of tables) {
        const head = t.querySelector('tr');
        if (head && /星期/.test(head.textContent)) return t;
    }
    return null;
}

// '1－2' → [1,2]；取首尾数字，'1－2,3－4' 表示 1~4 节连排
function parseSections(thText) {
    const nums = String(thText).match(/\d+/g);
    if (!nums) return null;
    return [parseInt(nums[0], 10), parseInt(nums[nums.length - 1], 10)];
}

// 周次：'3-12(周)' / '1,3,5(周)' / '2-4,8-20双周' / '3-12(周)[01-02节]'
// 单双标记有 (单)/(双)/(单周)/(双周)/裸「双周」等形态
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    let odd = false, even = false;
    // 圆括号与方括号整段摘掉。方括号里是节次（如 '[01-02节]'），
    // 不摘的话数字会粘成 '3-1201-02' 导致区间匹配失败、只剩第 3 周
    let rest = String(weekStr)
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/[\[【][^\]】]*[\]】]/g, '');
    // 单双只看括号内，避免课程名里的「双」字被误判
    if (/[（(][^）)]*单[^）)]*[）)]/.test(weekStr)) odd = true;
    if (/[（(][^）)]*双[^）)]*[）)]/.test(weekStr)) even = true;
    // 裸标记须在提数字前剥离，否则 '8-20双周' 的「双」会粘住区间尾部
    rest = rest.replace(/单周|双周/g, '').replace(/周|第/g, '');
    if (!odd && !even) {
        if (/单周/.test(weekStr)) odd = true;
        if (/双周/.test(weekStr)) even = true;
    }
    rest = rest.replace(/[^\d\-－~～,，]/g, '');   // 容忍 '3-12(周)abc' 这类脏数据

    for (let seg of rest.split(/[,，]/)) {
        seg = seg.trim();
        if (!seg) continue;
        const m = /^(\d+)\s*[-－~～]\s*(\d+)$/.exec(seg);
        if (m) {
            const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
            if (e >= s) for (let i = s; i <= e; i++) weeks.push(i);
            else weeks.push(s); // 倒序区间
        } else {
            const mm = /\d+/.exec(seg);
            if (mm) weeks.push(parseInt(mm[0], 10));
        }
    }
    let result = Array.from(new Set(weeks)).sort((a, b) => a - b);
    // 单双同时出现时不过滤，无法判定按哪个走，宁可多留不要丢课
    if (odd && !even) result = result.filter(w => w % 2 === 1);
    else if (even && !odd) result = result.filter(w => w % 2 === 0);
    return result;
}

// '贺福利[副教授]' → '贺福利'
function cleanTeacher(s) {
    return String(s).replace(/[\[【][^\]】]*[\]】]/g, '').trim();
}

// 解析 kbcontent 内的拼课块 → [[课程名, 教师, 教室, 周次原文], ...]
// 拼课以 5 个以上连字符分隔，分隔符落在 <br> 之后的文本节点里，遇分隔符结算当前段
function parseKbContent(div) {
    const parts = [];
    let buf = '';
    let fonts = [];
    for (const node of div.childNodes) {
        if (node.nodeType === 3) {
            const chunks = node.textContent.split(/-{5,}/);
            for (let i = 0; i < chunks.length; i++) {
                if (i > 0) { parts.push({ text: buf, fonts }); buf = ''; fonts = []; }
                buf += chunks[i];
            }
        } else if (node.tagName === 'BR') {
            buf += '\n';
        } else if (node.tagName === 'FONT') {
            fonts.push({
                title: node.getAttribute('title') || '',
                text: node.textContent.trim()
            });
            buf += node.textContent;
        } else {
            buf += node.textContent;
        }
    }
    parts.push({ text: buf, fonts });

    const out = [];
    for (const part of parts) {
        // 课程名 = 首个换行之前的非空文本行。
        // 拼课第 2 段起以 <br> 开头，首个换行之前是空的，要往后找
        let name = '';
        for (const line of part.text.split('\n')) {
            const t = line.replace(/\s+/g, ' ').trim();
            if (t.length >= 2) { name = t; break; }
        }
        if (!name) continue;

        const pick = (titles) => {
            for (const t of titles) {
                const hit = part.fonts.find(f => f.title === t);
                if (hit) return hit.text;
            }
            return '';
        };
        const teacher = cleanTeacher(pick(['老师', '教师']));
        const position = pick(['教室', '上课地点']);
        let weeks = pick(['周次(节次)', '周次', '节次']);
        const sd = pick(['单双周']);
        // 部分页面的单双周是独立字段，套上括号并入周次串以命中 parseWeeks 的括号匹配
        if (weeks && /单|双/.test(sd)) weeks += '(' + sd + ')';
        out.push([name, teacher, position, weeks]);
    }
    return out;
}

// 主解析：课表页 → 合并后的课程数组，接受 Document 或 HTML 字符串
function parseSchedule(input) {
    const doc = (input && input.nodeType === 9) ? input : parseDoc(input);
    const table = findCourseTable(doc);
    if (!table) return [];

    const colToDay = {};
    const raw = [];

    for (const row of table.querySelectorAll('tr')) {
        const ths = Array.from(row.querySelectorAll('th'));
        const tds = Array.from(row.querySelectorAll('td'));

        if (ths.some(th => th.textContent.indexOf('星期') >= 0)) {
            ths.forEach((th, ci) => {
                if (ci === 0) return; // 第 0 列是节次标签列
                const cname = th.textContent;
                for (const k in WEEKDAY_MAP) {
                    if (cname.indexOf(k) >= 0) {
                        colToDay[ci - 1] = WEEKDAY_MAP[k]; // td 索引从 0 起
                        break;
                    }
                }
            });
            continue;
        }

        const section = ths.length ? parseSections(ths[0].textContent) : null;
        if (!section) continue;

        tds.forEach((td, ci) => {
            const day = colToDay[ci];
            if (day === undefined) return;
            // 必须精确取 class="kbcontent"：隐藏的 kbcontent1 带着同样完整的
            // 拼课数据，用模糊选择器会把每门课翻倍
            const div = td.querySelector('div.kbcontent');
            if (!div) return;
            // 同格拼课共用本格节次范围、靠周次区分先后，绝不能拆成不同节次
            for (const [name, teacher, position, weeksTxt] of parseKbContent(div)) {
                const weeks = parseWeeks(weeksTxt);
                if (weeks.length === 0) continue;
                raw.push({
                    name, teacher, position,
                    day, startSection: section[0], endSection: section[1],
                    weeksRaw: weeksTxt, weeks
                });
            }
        });
    }
    return mergeCourses(raw);
}

// 阶段 1 合并连排课（周次须相同，否则分阶段排课会被错并），阶段 2 合并同节次的周次
function mergeCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const sameKey = (a, b) =>
        a.name === b.name && a.teacher === b.teacher &&
        a.position === b.position && a.day === b.day;
    const weeksKey = c => (Array.isArray(c.weeks) ? c.weeks.join(',') : '');
    const byCourseBase = (a, b) =>
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.teacher < b.teacher ? -1 : a.teacher > b.teacher ? 1 : 0) ||
        (a.position < b.position ? -1 : a.position > b.position ? 1 : 0) ||
        (a.day || 0) - (b.day || 0);
    const bySection = (a, b) =>
        byCourseBase(a, b) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0);

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? c.weeks.slice().sort((a, b) => a - b) : []
    }));

    // 阶段 1 必须先按周次分组，再按节次排序，防止同节次不同周次的拼课插在连排课中间
    list.sort((a, b) =>
        byCourseBase(a, b) ||
        weeksKey(a).localeCompare(weeksKey(b)) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );
    const step1 = [];
    let cur = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSameCourse = sameKey(cur, next) && weeksKey(cur) === weeksKey(next);
        if (isSameCourse && next.startSection === cur.endSection + 1) {
            cur.endSection = next.endSection;
        } else if (isSameCourse && next.startSection === cur.startSection &&
                   next.endSection === cur.endSection) {
            continue;
        } else {
            step1.push(cur);
            cur = next;
        }
    }
    step1.push(cur);

    step1.sort(bySection);
    const out = [];
    cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const next = step1[i];
        if (sameKey(cur, next) &&
            cur.startSection === next.startSection && cur.endSection === next.endSection) {
            cur.weeks = Array.from(new Set(cur.weeks.concat(next.weeks))).sort((a, b) => a - b);
        } else {
            out.push(cur);
            cur = next;
        }
    }
    out.push(cur);

    return out;
}

async function saveAppConfig(semesterStartDate, totalWeeks, firstDayOfWeek) {
    // 周起始随学期而定：周日列有日期为 7，否则为 1（见 fetchSemesterInfo）
    const config = {
        "semesterStartDate": semesterStartDate,
        "semesterTotalWeeks": totalWeeks || 20,
        "firstDayOfWeek": firstDayOfWeek
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

async function saveAppTimeSlots() {
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
}

async function saveImportedCourses(courses) {
    return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses.map(c => ({
        name: c.name,
        teacher: c.teacher,
        position: c.position,
        day: c.day,
        startSection: c.startSection,
        endSection: c.endSection,
        weeks: c.weeks
    }))));
}

async function runImportFlow() {
    try {
        // 停在统一认证页时教务接口会 404，提前拦下
        const host = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(location.href || '')) || [])[1] || '';
        if (!host.toLowerCase().endsWith('.its.csu.edu.cn')) {
            window.shiguangBridge.showToast("导入失败：请先登录教务系统");
            return;
        }

        // 1. 用户确认
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "导入前确认",
            "将从教务系统读取课表，导入可在任意教务页面进行。\n\n现在继续？",
            "开始导入");
        if (!confirmed) return;

        // 2. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期列表…");
        const { list: semesters, defaultIndex } = await fetchSemesterList();
        if (semesters.length === 0) {
            window.shiguangBridge.showToast("导入失败：未获取到学期列表");
            return;
        }

        // 3. 用户选择学期
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", JSON.stringify(semesters.map(s => s.label)), defaultIndex);
        if (selectedIndex === null || selectedIndex === undefined || selectedIndex < 0) return;
        const semesterId = semesters[selectedIndex].value;

        // 4. 获取开学日期 + 总周次
        window.shiguangBridge.showToast("正在获取学期信息…");
        const { startDate, totalWeeks, firstDayOfWeek } = await fetchSemesterInfo(semesterId);

        // 5. 读不到开学日期直接退出，不猜也不让用户手填
        if (!startDate) {
            window.shiguangBridge.showToast("导入失败：未读到开学日期");
            return;
        }

        // 6. 获取课程
        window.shiguangBridge.showToast("正在请求课程数据…");
        const courses = await fetchCourses(semesterId);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("导入失败：该学期没有课程");
            return;
        }

        // 7. 保存配置
        await saveAppConfig(startDate, totalWeeks, firstDayOfWeek);
        await saveAppTimeSlots();
        await saveImportedCourses(courses);

        // 8. 完成：三个 save 已各自提示过结果，这里只做收尾跳转
        window.shiguangBridge.notifyTaskCompletion();
    } catch (err) {
        // App 侧 reject 的文案多数已带「失败」，避免出现「导入失败：课程导入失败: …」
        const msg = String((err && err.message) ? err.message : err);
        window.shiguangBridge.showToast(msg.includes("失败") ? msg : "导入失败：" + msg);
    }
}

// Node 下供测试取用；浏览器里没有 module，此段自动跳过
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseSchedule, parseDoc, parseWeeks, parseSections, parseKbContent,
        mergeCourses, cleanTeacher, fetchSemesterList, fetchSemesterInfo, fetchCourses
    };
}

// 挂出口供离线测试直接驱动流程
if (typeof window !== 'undefined') {
    window.runImportFlow = runImportFlow;
}

// 入口：WebView 中桥接就绪即执行
if (typeof window !== 'undefined' && window.shiguangBridgePromise) {
    runImportFlow();
}

})();
