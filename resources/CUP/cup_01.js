// resources/CUP/cup_01.js

// 1. 显示一个公告信息弹窗
async function promptUserToStart() {
    try {
        console.log("即将显示公告弹窗...");
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "重要通知",
            "导入前请确保您已成功登录教务系统，并选定正确的学期。",
            "好的，开始"
        );
        if (confirmed) {
            console.log("用户点击了确认按钮。Alert Promise Resolved: " + confirmed);
            window.shiguangBridge.showToast("Alert：用户点击了确认！");
            return true; // 成功时返回 true
        } else {
            console.log("用户点击了取消按钮或关闭了弹窗。Alert Promise Resolved: " + confirmed);
            window.shiguangBridge.showToast("Alert：用户取消了！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示公告弹窗时发生错误:", error);
        window.shiguangBridge.showToast("Alert：显示弹窗出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

// 2. 获取学期信息
async function getSemesterIndex() {
    try {
        const response = await fetch(`https://bk.cup.edu.cn/student/for-std/course-table`)
        const htmlString = await response.text();
        const parser = new DOMParser();
        const dom = parser.parseFromString(htmlString, 'text/html');
        const selectElement = dom.getElementById('semesters') || dom.getElementById('allSemesters');
        
        if (!selectElement) {
            throw new Error("页面中未找到学期选择框");
        }

        // 1. 将所有 option 转换为数组
        const options = Array.from(selectElement.options);
        
        // 2. 过滤掉 "全部学期" (value="all")，因为导入课表通常只能导具体的某一学期
        const validOptions = options.filter(opt => opt.value !== "all");
        
        if (validOptions.length === 0) {
            throw new Error("未解析到有效的学期列表");
        }

        // 3. 提取用于展示的文本数组和用于请求的 value 数组
        const semesterTexts = validOptions.map(opt => opt.text);  // 例: ["2025-2026-2", "2025-2026-1", ...]
        const semesterValues = validOptions.map(opt => opt.value); // 例: ["191", "171", ...]

        // 4. 调用安卓原生弹窗，让用户选择
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期", 
            JSON.stringify(semesterTexts), // 必须是 JSON 字符串
            0 // 默认选中第一个（通常是最新学期）
        );

        // 5. 判断用户的选择结果
        if (selectedIndex !== null && selectedIndex >= 0) {
            // 根据选中的索引，获取对应的学期 ID (value)
            const selectedValue = semesterValues[selectedIndex];
            if (typeof window.shiguangBridge !== 'undefined' && window.shiguangBridge.showToast) {
                window.shiguangBridge.showToast("已选择学期: " + semesterTexts[selectedIndex]);
            }
            return selectedValue; // 成功时返回学期编号 (例如 "191")
        } else {
            // 用户取消了选择
            console.log("用户取消了学期选择");
            return null;
        }
    } catch (error) {
        console.error("获取学期信息时发生错误:", error);
        window.shiguangBridge.showToast("Alert：获取学期信息出错！" + error.message);
        return null; // 出现错误时返回 null
    }    
}

// 3. 获取课程数据
async function fetchPrintData(semesterIndex) {
    try {
        const responds = await fetch(`https://bk.cup.edu.cn/student/for-std/course-table/semester/${semesterIndex}/print-data`);
        if (!responds.ok) {
            throw new Error(`网络请求失败，状态码: ${responds.status}`);
        }
        const printData = await responds.json();
        return printData;
    } catch (error) {
        console.error("获取数据时发生错误:", error);
        window.shiguangBridge.showToast("Alert：获取数据出错！" + error.message);
        return null;
    }
}

// 4. 导入课程数据
async function parseCourses(printData) {
    console.log("正在导入课程数据...");

    const activities = printData.studentTableVms[0].activities;
    const parsedCourses = activities.map(activity => {
        // 返回拾光要求的标准结构
        return {
            name: activity.courseName,                                      // 课程名称
            teacher: activity.teachers ? activity.teachers.join(" ") : "",  // 授课教师
            position: activity.campus ? `${activity.campus} ${activity.room}` : (activity.room || "未知地点"),
                                                                            // 上课地点
            day: activity.weekday,                                          // 星期几 (1-7)
            startSection: activity.startUnit,                               // 开始节次
            endSection: activity.endUnit,                                   // 结束节次
            weeks: activity.weekIndexes                                     // 上课周次数组
        };
    });

    try {
        console.log("正在尝试导入课程...");
        const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        if (result === true) {
            console.log("课程导入成功！");
            window.shiguangBridge.showToast("测试课程导入成功！");
        } else {
            console.log("课程导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试课程导入失败，请查看日志。");
        }
    } catch (error) {
        console.error("导入课程时发生错误:", error);
        window.shiguangBridge.showToast("导入课程失败: " + error.message);
    }
}

// 5. 导入预设时间段
async function importPresetTimeSlots(printData) {
    console.log("正在准备预设时间段数据...");

    function formatTime(timeInt) {
        // 将数字转为字符串，并在前面补0直到长度为4
        const timeStr = timeInt.toString().padStart(4, '0'); 
        // 截取前两位作为小时，后两位作为分钟，中间加冒号
        return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
    }

    const courseUnitList = printData.studentTableVms[0].timeTableLayout.courseUnitList;
    const presetTimeSlots = courseUnitList.map(unit => {
        return {
            number: unit.indexNo,                 // 节次编号
            startTime: formatTime(unit.startTime), // 开始时间
            endTime: formatTime(unit.endTime)      // 结束时间
        };
    });
    
    try {
        console.log("正在尝试导入预设时间段...");
        const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
        if (result === true) {
            console.log("预设时间段导入成功！");
            window.shiguangBridge.showToast("测试时间段导入成功！");
        } else {
            console.log("预设时间段导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试时间段导入失败，请查看日志。");
        }
        return result; // 返回导入结果，供流程控制使用
    } catch (error) {
        console.error("导入时间段时发生错误:", error);
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

// 6. 导入课表配置
async function saveConfig(semesterIndex) {
    console.log("正在准备配置数据...");

    const responds = await fetch(`https://bk.cup.edu.cn/student/ws/semester/get/${semesterIndex}`);
    if (!responds.ok) {
        throw new Error(`网络请求失败，状态码: ${responds.status}`);
    }
    const semesterInfo = await responds.json();
    const startDate = new Date(semesterInfo.startDate);
    const endDate = new Date(semesterInfo.endDate);
    const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));
    const calculatedWeeks = Math.ceil(diffDays / 7);
    // 注意：只传入要修改的字段，其他字段（如 semesterTotalWeeks）会使用 Kotlin 模型中的默认值
    const courseConfigData = {
        "semesterStartDate": semesterInfo.startDate,
        "semesterTotalWeeks": calculatedWeeks,
        "defaultClassDuration": 45,
        "defaultBreakDuration": 5,
        "firstDayOfWeek": semesterInfo.weekStartOnSunday ? 7 : 1
    };

    try {
        console.log("正在尝试导入课表配置...");
        const configJsonString = JSON.stringify(courseConfigData);

        const result = await window.shiguangBridgePromise.saveCourseConfig(configJsonString);

        if (result === true) {
            console.log("课表配置导入成功！");
            window.shiguangBridge.showToast("测试配置导入成功！开学日期: " + startDate.toISOString().split('T')[0]);
        } else {
            console.log("课表配置导入未成功，结果：" + result);
            window.shiguangBridge.showToast("测试配置导入失败，请查看日志。");
        }
        return result; // 返回导入结果，供流程控制使用
    } catch (error) {
        console.error("导入配置时发生错误:", error);
        window.shiguangBridge.showToast("导入配置失败: " + error.message);
    }
}


/**
 * 编排整个课程导入流程。
 * 在任何一步用户取消或发生错误时，都会立即退出，AndroidBridge.notifyTaskCompletion()应该只在成功后调用  
 */
async function runImportFlow() {
    window.shiguangBridge.showToast("课程导入流程即将开始...");

    // 1. 公告和前置检查。
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        return; // 用户取消，立即退出函数
    }
    
    // 2. 获取学期。
    const semesterIndex = await getSemesterIndex();
    if (semesterIndex === null) {
        window.shiguangBridge.showToast("导入已取消。");
        // 用户取消，直接退出
        return;
    }

    // 3. 获取课程数据
    const printData = await fetchPrintData(semesterIndex);
    if (printData === null) {
        window.shiguangBridge.showToast("导入已取消。");
        // 请求失败或无数据，直接退出
        return;
    }

    // 4. 解析课程信息。
    const courses = await parseCourses(printData);
    if (courses === null) {
        // 请求失败或无数据，直接退出
        return;
    }

    // 5. 导入时间段数据。
    const timeSlotImportResult = await importPresetTimeSlots(printData);
    if (!timeSlotImportResult) {
        // 时间段导入失败，直接退出
        return;
    }
    
    // 6. 保存配置数据 (例如学期开始日期)
    const configSaveResult = await saveConfig(semesterIndex);
    if (!configSaveResult) {
        // 保存配置失败，直接退出
        return;
    }

    // 7. 流程**完全成功**，发送结束信号。
    window.shiguangBridge.showToast("所有任务已完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动所有演示
runImportFlow();