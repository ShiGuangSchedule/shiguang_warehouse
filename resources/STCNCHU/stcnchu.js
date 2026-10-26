// 南昌航空大学科技学院(stcnchu.edu.cn) 拾光课程表适配脚本
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
 * 适配多校区双季作息
 * @param {number} campusIndex 0 代表共青城校区, 1 代表上海路校区
 * @param {number} semesterIndex 0 代表第一学期(冬令时), 1 代表第二学期(夏令时)
 */
async function saveAppTimeSlots(campusIndex, semesterIndex) {
    // 共青城校区
    const campus1_slots = {
        winter: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:05", "endTime": "10:45" },
            { "number": 4, "startTime": "10:50", "endTime": "11:30" },
            { "number": 5, "startTime": "13:20", "endTime": "14:00" },
            { "number": 6, "startTime": "14:05", "endTime": "14:45" },
            { "number": 7, "startTime": "14:55", "endTime": "15:35" },
            { "number": 8, "startTime": "15:40", "endTime": "16:20" },
            { "number": 9, "startTime": "19:00", "endTime": "19:40" },
            { "number": 10, "startTime": "19:45", "endTime": "20:25" },
            { "number": 11, "startTime": "20:30", "endTime": "21:10" },
            { "number": 12, "startTime": "21:15", "endTime": "21:55" }
        ],
        summer: [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:15", "endTime": "09:55" },
            { "number": 3, "startTime": "10:05", "endTime": "10:45" },
            { "number": 4, "startTime": "10:50", "endTime": "11:30" },
            { "number": 5, "startTime": "13:40", "endTime": "14:20" },
            { "number": 6, "startTime": "14:25", "endTime": "15:05" },
            { "number": 7, "startTime": "15:15", "endTime": "15:55" },
            { "number": 8, "startTime": "16:00", "endTime": "16:40" },
            { "number": 9, "startTime": "19:00", "endTime": "19:40" },
            { "number": 10, "startTime": "19:45", "endTime": "20:25" },
            { "number": 11, "startTime": "20:30", "endTime": "21:10" },
            { "number": 12, "startTime": "21:15", "endTime": "21:55" }
        ]
    };

    // 上海路校区（无双季作息，共用同一个数组）
    const shanghaiRoadTimeTable = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        { "number": 10, "startTime": "19:55", "endTime": "20:40" },
        { "number": 11, "startTime": "20:50", "endTime": "21:35" },
        { "number": 12, "startTime": "21:45", "endTime": "22:30" }
    ];

    const campus2_slots = {
        winter: shanghaiRoadTimeTable,
        summer: shanghaiRoadTimeTable
    };

    const targetCampus = (campusIndex === 0) ? campus1_slots : campus2_slots;
    const selectedSlots = (semesterIndex === 0) ? targetCampus.winter : targetCampus.summer;

    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(selectedSlots));
}

// ================= 流程编排 =================

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示", "请确保已成功登录教务系统。是否开始导入？", "开始");
        if (!confirmed) return;

        // 1. 获取就读校区
        const campusIndex = await window.shiguangBridgePromise.showSingleSelection("选择所在校区", JSON.stringify(["共青城校区", "上海路校区"]), -1);
        if (campusIndex === null) return;

        // 2. 获取学年
        const year = await window.shiguangBridgePromise.showPrompt("选择学年", "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:", "", "validateYearInput");
        if (!year) return;

        // 3. 获取学期并记录索引
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(["第一学期", "第二学期"]), -1);
        if (semesterIndex === null) return;

        const semesterId = `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;

        window.shiguangBridge.showToast("正在请求数据...");
        const response = await fetch("http://qzjwxt.stcnchu.edu.cn:800/jsxsd/xskb/xskb_list.do", {
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

        // 保存全局设置
        await saveAppConfig();
        // 传入校区索引和学期索引联合控制作息映射
        await saveAppTimeSlots(campusIndex, semesterIndex);
        // 保存课程
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动
runImportFlow();