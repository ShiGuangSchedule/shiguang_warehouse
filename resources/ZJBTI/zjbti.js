// 浙江工商职业技术学院(zjbti.net.cn)拾光课程表适配脚本
// 基于官方推荐的青果教务系统 API 架构标准重构实现

/**
 * 动态获取教务系统基地址（自动适配内网直连与 WebVPN 代理路径）
 */
function getJwBaseUrl() {
    const href = window.location.href;
    const match = href.match(/^(https?:\/\/[^\/]+\/zjgsjw)/);
    if (match) return match[1];
    return window.location.origin + "/zjgsjw";
}

/**
 * Base64 编码 (用于生成请求参数)
 */
function encodeParams(xn, xq) {
    const rawStr = `xn=${xn}&xq=${xq}`;
    return btoa(rawStr);
}

/**
 * 深度解析周数字符串 (支持 1-16, 1-8单, 9-17双, 1,3,5 等格式)
 */
function parseWeeks(weekStr) {
    const weeks = [];
    const groups = String(weekStr).split(/[,，]/);
    groups.forEach(group => {
        const isSingle = group.includes("单");
        const isDouble = group.includes("双");
        const rangeMatch = group.match(/(\d+)-(\d+)/);

        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let i = start; i <= end; i++) {
                if (isSingle && i % 2 === 0) continue;
                if (isDouble && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            const num = parseInt(group.replace(/[^\d]/g, ""));
            if (!isNaN(num) && num > 0) {
                if (isSingle && num % 2 === 0) return;
                if (isDouble && num % 2 !== 0) return;
                weeks.push(num);
            }
        }
    });
    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

/**
 * 青果标准 HTML 数据解析函数
 */
function parseAndMergeKingosoftData(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const rawItems = [];
    const table = doc.getElementById("mytable") || doc.querySelector("table.table");

    if (!table) return [];

    // 动态确定星期列数 (一般为 7 列 或 5 列)
    let totalDays = 7;
    for (const tr of Array.from(table.rows)) {
        const texts = Array.from(tr.cells).map(c => c.textContent.trim());
        const hasMon = texts.some(t => t.includes("一") || t.includes("周一") || t.includes("星期一"));
        const hasSun = texts.some(t => t.includes("日") || t.includes("周日") || t.includes("星期日"));
        const hasSat = texts.some(t => t.includes("六") || t.includes("周六") || t.includes("星期六"));
        const hasFri = texts.some(t => t.includes("五") || t.includes("周五") || t.includes("星期五"));
        if (hasMon && (hasSun || hasSat)) {
            totalDays = 7;
            break;
        } else if (hasMon && hasFri) {
            totalDays = 5;
            break;
        }
    }

    const rows = Array.from(table.rows);
    rows.forEach(row => {
        const cells = Array.from(row.cells);
        if (cells.length < totalDays) return;

        cells.forEach((cell, colIndex) => {
            const distanceToLast = cells.length - 1 - colIndex;
            if (distanceToLast >= totalDays) return;
            const day = totalDays - distanceToLast;

            let courseDivs = Array.from(cell.querySelectorAll("div[style*='padding-bottom']"));
            if (courseDivs.length === 0) {
                const allDivs = Array.from(cell.querySelectorAll("div"));
                courseDivs = allDivs.filter(d => /\[\d+.*\]/.test(d.textContent));
            }
            if (courseDivs.length === 0 && /\[\d+.*\]/.test(cell.textContent)) {
                courseDivs = [cell];
            }

            courseDivs.forEach(div => {
                let lines = Array.from(div.childNodes)
                    .map(n => n.textContent.trim())
                    .filter(t => t.length > 0);
                if (lines.length === 1 && lines[0].includes("\n")) {
                    lines = lines[0].split(/\n+/).map(t => t.trim()).filter(t => t.length > 0);
                }

                const timeIndex = lines.findIndex(l => /(.*)\[(.*)\]/.test(l));
                if (timeIndex !== -1) {
                    const timeMatch = lines[timeIndex].match(/(.*)\[(.*)\]/);
                    if (timeMatch) {
                        const weeks = parseWeeks(timeMatch[1]);
                        const sectionStr = timeMatch[2].replace(/[^\d\-]/g, "");
                        const sections = sectionStr.split("-").map(Number).filter(n => !isNaN(n));

                        if (weeks.length > 0 && sections.length > 0) {
                            const name = lines[0] || "未知课程";
                            const teacher = timeIndex > 1 ? lines[1] : "";
                            const position = lines.slice(timeIndex + 1).join(" ") || "未知地点";

                            rawItems.push({
                                name,
                                teacher,
                                position,
                                day,
                                startSection: sections[0],
                                endSection: sections[sections.length - 1],
                                weeks
                            });
                        }
                    }
                }
            });
        });
    });

    const groupMap = new Map();
    rawItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(item);
    });

    const finalCourses = [];
    groupMap.forEach((items, key) => {
        const matrix = {};
        items.forEach(item => {
            item.weeks.forEach(w => {
                if (!matrix[w]) matrix[w] = new Set();
                for (let s = item.startSection; s <= item.endSection; s++) matrix[w].add(s);
            });
        });

        const patternMap = new Map();
        Object.keys(matrix).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(matrix[week]).sort((a, b) => a - b);
            let start = sections[0];
            for (let i = 0; i < sections.length; i++) {
                if (i === sections.length - 1 || sections[i + 1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, []);
                    patternMap.get(pKey).push(week);
                    if (i < sections.length - 1) start = sections[i + 1];
                }
            }
        });

        const [name, teacher, position, day] = key.split("|");
        patternMap.forEach((weeks, pKey) => {
            const [sStart, sEnd] = pKey.split("-").map(Number);
            finalCourses.push({
                name,
                teacher,
                position,
                day: parseInt(day),
                startSection: sStart,
                endSection: sEnd,
                weeks: weeks.sort((a, b) => a - b)
            });
        });
    });

    return finalCourses;
}

