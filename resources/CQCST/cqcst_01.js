async function runImportFlow() {
    // 兼容电脑端测试
    if (typeof window.shiguangBridgePromise === 'undefined') {
        window.shiguangBridgePromise = {
            showAlert: async () => true,
            saveImportedCourses: async (json) => {
                console.log("===============================");
                console.log("🎉 【解析成功】以下是整理好的课表数据：");
                console.table(JSON.parse(json)); 
                console.log("===============================");
                alert("抓取成功！请在 F12 控制台查看具体的课程数据格式。");
                return true;
            }
        };
        window.shiguangBridge = {
            showToast: (msg) => console.log("[系统提示] " + msg),
            notifyTaskCompletion: () => console.log("[流程结束] 任务已完成并通知APP")
        };
    }

    window.shiguangBridge.showToast("开始提取课表数据...");

    const table = document.getElementById('kbtable') || document.querySelector('.table_border') || document.querySelector('table');
    if (!table || !table.innerText.includes('星期')) {
        window.shiguangBridge.showToast("没找到课表！请确保您当前在“学期理论课表”页面。");
        return;
    }

    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "强智教务解析",
        "已检测到课表页面，是否提取数据并导入？",
        "确认导入"
    );
    if (!alertConfirmed) return;

    try {
        let courses = [];
        let courseSet = new Set(); 
        let rows = table.querySelectorAll('tr');

        // 遍历课表每一行（跳过第一行的表头）
        for (let i = 1; i < rows.length; i++) {
            // 【关键修复1】同时获取 th 和 td，防止错位
            let cells = rows[i].querySelectorAll('td, th'); 
            
            for (let j = 0; j < cells.length; j++) {
                let cell = cells[j];
                
                // 【关键修复2】逆向计算星期几：倒数第7列永远是周一，倒数第1列永远是周日
                // 这能完美解决强智系统左侧节次列导致的数据错位问题
                let day = 7 - (cells.length - 1 - j);
                if (day < 1 || day > 7) continue; // 如果算出来不是1-7，说明是左侧的节次列，跳过

                let blocks = cell.innerText.split(/-{5,}/).map(t => t.trim()).filter(t => t);

                for (let block of blocks) {
                    if (!block || block === ' ' || block === '') continue;
                    
                    let lines = block.split(/\n/).map(l => l.trim()).filter(l => l);
                    if(lines.length < 4) {
                        lines = block.split(/\s+/).map(l => l.trim()).filter(l => l);
                    }
                    if (lines.length < 3) continue;

                    let name = lines[0].replace(/\[.*?\]/g, '').trim();
                    let teacher = lines[1] || "未知";

                    let timeRegex = /([\d\-,]+)(?:\((单|双|.*?)\))?.*?\[([\d\-]+)节\]/;
                    let timeLineIdx = lines.findIndex(l => timeRegex.test(l));
                    if (timeLineIdx === -1) continue;

                    let match = lines[timeLineIdx].match(timeRegex);
                    let weeksStr = match[1]; 
                    let oddEven = match[2];  
                    let sectionsStr = match[3]; 

                    let position = (timeLineIdx + 1 < lines.length) ? lines[timeLineIdx + 1] : "未知地点";

                    let weeks = [];
                    let weekParts = weeksStr.split(',');
                    for (let wp of weekParts) {
                        if (wp.includes('-')) {
                            let parts = wp.split('-');
                            let start = parseInt(parts[0]);
                            let end = parseInt(parts[1]);
                            for (let w = start; w <= end; w++) {
                                if (oddEven === '单' && w % 2 === 0) continue;
                                if (oddEven === '双' && w % 2 !== 0) continue;
                                weeks.push(w);
                            }
                        } else {
                            weeks.push(parseInt(wp));
                        }
                    }

                    let secParts = sectionsStr.split('-');
                    let startSection = parseInt(secParts[0]);
                    let endSection = parseInt(secParts[secParts.length - 1]);

                    let uid = `${name}-${day}-${startSection}-${endSection}-${weeks.join(',')}`;
                    if (!courseSet.has(uid)) {
                        courseSet.add(uid);
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
                }
            }
        }

        if (courses.length === 0) {
            window.shiguangBridge.showToast("没有抓取到数据，可能当前表格为空。");
            return;
        }

        window.shiguangBridge.showToast(`提取成功，共发现 ${courses.length} 门课程，正在保存...`);
        
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (saveResult) {
            window.shiguangBridge.showToast("导入大功告成！");
            window.shiguangBridge.notifyTaskCompletion(); 
        }

    } catch (error) {
        console.error("解析过程中发生错误:", error);
        window.shiguangBridge.showToast("解析出错啦: " + error.message);
    }
}

runImportFlow();