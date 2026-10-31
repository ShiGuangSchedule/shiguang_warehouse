/**
 * 拾光课程表适配脚本 - 南方医科大学 (smu.edu.cn)
 * 乘方教务系统适配
 * 出现问题请提issues或者提交pr更改,这更加快速
 */

// 基础配置

const BASE_URL = "https://zhjw.smu.edu.cn/new";

// 校区与作息时间映射
const CAMPUS_CONFIG = {
    // 校本部 (00001)
    "00001": {
        name: "校本部",
        timeSlots: [
            { number: 1, startTime: "08:00", endTime: "08:40" },
            { number: 2, startTime: "08:45", endTime: "09:25" },
            { number: 3, startTime: "09:50", endTime: "10:30" },
            { number: 4, startTime: "10:35", endTime: "11:15" },
            { number: 5, startTime: "11:20", endTime: "12:00" },
            { number: 6, startTime: "14:30", endTime: "15:10" },
            { number: 7, startTime: "15:15", endTime: "15:55" },
            { number: 8, startTime: "16:15", endTime: "16:55" },
            { number: 9, startTime: "17:00", endTime: "17:40" },
            { number: 10, startTime: "19:30", endTime: "20:10" },
            { number: 11, startTime: "20:15", endTime: "20:55" },
            { number: 12, startTime: "21:00", endTime: "21:40" },
            { number: 13, startTime: "21:45", endTime: "22:25" }
        ]
    },
    // 顺德校区 (00009)
    "00009": {
        name: "顺德校区",
        timeSlots: [
            { number: 1, startTime: "08:30", endTime: "09:10" },
            { number: 2, startTime: "09:15", endTime: "09:55" },
            { number: 3, startTime: "10:20", endTime: "11:00" },
            { number: 4, startTime: "11:05", endTime: "11:45" },
            { number: 5, startTime: "11:50", endTime: "12:30" },
            { number: 6, startTime: "14:00", endTime: "14:40" },
            { number: 7, startTime: "14:45", endTime: "15:25" },
            { number: 8, startTime: "15:45", endTime: "16:25" },
            { number: 9, startTime: "16:30", endTime: "17:10" },
            { number: 10, startTime: "19:30", endTime: "20:10" },
            { number: 11, startTime: "20:15", endTime: "20:55" },
            { number: 12, startTime: "21:00", endTime: "21:40" },
            { number: 13, startTime: "21:45", endTime: "22:25" }
        ]
    }
};

// 周次解析

/**
 * 解析周次字符串，例如 "1,2,3,4,5" -> [1, 2, 3, 4, 5]
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weeks = weekStr.split(',')
        .map(w => Number(w.trim()))
        .filter(w => !isNaN(w) && w > 0);
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 合并去重函数

/**
 * 节次与周次合并去重函数
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const grouped = {};
    courses.forEach(c => {
        const name = c.name || '';
        const teacher = c.teacher || '';
        const position = c.position || '';
        const day = c.day || 0;
        const isCustom = c.isCustomTime || false;
        const cst = c.customStartTime || '';
        const cet = c.customEndTime || '';

        const key = `${day}|${name}|${teacher}|${position}|${isCustom}|${cst}|${cet}`;

        if (!grouped[key]) {
            grouped[key] = { 
                name, teacher, position, day, 
                isCustomTime: isCustom, 
                customStartTime: cst, 
                customEndTime: cet, 
                weeksMap: {} 
            };
        }

        const weeksArr = Array.isArray(c.weeks) ? [...new Set(c.weeks)] : [];
        weeksArr.forEach(w => {
            if (!grouped[key].weeksMap[w]) grouped[key].weeksMap[w] = [];
            grouped[key].weeksMap[w].push({ start: c.startSection, end: c.endSection });
        });
    });

    const finalResult = [];

    Object.values(grouped).forEach(group => {
        const sortedWeeks = Object.keys(group.weeksMap).map(Number).sort((a, b) => a - b);
        const processedWeeksMap = {};

        sortedWeeks.forEach(w => {
            let parts = group.weeksMap[w];
            parts.sort((a, b) => a.start - b.start || a.end - b.end);

            const mergedParts = [];
            let cur = parts[0];
            for (let i = 1; i < parts.length; i++) {
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

        const sectionsMap = {};

        sortedWeeks.forEach(w => {
            const parts = processedWeeksMap[w];
            const sig = parts.map(p => `${p.start}-${p.end}`).join('|');
            if (!sectionsMap[sig]) sectionsMap[sig] = { sections: parts, weeks: [] };
            sectionsMap[sig].weeks.push(w);
        });

        Object.values(sectionsMap).forEach(secGroup => {
            secGroup.sections.forEach(sec => {
                const baseCourse = {
                    name: group.name,
                    teacher: group.teacher,
                    position: group.position,
                    day: group.day,
                    startSection: sec.start,
                    endSection: sec.end,
                    weeks: secGroup.weeks
                };

                if (group.isCustomTime) {
                    baseCourse.isCustomTime = true;
                    baseCourse.customStartTime = group.customStartTime;
                    baseCourse.customEndTime = group.customEndTime;
                }

                finalResult.push(baseCourse);
            });
        });
    });

    finalResult.sort((a, b) => {
        return (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               a.name.localeCompare(b.name) ||
               a.weeks[0] - b.weeks[0];
    });

    return finalResult;
}

// JSON 解析

/**
 * 将教务系统返回的 JSON 转换为拾光标准的 CourseJsonModel 数组
 */
