// 重庆三峡科技大学（sanxiau.edu.cn）拾光课程表适配脚本
// 教务系统：正方软件 V-9.0（zftal-ui-v5）
// 课表页：/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default
//
// 数据来源：AJAX（POST 表单），返回 JSON，课程在 kbList 数组内。
// 本脚本不包含任何账号密码，完全依赖用户在软件内已建立的教务会话（cookie）。

/* ============================================================
 * 一、纯函数：解析工具
 * ============================================================ */

/**
 * 解析周次字符串，返回去重升序的周次数组。
 *
 * 支持（正方实际出现的各种写法）：
 *   "1-16周"            -> 1..16
 *   "1-15周(单)"        -> 1,3,5,...,15
 *   "2-16周(双)"        -> 2,4,6,...,16
 *   "1-3周(单),4-16周"  -> 1,3,4..16      ← 混合周次，关键用例
 *   "1-8周,10-16周"     -> 1..8,10..16
 *   "1-8,10-16周"       -> 同上（"周"只在末尾出现一次）
 *   "1,3,5周"           -> 1,3,5
 *   "第1-16周"          -> 1..16
 *   "1-16周(单双)"      -> 1..16（无限制）
 *   "1-16"              -> 1..16（无"周"字）
 *
 * @param {string} weekStr 原始周次字符串
 * @returns {number[]} 去重且升序的周次
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const text = String(weekStr).trim();
    if (!text) return [];

    // 1. 按逗号 / 顿号 / 分号切分多个区间
    const segments = text.split(/[,，、;；]+/);

    const weeks = new Set();

    for (const segment of segments) {
        const seg = segment.trim();
        if (!seg) continue;

        // 2. 判断奇偶限制：单周 / 双周
        //    兼容 "(单)" "（单）" "单周" "(单双)" 等写法
        const isOdd = /单/.test(seg) && !/单双/.test(seg);
        const isEven = /双/.test(seg) && !/单双/.test(seg);

        // 3. 抽取该区间内所有 "数字-数字" 或 "数字" 片段
        //    使用全局匹配，从而同时支持 "1-3" 和 "1,3,5" 这类混排
        const rangeRe = /(\d+)\s*-\s*(\d+)/g;
        let matched = false;
        let m;

        while ((m = rangeRe.exec(seg)) !== null) {
            matched = true;
            let start = parseInt(m[1], 10);
            let end = parseInt(m[2], 10);
            if (isNaN(start) || isNaN(end)) continue;
            if (start > end) { const t = start; start = end; end = t; } // 容错：反序
            for (let w = start; w <= end; w++) {
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 !== 0) continue;
                weeks.add(w);
            }
        }

        // 4. 该区间没有 "a-b" 形式，则抽取所有孤立数字（"1,3,5周"）
        if (!matched) {
            const singles = seg.match(/\d+/g) || [];
            for (const s of singles) {
                const w = parseInt(s, 10);
                if (isNaN(w)) continue;
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 !== 0) continue;
                weeks.add(w);
            }
        }
    }

    return [...weeks].filter(w => w > 0 && w < 100).sort((a, b) => a - b);
}

/**
 * 解析节次字符串，返回 { startSection, endSection }。
 *
 * 支持：
 *   "1-2"      -> {1,2}
 *   "3"        -> {3,3}
 *   "第1-2节"  -> {1,2}
 *   "0102"     -> {1,2}   正方偶见补零编码
 *   "9-10"     -> {9,10}  本校准许 11/12/13/14 节，不做上限裁剪
 *
 * @param {string} sectionStr 原始节次字符串
 * @returns {{startSection:number, endSection:number}|null}
 */
