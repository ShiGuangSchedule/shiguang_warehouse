// 文件: HUAT.js - 湖北汽车工业学院课表导入（基于教务系统 API） 
// 数据源:
//   /api/semester/list  → 可选学期列表（用于学期选择 + 学期基本信息）
//   /api/teachTask/list  → 教学任务列表（按 yearTermId 过滤）

// ==================== 验证函数 ====================
function validateDate(dateStr) {
    if (!dateStr || dateStr.trim().length === 0) {
        return "日期不能为空！";
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
        return "日期格式必须是 YYYY-MM-DD！";
    }
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return "请输入有效的日期！";
    }
    return false;
}

// ==================== API 数据获取 ====================
// 用当前页面协议构造 API 基址，避免 HTTP/HTTPS 跨域
// （http:// 和 https:// 在 CORS 看来是不同 origin，会触发预检并失败）
const API_BASE = window.location.protocol + '//neweas.huat.edu.cn';

/**
 * 获取认证 token（X-Token 头的值）
 * 优先级：localStorage / sessionStorage 常见 key → Admin-Token cookie → window 全局
 */
function getAuthToken() {
    const storageKeys = ['Admin-Token', 'adminToken', 'token', 'X-Token', 'x-token', 'admin_token'];
    for (const key of storageKeys) {
        const v = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (v) return v;
    }
    // 从 cookie 读 Admin-Token
    const cookieMatch = document.cookie.match(/Admin-Token=([^;]+)/);
    if (cookieMatch) return cookieMatch[1];
    // window 全局
    if (window.token) return window.token;
    if (window.userToken) return window.userToken;
    return null;
}

/**
 * 解析 JWT payload（仅解码，不验签）
 */
function decodeJwtPayload(jwt) {
    if (!jwt) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(atob(b64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

/**
 * 从 JWT 的 sub 字段提取学生 ID
 */
function getStudentId() {
    const token = getAuthToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    return (payload && payload.sub) || null;
}

/**
 * 诊断信息：token 来源 + 预览 + 当前页面 URL
 * 用于手机端排查认证失败问题（手机端通常没 DevTools 可看）
 */
function getTokenDiagnostic() {
    const storageKeys = ['Admin-Token', 'adminToken', 'token', 'X-Token', 'x-token', 'admin_token'];
    let source = '未找到';
    let token = null;

    for (const key of storageKeys) {
        const v = localStorage.getItem(key);
        if (v) { token = v; source = 'localStorage[' + key + ']'; break; }
    }
    if (!token) {
        for (const key of storageKeys) {
            const v = sessionStorage.getItem(key);
            if (v) { token = v; source = 'sessionStorage[' + key + ']'; break; }
        }
    }
    if (!token) {
        const m = document.cookie.match(/Admin-Token=([^;]+)/);
        if (m) { token = m[1]; source = 'cookie[Admin-Token]'; }
    }
    if (!token && window.token) { token = window.token; source = 'window.token'; }
    if (!token && window.userToken) { token = window.userToken; source = 'window.userToken'; }

    const preview = token
        ? (token.length > 24 ? token.slice(0, 12) + '...' + token.slice(-8) : token)
        : 'null';
    return 'token=' + preview + ' (长度=' + (token ? token.length : 0) + ', source=' + source + ')\nURL=' + window.location.href;
}

async function fetchSemesterList() {
    console.log("拉取学期列表...");
    const token = getAuthToken();
    if (!token) {
        throw new Error('无法获取认证 token\n\n诊断:\n' + getTokenDiagnostic());
    }

    // cURL 抓包：POST 无 body（Content-Length: 0），无 Content-Type
    let res;
    try {
        res = await fetch(API_BASE + '/api/semester/list', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'X-Token': token
            }
        });
    } catch (fetchErr) {
        // 网络层失败：CORS、URL 不可达、SSL 错误等
        throw new Error('fetch 失败: ' + fetchErr.message + '\n\n诊断:\n' + getTokenDiagnostic());
    }
    if (!res.ok) {
        throw new Error('semester/list HTTP ' + res.status + '\n\n诊断:\n' + getTokenDiagnostic());
    }
    const json = await res.json();
    if (json.code !== 200) {
        throw new Error('semester/list 返回错误 [code=' + json.code + ']: ' + json.msg + '\n\n诊断:\n' + getTokenDiagnostic());
    }
    return json.data || [];
}

async function fetchTeachTaskList(yearTermId) {
    console.log("拉取教学任务... yearTermId=" + (yearTermId || '(未指定)'));
    const token = getAuthToken();
    if (!token) {
        throw new Error('无法获取认证 token，请确认已登录教务系统');
    }
    const studId = getStudentId() || '';

    // body 格式来自 cURL 抓包：{"weekNum":"","yearTermId":"20252","studId":"202402417"}
    let res;
    try {
        res = await fetch(API_BASE + '/api/teachTask/list', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-Token': token,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                weekNum: "",
                yearTermId: yearTermId || "",
                studId: studId
            })
        });
    } catch (fetchErr) {
        throw new Error('fetch 失败: ' + fetchErr.message + '\n\n诊断:\n' + getTokenDiagnostic());
    }
    if (!res.ok) {
        throw new Error('teachTask/list HTTP ' + res.status);
    }
    const json = await res.json();
    if (json.code !== 200) {
        throw new Error('teachTask/list 返回错误 [code=' + json.code + ']: ' + json.msg);
    }
    return json.data || [];
}

