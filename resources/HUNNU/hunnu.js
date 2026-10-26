/**
 * 湖南师范大学 (hunnu.edu.cn) 拾光课程表适配脚本
 *
 * 适配方式：从 courseTableForStd.action 返回的 HTML 中
 *           解析 TaskActivity JavaScript 数据，提取精确的课程信息。
 *           课程数据以 new TaskActivity(...) 调用 + index 赋值的形式嵌入页面。
 */

"use strict";

// ===== 常量 =====
const UNIT_COUNT = 13;
const TIME_SLOTS = [
    { number: 1,  startTime: "08:00", endTime: "08:45" },
    { number: 2,  startTime: "08:55", endTime: "09:40" },
    { number: 3,  startTime: "10:00", endTime: "10:45" },
    { number: 4,  startTime: "10:55", endTime: "11:40" },
    { number: 5,  startTime: "12:45", endTime: "13:30" },
    { number: 6,  startTime: "13:30", endTime: "14:15" },
    { number: 7,  startTime: "14:30", endTime: "15:15" },
    { number: 8,  startTime: "15:25", endTime: "16:10" },
    { number: 9,  startTime: "16:30", endTime: "17:15" },
    { number: 10, startTime: "17:25", endTime: "18:10" },
    { number: 11, startTime: "19:00", endTime: "19:45" },
    { number: 12, startTime: "19:55", endTime: "20:40" },
    { number: 13, startTime: "20:50", endTime: "21:35" }
];

// ===== 工具函数 =====

/**
 * 将周次位图转为周次数组
 * 位图格式：50位0/1字符串，位置i（1-indexed）对应第i周
 * 位置0固定为0（占位符），位置1=第1周，位置2=第2周...
 */
function parseWeeksFromBitmap(bitmap) {
    const weeks = [];
    if (!bitmap) return weeks;
    for (let i = 1; i < bitmap.length; i++) {
        if (bitmap[i] === "1") weeks.push(i);
    }
    return weeks;
}

/**
 * 智能分割 TaskActivity 参数（按逗号，保留引号内内容）
 */
function splitArgs(str) {
    const result = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    for (const ch of str) {
        if (ch === '"') { inQuote = !inQuote; current += ch; }
        else if (ch === "(" && !inQuote) { depth++; current += ch; }
        else if (ch === ")" && !inQuote) { depth--; current += ch; }
        else if (ch === "," && !inQuote && depth === 0) {
            result.push(current.trim());
            current = "";
        } else { current += ch; }
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

/**
 * 从完整 HTML 中解析所有 TaskActivity 课程
 *
 * 匹配模式：actTeachers + 任意代码 + TaskActivity + index 赋值
 * 使用单个正则避免跨块获取错误的 actTeachers。
 */
function parseTaskActivities(html) {
    const courses = [];

    const blockRe = /var\s+actTeachers\s*=\s*\[[^\]]*?name\s*:\s*"([^"]+)"[^\]]*?\]\s*;[\s\S]*?activity\s*=\s*new\s+TaskActivity\s*\(([\s\S]*?)\)\s*;([\s\S]*?)(?=var\s+(?:actTeachers|teachers)|table0\.marshalTable|$)/g;

    let match;
    while ((match = blockRe.exec(html)) !== null) {
        const teacher = match[1];
        const argsStr = match[2];
        const tail = match[3];

        const parts = splitArgs(argsStr);
        if (parts.length < 7) continue;

        const courseFull = (parts[3] || "").replace(/^"|"$/g, "");
        const location = (parts[5] || "").replace(/^"|"$/g, "");
        const weekBitmap = (parts[6] || "").replace(/^"|"$/g, "");

        const nameMatch = courseFull.match(/^(.+?)\(/);
        const name = nameMatch ? nameMatch[1].trim() : courseFull;
        if (!name) continue;

        const weeks = parseWeeksFromBitmap(weekBitmap);
        if (weeks.length === 0) continue;

        const idxRe = /index\s*=\s*(\d+)\s*\*\s*(?:unitCount|\d+)\s*\+\s*(\d+)\s*;/g;
        let idxMatch;
        while ((idxMatch = idxRe.exec(tail)) !== null) {
            const day = parseInt(idxMatch[1]);
            const section = parseInt(idxMatch[2]);
            courses.push({
                name, teacher, position: location,
                day: day + 1, startSection: section + 1, endSection: section + 1,
                weeks: [...weeks]
            });
        }
    }
    return courses;
}

/**
 * 合并同一课程在相邻节次的条目
 */
function mergeCourses(courses) {
    // 第一步：按 name+teacher+position+day 分组
    const groups = new Map();
    for (const c of courses) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }

    const merged = [];
    for (const [, group] of groups) {
        // 按 startSection 排序
        group.sort((a, b) => a.startSection - b.startSection);

        let current = null;
        for (const c of group) {
            if (!current) {
                current = { ...c, weeks: [...c.weeks] };
            } else if (c.startSection === current.endSection + 1) {
                // 相邻节次，扩展 endSection 并合并周次
                current.endSection = c.endSection;
                current.weeks = [...new Set([...current.weeks, ...c.weeks])].sort((a, b) => a - b);
            } else {
                merged.push(current);
                current = { ...c, weeks: [...c.weeks] };
            }
        }
        if (current) merged.push(current);
    }

    return merged;
}

