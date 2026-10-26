// 上海财经大学浙江学院 (shufe-zj.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 教务系统: jwxt.shufe-zj.edu.cn (正方教务 ZFSoft)
// 登录方式: CAS 统一身份认证 (ty.shufe-zj.edu.cn)
// 参照仓库内 GDUST(广东科技学院)正方 v9 适配模板编写

/**
 * 解析周次字符串，兼容多种格式：
 *   - "1-16周"                     -> [1..16]
 *   - "1-8周(单)" / "1-8周(双)"    -> 单/双周
 *   - "1-3周,5周,7-9周(单)"        -> 多段混合
 *   - 无"周"字的 "1-16" / "1-3,5"
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    // 去掉花括号包裹的内容（部分正方版本返回 "{第1-16周}"）
    const cleaned = weekStr.replace(/\{[^}]*\}/g, '').trim();
    const weekSets = cleaned.split(',');
    const weeks = [];

    for (let set of weekSets) {
        set = set.trim();
        const isSingle = set.includes('(单)') || set.includes('(单周)');
        const isDouble = set.includes('(双)') || set.includes('(双周)');

        const rangeMatch = set.match(/(\d+)\s*[-~—]\s*(\d+)/);
        const singleMatch = set.match(/(\d+)/);

        let start, end;
        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
        } else {
            continue;
        }

        if (start > end) [start, end] = [end, start];
        if (end > 60) end = 60; // 防御异常数据

        for (let w = start; w <= end; w++) {
            if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
            if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
            weeks.push(w);
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析节次，兼容两种格式：
 *   - "1-2"  (范围)
 *   - "0102" (两位补零，老版本正方)
 */
function parseSections(jcs) {
    if (!jcs) return [];
    const str = String(jcs).trim();
    if (/^\d+-\d+$/.test(str)) {
        const [s, e] = str.split('-').map(Number);
        if (s > e) return [];
        return Array.from({ length: e - s + 1 }, (_, i) => s + i);
    }
    // 两位补零格式
    if (/^\d+$/.test(str) && str.length % 2 === 0) {
        const arr = [];
        for (let i = 0; i < str.length; i += 2) {
            arr.push(Number(str.substr(i, 2)));
        }
        return arr;
    }
    return [];
}

/**
 * 解析 API 返回的 JSON 数据（kbList）。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        const kcmc = rawCourse.kcmc;
        const xm = rawCourse.xm;
        const cdmc = rawCourse.cdmc;
        const xqj = Number(rawCourse.xqj);
        const zcd = rawCourse.zcd;

        if (!kcmc || !xm || !cdmc || !rawCourse.jcs || !zcd) continue;

        const weeksArray = parseWeeks(zcd);
        if (weeksArray.length === 0) continue;

        const sections = parseSections(rawCourse.jcs);
        if (sections.length === 0) continue;

        const startSection = sections[0];
        const endSection = sections[sections.length - 1];

        if (isNaN(xqj) || xqj < 1 || xqj > 7 || startSection > endSection) continue;

        finalCourseList.push({
            name: String(kcmc).trim(),
            teacher: String(xm).trim(),
            position: String(cdmc).trim(),
            day: xqj,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "上海财经大学浙江学院 · 教务导入",
        "请先确保已在当前页面成功登录教务系统（CAS 统一身份认证）。\n\n导入时会自动识别页面上当前选中的学年和学期，无需手动选择。",
        "我已登录，开始导入"
    );
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 学年请输入 2025）:",
        currentYear,
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesters = ["第 1 学期", "第 2 学期"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    return semesterIndex;
}

/**
 * 获取学期码候选列表。
 * 正方教务标准编码为 3(第一学期)/12(第二学期)，部分学校自定义为 1/2。
 * 依次尝试，取第一个能返回非空课表的。
 */
function getSemesterCodeCandidates(semesterIndex) {
    return semesterIndex === 0 ? ["3", "1"] : ["12", "2"];
}

/**
 * 从当前页面 URL 中提取 su 参数（学号），正方教务课表页通常带该参数。
 */
function getStudentIdFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const su = params.get("su");
        return su ? su.trim() : "";
    } catch (e) {
        return "";
    }
}

/**
 * 从当前页面自动识别选中的学年(xnm)与学期(xqm)。
 * 正方教务课表页的学年/学期下拉框通常以 xnm / xqm 命名。
 * 识别失败返回 null，由调用方回退到手动输入。
 */
function getCurrentSemesterFromPage() {
    try {
        const pairs = [
            ["#xnm", "#xqm"],
            ["select[name='xnm']", "select[name='xqm']"],
            ["#xnmSel", "#xqmSel"],
            ["select[name='xnm_id']", "select[name='xqm_id']"]
        ];
        for (const [yearSel, semSel] of pairs) {
            const yearEl = document.querySelector(yearSel);
            const semEl = document.querySelector(semSel);
            if (yearEl && semEl && yearEl.value !== "" && semEl.value !== "") {
                return { xnm: String(yearEl.value).trim(), xqm: String(semEl.value).trim() };
            }
        }
        // 兜底：按 name/id 模糊匹配学年学期下拉框
        let yearEl = null, semEl = null;
        document.querySelectorAll("select").forEach((s) => {
            const id = ((s.id || "") + " " + (s.name || "")).toLowerCase();
            if (!yearEl && /xnm|xnsel|schoolyear|学年/.test(id)) yearEl = s;
            if (!semEl && /xqm|xqsel|semester|学期/.test(id)) semEl = s;
        });
        if (yearEl && semEl && yearEl.value !== "" && semEl.value !== "") {
            return { xnm: String(yearEl.value).trim(), xqm: String(semEl.value).trim() };
        }
    } catch (e) {
        console.error("JS: 自动识别学年学期失败:", e);
    }
    return null;
}

