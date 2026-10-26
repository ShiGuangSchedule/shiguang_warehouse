// 铜仁学院移动教务 (gztrc.edu.cn:17230/yjw) 拾光课程表适配脚本
// 使用个人课表接口(courseSchedule)查询
// 登录后需要从 localStorage 中读取用户信息，无需在脚本内登录

const API = {
    semesters: "/api/baseInfo/mobile/common/querySemester",
    weeks: "/api/baseInfo/mobile/common/queryCurrentSemesterWeekList",
    times: "/api/baseInfo/mobile/common/timeNameDetail",
    schedule: "/api/arrange/mobile/courseSchedule/courseSchedule"
};

async function apiGet(path) {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) throw new Error("请求失败: " + path);
    return res.json();
}

async function apiPost(path, data, token) {
    const res = await fetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "accessToken": token
        },
        credentials: "include",
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error("请求失败: " + path);
    return res.json();
}

function parseUserFromStorage() {
    try {
        const raw = localStorage.getItem("user_info");
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.accessToken || !data.userInfo || !data.userInfo.userId) return null;
        return {
            token: data.accessToken,
            userId: data.userInfo.userId,
            userType: data.userInfo.userType || "0",
            name: data.userInfo.name || ""
        };
    } catch (e) {
        return null;
    }
}

/**
 * 解析单条课表记录（接口按"天 x 节次"逐格返回，每格一条记录）
 * week 为空时使用记录自带的 weeks 字段
 */
function parseCourseItem(c, week) {
    if (!c || !c.courseName) return null;
    const section = parseInt(c.time);
    if (isNaN(section) || section < 1) return null;

    let w = week;
    if (w === undefined || w === null) {
        w = parseInt(c.weeks);
        if (isNaN(w) || w < 1) return null;
    }

    // 教务dayOfWeek: 1=周日,2=周一,3=周二,4=周三,5=周四,6=周五,7=周六
    // 规范day: 1=周一,2=周二,3=周三,4=周四,5=周五,6=周六,7=周日
    const dayMap = { "1": 7, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6 };
    const day = dayMap[String(c.dayOfWeek)] || parseInt(c.dayOfWeek);

    let position = c.classroomName;
    if (!position || position === "," || position.trim() === "") {
        position = "未知地点";
    }

    return {
        name: c.courseName,
        teacher: c.teacherName || "",
        position: position,
        day: day,
        section: section,
        week: w
    };
}

function sameWeekSet(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function pushWeek(list, w) {
    if (list.indexOf(w) === -1) list.push(w);
}

/**
 * 将逐格记录合并为课程：
 * 先按(天,课程,教师,地点,节次)聚合周次，再合并连续节次（且周次集合相同）
 */
function mergeToCourses(records) {
    const groups = new Map();
    for (let r of records) {
        const key = [r.day, r.name, r.teacher, r.position].join("|");
        let g = groups.get(key);
        if (!g) {
            g = { day: r.day, name: r.name, teacher: r.teacher, position: r.position, secMap: new Map() };
            groups.set(key, g);
        }
        if (!g.secMap.has(r.section)) g.secMap.set(r.section, []);
        pushWeek(g.secMap.get(r.section), r.week);
    }

    const courses = [];
    for (let g of groups.values()) {
        const sections = Array.from(g.secMap.keys()).sort((a, b) => a - b);
        let cur = null;
        for (let sec of sections) {
            const weeks = g.secMap.get(sec).sort((a, b) => a - b);
            if (cur && sec === cur.endSection + 1 && sameWeekSet(cur.weeks, weeks)) {
                cur.endSection = sec;
            } else {
                cur = {
                    name: g.name,
                    teacher: g.teacher,
                    position: g.position,
                    day: g.day,
                    startSection: sec,
                    endSection: sec,
                    weeks: weeks.slice()
                };
                courses.push(cur);
            }
        }
    }
    return courses;
}

async function querySchedule(user, semesterId, weeks) {
    const body = {
        academicYearSemester: semesterId,
        userId: user.userId,
        userType: user.userType,
        weeks: weeks
    };
    const json = await apiPost(API.schedule, body, user.token);
    if (json.code !== 200) {
        if (json.code === 53000505) {
            throw new Error("登录已失效，请重新登录教务系统后重试。");
        }
        throw new Error(json.message || "获取课表失败");
    }
    if (!json.data || !json.data.course) throw new Error("课表数据为空");
    return json.data.course;
}

async function fetchAllCourses(user, semesterId, totalWeeks) {
    // 注意：一次请求多周时，接口会把同一格子的多周数据以逗号拼接返回
    // （如 courseName:"课A,课B"、teacherName:"师A,师A,..."），无法可靠拆分，
    // 因此必须逐周查询，单周返回的数据是干净的
    const records = [];
    for (let w = 1; w <= totalWeeks; w++) {
        const list = await querySchedule(user, semesterId, [w]);
        records.push(...list.map(c => parseCourseItem(c, w)).filter(c => c !== null));
    }
    return mergeToCourses(records);
}

async function fetchTimeSlots() {
    const json = await apiGet(API.times);
    if (json.code !== 200 || !json.data) throw new Error("获取作息时间失败");
    return json.data.map(t => ({
        number: parseInt(t.timeCode),
        startTime: t.startTime,
        endTime: t.endTime
    }));
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始导入课表...");

        // 1. 读取登录信息
        const user = parseUserFromStorage();
        if (!user) {
            await window.shiguangBridgePromise.showAlert(
                "请先登录",
                "请在教务系统（移动教务）中完成登录，进入主页后再次点击执行导入。",
                "知道了"
            );
            return;
        }

        // 2. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期列表...");
        const semesterJson = await apiGet(API.semesters);
        if (semesterJson.code !== 200) throw new Error("获取学期列表失败");
        const semesters = (semesterJson.data || []).filter(s => s && s.semesterId && /^\d{4}-\d{4}-\d+$/.test(s.semesterId));
        if (semesters.length === 0) throw new Error("未能获取学期列表");

        // 3. 选择学期
        let defaultIndex = 0;
        const currentIdx = semesters.findIndex(s => s.isCurrentSemester === "1");
        if (currentIdx !== -1) defaultIndex = currentIdx;
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesters.map(s => s.semesterName)),
            defaultIndex
        );
        if (semesterIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const semester = semesters[semesterIndex];

        // 4. 获取本学期周数
        let totalWeeks = 20;
        try {
            const weekJson = await apiGet(API.weeks);
            if (weekJson.code === 200 && weekJson.data && weekJson.data.length > 0) {
                totalWeeks = weekJson.data.length;
            }
        } catch (e) {
            // 使用默认周数
        }

        // 5. 获取课表数据
        window.shiguangBridge.showToast("正在获取课表数据，共 " + totalWeeks + " 周...");
        const courses = await fetchAllCourses(user, semester.semesterId, totalWeeks);
        if (courses.length === 0) throw new Error("未解析到课程数据，可能该学期暂无课表。");

        // 6. 保存预设时间段
        try {
            const timeSlots = await fetchTimeSlots();
            if (timeSlots.length > 0) {
                await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            }
        } catch (e) {
            window.shiguangBridge.showToast("时间段导入失败，但课程将继续导入。");
        }

        // 7. 保存课程数据
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast("成功导入 " + courses.length + " 条课程记录！");
        window.shiguangBridge.notifyTaskCompletion();

    } catch (e) {
        console.error("[适配脚本错误] " + e.message);
        window.shiguangBridge.showToast("导入失败: " + e.message);
    }
}

runImportFlow();
