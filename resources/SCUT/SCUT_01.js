/**
 * 解析正方教务系统的周次字符串
 */
function parseZhengFangWeeks(weekStr) {
    if (!weekStr) return [];
    let weeks = [];
    let isOdd = weekStr.includes('单');
    let isEven = weekStr.includes('双');
    let cleanStr = weekStr.replace(/周|\(单\)|\(双\)|单|双/g, '').replace(/\s+/g, '');

    let parts = cleanStr.split(',');
    for (let part of parts) {
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (isOdd && i % 2 === 0) continue;
                if (isEven && i % 2 !== 0) continue;
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) {
                if (isOdd && w % 2 === 0) continue;
                if (isEven && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 封装兼容 WebVPN 的原生 AJAX 请求
 */
function requestData(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        let xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        if (method === 'POST') {
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        }
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error("网络请求失败，状态码：" + xhr.status));
                }
            }
        };
        xhr.onerror = function() {
            reject(new Error("网络请求发生错误，请检查网络连接。"));
        };
        xhr.send(data);
    });
}

/**
 * 用正则从 HTML 文本中硬核提取 select 选项
 */
function extractOptionsByRegex(html, selectId) {
    let selectRegex = new RegExp(`<select[^>]*id="${selectId}"[^>]*>(.*?)<\/select>`, 'is');
    let selectMatch = html.match(selectRegex);
    if (!selectMatch) return [];
    
    let optionsHtml = selectMatch[1];
    let optionRegex = /<option\s+value="([^"]+)"([^>]*)>([^<]+)<\/option>/gi;
    let options = [];
    let match;
    while ((match = optionRegex.exec(optionsHtml)) !== null) {
        if (match[1].trim() !== "") {
            options.push({
                value: match[1].trim(),
                text: match[3].trim(),
                selected: match[2].includes('selected')
            });
        }
    }
    return options;
}

/**
 * 异步编排流程
 */
async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在通过 WebVPN 通道读取数据...");
        } else {
            console.log("【1/4】正在获取学期选项...");
        }

        let sysPath = typeof _path !== 'undefined' ? _path : '/jwglxt';
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        // 1. 尝试直接通过正则表达式，去后台请求并提取页面中的下拉框
        console.log("正在后台请求页面源码...");
        const indexHtml = await requestData(`${sysPath}/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`, 'GET');
        
        let yearOpts = extractOptionsByRegex(indexHtml, 'xnm');
        let termOpts = extractOptionsByRegex(indexHtml, 'xqm');

        if (yearOpts.length === 0 || termOpts.length === 0) {
            throw new Error("源码提取学期信息失败，可能是 WebVPN 会话过期，请重新登录教务系统！");
        }

        let count = 0;
        yearOpts.forEach(y => {
            termOpts.forEach(t => {
                semesters.push(`${y.text} 第${t.text}学期`);
                semesterValues.push({ xnm: y.value, xqm: t.value });
                if (y.selected && t.selected) {
                    defaultIndex = count;
                }
                count++;
            });
        });

        // 2. 弹出选择框
        let selectedIdx = defaultIndex;
        if (typeof window.shiguangBridgePromise !== 'undefined') {
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
        } else {
            let msg = "【浏览器测试】请选择学期对应的序号：\n\n";
            semesters.forEach((s, idx) => {
                if (Math.abs(idx - defaultIndex) <= 4) msg += `[ ${idx} ] : ${s}\n`;
            });
            msg += "\n请输入方括号中的数字：";
            let userInput = prompt(msg, defaultIndex);
            if (userInput === null) return;
            selectedIdx = parseInt(userInput);
            if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= semesters.length) {
                alert("输入无效，使用默认学期！");
                selectedIdx = defaultIndex;
            }
        }

        const targetData = semesterValues[selectedIdx];
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 数据...`);
        } else {
            console.log(`【2/4】正在向服务器请求 [${semesters[selectedIdx]}] 的 JSON 数据...`);
        }

        // 3. 发送 Ajax 请求获取真实的课表和作息时间
        const postBody = `xnm=${targetData.xnm}&xqm=${targetData.xqm}&kzlx=ck&xsdm=&kclbdm=&kclxdm=`;
        
        const [kbResText, timeResText] = await Promise.all([
            requestData(`${sysPath}/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`, 'POST', postBody),
            requestData(`${sysPath}/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151`, 'POST', postBody)
        ]);

        const kbJson = JSON.parse(kbResText);
        const timeJson = JSON.parse(timeResText);

        // 4. 解析作息时间 (拦截 21:35 之后的时间)
        let timeSlots = [];
        if (Array.isArray(timeJson)) {
            timeJson.forEach(t => {
                if (t.jssj > "21:35") return; 
                timeSlots.push({
                    number: parseInt(t.jcmc, 10),
                    startTime: t.qssj,
                    endTime: t.jssj
                });
            });
            timeSlots.sort((a, b) => a.number - b.number);
        }

        // 5. 解析课程数据
        let parsedCourses = [];
        if (kbJson && kbJson.kbList) {
            kbJson.kbList.forEach(c => {
                let courseObj = {
                    name: c.kcmc || "未知课程",
                    teacher: c.xm || "未知",
                    position: c.cdmc || "待定",
                    day: parseInt(c.xqj),
                    isCustomTime: false
                };

                courseObj.weeks = parseZhengFangWeeks(c.zcd);

                if (c.jcs) {
                    let secParts = c.jcs.split('-');
                    courseObj.startSection = parseInt(secParts[0]);
                    courseObj.endSection = parseInt(secParts[secParts.length - 1] || secParts[0]);
                }

                if (courseObj.name && courseObj.weeks.length > 0 && courseObj.startSection) {
                    parsedCourses.push(courseObj);
                }
            });
        }

        if (parsedCourses.length === 0) {
            const errMsg = "该学期暂无排课数据。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else alert(errMsg);
            return;
        }

        // 6. 去重
        let uniqueCourses = [];
        let courseSet = new Set();
        parsedCourses.forEach(course => {
            let uniqueKey = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
            if (!courseSet.has(uniqueKey)) {
                courseSet.add(uniqueKey);
                uniqueCourses.push(course);
            }
        });

        const config = {
            "defaultClassDuration": 45,
            "defaultBreakDuration": 5
        };

        // 7. 打印并保存
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【测试成功】被 21:35 规则过滤后的作息时间表：\n", timeSlots);
            console.log(`【测试成功】共获取到 ${uniqueCourses.length} 门课程：\n`, JSON.stringify(uniqueCourses, null, 2));
            alert(`解析成功！获取到 ${uniqueCourses.length} 门课程及过滤后的作息时间。\n请打开F12控制台查看。`);
            return;
        }

        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        if (timeSlots.length > 0) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
        
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(uniqueCourses));
        if (!saveResult) {
            window.shiguangBridge.showToast("保存失败，请重试！");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${uniqueCourses.length} 节课程！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("导入异常: " + error.message);
        } else {
            console.error("【导入异常】", error);
            alert("导入异常: " + error.message);
        }
    }
}

runImportFlow();