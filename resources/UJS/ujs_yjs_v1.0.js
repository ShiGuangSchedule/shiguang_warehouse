// 江苏大学(ujs.edu.cn)研究生管理系统 拾光课程表适配脚本
// 基于正方研究生管理系统(研究生版 Gmis / pyxx)适配
// 出现问题请联系作者或者提交直接pr更改,这更加快速

// 作者：洛初 Github@gongfuture

// 2026.09.10 第一版
// 研究生系统没有对外直连入口，需先经统一身份认证（ehall 门户或 http://yjsgll.ujs.edu.cn/pyxx/）登录。
// 课表从学生课表查询页 pygl/kbcx_xs.aspx 的 DataGrid 里解析：
// 单元格文本自带「第3-18周 单双周:星期二 上3,4 星期五 上1,2」，星期、节次、周次都能直接取到。
// 作息时间取自课表页下方的作息表（上午/下午/晚上），由服务端按当前令时渲染，脚本原样导入，
// 因此不再像本科脚本那样询问夏令时/冬令时，也不做楼栋匹配（研究生系统全校一套作息）。（后续看十一再调整）

// 2026.10.07 第二版
// 作息改为写入「组合作息方案」（comboSchedule）：夏令时 / 冬令时两套作息按日期区间自动切换，
// 不再从课表页抓取作息表，也不再需要用户手动选择令时。
// 夏令时 4/7 起、冬令时 10/7 起，与学校历年切令时公告一致，写死在方案规则里。
// 研究生全校作息统一（都在研究生楼一带），不存在本科那种按楼栋分叉的作息，
// 因此可以完全依赖组合作息，课程不再逐条写自定义时间：翻到哪一周，应用就用那一周的日期去匹配规则。
// 作息数据取自教务处公布的江大作息：上午三江楼(B)一套，下午/晚上本部(E)夏令时与冬令时各一套，两季上午相同。
// 开学日期：研究生系统没有校历接口，改用「我的课表」接口 App_Ajax/GetkcHandler.ashx 逐周回查，
// 找到某门课第一次出现的日期，再按（起始周-1）*7+（星期-1）反推开学日期；反推不到则跳过配置保存。
// 组合作息的日期区间按「本学期起止日期 ∩ 各令时日期区间」生成，保证整个学期被规则完整覆盖；
// 拿不到开学日期时回退为当年固定的 4/7–10/6、10/7–次年 4/6 两个区间。

/**
 * 数组过滤（原生实现）。
 * 部分教务页面会改写 Array.prototype.filter，这里用普通循环自行实现，不依赖被改写过的数组方法。
 */
function arrayFilter(arr, predicate) {
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i, arr)) {
            result.push(arr[i]);
        }
    }
    return result;
}

/**
 * 拼接教务系统接口地址。
 * 校内直连时 location.origin 就是教务域名，前缀为空；
 * 校外经 WebVPN 访问时路径带有 /http/<hex> 前缀，必须保留，否则会变成跨域请求。
 */
function buildApiUrl(path) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const prefix = prefixMatch ? prefixMatch[0] : "";
    return window.location.origin + prefix + path;
}

/**
 * 当前是否在研究生管理系统内。
 * 校内直连域名是 yjsgll.ujs.edu.cn，校外经 WebVPN 时是 webvpn.ujs.edu.cn/http/<hex>/pyxx/。
 */
function isGraduateSystemPage() {
    const host = window.location.hostname;
    if (host.indexOf("yjsgll.ujs.edu.cn") !== -1) return true;
    return /\/http\/[0-9a-f]+\/pyxx\//i.test(window.location.pathname);
}

/**
 * 是否停在登录页。
 * 未登录访问会被重定向到统一身份认证 https://pass.ujs.edu.cn/cas/login?service=.../pyxx/loginCAS.aspx。
 */
function isLoginPage() {
    const host = window.location.hostname;
    if (host.indexOf("pass.ujs.edu.cn") !== -1) return true;
    return window.location.pathname.indexOf("/cas/login") !== -1;
}

/**
 * 解析周次文本，返回周次数组。
 * 研究生系统的写法是「第3-18周」，也可能出现「第3周」；
 * 单双周标记要先把「单双周」这个词本身剔掉，否则会被误判成单周。
 */
