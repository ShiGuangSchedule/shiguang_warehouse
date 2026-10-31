// 山东药品食品职业学院(sddfvc.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 基础配置
const BASE_URL = "https://jwxt.sddfvc.edu.cn";

// 数据解析函数

/**
 * 将周次字符串结合单双周标识解析为数字数组    注：现在没有用了 因为无法获取整个学期的表了
 * @param {string} zcString "7-15,17-20"
 * @param {number} dsz 0: 全周, 1: 单周, 2: 双周, -1: 全周
 */
function parseWeeks(zcString, dsz) {
    let weeks = [];
    if (!zcString) return weeks;

    // 解析基础周次
    zcString.split(',').forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            weeks.push(Number(part));
        }
    });

    // 处理单双周过滤
    if (dsz === 1) {
        weeks = weeks.filter(w => w % 2 !== 0);
    } else if (dsz === 2) {
        weeks = weeks.filter(w => w % 2 === 0);
    }
    return weeks;
}

/**
 * 从 pkbmc 中提取课程名称
 * 规则：
 *   1. 用 "#" 分割
 *   2. 若某一边含"班"字，则丢弃那一边，保留另一边
 *   3. 若两边都不含"班"字，或没有 "#"，则整个 pkbmc 作为课程名（保留 "#"）
 * @param {string} pkbmc
 * @returns {string} 课程名
 */
function extractCourseName(pkbmc) {
    if (!pkbmc || typeof pkbmc !== "string") return "未知课程";

    if (!pkbmc.includes("#")) {
        // 没有 "#"，整体作为课程名
        return pkbmc;
    }

    const parts = pkbmc.split("#");
    // 这里只处理第一个 "#" 的两侧，保留其余部分
    const left = parts[0];
    const right = parts.slice(1).join("#");

    const leftHasClass = left.includes("班");
    const rightHasClass = right.includes("班");

    if (leftHasClass && !rightHasClass) {
        // 左边是班级，丢弃左边
        return right;
    }
    if (rightHasClass && !leftHasClass) {
        // 右边是班级，丢弃右边
        return left;
    }
    // 两边都含"班" 或 两边都不含"班"，整体作为课程名（保留 "#"）
    return pkbmc;
}

/**
 * 转换课程格式为应用模型
 */
function parseCoursesToModel(sourceData) {
    const resultCourses = [];
    const days = ["xq1", "xq2", "xq3", "xq4", "xq5", "xq6", "xq7"];
    const sectionMap = { "1": 1, "3": 2, "5": 3, "7": 4, "9": 5, "11": 6 };

    days.forEach((dayKey, index) => {
        const dayContent = sourceData[dayKey];
        if (!dayContent) return;

        Object.keys(dayContent).forEach(slotNum => {
            const mappedSection = sectionMap[slotNum];
            if (!mappedSection) return;

            Object.values(dayContent[slotNum]).forEach(item => {
                const courseName = extractCourseName(item.pkbmc);

                Object.values(item.pkmx).forEach(detail => {
                    if (!detail) return;

                    const computedWeeks = parseWeeks(detail.zc.zc, detail.zc.dsz);
                    if (computedWeeks.length === 0) return;

                    resultCourses.push({
                        "name": courseName,
                        "teacher": detail.teacher[0]?.xm || "未知教师",
                        "position": detail.classroom || "未知地点",
                        "day": index + 1,
                        "startSection": mappedSection,
                        "endSection": mappedSection,
                        "weeks": computedWeeks
                    });
                });
            });
        });
    });
    return resultCourses;
}

/**
 * 节次与周次合并去重函数（供开发者参考）
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

// 网络与交互业务函数

/**
 * 保存课表全局配置
 * @param {number} totalWeeks 学期总周数
 * @param {string|null} semesterStartDate 学期开始日期 YYYY-MM-DD
 */
