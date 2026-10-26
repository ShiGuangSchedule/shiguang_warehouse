// 辽宁科技大学(ustl.edu.cn)拾光课程表适配脚本
// 基于超星教务系统接口适配
// 本校毕业生适配, 开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改, 这更加快速

/**
 * 从 HTML 字符串中提取纯文本内容。
 * 超星系统返回的部分字段包含 HTML 标签（如 <a> 标签）
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
 * @param {string} weekStr - 周次字符串，如 "1,2,3,4,5"
 * @returns {number[]} - 排序后的周次数组
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    return weekStr.split(',')
        .map(w => Number(w.trim()))
        .filter(w => !isNaN(w) && w > 0)
        .sort((a, b) => a - b);
}

/**
 * 从周次列表中获取开学日期（第1周的开始日期）。
 * @param {Array} zclist - 周次列表，来自 getZclistByXnxq 接口
 * @returns {string|null} - 开学日期，格式 YYYY-MM-DD
 */
function getSemesterStartDate(zclist) {
    if (!zclist || !Array.isArray(zclist) || zclist.length === 0) {
        console.warn("JS: 周次列表为空或格式错误。");
        return null;
    }

    // 查找第1周的数据
    const firstWeek = zclist.find(zc => Number(zc.zc) === 1);
    if (!firstWeek || !firstWeek.minrq) {
        console.warn("JS: 未找到第1周的开始日期。");
        return null;
    }

    // 将 "2025-08-25 00:00:00" 格式转换为 "2025-08-25"
    const dateStr = firstWeek.minrq.split(' ')[0];
    console.log(`JS: 获取到开学日期: ${dateStr}`);
    return dateStr;
}

/**
 * 解析课程数据，并合并连续节次的同一课程。
 * @param {Object} jsonData - sdpkkbList 接口返回的 JSON 数据
 * @returns {Array<Object>} - 解析并合并后的课程列表
 */
function parseCourseData(jsonData) {
    console.log("JS: 开始解析超星课程数据...");

    if (!jsonData || !Array.isArray(jsonData.data)) {
        console.warn("JS: 课程数据结构错误或缺少 data 字段。");
        return [];
    }

    const rawCourseList = jsonData.data;

    // 1. 预处理课程数据，提取必要字段并标准化
    const processedList = rawCourseList
        .map(rawCourse => {
            const name = extractAnchorText(rawCourse.kcmc);
            const teacher = cleanTeacherName(extractAnchorText(rawCourse.tmc));
            const position = extractAnchorText(rawCourse.croommc) || '待定';
            const day = Number(rawCourse.xingqi);
            const section = Number(rawCourse.djc);
            
            // 解析周次字符串并转换为标准 JSON 字符串（用于比较）
            const weeksArray = parseWeeks(rawCourse.zcstr);
            const standardizedWeeks = JSON.stringify(weeksArray);

            // 验证必填字段
            if (!name || isNaN(day) || isNaN(section) || day < 1 || day > 7 || section < 1 || weeksArray.length === 0) {
                return null;
            }

            return { name, teacher, position, day, section, standardizedWeeks, weeksArray };
        })
        .filter(c => c !== null)
        // 排序：按星期 > 周次 > 课程名 > 教师 > 教室 > 节次
        .sort((a, b) =>
            a.day - b.day ||
            a.standardizedWeeks.localeCompare(b.standardizedWeeks) ||
            a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            a.section - b.section 
        );

    // 2. 合并连续节次的相同课程
    const finalCourseList = [];
    let i = 0;

    while (i < processedList.length) {
        let current = processedList[i];
        let startSection = current.section;
        let endSection = current.section;
        let j = i + 1;

        // 查找连续的节次
        while (j < processedList.length) {
            let next = processedList[j];

            // 检查是否可以合并：周次、星期、课程名、教师、教室必须相同，且节次连续
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

        // 添加合并后的课程
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

    console.log(`JS: 课程数据解析完成，共 ${finalCourseList.length} 门课程（已合并连续节次）。`);
    return finalCourseList;
}

/**
 * 生成学年学期选项列表。
 * @returns {Object} - 包含 labels（显示文本）、values（参数值）、defaultIndex（默认选项）
 */
function getSemesterOptions() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    // 根据当前月份判断默认学期（9月前为第二学期，9月后为第一学期）
    const defaultSemester = currentMonth < 9 ? 2 : 1;
    const defaultYear = currentMonth < 9 ? currentYear - 1 : currentYear;
    
    // 生成前后三年的学年学期选项
    const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1]; 
    const semesterCodes = ["1", "2"];

    let labels = [];
    let values = [];
    let defaultIndex = -1;
    
    let index = 0;
    for (let i = 0; i < years.length; i++) {
        const startYear = years[i];
        const endYear = startYear + 1;
        const yearStr = `${startYear}-${endYear}`;

        for (let j = 0; j < semesterCodes.length; j++) {
            const code = semesterCodes[j];
            const apiValue = `${yearStr}-${code}`;
            const semesterName = code === "1" ? "第一学期" : "第二学期";
            
            labels.push(`${yearStr}学年 ${semesterName}`);
            values.push(apiValue);
            
            // 设置默认选项
            if (startYear === defaultYear && Number(code) === defaultSemester) {
                defaultIndex = index;
            }
            
            index++;
        }
    }
    
    return { labels, values, defaultIndex };
}

