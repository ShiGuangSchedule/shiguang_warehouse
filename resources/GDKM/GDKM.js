//https://jw.gdkm.edu.cn/jsxsd/xskb/xskb_list.do
// 广东科贸职业学院(gdkm.edu.cn) 拾光课程表适配脚本
// 参考南昌航空大学科技学院(stcnchu.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 工具函数

window.validateYearInput = function(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字的学年喵~";
};

/**
 * 节次合并与去重
 */
function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;

    courses.sort((a, b) => {
        return a.name.localeCompare(b.name) || 
               a.day - b.day || 
               a.startSection - b.startSection || 
               a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const merged = [];
    let current = courses[0];

    for (let i = 1; i < courses.length; i++) {
        const next = courses[i];
        const isSameCourse = 
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;

        if (isSameCourse && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection) {
            continue;
        } else {
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

// 核心解析逻辑

function parseTimetableToModel(doc) {
    let timetable = doc.querySelector('table.qz-weeklyTable');
    if (!timetable) {
        const tables = Array.from(doc.querySelectorAll('table'));
        timetable = tables.sort((a, b) =>
            b.querySelectorAll('td').length - a.querySelectorAll('td').length
        )[0];
    }
    if (!timetable) return [];

    const rawCourses = [];
    const rows = Array.from(timetable.querySelectorAll('tbody tr'));

    // rowspan 占位表：key = 行下标，value = 该行被上方 rowspan 占用的列集合
    // 列号从 1 开始（1 = 周一）
    const occupied = {}; // { [rowIndex]: Set<col> }

    rows.forEach((row, rowIndex) => {
        const timeTd = row.querySelector('td[name="timeTd"]');
        const sectionText = timeTd ? timeTd.innerText : '';
        const rowSection = parseSectionFromLabel(sectionText);

        const courseTds = Array.from(row.querySelectorAll('td[name="kbDataTd"]'));

        // 本行被占用的列
        const occupiedCols = occupied[rowIndex] || new Set();

        let col = 1;          // 从第 1 列（周一）开始
        let tdIndex = 0;      // courseTds 的下标

        while (tdIndex < courseTds.length) {
            // 跳过被上方 rowspan 占用的列
            while (occupiedCols.has(col)) col++;

            const td = courseTds[tdIndex];
            const day = col;  // 这个 td 真正对应的星期几

            // 处理这个 td 里的课程
            const items = td.querySelectorAll('li.courselists-item');
            items.forEach(li => {
                const name = li.querySelector('.qz-hasCourse-title')?.innerText.trim() || '';
                if (!name) return;

                const abbr = li.querySelector('.qz-hasCourse-abbrinfo')?.innerText || '';
                const teacher = extractField(abbr, '老师') || '未知教师';
                const position = extractField(abbr, '地点') || '未知地点';
                const weekStr = extractField(abbr, '时间') || '';

                const parsed = parseSectionFromWeekStr(weekStr);
                const finalStart = parsed.startSection || rowSection.startSection;
                const finalEnd = parsed.endSection || rowSection.endSection;

                if (finalStart > 0) {
                    rawCourses.push({
                        name,
                        teacher,
                        weeks: parseWeeks(weekStr),
                        position,
                        day,
                        startSection: finalStart,
                        endSection: finalEnd
                    });
                }
            });

            // 看这个 td 有没有 rowspan
            const rowspan = parseInt(td.getAttribute('rowspan') || '1', 10);
            if (rowspan > 1) {
                // 它占用的列：接下来的 rowspan-1 行，这一列都不出现 td
                for (let r = rowIndex + 1; r < rowIndex + rowspan; r++) {
                    if (!occupied[r]) occupied[r] = new Set();
                    occupied[r].add(col);
                }
            }

            col++;
            tdIndex++;
        }
    });

    return mergeAndDistinctCourses(rawCourses);
}

//工具

// 从 "老师:张三;时间:3周[1-6节];地点:xxx" 里取某个字段
function extractField(text, key) {
    if (!text) return '';

    // 1. 找到 "老师:" 或 "老师：" 的位置
    let startIdx = -1;
    const colonVariants = [key + ':', key + '：'];
    for (let i = 0; i < colonVariants.length; i++) {
        startIdx = text.indexOf(colonVariants[i]);
        if (startIdx !== -1) {
            startIdx += colonVariants[i].length; // 跳过 key 和冒号
            break;
        }
    }
    if (startIdx === -1) return '';

    // 2. 从 startIdx 往后找第一个 ; 或 ；或换行
    let endIdx = text.length;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === ';' || ch === '；' || ch === '\n') {
            endIdx = i;
            break;
        }
    }

    return text.substring(startIdx, endIdx).trim();
}

// 从 "第一大节 (01、02小节)" 里取节次
function parseSectionFromLabel(text) {
    let startSection = 0, endSection = 0;
    if (!text) return { startSection, endSection };

    // 找 "(" 和 "小节"
    const openIdx = Math.max(text.indexOf('('), text.indexOf('（'));
    const closeIdx = text.indexOf('小节', openIdx);
    if (openIdx === -1 || closeIdx === -1) return { startSection, endSection };

    const inside = text.substring(openIdx + 1, closeIdx); // 例如 "01、02"
    // 用 、 或 , 切开
    const parts = inside.split(/[、,，]/);
    const nums = [];
    parts.forEach(p => {
        const n = parseInt(p.trim(), 10);
        if (!isNaN(n)) nums.push(n);
    });

    if (nums.length > 0) {
        startSection = nums[0];
        endSection = nums[nums.length - 1];
    }
    return { startSection, endSection };
}

// 从 "3周[1-6节]" 里取节次
function parseSectionFromWeekStr(weekStr) {
    let startSection = 0, endSection = 0;
    if (!weekStr) return { startSection, endSection };

    // 找 [ 和 节]
    const openIdx = weekStr.indexOf('[');
    const closeIdx = weekStr.indexOf('节]', openIdx);
    if (openIdx === -1 || closeIdx === -1) return { startSection, endSection };

    const inside = weekStr.substring(openIdx + 1, closeIdx); // 例如 "1-6" 或 "5-8"
    const dashIdx = inside.indexOf('-');
    if (dashIdx === -1) {
        // 只有一个数字
        const n = parseInt(inside.trim(), 10);
        if (!isNaN(n)) {
            startSection = n;
            endSection = n;
        }
    } else {
        const a = parseInt(inside.substring(0, dashIdx).trim(), 10);
        const b = parseInt(inside.substring(dashIdx + 1).trim(), 10);
        if (!isNaN(a)) startSection = a;
        if (!isNaN(b)) endSection = b;
    }
    return { startSection, endSection };
}

// 从 "3-4,9-18周" 里解析出所有周次
// 返回 [3,4,9,10,11,...,18] 这样的数组
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    // 1. 去掉 "周" 之后的内容，比如 "3-4,9-18周[1-2节]" -> "3-4,9-18"
    let endIdx = weekStr.indexOf('周');
    let core = endIdx === -1 ? weekStr : weekStr.substring(0, endIdx);

    // 2. 去掉 "[" 之前可能残留的东西（保险）
    const bracketIdx = core.indexOf('[');
    if (bracketIdx !== -1) core = core.substring(0, bracketIdx);

    const weeks = [];

    // 3. 按逗号切开，每段可能是 "3" 或 "9-18"
    const segments = core.split(/[,，]/);
    segments.forEach(seg => {
        seg = seg.trim();
        if (!seg) return;

        const dashIdx = seg.indexOf('-');
        if (dashIdx === -1) {
            // 单个周
            const n = parseInt(seg, 10);
            if (!isNaN(n)) weeks.push(n);
        } else {
            // 范围周
            const a = parseInt(seg.substring(0, dashIdx).trim(), 10);
            const b = parseInt(seg.substring(dashIdx + 1).trim(), 10);
            if (!isNaN(a) && !isNaN(b)) {
                for (let i = a; i <= b; i++) weeks.push(i);
            }
        }
    });

    // 4. 去重 + 排序
    const unique = [];
    weeks.forEach(w => {
        if (unique.indexOf(w) === -1) unique.push(w);
    });
    unique.sort((a, b) => a - b);

    return unique;
}

// 配置与流程

async function saveAppConfig(semesterStartDate,semesterTotalWeeks) {
    const config = { "semesterTotalWeeks": semesterTotalWeeks, "firstDayOfWeek": 1 ,"semesterStartDate" : semesterStartDate};
    return await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 返回作息
 */
async function saveAppTimeSlots() {
    const slots = [
            { "number": 1, "startTime": "08:30", "endTime": "09:10" },
            { "number": 2, "startTime": "09:20", "endTime": "10:00" },
            { "number": 3, "startTime": "10:20", "endTime": "11:00" },
            { "number": 4, "startTime": "11:10", "endTime": "11:50" },
            { "number": 5, "startTime": "14:00", "endTime": "14:40" },
            { "number": 6, "startTime": "14:50", "endTime": "15:20" },
            { "number": 7, "startTime": "15:30", "endTime": "16:10" },
            { "number": 8, "startTime": "16:20", "endTime": "16:50" },
            { "number": 9, "startTime": "18:30", "endTime": "19:10" },
            { "number": 10, "startTime": "19:20", "endTime": "19:50" },
            { "number": 11, "startTime": "20:00", "endTime": "20:40" },
            { "number": 12, "startTime": "20:50", "endTime": "21:20" },
    ]
    

    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}


window.isYMD = function(str) {
  // 1. 格式匹配：4位-2位-2位
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return "开始日期格式错误了喵~。请再次输入喵~";

  // 2. 校验是否是真实存在的日期（防止 2024-02-30）
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  if (! (date.getFullYear() === y && date.getMonth() === m - 1 &&date.getDate() === d)){
    return "开始日期格式错误了喵~。请再次输入喵~"
  } 
  return false
}

// ================= 流程编排 =================

window.semesterTotalWeeksInput = function(str){
    return /^-?\d+$/.test(str) ? false:"请输入周数喵~只要数字喵~"
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示喵~", "请确保已成功登录教务系统喵~。是否开始导入？", "开始");
        if (!confirmed) return;

        /*
        // 1. 获取就读校区
        const campusIndex = await window.shiguangBridgePromise.showSingleSelection("选择所在校区喵~", JSON.stringify(["清远校区", "广州白云校区","广州天河校区"]), -1);
        if (campusIndex === null) return;

        */
        // 2. 获取学年
        const year = await window.shiguangBridgePromise.showPrompt("选择学年喵~", "请输入要导入课程的起始学年喵~（例如 2025-2026 应输入2025):", "", "validateYearInput");
        if (!year) return;

        // 3. 获取学期并记录索引
        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection("选择学期喵~", JSON.stringify(["第一学期", "第二学期"]), -1);
        if (semesterIndex === null) return;
        const semesterId = `${year}-${parseInt(year) + 1}-${semesterIndex + 1}`;


        // 4. 获得学期开始日期
        const semesterStartDate = await window.shiguangBridgePromise.showPrompt("选择开始日期喵~", "请输入要导入课程的开始日期喵~ 格式为:YYYY-MM-DD,例如1145-01-04", "", "isYMD");

        // 2. 获取周数
        const semesterTotalWeeks = await window.shiguangBridgePromise.showPrompt("选择周数喵~", "请输入要导入课程的周数喵~（例如 20):", "", "semesterTotalWeeksInput");
        if (!semesterTotalWeeks) return;

        window.shiguangBridge.showToast("正在请求数据喵~");
        const url = `https://jw.gdkm.edu.cn/jsxsd/xskb/xskb_list.do?viweType=0&xnxq01id=${semesterId}&zc=`;
        const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
            "Referer": "https://jw.gdkm.edu.cn/jsxsd/"
        }
    });


        const html = await response.text();

        const finalCourses = parseTimetableToModel(new DOMParser().parseFromString(html, "text/html"));
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("未发现课程，请检查学期选择或登录状态喵~");
            return;
        }

        // 保存全局设置
        await saveAppConfig(semesterStartDate,parseInt(semesterTotalWeeks));
        // 传入作息
        await saveAppTimeSlots();
        // 保存课程
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程喵~`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("异常喵~ " + error.message);
    }
}

// 启动
runImportFlow();