// ==================== 数据转换 ====================
/**
 * 把选中的学期对象转成内部用的 semesterInfo
 * semesterStartDate 来自学期 beginDate
 * semesterTotalWeeks 来自 beginWeek..endWeek
 */
function buildSemesterInfoFromSemester(semester) {
    if (!semester) {
        return { semesterStartDate: '2026-09-07', semesterTotalWeeks: 25, yearTermId: null };
    }
    const beginWeek = semester.beginWeek || 1;
    const endWeek = semester.endWeek || 25;
    return {
        semesterStartDate: semester.beginDate,
        semesterTotalWeeks: endWeek - beginWeek + 1,
        yearTermId: semester.yearTermID
    };
}

/**
 * 根据 lessType 把 weekBegin..weekEnd 展开为周次数组
 *   "全周" → 所有周
 *   "单周" → 仅奇数周
 *   "双周" → 仅偶数周
 */
function buildWeeksArray(weekBegin, weekEnd, lessType) {
    const weeks = [];
    const start = weekBegin || 1;
    const end = weekEnd || start;
    for (let w = start; w <= end; w++) {
        if (lessType === '单周' && w % 2 === 0) continue;
        if (lessType === '双周' && w % 2 === 1) continue;
        weeks.push(w);
    }
    return weeks;
}

/**
 * 把 teachTask/list 返回的数组转换成 saveImportedCourses 所需格式
 * 注意：day 直接用 API 的 weekDay（1=周一 ... 7=周日）
 *       若发现课程排错星期，改成 task.weekDay - 1（0=周一）即可
 */
function transformTeachTaskToCourses(taskList) {
    const courses = [];
    (taskList || []).forEach(task => {
        // 教师名拼接（多个教师用「、」连接）
        const teachers = (task.teacherList || [])
            .map(t => t.teacherName)
            .filter(name => name && String(name).trim().length > 0);
        const teacher = teachers.length > 0 ? teachers.join('、') : '未知教师';

        const course = {
            name: task.courName || '未知课程',
            teacher: teacher,
            position: task.roomId ? String(task.roomId) : '未知教室',
            day: task.weekDay,                              // API: 1=周一 ... 7=周日
            startSection: task.startSection,
            endSection: task.endSection,
            weeks: buildWeeksArray(task.weekBegin, task.weekEnd, task.lessType),
            isCustomTime: false
        };
        courses.push(course);
    });
    return courses;
}

// ========== 根据季节获取时间段（夏季/秋季） ==========
/**
 * 根据季节返回对应的时间段数组
 * @param {string} season - "summer" 或 "autumn"
 * @returns {Array} 时间段对象数组
 */
