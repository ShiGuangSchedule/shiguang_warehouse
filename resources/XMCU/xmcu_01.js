/**
 * 基础工具函数：Base64 编码 (用于生成 URL 中的 params 参数)
 */
function encodeParams(xn, xq) {
    const rawStr = `xn=${xn}&xq=${xq}`;
    return btoa(rawStr);
}

/**
 * 判断是否处于教务系统登录环境
 */
async function checkLoginEnvironment() {
    const currentUrl = window.location.href;
    const targetBase = "https://jws-443.webvpn.xmcu.edu.cn/xmcsjw/";
    
    if (!currentUrl.startsWith(targetBase)) {
        window.shiguangBridge.showToast("请先登录教务系统再进行导入");
        return false;
    }
    return true;
}

/**
 * 数据解析函数
 */
function parseAndMergeXmcuData(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const rawItems = [];
    const table = doc.getElementById('mytable');

    if (!table) return [];

    const rows = table.querySelectorAll('tr');
    rows.forEach((row) => {
        const cells = row.querySelectorAll('td.td');
        cells.forEach((cell, dayIndex) => {
            const day = dayIndex + 1;
            const courseDivs = cell.querySelectorAll('div[style*="padding-bottom:5px"]');
            courseDivs.forEach(div => {
                const lines = Array.from(div.childNodes)
                    .map(n => n.textContent.trim())
                    .filter(t => t.length > 0);
                
                if (lines.length >= 3) {
                    const match = lines[2].match(/(.*)\[(.*)\]/);
                    if (match) {
                        const weeks = [];
                        match[1].split(',').forEach(g => {
                            if (g.includes('-')) {
                                const [s, e] = g.split('-').map(Number);
                                for (let i = s; i <= e; i++) weeks.push(i);
                            } else { weeks.push(Number(g)); }
                        });
                        const sections = match[2].split('-').map(Number);
                        rawItems.push({
                            name: lines[0],
                            teacher: lines[1],
                            position: lines[3] || "未知地点",
                            day: day,
                            startSection: sections[0],
                            endSection: sections[sections.length - 1],
                            weeks: Array.from(new Set(weeks))
                        });
                    }
                }
            });
        });
    });

    const groupMap = new Map();
    rawItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(item);
    });

    const finalCourses = [];
    groupMap.forEach((items, key) => {
        const matrix = {}; 
        items.forEach(item => {
            item.weeks.forEach(w => {
                if (!matrix[w]) matrix[w] = new Set();
                for (let s = item.startSection; s <= item.endSection; s++) matrix[w].add(s);
            });
        });

        const patternMap = new Map();
        Object.keys(matrix).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(matrix[week]).sort((a, b) => a - b);
            let start = sections[0];
            for (let i = 0; i < sections.length; i++) {
                if (i === sections.length - 1 || sections[i+1] !== sections[i] + 1) {
                    const pKey = `${start}-${sections[i]}`;
                    if (!patternMap.has(pKey)) patternMap.set(pKey, []);
                    patternMap.get(pKey).push(week);
                    if (i < sections.length - 1) start = sections[i+1];
                }
            }
        });

        const [name, teacher, position, day] = key.split('|');
        patternMap.forEach((weeks, pKey) => {
            const [sStart, sEnd] = pKey.split('-').map(Number);
            finalCourses.push({
                name, teacher, position,
                day: parseInt(day),
                startSection: sStart,
                endSection: sEnd,
                weeks: weeks.sort((a, b) => a - b)
            });
        });
    });
    return finalCourses;
}

/**
 * 学期获取函数
 */
async function getYearAndSemester() {
    try {
        window.shiguangBridge.showToast("正在获取学期列表...");
        const response = await fetch("https://jws-443.webvpn.xmcu.edu.cn/xmcsjw/frame/droplist/getDropLists.action", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: "comboBoxName=StMsXnxqDxDesc&paramValue=&isYXB=0&isCDDW=0&isXQ=0&isDJKSLB=0&isZY=0",
            credentials: "include"
        });
        const list = await response.json();
        const names = list.map(item => item.name);
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection("选择导入学期", JSON.stringify(names), 0);
        if (selectedIndex === null) return null;
        const [xn, xq] = list[selectedIndex].code.split('-');
        return { xn, xq };
    } catch (error) {
        window.shiguangBridge.showToast("获取列表失败");
        return null;
    }
}

/**
 * 课表抓取函数
 */
async function fetchCourses(xn, xq) {
    try {
        const paramsBase64 = encodeParams(xn, xq);
        const url = `https://jws-443.webvpn.xmcu.edu.cn/xmcsjw/student/wsxk.xskcb10319.jsp?params=${paramsBase64}`;
        window.shiguangBridge.showToast("正在提取数据...");
        const response = await fetch(url, { method: "GET", credentials: "include" });
        const arrayBuffer = await response.arrayBuffer();
        const htmlText = new TextDecoder('gbk').decode(arrayBuffer);
        return parseAndMergeXmcuData(htmlText);
    } catch (error) {
        window.shiguangBridge.showToast("抓取课表失败");
        return null;
    }
}

/**
 * 时间段导入函数
 */
async function importPresetTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:15", "endTime": "09:00" },
        { "number": 2, "startTime": "09:05", "endTime": "09:50" },
        { "number": 3, "startTime": "10:15", "endTime": "11:00" },
        { "number": 4, "startTime": "11:05", "endTime": "11:50" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:50", "endTime": "15:35" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:50", "endTime": "17:35" },
        { "number": 9, "startTime": "18:30", "endTime": "19:15" },
        { "number": 10, "startTime": "19:15", "endTime": "20:00" },
        { "number": 11, "startTime": "20:00", "endTime": "20:45" }
    ];
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots)).catch(() => {});
}

/**
 * 最终流程控制
 */
async function runImportFlow() {
    // 环境检查 (非教务页面直接 Toast 退出)
    const isReady = await checkLoginEnvironment();
    if (!isReady) return;

    // 弹窗确认
    const confirmed = await window.shiguangBridgePromise.showAlert("教务导入", "建议在‘课表查询’页面进行导入以确保数据最全。", "确定");
    if (!confirmed) return;

    // 选择学期
    const params = await getYearAndSemester();
    if (!params) return;

    // 获取并解析数据
    const courses = await fetchCourses(params.xn, params.xq);
    if (!courses || courses.length === 0) {
        window.shiguangBridge.showToast("未找到有效课程");
        return;
    }

    // 存储
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    await importPresetTimeSlots();

    // 完成
    window.shiguangBridge.showToast(`导入成功：共 ${courses.length} 门课程`);
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动
runImportFlow();