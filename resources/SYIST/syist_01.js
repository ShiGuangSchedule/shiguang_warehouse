// 沈阳科技学院 (syist.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 备用默认作息时间表
const DEFAULT_TIME_SLOTS = [
    { "number": 1, "startTime": "08:20", "endTime": "09:05" },
    { "number": 2, "startTime": "09:10", "endTime": "09:55" },
    { "number": 3, "startTime": "10:10", "endTime": "10:55" },
    { "number": 4, "startTime": "11:00", "endTime": "11:45" },
    { "number": 5, "startTime": "13:30", "endTime": "14:15" },
    { "number": 6, "startTime": "14:20", "endTime": "15:05" },
    { "number": 7, "startTime": "15:15", "endTime": "16:00" },
    { "number": 8, "startTime": "16:05", "endTime": "16:50" },
    { "number": 9, "startTime": "17:20", "endTime": "18:05" },
    { "number": 10, "startTime": "18:15", "endTime": "19:00" },
    { "number": 11, "startTime": "19:10", "endTime": "19:55" },
    { "number": 12, "startTime": "20:05", "endTime": "20:50" }
];

/**
 * 辅助函数：解析周次字符串 "111000..." 为数字数组 [1, 2, 3]
 */
function parseWeeksFromSkzc(skzc) {
    const weeks = [];
    const rawSkzc = skzc || '';
    for (let i = 0; i < rawSkzc.length; i++) {
        if (rawSkzc[i] === '1') {
            weeks.push(Number(i + 1));
        }
    }
    return weeks;
}

/**
 * 清除辅助私有属性并过滤掉无效课程
 */
function cleanCourses(courses) {
    return courses.map(c => {
        const { _kbId, _day, _startSection, _endSection, ...cleanCourse } = c;
        return cleanCourse;
    }).filter(c => c.weeks && c.weeks.length > 0);
}

/**
 * 节次合并、周次合并与去重函数
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
 * 将教务系统的课程数据转换成 CourseJsonModel 结构
 */
function parseSingleCourse(rawCourse) {
    // 判断是否为实验课程（存在 SYXMMC 字段）
    const isExperiment = rawCourse.SYXMMC !== undefined && rawCourse.SYXMMC !== null;
    
    // 课程名称：实验课程使用 "KCM - SYXMMC" 格式
    const courseName = isExperiment 
        ? `${rawCourse.KCM} - ${rawCourse.SYXMMC}`
        : rawCourse.KCM;
    
    const teacherName = rawCourse.SKJS ? rawCourse.SKJS.split('/')[0] : (rawCourse.JSM || '');
    const position = rawCourse.JASMC;
    const day = rawCourse.SKXQ;
    const startSection = rawCourse.KSJC;
    const endSection = rawCourse.JSJC;
    const weeks = parseWeeksFromSkzc(rawCourse.SKZC);

    if (!courseName || !day || !startSection || !endSection || weeks.length === 0) {
        return null;
    }

    const course = {
        "name": courseName,
        "teacher": teacherName,
        "position": position || '待定',
        "day": parseInt(day),
        "startSection": parseInt(startSection),
        "endSection": parseInt(endSection),
        "weeks": weeks
    };

    // 用于匹配调课信息的私有辅助属性
    course._kbId = rawCourse.KBID;
    course._day = course.day;
    course._startSection = course.startSection;
    course._endSection = course.endSection;

    return course;
}

/**
 * 将调课数据应用到已解析的课程列表上
 */
