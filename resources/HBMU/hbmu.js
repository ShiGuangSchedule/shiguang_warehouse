// 功能：从湖医药教务系统获取课程表，通过桥接 API 导入到拾光课程表

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
    weeksStr = weeksStr.replace('周', '');
    const parts = weeksStr.split(',');
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
        const weeks = parseWeeks(course.zc);
        const day = parseInt(course.xq);
        const sections = parseSections(course.jcdm);
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
        { number: 1, startTime: "08:00", endTime: "08:40" },
        { number: 2, startTime: "08:50", endTime: "09:30" },
        { number: 3, startTime: "09:40", endTime: "10:20" },
        { number: 4, startTime: "10:30", endTime: "11:10" },
        { number: 5, startTime: "11:20", endTime: "12:00" },
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
    let page = 1;
    const rowsPerPage = 100;
    let allRows = [];
    let total = 0;

    while (true) {
        const res = await fetch("https://jw.hbmu.edu.cn/xsgrkbcx!getDataList.action", {
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: `xnxqdm=${xnxqdm}&page=${page}&rows=${rowsPerPage}`,
            method: "POST",
            credentials: "include"
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const ret = await res.json();
        if (!ret.rows || !Array.isArray(ret.rows)) {
            throw new Error("返回数据格式不正确");
        }
        total = ret.total;
        allRows = allRows.concat(ret.rows);
        if (allRows.length >= total) break;
        page++;
        if (page > 10) break;
    }
    return allRows;
}

// ---------- 用户交互 ----------
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "重要提醒",
        "请确保您已登录湖医药教务系统，且当前页面为教务系统内任意页面。\n\n点击确定继续。",
        "确定"
    );
}

async function getAcademicYear() {
    return await window.shiguangBridgePromise.showPrompt(
        "学年设置",
        "请输入本学年开始的年份\n（例如 2024，代表 2024-2025 学年）",
        "2024",
        "validateYearInput"  // 传入验证函数名
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
        // 1. 公告
        const confirmed = await promptUserToStart();
        if (!confirmed) {
            window.shiguangBridge.showToast("用户取消了导入流程。");
            return;
        }

        // 2. 获取学年
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

        // 3. 获取学期
        const semesterIndex = await selectSemester();
        if (semesterIndex === null) {
            window.shiguangBridge.showToast("导入已取消。");
            return;
        }
        const termCode = semesterIndex === 0 ? "01" : (semesterIndex === 1 ? "02" : "03");
        const xnxqdm = `${yearNum}${termCode}`;

        // 4. 请求课表
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

        // 5. 解析并转换
        const middleCourses = parseRawCourses(rawData);
        const targetCourses = convertToTargetCourses(middleCourses);

        // 6. 保存课程
        try {
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(targetCourses));
            window.shiguangBridge.showToast(`课程数据已导入（共 ${targetCourses.length} 条）`);
        } catch (saveErr) {
            await window.shiguangBridgePromise.showAlert("保存课程失败", saveErr.message, "确定");
            return;
        }

        // 7. 保存时间段
        const timeSlots = getTimeSlots();
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("时间段数据已导入");
        } catch (slotErr) {
            // 时间段保存失败不终止流程，只提示
            window.shiguangBridge.showToast(`时间段保存失败：${slotErr.message}`);
        }

        // 8. 完成通知
        window.shiguangBridge.showToast("导入完成！");
        window.shiguangBridge.notifyTaskCompletion();

    } catch (err) {
        // 捕获所有未预料的错误
        console.error("run error:", err);
        await window.shiguangBridgePromise.showAlert(
            "导入失败",
            `未知错误：${err.message || err}\n\n请联系开发者。`,
            "确定"
        );
        // 仍然通知完成，但可能不会生成有效文件
        window.shiguangBridge.notifyTaskCompletion();
    }
}

// 启动
run();