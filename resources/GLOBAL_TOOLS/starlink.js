/**
 * 星链课表分享导入脚本
 */

// 工具函数

// 输入验证
function validateInput(input) {
    if (!input || input.trim().length === 0) return "请输入分享码！";
    return false;
}

// 提取分享码
function extractShareCode(text) {
    const structuredRegex = /输入：\s*([^（\s]+)/;
    const fallbackRegex = /([a-zA-Z0-9-]{5,20})/;

    const matchA = text.match(structuredRegex);
    if (matchA && matchA[1]) return matchA[1].trim();

    const matchB = text.match(fallbackRegex);
    if (matchB) return matchB[1].trim();

    return text.trim();
}

// 课程合并与去重函数

/**
 * 节次与周次合并去重函数
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            // 节次连续：延长结束节次
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    // 阶段 2：合并同节次的周次
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            // 周次合并去重
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// 时间转换函数

// 将分钟数转换为 HH:mm 格式
function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// 将星链的 sectionMinutes 转换为标准时间段数据
function convertTimeSlots(sectionMinutes) {
    if (!sectionMinutes) return [];
    
    const timeSlots = [];
    for (const [number, [startMin, endMin]] of Object.entries(sectionMinutes)) {
        timeSlots.push({
            number: parseInt(number),
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(endMin)
        });
    }
    timeSlots.sort((a, b) => a.number - b.number);
    return timeSlots;
}

// 主流程

async function runStarlinkImport() {
    try {
        // 获取用户输入
        const userInput = await window.shiguangBridgePromise.showPrompt(
            "导入星链课表",
            "请粘贴分享文案（包含分享码）",
            "",
            "validateInput"
        );

        if (!userInput) return;

        const shareCode = extractShareCode(userInput);
        const apiUrl = `https://api.starlinkkb.cn/share/curriculum/${shareCode}`;
        
        window.shiguangBridge.showToast("正在同步云端数据...");

        // 请求数据
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("分享码已失效或网络异常");

        const resJson = await response.json();
        const data = resJson.data;

        if (!data || !data.courses || data.courses.length === 0) {
            throw new Error("未获取到课程数据");
        }

        // 数据映射 - 转换为标准格式
        const rawCourses = data.courses.map(c => ({
            name: c.name || "未命名课程",
            teacher: (c.teacher && c.teacher !== "无") ? c.teacher : "未知教师",
            position: (c.location && c.location.replace(/^@/, '').trim() !== "") 
                        ? c.location.replace(/^@/, '').trim() 
                        : "未排地点",
            day: c.weekday || 1,
            startSection: c.startSection || 1,
            endSection: c.endSection || 1,
            weeks: c.weeks || []
        }));

        // 使用官方合并去重函数处理课程数据
        const finalCourses = mergeAndDistinctCourses(rawCourses);

        // 构建标准课程数据
        const standardCourses = finalCourses.map(c => ({
            name: c.name,
            teacher: c.teacher,
            position: c.position,
            day: c.day,
            startSection: c.startSection,
            endSection: c.endSection,
            weeks: c.weeks
        }));

        // 构建配置数据
        const config = {
            semesterStartDate: data.startDate ? data.startDate.substring(0, 10) : null,
            semesterTotalWeeks: data.totalWeeks || 20
        };

        // 转换时间段数据
        const timeSlots = convertTimeSlots(data.sectionMinutes || {});

        // 保存配置
        if (config.semesterStartDate) {
            try {
                await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
                window.shiguangBridge.showToast("课表配置已更新");
            } catch (e) {
                console.warn("保存配置失败:", e.message);
            }
        }

        // 保存时间段
        if (timeSlots.length > 0) {
            try {
                await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
                window.shiguangBridge.showToast("已导入 " + timeSlots.length + " 个时间段");
            } catch (e) {
                console.warn("保存时间段失败:", e.message);
            }
        }

        // 保存课程数据
        const success = await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(standardCourses)
        );

        if (success) {
            window.shiguangBridge.showToast("成功导入 " + standardCourses.length + " 门课程");
            window.shiguangBridge.notifyTaskCompletion();
        }

    } catch (e) {
        await window.shiguangBridgePromise.showAlert(
            "导入失败", 
            e.message || "未知错误，请检查网络或分享码", 
            "确定"
        );
    }
}

// 启动导入
runStarlinkImport();