function parseJsonData(jsonData) {
    if (!jsonData || jsonData.code !== 0 || !Array.isArray(jsonData.data)) {
        return { courses: [], campusCodes: [] };
    }

    let allProcessedCourses = [];
    let detectedCampusCodes = new Set();

    jsonData.data.forEach(raw => {
        if (!(raw.kcmc && raw.xq && raw.ps && raw.pe)) return;

        if (raw.kkxqdm) {
            detectedCampusCodes.add(String(raw.kkxqdm).trim());
        }

        const startSec = Number(raw.ps);
        const endSec = Number(raw.pe);

        let isCustomTime = false;
        let customStartTime = "";
        let customEndTime = "";

        // 【特殊逻辑说明】
        // 南方医科大学教务系统从第10节开始（晚间）的起止时间，与常规的“40分钟一节、课间5分钟”基础作息规则不一致。
        // 为了保证课表显示的实际上下课时间与教务系统完全吻合，遇到 >=10 节的课程，
        // 强制启用 isCustomTime，并直接使用接口返回的真实起止时间（qssj/jssj），不再依赖预设的基础节次时间。
        if (startSec >= 10) {
            isCustomTime = true;
            customStartTime = raw.qssj ? raw.qssj.substring(0, 5) : "";
            customEndTime = raw.jssj ? raw.jssj.substring(0, 5) : "";
        }

        const locationMap = new Map();
        if (raw.jxcdmc2) {
            const parts = raw.jxcdmc2.split(',');
            parts.forEach(part => {
                const lastDashIndex = part.lastIndexOf('-');
                if (lastDashIndex !== -1) {
                    const room = part.substring(0, lastDashIndex).trim();
                    const week = Number(part.substring(lastDashIndex + 1));
                    if (!isNaN(week)) {
                        if (!locationMap.has(room)) locationMap.set(room, []);
                        locationMap.get(room).push(week);
                    }
                }
            });
        }

        if (locationMap.size > 0) {
            locationMap.forEach((weeks, room) => {
                const courseObj = {
                    name: raw.kcmc.trim(),
                    teacher: (raw.teaxms || "未知教师").trim(),
                    position: room || "不用场地",
                    day: Number(raw.xq),
                    startSection: startSec,
                    endSection: endSec,
                    weeks: weeks.sort((a, b) => a - b)
                };
                if (isCustomTime) {
                    courseObj.isCustomTime = true;
                    courseObj.customStartTime = customStartTime;
                    courseObj.customEndTime = customEndTime;
                }
                allProcessedCourses.push(courseObj);
            });
        } else if (raw.zc) {
            const courseObj = {
                name: raw.kcmc.trim(),
                teacher: (raw.teaxms || "未知教师").trim(),
                position: (raw.jxcdmc || "").trim() || "不用场地",
                day: Number(raw.xq),
                startSection: startSec,
                endSection: endSec,
                weeks: parseWeeks(raw.zc)
            };
            if (isCustomTime) {
                courseObj.isCustomTime = true;
                courseObj.customStartTime = customStartTime;
                courseObj.customEndTime = customEndTime;
            }
            allProcessedCourses.push(courseObj);
        }
    });

    const filtered = allProcessedCourses.filter(course => {
        return course.weeks.length > 0 && course.startSection <= course.endSection;
    });

    return {
        courses: mergeAndDistinctCourses(filtered),
        campusCodes: Array.from(detectedCampusCodes)
    };
}

// 学年学期选项获取

async function fetchAcademicOptions() {
    const url = `${BASE_URL}/student/xlxx/xlxxlist.page`;

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) return null;

        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        const allOptions = Array.from(doc.querySelectorAll("#xnxqdm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({
                value: opt.value,
                text: opt.textContent.trim(),
                selected: opt.selected
            }));

        if (allOptions.length === 0) return null;

        const selectedIndex = allOptions.findIndex(opt => opt.selected);

        if (selectedIndex === -1) {
            return {
                options: allOptions.slice(0, 7),
                defaultIndex: 0
            };
        }

        const start = Math.max(0, selectedIndex - 3);
        const end = Math.min(allOptions.length, selectedIndex + 4);
        const options = allOptions.slice(start, end);
        const newDefaultIndex = selectedIndex - start;

        return { options, defaultIndex: newDefaultIndex };

    } catch (e) {
        return null;
    }
}

// 校历数据获取

