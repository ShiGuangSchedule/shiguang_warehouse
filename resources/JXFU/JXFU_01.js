/**
 * 解析周次字符串 (例如 "17,2,3,4,6")
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    let weeks = [];
    let parts = String(weekStr).split(',');
    for (let part of parts) {
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part.trim());
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 直接从 JS 变量中提取 JSON 数据
 */
function extractCoursesFromHtml(htmlText) {
    let parsedCourses = [];
    
    // 使用正则表达式精准捕获 var kbxx = [...] 中的 JSON 数组
    let match = htmlText.match(/var\s+kbxx\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match || !match[1]) {
        if (htmlText.includes('<table class="kb"')) {
            console.warn("页面结构正确但未找到课表数据，推测该学期暂未排课。");
            return []; // 这是一个合法的空课表
        }
        console.error("【调试HTML片段】", htmlText.substring(0, 800));
        throw new Error("未能从目标页面抓取到 kbxx 数据，请确认当前处于教务系统登录状态。");
    }

    let rawData = [];
    try {
        rawData = JSON.parse(match[1]);
    } catch (e) {
        throw new Error("解析课表JSON数据失败！");
    }

    rawData.forEach(item => {
        let courseObj = {
            name: item.kcmc || "未知课程",
            teacher: item.teaxms || "未知",
            position: item.jxcdmcs || "待定",
            day: parseInt(item.xq),
            isCustomTime: false
        };

        // 处理周次 (item.zcs 格式为 "18,2,3,4,7,8")
        if (item.zcs) {
            courseObj.weeks = parseWeeks(item.zcs);
        } else {
            return; // 无周次则抛弃
        }

        // 处理节次 (item.jcdm2 格式为 "05,06" 或 "10")
        if (item.jcdm2) {
            let sections = item.jcdm2.split(',').map(s => parseInt(s, 10));
            courseObj.startSection = sections[0];
            courseObj.endSection = sections[sections.length - 1];
        } else {
            return; // 无节次则抛弃
        }

        // 只有包含完整有效信息才加入
        if (courseObj.name && courseObj.weeks && courseObj.weeks.length > 0) {
            parsedCourses.push(courseObj);
        }
    });

    // 去重逻辑
    let uniqueCourses = [];
    let courseSet = new Set();
    parsedCourses.forEach(course => {
        let uniqueKey = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
        if (!courseSet.has(uniqueKey)) {
            courseSet.add(uniqueKey);
            uniqueCourses.push(course);
        }
    });

    return uniqueCourses;
}

/**
 * 生成学校专属的作息时间段
 */
function getPresetTimeSlots() {
    return [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        // 课间 10分
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        // 课间 20分 (特殊)
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        // 课间 10分
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        // 课间 10分
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        // 课间 15分 (特殊)
        { "number": 7, "startTime": "15:55", "endTime": "16:40" },
        // 课间 10分
        { "number": 8, "startTime": "16:50", "endTime": "17:35" },
        
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        // 课间 10分
        { "number": 10, "startTime": "19:55", "endTime": "20:40" },
        // 课间 10分
        { "number": 11, "startTime": "20:50", "endTime": "21:35" } 
    ];
}

/**
 * 生成全局课表配置
 */
function getCourseConfig() {
    return {
        "defaultClassDuration": 45, // 单节课 45 分钟
        "defaultBreakDuration": 10  // 默认课间 10 分钟
    };
}

/**
 * 异步编排流程
 */
async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在获取课表配置，请稍候...");
        } else {
            console.log("正在请求获取学期列表...");
        }

        // 第 1 步：请求外层页面，获取学期列表
        const listResponse = await fetch('/xsgrkbcx!getXsgrbkList.action', { method: 'GET' });
        const listHtml = await listResponse.text();
        const parser = new DOMParser();
        const listDoc = parser.parseFromString(listHtml, 'text/html');

        const selectElem = listDoc.getElementById('xnxqdm');
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected') || opt.selected) {
                    defaultIndex = index;
                }
            });
        }

        if (semesters.length === 0) {
            throw new Error("无法在页面中找到学期选项(xnxqdm)，请确认教务系统是否正常。");
        }

        // 第 2 步：选择学期
        let selectedIdx = defaultIndex;
        if (typeof window.shiguangBridgePromise !== 'undefined') {
            // APP 内原生弹窗
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
            // 电脑浏览器端原生 prompt 弹窗测试
            let msg = "【浏览器测试】请选择学期对应的序号：\n\n";
            semesters.forEach((s, idx) => {
                msg += `[ ${idx} ] : ${s}\n`;
            });
            let userInput = prompt(msg, defaultIndex);
            if (userInput === null) {
                console.log("已取消测试。");
                return;
            }
            selectedIdx = parseInt(userInput);
            if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= semesters.length) {
                alert("输入的序号不合法，将使用默认学期！");
                selectedIdx = defaultIndex;
            }
        }
        
        let targetXnxqdm = semesterValues[selectedIdx];

        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 课表数据...`);
        } else {
            console.log(`准备拉取学期 [${semesters[selectedIdx]} / 代码: ${targetXnxqdm}] 的课表数据...`);
        }

        // 第 3 步：带上学期参数，请求真正的课表数据接口
        const kbResponse = await fetch(`/xsgrkbcx!xsAllKbList.action?xnxqdm=${targetXnxqdm}`, { method: 'GET' });
        const kbHtmlText = await kbResponse.text();

        // 第 4 步：提取数据
        const courses = extractCoursesFromHtml(kbHtmlText);
        
        if (courses.length === 0) {
            const errMsg = "该学期暂无排课数据。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else {
                alert(errMsg);
            }
            return;
        }

        const config = getCourseConfig();
        const timeSlots = getPresetTimeSlots();

        // 浏览器测试环境，直接打印输出
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【测试成功】课表配置：", config);
            console.log("【测试成功】作息时间：", timeSlots);
            console.log("【测试成功】课程数据：\n", JSON.stringify(courses, null, 2));
            alert(`解析成功！获取到 ${courses.length} 门课程以及专属作息。\n（请打开 F12 Console 控制台查看具体数据）`);
            return;
        }

        // APP 环境保存数据
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        
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

// 启动导入流程
runImportFlow();