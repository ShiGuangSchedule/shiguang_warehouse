// 文件: capadap.js
//后期可加入接口-获取校区  https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduledCampus.do
// 新版适配 - 接口新增了每个字段，可以直接使用无需再做正则提取

/**
 * 显示导入提示
 */
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "导入确认",
        "请确保您已经登录咯~",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入");
        return false;
    }
    window.shiguangBridge.showToast("开始流程咯~");
    return true;
}

/**
 * 请求工具
 */
async function api(url, options = {}) {
    const method = options.method || (options.data ? "POST" : "GET");
    const headers = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        "Referer": "https://jwxt.cap.edu.cn/jwapp/sys/kbapp/*default/index.do",
        ...(options.data && { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }),
        ...options.headers
    };
    const res = await fetch(url, {
        method: method,
        headers: headers,
        body: options.data || null,
        credentials: "include"
    });
    return res.json();
}

// ========== 共享变量 ==========
const AppConfig = {
    currentSemester: null,
    postData: null,
};

// ========== 1. 提取上课时间 & 学期信息 ==========
async function extractCourseTime() {
    try {
        // 1. 获取当前学期
        const userRes = await api(
            "https://jwxt.cap.edu.cn/jwapp/sys/homeapp/api/home/currentUser.do"
        );
        AppConfig.currentSemester = userRes.datas.welcomeInfo.xnxqdm;
        console.log("检测到当前学期:", AppConfig.currentSemester);

        AppConfig.postData = `XNXQDM=${AppConfig.currentSemester}&XQDM=01`;

        // 2. 获取节次时间表（小节），这里原来被 return 挡在后面了
        const sectionRes = await api(
            "https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMySectionList.do",
            { data: AppConfig.postData }
        );
        const rawSections = sectionRes.datas.getMySectionList;
        const cleanSections = rawSections
            .filter(item => item.name.includes("第"))
            .map(item => ({
                number: parseInt(item.name.replace(/[^0-9]/g, "")),
                startTime: item.startTime,
                endTime: item.endTime
            }))
            .sort((a, b) => a.number - b.number);
        console.log("节次时间表:", cleanSections);

        // 3. 获取学期周次
        const weekRes = await api(
            "https://jwxt.cap.edu.cn/jwapp/sys/homeapp/api/home/getTermWeeks.do",
            { data: `termCode=${AppConfig.currentSemester}` }
        );
        const finalWeeks = weekRes.datas.map(item => ({
            week: item.serialNumber,
            startTime: item.startDate.split(' ')[0],
            endTime: item.endDate.split(' ')[0],
            isCurrent: item.curWeek
        }));
        const totalWeeks = finalWeeks.length;
        const startDate = finalWeeks[0].startTime;
        console.log("学期信息:", {
            semester: AppConfig.currentSemester,
            totalWeeks,
            startDate
        });

        // 把 cleanSections 带出去
        return {
            currentSemester: AppConfig.currentSemester,
            totalWeeks,
            startDate,
            cleanSections
        };
    } catch (error) {
        console.error('解析基础信息时出错:', error);
        window.shiguangBridge.showToast(`解析失败: ${error.message}`);
        return null;
    }
}

// ========== 2. 获取课表原始数据 ==========
async function getCourseData(totalWeeks) {
    const allRaw = [];
    const seen = new Set();

    const weekRequests = [];
    for (let zc = 1; zc <= totalWeeks; zc++) {
        weekRequests.push(
            api("https://jwxt.cap.edu.cn/jwapp/sys/kbapp/api/wdkbcx/getMyScheduleDetail.do", {
                data: `${AppConfig.postData}&ZC=${zc}`,
            }).then(res => {
                const list = res?.datas?.getMyScheduleDetail?.arrangedList || [];
                list.forEach(item => {
                    // 更精确的去重键：课程名+教学班ID+星期+节次+周次字符串
                    // 加上周次字符串可以避免同一门课在不同周被误判为重复
                    const key = `${item.courseCode || item.courseName}|${item.teachClassId}|${item.dayOfWeek}|${item.beginSection}`;
                    
                    if (!seen.has(key)) {
                        seen.add(key);
                        allRaw.push(item);
                    }
                });
            }).catch(e => {
                console.warn(`第${zc}周请求失败:`, e.message);
            })
        );
    }

    await Promise.all(weekRequests);
    console.log(`获取到 ${allRaw.length} 条课程数据（含短期实验/实习）`);
    return allRaw;
}

// ========== 3. 辅助周次解析函数 ==========
function parseWeekString(weekStr) {
    // "101101011111111111" -> [1,3,4,6,8,9,...]
    if (!weekStr) return [];
    const weeks = [];
    for (let i = 0; i < weekStr.length; i++) {
        if (weekStr[i] === '1') {
            weeks.push(i + 1);
        }
    }
    return weeks;
}

