// 广州华立学院(jw.hualixy.edu.cn) 拾光课程表适配脚本
// 基于正方新一代教务系统接口适配
// 维护者：小漫君(xiaomanjun233)
// 出现问题请提issues或者提交pr更改,这更加快速
//
// 通过正方接口 xskbcx_cxXsgrkb 拉取个人课表 JSON（kbList），解析课程名、教师、教室、
// 星期、节次和周次（含单双周）。集中实践课（军训、毕业设计等）无星期节次，直接忽略不导入。
// 交互上自动读取教务系统的学年/学期下拉列表，用户只需依次点选即可，无需手动输入。
// 通过 xskbcx_cxXskbcxIndex 读取学年学期选项、xskbcxZccx_cxZcByXnxq 取所选学期开学日期，
// 并优先从 xskbcx_cxRjc 动态读取该校真实节次作息时间，读取失败时跳过作息导入。
//
// 使用方式：通过统一认证(https://jw.hualixy.edu.cn/sso/ddlogin)或正方直登
// (https://jw.hualixy.edu.cn/jwglxt/xtgl/login_slogin.html)登录后，
// 在教务系统(jw.hualixy.edu.cn/jwglxt)任意页面（如首页）直接执行导入即可，
// 无需进入课表查询页面。脚本通过接口自动读取学年学期并获取课表与节次作息。

// 正方新一代教务部分学校接口模块号可能不同，依次尝试常见模块号
const GNMKDMS = ["N2151", "N253508"];

/**
 * 拼接教务系统接口地址。
 * 正方新一代部署在 /jwglxt 子路径下，接口路径必须带上该前缀；
 * 校外经 WebVPN 访问时路径还带有 /http/<hex> 前缀，需保留。
 */
function buildApiUrl(modulePath, gnmkdm) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const webvpnPrefix = prefixMatch ? prefixMatch[0] : "";
    const gnmkdmQuery = gnmkdm ? "?gnmkdm=" + gnmkdm : "";
    return window.location.origin + webvpnPrefix + "/jwglxt" + modulePath + gnmkdmQuery;
}

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/);

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 解析 API 返回的 JSON 数据。
 */
function parseJsonData(jsonData) {
    console.log("JS: parseJsonData 正在解析 JSON 数据...");

    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const finalCourseList = [];

    for (const rawCourse of rawCourseList) {
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        };

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
        "广州华立学院课表导入",
        "导入前请确保您已通过统一认证(jw.hualixy.edu.cn/sso/ddlogin)或正方直登登录教务系统；在任意页面直接执行导入即可，无需进入课表查询页面。",
        "好的，开始导入"
    );
}

/**
 * 从教务系统课表查询页读取学年与学期下拉选项（多个模块号依次尝试）。
 */
async function fetchAcademicOptions() {
    for (const gnmkdm of GNMKDMS) {
        const url = buildApiUrl("/kbcx/xskbcx_cxXskbcxIndex.html", gnmkdm);
        try {
            const response = await fetch(url, { method: "GET", credentials: "include" });
            if (!response.ok) continue;
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

            if (allYearOptions.length === 0 || semesterOptions.length === 0) continue;

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
            console.warn(`JS: 读取学年学期失败(gnmkdm=${gnmkdm}):`, e);
        }
    }
    return null;
}

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
    if (yearIndex === null || yearIndex === -1) return null;
    const academicYear = yearOptions[yearIndex].value;

    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesterOptions.map((item) => item.text)),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

/**
 * 获取所选学期的开学日期（第 1 周的日期）。
 */
async function fetchSemesterStartDate(academicYear, semesterCode) {
    for (const gnmkdm of GNMKDMS) {
        const url = buildApiUrl("/kbcx/xskbcxZccx_cxZcByXnxq.html", gnmkdm);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body: `xnm=${academicYear}&xqm=${semesterCode}`,
                credentials: "include"
            });

            if (response.ok) {
                const json = await response.json();
                if (Array.isArray(json) && json.length > 0) {
                    const firstWeekObj = json.find((item) => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
                    const matchStr = String(firstWeekObj.rq || firstWeekObj.zcrq || firstWeekObj.ksrq || "").match(/(\d{4}-\d{2}-\d{2})/);
                    if (matchStr) return matchStr[1];
                }
            }
        } catch (e) {
            console.warn(`JS: 获取开学日期失败(gnmkdm=${gnmkdm}):`, e);
        }
    }
    return null;
}

/**
 * 从正方系统动态获取该学期真实节次作息时间。
 * 读取失败返回 null，由调用方跳过作息导入（不写死未知作息）。
 */
