// 青岛理工大学 - 正方教务系统 课程表适配脚本

// 教务系统基地址：跟随当前登录页协议（http/https 的会话 cookie 是分开的，必须与登录页一致）
var BASE_URL = window.location.origin;

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(zcd) {
    if (!zcd) return [];

    var weekSets = String(zcd).replace(/，/g, ',').split(',');
    var weeks = [];

    for (var i = 0; i < weekSets.length; i++) {
        var trimmedSet = weekSets[i].trim();

        var rangeMatch = trimmedSet.match(/(\d+)\s*-\s*(\d+)\s*周?/);
        var singleMatch = trimmedSet.match(/^(\d+)\s*周?/);

        var start = 0;
        var end = 0;
        var processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed && start >= 1 && end >= start) {
            var isSingle = trimmedSet.indexOf('(单)') !== -1;
            var isDouble = trimmedSet.indexOf('(双)') !== -1;

            for (var w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }

    var uniqueWeeks = [];
    var seen = {};
    for (var j = 0; j < weeks.length; j++) {
        if (!seen[weeks[j]]) {
            seen[weeks[j]] = true;
            uniqueWeeks.push(weeks[j]);
        }
    }
    uniqueWeeks.sort(function(a, b) { return a - b; });
    return uniqueWeeks;
}

/**
 * 清洗课程名称中的特殊字符
 */
function cleanCourseName(name) {
    return name.replace(/[★○●◇◆]/g, '').trim();
}

function mergeAndDistinctCourses(courses) {
    var sorted = courses.slice().sort(function(a, b) {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            a.day - b.day ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
            a.startSection - b.startSection;
    });
    var merged = [];

    sorted.forEach(function(course) {
        var previous = merged[merged.length - 1];
        var sameCourse = previous && previous.name === course.name &&
            previous.teacher === course.teacher && previous.position === course.position &&
            previous.day === course.day && previous.weeks.join(',') === course.weeks.join(',');

        if (sameCourse && previous.endSection + 1 >= course.startSection) {
            previous.endSection = Math.max(previous.endSection, course.endSection);
        } else if (sameCourse && previous.startSection === course.startSection && previous.endSection === course.endSection) {
            return;
        } else {
            merged.push(course);
        }
    });

    var sameSection = new Map();
    merged.forEach(function(course) {
        var key = [course.name, course.teacher, course.position, course.day,
            course.startSection, course.endSection].join('|');
        if (sameSection.has(key)) {
            var existing = sameSection.get(key);
            existing.weeks = Array.from(new Set(existing.weeks.concat(course.weeks))).sort(function(a, b) { return a - b; });
        } else {
            sameSection.set(key, course);
        }
    });
    return Array.from(sameSection.values()).sort(function(a, b) {
        return a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name);
    });
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

    var rawCourseList = jsonData.kbList;
    var finalCourseList = [];

    for (var dbg = 0; dbg < Math.min(rawCourseList.length, 2); dbg++) {
        console.log("JS: 原始课程字段示例[" + dbg + "]: " + JSON.stringify(rawCourseList[dbg]));
    }

    for (var i = 0; i < rawCourseList.length; i++) {
        var rawCourse = rawCourseList[i];
        if (!rawCourse || typeof rawCourse !== "object" || !rawCourse.kcmc ||
            rawCourse.xqj == null || rawCourse.jcs == null || rawCourse.zcd == null) {
            continue;
        }

        var weeksArray = parseWeeks(rawCourse.zcd);
        if (weeksArray.length === 0) {
            continue;
        }

        var sectionMatch = String(rawCourse.jcs).match(/^\s*(?:第)?(\d+)\s*(?:-\s*(\d+))?\s*节?\s*$/);
        if (!sectionMatch) {
            console.warn("JS: 跳过无法解析节次的课程：" + rawCourse.kcmc + "，节次=" + rawCourse.jcs);
            continue;
        }
        var startSection = Number(sectionMatch[1]);
        var endSection = Number(sectionMatch[2] || sectionMatch[1]);
        var day = Number(rawCourse.xqj);

        if (!Number.isInteger(day) || !Number.isInteger(startSection) || !Number.isInteger(endSection) ||
            day < 1 || day > 7 || startSection < 1 || endSection < startSection) {
            continue;
        }

        finalCourseList.push({
            name: cleanCourseName(String(rawCourse.kcmc)),
            teacher: rawCourse.xm == null ? "" : String(rawCourse.xm).trim(),
            position: rawCourse.cdmc == null ? "" : String(rawCourse.cdmc).trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }

    finalCourseList = mergeAndDistinctCourses(finalCourseList);

    console.log("JS: JSON 数据解析完成，共找到 " + finalCourseList.length + " 门课程。");
    return finalCourseList;
}

/**
 * 构建课表配置，从课程数据中推断最大周次。
 */
function buildCourseConfig(courses) {
    var maxWeek = 0;
    for (var i = 0; i < courses.length; i++) {
        var course = courses[i];
        for (var j = 0; j < course.weeks.length; j++) {
            if (course.weeks[j] > maxWeek) {
                maxWeek = course.weeks[j];
            }
        }
    }
    return {
        semesterStartDate: null,
        semesterTotalWeeks: maxWeek || 20,
        firstDayOfWeek: 1
    };
}

/**
 * 检查是否在登录页面。
 */
function isLoginPage() {
    var url = window.location.href;
    return url.indexOf("/jwglxt/xtgl/login_slogin.html") !== -1;
}

async function promptUserToStart() {
    console.log("JS: 流程开始：显示公告。");
    return await window.shiguangBridgePromise.showAlert(
        "青岛理工大学课表导入",
        "导入前请确保您已在浏览器中成功登录青岛理工大学教务系统。\n脚本将通过正方教务接口读取课表。",
        "好的，开始导入"
    );
}

function parseSelectOptions(selectElement) {
    if (!selectElement) return { options: [], defaultIndex: 0 };
    var options = [];
    var defaultIndex = 0;
    Array.from(selectElement.querySelectorAll("option")).forEach(function(option) {
        var value = String(option.value || "").trim();
        if (!value) return;
        var text = String(option.textContent || "").trim() || value;
        if (option.selected) defaultIndex = options.length;
        options.push({ value: value, text: text });
    });
    return { options: options, defaultIndex: defaultIndex };
}

function parseTermOptions(doc) {
    var yearData = parseSelectOptions(doc.querySelector("#xnm"));
    var semesterData = parseSelectOptions(doc.querySelector("#xqm"));
    if (!yearData.options.length || !semesterData.options.length) {
        throw new Error("课表页面未找到有效的学年或学期选项");
    }
    return { yearData: yearData, semesterData: semesterData };
}

function isOnTimetablePage() {
    return window.location.pathname.indexOf("/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html") !== -1;
}

function readCurrentTerm() {
    var yearElement = document.querySelector("#xnm");
    var semesterElement = document.querySelector("#xqm");
    var academicYear = yearElement ? String(yearElement.value || "").trim() : "";
    var semesterCode = semesterElement ? String(semesterElement.value || "").trim() : "";
    if (!academicYear || !semesterCode) {
        throw new Error("当前课表页面未读取到学年学期，请先在教务系统页面选择学年和学期");
    }
    return { academicYear: academicYear, semesterCode: semesterCode };
}

async function fetchTermPage() {
    var url = BASE_URL + "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default";
    var response = await fetch(url, { method: "GET", credentials: "include" });
    if (!response.ok) throw new Error("读取课表页面失败：HTTP " + response.status);
    return new DOMParser().parseFromString(await response.text(), "text/html");
}

async function selectTermFromPage(doc) {
    var termData = parseTermOptions(doc);
    var yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(termData.yearData.options.map(function(item) { return item.text; })), termData.yearData.defaultIndex
    );
    if (yearIndex === null || yearIndex === -1 || !termData.yearData.options[yearIndex]) throw new Error("已取消或无法识别学年选择");

    var semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(termData.semesterData.options.map(function(item) { return item.text; })), termData.semesterData.defaultIndex
    );
    if (semesterIndex === null || semesterIndex === -1 || !termData.semesterData.options[semesterIndex]) throw new Error("已取消或无法识别学期选择");

    return {
        academicYear: termData.yearData.options[yearIndex].value,
        semesterCode: termData.semesterData.options[semesterIndex].value
    };
}

