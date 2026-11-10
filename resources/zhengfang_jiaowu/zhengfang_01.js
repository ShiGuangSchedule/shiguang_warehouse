// 基于 HTML 页面抓取的拾光课表正方适配脚本

/**
 * 解析表格
 */
function parserTbale() {
    const regexName = /[●★○]/g;
    const courseInfoList = [];

    document.querySelectorAll('#kbgrid_table_0 td').forEach((td) => {
        if (td.classList.contains('td_wrap') && td.textContent.trim() !== '') {
            const day = parseInt(td.getAttribute('id').split('-')[0]);

            td.querySelectorAll('.timetable_con.text-left').forEach((course) => {
                const name = [...course.querySelectorAll('.title font')].map(e => e.textContent).join('').replace(regexName, '').trim();

                const ps = course.querySelectorAll('p');
                const infoStr = ps[0]?.querySelectorAll('font[color]')[1]?.textContent.trim() || '';
                const position = ps[1] ? [...ps[1].querySelectorAll('font[color]')].map(e => e.textContent).join('').trim() : '';
                const teacherRaw = ps[2] ? [...ps[2].querySelectorAll('font[color]')].map(e => e.textContent).join('').trim() : '';
                const teacher = teacherRaw.replace(/[\(（][^\)）]*[\)）]/g, '').trim();

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

    let courseInfoList = [];
    document.querySelectorAll('#kblist_table tbody').forEach((tbody, day) => {
        if (day > 0 && day < 8) {
            let sections;
            tbody.querySelectorAll('tr:not(:first-child)').forEach((tr) => {
                let name, font;

                if (tr.querySelectorAll('td').length > 1) {
                    const firstTd = tr.querySelector('td:first-child');
                    sections = parserSections(firstTd.textContent);
                    const secondTd = tr.querySelector('td:nth-child(2)');
                    name = [...secondTd.querySelectorAll('.title')].map(e => e.textContent).join('').replace(regexName, '').trim();
                    font = secondTd.querySelectorAll('p font');
                } else {
                    const td = tr.querySelector('td');
                    name = [...td.querySelectorAll('.title')].map(e => e.textContent).join('').replace(regexName, '').trim();
                    font = td.querySelectorAll('p font');
                }

                const weekStr = font[0] ? font[0].textContent.replace(regexWeekNum, '').trim() : '';
                const weeks = parserWeeks(weekStr);

                const positionRaw = font[1] ? font[1].textContent.replace(regexPosition, '').trim() : '';
                const finalPosition = positionRaw.split(/\s+/).pop();

                const teacherRaw = font[2] ? font[2].textContent.replace(regexTeacher, '').trim() : '';
                const teacher = teacherRaw.replace(/[\(（][^\)）]*[\)）]/g, '').trim();

                if (name && sections && weeks.length && teacher && finalPosition) {
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
function parserSections(str) {
    const [start, end] = str.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start > end) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * 解析周次
 */
function parserWeeks(str) {
    const segments = str.split(',');
    let weeks = [];
    const segmentRegex = /(\d+)(?:-(\d+))?\s*(\([单双]\))?/g;

    for (const segment of segments) {
        const cleanSegment = segment.replace(/周/g, '').trim();
        segmentRegex.lastIndex = 0;

        let match;
        while ((match = segmentRegex.exec(cleanSegment)) !== null) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || '';

            let flag = 0;
            if (flagStr.includes('单')) {
                flag = 1;
            } else if (flagStr.includes('双')) {
                flag = 2;
            }

            for (let i = start; i <= end; i++) {
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


async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统，并处于课表查询页面且已点击查询。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const result = await scrapeAndParseCourses();
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses } = result;

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();