// 西北工业大学(NWPU) 拾光课程表适配脚本
// 适配系统：EAMS 教务系统（jwxt.nwpu.edu.cn）
// 适配范围：本科（BACHELOR_AND_ASSOCIATE）
// 维护者：zengzoxiong

/**
 * 将 HHmm 整数格式转换为 HH:mm 字符串
 * @param {number} hhmm - 如 830, 915, 1400
 * @returns {string} - 如 "08:30", "09:15", "14:00"
 */
function formatTime(hhmm) {
    var h = String(Math.floor(hhmm / 100));
    var m = String(hhmm % 100);
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    return h + ':' + m;
}

/**
 * 发起网络请求
 * @param {string} url - 请求地址
 * @returns {Promise<string>} - 响应文本
 */
async function request(url) {
    var res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("网络请求失败: " + res.status);
    return await res.text();
}

/**
 * 获取学生 ID（降级方案）
 * 调用 student-portrait API 获取当前登录学生的数据库 ID
 * @returns {Promise<number|null>} - 学生 ID
 */
async function getStudentIdFallback() {
    console.log("[NWPU] 降级方案：通过 API 获取学生 ID...");
    try {
        var data = await request("/student/for-std/student-portrait/getStdInfo?bizTypeAssoc=2&cultivateTypeAssoc=1");
        var json = JSON.parse(data);
        if (json && json.student && json.student.id) {
            console.log("[NWPU] API 获取学生 ID: " + json.student.id);
            return json.student.id;
        }
        console.error("[NWPU] API 响应中未找到 student.id");
        return null;
    } catch (e) {
        console.error("[NWPU] API 获取学生 ID 失败: " + e.message);
        return null;
    }
}

/**
 * 获取学期列表和学生 ID
 * 请求课表页面 HTML，解析 #allSemesters 下拉框和 dataId
 * dataId 提取失败时降级调用 getStdInfo API
 * @returns {Promise<{semesters: Array, studentId: number|null}>} - 学期列表和学生 ID
 */
async function getSemestersAndStudentId() {
    console.log("[NWPU] 正在获取学期列表和学生 ID...");
    try {
        var html = await request("/student/for-std/course-table");

        // 优先从 HTML 提取 dataId
        var dataIdMatch = html.match(/var\s+dataId\s*=\s*(\d+)/);
        var studentId = dataIdMatch ? parseInt(dataIdMatch[1]) : null;

        if (studentId) {
            console.log("[NWPU] 从页面提取 dataId: " + studentId);
        } else {
            // 降级：调用 API 获取
            console.log("[NWPU] 页面未找到 dataId，降级调用 API...");
            studentId = await getStudentIdFallback();
        }

        // 解析学期列表
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var select = doc.querySelector("#allSemesters");
        if (!select) {
            console.error("[NWPU] 未找到 #allSemesters 元素");
            return { semesters: [], studentId: studentId };
        }
        var options = select.querySelectorAll("option");
        var semesters = [];
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var id = parseInt(opt.getAttribute("value"));
            var name = opt.textContent.trim();
            if (!isNaN(id) && name) {
                semesters.push({ id: id, name: name });
            }
        }
        console.log("[NWPU] 获取到 " + semesters.length + " 个学期");
        return { semesters: semesters, studentId: studentId };
    } catch (e) {
        console.error("[NWPU] 获取学期列表失败: " + e.message);
        return { semesters: [], studentId: null };
    }
}

/**
 * 获取课程数据
 * 调用 print-data API 获取指定学期的课程和时间表信息
 * @param {number} semesterId - 学期 ID
 * @param {number} studentId - 学生 ID
 * @returns {Promise<object|null>} - API 响应 JSON
 */
async function getCourseData(semesterId, studentId) {
    console.log("[NWPU] 正在获取课程数据...");
    window.shiguangBridge.showToast("正在同步课表...");
    try {
        var url = "/student/for-std/course-table/semester/" + semesterId + "/print-data/" + studentId;
        var data = await request(url);
        return JSON.parse(data);
    } catch (e) {
        console.error("[NWPU] 获取课程数据失败: " + e.message);
        window.shiguangBridge.showToast("获取课程数据失败: " + e.message);
        return null;
    }
}

/**
 * NWPU 默认作息时间（长安校区）
 * 当 API 响应中不包含 timeTableLayout 时使用
 */
function getDefaultTimeSlots() {
    return [
        { number: 1,  startTime: "08:30", endTime: "09:15" },
        { number: 2,  startTime: "09:25", endTime: "10:10" },
        { number: 3,  startTime: "10:30", endTime: "11:15" },
        { number: 4,  startTime: "11:25", endTime: "12:10" },
        { number: 5,  startTime: "12:20", endTime: "13:05" },
        { number: 6,  startTime: "13:05", endTime: "13:50" },
        { number: 7,  startTime: "14:00", endTime: "14:45" },
        { number: 8,  startTime: "14:55", endTime: "15:40" },
        { number: 9,  startTime: "16:00", endTime: "16:45" },
        { number: 10, startTime: "16:55", endTime: "17:40" },
        { number: 11, startTime: "19:00", endTime: "19:45" },
        { number: 12, startTime: "19:55", endTime: "20:40" },
        { number: 13, startTime: "20:40", endTime: "21:25" }
    ];
}

