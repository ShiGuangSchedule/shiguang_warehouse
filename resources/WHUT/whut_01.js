// 武汉理工大学(whut.edu.cn)拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 核心工具函数：数据验证 
function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input) && parseInt(input) > 2000) {
        return false;
    } else {
        return "请输入有效的四位数字学年（例如：2025）！";
    }
}

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
 * 全局课程合并清洗逻辑
 * 解决单双周割裂、冗余重复、实验课节次部分重叠等问题
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                // 大学的周次一般为 1~30 周，这里开辟 55 长度的矩阵足够，Set 用于节次去重
                weeksMatrix: Array.from({ length: 55 }, () => new Set())
            };
        }
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                const weekNum = parseInt(w);
                // 严格限制合法周次，防止越界
                if (weekNum >= 1 && weekNum < 55) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[weekNum].add(s);
                    }
                }
            });
        }
    });

    const merged = [];

    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;
        const blockMap = {};

        // 遍历矩阵（从1开始，对齐自然周）
        for (let w = 1; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            let start = sections[0];
            let prev = sections[0];

            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr;
                } else {
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    
                    start = curr;
                    prev = curr;
                }
            }
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey]
            });
        }
    }

    // 格式化输出排序
    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

/**
 * 将教务系统的课程数据转换成 CourseJsonModel 结构（应用物理节次转换）
 */
function parseSingleCourse(rawCourse, sectionMap) {
    const courseName = rawCourse.KCM;
    const teacherName = rawCourse.SKJS ? rawCourse.SKJS.split('/')[0] : '';
    const position = rawCourse.JASMC;
    const day = rawCourse.SKXQ; 
    const startSection = sectionMap[rawCourse.KSJC];
    const endSection = sectionMap[rawCourse.JSJC];
    const weeks = parseWeeksFromSkzc(rawCourse.SKZC);

    if (!courseName || !day || !startSection || !endSection || weeks.length === 0) {
        return null;
    }

    return {
        "name": courseName,
        "teacher": teacherName,
        "position": position || '待定',
        "day": parseInt(day),
        "startSection": startSection,
        "endSection": endSection,
        "weeks": weeks
    };
}

async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "武汉理工大学课表导入",
        "本流程将通过教务系统接口获取您的个人课表与开学时间。\n重要提示:\n导入前请确保您已在浏览器中成功登录教务系统，且未关闭登录窗口。",
        "好的，开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return null;
    }
    return true;
}

async function getAcademicYear() {
    const currentYear = new Date().getFullYear();
    const yearSelection = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:",
        String(currentYear), 
        "validateYearInput"
    );
    return yearSelection;
}

async function selectSemester() {
    const semesters = ["1 (秋季学期/上学期)", "2 (春季学期/下学期)"];
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        0
    );
    if (semesterIndex === null) return null;
    return String(semesterIndex + 1);
}

async function fetchSectionMapping(commonHeaders) {
    const sectionMapUrl = "https://jwxt.whut.edu.cn/jwapp/sys/kcbcxby/modules/dzkz/jcjcx.do";
    try {
        const response = await fetch(sectionMapUrl, {
            "headers": commonHeaders,
            "method": "POST",
            "credentials": "include"
        });
        const resData = JSON.parse(await response.text());
        const rows = resData?.datas?.jcjcx?.rows || [];
        
        const dictionary = {};
        let physicalIndex = 1;

        for (const row of rows) {
            if (row.MC && row.MC.includes("节")) {
                dictionary[row.DM] = physicalIndex;
                physicalIndex++;
            }
        }
        return dictionary;
    } catch (e) {
        console.error("Fetch Section Mapping Error, use fallback:", e);
        return { "1":1, "2":2, "3":3, "4":4, "5":5, "8":6, "9":7, "10":8, "11":9, "12":10, "14":11, "15":12, "16":13 };
    }
}

// 数据获取和解析部分

