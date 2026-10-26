/**
 * 将周次字符串（如 "1-4,6,8-10"）解析为有序的周次数字数组。
 * 支持连续区间（如 "1-4"）和单个周次（如 "6"）的混合格式。
 * @param {string} weekStr - 原始周次字符串
 * @returns {number[]} 去重并升序排列的周次数组
 */
function parseWeeks(weekStr) {
    const weeks = [];
    const parts = weekStr.split(',');

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-');
            for (let w = parseInt(start); w <= parseInt(end); w++) {
                if (!weeks.includes(w)) weeks.push(w);
            }
        } else {
            const w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }

    return weeks.sort((a, b) => a - b);
}

/**
 * 从教务系统返回的 HTML 文档中解析所有课程信息。
 * 遍历课表格 #timetable 中每个单元格，提取课程名、教师、教室及周次节次。
 * @param {Document} doc - 已解析的 HTML 文档对象
 * @returns {object[]} 课程对象数组，每项包含 day/name/teacher/position/weeks/startSection/endSection
 */
function extractCoursesFromDoc(doc) {
    const courses = [];
    const table = doc.getElementById('timetable');
    if (!table) throw new Error("未找到课表格元素（#timetable），请确认教务系统页面已正常加载。");

    const rows = table.getElementsByTagName('tr');
    // 跳过首行（表头）和末行（通常为空白行）
    for (let rowIdx = 1; rowIdx < rows.length - 1; rowIdx++) {
        const cells = rows[rowIdx].getElementsByTagName('td');

        for (let colIdx = 0; colIdx < cells.length; colIdx++) {
            const dayOfWeek = colIdx + 1; // 列索引对应星期几（1=周一）
            const cell = cells[colIdx];

            const contentDivs = cell.querySelectorAll('div.kbcontent');
            if (contentDivs.length === 0) continue;

            contentDivs.forEach(div => {
                const rawHtml = div.innerHTML;
                // 跳过空单元格
                if (!rawHtml.trim() || rawHtml === '&nbsp;') return;

                // 同一格内多门课以 10 个以上连字符分隔
                const blocks = rawHtml.split(/-{10,}\s*<br\s*\/?>/i);

                blocks.forEach(block => {
                    if (!block.trim()) return;

                    const tmp = document.createElement('div');
                    tmp.innerHTML = block;

                    const course = {
                        day: dayOfWeek,
                        isCustomTime: false
                    };

                    // 课程名称取第一个文本节点，fallback 到 innerText 首行
                    const firstNode = tmp.childNodes[0];
                    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
                        course.name = firstNode.nodeValue.trim();
                    } else {
                        course.name = tmp.innerText.split('\n')[0].trim();
                    }

                    // 教师姓名
                    const teacherEl = tmp.querySelector('font[title="教师"]');
                    course.teacher = teacherEl ? teacherEl.innerText.trim() : "未知";

                    // 上课教室
                    const roomEl = tmp.querySelector('font[title="教室"]');
                    course.position = roomEl ? roomEl.innerText.trim() : "待定";

                    // 周次与节次：格式为 "X-Y(周)[A-B节]" 或仅 "X-Y(周)"
                    const timeEl = tmp.querySelector('font[title="周次(节次)"]');
                    if (!timeEl) return;

                    const timeText = timeEl.innerText.trim();
                    const fullMatch = timeText.match(/(.+?)\(周\)\[(\d+)-(\d+)节\]/);
                    if (fullMatch) {
                        course.weeks = parseWeeks(fullMatch[1]);
                        course.startSection = parseInt(fullMatch[2]);
                        course.endSection = parseInt(fullMatch[3]);
                    } else {
                        const weekOnlyMatch = timeText.match(/(.+?)\(周\)/);
                        if (weekOnlyMatch) {
                            // 节次信息缺失时，根据行索引推算默认节次
                            course.weeks = parseWeeks(weekOnlyMatch[1]);
                            course.startSection = rowIdx * 2 - 1;
                            course.endSection = rowIdx * 2;
                        } else {
                            return; // 无法识别的时间格式，跳过
                        }
                    }

                    if (course.name && course.weeks && course.weeks.length > 0) {
                        courses.push(course);
                    }
                });
            });
        }
    }

    return courses;
}