function parseWeeks(weekText) {
    if (!weekText) return [];

    const cleaned = String(weekText).replace(/单双周/g, "");
    const oddOnly = cleaned.indexOf("单") !== -1;
    const evenOnly = cleaned.indexOf("双") !== -1;

    const weeks = [];
    const rangePattern = /(\d+)\s*-\s*(\d+)\s*周|(\d+)\s*周/g;
    let match;

    while ((match = rangePattern.exec(cleaned)) !== null) {
        const start = Number(match[1] || match[3]);
        const end = match[2] ? Number(match[2]) : start;

        for (let week = start; week <= end; week++) {
            if (oddOnly && week % 2 === 0) continue;
            if (evenOnly && week % 2 !== 0) continue;
            weeks.push(week);
        }
    }

    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重（参考官方 wiki 课程合并与去重函数）。
 * 课表里同一门课的每个上课时段都会重复一份完整文本，
 * 解析后会得到多条完全相同的记录，这里统一合并/去重。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
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
            current.weeks.join(",") === next.weeks.join(",");

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
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
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 取单元格文本。
 * 课表每个格子里是 <br> 分行的文本，DOMParser 解析出来的文档没有 innerText，
 * 先把 <br> 换成换行再取 textContent。
 */
function readCellText(cell) {
    const clone = cell.cloneNode(true);
    Array.from(clone.querySelectorAll("br")).forEach(br => br.replaceWith("\n"));
    return clone.textContent.replace(/ /g, " ").replace(/\r/g, "");
}

/**
 * 把「上3,4」「晚9,10,11」里的节次换算成全天连续节次。
 * 研究生系统文本里的节次就是全天连续编号（晚上从 9 开始），
 * 但个别部署可能写成段内编号（下1,2 / 晚1,2,3），这里两种写法都兼容。
 */
function normalizeSection(periodPrefix, number) {
    if (periodPrefix === "下") return number <= 4 ? number + 4 : number;
    if (periodPrefix === "晚") return number <= 3 ? number + 8 : number;
    return number;
}

const CHINESE_WEEKDAY_MAP = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7
};

/**
 * 解析一个课表单元格的文本。
 * 典型内容：
 *   课程:ESP（专门用途英语）
 *   班级:ESP（专门用途英语）5班理工
 *   (Y206(M)                       )
 *   第3-18周 单双周:星期二 上3,4 星期五 上1,2
 *   主讲教师:史莹娟
 * 一门课在同一格里会列出全部上课时段（上面的例子就是周二 + 周五两段），
 * 所以一个单元格可能产出多条课程记录。
 */
function parseCourseCellText(text) {
    const lines = String(text).split("\n").map(line => line.trim()).filter(line => line.length > 0);

    let name = "";
    let className = "";
    let teacher = "";
    let position = "";
    let scheduleLine = "";

    for (const line of lines) {
        if (/^课程[:：]/.test(line)) {
            name = line.replace(/^课程[:：]\s*/, "").trim();
            continue;
        }
        if (/^班级[:：]/.test(line)) {
            className = line.replace(/^班级[:：]\s*/, "").trim();
            continue;
        }
        if (/^主讲教师[:：]/.test(line)) {
            teacher = line.replace(/^主讲教师[:：]\s*/, "").trim();
            continue;
        }
        if (/^[（(].*[)）]$/.test(line)) {
            // 教室整行被括号包住，去掉最外层括号（教室内名可能自带括号，如 Y206(M)）
            position = line.replace(/^[（(]/, "").replace(/[)）]$/, "").trim();
            continue;
        }
        if (line.indexOf("周") !== -1) {
            scheduleLine = scheduleLine ? `${scheduleLine} ${line}` : line;
        }
    }

    // 名称、周次、上课时段是排课必需的，缺一不可
    if (!name || !scheduleLine) return [];

    const weeks = parseWeeks(scheduleLine);
    if (weeks.length === 0) return [];

    const sessionPattern = /星期([一二三四五六日天])\s*([上下晚])\s*([0-9，,、\s]+)/g;
    const records = [];
    let match;

    while ((match = sessionPattern.exec(scheduleLine)) !== null) {
        const day = CHINESE_WEEKDAY_MAP[match[1]];
        if (!day) continue;

        const numbers = arrayFilter(
            match[3].split(/[^0-9]+/).map(item => Number(item)),
            (item) => !isNaN(item) && item > 0
        );
        if (numbers.length === 0) continue;

        const sections = numbers.map(number => normalizeSection(match[2], number)).sort((a, b) => a - b);
        const startSection = sections[0];
        const endSection = sections[sections.length - 1];

        if (startSection < 1 || endSection > 20) continue;

        const remarkParts = [];
        if (className) remarkParts.push(`班级:${className}`);
        if (scheduleLine) remarkParts.push(scheduleLine.trim());

        records.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks,
            remark: remarkParts.join(" | ")
        });
    }

    return records;
}

