// 辽宁大学课表适配脚本
// 基于 URP 教务系统 JSON 接口适配

// 解析 classWeek 二进制串，如 "111111111111111100000000" -> [1..16]
function parseWeeks(binaryStr) {
    const weeks = [];
    if (!binaryStr) return weeks;
    for (let i = 0; i < binaryStr.length; i++) {
        if (binaryStr[i] === '1') weeks.push(i + 1);
    }
    return weeks;
}

function cleanTeacher(teacher) {
    return (teacher || "").replace(/\*/g, " ").replace(/\s+/g, " ").trim();
}

function formatTime(timeStr) {
    if (timeStr && timeStr.length === 4) {
        return timeStr.substring(0, 2) + ":" + timeStr.substring(2);
    }
    return timeStr || "";
}

function buildPosition(campus, building, room) {
    const campusPart = (campus || "").trim();
    let buildingPart = (building || "").trim();
    let roomPart = (room || "").trim();
    if (campusPart && buildingPart.startsWith(campusPart)) {
        buildingPart = buildingPart.slice(campusPart.length);
    }
    if (campusPart && roomPart.startsWith(campusPart)) {
        roomPart = roomPart.slice(campusPart.length);
    }
    const result = (campusPart + buildingPart + roomPart).trim();
    return result || "待定";
}

function parseCourses(data) {
    const courses = [];
    const seen = new Set();
    const list = (data && data.xkxx) || [];
    for (let i = 0; i < list.length; i++) {
        const map = list[i];
        if (!map) continue;
        for (const key in map) {
            const course = map[key];
            if (!course || !course.courseName || !course.timeAndPlaceList) continue;
            const teacher = cleanTeacher(course.attendClassTeacher);
            for (const timePlace of course.timeAndPlaceList) {
                const day = parseInt(timePlace.classDay);
                const start = parseInt(timePlace.classSessions);
                const continuing = parseInt(timePlace.continuingSession) || 2;
                const end = start + continuing - 1;
                const weeks = parseWeeks(timePlace.classWeek);
                if (!day || !start || weeks.length === 0) continue;
                const position = buildPosition(timePlace.campusName, timePlace.teachingBuildingName, timePlace.classroomName);
                const dedupKey = course.courseName + '|' + teacher + '|' + day + '|' + start + '|' + end + '|' + weeks.join(',') + '|' + position;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);
                courses.push({
                    name: course.courseName,
                    teacher: teacher,
                    position: position,
                    day: day,
                    startSection: start,
                    endSection: end,
                    weeks: weeks,
                    isCustomTime: false
                });
            }
        }
    }
    return courses;
}

function parseTimeSlots(data) {
    const slots = [];
    const list = (data && data.jcsjbs) || [];
    for (const slot of list) {
        const num = parseInt(slot.jc, 10);
        if (isNaN(num)) continue;
        slots.push({
            number: num,
            startTime: formatTime(slot.kssj),
            endTime: formatTime(slot.jssj)
        });
    }
    return slots.sort((a, b) => a.number - b.number);
}

// 教务系统提供的时间可能把校区搞混，所以提供各校区的作息时间表，供用户选择
const CHONGSHAN_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:20" },
    { number: 6, startTime: "14:30", endTime: "15:20" },
    { number: 7, startTime: "15:40", endTime: "16:30" },
    { number: 8, startTime: "16:40", endTime: "17:30" },
    { number: 9, startTime: "18:00", endTime: "18:50" },
    { number: 10, startTime: "19:00", endTime: "19:50" },
    { number: 11, startTime: "20:10", endTime: "21:00" },
    { number: 12, startTime: "21:10", endTime: "22:00" }
];

const PUHE_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:20", endTime: "15:05" },
    { number: 7, startTime: "15:25", endTime: "16:10" },
    { number: 8, startTime: "16:15", endTime: "17:00" },
    { number: 9, startTime: "17:30", endTime: "18:15" },
    { number: 10, startTime: "18:20", endTime: "19:05" },
    { number: 11, startTime: "19:25", endTime: "20:10" },
    { number: 12, startTime: "20:15", endTime: "21:00" }
];

const WUSHENG_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "09:00", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:10", endTime: "12:00" },
    { number: 5, startTime: "13:30", endTime: "14:20" },
    { number: 6, startTime: "14:30", endTime: "15:20" },
    { number: 7, startTime: "15:30", endTime: "16:20" },
    { number: 8, startTime: "16:30", endTime: "17:20" },
    { number: 9, startTime: "18:00", endTime: "18:50" },
    { number: 10, startTime: "19:00", endTime: "19:50" },
    { number: 11, startTime: "20:10", endTime: "21:00" },
    { number: 12, startTime: "21:10", endTime: "22:00" }
];

const CAMPUS_CHONGSHAN = "崇山";
const CAMPUS_PUHE = "蒲河";
const CAMPUS_WUSHENG = "武圣";

const TIME_SLOT_OPTIONS = [
    "从教务提取",
    "内置" + CAMPUS_CHONGSHAN + "校区作息",
    "内置" + CAMPUS_PUHE + "校区作息",
    "内置" + CAMPUS_WUSHENG + "校区作息"
];

const TIME_SLOT_OPTION_EXTRACT = 0;
const TIME_SLOT_OPTION_CHONGSHAN = 1;
const TIME_SLOT_OPTION_PUHE = 2;
const TIME_SLOT_OPTION_WUSHENG = 3;

