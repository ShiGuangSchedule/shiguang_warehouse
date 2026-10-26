// 长春工程学院(ccit.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 工具函数

window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年！"; //[cite: 1]
};

function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    const pureWeekData = weekStr.split('(')[0]; 
    pureWeekData.split(',').forEach(seg => {
        if (seg.includes('-')) {
            const [s, e] = seg.split('-').map(Number);
            if (!isNaN(s) && !isNaN(e)) {
                for (let i = s; i <= e; i++) weeks.push(i);
            }
        } else {
            const w = parseInt(seg);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 节次合并与去重
 */
function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;

    courses.sort((a, b) => {
        return a.name.localeCompare(b.name) || 
               a.day - b.day || 
               a.startSection - b.startSection || 
               a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const merged = [];
    let current = courses[0];

    for (let i = 1; i < courses.length; i++) {
        const next = courses[i];
        const isSameCourse = 
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;

        if (isSameCourse && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection) {
            continue;
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

/**
 * 错峰上下课时间适配逻辑
 */
function applyCustomTimeSplitting(courses) {
    const SPLIT_CONFIG = [
        {
            // 组1
            // 匹配：DJ1(11-12层), DJ2(21-23层), XJ3(31-32层), XJ5(51-52层), XJ6(61-62层), XJ7(71-74层)
            regex: /(DJ1-1[12])|(DJ2-2[1-3])|(XJ3-3[12])|(XJ5-5[12])|(XJ6-6[12])|(XJ7-7[1-4])/,
            timeMap: {
                1: ["07:50", "08:35"], 2: ["08:35", "09:20"],
                3: ["10:10", "10:55"], 4: ["10:55", "11:40"],
                5: ["13:20", "14:05"], 6: ["14:05", "14:50"],
                7: ["15:40", "16:25"], 8: ["16:25", "17:10"],
                9: ["18:00", "18:45"], 10: ["18:50", "19:35"]
            }
        },
        {
            // 组2
            // 匹配：DJ1(13-15层), DJ2(24-26层), XJ3(33-34层), XJ6(63层), XJ7(75-77层), DSx, XSx
            regex: /(DJ1-1[3-5])|(DJ2-2[4-6])|(XJ3-3[34])|(XJ6-63)|(XJ7-7[5-7])|(DS)|(XS)/,
            timeMap: {
                1: ["08:10", "08:55"], 2: ["08:55", "09:40"],
                3: ["10:30", "11:15"], 4: ["11:15", "12:00"],
                5: ["13:40", "14:25"], 6: ["14:25", "15:10"],
                7: ["16:00", "16:45"], 8: ["16:45", "17:30"],
                9: ["18:00", "18:45"], 10: ["18:50", "19:35"]
            }
        }
    ];

    return courses.map(course => {
        for (const config of SPLIT_CONFIG) {
            // 使用正则匹配 course.position (上课地点)
            if (config.regex.test(course.position)) {
                const startTimes = config.timeMap[course.startSection];
                const endTimes = config.timeMap[course.endSection];

                if (startTimes && endTimes) {
                    // 必须设为 true 以激活自定义时间模式
                    course.isCustomTime = true; 
                    // 格式必须为 HH:mm
                    course.customStartTime = startTimes[0];
                    course.customEndTime = endTimes[1];
                }
                break; 
            }
        }
        return course;
    });
}

// 核心解析逻辑

function parseTimetableToModel(doc) {
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return [];

    let rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDivs = cell.querySelectorAll('div.kbcontent');
            
            detailDivs.forEach(div => {
                const rawHtml = div.innerHTML.trim();
                if (!rawHtml || rawHtml === "&nbsp;" || div.innerText.trim().length < 2) return;

                const blocks = rawHtml.split(/---------------------|----------------------/);

                blocks.forEach(block => {
                    if (!block.trim()) return;
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let name = "";
                    for (let node of tempDiv.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        }
                    }

                    const teacherRaw = tempDiv.querySelector('font[title="老师"], font[title="教师"]')?.innerText || "";
                    const teacher = teacherRaw.replace("任课教师:", "").trim();
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText || "未知地点";
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText || "";
                    
                    let startSection = 0;
                    let endSection = 0;
                    if (weekStr) {
                        const sectionPart = weekStr.match(/\[(.*?)节\]/);
                        if (sectionPart && sectionPart[1]) {
                            const sections = sectionPart[1].split('-').map(Number).filter(n => !isNaN(n));
                            if (sections.length > 0) {
                                startSection = sections[0];
                                endSection = sections[sections.length - 1];
                            }
                        }
                    }

                    if (name && startSection > 0) {
                        rawCourses.push({
                            "name": name,
                            "teacher": teacher || "未知教师",
                            "weeks": parseWeeks(weekStr),
                            "position": position,
                            "day": day,
                            "startSection": startSection,
                            "endSection": endSection
                        });
                    }
                });
            });
        });
    });

    // 1. 先进行标准节次合并
    const merged = mergeAndDistinctCourses(rawCourses);
    // 2. 根据地点注入自定义时间（合并后注入）
    return applyCustomTimeSplitting(merged);
}

// 配置与流程

async function saveAppConfig() {
    const config = { "semesterTotalWeeks": 20, "firstDayOfWeek": 1 };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "10:05", "endTime": "10:50" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "13:30", "endTime": "14:15" },
        { "number": 6, "startTime": "14:20", "endTime": "15:05" },
        { "number": 7, "startTime": "15:35", "endTime": "16:20" },
        { "number": 8, "startTime": "16:25", "endTime": "17:10" },
        { "number": 9, "startTime": "18:00", "endTime": "18:45" },
        { "number": 10, "startTime": "18:50", "endTime": "19:35" },
        { "number": 11, "startTime": "19:40", "endTime": "20:25" },
        { "number": 12, "startTime": "20:30", "endTime": "21:15" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示", "请确保已成功登录教务系统。是否开始导入？", "开始");
        if (!confirmed) return;

        const currentYear = new Date().getFullYear();
        const year = await window.shiguangBridgePromise.showPrompt("选择学年", "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:", String(currentYear), "validateYearInput");
        if (!year) return;

        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(["第一学期", "第二学期"]), 0);
        if (semesterIndex === null) return;

        const semesterId = `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;

        window.shiguangBridge.showToast("正在请求数据...");
        const response = await fetch("https://http-10-198-47-148-8080.webvpn.ccit.edu.cn/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `jx0404id=&cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
            credentials: "include"
        });
        
        const html = await response.text();
        const finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        await saveAppConfig();
        await saveAppTimeSlots();
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses)); //[cite: 1]
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

runImportFlow();