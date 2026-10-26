// 文件: neu.js

/**
 * ============================================================
 * 1. 用户交互层（使用桥接 API）
 * ============================================================
 */

/**
 * 显示公告并等待用户确认
 * @returns {Promise<boolean>} true-继续，false-取消
 */
async function showStartAlert() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "课表导入",
        "请确保您已登录教务系统（jwxt.neu.edu.cn），且网络连接正常。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return false;
    }
    return true;
}

/**
 * 全局验证函数：校验学年输入
 */
function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false; // 验证通过
    }
    return "请输入四位数字的年份！";
}

/**
 * 获取学年（起始年份）
 * @returns {Promise<string|null>} 四位年份字符串，取消返回 null
 */
async function getAcademicYear() {
    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入起始年份（如 2025）:",
        new Date().getFullYear().toString(),
        "validateYearInput"
    );
    if (year === null) {
        window.shiguangBridge.showToast("已取消导入");
        return null;
    }
    return year;
}

/**
 * 选择学期（秋季/春季）
 * @returns {Promise<{termType: string}|null>}
 */
async function selectSemester() {
    const items = ["秋季学期 (1)", "春季学期 (2)"];
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(items),
        -1
    );
    if (idx === null) {
        window.shiguangBridge.showToast("已取消导入");
        return null;
    }
    const termType = idx === 0 ? "1" : "2";
    return { termType };
}

/**
 * 选择校区
 * @returns {Promise<string|null>} "南湖校区" 或 "浑南校区"
 */
async function selectCampus() {
    const campuses = ["南湖校区", "浑南校区"];
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(campuses),
        -1
    );
    if (idx === null) {
        window.shiguangBridge.showToast("已取消导入");
        return null;
    }
    return campuses[idx];
}

/**
 * 询问是否导入考试时间
 * @returns {Promise<boolean>} true-导入，false-不导入
 */
async function askImportExams() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "导入考试时间",
        "是否导入考试时间？\n（测试功能，考试固定在第15周，出错请反馈）",
        "导入"
    );
    return confirmed;
}

/**
 * ============================================================
 * 2. 数据解析层
 * ============================================================
 */

/**
 * 增强版周次解析：支持 "1-8周", "2-6周(双)", "1,3,5周" 等格式
 */
function parseWeeksString(weeksStr) {
    if (!weeksStr) return [];
    const result = [];
    const weekParts = weeksStr.split(/[，,]/).map(part => part.trim());

    weekParts.forEach(part => {
        // 匹配单个数字周，如 "6周" 或 "6周(单)"
        const singleMatch = part.match(/^(\d+)周(?:\(([单双])\))?$/);
        if (singleMatch) {
            const num = parseInt(singleMatch[1]);
            const type = singleMatch[2];
            if (!type || (type === '单' && num % 2 === 1) || (type === '双' && num % 2 === 0)) {
                result.push(num);
            }
            return;
        }

        // 匹配范围周，如 "1-8周" 或 "2-6周(双)"
        const rangeMatch = part.match(/^(\d+)-(\d+)周(?:\(([单双])\))?$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            const type = rangeMatch[3];

            if (!type) {
                for (let i = start; i <= end; i++) result.push(i);
            } else if (type === '单') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 1) result.push(i);
                }
            } else if (type === '双') {
                for (let i = start; i <= end; i++) {
                    if (i % 2 === 0) result.push(i);
                }
            }
        }
    });

    return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * 将API返回的课表原始数据转换为标准课程对象数组
 * 直接使用 titleWeekTeacherClassroomDetail 数组，为每个安排生成独立课程
 */