function parseSections(sectionStr) {
    if (sectionStr === null || sectionStr === undefined) return null;
    const text = String(sectionStr).trim();
    if (!text) return null;

    // 去掉 "第" "节" "课" 等中文字符，只留数字和连字符
    const normalized = text.replace(/[^\d-]/g, '');
    if (!normalized) return null;

    // a-b 形式
    const rangeMatch = normalized.match(/^(\d+)\s*-\s*(\d+)$/) || normalized.match(/(\d+)-(\d+)/);
    if (rangeMatch) {
        let start = parseInt(rangeMatch[1], 10);
        let end = parseInt(rangeMatch[2], 10);
        if (isNaN(start) || isNaN(end)) return null;
        if (start > end) { const t = start; start = end; end = t; }
        return { startSection: start, endSection: end };
    }

    // 纯数字形式：可能是 "3" 也可能是补零的 "0102"
    const digits = normalized.replace(/-/g, '');
    if (/^\d{4}$/.test(digits)) {
        // "0102" -> 1~2
        const start = parseInt(digits.slice(0, 2), 10);
        const end = parseInt(digits.slice(2, 4), 10);
        if (start > 0 && end >= start) return { startSection: start, endSection: end };
    }
    if (/^\d+$/.test(digits)) {
        const n = parseInt(digits, 10);
        if (!isNaN(n) && n > 0) return { startSection: n, endSection: n };
    }

    return null;
}

/**
 * 清洗课程名称：去掉末尾的课程类型标记符号。
 *
 * 课表顶部图例：
 *   ★ 理论   ☆ 实验   〇 课外   ■ 实践   ◆ 上机
 * 这些符号属于"类型"而非课程名的一部分，需要剥离。
 * 例如 "线性代数Ⅱ★" -> "线性代数Ⅱ"
 *
 * @param {string} rawName 原始课程名
 * @returns {string} 清洗后的课程名
 */
function cleanCourseName(rawName) {
    if (!rawName) return '';
    return String(rawName)
        // 去掉末尾连续出现的类型标记
        .replace(/[★☆〇■◆○●◇□▪▫•·]+$/g, '')
        .trim();
}

/**
 * 合并与去重课程。
 *
 * 处理两类情况：
 *   1. 同一门课在同一星期、同一地点、同一周次下被拆成连续节次（如 1-2 与 3-4），合并为 1-4。
 *   2. 除节次外完全相同的记录，周次取并集。
 *
 * 注意：星期、周次、地点、教师任一不同则视为独立排课单元，不做合并。
 *       这正是"同名课程多个排课单元"能正确保留的原因。
 *
 * @param {Array} courses 课程数组
 * @returns {Array} 处理后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses || [];

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 先按 课程名/教师/地点/星期/周次/起始节次 排序，使可合并项彼此相邻
    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

    // 第一轮：合并连续节次 / 去除完全重复
    const step1 = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const sameKey =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection &&
                            current.endSection === next.endSection;

        if (sameKey && isContinuous) {
            current.endSection = next.endSection;
        } else if (sameKey && isDuplicate) {
            continue;
        } else {
            step1.push(current);
            current = next;
        }
    }
    step1.push(current);

    // 第二轮：节次也相同者，合并周次
    step1.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

    const step2 = [];
    let cur = step1[0];
    for (let i = 1; i < step1.length; i++) {
        const nxt = step1[i];
        const sameSlot =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;
        if (sameSlot) {
            cur.weeks = [...new Set([...cur.weeks, ...nxt.weeks])].sort((a, b) => a - b);
        } else {
            step2.push(cur);
            cur = nxt;
        }
    }
    step2.push(cur);

    return step2;
}

/* ============================================================
 * 二、数据解析：正方 kbList -> 拾光 CourseJsonModel
 * ============================================================ */