/**
 * 解析学期间的周次描述，例如 "14-15周"、"3周"、"1-3周(单),7周,11-17周(单)"
 * 返回周次数组
 */
function parseWeeksDescription(desc) {
    if (!desc) return [];
    const weeks = [];
    // 预处理：去掉“周”字、空格，中文逗号变英文
    let clean = desc.replace(/\s+/g, '').replace(/，/g, ',').replace(/周/g, '');

    const segments = clean.split(',');
    segments.forEach(seg => {
        // 检测单双周标记
        const isOdd = seg.includes('(单)');
        const isEven = seg.includes('(双)');
        seg = seg.replace(/\(单\)|\(双\)/g, '');

        if (seg.includes('-')) {
            const [start, end] = seg.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                if (isOdd && i % 2 === 0) continue;
                if (isEven && i % 2 !== 0) continue;
                weeks.push(i);
            }
        } else {
            const num = parseInt(seg);
            if (!isNaN(num)) {
                if (isOdd && num % 2 === 0) return;
                if (isEven && num % 2 !== 0) return;
                weeks.push(num);
            }
        }
    });
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// ========== 4. 从HTML片段中提取教师姓名 ==========
function extractTeacherFromHTML(html) {
    if (!html) return null;
    const match = html.match(/<a[^>]*>([^<]+)<\/a>/);
    return match ? match[1].trim() : null;
}

/**
 * 从描述文本中提取非教师、非校区的备注地点
 */
function extractExtraLocation(htmlText, campusName, teacher) {
    if (!htmlText) return '';
    // 去掉所有HTML标签
    let clean = htmlText.replace(/<[^>]+>/g, ' ').trim();
    // 去掉已知校区名
    if (campusName) clean = clean.replace(new RegExp(campusName, 'g'), '');
    // 去掉开头的周次描述
    clean = clean.replace(/^\d+(-\d+)?周\s*/, '');
    // 去掉教师姓名（如果传入）
    if (teacher) clean = clean.replace(new RegExp(teacher, 'g'), '');
    // 清理多余空格
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean;
}

// ========== 5. 核心解析函数：将单条 raw item 解析为多个 course 片段 ==========
function parseCourseItem(item) {
    const courseName = item.courseName;
    const day = item.dayOfWeek;
    const beginSection = item.beginSection;
    const endSection = item.endSection;
    const campusName = item.campusName || '';
    const placeName = item.placeName || '';
    const tags = item.tags || [];

    // 优先使用 cellWeekTeacherClassroomDetail，如果为空则用 multiCourseTitleDetail 或 titleDetail
    let segmentsSource = [];

    if (item.cellWeekTeacherClassroomDetail && item.cellWeekTeacherClassroomDetail.length > 0) {
        segmentsSource = item.cellWeekTeacherClassroomDetail.map(cell => cell.text);
    } else if (item.multiCourseTitleDetail && item.multiCourseTitleDetail.length > 1) {
        segmentsSource = item.multiCourseTitleDetail
            .slice(1)
            .filter(line => {
                const plainText = line.replace(/<[^>]+>/g, '').trim();
                // 过滤掉纯数字/逗号/空格组成的行（班级列表）
                if (/^[\d,\s]+$/.test(plainText)) return false;
                // 过滤掉空行
                return plainText.length > 0;
            })
            .map(line => line.trim())
            .filter(line => line !== '');
    } else if (item.titleDetail && item.titleDetail.length > 1) {
        // ✅ 兜底：只有 titleDetail 时，用其中第一行教师/地点信息
        segmentsSource = [item.titleDetail[1]];
    }

    const courses = [];
    // 保存总周次作为兜底
    const totalWeeks = parseWeekString(item.week || '');

    segmentsSource.forEach(segText => {
        const teacher = extractTeacherFromHTML(segText) || '未知教师';
        let weeks;
        // 尝试从文本中提取周次描述
        const weekDescMatch = segText.match(/^([\d\-\(\),周单双\s]+?)\s*</);
        if (weekDescMatch && weekDescMatch[1]) {
            const wd = weekDescMatch[1].trim();
            weeks = parseWeeksDescription(wd);
            if (weeks.length === 0) weeks = totalWeeks;
        } else {
            weeks = totalWeeks;
        }

        // 确定地点
        let position;
        if (placeName) {
            position = (campusName && !placeName.includes(campusName)) ? `${campusName} ${placeName}` : placeName;
        } else {
            // placeName 为空时，从描述提取备注
            const extra = extractExtraLocation(segText, campusName, teacher);
            position = campusName ? `${campusName} ${extra}`.trim() : extra;
        }
        position = position || campusName || '未知地点';

        courses.push({
            name: courseName,
            teacher: teacher,
            position: position.trim(),
            day: day,
            startSection: beginSection,
            endSection: endSection,
            weeks: weeks,
            campusName: campusName,
            rawPlaceName: placeName,
            hasExperimentTag: tags.some(t => t.text === '实')
        });
    });

    return courses;
}

