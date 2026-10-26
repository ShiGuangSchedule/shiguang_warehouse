/**
 * 青岛农业大学综合教务管理系统(强智科技)
 * by ReGoMark, 2026.07.04
 * 
 */

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 解析周次字符串
 * 例如 "1-4,6,11-13" → [1, 2, 3, 4, 6, 11, 12, 13]
 */
function parseWeeks(weekStr) {
    let weeks = [];
    weekStr = weekStr.replace(/\(.*?\)/g, '').trim();
    let parts = weekStr.split(',');
    for (let part of parts) {
        part = part.trim();
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 解析行标题中的节次范围
 * 例如 "第1,2节" → { start: 1, end: 2 }
 *      "第5节"   → { start: 5, end: 5 }
 */
function parseSectionFromThHeader(thText) {
    let match = thText.match(/第([\d,]+)节/);
    if (!match) return null;
    let nums = match[1].split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
    if (nums.length === 0) return null;
    return { start: nums[0], end: nums[nums.length - 1] };
}

// ─────────────────────────────────────────────
// 核心解析
// ─────────────────────────────────────────────

/**
 * 从课表页面的 Document 中提取并去重、合并课程数据
 */
function extractCoursesFromDoc(doc) {
    let parsedCourses = [];

    const table = doc.getElementById('kbtable');
    if (!table) throw new Error("未找到课表表格（#kbtable），请确认已登录教务系统且当前学期有排课。");

    const rows = table.getElementsByTagName('tr');

    for (let i = 1; i < rows.length - 1; i++) {
        const row = rows[i];

        const th = row.querySelector('th');
        if (!th) continue;
        const sectionInfo = parseSectionFromThHeader(th.innerText || th.textContent);
        if (!sectionInfo) continue;

        const cells = row.getElementsByTagName('td');
        for (let j = 0; j < cells.length; j++) {
            const dayOfWeek = j + 1;
            const cell = cells[j];

            const detailDivs = cell.querySelectorAll('div.kbcontent');
            if (detailDivs.length === 0) continue;

            detailDivs.forEach(div => {
                let htmlContent = div.innerHTML;
                if (!htmlContent.trim() || htmlContent.trim() === '&nbsp;') return;

                let courseBlocks = htmlContent.split(/-{5,}\s*<br\s*\/?>/i);

                courseBlocks.forEach(block => {
                    if (!block.trim() || block.trim() === '&nbsp;') return;

                    let tempDiv = doc.createElement('div');
                    tempDiv.innerHTML = block;

                    let courseObj = {
                        day: dayOfWeek,
                        isCustomTime: false,
                        startSection: sectionInfo.start,
                        endSection: sectionInfo.end
                    };

                    // 1. 课程名
                    let lines = tempDiv.innerHTML.split(/<br\s*\/?>/i);
                    for (let line of lines) {
                        let cleanLine = line.replace(/<[^>]+>/g, '').trim();
                        if (cleanLine && cleanLine !== '&nbsp;') {
                            courseObj.name = cleanLine;
                            break;
                        }
                    }

                    // 2. 教师（QAU title="老师"）
                    let teacherFont = tempDiv.querySelector('font[title="老师"]');
                    courseObj.teacher = teacherFont
                        ? (teacherFont.innerText || teacherFont.textContent).trim()
                        : "未知";

                    // 3. 教室
                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont
                        ? (positionFont.innerText || positionFont.textContent).trim()
                        : "待定";

                    // 4. 周次
                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = (timeFont.innerText || timeFont.textContent).trim();
                        let weekMatch = timeText.match(/^(.+?)\(周\)/);
                        if (weekMatch) {
                            courseObj.weeks = parseWeeks(weekMatch[1]);
                        }
                    }

                    if (!courseObj.weeks || courseObj.weeks.length === 0) return;
                    if (!courseObj.name) return;

                    parsedCourses.push(courseObj);
                });
            });
        }
    }

    // ── 去重 ──
    let uniqueCourses = [];
    let courseSet = new Set();
    parsedCourses.forEach(course => {
        let key = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.weeks.join(',')}`;
        if (!courseSet.has(key)) {
            courseSet.add(key);
            uniqueCourses.push(course);
        }
    });

    // ── 合并相邻节次（最多合并两个大节，即 1-4 节）──
    // 条件：同天、同名、同教师、同教室、同周次，节次紧邻，且合并后跨度不超过 4 节
    const sorted = uniqueCourses.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        const wa = a.weeks.join(','), wb = b.weeks.join(',');
        if (wa !== wb) return wa.localeCompare(wb);
        return a.startSection - b.startSection;
    });

    const merged = [];
    for (const cur of sorted) {
        const prev = merged[merged.length - 1];
        const canMerge = prev
            && prev.day === cur.day
            && prev.name === cur.name
            && prev.teacher === cur.teacher
            && prev.position === cur.position
            && prev.weeks.join(',') === cur.weeks.join(',')
            && prev.endSection + 1 === cur.startSection
            && (cur.endSection - prev.startSection) <= 3;
        if (canMerge) {
            prev.endSection = cur.endSection;
        } else {
            merged.push({ ...cur });
        }
    }

    return merged;
}

// ─────────────────────────────────────────────
// 学校定制数据
// ─────────────────────────────────────────────

/**
 * 三个校区的作息时间表
 */
const CAMPUS_TIME_SLOTS = {
    "青岛校区": [
        { "number": 1,  "startTime": "08:00", "endTime": "08:45" },
        { "number": 2,  "startTime": "08:55", "endTime": "09:40" },
        { "number": 3,  "startTime": "09:55", "endTime": "10:40" },
        { "number": 4,  "startTime": "10:50", "endTime": "11:35" },
        { "number": 5,  "startTime": "11:35", "endTime": "12:00" },
        { "number": 6,  "startTime": "14:00", "endTime": "14:45" },
        { "number": 7,  "startTime": "14:55", "endTime": "15:40" },
        { "number": 8,  "startTime": "15:55", "endTime": "16:40" },
        { "number": 9,  "startTime": "16:50", "endTime": "17:35" },
        { "number": 10, "startTime": "18:50", "endTime": "19:35" },
        { "number": 11, "startTime": "19:45", "endTime": "20:30" }
    ],
    "平度校区": [
        { "number": 1,  "startTime": "08:30", "endTime": "09:15" },
        { "number": 2,  "startTime": "09:25", "endTime": "10:10" },
        { "number": 3,  "startTime": "10:20", "endTime": "11:05" },
        { "number": 4,  "startTime": "11:15", "endTime": "12:00" },
        { "number": 5,  "startTime": "12:00", "endTime": "12:25" },
        { "number": 6,  "startTime": "14:00", "endTime": "14:45" },
        { "number": 7,  "startTime": "14:55", "endTime": "15:40" },
        { "number": 8,  "startTime": "15:50", "endTime": "16:35" },
        { "number": 9,  "startTime": "16:45", "endTime": "17:30" },
        { "number": 10, "startTime": "18:50", "endTime": "19:35" },
        { "number": 11, "startTime": "19:45", "endTime": "20:30" }
    ],
    "蓝谷校区": [
        { "number": 1,  "startTime": "08:30", "endTime": "09:15" },
        { "number": 2,  "startTime": "09:20", "endTime": "10:05" },
        { "number": 3,  "startTime": "10:15", "endTime": "11:00" },
        { "number": 4,  "startTime": "11:05", "endTime": "11:50" },
        { "number": 5,  "startTime": "13:10", "endTime": "13:55" },
        { "number": 6,  "startTime": "14:00", "endTime": "14:45" },
        { "number": 7,  "startTime": "14:55", "endTime": "15:40" },
        { "number": 8,  "startTime": "15:45", "endTime": "16:30" },
        { "number": 9,  "startTime": "16:35", "endTime": "17:20" },
        { "number": 10, "startTime": "18:30", "endTime": "19:15" },
        { "number": 11, "startTime": "19:25", "endTime": "20:15" }
    ]
};

function getCourseConfig() {
    return {
        "defaultClassDuration": 45,
        "defaultBreakDuration": 5
    };
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("正在获取课表数据，请稍候...");

        const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET' });
        const htmlText = await response.text();
        const parser = new DOMParser();
        let doc = parser.parseFromString(htmlText, 'text/html');

        // 解析学期列表
        const selectElem = doc.getElementById('xnxq01id');
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push((opt.innerText || opt.textContent).trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected')) {
                    defaultIndex = index;
                }
            });
        }

        // 选择学期
        if (semesters.length > 0) {
            let selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
                "请选择要导入的学期",
                JSON.stringify(semesters),
                defaultIndex
            );

            if (selectedIdx === null) {
                window.shiguangBridge.showToast("已取消导入");
                return;
            }

            if (selectedIdx !== defaultIndex) {
                window.shiguangBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 课表...`);
                let formData = new URLSearchParams();
                formData.append('xnxq01id', semesterValues[selectedIdx]);

                const postResponse = await fetch('/jsxsd/xskb/xskb_list.do', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });
                const postHtml = await postResponse.text();
                doc = parser.parseFromString(postHtml, 'text/html');
            }
        }

        // 选择校区
        const campusNames = Object.keys(CAMPUS_TIME_SLOTS);
        const campusIdx = await window.shiguangBridgePromise.showSingleSelection(
            "请选择您所在的校区",
            JSON.stringify(campusNames),
            0
        );

        if (campusIdx === null) {
            window.shiguangBridge.showToast("已取消导入");
            return;
        }

        const selectedCampus = campusNames[campusIdx];
        const timeSlots = CAMPUS_TIME_SLOTS[selectedCampus];

        // 解析课程
        const courses = extractCoursesFromDoc(doc);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert(
                "提示",
                "未能解析到任何课程，请检查当前学期是否有排课，或尝试切换学期。",
                "好的"
            );
            return;
        }

        // 保存
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(getCourseConfig()));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));

        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saveResult) {
            window.shiguangBridge.showToast("课程保存失败，请重试！");
            return;
        }

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 节课程（${selectedCampus}作息）！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        window.shiguangBridge.showToast("导入发生异常: " + error.message);
    }
}

runImportFlow();