/**
 * 从正方返回的 JSON 中解析课程。
 *
 * 真实返回结构（已对本校接口实测）：
 * {
 *   "kbList": [                      // 已排课课程
 *     { "kcmc":"高等数学",            //   课程名（干净，★ 不在这里）
 *       "xslxbj":"★",                 //   课程类型标记：★理论 ☆实验 〇课外 ■实践 ◆上机
 *       "xm":"张三",                  //   教师
 *       "xqmc":"某校区", "cdmc":"某教学楼101",  // 校区 与 教室（两个字段，需拼接）
 *       "xqj":"1",                    //   星期 1-7
 *       "zcd":"1-16周",               //   周次，如 "1-3周(单),4-16周"
 *       "jcor":"3-4", "jcs":"3-4", "jc":"3-4节",  // 节次
 *       "pkbj":"1",                   //   排课标记，本适配器不使用（原因见解析处的说明）
 *       ... 以及 kch/xf/zxs/khfsmc/jxbmc 等大量附加信息（本适配器不使用）
 *     }
 *   ],
 *   "sjkList": [ ... ]               // 其它课程（智慧树等网课），无星期/节次，本适配器跳过
 * }
 *
 * 字段名仍保留多路兜底，以便同一适配器在其它正方部署上也能工作。
 *
 * @param {object} jsonData 接口返回的 JSON
 * @returns {Array} 拾光课程数组
 */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];

    const initialCourseList = [];

    for (const raw of jsonData.kbList) {
        // --- 关于「未排地点」的课程：不要跳过 ---
        // 本校正方给「没有分配教室」的课标上 cdmc="未排地点"、cd_id 缺失、pkbj="0"。
        // 实测确认：这类课**仍然有固定的上课时间**（如毛概 周五5-6节、5-12周），
        // 只是没排教室而已，属于正常课程，必须照常排进课表，地点写占位文字。
        // 而真正的网课（智慧树等）没有星期和节次，位于 sjkList，本函数根本读不到，
        // 自然不会误排。所以这里不按 pkbj 做任何过滤：没有时间的课会被下面的
        // 星期/节次校验自然挡掉，有时间的课一律保留。

        // --- 课程名 ---
        const rawName = raw.kcmc || raw.kcmc_raw || raw.kcbmc || '';
        const courseName = cleanCourseName(rawName);
        if (!courseName) continue;

        // --- 教师 ---
        const teacher = String(raw.xm || raw.jsxm || raw.jsmc || '').trim();

        // --- 地点 ---
        // 本校正方把校区与教室放在两个独立字段里（已实测）：
        //   xqmc="某校区" + cdmc="某教学楼101"  →  "某校区 某教学楼101"
        // 教室可能直接是 "未排地点" 或空串；本校准许没有正常教室的课程，
        // 空值时补一个可读占位，不因为缺地点就丢弃这门课。
        const campus = String(raw.xqmc || '').trim();
        const room = String(raw.cdmc || raw.jxdd || '').trim();
        const position = [campus, room || '未排地点'].filter(Boolean).join(' ') || '未排地点';

        // --- 星期 ---
        const day = parseInt(raw.xqj, 10);
        if (isNaN(day) || day < 1 || day > 7) continue;

        // --- 周次 ---
        const weeksArray = parseWeeks(raw.zcd || raw.zcmc || '');
        if (weeksArray.length === 0) continue;

        // --- 节次 ---
        const sectionSource = raw.jcor || raw.jcs || raw.jc || raw.jcsjmc || '';
        const sections = parseSections(sectionSource);
        if (!sections) continue;
        const { startSection, endSection } = sections;

        initialCourseList.push({
            name: courseName,
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    return mergeAndDistinctCourses(initialCourseList);
}

/* ============================================================
 * 三、网络请求
 * ============================================================ */

/**
 * 推导教务系统的上下文根路径。
 *
 * 多数学校部署在 /jwglxt/ 下（如 http://host/jwglxt/kbcx/...），
 * 但也有学校直接部署在域名根目录（如 http://jwglxt.sanxiau.edu.cn/kbcx/...）。
 * 本函数从当前页面 URL 中自动识别，避免写死。
 *
 * @returns {string} 形如 "http://host" 或 "http://host/jwglxt"
 */
function getContextRoot() {
    const origin = window.location.origin;
    const path = window.location.pathname || '';
    // 若当前路径里出现 /jwglxt/，则上下文根带该前缀
    const m = path.match(/^(.*?\/jwglxt)(?=\/|$)/);
    if (m) return origin + m[1];
    return origin;
}

/** 构造通用请求头 */
function jsonHeaders() {
    return {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'accept': 'application/json, text/javascript, */*; q=0.01'
    };
}

/**
 * 抓取课表页面，解析出可选的学年（xnm）与学期（xqm）。
 * 同时用于判断用户当前是否已登录。
 *
 * @returns {Promise<object|null>} { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex }
 */
async function fetchAcademicOptions() {
    const url = getContextRoot() + '/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default';
    try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        if (!response.ok) return null;

        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');

        const allYearOptions = Array.from(doc.querySelectorAll('#xnm option'))
            .filter(opt => opt.value !== '')
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        const semesterOptions = Array.from(doc.querySelectorAll('#xqm option'))
            .filter(opt => opt.value !== '')
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);
        const defaultSemesterIndex = semesterOptions.findIndex(opt => opt.selected);

        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex: defaultSemesterIndex !== -1 ? defaultSemesterIndex : 0
            };
        }

        // 以当前学年为中心，向前 2 年、向后 2 年，避免列表过长
        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);

        return {
            yearOptions: allYearOptions.slice(start, end),
            semesterOptions,
            defaultYearIndex: selectedIndex - start,
            defaultSemesterIndex: defaultSemesterIndex !== -1 ? defaultSemesterIndex : 0
        };
    } catch (e) {
        return null;
    }
}