function applyCourseChanges(parsedCourses, rawChanges) {
    let successCount = 0;

    for (const change of rawChanges) {
        const kbID = change.KBID;
        const originalTeacher = change.YSKJS ? change.YSKJS.split('/')[0] : '';
        const weeksToRemove = parseWeeksFromSkzc(change.SKZC);
        let changeApplied = false;

        const affectedOriginalCourses = parsedCourses.filter(c =>
            c._kbId === kbID &&
            c._day === parseInt(change.SKXQ) &&
            c._startSection === parseInt(change.KSJC) &&
            c._endSection === parseInt(change.JSJC)
        );

        if (affectedOriginalCourses.length === 0) {
            continue;
        }

        if (weeksToRemove.length > 0) {
            affectedOriginalCourses.forEach(originalCourse => {
                const beforeLength = originalCourse.weeks.length;
                originalCourse.weeks = originalCourse.weeks.filter(w => !weeksToRemove.includes(w));
                if (originalCourse.weeks.length < beforeLength) {
                    changeApplied = true;
                }
            });
        }

        const isTimeLocationChange = (change.TKLXDM === '01' || change.TKLXDM === '03');

        if (isTimeLocationChange && change.XSKZC && change.XSKXQ && change.XKSJC && change.XJSJC) {
            const newWeeks = parseWeeksFromSkzc(change.XSKZC);

            if (newWeeks.length > 0) {
                const newCourse = {
                    "name": change.KCM,
                    "teacher": change.XSKJS ? change.XSKJS.split('/')[0] : originalTeacher,
                    "position": change.XJASMC || change.JASMC || '待定',
                    "day": parseInt(change.XSKXQ),
                    "startSection": parseInt(change.XKSJC),
                    "endSection": parseInt(change.XJSJC),
                    "weeks": newWeeks,
                    "_kbId": kbID,
                    "_day": parseInt(change.XSKXQ),
                    "_startSection": parseInt(change.XKSJC),
                    "_endSection": parseInt(change.XJSJC)
                };
                parsedCourses.push(newCourse);
                changeApplied = true;
            }
        }

        if (changeApplied) {
            successCount++;
        }
    }

    if (successCount > 0) {
        window.shiguangBridge.showToast(`已应用 ${successCount} 条调课/停课变更。`);
    }

    return parsedCourses;
}

/**
 * 前置提示弹窗
 */
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "注意",
        "导入前请确保您已在浏览器中成功登录教务系统，且当前页面显示课表系统，否则无法获取数据。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return null;
    }
    return true;
}

/**
 * 动态获取并选择学期
 */
async function selectSemester() {
    const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
    };

    // 获取学期列表
    let semesterList = [];
    try {
        const response = await fetch("http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do", {
            headers,
            body: "*order=-DM",
            method: "POST",
            credentials: "include"
        });
        const resData = await response.json();
        semesterList = resData?.datas?.xnxqcx?.rows || [];
    } catch (e) {
        window.shiguangBridge.showToast("获取学期列表失败，请检查登录状态。");
        return null;
    }

    if (semesterList.length === 0) {
        window.shiguangBridge.showToast("未查询到学期数据。");
        return null;
    }

    // 获取当前学期作为默认值
    let defaultDM = null;
    try {
        const dqResponse = await fetch("http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do", {
            headers,
            method: "POST",
            credentials: "include"
        });
        const dqData = await dqResponse.json();
        const currentSemester = dqData?.datas?.dqxnxq?.rows?.[0];
        if (currentSemester) {
            defaultDM = currentSemester.DM;
        }
    } catch (e) {
        console.warn("获取当前学期失败，将不使用默认值:", e);
    }

    const topSemesters = semesterList.slice(0, 10);
    const displayNames = topSemesters.map(item => item.MC || item.DM);

    // 查找默认学期的索引
    let defaultIndex = -1;
    if (defaultDM) {
        defaultIndex = topSemesters.findIndex(item => item.DM === defaultDM);
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择学期",
        JSON.stringify(displayNames),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }

    return topSemesters[selectedIndex];
}

/**
 * 获取开学日期与总周数配置
 */
async function fetchSemesterConfig(xn, xq) {
    const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
    };

    try {
        const response = await fetch("http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do", {
            headers,
            body: `XN=${xn}&XQ=${xq}`,
            method: "POST",
            credentials: "include"
        });
        const resData = await response.json();
        const row = resData?.datas?.cxjcs?.rows?.[0];

        if (row) {
            const rawDate = row.XQKSRQ;
            const startDate = rawDate ? rawDate.split(' ')[0] : null;
            const totalWeeks = parseInt(row.ZZC) || 20;

            return {
                semesterStartDate: startDate,
                semesterTotalWeeks: totalWeeks
            };
        }
    } catch (e) {
        console.error("Fetch Config Error:", e);
    }

    return {
        semesterTotalWeeks: 20
    };
}

/**
 * 获取并保存节次作息时间段（含备用逻辑）
 */
async function importPresetTimeSlots() {
    window.shiguangBridge.showToast("正在获取作息时间...");
    const headers = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest"
    };

    let presetTimeSlots = null;

    try {
        const response = await fetch("http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/jshkcb/jc.do", {
            headers,
            method: "POST",
            credentials: "include"
        });
        const resData = await response.json();
        const rows = resData?.datas?.jc?.rows || [];

        if (rows.length > 0) {
            presetTimeSlots = rows.map(item => ({
                number: parseInt(item.DM),
                startTime: item.KSSJ,
                endTime: item.JSSJ
            }));
        }
    } catch (error) {
        console.warn("拉取作息时间失败，将使用备用作息时间表:", error);
    }

    if (!presetTimeSlots || presetTimeSlots.length === 0) {
        window.shiguangBridge.showToast("未能获取线上作息时间，已启用备用作息表。");
        presetTimeSlots = DEFAULT_TIME_SLOTS;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存时间段失败: " + error.message);
        return false;
    }
}