async function saveAppConfig(totalWeeks, semesterStartDate) {
    const config = {
        "semesterTotalWeeks": totalWeeks,
        "defaultClassDuration": 90,
        "defaultBreakDuration": 15,
        "firstDayOfWeek": 1
    };
    if (semesterStartDate) {
        config.semesterStartDate = semesterStartDate;
    }
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 保存时间段配置
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "10:00" },
        { "number": 2, "startTime": "10:15", "endTime": "11:45" },
        { "number": 3, "startTime": "13:30", "endTime": "15:00" },
        { "number": 4, "startTime": "15:15", "endTime": "16:45" },
        { "number": 5, "startTime": "19:00", "endTime": "19:30" },
        { "number": 6, "startTime": "20:00", "endTime": "20:45" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

/**
 * 获取并让用户选择学期，返回 { id, name }
 */
async function getSelectedSemester(apiToken) {
    const xqRes = await fetch(`${BASE_URL}/mobile/student/mobile_kcb_xq?api_token=${apiToken}`, {
        "credentials": "include"
    });
    const xqJson = await xqRes.json();
    const xqList = xqJson.data.xq_all;
    const currentXq = xqJson.data.xq_current;

    const xqNames = xqList.map(item => item.xqmc);
    const defaultIdx = xqList.findIndex(item => item.id === currentXq.id);

    const selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
        "请确认导入学期",
        JSON.stringify(xqNames),
        defaultIdx !== -1 ? defaultIdx : xqNames.length - 1
    );

    if (selectedIdx === null) return null;
    return { id: xqList[selectedIdx].id, name: xqList[selectedIdx].xqmc };
}

/**
 * 获取学期周次列表，并推算学期开始日期
 * @param {string} apiToken
 * @param {string} semesterId
 * @param {string} semesterName 形如 "2026-2027 学年度第一学期"
 * @returns {{ weeks: Array, semesterStartDate: string|null, totalWeeks: number }}
 */
async function fetchSemesterWeeks(apiToken, semesterId, semesterName) {
    const res = await fetch(`${BASE_URL}/mobile/student/mobile_kcb_weeks?xq=${semesterId}&api_token=${apiToken}`, {
        "credentials": "include"
    });
    const json = await res.json();
    const weekList = json?.data?.week_list || [];

    let semesterStartDate = null;
    const firstWeek = weekList.find(w => String(w.id) === '1') || weekList[0];
    if (firstWeek && firstWeek.start_date && semesterName) {
        const yearMatch = semesterName.match(/(\d{4})-(\d{4})/);
        if (yearMatch) {
            const startYear = Number(yearMatch[1]);
            const isSecondTerm = semesterName.includes('第二学期');
            const year = isSecondTerm ? startYear + 1 : startYear;
            const [mm, dd] = firstWeek.start_date.split('/');
            semesterStartDate = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        }
    }

    return {
        weeks: weekList,
        semesterStartDate: semesterStartDate,
        totalWeeks: weekList.length
    };
}

/**
 * 遍历抓取该学期所有周的数据
 * @param {string} apiToken
 * @param {string} semesterId
 * @param {Array} weekList 来自 mobile_kcb_weeks 的 week_list
 */
async function fetchFullSemesterData(apiToken, semesterId, weekList) {
    let allCourses = [];

    for (const week of weekList) {
        const w = week.id;
        window.shiguangBridge.showToast(`正在获取第 ${w}/${weekList.length} 周...`);
        try {
            const res = await fetch(`${BASE_URL}/mobile/student/mobile_kcb?api_token=${apiToken}&xq=${semesterId}&week=${w}`, {
                "credentials": "include"
            });
            const json = await res.json();
            if (json.data) {
                const weekCourses = parseCoursesToModel(json.data);
                allCourses = allCourses.concat(weekCourses);
            }
        } catch (e) {
            console.warn(`第 ${w} 周数据抓取失败`, e);
        }
    }

    // 调用合并函数
    return mergeAndDistinctCourses(allCourses);
}

// 流程控制

async function runImportFlow() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const apiToken = urlParams.get('api_token');
        if (!apiToken) {
            console.error("当前 URL 中未找到 api_token 参数:", window.location.href);
            window.shiguangBridge.showToast("未检测到登录 Token，请确保在课表页面运行");
            return;
        }

        const semester = await getSelectedSemester(apiToken);
        if (!semester) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        // 先拿周次列表，用于驱动循环 + 推算开学日期
        window.shiguangBridge.showToast("正在获取学期周次...");
        const { weeks, semesterStartDate, totalWeeks } = await fetchSemesterWeeks(apiToken, semester.id, semester.name);

        if (!weeks.length) {
            window.shiguangBridge.showToast("未获取到周次列表，无法导入");
            return;
        }

        // 直接进入周遍历模式
        window.shiguangBridge.showToast("开始抓取周课表数据...");
        const finalCourses = await fetchFullSemesterData(apiToken, semester.id, weeks);

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现任何课程数据");
            return;
        }

        // 保存逻辑
        window.shiguangBridge.showToast("正在保存配置...");
        await saveAppConfig(totalWeeks, semesterStartDate);
        await saveAppTimeSlots();
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

runImportFlow();