// 文件: gdut.js

if (typeof url_strings === 'undefined') {
    var url_strings = {
        BASE_URL: "https://jxfw.gdut.edu.cn",
        GET_WEEK_COURSES_API_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!getKbRq.action",
        GET_ALL_COURSES_API_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!getDataList.action",
        GET_ALL_COURSES_HTML_URL: "https://jxfw.gdut.edu.cn/xsgrkbcx!xsAllKbList.action",
        GET_ALL_COURSES_HTML_URL_REFERRER: "https://jxfw.gdut.edu.cn/xsgrkbcx!getXsgrbkList.action"
    };
}

/**
 * 展示导入课程确认弹窗
 * @returns {Promise<boolean>} 是否确认执行导入课程操作
 */
async function stepDescriptionAlert() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "提示",
            "即将执行导入课程操作，确保当前已登录到教务系统（无需打开课程表页面）",
            "确认"
        );
        
        return confirmed;
    } catch (error) {
        console.error("显示弹窗时发生错误:", error);
        return false;
    }
}

/**
 * 展示学期选择弹窗
 * @returns {Promise<string>} 选择的学期代码
 */
async function selectSemesterSelection(){
    // 教务系统识别学期的规则为：学年年份 + 学期编号。
    // 学年年份与实际年份并不相等，例如：2025-2026 学年（2025 学年）秋季学期对应实际年份为 2025，春季学期对应实际年份为 2026；
    // 2026-2027 学年（2026 学年）秋季学期对应实际年份为 2026，春季学期对应实际年份为 2027。
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const currentSemester = currentMonth >= 7 || currentMonth <= 1 ? 1 : 2;
    let currentSemesterYear = currentSemester === 1 ? currentYear : currentYear - 1;
    currentSemesterYear = currentMonth <= 1 ? currentSemesterYear - 1 : currentSemesterYear;
    const nextSemester = currentSemester === 1 ? 2 : 1;
    const nextSemesterYear = currentSemester === 1 ? currentSemesterYear : currentSemesterYear + 1;

    const presetSemestersIds = [];
    const presetSemestersNames = [];

    for (let semesterYear = nextSemesterYear; semesterYear >= nextSemesterYear - 6; semesterYear--){
        for (let semester = semesterYear === nextSemesterYear ? nextSemester : 2; semester >= 1; semester--){
            presetSemestersIds.push(`${semesterYear}0${semester}`);
            const semesterName = `${semester === 1 ? semesterYear : semesterYear + 1}年${semester === 1 ? "秋季" : "春季"} (${semesterYear}-${semesterYear + 1} 学年第${semester}学期)`;
            presetSemestersNames.push(semesterName);
        }
    }

    try {
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择要导入的学期",
            JSON.stringify(presetSemestersNames),
            1
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < presetSemestersIds.length) {
            console.log("用户选择了: " + presetSemestersNames[selectedIndex] + " (索引: " + selectedIndex + ")");
            return presetSemestersIds[selectedIndex];
        } else {
            console.log("用户取消了选择。");
            return null;
        }
    } catch (error) {
        console.error("显示单选列表弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Single Selection：显示列表出错！" + error.message);
        return null;
    }
}

/**
 * 从 JSON 格式的日期信息数据中提取第一个周一的日期
 * @param {string} dateInfoJsonData JSON 格式的日期信息数据
 * @returns {string|null} 找到的第一个周一的日期字符串，未找到时返回 null
 */
function extractFirstDay(dateInfoJsonData) {
    try {
        const jsonArray = JSON.parse(dateInfoJsonData);

        const dateInfoArray = jsonArray[1];

        // 遍历查找 xqmc === "1"（周一）的项
        for (const dateInfo of dateInfoArray) {
            if (dateInfo.xqmc === "1" && dateInfo.rq) {
                return dateInfo.rq;
            }
        }

        console.error('未找到 xqmc=1 的日期项');
        return null;
    } catch (error) {
        console.error('解析 JSON 失败:', error);
        return null;
    }
}

/**
 * 获取学期开始日期（第一个周一），获取失败时返回当前日期
 * @param {string} semesterId 学期代码
 * @returns {Promise<Date>} 学期开始日期，获取失败时返回当前日期
 */
