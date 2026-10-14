// 广州理工学院 (gzist.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统 (jwglxt) 接口适配，双入口：校园网直连 + WebVPN
//
// 本脚本派生自上游适配仓库江苏电子信息职业学院适配 (resources/JSEI/jsei_01.js, MIT)，
// 保留了其正方解析逻辑与"节次合并去重"工具函数，仅替换学校域名与回退策略。
//
// 学校信息（侦查结论见 docs/reference-adapters/GZIST-recon.md）：
//   - 教务版本：正方新版 jwglxt（ZFTAL UI v5，响应头 ZFSOFT-SERVER）
//   - 校内入口：http://jw.gzist.edu.cn/jwglxt 与 https://... 均可（门户/官方链接用 http，
//             DNS 解析到内网 10.0.22.231，仅校园网内可达；未登录访问 index_initMenu 会跳回登录页）
//   - 融合门户：https://portal.gzist.edu.cn/#/index4 里的「正方教务系统」图块即指向教务首页
//   - 统一身份认证：正方登录页含「统一身份认证」入口，实际跳到 ids.gzist.edu.cn/lyuapServer
//   - 校外入口：https://webvpn.gzist.edu.cn/https/jw.gzist.edu.cn/jwglxt
//               （Array Networks 路径式改写，已实测有效；-443 主机式不适用）
//   - 登录：脚本不负责登录，用户手动登录后点击开始导入
//            （页面提供教务账号密码与「统一身份认证」两种方式；验证码未启用）
//
// 开发中，非本校开发者适配，若解析有误请提交 issue / PR

/**
 * 基础域名配置
 * ⚠️ 不要硬编码协议：本校门户/官方链接用的是 http://，而 http 页面去 fetch https 属于跨源，
 * 会被 CORS 拦掉。因此 base URL 一律「跟随当前页面的 origin 与路径」推导，保证同源。
 */
const CAMPUS_HOST = "jw.gzist.edu.cn";
const CAMPUS_ENTRY_PATH = "/jwglxt";

/**
 * 推导教务系统 base URL（同源优先）
 * - 校园网直连：http://jw.gzist.edu.cn/jwglxt 或 https://... 均可用，跟随当前页面协议
 * - WebVPN（Array Networks 路径式改写）：
 *   https://webvpn.gzist.edu.cn/https/jw.gzist.edu.cn/jwglxt
 */
function getBaseUrl() {
    const { origin, pathname, hostname } = window.location;

    // WebVPN 路径式改写：从当前路径里截出 /https/jw.gzist.edu.cn/jwglxt
    if (hostname.includes("webvpn")) {
        const matched = pathname.match(/\/https\/jw\.gzist\.edu\.cn\/jwglxt/);
        return origin + (matched ? matched[0] : "/https/jw.gzist.edu.cn/jwglxt");
    }

    // 校园网直连：从当前路径里截出 /jwglxt，协议与主机完全跟随当前页面
    const idx = pathname.indexOf(CAMPUS_ENTRY_PATH);
    if (idx >= 0) {
        return origin + pathname.slice(0, idx + CAMPUS_ENTRY_PATH.length);
    }

    // 兜底：不在教务路径下（例如误在融合门户页运行）。
    // 注意：此处**只能**用绝对地址 —— 因为当前页面不是教务域名，无法推导出教务的协议，
    // 用当前 origin 会拼成错误的 base（如 portal.gzist.edu.cn/jwglxt）。
    // 正常路径（教务页 / WebVPN 页）永远不会走到这里。
    return "https://" + CAMPUS_HOST + CAMPUS_ENTRY_PATH;
}

/**
 * 节次与周次合并去重函数
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

/**
 * 解析周次字符串，处理单双周和周次范围
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const cleaned = weekStr
        .replace(/周数[:：]/g, '')
        .replace(/第/g, '')
        .replace(/周/g, '')
        .replace(/共\s*\d+\s*.*$/g, '');

    const segments = cleaned.split(/[,，、;；]/);

    const weeks = [];
    const segRegex = /(\d+)(?:\s*[-~]\s*(\d+))?\s*(?:[（(]?\s*([单双])\s*周?\s*[)）]?)?/g;

    for (const seg of segments) {
        const s = seg.trim();
        if (!s) continue;

        segRegex.lastIndex = 0;
        let m;
        while ((m = segRegex.exec(s)) !== null) {
            if (m[0] === '') {
                segRegex.lastIndex++;
                continue;
            }

            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : start;
            const flagStr = m[3] || '';

            let flag = 0;
            if (flagStr.includes('单')) flag = 1;
            else if (flagStr.includes('双')) flag = 2;

            for (let w = start; w <= end; w++) {
                if (flag === 1 && w % 2 === 0) continue;
                if (flag === 2 && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据
 */