/**
 * 让用户选择学年与学期。
 * 若页面解析失败（例如未登录），使用基于当前日期的智能兜底并提示用户。
 *
 * @returns {Promise<{academicYear:string, semesterCode:string}|null>} 用户取消返回 null
 */
async function selectAcademicYearAndSemester() {
    let optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        // 兜底：未登录或页面结构异常时，按当前日期推测学年学期
        const d = new Date();
        const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
        const isFirstSemester = d.getMonth() >= 7;
        optionsData = {
            yearOptions: [
                { value: String(y - 1), text: `${y - 1}-${y}` },
                { value: String(y), text: `${y}-${y + 1}` },
                { value: String(y + 1), text: `${y + 1}-${y + 2}` }
            ],
            semesterOptions: [
                { value: '3', text: '第一学期' },
                { value: '12', text: '第二学期' }
            ],
            defaultYearIndex: 1,
            defaultSemesterIndex: isFirstSemester ? 0 : 1
        };
        window.shiguangBridge.showToast('未能读取学年列表，已切换为智能预测，请确认后选择');
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学年', JSON.stringify(yearOptions.map(o => o.text)), defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期', JSON.stringify(semesterOptions.map(o => o.text)), defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/**
 * 向课表接口发起 POST，返回解析后的 JSON（失败返回 null）。
 *
 * @param {string} url 接口地址
 * @param {string} body 表单内容
 * @returns {Promise<object|null>}
 */
async function postForm(url, body) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: jsonHeaders(),
            body: body,
            credentials: 'include'
        });
        if (!response.ok) return null;
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            // 返回的不是 JSON，通常意味着会话已失效、被重定向到登录页
            return null;
        }
    } catch (e) {
        return null;
    }
}

/**
 * 获取课表数据。
 * 主接口失败时自动回落到备用接口（不同学校对正方的定制不同）。
 *
 * @param {string} academicYear 学年，如 "2026"
 * @param {string} semesterCode 学期代码，如 "3"
 * @returns {Promise<object|null>} 含 kbList 的 JSON
 */