/**
 * 课程合并与去重处理
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || "",
        teacher: c.teacher || "",
        position: c.position || "",
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(",").localeCompare(b.weeks.join(",")) ||
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
            current.weeks.join(",") === next.weeks.join(",");

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
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
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 异步请求学期列表
 */
async function getYearAndSemester(baseUrl) {
    try {
        window.shiguangBridge.showToast("正在获取学期列表...");
        const response = await fetch(`${baseUrl}/frame/droplist/getDropLists.action`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: "comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0",
            credentials: "include"
        });
        const list = await response.json();
        const names = list.map(item => item.name);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), 0);
        if (selectedIndex === null) return null;
        const [xn, xq] = list[selectedIndex].code.split("-");
        return { xn, xq };
    } catch (error) {
        window.shiguangBridge.showToast("获取学期列表失败: " + error.message);
        return null;
    }
}

/**
 * 课表后台数据抓取
 */
async function fetchCourses(baseUrl, xn, xq) {
    try {
        const paramsBase64 = encodeParams(xn, xq);
        const url = `${baseUrl}/student/wsxk.xskcb10319.jsp?params=${paramsBase64}`;
        window.shiguangBridge.showToast("正在提取课表数据...");
        const response = await fetch(url, { method: "GET", credentials: "include" });
        const arrayBuffer = await response.arrayBuffer();
        const htmlText = new TextDecoder("gbk").decode(arrayBuffer);
        return parseAndMergeKingosoftData(htmlText);
    } catch (error) {
        window.shiguangBridge.showToast("抓取课表失败: " + error.message);
        return null;
    }
}

/**
 * 获取第一周周一开学日期
 */