// 根据课程数据的 campusName 字段猜测所在校区
function guessCampus(data) {
    const counts = {};
    const list = (data && data.xkxx) || [];
    for (const map of list) {
        if (!map) continue;
        for (const key in map) {
            const course = map[key];
            if (!course || !course.timeAndPlaceList) continue;
            for (const timePlace of course.timeAndPlaceList) {
                const campus = (timePlace.campusName || "").trim();
                if (campus) {
                    counts[campus] = (counts[campus] || 0) + 1;
                }
            }
        }
    }
    let best = null;
    let bestCount = 0;
    for (const name in counts) {
        if (counts[name] > bestCount) {
            best = name;
            bestCount = counts[name];
        }
    }
    if (best && best.includes(CAMPUS_CHONGSHAN)) {
        return CAMPUS_CHONGSHAN; 
    }
    if (best && best.includes(CAMPUS_PUHE)) { 
        return CAMPUS_PUHE; 
    }
    if (best && best.includes(CAMPUS_WUSHENG)) {
        return CAMPUS_WUSHENG;
    }
    return null;
}

function readSemesterOptions() {
    const select = document.getElementById('planCode');
    if (!select || !select.options || select.options.length === 0) {
        return null;
    }
    const texts = [];
    const values = [];
    for (let i = 0; i < select.options.length; i++) {
        texts.push(select.options[i].text.replace(/\s+/g, ' ').trim());
        values.push(select.options[i].value);
    }
    return {
        texts: texts,
        values: values,
        defaultIndex: select.selectedIndex >= 0 ? select.selectedIndex : 0
    };
}

async function fetchCourseConfig() {
    try {
        const res = await fetch("/indexCalendar");
        if (!res.ok) return null;
        const html = await res.text();
        
        const config = {};
        const rqMatch = html.match(/var\s+rq\s*=\s*["'](\d{8})["']/);
        if (rqMatch && rqMatch[1]) {
            const dateStr = rqMatch[1];
            // 转换为 YYYY-MM-DD
            config.semesterStartDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        }
        
        const skzcMatch = html.match(/var\s+skzc\s*=\s*["'](\d+)["']/);
        if (skzcMatch && skzcMatch[1]) {
            config.semesterTotalWeeks = parseInt(skzcMatch[1], 10);
        }
        
        return Object.keys(config).length > 0 ? config : null;
    } catch (e) {
        window.shiguangBridge.showToast("获取课程配置失败: " + e.message);
        return null;
    }
}

async function runImportFlow() {
    try {
        let method = "GET";
        let body = undefined;
        let idx = -1;
        let options = null;

        const apiPath = "/student/courseSelect/thisSemesterCurriculum/ajaxStudentSchedule/callback";
        const headers = {
            "Accept": "*/*",
            "X-Requested-With": "XMLHttpRequest"
        };

        const confirmed = await window.shiguangBridgePromise.showAlert(
            "辽宁大学课表导入",
            "请确认已登录教务系统，并处于课表页面。",
            "确定"
        );
        if (!confirmed) return;

        options = readSemesterOptions();
        if (options) {
            idx = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期",
                JSON.stringify(options.texts),
                options.defaultIndex
            );
            if (idx === null || idx < 0) {
                window.shiguangBridge.showToast("导入已取消");
                return;
            }
        }

        if (options && idx >= 0) {
            method = "POST";
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
            headers["Accept"] = "application/json, text/javascript, */*; q=0.01";
            body = "planCode=" + encodeURIComponent(options.values[idx]);
        }

        window.shiguangBridge.showToast("正在获取教务数据...");
        const res = await fetch(apiPath, {
            method: method,
            headers: headers,
            body: body,
            credentials: "include"
        });
        if (!res.ok) {
            window.shiguangBridge.showToast("网络请求失败，状态码: " + res.status);
            return;
        }

        const data = await res.json();

        const courses = parseCourses(data);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("导入失败: 未解析到课程数据，请确认所选学期有课");
            return;
        }

        const campus = guessCampus(data);
        let defaultIndex = TIME_SLOT_OPTION_EXTRACT;
        if (campus === CAMPUS_CHONGSHAN) {
            defaultIndex = TIME_SLOT_OPTION_CHONGSHAN;
        } else if (campus === CAMPUS_PUHE) {
            defaultIndex = TIME_SLOT_OPTION_PUHE;
        } else if (campus === CAMPUS_WUSHENG) {
            defaultIndex = TIME_SLOT_OPTION_WUSHENG;
        }
        const choice = await window.shiguangBridgePromise.showSingleSelection(
            "作息时间来源",
            JSON.stringify(TIME_SLOT_OPTIONS),
            defaultIndex
        );
        if (choice === null || choice < 0) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }
        let timeSlots;
        if (choice === TIME_SLOT_OPTION_CHONGSHAN) {
            timeSlots = CHONGSHAN_TIME_SLOTS;
        } else if (choice === TIME_SLOT_OPTION_PUHE) {
            timeSlots = PUHE_TIME_SLOTS;
        } else if (choice === TIME_SLOT_OPTION_WUSHENG) {
            timeSlots = WUSHENG_TIME_SLOTS;
        } else {
            timeSlots = parseTimeSlots(data);
        }
        
        const configData = await fetchCourseConfig();

        const saved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saved) {
            window.shiguangBridge.showToast("课程保存失败");
            return;
        }
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            if (configData) {
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
            }
        } catch (error) {
            window.shiguangBridge.showToast("作息时间或配置保存失败: " + error.message);
        }

        window.shiguangBridge.showToast("成功导入 " + courses.length + " 个课程时段");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        window.shiguangBridge.showToast("导入失败: " + e.message);
    }
}

runImportFlow();
