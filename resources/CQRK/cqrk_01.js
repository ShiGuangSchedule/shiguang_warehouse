// 重庆人文科技学院(cqrk.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 工具函数

window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年！";
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
                        // 匹配方括号内所有的数字
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

    return mergeAndDistinctCourses(rawCourses);
}

// 配置与流程

async function saveAppConfig() {
    const config = { "semesterTotalWeeks": 20, "firstDayOfWeek": 1 };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 全年统一作息（不再分学期）
 */
async function saveAppTimeSlots() {
    // 重庆人文科技学院全年统一作息
    const timeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:15" },
        { "number": 2, "startTime": "09:20", "endTime": "10:05" },
        { "number": 3, "startTime": "10:20", "endTime": "11:05" },
        { "number": 4, "startTime": "11:10", "endTime": "11:55" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:50", "endTime": "15:35" },
        { "number": 7, "startTime": "15:40", "endTime": "16:25" },
        { "number": 8, "startTime": "16:40", "endTime": "17:25" },
        { "number": 9, "startTime": "17:30", "endTime": "18:15" },
        { "number": 10, "startTime": "19:00", "endTime": "19:45" },
        { "number": 11, "startTime": "19:50", "endTime": "20:35" },
        { "number": 12, "startTime": "20:40", "endTime": "21:25" }
    ];

    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示", "请确保已成功登录教务系统。是否开始导入？", "开始");
        if (!confirmed) return;

        // 1. 获取学年
        const currentYear = new Date().getFullYear();
        const year = await window.shiguangBridgePromise.showPrompt("选择学年", "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:", String(currentYear), "validateYearInput");
        if (!year) return;

        // 2. 获取学期并记录索引
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(["第一学期", "第二学期"]), 0);
        if (semesterIndex === null) return;

        const semesterId = `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;

        window.shiguangBridge.showToast("正在请求数据...");
        const response = await fetch("http://jwxt.cqrk.edu.cn:18080/jsxsd/xskb/xskb_list.do", {
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
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动
runImportFlow();