async function resolveTerm() {
    if (isOnTimetablePage()) return readCurrentTerm();
    return await selectTermFromPage(await fetchTermPage());
}

function normalizeStartDate(value) {
    var match = String(value || "").match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
    if (!match) return null;
    return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function findSemesterStartDate(value) {
    if (value == null) return null;
    if (typeof value !== "object") return normalizeStartDate(value);

    if (Array.isArray(value)) {
        var firstWeek = value.find(function(item) {
            return item && (String(item.zs) === "1" || String(item.zsmc) === "1");
        }) || value[0];
        var firstWeekDate = findSemesterStartDate(firstWeek);
        if (firstWeekDate) return firstWeekDate;
        for (var i = 0; i < value.length; i++) {
            var date = findSemesterStartDate(value[i]);
            if (date) return date;
        }
        return null;
    }

    var fields = ["zrq", "zcrq", "rq", "ksrq"];
    for (var j = 0; j < fields.length; j++) {
        var fieldDate = normalizeStartDate(value[fields[j]]);
        if (fieldDate) return fieldDate;
    }
    var values = Object.values(value);
    for (var k = 0; k < values.length; k++) {
        var nestedDate = findSemesterStartDate(values[k]);
        if (nestedDate) return nestedDate;
    }
    return null;
}

async function fetchSemesterStartDate(academicYear, semesterCode) {
    var url = BASE_URL + "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
    var requestBody = "xnm=" + encodeURIComponent(academicYear) + "&xqm=" + encodeURIComponent(semesterCode);

    try {
        var response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });
        if (!response.ok) {
            console.warn("JS: 开学日期接口请求失败：HTTP " + response.status);
            return null;
        }
        var responseText = await response.text();
        var data;
        try {
            data = JSON.parse(responseText);
        } catch (error) {
            console.warn("JS: 开学日期接口未返回 JSON，可能登录已过期。", error);
            return null;
        }
        var startDate = findSemesterStartDate(data);
        if (!startDate) console.warn("JS: 校历响应中未找到第 1 周开学日期。");
        else console.log("JS: 获取到开学日期：" + startDate);
        return startDate;
    } catch (error) {
        console.warn("JS: 获取学期开学日期失败：", error);
        return null;
    }
}

