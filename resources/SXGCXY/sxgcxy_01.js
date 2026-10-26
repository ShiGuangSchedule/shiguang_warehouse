// 山西工程职业学院(sxgcxy.cn)拾光课程表适配脚本
// 基于超星教务系统接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速



// 唐槐校区作息时间
const TangHuaiTimeSlots = [
    { number: 1, startTime: "08:20", endTime: "09:05" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "13:40", endTime: "14:25" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:20", endTime: "16:05" },
    { number: 8, startTime: "16:05", endTime: "16:50" },
    { number: 9, startTime: "17:30", endTime: "18:15" },
    { number: 10, startTime: "18:15", endTime: "19:00" }
];

// 龙潭校区作息时间
const LongTanTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:45", endTime: "09:30" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:15", endTime: "16:00" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:15", endTime: "18:00" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:45", endTime: "20:30" }
];


// 校区作息选项列表
const CampusTimeTables = [
    { label: "唐槐校区", slots: TangHuaiTimeSlots },
    { label: "龙潭校区", slots: LongTanTimeSlots }
];


/**
 * 从 HTML 字符串中提取纯文本内容。
 */
function extractAnchorText(htmlStr) {
    if (!htmlStr) return '';
    // 移除 HTML 标签，返回剩余的文本内容
    const match = htmlStr.match(/>([^<]+)</);
    return match ? match[1].trim() : htmlStr.trim();
}

/**
 * 清理教师名称，去除括号及其内容。
 */
function cleanTeacherName(name) {
    if (!name) return '';
    // 移除全角或半角的括号及其中的内容
    return name.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
}

/**
 * 解析周次字符串，超星系统直接提供逗号分隔的周次数字。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return weekStr.split(',')
        .map(w => Number(w.trim()))
        .filter(w => !isNaN(w) && w > 0)
        .sort((a, b) => a - b);
}


/**
 * 解析 API 返回的 JSON 数据，并合并连续节次。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析超星 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.data)) {
        console.warn("JS: JSON 数据结构错误或缺少 data 字段。");
        return [];
    }

    const rawCourseList = jsonData.data;

    // 1. 预处理，并标准化周次信息
    const processedList = rawCourseList
        .map(rawCourse => {
            const name = extractAnchorText(rawCourse.kcmc);
            const teacher = cleanTeacherName(extractAnchorText(rawCourse.tmc));
            
            const position = extractAnchorText(rawCourse.croommc) || '待定';
            
            const day = Number(rawCourse.xingqi);
            const section = Number(rawCourse.djc);
            
            // 将原始周次字符串解析为排序后的数组，然后转换为 JSON 字符串
            const weeksArray = parseWeeks(rawCourse.zcstr);
            const standardizedWeeks = JSON.stringify(weeksArray);

            if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeksArray.length === 0) {
                return null;
            }

            return { name, teacher, position, day, section, standardizedWeeks, weeksArray };
        })
        .filter(c => c !== null)
        // 排序顺序：星期 > 周次 > 课程名 > 教师 > 教室 > 节次
        .sort((a, b) =>
            a.day - b.day ||
            a.standardizedWeeks.localeCompare(b.standardizedWeeks) ||
            a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            a.section - b.section 
        );

    const finalCourseList = [];
    let i = 0;

    // 2. 迭代合并连续节次
    while (i < processedList.length) {
        let current = processedList[i];
        let startSection = current.section;
        let endSection = current.section;
        let j = i + 1;

        while (j < processedList.length) {
            let next = processedList[j];

            // 检查合并条件：周次、星期、名称、教师、教室 必须相同，且节次连续
            if (
                next.day === current.day &&
                next.name === current.name &&
                next.teacher === current.teacher &&
                next.position === current.position &&
                next.standardizedWeeks === current.standardizedWeeks && 
                next.section === endSection + 1
            ) {
                endSection = next.section;
                j++;
            } else {
                break;
            }
        }

        // 3. 构建合并后的课程对象
        finalCourseList.push({
            name: current.name,
            teacher: current.teacher,
            position: current.position,
            day: current.day,
            startSection: startSection,
            endSection: endSection,
            weeks: current.weeksArray 
        });

        i = j;
    }

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程（合并后）。`);
    return finalCourseList;
}


/**
 * 提示用户选择校区作息时间。
 * @returns {Promise<Array<Object>|null>} 选中的作息时间数组或 null。
 */
