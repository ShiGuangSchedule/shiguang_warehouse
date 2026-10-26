// 文件: neuyjs.js
// ========== 工具函数 ==========
function formatTime(time) {
    const hours = String(Math.floor(time / 100)).padStart(2, '0');
    const minutes = String(time % 100).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function parseWeeks(zcbh) {
    const weeks = [];
    for (let i = 0; i < zcbh.length; i++) {
        if (zcbh[i] === '1') weeks.push(i + 1);
    }
    return weeks;
}

// ========== 验证函数（用于弹窗） ==========
function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) return false;
    return "请输入四位数字的学年！";
}

// ========== 用户交互 ==========
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "导入课程表",
        "请确保您已连接校园网络，且教务系统可正常访问。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return false;
    }
    return true;
}

async function getAcademicYear() {
    const year = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入要导入课程的学年（如 2026）:",
        "2026",
        "validateYearInput"
    );
    if (year === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return null;
    }
    return year;
}

async function selectSemester() {
    const semesters = ["第一学期（秋季）", "第二学期（春季）"];
    const index = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        -1
    );
    if (index === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return null;
    }
    return index + 1;  // 返回 1 或 2
}

// ========== 网络请求 ==========
async function fetchCourses(year, semester) {
    const xnxqdm = `${year}${semester}`;  // 如 "20261"
    
    // 使用 fetch 发送请求（注意：需处理跨域和cookie）
    const response = await fetch(
        'https://yjs.neu.edu.cn/gsapp/sys/wdkbapp/xskcb/loadPkjg.do',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include',  // 携带cookie
            body: `XNXQDM=${xnxqdm}&ZC=`
        }
    );
    
    if (!response.ok) {
        window.shiguangBridge.showToast(`请求失败: ${response.status}`);
        return null;
    }
    
    const data = await response.json();
    if (!data.jgList || data.jgList.length === 0) {
        window.shiguangBridge.showToast("该学期暂无课程数据");
        return null;
    }
    
    return data;
}

// ========== 数据解析与保存 ==========
async function saveCoursesData(data) {
    const { jgList, jcList } = data;
    
    // 1. 解析时间段
    const timeSlots = jcList.map(item => ({
        number: item.DM,
        startTime: formatTime(item.KSSJ),
        endTime: formatTime(item.JSSJ)
    }));
    
    // 2. 解析课程
    const sectionMap = {};
    jcList.forEach(item => { sectionMap[item.DM] = item; });
    
    const courses = jgList.map(item => {
        const weeks = parseWeeks(item.ZCBH);
        if (weeks.length === 0) return null;
        return {
            name: item.KCMC,
            teacher: item.JGJSXM,
            position: item.JASMC,
            day: item.XQ,
            startSection: item.KSJCDM,
            endSection: item.JSJCDM,
            weeks: weeks,
            isCustomTime: false
        };
    }).filter(c => c !== null);
    
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到有效课程");
        return false;
    }
    
    // 3. 构建课表配置
    const config = {
        semesterTotalWeeks: 18,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 7
    };
    
    // 4. 依次保存
    try {
        await window.shiguangBridgePromise.saveCourseConfig(
            JSON.stringify(config)
        );
        await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(timeSlots)
        );
        await window.shiguangBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`保存失败: ${error.message}`);
        return false;
    }
}

// ========== 主流程 ==========
async function runImportFlow() {
    window.shiguangBridge.showToast("开始导入课程...");
    
    // 1. 公告
    const confirmed = await promptUserToStart();
    if (!confirmed) return;
    
    // 2. 获取学年
    const year = await getAcademicYear();
    if (year === null) return;
    
    // 3. 获取学期
    const semester = await selectSemester();
    if (semester === null) return;
    
    // 4. 请求数据
    const data = await fetchCourses(year, semester);
    if (data === null) return;
    
    // 5. 解析并保存
    const success = await saveCoursesData(data);
    if (!success) return;
    
    // 6. 完成
    window.shiguangBridge.showToast(`✅ 成功导入课程！`);
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动
runImportFlow();