/**
 * 解析课表页 #MainWork_DataGrid1 里的全部课程。
 * 每个单元格自带完整文本（含星期、节次、周次），不必按表格行列还原，
 * 重复出现的记录交给 mergeAndDistinctCourses 去重。
 */
function parseCoursesFromGrid(doc) {
    const grid = doc.querySelector("#MainWork_DataGrid1");
    if (!grid) return [];

    const courses = [];
    for (const cell of Array.from(grid.querySelectorAll("td"))) {
        const text = readCellText(cell);
        if (text.indexOf("课程") === -1) continue;
        courses.push(...parseCourseCellText(text));
    }

    return mergeAndDistinctCourses(courses);
}

/**
 * 研究生楼作息时间（江苏大学教务处公布的作息，两季对比如下）。
 *
 * 上午一年四季不变，与本科三江楼(B)那套一致；
 * 下午/晚上分夏令时与冬令时两套，与本科本部(E)那套一致：
 *   夏令时：下午 14:00 开始，晚上 19:00 开始；
 *   冬令时：下午 13:30 开始，晚上 18:30 开始。
 *
 * 节次是全天连续编号（上午 1-4、下午 5-8、晚上 9-11），与课表文本里的「上3,4」「晚9,10,11」一致。
 */
const MorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" }
];

// 夏令时 下午
const SummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" }
];

// 夏令时 晚上
const SummerEveningTimeSlots = [
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" }
];

// 冬令时 下午
const WinterAfternoonTimeSlots = [
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:25", endTime: "17:10" }
];

// 冬令时 晚上
const WinterEveningTimeSlots = [
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:25", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:05" }
];

// 两季各一套完整作息（上午、下午、晚上依次顺延，共 11 节）
const SummerTimeSlots = [...MorningTimeSlots, ...SummerAfternoonTimeSlots, ...SummerEveningTimeSlots];
const WinterTimeSlots = [...MorningTimeSlots, ...WinterAfternoonTimeSlots, ...WinterEveningTimeSlots];

/**
 * 组合作息方案名称。
 */
const COMBO_SCHEDULE_NAME = "江苏大学研究生作息（夏令时 / 冬令时自动切换）";

/**
 * 判断当前是否处于夏令时作息。
 * 学校历年都是 4 月 7 日起执行夏令时、10 月 7 日起执行冬令时（十一假期结束后切回）。
 * 这里只用于决定「基础时间段」写入哪一套，真正生效的时间由组合作息按日期决定。
 */
function isSummerTimeNow() {
    const now = new Date();
    const summerStart = new Date(now.getFullYear(), 3, 7); // 4月7日
    const winterStart = new Date(now.getFullYear(), 9, 7); // 10月7日
    return now >= summerStart && now < winterStart;
}

/**
 * 把日期字符串（"YYYY-MM-DD"）加减天数，返回同样格式的字符串。
 */
function shiftDate(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}

/**
 * 构造组合作息方案（comboSchedule）。
 *
 * 规则按日期区间匹配：夏令时 4/7–10/6，冬令时 10/7–次年 4/6。
 * 两者首尾相接，全年任意一天都能命中一条，不存在空档。
 *
 * 一个学期可能横跨两套令时区间，也可能跨年：
 *   秋季学期（9 月开学、次年 1 月结束）：当年夏令时尾巴 + 当年冬令时；
 *   春季学期（2 月开学、7 月结束）：上一年冬令时尾巴 + 当年夏令时。
 * 所以这里不假设"学期属于某一年"，而是把学期覆盖到的每一年都生成一对区间，
 * 再逐个与学期区间求交集，命中的才写进方案——这样任何学期都能被完整覆盖。
 *
 * 拿到开学日期时，方案只覆盖本学期，避免与其它学期的作息方案互相干扰；
 * 拿不到开学日期时退回全年固定的两个区间（以导入当天的"夏令时年份"为基准）。
 *
 * @param {string|null} semesterStartDate 本学期开学日期 "YYYY-MM-DD"，取不到传 null
 * @param {number} totalWeeks 本学期总周数
 */
