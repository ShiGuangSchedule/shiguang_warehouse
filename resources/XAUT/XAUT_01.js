/**
 * 辅助函数：解析强智系统的周次字符串
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
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
 * 核心解析函数：提取并构建“大节”时间轴，同时提取课程并映射去重
 */
function extractDataFromDoc(doc) {
    let timeSlots = [];
    let sectionMapping = {};    // 记录 小节->大节 的映射
    let rowToSectionMap = {};   // 记录 表格行号->大节 的映射
    let newSectionIndex = 1;

    const table = doc.getElementById('timetable');
    if (!table) throw new Error("请求成功但未找到课表表格，请确认教务系统状态。");

    const rows = table.getElementsByTagName('tr');
    
    // ==========================================
    // 1. 解析时间轴，剔除午休，建立小节到大节的映射
    // ==========================================
    for (let i = 1; i < rows.length - 1; i++) {
        let th = rows[i].querySelector('th');
        if (!th) continue;
        
        let html = th.innerHTML;
        let secMatch = html.match(/\(([\d,]+)小节\)/);
        let timeMatch = html.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        
        if (secMatch && timeMatch) {
            let startStr = timeMatch[1];
            let endStr = timeMatch[2];
            
            // 【核心要求】剔除 12:10-14:00 这个无效的午休时间段
            if (startStr === "12:10" && endStr === "14:00") {
                continue; // 跳过，不计入真实上课时间轴
            }
            
            // 记录真实上课的“大节”
            timeSlots.push({
                number: newSectionIndex,
                startTime: startStr,
                endTime: endStr
            });
            
            // 绑定该行对应的大节索引
            rowToSectionMap[i] = newSectionIndex;
            
            // 将 (07,08小节) 这样的小节数字，统一映射到新生成的大节索引上
            let smallSections = secMatch[1].split(',').map(s => parseInt(s, 10));
            smallSections.forEach(s => {
                sectionMapping[s] = newSectionIndex;
            });
            
            newSectionIndex++;
        }
    }

    // ==========================================
    // 2. 逐行提取课程内容，并将其映射到大节上
    // ==========================================
    let parsedCourses = [];
    for (let i = 1; i < rows.length - 1; i++) {
        let targetSection = rowToSectionMap[i];
        if (!targetSection) continue; // 如果这行是午休那行，直接跳过处理

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

                    // 提取课程名 (剥离二维码 item-box 节点)
                    let itemBoxes = tempDiv.querySelectorAll('.item-box');
                    itemBoxes.forEach(box => box.remove());
                    
                    let lines = tempDiv.innerHTML.split(/<br\s*\/?>/i);
                    for (let line of lines) {
                        let cleanLine = line.replace(/<[^>]+>/g, '').trim();
                        if (cleanLine && cleanLine !== "") {
                            courseObj.name = cleanLine;
                            break;
                        }
                    }

                    // 提取教师和教室
                    let teacherFont = tempDiv.querySelector('font[title="教师"]');
                    courseObj.teacher = teacherFont ? teacherFont.innerText.trim() : "未知";

                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont ? positionFont.innerText.trim() : "待定";

                    // 提取并转换周次、节次
                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = timeFont.innerText.trim();
                        let timeMatch = timeText.match(/(.+?)\(周\)(?:\[([\d-]+)节\])?/);
                        if (timeMatch) {
                            courseObj.weeks = parseWeeks(timeMatch[1]);
                            if (timeMatch[2]) {
                                let secParts = timeMatch[2].split('-');
                                let origStart = parseInt(secParts[0]);
                                let origEnd = parseInt(secParts[secParts.length - 1]);
                                
                                // 【核心转换】将原始的 07, 10 等小节，转换为 App 里的 3，4 等大节
                                courseObj.startSection = sectionMapping[origStart];
                                courseObj.endSection = sectionMapping[origEnd];
                            } else {
                                courseObj.startSection = targetSection;
                                courseObj.endSection = targetSection;
                            }
                        }
                    } else {
                        return; // 抛弃无时间信息的无课表课程
                    }

                    if (courseObj.name && courseObj.weeks && courseObj.weeks.length > 0 && courseObj.startSection && courseObj.endSection) {
                        parsedCourses.push(courseObj);
                    }
                });
            });
        }
    }

    // ==========================================
    // 3. 终极去重（处理跨大节的连排课导致的 DOM 重复）
    // ==========================================
    let uniqueCourses = [];
    let courseSet = new Set();

    parsedCourses.forEach(course => {
        let uniqueKey = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
        if (!courseSet.has(uniqueKey)) {
            courseSet.add(uniqueKey);
            uniqueCourses.push(course);
        }
    });

    return { timeSlots, uniqueCourses };
}

/**
 * 异步编排流程
 */
async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在获取课表与作息配置...");
        } else {
            console.log("正在发起请求获取课表...");
        }

        // 第 1 步：请求外层页面，获取学期列表
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

        // 第 2 步：选择学期
        let selectedIdx = defaultIndex;
        if (semesters.length > 0 && typeof window.shiguangBridgePromise !== 'undefined') {
            let userChoice = await window.shiguangBridgePromise.showSingleSelection(
                "请选择要导入的学期", 
                JSON.stringify(semesters), 
                defaultIndex
            );

            if (userChoice === null) {
                window.shiguangBridge.showToast("已取消导入");
                return;
            }
            selectedIdx = userChoice;
            
            // 如果非默认学期，重新获取页面
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
        } else if (typeof window.shiguangBridgePromise === 'undefined') {
            // 浏览器环境测验
            let msg = "【浏览器测试】请选择学期序号：\n\n";
            semesters.forEach((s, idx) => msg += `[${idx}] : ${s}\n`);
            let userInput = prompt(msg, defaultIndex);
            if (userInput === null) return;
            selectedIdx = parseInt(userInput);
            if (isNaN(selectedIdx)) selectedIdx = defaultIndex;
            
            if (selectedIdx !== defaultIndex) {
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

        // 第 3 步：解析数据
        const extractedData = extractDataFromDoc(doc);
        const timeSlots = extractedData.timeSlots;
        const courses = extractedData.uniqueCourses;
        
        if (courses.length === 0) {
            const errMsg = "未能解析到任何课程，请检查是否暂无排课。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else {
                alert(errMsg);
            }
            return;
        }

        const config = {
            "defaultClassDuration": 110, // 大节课一般是 110 分钟左右
            "defaultBreakDuration": 10
        };

        // 浏览器测试输出
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【智能抓取大节时间轴 (剔除12:10-14:00)】\n", timeSlots);
            console.log(`【成功提取去重课程 (${courses.length}门)】\n`, JSON.stringify(courses, null, 2));
            alert(`解析并去重成功！获取到 ${courses.length} 门课程及大节作息。请打开F12查看。`);
            return;
        }

        // APP 环境保存
        if (timeSlots.length > 0) {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
        
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