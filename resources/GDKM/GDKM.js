//https://jw.gdkm.edu.cn/jsxsd/xskb/xskb_list.do
// 广东科贸职业学院(gdkm.edu.cn) 拾光课程表适配脚本
// 参考南昌航空大学科技学院(stcnchu.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 工具函数

window.validateYearInput = function (input) {
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

async function saveAppConfig(semesterStartDate, semesterTotalWeeks) {
    const config = { "semesterTotalWeeks": semesterTotalWeeks, "firstDayOfWeek": 1, "semesterStartDate": semesterStartDate };
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

//拿开学日期
function getSchoolStartDate(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // 找到第1周那一行
    const rows = doc.querySelectorAll('tr.qz-weeklyTable-tr');
    let firstWeekRow = null;
    for (const row of rows) {
        const label = row.querySelector('.qz-weeklyTable-label .td-cell');
        if (label && label.textContent.trim() === '第1周') {
            firstWeekRow = row;
            break;
        }
    }
    if (!firstWeekRow) throw new Error('未找到第1周的数据');

    // 取日期单元格：cells[0]=星期一，cells[5]=星期六
    const cells = firstWeekRow.querySelectorAll('td.qz-weeklyTable-normalDay');
    const mondayText = cells[0].textContent.trim();   // 例如 "31"
    const saturdayText = cells[5].textContent.trim(); // 例如 "09月05日"

    // 从星期六的文本里提取月份和日号
    const satMatch = saturdayText.match(/(\d{1,2})月(\d{1,2})日/);
    if (!satMatch) throw new Error('无法从周末日期中解析出月日');
    const month = parseInt(satMatch[1], 10);
    const satDay = parseInt(satMatch[2], 10);

    // 星期一那格可能只有日号，也可能带“月日”
    let day;
    const dayMatch = mondayText.match(/(\d{1,2})日/);
    day = dayMatch ? parseInt(dayMatch[1], 10) : parseInt(mondayText, 10);
    if (isNaN(day)) throw new Error('无法解析星期一的日期');

    // 取学年起始年（如 "2026-2027-1" → 2026）
    let year = new Date().getFullYear();
    const yearSelect = doc.querySelector('#xnxq01id');
    if (yearSelect) {
        const selected = yearSelect.querySelector('option[selected]');
        const value = selected ? selected.value : yearSelect.options[0].value;
        year = parseInt(value.split('-')[0], 10);
    }

    // 跨月修正：若周一日期数字 > 周六日期数字，说明周一在上一个月
    let finalMonth = month;
    let finalDay = day;
    if (day > satDay) {
        finalMonth = month - 1;
        if (finalMonth === 0) finalMonth = 12;
    }

    // 格式化为 YYYY-MM-DD
    const mm = String(finalMonth).padStart(2, '0');
    const dd = String(finalDay).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

//拿总周数
function getTotalWeeks(htmlText) {
    if (!htmlText || typeof htmlText !== 'string') return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // 优先用 .qz-weeklyTable-label 精确匹配
    const labels = doc.querySelectorAll('.qz-weeklyTable-label .td-cell');
    let maxWeek = 0;

    labels.forEach(el => {
        const text = el.textContent.trim();
        const match = text.match(/^第\s*(\d+)\s*周$/);
        if (match) {
            const n = parseInt(match[1], 10);
            if (n > maxWeek) maxWeek = n;
        }
    });

    // 如果精确选择器没找到，退回全表扫描
    if (maxWeek === 0) {
        const allText = doc.body ? doc.body.innerText : '';
        const re = /第\s*(\d+)\s*周/g;
        let m;
        while ((m = re.exec(allText)) !== null) {
            const n = parseInt(m[1], 10);
            if (n > maxWeek) maxWeek = n;
        }
    }

    // 解析失败返回 null，成功返回最大周数
    return maxWeek > 0 ? maxWeek : null;
}

// 拿学年

function getAcademicYearInfo(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    const results = [];

    // 从下拉框取所有选项
    const select = doc.querySelector('#xnxq01id');
    if (select) {
        const options = select.querySelectorAll('option');
        options.forEach(opt => {
            const value = (opt.value || '').trim(); // 例如 "2026-2027-1"
            if (!value) return;

            // 只做格式校验：起始年-结束年-学期
            if (/^\d{4}-\d{4}-\d+$/.test(value)) {
                results.push(value);
            }
        });
    }
    return results.length > 0 ? results : null;
}

window.isYMD = function (str) {
    // 1. 格式匹配：4位-2位-2位
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return "开始日期格式错误了喵~。请再次输入喵~";

    // 2. 校验是否是真实存在的日期（防止 2024-02-30）
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    if (!(date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d)) {
        return "开始日期格式错误了喵~。请再次输入喵~"
    }
    return false
}

window.isAcademicYear = function (str) {
    if (typeof str !== 'string') {
        return "请输入学年学期喵~（例如 2025-2026-1）";
    }

    // 1. 格式匹配：4位-4位-1到2位
    if (!/^\d{4}-\d{4}-\d{1,2}$/.test(str.trim())) {
        return "学年学期格式错误喵~。正确格式为:2025-2026-1";
    }

    const parts = str.trim().split('-');
    const startYear = parseInt(parts[0], 10);
    const endYear = parseInt(parts[1], 10);
    const semester = parseInt(parts[2], 10);

    // 2. 结束学年必须比起始学年大 1
    if (endYear !== startYear + 1) {
        return "结束学年必须是起始学年的下一年喵~（例如 2025-2026）";
    }

    // 3. 学期只能是 1 或 2（如学校有小学期可自行放宽）
    if (semester !== 1 && semester !== 2) {
        return "学期只能是 1 或 2 喵~";
    }

    return false;
};

// ================= 流程编排 =================

window.semesterTotalWeeksInput = function (str) {
    return /^-?\d+$/.test(str) ? false : "请输入周数喵~只要数字喵~"
}

async function runImportFlow() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert("提示喵~", "请确保已成功登录教务系统喵~。是否开始导入？", "开始");
        if (!confirmed) return;

        const response_calendar = await fetch("https://jw.gdkm.edu.cn/jsxsd/jxzl/jxzl_query", {
            "headers": {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "accept-language": "zh-CN,zh;q=0.9",
                "priority": "u=0, i",
                "upgrade-insecure-requests": "1"
            },
            "body": null,
            "method": "GET",
            "mode": "cors",
            "credentials": "include"
        })
        const html_calendar = await response_calendar.text();


        /*
        // 1. 获取就读校区
        const campusIndex = await window.shiguangBridgePromise.showSingleSelection("选择所在校区喵~", JSON.stringify(["清远校区", "广州白云校区","广州天河校区"]), -1);
        if (campusIndex === null) return;

        */
        // 2. 获取学年
        var semesterId_array = getAcademicYearInfo(html_calendar)
        var semesterId_index = await window.shiguangBridgePromise.showSingleSelection("选择学年学期喵~", JSON.stringify(semesterId_array), 0);
        var semesterId = semesterId_array[semesterId_index]
        if (!semesterId) return;




        var semesterStartDate = getSchoolStartDate(html_calendar);

        if (window.isYMD(semesterStartDate)) {
            semesterStartDate = await window.shiguangBridgePromise.showPrompt("选择开始日期喵~" + "errror " + semesterStartDate + window.isYMD(semesterStartDate), "请输入要导入课程的开始日期喵~ 格式为:YYYY-MM-DD,例如1145-01-04", "", "isYMD");
        }
        if (!semesterStartDate) return;

        var semesterTotalWeeks = getTotalWeeks(html_calendar)

        if (window.semesterTotalWeeksInput(semesterTotalWeeks)) {
            semesterTotalWeeks = await window.shiguangBridgePromise.showPrompt("选择周数喵~" + "errror " + semesterTotalWeeks + window.semesterTotalWeeksInput(semesterStartDate), "请输入要导入课程的周数喵~（例如 20):", "", "semesterTotalWeeksInput");
        }

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
        await saveAppConfig(semesterStartDate, parseInt(semesterTotalWeeks));
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