/**
 * 从学年学期下拉框 HTML 中解析选项。
 * @param {string} selectHtml - id=xnxq1 的 select 元素 HTML
 * @returns {Object|null} - 包含 labels、values、defaultIndex，失败返回 null
 */
function parseSemesterOptionsFromHtml(selectHtml) {
    if (!selectHtml || typeof selectHtml !== 'string') {
        return null;
    }

    try {
        const doc = new DOMParser().parseFromString(selectHtml, "text/html");
        const selectElement = doc.querySelector('#xnxq1') || doc.querySelector('select[name="xnxq"]');
        if (!selectElement) {
            return null;
        }

        const optionElements = Array.from(selectElement.querySelectorAll('option'));
        const validOptions = optionElements.filter(option => (option.value || '').trim() !== '');
        if (validOptions.length === 0) {
            return null;
        }

        const labels = validOptions.map(option => (option.textContent || option.value || '').trim());
        const values = validOptions.map(option => (option.value || '').trim());

        let defaultIndex = validOptions.findIndex(option => option.selected);
        if (defaultIndex < 0) {
            defaultIndex = 0;
        }

        return { labels, values, defaultIndex };
    } catch (error) {
        console.warn("JS: 解析学年学期下拉 HTML 失败", error);
        return null;
    }
}

/**
 * 提示用户选择学年学期。
 * @param {string|null|undefined} xnxqSelectHtml - 页面中 id=xnxq1 的 select 元素 HTML
 * @returns {Promise<string|null>} - 选中的学年学期参数（如 "2025-2026-1"），或 null（取消）
 */
async function selectAcademicYearAndSemester(xnxqSelectHtml) {
    console.log("JS: 提示用户选择学年学期。");
    let options = parseSemesterOptionsFromHtml(xnxqSelectHtml);
    if (!options) {
        console.warn("JS: 页面学年学期选项解析失败，回退为前后三年选项。");
        options = getSemesterOptions();
    }
    const { labels, values, defaultIndex } = options;
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年学期",
        JSON.stringify(labels),
        defaultIndex
    );
    
    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }
    
    console.log(`JS: 用户选择了学年学期: ${values[selectedIndex]}`);
    return values[selectedIndex];
}

/**
 * 获取校区列表。
 * @returns {Promise<Array<{xqdm: string, xqmc: string}>|null>} - 校区列表，或 null（失败）
 */
async function fetchCampusList() {
    console.log("JS: 正在请求校区列表...");

    const url = "/admin/api/jcsj/xqsj/getXqList";
    const requestOptions = {
        "headers": {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        },
        "method": "GET",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }

        const jsonData = await response.json();

        if (jsonData.ret !== 0) {
            throw new Error(`API 返回错误: ${jsonData.msg || '未知错误'}`);
        }

        if (!Array.isArray(jsonData.data)) {
            throw new Error("校区列表数据格式错误。");
        }

        const campusList = jsonData.data
            .map(item => ({
                xqdm: String(item.id || '').trim(),
                xqmc: String(item.xqmc || item.id || '').trim()
            }))
            .filter(item => item.xqdm && item.xqmc);

        if (campusList.length === 0) {
            throw new Error("未获取到有效校区信息。");
        }

        console.log(`JS: 校区列表获取成功，共 ${campusList.length} 个校区。`);
        return campusList;
    } catch (error) {
        window.shiguangBridge.showToast(`获取校区列表失败: ${error.message}`);
        console.error('JS: fetchCampusList Error:', error);
        return null;
    }
}