function getSeasonTimeSlots(season) {
    // 上午固定时间（夏秋通用）
    const morning_classes = [
        {"number": 1, "startTime": "08:10", "endTime": "08:55"},
        {"number": 2, "startTime": "09:00", "endTime": "09:45"},
        {"number": 3, "startTime": "10:05", "endTime": "10:50"},
        {"number": 4, "startTime": "10:55", "endTime": "11:40"}
    ];

    // 夏季下午/晚上时间
    const summer_afternoon_evening = [
        {"number": 5, "startTime": "14:30", "endTime": "15:15"},
        {"number": 6, "startTime": "15:20", "endTime": "16:05"},
        {"number": 7, "startTime": "16:25", "endTime": "17:10"},
        {"number": 8, "startTime": "17:15", "endTime": "18:00"},
        {"number": 9, "startTime": "18:45", "endTime": "19:30"},
        {"number": 10, "startTime": "19:35", "endTime": "20:20"},
        {"number": 11, "startTime": "20:25", "endTime": "21:10"}
    ];

    // 秋季下午/晚上时间
    const autumn_afternoon_evening = [
        {"number": 5, "startTime": "14:00", "endTime": "14:45"},
        {"number": 6, "startTime": "14:50", "endTime": "15:35"},
        {"number": 7, "startTime": "15:55", "endTime": "16:40"},
        {"number": 8, "startTime": "16:45", "endTime": "17:30"},
        {"number": 9, "startTime": "18:15", "endTime": "19:00"},
        {"number": 10, "startTime": "19:05", "endTime": "19:50"},
        {"number": 11, "startTime": "19:55", "endTime": "20:40"}
    ];

    if (season === 'autumn') {
        return morning_classes.concat(autumn_afternoon_evening);
    }
    // 默认夏季（兼容旧调用）
    return morning_classes.concat(summer_afternoon_evening);
}

// ==================== 弹窗和导入函数 ====================
async function demoAlert() {
    try {
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "📚 湖北汽车工业学院课表导入",
            "将通过教务系统 API 拉取课表数据并导入到 App\n\n" +
            "📌 请确认已登录教务系统\n" +
            "📌 流程：选择学期 → 选择季节 → 拉取课程",
            "开始导入",
            "取消"
        );
        return confirmed;
    } catch (error) {
        console.error("显示弹窗错误:", error);
        return false;
    }
}

async function demoPrompt(semesterInfo) {
    try {
        const defaultDate = (semesterInfo && semesterInfo.semesterStartDate) || '2026-09-07';
        const semesterStart = await window.shiguangBridgePromise.showPrompt(
            "📅 设置开学日期",
            "已从教务系统获取开学日期，如需修改请直接编辑",
            defaultDate,
            "validateDate"
        );
        return semesterStart || defaultDate;
    } catch (error) {
        console.error("日期输入错误:", error);
        return "2026-09-07";
    }
}

/**
 * 学期选择 - 用单选列表让用户选学期
 * 默认选中 currYearTerm === 1 的当前学期
 */
async function pickSemester(semesterList) {
    if (!semesterList || semesterList.length === 0) return null;

    const names = semesterList.map(s => s.yearTermName || s.yearTermID);
    // 默认选中当前学期（currYearTerm === 1）
    let defaultIdx = semesterList.findIndex(s => s.currYearTerm === 1);
    if (defaultIdx < 0) defaultIdx = 0;

    try {
        console.log("即将显示学期选择弹窗...");
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择要导入的学期",
            JSON.stringify(names),
            defaultIdx
        );

        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < semesterList.length) {
            const picked = semesterList[selectedIndex];
            console.log("用户选择了: " + picked.yearTermName + " (yearTermID=" + picked.yearTermID + ")");
            window.shiguangBridge.showToast("已选 " + picked.yearTermName);
            return picked;
        }
        console.log("用户取消了学期选择。");
        window.shiguangBridge.showToast("学期选择：用户取消");
        return null;
    } catch (error) {
        console.error("显示学期选择弹窗出错:", error);
        window.shiguangBridge.showToast("学期选择出错：" + error.message);
        return null;
    }
}

