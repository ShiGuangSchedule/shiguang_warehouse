/**
 * 拾光课程表 - 东北林业大学 (NEFU) 教务系统适配脚本
 *
 * 适用系统：强智新版教务系统 (/dist/#/new/tableIndex)
 * 支持环境：校内直连 (jwxt.nefu.edu.cn) 及校外 WebVPN (jwxt-443.webvpn.nefu.edu.cn)
 * 适配规范：拾光课程表 V2 桥接 API
 * 维护者：StarryHui
 */

// ========== 1. 基础工具函数 ==========

/**
 * 封装 API POST 请求 (自动携带 Cookie 会话凭据)
 */
async function postApi(url, data = null) {
    const headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded"
    };

    // 若当前会话存在 token 字段则兼容附带，但不做强制依赖
    try {
        const token = sessionStorage.getItem("Token");
        if (token) {
            headers["token"] = token;
        }
    } catch (_) {}

    let body = null;
    if (data && typeof data === "object") {
        body = new URLSearchParams(data).toString();
    } else if (typeof data === "string") {
        body = data;
    }

    const res = await fetch(url, {
        method: "POST",
        headers: headers,
        body: body,
        credentials: "include"
    });

    if (!res.ok) {
        throw new Error(`网络请求失败: HTTP ${res.status}`);
    }

    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

/**
 * 根据某周周一日期与周次编号，推算第 1 周周一日期 (YYYY-MM-DD)
 */
function calculateSemesterStartDate(mondayDateStr, currentWeekNum) {
    if (!mondayDateStr || !currentWeekNum) return null;
    try {
        const parts = mondayDateStr.split("-").map(Number);
        if (parts.length !== 3) return null;
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setDate(d.getDate() - (currentWeekNum - 1) * 7);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    } catch (e) {
        console.warn("计算开学日期出错:", e);
        return null;
    }
}

/**
 * 解析单条课程原始记录并转换为 CourseJsonModel
 */
function parseCourseItem(rawItem) {
    const name = (rawItem.courseName || "").trim();
    const teacher = (rawItem.teacherName || "").trim();
    const position = (rawItem.location || "").trim();
    const classTime = String(rawItem.classTime || "").trim();

    if (!name || classTime.length < 3) return null;

    // 第 1 位为星期 (1~7)
    const day = parseInt(classTime[0], 10);
    if (isNaN(day) || day < 1 || day > 7) return null;

    // 后面每 2 位为一个节次编号 (例如 "0102" -> [1, 2])
    const secPart = classTime.slice(1);
    const sections = [];
    for (let i = 0; i < secPart.length; i += 2) {
        const sec = parseInt(secPart.slice(i, i + 2), 10);
        if (!isNaN(sec) && sec > 0) {
            sections.push(sec);
        }
    }
    if (sections.length === 0) return null;

    const startSection = Math.min(...sections);
    const endSection = Math.max(...sections);

    // 解析周次 (优先使用 classWeekDetails，形如 ",6,7,8,9,10,11,12,13,14,15,16,17,")
    let weeks = [];
    if (rawItem.classWeekDetails) {
        weeks = rawItem.classWeekDetails
            .split(",")
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);
    } else if (rawItem.classWeek) {
        // 兜底格式，例如 "6-17" 或 "4"
        const segments = rawItem.classWeek.split(",");
        for (const seg of segments) {
            if (seg.includes("-")) {
                const [start, end] = seg.split("-").map(Number);
                if (!isNaN(start) && !isNaN(end)) {
                    for (let w = start; w <= end; w++) weeks.push(w);
                }
            } else {
                const w = parseInt(seg, 10);
                if (!isNaN(w) && w > 0) weeks.push(w);
            }
        }
    }

    weeks = [...new Set(weeks)].sort((a, b) => a - b);
    if (weeks.length === 0) return null;

    return {
        name,
        teacher,
        position,
        day,
        startSection,
        endSection,
        weeks,
        isCustomTime: false
    };
}

/**
 * 对课程进行同属性合并与去重
 */
