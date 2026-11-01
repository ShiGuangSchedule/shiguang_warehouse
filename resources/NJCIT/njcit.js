// 南京信息职业技术学院教务适配
// 注意：本校教务页面加载的 zftal-ui 的 jquery.extends.contact-min.js
// 会污染以下原型方法，本文件一律不使用：
//   Array.prototype.filter / some —— 回调实参变成 (下标, 元素, 数组)
//   Array.prototype.every        —— 恒为 true
//   String.prototype.trim        —— 删除所有空白而非仅首尾
// 参考 resources/SCNU/scnu.js、resources/UJS/ujs_zhengfang_v9.0.js 的同类处理。

const text = value => String(value == null ? '': value).replace(/^\s+|\s+$/g, '');

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统（无需打开课表页面），点击开始后将弹窗选择学期。",
        "好的，开始导入"
    );
}

async function fetchAcademicOptions() {
    const url = "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default"

    try {
        const response = await fetch(url, {
            method : "GET",
            credentials: "include"
        }) 

        if (!response.ok) {
            return null;
        }

        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, "text/html");

        const parseOptions = (selector) => {
            const list = [];
            let defaultIdx = 0;

            for (const opt of doc.querySelectorAll(`${selector} option`)) {
                const value = opt.getAttribute("value") || opt.value;
                if (!value) continue;

                const selected = opt.hasAttribute("selected") || opt.selected;
                if (selected) defaultIdx = list.length;
                
                list.push({value, text: text(opt.textContent), selected});
            }

            return {list, defaultIdx};
        }
        const {list: allYears, defaultIdx: yearIdx} = parseOptions("#xnm");
        const {list: semesterOptions, defaultIdx: defaultSemesterIndex } = parseOptions("#xqm");

        if (allYears.length == 0 || semesterOptions.length == 0) return null;

        const start = Math.max(0, yearIdx - 2);
        const end = Math.min(allYears.length, yearIdx + 3);

        const yearOptions = allYears.slice(start, end);

        return {
            yearOptions,
            semesterOptions,
            defaultYearIndex: yearIdx - start,
            defaultSemesterIndex
        }
    } catch(error) {
        console.error(error.message);
        return null;
    }
}


async function selectAcademicYearAndSemester()  {
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

    if (yearIndex === null || yearIndex === -1) {
        return null;
    }
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

async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}`;
    try {
        const response = await fetch(url, {
            method : "POST",
            headers : {
                "Content-Type" :"application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) {
            return null;
        }

        const json = await response.json();
        if (Array.isArray(json) &&  json.length > 0) {
            const firstWeekObj = json.find(item => String(item.zs) == "1" || String(item.zsmc) == "1") || json[0];
            const totalWeeksInt = json.length;

            if (firstWeekObj.rq) {
                const startDateStr = firstWeekObj.rq.split('/')[0];
                if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
                    return {
                        semesterStartDate : startDateStr,
                        semesterTotalWeeks: totalWeeksInt
                    }
                }
            }
        }

    } catch(e) {
        console.error(e);
    }
    return null;
}

async function fetchTimesSlots(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151";
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&xqh_id=01`;
    try {
        const response = await fetch(url, {
            method : "POST",
            headers : {
                "Content-Type" :"application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) {
            return null;
        }

        const json = await response.json();
        if (!Array.isArray(json)) {
            return null;
        }
        
        const timeSlots = [];
        for (const item of json) {
            if (!item.jcmc || !item.qssj || !item.jssj) {
                continue;
            }

            timeSlots.push({
                number: Number(item.jcmc),
                startTime: item.qssj.substring(0, 5),
                endTime: item.jssj.substring(0, 5)
            })
        }
        timeSlots.sort((a, b) => a.number - b.number);
            
        return timeSlots.length > 0 ? timeSlots : null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

/**
 * 节次与周次合并去重函数
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

function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = text(set);

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/);

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }
        
        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseCourseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        return [];
    }

    const rawCourseList = jsonData.kbList;
    let initalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);
        const day = Number(rawCourse.xqj);
        const weeks = parseWeeks(rawCourse.zcd);

        initalCourseList.push({
            name: text(rawCourse.kcmc),
            teacher: text(rawCourse.xm),
            position: text(rawCourse.cdmc || "未排地点"),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        })
    }

    return mergeAndDistinctCourses(initalCourseList);
}


async function fetchAndParseCourses(academicYear, semesterCode) {
    const url = "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck`;
    
    try {
        const [courseResponse, semesterStartDate, fetchedTimeSlots] = await Promise.all(
            [
                fetch(url, {
                method : "POST",
                headers : {
                    "Content-Type" :"application/x-www-form-urlencoded;charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest"
                },
                body: requestBody,
                credentials: "include"
                }),
                fetchSemesterStartDate(academicYear, semesterCode),
                fetchTimesSlots(academicYear, semesterCode)
            ]
        );

        if (courseResponse.ok) {
            const json = await courseResponse.json();
            const courseData = parseCourseJsonData(json);

            return {
                courses: courseData,
                config: semesterStartDate,
                timeSlots: fetchedTimeSlots
            }
        }
    } catch(e) {
        console.error(e);
    }

    return null;
}



// 课程是必须的，保存失败就没有导入的意义，抛异常交给导入流程中断
async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (error) {
        throw new Error("课程保存失败：" + error.message);
    }
}

// 作息和学期配置不是必须的，失败只返回 false，由导入流程汇总提示
async function saveTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

async function saveConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

(async function runImportFlow() {

    const confirmed = await promptUserToStart();
    if (!confirmed) {
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
    if (!result || !result.courses || result.courses.length === 0) {
        window.shiguangBridge.showToast("未获取到有效课程，导入终止！");
        return;
    }
    const { courses, config, timeSlots } = result;

    try {
        await saveCourses(courses);
    } catch(error) {
        window.shiguangBridge.showToast(error.message);
        return;
    }

    // 记下没保存成功的部分，最后一起提示，避免提示互相覆盖
    const failed = [];

    if (config) {
        const saved = await saveConfig(config);
        if (!saved) failed.push("学期配置");
    }

    if (timeSlots) {
        const saved = await saveTimeSlots(timeSlots);
        if (!saved) failed.push("作息");
    }

    window.shiguangBridge.showToast(
        failed.length
            ? `成功导入 ${courses.length} 条排课记录，但${failed.join("、")}未保存成功`
            : `成功导入 ${courses.length} 条排课记录！`
    );

    window.shiguangBridge.notifyTaskCompletion();
})();