/**
 * 导入时间段 - 使用单选列表弹窗让用户选择夏季或秋季
 * 参考 demoSingleSelection 的调用模式
 */
async function importPresetTimeSlots() {
    const seasons = ["夏季", "秋季"];
    try {
        console.log("即将显示季节选择单选列表弹窗...");
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择作息时间",
            JSON.stringify(seasons),
            0
        );
        if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < seasons.length) {
            console.log("用户选择了: " + seasons[selectedIndex] + " (索引: " + selectedIndex + ")");
            window.shiguangBridge.showToast("你选择了 " + seasons[selectedIndex]);

            // 索引 0 -> 夏季，索引 1 -> 秋季
            const season = selectedIndex === 0 ? 'summer' : 'autumn';

            // 获取对应季节的时间段
            const presetTimeSlots = getSeasonTimeSlots(season);
            console.log(`选择的季节: ${season}，时间段:`, presetTimeSlots);

            // 导入时间段
            const result = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
            if (result === true) {
                console.log("预设时间段导入成功！");
                window.shiguangBridge.showToast(`✅ ${seasons[selectedIndex]}时间段导入成功！`);
                return true; // 成功时返回 true
            } else {
                console.log("预设时间段导入未成功，结果：" + result);
                window.shiguangBridge.showToast("❌ 时间段导入失败，请查看日志。");
                return false;
            }
        } else {
            console.log("用户取消了选择。");
            window.shiguangBridge.showToast("季节选择：用户取消了选择！");
            return false; // 用户取消时返回 false
        }
    } catch (error) {
        console.error("显示季节选择单选列表弹窗时发生错误:", error);
        window.shiguangBridge.showToast("季节选择：显示列表出错！" + error.message);
        return false; // 出现错误时也返回 false
    }
}

/**
 * 从 API 拉取课程并导入（按选中的 yearTermId 过滤）
 */
async function importSchedule(semesterInfo) {
    const result = { success: false, courseCount: 0, errorMsg: null };
    try {
        window.shiguangBridge.showToast("正在从教务系统拉取课表...");

        const yearTermId = semesterInfo && semesterInfo.yearTermId;
        const tasks = await fetchTeachTaskList(yearTermId);
        console.log(`拉取到 ${tasks.length} 条教学任务`);

        const courses = transformTeachTaskToCourses(tasks);
        result.courseCount = courses.length;

        if (courses.length === 0) {
            result.errorMsg = "教务系统未返回任何课程数据";
            await window.shiguangBridgePromise.showAlert(
                "⚠️ 拉取失败",
                result.errorMsg + "，请确认已登录且所选学期有课程",
                "知道了"
            );
            return result;
        }

        // 预览
        const preview = await window.shiguangBridgePromise.showAlert(
            "📊 数据预览",
            `共拉取到 ${courses.length} 条课程记录\n\n` +
            `示例:\n${courses.slice(0, 5).map(c =>
                `• 周${c.day} ${c.name} - 第${c.startSection}-${c.endSection}节`
            ).join('\n')}`,
            "确认导入",
            "取消"
        );

        if (!preview) {
            result.errorMsg = "用户在预览时取消";
            return result;
        }

        // 导入课程
        window.shiguangBridge.showToast("正在导入课程...");
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        if (saveResult !== true) {
            result.errorMsg = "saveImportedCourses 返回非 true";
            return result;
        }

        // 设置开学日期（默认值来自学期 API 的 beginDate）
        const semesterDate = await demoPrompt(semesterInfo);
        const totalWeeks = (semesterInfo && semesterInfo.semesterTotalWeeks) || 25;

        // 保存课表配置
        const configResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: semesterDate,
            semesterTotalWeeks: totalWeeks,
            defaultClassDuration: 45,
            defaultBreakDuration: 10,
            firstDayOfWeek: 1
        }));

        if (configResult === true) {
            result.success = true;
            return result;
        }

        result.errorMsg = "saveCourseConfig 返回非 true";
        return result;
    } catch (error) {
        console.error("导入错误:", error);
        result.errorMsg = error.message;
        return result;
    }
}

