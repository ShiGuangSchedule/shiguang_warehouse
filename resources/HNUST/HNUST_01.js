/**
 * 解析强智系统的周次字符串
 */
function parseWeeks(weekStr) {
    let weeks = [];
    let parts = weekStr.split(',');
    for (let part of parts) {
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 提取课程数据
 */
/**
 * 提取课程数据（已优化多节连堂课合并与去重逻辑）
 */
function extractCoursesFromDoc(doc) {
    let parsedCourses = [];
    const table = doc.getElementById('timetable');
    if (!table) throw new Error("请求成功但未找到课表表格，请确认教务系统状态。");

    const rows = table.getElementsByTagName('tr');
    for (let i = 1; i < rows.length - 1; i++) {
        const cells = rows[i].getElementsByTagName('td');
        for (let j = 0; j < cells.length; j++) {
            const dayOfWeek = j + 1; 
            const cell = cells[j];
            
            const detailDivs = cell.querySelectorAll('div.kbcontent');
            if (detailDivs.length === 0) continue;

            detailDivs.forEach(div => {
                let htmlContent = div.innerHTML;
                if (!htmlContent.trim() || htmlContent === '&nbsp;') return;

                let courseBlocks = htmlContent.split(/-{10,}\s*<br\s*\/?>/i);

                courseBlocks.forEach(block => {
                    if (!block.trim()) return;

                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let courseObj = {
                        day: dayOfWeek,
                        isCustomTime: false
                    };

                    let firstNode = tempDiv.childNodes[0];
                    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
                        courseObj.name = firstNode.nodeValue.trim();
                    } else {
                        courseObj.name = tempDiv.innerText.split('\n')[0].trim();
                    }

                    let teacherFont = tempDiv.querySelector('font[title="教师"]');
                    courseObj.teacher = teacherFont ? teacherFont.innerText.trim() : "未知";

                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont ? positionFont.innerText.trim() : "待定";

                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = timeFont.innerText.trim();
                        let timeMatch = timeText.match(/(.+?)\(周\)\[([\d-]+)节\]/);
                        if (timeMatch) {
                            courseObj.weeks = parseWeeks(timeMatch[1]);
                            let sections = timeMatch[2].split('-');
                            courseObj.startSection = parseInt(sections[0]);
                            courseObj.endSection = parseInt(sections[sections.length - 1]);
                        } else {
                            let weekOnlyMatch = timeText.match(/(.+?)\(周\)/);
                            if (weekOnlyMatch) {
                                courseObj.weeks = parseWeeks(weekOnlyMatch[1]);
                                courseObj.startSection = i * 2 - 1;
                                courseObj.endSection = i * 2;
                            } else return; 
                        }
                    } else return; 

                    if (courseObj.name && courseObj.weeks && courseObj.weeks.length > 0) {
                        let isDuplicate = parsedCourses.some(c => 
                            c.day === courseObj.day &&
                            c.name === courseObj.name &&
                            c.startSection === courseObj.startSection &&
                            c.endSection === courseObj.endSection &&
                            c.teacher === courseObj.teacher &&
                            c.position === courseObj.position &&
                            JSON.stringify(c.weeks) === JSON.stringify(courseObj.weeks)
                        );
                        
                        if (!isDuplicate) {
                            parsedCourses.push(courseObj);
                        }
                    }
                });
            });
        }
    }
    return parsedCourses;
}

// ======== 替换原有的 getPresetTimeSlots，引入双套作息时间 ========

// 非夏季（秋冬春）作息（保持 HNUST 原有数据）
const Non_summerTimeSlots = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:55", "endTime": "09:40" },
    { "number": 3, "startTime": "10:00", "endTime": "10:45" },
    { "number": 4, "startTime": "10:55", "endTime": "11:40" },
    { "number": 5, "startTime": "14:00", "endTime": "14:45" },
    { "number": 6, "startTime": "14:55", "endTime": "15:40" },
    { "number": 7, "startTime": "16:00", "endTime": "16:45" },
    { "number": 8, "startTime": "16:55", "endTime": "17:40" },
    { "number": 9, "startTime": "19:00", "endTime": "19:45" },
    { "number": 10,"startTime": "19:55", "endTime": "20:40" }
];