/**
 * 根据当前日期返回对应学期的作息时间表。
 * 通过配置参数动态推算各节课起止时间，支持早、午、晚三段以及
 * 普通课间 / 中课间 / 大课间三级课间时长。
 * 5月～9月使用夏季作息，其余月份使用春秋冬季作息。
 * @returns {object[]} 节次时间数组，每项包含 number/startTime/endTime
 */
function getPresetTimeSlots() {
    const month = new Date().getMonth() + 1;
    const isSummer = month >= 5 && month <= 9;

    // ── 作息参数配置 ──────────────────────────────────────────────
    const params = isSummer ? {
        // 夏季作息参数
        morningStartTime:     "08:10",  // 早上第 1 节开始时间
        afternoonStartTime:   "14:45",  // 中午第 1 节开始时间（第 5 节）
        eveningStartTime:     "19:30",  // 晚上第 1 节开始时间（第 9 节）
        classDuration:        45,       // 单节课时长（分钟）
        normalBreakDuration:  10,       // 普通课间时长（分钟）
        mediumBreakDuration:  15,       // 中课间时长（分钟）
        longBreakDuration:    20,       // 大课间时长（分钟）
        longBreakAfterSlot:   2,        // 大课间插入位置（第 N 节课后）
        mediumBreakAfterSlot: 6,        // 中课间插入位置（第 N 节课后）
    } : {
        // 春秋冬季作息参数
        morningStartTime:     "08:20",
        afternoonStartTime:   "14:30",
        eveningStartTime:     "19:10",
        classDuration:        45,
        normalBreakDuration:  10,
        mediumBreakDuration:  15,
        longBreakDuration:    20,
        longBreakAfterSlot:   2,
        mediumBreakAfterSlot: 6,
    };

    // 早上 4 节 / 下午 4 节 / 晚上 3 节
    const SESSION_SLOTS   = [4, 4, 3];
    const SESSION_STARTS  = [
        params.morningStartTime,
        params.afternoonStartTime,
        params.eveningStartTime,
    ];

    const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const toTimeStr = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

    const { classDuration, normalBreakDuration, mediumBreakDuration, longBreakDuration,
            longBreakAfterSlot, mediumBreakAfterSlot } = params;

    const result = [];
    let slotNumber = 1;

    for (let s = 0; s < SESSION_SLOTS.length; s++) {
        let cursor = toMinutes(SESSION_STARTS[s]);
        const count = SESSION_SLOTS[s];

        for (let i = 0; i < count; i++) {
            result.push({
                number:    slotNumber,
                startTime: toTimeStr(cursor),
                endTime:   toTimeStr(cursor + classDuration),
            });
            cursor += classDuration;
            // 非本段末节时，按位置选择课间时长
            if (i < count - 1) {
                if      (slotNumber === longBreakAfterSlot)   cursor += longBreakDuration;
                else if (slotNumber === mediumBreakAfterSlot) cursor += mediumBreakDuration;
                else                                          cursor += normalBreakDuration;
            }
            slotNumber++;
        }
    }

    return result;
}
/**
 * 从教学周历页面推断学期开学日期（YYYY-MM-DD）。
 * 解析策略：
 * 1) 优先读取第 1 周对应的周一日期；
 * 2) 若未命中，则在周历表中收集全部日期并取最小值兜底。
 * @returns {Promise<{ semesterStartDate: string|null, totalWeeks: number|null }>} 开学日期和总周数；无法解析时返回 null
 */
