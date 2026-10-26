/**
 * 解析 URP 系统的周次字符串
 * 支持处理："1-16周", "1,3,5周", "1-16周(双)" 等各种奇葩格式
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    let weeks = [];
    
    // 提取单双周标志，并剔除汉字
    let isOdd = weekStr.includes('单');
    let isEven = weekStr.includes('双');
    let cleanStr = weekStr.replace(/周|\(单\)|\(双\)|单|双/g, '').replace(/\s+/g, '');

    let parts = cleanStr.split(',');
    for (let part of parts) {
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            let s = parseInt(start);
            let e = parseInt(end);
            for (let i = s; i <= e; i++) {
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
 * 调用 URP 隐藏接口获取 JSON 课表
 */
async function runImportFlow() {
    try {
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast("正在通过数据接口获取课表...");
        } else {
            console.log("正在请求 URP 内部数据接口...");
        }

        // 1. 直接请求 URP 系统内部的课表 JSON 接口
        const apiUrl = '/student/courseSelect/thisSemesterCurriculum/ajaxStudentSchedule/callback';
        const response = await fetch(apiUrl, { method: 'GET' });
        
        if (!response.ok) {
            throw new Error(`接口请求失败，状态码: ${response.status}`);
        }

        const data = await response.json();
        
        // URP 的课程数据存放在 xkxx 这个数组的第0个对象里
        if (!data || !data.xkxx || !data.xkxx[0]) {
            const errMsg = "未获取到有效的课表数据，可能是当前学期暂无排课。";
            if (typeof window.shiguangBridgePromise !== 'undefined') {
                await window.shiguangBridgePromise.showAlert("提示", errMsg, "好的");
            } else {
                alert(errMsg);
            }
            return;
        }

        const coursesMap = data.xkxx[0];
        let parsedCourses = [];

        // ==========================================
        // 自动管理：直接从 URP 返回的 jcsjbs 字段提取并格式化作息时间
        // ==========================================
        let timeSlots = [];
        if (data.jcsjbs && Array.isArray(data.jcsjbs)) {
            timeSlots = data.jcsjbs.map(t => {
                // 辅助函数：将 "0810" 格式化为 "08:10"
                const formatTime = (timeStr) => {
                    if (timeStr && timeStr.length === 4) {
                        return timeStr.substring(0, 2) + ":" + timeStr.substring(2, 4);
                    }
                    return timeStr || "";
                };
                
                return {
                    number: parseInt(t.jc),
                    startTime: formatTime(t.kssj),
                    endTime: formatTime(t.jssj)
                };
            });
        }

        // 2. 遍历 JSON 数据进行格式转换
        for (let key in coursesMap) {
            const courseInfo = coursesMap[key];
            
            // 跳过没有时间地点的课程（无课表课程）
            if (!courseInfo.timeAndPlaceList || courseInfo.timeAndPlaceList.length === 0) {
                continue;
            }

            // 一门课可能在一周内上多次，所以遍历 timeAndPlaceList
            courseInfo.timeAndPlaceList.forEach(tp => {
                let courseObj = {
                    name: courseInfo.courseName || "未知课程",
                    teacher: (courseInfo.attendClassTeacher || "未知").replace(/\*/g, '').trim(),
                    isCustomTime: false
                };

                // 拼装地点：校区 + 教学楼 + 教室
                let campus = tp.campusName || "";
                let building = tp.teachingBuildingName || "";
                let room = tp.classroomName || "";
                let fullPosition = campus + building + room;
                courseObj.position = fullPosition ? fullPosition : "待定";

                // 解析时间
                courseObj.day = parseInt(tp.classDay);
                courseObj.startSection = parseInt(tp.classSessions);
                // 结束节次 = 开始节次 + 持续节次 - 1
                courseObj.endSection = courseObj.startSection + parseInt(tp.continuingSession) - 1;
                
                // 解析周次 (例如 "1-17周")
                courseObj.weeks = parseWeeks(tp.weekDescription);

                // 只有数据完整才加入
                if (courseObj.day && courseObj.startSection && courseObj.weeks.length > 0) {
                    parsedCourses.push(courseObj);
                }
            });
        }

        if (parsedCourses.length === 0) {
            throw new Error("解析完成，但没有提取到包含时间的有效课程。");
        }

        const config = {
            "defaultClassDuration": 45,
            "defaultBreakDuration": 10
        };

        // 3. 浏览器测试环境，直接打印输出
        if (typeof window.shiguangBridgePromise === 'undefined') {
            console.log("【URP系统测试成功】提取的课程数据：\n", JSON.stringify(parsedCourses, null, 2));
            if (timeSlots.length > 0) {
                console.log("【URP系统测试成功】提取到的作息时间：\n", JSON.stringify(timeSlots, null, 2));
            } else {
                console.log("【URP系统测试成功】未获取到作息时间，将交由APP自动管理。");
            }
            alert(`解析成功！直接从接口抓取到 ${parsedCourses.length} 门课程。请打开F12控制台查看。`);
            return;
        }

        // 4. APP 环境保存数据
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        
        // 将格式化后的标准作息时间交给 APP 进行保存
        if (timeSlots.length > 0) {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        }
        
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        if (!saveResult) {
            window.shiguangBridge.showToast("保存课程失败，请重试！");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${parsedCourses.length} 节课程！`);
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