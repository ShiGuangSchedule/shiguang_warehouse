// 大连理工大学本科教务系统适配脚本
// 适配人: dffzcqs78694
//
// 接口链路（与页面实际请求一致）:
// 1. GET  /student/for-std/course-table                  → 解析学期下拉框 + 提取 stdPersonId
// 2. GET  /student/ws/schedule-table/get-data?bizTypeId=2&semesterId={id} → lessonIds / timeTableLayoutId / weekIndices
// 3. POST /student/ws/schedule-table/datum               → lessonList(课程) + scheduleList(排课明细)
// 4. POST /student/ws/schedule-table/timetable-layout    → 节次时间定义
// 5. GET  /student/ws/semester/get/{semesterId}          → 学期起止日期(用于推算开学日期, 失败则回退)

// ---- 节次时间表兜底数据(接口失败时使用, 与大工 timetable-layout 一致) ----
const FALLBACK_TIME_SLOTS = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:50", "endTime": "09:35" },
    { "number": 3, "startTime": "10:05", "endTime": "10:50" },
    { "number": 4, "startTime": "10:55", "endTime": "11:40" },
    { "number": 5, "startTime": "13:30", "endTime": "14:15" },
    { "number": 6, "startTime": "14:20", "endTime": "15:05" },
    { "number": 7, "startTime": "15:35", "endTime": "16:20" },
    { "number": 8, "startTime": "16:25", "endTime": "17:10" },
    { "number": 9, "startTime": "18:00", "endTime": "18:45" },
    { "number": 10, "startTime": "18:50", "endTime": "19:35" },
    { "number": 11, "startTime": "19:40", "endTime": "20:25" },
    { "number": 12, "startTime": "20:30", "endTime": "21:15" }
];

// 时间数字格式化: 1800 -> "18:00"
function formatTimeNum(timeNum) {
    if (timeNum === null || timeNum === undefined) return "";
    const str = String(timeNum).padStart(4, '0');
    return `${str.slice(0, 2)}:${str.slice(2, 4)}`;
}

// 判断时间数字是否在 [start, end] 区间内(用于节次映射)
function timeInRange(timeNum, startNum, endNum) {
    return timeNum >= startNum && timeNum <= endNum;
}

// 构建节次列表(数字格式): 优先用接口返回的 courseUnitList, 失败时用内置兜底作息表
function buildCourseUnits(layout) {
    if (layout && Array.isArray(layout.courseUnitList) && layout.courseUnitList.length > 0) {
        return layout.courseUnitList;
    }
    // 兜底: 内置节次表(与大工 timetable-layout 实际数据一致)
    return FALLBACK_TIME_SLOTS.map(slot => ({
        indexNo: slot.number,
        startTime: parseInt(slot.startTime.replace(':', ''), 10),
        endTime: parseInt(slot.endTime.replace(':', ''), 10)
    }));
}

// ---- 纯函数: 根据课程原始排课明细解析为拾光课程格式 ----
// printData: datum 响应中的 result 对象
// layout: timetable-layout 响应中的 result 对象
// 返回课程数组
function parseCourses(printData, layout) {
    const lessonList = printData.lessonList || [];
    const scheduleList = printData.scheduleList || [];
    const lessonById = {};
    lessonList.forEach(lesson => { lessonById[lesson.id] = lesson; });

    // 从 layout 中构建节次列表 (用于 startTime/endTime -> 节次号)
    const units = buildCourseUnits(layout);

    // 按 (lessonId, weekday, startTime, endTime) 分组, 收集周次
    const groups = {};
    scheduleList.forEach(schedule => {
        const key = `${schedule.lessonId}|${schedule.weekday}|${schedule.startTime}|${schedule.endTime}`;
        if (!groups[key]) {
            groups[key] = { schedule: schedule, weeks: [] };
        }
        if (schedule.weekIndex !== null && schedule.weekIndex !== undefined) {
            groups[key].weeks.push(schedule.weekIndex);
        }
    });

    const courses = [];
    Object.keys(groups).forEach(key => {
        const group = groups[key];
        const schedule = group.schedule;
        const lesson = lessonById[schedule.lessonId] || {};

        // 星期几
        const day = schedule.weekday;

        // 节次映射: 找到所有 startTime>=调度开始 && endTime<=调度结束 的节次
        let startSection = null;
        let endSection = null;
        if (units.length > 0 && schedule.startTime !== null && schedule.endTime !== null) {
            const matched = units.filter(unit =>
                timeInRange(unit.startTime, schedule.startTime, schedule.endTime) &&
                timeInRange(unit.endTime, schedule.startTime, schedule.endTime)
            );
            if (matched.length > 0) {
                startSection = matched[0].indexNo;
                endSection = matched[matched.length - 1].indexNo;
            }
        }

        // 教师: 优先取排课明细中的教师, 否则取课程下的教师列表
        let teacher = schedule.personName || "";
        if (!teacher && lesson.teacherAssignmentList) {
            teacher = lesson.teacherAssignmentList.map(t => t.name).filter(Boolean).join(" ");
        }

        // 教室
        let position = "";
        if (schedule.room && schedule.room.nameZh) {
            position = schedule.room.nameZh;
        } else if (schedule.customPlace) {
            position = schedule.customPlace;
        }

        // 周次去重排序
        const weeks = Array.from(new Set(group.weeks)).sort((a, b) => a - b);

        const course = {
            name: lesson.courseName || "",
            teacher: teacher,
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeks
        };
        courses.push(course);
    });

    return courses;
}

