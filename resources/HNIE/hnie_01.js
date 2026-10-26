// 湖南工程学院(hnie.edu.cn) 强智教务适配脚本
// 双季作息：一个学期可能存在两种作息，用户手动选择

// 年份输入验证
window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年！";
};

// 解析周次字符串为数组
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

// 节次合并与去重
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

// 解析课程数据
function parseTimetableToModel(doc) {
    const timetable = doc.getElementById('timetable');
    if (!timetable) return [];
    let rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDivs = cell.querySelectorAll('div.kbcontent, div.kbcontent1');
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
                    if (!name) {
                        const nameFont = tempDiv.querySelector('font:not([title])');
                        if (nameFont) name = nameFont.innerText.trim();
                    }
                    const teacherRaw = tempDiv.querySelector('font[title="教师"]')?.innerText || "";
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
    return mergeAndDistinctCourses(rawCourses);
}

// 从教学周历解析开学日期和结束日期
function parseWeekCalendar(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.getElementById('kbtable');
    if (!table) return null;
    
    const rows = table.querySelectorAll('tr');
    let firstWeekMonday = null;
    let lastWeekSaturday = null;
    
    for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;
        
        const firstCell = cells[0].innerText.trim();
        if (!/^\d+$/.test(firstCell)) continue;
        
        const weekNum = parseInt(firstCell);
        if (weekNum === 1) {
            // 第1周，找周一（索引2：周号0、周日1、周一2）
            if (cells.length > 2) {
                firstWeekMonday = cells[2].getAttribute('title');
            }
        }
        // 记录最后一周
        if (cells.length > 7) {
            lastWeekSaturday = cells[7].getAttribute('title');
        }
    }
    
    return { firstWeekMonday, lastWeekSaturday };
}

// 保存课表配置
async function saveAppConfig(startDate) {
    const config = { 
        "semesterTotalWeeks": 20, 
        "firstDayOfWeek": 1,
        "semesterStartDate": startDate
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

// 双季作息时间表
const winterSlots = [
    { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
    { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
    { "number": 3,  "startTime": "10:10", "endTime": "10:55" },
    { "number": 4,  "startTime": "11:05", "endTime": "11:50" },
    { "number": 5,  "startTime": "14:00", "endTime": "14:45" },
    { "number": 6,  "startTime": "14:55", "endTime": "15:40" },
    { "number": 7,  "startTime": "16:10", "endTime": "16:55" },
    { "number": 8,  "startTime": "17:05", "endTime": "17:50" },
    { "number": 9,  "startTime": "19:00", "endTime": "19:45" },
    { "number": 10, "startTime": "19:55", "endTime": "20:40" },
    { "number": 11, "startTime": "20:50", "endTime": "21:35" }
];

const summerSlots = [
    { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
    { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
    { "number": 3,  "startTime": "10:10", "endTime": "10:55" },
    { "number": 4,  "startTime": "11:05", "endTime": "11:50" },
    { "number": 5,  "startTime": "14:30", "endTime": "15:15" },
    { "number": 6,  "startTime": "15:25", "endTime": "16:10" },
    { "number": 7,  "startTime": "16:40", "endTime": "17:25" },
    { "number": 8,  "startTime": "17:35", "endTime": "18:20" },
    { "number": 9,  "startTime": "19:30", "endTime": "20:15" },
    { "number": 10, "startTime": "20:25", "endTime": "21:10" },
    { "number": 11, "startTime": "21:20", "endTime": "22:05" }
];

// 保存时间段（根据用户选择）
async function saveAppTimeSlots(timeSlots) {
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

// 流程编排
async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示", "请确保已成功登录教务系统。是否开始导入？", "开始");
        if (!confirmed) return;

        // 选择学年
        const year = await window.shiguangBridgePromise.showPrompt("选择学年", "请输入要导入课程的起始学年（例如 2026-2027 应输入2026）:", "", "validateYearInput");
        if (!year) return;

        // 选择学期
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(["第一学期", "第二学期"]), -1);
        if (semesterIndex === null) return;

        // 选择作息时间类型
        const scheduleIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择作息时间",
            JSON.stringify(["冬令时", "夏令时"]),
            -1
        );
        if (scheduleIndex === null) return;

        const semesterId = `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;
        window.shiguangBridge.showToast("正在获取学期日期...");

        // 请求教学周历获取开学日期
        let semesterStartDate = null;
        try {
            let calendarBody = `xnxq01id=${semesterId}`;
            for (let i = 1; i <= 20; i++) {
                calendarBody += `&xqt=${i}&xqt=${i}`;
            }
            
            const calendarResp = await fetch("/jsxsd/jxzl/jxzl_query", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: calendarBody,
                credentials: "include"
            });
            const calendarHtml = await calendarResp.text();
            const calendarInfo = parseWeekCalendar(calendarHtml);
            if (calendarInfo && calendarInfo.firstWeekMonday) {
                // 转换格式：2026年09月07日 -> 2026-09-07
                const raw = calendarInfo.firstWeekMonday;
                const m = raw.match(/(\d{4})年(\d{2})月(\d{2})/);
                if (m) semesterStartDate = `${m[1]}-${m[2]}-${m[3]}`;
                window.shiguangBridge.showToast(`开学日期: ${semesterStartDate}`);
            }
        } catch (e) {
            console.error("获取学期日期失败:", e);
        }

        window.shiguangBridge.showToast("正在请求课程数据...");

        const response = await fetch("/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}&sfFD=1&wkbkc=1`,
            credentials: "include"
        });

        const html = await response.text();
        const finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态。");
            return;
        }

        await saveAppConfig(semesterStartDate);
        const selectedSlots = scheduleIndex === 0 ? winterSlots : summerSlots;
        await saveAppTimeSlots(selectedSlots);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

runImportFlow();