/**
 * 请求并解析课程数据。
 * xnm: 学年（如 2025）；xqmCandidates: 学期码候选列表，依次尝试。
 */
async function fetchAndParseCourses(xnm, xqmCandidates) {
    const semesterCandidates = Array.isArray(xqmCandidates) ? xqmCandidates : [xqmCandidates];
    const studentId = getStudentIdFromUrl();

    // 课表数据接口候选（均已通过 HTTP 302->CAS 验证存在）
    const apiPaths = [
        "/kbcx/xskbcx_cxXsKb.html",
        "/kbcx/xskbcx_cxXsgrkb.html"
    ];
    const baseUrls = [
        "https://jwxt.shufe-zj.edu.cn"
    ];

    // 组装入口 URL 列表：域名 × 接口 × (学号可选)
    const targetUrls = [];
    for (const base of baseUrls) {
        for (const path of apiPaths) {
            const suQuery = studentId ? `&su=${encodeURIComponent(studentId)}` : "";
            targetUrls.push(`${base}${path}?gnmkdm=N2151${suQuery}`);
        }
    }

    for (const semesterCode of semesterCandidates) {
        const requestBody = `xnm=${xnm}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;

        for (const url of targetUrls) {
            try {
                window.shiguangBridge.showToast("正在获取课表数据，请稍候...");
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                    },
                    body: requestBody,
                    credentials: "include"
                });

                if (response.ok) {
                    const jsonText = await response.text();
                    const jsonData = JSON.parse(jsonText);
                    if (jsonData && Array.isArray(jsonData.kbList) && jsonData.kbList.length > 0) {
                        const parsedCourses = parseJsonData(jsonData);
                        if (parsedCourses.length > 0) {
                            console.log(`JS: 使用学期码 ${semesterCode} 通过 ${url} 获取成功`);
                            return {
                                courses: parsedCourses,
                                config: {
                                    semesterStartDate: null,
                                    semesterTotalWeeks: 20
                                }
                            };
                        }
                    }
                }
            } catch (e) {
                console.error(`Entry failed: ${url} (semester=${semesterCode})`);
            }
        }
    }

    window.shiguangBridge.showToast("未能获取课表数据，请检查登录状态或网络环境。");
    return null;
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

// 作息时间（上海财经大学浙江学院，每节40分钟，课间10分钟）
const TimeSlots = [
    { number: 1,  startTime: "08:00", endTime: "08:40" },
    { number: 2,  startTime: "08:50", endTime: "09:30" },
    { number: 3,  startTime: "09:40", endTime: "10:20" },
    { number: 4,  startTime: "10:30", endTime: "11:10" },
    { number: 5,  startTime: "11:20", endTime: "12:00" },
    { number: 6,  startTime: "14:00", endTime: "14:40" },
    { number: 7,  startTime: "14:50", endTime: "15:30" },
    { number: 8,  startTime: "15:40", endTime: "16:20" },
    { number: 9,  startTime: "16:30", endTime: "17:10" },
    { number: 10, startTime: "18:30", endTime: "19:10" },
    { number: 11, startTime: "19:20", endTime: "20:00" },
    { number: 12, startTime: "20:10", endTime: "20:50" },
    { number: 13, startTime: "21:00", endTime: "21:40" },
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        }
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 自动识别页面当前选中的学年学期；识别失败才回退到手动输入
    const autoSemester = getCurrentSemesterFromPage();
    let xnm, xqmCandidates;

    if (autoSemester) {
        xnm = autoSemester.xnm;
        // 页面当前值优先，附带对应备选编码（兼容标准编码 3/12 与自定义 1/2）
        xqmCandidates = [autoSemester.xqm];
        const alt = { "3": "1", "1": "3", "12": "2", "2": "12" };
        if (alt[autoSemester.xqm]) xqmCandidates.push(alt[autoSemester.xqm]);
        window.shiguangBridge.showToast(`已自动识别学年学期 ${xnm} / ${autoSemester.xqm}，开始获取课表...`);
        console.log(`JS: 自动识别学年学期 xnm=${xnm}, xqm=${autoSemester.xqm}`);
    } else {
        const academicYear = await getAcademicYear();
        if (academicYear === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }

        const semesterIndex = await selectSemester();
        if (semesterIndex === null || semesterIndex === -1) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        xnm = academicYear;
        xqmCandidates = getSemesterCodeCandidates(semesterIndex);
    }

    const result = await fetchAndParseCourses(xnm, xqmCandidates);
    if (result === null) {
        return;
    }
    const { courses, config } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`课表配置更新成功！总周数：${config.semesterTotalWeeks}周。`);
    } catch (error) {
        console.error('JS: Save Config Error:', error);
    }

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
