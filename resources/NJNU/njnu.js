// 南京师范大学(njnu.edu.cn)拾光课程表适配脚本
// 由本校开发者适配，可联系开发者修改
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
 * 将教务系统的课程数据转换成 CourseJsonModel 结构
 */
function parseSingleCourse(rawCourse) {
    const courseName = rawCourse.KCM;
    const teacherName = rawCourse.SKJS ? rawCourse.SKJS.split('/')[0] : '';
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
    
    course._kbId = rawCourse.KBID; 
    course._day = course.day;
    course._startSection = course.startSection;
    course._endSection = course.endSection;
    
    return course;
}
/**
 * 获取学期开始日期函数
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    try {
        const response = await fetch("http://ehallapp.nnu.edu.cn/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do", {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `XN=${academicYear}-${parseInt(academicYear) + 1}&XQ=${semesterCode}`,
            credentials: "include"
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        
        // 安全检查：确保 rows 存在
        if (!data?.datas?.cxjcs?.rows || data.datas.cxjcs.rows.length === 0) {
            return null;
        }

        const xqksrq = data.datas.cxjcs.rows[0].XQKSRQ; 
        // 本校获取日期格式通常为 "2025-09-01 00:00:00"的形式
        
        // 直接切割字符串，不使用 new Date() 避免时区导致的日期减一
        const formattedDate = xqksrq.split(' ')[0]; 
        console.log('确认学期开始日期:', formattedDate);
        
        return formattedDate;
        
    } catch (error) {
        console.error('获取日期失败:', error);
        window.shiguangBridge.showToast("获取错误，需要手动设置开学日期");
        return null;
    }
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
        window.shiguangBridge.showToast(`已应用 ${successCount} 条调课/停课变更，获得实际课表。`);
    }
    
    return parsedCourses.map(c => {
        delete c._kbId;
        delete c._day;
        delete c._startSection;
        delete c._endSection;
        return c;
    }).filter(c => c.weeks.length > 0); 
}


async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "重要通知：南京师范大学课表导入",
        "本流程将通过教务系统接口获取您的个人课表。\n重要提示:\n导入前请确保您已在浏览器中成功登录教务系统，且未关闭登录窗口，确认当前页面有显示你想要获取的学期的课表，不然获取不了数据",
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
        "请输入要导入课程的学年（例如 2025-2026学年，无论你是上学期还是下学期，都请输入2025哦）:",
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
// 数据获取和解析部分

async function fetchAndParseCourses(academicYear, semesterCode) {
    const XNXQDM = `${academicYear}-${parseInt(academicYear) + 1}-${semesterCode}`;
    const headers = {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
    };
    
    // 获取个人课表数据
    const courseUrl = "http://ehallapp.nnu.edu.cn/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do";
    const courseBody = `XNXQDM=${XNXQDM}&`;
    let rawCourseData;
    try {
        const response = await fetch(courseUrl, { "headers": headers, "body": courseBody, "method": "POST", "credentials": "include" });
        rawCourseData = JSON.parse(await response.text());
    } catch (e) {
        window.shiguangBridge.showToast("请求课表 API 失败，请检查网络和登录状态,以及是否跳转到课表页面");
        console.error("Fetch Course Error:", e);
        return null;
    }

    const rawCourses = rawCourseData?.datas?.cxxszhxqkb?.rows || [];
    if (rawCourses.length === 0) {
        window.shiguangBridge.showToast("该学期未查询到您的课程数据。");
        return null;
    }
    let parsedCourses = rawCourses.map(c => parseSingleCourse(c)).filter(c => c !== null);
    
    const changeUrl = "http://ehallapp.nnu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do";
    const changeBody = `XNXQDM=${XNXQDM}&*order=-SQSJ`; 
    let rawChangeData;
    try {
        const response = await fetch(changeUrl, { "headers": headers, "body": changeBody, "method": "POST", "credentials": "include" });
        rawChangeData = JSON.parse(await response.text());
    } catch (e) {
        window.shiguangBridge.showToast("请求调课 API 失败，将使用未调整的课表数据。");
        console.error("Fetch Change Error:", e);
    }
    
    const rawChanges = rawChangeData?.datas?.xsdkkc?.rows || [];
    
    // 应用调课变更
    if (rawChanges.length > 0) {
        parsedCourses = applyCourseChanges(parsedCourses, rawChanges);
    }
    
    // 课表配置数据
    const semesterStartDate = await fetchSemesterStartDate(academicYear, semesterCode);
    const courseConfig = {
        semesterTotalWeeks: 20,
        semesterStartDate: semesterStartDate
    };

    return {
        courses: parsedCourses,
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
        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 门课程！`);
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
    window.shiguangBridge.showToast("正在导入预设节次时间...");
    
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:45", "endTime": "09:25" },
        { "number": 3, "startTime": "09:40", "endTime": "10:20" },
        { "number": 4, "startTime": "10:35", "endTime": "11:15" },
        { "number": 5, "startTime": "11:20", "endTime": "12:00" },
        { "number": 6, "startTime": "13:30", "endTime": "14:10" },
        { "number": 7, "startTime": "14:15", "endTime": "14:55" },
        { "number": 8, "startTime": "15:10", "endTime": "15:50" },
        { "number": 9, "startTime": "15:55", "endTime": "16:35" },
        { "number": 10, "startTime": "18:30", "endTime": "19:10" },
        { "number": 11, "startTime": "19:20", "endTime": "20:00" },
        { "number": 12, "startTime": "20:10", "endTime": "20:50" }
    ];

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
        return true; 
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false; 
    }
}

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

// 主流程入口

async function runImportFlow() {
    window.shiguangBridge.showToast("南京师范大学课程导入流程启动...");

    // 1. 公告和前置检查。
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) return;
    
    // 2. 获取用户输入参数 (学年和学期)。
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

    // 3. 导入预设时间段
    await importPresetTimeSlots();

    // 4. 网络请求和数据解析。
    const courseData = await fetchAndParseCourses(academicYear, semesterCode);
    if (courseData === null) return;

    // 5. 保存配置数据
    const configSaveResult = await saveConfig(courseData.config);
    if (!configSaveResult) return;

    // 6. 课程数据保存。
    const saveResult = await saveCourses(courseData.courses);
    if (!saveResult) return;

    // 7. 流程完全成功，发送结束信号。
    window.shiguangBridge.showToast("所有任务已完成！课表导入成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();