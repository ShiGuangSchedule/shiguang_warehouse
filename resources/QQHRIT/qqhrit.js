// 齐齐哈尔工程学院(qqhrit.com) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

/**
 * 基础地址
 */
const BASE_URL = "http://jwxt.qqhrit.com:20266/jwglxt";

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 按天、课程名、教师、地点将课程分组，相同课程的记录归入同一组
    const grouped = {};
    courses.forEach(c => {
        const name = c.name || '';
        const teacher = c.teacher || '';
        const position = c.position || '';
        const day = c.day || 0;
        
        // 构造唯一标识，用于识别是否为同一门课
        const key = `${day}|${name}|${teacher}|${position}`;
        
        if (!grouped[key]) {
            grouped[key] = {
                name, teacher, position, day,
                // 记录每周对应的节次段，结构如 { 8: [ {start: 5, end: 6}, {start: 7, end: 8} ] }
                weeksMap: {}
            };
        }
        
        // 将该记录覆盖的所有周次拆开，分别记录对应周的节次段
        const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
        weeksArr.forEach(w => {
            if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
            grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
        });
    });

    const finalResult = [];

    // 逐组处理每门课程
    Object.values(grouped).forEach(group => {
        // 获取该课程有课的所有周次，升序排列
        const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);
        
        // 记录每周合并后的最终节次段，结构如 { 8: [ {start: 5, end: 8} ] }
        const processedWeeksMap = {};
        
        sortedWeeks.forEach(w => {
            let parts = group.weeksMap[w];
            
            // 按开始节次和结束节次排序，确保合并顺序正确
            parts.sort((a, b) => a.start - b.start || a.end - b.end);
            
            // 合并该周内连续或重叠的节次段
            const mergedParts = [];
            let cur = parts[0];
            for (let i = 1; i < parts.length; i++) {
                // 如果当前节次段与下一段相邻或重叠，则延长当前段
                if (cur.end + 1 >= parts[i].start) {
                    cur.end = Math.max(cur.end, parts[i].end);
                } else {
                    mergedParts.push(cur);
                    cur = parts[i];
                }
            }
            mergedParts.push(cur);
            processedWeeksMap[w] = mergedParts;
        });

        // 将节次结构完全相同的周次归为一组
        // 结构如 { "节次签名字符串": { sections: [...], weeks: [] } }
        const sectionsMap = {};
        
        sortedWeeks.forEach(w => {
            const parts = processedWeeksMap[w];
            // 将当前周的所有节次段组合成字符串签名，如 "1-2|5-6"
            const sig = parts.map(p => `${p.start}-${p.end}`).join('|');
            
            if (!sectionsMap[sig]) {
                sectionsMap[sig] = { sections: parts, weeks: [] };
            }
            sectionsMap[sig].weeks.push(w);
        });

        // 将每组相同节次结构的周次生成对应的课程对象
        Object.values(sectionsMap).forEach(secGroup => {
            secGroup.sections.forEach(sec => {
                finalResult.push({
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection: sec.start,
                    endSection: sec.end,
                    weeks: secGroup.weeks
                });
            });
        });
    });

    // 按星期、开始节次、课程名、起始周排序，保证输出结果顺序稳定
    finalResult.sort((a, b) => {
        return (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               a.name.localeCompare(b.name) ||
               a.weeks[0] - b.weeks[0];
    });

    return finalResult;
}


/**
 * 解析周次字符串，处理单双周和周次范围
 * 兼容中英文括号、多分隔符、带"第"字前缀、带"共 N 周"尾巴等常见正方返回格式
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
 * 独立处理课程时间逻辑的函数
 */
function applyCustomTimeLogic(courses) {
    // 方案1：周末全天
    const TIME_SCHEME_1 = [
        { number: 1, startTime: "08:20", endTime: "09:05" },
        { number: 2, startTime: "09:05", endTime: "09:50" },
        { number: 3, startTime: "10:00", endTime: "10:45" },
        { number: 4, startTime: "10:45", endTime: "11:30" },
        { number: 5, startTime: "13:30", endTime: "14:15" },
        { number: 6, startTime: "14:15", endTime: "15:00" },
        { number: 7, startTime: "15:20", endTime: "16:05" },
        { number: 8, startTime: "16:05", endTime: "16:50" },
        { number: 9, startTime: "18:00", endTime: "18:45" },
        { number: 10, startTime: "18:45", endTime: "19:30" },
        { number: 11, startTime: "19:30", endTime: "20:15" }
    ];

    // 方案2：2#/3# 专用（3-4节）
    const TIME_SCHEME_2 = [
        { number: 3, startTime: "09:55", endTime: "10:40" },
        { number: 4, startTime: "10:50", endTime: "11:35" }
    ];

    // 方案3：图/馆/齐三机床 专用（3-4节）
    const TIME_SCHEME_3 = [
        { number: 3, startTime: "10:05", endTime: "10:50" },
        { number: 4, startTime: "11:00", endTime: "11:45" }
    ];

    return courses.map(course => {
        const is23Sharp = /(2#|3#)/.test(course.position);
        const isLibMachine = /(图|馆|齐三机床)/.test(course.position);
        const isWeekend = (course.day === 6 || course.day === 7);
        const isSpecialPos = (is23Sharp || isLibMachine);
        const isEndpoint3or4 = (course.startSection === 3 || course.startSection === 4 ||
                                course.endSection === 3 || course.endSection === 4);
        const shouldApplyCustom = isWeekend || (isSpecialPos && isEndpoint3or4);

        if (shouldApplyCustom) {
            let startSlot, endSlot;

            if (isWeekend) {
                startSlot = TIME_SCHEME_1.find(s => s.number === course.startSection);
                endSlot = TIME_SCHEME_1.find(s => s.number === course.endSection);
            } else {
                // 工作日特殊教室逻辑
                const scheme = is23Sharp ? TIME_SCHEME_2 : TIME_SCHEME_3;

                const getSectionTime = (sec) => {
                    if (sec === 3 || sec === 4) {
                        return scheme.find(s => s.number === sec);
                    }
                    return TimeSlots.find(s => s.number === sec);
                };

                startSlot = getSectionTime(course.startSection);
                endSlot = getSectionTime(course.endSection);
            }

            if (startSlot && endSlot) {
                return {
                    ...course,
                    isCustomTime: true,
                    customStartTime: startSlot.startTime,
                    customEndTime: endSlot.endTime
                };
            }
        }

        return course;
    });
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

    const mergedCourses = mergeAndDistinctCourses(initialCourseList);
    return applyCustomTimeLogic(mergedCourses);
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
    const url = `${BASE_URL}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151`;

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
    const url = `${BASE_URL}/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154`;
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
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const targetUrl = `${BASE_URL}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;

    let courseResponse, semesterStartDate;
    try {
        // 并行获取课程数据和开学日期
        [courseResponse, semesterStartDate] = await Promise.all([
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
    } catch (e) {
        window.shiguangBridge.showToast("请求教务系统失败，请检查网络环境或登录状态。");
        return null;
    }

    try {
        if (courseResponse && courseResponse.ok) {
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

const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:20", endTime: "16:05" },
    { number: 8, startTime: "16:05", endTime: "16:50" },
    { number: 9, startTime: "18:00", endTime: "18:45" },
    { number: 10, startTime: "18:45", endTime: "19:30" },
    { number: 11, startTime: "19:30", endTime: "20:15" }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
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

    await importPresetTimeSlots(TimeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();