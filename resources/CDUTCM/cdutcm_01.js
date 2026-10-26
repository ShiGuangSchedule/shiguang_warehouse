// CDUTCM_01.js
// 成都中医药大学教务系统适配脚本
// 系统厂商：广州乘方科技有限公司（CFKJ / entss）
//
// 数据源（两个接口组合）：
// 1. 课程任务列表：/xsgrkbcx!xsAllKbList.action?xnxqdm=YYYYNN
//    字段：kcmc, kcbh, jxbmc, kcrwdm, jcdm2, zcs（数组）, xq, jxcdmcs（备选）, teaxms
//    用途：教师（teaxms）、班分子（jxbmc 中的 [N-M]）、课程编号
//
// 2. 排课详情：/xsgrkbcx!getSkxxDataList.action?kcrwdm=X&teadm=
//    字段：kxh, zc（单值）, xq, jcdm2, kcmc, jxcdmc（精确）, jxbmc, sknrjj
//    用途：精确教室（jxcdmc），按单次具体排课展开
//
// 关联键：(kcmc + xq + jcdm2) 三元组
// 36 条课程任务只对应 13 个不同 kcrwdm，并发 13 次 fetch 即覆盖全部排课详情

// ===== 解析周次字符串为升序 number[] =====
function parseWeeks(zcs) {
    if (!zcs) return [];
    const set = new Set();
    String(zcs).split(',').forEach(part => {
        const n = parseInt(String(part).trim(), 10);
        if (!isNaN(n) && n > 0) set.add(n);
    });
    return Array.from(set).sort((a, b) => a - b);
}

// ===== 解析节次字符串为 number[]（保留 0，用于识别早读）=====
function parsePeriods(jcdm2) {
    if (!jcdm2) return [];
    return String(jcdm2).split(',')
        .map(s => parseInt(String(s).trim(), 10))
        .filter(n => !isNaN(n));
}

// ===== 拆分教学班名称中的 [N-M] 班分子 =====
function splitClassInfo(jxbmc) {
    const text = String(jxbmc || '').trim();
    const m = text.match(/^(.*?)\[(\d+)-(\d+)\]\s*$/);
    if (m) {
        return { base: m[1].trim(), range: `${m[2]}-${m[3]}` };
    }
    return { base: text, range: '' };
}

// ===== 早读默认时段 =====
const MORNING_READING_START = '08:00';
const MORNING_READING_END = '08:20';

// ===== 时间模板（节次时间表，CDUTCM 教务不直接暴露）=====
// 推导规则：每节 40 分钟，节间 10 分钟
//   00 早读：08:00-08:20
//   01-05 上午：08:30 起
//   06-09 下午：14:00 起
//   10-12 晚上：18:30 起
const TIME_SLOTS = [
    { number: 0,  startTime: '08:00', endTime: '08:20' },
    { number: 1,  startTime: '08:30', endTime: '09:10' },
    { number: 2,  startTime: '09:20', endTime: '10:00' },
    { number: 3,  startTime: '10:10', endTime: '10:50' },
    { number: 4,  startTime: '11:00', endTime: '11:40' },
    { number: 5,  startTime: '11:50', endTime: '12:30' },
    { number: 6,  startTime: '14:00', endTime: '14:40' },
    { number: 7,  startTime: '14:50', endTime: '15:30' },
    { number: 8,  startTime: '15:40', endTime: '16:20' },
    { number: 9,  startTime: '16:30', endTime: '17:10' },
    { number: 10, startTime: '18:30', endTime: '19:10' },
    { number: 11, startTime: '19:20', endTime: '20:00' },
    { number: 12, startTime: '20:10', endTime: '20:50' }
];

// ===== 学期配置 =====
const SEMESTER_DEFAULT_START_DATE = '2026-08-31';
const SEMESTER_TOTAL_WEEKS = 22;
const DEFAULT_CLASS_DURATION = 40;
const DEFAULT_BREAK_DURATION = 10;
const FIRST_DAY_OF_WEEK = 1;

function isValidDateString(s) {
    if (!s) return false;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(s);
    if (isNaN(date.getTime())) return false;
    return date.getFullYear() === year
        && date.getMonth() + 1 === month
        && date.getDate() === day;
}

async function promptSemesterStartDate() {
    while (true) {
        const input = await window.shiguangBridgePromise.showPrompt(
            '学期开始日期',
            '请输入本学期第一周周一的日期（YYYY-MM-DD）',
            SEMESTER_DEFAULT_START_DATE,
            null
        );
        if (input === null) return null;
        if (isValidDateString(input)) return input;
        await window.shiguangBridgePromise.showAlert(
            '日期格式错误',
            `请输入 YYYY-MM-DD 格式，例如 ${SEMESTER_DEFAULT_START_DATE}`,
            '重试'
        );
    }
}