/**
 * 请求和解析课程数据。
 */
async function fetchAndParseCourses(academicYear, semesterCode) {
    window.shiguangBridge.showToast("正在获取课表数据...");

    var requestBody = "xnm=" + encodeURIComponent(academicYear) +
                      "&xqm=" + encodeURIComponent(semesterCode) +
                      "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
    var url = BASE_URL + "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N253508";

    console.log("JS: 发送请求到 " + url + ", body: " + requestBody);

    var requestOptions = {
        "headers": {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
        },
        "body": requestBody,
        "method": "POST",
        "credentials": "include"
    };

    try {
        var requests = await Promise.all([fetch(url, requestOptions), fetchSemesterStartDate(academicYear, semesterCode)]);
        var response = requests[0];
        var semesterStartDate = requests[1];
        var jsonText = await response.text();
        var responseType = response.headers && response.headers.get
            ? response.headers.get("content-type") || "未知"
            : "未知";
        var responsePreview = jsonText.replace(/\s+/g, " ").trim().slice(0, 200) || "<空响应>";

        if (!response.ok) {
            var sessionHint = response.status === 901
                ? "；QUT 教务系统通常用 901 表示登录会话无效或已过期，请重新登录后停留在教务系统页面再测试"
                : "";
            throw new Error(
                "QUT 课表接口请求失败：HTTP " + response.status +
                (response.statusText ? " " + response.statusText : "") +
                sessionHint +
                "；响应类型=" + responseType +
                "；最终地址=" + (response.url || url) +
                "；响应摘要=" + responsePreview
            );
        }

        if (jsonText.indexOf("登录") !== -1 && jsonText.indexOf("密码") !== -1) {
            throw new Error(
                "QUT 课表接口返回了登录页面，当前登录会话已失效。" +
                "请重新登录教务系统后再导入；最终地址=" + (response.url || url) +
                "；响应类型=" + responseType
            );
        }

        var jsonData;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            throw new Error(
                "QUT 课表接口未返回有效 JSON：" + e.message +
                "；响应类型=" + responseType +
                "；最终地址=" + (response.url || url) +
                "；响应摘要=" + responsePreview
            );
        }

        var courses = parseJsonData(jsonData);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }

        console.log("JS: 课程数据解析成功，共找到 " + courses.length + " 门课程。");

        var config = buildCourseConfig(courses);
        config.semesterStartDate = semesterStartDate;

        return { courses: courses, config: config };

    } catch (error) {
        window.shiguangBridge.showToast("请求或解析失败: " + error.message);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

/**
 * 从正方系统获取该学期真实的节次作息时间。
 */
async function fetchAndParseTimeSlots(academicYear, semesterCode) {
    var baseUrl = BASE_URL + "/jwglxt/kbcx/xskbcx_cxRjc.html";
    var requestBody = "xnm=" + encodeURIComponent(academicYear) +
                      "&xqm=" + encodeURIComponent(semesterCode) +
                      "&kzlx=ck&xsdm=&kclbdm=&kclxdm=";
    var gnmkdms = ["N2151", "N253508"];
    var lastError = null;

    for (var i = 0; i < gnmkdms.length; i++) {
        var url = baseUrl + "?gnmkdm=" + gnmkdms[i];
        try {
            var response = await fetch(url, {
                "headers": {
                    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                },
                "body": requestBody,
                "method": "POST",
                "credentials": "include"
            });
            if (!response.ok) {
                lastError = "HTTP " + response.status;
                console.warn("JS: 节次时间接口请求失败(gnmkdm=" + gnmkdms[i] + ")：HTTP " + response.status);
                continue;
            }

            var responseText = await response.text();
            var responsePreview = responseText.replace(/\s+/g, " ").trim().slice(0, 200) || "<空响应>";

            var data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                lastError = "非 JSON：响应=" + responsePreview;
                console.warn("JS: 节次时间接口未返回 JSON(gnmkdm=" + gnmkdms[i] + ")：", e, "响应摘要=" + responsePreview);
                continue;
            }

            if (data && !Array.isArray(data) && Array.isArray(data.data)) {
                data = data.data;
            }
            if (!Array.isArray(data)) {
                lastError = "格式异常：响应=" + responsePreview;
                console.warn("JS: 节次时间接口返回格式异常(gnmkdm=" + gnmkdms[i] + ")：响应摘要=" + responsePreview);
                continue;
            }

            var timeSlots = [];
            for (var j = 0; j < data.length; j++) {
                var item = data[j];
                if (!item || typeof item !== "object") continue;

                var number = Number(item.jcdm != null ? item.jcdm : item.jcmc);
                var startTime = "";
                var endTime = "";
                if (item.qssj != null && item.jssj != null) {
                    startTime = String(item.qssj).trim();
                    endTime = String(item.jssj).trim();
                } else if (item.sksj) {
                    var sksjParts = String(item.sksj).split(/[~\-—至到]/);
                    if (sksjParts.length >= 2) {
                        startTime = sksjParts[0].trim();
                        endTime = sksjParts[1].trim();
                    }
                }
                startTime = startTime.slice(0, 5);
                endTime = endTime.slice(0, 5);
                if (!(number > 0) || !startTime || !endTime) continue;

                timeSlots.push({ number: number, startTime: startTime, endTime: endTime });
            }

            timeSlots.sort(function(a, b) { return a.number - b.number; });

            if (timeSlots.length === 0) {
                lastError = "无有效数据：响应=" + responsePreview;
                console.warn("JS: 节次时间接口未返回有效作息时间(gnmkdm=" + gnmkdms[i] + ")：响应摘要=" + responsePreview);
                continue;
            }

            console.log("JS: 获取到真实节次作息 " + timeSlots.length + " 条(gnmkdm=" + gnmkdms[i] + ")，第1节 " +
                timeSlots[0].startTime + "-" + timeSlots[0].endTime);
            return timeSlots;
        } catch (error) {
            lastError = error.message || String(error);
            console.warn("JS: 获取节次作息时间失败(gnmkdm=" + gnmkdms[i] + ")：", error);
        }
    }

    console.warn("JS: 所有节次时间接口尝试均失败，最后原因：" + lastError);
    return null;
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast("正在保存 " + parsedCourses.length + " 门课程...");
    console.log("JS: 尝试保存 " + parsedCourses.length + " 门课程...");
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("课程保存失败: " + error.message);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

// 青岛理工大学统一作息时间（兜底，接口获取失败时使用）
var TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:55", endTime: "10:40" },
    { number: 4, startTime: "10:45", endTime: "11:30" },
    { number: 5, startTime: "11:35", endTime: "12:20" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:55", endTime: "16:40" },
    { number: 9, startTime: "16:45", endTime: "17:30" },
    { number: 10, startTime: "19:00", endTime: "19:45" }
];

async function importPresetTimeSlots(timeSlots) {
    console.log("JS: 准备导入 " + timeSlots.length + " 个预设时间段。");

    if (timeSlots.length > 0) {
        window.shiguangBridge.showToast("正在导入 " + timeSlots.length + " 个预设时间段...");
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
            window.shiguangBridge.showToast("预设时间段导入成功！");
            console.log("JS: 预设时间段导入成功。");
        } catch (error) {
            window.shiguangBridge.showToast("导入时间段失败: " + error.message);
            console.error('JS: Save Time Slots Error:', error);
        }
    } else {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        console.warn("JS: 警告：传入时间段为空，未导入时间段信息。");
    }
}

