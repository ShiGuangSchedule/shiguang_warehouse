// 扬州大学(yzu.edu.cn) 拾光课程表适配脚本
// 基于URP教务系统接口适配

const PAGE_URL = window.location.href;
const VPN_BASE = (PAGE_URL.match(/^(https?:\/\/[^/]+\/http[^/]*\/[^/]+)/) || [])[1];
if (!VPN_BASE) {
    window.shiguangBridge.showToast("请通过扬州大学 WebVPN 进入教务系统后使用");
    throw new Error("无法定位 WebVPN 基址");
}

const API_PATH = "/student/courseSelect/thisSemesterCurriculum/ajaxStudentSchedule/callback";

function parseWeeks(s) {
    const w = [];
    if (!s) return w;
    for (let i = 0; i < s.length; i++) if (s[i] === '1') w.push(i + 1);
    return w;
}

function cleanTeacher(t) {
    return (t || "").replace(/\*/g, "").trim();
}

function parseCourses(data) {
    const courses = [];
    const seen = new Set();
    const list = (data && data.xkxx) || [];
    for (let i = 0; i < list.length; i++) {
        const map = list[i];
        if (!map) continue;
        const keys = Object.keys(map);
        for (let j = 0; j < keys.length; j++) {
            const c = map[keys[j]];
            if (!c || !c.courseName || !c.timeAndPlaceList) continue;
            const teacher = cleanTeacher(c.attendClassTeacher);
            const tpl = c.timeAndPlaceList;
            for (let k = 0; k < tpl.length; k++) {
                const tp = tpl[k];
                const start = tp.classSessions;
                const weeks = parseWeeks(tp.classWeek);
                if (!start || !tp.classDay || weeks.length === 0) continue;
                const key = c.courseName + '|' + teacher + '|' + tp.classDay + '|' + start + '|' + (tp.classSessions + tp.continuingSession - 1) + '|' + weeks.join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                courses.push({
                    name: c.courseName,
                    teacher: teacher,
                    position: ((tp.campusName || "") + (tp.classroomName || "")).trim() || "待定",
                    day: tp.classDay,
                    startSection: start,
                    endSection: tp.classSessions + tp.continuingSession - 1,
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
    for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const n = parseInt(it.jc, 10);
        const st = it.kssj, et = it.jssj;
        if (isNaN(n) || !st || st.length !== 4 || !et || et.length !== 4) continue;
        slots.push({
            number: n,
            startTime: st.substring(0, 2) + ":" + st.substring(2),
            endTime: et.substring(0, 2) + ":" + et.substring(2)
        });
    }
    return slots.sort((a, b) => a.number - b.number);
}

const FALLBACK_TIME_SLOTS = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:55", "endTime": "09:40" },
    { "number": 3, "startTime": "09:55", "endTime": "10:40" },
    { "number": 4, "startTime": "10:50", "endTime": "11:35" },
    { "number": 5, "startTime": "11:45", "endTime": "12:30" },
    { "number": 6, "startTime": "14:30", "endTime": "15:15" },
    { "number": 7, "startTime": "15:25", "endTime": "16:10" },
    { "number": 8, "startTime": "16:20", "endTime": "17:05" },
    { "number": 9, "startTime": "17:15", "endTime": "18:00" },
    { "number": 10, "startTime": "18:10", "endTime": "18:55" },
    { "number": 11, "startTime": "19:30", "endTime": "20:15" },
    { "number": 12, "startTime": "20:25", "endTime": "21:10" }
];

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "扬州大学课表导入",
            "请确认：\n1. 已登录扬州大学 WebVPN(webvpn.yzu.edu.cn)\n2. 已进入教务「我的课表」页面（能看到学期下拉框）\n未在课表页会导致获取失败。",
            "好的，开始导入"
        );
        if (!confirmed) return;

        const select = document.getElementById("planCode");
        if (!select || select.options.length === 0) {
            window.shiguangBridge.showToast("未找到学期选择框，请先进入课表页面");
            return;
        }
        const texts = [];
        const values = [];
        for (let i = 0; i < select.options.length; i++) {
            texts.push(select.options[i].text);
            values.push(select.options[i].value);
        }
        const defaultIndex = select.selectedIndex >= 0 ? select.selectedIndex : 0;
        const idx = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(texts),
            defaultIndex
        );
        if (idx === null || idx < 0) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        window.shiguangBridge.showToast("正在获取教务数据...");
        const res = await fetch(VPN_BASE + API_PATH, {
            "headers": {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest"
            },
            "body": "planCode=" + values[idx],
            "method": "POST",
            "credentials": "include"
        });
        if (!res.ok) throw new Error("网络请求失败，状态码: " + res.status);

        const data = await res.json();
        const courses = parseCourses(data);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("未解析到课程数据，请确认所选学期有课");
            return;
        }

        const timeSlots = parseTimeSlots(data);
        const ok = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!ok) {
            window.shiguangBridge.showToast("课程保存失败");
            return;
        }
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots.length ? timeSlots : FALLBACK_TIME_SLOTS));
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: 20 }));

        window.shiguangBridge.showToast("成功导入 " + courses.length + " 个课程时段");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        console.error("导入异常:", e);
        window.shiguangBridge.showToast("导入失败: " + e.message);
    }
}

runImportFlow();