async function fetchCourseJson(academicYear, semesterCode) {
    const root = getContextRoot();
    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;

    const endpoints = [
        root + '/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
        root + '/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151'
    ];

    for (const url of endpoints) {
        const json = await postForm(url, body);
        if (json && Array.isArray(json.kbList) && json.kbList.length > 0) {
            return json;
        }
    }
    return null;
}

/**
 * 尝试获取学期第 1 周的起始日期（用于校准周次）。
 *
 * 说明：该接口并非所有学校都开放，取不到时返回 null，
 *      此时不写入 semesterStartDate，交由用户在软件内自行设置，
 *      绝不使用"常识"猜测的日期。
 *
 * @param {string} academicYear 学年
 * @param {string} semesterCode 学期代码
 * @returns {Promise<string|null>} "YYYY-MM-DD" 或 null
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    const root = getContextRoot();
    const url = root + '/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154';
    const json = await postForm(url, `xnm=${academicYear}&xqm=${semesterCode}`);
    if (!json) return null;

    const list = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : null);
    if (!list || list.length === 0) return null;

    // 找到第 1 周记录
    const firstWeek = list.find(item =>
        String(item.zs) === '1' || String(item.zsmc) === '1'
    ) || list[0];

    const candidates = [firstWeek.rq, firstWeek.zcrq, firstWeek.ksrq, firstWeek.qsrq];
    for (const c of candidates) {
        if (!c) continue;
        // "2026-09-07/2026-09-13" 这种区间取前半段
        const match = String(c).match(/(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    return null;
}

/**
 * 本校作息时间（节次 -> 起止时间）。
 *
 * 【数据来源】2026-09-16 从本校教务系统「学生课表查询（按周次）」
 *   (gnmkdm=N2154) 页面**实测读取**：该页把每节课的起止时间渲染在
 *   课表首列，共 14 节，每节 40 分钟。逐条核对如下（节次/开始/结束）：
 *     1 08:30:00 09:10:00      8 15:20:00 16:00:00
 *     2 09:20:00 10:00:00      9 16:20:00 17:00:00
 *     3 10:20:00 11:00:00     10 17:10:00 17:50:00
 *     4 11:10:00 11:50:00     11 19:00:00 19:40:00
 *     5 12:30:00 13:10:00     12 19:50:00 20:30:00
 *     6 13:20:00 14:00:00     13 20:40:00 21:20:00
 *     7 14:30:00 15:10:00     14 21:30:00 22:10:00
 *   这是从系统里读出来的真实值，不是按常识推测的通用作息。
 *
 * 【为什么写死而不是动态取】已逐一排查，无接口可取：
 *   - /xtgl/jcsj_cxJcsj.html 对**学生账号返回"没有访问权限!"**（管理员接口）
 *   - 课表页 HTML（36 万字符）中「作息」0 命中、无任何 HH:MM
 *   - 课表模块 JS /js/comp/jwglxt/pkgl/cxkbazc/cxXskbcx.js (36KB)
 *     中无 08:30、无 kssj/jssj/jcsj 字段
 *   - 校历接口 xskbcxZccx_cxZcByXnxq.html 只返回周次与日期，不含节次时间
 *   - 页面 41 个 script、菜单中均无作息数据源
 *   仓库内同为正方 V9 的 GZMTU 适配器亦采用写死方式。
 *
 * 【学校调整作息怎么办】直接在拾光 App「课表设置 → 作息时间」里改，
 *   或改这里的常量。14 节覆盖了 1-10 与晚间 11-14 节。
 */