async function getStartDateandTotalWeeks() {
    const response = await fetch('/jsxsd/jxzl/jxzl_query', { method: 'GET' });
    if (!response.ok) {
        throw new Error(`周历请求失败：${response.status}`);
    }

    const htmlText = await response.text();
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const table = doc.querySelector('#kbtable');

    if (!table) {
        console.log('未找到周历表格 #kbtable');
        return { semesterStartDate: null, totalWeeks: null };
    }

    const parseCNDate = (text) => {
        const m = String(text || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
        if (!m) return null;
        const [, y, mo, d] = m;
        return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    };

    let week1Monday = null;
    let minDate = null;
    let totalWeeks = null;

    const rows = table.querySelectorAll('tr');
    if(!rows || rows.length === 0) {
        console.log('周历表格 #kbtable 中未找到任何行');
        return { semesterStartDate: null, totalWeeks: null };
    }

    rows.forEach((row) => {
        const firstCellText = row.cells?.[0]?.textContent?.trim() || '';
        const week = /^\d+$/.test(firstCellText) ? Number(firstCellText) : NaN;

        if (!Number.isNaN(week)) {
            totalWeeks = Math.max(totalWeeks, week);
            if (week === 1 && !week1Monday) {
                const candidate = parseCNDate(row.cells?.[1]?.getAttribute('title'));
                if (candidate) week1Monday = candidate;
            }
        }

        row.querySelectorAll('td[title]').forEach((td) => {
            const candidate = parseCNDate(td.getAttribute('title'));
            if (!candidate) return;
            if (!minDate || candidate < minDate) {
                minDate = candidate;
            }
        });
    });

    const semesterStartDate = week1Monday || minDate;
    console.log('开学日期：', semesterStartDate || '未找到');
    console.log('总周数：', totalWeeks);

    return { semesterStartDate, totalWeeks };
}

/**
 * 返回全局课表基础配置（单节课时长与课间休息时长）。
 * @returns {Promise<{ semesterStartDate: string|null, semesterTotalWeeks: number, defaultClassDuration: number, defaultBreakDuration: number }>}
 */
async function getCourseConfig() {
    const { semesterStartDate, totalWeeks } = await getStartDateandTotalWeeks();
    return {
        semesterStartDate: semesterStartDate,
        semesterTotalWeeks: totalWeeks,
        defaultClassDuration: 45,
        defaultBreakDuration: 10
    };
}

/**
 * 课表导入主流程。
 * 依次完成：发起请求 → 解析 HTML → 提取课程 → 保存配置/作息/课程 → 通知完成。
 * 在浏览器调试环境中仅打印结果，不调用 AndroidBridge。
 */
async function runImportFlow() {
    const isApp = typeof window.shiguangBridgePromise !== 'undefined';
    const hasToast = typeof window.shiguangBridge !== 'undefined';

    try {
        if (hasToast) {
            window.shiguangBridge.showToast("正在拉取课表，请稍候...");
        } else {
            console.log("[HUSE] 开始请求课表页面...");
        }

        const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET' });
        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');

        // 读取学期列表（当前仅用于记录，实际取最新学期）
        const selectEl = doc.getElementById('xnxq01id');
        const semesters = [];
        const semesterValues = [];
        let defaultIndex = 0;

        if (selectEl) {
            selectEl.querySelectorAll('option').forEach((opt, idx) => {
                semesters.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected')) defaultIndex = idx;
            });
        }
        // 始终选取列表首的最新学期
        defaultIndex = 0;
        console.log(`[HUSE] 共找到 ${semesters.length} 个学期，当前使用：${semesters[defaultIndex] || '未知'}`);

        const courses = extractCoursesFromDoc(doc);

        if (courses.length === 0) {
            const msg = "未解析到任何课程，当前学期可能暂无排课。";
            console.warn("[HUSE] " + msg);
            if (isApp) {
                await window.shiguangBridgePromise.showAlert("提示", msg, "好的");
            } else {
                alert(msg);
            }
            return;
        }

        console.log(`[HUSE] 成功解析 ${courses.length} 门课程。`);

        const config = await getCourseConfig();
        const timeSlots = getPresetTimeSlots();

        // 浏览器调试环境：输出结果后退出，不执行 APP 存储逻辑
        if (!isApp) {
            console.log("[HUSE] 课表基础配置：", config);
            console.log("[HUSE] 作息时间表：", timeSlots);
            console.log("[HUSE] 课程列表：", courses);
            alert(`解析完成！共获取 ${courses.length} 门课程及作息时间，详情见控制台（F12）。`);
            return;
        }

        // APP 环境：保存课表配置与作息时间
        const configSaved = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        const slotsSaved = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        if (!configSaved || !slotsSaved) {
            // 时间配置保存失败不强制中断，继续尝试导入课程
            console.warn("[HUSE] 课表时间配置保存失败，将继续尝试导入课程。");
            window.shiguangBridge.showToast("时间配置保存失败，继续导入课程...");
        }

        // APP 环境：保存课程数据
        const courseSaved = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!courseSaved) {
            console.error("[HUSE] 课程数据保存失败。");
            window.shiguangBridge.showToast("课程保存失败，请重试！");
            return;
        }

        console.log(`[HUSE] 导入完成，共写入 ${courses.length} 门课程。`);
        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程及作息时间！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (err) {
        console.error("[HUSE] 导入流程发生异常：", err);
        if (hasToast) {
            window.shiguangBridge.showToast("导入失败：" + err.message);
        } else {
            alert("导入失败：" + err.message);
        }
    }
}

runImportFlow();