// 广东药科大学 (gdpu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统 V-9.0 接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

(function () {

// ==================== 接口地址推导 ====================

/**
 * 推导教务系统接口前缀，兼容三种入口形态：
 *   校园网直连：  pathname 形如 /kbcx/xskbcx_cxXsgrkb.html
 *   WebVPN 哈希： pathname 形如 /http/<jwt>/kbcx/xskbcx_cxXsgrkb.html
 *   WebVPN 拼接： pathname 形如 /https://jwsys.gdpu.edu.cn/kbcx/xskbcx_...html
 * 以 "/kbcx/" 为锚点即可同时覆盖以上三种情况。
 */
function getScheduleBase() {
    const path = (window.location && window.location.pathname) || "";

    const kbIndex = path.indexOf("/kbcx/");
    if (kbIndex >= 0) return path.slice(0, kbIndex);

    // 兜底：停留在教务系统非课表页（如首页、菜单页）时，直接识别反代前缀
    const proxyPrefix = path.match(/^\/(?:https?:\/\/[^/]+|(?:http|https|https-443)\/[^/]+)/i);
    return proxyPrefix ? proxyPrefix[0] : "";
}

/**
 * 拼接教务系统接口地址，自动带上直连/反代前缀
 */
function buildScheduleUrl(modulePath, query) {
    const base = getScheduleBase();
    const queryString = query ? "?" + query : "";
    return window.location.origin + base + "/kbcx/" + modulePath + queryString;
}

// ==================== 解析函数 ====================

/**
 * 解析周次字符串，处理单双周和周次范围
 * 兼容"1-4周"、"第6周"、"1-16周(单)"、"1-4周，第6周"、"周数：1-16周"等写法
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
 * 解析节次字段，如 "1-2"、"3"、"1-2节"、"第1-2节"，得到起止节次
 * 格式无法识别或数值不合法时返回 null
 */
function parseSectionRange(sectionStr) {
    const text = sectionStr == null ? '' : String(sectionStr);
    const match = text.match(/^\s*(?:第)?(\d+)\s*(?:-\s*(\d+))?\s*节?\s*$/);

    if (!match) return null;

    const startSection = Number(match[1]);
    const endSection = Number(match[2] || match[1]);

    if (!Number.isInteger(startSection) || !Number.isInteger(endSection) ||
        startSection < 1 || endSection < startSection) {
        return null;
    }

    return { startSection, endSection };
}

/**
 * 解析课表接口返回的 JSON
 * 记录课程所属校区（xqmc / xqh_id），供后续获取对应校区作息
 */
function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        return { courses: [], campuses: [] };
    }

    const courses = [];
    const campusMap = {};
    // 记录被跳过的条数，避免解析失败时静默丢课（原缺陷正是静默丢弃）
    let dropped = 0;

    for (const raw of jsonData.kbList) {
        if (!raw || typeof raw !== 'object') { dropped++; continue; }
        if (!raw.kcmc || raw.xqj == null || raw.jcs == null || raw.zcd == null) { dropped++; continue; }

        const weeks = parseWeeks(raw.zcd);
        if (weeks.length === 0) { dropped++; continue; }

        const sectionRange = parseSectionRange(raw.jcs);
        if (!sectionRange) { dropped++; continue; }

        const day = Number(raw.xqj);
        if (isNaN(day) || day < 1 || day > 7) { dropped++; continue; }

        const xqhId = raw.xqh_id == null ? "" : String(raw.xqh_id).trim();
        const xqmc = raw.xqmc == null ? "" : String(raw.xqmc).trim();
        if (xqhId && !campusMap[xqhId]) {
            campusMap[xqhId] = { id: xqhId, name: xqmc || ("校区 " + xqhId) };
        }

        courses.push({
            name: raw.kcmc == null ? '' : String(raw.kcmc).trim(),
            teacher: raw.xm == null ? '' : String(raw.xm).trim(),
            position: raw.cdmc == null ? '' : String(raw.cdmc).trim(),
            day: day,
            startSection: sectionRange.startSection,
            endSection: sectionRange.endSection,
            weeks: weeks
        });
    }

    // 与旧版一致：按星期、节次、课程名排序，保证导入顺序稳定
    courses.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    return { courses: courses, campuses: Object.values(campusMap), dropped: dropped, total: jsonData.kbList.length };
}

// ==================== 教务接口 ====================

/**
 * 从 select 元素解析选项，默认索引取当前选中项
 */
function parseSelectOptions(selectElement) {
    const options = [];
    let defaultIndex = 0;

    Array.from(selectElement.querySelectorAll("option")).forEach(option => {
        const value = String(option.value).trim();
        if (!value) return;
        if (option.selected) defaultIndex = options.length;
        options.push({ value: value, text: String(option.textContent).trim() });
    });

    return { options: options, defaultIndex: defaultIndex };
}

