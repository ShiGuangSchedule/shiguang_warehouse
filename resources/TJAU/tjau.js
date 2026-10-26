// 天津农学院(tjau.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

function powerSplit(paramsRaw) {
    const args = [];
    let current = "";
    let depth = 0; 
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < paramsRaw.length; i++) {
        let char = paramsRaw[i];
        if ((char === '"' || char === "'") && (i === 0 || paramsRaw[i - 1] !== '\\')) {
            if (!inQuote) { inQuote = true; quoteChar = char; }
            else if (char === quoteChar) { inQuote = false; }
        }
        if (!inQuote) {
            if (char === '(' || char === '[' || char === '{') depth++;
            if (char === ')' || char === ']' || char === '}') depth--;
        }
        if (char === ',' && depth === 0 && !inQuote) {
            args.push(cleanArg(current));
            current = "";
        } else {
            current += char;
        }
    }
    args.push(cleanArg(current)); 
    return args;
}

function cleanArg(s) {
    s = s.trim();
    if (s === "null") return null;
    return s.replace(/^["']|["']$/g, "");
}

/**
 * 全局课程合并逻辑
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];

    // 1. 建立基于 (课程名|教师|地点|星期几) 的分组
    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                // 假设大学最多 50 周，构建一个：第 N 周对应哪些节次的矩阵
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        }
        // 将系统传来的凌乱数据彻底打散，按“周”填入对应的“节”中，Set自动去重
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });

    const merged = [];

    // 2. 根据矩阵重新组装绝对精确的课程块
    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;
        
        // 用于记录相同的“连续节次块”分布在哪些周次
        // 例如 blockMap["1-2"] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        // 例如 blockMap["2-2"] = [10]
        const blockMap = {};

        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;

            // 寻找当前周的连续节次块
            let start = sections[0];
            let prev = sections[0];

            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr; // 节次连续，继续延伸
                } else {
                    // 节次断开，结算上一个块
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);
                    
                    // 开启新块
                    start = curr;
                    prev = curr;
                }
            }
            // 结算每周最后一个块
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }

        // 3. 将聚合好的 blockMap 转换为最终的 JSON 对象
        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey]
            });
        }
    }

    // 4. 排序以便输出整洁美观
    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });

    return merged;
}

function parseTaskActivities(html) {
    const rawResults = [];
    const blocks = html.split(/var\s+teachers\s*=/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        let teacherName = "未知教师";
        const tMatch = block.match(/actTeachers\s*=\s*\[\s*\{[\s\S]*?name:\s*"(.*?)"/);
        if (tMatch) teacherName = tMatch[1];

        const activityMatch = block.match(/new\s+TaskActivity\(([\s\S]*?)\);/);
        if (!activityMatch) continue;

        const args = powerSplit(activityMatch[1]);
        const courseName = (args[3] || "未知课程").split('(')[0];
        const position = (args[5] || "未知地点").replace(/\(.*?\)/g, "");
        const weeksBitmap = args[6] || "";
        
        const weeks = [];
        for (let j = 0; j < weeksBitmap.length; j++) {
            if (weeksBitmap[j] === '1') weeks.push(j);
        }

        const unitCountMatch = html.match(/unitCount\s*=\s*(\d+)/);
        const unitCount = unitCountMatch ? parseInt(unitCountMatch[1]) : 14;

        const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+);/g;
        let m;
        while ((m = idxRegex.exec(block)) !== null) {
            const day = parseInt(m[1]) + 1; 
            const section = parseInt(m[2]) + 1;

            rawResults.push({
                "name": courseName,
                "teacher": teacherName,
                "position": position,
                "day": day,
                "startSection": section,
                "endSection": section,
                "weeks": weeks
            });
        }
    }

    // 执行全局合并逻辑
    return mergeContinuousLessons(rawResults);
}

async function request(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) throw new Error(`网络请求失败: ${res.status}`);
    return await res.text();
}

async function detectParameters() {
    const html = await request("http://jwxt.tjau.edu.cn/eams/courseTableForStd.action?sf_request_type=ajax");
    const idsMatch = html.match(/bg\.form\.addInput\(form,"ids","(\d+)"\)/);
    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    if (!idsMatch || !tagIdMatch) return null;
    return { ids: idsMatch[1], tagId: tagIdMatch[1] };
}

async function getSelectedSemester(tagId) {
    const raw = await request(`http://jwxt.tjau.edu.cn/eams/dataQuery.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar`
    });
    const data = Function(`return (${raw});`)();
    const list = [];
    for (let key in data.semesters) {
        data.semesters[key].forEach(s => list.push({ id: s.id, name: `${s.schoolYear} ${s.name}学期` }));
    }
    const idx = await window.shiguangBridgePromise.showSingleSelection("选择学期", JSON.stringify(list.map(s => s.name)), 0);
    return idx !== null ? list[idx] : null;
}

async function fetchAndParseCourses(semesterId, ids) {
    const html = await request(`http://jwxt.tjau.edu.cn/eams/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `ignoreHead=1&setting.kind=std&semester.id=${semesterId}&ids=${ids}`
    });
    return parseTaskActivities(html);
}

async function applyTimeSlots() {
    const slots = [
        { "number": 1, "startTime": "08:30", "endTime": "09:15" }, 
        { "number": 2, "startTime": "09:20", "endTime": "10:05" },
        { "number": 3, "startTime": "10:25", "endTime": "11:10" },
        { "number": 4, "startTime": "11:15", "endTime": "12:00" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:50", "endTime": "15:35" },
        { "number": 7, "startTime": "15:55", "endTime": "16:40" }, 
        { "number": 8, "startTime": "16:45", "endTime": "17:30" },
        { "number": 9, "startTime": "18:30", "endTime": "19:15" }, 
        { "number": 10, "startTime": "19:20", "endTime": "20:05" },
        { "number": 11, "startTime": "20:10", "endTime": "20:55" }
    ];
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}


async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const params = await detectParameters();
        if (!params) throw new Error("未能识别教务参数，请确认已登录");

        const semester = await getSelectedSemester(params.tagId);
        if (!semester) return; 

        window.shiguangBridge.showToast("正在同步课表...");
        const courses = await fetchAndParseCourses(semester.id, params.ids);
        
        if (!courses || courses.length === 0) throw new Error("未解析到课程数据");

        await applyTimeSlots();
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        
        if (saveResult) {
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error(`[异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();