async function fetchStartDate(semesterId) {
    const url = `${url_strings.GET_WEEK_COURSES_API_URL}?xnxqdm=${semesterId}&zc=1`;
    
    try {
        console.log(`正在获取学期开始日期。学期代码：${semesterId}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Referer': url
            },
            credentials: 'include'
        });

        const data = await response.text();
        
        const startDateString = extractFirstDay(data);

        // 如果提取失败，返回当前日期
        if (startDateString === null) {
            // 使用当前日期
            return new Date();
        }

        // 解析日期字符串为 Date 对象
        const date = new Date(startDateString);
        if (isNaN(date.getTime())) {
            console.warn(`日期解析失败: ${startDateString}，使用当前日期`);
            return new Date();
        }

        console.log(`成功获取学期开始日期: ${date.toISOString().split('T')[0]}`);

        return date;
    } catch (error) {
        console.error('获取学期开始日期失败，使用当前日期。错误信息:', error);
        return new Date();
    }
}

/**
 * 获取指定学期的课程数据并转换为课程对象列表
 * @param {string} semesterId 学期代码
 * @returns {Promise<Array<Object>|null>} 课程对象列表，获取失败时返回 null
 */
async function fetchCourses(semesterId){
    try {
        console.log(`正在获取学期 ${semesterId} 的课程数据...`);

        // 理论上此处应分页遍历处理，但分页处理将导致教务系统返回错误的数据（课程重复和缺失）。
        // API 返回结果包含课程总量，可以先探测一遍获取总量，再使用获取的总量去获取所有课程。
        let formData = new URLSearchParams({
            zc: '',
            xnxqdm: semesterId,
            page: '1',
            rows: '1',
            sort: 'kxh',
            order: 'asc'
        })

        let response = await fetch(url_strings.GET_ALL_COURSES_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': url_strings.BASE_URL
            },
            body: formData.toString(),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        let rawData = await response.json();
        const total = rawData.total;

        if (total === 0 || rawData.rows.length === 0) {
            console.log(`学期 ${semesterId} 没有找到课程数据。`);
            if (await checkSemesterIsOpened(semesterId)) {
                throw new Error('该学期没有找到课程！请确认选择了正确的学期。');
            }
            throw new Error('学期未开放课表查询！');
        }

        formData.set('rows', total);

        response = await fetch(url_strings.GET_ALL_COURSES_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': url_strings.BASE_URL
            },
            body: formData.toString(),
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        rawData = await response.json();
        const rawCourses = rawData.rows;
        console.log(`成功获取学期 ${semesterId} 的课程数据，共 ${rawCourses.length} 条记录。`);
        const courses = parseCourses(rawCourses);

        return courses;
    } catch (error) {
        console.error('添加课程表失败:', error);
        window.shiguangBridge.showToast(`添加课程失败: ${error.message}`);
        return null;
    }
}

/**
 * 检查指定学期的课表查询是否已开放
 * @param {string} semesterId 学期代码
 * @returns {Promise<boolean>} 已开放时返回 true，未开放时返回 false
 */
async function checkSemesterIsOpened(semesterId) {
    console.log(`正在检查学期 ${semesterId} 是否已开放课表查询...`);

    const url = `${url_strings.GET_ALL_COURSES_HTML_URL}?xnxqdm=${semesterId}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Referer': url_strings.GET_ALL_COURSES_HTML_URL_REFERRER
        },
        credentials: 'include'
    });
    
    const html = await response.text();

    // 如果不包含"未开放"文字，说明已开放
    return !html.includes("本学期课表还未开放，请稍后查询！");
}

/**
 * 将原始课程数据转换为标准课程对象列表
 * @param {Array<Object>} rawCourses 原始课程数据列表
 * @returns {Array<Object>} 转换后的课程对象列表
 */
function parseCourses(rawCourses){
    console.log(`正在转换原始课程数据...`);

    const courses = [];
    for (const raw of rawCourses) {
        const sectionMatch = raw.jcdm.match(/\d{2}/g);
        if (!sectionMatch) {
            console.error(`课程节次解析失败，原始数据：${raw.jcdm}。`);
            throw new Error(`课程 ${raw.kcmc} 节次解析失败，原始数据：${raw.jcdm}。联系开发者解决此问题。`);
        }

        const sections = sectionMatch.map(Number);
        const startSection = sections[0];
        const endSection = sections[sections.length - 1];
        
        // 周次
        const week = Number(raw.zc);
        if (isNaN(week)) {
            console.error(`课程周次解析失败，原始数据：${raw.zc}。`);
            throw new Error(`课程 ${raw.kcmc} 周次解析失败，原始数据：${raw.zc}。联系开发者解决此问题。`);
        }

        const course = {
            name: decodeHtmlEntities(raw.kcmc).trim(),
            teacher: decodeHtmlEntities(raw.teaxms || "").trim(),
            position: decodeHtmlEntities(raw.jxcdmc || "").trim(),
            day: Number(raw.xq),
            startSection: startSection,
            endSection: endSection,
            weeks: [week],
            isCustomTime: false
        };

        courses.push(course);
    }

    return courses;
}