function parseJsonData(jsonData) {
    // 容器降级：kbList 之外再认 items / rows / data / list
    const rawCourseList = pickCourseList(jsonData);
    if (!rawCourseList) {
        return [];
    }

    const initialCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 契约允许 teacher/position 为空串（上游文档：「无则传 ""」），故这两项用 pickAllowEmpty；
        // 其余项为必填，空值仍当作脏数据丢弃（降级不放宽校验）。
        const nameRaw = pick(rawCourse, ['kcmc', 'courseName', 'kcmc_mc']);
        const teacherRaw = pickAllowEmpty(rawCourse, ['xm', 'teacherName', 'jsxm']);
        const positionRaw = pickAllowEmpty(rawCourse, ['cdmc', 'classroomName', 'jsmc', 'cdmc_mc']);
        const dayRaw = pick(rawCourse, ['xqj', 'xq', 'weekDay']);
        const sectionRaw = pick(rawCourse, ['jcs', 'jc', 'section']);
        const weekRaw = pick(rawCourse, ['zcd', 'zcmc', 'weeks']);

        if (nameRaw === undefined || dayRaw === undefined ||
            sectionRaw === undefined || weekRaw === undefined) {
            continue;
        }

        const weeksArray = parseWeeks(String(weekRaw));
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionParts = String(sectionRaw).split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);
        const day = Number(dayRaw);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        initialCourseList.push({
            name: String(nameRaw).trim(),
            teacher: String(teacherRaw === undefined ? '' : teacherRaw).trim(),
            position: String(positionRaw === undefined ? '' : positionRaw).trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    return mergeAndDistinctCourses(initialCourseList);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "广州理工学院课表导入",
        "导入前请确保您已成功登录教务系统（校内直连或 WebVPN 均可）。",
        "好的，开始导入"
    );
}

/**
 * 从教务系统获取学年学期选项
 * 学年：以选中项为中心，取前2年+后2年，共5个选项
 */
/**
 * 从选项页里提取学年/学期选项，三级降级：
 *   ① #xnm / #xqm  ② 扫描全部 <select> 按选项形态识别  ③ 正则扫描原始 HTML
 * 抽成独立函数并接收 doc 参数：便于单测免依赖（Node 无 DOMParser）
 */
function extractAcademicOptions(doc, htmlText) {
    const toOptions = (nodes) => Array.from(nodes)
        .filter(opt => opt.value !== "")
        .map(opt => ({
            value: opt.value,
            text: (opt.textContent || '').trim(),
            selected: !!opt.selected
        }));

    let yearOptions = [];
    let semesterOptions = [];
    let strategy = 'id';

    try {
        yearOptions = toOptions(doc.querySelectorAll("#xnm option"));
        semesterOptions = toOptions(doc.querySelectorAll("#xqm option"));
    } catch (e) {
        console.warn('[GZIST] 按 id 读取选项失败，转降级策略：' + e.message);
    }

    // 策略 2：id 失效 → 扫描全部 <select>，按选项形态识别
    if (yearOptions.length === 0 || semesterOptions.length === 0) {
        try {
            const grouped = classifyOptionGroups(
                Array.from(doc.querySelectorAll('select')).map(optionGroupFromSelect)
            );
            if (grouped.year.length > 0 && grouped.semester.length > 0) {
                yearOptions = grouped.year;
                semesterOptions = grouped.semester;
                strategy = 'select 启发式';
            }
        } catch (e) {
            console.warn('[GZIST] select 启发式失败，转正则扫描：' + e.message);
        }
    }

    // 策略 3：DOM 也拿不到 → 正则扫描原始 HTML
    if (yearOptions.length === 0 || semesterOptions.length === 0) {
        const grouped = classifyOptionGroups(optionGroupsFromHtml(htmlText));
        if (grouped.year.length > 0 && grouped.semester.length > 0) {
            yearOptions = grouped.year;
            semesterOptions = grouped.semester;
            strategy = '正则扫描';
        }
    }

    const error = (yearOptions.length === 0 || semesterOptions.length === 0)
        ? `三种策略均未能解析出学年/学期选项（id → select 启发式 → 正则扫描）；响应前 120 字：${htmlText.substring(0, 120)}`
        : null;

    return { yearOptions, semesterOptions, strategy, error };
}

