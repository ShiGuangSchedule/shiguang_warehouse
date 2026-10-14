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
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const initialCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc ||
            !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);
        const day = Number(rawCourse.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        initialCourseList.push({
            name: rawCourse.kcmc.trim(),
            teacher: rawCourse.xm.trim(),
            position: rawCourse.cdmc.trim(),
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
async function fetchAcademicOptions() {
    const url = `${getBaseUrl()}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) return null;

        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({
                value: opt.value,
                text: opt.textContent.trim(),
                selected: opt.selected
            }));

        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({
                value: opt.value,
                text: opt.textContent.trim(),
                selected: opt.selected
            }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) {
            return null;
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
        return null;
    }
}

/**
 * 提示用户选择学年和学期
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保登录状态。");
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
            const json = await response.json();
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

    return slots.length >= 3 ? slots : null;
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
            console.warn('[GZIST] 作息接口 HTTP 异常:', response.status, url);
            return null;
        }

        const rawText = await response.text();
        let json = null;
        try {
            json = JSON.parse(rawText);
        } catch (e) {
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
        return null;
    } catch (e) {
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
    const [courseResponse, semesterStartDate, fetchedTimeSlots] = await Promise.all([
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

    try {
        if (courseResponse.ok) {
            const jsonText = await courseResponse.text();
            const jsonData = JSON.parse(jsonText);
            if (jsonData && jsonData.kbList) {
                const parsedCourses = parseJsonData(jsonData);
                if (parsedCourses.length > 0) {
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
                }
            }
        }
    } catch (e) {
        // 请求失败
    }

    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或登录状态。");
    return null;
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

// 保底作息表：仅当接口 / 课表响应 / DOM 三级都取不到时使用。
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

async function importPresetTimeSlots(timeSlots) {
    let finalTimeSlots = timeSlots;
    let usedFallback = false;

    if (!finalTimeSlots || finalTimeSlots.length === 0) {
        if (FALLBACK_TIME_SLOTS.length === 0) {
            // 既没取到动态作息，也没有保底数据：跳过，避免写入错误作息
            window.shiguangBridge.showToast("未获取到教务系统作息时间，已跳过作息导入（课表使用应用默认节次）。");
            return;
        }
        finalTimeSlots = FALLBACK_TIME_SLOTS;
        usedFallback = true;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalTimeSlots));
        if (usedFallback) {
            window.shiguangBridge.showToast(
                `未获取到教务系统作息，已使用内置保底作息（核验于 ${FALLBACK_TIME_SLOTS_META.verifiedAt}，如与实际不符请反馈）。`
            );
        } else {
            window.shiguangBridge.showToast("预设时间段导入成功！");
        }
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

async function runImportFlow() {
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
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    await importPresetTimeSlots(timeSlots);

    // 课程数据已写入，但不掩盖配置保存失败（否则用户会误以为开学日期/周数都准了）
    window.shiguangBridge.showToast(
        configOk
            ? `课程导入成功，共导入 ${courses.length} 门课程！`
            : `课程已导入 ${courses.length} 门，但课表配置保存失败（开学日期/总周数可能不准，可再次导入）。`
    );
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
