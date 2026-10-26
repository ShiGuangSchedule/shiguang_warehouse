// resources/CUP/cup_02.js
// 中国石油大学(北京)研究生拾光课程表适配脚本
// https://gmis.cup.edu.cn/gmis/student/default/index
// 教务平台：南京南软
// 适配开发者：larryyan

// ==========================================
// 0. 全局配置与验证函数
// ==========================================

const PRESET_TIME_CONFIG = {
    campuses: {
        MainCampus: {
            startTimes: {
                morning: "08:00",
                afternoon: "13:30",
                evening: "18:30"
            },
            sectionCounts: {
                morning: 4,
                afternoon: 4,
                evening: 3
            },
            durations: {
                classMinutes: 45,
                shortBreakMinutes: 5,
                longBreakMinutes: 30
            }
        },
        Karamay: {
            startTimes: {
                morning: "09:30",
                afternoon: "16:00",
                evening: "20:30"
            },
            sectionCounts: {
                morning: 5,
                afternoon: 4,
                evening: 3
            },
            durations: {
                classMinutes: 45,
                shortBreakMinutes: 5,
                longBreakMinutes: 20
            },
        }
    },
    common: {
        longBreakAfter: {
            morning: 2,
            afternoon: 2,
            evening: 0  // 晚间课程无大课间
        }
    }
};

const CAMPUS_OPTIONS = [
    { id: "MainCampus", label: "主校区" },
    { id: "Karamay", label: "克拉玛依校区" }
];

/**
 * 验证开学日期的输入格式
 */
function validateDateInput(input) {
    if (/^\d{4}[-\/\.]\d{2}[-\/\.]\d{2}$/.test(input)) {
        return false; 
    } else {
        return "请输入正确的日期格式，例如: 2025-09-01"; 
    }
}

// ==========================================
// 业务流程函数
// ==========================================

// 1. 显示一个公告信息弹窗
async function promptUserToStart() {
    console.log("即将显示公告弹窗...");
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "重要通知",
        "导入前请确保您已成功登录教务系统，并选定正确的学期。",
        "好的，开始"
    );
    return confirmed === true;
}

// 2. 选择校区 (使用配置项)
async function selectCampus() {
    // 从配置中提取用于展示的名称数组
    const campusLabels = CAMPUS_OPTIONS.map(opt => opt.label);
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择所在校区", 
        JSON.stringify(campusLabels), 
        0 
    );

    if (selectedIndex !== null && selectedIndex >= 0) {
        const selectedCampus = CAMPUS_OPTIONS[selectedIndex];
        if (!selectedCampus) {
            throw new Error("校区选择结果无效。");
        }
        // 返回选中的校区 ID ("MainCampus" 或 "Karamay")
        return selectedCampus.id; 
    }

    return null;
}

// 3. 获取学期信息
async function getTermCode() {
    if (typeof $ === 'undefined' || !$.ajax) {
        throw new Error("未检测到 jQuery 环境，请确保在正确的课表页面执行。");
    }

    const termData = await new Promise((resolve, reject) => {
        $.ajax({
            type: 'get',
            dataType: 'json',
            url: '/gmis/default/bindterm',
            cache: false, 
            success: function (data) { resolve(data); },
            error: function (xhr, status, error) { reject(new Error(`网络请求失败，状态码: ${xhr.status} ${error}`)); }
        });
    });

    if (!termData || termData.length === 0) {
        throw new Error("未能获取到有效的学期列表数据。");
    }

    const semesterTexts = [];
    const semesterValues = [];
    let defaultSelectedIndex = 0; 

    termData.forEach((item, index) => {
        semesterTexts.push(item.termname);
        semesterValues.push(item.termcode);
        if (item.selected) {
            defaultSelectedIndex = index;
        }
    });

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择导入学期", 
        JSON.stringify(semesterTexts), 
        defaultSelectedIndex
    );

    if (selectedIndex !== null && selectedIndex >= 0) {
        return semesterValues[selectedIndex];
    }

    return null;
}

// 4. 获取课程数据
async function fetchData(termCode) {
    if (typeof $ === 'undefined' || !$.ajax) {
        throw new Error("未检测到 jQuery 环境，请确保在正确的课表页面执行。");
    }

    const response = await new Promise((resolve, reject) => {
        $.ajax({
            type: 'post',
            dataType: 'json',
            url: "../pygl/py_kbcx_ew",
            data: { 'kblx': 'xs', 'termcode': termCode },
            cache: false,
            success: function (data) { resolve(data); },
            error: function (xhr, status, error) { reject(new Error(`网络请求失败，状态码: ${xhr.status} ${error}`)); }
        });
    });

    if (!response || !response.rows) {
        throw new Error("接口返回数据为空或解密后格式不正确");
    }

    return response.rows;
}

