// 文件: nchu.js
// 南昌航空大学教务系统课程表导入脚本

function isOnSchedulePage() {
    const url = window.location.href;
    return /jwc-publish2\.jwc\.nchu\.edu\.cn/i.test(url);
}

// 解析周数字符串，支持逗号/顿号分隔的多段与连续区间
// 例：第4-6,8-19周 / 第5,7,9,11,13,15,17,19周 / 第9周 / 第13-16周
function parseWeeks(timeStr) {
    const weeks = new Set();
    const segment = timeStr.match(/第\s*([\d、,\-\s]+)\s*周/);
    if (!segment) return [];
    segment[1].split(/[,、\s]+/).forEach(part => {
        part = part.trim();
        if (!part) return;
        const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range) {
            const start = parseInt(range[1], 10);
            const end = parseInt(range[2], 10);
            for (let i = start; i <= end; i++) weeks.add(i);
        } else if (/^\d+$/.test(part)) {
            weeks.add(parseInt(part, 10));
        }
    });
    return Array.from(weeks).sort((a, b) => a - b);
}

// 解析节次字符串，兼容 "01~02小节" 与 "01~02节" 两种写法
function parseSections(sectionStr) {
    const match = sectionStr.match(/(\d{1,2})~(\d{1,2})(?:小)?节/);
    if (match) {
        return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
    }
    return null;
}

// 从文档中提取课程数据
function extractCoursesFromDoc(doc) {
    const courses = [];
    
    const table = doc.querySelector('.time-table table');
    if (!table) {
        console.log('未找到课表表格');
        return courses;
    }
    
    const rows = table.querySelectorAll('tbody tr');
    
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;
        
        // cells[0] 是节次列，cells[1..] 对应周一~周日
        for (let i = 1; i < cells.length; i++) {
            const day = i;
            const cell = cells[i];
            
            // 一个格子里可能有多门课（多个 .item-box）
            const itemBoxes = cell.querySelectorAll('.item-box');
            itemBoxes.forEach(itemBox => {
                parseItemBox(itemBox, day, courses);
            });
        }
    });
    
    return courses;
}

// 解析单个 .item-box（一门课），其内部可能含多个时间段块
function parseItemBox(itemBox, day, courses) {
    // 课程全名：.item-box 内第一个 <p>
    const courseP = itemBox.querySelector('p');
    const name = courseP ? courseP.textContent.trim() : '';
    if (!name) return;
    
    // 每个时间段块的构成：<p>课程名</p><div class="tch-name">…</div><div><span item1>教室</span><span item3>周次</span></div>
    itemBox.querySelectorAll('.tch-name').forEach(tch => {
        const segDiv = tch.nextElementSibling;
        if (!segDiv) return;
        
        // 周次：该 div 中 item3.png 所在 span 的文本（如 "第13-16周 星期四"）
        const weekImg = segDiv.querySelector('img[src*="item3.png"]');
        const timeInfo = weekImg && weekImg.parentElement ? weekImg.parentElement.textContent.trim() : '';
        const weeks = parseWeeks(timeInfo);
        if (weeks.length === 0) return;
        
        // 节次：从 tch-name 内 "01~02节" 的 span 获取
        let sectionInfo = null;
        tch.querySelectorAll('span').forEach(s => {
            if (sectionInfo) return;
            sectionInfo = parseSections(s.textContent);
        });
        if (!sectionInfo) return;
        
        // 教室：该 div 中 item1.png 所在 span 的文字（如 "博学楼F栋-F302"）
        let room = '';
        const roomImg = segDiv.querySelector('img[src*="item1.png"]');
        if (roomImg && roomImg.parentElement) {
            room = roomImg.parentElement.textContent.trim();
        }
        
        // 教师：在本块 tch-name 的 span 中找 "教师：xxx"（避免与学分/节次拼接）
        let teacher = '';
        tch.querySelectorAll('span').forEach(s => {
            if (teacher) return;
            const m = s.textContent.match(/教师[:：]\s*(.+)/);
            if (m) teacher = m[1].trim();
        });
        
        courses.push({
            name,
            teacher,
            position: room || '未指定',
            day,
            startSection: sectionInfo.start,
            endSection: sectionInfo.end,
            weeks
        });
    });
}

// 获取当前页面的课程（兼容课表页直接注入，或从首页 iframe 中取课表内容）
function getCurrentWeekCourses() {
    // 若当前文档自身就是课表页，直接解析
    if (document.querySelector('.time-table table')) {
        return extractCoursesFromDoc(document);
    }
    
    // 否则遍历 iframe 查找课表页
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
        try {
            if (iframe.contentDocument && iframe.contentDocument.querySelector('.time-table table')) {
                return extractCoursesFromDoc(iframe.contentDocument);
            }
        } catch (e) {
            // 跨域 iframe 跳过
        }
    }
    
    return [];
}

// 去重合并课程
function mergeAndDeduplicateCourses(allCourses) {
    const courseMap = new Map();
    
    allCourses.forEach(course => {
        const key = `${course.day}-${course.startSection}-${course.endSection}-${course.name}-${course.teacher}-${course.position}`;
        
        if (!courseMap.has(key)) {
            courseMap.set(key, {
                ...course,
                weeks: [...course.weeks]
            });
        } else {
            const existing = courseMap.get(key);
            const weekSet = new Set([...existing.weeks, ...course.weeks]);
            existing.weeks = Array.from(weekSet).sort((a, b) => a - b);
        }
    });
    
    return Array.from(courseMap.values());
}

// 生成时间段配置（该校实际为 11 节课）
function generateTimeSlots() {
    return [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "10:00", "endTime": "10:45" },
        { "number": 4, "startTime": "10:55", "endTime": "11:40" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "16:00", "endTime": "16:45" },
        { "number": 8, "startTime": "16:55", "endTime": "17:40" },
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        { "number": 10, "startTime": "19:55", "endTime": "20:40" },
        { "number": 11, "startTime": "20:50", "endTime": "21:35" }
    ];
}

// 主函数：导入课程
async function importCourseSchedule() {
    try {
        console.log('开始导入课程表...');
        window.shiguangBridge.showToast('正在获取课表数据...');
        
        // 获取当前周课程
        const courses = getCurrentWeekCourses();
        console.log(`找到 ${courses.length} 门课程`);
        
        if (courses.length === 0) {
            window.shiguangBridge.showToast('未找到课程数据');
            return false;
        }
        
        console.log('课程数据:', courses);
        
        // 导入课程
        const coursesResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (coursesResult === true) {
            console.log('课程导入成功！');
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 门课程！`);
        } else {
            console.log('课程导入失败');
            window.shiguangBridge.showToast('课程导入失败');
            return false;
        }
        
        // 生成并导入时间段
        const finalTimeSlots = generateTimeSlots();
        const timeSlotsResult = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(finalTimeSlots));
        if (timeSlotsResult === true) {
            console.log('时间段导入成功！');
        }
        
        return true;
        
    } catch (error) {
        console.error('导入过程出错:', error);
        window.shiguangBridge.showToast('导入失败: ' + error.message);
        return false;
    }
}

// ========== 主执行逻辑 ==========

if (isOnSchedulePage()) {
    console.log('检测到南昌航空大学教务系统');
    window.shiguangBridge.showToast('正在准备导入课程表...');
    
    setTimeout(async () => {
        const success = await importCourseSchedule();
        if (success) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }, 2000);
    
} else {
    console.log('当前不在教务系统页面');
    window.shiguangBridge.showToast('请先登录教务系统！');
}
