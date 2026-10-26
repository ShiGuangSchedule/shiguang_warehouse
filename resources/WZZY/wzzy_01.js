// 梧州职业学院(wzzy.edu.cn)拾光适配代码
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

/**
 * 基础工具函数：Base64 编码
 */
function encodeParams(xn, xq) {
    const rawStr = `xn=${xn}&xq=${xq}`;
    return btoa(rawStr);
}


/**
 * 深度解析周数字符串 (支持 1-16, 1-8单, 9-17双, 1,3,5等格式)
 */
function parseWeeks(weekStr) {
    const weeks = [];
    const groups = weekStr.split(',');
    groups.forEach(group => {
        const isSingle = group.includes('单');
        const isDouble = group.includes('双');
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
            const num = parseInt(group.replace(/[^\d]/g, ''));
            if (!isNaN(num)) weeks.push(num);
        }
    });
    return Array.from(new Set(weeks)).sort((a, b) => a - b);
}

/**
 * 数据解析函数
 */
function parseAndMergeXmcuData(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const rawItems = [];
    const table = doc.getElementById('mytable');

    if (!table) return [];

    const rows = table.querySelectorAll('tr');
    rows.forEach((row) => {
        // 排除表头和特殊行，只处理包含课程内容的行
        const cells = row.querySelectorAll('td.td');
        if (cells.length === 0) return;

        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 对应 星期一 到 星期五
            // 找到所有包含课程信息的 div
            const courseDivs = cell.querySelectorAll('div[style*="padding-bottom:5px"]');
            
            courseDivs.forEach(div => {
                // 提取文本并过滤空行
                const lines = Array.from(div.childNodes)
                    .map(n => n.textContent.trim())
                    .filter(t => t.length > 0);

                if (lines.length >= 3) {
                    const name = lines[0];
                    const teacher = lines[1];
                    // 匹配格式：周数[节次] -> 例如 "1-8 单 [3-4]"
                    const timeMatch = lines[2].match(/(.*)\[(.*)\]/);
                    const position = lines[3] || "未知地点";

                    if (timeMatch) {
                        const weeks = parseWeeks(timeMatch[1]);
                        const sections = timeMatch[2].split('-').map(Number);
                        
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
                if (i === sections.length - 1 || sections[i+1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, []);
                    patternMap.get(pKey).push(week);
                    if (i < sections.length - 1) start = sections[i+1];
                }
            }
        });

        const [name, teacher, position, day] = key.split('|');
        patternMap.forEach((weeks, pKey) => {
            const [sStart, sEnd] = pKey.split('-').map(Number);
            finalCourses.push({
                name, teacher, position,
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
 * 节次与周次合并去重函数（供开发者参考）
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

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
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
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
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

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
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
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周)
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
 * 学期获取函数
 */
async function getYearAndSemester() {
    try {
        window.shiguangBridge.showToast("正在获取学期列表...");
        const response = await fetch("http://222.217.195.24:805/wzzyjw/frame/droplist/getDropLists.action", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: "comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0",
            credentials: "include"
        });
        const list = await response.json();
        const names = list.map(item => item.name);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), 0);
        if (selectedIndex === null) return null;
        const [xn, xq] = list[selectedIndex].code.split('-');
        return { xn, xq };
    } catch (error) {
        window.shiguangBridge.showToast("获取列表失败");
        return null;
    }
}

/**
 * 课表抓取函数
 */
async function fetchCourses(xn, xq) {
    try {
        const paramsBase64 = encodeParams(xn, xq);
        const url = `http://222.217.195.24:805/wzzyjw/student/wsxk.xskcb10319.jsp?params=${paramsBase64}`;
        window.shiguangBridge.showToast("正在提取数据...");
        const response = await fetch(url, { method: "GET", credentials: "include" });
        const arrayBuffer = await response.arrayBuffer();
        const htmlText = new TextDecoder('gbk').decode(arrayBuffer);
        return parseAndMergeXmcuData(htmlText);
    } catch (error) {
        window.shiguangBridge.showToast("抓取课表失败");
        return null;
    }
}

/**
 * 获取开学日期函数
 * 通过第一周课表 HTML 解析出第一周周一的日期
 * @param {String} xn 学年（如 "2026"）
 * @param {String} xq 学期码（"0"=第一学期/"1"=第二学期）
 * @returns {String|null} 格式 YYYY-MM-DD 的开学日期，失败返回 null
 */
async function fetchSemesterStartDate(xn, xq) {
    try {
        window.shiguangBridge.showToast("正在获取开学日期...");
        const url = `http://222.217.195.24:805/wzzyjw/frame/desk/showLessonScheduleInfosV14.action?xn=${xn}&xq=${xq}&jxz=1`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "x-requested-with": "XMLHttpRequest" },
            credentials: "include"
        });

        const arrayBuffer = await response.arrayBuffer();
        const htmlText = new TextDecoder('gbk').decode(arrayBuffer);

        const match = htmlText.match(/<br\s*\/?>\s*(\d{2})-(\d{2})/);
        if (match) {
            const month = match[1];
            const day = match[2];
            const year = xq === "1" ? String(parseInt(xn) + 1) : xn;
            return `${year}-${month}-${day}`;
        }
        return null;
    } catch (error) {
        window.shiguangBridge.showToast("获取开学日期失败");
        return null;
    }
}

/**
 * 开学日期输入验证函数（供 showPrompt 调用）
 * 返回 false 表示验证通过，返回字符串表示错误信息
 */
function validateDateInput(input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return false; // 验证通过
    }
    return "请输入正确格式的日期，如 2026-03-09";
}

