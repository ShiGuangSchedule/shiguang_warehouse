// 浙江万里学院(zwu.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

/**
 * 基础域名配置
 * 浙江万里学院仅支持校园网内网直连
 */
const BASE_URL = "https://jw.zwu.edu.cn/jwglxt";

/**
 * 获取基础地址
 */
function getBaseUrl() {
    return BASE_URL;
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
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
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
 * 请求和解析课程数据
 * 不再请求教务作息接口，作息时间由内置的冬令时/夏令时方案提供
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const targetUrl = `${getBaseUrl()}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

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

    try {
        if (courseResponse.ok) {
            const jsonText = await courseResponse.text();
            const jsonData = JSON.parse(jsonText);
            if (jsonData && jsonData.kbList) {
                const parsedCourses = parseJsonData(jsonData);
                if (parsedCourses.length > 0) {
                    return {
                        courses: parsedCourses,
                        config: {
                            semesterStartDate: semesterStartDate,
                            semesterTotalWeeks: 20
                        }
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

/**
 * 浙江万里学院作息时间表
 * 冬令时（10月-次年4月）
 * 夏令时（5月-9月）
 * 1-5 节两个令时一致，6-14 节不同
 */

// 冬令时（完整 14 节）
const WINTER_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:50", endTime: "09:35" },
    { number: 3,  startTime: "09:50", endTime: "10:35" },
    { number: 4,  startTime: "10:40", endTime: "11:25" },
    { number: 5,  startTime: "11:30", endTime: "12:15" },
    { number: 6,  startTime: "13:30", endTime: "14:15" },
    { number: 7,  startTime: "14:20", endTime: "15:05" },
    { number: 8,  startTime: "15:20", endTime: "16:05" },
    { number: 9,  startTime: "16:10", endTime: "16:55" },
    { number: 10, startTime: "18:00", endTime: "18:45" },
    { number: 11, startTime: "18:50", endTime: "19:35" },
    { number: 12, startTime: "19:40", endTime: "20:25" },
    { number: 13, startTime: "20:30", endTime: "21:15" },
    { number: 14, startTime: "21:20", endTime: "22:05" }
];

// 夏令时（完整 14 节）
const SUMMER_TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:50", endTime: "09:35" },
    { number: 3,  startTime: "09:50", endTime: "10:35" },
    { number: 4,  startTime: "10:40", endTime: "11:25" },
    { number: 5,  startTime: "11:30", endTime: "12:15" },
    { number: 6,  startTime: "14:00", endTime: "14:45" },
    { number: 7,  startTime: "14:50", endTime: "15:35" },
    { number: 8,  startTime: "15:50", endTime: "16:35" },
    { number: 9,  startTime: "16:40", endTime: "17:25" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:20", endTime: "20:05" },
    { number: 12, startTime: "20:10", endTime: "20:55" },
    { number: 13, startTime: "21:00", endTime: "21:45" },
    { number: 14, startTime: "21:50", endTime: "22:35" }
];

/**
 * 生成组合作息方案
 * - 名称用学年参数拼成 "2026-2027 学年作息方案"
 * - 基础骨架用当前月份对应的令时（全量 14 节）
 * - combo 里两个令时都提交完整 14 节
 * - 日期区间根据脚本运行时的当前月份动态生成
 *   - 夏令时：每年 5-9 月
 *   - 冬令时：每年 10 月-次年 4 月
 */
function buildComboSchedule(academicYear) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    let summerStart, summerEnd, winterStart, winterEnd;
    let isSummerNow;

    if (month >= 5 && month <= 9) {
        // 当前是夏令时
        isSummerNow = true;
        summerStart = `${year}-05-01`;
        summerEnd = `${year}-09-30`;
        winterStart = `${year}-10-01`;
        winterEnd = `${year + 1}-04-30`;
    } else if (month >= 10) {
        // 当前是冬令时（10-12月）
        isSummerNow = false;
        winterStart = `${year}-10-01`;
        winterEnd = `${year + 1}-04-30`;
        summerStart = `${year + 1}-05-01`;
        summerEnd = `${year + 1}-09-30`;
    } else {
        // 当前是冬令时（1-4月）
        isSummerNow = false;
        winterStart = `${year - 1}-10-01`;
        winterEnd = `${year}-04-30`;
        summerStart = `${year}-05-01`;
        summerEnd = `${year}-09-30`;
    }

    // 名称用学年，academicYear 是 "2026" 这种
    const yearLabel = academicYear
        ? `${academicYear}-${Number(academicYear) + 1}`
        : `${year}`;

    // 当前令时作为骨架（全量），另一个令时作为覆盖（也全量）
    const skeletonSlots = isSummerNow ? SUMMER_TIME_SLOTS : WINTER_TIME_SLOTS;

    return {
        skeletonSlots,
        combo: {
            name: `${yearLabel} 学年作息方案`,
            publicSchedules: [
                {
                    name: "夏令时",
                    startDate: summerStart,
                    endDate: summerEnd,
                    timeSlots: SUMMER_TIME_SLOTS
                },
                {
                    name: "冬令时",
                    startDate: winterStart,
                    endDate: winterEnd,
                    timeSlots: WINTER_TIME_SLOTS
                }
            ]
        }
    };
}

/**
 * 导入基础作息（当前月份对应的令时，全量 14 节）作为骨架
 */
async function importBaseTimeSlots(skeletonSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(skeletonSlots));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入基础作息失败: " + error.message);
        return false;
    }
}

/**
 * 导入组合作息方案
 * 必须在 importBaseTimeSlots 成功之后调用
 */
async function importComboSchedule(combo) {
    try {
        await window.shiguangBridgePromise.saveComboSchedule(JSON.stringify(combo));
        window.shiguangBridge.showToast("夏令时/冬令时作息方案导入成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入组合作息失败: " + error.message);
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
        let configMsg = "课表配置更新成功！";
        if (config.semesterStartDate) {
            configMsg += ` 开学日期：${config.semesterStartDate}`;
        }
        window.shiguangBridge.showToast(configMsg);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
    }

    // 先导入基础作息（当前月份对应的令时），再导入组合作息方案
    const { skeletonSlots, combo } = buildComboSchedule(academicYear);
    const baseSaved = await importBaseTimeSlots(skeletonSlots);
    if (!baseSaved) {
        window.shiguangBridge.showToast("基础作息导入失败，跳过组合作息方案。");
    } else {
        await importComboSchedule(combo);
    }

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();