async function fetchSemesterCalendar(xnxqdm) {
    const url = `${BASE_URL}/xlxx/data`;
    const requestBody = `xnxqdm=${xnxqdm}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });

        if (!response.ok) return { startDate: null, totalWeeks: null };

        const json = await response.json();
        if (!json || json.code !== 0 || !Array.isArray(json.data)) {
            return { startDate: null, totalWeeks: null };
        }

        let earliestDate = null;
        let earliestWeek = Infinity;
        let maxWeek = 0;

        json.data.forEach(monthBlock => {
            if (!Array.isArray(monthBlock)) return;

            monthBlock.forEach(row => {
                if (!Array.isArray(row) || row.length === 0) return;

                const weekHead = row[0];
                if (!weekHead || weekHead.type !== "zc") return;
                const weekNum = Number(weekHead.value);
                if (isNaN(weekNum)) return;

                if (weekNum > maxWeek) maxWeek = weekNum;

                for (let i = 1; i < row.length; i++) {
                    const cell = row[i];
                    if (!cell || cell.type !== "day") continue;
                    if (!cell.fullText) continue;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(cell.fullText)) continue;

                    if (weekNum < earliestWeek ||
                        (weekNum === earliestWeek && cell.fullText < earliestDate)) {
                        earliestWeek = weekNum;
                        earliestDate = cell.fullText;
                    }
                }
            });
        });

        return {
            startDate: earliestDate,
            totalWeeks: maxWeek > 0 ? maxWeek : null
        };

    } catch (e) {
        return { startDate: null, totalWeeks: null };
    }
}

// 保存逻辑模块

async function saveCampusTimeSlotsAndConfig(campusCodes, calendar) {
    let finalConfig = CAMPUS_CONFIG["00001"];
    
    let matchedCode = campusCodes.find(code => CAMPUS_CONFIG[code]);
    
    if (matchedCode) {
        finalConfig = CAMPUS_CONFIG[matchedCode];
    } else if (campusCodes.length > 0) {
        const unknownStr = campusCodes.join(", ");
        await window.shiguangBridgePromise.showAlert(
            "未记录校区提醒",
            `检测到课表中包含未记录的校区代码（${unknownStr}）。\n系统将默认使用【校本部】作息时间。`,
            "好的，继续导入"
        );
    }

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalConfig.timeSlots));

        if (calendar && (calendar.startDate || calendar.totalWeeks)) {
            const config = {};
            if (calendar.startDate) config.semesterStartDate = calendar.startDate;
            if (calendar.totalWeeks) config.semesterTotalWeeks = calendar.totalWeeks;

            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            
            let msg = `配置更新成功！(使用 ${finalConfig.name} 作息)`;
            if (calendar.startDate) msg += ` 开学：${calendar.startDate}`;
            if (calendar.totalWeeks) msg += ` 总周数：${calendar.totalWeeks}`;
            window.shiguangBridge.showToast(msg);
        } else {
            window.shiguangBridge.showToast(`作息已更新为 ${finalConfig.name}，但未获取到校历信息。`);
        }

    } catch (e) {
        window.shiguangBridge.showToast("保存配置或作息失败: " + e.message);
    }
}

// 用户交互

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务导入说明",
        "1. 请确保已在浏览器中成功登录教务系统\n2. 导入过程中请勿关闭页面",
        "好的，开始导入"
    );
}

async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (!optionsData) {
        window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确保登录状态。");
        return null;
    }

    const { options, defaultIndex } = optionsData;
    const texts = options.map(item => item.text);

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年学期",
        JSON.stringify(texts),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1) return null;

    return {
        xnxqdm: options[selectedIndex].value,
        xnxqmc: options[selectedIndex].text
    };
}

// 网络请求

async function fetchCourses(xnxqdm) {
    window.shiguangBridge.showToast("正在请求教务数据...");

    const body = `xnxqdm=${xnxqdm}`;
    const url = `${BASE_URL}/student/xsgrkb/getCalendarWeekDatas`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body,
            credentials: "include"
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const jsonData = await response.json();
        return parseJsonData(jsonData);
    } catch (e) {
        window.shiguangBridge.showToast("网络请求失败，请检查登录状态");
        return null;
    }
}

// 主流程编排

async function runImportFlow() {
    const isReady = await promptUserToStart();
    if (!isReady) return;

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入终止。");
        return;
    }

    const { xnxqdm } = selection;

    const [courseData, calendar] = await Promise.all([
        fetchCourses(xnxqdm),
        fetchSemesterCalendar(xnxqdm)
    ]);

    if (!courseData || !courseData.courses || courseData.courses.length === 0) {
        if (courseData && courseData.courses && courseData.courses.length === 0) {
            window.shiguangBridge.showToast("该学期暂无课程数据");
        }
        return;
    }

    const { courses, campusCodes } = courseData;

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await saveCampusTimeSlotsAndConfig(campusCodes, calendar);

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (e) {
        window.shiguangBridge.showToast("保存失败: " + e.message);
    }
}

// 启动入口
runImportFlow();