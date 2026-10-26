const UZZ_BASE_URL = window.location.origin;

function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const segments = weekStr.split(',');
    let weeks = [];
    const segmentRegex = /(\d+)(?:-(\d+))?\s*周?(\([单双]\))?/g;
    for (const segment of segments) {
        segmentRegex.lastIndex = 0;
        let match;
        while ((match = segmentRegex.exec(segment)) !== null) {
            const start = parseInt(match[1]);
            const end = match[2] ? parseInt(match[2]) : start;
            const flagStr = match[3] || '';
            let flag = 0;
            if (flagStr.includes('单')) flag = 1;
            else if (flagStr.includes('双')) flag = 2;

            for (let i = start; i <= end; i++) {
                if (flag === 1 && i % 2 !== 1) continue;
                if (flag === 2 && i % 2 !== 0) continue;
                if (!weeks.includes(i)) weeks.push(i);
            }
        }
    }
    return weeks.sort((a, b) => a - b);
}

function parseJsonData(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.kbList)) return [];
    const finalCourseList = [];
    for (const item of jsonData.kbList) {
        const weeks = parseWeeks(item.zcd);
        const sectionParts = item.jcs.split('-');
        const startSection = parseInt(sectionParts[0]);
        const endSection = parseInt(sectionParts[sectionParts.length - 1]);
        const day = parseInt(item.xqj);

        if (weeks.length > 0 && !isNaN(day)) {
            finalCourseList.push({
                name: item.kcmc.trim(),
                teacher: item.xm ? item.xm.trim() : "未知",
                position: item.cdmc ? item.cdmc.trim() : "未知",
                day: day,
                startSection: startSection,
                endSection: endSection,
                weeks: weeks
            });
        }
    }
    return finalCourseList;
}

const TimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:50" },
    { number: 2, startTime: "08:50", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "11:00" },
    { number: 4, startTime: "11:00", endTime: "11:50" },
    { number: 5, startTime: "14:30", endTime: "15:20" },
    { number: 6, startTime: "15:20", endTime: "16:10" },
    { number: 7, startTime: "16:40", endTime: "17:30" },
    { number: 8, startTime: "17:30", endTime: "18:20" },
    { number: 9, startTime: "19:30", endTime: "20:20" },
    { number: 10, startTime: "20:20", endTime: "21:10" }
];

async function runImportFlow() {
    const $ = window.jQuery;
    
    // 强拦截：由于正方系统的 gnmkdm 模块会话校验，必须要求用户在课表页面才能请求 API
    if (!$ || !$('#xnm').length || !$('#xqm').length) {
        await window.shiguangBridgePromise.showAlert(
            "导入提示", 
            "正方教务系统限制：请务必先点击进入【正方教务管理系统】->【个人课表查询】页面后，再点击一键导入！", 
            "我知道了"
        );
        return;
    }

    window.shiguangBridge.showToast("正在获取当前页面课表数据...");
    
    // 直接静默提取页面上已经选好的学年和学期
    const xnm = $('#xnm').val();
    const xqm = $('#xqm').val();

    try {
        const apiUrl = `${UZZ_BASE_URL}/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`;
        const body = `xnm=${xnm}&xqm=${xqm}&kzlx=ck&xsdm=&kclbdm=`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body
        });

        const json = await response.json();
        const courses = parseJsonData(json);

        if (courses.length === 0) {
            await window.shiguangBridgePromise.showAlert("导入失败", "该学年学期未找到课程数据，请确认页面上显示的课表是否为空。", "确定");
            return;
        }

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));

        window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (e) {
        await window.shiguangBridgePromise.showAlert("导入失败", "接口请求异常，请确认教务系统网络通畅。", "确定");
        console.error(e);
    }
}

runImportFlow();