// ---- 纯函数: 生成预设时间段 ----
// layout: timetable-layout 响应中的 result 对象
function buildTimeSlots(layout) {
    if (layout && Array.isArray(layout.courseUnitList) && layout.courseUnitList.length > 0) {
        return layout.courseUnitList.map(unit => ({
            number: unit.indexNo,
            startTime: formatTimeNum(unit.startTime),
            endTime: formatTimeNum(unit.endTime)
        }));
    }
    return FALLBACK_TIME_SLOTS;
}

// ---- 纯函数: 推算学期开始日期(第1周周一) ----
// 排课明细的 date + weekIndex 已知, 用最小的 date 算出其所在周周一,
// 再按 weekIndex 差值回退到第 1 周周一。
// 例: 第3周周一=2026-09-14, 则第1周周一 = 09-14 - 2周 = 2026-08-31
function calcSemesterStartDate(printData) {
    let minDate = null;
    let minWeekIndex = null;

    (printData.scheduleList || []).forEach(s => {
        if (s.date && s.date.length >= 10 && s.weekIndex !== null && s.weekIndex !== undefined) {
            if (!minDate || s.date < minDate) {
                minDate = s.date;
                minWeekIndex = s.weekIndex;
            }
        }
    });

    if (!minDate || !minWeekIndex) return null;

    // 该日期所在周的周一
    const dt = new Date(minDate);
    const day = dt.getDay(); // 0=周日
    const diff = (day === 0 ? -6 : 1 - day);
    dt.setDate(dt.getDate() + diff);

    // 回退到第1周
    dt.setDate(dt.getDate() - (minWeekIndex - 1) * 7);
    return dt.toISOString().split('T')[0];
}

// ---- 桥接封装 ----
async function bridgeSaveCourses(courses) {
    const result = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (result === true) {
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        return true;
    }
    window.shiguangBridge.showToast("课程导入未成功，请查看日志。");
    return false;
}

async function bridgeSaveTimeSlots(timeSlots) {
    const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    if (result === true) {
        window.shiguangBridge.showToast(`成功导入 ${timeSlots.length} 个时间段！`);
        return true;
    }
    window.shiguangBridge.showToast("时间段导入失败，请查看日志。");
    return false;
}

async function bridgeSaveConfig(config) {
    const result = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    if (result === true) {
        window.shiguangBridge.showToast("课表配置导入成功！");
        return true;
    }
    window.shiguangBridge.showToast("课表配置导入失败，请查看日志。");
    return false;
}

// ---- 1. 公告 ----
async function promptUserToStart() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "导入提醒",
            "请确保您已登录教务系统，导入前请确认当前学期正确。",
            "好的，开始导入"
        );
        return confirmed === true;
    } catch (e) {
        console.error("公告弹窗出错:", e);
        window.shiguangBridge.showToast("显示公告出错: " + e.message);
        return false;
    }
}

// ---- 2. 获取学期列表 ----
async function getSemesterOptions() {
    try {
        const response = await fetch(`/student/for-std/course-table`);
        const htmlString = await response.text();
        const parser = new DOMParser();
        const dom = parser.parseFromString(htmlString, 'text/html');
        const selectElement = dom.getElementById('semesters') || dom.getElementById('allSemesters');
        if (!selectElement) throw new Error("页面中未找到学期选择框");

        const options = Array.from(selectElement.options);
        const validOptions = options.filter(opt => opt.value && opt.value !== "all");
        if (validOptions.length === 0) throw new Error("未解析到有效的学期列表");

        const semesterTexts = validOptions.map(opt => opt.text.trim());
        const semesterValues = validOptions.map(opt => opt.value);
        return { semesterTexts, semesterValues };
    } catch (e) {
        console.error("获取学期列表失败:", e);
        window.shiguangBridge.showToast("获取学期列表失败: " + e.message);
        return null;
    }
}

