// 广州航海学院(gzmtu.edu.cn) 拾光课程表适配脚本


/**
 * 节次与周次合并去重函数 
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));
    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
               (a.startSection || 0) - (b.startSection || 0);
    });
    const step1Merged = [];
    let current = list[0];
    for (let i = 1; i < list.length; i++) {
        const next = list[i];
        const isSameCourseAndWeeks =
            current.name === next.name && current.teacher === next.teacher &&
            current.position === next.position && current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');
        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;
        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });
    const step2Merged = [];
    let cur = step1Merged[0];
    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];
        const isSameCourseAndSection =
            cur.name === nxt.name && cur.teacher === nxt.teacher &&
            cur.position === nxt.position && cur.day === nxt.day &&
            cur.startSection === nxt.startSection && cur.endSection === nxt.endSection;
        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);
    return step2Merged;
}

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weekSets = weekStr.split(/[,，]/);
    let weeks = [];
    for (const set of weekSets) {
        const trimmedSet = set.trim();
        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周?/);
        const singleMatch = trimmedSet.match(/^(\d+)周?/);
        let start = 0, end = 0, processed = false;
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

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const initialCourseList = [];
    for (const rawCourse of jsonData.kbList) {
        const courseName = rawCourse.kcmc || rawCourse.kcmc_raw;
        const teacher = rawCourse.xm || "";
        const position = rawCourse.cdmc || rawCourse.cd_id || "";
        const day = Number(rawCourse.xqj);
        const zcd = rawCourse.zcd;
        const jcStr = rawCourse.jcor || rawCourse.jcs || rawCourse.jc;
        if (!courseName || !day || !zcd || !jcStr) continue;
        const weeksArray = parseWeeks(zcd);
        if (weeksArray.length === 0) continue;
        const sectionParts = jcStr.split('-').map(Number).filter(n => !isNaN(n));
        if (sectionParts.length === 0) continue;
        const startSection = Math.min(...sectionParts);
        const endSection = Math.max(...sectionParts);
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) continue;
        initialCourseList.push({
            name: courseName.trim(),
            teacher: teacher.trim(),
            position: position.trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        });
    }
    return mergeAndDistinctCourses(initialCourseList);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "广州航海学院教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

async function fetchAcademicOptions() {
    // 移动端强化：增加 layout=default 强制正方返回 PC 版结构，避免移动版精简页面丢失选项
    const url = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default";
    try {
        const response = await fetch(url, { method: "GET", credentials: "include" });
        if (!response.ok) return null;
        const htmlText = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");
        
        const allYearOptions = Array.from(doc.querySelectorAll("#xnm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));
        
        const semesterOptions = Array.from(doc.querySelectorAll("#xqm option"))
            .filter(opt => opt.value !== "")
            .map(opt => ({ value: opt.value, text: opt.textContent.trim(), selected: opt.selected }));
            
        if (allYearOptions.length === 0 || semesterOptions.length === 0) return null;
        
        const selectedIndex = allYearOptions.findIndex(opt => opt.selected);
        if (selectedIndex === -1) {
            return {
                yearOptions: allYearOptions.slice(0, 5),
                semesterOptions,
                defaultYearIndex: 0,
                defaultSemesterIndex: semesterOptions.findIndex(opt => opt.selected) !== -1 ? semesterOptions.findIndex(opt => opt.selected) : 0
            };
        }
        
        const start = Math.max(0, selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex + 3);
        const yearOptions = allYearOptions.slice(start, end);
        const newDefaultIndex = selectedIndex - start;
        const defaultSemesterIndex = semesterOptions.findIndex(opt => opt.selected);
        
        return {
            yearOptions,
            semesterOptions,
            defaultYearIndex: newDefaultIndex,
            defaultSemesterIndex: defaultSemesterIndex !== -1 ? defaultSemesterIndex : 0
        };
    } catch (e) {
        return null;
    }
}

async function selectAcademicYearAndSemester() {
    let optionsData = await fetchAcademicOptions();
    
    // 移动端强化兜底：如果 API 被移动端拦截或页面解析失败，智能生成本学年的默认选项
    if (!optionsData) {
        const d = new Date();
        const year = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
        const isFirstSemester = d.getMonth() >= 7;
        optionsData = {
            yearOptions: [
                { value: (year - 1).toString(), text: `${year - 1}-${year}` },
                { value: year.toString(), text: `${year}-${year + 1}` },
                { value: (year + 1).toString(), text: `${year + 1}-${year + 2}` }
            ],
            semesterOptions: [
                { value: "3", text: "第一学期" },
                { value: "12", text: "第二学期" }
            ],
            defaultYearIndex: 1,
            defaultSemesterIndex: isFirstSemester ? 0 : 1
        };
        window.shiguangBridge.showToast("页面获取失败，已切换为智能学年预测");
    }

    const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;
    const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学年", JSON.stringify(yearOptions.map(item => item.text)), defaultYearIndex
    );
    if (yearIndex === null || yearIndex === -1) return null;
    
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(semesterOptions.map(item => item.text)), defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;
    
    return {
        academicYear: yearOptions[yearIndex].value,
        semesterCode: semesterOptions[semesterIndex].value
    };
}

async function fetchSemesterStartDate(academicYear, semesterCode) {
    const url = window.location.origin + "/jwglxt/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154";
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}`;
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        });
        if (response.ok) {
            const jsonText = await response.text();
            let json;
            try { json = JSON.parse(jsonText); } catch(e) { return null; }
            if (Array.isArray(json) && json.length > 0) {
                const firstWeekObj = json.find(item => String(item.zs) === "1" || String(item.zsmc) === "1") || json[0];
                if (firstWeekObj.rq) {
                    const startDateStr = firstWeekObj.rq.split('/')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return startDateStr;
                }
                if (firstWeekObj.zcrq) {
                    const match = firstWeekObj.zcrq.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match) return match[1];
                }
                if (firstWeekObj.ksrq) {
                    const match = firstWeekObj.ksrq.match(/(\d{4}-\d{2}-\d{2})/);
                    if (match) return match[1];
                }
            }
        }
    } catch (e) {}
    return null;
}

async function fetchAndParseCourses(academicYear, semesterCode) {
    const requestBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const targetUrl = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151";
    const backupUrl = window.location.origin + "/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151";

    const [courseResponse, semesterStartDate] = await Promise.all([
        fetch(targetUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            body: requestBody,
            credentials: "include"
        }).catch(() => null),
        fetchSemesterStartDate(academicYear, semesterCode)
    ]);

    try {
        let resp = courseResponse;
        if (!resp || !resp.ok) {
            resp = await fetch(backupUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest"
                },
                body: requestBody,
                credentials: "include"
            });
        }
        if (resp && resp.ok) {
            const jsonText = await resp.text();
            const jsonData = JSON.parse(jsonText);
            if (jsonData && jsonData.kbList) {
                const parsedCourses = parseJsonData(jsonData);
                if (parsedCourses.length > 0) {
                    let maxWeek = 0;
                    for (const c of parsedCourses) {
                        for (const w of c.weeks) {
                            if (w > maxWeek) maxWeek = w;
                        }
                    }
                    return {
                        courses: parsedCourses,
                        config: {
                            semesterStartDate: semesterStartDate,
                            semesterTotalWeeks: 20
                        }
                    };
                }
            }
        }
    } catch (e) {}

    window.shiguangBridge.showToast("未能获取课表数据，请检查网络环境或确认页面状态。");
    return null;
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        return false;
    }
}

const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:40", endTime: "19:25" },
    { number: 10, startTime: "19:35", endTime: "20:20" }
];

async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) return;
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
    }
}

async function runImportFlow() {
    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (!selection) {
        window.shiguangBridge.showToast("未选择学年学期，导入流程终止。");
        return;
    }

    const { academicYear, semesterCode } = selection;
    const result = await fetchAndParseCourses(academicYear, semesterCode);
    if (result === null) return;

    const { courses, config } = result;
    const saveResult = await saveCourses(courses);
    if (!saveResult) return;

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        let configMsg = "课表配置更新成功！";
        if (config.semesterStartDate) {
            configMsg += ` 开学日期：${config.semesterStartDate}`;
        }
        window.shiguangBridge.showToast(configMsg);
    } catch (error) {}

    await importPresetTimeSlots(TimeSlots);
    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