/**
 * 提示用户选择校区。
 * @param {string} defaultXqdm - 默认选中的校区代码
 * @returns {Promise<{xqdm: string, xqmc: string}|null>} - 选中的校区信息，或 null（取消/失败）
 */
async function selectCampus(defaultXqdm) {
    const campusList = await fetchCampusList();
    if (!campusList) {
        console.warn(`JS: 获取校区列表失败，使用页面参数 xqdm=${defaultXqdm} 继续导入。`);
        window.shiguangBridge.showToast("获取校区列表失败，使用默认校区继续导入。");
        return {
            xqdm: defaultXqdm,
            xqmc: ""
        };
    }

    const labels = campusList.map(item => item.xqmc);
    const defaultIndex = Math.max(
        campusList.findIndex(item => item.xqdm === defaultXqdm),
        0
    );

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择校区",
        JSON.stringify(labels),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1) {
        return null;
    }

    const selectedCampus = campusList[selectedIndex];
    console.log(`JS: 用户选择了校区: ${selectedCampus.xqmc} (${selectedCampus.xqdm})`);
    return selectedCampus;
}

/** 
 * 时间格式化
 * @returns {string|null} - 格式化后的时间字符串 "HH:MM"，或 null（格式不合法）
 */
function formatTime(timeStr) {
    if (typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (!match) return null;
    let [ , hour, minute ] = match.map(Number);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 从节次时间数据生成时间段列表。
 * @param {Array} jcsjszList - 节次时间数组，来自 getZclistByXnxq 接口
 * @returns {Array<Object>|null} - 时间段列表，格式不合法时返回 null
 */
function generateTimeSlots(jcsjszList) {
    if (!jcsjszList || !Array.isArray(jcsjszList)) {
        console.warn("JS: 节次时间数据为空或格式错误。");
        return [];
    }

    const timeSlots = [];

    for (const item of jcsjszList) {
        const startTime = formatTime(item.kssj);
        const endTime = formatTime(item.jssj);

        if (!startTime || !endTime) {
            console.warn("JS: 节次时间格式不合法，跳过生成时间段列表。", item);
            return null;
        }

        timeSlots.push({
            number: Number(item.jc),
            startTime,
            endTime
        });
    }

    timeSlots.sort((a, b) => a.number - b.number);

    console.log(`JS: 生成了 ${timeSlots.length} 个时间段。`);
    return timeSlots;
}

/**
 * 从页面中提取必要的参数。
 * @returns {Object|null} - 包含 xhid、xqdm 和 xnxqSelectHtml 的对象，或 null（提取失败）
 */
async function extractPageParams() {
    console.log("JS: 尝试从页面中提取参数...");
    
    // 方法1：从隐藏的 input 元素中获取
    let xhid = document.querySelector('#xhid')?.value;
    let xqdm = document.querySelector('#xqdm')?.value;
    let xnxqSelectHtml = document.querySelector('#xnxq1')?.outerHTML;
    
    // 方法2：如果页面上找不到，尝试抓取课表页并解析
    if (!xhid || !xqdm || !xnxqSelectHtml) {
        console.log("JS: 尝试抓取课表页并解析...");
        const path = "/admin/pkgl/xskb/queryKbForXsd";

        try {
            // 获取课表页的 HTML 文档
            const htmlText = await fetch(path).then(res => res.text());
            const contentDom = new DOMParser().parseFromString(htmlText, "text/html");

            // 从转换后的 HTML 文档中获取 xhid 和 xqdm 的值
            xhid = contentDom.querySelector("#xhid")?.value ||  xhid;
            xqdm = contentDom.querySelector("#xqdm")?.value || xqdm;
            xnxqSelectHtml = contentDom.querySelector("#xnxq1")?.outerHTML || xnxqSelectHtml;
        } catch (error) {
            console.warn("JS: 通过抓取课表页提取参数失败", error);
        }
    }
    
    console.log(`JS: 提取到参数 - xhid: ${xhid}, xqdm: ${xqdm}, xnxqSelectHtml: ${xnxqSelectHtml ? 'yes' : 'no'}`);
    
    if (!xhid || !xqdm) {
        console.warn("JS: 无法从页面中提取必要参数。");
        return null;
    }
    
    return { xhid, xqdm, xnxqSelectHtml };
}

/**
 * 获取节次时间和开学日期信息。
 * @param {string} xnxq - 学年学期参数
 * @param {string} xqdm - 校区代码
 * @returns {Promise<Object>} - 包含 timeSlots 和 semesterStartDate，请求失败时返回空配置继续流程
 */
async function fetchTimeAndWeekData(xnxq, xqdm) {
    console.log(`JS: 正在请求节次时间和周次数据...`);
    window.shiguangBridge.showToast("正在获取课表配置信息...");
    
    const url = `/admin/api/getZclistByXnxq?xnxq=${xnxq}&xqid=${xqdm}`;
    
    const requestOptions = {
        "headers": {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        },
        "method": "GET",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }
        
        const jsonData = await response.json();
        
        if (jsonData.ret !== 0) {
            throw new Error(`API 返回错误: ${jsonData.msg || '未知错误'}`);
        }

        // 提取节次时间和开学日期
        const timeSlots = generateTimeSlots(jsonData.data?.jcsjszList);
        const semesterStartDate = getSemesterStartDate(jsonData.data?.zclist);

        if (!timeSlots) {
            console.warn("JS: 未获取到节次时间");
        }

        if (!semesterStartDate) {
            console.warn("JS: 未获取到开学日期");
        }

        console.log(`JS: 成功获取节次时间（${Array.isArray(timeSlots) ? timeSlots.length : 0}个）和开学日期（${semesterStartDate}）。`);
        return { timeSlots, semesterStartDate };

    } catch (error) {
        window.shiguangBridge.showToast(`获取配置信息失败，将继续导入课程: ${error.message}`);
        console.error('JS: fetchTimeAndWeekData Error:', error);
        return {
            timeSlots: null,
            semesterStartDate: null
        };
    }
}

/**
 * 获取课程数据。
 * @param {string} xnxq - 学年学期参数
 * @param {string} xhid - 学号ID
 * @param {string} xqdm - 校区代码
 * @returns {Promise<Array|null>} - 课程列表，或 null（失败）
 */
async function fetchCourseData(xnxq, xhid, xqdm) {
    console.log(`JS: 正在请求课程数据...`);
    window.shiguangBridge.showToast(`正在获取 ${xnxq} 的课程数据...`);
    
    const url = `/admin/xsd/pkgl/xskb/sdpkkbList?xnxq=${xnxq}&xhid=${xhid}&xqdm=${xqdm}&xskbxslx=0`;
    
    const requestOptions = {
        "headers": {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest"
        },
        "method": "GET",
        "credentials": "include"
    };

    try {
        const response = await fetch(url, requestOptions);

        if (!response.ok) {
            throw new Error(`网络请求失败。状态码: ${response.status}`);
        }
        
        const jsonData = await response.json();
        
        if (jsonData.ret !== 0) {
            throw new Error(`API 返回错误: ${jsonData.msg || '未知错误'}`);
        }

        const courses = parseCourseData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，本学期可能无课。");
            return null;
        }

        console.log(`JS: 课程数据获取成功，共 ${courses.length} 门课程。`);
        return courses;

    } catch (error) {
        window.shiguangBridge.showToast(`获取课程数据失败: ${error.message}`);
        console.error('JS: fetchCourseData Error:', error);
        return null;
    }
}