async function fetchAndParseCourses(academicYear, semesterCode) {
    const commonHeaders = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "accept-language": "zh-CN,zh;q=0.9",
        "x-requested-with": "XMLHttpRequest"
    };

    // 获取物理节次转换映射字典
    const sectionMap = await fetchSectionMapping(commonHeaders);

    // 获取当前登录用户的学号 (XH)
    let studentId = "";
    try {
        const userUrl = "https://jwxt.whut.edu.cn/jwapp/sys/homeapp/api/home/currentUser.do";
        const userResponse = await fetch(userUrl, { "method": "GET", "credentials": "include" });
        const userData = JSON.parse(await userResponse.text());
        studentId = userData?.datas?.userId;
        if (!studentId) throw new Error("无法读取 userId");
    } catch (e) {
        window.shiguangBridge.showToast("获取用户信息失败，请确认是否登录教务系统！");
        console.error("Fetch User Error:", e);
        return null;
    }

    // 获取该学期的课表配置
    let courseConfig = { semesterTotalWeeks: 20 };
    try {
        const configUrl = "https://jwxt.whut.edu.cn/jwapp/sys/kcbcxby/modules/bjkcb/cxjcs.do";
        const configBody = `XN=${academicYear}-${parseInt(academicYear) + 1}&XQ=${semesterCode}`;
        const configResponse = await fetch(configUrl, {
            "headers": { ...commonHeaders, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            "body": configBody,
            "method": "POST",
            "credentials": "include"
        });
        const configData = JSON.parse(await configResponse.text());
        const configRow = configData?.datas?.cxjcs?.rows?.[0];
        
        if (configRow) {
            if (configRow.XQKSRQ) {
                courseConfig.semesterStartDate = configRow.XQKSRQ.split(" ")[0];
            }
            if (configRow.ZZC) {
                courseConfig.semesterTotalWeeks = parseInt(configRow.ZZC);
            }
        }
    } catch (e) {
        console.error("Fetch Config Error, will use default config:", e);
    }

    // 获取个人课表数据
    const XNXQDM = `${academicYear}-${parseInt(academicYear) + 1}-${semesterCode}`;
    const courseUrl = "https://jwxt.whut.edu.cn/jwapp/sys/kcbcxby/modules/xskcb/cxxskcb.do";
    const courseBody = `XNXQDM=${XNXQDM}&XH=${studentId}`;
    let rawCourseData;
    try {
        const response = await fetch(courseUrl, {
            "headers": { ...commonHeaders, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            "body": courseBody,
            "method": "POST",
            "credentials": "include"
        });
        rawCourseData = JSON.parse(await response.text());
    } catch (e) {
        window.shiguangBridge.showToast("请求课表 API 失败，请检查网络和登录状态。");
        console.error("Fetch Course Error:", e);
        return null;
    }

    const rawCourses = rawCourseData?.datas?.cxxskcb?.rows || [];
    if (rawCourses.length === 0) {
        window.shiguangBridge.showToast("该学期未查询到您的课程数据。");
        return null;
    }

    const initialCourses = rawCourses.map(c => parseSingleCourse(c, sectionMap)).filter(c => c !== null);
    const finalParsedCourses = mergeContinuousLessons(initialCourses);

    return {
        courses: finalParsedCourses,
        config: courseConfig
    };
}

async function saveCourses(parsedCourses) {
    if (parsedCourses.length === 0) {
        window.shiguangBridge.showToast("没有有效的课程数据可供保存。");
        return true;
    }
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 个规范后的课程块！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存课程数据失败: ${error.message}`);
        return false;
    }
}

/**
 * 导入预设时间段数据
 */
async function importPresetTimeSlots() {
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "09:55", "endTime": "10:40" },
        { "number": 4, "startTime": "10:45", "endTime": "11:30" },
        { "number": 5, "startTime": "11:35", "endTime": "12:20" },
        { "number": 6, "startTime": "14:00", "endTime": "14:45" },
        { "number": 7, "startTime": "14:50", "endTime": "15:35" },
        { "number": 8, "startTime": "15:40", "endTime": "16:25" },
        { "number": 9, "startTime": "16:45", "endTime": "17:30" },
        { "number": 10, "startTime": "17:35", "endTime": "18:20" },
        { "number": 11, "startTime": "19:00", "endTime": "19:45" },
        { "number": 12, "startTime": "19:50", "endTime": "20:35" },
        { "number": 13, "startTime": "20:40", "endTime": "21:25" }
    ];

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        return true; 
    } catch (error) {
        console.error("导入时间段失败: " + error.message);
        return false; 
    }
}

async function saveConfig(configData) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        return true;
    } catch (error) {
        console.error("保存配置失败: " + error.message);
        return false;
    }
}

async function runImportFlow() {
    window.shiguangBridge.showToast("武汉理工大学课程导入流程启动...");

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;
    
    const academicYear = await getAcademicYear();
    if (academicYear === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    
    const semesterCode = await selectSemester();
    if (semesterCode === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    const courseData = await fetchAndParseCourses(academicYear, semesterCode);
    if (courseData === null) return;

    await importPresetTimeSlots();

    const configSaveResult = await saveConfig(courseData.config);
    if (!configSaveResult) return;

    const saveResult = await saveCourses(courseData.courses);
    if (!saveResult) return;

    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();