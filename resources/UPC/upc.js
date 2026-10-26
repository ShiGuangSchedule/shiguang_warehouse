// 中国石油大学（华东)(upc.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

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

    const results = [];
    const rows = Array.from(timetable.querySelectorAll('tr')).slice(1);

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) return;

        cells.forEach((cell, dayIndex) => {
            let day;
            if (dayIndex === 0) {
                day = 7;
            } else {
                day = dayIndex;
            }
            const detailDivs = cell.querySelectorAll('.kbcontent, .kbcontent1');
            
            detailDivs.forEach(detailDiv => {
                const rawHtml = detailDiv.innerHTML.trim();
                if (rawHtml === "" || rawHtml === "&nbsp;") return;

                const courseBlocks = rawHtml.split(/---------------------|----------------------/);
                
                courseBlocks.forEach(block => {
                    if (block.replace(/&nbsp;|<br\/?>/g, '').trim() === "") return;

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let name = "";
                    const nameFont = tempDiv.querySelector('font:not([title])');
                    if (nameFont) {
                        name = nameFont.innerText.trim();
                    }

                    // 提取教师、周次、地点
                    const teacher = tempDiv.querySelector('font[title="教师"]')?.innerText.trim() || "未知教师";
                    const weekInfo = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText.trim() || "";
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText.trim() || "未知地点";

                    let start = 0, end = 0;
                    if (weekInfo) {
                        const secMatch = weekInfo.match(/\[(\d+)(?:-(\d+))?节\]/);
                        if (secMatch) {
                            start = parseInt(secMatch[1]);
                            end = secMatch[2] ? parseInt(secMatch[2]) : start;
                        }
                    }

                    if (name && start > 0) {
                        results.push({
                            "name": name,
                            "teacher": teacher,
                            "weeks": parseWeeks(weekInfo),
                            "position": position,
                            "day": day,
                            "startSection": start,
                            "endSection": end
                        });
                    }
                });
            });
        });
    });

    return results;
}

/**
 * 保存课表全局配置
 */
async function saveAppConfig() {
    const config = {
        "firstDayOfWeek": 7
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 保存时间段配置
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:50", "endTime": "09:35" },
        { "number": 3, "startTime": "09:55", "endTime": "10:40" },
        { "number": 4, "startTime": "10:45", "endTime": "11:30" },
        { "number": 5, "startTime": "11:35", "endTime": "12:20" },
        { "number": 6, "startTime": "14:00", "endTime": "14:45" },
        { "number": 7, "startTime": "14:50", "endTime": "15:35" },
        { "number": 8, "startTime": "15:55", "endTime": "16:40" },
        { "number": 9, "startTime": "16:45", "endTime": "17:30" },
        { "number": 10, "startTime": "19:00", "endTime": "19:45" },
        { "number": 11, "startTime": "19:50", "endTime": "20:35" },
        { "number": 12, "startTime": "20:40", "endTime": "21:25" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

/**
 * 获取并让用户选择学期 ID
 */
async function getSelectedSemesterId() {
    const currentYear = new Date().getFullYear();
    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年", "请输入起始学年（如 2025-2026 应输入 2025）:", String(currentYear), "validateYearInput"
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
            "导入提示",
            "脚本将获取当前教务系统的课表数据。请确保您已登录。是否继续？",
            "确认并开始"
        );
        if (!confirmed) return;

        const semesterId = await getSelectedSemesterId();
        if (!semesterId) {
            window.shiguangBridge.showToast("用户取消了学期选择");
            return;
        }

        window.shiguangBridge.showToast("正在请求教务数据...");
        const response = await fetch("https://jwxt-443.webvpn.upc.edu.cn/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
            credentials: "include"
        });
        
        if (!response.ok) throw new Error("网络请求失败，请检查登录状态");

        const html = await response.text();
        const finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));

        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程数据，请检查该学期是否有课或登录是否过期");
            return;
        }
        await saveAppConfig();
        await saveAppTimeSlots();
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程！`);

        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error(error);
        window.shiguangBridge.showToast("异常: " + error.message);
    }
}

// 启动导入流程
runImportFlow();