async function fetchAcademicOptions() {
    const url = `${getBaseUrl()}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) {
            auxDiagnostics.options = { code: 'E3', why: `HTTP ${response.status}（学年学期列表接口）` };
            return null;
        }

        const { text: htmlText, encoding } = await readTextSmart(response);

        // 会话失效时正方会返回 200 + 登录页，必须先识别，否则会被误判为“解析失败”
        const loginCheck = detectLoginPage(response, htmlText);
        if (loginCheck.isLogin) {
            auxDiagnostics.options = { code: 'E1', why: loginCheck.why };
            return null;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        const extracted = extractAcademicOptions(doc, htmlText);
        const allYearOptions = extracted.yearOptions;
        const semesterOptions = extracted.semesterOptions;

        if (allYearOptions.length === 0 || semesterOptions.length === 0) {
            auxDiagnostics.options = { code: 'E4', why: extracted.error };
            return null;
        }

        if (extracted.strategy !== 'id') {
            console.warn(`[GZIST] #xnm/#xqm 未命中，已用「${extracted.strategy}」识别选项（${allYearOptions.length} 个学年 / ${semesterOptions.length} 个学期）`);
        }

        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);

        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex: semesterOptions.findIndex(opt => opt.selected) !== -1
                    ? semesterOptions.findIndex(opt => opt.selected)
                    : 0
            };
        }

        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);
        const yearOptions = allYearOptions.slice(start, end);
        const newDefaultIndex = selectedIndex - start;
        const defaultSemesterIndex = semesterOptions.findIndex(opt => opt.selected);

        return {
            yearOptions,
            semesterOptions,
            defaultYearIndex: newDefaultIndex,
            defaultSemesterIndex: defaultSemesterIndex !== -1 ? defaultSemesterIndex : 0
        };

    } catch (e) {
        auxDiagnostics.options = { code: 'E2', why: `请求异常：${errText(e)}` };
        return null;
    }
}

/**
 * 提示用户选择学年和学期
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        const d = auxDiagnostics.options || { code: 'E6', why: '' };
        await reportImportError(d.code, ['获取学年学期列表失败', d.why]);
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearTexts = yearOptions.map(item => item.text);
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearTexts),
        defaultYearIndex
    );

    if (yearIndex === null || yearIndex === -1) return null;
    const selectedYearCode = yearOptions[yearIndex].value;

    const semesterTexts = semesterOptions.map(item => item.text);
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterTexts),
        defaultSemesterIndex
    );

    if (semesterIndex === null || semesterIndex === -1) return null;
    const selectedSemesterCode = semesterOptions[semesterIndex].value;

    return {
        academicYear: selectedYearCode,
        semesterCode: selectedSemesterCode
    };
}

/**
 * 获取学期开学日期
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = `${getBaseUrl()}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`;
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (response.ok) {
            const { text: rawText } = await readTextSmart(response);

            // 会话失效优先判定：否则 200 + 登录页会走到 JSON.parse 而被误归为“格式异常”
            const loginCheck = detectLoginPage(response, rawText);
            if (loginCheck.isLogin) {
                auxDiagnostics.startDate = { code: 'E1', why: loginCheck.why };
                return null;
            }

            let json = null;
            try {
                json = JSON.parse(rawText);
            } catch (parseErr) {
                auxDiagnostics.startDate = { code: 'E4', why: `开学日期接口返回非 JSON（前 120 字）：${String(rawText).substring(0, 120)}` };
                return null;
            }

            if (Array.isArray(json) && json.length > 0) {
                // 优先找第1周，否则取第一项
                const firstWeekObj = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];

                if (firstWeekObj.rq) {
                    const startDateStr = firstWeekObj.rq.split('/')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
                        return startDateStr;
                    }
                }
                if (firstWeekObj.zcrq) {
                    const match = firstWeekObj.zcrq.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match) return match[1];
                }
                // 某些系统用 ksrq 字段
                if (firstWeekObj.ksrq) {
                    const match = firstWeekObj.ksrq.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match) return match[1];
                }
            }
            // 能拿到响应但解析不出日期：不静默
            auxDiagnostics.startDate = { code: 'E4', why: '开学日期接口返回内容中未找到可识别的日期字段（rq / zcrq / ksrq）' };
        } else {
            auxDiagnostics.startDate = { code: 'E3', why: `HTTP ${response.status}（开学日期接口）` };
        }
    } catch (e) {
        // 获取失败不影响主流程
    }
    return null;
}

/**
 * 时间校验：允许单位数小时（正方常返回 "9:15"），但必须落在真实范围内
 * （旧版仅用 /^\d{1,2}:\d{2}$/，会把 "25:99" 这类非法值放行 → 已据单测修正）
 */
const TIME_RE = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;

/* ==========================================================================
 * 错误分级（E1–E7）与诊断信息上报
 *
 * 目的：把「导入失败」拆成可定位的原因，而不是一句笼统提示。
 *   E1 登录失效/会话过期   E2 网络不可达/跨源   E3 服务端错误   E4 数据格式异常
 *   E5 数据为空           E6 辅助数据失败      E7 应用拒绝导入
 * ========================================================================== */
const IMPORT_ERRORS = {
    E1: { title: '登录状态已失效', hint: '请在页面内重新登录教务系统，然后再点一次「开始导入」。' },
    E2: { title: '无法连接教务系统', hint: '请确认处于校园网内，或已通过 WebVPN 访问。' },
    E3: { title: '教务接口返回异常', hint: '服务端可能繁忙或正在维护，请稍后重试。' },
    E4: { title: '教务数据格式异常', hint: '学校教务可能已改版，请把诊断信息反馈给适配维护者。' },
    E5: { title: '该学年学期没有课程', hint: '请确认选择的学年 / 学期是否正确。' },
    E6: { title: '辅助数据获取失败', hint: '课表仍会导入，但开学日期或作息可能使用默认值。' },
    E7: { title: '导入被应用拒绝', hint: '可能是导入顺序或应用状态异常，请重试。' },
    E8: { title: '未预期异常', hint: '这是脚本未预料到的错误，请把下方诊断信息反馈给适配维护者。' }
};