function buildComboSchedule(semesterStartDate, totalWeeks) {
    // 本学期日期区间（含最后一周的最后一天）
    const semesterEnd = semesterStartDate
        ? shiftDate(semesterStartDate, Math.max(1, totalWeeks) * 7 - 1)
        : null;

    /**
     * 求「本学期」与「某个令时区间」的交集，无交集返回 null。
     */
    const intersect = (seasonStart, seasonEnd) => {
        if (!semesterStartDate || !semesterEnd) return null;
        const start = semesterStartDate > seasonStart ? semesterStartDate : seasonStart;
        const end = semesterEnd < seasonEnd ? semesterEnd : seasonEnd;
        return start <= end ? { startDate: start, endDate: end } : null;
    };

    // 学期覆盖到的年份范围：往前多取一年，兜住"1 月结束的秋季学期"和"2 月开学的春季学期"
    const now = new Date();
    const month = now.getMonth() + 1;
    const fallbackSummerYear = (month >= 8 || month < 4) ? now.getFullYear() : now.getFullYear() - 1;
    const firstYear = semesterStartDate
        ? Number(semesterStartDate.slice(0, 4))
        : fallbackSummerYear;
    const lastYear = semesterEnd ? Number(semesterEnd.slice(0, 4)) : firstYear;

    const publicSchedules = [];

    for (let year = firstYear - 1; year <= lastYear; year++) {
        // 该年度的夏令时：year/4/7 – year/10/6；冬令时：year/10/7 – (year+1)/4/6
        const summerRange = intersect(`${year}-04-07`, `${year}-10-06`);
        if (summerRange) {
            publicSchedules.push({
                name: "夏令时",
                startDate: summerRange.startDate,
                endDate: summerRange.endDate,
                defaultClassDuration: 45,
                defaultBreakDuration: 10,
                timeSlots: SummerTimeSlots
            });
        }

        const winterRange = intersect(`${year}-10-07`, `${year + 1}-04-06`);
        if (winterRange) {
            publicSchedules.push({
                name: "冬令时",
                startDate: winterRange.startDate,
                endDate: winterRange.endDate,
                defaultClassDuration: 45,
                defaultBreakDuration: 10,
                timeSlots: WinterTimeSlots
            });
        }
    }

    // 拿不到开学日期，或学期与所有令时区间都没有交集（例如纯夏季小学期）时，退回全年固定区间
    if (publicSchedules.length === 0) {
        publicSchedules.push({
            name: "夏令时",
            startDate: `${fallbackSummerYear}-04-07`,
            endDate: `${fallbackSummerYear}-10-06`,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            timeSlots: SummerTimeSlots
        });
        publicSchedules.push({
            name: "冬令时",
            startDate: `${fallbackSummerYear}-10-07`,
            endDate: `${fallbackSummerYear + 1}-04-06`,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            timeSlots: WinterTimeSlots
        });
    }

    // 按开始日期排序，保证规则顺序与时间顺序一致（应用取第一条命中的规则）
    publicSchedules.sort((a, b) => a.startDate.localeCompare(b.startDate));

    return {
        name: COMBO_SCHEDULE_NAME,
        publicSchedules: publicSchedules
    };
}

/**
 * 读取下拉框当前选中项的值。
 * DOMParser 解析出的文档不一定支持 select.value，这里按 selected 属性自行判断。
 */
function getSelectedOptionValue(select) {
    if (!select || !select.options || select.options.length === 0) return "";

    for (const option of Array.from(select.options)) {
        if (option.hasAttribute("selected")) return option.value;
    }
    return select.options[0].value;
}

/**
 * 收集表单里可提交的字段，模拟一次完整回发。
 * ASP.NET 的 __VIEWSTATE 等方法不能少，逐个手写容易漏，这里整体搬运后按需覆盖。
 */
