// 文件: school.js
// 功能：从桂医教务系统获取课程表，通过桥接 API 导入到拾光课程表

// ---------- 全局验证函数 ----------
function validateYearInput(input) {
    if (/^\d{4}$/.test(input)) {
        return false; // 验证通过
    } else {
        return "请输入四位数字的年份（例如 2024）";
    }
}

// ---------- 工具函数 ----------
function parseWeeks(weeksStr) {
    // 🔥 修复核心：兼容数字、数组和字符串
    if (typeof weeksStr === 'number') {
        return [weeksStr];
    }
    if (Array.isArray(weeksStr)) {
        return weeksStr.map(Number);
    }

    // 兼容字符串情况
    let str = String(weeksStr).replace('周', '');
    const parts = str.split(',');
    const weeks = [];
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            weeks.push(Number(part));
        }
    }
    return weeks;
}

// 兼容旧字段 jcdm 的解析（保留作为备用）
function parseSections(jcdm) {
    const str = String(jcdm);
    const sections = [];
    if (str.includes('-')) {
        const [start, end] = str.split('-').map(Number);
        for (let i = start; i <= end; i++) sections.push(i);
    } else if (/^\d+$/.test(str)) {
        for (let i = 0; i < str.length; i += 2) {
            const sec = parseInt(str.substring(i, i + 2), 10);
            if (!isNaN(sec)) sections.push(sec);
        }
    } else {
        sections.push(parseInt(str));
    }
    return sections;
}

function parseRawCourses(rawData) {
    const courseInfos = [];
    for (const course of rawData) {
        const name = course.kcmc;
        const teacher = course.teaxms;
        const position = course.jxcdmc;
        const weeks = parseWeeks(course.zc); // 这里调用已经修复
        const day = parseInt(course.xq);

        // 使用 ps 和 pe 字段来生成 sections 数组
        let sections = [];
        if (course.ps !== undefined && course.pe !== undefined && course.ps !== '' && course.pe !== '') {
            const start = parseInt(course.ps, 10);
            const end = parseInt(course.pe, 10);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    sections.push(i);
                }
            }
        } else if (course.jcdm !== undefined) {
            sections = parseSections(course.jcdm);
        }

        if (sections.length === 0) {
            console.warn('跳过无节次信息的课程:', course.kcmc);
            continue;
        }

        courseInfos.push({ name, teacher, position, weeks, day, sections });
    }
    return courseInfos;
}

function convertToTargetCourses(middleCourses) {
    return middleCourses.map(c => ({
        name: c.name,
        teacher: c.teacher,
        position: c.position,
        day: c.day,
        startSection: c.sections[0],
        endSection: c.sections[c.sections.length - 1],
        weeks: c.weeks,
        isCustomTime: false
    }));
}

function getTimeSlots() {
    return [
        { number: 1, startTime: "08:30", endTime: "09:10" },
        { number: 2, startTime: "09:20", endTime: "10:00" },
        { number: 3, startTime: "10:10", endTime: "10:50" },
        { number: 4, startTime: "11:00", endTime: "11:40" },
        { number: 5, startTime: "11:50", endTime: "12:30" },
        { number: 6, startTime: "14:30", endTime: "15:10" },
        { number: 7, startTime: "15:20", endTime: "16:00" },
        { number: 8, startTime: "16:10", endTime: "16:50" },
        { number: 9, startTime: "17:00", endTime: "17:40" },
        { number: 10, startTime: "19:00", endTime: "19:40" },
        { number: 11, startTime: "19:50", endTime: "20:30" },
        { number: 12, startTime: "20:40", endTime: "21:20" }
    ];
}