/**
 * 获取并解析课程数据
 */
async function fetchAndParseCourses(semesterObj) {
    const XNXQDM = semesterObj.DM;
    const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
    };

    // 获取理论课程
    const courseUrl = "http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do";
    const courseBody = `XNXQDM=${XNXQDM}`;
    let rawCourseData;
    try {
        const response = await fetch(courseUrl, { headers, body: courseBody, method: "POST", credentials: "include" });
        rawCourseData = await response.json();
    } catch (e) {
        window.shiguangBridge.showToast("请求课表 API 失败，请检查网络或登录状态。");
        console.error("Fetch Course Error:", e);
        return null;
    }

    const rawCourses = rawCourseData?.datas?.cxxszhxqkb?.rows || [];

    // 获取实验课程
    let rawExperimentCourses = [];
    try {
        const expUrl = "http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/syjxkcb/cxsyjxxskb.do";
        const expBody = `XNXQDM=${XNXQDM}`;
        const expResponse = await fetch(expUrl, { headers, body: expBody, method: "POST", credentials: "include" });
        const expData = await expResponse.json();
        rawExperimentCourses = expData?.datas?.cxsyjxxskb?.rows || [];
    } catch (e) {
        console.warn("获取实验课程失败，将仅使用理论课程:", e);
    }

    // 合并理论课程和实验课程
    const allRawCourses = [...rawCourses, ...rawExperimentCourses];

    if (allRawCourses.length === 0) {
        window.shiguangBridge.showToast("该学期未查询到您的课程数据。");
        return null;
    }

    // 解析所有课程
    let parsedCourses = allRawCourses.map(c => parseSingleCourse(c)).filter(c => c !== null);

    // 获取调课数据
    const changeUrl = "http://jwxt.syist.edu.cn:30334/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do";
    const changeBody = `XNXQDM=${XNXQDM}&*order=-SQSJ`;
    let rawChangeData;
    try {
        const response = await fetch(changeUrl, { headers, body: changeBody, method: "POST", credentials: "include" });
        rawChangeData = await response.json();
    } catch (e) {
        window.shiguangBridge.showToast("请求调课 API 失败，将使用原始课表。");
        console.error("Fetch Change Error:", e);
    }

    const rawChanges = rawChangeData?.datas?.xsdkkc?.rows || [];

    if (rawChanges.length > 0) {
        parsedCourses = applyCourseChanges(parsedCourses, rawChanges);
    }

    // 清理临时字段
    const cleanList = cleanCourses(parsedCourses);
    // 执行两阶段合并（节次合并 + 周次合并）
    const finalCourses = mergeAndDistinctCourses(cleanList);

    const courseConfig = await fetchSemesterConfig(semesterObj.XNDM, semesterObj.XQDM);

    // 显示实验课程数量提示
    if (rawExperimentCourses.length > 0) {
        window.shiguangBridge.showToast(`共获取到 ${rawCourses.length} 门理论课程和 ${rawExperimentCourses.length} 门实验课程。`);
    }

    return {
        courses: finalCourses,
        config: courseConfig
    };
}

/**
 * 保存课程数据
 */
async function saveCourses(parsedCourses) {
    if (!parsedCourses || parsedCourses.length === 0) {
        window.shiguangBridge.showToast("没有有效的课程数据可供保存。");
        return false;
    }
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 门课程！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存课程数据失败: ${error.message}`);
        return false;
    }
}

/**
 * 保存配置数据
 */
async function saveConfig(configData) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        window.shiguangBridge.showToast("课表配置更新成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}

/**
 * 主流程控制
 */
async function runImportFlow() {
    window.shiguangBridge.showToast("课程导入流程启动...");

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;

    const selectedSemester = await selectSemester();
    if (!selectedSemester) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    await importPresetTimeSlots();

    const courseData = await fetchAndParseCourses(selectedSemester);
    if (!courseData) return;

    const configSaveResult = await saveConfig(courseData.config);
    if (!configSaveResult) return;

    const saveResult = await saveCourses(courseData.courses);
    if (!saveResult) return;

    window.shiguangBridge.showToast("所有任务已完成！课表导入成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();