/**
 * 读取课表查询页里的学年/学期下拉选项
 * 失败返回 null，由调用方提示用户
 */
async function fetchAcademicOptions() {
    const url = buildScheduleUrl("xskbcx_cxXskbcxIndex.html", "gnmkdm=N2151&layout=default");

    try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) return null;

        const doc = new DOMParser().parseFromString(await response.text(), "text/html");

        const yearData = parseSelectOptions(doc.querySelector("#xnm"));
        const semesterData = parseSelectOptions(doc.querySelector("#xqm"));
        if (yearData.options.length === 0 || semesterData.options.length === 0) return null;

        // 教务系统的学年下拉包含全部历史年份（约 30 项），弹窗太长。
        // 以当前选中年份为中心截取前 2 年、后 2 年，共 5 项。
        const start = Math.max(0, yearData.defaultIndex - 2);
        const end = Math.min(yearData.options.length, yearData.defaultIndex + 3);

        return {
            yearOptions: yearData.options.slice(start, end),
            semesterOptions: semesterData.options,
            defaultYearIndex: yearData.defaultIndex - start,
            defaultSemesterIndex: semesterData.defaultIndex
        };
    } catch (e) {
        console.error("读取学年学期选项失败:", e);
        return null;
    }
}

/**
 * 查询指定学期的周次安排，取第 1 周的日期作为开学日期，并返回该学期总周数
 * 与课表同源（同为正方的教务基础数据），失败即视为会话异常
 */
async function fetchSemesterInfo(academicYear, semesterCode) {
    const url = buildScheduleUrl(
        "xskbcxZccx_cxZcByXnxq.html",
        "gnmkdm=N2154&xnm=" + encodeURIComponent(academicYear) + "&xqm=" + encodeURIComponent(semesterCode)
    );

    try {
        // 该接口沿用正方 V9 惯例，按 GET 携带 xnm/xqm 查询；失败时上层回退默认值
        const response = await fetch(url, {
            method: "GET",
            headers: { "accept": "application/json, text/javascript, */*; q=0.01" },
            credentials: "include"
        });

        if (!response.ok) return null;

        const weeks = await response.json();
        if (!Array.isArray(weeks) || weeks.length === 0) return null;

        return {
            // weeks[0] 即第 1 周，rq 形如 "2026-09-07/2026-09-13"
            startDate: String(weeks[0].rq).split("/")[0],
            totalWeeks: weeks.length
        };
    } catch (e) {
        console.error("获取校历失败:", e);
        return null;
    }
}

/**
 * 从教务获取指定校区的作息时间表（节次 -> 起止时间）
 */
async function fetchTimeSlots(academicYear, semesterCode, xqhId) {
    const url = buildScheduleUrl("xskbcx_cxRjc.html", "gnmkdm=N2151");
    const body = "xnm=" + encodeURIComponent(academicYear) +
        "&xqm=" + encodeURIComponent(semesterCode) +
        "&xqh_id=" + encodeURIComponent(xqhId);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: body,
            credentials: "include"
        });

        if (!response.ok) return null;

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) return null;

        const seen = {};
        const timeSlots = [];

        for (const item of json) {
            if (!item || !item.jcmc || !item.qssj || !item.jssj) continue;

            const num = Number(item.jcmc);
            if (isNaN(num) || seen[num]) continue;
            seen[num] = true;

            const start = String(item.qssj).substring(0, 5);
            const end = String(item.jssj).substring(0, 5);
            if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;

            timeSlots.push({ number: num, startTime: start, endTime: end });
        }

        timeSlots.sort((a, b) => a.number - b.number);

        // App 要求节次必须从 1 开始连续，且相邻不得重叠
        for (let i = 0; i < timeSlots.length; i++) {
            if (timeSlots[i].number !== i + 1) return null;
            if (i > 0 && timeSlots[i].startTime < timeSlots[i - 1].endTime) return null;
        }

        return timeSlots.length > 0 ? timeSlots : null;
    } catch (e) {
        console.error("获取作息时间失败:", e);
        return null;
    }
}

// ==================== 交互 ====================

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "广东药科大学教务系统课表导入",
        "导入前请确认已在浏览器中登录广东药科大学教务系统。\n" +
        "脚本通过接口直接获取课表，无需停留在课表页；如未登录请先登录后再运行。",
        "好的，开始导入"
    );
}

/**
 * 依次弹出学年、学期选择框，选项来自教务系统
 */