// ========== 6. 聚合所有课程并映射小节编号 ==========
function parseAllCourses(rawArrangedList, sectionList) {
    const allCourses = [];

    if (!rawArrangedList || !Array.isArray(rawArrangedList)) {
        return { courses: [], timeSlots: [] };
    }

    // 构建时间 -> 小节编号 的映射
    const startTimeToSection = {};
    const endTimeToSection = {};
    sectionList.forEach(slot => {
        startTimeToSection[slot.startTime] = slot.number;
        endTimeToSection[slot.endTime] = slot.number;
    });

    rawArrangedList.forEach(item => {
        if (item.dayOfWeek === null || item.beginSection === null) return;

        // 根据 beginTime 和 endTime 查找正确的小节区间
        const realStart = startTimeToSection[item.beginTime];
        const realEnd = endTimeToSection[item.endTime];

        if (realStart === undefined || realEnd === undefined) {
            // 时间无法匹配，丢弃该课程（或使用原始值，但不推荐）
            console.warn(`课程 ${item.courseName} 时间无法匹配时间槽: ${item.beginTime}-${item.endTime}`);
            return;
        }

        // 用正确的小节编号覆盖原始 beginSection/endSection
        const correctedItem = {
            ...item,
            beginSection: realStart,
            endSection: realEnd
        };

        const courses = parseCourseItem(correctedItem);
        allCourses.push(...courses);
    });

    // 时间槽直接使用 sectionList，编号保持 1,2,3...
    const timeSlots = sectionList.map(sec => ({
        number: sec.number,
        startTime: sec.startTime,
        endTime: sec.endTime
    }));

    console.log(`解析完成，共 ${allCourses.length} 个课程片段，${timeSlots.length} 个时间段`);
    return { courses: allCourses, timeSlots };
}


// ========== 7. 获取所有数据 ==========
async function fetchAllRawData() {
    const baseInfo = await extractCourseTime();
    if (!baseInfo) return null;

    const rawArrangedList = await getCourseData(baseInfo.totalWeeks);

    if (!rawArrangedList || rawArrangedList.length === 0) {
        window.shiguangBridge.showToast("未检测到当前学期的课程数据");
        return null;
    }
    return { baseInfo, rawArrangedList };
}

// ========== 8. 保存配置 ==========
async function saveConfig(baseInfo) {
    const configData = {
        semesterStartDate: baseInfo.startDate,
        semesterTotalWeeks: baseInfo.totalWeeks || 20,
    };
    try {
        const configSuccess = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(configData));
        if (!configSuccess) {
            window.shiguangBridge.showToast("学期保存失败");
            return false;
        }
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存配置失败: " + error.message);
        return false;
    }
}

// ========== 9. 主导入流程 ==========
async function runImportFlow() {
    try {
        const isReady = await promptUserToStart();
        if (!isReady) return;

        const dataBundle = await fetchAllRawData();
        if (!dataBundle) return;

        const { courses: finalCourses, timeSlots } = parseAllCourses(dataBundle.rawArrangedList, dataBundle.baseInfo.cleanSections);
        if (finalCourses.length === 0) {
            window.shiguangBridge.showToast("解析失败：未能提取到有效课程");
            return;
        }

        // 保存学期配置
        const configSaveResult = await saveConfig(dataBundle.baseInfo);
        if (!configSaveResult) return;

        // 保存时间段 (基于实际课程生成的大节)
        try {
            const slotJson = JSON.stringify(timeSlots);
            console.log("写入时间段数据:", slotJson);
            await window.shiguangBridgePromise.savePresetTimeSlots(slotJson);
        } catch (e) {
            console.error("时间段写入失败:", e);
            window.shiguangBridge.showToast("时间段保存失败");
            return;
        }

        // 保存课程数据
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        if (!saveResult) {
            window.shiguangBridge.showToast("课程数据保存失败");
            return;
        }

        window.shiguangBridge.showToast("Hi ~ 课表导入成功！");
        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        console.error("主流程异常:", error);
        window.shiguangBridge.showToast("意外错误: " + error.message);
    }
}

// 启动导入流程
runImportFlow();