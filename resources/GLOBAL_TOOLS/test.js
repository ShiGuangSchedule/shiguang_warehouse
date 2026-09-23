function parseWeeks(weekStr) {
    const weeks = [];
    weekStr.split(',').forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            const w = parseInt(part);
            if (!isNaN(w)) weeks.push(w);
        }
    });
    return weeks;
}

async function fetchAndParseCourses() {
    const rawItems = [];
    
    function findTable(win) {
        const t = Array.from(win.document.querySelectorAll('table')).find(x => x.innerText.includes("星期一") && x.innerText.includes("["));
        if (t) return t;
        for (let i = 0; i < win.frames.length; i++) {
            try { const st = findTable(win.frames[i]); if (st) return st; } catch (e) {}
        }
        return null;
    }

    const table = findTable(window);
    if (!table) return null;

    // 原始数据清洗抓取
    Array.from(table.rows).forEach(row => {
        const cells = Array.from(row.cells);
        if (cells.length < 7) return;

        cells.forEach((cell, colIndex) => {
            const distanceToLast = cells.length - 1 - colIndex;
            if (distanceToLast > 6) return; 
            const day = 7 - distanceToLast;

            const rawText = cell.innerText.trim();
            if (!rawText.includes('[')) return;

            // 过滤掉空白行，并清洗每一行的首尾空格
            const lines = rawText.split('\n').map(l => l.trim()).filter(l => l);
            
            lines.forEach((line, i) => {
                const match = line.match(/([\d\-,]+)\[(\d+)-(\d+)\]/);
                if (match) {
                    let name = "未知课程";
                    if (i >= 2) name = lines[i-2];
                    else if (i >= 1) name = lines[i-1];

                    let teacher = (i >= 1 && !lines[i-1].includes('[')) ? lines[i-1] : "未知教师";
                    let position = (i < lines.length - 1) ? lines[i+1] : "未知地点";

                    rawItems.push({
                        name: name.replace(/\s/g, ""), // 去除所有空格
                        teacher: teacher.replace(/\s/g, ""),
                        position: position.replace(/\s/g, ""),
                        day: day,
                        startSection: parseInt(match[2]),
                        endSection: parseInt(match[3]),
                        weeks: parseWeeks(match[1])
                    });
                }
            });
        });
    });

    // 矩阵合并
    const groupMap = new Map();
    rawItems.forEach(item => {
        const key = `${item.name}|${item.teacher}|${item.position}|${item.day}`;
        if (!groupMap.has(key)) groupMap.set(key, {});
        
        const weekMap = groupMap.get(key);
        item.weeks.forEach(w => {
            if (!weekMap[w]) weekMap[w] = new Set();
            for (let s = item.startSection; s <= item.endSection; s++) {
                weekMap[w].add(s);
            }
        });
    });

    const finalCourses = [];
    groupMap.forEach((weekMap, key) => {
        const [name, teacher, position, day] = key.split('|');
        
        // 模式聚合：寻找具有相同“节次跨度”的周次
        const patternMap = new Map(); 

        Object.keys(weekMap).forEach(w => {
            const week = parseInt(w);
            const sections = Array.from(weekMap[week]).sort((a, b) => a - b);
            if (sections.length === 0) return;

            // 重新切分连续节次
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

// ========== 时间段配置==========
// 上午 5 节、下午 4 节、晚上 3 节，共 12 节
const SCHOOL_TIME_TABLE = [
  // 上午
  { section: 1, startTime: '08:20', endTime: '09:00' },
  { section: 2, startTime: '09:05', endTime: '09:45' },
  { section: 3, startTime: '10:05', endTime: '10:45' },
  { section: 4, startTime: '10:50', endTime: '11:30' },
  { section: 5, startTime: '11:35', endTime: '12:15' },
  // 下午
  { section: 6, startTime: '14:30', endTime: '15:10' },
  { section: 7, startTime: '15:15', endTime: '15:55' },
  { section: 8, startTime: '16:15', endTime: '16:55' },
  { section: 9, startTime: '17:00', endTime: '17:40' },
  // 晚上
  { section: 10, startTime: '19:00', endTime: '19:40' },
  { section: 11, startTime: '19:45', endTime: '20:25' },
  { section: 12, startTime: '20:30', endTime: '21:10' },
];

/**
 * 生成并导入时间段配置
 * 格式对齐拾光课程表规范：totalWeek / startSemester / startWithSunday / showWeekend
 *                       / forenoon / afternoon / night / sections
 */
async function importTimeSlots() {
    // 明确划分：上午 5 节、下午 4 节、晚上 3 节
    const forenoon = 5;
    const afternoon = 4;
    const night = 3;

    // 节数配置对象（主流拾光版本：直接传对象，会读取 forenoon/afternoon/night）
    const timeConfig = {
        totalWeek: 20,
        startSemester: '',
        startWithSunday: false,
        showWeekend: false,
        forenoon: forenoon,   // 上午 5 节（前 5 个时间点归上午）
        afternoon: afternoon, // 下午 4 节
        night: night,         // 晚上 3 节
        sections: SCHOOL_TIME_TABLE
    };

    // 兼容旧版桥接：{number, startTime, endTime} 纯数组格式
    const presetTimeSlots = SCHOOL_TIME_TABLE.map(t => ({
        number: t.section,
        startTime: t.startTime,
        endTime: t.endTime
    }));

    // 方案 A：传完整配置对象（推荐，能正确按 forenoon=5 划分上午）
    try {
        if (typeof window.shiguangBridge !== 'undefined'
            && typeof window.shiguangBridge.savePresetTimeSlots === 'function') {
            window.shiguangBridge.savePresetTimeSlots(timeConfig);
            console.log('时间配置导入成功（对象模式）:', timeConfig);
            return true;
        }
    } catch (e) {
        console.warn('对象模式失败，尝试数组模式:', e);
    }

    // 方案 B：传纯数组（兼容旧版，节数划分依赖 App 默认，可能需要手动把上午设为 5）
    try {
        if (typeof window.shiguangBridgePromise !== 'undefined') {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
            window.shiguangBridge.showToast('时间点已保存，请确认上午节数为5');
            return true;
        }
    } catch (error) {
        console.error('导入时间段失败:', error);
        window.shiguangBridge.showToast('时间段配置导入失败，课程将继续导入');
        return false;
    }
}

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("正在合并课表数据...");
        const courses = await fetchAndParseCourses();
        if (!courses || courses.length === 0) {
            window.shiguangBridge.showToast("未找到可导入课程");
            return;
        }

        // 先导入时间段配置，再保存课程
        await importTimeSlots();

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast(`成功：已优化合并为 ${courses.length} 个课块`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("解析失败: " + error.message);
    }
}

runImportFlow();