// ---- 3. 获取 stdPersonId (从页面 JS 变量中提取) ----
async function fetchStdPersonId() {
    try {
        const response = await fetch(`/student/for-std/course-table`);
        const htmlString = await response.text();
        // 常见模式: stdPersonId = 3284653 或 stdPersonId: 3284653 或 stdPersonId":"3284653"
        const patterns = [
            /stdPersonId\s*[:=]\s*["']?(\d+)["']?/,
            /std_person_id\s*[:=]\s*["']?(\d+)["']?/,
            /stdPersonId["']?\s*[:=]\s*["']?(\d+)["']?/
        ];
        for (const pattern of patterns) {
            const match = htmlString.match(pattern);
            if (match) return match[1];
        }
        return null;
    } catch (e) {
        console.error("提取 stdPersonId 失败:", e);
        return null;
    }
}

// ---- 4. 获取课程基础数据 (get-data) ----
async function fetchGetData(semesterId) {
    const url = `/student/for-std/course-table/get-data?bizTypeId=2&semesterId=${semesterId}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`get-data 请求失败, 状态码: ${response.status}`);
    return await response.json();
}

// ---- 5. 获取排课明细 (datum) ----
async function fetchDatum(lessonIds, stdPersonId) {
    const body = {
        lessonIds: lessonIds,
        studentId: null,
        stdPersonId: stdPersonId,
        weekIndex: null
    };
    const response = await fetch(`/student/ws/schedule-table/datum`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`datum 请求失败, 状态码: ${response.status}`);
    return await response.json();
}

// ---- 6. 获取节次时间表 (timetable-layout) ----
async function fetchTimeTableLayout(timeTableLayoutId) {
    try {
        const response = await fetch(`/student/ws/schedule-table/timetable-layout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: timeTableLayoutId })
        });
        if (!response.ok) throw new Error(`timetable-layout 请求失败, 状态码: ${response.status}`);
        const json = await response.json();
        if (!json || !json.result || !json.result.courseUnitList) throw new Error("timetable-layout 响应结构异常");
        return json.result;
    } catch (e) {
        console.warn("获取节次时间表失败, 使用内置兜底数据:", e);
        return { courseUnitList: null };
    }
}

// ---- 7. 获取学期日期信息 (用于推算开学日期, 可选) ----
async function fetchSemesterInfo(semesterId) {
    try {
        const response = await fetch(`/student/ws/semester/get/${semesterId}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        return null;
    }
}

// ---- 主流程 ----
async function runImportFlow() {
    window.shiguangBridge.showToast("课程导入流程即将开始...");

    // 1. 公告确认
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        return;
    }

    // 2. 选择学期
    const semesterOptions = await getSemesterOptions();
    if (!semesterOptions) return;
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.semesterTexts),
        0
    );
    if (selectedIndex === null || selectedIndex < 0) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    const semesterId = semesterOptions.semesterValues[selectedIndex];
    window.shiguangBridge.showToast(`已选择: ${semesterOptions.semesterTexts[selectedIndex]}`);

    try {
        // 3. 获取课程基础数据
        window.shiguangBridge.showToast("正在获取课程数据...");
        const getData = await fetchGetData(semesterId);
        const lessonIds = getData.lessonIds || [];
        const timeTableLayoutId = getData.timeTableLayoutId;

        // 4. 获取 stdPersonId
        let stdPersonId = await fetchStdPersonId();

        // 5. 获取排课明细
        window.shiguangBridge.showToast("正在获取排课明细...");
        const datum = await fetchDatum(lessonIds, stdPersonId);
        const result = datum.result;
        if (!result || !result.lessonList || !result.scheduleList) {
            throw new Error("datum 响应结构异常, 请检查是否已登录");
        }

        // 6. 获取节次时间表
        const layout = await fetchTimeTableLayout(timeTableLayoutId);

        // 7. 解析课程
        const courses = parseCourses(result, layout);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未解析到课程数据。");
            return;
        }

        // 8. 生成时间段
        const timeSlots = buildTimeSlots(layout);

        // 9. 生成课表配置
        const config = {
            semesterStartDate: null,
            semesterTotalWeeks: 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 5,
            firstDayOfWeek: 1
        };

        // 优先尝试从学期接口获取开学日期与周数
        const semesterInfo = await fetchSemesterInfo(semesterId);
        if (semesterInfo && semesterInfo.startDate) {
            config.semesterStartDate = semesterInfo.startDate;
            if (semesterInfo.endDate) {
                const start = new Date(semesterInfo.startDate);
                const end = new Date(semesterInfo.endDate);
                const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
                const weeks = Math.ceil(diffDays / 7);
                if (weeks > 0) config.semesterTotalWeeks = weeks;
            }
        } else {
            // 回退: 从排课明细推算开学日期
            const startDate = calcSemesterStartDate(result);
            if (startDate) config.semesterStartDate = startDate;
            // 回退: 从课程实际最大周次推算总周数(避免出现大量空白周)
            if (courses.length > 0) {
                let maxWeek = 0;
                courses.forEach(c => c.weeks.forEach(w => { if (w > maxWeek) maxWeek = w; }));
                if (maxWeek > 0) config.semesterTotalWeeks = maxWeek;
            }
        }

        // 10. 依次保存
        const timeSlotOk = await bridgeSaveTimeSlots(timeSlots);
        if (!timeSlotOk) return;

        const configOk = await bridgeSaveConfig(config);
        if (!configOk) return;

        const coursesOk = await bridgeSaveCourses(courses);
        if (!coursesOk) return;

        // 11. 完成
        window.shiguangBridge.showToast("课程导入完成！");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        console.error("导入流程发生错误:", e);
        window.shiguangBridge.showToast("导入失败: " + e.message);
    }
}

// 启动
runImportFlow();