/** 记录各辅助接口最近一次失败原因，供最后统一汇报（避免静默失败） */
const auxDiagnostics = { options: null, startDate: null, timeSlots: null };

/** 把任意异常/拒绝值转成可读文本（桥接层可能以**字符串** reject，此时 e.message 是 undefined） */
function errText(e) {
    if (e === null || e === undefined) return '未知错误';
    if (typeof e === 'string') return e;
    if (typeof e === 'object' && e.message) return String(e.message);
    try {
        return JSON.stringify(e);
    } catch (_) {
        return String(e);
    }
}

/**
 * 判断响应是否其实是「未登录 / 会话已过期」。
 * 正方在会话失效时通常返回 HTTP 200 + 登录页 HTML，所以不能只看 response.ok，
 * 必须靠「最终重定向地址 + 登录表单特征」判断。
 *
 * ⚠️ 判据只认「登录表单本身」：**不得单凭 id="csrftoken" 判定** —— 正方很多正常页面
 * （包括已登录时的内容页）也带该隐藏域，单独用它会把已登录用户误判为“登录失效”而中断导入。
 */
function detectLoginPage(response, bodyText) {
    const finalUrl = response && response.url ? String(response.url) : '';
    if (/login_slogin|xtgl\/login/i.test(finalUrl)) {
        return { isLogin: true, why: '请求被重定向到登录页：' + finalUrl };
    }
    if (typeof bodyText === 'string' && bodyText.length > 0) {
        const hasLoginFormAction = /login_slogin\.html/i.test(bodyText);
        const hasUserField = /name=["']yhm["']/i.test(bodyText);
        const hasPassField = /name=["']mm["']/i.test(bodyText);
        if (hasLoginFormAction || (hasUserField && hasPassField)) {
            return {
                isLogin: true,
                why: hasLoginFormAction
                    ? '响应体含登录表单（login_slogin.html）'
                    : '响应体含登录页账号/密码输入框（yhm / mm）'
            };
        }
    }
    return { isLogin: false, why: '' };
}

/**
 * 把一次失败的请求归入错误码：
 * 登录页 → E1；HTTP 非 2xx → E3；其余交给调用方指定的兜底码。
 */
function classifyFetchFailure(response, bodyText, fallbackCode) {
    const login = detectLoginPage(response, bodyText);
    if (login.isLogin) return { code: 'E1', why: login.why };
    if (response && response.ok === false) return { code: 'E3', why: `HTTP ${response.status}` };
    return { code: fallbackCode || 'E4', why: '' };
}

/**
 * 致命错误上报：优先用 showAlert（可承载多行诊断信息），失败时退化为 showToast。
 * 无论哪条路径都**不会静默**。
 */
async function reportImportError(code, lines) {
    const e = IMPORT_ERRORS[code] || IMPORT_ERRORS.E4;
    const detail = (lines || []).filter(Boolean);
    const body = `${e.hint}\n\n— 诊断信息（反馈时请附上）—\n` +
        (detail.length > 0 ? detail.map(l => `· ${l}`).join('\n') : '·（无）');
    try {
        await window.shiguangBridgePromise.showAlert(`导入失败【${code}】${e.title}`, body, '知道了');
    } catch (err) {
        window.shiguangBridge.showToast(`导入失败【${code}】${e.title}`);
    }
}

/** 非致命问题提示（例如作息/开学日期取不到，但仍可导入课表） */
function noticeAux(code, what) {
    const e = IMPORT_ERRORS[code] || IMPORT_ERRORS.E6;
    window.shiguangBridge.showToast(`${what}获取失败【${code}】${e.title}，已使用默认值。`);
}

/* ==========================================================================
 * 兼容层（P2）：编码兜底 + 结构降级
 * ========================================================================== */

/**
 * 读取响应正文并做编码兜底。
 *
 * 背景：正方分省部署存在 GBK 页面；若服务端未在 Content-Type 里声明 charset，
 * 浏览器会默认按 UTF-8 解码 → 中文乱码 → 后续 JSON.parse / 正则全部失败。
 * 策略：① Content-Type 声明的 charset 优先 → ② 严格 UTF-8（拒绝替换符）→ ③ 按 GBK 重解码。
 */
async function readTextSmart(response) {
    let buf = null;
    try {
        buf = await response.arrayBuffer();
    } catch (e) {
        // 环境不支持 arrayBuffer 时退回普通 text()
        return { text: await response.text(), encoding: 'text()' };
    }

    const ct = response.headers && typeof response.headers.get === 'function'
        ? (response.headers.get('content-type') || '')
        : '';
    const declared = /charset=["']?([\w-]+)/i.exec(ct);

    const decodeWith = (label, fatal) => {
        try {
            return new TextDecoder(label, { fatal: !!fatal }).decode(buf);
        } catch (e) {
            return null;
        }
    };

    if (declared) {
        const label = declared[1].trim().toLowerCase();
        const t = decodeWith(label, false);
        if (t !== null) return { text: t, encoding: label };
    }

    // 未声明 charset：先严格 UTF-8（出现 U+FFFD 即为误码）
    const strictUtf8 = decodeWith('utf-8', true);
    if (strictUtf8 !== null && strictUtf8.indexOf('\uFFFD') === -1) {
        return { text: strictUtf8, encoding: 'utf-8(推断)' };
    }

    // 再按 GBK 解一次（Chromium 支持 legacy 编码；不支持时抛错→返回 null）
    const gbk = decodeWith('gbk', false);
    if (gbk !== null && gbk.indexOf('\uFFFD') === -1) {
        console.warn('[GZIST] 响应未声明编码且非 UTF-8，已按 GBK 解码');
        return { text: gbk, encoding: 'gbk(推断)' };
    }

    return { text: strictUtf8 !== null ? strictUtf8 : (gbk || ''), encoding: '未知' };
}

/** 多字段名取值（结构降级用）：返回第一个非空值 */
function pick(obj, names) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const n of names) {
        const v = obj[n];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
}

/**
 * 与 pick 相同，但接受空串。
 * 用于契约上「无则传 ""」的字段（teacher / position）—— 否则线上课、无固定教室的课会被整条丢弃。
 */
function pickAllowEmpty(obj, names) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const n of names) {
        if (obj[n] !== undefined && obj[n] !== null) return obj[n];
    }
    return undefined;
}

