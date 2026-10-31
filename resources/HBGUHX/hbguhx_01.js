// 河北地质大学华信学院强智教务 (61.182.88.214:8090) 拾光课程表适配脚本
// 本校 25 届开发者适配，无法覆盖所有边界情况
// 出现问题请联系 4831884790@qq.com 或提交 pr，pr 更加快速

const BASE_URL = "http://61.182.88.214:8090";

/**
 * 带错误检查的 fetch，返回响应文本
 */
async function fetchText(url, options = {}) {
    const response = await fetch(url, { credentials: "include", ...options });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.text();
}

/**
 * 解析周次字符串为数组
 * 支持 "1-17"、"1-17(周)"、"(单周)"/"(双周)" 标记（按段生效）、中英文逗号与顿号分隔
 */
function parseWeeks(weekStr) {
    const weeks = [];
    if (!weekStr) return weeks;

    // 移除节次信息（防御性），保留周次段
    const pureWeekData = weekStr.replace(/\[.*?节\]/g, '').trim();
    if (!pureWeekData) return weeks;

    // 分割并处理每个段
    const segments = pureWeekData.split(/[,，、]/);
    segments.forEach(seg => {
        seg = seg.trim();
        if (!seg) return;

        // 检测本段的单双周标记（如 "1-17(单周)"、"6(双)"），需在剥离标记前记录
        const onlyOdd = /单/.test(seg);
        const onlyEven = /双/.test(seg);
        seg = seg.replace(/单|双|周|\(.*?\)/g, '').trim();
        if (!seg) return;

        if (seg.includes('-')) {
            const [start, end] = seg.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) {
                    if (onlyOdd && i % 2 === 0) continue;
                    if (onlyEven && i % 2 === 1) continue;
                    weeks.push(i);
                }
            }
        } else {
            const w = parseInt(seg, 10);
            if (!isNaN(w)) {
                if (onlyOdd && w % 2 === 0) return;
                if (onlyEven && w % 2 === 1) return;
                weeks.push(w);
            }
        }
    });

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 合并连续节次的相同课程
 */
function mergeAndDistinctCourses(courses) {
    if (courses.length <= 1) return courses;

    // 排序以便合并
    courses.sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        if (a.teacher !== b.teacher) return a.teacher.localeCompare(b.teacher);
        if (a.position !== b.position) return a.position.localeCompare(b.position);
        return a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const merged = [];
    let current = courses[0];

    for (let i = 1; i < courses.length; i++) {
        const next = courses[i];

        // 判断是否为同一门课程
        const isSameCourse =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        // 判断节次是否连续
        const isContinuous = (current.endSection + 1 === next.startSection);

        if (isSameCourse && isContinuous) {
            // 合并连续节次
            current.endSection = next.endSection;
        } else if (!(isSameCourse && current.startSection === next.startSection && current.endSection === next.endSection)) {
            // 完全重复的条目直接丢弃，其余推入结果
            merged.push(current);
            current = next;
        }
    }
    merged.push(current);
    return merged;
}

/**
 * 从课程块中提取周次和节次
 * 匹配 "1-17(周)[01-02节]" / "1-17(周)[01-02 节]" 格式，空格均可选
 */
function extractWeekAndSection(weekFull) {
    const match = weekFull.match(/(.+?)\(周\)\s*\[\s*(\d+)-(\d+)\s*节\s*\]/);
    if (match) {
        return {
            weekStr: match[1],
            startSection: parseInt(match[2], 10),
            endSection: parseInt(match[3], 10)
        };
    }
    // 兜底：只匹配周次范围，节次按 1-2 节假设
    const altMatch = weekFull.match(/(\d+)-(\d+)/);
    if (altMatch) {
        return {
            weekStr: altMatch[0],
            startSection: 1,
            endSection: 2
        };
    }
    return null;
}

/**
 * 将 HTML 源码解析为课程模型
 */