async function selectCampusTimeTable() {
    console.log("JS: 提示用户选择校区作息时间。");
    const labels = CampusTimeTables.map(opt => opt.label);
    
    const defaultIndex = -1; 
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择校区对应的作息时间",
        JSON.stringify(labels),
        defaultIndex 
    );
    
    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }
    
    return CampusTimeTables[selectedIndex].slots;
}


/**
 * 生成超星教务系统所需的学年学期选项。
 */
function getSemesterOptions() {
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1]; 
    const semesterCodes = ["1", "2"]; 

    let labels = [];
    let values = [];
    let defaultIndex = -1; 
    
    for (let i = 0; i < years.length; i++) {
        const startYear = years[i];
        const endYear = startYear + 1;
        const yearStr = `${startYear}-${endYear}`;

        for (let j = 0; j < semesterCodes.length; j++) {
            const code = semesterCodes[j];
            const apiValue = `${yearStr}-${code}`;
            labels.push(apiValue);
            values.push(apiValue);
        }
    }
    
    return { labels, values, defaultIndex };
}

/**
 * 提示用户选择学年和学期。
 */
async function selectAcademicYearAndSemester() {
    console.log("JS: 提示用户选择学年学期 (纯参数格式)。");
    const { labels, values, defaultIndex } = getSemesterOptions();
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年学期 (参数格式：YYYY-YYYY-X)",
        JSON.stringify(labels),
        defaultIndex
    );
    
    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }
    
    return values[selectedIndex];
}


async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入 (超星)",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}


/**
 * 请求和解析课程数据
 */
async function fetchAndParseCourses(xnxq) {
    window.shiguangBridge.showToast(`正在请求 ${xnxq} 的课表数据...`);

    // xhid 需要从页面获取
    const xhid = document.getElementById('encodeId')?.value || 'UNKNOWN'; 

    const dynamicUrl = `https://sxevc.jw.chaoxing.com/admin/pkgl/xskb/sdpkkbList?xnxq=${xnxq}&xhid=${xhid}`;
    
    console.log(`JS: 发送请求到 ${dynamicUrl}`);

    const requestOptions = {
        "headers": {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        },
        "method": "GET", 
        "credentials": "include"
    };

    try {
        const response = await fetch(dynamicUrl, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status} (${response.statusText})`);
        }
        
        const jsonData = await response.json();
        
        if (jsonData.ret !== 0) {
             console.error(`JS: API 返回错误: ${jsonData.msg}`);
             window.shiguangBridge.showToast(`数据请求失败: ${jsonData.msg}，请检查是否登录或参数是否正确。`);
             return null;
        }

        const courses = parseJsonData(jsonData);    

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);
        return { courses: courses };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
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

async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 导入预设时间段。`);
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
    }
}


async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    
    const selectedTimeSlots = await selectCampusTimeTable();
    if (selectedTimeSlots === null) {
        window.shiguangBridge.showToast("导入已取消，未选择作息时间。");
        return;
    }
    console.log(`JS: 已选择包含 ${selectedTimeSlots.length} 节课的作息时间。`);


    const xnxq = await selectAcademicYearAndSemester();
    if (xnxq === null) {
        window.shiguangBridge.showToast("导入已取消，未选择学年学期。");
        return;
    }
    console.log(`JS: 已选择学年学期参数: ${xnxq}`);

    const result = await fetchAndParseCourses(xnxq);
    if (result === null) {
        return;
    }
    const { courses } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    await importPresetTimeSlots(selectedTimeSlots);


    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();