async function runImportFlow() {
    try {
        if (isLoginPage()) {
            throw new Error("当前是登录页面，请先登录青岛理工大学教务系统");
        }

        window.shiguangBridge.showToast("拾光课程表 - 青岛理工大学适配");

        var alertConfirmed = await promptUserToStart();
        if (!alertConfirmed) {
            window.shiguangBridge.showToast("用户取消了导入。");
            console.log("JS: 用户取消了导入流程。");
            return;
        }

        var term = await resolveTerm();
        console.log("JS: 已选择学年学期: " + term.academicYear + ", " + term.semesterCode);

        var result = await fetchAndParseCourses(term.academicYear, term.semesterCode);
        if (result === null) {
            console.log("JS: 课程获取或解析失败，流程终止。");
            return;
        }
        var courses = result.courses;
        var config = result.config;

        var saveResult = await saveCourses(courses);
        if (!saveResult) {
            console.log("JS: 课程保存失败，流程终止。");
            return;
        }

        var timeSlots = await fetchAndParseTimeSlots(term.academicYear, term.semesterCode);
        if (timeSlots === null) {
            timeSlots = TimeSlots;
            window.shiguangBridge.showToast("未获取到学校作息时间，已使用内置统一作息作为兜底。");
        }

        if (timeSlots.length > 0) {
            var firstSlotDuration = Math.round(
                (timeSlots[0].endTime.slice(0, 2) * 60 + Number(timeSlots[0].endTime.slice(3, 5))) -
                (timeSlots[0].startTime.slice(0, 2) * 60 + Number(timeSlots[0].startTime.slice(3, 5)))
            );
            if (firstSlotDuration >= 20) {
                config.defaultClassDuration = Math.round(firstSlotDuration / 5) * 5;
                config.defaultBreakDuration = 10;
            }
        }

        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
            window.shiguangBridge.showToast("课表配置更新成功！总周数：" + config.semesterTotalWeeks + "周。");
        } catch (error) {
            window.shiguangBridge.showToast("课表配置保存失败: " + error.message);
            console.error('JS: Save Config Error:', error);
        }

        await importPresetTimeSlots(timeSlots);

        window.shiguangBridge.showToast("成功导入 " + courses.length + " 门课程！");
        console.log("JS: 整个导入流程执行完毕并成功。");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("导入失败: " + error.message);
        console.error("JS: 导入流程失败:", error);
    }
}

runImportFlow();
