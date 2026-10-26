// 福建船政交通职业学院(fjcpc.edu.cn)拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 引导
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "公告",
        "即将开始导入请确保已经登录并跳转到已显示课表位置",
        "好的，开始"
    );
}

/**
 * 选择作息时间（双季适配）
 */
async function selectTimeSchedule() {
    const semesters = ["夏季作息", "冬季作息"];
    
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(semesters),
        -1
    );
    
    if (selectedIndex === null) return null;

    // 预设节次数据
    const summerTime = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:00", endTime: "10:45" },
        { number: 4, startTime: "10:55", endTime: "11:40" },
        { number: 5, startTime: "14:30", endTime: "15:15" },
        { number: 6, startTime: "15:25", endTime: "16:10" },
        { number: 7, startTime: "16:30", endTime: "17:15" },
        { number: 8, startTime: "17:25", endTime: "18:10" },
        { number: 9, startTime: "19:20", endTime: "20:05" },
        { number: 10, startTime: "20:15", endTime: "21:00" }
    ];

    const winterTime = [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:55", endTime: "09:40" },
        { number: 3, startTime: "10:00", endTime: "10:45" },
        { number: 4, startTime: "10:55", endTime: "11:40" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:55", endTime: "15:40" },
        { number: 7, startTime: "16:00", endTime: "16:45" },
        { number: 8, startTime: "16:55", endTime: "17:40" },
        { number: 9, startTime: "19:00", endTime: "19:45" },
        { number: 10, startTime: "19:55", endTime: "20:40" }
    ];

    return selectedIndex === 0 ? summerTime : winterTime;
}

/**
 * 获取并解析网络数据
 */
async function fetchAndParseData() {
    // 自动提取凭证
    const match = document.cookie.match(/Admin-Token=([^;]+)/);
    if (!match) {
        window.shiguangBridge.showToast("未发现登录凭证，请登录后重试");
        return null;
    }
    const token = decodeURIComponent(match[1]);

    try {
        const response = await fetch("https://211-80-233-108.webvpn.fjcpc.edu.cn/jwxt/manager/bjxx/kb/selectStudentLeader", {
            "headers": { "authorization": token },
            "method": "GET"
        });
        const json = await response.json();
        const { xlxx, xskbList } = json.data;

        // 计算日期
        const date = new Date(xlxx.rq);
        const day = date.getDay();
        const diffToMonday = (day === 0 ? 6 : day - 1);
        const firstMonday = new Date(date);
        firstMonday.setDate(date.getDate() - diffToMonday - (parseInt(xlxx.zc) - 1) * 7);

        // 解析课程列表
        const days = { "Mon": 1, "Tues": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6, "Sun": 7 };
        const slots = ["1_2", "3_4", "5_6", "7_8", "9_10", "11_12"];
        const courses = [];

        for (const [dk, dv] of Object.entries(days)) {
            slots.forEach(sk => {
                const raw = xskbList[`${dk}${sk}`];
                if (raw && raw.includes('◇')) {
                    raw.split('\n').filter(l => l.includes('◇')).forEach(line => {
                        const p = line.split('◇');
                        const timePart = p[1]; 
                        const secStr = timePart.split('(')[1].replace(')', '');
                        const sec = secStr.split(',');

                        courses.push({
                            name: p[0].split('<')[1].trim(),
                            teacher: p[4].trim(),
                            position: p[2].trim(),
                            day: dv,
                            startSection: parseInt(sec[0]),
                            endSection: parseInt(sec[1]),
                            weeks: ((s) => {
                                const ws = [];
                                s.split(',').forEach(v => {
                                    if (v.includes('-')) {
                                        const [b, e] = v.split('-').map(Number);
                                        for (let i = b; i <= e; i++) ws.push(i);
                                    } else ws.push(Number(v));
                                });
                                return ws;
                            })(timePart.split('(')[0])
                        });
                    });
                }
            });
        }

        return {
            config: {
                semesterStartDate: firstMonday.toISOString().split('T')[0],
                semesterTotalWeeks: 24,
                firstDayOfWeek: 1
            },
            courses: courses
        };
    } catch (e) {
        window.shiguangBridge.showToast("数据解析失败: " + e.message);
        return null;
    }
}

// 编排主流程

async function runImportFlow() {
    window.shiguangBridge.showToast("课程导入流程开始...");

    // 公告和前置检查
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    // 选择作息时间
    const timeSlots = await selectTimeSchedule();
    if (timeSlots === null) {
        window.shiguangBridge.showToast("已取消选择作息。");
        return;
    }

    // 网络请求和数据解析
    const data = await fetchAndParseData();
    if (data === null) {
        return;
    }

    // 保存课表配置
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(data.config));
    } catch (e) {
        window.shiguangBridge.showToast("保存配置失败");
        return;
    }

    // 课程数据保存
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(data.courses));
        window.shiguangBridge.showToast(`成功抓取 ${data.courses.length} 门课程！`);
    } catch (e) {
        window.shiguangBridge.showToast("保存课程数据失败");
        return;
    }

    // 导入时间段
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("作息时间同步成功");
    } catch (e) {
        console.error("作息保存失败:", e);
    }

    window.shiguangBridge.showToast("所有任务已完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();