/**
 * 解析周次
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    let parts = String(weekStr).split(',');
    let weeks = new Set();
    for (let p of parts) {
        let num = parseInt(p.trim());
        if (!isNaN(num)) weeks.add(num);
    }
    return Array.from(weeks).sort((a, b) => a - b);
}

async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在获取作息时间与学期列表...");
        } else {
            console.log("【1/4】正在请求 week.page 获取学期和作息时间...");
        }

        // 1. 获取学期列表与作息时间
        const pageRes = await fetch('/new/student/xsgrkb/week.page', { method: 'GET' });
        const pageHtml = await pageRes.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(pageHtml, 'text/html');

        const selectElem = doc.getElementById('xnxqdm');
        let semesters = [], semesterValues = [], defaultIndex = 0;
        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected') || opt.selected) defaultIndex = index;
            });
        }
        if (semesters.length === 0) throw new Error("未找到学期列表。");

        // 提取作息时间，并分离 1-12 节(常规) 和 13-14 节(中午异形)
        let rawTimeMap = {};
        let standardTimeSlots = [];
        const bhMatch = pageHtml.match(/var\s+businessHours\s*=\s*\$\.parseJSON\('(\[.*?\])'\);/);
        
        if (bhMatch && bhMatch[1]) {
            const bhData = JSON.parse(bhMatch[1]);
            bhData.forEach(item => {
                let num = parseInt(item.jcdm, 10);
                let st = item.qssj.substring(0, 5);
                let et = item.jssj.substring(0, 5);
                rawTimeMap[num] = { start: st, end: et }; // 记录所有节次的真实时间
                
                // 只有 1-12 节作为正常的网格标尺
                if (num >= 1 && num <= 12) {
                    standardTimeSlots.push({ number: num, startTime: st, endTime: et });
                }
            });
            standardTimeSlots.sort((a, b) => a.number - b.number);
        } else {
            throw new Error("未抓取到作息时间！");
        }

        // 2. 选择学期
        let selectedIdx = defaultIndex;
        if (typeof window.shiguangBridgePromise !== 'undefined') {
            let userChoice = await window.shiguangBridgePromise.showSingleSelection(
                "请选择要导入的学期", JSON.stringify(semesters), defaultIndex
            );
            if (userChoice === null) {
                window.shiguangBridge.showToast("已取消导入");
                return;
            }
            selectedIdx = userChoice;
        } else {
            let msg = "【浏览器测试】请选择学期序号：\n\n";
            semesters.forEach((s, idx) => msg += `[${idx}] : ${s}\n`);
            let userInput = prompt(msg, defaultIndex);
            if (userInput === null) return;
            selectedIdx = parseInt(userInput);
            if (isNaN(selectedIdx)) selectedIdx = defaultIndex;
        }

        const targetXnxqdm = semesterValues[selectedIdx];
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 数据...`);
        }

        // 3. 请求课表接口
        let formData = new URLSearchParams();
        formData.append('xnxqdm', targetXnxqdm);
        formData.append('zc', '');
        formData.append('d1', '2020-01-01 00:00:00');
        formData.append('d2', '2030-01-01 00:00:00');

        const apiRes = await fetch('/new/student/xsgrkb/getCalendarWeekDatas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData.toString()
        });

        const apiJson = await apiRes.json();
        if (apiJson.code !== 0 || !apiJson.data) throw new Error("获取课表失败");
        
        if (apiJson.data.length === 0) {
            const errMsg = "该学期暂无排课数据。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else alert(errMsg);
            return;
        }

        // 4. 数据转换与倒挂课表隔离
        let parsedCourses = [];
        apiJson.data.forEach(item => {
            let courseObj = {
                name: item.kcmc || "未知课程",
                teacher: item.teaxms || "未知",
                position: item.jxcdmc || "待定",
                day: parseInt(item.xq),
                isCustomTime: false
            };

            courseObj.weeks = parseWeeks(item.zc);
            let startSec = parseInt(item.ps);
            let endSec = parseInt(item.pe);

            // 【核心修正】处理第13、14节的中午倒挂课程
            if (startSec > 12 || endSec > 12) {
                courseObj.isCustomTime = true;
                // 取教务系统真实设定的时间（如 11:45）
                courseObj.customStartTime = rawTimeMap[startSec] ? rawTimeMap[startSec].start : "11:45";
                courseObj.customEndTime = rawTimeMap[endSec] ? rawTimeMap[endSec].end : "13:15";
            } else {
                courseObj.startSection = startSec;
                courseObj.endSection = endSec;
            }

            if (courseObj.name && !isNaN(courseObj.day) && courseObj.weeks.length > 0) {
                parsedCourses.push(courseObj);
            }
        });

        // 去重逻辑
        let uniqueCourses = [];
        let courseSet = new Set();
        parsedCourses.forEach(course => {
            let uniqueKey = course.isCustomTime ? 
                `${course.day}-${course.customStartTime}-${course.customEndTime}-${course.name}-${course.weeks.join(',')}` : 
                `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
            if (!courseSet.has(uniqueKey)) {
                courseSet.add(uniqueKey);
                uniqueCourses.push(course);
            }
        });

        const config = { "defaultClassDuration": 45, "defaultBreakDuration": 10 };

        // 浏览器测试输出
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【修正后的正常网格时间】", standardTimeSlots);
            console.log(`【提取的课程 (${uniqueCourses.length}门)】\n`, JSON.stringify(uniqueCourses, null, 2));
            alert("解析成功！已将中午课程转为无缝自定义时间。请看F12。");
            return;
        }

        // 5. 保存到APP
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(standardTimeSlots));
        
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(uniqueCourses));
        if (!saveResult) {
            window.shiguangBridge.showToast("保存失败，请重试！");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${uniqueCourses.length} 节课程！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        if (typeof window.shiguangBridge !== 'undefined') window.shiguangBridge.showToast("异常: " + error.message);
        else alert("异常: " + error.message);
    }
}

runImportFlow();