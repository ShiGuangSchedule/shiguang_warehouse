// 湖北经济学院(hbue.edu.cn) 拾光课程表适配脚本
// 基于正方教务(jwglxt) HTML 页面抓取，结构与徐州工程学院(XZIT)适配一致

// 湖北经济学院作息时间表（依据学校官方校历卡，共 12 节）
const TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:50", endTime: "10:35" },
    { number: 4, startTime: "10:40", endTime: "11:25" },
    { number: 5, startTime: "11:30", endTime: "12:15" },
    { number: 6, startTime: "14:00", endTime: "14:45" },
    { number: 7, startTime: "14:50", endTime: "15:35" },
    { number: 8, startTime: "15:50", endTime: "16:35" },
    { number: 9, startTime: "16:40", endTime: "17:25" },
    { number: 10, startTime: "18:30", endTime: "19:15" },
    { number: 11, startTime: "19:20", endTime: "20:05" },
    { number: 12, startTime: "20:10", endTime: "20:55" }
];

function parseTable() {
    const regexName = /[●★○]/g;
    const courseInfoList = [];
    const $ = window.jQuery;
    if (!$) return courseInfoList;

    $("#kbgrid_table_0 td").each((i, td) => {
        if ($(td).hasClass("td_wrap") && $(td).text().trim() !== "") {
            const day = parseInt($(td).attr("id").split("-")[0], 10);

            $(td).find(".timetable_con.text-left").each((index, course) => {
                const name = $(course).find(".title font").text().replace(regexName, "").trim();
                const infoStr = $(course).find("p").eq(0).find("font").eq(1).text().trim();
                const position = $(course).find("p").eq(1).find("font").text().trim();
                const teacher = $(course).find("p").eq(2).find("font").text().trim();

                if (infoStr && infoStr.match(/\((\d+-\d+节)\)/) && infoStr.split("节)")[1]) {
                    const [sections, weeks] = parseCourseInfo(infoStr);
                    if (name && position && teacher && sections.length && weeks.length) {
                        courseInfoList.push({
                            name: name,
                            day: day,
                            weeks: weeks,
                            teacher: teacher,
                            position: position.split(/\s+/).pop(),
                            startSection: sections[0],
                            endSection: sections[sections.length - 1]
                        });
                    }
                }
            });
        }
    });

    return courseInfoList;
}

function parseList() {
    const regexName = /[●★○]/g;
    const regexWeekNum = /周数：|周/g;
    const regexPosition = /上课地点：/g;
    const regexTeacher = /教师 ：/g;
    const $ = window.jQuery;
    if (!$) return [];

    const courseInfoList = [];
    $("#kblist_table tbody").each((day, tbody) => {
        if (day > 0 && day < 8) {
            let sections;
            $(tbody).find("tr:not(:first-child)").each((trIndex, tr) => {
                let name;
                let font;

                if ($(tr).find("td").length > 1) {
                    sections = parseSections($(tr).find("td:first-child").text());
                    name = $(tr).find("td:nth-child(2)").find(".title").text().replace(regexName, "").trim();
                    font = $(tr).find("td:nth-child(2)").find("p font");
                } else {
                    name = $(tr).find("td").find(".title").text().replace(regexName, "").trim();
                    font = $(tr).find("td").find("p font");
                }

                const weekStr = $(font[0]).text().replace(regexWeekNum, "").trim();
                const weeks = parseWeeks(weekStr);
                const positionRaw = $(font[1]).text().replace(regexPosition, "").trim();
                const teacher = $(font[2]).text().replace(regexTeacher, "").trim();

                if (name && sections && weeks.length && teacher && positionRaw) {
                    courseInfoList.push({
                        name: name,
                        day: day,
                        weeks: weeks,
                        teacher: teacher,
                        position: positionRaw.split(/\s+/).pop(),
                        startSection: sections[0],
                        endSection: sections[sections.length - 1]
                    });
                }
            });
        }
    });

    return courseInfoList;
}

function parseCourseInfo(str) {
    const sections = parseSections(str.match(/\((\d+-\d+节)\)/)[1].replace(/节/g, ""));
    const weekStrWithMarker = str.split("节)")[1];
    const weeks = parseWeeks(weekStrWithMarker.replace(/周/g, "").trim());
    return [sections, weeks];
}