/**
 * 显示最终结果汇总弹窗
 */
async function showFinalResult(results) {
    const success = results.schedule && results.schedule.success;
    const title = success ? '🎉 导入成功' : '❌ 导入失败';

    let msg = '';
    if (results.semesterName) msg += '📚 学期: ' + results.semesterName + '\n';
    if (results.schedule && results.schedule.courseCount > 0) {
        msg += '📖 课程: ' + results.schedule.courseCount + ' 条\n';
    }
    msg += '\n📋 步骤状态:\n';
    msg += (results.semesterList ? '✅' : '❌') + ' 获取学期列表\n';
    msg += (results.season ? '✅' : '❌') + ' 导入时间段';
    if (results.seasonName) msg += ' (' + results.seasonName + ')';
    msg += '\n';
    msg += (results.schedule ? (results.schedule.success ? '✅' : '❌') : '⏭️') + ' 导入课表';
    if (results.schedule && results.schedule.courseCount > 0) msg += ' (' + results.schedule.courseCount + '条)';
    msg += '\n';

    if (results.errorMsg) {
        msg += '\n❗ 错误: ' + results.errorMsg;
    }

    try {
        await window.shiguangBridgePromise.showAlert(title, msg, '知道了');
    } catch (e) {
        console.error('显示最终结果弹窗失败:', e);
        window.shiguangBridge.showToast(title);
    }
}

async function runAllDemosSequentially() {
    window.shiguangBridge.showToast("🚀 课表导入助手启动...");

    const results = {
        semesterList: false,
        semesterName: '',
        season: false,
        seasonName: '',
        schedule: null,
        errorMsg: null
    };

    try {
        // 1. 确认开始
        const start = await demoAlert();
        if (!start) {
            results.errorMsg = '用户取消（开始按钮）';
            await showFinalResult(results);
            return;
        }

        // 2. 拉学期列表
        let semesterList = [];
        try {
            window.shiguangBridge.showToast("正在获取学期列表...");
            semesterList = await fetchSemesterList();
            console.log(`拉取到 ${semesterList.length} 个学期`);
            results.semesterList = true;
        } catch (e) {
            console.error("获取学期列表失败:", e);
            results.errorMsg = e.message;
            await showFinalResult(results);
            return;
        }

        // 3. 让用户选择学期
        const pickedSemester = await pickSemester(semesterList);
        if (!pickedSemester) {
            results.errorMsg = '用户取消了学期选择';
            await showFinalResult(results);
            return;
        }
        results.semesterName = pickedSemester.yearTermName;
        const semesterInfo = buildSemesterInfoFromSemester(pickedSemester);

        // 4. 导入时间段（季节选择：夏季/秋季）
        results.season = await importPresetTimeSlots();
        // 季节名映射（与 importPresetTimeSlots 内部一致）
        // 这里不直接拿名字，留空也行；如果想显示需要改 importPresetTimeSlots 返回值

        // 5. 导入课表（用选中的 yearTermId 拉 teachTask）
        results.schedule = await importSchedule(semesterInfo);
    } catch (e) {
        console.error("运行错误:", e);
        results.errorMsg = e.message;
    }

    await showFinalResult(results);
    window.shiguangBridge.notifyTaskCompletion();
}

// 导出函数
window.validateDate = validateDate;
window.getAuthToken = getAuthToken;
window.getStudentId = getStudentId;
window.decodeJwtPayload = decodeJwtPayload;
window.fetchSemesterList = fetchSemesterList;
window.fetchTeachTaskList = fetchTeachTaskList;
window.pickSemester = pickSemester;
window.transformTeachTaskToCourses = transformTeachTaskToCourses;
window.getSeasonTimeSlots = getSeasonTimeSlots;
window.importPresetTimeSlots = importPresetTimeSlots;
window.importSchedule = importSchedule;

// 启动
runAllDemosSequentially();
