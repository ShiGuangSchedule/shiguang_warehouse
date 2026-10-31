// 广州理工学院（GZIST）拾光课程表适配脚本
// 正方教务 v9 接口，参考案例 JSEI_01：
// https://github.com/XingHeYuZhuan/shiguang_warehouse/tree/main/resources/JSEI
// 非该校开发者适配，发现问题请提 issue 或 PR

/** 基础域名：校园网直连 / WebVPN（按当前页面自动选择） */
const BASE_URLS = {
    campus: "http://jw.gzist.edu.cn/jwglxt",
    webvpn: "https://webvpn.gzist.edu.cn/https/jw.gzist.edu.cn/jwglxt"
};

// 本校正方页面覆盖了原型方法且行为不符标准：filter 回调拿到的第一个参数是 index、trim 会删掉字符串内部空白，
// 故下面两处改用不依赖原型的写法（for 循环 / 正则）。
const safeTrim = (s) => String(s).replace(/^\s+|\s+$/g, "");

function getBaseUrl() {
    const { origin, hostname, pathname } = window.location;

    // WebVPN：路径形如 /https/jw.gzist.edu.cn/jwglxt/...
    if (hostname.includes("webvpn")) {
        const matched = pathname.match(/\/https\/[^/]+\/jwglxt/);
        return origin + (matched ? matched[0] : "/https/jw.gzist.edu.cn/jwglxt");
    }

    // 校园网：从 /jwglxt 起截断
    const matched = pathname.match(/\/jwglxt(?=\/|$)/);
    if (matched) return origin + pathname.substring(0, matched.index + matched[0].length);

    return BASE_URLS.campus;
}

/** 节次与周次合并去重（取自上游 wiki：课程合并与去重函数） */
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

/** 解析周次字符串，处理单双周和周次范围 */
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
        const s = safeTrim(seg);
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

/** 解析课表接口返回的 JSON */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];

    const initialCourseList = [];

    for (const raw of jsonData.kbList) {
        if (!raw.kcmc || !raw.xqj || !raw.jcs || !raw.zcd) continue;

        const weeksArray = parseWeeks(raw.zcd);
        if (weeksArray.length === 0) continue;

        const sectionParts = String(raw.jcs).split("-");
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);
        const day = Number(raw.xqj);

        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) ||
            day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        initialCourseList.push({
            name: safeTrim(raw.kcmc),
            teacher: safeTrim(raw.xm || ""),      // 无教师（如线上课）时传空串
            position: safeTrim(raw.cdmc || ""),   // 无固定教室时传空串
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
        "导入前请确保已进入教务系统页面（本校学生请用统一身份认证登录，教务自身的账号密码不可用；校外请走 WebVPN）",
        "好的，开始导入"
    );
}

/** 获取学年学期选项；学年以选中项为中心取前后共 5 个 */
async function fetchAcademicOptions() {
    const url = `${getBaseUrl()}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`;

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) return null;

        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const readOptions = (selector) => {
            const result = [];
            doc.querySelectorAll(selector).forEach(opt => {
                if (opt.value === "") return;
                result.push({
                    value: opt.value,
                    text: safeTrim(opt.textContent),
                    selected: opt.selected
                });
            });
            return result;
        };

        const allYearOptions = readOptions("#xnm option");
        const semesterOptions = readOptions("#xqm option");

        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;

        const semesterIndex = semesterOptions.findIndex(opt => opt.selected);
        const defaultSemesterIndex = semesterIndex === -1 ? 0 : semesterIndex;
        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);

        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex
            };
        }

        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);

        return {
            yearOptions: allYearOptions.slice(start, end),
            semesterOptions,
            defaultYearIndex: selectedIndex - start,
            defaultSemesterIndex
        };
    } catch (e) {
        return null;
    }
}

/** 提示用户选择学年和学期 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        window.shiguangBridge.showToast("读取学年学期失败，请确认已登录教务系统。");
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearOptions.map(item => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === undefined || yearIndex < 0) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map(item => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === undefined || semesterIndex < 0) return null;

    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/** 获取学期开学日期（失败返回 null，不影响主流程） */
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

        if (!response.ok) return null;

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) return null;

        // 优先找第 1 周，否则取第一项
        const firstWeekObj = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];

        if (firstWeekObj.rq) {
            const startDateStr = firstWeekObj.rq.split('/')[0];
            if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return startDateStr;
        }
        for (const field of ["zcrq", "ksrq"]) {
            const matched = firstWeekObj[field] && String(firstWeekObj[field]).match(/(\d{4}-\d{2}-\d{2})/);
            if (matched) return matched[1];
        }
    } catch (e) {
        // 开学日期获取失败不影响导入
    }

    return null;
}

/** 请求并解析课程数据 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const targetUrl = `${getBaseUrl()}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

    try {
        // 并行获取课程数据与开学日期
        const [courseResponse, semesterStartDate] = await Promise.all([
            fetch(targetUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                },
                body: requestBody,
                credentials: "include"
            }),
            fetchSemesterStartDate(academicYear, semesterCode)
        ]);

        if (!courseResponse.ok) {
            window.shiguangBridge.showToast(`获取课表失败（HTTP ${courseResponse.status}），请稍后重试。`);
            return null;
        }

        const jsonText = await courseResponse.text();

        // 会话失效时正方返回 200 + 登录页，单独提示，避免被误认为网络问题
        if (/login_slogin|name=["']yhm["']/.test(jsonText)) {
            window.shiguangBridge.showToast("登录状态已失效，请重新登录教务系统后再导入。");
            return null;
        }

        const parsedCourses = parseJsonData(JSON.parse(jsonText));
        if (parsedCourses.length === 0) {
            window.shiguangBridge.showToast("该学期没有查询到课程，请确认所选学年学期是否正确。");
            return null;
        }

        return {
            courses: parsedCourses,
            config: {
                semesterStartDate: semesterStartDate,
                semesterTotalWeeks: 20
            }
        };
    } catch (e) {
        window.shiguangBridge.showToast("获取课表失败，请检查网络环境或登录状态。");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败：${error}`);
        return false;
    }
}

// 本校作息（学校作息表口径：每节 45 分钟 + 10 分钟课间）。
// 本校按此口径导入作息（接口另有“每节 50 分钟、两节相连”的行政口径，经决定不采用）。
const FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:15", endTime: "10:00" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:40", endTime: "19:20" },
    { number: 10, startTime: "19:20", endTime: "20:00" },
    { number: 11, startTime: "20:20", endTime: "21:00" },
    { number: 12, startTime: "21:00", endTime: "21:40" }
];

async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(FALLBACK_TIME_SLOTS));
        window.shiguangBridge.showToast("时间段导入成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`时间段导入失败：${error}`);
        return false;
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
    if (result === null) return;

    const { courses, config } = result;

    // 保存顺序对齐 JSEI_01：课程 → 作息 → 课表配置
    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    const timeSlotsSaved = await importPresetTimeSlots();

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            config.semesterStartDate
                ? `课表配置更新成功！开学日期：${config.semesterStartDate}`
                : "课表配置更新成功！"
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败：${error}`);
    }

    window.shiguangBridge.showToast(
        timeSlotsSaved
            ? `课程导入成功，共导入 ${courses.length} 门课程！`
            : `课程已导入 ${courses.length} 门，但作息时间未写入，请在「作息时间」中手动设置。`
    );
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