/**
 * 解码 HTML 实体字符为普通文本
 * @param {string} text 需要解码的文本
 * @returns {string} 解码后的文本，输入为空时返回空字符串
 */
function decodeHtmlEntities(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent || div.innerText || '';
}

/**
 * 将课程列表导入到应用
 * @param {Array<Object>} courses 课程对象列表
 */
async function saveCourses(courses){
    try {
        console.log("正在尝试导入课程...");
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (result !== true) {
            console.log("课程导入未成功，结果：" + result);
            window.shiguangBridge.showToast("课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
    }
}

/**
 * 导入预设时间段
 */
async function setPresetTimeSlots() {
    const presetTimeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:15" },
        { "number": 2, "startTime": "09:20", "endTime": "10:05" },
        { "number": 3, "startTime": "10:25", "endTime": "11:10" },
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "13:50", "endTime": "14:35" },
        { "number": 6, "startTime": "14:40", "endTime": "15:25" },
        { "number": 7, "startTime": "15:30", "endTime": "16:15" },
        { "number": 8, "startTime": "16:30", "endTime": "17:15" },
        { "number": 9, "startTime": "17:20", "endTime": "18:05" },
        { "number": 10, "startTime": "18:30", "endTime": "19:15" },
        { "number": 11, "startTime": "19:20", "endTime": "20:05" },
        { "number": 12, "startTime": "20:10", "endTime": "20:55" },
        { "number": 13, "startTime": "21:00", "endTime": "21:45" },
        { "number": 14, "startTime": "21:50", "endTime": "22:35" }
    ];

    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result !== true) {
            console.log("预设时间段导入未成功，结果：" + result);
            window.shiguangBridge.showToast("预设时间段导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

/**
 * 导入课表配置
 * @param {Object} config 课表配置对象
 */
async function saveConfig(config) {
    try {
        console.log("正在尝试导入课表配置...");
        const configJsonString = JSON.stringify(config);
        const result = await window.shiguangBridgePromise.saveCourseConfig(configJsonString);
        if (result !== true) {
            console.log("课表配置导入未成功，结果：" + result);
            window.shiguangBridge.showToast("课表配置导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课表配置时发生错误:", error);
        window.shiguangBridge.showToast("导入课表配置失败: " + error.message);
    }
}

/**
 * 编排这些异步操作，并在用户取消时停止后续执行。
 */
async function runImportFlow() {
    if (window.location.hostname === "authserver.gdut.edu.cn"){
        window.shiguangBridge.showToast("执行导入课表操作前，必须先登录到教务系统！");
        return;
    } 

    if (window.location.hostname !== "jxfw.gdut.edu.cn") {
        window.shiguangBridge.showToast("当前页面不是教务系统页面！");
        return;
    }

    const result = await stepDescriptionAlert();

    if (!result) {
        console.log("用户取消了操作，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    const semesterId = await selectSemesterSelection();

    if (!semesterId) {
        console.log("用户取消了学期选择，停止后续执行。");
        return; // 用户取消，立即退出函数
    }

    const startDate = await fetchStartDate(semesterId);

    const courses = await fetchCourses(semesterId);

    if (!courses) {
        console.log(`未能获取课程数据，停止后续执行。`);
        return; // 获取课程失败，立即退出函数
    }

    const config = {
        semesterStartDate: startDate.toISOString().split('T')[0], // 转换为 YYYY-MM-DD 格式
        semesterTotalWeeks: 20,
        defaultClassDuration: 45,
        defaultBreakDuration: 5,
        firstDayOfWeek: 1
    }

    await saveConfig(config);
    await saveCourses(courses);
    await setPresetTimeSlots();

    window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);

    // 发送最终的生命周期完成信号
    window.shiguangBridge.notifyTaskCompletion();
}

// 入口函数，开始执行导入流程
runImportFlow();