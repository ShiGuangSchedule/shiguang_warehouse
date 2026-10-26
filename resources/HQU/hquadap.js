/**
 * 华侨大学 (HQU) 教务系统课程导入脚本
 * 版本：2026 春季学期
 * 还有待解决的问题：课程合并 
 */

// 1. 全局验证函数 (由 showPrompt 调用)
function validateTermInput(input) {
    if (/^\d{4}-\d{4}-\d$/.test(input)) {
        return false; // 校验通过
    } else {
        return "格式错误！请输入如 2025-2026-2";
    }
}

async function runImportFlow() {
    window.shiguangBridge.showToast("正在启动华大教务同步程序...");

    try {
        // --- 1. 获取学期代码 ---
        const termQuery = [
            { name: "CSDM", linkOpt: "AND", builderList: "cbl_String", builder: "equal", value: "PK" },
            { name: "ZCSDM", linkOpt: "AND", builderList: "cbl_String", builder: "equal", value: "XSDXNXQDM" }
        ];
        
        const termResp = await fetch("https://jwapp-hqu-edu-cn-s.atrust.hqu.edu.cn:9443/jwapp/sys/wdkb/modules/xskcb/xtcscx.do?sf_request_type=ajax", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: `querySetting=${encodeURIComponent(JSON.stringify(termQuery))}`
        });
        const termJson = await termResp.json();
        const currentXNXQ = termJson.datas.xtcscx.CSZA || "2025-2026-2";

        const parts = currentXNXQ.split('-');
        const currentXN = `${parts}-${parts}`;
        const currentXQ = parts;

        // --- 2. 获取配置与开学日期 ---
        let startDate = "2026-03-02";
        let totalWeeks = 18;
        try {
            const configResp = await fetch("https://jwapp-hqu-edu-cn-s.atrust.hqu.edu.cn:9443/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do?sf_request_type=ajax", {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: `XN=${currentXN}&XQ=${currentXQ}`
            });
            const configJson = await configResp.json();
            const schoolConfig = configJson.datas.cxjcs.rows;
            if (schoolConfig && schoolConfig.XQKSRQ) {
                startDate = schoolConfig.XQKSRQ.split(' ');
                totalWeeks = parseInt(schoolConfig.ZZC) || 18;
            }
        } catch (e) { console.log("配置抓取跳过"); }

        // --- 3. 抓取课表详情 ---
        const kbResp = await fetch("https://jwapp-hqu-edu-cn-s.atrust.hqu.edu.cn:9443/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do?sf_request_type=ajax", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: `XNXQDM=${currentXNXQ}&XNXQDM2=${currentXNXQ}&XNXQDM3=${currentXNXQ}`
        });
        const kbJson = await kbResp.json();
        const rawRows = kbJson.datas.cxxszhxqkb.rows;

        //转换数据结构
        const parsedCourses = rawRows.map(item => {
    // 1. 周次解析：从位图获取最硬核的数据
        const weeks = [];
        const bitMap = item.SKZC || "";
            

    // 华大逻辑：如果位图索引1是1，那就是第一周有课  你看它里面  "SKZC": "011111111111111100",
    for (let i = 0; i < bitMap.length; i++) {
        if (bitMap[i] === '1') {
            weeks.push(i + 1); 
        }
    }
            
    // 体育课的标题：体育课加上具体的项目（如：篮球）
    let courseName = item.KCM;
    if (item.TYXMDM_DISPLAY) {
        courseName = `${courseName}(${item.TYXMDM_DISPLAY})`;
    }

    // 地点兜底：优先取具体教室，没有则取教学楼，再没有则标记操场
    const position = item.JASMC || item.JXLDM_DISPLAY || "操场/待定";

    // 2. YPSJDD 
    let note = `原始安排：${item.YPSJDD || '无'}`;
    if (item.XF) note += `\n学分：${item.XF}`;
    if (item.KCXZDM_DISPLAY) note += `\n性质：${item.KCXZDM_DISPLAY}`;

    return {
        name: item.KCM,
        teacher: item.SKJS || item.JSM || "未知",
        position: position,
        day: parseInt(item.SKXQ),
        startSection: parseInt(item.KSJC),
        endSection: parseInt(item.JSJC),
        weeks: weeks,
    };
});

        // --- 5. 提交数据 ---
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterStartDate: startDate,
            semesterTotalWeeks: totalWeeks
        }));

        const timeSlots = [
            { number: 1, startTime: "08:00", endTime: "08:45" }, { number: 2, startTime: "08:55", endTime: "09:40" },
            { number: 3, startTime: "10:00", endTime: "10:45" }, { number: 4, startTime: "10:55", endTime: "11:40" },
            { number: 5, startTime: "11:45", endTime: "12:30" }, { number: 6, startTime: "14:30", endTime: "15:15" },
            { number: 7, startTime: "15:25", endTime: "16:10" }, { number: 8, startTime: "16:20", endTime: "17:05" },
            { number: 9, startTime: "17:15", endTime: "18:00" }, { number: 10, startTime: "18:20", endTime: "19:05" },
            { number: 11, startTime: "19:10", endTime: "19:55" }, { number: 12, startTime: "20:05", endTime: "20:50" },
            { number: 13, startTime: "20:55", endTime: "21:40" }
        ];
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));

        window.shiguangBridge.showToast(`${currentXNXQ} 导入成功！`);
        window.shiguangBridge.notifyTaskCompletion();

    } catch (e) {
        await window.shiguangBridgePromise.showAlert("导入失败", "错误: " + e.message, "重试");
    }
}

runImportFlow();