async function fetchSemesterStartDate(baseUrl, xn, xq) {
    try {
        window.shiguangBridge.showToast("正在获取开学日期...");
        const url = `${baseUrl}/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=1`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "x-requested-with": "XMLHttpRequest" },
            credentials: "include"
        });

        const arrayBuffer = await response.arrayBuffer();
        const htmlText = new TextDecoder("gbk").decode(arrayBuffer);

        const match = htmlText.match(/<br\s*\/?>\s*(\d{2})-(\d{2})/);
        if (match) {
            const month = match[1];
            const day = match[2];
            const year = xq === "1" ? String(parseInt(xn) + 1) : xn;
            return `${year}-${month}-${day}`;
        }
        return null;
    } catch (error) {
        console.warn("获取开学日期失败:", error);
        return null;
    }
}

/**
 * 日期格式校验
 */
function validateDateInput(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return false;
    }
    return "请输入正确格式的日期，如 2026-09-07";
}

/**
 * 浙江工商职业技术学院 12 节课标准作息时间表
 */
async function importPresetTimeSlots() {
    const slots = [
        { number: 1, startTime: "08:30", endTime: "09:15" },
        { number: 2, startTime: "09:20", endTime: "10:05" },
        { number: 3, startTime: "10:20", endTime: "11:05" },
        { number: 4, startTime: "11:10", endTime: "11:55" },
        { number: 5, startTime: "13:10", endTime: "13:55" },
        { number: 6, startTime: "14:00", endTime: "14:45" },
        { number: 7, startTime: "15:00", endTime: "15:45" },
        { number: 8, startTime: "15:50", endTime: "16:35" },
        { number: 9, startTime: "16:40", endTime: "17:25" },
        { number: 10, startTime: "18:20", endTime: "19:05" },
        { number: 11, startTime: "19:10", endTime: "19:55" },
        { number: 12, startTime: "20:00", endTime: "20:45" }
    ];
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)).catch(() => {});
}

/**
 * 主导入流程
 */
async function runImportFlow() {
    try {
        const currentUrl = window.location.href;

        // 1. 检查是否在教务管理页面环境中
        if (!currentUrl.includes("zjgsjw")) {
            await window.shiguangBridgePromise.showAlert(
                "教务导入指引",
                "请先在 WebVPN 中点击进入「教务管理」，登录进入系统后再点击执行导入",
                "我知道了"
            );
            return;
        }

        window.shiguangBridge.showToast("已连接教务管理，正在获取学期信息...");

        const baseUrl = getJwBaseUrl();

        // 2. 选择学年学期
        const termParams = await getYearAndSemester(baseUrl);
        if (!termParams) return;

        // 3. 获取并解析课程数据
        const rawCourses = await fetchCourses(baseUrl, termParams.xn, termParams.xq);
        if (!rawCourses || rawCourses.length === 0) {
            window.shiguangBridge.showToast("未找到有效课程数据，请确认所选学期是否有课");
            return;
        }

        // 4. 合并去重
        const finalCourses = mergeAndDistinctCourses(rawCourses);

        // 5. 自动获取开学日期并让用户确认
        const autoStartDate = await fetchSemesterStartDate(baseUrl, termParams.xn, termParams.xq);
        const confirmedDate = await window.shiguangBridgePromise.showPrompt(
            "确认开学日期",
            "请确认本学期第一周周一的日期（格式 YYYY-MM-DD）：",
            autoStartDate || "",
            "validateDateInput"
        );
        if (confirmedDate === null) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        // 6. 推导学期总周数并保存配置
        let maxWeek = 0;
        finalCourses.forEach(c => {
            c.weeks.forEach(w => {
                if (w > maxWeek) maxWeek = w;
            });
        });

        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: confirmedDate,
            semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        })).catch(() => {});

        // 7. 保存课程数据与作息时间
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        await importPresetTimeSlots();

        window.shiguangBridge.showToast(`导入成功：共 ${finalCourses.length} 门课程`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("导入异常: " + error.message);
        console.error("ZJBTI Import Flow Error:", error);
    }
}

runImportFlow();