/**
 * 保存课程数据到应用。
 * @param {Array} courses - 课程列表
 * @returns {Promise<boolean>} - 是否保存成功
 */
async function saveCourses(courses) {
    console.log(`JS: 正在保存 ${courses.length} 门课程...`);
    window.shiguangBridge.showToast(`正在保存 ${courses.length} 门课程...`);
    
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2));
        console.log("JS: 课程保存成功。");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: saveCourses Error:', error);
        return false;
    }
}

/**
 * 导入预设时间段到应用。
 * @param {Array} timeSlots - 时间段列表
 * @returns {Promise<boolean>} - 是否导入成功
 */
async function importPresetTimeSlots(timeSlots) {
    console.log(`JS: 正在导入 ${timeSlots.length} 个预设时间段...`);
    window.shiguangBridge.showToast(`正在导入作息时间...`);
    
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        console.log("JS: 预设时间段导入成功。");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        console.error('JS: importPresetTimeSlots Error:', error);
        return false;
    }
}

/**
 * 保存课表配置（开学日期等）。
 * @param {string|null} semesterStartDate - 开学日期
 * @returns {Promise<boolean>} - 是否保存成功
 */
async function saveCourseConfig(semesterStartDate) {
    if (!semesterStartDate) {
        console.log("JS: 开学日期为空，跳过课表配置保存。");
        return true;
    }
    
    console.log(`JS: 正在保存课表配置（开学日期: ${semesterStartDate}）...`);
    
    const config = {
        semesterStartDate: semesterStartDate
    };
    
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        console.log("JS: 课表配置保存成功。");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存课表配置失败: " + error.message);
        console.error('JS: saveCourseConfig Error:', error);
        return false;
    }
}