// ===== 主流程 =====

/**
 * 等待指定毫秒
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取课表页面的完整 HTML
 *
 * 策略：
 * 1. 当前已经是课表页（URL 含 courseTableForStd）→ 直接取 document
 * 2. 在外层页面，课表 iframe 已存在 → 取 iframe 内容
 * 3. 在外层页面，课表 iframe 未创建 → 自动点击"我的课表"链接，等待 iframe 加载后取内容
 */
async function getCourseTableHtml() {
    const url = window.location.href;

    if (url.includes("courseTableForStd")) {
        return document.documentElement.outerHTML;
    }

    let iframe = Array.from(document.querySelectorAll("iframe.eams-iframe")).find(
        f => (f.src || f.getAttribute("src") || "").includes("courseTableForStd")
    );

    if (!iframe) {
        const link = document.querySelector('a[href*="courseTableForStd"][target*="eams-iframe"]');
        if (link) {
            link.click();
            for (let i = 0; i < 30; i++) {
                iframe = Array.from(document.querySelectorAll("iframe.eams-iframe")).find(
                    f => (f.src || f.getAttribute("src") || "").includes("courseTableForStd")
                );
                if (iframe) break;
                await sleep(200);
            }
        }
    }

    if (iframe) {
        const srcdoc = iframe.getAttribute("srcdoc");
        if (srcdoc) return srcdoc;

        if (!iframe.contentDocument) {
            await new Promise(resolve => {
                iframe.addEventListener("load", resolve, { once: true });
            });
        }
        return iframe.contentDocument.documentElement.outerHTML;
    }

    await window.shiguangBridgePromise.showAlert(
        "未找到课表",
        "请先点击「我的课表」打开课表页面，然后重新运行导入。",
        "确定"
    );
    throw new Error("course table not found");
}

async function runImportFlow() {
    window.shiguangBridge.showToast("湖南师范大学课程导入启动...");

    const confirmed = await window.shiguangBridgePromise.showAlert(
        "湖南师范大学课表导入",
        "导入前请确保：\n1. 您已登录教务系统\n2. 课表页面已打开且课程数据正常显示",
        "好的，开始导入"
    );
    if (!confirmed) { window.shiguangBridge.showToast("导入已取消"); return; }

    window.shiguangBridge.showToast("正在获取课表数据...");

    const html = await getCourseTableHtml();

    // 解析课程
    const rawCourses = parseTaskActivities(html);
    if (rawCourses.length === 0) {
        await window.shiguangBridgePromise.showAlert(
            "解析失败",
            "未能从页面中识别到课程数据。\n请确认课表页面已正确加载。",
            "确定"
        );
        return;
    }

    const courses = mergeCourses(rawCourses);

    // 导入时间段
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
    } catch (e) {
        window.shiguangBridge.showToast("导入时间段失败: " + e.message);
    }

    // 保存配置
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({ semesterTotalWeeks: 20 }));
    } catch (e) {
        window.shiguangBridge.showToast("保存配置失败: " + e.message);
    }

    // 保存课程
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
    } catch (e) {
        window.shiguangBridge.showToast("保存课程数据失败: " + e.message);
        return;
    }

    window.shiguangBridge.showToast("课表导入完成！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
