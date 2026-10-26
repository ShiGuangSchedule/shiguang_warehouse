// 湖南信息职业技术学院(hniu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 验证逻辑

/**
 * 年份输入验证函数
 * @param {string} input 用户输入的年份
 * @returns {boolean|string} 验证通过返回false，失败返回错误提示
 */
window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年！";
};

// 数据解析函数

/**
 * 将周次字符串解析为数字数组
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;
    
    // 适配 "1-9,11-17(周)[01-02节]" 或 "12-15(周)"
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
 * 转换课程 HTML 格式为应用模型
 */
function parseTimetableToModel(doc) {
    const timetable = doc.getElementById('timetable');
    if (!timetable) return [];

    const rawResults = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).slice(1);

    // 1. 原始解析阶段
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) return;

        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const detailDiv = cell.querySelector('div.kbcontent[style*="none"]');
            
            if (detailDiv) {
                const rawHtml = detailDiv.innerHTML.trim();
                if (rawHtml === "" || rawHtml === "&nbsp;") return;

                const courseBlocks = rawHtml.split(/---------------------|----------------------/);
                
                courseBlocks.forEach(block => {
                    if (block.replace(/&nbsp;|<br\/?>/g, '').trim() === "") return;

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let name = "";
                    for (let node of tempDiv.childNodes) {
                        if (node.nodeType === 3 && node.textContent.trim() !== "") {
                            name = node.textContent.trim();
                            break;
                        } else if (node.tagName === "BR" && name !== "") {
                            break;
                        } else if (node.nodeType === 3) {
                            name += node.textContent.trim();
                        }
                    }

                    const teacher = tempDiv.querySelector('font[title="教师"]')?.innerText || "未知教师";
                    const weekStr = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText || "";
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText || "未知地点";

                    let start = 0, end = 0;
                    if (weekStr) {
                        // 兼容 [01-02-03-04节] 格式
                        const sectionPartMatch = weekStr.match(/\[(.*?)节\]/);
                        if (sectionPartMatch && sectionPartMatch[1]) {
                            const nums = sectionPartMatch[1].match(/\d+/g);
                            if (nums && nums.length > 0) {
                                const sectionNums = nums.map(Number);
                                start = Math.min(...sectionNums);
                                end = Math.max(...sectionNums);
                            }
                        }
                    }

                    if (name && weekStr && start > 0) {
                        rawResults.push({
                            "name": name,
                            "teacher": teacher,
                            "weeks": parseWeeks(weekStr), // 解析出的数组
                            "position": position,
                            "day": day,
                            "startSection": start,
                            "endSection": end
                        });
                    }
                });
            }
        });
    });

    // 2. 去重与合并阶段
    // 排序顺序：星期 > 课程名 > 教师 > 教室 > 周次 > 起始节次
    rawResults.sort((a, b) => 
        a.day - b.day || 
        a.name.localeCompare(b.name) || 
        a.teacher.localeCompare(b.teacher) || 
        a.position.localeCompare(b.position) || 
        JSON.stringify(a.weeks).localeCompare(JSON.stringify(b.weeks)) ||
        a.startSection - b.startSection
    );

    const mergedResults = [];
    rawResults.forEach(current => {
        if (mergedResults.length === 0) {
            mergedResults.push(current);
            return;
        }

        const last = mergedResults[mergedResults.length - 1];

        // 检查是否完全相同（完全相同的重复项直接跳过）
        const isDuplicate = 
            last.day === current.day &&
            last.name === current.name &&
            last.teacher === current.teacher &&
            last.position === current.position &&
            last.startSection === current.startSection &&
            last.endSection === current.endSection &&
            JSON.stringify(last.weeks) === JSON.stringify(current.weeks);

        if (isDuplicate) return;

        // 检查是否可以合并（信息相同且节次连续，例如 1-2 节和 3-4 节合并为 1-4 节）
        const canMerge = 
            last.day === current.day &&
            last.name === current.name &&
            last.teacher === current.teacher &&
            last.position === current.position &&
            JSON.stringify(last.weeks) === JSON.stringify(current.weeks) &&
            current.startSection <= last.endSection + 1; // 节次连续或重叠

        if (canMerge) {
            last.endSection = Math.max(last.endSection, current.endSection);
        } else {
            mergedResults.push(current);
        }
    });

    return mergedResults;
}
/**
 * 保存课表全局配置
 */
async function saveAppConfig() {
    const config = {
        "semesterTotalWeeks": 20,
        "firstDayOfWeek": 1
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 保存时间段配置
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:10" },
        { "number": 2, "startTime": "09:20", "endTime": "10:00" },
        { "number": 3, "startTime": "10:20", "endTime": "11:00" },
        { "number": 4, "startTime": "11:10", "endTime": "11:50" },
        { "number": 5, "startTime": "14:00", "endTime": "14:40" },
        { "number": 6, "startTime": "14:50", "endTime": "15:30" },
        { "number": 7, "startTime": "15:50", "endTime": "16:30" },
        { "number": 8, "startTime": "16:40", "endTime": "17:20" },
        { "number": 9, "startTime": "18:40", "endTime": "19:20" },
        { "number": 10, "startTime": "19:30", "endTime": "20:10" },
        { "number": 11, "startTime": "20:20", "endTime": "21:00" },
        { "number": 12, "startTime": "21:10", "endTime": "21:50" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

/**
 * 获取并让用户选择学期 ID
 */
async function getSelectedSemesterId() {
    const currentYear = new Date().getFullYear();
    // 绑定验证函数 validateYearInput
    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年", "请输入要导入课程的起始学年（例如 2025-2026 应输入2025）:", String(currentYear), "validateYearInput"
    );
    if (!year) return null;
    
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(["第一学期", "第二学期"]), 0
    );
    if (semesterIndex === null) return null;
    
    return `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;
}

// 流程控制

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "公告",
            "请确保您已在当前页面成功登录教务系统，否则无法获取数据。是否继续？",
            "确认已登录"
        );
        if (!confirmed) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        const semesterId = await getSelectedSemesterId();
        if (!semesterId) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        window.shiguangBridge.showToast("正在获取教务数据...");
        
        const response = await fetch("https://jw.hniu.cn/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
            credentials: "include"
        });
        
        const html = await response.text();
        const finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现任何课程数据,检查是否登录或者学期选择是否正确");
            return;
        }

        // 保存数据
        window.shiguangBridge.showToast("正在保存配置...");
        await saveAppConfig();
        await saveAppTimeSlots();
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动导入流程
runImportFlow();