const DEFAULT_TIME_SLOTS = [
    { number: 1,  startTime: '08:30', endTime: '09:10' },
    { number: 2,  startTime: '09:20', endTime: '10:00' },
    { number: 3,  startTime: '10:20', endTime: '11:00' },
    { number: 4,  startTime: '11:10', endTime: '11:50' },
    { number: 5,  startTime: '12:30', endTime: '13:10' },
    { number: 6,  startTime: '13:20', endTime: '14:00' },
    { number: 7,  startTime: '14:30', endTime: '15:10' },
    { number: 8,  startTime: '15:20', endTime: '16:00' },
    { number: 9,  startTime: '16:20', endTime: '17:00' },
    { number: 10, startTime: '17:10', endTime: '17:50' },
    { number: 11, startTime: '19:00', endTime: '19:40' },
    { number: 12, startTime: '19:50', endTime: '20:30' },
    { number: 13, startTime: '20:40', endTime: '21:20' },
    { number: 14, startTime: '21:30', endTime: '22:10' }
];

/**
 * 返回本校作息时间。数据来源见 DEFAULT_TIME_SLOTS 上方注释。
 *
 * @returns {Promise<Array>} TimeSlotJsonModel 数组
 */
async function fetchTimeSlots() {
    return DEFAULT_TIME_SLOTS.map(slot => ({ ...slot }));
}

/* ============================================================
 * 四、桥接调用
 * ============================================================ */

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        '重庆三峡科技大学教务课表导入',
        '导入前请确保您已在当前页面成功登录教务系统。\n\n本脚本只会读取课表数据，不会保存您的账号或密码。',
        '好的，开始导入'
    );
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败：${error.message}`);
        return false;
    }
}

async function saveConfig(config) {
    if (!config || Object.keys(config).length === 0) return;
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        // 配置保存失败不阻断主流程
        window.shiguangBridge.showToast(`课表配置保存失败：${error.message}`);
    }
}

async function savePresetTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast(`时间段保存失败：${error.message}`);
    }
}

/* ============================================================
 * 五、主流程
 * ============================================================ */

async function runImportFlow() {
    // 1. 前置说明
    const confirmed = await promptUserToStart();
    if (!confirmed) {
        window.shiguangBridge.showToast('用户取消了导入。');
        return;
    }

    // 2. 选择学年学期
    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast('未选择学年学期，导入流程终止。');
        return;
    }
    const { academicYear, semesterCode } = selection;

    // 3. 拉取并解析课表
    window.shiguangBridge.showToast('正在获取课表数据…');
    const json = await fetchCourseJson(academicYear, semesterCode);
    if (!json) {
        await window.shiguangBridgePromise.showAlert(
            '获取失败',
            '未能获取课表数据。\n\n请确认：\n1. 已登录教务系统；\n2. 当前学期确实有课表；\n3. 网络可访问教务系统。',
            '知道了'
        );
        return;
    }

    const courses = parseJsonData(json);
    if (courses.length === 0) {
        window.shiguangBridge.showToast('未解析到任何课程，请检查所选学年学期。');
        return;
    }

    // 4. 保存课程
    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    // 5. 保存课表配置（学期开始日期能取到才写，取不到则沿用软件默认）
    const [semesterStartDate, timeSlots] = await Promise.all([
        fetchSemesterStartDate(academicYear, semesterCode),
        fetchTimeSlots()
    ]);

    const maxWeek = courses.reduce((m, c) => Math.max(m, ...c.weeks), 0);

    const config = {};
    if (semesterStartDate) config.semesterStartDate = semesterStartDate;
    if (maxWeek > 0) config.semesterTotalWeeks = Math.max(maxWeek, 20);

    if (Object.keys(config).length > 0) await saveConfig(config);

    // 6. 保存作息时间（使用实测的 DEFAULT_TIME_SLOTS；学校调整作息需更新该常量）
    await savePresetTimeSlots(timeSlots);

    // 7. 完成
    let msg = `导入成功，共 ${courses.length} 条课程安排！`;
    if (!semesterStartDate) msg += '（未获取到开学日期，请在设置中自行确认）';
    else msg += ` 开学日期：${semesterStartDate}`;
    if (timeSlots.length > 0) msg += ` 作息已导入 ${timeSlots.length} 节`;

    window.shiguangBridge.showToast(msg);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