function collectPostbackFields(doc, overrides) {
    const params = new URLSearchParams();
    const form = doc.querySelector("#form1") || doc.querySelector("form");
    if (!form) return params;

    for (const el of Array.from(form.querySelectorAll("input[name], select[name], textarea[name]"))) {
        const tag = el.tagName.toLowerCase();
        const name = el.getAttribute("name");
        if (!name) continue;

        if (tag === "select") {
            params.set(name, getSelectedOptionValue(el));
            continue;
        }

        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "submit" || type === "image" || type === "button" || type === "reset") {
            // 图片按钮/提交按钮需要 .x / .y，或者完全不提交，这里跳过由调用方补充
            continue;
        }
        if (type === "checkbox" || type === "radio") {
            if (!el.hasAttribute("checked")) continue;
        }

        params.set(name, el.getAttribute("value") || "");
    }

    Object.keys(overrides || {}).forEach(key => params.set(key, overrides[key]));
    return params;
}

/**
 * 以 form 表单方式回发并返回响应 HTML。
 */
async function postForm(url, params) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: params.toString(),
        credentials: "include"
    });

    if (!response.ok) {
        throw new Error(`回发失败，状态码 ${response.status}`);
    }
    return await response.text();
}

/**
 * 读取指定学期的课表页文档。
 * 课表页默认渲染系统当前学期；要查历史/其它学期得按页面自身的逻辑回发两次：
 * 先把学期下拉框回发一次（换出新的 __VIEWSTATE），再点一次「查询」按钮重新绑定课表。
 * @param {string} semesterValue 学期下拉框的 value，为空表示用默认（当前）学期
 */
async function fetchTimetableDocument(semesterValue) {
    const url = buildApiUrl("/pyxx/pygl/kbcx_xs.aspx");

    const pageResponse = await fetch(url, { method: "GET", credentials: "include" });
    const pageDoc = new DOMParser().parseFromString(await pageResponse.text(), "text/html");

    const semesterSelect = pageDoc.querySelector("#MainWork_drpxq");
    if (!semesterSelect) {
        throw new Error("NOT_LOGGED_IN");
    }

    const currentValue = getSelectedOptionValue(semesterSelect);
    if (!semesterValue || semesterValue === currentValue) {
        return pageDoc;
    }

    // 第一步：学期下拉框回发，拿到与新选中项对应的 __VIEWSTATE
    const firstParams = collectPostbackFields(pageDoc, {
        "__EVENTTARGET": "ctl00$MainWork$drpxq",
        "__EVENTARGUMENT": "",
        "ctl00$MainWork$drpxq": semesterValue
    });
    const afterChangeDoc = new DOMParser().parseFromString(await postForm(url, firstParams), "text/html");

    // 第二步：点「查询」按钮，课表才按新学期的选项重新绑定
    const secondParams = collectPostbackFields(afterChangeDoc, {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "ctl00$MainWork$drpxq": semesterValue,
        "ctl00$MainWork$btnSearch.x": "5",
        "ctl00$MainWork$btnSearch.y": "5"
    });
    const resultDoc = new DOMParser().parseFromString(await postForm(url, secondParams), "text/html");

    if (!resultDoc.querySelector("#MainWork_DataGrid1")) {
        throw new Error("POSTBACK_FAILED");
    }
    return resultDoc;
}

/**
 * 读取学期下拉框的全部选项。
 */
function readSemesterOptions(doc) {
    const select = doc.querySelector("#MainWork_drpxq");
    if (!select) return null;

    const options = Array.from(select.options)
        .map(option => ({
            value: option.value,
            text: option.textContent.trim(),
            selected: option.hasAttribute("selected")
        }))
        .filter(option => option.text);

    if (options.length === 0) return null;

    let defaultIndex = options.findIndex(option => option.selected);
    if (defaultIndex === -1) defaultIndex = 0;

    return { options: options, defaultIndex: defaultIndex };
}

function formatDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, days) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + days);
    return result;
}

/**
 * 查询某天「我的课表」接口，判断目标课程当天是否上课。
 * App_Ajax/GetkcHandler.ashx 是首页「我的课表」按日期查询用的接口，
 * 传入日期就返回当天课程，可以用来反推开学日期。
 */