async function fetchAndParseTimeSlots(academicYear, semesterCode) {
    const requestBody = "xnm=" + encodeURIComponent(academicYear) +
        "&xqm=" + encodeURIComponent(semesterCode) +
        "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
    let lastError = null;

    for (const gnmkdm of GNMKDMS) {
        const url = buildApiUrl("/kbcx/xskbcx_cxRjc.html", gnmkdm);
        try {
            const response = await fetch(url, {
                headers: {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                body: requestBody,
                method: "POST",
                credentials: "include"
            });
            if (!response.ok) {
                lastError = "HTTP " + response.status;
                console.warn(`JS: 节次时间接口请求失败(gnmkdm=${gnmkdm})：HTTP ${response.status}`);
                continue;
            }

            const responseText = await response.text();
            const responsePreview = responseText.replace(/\s+/g, " ").trim().slice(0, 200) || "<空响应>";

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                lastError = "非 JSON：响应=" + responsePreview;
                console.warn(`JS: 节次时间接口未返回 JSON(gnmkdm=${gnmkdm}):`, e);
                continue;
            }

            if (data && !Array.isArray(data) && Array.isArray(data.data)) {
                data = data.data;
            }
            if (!Array.isArray(data)) {
                lastError = "格式异常：响应=" + responsePreview;
                console.warn(`JS: 节次时间接口返回格式异常(gnmkdm=${gnmkdm}): ${responsePreview}`);
                continue;
            }

            const timeSlots = [];
            for (const item of data) {
                if (!item || typeof item !== "object") continue;
                const number = Number(item.jcdm != null ? item.jcdm : item.jcmc);
                let startTime = "";
                let endTime = "";
                if (item.qssj != null && item.jssj != null) {
                    startTime = String(item.qssj).trim();
                    endTime = String(item.jssj).trim();
                } else if (item.sksj) {
                    const sksjParts = String(item.sksj).split(/[~\-—至到]/);
                    if (sksjParts.length >= 2) {
                        startTime = sksjParts[0].trim();
                        endTime = sksjParts[1].trim();
                    }
                }
                startTime = startTime.slice(0, 5);
                endTime = endTime.slice(0, 5);
                if (!(number > 0) || !startTime || !endTime) continue;

                timeSlots.push({ number, startTime, endTime });
            }

            timeSlots.sort((a, b) => a.number - b.number);
            if (timeSlots.length === 0) {
                lastError = "无有效数据：响应=" + responsePreview;
                console.warn(`JS: 节次时间接口未返回有效作息时间(gnmkdm=${gnmkdm}): ${responsePreview}`);
                continue;
            }

            console.log(`JS: 获取到真实节次作息 ${timeSlots.length} 条(gnmkdm=${gnmkdm})，第1节 ${timeSlots[0].startTime}-${timeSlots[0].endTime}`);
            return timeSlots;
        } catch (error) {
            lastError = error.message || String(error);
            console.warn(`JS: 获取节次作息时间失败(gnmkdm=${gnmkdm}):`, error);
        }
    }

    console.warn("JS: 所有节次时间接口尝试均失败，最后原因：" + lastError);
    return null;
}

/**
 * 计算课表配置。只在能拿到真实开学日期时返回配置，否则返回 null 由调用方跳过。
 */
function buildCourseConfig(courses, startDate, firstDayOfWeek) {
    if (!startDate) return null;

    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) maxWeek = week;
        }
    }

    return {
        semesterStartDate: startDate,
        semesterTotalWeeks: Math.max(maxWeek, 20),
        firstDayOfWeek: firstDayOfWeek
    };
}

/**
 * 请求和解析课程数据。并行拉取课表 JSON 与所选学期开学日期。
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const body = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    let lastError = null;

    for (const gnmkdm of GNMKDMS) {
        const url = buildApiUrl("/kbcx/xskbcx_cxXsgrkb.html", gnmkdm);
        try {
            const [courseResponse, startDate] = await Promise.all([
                fetch(url, {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
                    body,
                    credentials: "include"
                }),
                fetchSemesterStartDate(academicYear, semesterCode)
            ]);

            if (!courseResponse.ok) {
                lastError = `网络请求失败。状态码: ${courseResponse.status} (${courseResponse.statusText})`;
                console.warn(`JS: 课程请求失败(gnmkdm=${gnmkdm})：${lastError}`);
                continue;
            }

            const jsonText = await courseResponse.text();
            if (jsonText.indexOf("登录") !== -1 && jsonText.indexOf("密码") !== -1) {
                lastError = "课表接口返回了登录页面，登录会话已失效";
                console.warn(`JS: ${lastError}(gnmkdm=${gnmkdm})`);
                continue;
            }

            let jsonData;
            try {
                jsonData = JSON.parse(jsonText);
            } catch (e) {
                lastError = "数据返回格式错误";
                console.warn(`JS: JSON 解析失败(gnmkdm=${gnmkdm}):`, e);
                continue;
            }

            const courses = parseJsonData(jsonData);
            if (courses.length === 0) {
                window.shiguangBridge.showToast("未找到任何课程数据，请确认登录状态有效（非停留在登录页）、所选学年学期正确，或本学期无课。");
                return null;
            }

            console.log(`JS: 课程数据解析成功，共找到 ${courses.length} 门课程(gnmkdm=${gnmkdm})。`);

            const rawFirstDay = Number(jsonData.qsxqj);
            const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;

            return { courses, startDate, firstDayOfWeek };
        } catch (error) {
            lastError = error.message;
            console.warn(`JS: Fetch/Parse Error(gnmkdm=${gnmkdm}):`, error);
        }
    }

    window.shiguangBridge.showToast(`请求或解析失败: ${lastError}`);
    return null;
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

async function saveCourseConfigIfPossible(courses, startDate, firstDayOfWeek) {
    const config = buildCourseConfig(courses, startDate, firstDayOfWeek);
    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        return;
    }
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(`开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`);
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }
}

async function importPresetTimeSlots(timeSlots) {
    if (!timeSlots || timeSlots.length === 0) {
        window.shiguangBridge.showToast("未能读取该校真实作息时间，已跳过作息导入，请手动设置节次时间或其他节次时段。");
        return;
    }
    window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        console.error('JS: Save Time Slots Error:', error);
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

    const timeSlots = await fetchAndParseTimeSlots(selection.academicYear, selection.semesterCode);
    await importPresetTimeSlots(timeSlots);

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();