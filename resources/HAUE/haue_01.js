// 河南工程学院正方教务适配（待学生登录实测）
// 基于 resources/zhengfang_jiaowu/zhengfang_01.js，原维护者：星河欲转。
// 使用用户提供的全年固定作息；开学日期请在软件内核对设置。
// 基于 HTML 页面抓取的拾光课表正方适配脚本

/**
 * 解析表格
 */
function parserTbale() {
    const regexName = /[●★○]/g;
    const courseInfoList = [];
    const $ = window.jQuery; 
    if (!$) return courseInfoList;

    $('#kbgrid_table_0 td').each((i, td) => {
        if ($(td).hasClass('td_wrap') && $(td).text().trim() !== '') {
            const day = parseInt($(td).attr('id').split('-')[0]); 
            
            $(td).find('.timetable_con.text-left').each((i, course) => {
                const name = $(course).find('.title font').text().replace(regexName, '').trim();
                
                const infoStr = $(course).find('p').eq(0).find('font').eq(1).text().trim(); 
                
                const position = $(course).find('p').eq(1).find('font').text().trim();
                const teacher = $(course).find('p').eq(2).find('font').text().trim();

                if (infoStr && infoStr.match(/\((\d+-\d+节)\)/) && infoStr.split('节)')[1]) {
                    const [sections, weeks] = parserInfo(infoStr);

                    if (name && position && teacher && sections.length && weeks.length) {
                        const startSection = sections[0];
                        const endSection = sections[sections.length - 1];
                        
                        const finalPosition = position.split(/\s+/).pop();
                        
                        const data = { name, day, weeks, teacher, position: finalPosition, startSection, endSection };
                        courseInfoList.push(data);
                    }
                }
            });
        }
    });
    return courseInfoList;
}

/**
 * 解析列表
 */
function parserList() {
    const regexName = /[●★○]/g;
    const regexWeekNum = /周数：|周/g;
    const regexPosition = /上课地点：/g;
    const regexTeacher = /教师 ：/g;

    const $ = window.jQuery; 
    if (!$) return [];
    
    let courseInfoList = [];
    $('#kblist_table tbody').each((day, tbody) => {
        if (day > 0 && day < 8) { 
            let sections;
            $(tbody).find('tr:not(:first-child)').each((trIndex, tr) => {
                let name, font;
                
                if ($(tr).find('td').length > 1) { 
                    sections = parserSections($(tr).find('td:first-child').text());
                    name = $(tr).find('td:nth-child(2)').find('.title').text().replace(regexName, '').trim();
                    font = $(tr).find('td:nth-child(2)').find('p font');
                } else { 
                    name = $(tr).find('td').find('.title').text().replace(regexName, '').trim();
                    font = $(tr).find('td').find('p font');
                }
                
                const weekStr = $(font[0]).text().replace(regexWeekNum, '').trim();
                const weeks = parserWeeks(weekStr);

                const positionRaw = $(font[1]).text().replace(regexPosition, '').trim(); 
                const finalPosition = positionRaw.split(/\s+/).pop();
                
                const teacher = $(font[2]).text().replace(regexTeacher, '').trim();
                
                if (name && sections && sections.length && weeks.length && teacher && finalPosition) {
                    const startSection = sections[0];
                    const endSection = sections[sections.length - 1];
                    
                    const data = { 
                        name, 
                        day, 
                        weeks, 
                        teacher, 
                        position: finalPosition, 
                        startSection, 
                        endSection 
                    };
                    courseInfoList.push(data);
                }
            });
        }
    });
    return courseInfoList;
}

/**
 * 解析课程信息
 */
function parserInfo(str) {
    const sections = parserSections(str.match(/\((\d+-\d+节)\)/)[1].replace(/节/g, ''));
    const weekStrWithMarker = str.split('节)')[1];
    const weeks = parserWeeks(weekStrWithMarker.replace(/周/g, '').trim());
    return [sections, weeks];
}

/**
 * 解析节次
 */
// 不依赖宿主页可能改写的 Number.isInteger；统一数字/数字字符串。
function normalizeSection(value) {
    if (typeof value !== "number" && typeof value !== "string") return NaN;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return NaN;
    const number = +text;
    return number >= 1 && number <= HAUE_TIME_SLOTS.length ? number : NaN;
}

function parserSections(str) {
    const match = String(str).trim().match(/^(\d+)\s*(?:[-～~—–]\s*(\d+))?\s*节?$/);
    if (!match) return [];
    const start = +match[1];
    const end = +(match[2] || match[1]);
    if (start < 1 || start > end || end - start > 100) return [];
    const sections = [];
    for (let n = start; n <= end; n++) sections.push(n);
    return sections;
}

/**
 * 解析周次
 */