function parseSections(str) {
    const [start, end] = str.split("-").map(Number);
    if (isNaN(start) || isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function parseWeeks(str) {
    const segments = str.split(",");
    const weeks = [];
    const segmentRegex = /(\d+)(?:-(\d+))?\s*(\([单双]\))?/g;

    for (const segment of segments) {
        const cleanSegment = segment.replace(/周/g, "").trim();
        segmentRegex.lastIndex = 0;

        let match;
        while ((match = segmentRegex.exec(cleanSegment)) !== null) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : start;
            const flagStr = match[3] || "";

            let flag = 0;
            if (flagStr.includes("单")) {
                flag = 1;
            } else if (flagStr.includes("双")) {
                flag = 2;
            }

            for (let i = start; i <= end; i += 1) {
                if (flag === 1 && i % 2 !== 1) continue;
                if (flag === 2 && i % 2 !== 0) continue;
                if (!weeks.includes(i)) {
                    weeks.push(i);
                }
            }
        }
    }

    return weeks.sort((a, b) => a - b);
}

function buildCourseConfig(courses) {
    let maxWeek = 0;
    for (const course of courses) {
        for (const week of course.weeks) {
            if (week > maxWeek) {
                maxWeek = week;
            }
        }
    }

    return {
        semesterTotalWeeks: maxWeek || 20,
        firstDayOfWeek: 1
    };
}

async function scrapeAndParseCourses() {
    window.shiguangBridge.showToast("正在检查页面并抓取课程数据...");
    const tips = "1. 登录湖北经济学院教务系统(jwxt.hbue.edu.cn)\n2. 进入「信息查询 → 学生个人课表」\n3. 选择正确学年、学期并点击【查询】\n4. 确认页面已显示课表\n5. 点击下方【一键导入】";

    try {
        const response = await fetch(window.location.href);
        const text = await response.text();
        if (!text.includes("课表查询")) {
            await window.shiguangBridgePromise.showAlert("导入失败", `当前页面似乎不是学生课表查询页面。请检查：\n${tips}`, "确定");
            return null;
        }

        const typeElement = document.querySelector("#shcPDF");
        if (!typeElement) {
            await window.shiguangBridgePromise.showAlert("导入失败", "未能识别课表视图类型，请确认您已点击查询且课表已加载完毕。", "确定");
            return null;
        }

        const type = typeElement.dataset.type;
        const tableElement = document.querySelector(type === "list" ? "#kblist_table" : "#kbgrid_table_0");
        if (!tableElement) {
            await window.shiguangBridgePromise.showAlert("导入失败", `未能找到课表主体（${type} 视图），请确认您已点击查询且课表已加载完毕。`, "确定");
            return null;
        }

        const courses = type === "list" ? parseList() : parseTable();
        if (!courses.length) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查学年学期是否正确或本学期无课。");
            return null;
        }

        return {
            courses: courses,
            config: buildCourseConfig(courses)
        };
    } catch (error) {
        window.shiguangBridge.showToast(`抓取或解析失败: ${error.message}`);
        console.error("JS: Scrape/Parse Error:", error);
        await window.shiguangBridgePromise.showAlert("抓取或解析失败", `发生错误：${error.message}`, "确定");
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
        console.error("JS: Save Courses Error:", error);
        return false;
    }
}

async function saveCourseConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error("JS: Save Config Error:", error);
    }
}

async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast(`导入时间段失败: ${error.message}`);
        console.error("JS: Save Time Slots Error:", error);
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "湖北经济学院课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统，并处于课表查询页面且已点击查询。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    if (typeof window.jQuery === "undefined" && typeof $ === "undefined") {
        const errorMsg = "当前教务系统页面似乎没有加载 jQuery 库。本脚本依赖 jQuery 进行 DOM 解析。";
        window.shiguangBridge.showToast(errorMsg);
        await window.shiguangBridgePromise.showAlert("导入失败", `${errorMsg}\n请尝试刷新页面后重试。`, "确定");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (result === null) {
        return;
    }

    const { courses, config } = result;
    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        return;
    }

    await saveCourseConfig(config);
    await importPresetTimeSlots();
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