function parseTimetableToModel(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) {
        return [];
    }

    const rawCourses = [];
    // 行 = 大节，列 = 星期；只处理含 td 的行（跳过表头），备注/中午行会因缺少周次标记被自然过滤
    const rows = Array.from(timetable.querySelectorAll('tr')).filter(r => r.querySelector('td'));

    rows.forEach((row) => {
        const cells = row.querySelectorAll('td');

        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1; // 星期几（1-7）

            // 获取所有课程详情 div，包括所有状态的
            const detailDivs = Array.from(cell.querySelectorAll('div.kbcontent'));

            detailDivs.forEach((detailDiv) => {
                const rawHtml = detailDiv.innerHTML.trim();
                const innerText = detailDiv.innerText.trim();

                if (!rawHtml || rawHtml === "&nbsp;" || innerText.length < 2) return;

                // 分割同一个格子内的多门课程（10 个以上连字符即为分隔线）
                const blocks = rawHtml.split(/-{10,}/);

                blocks.forEach((block) => {
                    if (!block.trim()) return;

                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    // 1. 提取课程名（跳过开头的空行，处理 <br> 开头的分隔块）
                    // 注意：innerHTML 中的 &nbsp; 等实体不会自动解码，需手动处理
                    let name = "";
                    const htmlLines = tempDiv.innerHTML.split('<br>');
                    for (const line of htmlLines) {
                        const text = line
                            .replace(/<[^>]*>/g, '')
                            .replace(/&nbsp;/gi, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (text) {
                            name = text;
                            break;
                        }
                    }

                    if (!name) return;

                    // 2. 提取周次和节次信息
                    const weekFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    const weekFull = weekFont?.innerText || "";
                    const weekSection = extractWeekAndSection(weekFull);
                    if (!weekSection) return;

                    // 3. 提取教师信息
                    const teacher = tempDiv.querySelector('font[title="老师"]')?.innerText.trim() || "未知教师";

                    // 4. 提取教室地点
                    const position = tempDiv.querySelector('font[title="教室"]')?.innerText.trim() || "未知地点";

                    rawCourses.push({
                        "name": name,
                        "teacher": teacher,
                        "weeks": parseWeeks(weekSection.weekStr),
                        "position": position,
                        "day": day,
                        "startSection": weekSection.startSection,
                        "endSection": weekSection.endSection
                    });
                });
            });
        });
    });

    return mergeAndDistinctCourses(rawCourses);
}

/**
 * 从网页中提取学期选项列表
 */
function extractSemesterOptions(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const semesterSelect = doc.getElementById('xnxq01id');
    if (!semesterSelect) {
        return [];
    }

    return Array.from(semesterSelect.querySelectorAll('option'))
        .filter(opt => opt.value)
        .map(opt => ({
            value: opt.value,
            text: opt.text
        }));
}

/**
 * 时间字符串加分钟数，"08:30" + 45 → "09:15"
 */