function parserWeeks(str) {
    const segments = str.split(',');
    let weeks = [];
    const segmentRegex = /(\d+)(?:-(\d+))?\s*(\([单双]\))?/g;

    for (const segment of segments) {
        // 清理段落中的周字和多余空格
        const cleanSegment = segment.replace(/周/g, '').trim();
        
        // 重置正则的 lastIndex
        segmentRegex.lastIndex = 0;

        let match;
        // 循环匹配一个段落内可能存在的所有周次定义（虽然通常只有一个）
        while ((match = segmentRegex.exec(cleanSegment)) !== null) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || ''; // (单) 或 (双) 或 ""
            
            let flag = 0;
            if (flagStr.includes('单')) {
                flag = 1;
            } else if (flagStr.includes('双')) {
                flag = 2;
            }

            for (let i = start; i <= end; i++) {
                // 过滤单双周
                if (flag === 1 && i % 2 !== 1) continue; // 仅保留单周
                if (flag === 2 && i % 2 !== 0) continue; // 仅保留双周
                
                // 防止重复添加
                if (!weeks.includes(i)) {
                    weeks.push(i);
                }
            }
        }
    }

    // 排序并返回唯一的周次列表
    return weeks.sort((a, b) => a - b);
}

async function scrapeAndParseCourses() {
    window.shiguangBridge.showToast("正在检查页面并抓取课程数据...");
    const ts = `1.登陆教务系统\n2.导航到学生课表查询页面\n3.等待课表信息加载，选择对应学年、学期，确认无误后点击【查询】\n4.确保页面上显示了课程表\n5.点击下方【一键导入】`
    try {
        const response = await fetch(window.location.href);
        const text = await response.text();
        if (!text.includes("课表查询")) {
            console.log("页面内容检查失败！");
            await window.shiguangBridgePromise.showAlert("导入失败", "当前页面似乎不是学生课表查询页面。请检查：\n" + ts, "确定"); 
            return null;
        }
        const typeElement = document.querySelector('#shcPDF');
        if (!typeElement) {
             console.log("未能找到视图类型元素 (#shcPDF)");
             await window.shiguangBridgePromise.showAlert("导入失败", "未能识别课表视图类型，请确认您已点击查询且课表已加载完毕。", "确定");
             return null;
        }
        const type = typeElement.dataset['type'];
        const tableElement = document.querySelector(type === 'list' ? '#kblist_table' : '#kbgrid_table_0');
        if (!tableElement) {
             console.log("未能找到课表主体 HTML");
             await window.shiguangBridgePromise.showAlert("导入失败", `未能找到课表主体 (${type} 视图)，请确认您已点击查询且课表已加载完毕。`, "确定");
             return null;
        }
        let result = [];
        if (type === 'list') {
            result = parserList(); 
        } else {
            result = parserTbale(); 
        }
        if (result.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课。");
            return null;
        }
        console.log(`JS: 课程数据解析成功，共找到 ${result.length} 门课程。`);
        return { courses: result };
    } catch (error) {
        window.shiguangBridge.showToast(`抓取或解析失败: ${error.message}`);
        console.error('JS: Scrape/Parse Error:', error);
        await window.shiguangBridgePromise.showAlert("抓取或解析失败", `发生错误：${error.message}。请重试或联系开发者。`, "确定");
        return null;
    }
}

async function saveCourses(parsedCourses) {
    window.shiguangBridge.showToast(`正在保存 ${parsedCourses.length} 门课程...`);
    console.log(`JS: 尝试保存 ${parsedCourses.length} 门课程...`);
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses, null, 2));
        console.log("JS: 课程保存成功！");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}


// 按用户提供的河南工程学院课表截图逐节录入，全年一致。
const HAUE_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "15:55", endTime: "16:40" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "19:20", endTime: "20:05" },
    { number: 10, startTime: "20:10", endTime: "20:55" },
    { number: 11, startTime: "21:00", endTime: "21:45" }
];

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "河南工程学院课表导入（测试版）",
        "请先登录河南工程学院教务，打开个人课表并选择学期、点击查询。将导入课程和全年固定的第1至11节作息，不区分夏冬。开学日期请在软件内核对设置。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }
    
    if (typeof window.jQuery === 'undefined' && typeof $ === 'undefined') {
        const errorMsg = "当前教务系统页面似乎没有加载 jQuery 库。本脚本依赖 jQuery 进行 DOM 解析。";
        window.shiguangBridge.showToast(errorMsg);
        await window.shiguangBridgePromise.showAlert("导入失败", errorMsg + "\n请尝试刷新页面或使用其他导入方式。", "确定");
        console.error("JS: 缺少 jQuery 依赖，流程终止。");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses } = result;
    const invalidCourses = [];
    for (const course of courses) {
        const start = normalizeSection(course.startSection);
        const end = normalizeSection(course.endSection);
        if (start !== start || end !== end || end < start) {
            invalidCourses.push(course);
        } else {
            course.startSection = start;
            course.endSection = end;
        }
    }
    if (invalidCourses.length > 0) {
        const details = invalidCourses.slice(0, 5).map(course =>
            `${course.name || "未命名课程"}：第 ${String(course.startSection)}～${String(course.endSection)} 节（类型 ${typeof course.startSection}/${typeof course.endSection}）`
        ).join("\n");
        await window.shiguangBridgePromise.showAlert("节次超出已确认作息",
            "本校已配置第1至11节。以下课程节次异常，本次未保存，请截图联系维护者核对：\n" + details, "确定");
        return;
    }

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }
    
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(HAUE_TIME_SLOTS));
    } catch (error) {
        await window.shiguangBridgePromise.showAlert("作息保存失败",
            "课程已保存，但固定作息未保存成功，请重试导入并核对时间。错误：" + error.message, "确定");
        return;
    }
    window.shiguangBridge.showToast(`课程和全年固定作息导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
