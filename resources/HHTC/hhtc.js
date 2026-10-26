// 怀化学院(hhtc.edu.cn) 拾光课程表适配脚本
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
            let day = dayIndex + 1;
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
 * 全局课程合并逻辑
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    // 1. 建立基于 (课程名|教师|地点|星期几) 的分组
    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                // 假设大学最多 50 周，构建一个：第 N 周对应哪些节次的矩阵
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        }
        // 将系统传来的凌乱数据彻底打散，按“周”填入对应的“节”中，Set自动去重
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });

    const merged = [];

    // 2. 根据矩阵重新组装绝对精确的课程块
    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;
        
        // 用于记录相同的“连续节次块”分布在哪些周次
        // 例如 blockMap["1-2"] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        // 例如 blockMap["2-2"] = [10]
        const blockMap = {};

        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            // 寻找当前周的连续节次块
            let start = sections[0];
            let prev = sections[0];

            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr; // 节次连续，继续延伸
                } else {
                    // 节次断开，结算上一个块
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    
                    // 开启新块
                    start = curr;
                    prev = curr;
                }
            }
            // 结算每周最后一个块
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        // 3. 将聚合好的 blockMap 转换为最终的 JSON 对象
        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey]
            });
        }
    }

    // 4. 排序以便输出整洁美观
    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

/**
 * 保存课表全局配置
 */
async function saveAppConfig() {
    const config = {
        "firstDayOfWeek": 1
    };
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 保存时间段配置
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:20", "endTime": "09:05" },
        { "number": 2, "startTime": "09:15", "endTime": "10:00" },
        { "number": 3, "startTime": "10:20", "endTime": "11:05" },
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "14:20", "endTime": "15:05" },
        { "number": 6, "startTime": "15:15", "endTime": "16:00" },
        { "number": 7, "startTime": "16:20", "endTime": "17:05" },
        { "number": 8, "startTime": "17:15", "endTime": "18:00" },
        { "number": 9, "startTime": "19:30", "endTime": "20:15" },
        { "number": 10, "startTime": "20:25", "endTime": "21:10" }
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
        "选择学期", JSON.stringify(["第一学期", "第二学期"]), -1
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
        const response = await fetch("https://jwmis.hhtc.edu.cn/jsxsd/xskb/xskb_list.do", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `cj0701id=&zc=&demo=&xnxq01id=${semesterId}`,
            credentials: "include"
        });
        
        if (!response.ok) throw new Error("网络请求失败，请检查登录状态");

        const html = await response.text();
        let finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));

        finalCourses = mergeContinuousLessons(finalCourses);

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