function convertApiResponseToLessons(arrangedList) {
    const lessons = [];
    for (const item of arrangedList) {
        const day = item.dayOfWeek;
        const startSection = parseInt(item.beginSection, 10);
        const endSection = parseInt(item.endSection, 10);
        if (!day || isNaN(startSection) || isNaN(endSection)) continue;

        const name = item.courseName || "";
        if (!name) continue;

        const details = item.titleWeekTeacherClassroomDetail || [];
        if (details.length === 0) {
            console.warn(`课程 "${name}" 无上课安排，已跳过`);
            continue;
        }

        for (const detail of details) {
            if (!detail) continue;
            const tokens = detail.trim().split(/\s+/);
            if (tokens.length < 1) continue;
            const weeksStr = tokens[0];
            const teacher = tokens[1] || "";
            const position = tokens.slice(2).join(' ');

            const weeks = parseWeeksString(weeksStr);
            if (weeks.length === 0) {
                console.warn(`周次解析失败: "${weeksStr}"，课程: ${name}`);
                continue;
            }

            lessons.push({
                name: name,
                teacher: teacher,
                position: position,
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks,
                isCustomTime: false
            });
        }
    }
    return lessons;
}

/**
 * 解析考试时间描述字符串
 */
function parseExamTimeDescription(desc) {
    const weekMap = { '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5, '星期六': 6, '星期日': 7 };
    let day = null;
    let startTime = null;
    let endTime = null;
    for (const [cn, num] of Object.entries(weekMap)) {
        if (desc.includes(cn)) {
            day = num;
            break;
        }
    }
    const timeMatch = desc.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
    if (timeMatch) {
        startTime = timeMatch[1];
        endTime = timeMatch[2];
    }
    return { day, startTime, endTime };
}

/**
 * 从考试API获取考试数据
 */
async function fetchExamsFromAPI(termCode) {
    const url = `https://jwxt.neu.edu.cn/jwapp/sys/homeapp/api/home/student/exams.do?termCode=${encodeURIComponent(termCode)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Fetch-Api': 'true',
            'Referer': 'https://jwxt.neu.edu.cn/jwapp/sys/homeapp/home/index.html',
            'User-Agent': navigator.userAgent
        }
    });
    if (!response.ok) throw new Error(`考试API HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== '0') throw new Error(`考试API错误码: ${data.code}`);
    const exams = data.datas || [];
    const lessons = [];
    for (const exam of exams) {
        const rawName = exam.courseName || "";
        const examType = exam.examType || "考试";
        const desc = exam.examTimeDescription || "";
        let dateStr = "";
        const dateMatch = desc.match(/(\d{2})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
            dateStr = `${dateMatch[2]}月${dateMatch[3]}日`;
        } else {
            const simpleMatch = desc.match(/(\d{2})月(\d{2})日/);
            if (simpleMatch) dateStr = `${simpleMatch[1]}月${simpleMatch[2]}日`;
        }
        const name = dateStr ? `${rawName}_${examType}_${dateStr}` : `${rawName}_${examType}`;
        const teacher = exam.teachers || "";
        const position = exam.examPlace || "";
        const { day, startTime, endTime } = parseExamTimeDescription(desc);
        if (!day || !startTime || !endTime) {
            console.warn("解析考试时间失败，跳过:", desc);
            continue;
        }
        lessons.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            startSection: undefined,
            endSection: undefined,
            weeks: [15],
            isCustomTime: true,
            customStartTime: startTime,
            customEndTime: endTime
        });
    }
    return lessons;
}

/**
 * ============================================================
 * 3. 网络请求层
 * ============================================================
 */

/**
 * 从教务API获取课表数据（支持重试）
 */