/**
 * 检查是否在登录页面。
 * @returns {boolean}
 */
function isLoginPage() {
    const url = window.location.href;
    return url.includes('admin/login');
}

/**
 * 提示用户开始导入。
 * @returns {Promise<boolean>} - 用户是否确认
 */
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "超星教务系统课表导入",
        "导入前请确保您已在成功登录教务系统，并打开课表页面。\n\n本脚本将自动获取作息时间、开学日期和课程数据。",
        "开始导入"
    );
}

/**
 * 主导入流程。
 */
async function runImportFlow() {
    console.log("JS: 开始执行超星教务系统课表导入流程...");
    
    // 1. 检查是否在登录页面
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        return;
    }

    // 2. 提示用户确认开始导入
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    
    // 3. 提取页面参数
    const params = await extractPageParams();
    if (!params) {
        window.shiguangBridge.showToast("无法从页面获取必要参数，请确保在正确的页面执行脚本。");
        return;
    }
    
    const { xhid, xqdm: pageXqdm, xnxqSelectHtml } = params;
    
    // 4. 让用户选择学年学期
    const xnxq = await selectAcademicYearAndSemester(xnxqSelectHtml);
    if (xnxq === null) {
        window.shiguangBridge.showToast("导入已取消，未选择学年学期。");
        return;
    }

    // 5. 让用户选择校区（默认使用页面参数中的 xqdm，若校区接口失败则自动回退使用页面 xqdm）
    const selectedCampus = await selectCampus(pageXqdm);
    if (!selectedCampus) {
        window.shiguangBridge.showToast("导入已取消，未选择校区。");
        return;
    }
    const { xqdm } = selectedCampus;

    // 6. 获取节次时间和开学日期
    const timeData = await fetchTimeAndWeekData(xnxq, xqdm);
    const { timeSlots, semesterStartDate } = timeData;

    // 7. 获取课程数据
    const courses = await fetchCourseData(xnxq, xhid, xqdm);
    if (!courses) {
        return;
    }

    // 8. 保存课程数据
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    // 9. 导入预设时间段
    if (Array.isArray(timeSlots) && timeSlots.length > 0) {
        await importPresetTimeSlots(timeSlots);
    } else {
        console.log("JS: 未生成有效时间段，跳过预设时间段导入。");
    }

    // 10. 保存课表配置（开学日期）
    if (semesterStartDate) {
        await saveCourseConfig(semesterStartDate);
    } else {
        console.log("JS: 未获取到开学日期，跳过课表配置保存。");
    }

    // 11. 完成
    window.shiguangBridge.showToast(`导入成功！共导入 ${courses.length} 门课程。`);
    window.shiguangBridge.notifyTaskCompletion();
    console.log("JS: 超星教务系统课表导入流程完成。");
}

// 执行主流程
runImportFlow();