async function hasCourseOn(date, courseName, studentId) {
    const url = buildApiUrl(
        `/pyxx/App_Ajax/GetkcHandler.ashx?kcdate=${formatDate(date)}&xh=${encodeURIComponent(studentId)}`
    );

    const response = await fetch(url, { method: "GET", credentials: "include" });
    if (!response.ok) return false;

    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const text = (doc.body ? doc.body.textContent : "").replace(/\s+/g, "");
    return text.indexOf(String(courseName).replace(/\s+/g, "")) !== -1;
}

/**
 * 找到参照日期：距离今天最近的一个「目标星期」的日期（今天或之前）。
 * 星期编号 1-7 对应周一到周日。
 */
function findReferenceDate(day) {
    const today = new Date();
    const jsDay = today.getDay(); // 0=周日
    const todayDay = jsDay === 0 ? 7 : jsDay;
    let diff = todayDay - day;
    if (diff < 0) diff += 7;
    return addDays(today, -diff);
}

/**
 * 挑选用于探测的课程：起始周最早、周次跨度最短的那门，
 * 跨度短意味着要核对的周次少。
 */
function pickProbeCourse(courses) {
    let best = null;

    for (const course of courses) {
        if (!course.weeks || course.weeks.length === 0) continue;

        const weeks = course.weeks;
        const span = weeks[weeks.length - 1] - weeks[0];

        if (!best ||
            weeks[0] < best.weeks[0] ||
            (weeks[0] === best.weeks[0] && span < best.span)) {
            best = { name: course.name, day: course.day, weeks: weeks, span: span };
        }
    }

    return best;
}

/**
 * 反推本学期开学日期。
 *
 * 研究生系统没有校历接口，只能借「我的课表」接口逐周回查：
 * 以目标课程所在星期的最近一个日期为参照，按周展开探测（区间大约覆盖前后一个学期），
 * 再把每个命中日期当作「该课第一次上课的那天」，用课程自己的周次表去核对：
 * 前一周必须没课，且课程周次表里的每一周都应当对得上。
 * 核对通过后，开学日期 = 首次上课日期 - ((起始周 - 1) * 7 + (星期 - 1))，按周一为一周之始。
 *
 * 校验通过多个候选时取离今天最近的那个，避免把上一学年的同名课程认成本学期。
 * 任何一步拿不到结果就返回 null，由调用方跳过配置保存。
 */
async function deriveSemesterStartDate(courses, studentId) {
    if (!studentId) {
        console.warn("JS: 未取到学号，跳过开学日期推算。");
        return null;
    }

    const target = pickProbeCourse(courses);
    if (!target) {
        console.warn("JS: 没有可用于探测的课程，跳过开学日期推算。");
        return null;
    }

    const reference = findReferenceDate(target.day);
    const maxBackWeeks = 40;
    const maxForwardWeeks = 12;

    const offsets = [0];
    for (let week = 1; week <= maxBackWeeks; week++) {
        offsets.push(-week);
        if (week <= maxForwardWeeks) offsets.push(week);
    }

    const observed = new Map();
    const batchSize = 2;
    let hitBatchIndex = -1;

    for (let index = 0; index < offsets.length; index += batchSize) {
        const batch = offsets.slice(index, index + batchSize);
        const results = await Promise.all(
            batch.map(async offset => ({
                offset: offset,
                hit: await hasCourseOn(addDays(reference, offset * 7), target.name, studentId)
            }))
        );

        for (const item of results) {
            observed.set(item.offset, item.hit);
        }

        if (hitBatchIndex === -1 && results.some(item => item.hit)) {
            hitBatchIndex = index / batchSize;
        }
        // 找到命中后再多探一批，够核对课程周次就够了，不必把整个区间探完
        if (hitBatchIndex !== -1 && index / batchSize > hitBatchIndex) {
            break;
        }

        // 稍作等待防止风控
        const delay = 300 + Math.floor(Math.random() * 200);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    const hitOffsets = Array.from(observed.keys())
        .filter(offset => observed.get(offset))
        .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);

    if (hitOffsets.length === 0) {
        console.warn(`JS: 前后约一个学期内未探到课程「${target.name}」，跳过开学日期推算。`);
        return null;
    }

    const firstWeek = target.weeks[0];
    // 单双周课程每隔一周才上课，用课程自己的周次间隔做「上一次课」的核对距离，
    // 否则会把「课程中途的某一次课」误判成起始周（相邻一周本来就该没课）。
    const weekStep = target.weeks.length > 1 ? target.weeks[1] - target.weeks[0] : 1;

    for (const candidate of hitOffsets) {
        // 起始周之前的那一次课必须没有课，否则这个候选只是课程中途的一次课
        if (observed.get(candidate - weekStep) === true) continue;

        // 用课程自己的周次表核对：课程上课的每一周都应探到课
        let consistent = true;
        let checked = 0;

        for (const week of target.weeks) {
            const offset = candidate + (week - firstWeek);
            const seen = observed.get(offset);
            if (seen === undefined) continue;

            checked += 1;
            if (!seen) {
                consistent = false;
                break;
            }
        }

        if (!consistent || checked < 1) continue;

        const firstClassDate = addDays(reference, candidate * 7);
        const startDate = addDays(firstClassDate, -((firstWeek - 1) * 7 + (target.day - 1)));

        // 推算出的开学日期必须是周一，否则说明数据对不上，宁可不写
        if (startDate.getDay() !== 1) continue;

        console.log(`JS: 探测课程「${target.name}」首次上课日期 ${formatDate(firstClassDate)}（第 ${firstWeek} 周），推算开学日期 ${formatDate(startDate)}。`);
        return formatDate(startDate);
    }

    console.warn(`JS: 课程「${target.name}」的探测结果与周次表对不上，跳过开学日期推算。`);
    return null;
}