/**
 * 从 API 响应中提取时间段
 * 优先从 timeTableLayout.courseUnitList 动态获取，否则使用默认时间段
 * @param {object} apiData - API 响应
 * @returns {Array<{number: number, startTime: string, endTime: string}>}
 */
function extractTimeSlots(apiData) {
    var layout = apiData.timeTableLayout;
    if (layout && layout.courseUnitList) {
        var slots = [];
        for (var i = 0; i < layout.courseUnitList.length; i++) {
            var unit = layout.courseUnitList[i];
            slots.push({
                number: unit.indexNo,
                startTime: formatTime(unit.startTime),
                endTime: formatTime(unit.endTime)
            });
        }
        console.log("[NWPU] 从 API 提取到 " + slots.length + " 个时间段");
        return slots;
    }
    console.log("[NWPU] API 未返回时间段，使用默认作息时间");
    return getDefaultTimeSlots();
}

/**
 * 获取学期信息（开始日期、结束日期）
 * 调用 ws/semester/get API
 * @param {number} semesterId - 学期 ID
 * @returns {Promise<{startDate: string|null, endDate: string|null}>}
 */
async function getSemesterInfo(semesterId) {
    try {
        var data = await request("/student/ws/semester/get/" + semesterId);
        var json = JSON.parse(data);
        return {
            startDate: json.startDate || null,
            endDate: json.endDate || null
        };
    } catch (e) {
        console.warn("[NWPU] 获取学期信息失败: " + e.message);
        return { startDate: null, endDate: null };
    }
}

/**
 * 计算两个日期之间的周数
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {number}
 */
function calculateTotalWeeks(startDate, endDate) {
    if (!startDate || !endDate) return 20;
    var start = new Date(startDate);
    var end = new Date(endDate);
    var diffMs = end.getTime() - start.getTime();
    var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.ceil(diffDays / 7);
}

/**
 * 从 API 响应和学期信息中提取学期配置
 * @param {object} semesterInfo - 学期信息 {startDate, endDate}
 * @param {Array} activities - 课程活动列表
 * @returns {object} - CourseConfigJsonModel
 */
function extractCourseConfig(semesterInfo, activities) {
    var semesterStartDate = semesterInfo.startDate;
    var semesterTotalWeeks = 20;

    // 优先从学期日期计算总周数
    if (semesterInfo.startDate && semesterInfo.endDate) {
        semesterTotalWeeks = calculateTotalWeeks(semesterInfo.startDate, semesterInfo.endDate);
    } else if (activities.length > 0) {
        // 回退：从 weekIndexes 推算
        var maxWeek = 0;
        for (var i = 0; i < activities.length; i++) {
            var weeks = activities[i].weekIndexes;
            if (weeks && weeks.length > 0) {
                for (var j = 0; j < weeks.length; j++) {
                    if (weeks[j] > maxWeek) maxWeek = weeks[j];
                }
            }
        }
        if (maxWeek > 0) semesterTotalWeeks = maxWeek;
    }

    console.log("[NWPU] 学期开始日期: " + (semesterStartDate || "未知") + ", 总周数: " + semesterTotalWeeks);
    return {
        semesterStartDate: semesterStartDate,
        semesterTotalWeeks: semesterTotalWeeks,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1
    };
}

/**
 * 将 API 活动数据转换为 ImportCourseJsonModel 格式
 * @param {Array} activities - API activities 数组
 * @returns {Array<object>} - 课程列表
 */
function convertCourses(activities) {
    var courses = [];
    for (var i = 0; i < activities.length; i++) {
        var act = activities[i];

        // 拼接教室信息：优先 room，辅以 building
        var position = act.room || act.building || "未知地点";

        // 取第一个教师
        var teacher = "未知教师";
        if (act.teachers && act.teachers.length > 0) {
            teacher = act.teachers[0];
        }

        // 排序周次
        var weeks = (act.weekIndexes || []).slice().sort(function(a, b) { return a - b; });

        if (act.courseName && weeks.length > 0) {
            courses.push({
                name: act.courseName,
                teacher: teacher,
                position: position,
                day: act.weekday,
                startSection: act.startUnit,
                endSection: act.endUnit,
                weeks: weeks
            });
        }
    }
    console.log("[NWPU] 转换完成，共 " + courses.length + " 个课程条目");
    return courses;
}

/**
 * 第一步：保存时间段
 */