/** 课程列表容器降级：kbList 之外再认几种常见容器名 */
const COURSE_LIST_KEYS = ['kbList', 'items', 'rows', 'data', 'list'];
function pickCourseList(jsonData) {
    if (!jsonData || typeof jsonData !== 'object') return null;
    for (const k of COURSE_LIST_KEYS) {
        if (Array.isArray(jsonData[k])) return jsonData[k];
    }
    return null;
}

/** 从 <select> 元素提取选项组（DOM 路径） */
function optionGroupFromSelect(sel) {
    const opts = Array.from(sel.querySelectorAll('option'))
        .filter(o => o.value !== '')
        .map(o => ({ value: o.value, text: (o.textContent || '').trim(), selected: !!o.selected }));
    return { id: sel.id || sel.getAttribute('name') || '', opts };
}

/** 正则从原始 HTML 提取 <select> 选项组（DOM 策略失效时的降级） */
function optionGroupsFromHtml(html) {
    const groups = [];
    const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    let sm;
    while ((sm = selectRe.exec(html)) !== null) {
        const attrs = sm[1] || '';
        const body = sm[2] || '';
        const idMatch = /(?:id|name)=["']([^"']+)["']/i.exec(attrs);
        const opts = [];
        const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
        let om;
        while ((om = optRe.exec(body)) !== null) {
            const oAttrs = om[1] || '';
            const valueMatch = /value=["']([^"']*)["']/i.exec(oAttrs);
            const value = valueMatch ? valueMatch[1] : '';
            if (value === '') continue;
            opts.push({
                value,
                text: String(om[2] || '').replace(/<[^>]*>/g, '').trim(),
                selected: /\bselected\b/i.test(oAttrs)
            });
        }
        groups.push({ id: idMatch ? idMatch[1] : '', opts });
    }
    return groups;
}

/**
 * 选项组识别（降级用）：不依赖 #xnm / #xqm 这两个 id，
 * 而是按「值形如 4 位年份 / 文本含学年区间」判学年，按「文本含学期」判学期。
 */
function classifyOptionGroups(groups) {
    let year = [];
    let semester = [];
    for (const g of groups) {
        if (!g || !Array.isArray(g.opts) || g.opts.length < 2) continue;
        const yearLike = g.opts.filter(o => /^\d{4}$/.test(String(o.value).trim()) || /\d{4}\s*[-~—～]\s*\d{4}/.test(o.text)).length;
        const termLike = g.opts.some(o => /学期/.test(o.text));
        if (year.length === 0 && yearLike >= 2) { year = g.opts; continue; }
        if (semester.length === 0 && termLike) { semester = g.opts; continue; }
    }
    return { year, semester };
}

/**
 * 将任意来源的节次条目归一化为 {number, startTime, endTime}
 * 不同正方版本字段名不一致，这里做多名称兼容
 */
