// 通用 URP 教务拾光课程表适配脚本

/**
 * 解析复杂的周次文本
 * 示例: "1-8,10-17周" -> [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16,17]
 * 示例: "1-5,7-8,10-12周双周,13-17周" -> 自动过滤单双周
 */
function parseWeekText(weekStr) {
    let weeks = new Set();
    if (!weekStr) return [];
    
    // 清理无用后缀，按逗号或分号切割
    const rawSegments = weekStr.replace(/周/g, '').split(/[,，;；]/);
    
    rawSegments.forEach(segment => {
        let isEven = segment.includes('双');
        let isOdd = segment.includes('单');
        let cleanSegment = segment.replace(/(单|双)/g, '').replace(/第/g, '').trim();
        
        if (cleanSegment.includes('-')) {
            const [start, end] = cleanSegment.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    if (isEven && i % 2 !== 0) continue;
                    if (isOdd && i % 2 === 0) continue;
                    weeks.add(i);
                }
            }
        } else {
            const num = Number(cleanSegment);
            if (!isNaN(num) && num > 0) {
                weeks.add(num);
            }
        }
    });
    
    return Array.from(weeks).sort((a, b) => a - b);
}

/**
 * 解析节次文本 
 */
function parseSectionText(sectionStr) {
    let startSection = 1;
    let endSection = 1;
    if (!sectionStr) return { startSection, endSection };
    
    const match = sectionStr.match(/(\d+)-(\d+)节?/);
    if (match) {
        startSection = parseInt(match[1]);
        endSection = parseInt(match[2]);
    } else {
        const singleMatch = sectionStr.match(/(\d+)节?/);
        if (singleMatch) {
            startSection = parseInt(singleMatch[1]);
            endSection = parseInt(singleMatch[1]);
        }
    }
    return { startSection, endSection };
}

/**
 * 从表格中动态解析时间段信息 (寻找 id="0_x" 的 th)
 */
function parseTimeSlots() {
    let timeSlots = [];
    const timeThs = document.querySelectorAll('th[id^="0_"]');
    
    timeThs.forEach(th => {
        const idParts = th.id.split('_');
        const sectionNumber = parseInt(idParts[1]); // 获取节次序号
        const text = th.textContent || "";
        
        // 匹配格式如 "(08:00-08:45)"
        const timeMatch = text.match(/\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
        if (timeMatch && !isNaN(sectionNumber)) {
            timeSlots.push({
                number: sectionNumber,
                startTime: timeMatch[1],
                endTime: timeMatch[2]
            });
        }
    });
    
    return timeSlots.sort((a, b) => a.number - b.number);
}

/**
 * 核心解析：基于 HTML DOM 结构解析课程数据
 */
async function fetchAndParseJwData() {
    try {
        window.shiguangBridge.showToast("正在解析网页课表...");
        
        let courses = [];
        
        // 获取所有带有有效 id (格式如 2_5) 且内部包含课程块的单元格
        const allTds = document.querySelectorAll('td[id*="_"]');
        
        allTds.forEach(td => {
            const idParts = td.id.split('_');
            if (idParts.length !== 2) return;
            
            // _前面从1到7代表星期
            const day = parseInt(idParts[0]);
            if (isNaN(day) || day < 1 || day > 7) return; 

            // 找到单元格内所有的课程卡片
            const classDivs = td.querySelectorAll('.class_div');
            
            classDivs.forEach(div => {
                const pTags = div.querySelectorAll('p');
                if (pTags.length < 5) return; // 格式不健全的格子直接跳过
                
                // 兼容两种结构：
                // p[1]=教师,p[2]=周次,p[3]=节次,p[4]=地点
                // p[2]=教师,p[3]=周次,p[4]=节次,p[5]=地点
                let teacherIdx = 2, weekIdx = 3, sectionIdx = 4, posIdx = 5;
                const p1Text = pTags[1] ? pTags[1].textContent.trim() : '';
                if (p1Text && !/\d/.test(p1Text) && !p1Text.includes('周') && p1Text.length < 10) {
                    teacherIdx = 1;
                    weekIdx = 2;
                    sectionIdx = 3;
                    posIdx = 4;
                }
                
                const name = pTags[0].textContent.trim();
                const teacher = pTags[teacherIdx].textContent.replace(/^[\s*]+|[\s*]+$/g, '').replace(/\*/g, ' ').replace(/\s+/g, ' ');
                const weekStr = pTags[weekIdx].textContent.trim();
                const sectionStr = pTags[sectionIdx].textContent.trim();
                const position = pTags[posIdx] ? pTags[posIdx].textContent.trim() : "未知地点";
                
                // 解析周次与真实的开始/结束节次
                const weeks = parseWeekText(weekStr);
                const { startSection, endSection } = parseSectionText(sectionStr);
                
                if (name && weeks.length > 0) {
                    courses.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        day: day,
                        startSection: startSection,
                        endSection: endSection,
                        weeks: weeks
                    });
                }
            });
        });

        // 动态提取时间段
        const timeSlots = parseTimeSlots();

        if (courses.length === 0) {
            throw new Error("未能在当前页面检测到有效的课表数据，请确认是否处于课表视图页面");
        }

        return { courses, timeSlots };
    } catch (e) {
        console.error("HTML解析失败详情:", e);
        window.shiguangBridge.showToast("同步失败: " + e.message);
        return null;
    }
}

/**
 * 辅助：保存数据到外部 APP
 */
async function saveToApp(result) {
    const courseSuccess = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
    if (!courseSuccess) return false;

    if (result.timeSlots && result.timeSlots.length > 0) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(result.timeSlots));
    }
    return true;
}

/**
 * 流程控制流程
 */
async function runImportFlow() {
    const alertResult = await window.shiguangBridgePromise.showAlert(
        "教务网页课表导入",
        "请确保您当前的网页已加载出课表视图后再开始导入",
        "开始同步"
    );
    if (!alertResult) return;

    const result = await fetchAndParseJwData();
    if (!result || result.courses.length === 0) return;

    if (await saveToApp(result)) {
        window.shiguangBridge.showToast(`成功从网页导入 ${result.courses.length} 个课程时段`);
        window.shiguangBridge.notifyTaskCompletion(); 
    }
}

// 启动导入流程
runImportFlow();