function mergeCourses(courseList) {
    const map = new Map();
    for (const c of courseList) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}`;
        if (!map.has(key)) {
            map.set(key, { ...c, weeks: [...c.weeks] });
        } else {
            const existing = map.get(key);
            const combined = [...new Set([...existing.weeks, ...c.weeks])].sort((a, b) => a - b);
            existing.weeks = combined;
        }
    }
    return Array.from(map.values());
}

/**
 * 东北林业大学预设作息时间表定义 (1~12节) - 东北林业大学标准作息时间
 */
function getPresetTimeSlots() {
    return [
        { number: 1, startTime: "08:00", endTime: "08:45" },
        { number: 2, startTime: "08:50", endTime: "09:35" },
        { number: 3, startTime: "09:55", endTime: "10:40" },
        { number: 4, startTime: "10:45", endTime: "11:30" },
        { number: 5, startTime: "13:40", endTime: "14:25" },
        { number: 6, startTime: "14:30", endTime: "15:15" },
        { number: 7, startTime: "15:35", endTime: "16:20" },
        { number: 8, startTime: "16:25", endTime: "17:10" },
        { number: 9, startTime: "18:00", endTime: "18:45" },
        { number: 10, startTime: "18:50", endTime: "19:35" },
        { number: 11, startTime: "19:40", endTime: "20:25" },
        { number: 12, startTime: "20:30", endTime: "21:15" }
    ];
}

// ========== 2. 主流程控制函数 ==========

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("正在准备导入东北林业大学课表...");

        // 1. 导入确认弹窗 (假设用户已进入教务系统环境)
        const startConfirmed = await window.shiguangBridgePromise.showAlert(
            "东北林业大学教务导入",
            "点击开始后将自动获取学期、作息及全部课程数据。请确保您已进入教务系统页面。是否继续？",
            "开始导入"
        );
        if (!startConfirmed) {
            window.shiguangBridge.showToast("已取消导入。");
            return;
        }

        const baseUrl = `${window.location.origin}/njwhd`;

        // 3. 获取学期列表
        window.shiguangBridge.showToast("正在获取学期信息...");
        let xnxqList = [];
        try {
            xnxqList = await postApi(`${baseUrl}/getXnxqList`);
        } catch (e) {
            console.error("获取学期失败:", e);
        }

        if (!Array.isArray(xnxqList) || xnxqList.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "登录状态失效",
                "未能获取到学期数据，您的登录凭证可能已过期。\n请刷新页面重新登录后再试。",
                "确定"
            );
            return;
        }

        // 确定默认学期 (当前学期 isdqxq === "1")
        let defaultIndex = xnxqList.findIndex(item => item.isdqxq === "1");
        if (defaultIndex < 0) defaultIndex = 0;

        let selectedXnxq = xnxqList[defaultIndex].xnxq01id;

        // 如果有多个学期供选择
        if (xnxqList.length > 1) {
            const semesterOptions = xnxqList.map(item => {
                const label = item.xqmc || item.xnxq01id;
                return item.isdqxq === "1" ? `${label} (当前学期)` : label;
            });

            const userChoice = await window.shiguangBridgePromise.showSingleSelection(
                "选择导入学期",
                JSON.stringify(semesterOptions),
                defaultIndex
            );

            if (userChoice === null) {
                window.shiguangBridge.showToast("已取消学期选择。");
                return;
            }
            selectedXnxq = xnxqList[userChoice].xnxq01id;
        }

        console.log("选择的学期:", selectedXnxq);

        // 4. 获取节次模式 (本部 / 海南国际学院)
        let kbjcmsid = "";
        try {
            const msRes = await postApi(`${baseUrl}/Get_sjkbms`);
            if (msRes && Array.isArray(msRes.data)) {
                const defaultMs = msRes.data.find(m => m.mrms === "1") || msRes.data[0];
                if (defaultMs) kbjcmsid = defaultMs.kbjcmsid;
            }
        } catch (e) {
            console.warn("获取节次模式失败，使用默认值:", e);
        }

        // 5. 获取教学周次及计算学期开学日期
        window.shiguangBridge.showToast("正在计算学期开学日期...");
        let totalWeeks = 20;
        let nowWeek = 1;
        try {
            const weekRes = await postApi(`${baseUrl}/teachingWeek`);
            if (weekRes && weekRes.code === "1") {
                if (Array.isArray(weekRes.data) && weekRes.data.length > 0) {
                    totalWeeks = weekRes.data.length;
                }
                if (weekRes.nowWeek) {
                    nowWeek = parseInt(weekRes.nowWeek, 10);
                }
            }
        } catch (e) {
            console.warn("获取周次信息失败:", e);
        }

        // 6. 请求当前周数据以推导开学第 1 周周一日期
        let semesterStartDate = null;
        try {
            const curWeekRes = await postApi(`${baseUrl}/student/curriculum?xnxq01id=${selectedXnxq}&kbjcmsid=${kbjcmsid}&week=`);
            if (curWeekRes && curWeekRes.data && curWeekRes.data[0] && Array.isArray(curWeekRes.data[0].date)) {
                const dateArr = curWeekRes.data[0].date;
                if (dateArr.length > 0 && dateArr[0].mxrq) {
                    const thisWeekMonday = dateArr[0].mxrq;
                    const thisWeekNum = curWeekRes.nowWeek ? parseInt(curWeekRes.nowWeek, 10) : nowWeek;
                    semesterStartDate = calculateSemesterStartDate(thisWeekMonday, thisWeekNum);
                    console.log(`依据第 ${thisWeekNum} 周周一 ${thisWeekMonday} 计算开学日:`, semesterStartDate);
                }
            }
        } catch (e) {
            console.warn("获取当前周推导开学日期失败:", e);
        }

        // 7. 获取全学期课程数据
        window.shiguangBridge.showToast("正在拉取全学期课程数据...");
        let rawItems = [];

        try {
            // week=all 直接获取整学期全部课程
            const allRes = await postApi(`${baseUrl}/student/curriculum?xnxq01id=${selectedXnxq}&kbjcmsid=${kbjcmsid}&week=all`);
            if (allRes && allRes.data && allRes.data[0] && Array.isArray(allRes.data[0].item)) {
                rawItems = allRes.data[0].item;
            }
        } catch (e) {
            console.warn("直接请求全学期课程异常，尝试周次循环兜底:", e);
        }

        // 兜底方案：若 week=all 结果为空，则循环请求各周
        if (rawItems.length === 0) {
            window.shiguangBridge.showToast("正在逐周聚合课表数据...");
            const seenJx0408 = new Set();
            for (let w = 1; w <= totalWeeks; w++) {
                try {
                    const wRes = await postApi(`${baseUrl}/student/curriculum?xnxq01id=${selectedXnxq}&kbjcmsid=${kbjcmsid}&week=${w}`);
                    if (wRes && wRes.data && wRes.data[0] && Array.isArray(wRes.data[0].item)) {
                        for (const item of wRes.data[0].item) {
                            const key = item.jx0408id || `${item.courseName}_${item.classTime}_${item.classWeek}`;
                            if (!seenJx0408.has(key)) {
                                seenJx0408.add(key);
                                rawItems.push(item);
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`第 ${w} 周请求跳过:`, err);
                }
            }
        }

        console.log(`原始课程记录数: ${rawItems.length}`);
        if (rawItems.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "未找到课程",
                "教务系统未返回选定学期的课程数据，请确认本学期是否已排课。",
                "确定"
            );
            return;
        }

        // 8. 解析与合并课程
        const parsedList = [];
        for (const raw of rawItems) {
            const course = parseCourseItem(raw);
            if (course) parsedList.push(course);
        }

        const finalCourses = mergeCourses(parsedList);
        console.log(`成功解析并合并为 ${finalCourses.length} 个课块`);

        if (finalCourses.length === 0) {
            await window.shiguangBridgePromise.showAlert("解析失败", "未能解析到有效课程时间段。", "确定");
            return;
        }

        // 9. 作息时间表设置 (东北林业大学标准作息时间)
        const timeOptions = [
            "东北林业大学标准作息时间"
        ];
        const timeChoice = await window.shiguangBridgePromise.showSingleSelection(
            "选择作息时间表",
            JSON.stringify(timeOptions),
            0
        );
        if (timeChoice === null) {
            window.shiguangBridge.showToast("已取消作息时间选择。");
            return;
        }

        const timeSlots = getPresetTimeSlots();

        // 10. 保存课表全局配置
        const courseConfig = {
            semesterTotalWeeks: totalWeeks,
            firstDayOfWeek: 1
        };
        if (semesterStartDate) {
            courseConfig.semesterStartDate = semesterStartDate;
        }

        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(courseConfig));

        // 11. 保存预设时间段
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));

        // 12. 保存课程数据
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));

        // 13. 完成提示与结束信号
        window.shiguangBridge.showToast(`导入成功！共导入 ${finalCourses.length} 门课程块`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("导入流程异常:", error);
        window.shiguangBridge.showToast(`导入失败: ${error.message}`);
    }
}

// 启动导入流程
runImportFlow();