function normalizeTimeSlotItem(item) {
    if (!item || typeof item !== 'object') return null;

    const num = Number(item.jcmc ?? item.jc ?? item.jcs ?? item.number);
    const pad = t => (t.length === 4 ? '0' + t : t);
    let start = String(item.qssj ?? item.kssj ?? item.startTime ?? item.sj ?? '').trim();
    let end = String(item.jssj ?? item.endTime ?? item.kjsj ?? '').trim();

    start = pad(start.substring(0, 5));
    end = pad(end.substring(0, 5));

    if (!Number.isFinite(num) || num < 1) return null;
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
    if (start >= end) return null;   // 起止倒置/相等视为无效

    return { number: num, startTime: start, endTime: end };
}

/**
 * 从一组节次条目构建作息表（要求至少 3 节，否则视为无效数据）
 */
function buildTimeSlotsFrom(list) {
    if (!Array.isArray(list) || list.length === 0) return null;

    const seen = new Set();
    const slots = [];
    for (const raw of list) {
        const s = normalizeTimeSlotItem(raw);
        if (s && !seen.has(s.number)) {
            seen.add(s.number);
            slots.push(s);
        }
    }
    slots.sort((a, b) => a.number - b.number);

    if (slots.length < 3) return null;

    // 与 App 侧 validateTimeSlotsOrThrow（CourseConversionRepository.kt:63）对齐：
    // 编号必须从 1 连续、时间段不得重叠。否则应用会拒绝整份作息，而此时课程已写入，
    // 会出现「课程导入成功、作息导入失败」的割裂状态 —— 宁可提前判无效并回退内置保底作息。
    const toMinutes = (t) => {
        const parts = t.split(':');
        return Number(parts[0]) * 60 + Number(parts[1]);
    };
    for (let i = 0; i < slots.length; i++) {
        if (slots[i].number !== i + 1) {
            console.warn(`[GZIST] 作息节次编号不连续（第 ${i + 1} 项为 ${slots[i].number}），改用内置保底作息`);
            return null;
        }
        if (i > 0 && toMinutes(slots[i].startTime) < toMinutes(slots[i - 1].endTime)) {
            console.warn(`[GZIST] 作息时间存在重叠（第 ${slots[i].number} 节），改用内置保底作息`);
            return null;
        }
    }

    return slots;
}

/**
 * 兜底 1：部分正方版本会把节次时间放在课表接口响应的 sjkList / sjList 里
 */
function parseTimeSlotsFromCourseJson(jsonData) {
    if (!jsonData || typeof jsonData !== 'object') return null;
    return buildTimeSlotsFrom(jsonData.sjkList || jsonData.sjList || jsonData.timeList);
}

/**
 * 【已移除】DOM 文本解析（原 parseTimeSlotsFromDom）
 *
 * 按上游维护者建议删除：存在课表的页面有很多，而只有「学期课表（按周次）」才展示节次时间，
 * 普通学期课表与班级课表都不展示 —— DOM 解析能覆盖的场景太少。
 * 现在拿不到节次时间时，直接使用脚本内置保底作息（见下方 FALLBACK_TIME_SLOTS）。
 */

/**
 * 从教务系统获取作息时间表（节次时间）
 * @param {string} academicYear 学年
 * @param {string} semesterCode 学期代码
 * @returns {Promise<Array<{number: number, startTime: string, endTime: string}>>}
 */