// 夏季作息（注：此处假设下午推迟半小时，请根据 HNUST 实际情况微调时间）
const SummerTimeSlots = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:55", "endTime": "09:40" },
    { "number": 3, "startTime": "10:00", "endTime": "10:45" },
    { "number": 4, "startTime": "10:55", "endTime": "11:40" },
    { "number": 5, "startTime": "14:30", "endTime": "15:15" },
    { "number": 6, "startTime": "15:25", "endTime": "16:10" },
    { "number": 7, "startTime": "16:30", "endTime": "17:15" },
    { "number": 8, "startTime": "17:25", "endTime": "18:10" },
    { "number": 9, "startTime": "19:30", "endTime": "20:15" },
    { "number": 10,"startTime": "20:25", "endTime": "21:10" }
];

/**
 * 弹出选择作息时间
 */
async function selectTimeSlotsType() {
    const timeSlotsOptions = ["非夏季作息 (14:00上课)", "夏季作息 (14:30上课)"];
    console.log("JS: 提示用户选择作息时间类型。");
    
    // 如果不在APP内（网页测试环境），默认返回0
    if (typeof window.shiguangBridgePromise === 'undefined') {
        return 0; 
    }
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(timeSlotsOptions),
        0 // 默认选中第一个
    );
    return selectedIndex;
}

// =================================================================

/**
 * 生成全局课表配置
 */
function getCourseConfig() {
    return {
        "defaultClassDuration": 45,
        "defaultBreakDuration": 10
    };
}

/**
 * 异步编排流程
 */
async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在获取课表数据，请稍候...");
        } else {
            console.log("正在发起请求获取课表...");
        }

        const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET' });
        const htmlText = await response.text();
        const parser = new DOMParser();
        let doc = parser.parseFromString(htmlText, 'text/html');

        const selectElem = doc.getElementById('xnxq01id');
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected')) {
                    defaultIndex = index;
                }
            });
        }

        if (semesters.length > 0 && typeof window.shiguangBridgePromise !== 'undefined') {
            let selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
                "请选择要导入的学期", 
                JSON.stringify(semesters), 
                defaultIndex
            );

            if (selectedIdx === null) {
                window.shiguangBridge.showToast("已取消导入");
                return;
            }

            if (selectedIdx !== defaultIndex) {
                window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 课表...`);
                let formData = new URLSearchParams();
                formData.append('xnxq01id', semesterValues[selectedIdx]);

                const postResponse = await fetch('/jsxsd/xskb/xskb_list.do', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });
                const postHtml = await postResponse.text();
                doc = parser.parseFromString(postHtml, 'text/html');
            }
        }

        const courses = extractCoursesFromDoc(doc);
        
        if (courses.length === 0) {
            const errMsg = "未能解析到任何课程，请检查是否暂无排课。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else {
                alert(errMsg);
            }
            return;
        }

        const config = getCourseConfig();

        // ------------------ 选择作息时间阶段 ------------------
        const timeSlotsIndex = await selectTimeSlotsType();
        if (timeSlotsIndex === null && typeof window.shiguangBridgePromise !== 'undefined') {
             window.shiguangBridge.showToast("已取消选择作息时间，终止导入");
             return;
        }
        
        let selectedTimeSlots = Non_summerTimeSlots;
        if (timeSlotsIndex === 1) {
             selectedTimeSlots = SummerTimeSlots;
        }
        // -----------------------------------------------------

        // 浏览器测试环境，直接输出结果
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【测试成功】课表配置：", config);
            console.log("【测试成功】作息时间：", selectedTimeSlots);
            console.log("【测试成功】课程数据：", courses);
            alert(`解析成功！获取到 ${courses.length} 门课程以及作息时间。请打开F12控制台查看。`);
            return;
        }

        // APP 环境，执行保存配置和作息时间
        const configSaved = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        const timeSlotsSaved = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(selectedTimeSlots));
        if (!configSaved || !timeSlotsSaved) {
            window.shiguangBridge.showToast("保存课表时间配置失败！");
            // 注意：时间配置失败不一定阻断课程导入，这里选择继续导入课程
        }

        // APP 环境，执行保存课程
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saveResult) {
            window.shiguangBridge.showToast("保存课程失败，请重试！");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 节课程及作息时间！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("导入发生异常: " + error.message);
        } else {
            console.error("【导入发生异常】", error);
            alert("导入发生异常: " + error.message);
        }
    }
}

runImportFlow();