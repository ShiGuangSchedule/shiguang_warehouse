// 西南大学(swu.edu.cn) 拾光课程表适配脚本
// 基于正方新一代教务系统接口适配
// 维护者：小漫君(xiaomanjun233)
// 出现问题请提issues或者提交pr更改,这更加快速
//
// 通过正方接口 xskbcx_cxXsgrkb 拉取个人课表 JSON（kbList），解析课程名、教师、教室、
// 星期、节次和周次（含单双周）。集中实践课（军训、毕业设计等）无星期节次，直接忽略不导入。
// 交互上自动读取教务系统的学年/学期下拉列表，用户只需依次点选即可，无需手动输入。
// 通过 xskbcx_cxXskbcxIndex 读取学年学期选项、xskbcxZccx_cxZcByXnxq 取所选学期开学日期；
// 导入课程、课表配置与西南大学 14 节节次时间。
//
// 使用方式：从办事大厅(i.swu.edu.cn)登录后进入教务系统(jw.swu.edu.cn/jwglxt)课表查询页面，再执行导入。

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = String(weekStr).replace(/，|、/g, ',').replace(/（/g, '(').replace(/）/g, ')').split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        // 正方实验课的单周写法可能为“第7周”，逗号列表也可能只在末项带“周”。
        const weekMatch = trimmedSet.match(/^(?:第)?\s*(\d+)(?:\s*[-~至]\s*(?:第)?\s*(\d+))?\s*(?:周)?\s*(?:\(([单双])\))?$/);

        let start = 0;
        let end = 0;
        let processed = false;

        if (weekMatch) {
            start = Number(weekMatch[1]);
            end = Number(weekMatch[2] || weekMatch[1]);
            processed = true;
        }

        if (processed && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 拼接教务系统接口地址。
 * 西南大学教务（jw.swu.edu.cn）的正方新一代部署在 /jwglxt 子路径下，
 * 接口路径必须带上该前缀；校外经 WebVPN 访问时路径还带有 /http/<hex> 前缀，需保留。
 */
function buildApiUrl(path) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const webvpnPrefix = prefixMatch ? prefixMatch[0] : "";
    return window.location.origin + webvpnPrefix + "/jwglxt" + path;
}

/**
 * 拼装课程备注。
 * xm 只有姓名，kcmc 只有课程名，以下信息只存在于原始字段里，
 * 放进备注方便用户核对：重修标记、选课备注（体育项目、微专业等）、周次原文。
 */