// ===== HTTP 工具 =====
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
        clearTimeout(timeoutId);
    }
}

const COMMON_HEADERS = {
    'Referer': 'https://jwweb.cdutcm.edu.cn/xsgrkbcx!xsgrkbMain.action',
    'X-Requested-With': 'XMLHttpRequest'
};

// ===== 抓取课程任务列表（含教师、班分子、周次数组）=====
async function fetchKbTaskList(xnxqdm) {
    const url = `/xsgrkbcx!xsAllKbList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`;
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        credentials: 'include',
        headers: COMMON_HEADERS
    });
    if (!response.ok) throw new Error(`课程任务列表请求失败（HTTP ${response.status}）`);
    const text = await response.text();
    return extractKbxx(text);
}

// ===== 抓取学期下拉框（用于让用户选学期）=====
async function fetchXsgrkbListPage() {
    const currentYear = new Date().getFullYear();
    const candidateXnxqdm = [`${currentYear}01`, `${currentYear - 1}01`];
    let lastError = null;
    for (const xnxqdm of candidateXnxqdm) {
        try {
            const response = await fetchWithTimeout(
                `/xsgrkbcx!getXsgrbkList.action?xnxqdm=${encodeURIComponent(xnxqdm)}`,
                { method: 'GET', credentials: 'include', headers: COMMON_HEADERS }
            );
            if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
            const text = await response.text();
            if (extractSemesterOptions(text)) return text;
        } catch (e) {
            lastError = e.message || String(e);
        }
    }
    throw new Error(
        `无法获取学期下拉框（${lastError || '无可用学期码'}）。` +
        `请先在浏览器里手动打开「信息查询 → 学生个人课表查询 → 我的课表」后再运行脚本。`
    );
}

// ===== 抓取单个教学任务的精确排课（并发调用）=====
async function fetchSkxx(kcrwdm) {
    const url = `/xsgrkbcx!getSkxxDataList.action?kcrwdm=${encodeURIComponent(kcrwdm)}&teadm=`;
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        credentials: 'include',
        headers: COMMON_HEADERS
    });
    if (!response.ok) throw new Error(`getSkxxDataList 失败（HTTP ${response.status}）`);
    const json = await response.json();
    return json.rows || [];
}

// ===== 并发抓取所有 kcrwdm 的精确排课 =====
async function fetchAllSkxx(kcrwdms) {
    const results = await Promise.allSettled(kcrwdms.map(k => fetchSkxx(k)));
    const allRows = [];
    const failed = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            allRows.push(...r.value);
        } else {
            failed.push(kcrwdms[i]);
        }
    });
    return { rows: allRows, failed };
}

// ===== HTML/JSON 解析 =====
function extractSemesterOptions(htmlText) {
    const selectMatch = htmlText.match(/<select[^>]*id=['"]xnxqdm['"][^>]*>([\s\S]*?)<\/select>/i);
    if (!selectMatch) return null;
    const options = [];
    const optionRe = /<option[^>]*value=['"]([^'"]+)['"]([^>]*)>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = optionRe.exec(selectMatch[1])) !== null) {
        const value = (m[1] || '').trim();
        const attrs = m[2] || '';
        const label = (m[3] || '').replace(/<[^>]+>/g, '').trim();
        if (!value || !label) continue;
        const selected = /selected/i.test(attrs);
        options.push({ value, label, selected });
    }
    if (options.length === 0) return null;
    return options;
}

function extractKbxx(htmlText) {
    const match = htmlText.match(/(?:var\s+)?kbxx\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match || !match[1]) return null;
    try { return JSON.parse(match[1]); }
    catch (e) { console.warn('CDUTCM: kbxx JSON.parse failed', e); return null; }
}