async function fetchCoursesFromAPI(semesterCode, retries = 2) {
    const url = 'https://jwxt.neu.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduleDetail.do';
    const xnxqdm = semesterCode;
    const xqdm = ''; // 神秘参数，设为空可获取课表数据

    for (let i = 1; i <= retries; i++) {
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 10000);
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Fetch-Api': 'true',
                    'Referer': 'https://jwxt.neu.edu.cn/jwapp/sys/kbapp/home/index.html',
                    'User-Agent': navigator.userAgent,
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({ XNXQDM: xnxqdm, XQDM: xqdm }),
                signal: ctrl.signal
            });
            clearTimeout(tid);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.code !== '0') throw new Error(`API error ${data.code}`);
            const list = data?.datas?.getMyScheduleDetail?.arrangedList || [];
            return convertApiResponseToLessons(list);
        } catch (e) {
            if (i === retries) throw e;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

/**
 * ============================================================
 * 4. 数据保存层（使用桥接 API）
 * ============================================================
 */

/**
 * 保存课程列表
 */
async function saveCourses(lessons) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(lessons));
        window.shiguangBridge.showToast(`成功导入 ${lessons.length} 门课程`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存课程失败: ${error.message}`);
        return false;
    }
}

/**
 * 保存预设时间段（根据校区）
 */
async function saveTimeSlots(campus) {
    const hunNan = [
        { "number": 1, "startTime": "08:30", "endTime": "09:15" },
        { "number": 2, "startTime": "09:25", "endTime": "10:10" },
        { "number": 3, "startTime": "10:30", "endTime": "11:15" },
        { "number": 4, "startTime": "11:25", "endTime": "12:10" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "18:30", "endTime": "19:15" },
        { "number": 10, "startTime": "19:25", "endTime": "20:10" },
        { "number": 11, "startTime": "20:30", "endTime": "21:15" },
        { "number": 12, "startTime": "21:15", "endTime": "22:10" }
    ];
    const nanHu = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "18:30", "endTime": "19:15" },
        { "number": 10, "startTime": "19:25", "endTime": "20:10" },
        { "number": 11, "startTime": "20:20", "endTime": "21:05" },
        { "number": 12, "startTime": "21:15", "endTime": "22:00" }
    ];
    const slots = campus === "南湖校区" ? nanHu : hunNan;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`导入时间段失败: ${error.message}`);
        return false;
    }
}

/**
 * 保存课表配置（不包含 semesterStartDate）
 */
async function saveConfig() {
    const config = {
        semesterTotalWeeks: 18,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 7
    };
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存配置失败: ${error.message}`);
        return false;
    }
}

/**
 * ============================================================
 * 5. 主流程（符合规范的结构化编排）
 * ============================================================
 */

async function runImportFlow() {
    window.shiguangBridge.showToast("开始导入课表...");

    // 1. 公告确认
    const alertConfirmed = await showStartAlert();
    if (!alertConfirmed) return;

    // 2. 获取学年
    const academicYear = await getAcademicYear();
    if (academicYear === null) return;

    // 3. 选择学期
    const semesterResult = await selectSemester();
    if (semesterResult === null) return;
    const { termType } = semesterResult;
    const startYear = parseInt(academicYear, 10);
    const endYear = startYear + 1;
    const semesterCode = `${startYear}-${endYear}-${termType}`;

    // 4. 选择校区
    const campus = await selectCampus();
    if (campus === null) return;

    // 5. 获取课表数据
    window.shiguangBridge.showToast("正在获取课表数据...");
    let lessons;
    try {
        lessons = await fetchCoursesFromAPI(semesterCode);
        if (!lessons.length) {
            window.shiguangBridge.showToast("未获取到任何课程");
            return;
        }
        console.log(`获取到 ${lessons.length} 条课程内容`);
    } catch (e) {
        window.shiguangBridge.showToast("获取课表失败: " + e.message);
        return;
    }

    // 6. 保存课程
    const saveResult = await saveCourses(lessons);
    if (!saveResult) return;

    // 7. 保存时间段
    await saveTimeSlots(campus);

    // 8. 保存配置（不包含 semesterStartDate）
    const configResult = await saveConfig();
    if (!configResult) return;

    window.shiguangBridge.showToast("课表导入完成！");

    // 9. [可选] 导入考试时间
    const importExams = await askImportExams();
    if (importExams) {
        window.shiguangBridge.showToast("正在获取考试数据...");
        try {
            const examLessons = await fetchExamsFromAPI(semesterCode);
            if (examLessons.length === 0) {
                window.shiguangBridge.showToast("未获取到考试数据");
            } else {
                const allLessons = [...lessons, ...examLessons];
                await saveCourses(allLessons);
                window.shiguangBridge.showToast(`已导入 ${examLessons.length} 条考试记录`);
            }
        } catch (e) {
            window.shiguangBridge.showToast("导入考试失败: " + e.message);
            console.error(e);
            // 考试导入失败不影响主流程完成
        }
    }

    // 10. 流程完全成功，发送结束信号
    window.shiguangBridge.showToast("所有任务已完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();