async function saveTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        console.warn("[NWPU] 无时间段数据，跳过");
        return true;
    }
    try {
        console.log("[NWPU] 正在保存时间段...");
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("成功导入 " + timeSlots.length + " 个时间段");
        return true;
    } catch (e) {
        console.error("[NWPU] 保存时间段失败: " + e.message);
        window.shiguangBridge.showToast("保存时间段失败: " + e.message);
        return false;
    }
}

/**
 * 第二步：保存课表配置
 */
async function saveConfig(config) {
    try {
        console.log("[NWPU] 正在保存课表配置...");
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast("课表配置导入成功");
        return true;
    } catch (e) {
        console.error("[NWPU] 保存配置失败: " + e.message);
        window.shiguangBridge.showToast("保存配置失败: " + e.message);
        return false;
    }
}

/**
 * 第三步：保存课程数据
 */
async function saveCourses(courses) {
    if (courses.length === 0) {
        window.shiguangBridge.showToast("没有课程数据需要导入");
        return true;
    }
    try {
        console.log("[NWPU] 正在保存课程数据...");
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast("成功导入 " + courses.length + " 个课程条目");
        return true;
    } catch (e) {
        console.error("[NWPU] 保存课程失败: " + e.message);
        window.shiguangBridge.showToast("保存课程失败: " + e.message);
        return false;
    }
}

/**
 * 主导入流程
 */
async function runImportFlow() {
    try {
        // 1. 显示导入说明
        var confirmed = await window.shiguangBridgePromise.showAlert(
            "西北工业大学课表导入",
            "导入前请确保您已在浏览器中登录教务系统（jwxt.nwpu.edu.cn）。\n\n" +
            "本适配将自动获取学期信息、时间段和课程数据。",
            "开始导入"
        );
        if (!confirmed) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        // 2. 获取学期列表和学生 ID（从同一页面提取）
        window.shiguangBridge.showToast("正在获取学期列表...");
        var pageData = await getSemestersAndStudentId();
        if (!pageData.studentId) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "未能获取学生 ID，请确认您已登录教务系统。",
                "确定"
            );
            return;
        }
        if (pageData.semesters.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "导入失败",
                "未能获取学期列表，请刷新页面后重试。",
                "确定"
            );
            return;
        }
        var semesters = pageData.semesters;
        var studentId = pageData.studentId;

        // 3. 用户选择学期（支持重选）
        var semesterNames = [];
        for (var i = 0; i < semesters.length; i++) {
            semesterNames.push(semesters[i].name);
        }

        var activities = null;
        var selectedSemester = null;

        while (true) {
            var selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期",
                JSON.stringify(semesterNames),
                0
            );
            if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= semesters.length) {
                window.shiguangBridge.showToast("导入已取消");
                return;
            }
            selectedSemester = semesters[selectedIndex];
            console.log("[NWPU] 选择学期: " + selectedSemester.name + " (ID: " + selectedSemester.id + ")");

            // 4. 获取课程数据
            var apiData = await getCourseData(selectedSemester.id, studentId);
            if (!apiData) return;

            var tableVm = apiData.studentTableVm;
            if (tableVm && tableVm.activities && tableVm.activities.length > 0) {
                activities = tableVm.activities;
                break;
            }

            // 无数据，弹窗提示后重新选择
            var retry = await window.shiguangBridgePromise.showAlert(
                "无课程数据",
                "「" + selectedSemester.name + "」没有课程数据，请选择其他学期。",
                "重新选择"
            );
            if (!retry) {
                window.shiguangBridge.showToast("导入已取消");
                return;
            }
        }

        console.log("[NWPU] 获取到 " + activities.length + " 条课程活动");

        // 5. 获取学期信息（开始日期、结束日期）
        window.shiguangBridge.showToast("正在获取学期信息...");
        var semesterInfo = await getSemesterInfo(selectedSemester.id);
        console.log("[NWPU] 学期开始: " + (semesterInfo.startDate || "未知") + ", 结束: " + (semesterInfo.endDate || "未知"));

        // 6. 提取时间段
        var timeSlots = extractTimeSlots(apiData);

        // 7. 提取课表配置
        var courseConfig = extractCourseConfig(semesterInfo, activities);

        // 8. 转换课程数据
        var courses = convertCourses(activities);

        // 9. 三步导入：时间段 → 配置 → 课程
        var timeSlotResult = await saveTimeSlots(timeSlots);
        if (!timeSlotResult) return;

        var configResult = await saveConfig(courseConfig);
        if (!configResult) return;

        var courseResult = await saveCourses(courses);
        if (!courseResult) return;

        // 完成
        window.shiguangBridge.showToast("课表导入完成！");
        window.shiguangBridge.notifyTaskCompletion();

    } catch (e) {
        console.error("[NWPU] 导入异常: " + e.message);
        window.shiguangBridge.showToast("导入异常: " + e.message);
    }
}

// 启动导入流程
runImportFlow();