// ===== 把 skxx rows + kbxx 任务合并成最终课程列表 =====
// 关联键：kcmc + xq + jcdm2
function mergeToCourses(skxxRows, kbxxTasks) {
    // 把 kbxx 按 (kcmc, xq, jcdm2) 索引，便于查找教师/班分子
    const kbxxIndex = new Map();
    kbxxTasks.forEach(t => {
        const key = `${t.kcmc}__${t.xq}__${t.jcdm2}`;
        if (!kbxxIndex.has(key)) kbxxIndex.set(key, t);
    });

    const courses = [];
    const seen = new Set();

    skxxRows.forEach(row => {
        const day = parseInt(String(row.xq || '').trim(), 10);
        if (isNaN(day) || day < 1 || day > 7) return;

        const name = String(row.kcmc || '').trim();
        if (!name) return;

        const periods = parsePeriods(row.jcdm2);
        if (periods.length === 0) return;

        const zc = parseInt(String(row.zc || '').trim(), 10);
        if (isNaN(zc) || zc < 1) return;

        // 关联到 kbxx 任务（拿教师、班分子）
        const key = `${name}__${row.xq}__${row.jcdm2}`;
        const task = kbxxIndex.get(key);
        const teacher = task ? String(task.teaxms || '').trim() : '';
        const classInfo = task ? splitClassInfo(task.jxbmc) : { base: '', range: '' };

        const noteParts = [];
        if (classInfo.base) noteParts.push(classInfo.base);
        if (classInfo.range) noteParts.push(`班分子 ${classInfo.range}`);
        if (row.sknrjj) noteParts.push(String(row.sknrjj).trim());
        const note = noteParts.join(' · ');

        // 精确教室（jxcdmc）作为 position
        // 空教室时（如某些实习课）兜底为「不用场地」
        const position = String(row.jxcdmc || '').trim() || '不用场地';

        const baseFields = {
            name,
            teacher,
            position,
            day,
            weeks: [zc],
            description: note,
            note,
            location: position,
            dayOfWeek: day,
            startWeek: zc,
            endWeek: zc
        };

        // 去重 key（含 jxcdmc，避免同课同节次同周不同教室被去重）
        const dedupKey = `${name}__${teacher}__${position}__${day}__${row.jcdm2}__${zc}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);

        // 早读分支
        if (periods.length === 1 && periods[0] === 0) {
            courses.push(Object.assign({}, baseFields, {
                isCustomTime: true,
                customStartTime: MORNING_READING_START,
                customEndTime: MORNING_READING_END
            }));
            return;
        }

        // 普通节次
        const startSection = Math.min(...periods);
        const endSection = Math.max(...periods);
        if (startSection > endSection) return;
        courses.push(Object.assign({}, baseFields, {
            startSection,
            endSection,
            courseNature: undefined
        }));
    });

    return courses.sort((a, b) =>
        a.day - b.day ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0) ||
        a.name.localeCompare(b.name)
    );
}

// ===== 主流程 =====
async function runImportFlow() {
    try {
        shiguangBridge.showToast('开始读取课表入口...');

        const listHtml = await fetchXsgrkbListPage();
        const semesters = extractSemesterOptions(listHtml);
        if (!semesters) throw new Error('未找到学期下拉框');

        const defaultIndex = Math.max(0, semesters.findIndex(s => s.selected));
        const labels = semesters.map(s => s.label);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            '选择学期',
            JSON.stringify(labels),
            defaultIndex
        );
        if (selectedIndex === null || selectedIndex < 0) {
            shiguangBridge.showToast('已取消导入');
            return;
        }

        const xnxqdm = semesters[selectedIndex].value;
        shiguangBridge.showToast(`正在获取 ${semesters[selectedIndex].label} 课表与精确教室...`);

        // 1. 抓取课程任务列表（含教师、班分子）
        const kbxxTasks = await fetchKbTaskList(xnxqdm);
        if (!kbxxTasks || kbxxTasks.length === 0) {
            throw new Error('该学期未解析到课程任务，请确认登录状态和所选学期');
        }

        // 2. 提取所有不同 kcrwdm，并发抓精确教室
        const kcrwdms = Array.from(new Set(kbxxTasks.map(t => String(t.kcrwdm || '').trim()).filter(Boolean)));
        if (kcrwdms.length === 0) {
            throw new Error('未找到 kcrwdm 字段');
        }
        const { rows: skxxRows, failed: failedKcrwdms } = await fetchAllSkxx(kcrwdms);
        if (skxxRows.length === 0) {
            throw new Error('未获取到精确教室数据，请确认登录状态');
        }

        // 3. 合并生成最终课程列表
        const courses = mergeToCourses(skxxRows, kbxxTasks);
        if (courses.length === 0) {
            throw new Error('未能转换为有效课程');
        }

        // 4. 保存
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));

        const semesterStartDate = await promptSemesterStartDate();
        if (!semesterStartDate) {
            shiguangBridge.showToast('已取消（未提供学期开始日期）');
            return;
        }
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate,
            semesterTotalWeeks: SEMESTER_TOTAL_WEEKS,
            defaultClassDuration: DEFAULT_CLASS_DURATION,
            defaultBreakDuration: DEFAULT_BREAK_DURATION,
            firstDayOfWeek: FIRST_DAY_OF_WEEK
        }));

        let msg = `Skxx 共 ${skxxRows.length} 条（精确教室），生成 ${courses.length} 门课程`;
        if (failedKcrwdms.length > 0) {
            msg += `（${failedKcrwdms.length} 个教学任务未拿到精确教室：${failedKcrwdms.join(', ')}）`;
        }
        shiguangBridge.showToast(msg);
        shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error('CDUTCM import failed:', error);
        await window.shiguangBridgePromise.showAlert(
            '导入失败',
            error && error.message ? error.message : String(error),
            '确定'
        );
    }
}

runImportFlow();