function buildCourseRemark(rawCourse) {
    const parts = [];

    const retakeFlag = String(rawCourse.cxbjmc || "").trim();
    if (retakeFlag) {
        parts.push(retakeFlag);
    }

    const selectionNote = String(rawCourse.xkbz || "").trim();
    if (selectionNote) {
        parts.push(selectionNote);
    }

    const weekDesc = String(rawCourse.zcd || "").trim();
    if (weekDesc) {
        parts.push(weekDesc);
    }

    return parts.join(" | ");
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    // 检查JSON结构：新的数据在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段检查：只有 kcmc(课名), xqj(星期), jcs(节次范围), zcd(周次描述) 是排课必需的。
        // xm(教师) 与 cdmc(教室) 在实践课、线上课、未排地点的课程上可能为空，
        // 缺这两项不影响排课，不能因此丢弃整门课程。
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        const remark = buildCourseRemark(rawCourse);

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        };

        if (remark) {
            course.remark = remark;
        }

        finalCourseList.push(course);
    }

    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: JSON 数据解析完成，共找到 ${finalCourseList.length} 门课程。`);
    return finalCourseList;
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "西南大学课表导入",
        "导入前请确保您已从办事大厅(i.swu.edu.cn)登录并进入教务系统(jw.swu.edu.cn)课表查询页面。",
        "好的，开始导入"
    );
}

/**
 * 从教务系统课表查询页读取学年与学期下拉选项。
 * 学年以选中的一项为中心，取前 2 年 + 后 2 年，最多 5 项，避免列表过长。
 */
async function fetchAcademicOptions() {
    const url = buildApiUrl("/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151");

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });
        if (!response.ok) {
            return null;
        }
        const htmlText = await response.text();
        const doc = new DOMParser().parseFromString(htmlText, "text/html");

        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter((opt) => opt.value !== "")
            .map((opt) => ({
                value: opt.value,
                text: opt.textContent.trim(),
                selected: opt.selected
            }));
        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter((opt) => opt.value !== "")
            .map((opt) => ({
                value: opt.value,
                text: opt.textContent.trim(),
                selected: opt.selected
            }));

        if (allYearOptions.length === 0 || semesterOptions.length === 0) {
            return null;
        }

        const defaultSemesterIndex = (() => {
            const i = semesterOptions.findIndex((opt) => opt.selected);
            return i !== -1 ? i : 0;
        })();

        const selectedIndex = allYearOptions.findIndex((opt) => opt.selected);
        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex
            };
        }

        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);
        return {
            yearOptions: allYearOptions.slice(start, end),
            semesterOptions,
            defaultYearIndex: selectedIndex - start,
            defaultSemesterIndex
        };
    } catch (e) {
        return null;
    }
}

/**
 * 让用户依次点选学年与学期（带默认选中项），返回 API 所需的 xnm/xqm 代码。
 * 无需手动输入，用户一路点下一步即可。
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();
    if (!optionsData) {
        window.shiguangBridge.showToast("从教务系统读取学年学期失败，请确认登录状态有效。");
        return null;
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年",
        JSON.stringify(yearOptions.map((item) => item.text)),
        defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) {
        return null;
    }
    const academicYear = yearOptions[yearIndex].value;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map((item) => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) {
        return null;
    }

    return {
        academicYear,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/**
 * 获取所选学期的开学日期（第 1 周的日期）。
 * 该接口按用户所选 xnm/xqm 返回对应学期的周历，能拿到比当前学期更准确的开班日期。
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = buildApiUrl("/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154");

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: `xnm=${academicYear}&xqm=${semesterCode}`,
            credentials: "include"
        });

        if (response.ok) {
            const json = await response.json();
            if (Array.isArray(json) && json.length > 0) {
                const firstWeekObj = json.find((item) => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];

                const matchStr = String(firstWeekObj.rq || firstWeekObj.zcrq || firstWeekObj.ksrq || "").match(/(\d{4}-\d{2}-\d{2})/);
                if (matchStr) {
                    return matchStr[1];
                }
            }
        }
    } catch (e) {
        // 获取失败不影响主流程
    }
    return null;
}

/**
 * 计算课表配置。
 *
 * 应用侧的 saveCourseConfig 是整体覆盖而非字段级合并：没有传入的字段会被写成模型默认值，
 * 其中 semesterStartDate 的默认值是 null，会把用户已经设置好的开学日期清空。
 * 所以拿不到真实开学日期时返回 null，由调用方跳过整个配置保存，宁可不写也不要写坏。
 */
function buildCourseConfig(courses, startDate, firstDayOfWeek) {
    if (!startDate) {
        return null;
    }

    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }

    return {
        semesterStartDate: startDate,
        // 只增不减：默认 20 周，课表里出现更大的周次时才扩展。
        semesterTotalWeeks: Math.max(maxWeek, 20),
        firstDayOfWeek: firstDayOfWeek
    };
}

/**
 * 请求和解析课程数据。
 * 并行拉取课表 JSON 与所选学期开学日期。
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = buildApiUrl("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151");

    const [courseResponse, startDate] = await Promise.all([
        fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body,
            credentials: "include"
        }),
        fetchSemesterStartDate(academicYear, semesterCode)
    ]);

    try {
        if (!courseResponse.ok) {
            throw new Error(`网络请求失败。状态码: ${courseResponse.status} (${courseResponse.statusText})`);
        }

        const jsonText = await courseResponse.text();
        let jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error('JS: JSON 解析失败:', e);
            window.shiguangBridge.showToast("数据返回格式错误，请确认已进入教务系统(jw.swu.edu.cn)课表查询页面（而非停留在办事大厅门户页），且登录状态有效。");
            return null;
        }

        const courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程。`);

        // qsxqj: 教务系统设置的一周起始星期几，缺失时按周一处理。
        const rawFirstDay = Number(jsonData.qsxqj);
        const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;

        return {
            courses,
            startDate,
            firstDayOfWeek
        };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

/**
 * 只在能拿到真实开学日期时写入课表配置。
 * 拿不到就完全不调用 saveCourseConfig —— 应用侧是整体覆盖，
 * 传入不含 semesterStartDate 的配置会把用户已设置的开学日期清空。
 */
async function saveCourseConfigIfPossible(courses, startDate, firstDayOfWeek) {
    const config = buildCourseConfig(courses, startDate, firstDayOfWeek);

    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        console.log("JS: 无可用开学日期，跳过 saveCourseConfig 以保留用户现有配置。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            `课表配置更新成功！开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }
}

// 西南大学统一作息时间（14 节，第 5 节 12:10 从中午开始，傍晚 17:50 后为第 11 节）
const SWU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "12:10", endTime: "12:55" },
    { number: 6, startTime: "13:05", endTime: "13:50" },
    { number: 7, startTime: "14:00", endTime: "14:45" },
    { number: 8, startTime: "14:55", endTime: "15:40" },
    { number: 9, startTime: "15:50", endTime: "16:35" },
    { number: 10, startTime: "16:55", endTime: "17:40" },
    { number: 11, startTime: "17:50", endTime: "18:35" },
    { number: 12, startTime: "19:20", endTime: "20:05" },
    { number: 13, startTime: "20:15", endTime: "21:00" },
    { number: 14, startTime: "21:10", endTime: "21:55" },
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (selection === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    console.log(`JS: 已选择学年学期: ${selection.academicYear}/${selection.semesterCode}`);

    const result = await fetchAndParseCourses(selection.academicYear, selection.semesterCode);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, startDate, firstDayOfWeek } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    await saveCourseConfigIfPossible(courses, startDate, firstDayOfWeek);

    await importPresetTimeSlots(SWU_TIME_SLOTS);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