async function selectAcademicYearAndSemester() {
    const options = await fetchAcademicOptions();
    if (!options) {
        window.shiguangBridge.showToast("读取学年学期失败，请确认已登录教务系统。");
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = options;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearOptions.map(item => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map(item => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/**
 * 当课表涉及多个校区时，询问用哪个校区的作息
 * 单校区时直接返回，不打扰用户
 */
async function selectCampus(campuses) {
    if (campuses.length === 0) return null;
    if (campuses.length === 1) return campuses[0];

    const campusIndex = await window.shiguangBridgePromise.showSingleSelection(
        "检测到多个校区，请选择用于作息的校区",
        JSON.stringify(campuses.map(item => item.name)),
        0
    );
    if (campusIndex === null || campusIndex === -1) return null;
    return campuses[campusIndex];
}

// ==================== 保存 ====================

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        return false;
    }
}

async function importPresetTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

// ==================== 数据抓取 ====================

/**
 * 请求课表接口并解析课程，同时并行获取学期信息
 * 返回 { courses, campuses } 或 null
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const body = "xnm=" + encodeURIComponent(academicYear) +
        "&xqm=" + encodeURIComponent(semesterCode) +
        "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
    const courseUrl = buildScheduleUrl("xskbcx_cxXsgrkb.html", "gnmkdm=N2151");

    try {
        const [courseResponse, semesterInfo] = await Promise.all([
            fetch(courseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body: body,
                credentials: "include"
            }),
            fetchSemesterInfo(academicYear, semesterCode)
        ]);

        if (!courseResponse.ok) {
            window.shiguangBridge.showToast("课表请求失败：HTTP " + courseResponse.status + "，请确认已登录教务系统。");
            return null;
        }

        const text = await courseResponse.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            window.shiguangBridge.showToast("数据解析失败，登录状态可能已过期，请重新登录后重试。");
            return null;
        }

        const parsed = parseJsonData(json);

        if (parsed.courses.length === 0) {
            window.shiguangBridge.showToast("未查询到课表数据，请检查学年/学期选择或登录状态。");
            return null;
        }

        if (!semesterInfo) {
            window.shiguangBridge.showToast("获取校历失败，无法确定开学日期，请确认登录状态后重试。");
            return null;
        }

        return {
            courses: parsed.courses,
            campuses: parsed.campuses,
            semesterInfo: semesterInfo
        };
    } catch (e) {
        window.shiguangBridge.showToast("获取课表失败，请确认已登录且网络可正常访问教务系统。");
        return null;
    }
}

// ==================== 主流程 ====================

/**
 * 检查是否停留在统一认证登录页
 */
function isLoginPage() {
    const href = (window.location && window.location.href) || "";
    return href.indexOf("lyuapServer/login") > -1;
}

async function runImportFlow() {
    // 0. 登录页直接拦截，避免发出必然失败的请求
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先在浏览器登录教务系统！");
        return;
    }

    // 1. 确认导入
    const confirmed = await promptUserToStart();
    if (!confirmed) return;

    // 2. 选择学年学期
    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    // 3. 拉取并解析课程
    const result = await fetchAndParseCourses(selection.academicYear, selection.semesterCode);
    if (result === null) return;

    const courses = result.courses;
    const campuses = result.campuses;
    const semesterInfo = result.semesterInfo;

    if (result.dropped > 0) {
        window.shiguangBridge.showToast(
            "共 " + result.total + " 条课程记录，其中 " + result.dropped + " 条因周次/节次无法识别被跳过。"
        );
    }

    // 4. 确定作息所属校区（用户取消则终止，避免写入课程后静默套用错误作息）
    const campus = await selectCampus(campuses);
    if (!campus) return;

    // 5. 保存课程
    if (!(await saveCourses(courses))) return;

    // 6. 保存课表配置
    const maxCourseWeek = courses.reduce((max, c) => {
        const m = c.weeks.length ? Math.max.apply(null, c.weeks) : 0;
        return Math.max(max, m);
    }, 0);
    // 校历返回的是学期总跨度（第二学期含暑假，实测 27 周），不能直接当教学周数。
    const totalWeeks = Math.max(maxCourseWeek, Math.min(semesterInfo.totalWeeks, 20));

    const config = {
        semesterStartDate: semesterInfo.startDate,
        semesterTotalWeeks: totalWeeks
    };

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            "课表配置更新成功！总周数：" + totalWeeks + " 周。 开学日期：" + config.semesterStartDate
        );
    } catch (error) {
        window.shiguangBridge.showToast("课表配置保存失败: " + error.message);
    }

    // 7. 导入作息时间
    const timeSlots = await fetchTimeSlots(selection.academicYear, selection.semesterCode, campus.id);
    if (!timeSlots) {
        window.shiguangBridge.showToast("获取作息时间失败，请确认登录状态后重试。");
        return;
    }
    await importPresetTimeSlots(timeSlots);

    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();

})();