/**
 * 时间段导入函数
 */
async function importPresetTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:50", "endTime": "09:30" },
        { "number": 3, "startTime": "09:50", "endTime": "10:30" },
        { "number": 4, "startTime": "10:40", "endTime": "11:20" },
        { "number": 5, "startTime": "11:30", "endTime": "12:10" },
        { "number": 6, "startTime": "14:30", "endTime": "15:10" },
        { "number": 7, "startTime": "15:20", "endTime": "16:00" },
        { "number": 8, "startTime": "16:10", "endTime": "16:50" },
        { "number": 9, "startTime": "17:00", "endTime": "17:40" },
        { "number": 10, "startTime": "18:45", "endTime": "19:25" },
        { "number": 11, "startTime": "19:35", "endTime": "20:15" },
        { "number": 12, "startTime": "20:25", "endTime": "21:05" },
        { "number": 13, "startTime": "21:15", "endTime": "21:55" }
    ];
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)).catch(() => {});
}

/**
 * 最终流程控制
 */
async function runImportFlow() {
    // 弹窗确认
    const confirmed = await window.shiguangBridgePromise.showAlert("教务导入", "确认已经登录并进入教务系统", "确定");
    if (!confirmed) return;

    // 选择学期
    const params = await getYearAndSemester();
    if (!params) return;

    // 获取并解析数据
    const courses = await fetchCourses(params.xn, params.xq);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未找到有效课程");
        return;
    }

    // 合并去重
    const finalCourses = mergeAndDistinctCourses(courses);

    // 获取开学日期并让用户确认
    const startDate = await fetchSemesterStartDate(params.xn, params.xq);
    const confirmedDate = await window.shiguangBridgePromise.showPrompt(
        "确认开学日期",
        "请确认本学期第一周周一的日期（格式 YYYY-MM-DD）：",
        startDate || "",
        "validateDateInput"
    );
    if (confirmedDate === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    // 保存课表配置
    // 从课程周次中推算本学期总周数（取所有课程 weeks 的最大值）
    let maxWeek = 0;
    finalCourses.forEach(c => {
        c.weeks.forEach(w => { if (w > maxWeek) maxWeek = w; });
    });

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterStartDate: confirmedDate,
        semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,
        defaultClassDuration: 40,
        defaultBreakDuration: 10
    })).catch(() => {});

    // 存储
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
    await importPresetTimeSlots();

    // 完成
    window.shiguangBridge.showToast(`导入成功：共 ${finalCourses.length} 门课程`);
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动
runImportFlow();