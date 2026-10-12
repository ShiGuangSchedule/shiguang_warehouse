// 长沙工业学院教务适配，适配作者：小漫君
// 派生自拾光 resources/chaoxing_jiaowu/chaoxing.js，原作者 b1n23，MIT。
// 上游基线：174396aca3edaa0d2df72a55d28a93a2e71c8272。
// 登录统一认证并进入 tls.ccsut.cn 后即可导入，无需打开课表页面。
// 参数请求参考 resources/HBUAS/hbuas_01.js（salt-fishes，MIT）；仅解析请求响应，完全不读取当前页面 DOM。
// 超星教务系统拾光课程表适配脚本
// 理论上使用超星教务系统的学校通用
// 课程数据处理部分来自sxgcxy_01.js，由GitHub Copilot生成

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
 * 提示用户选择学年学期。
 * @param {Object} options - 网络响应中取得的系统学期选项
 * @returns {Promise<string|null>} - 选中的学年学期参数（如 "2025-2026-1"），或 null（取消）
 */
async function selectAcademicYearAndSemester(options) {
    console.log("JS: 提示用户选择学年学期。");
    const { labels, values, defaultIndex } = options;

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年学期",
        JSON.stringify(labels),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex < 0) {
        return null;
    }

    console.log(`JS: 用户选择了学年学期: ${values[selectedIndex]}`);
    if (!values[selectedIndex]) return null;
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
        console.warn("JS: 获取校区列表失败，使用课表入口响应中的账号默认校区。");
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

    if (selectedIndex === null || selectedIndex < 0) {
        return null;
    }

    const selectedCampus = campusList[selectedIndex];
    if (!selectedCampus) return null;
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
 * 主动请求固定入口，读取同一次响应中的账号参数与系统学期选项。
 * 响应是服务端 HTML，但这里只提取请求参数，不解析课程或读取当前页面。
 * @returns {Object} - xhid、xqdm 和 semesterOptions；缺失时停止，不回退到当前 DOM。
 */
async function fetchImportParams() {
    const response = await fetch("/admin/pkgl/xskb/queryKbForXsd", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" }
    });
    if (!response.ok) throw new Error(`课表入口请求失败（HTTP ${response.status}）`);
    const responseDoc = new DOMParser().parseFromString(await response.text(), "text/html");
    const xhid = responseDoc.querySelector('#xhid')?.value.trim();
    const xqdm = responseDoc.querySelector('#xqdm')?.value.trim();
    const select = responseDoc.querySelector('#xnxq1') || responseDoc.querySelector('select[name="xnxq"]');
    const options = [...(select?.querySelectorAll('option') || [])].filter(option => option.value.trim());
    if (!xhid || !xqdm || !options.length) {
        throw new Error("课表入口未返回完整的账号参数或学期选项，请确认已登录超星教务后重试");
    }
    const semesterOptions = {
        labels: options.map(option => (option.textContent || option.value).trim()),
        values: options.map(option => option.value.trim()),
        defaultIndex: Math.max(options.findIndex(option => option.selected), 0)
    };
    return { xhid, xqdm, semesterOptions };
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

    const url = `/admin/api/getZclistByXnxq?${new URLSearchParams({ xnxq, xqid: xqdm })}`;

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

    const url = `/admin/xsd/pkgl/xskb/sdpkkbList?${new URLSearchParams({ xnxq, xhid, xqdm, xskbxslx: '0' })}`;

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
        const saved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (saved === false || saved === "false") throw new Error("课程校验未通过");
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
 * 提示用户开始导入。
 * @returns {Promise<boolean>} - 用户是否确认
 */
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "长沙工业学院课表导入",
        "请先登录超星教务系统，无需打开课表页面。\n\n本脚本将通过网络请求获取学期、校区和课程数据，并尝试获取作息时间及开学日期。",
        "开始导入"
    );
}

/**
 * 主导入流程。
 */
async function runImportFlow() {
    if (window.location.hostname !== "tls.ccsut.cn") {
        throw new Error("请先通过智慧校园进入超星教务系统（tls.ccsut.cn），再点击导入，无需打开课表页面");
    }
    console.log("JS: 开始执行超星教务系统课表导入流程...");

    // 2. 提示用户确认开始导入
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 3. 主动请求参数，和用户当前打开的页面无关
    const { xhid, xqdm: defaultXqdm, semesterOptions } = await fetchImportParams();

    // 4. 让用户选择学年学期
    const xnxq = await selectAcademicYearAndSemester(semesterOptions);
    if (xnxq === null) {
        window.shiguangBridge.showToast("导入已取消，未选择学年学期。");
        return;
    }

    // 5. 选择校区；列表接口失败时保留本次入口响应中的账号默认校区
    const selectedCampus = await selectCampus(defaultXqdm);
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
runImportFlow().catch((error) => {
    window.shiguangBridgePromise.showAlert("导入失败", error.message, "确定");
});