function addMinutes(hhmm, minutes) {
    const parts = hhmm.split(':').map(Number);
    const total = parts[0] * 60 + parts[1] + minutes;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 从网页中提取作息时间
 * 课表页 #kbtable 中每个大节行头 th 形如 "第一大节\n08:30-10:05"
 * 拆分规则：第 1 小节 = 开始 ~ 开始+45 分钟；第 2 小节 = 开始+55 分钟 ~ 大节结束
 */
function extractTimeSlots(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return null;

    const timeSlots = [];
    const rows = Array.from(timetable.querySelectorAll('tr'));

    rows.forEach((row) => {
        const th = row.querySelector('th');
        if (!th) return;

        // 提取时间范围，如 "08:30-10:05"
        const timeText = th.innerText.trim();
        const timeMatch = timeText.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
        if (!timeMatch) return;

        const startTime = timeMatch[1];
        const endTime = timeMatch[2];

        // 判断是否是有效的时间段（排除"中午"等）
        const sectionName = timeText.split('\n')[0].trim();
        if (sectionName === '中午') return;

        // 为每个大节创建两个小节（时间加法，勿用分钟硬替换）
        timeSlots.push(
            {
                number: timeSlots.length + 1,
                startTime: startTime,
                endTime: addMinutes(startTime, 45)
            },
            {
                number: timeSlots.length + 2,
                startTime: addMinutes(startTime, 55),
                endTime: endTime
            }
        );
    });

    return timeSlots.length > 0 ? timeSlots : null;
}

/**
 * 根据学期字符串估算学期第一周周一日期
 * 学期格式如 "2025-2026-2"
 * 春季学期：3月第二个周一，秋季学期：9月1日所在周的周一
 * 仅作兜底，优先使用教学周历解析出的真实日期
 */
function getSemesterStartMonday(semesterId) {
    if (!semesterId) return null;
    const parts = semesterId.split('-');
    if (parts.length < 3) return null;
    const year1 = parseInt(parts[0], 10);
    const year2 = parseInt(parts[1], 10);
    const semester = parseInt(parts[2], 10);
    if (isNaN(year1) || isNaN(year2) || isNaN(semester)) return null;

    // 估算学期开始日期
    let startDate;
    if (semester === 1) {
        startDate = new Date(year1, 8, 1); // 秋季学期：约9月1日
    } else {
        // 春季学期：3月第二个周一
        const march1Day = new Date(year2, 2, 1).getDay();
        const firstMondayDate = march1Day === 1 ? 1 : march1Day === 0 ? 2 : 9 - march1Day;
        startDate = new Date(year2, 2, firstMondayDate + 7); // 第二个周一
    }

    // 找到学期开始日期所在周的周一
    const startDay = startDate.getDay(); // 0=周日
    const monday = new Date(startDate);
    monday.setDate(startDate.getDate() + (startDay === 0 ? -6 : 1 - startDay));
    return monday;
}

/**
 * 从教学周历页面 HTML 中解析第一周周一的日期
 * 表格结构：<tr height='28'><td>1</td><td title='2026年08月31'>31</td>...
 * 第 1 个 td 为周次，第 2 个 td 为星期一，title 为完整日期
 */
function extractWeekCalendarStartDate(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, "text/html");
    const timetable = doc.getElementById('kbtable');
    if (!timetable) return null;

    const rows = Array.from(timetable.querySelectorAll('tr'));
    for (const row of rows) {
        const tds = row.querySelectorAll('td');
        if (tds.length < 2) continue;
        if (tds[0].innerText.trim() !== '1') continue; // 只看第 1 周

        const title = tds[1].getAttribute('title') || '';
        const match = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
        if (match) {
            const date = new Date(
                parseInt(match[1], 10),
                parseInt(match[2], 10) - 1,
                parseInt(match[3], 10)
            );
            if (!isNaN(date.getTime())) return date;
        }
        return null; // 找到第 1 周行但解析失败，不再继续扫
    }
    return null;
}

/**
 * 请求教学周历页面，获取准确的学期第一周周一日期
 * 失败时返回 null，由调用方回退到估算
 */
async function fetchSemesterStartMonday(semesterId) {
    try {
        // 注意：必须使用完整 URL 或前导 "/"，否则相对路径会被教务框架错误拼接
        const html = await fetchText(`${BASE_URL}/jsxsd/jxzl/jxzl_query`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `xnxq01id=${encodeURIComponent(semesterId)}`
        });
        return extractWeekCalendarStartDate(html);
    } catch (error) {
        console.error('获取教学周历失败，将回退到估算学期起点：', error);
        return null;
    }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 根据学期字符串计算当前周数
 * 优先使用从教学周历解析到的真实起始日期，否则回退到估算
 */
function calculateCurrentWeek(semesterId, startMondayOverride) {
    const monday = startMondayOverride || getSemesterStartMonday(semesterId);
    if (!monday) return 1;

    const now = new Date();
    const diffMs = now.getTime() - monday.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * 显示欢迎提示
 */
async function showWelcomeAlert() {
    return await window.shiguangBridgePromise.showAlert(
        "导入提示",
        "请先进入学期理论课表页面，首页周课表无法导入",
        "开始导入"
    );
}

/**
 * 获取用户选择的学期参数
 */
async function getSemesterParamsFromUser(semesterOptions) {
    if (!semesterOptions || semesterOptions.length === 0) {
        window.shiguangBridge.showToast("未获取到学期列表");
        return null;
    }

    // 直接显示所有学期选项，让用户一次性选择
    const semesterLabels = semesterOptions.map(opt => opt.text);

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterLabels),
        0 // 默认选择第一个（最新学期）
    );

    if (semesterIndex == null) return null; // 兼容 null / undefined（用户取消）

    return semesterOptions[semesterIndex].value;
}

/**
 * 请求课表页面 HTML
 */