// 5. 导入课程数据
async function parseCourses(py_kbcx_ew, isKaramayCampus) {    
    // 用于存放每一小节课的临时数组
    let allCourseBlocks = [];

    // 辅助函数 1：根据 jcid 转换成标准的节次编号
    function getStandardSection(jcid) {
        if (jcid >= 11 && jcid <= 15) return jcid - 10;
        let afternoonOffset = isKaramayCampus ? 5 : 4;
        if (jcid >= 21 && jcid <= 24) return jcid - 20 + afternoonOffset; 
        let eveningOffset = isKaramayCampus ? 9 : 8;
        if (jcid >= 31 && jcid <= 33) return jcid - 30 + eveningOffset;
        return 1; // 默认兜底
    }

    // 辅助函数 2：解析类似 "连续周 1-12周" 或 "单周 1-11周" 的字符串，返回数字数组
    function parseWeeks(weekStr) {
        let weeks = [];
        let isSingle = weekStr.includes('单');
        let isDouble = weekStr.includes('双');

        let matches = weekStr.match(/\d+-\d+|\d+/g);
        if (matches) {
            matches.forEach(m => {
                if (m.includes('-')) {
                    let [start, end] = m.split('-').map(Number);
                    for (let i = start; i <= end; i++) {
                        if (isSingle && i % 2 === 0) continue;
                        if (isDouble && i % 2 !== 0) continue;
                        weeks.push(i);
                    }
                } else {
                    let w = Number(m);
                    if (isSingle && w % 2 === 0) return;
                    if (isDouble && w % 2 !== 0) return;
                    weeks.push(w);
                }
            });
        }
        return [...new Set(weeks)].sort((a, b) => a - b);
    }

    // --- 第一步：将按“行”排列的数据，拆解提取出每一小节课 ---
    py_kbcx_ew.forEach(row => {
        // 本校区强行剔除上午第5节 (jcid === 15)
        if (!isKaramayCampus && row.jcid === 15) {
            return; 
        }

        let currentSection = getStandardSection(row.jcid);
        // 遍历星期一 (z1) 到星期日 (z7)
        for (let day = 1; day <= 7; day++) {
            let zVal = row['z' + day];
            if (zVal) {
                // 如果同一个时间有两门课（比如单双周不同），按 <br/> 拆分
                let classParts = zVal.split(/<br\s*\/?>/i); 
                
                classParts.forEach(part => {
                    let match = part.match(/(.*?)\[(.*?)\]([^\[]*)(?:\[(.*?)\])?$/);
                    
                    if (match) {
                        allCourseBlocks.push({
                            name: match[1].trim(),                   // 提取：课程名
                            weekStr: match[2].trim(),                // 提取：原始周次字符串 (用于后续比对)
                            weeks: parseWeeks(match[2]),             // 解析：纯数字周次数组
                            teacher: match[3] ? match[3].trim() : "",// 提取：老师
                            position: match[4] ? match[4].trim() : "未知地点", // 提取：上课地点
                            day: day,                                // 星期几
                            section: currentSection                  // 当前是第几节
                        });
                    }
                });
            }
        }
    });

    // --- 第二步：将连续的小节课“合并”成一门完整的课 ---
    let mergedCourses = [];
    allCourseBlocks.forEach(block => {
        // 寻找是否已经有相邻的课可以合并 (同星期、同课名、同老师、同地点、同周次，且节次刚好挨着)
        let existingCourse = mergedCourses.find(c => 
            c.day === block.day &&
            c.name === block.name &&
            c.teacher === block.teacher &&
            c.position === block.position &&
            c.weekStr === block.weekStr &&
            c.endSection === block.section - 1 // 核心：判断是否紧挨着上一节
        );

        if (existingCourse) {
            // 如果可以合并，就把结束节次往后延
            existingCourse.endSection = block.section;
        } else {
            // 如果不能合并，就作为一门新课加入
            mergedCourses.push({
                name: block.name,
                teacher: block.teacher,
                position: block.position,
                day: block.day,
                startSection: block.section,
                endSection: block.section,
                weeks: block.weeks,
                weekStr: block.weekStr 
            });
        }
    });

    // 清理掉多余的辅助比对字段，输出最终给拾光 App 的标准格式
    const finalCourses = mergedCourses.map(c => {
        delete c.weekStr; 
        return c;
    });

    const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
    if (result !== true) {
        throw new Error("课程导入失败，请查看日志。");
    }
}

// 6. 导入预设时间段
async function importPresetTimeSlots(campusId) {    
    const campusConfig = PRESET_TIME_CONFIG.campuses[campusId];
    const commonConfig = PRESET_TIME_CONFIG.common;
    const generatedSlots = [];
    let currentSectionNum = 1;

    // 辅助函数：把 HH:mm 转换成分钟数 (例如 08:00 -> 480)
    function timeToMinutes(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    // 辅助函数：把分钟数转换成 HH:mm
    function minutesToTime(mins) {
        const h = Math.floor(mins / 60).toString().padStart(2, '0');
        const m = (mins % 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    }

    // 按照上午、下午、晚上的顺序生成
    const periods = ["morning", "afternoon", "evening"];
    
    periods.forEach(period => {
        const count = campusConfig.sectionCounts[period];
        if (count === 0) return; // 如果该时段没课，跳过

        let currentMins = timeToMinutes(campusConfig.startTimes[period]);
        const longBreakPos = commonConfig.longBreakAfter[period];

        for (let i = 1; i <= count; i++) {
            const startStr = minutesToTime(currentMins);
            currentMins += campusConfig.durations.classMinutes; // 加上课时间
            const endStr = minutesToTime(currentMins);

            generatedSlots.push({
                number: currentSectionNum,
                startTime: startStr,
                endTime: endStr
            });

            currentSectionNum++;

            // 如果不是该时段的最后一节课，则加上课间休息时间，推算出下一节的开始时间
            if (i < count) {
                if (i === longBreakPos) {
                    currentMins += campusConfig.durations.longBreakMinutes;
                } else {
                    currentMins += campusConfig.durations.shortBreakMinutes;
                }
            }
        }
    });

    const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(generatedSlots));
    if (result !== true) {
        throw new Error("时间段导入失败，请查看日志。");
    }
}


// 7. 导入课表配置
async function saveConfig() {
    let startDate = await window.shiguangBridgePromise.showPrompt(
        "输入开学日期", 
        "请输入本学期开学日期 (格式: YYYY-MM-DD):",
        "2025-09-01",          
        "validateDateInput"    
    );

    if (startDate === null) {
        startDate = "2025-09-01"; 
    } else {
        startDate = startDate.trim().replace(/[\/\.]/g, '-');
    }

    const courseConfigData = {
        "semesterStartDate": startDate,
        "semesterTotalWeeks": 25,
        "defaultClassDuration": 45,
        "defaultBreakDuration": 5,
        "firstDayOfWeek": 1
    };

    const configJsonString = JSON.stringify(courseConfigData);
    const result = await window.shiguangBridgePromise.saveCourseConfig(configJsonString);
    if (result !== true) {
        throw new Error("导入配置失败，请查看日志。");
    }
}

/**
 * 编排整个课程导入流程。
 */
async function runImportFlow() {
    try {
        // 1. 公告和前置检查。
        const alertConfirmed = await promptUserToStart();
        if (!alertConfirmed) {
            throw new Error("导入已取消。");
        }
        
        // 2. 选择校区。 (获取校区ID)
        const campusId = await selectCampus();
        if (campusId === null) {
            throw new Error("导入已取消：未选择校区。");
        }
        
        // 生成一个 boolean 给解析课程使用
        const isKaramayCampus = (campusId === "Karamay");

        // 3. 获取学期。
        const termCode = await getTermCode();
        if (termCode === null) {
            throw new Error("导入已取消：未选择学期。");
        }

        // 4. 获取课程数据
        const py_kbcx_ew = await fetchData(termCode);

        // 5. 解析课程信息。 (传入 boolean)
        await parseCourses(py_kbcx_ew, isKaramayCampus);
        
        // 6. 导入时间段数据。 (传入字符串 campusId，供引擎推算)
        await importPresetTimeSlots(campusId);
        
        // 7. 保存配置数据 
        await saveConfig();

        // 8. 流程**完全成功**，发送结束信号。
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        const message = error && error.message ? error.message : "导入流程执行失败。";
        if (typeof window.shiguangBridge !== 'undefined') {
            window.shiguangBridge.showToast(message);
        }
        console.error("runImportFlow error:", error);
    }
}

// 启动所有演示
runImportFlow();