// ---------- 网络请求 ----------
async function fetchCourseData(xnxqdm) {
    const url = "https://ejwc.glmu.edu.cn/new/student/xsgrkb/getCalendarWeekDatas";

    // 🔥 核心修改：并发请求第 1 周到第 20 周
    const promises = [];
    for (let zc = 1; zc <= 20; zc++) {
        const bodyParams = `xnxqdm=${xnxqdm}&zc=${zc}`;
        promises.push(
            fetch(url, {
                headers: {
                    "accept": "application/json, text/javascript, */*; q=0.01",
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest"
                },
                body: bodyParams,
                method: "POST",
                credentials: "include"
            })
            .then(res => res.json())
            .then(ret => {
                // 深度兼容新版数据结构
                let courseData = null;
                if (Array.isArray(ret)) {
                    courseData = ret;
                } else if (ret.rows && Array.isArray(ret.rows)) {
                    courseData = ret.rows;
                } else if (ret.data) {
                    if (Array.isArray(ret.data)) {
                        courseData = ret.data;
                    } else if (ret.data.rows && Array.isArray(ret.data.rows)) {
                        courseData = ret.data.rows;
                    } else if (ret.data.list && Array.isArray(ret.data.list)) {
                        courseData = ret.data.list;
                    }
                } else if (ret.result && Array.isArray(ret.result)) {
                    courseData = ret.result;
                } else if (ret.list && Array.isArray(ret.list)) {
                    courseData = ret.list;
                }

                if (courseData && courseData.length > 0) {
                    // 安全补全：如果教务系统返回的数据里没有 zc 字段，补上当前请求的周次
                    courseData.forEach(course => {
                        if (!course.zc) {
                            course.zc = String(zc);
                        }
                    });
                    return courseData;
                }
                return [];
            })
            .catch(err => {
                console.error(`请求第 ${zc} 周数据出错:`, err);
                return []; // 某一周失败不影响整体
            })
        );
    }

    // 等待所有 20 个请求并发完成
    const results = await Promise.all(promises);

    // 合并结果
    let allRows = [];
    results.forEach(rows => {
        allRows = allRows.concat(rows);
    });

    return allRows;
}

// ---------- 用户交互 ----------
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "重要提醒",
        "请确保您已登录桂医教务系统，且当前页面为教务系统内任意页面。\n\n点击确定继续。",
        "确定"
    );
}

async function getAcademicYear() {
    return await window.shiguangBridgePromise.showPrompt(
        "学年设置",
        "请输入本学年开始的年份\n（例如 2024，代表 2024-2025 学年）",
        "2024",
        "validateYearInput"
    );
}

async function selectSemester() {
    const semesterOptions = ["上学期", "下学期", "短学期"];
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions),
        0
    );
    if (index === null || index < 0) return null;
    return index;
}

// ---------- 主流程 ----------
async function run() {
    try {
        const confirmed = await promptUserToStart();
        if (!confirmed) {
            window.shiguangBridge.showToast("用户取消了导入流程。");
            return;
        }

        const yearInput = await getAcademicYear();
        if (yearInput === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const yearNum = parseInt(yearInput);
        if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
            await window.shiguangBridgePromise.showAlert("错误", "学年输入无效，请输入2000-2100之间的数字。", "确定");
            return;
        }

        const semesterIndex = await selectSemester();
        if (semesterIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const termCode = semesterIndex === 0 ? "01" : (semesterIndex === 1 ? "02" : "03");
        const xnxqdm = `${yearNum}${termCode}`;

        window.shiguangBridge.showToast("正在获取课表，请稍候...");
        let rawData;
        try {
            rawData = await fetchCourseData(xnxqdm);
        } catch (fetchErr) {
            await window.shiguangBridgePromise.showAlert(
                "网络请求失败",
                `请求教务系统失败：${fetchErr.message}\n\n请检查网络连接和登录状态。`,
                "确定"
            );
            return;
        }

        if (!rawData.length) {
            await window.shiguangBridgePromise.showAlert("提示", "未获取到任何课程数据。请确认已登录教务系统并选择正确的学年学期。", "确定");
            return;
        }

        const middleCourses = parseRawCourses(rawData);
        const targetCourses = convertToTargetCourses(middleCourses);

        try {
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(targetCourses));
            window.shiguangBridge.showToast(`课程数据已导入（共 ${targetCourses.length} 条）`);
        } catch (saveErr) {
            await window.shiguangBridgePromise.showAlert("保存课程失败", saveErr.message, "确定");
            return;
        }

        const timeSlots = getTimeSlots();
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("时间段数据已导入");
        } catch (slotErr) {
            window.shiguangBridge.showToast(`时间段保存失败：${slotErr.message}`);
        }

        window.shiguangBridge.showToast("导入完成！");
        window.shiguangBridge.notifyTaskCompletion();

    } catch (err) {
        console.error("run error:", err);
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            `未知错误：${err.message || err}\n\n请联系开发者。`,
            "确定"
        );
        window.shiguangBridge.notifyTaskCompletion();
    }
}

// 启动
run();