/**
 * 计算本学期总周数：取所有课程周次的最大值。
 * 研究生系统没有校历，这个值只是课表的周次上限，多算几周无空白无妨，少算会截断课程。
 */
function calculateTotalWeeks(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) maxWeek = week;
        }
    }
    return maxWeek;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "研究生系统课表导入",
        "导入前请确保您已在浏览器中登录江苏大学研究生管理系统（可从综合服务门户点「研究生管理系统」进入，或直接访问 http://yjsgll.ujs.edu.cn/pyxx/）。",
        "好的，开始导入"
    );
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error("JS: Save Courses Error:", error);
        return false;
    }
}

/**
 * 只在能拿到真实开学日期时写入课表配置。
 * 应用侧的 saveCourseConfig 是整体覆盖而非字段级合并：没有传入的字段会被写成模型默认值，
 * 其中 semesterStartDate 的默认值是 null，会把用户已经设置好的开学日期清空。
 * 所以拿不到开学日期时返回 null，宁可不写也不要写坏。
 */
async function saveCourseConfigIfPossible(config) {
    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        console.log("JS: 无可用开学日期，跳过 saveCourseConfig 以保留用户现有配置。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            `课表配置更新成功！开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error("JS: Save Config Error:", error);
    }
}

/**
 * 提交基础时间段（组合作息的骨架）。
 * 必须成功，否则后面的 saveComboSchedule 会被应用直接拒绝（顺序强校验）。
 */
async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return false;
    }

    window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        console.error("JS: Save Time Slots Error:", error);
        return false;
    }
}

/**
 * 提交组合作息方案：夏令时 / 冬令时按日期区间自动切换。
 * 应用会以 importPresetTimeSlots 提交的基础时间段为骨架做差量合并，
 * 本方案每个模板都提交完整 1-11 节，所以合并结果与模板本身一致。
 * 调用后本次导入任务不再允许调用 savePresetTimeSlots，因此顺序必须固定为「先时间段、后方案」。
 */
async function importComboSchedule(comboSchedule) {
    window.shiguangBridge.showToast("正在导入夏令时/冬令时组合作息方案...");
    try {
        await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(comboSchedule));
        console.log("JS: 组合作息方案已导入:", comboSchedule);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入作息方案失败: " + error.message);
        console.error("JS: Save Combo Schedule Error:", error);
        return false;
    }
}