async function fetchTimeSlots(academicYear, semesterCode) {
    const url = `${getBaseUrl()}/jzgl/skxxMobile_cxRsdjc.html?gnmkdm=N2154`;
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&xqh_id=1`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) {
            auxDiagnostics.timeSlots = { code: 'E3', why: `HTTP ${response.status}（作息接口）` };
            console.warn('[GZIST] 作息接口 HTTP 异常:', response.status, url);
            return null;
        }

        const { text: rawText } = await readTextSmart(response);

        // 会话失效优先判定：否则 200 + 登录页会被误归为“格式异常”
        const loginCheck = detectLoginPage(response, rawText);
        if (loginCheck.isLogin) {
            auxDiagnostics.timeSlots = { code: 'E1', why: loginCheck.why };
            return null;
        }

        let json = null;
        try {
            json = JSON.parse(rawText);
        } catch (e) {
            auxDiagnostics.timeSlots = { code: 'E4', why: `作息接口返回非 JSON（前 120 字）：${rawText.substring(0, 120)}` };
            console.warn('[GZIST] 作息接口返回非 JSON，前 300 字:', rawText.substring(0, 300));
            return null;
        }

        // 兼容：有时直接返回数组，有时包在 {items:[...]} / {rows:[...]} 里
        const list = Array.isArray(json)
            ? json
            : (Array.isArray(json.items) ? json.items
                : (Array.isArray(json.rows) ? json.rows : null));

        const slots = buildTimeSlotsFrom(list);
        if (slots) return slots;

        console.warn('[GZIST] 作息接口未返回可用节次数据（已尝试 jcmc/qssj/jssj 等多种字段）。原始响应前 500 字:',
            rawText.substring(0, 500));
        auxDiagnostics.timeSlots = {
            code: 'E4',
            why: `作息接口未返回可用节次数据（已尝试 jcmc/qssj/jssj 等字段），响应前 120 字：${rawText.substring(0, 120)}`
        };
        return null;
    } catch (e) {
        auxDiagnostics.timeSlots = { code: 'E2', why: `请求异常：${errText(e)}` };
        console.warn('[GZIST] 作息接口请求失败:', e && e.message ? e.message : e);
        return null;
    }
}

/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const targetUrl = `${getBaseUrl()}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

    // 并行获取课程数据、开学日期、作息时间
    // 本段必须自带 try/catch：fetch() 在网络故障时是 **reject**（而非返回 ok:false），
    // 若让异常冒泡出去，整个导入会静默死掉（不报错、不通知完成）—— 正是要消除的“神秘失败”。
    let courseResponse;
    let semesterStartDate = null;
    let fetchedTimeSlots = null;
    try {
        [courseResponse, semesterStartDate, fetchedTimeSlots] = await Promise.all([
            fetch(targetUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                },
                body: requestBody,
                credentials: "include"
            }),
            fetchSemesterStartDate(academicYear, semesterCode),
            fetchTimeSlots(academicYear, semesterCode)
        ]);
    } catch (netErr) {
        await reportImportError('E2', [
            `请求课表失败：${errText(netErr)}`,
            `请求：${targetUrl}`,
            `入口：${getBaseUrl()}`,
            '常见原因：不在校园网内 / WebVPN 已掉线 / 代理或跨源拦截了请求'
        ]);
        return null;
    }

    try {
        if (!courseResponse.ok) {
            await reportImportError('E3', [
                `课表接口返回 HTTP ${courseResponse.status}`,
                `请求：${targetUrl}`
            ]);
            return null;
        }

        const { text: jsonText, encoding: courseEncoding } = await readTextSmart(courseResponse);

        // 会话失效优先判定：正方会返回 200 + 登录页，不识别就会被误判成「格式异常」
        const loginCheck = detectLoginPage(courseResponse, jsonText);
        if (loginCheck.isLogin) {
            await reportImportError('E1', [
                '课表接口返回的是登录页，说明登录会话已过期',
                loginCheck.why,
                `请求：${targetUrl}`
            ]);
            return null;
        }

        let jsonData = null;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (parseErr) {
            await reportImportError('E4', [
                '课表接口返回的内容不是合法 JSON',
                `响应编码：${courseEncoding}`,
                `响应前 120 字：${jsonText.substring(0, 120)}`,
                `请求：${targetUrl}`
            ]);
            return null;
        }

        if (!jsonData || !pickCourseList(jsonData)) {
            await reportImportError('E4', [
                '响应中找不到课表列表字段（已尝试 kbList / items / rows / data / list）',
                `响应编码：${courseEncoding}`,
                `响应前 120 字：${jsonText.substring(0, 120)}`,
                `请求：${targetUrl}`
            ]);
            return null;
        }

        const parsedCourses = parseJsonData(jsonData);
        if (parsedCourses.length === 0) {
            await reportImportError('E5', [
                `所选学年学期（xnm=${academicYear} / xqm=${semesterCode}）返回 0 条课程`
            ]);
            return null;
        }

        // 作息优先级：节次时间接口 → 课表响应里的 sjkList → 脚本内置保底作息
        // （内置保底不在此处处理，统一由 importPresetTimeSlots 兜底）
        const resolvedTimeSlots = fetchedTimeSlots || parseTimeSlotsFromCourseJson(jsonData);

        return {
            courses: parsedCourses,
            config: {
                semesterStartDate: semesterStartDate,
                // 已与本校学生确认：本学期 20 周（2026-10-13）
                semesterTotalWeeks: 20
            },
            timeSlots: resolvedTimeSlots
        };
    } catch (e) {
        await reportImportError('E2', [
            `请求课表时发生异常：${errText(e)}`,
            `请求：${targetUrl}`
        ]);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败【E7】${IMPORT_ERRORS.E7.title}: ${errText(error)}`);
        return false;
    }
}

// 保底作息表：仅当接口 / 课表响应两级都取不到时使用。
//
// 数据来源：本校学生提供的真实作息（2026-10-13），已与导出课表交叉核对：
//   · 上午 1-4 节、下午 5-8 节，每节 45 分钟，节间 10 分钟，第 2-3 节与第 6-7 节间为大课间 20 分钟
//   · 晚上 9-12 节为「两节一对」的 80 分钟大节：9-10 = 18:40-20:00，11-12 = 20:20-21:40
//     （故每节按 40 分钟拆分，这样「第9-10节」的课程会正确显示为 18:40-20:00）
//   · 课表页模板共 12 节（上午/下午/晚上各 4 节），11-12 节当前学期未被占用但仍保留
/**
 * 保底作息的元数据（每次改动作息时请同步更新 —— 便于日后核查来源与时效）
 *
 *   生效学期 : 2026-2027 学年第一学期（开学日 2026-08-31，共 20 周）
 *   最后核验 : 2026-10-13
 *   来源     : 本校学生提供的作息表，已与本学期导出课表交叉核对
 *   维护提示 : 作息可能随校历微调；若课程时间出现偏移，优先核验 FALLBACK_TIME_SLOTS
 *   缺省策略 : 若该表为空数组，则跳过作息导入（不猜时间），交由应用默认节次接管
 */
const FALLBACK_TIME_SLOTS_META = {
    academicTerm: "2026-2027-1",
    verifiedAt: "2026-10-13",
    source: "本校学生提供的作息表（已与导出课表交叉核对）"
};

const FALLBACK_TIME_SLOTS = [
    { number: 1,  startTime: "08:20", endTime: "09:05" },
    { number: 2,  startTime: "09:15", endTime: "10:00" },
    { number: 3,  startTime: "10:20", endTime: "11:05" },
    { number: 4,  startTime: "11:15", endTime: "12:00" },
    { number: 5,  startTime: "14:00", endTime: "14:45" },
    { number: 6,  startTime: "14:55", endTime: "15:40" },
    { number: 7,  startTime: "16:00", endTime: "16:45" },
    { number: 8,  startTime: "16:55", endTime: "17:40" },
    { number: 9,  startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:20", endTime: "20:00" },
    { number: 11, startTime: "20:20", endTime: "21:00" },
    { number: 12, startTime: "21:00", endTime: "21:40" }
];

async function importPresetTimeSlots(timeSlots, auxDiag) {
    let finalTimeSlots = timeSlots;
    let usedFallback = false;

    if (!finalTimeSlots || finalTimeSlots.length === 0) {
        if (FALLBACK_TIME_SLOTS.length === 0) {
            // 既没取到动态作息，也没有保底数据：跳过，避免写入错误作息
            const codeHint = auxDiag ? `【${auxDiag.code}】` : '';
            window.shiguangBridge.showToast(`未获取到教务系统作息${codeHint}，已跳过作息导入（课表使用应用默认节次）。`);
            return;
        }
        finalTimeSlots = FALLBACK_TIME_SLOTS;
        usedFallback = true;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalTimeSlots));
        if (usedFallback) {
            // 非致命，但必须告知原因（错误码），避免「静默用了默认值」
            const codeHint = auxDiag
                ? `，原因【${auxDiag.code}】${(IMPORT_ERRORS[auxDiag.code] && IMPORT_ERRORS[auxDiag.code].title) || ''}`
                : '';
            window.shiguangBridge.showToast(
                `未获取到教务系统作息${codeHint}。已使用内置保底作息（核验于 ${FALLBACK_TIME_SLOTS_META.verifiedAt}，如与实际不符请反馈）。`
            );
        } else {
            window.shiguangBridge.showToast("预设时间段导入成功！");
        }
    } catch (error) {
        window.shiguangBridge.showToast(`导入时间段失败【E7】${errText(error)}`);
    }
}

/**
 * 顶层入口：包一层安全网。
 * 任何未预期异常都必须让用户看到并带上诊断信息 —— 绝不允许静默死亡
 * （注意：早期版本把 Promise.all 放在 try 之外，断网时会静默失败，已由单测守住）。
 */
async function runImportFlow() {
    try {
        await runImportFlowInner();
    } catch (fatal) {
        await reportImportError('E8', [
            `导入流程出现未预期异常：${errText(fatal)}`,
            fatal && fatal.stack ? String(fatal.stack).split('\n').slice(0, 3).join(' | ') : '',
            '请把以上信息反馈给适配维护者'
        ].filter(Boolean));
    }
}

async function runImportFlowInner() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    const { academicYear, semesterCode } = selection;

    const result = await fetchAndParseCourses(academicYear, semesterCode);
    if (result === null) {
        return;
    }

    const { courses, config, timeSlots } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    let configOk = true;
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        let configMsg = "课表配置更新成功！";
        if (config.semesterStartDate) {
            configMsg += ` 开学日期：${config.semesterStartDate}`;
        }
        window.shiguangBridge.showToast(configMsg);
    } catch (error) {
        configOk = false;
        window.shiguangBridge.showToast(`课表配置保存失败【E7】${errText(error)}`);
    }

    // 开学日期取不到时明确告知原因（非致命，但不静默）
    if (!config.semesterStartDate && auxDiagnostics.startDate) {
        noticeAux(auxDiagnostics.startDate.code, '开学日期');
    }

    // 作息：把失败原因（错误码）一并传入，便于用户/维护者定位
    await importPresetTimeSlots(timeSlots, auxDiagnostics.timeSlots);

    // 课程数据已写入，但不掩盖配置保存失败（否则用户会误以为开学日期/周数都准了）
    window.shiguangBridge.showToast(
        configOk
            ? `课程导入成功，共导入 ${courses.length} 门课程！`
            : `课程已导入 ${courses.length} 门，但课表配置保存失败（开学日期/总周数可能不准，可再次导入）。`
    );
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