async function fetchCourseHtml() {
    // 浏览器禁止通过 fetch 设置 User-Agent，无需伪装请求头，Cookie 跟随即可
    return fetchText(`${BASE_URL}/jsxsd/xskb/xskb_list.do`);
}

/**
 * 根据选择的学期请求课表页面 HTML
 */
async function fetchCourseHtmlBySemester(semesterId) {
    return fetchText(`${BASE_URL}/jsxsd/xskb/xskb_list.do`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `cj0701id=&zc=&demo=&xnxq01id=${encodeURIComponent(semesterId)}`
    });
}

/**
 * 保存课程数据到 App
 */
async function saveCourseDataToApp(courses, timeSlots, semesterId, startMondayOverride) {
    // 计算学期开始日期和当前周数（优先使用教学周历解析出的真实日期）
    const startMonday = startMondayOverride || getSemesterStartMonday(semesterId);
    const currentWeek = calculateCurrentWeek(semesterId, startMondayOverride);

    // 学期总周数：从课程数据中的最大周次推导，最小 20 周
    const maxCourseWeek = courses.reduce((max, c) => Math.max(max, ...(c.weeks || [])), 0);

    // 保存学期配置
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        "semesterStartDate": startMonday ? formatDate(startMonday) : null,
        "currentWeek": currentWeek,
        "semesterTotalWeeks": Math.max(20, maxCourseWeek),
        "firstDayOfWeek": 1
    }));

    // 保存作息时间（从网页提取）
    if (timeSlots && timeSlots.length > 0) {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    }

    // 保存课程数据
    return await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
}

/**
 * 主流程控制
 */
async function runImportFlow() {
    try {
        // 1. 显示欢迎提示
        const start = await showWelcomeAlert();
        if (!start) return;

        // 2. 获取课表 HTML（包含学期选项和作息时间）
        const html = await fetchCourseHtml();

        // 3. 从网页中提取学期选项
        const semesterOptions = extractSemesterOptions(html);

        // 4. 从网页中提取作息时间，失败则回退到内置默认值（按本校实际作息）
        const timeSlots = extractTimeSlots(html) || [
            { number: 1, startTime: "08:30", endTime: "09:15" },
            { number: 2, startTime: "09:25", endTime: "10:05" },
            { number: 3, startTime: "10:15", endTime: "11:00" },
            { number: 4, startTime: "11:10", endTime: "11:50" },
            { number: 5, startTime: "14:30", endTime: "15:15" },
            { number: 6, startTime: "15:25", endTime: "16:05" },
            { number: 7, startTime: "16:15", endTime: "17:00" },
            { number: 8, startTime: "17:10", endTime: "17:50" },
            { number: 9, startTime: "19:00", endTime: "19:45" },
            { number: 10, startTime: "19:55", endTime: "20:40" }
        ];

        // 5. 让用户选择学期
        const semesterId = await getSemesterParamsFromUser(semesterOptions);
        if (!semesterId) return;

        // 6. 根据选择的学期重新请求课表数据
        const courseHtml = await fetchCourseHtmlBySemester(semesterId);

        // 7. 从教学周历获取准确的学期第一周周一日期（失败则自动回退到估算）
        const realStartMonday = await fetchSemesterStartMonday(semesterId);

        // 8. 解析课程数据
        const finalCourses = parseTimetableToModel(courseHtml);

        if (finalCourses.length === 0) {
            // 兜底：直接从初始页面解析，成功不额外提示，仅在失败时提示
            const initialCourses = parseTimetableToModel(html);
            if (initialCourses.length > 0) {
                await saveCourseDataToApp(initialCourses, timeSlots, semesterId, realStartMonday);
                window.shiguangBridge.notifyTaskCompletion();
            } else {
                window.shiguangBridge.showToast("未获取到课程，请确认已登录且所选学期有课");
            }
            return;
        }

        // 9. 保存课程数据
        await saveCourseDataToApp(finalCourses, timeSlots, semesterId, realStartMonday);

        const currentWeek = calculateCurrentWeek(semesterId, realStartMonday);
        window.shiguangBridge.showToast(`成功导入 ${finalCourses.length} 门课程（当前第 ${currentWeek} 周）`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error('导入异常：', error);
        window.shiguangBridge.showToast("导入异常：" + error.message);
    }
}

// 启动执行
runImportFlow();