async function runImportFlow() {
    if (!isGraduateSystemPage()) {
        window.shiguangBridge.showToast("导入失败：请先进入江苏大学研究生管理系统！");
        console.log("JS: 当前不在研究生管理系统页面，终止导入。");
        return;
    }

    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录研究生管理系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在读取课表数据...");

    // 先取一次默认（当前）学期，用于学期列表与课表
    let defaultDoc;
    try {
        defaultDoc = await fetchTimetableDocument("");
    } catch (error) {
        if (error.message === "NOT_LOGGED_IN") {
            window.shiguangBridge.showToast("未登录或登录已过期，请先登录研究生管理系统。");
        } else {
            window.shiguangBridge.showToast(`读取课表失败: ${error.message}`);
        }
        console.error("JS: 读取课表页失败:", error);
        return;
    }

    const semesterData = readSemesterOptions(defaultDoc);
    if (!semesterData) {
        window.shiguangBridge.showToast("未能读取学期列表，请确认已登录并停留在研究生管理系统。");
        return;
    }

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterData.options.map(item => item.text)),
        semesterData.defaultIndex
    );
    if (semesterIndex === null || semesterIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const semesterValue = semesterData.options[semesterIndex].value;
    const semesterText = semesterData.options[semesterIndex].text;

    let timetableDoc = defaultDoc;
    if (semesterIndex !== semesterData.defaultIndex) {
        window.shiguangBridge.showToast(`正在切换到 ${semesterText} ...`);
        try {
            timetableDoc = await fetchTimetableDocument(semesterValue);
        } catch (error) {
            window.shiguangBridge.showToast(`切换学期失败: ${error.message}`);
            console.error("JS: 切换学期失败:", error);
            return;
        }
    }

    const courses = parseCoursesFromGrid(timetableDoc);
    if (courses.length === 0) {
        window.shiguangBridge.showToast(`${semesterText} 未找到任何课程，请确认所选学期是否正确。`);
        console.log("JS: 课表为空，终止导入。");
        return;
    }

    console.log(`JS: 解析到 ${courses.length} 门课程。`);

    // 学号取自课表页隐藏域，用来查「我的课表」接口
    const studentId = (timetableDoc.querySelector("#MainWork_WUCpyjhdy_HFfilename") || {}).value || "";

    window.shiguangBridge.showToast("正在推算开学日期...");
    const semesterStartDate = await deriveSemesterStartDate(courses, studentId);

    const totalWeeks = calculateTotalWeeks(courses);
    const config = semesterStartDate
        ? {
            semesterStartDate: semesterStartDate,
            semesterTotalWeeks: totalWeeks,
            firstDayOfWeek: 1
        }
        : null;

    // 基础时间段（骨架）用导入当下的令时那一套；方案里两个模板都会提交完整 11 节，
    // 骨架实际只是用来满足「先时间段、后方案」的顺序要求，不会影响最终显示。
    const baseTimeSlots = isSummerTimeNow() ? SummerTimeSlots : WinterTimeSlots;
    const comboSchedule = buildComboSchedule(semesterStartDate, totalWeeks);

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    await saveCourseConfigIfPossible(config);

    // 顺序不可调换：saveComboSchedule 依赖 savePresetTimeSlots 成功写入的基础时间段。
    const timeSlotSaved = await importPresetTimeSlots(baseTimeSlots);
    if (timeSlotSaved) {
        await importComboSchedule(comboSchedule);
    } else {
        window.shiguangBridge.showToast("时间段导入失败，已跳过组合作息方案。");
        console.log("JS: 基础时间段未写入成功，跳过 saveComboSchedule。");
    }

    const scheduleBrief = comboSchedule.publicSchedules
        .map((rule) => `${rule.name} ${rule.startDate} ~ ${rule.endDate}`)
        .join("\n");

    await window.shiguangBridgePromise.showAlert(
        "导入完成",
        `已导入 ${semesterText} 共 ${courses.length} 门课程。\n\n` +
        `作息已写入组合作息方案（全天 ${baseTimeSlots.length} 节），将于每年 4 月 7 日切换到夏令时、` +
        "10 月 7 日切换到冬令时，无需重新导入。\n\n" +
        `本次方案的生效区间：\n${scheduleBrief}\n\n` +
        (semesterStartDate
            ? `开学日期由课表数据反推得到：${semesterStartDate}，请在应用内核对。`
            : "未能反推开学日期（作息方案已退回全年固定区间），请在应用内手动设置开学日期。"),
        "我知道了"
    );

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
