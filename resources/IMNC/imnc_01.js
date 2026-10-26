/**
 * 呼和浩特民族学院 (IMNC) 课表解析脚本-通过 WebVPN 登录
 * 目标页面：教务系统【本学期课表】（"本学期课程安排"页面）
 * 从课程主表读取课程号、课程序号、学分、选课属性，写入课程备注 remark
 * 桥接 API 使用 v2：window.shiguangBridge(同步) / window.shiguangBridgePromise(异步)
 * 导入时一并写入默认时间表（10 节）与默认学期总周数（16 周）
 */

// 清理 <wbr> 标签
function cleanWbr(str) {
    return str ? str.replace(/<wbr\s*\/?>/gi, '') : str;
}

// 默认时间表（TimeSlotJsonModel：number 从 1 递增，HH:mm 格式）
const TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:25", endTime: "10:10" },
    { number: 3, startTime: "10:30", endTime: "11:15" },
    { number: 4, startTime: "11:25", endTime: "12:10" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:25", endTime: "16:10" },
    { number: 7, startTime: "16:30", endTime: "17:15" },
    { number: 8, startTime: "17:25", endTime: "18:10" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

// 默认本学期总周数（CourseConfigJsonModel.semesterTotalWeeks，未传入的字段使用应用默认值）
const SEMESTER_TOTAL_WEEKS = 16;

// 周次解析函数
function parseWeeks(weekStr) {
    let weeks = [];
    if (!weekStr) return weeks;
    let isSingle = weekStr.includes('单');
    let isDouble = weekStr.includes('双');

    // 匹配 "1-16", "第1-9周", "全周（1-16）"
    let match = weekStr.match(/(\d+)-(\d+)/);
    if (match) {
        let start = parseInt(match[1]);
        let end = parseInt(match[2]);
        for (let i = start; i <= end; i++) {
            if (isSingle && i % 2 === 0) continue;
            if (isDouble && i % 2 !== 0) continue;
            weeks.push(i);
        }
    } else {
        // 匹配 "第13周"
        let singleMatch = weekStr.match(/(\d+)/);
        if (singleMatch) {
            weeks.push(parseInt(singleMatch[1]));
        }
    }
    return weeks;
}

// 星期映射（星期一~星期日 -> 1~7）
const DAY_NAME_MAP = {
    '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4,
    '星期五': 5, '星期六': 6, '星期日': 7, '星期天': 7
};

function parseDay(dayStr) {
    if (!dayStr) return 0;
    let normalized = dayStr.replace(/\s+/g, '');
    if (DAY_NAME_MAP[normalized]) return DAY_NAME_MAP[normalized];
    let match = normalized.match(/星期([一二三四五六日天])/);
    if (!match) match = normalized.match(/周([一二三四五六日天])/);
    if (match) {
        let index = '一二三四五六日天'.indexOf(match[1]);
        return index >= 0 ? index + 1 : 0;
    }
    return 0;
}

// 节次解析："第1-2节" -> {start:1, end:2}；"第3节" -> {start:3, end:3}
function parseSections(sectionStr) {
    if (!sectionStr) return null;
    let rangeMatch = sectionStr.match(/第\s*(\d+)\s*[-—~至]\s*(\d+)\s*节/);
    if (rangeMatch) {
        return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
    }
    let singleMatch = sectionStr.match(/第\s*(\d+)\s*节/);
    if (singleMatch) {
        let section = parseInt(singleMatch[1]);
        return { start: section, end: section };
    }
    return null;
}

function cleanCellText(cell) {
    return cell.textContent.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// 教师单元格解析：任课教师以链接列表展示，用"、"拼接
function parseTeacherCell(cell) {
    let links = cell.querySelectorAll('a');
    if (links.length > 0) {
        let names = [];
        for (let i = 0; i < links.length; i++) {
            let name = cleanWbr(links[i].textContent).replace(/\s+/g, ' ').trim();
            if (name) names.push(name);
        }
        if (names.length > 0) return names.join('、');
    }
    return cleanCellText(cell);
}

// 解析"上课时间、地点"单元格内的嵌套表格，每行：周次 / 星期 / 节次 / 地点
function parseScheduleCell(cell) {
    let slots = [];
    let rows = cell.querySelectorAll('table tr');
    for (let i = 0; i < rows.length; i++) {
        let tds = rows[i].querySelectorAll('td');
        if (tds.length < 3) continue;

        let weekStr = cleanCellText(tds[0]);
        let dayStr = cleanCellText(tds[1]);
        let sectionStr = cleanCellText(tds[2]);
        let position = tds.length > 3 ? cleanCellText(tds[3]) : '';

        // 无星期或节次的子行（仅有周次的课程安排）跳过
        let day = parseDay(dayStr);
        let section = parseSections(sectionStr);
        if (!day || !section) continue;

        slots.push({
            weeks: parseWeeks(weekStr),
            weeksText: weekStr,
            day: day,
            startSection: section.start,
            endSection: section.end,
            position: cleanWbr(position)
        });
    }
    return slots;
}

// 在单个文档中定位课程主表：table.infolist_tab 且表头含"课程号"（排除"上课大节"对照表）
function findCourseTableInDoc(doc) {
    let tables = doc.querySelectorAll('table.infolist_tab');
    for (let i = 0; i < tables.length; i++) {
        let headerCells = tables[i].rows[0] ? tables[i].rows[0].cells : [];
        for (let j = 0; j < headerCells.length; j++) {
            if (cleanCellText(headerCells[j]).replace(/\s+/g, '') === '课程号') {
                return tables[i];
            }
        }
    }
    return null;
}

// 收集文档内所有可访问的同源框架文档（教务系统为 frameset 结构，课表位于 mainFrame 内）
function collectFrameDocs(doc, docs, depth) {
    if (depth > 3) return;
    let frames = doc.querySelectorAll('frame, iframe');
    for (let i = 0; i < frames.length; i++) {
        try {
            let frameDoc = frames[i].contentDocument ||
                (frames[i].contentWindow ? frames[i].contentWindow.document : null);
            if (frameDoc && docs.indexOf(frameDoc) < 0) {
                docs.push(frameDoc);
                collectFrameDocs(frameDoc, docs, depth + 1);
            }
        } catch (e) { /* 跨域框架无法访问，忽略 */ }
    }
    return docs;
}

function findCourseTable() {
    // 优先在当前文档查找
    let table = findCourseTableInDoc(document);
    if (table) return table;
    // 当前文档没有（如处于 index_frame 顶层框架），遍历同源框架查找
    let frameDocs = collectFrameDocs(document, [], 0);
    for (let i = 0; i < frameDocs.length; i++) {
        let tableInFrame = findCourseTableInDoc(frameDocs[i]);
        if (tableInFrame) return tableInFrame;
    }
    return null;
}

// 组装课程备注（官方 ImportCourseJsonModel 字段 remark，字符数限制 300）
function buildRemark(courseId, sequence, credit, electiveAttr) {
    let lines = [];
    if (courseId) lines.push('课程号：' + courseId);
    if (sequence) lines.push('课程序号：' + sequence);
    if (credit) lines.push('学分：' + credit);
    if (electiveAttr) lines.push('选课属性：' + electiveAttr);
    let remark = lines.join('\n');
    if (remark.length > 300) remark = remark.substring(0, 300);
    return remark;
}

// 核心解析函数：在"本学期课程安排"页面按表头定位列并逐行解析
function fetchCurrentSemesterCourses() {
    let table = findCourseTable();
    if (!table) return null;

    // 按表头文本建立列索引（表头文本去除空白，兼容"课程<br>序号"、"学 分"等换行写法）
    let indexMap = {};
    let headerCells = table.rows[0] ? table.rows[0].cells : [];
    for (let i = 0; i < headerCells.length; i++) {
        indexMap[cleanCellText(headerCells[i]).replace(/\s+/g, '')] = i;
    }

    function columnIndex(keys) {
        for (let i = 0; i < keys.length; i++) {
            if (indexMap[keys[i]] !== undefined) return indexMap[keys[i]];
        }
        return -1;
    }

    let courseIdIdx = columnIndex(['课程号']);
    let sequenceIdx = columnIndex(['课程序号']);
    let nameIdx = columnIndex(['课程名称']);
    let teacherIdx = columnIndex(['任课教师']);
    let creditIdx = columnIndex(['学分']);
    let electiveAttrIdx = columnIndex(['选课属性']);
    let scheduleIdx = columnIndex(['上课时间、地点', '上课时间地点']);

    if (nameIdx < 0 || scheduleIdx < 0) return null;

    let courses = [];
    let skipped = [];

    // 第 0 行是表头，从第 1 行开始遍历课程
    for (let i = 1; i < table.rows.length; i++) {
        let cells = table.rows[i].cells;
        function cellAt(index) {
            return index >= 0 && index < cells.length ? cells[index] : null;
        }

        let nameCell = cellAt(nameIdx);
        let name = nameCell ? cleanWbr(cleanCellText(nameCell)) : '';
        if (!name) continue;

        let courseIdCell = cellAt(courseIdIdx);
        let sequenceCell = cellAt(sequenceIdx);
        let creditCell = cellAt(creditIdx);
        let electiveAttrCell = cellAt(electiveAttrIdx);
        let teacherCell = cellAt(teacherIdx);

        let courseId = courseIdCell ? cleanCellText(courseIdCell) : '';
        let sequence = sequenceCell ? cleanCellText(sequenceCell) : '';
        let credit = creditCell ? cleanCellText(creditCell) : '';
        let electiveAttr = electiveAttrCell ? cleanCellText(electiveAttrCell) : '';
        let teacher = teacherCell ? parseTeacherCell(teacherCell) : '';

        let remark = buildRemark(courseId, sequence, credit, electiveAttr);

        let scheduleCell = cellAt(scheduleIdx);
        let slots = scheduleCell ? parseScheduleCell(scheduleCell) : [];

        if (slots.length === 0) {
            // 无任何有效排课位的课程（如仅有周次的"形势与政策（三）"、无时间安排的"体能测试Ⅱ"）
            let weeksText = '未填写周次';
            if (scheduleCell) {
                let firstTd = scheduleCell.querySelector('table td');
                if (firstTd) {
                    let text = cleanCellText(firstTd);
                    if (text) weeksText = text;
                }
            }
            skipped.push({
                name: name,
                teacher: teacher || '未填写教师',
                weeks: weeksText
            });
            continue;
        }

        for (let k = 0; k < slots.length; k++) {
            let slot = slots[k];
            let courseBlock = {
                name: name,
                teacher: teacher,
                position: slot.position,
                day: slot.day,
                startSection: slot.startSection,
                endSection: slot.endSection,
                weeks: slot.weeks,
                remark: remark
            };

            // 查找同一天、同名、同老师、同地点、同周次、同备注，且正好是上一节的课程（合并连上的课）
            let existingCourse = courses.find(c =>
                c.name === courseBlock.name &&
                c.day === courseBlock.day &&
                c.teacher === courseBlock.teacher &&
                c.position === courseBlock.position &&
                JSON.stringify(c.weeks) === JSON.stringify(courseBlock.weeks) &&
                c.remark === courseBlock.remark &&
                c.endSection === courseBlock.startSection - 1
            );

            if (existingCourse) {
                existingCourse.endSection = courseBlock.endSection;
            } else {
                courses.push(courseBlock);
            }
        }
    }

    return { courses: courses, skipped: skipped };
}

function formatNoArrangementMessage(courses) {
    let lines = courses.map((course, index) => {
        let teacher = course.teacher || '未填写教师';
        let weeks = course.weeks || '未填写周次';
        return `${index + 1}. ${course.name} / ${teacher} / ${weeks}`;
    });

    return `检测到 ${courses.length} 门课程没有具体上课时间或地点，无法自动放入课表：\n\n${lines.join('\n')}\n\n请在确认课程时间后重新导入，点击【继续】将导入已知课程。`;
}

// 保存课表配置（默认学期总周数；失败不阻断课程导入）
async function saveCourseConfigData() {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
            semesterTotalWeeks: SEMESTER_TOTAL_WEEKS
        }));
        window.shiguangBridge.showToast(`已设置默认学期总周数：${SEMESTER_TOTAL_WEEKS} 周`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存课表配置失败: " + error.message);
        return false;
    }
}

// 导入预设时间段（默认时间表；失败不阻断课程导入）
async function importPresetTimeSlots() {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        window.shiguangBridge.showToast(`预设时间段导入成功（${TIME_SLOTS.length} 节）！`);
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        return false;
    }
}

// 调度流程
async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始解析课表...");

        const alertConfirmed = await window.shiguangBridgePromise.showAlert(
            "导入确认",
            "请确保您目前处于教务系统的“本学期课表”显示页面（页面标题为“本学期课程安排”）。\n是否立即提取并导入课表？",
            "开始提取"
        );

        if (!alertConfirmed) {
            window.shiguangBridge.showToast("导入已取消");
            return;
        }

        const result = fetchCurrentSemesterCourses();

        if (!result || result.courses.length === 0) {
            await window.shiguangBridgePromise.showAlert("错误", "未在当前页面找到可导入的课程数据，请确认是否处于“本学期课表”页面，或联系适配开发者。", "好的");
            return;
        }

        if (result.skipped.length > 0) {
            await window.shiguangBridgePromise.showAlert(
                "存在未安排课程",
                formatNoArrangementMessage(result.skipped),
                "继续"
            );
        }

        // 课表配置（学期总周数），失败不阻断
        await saveCourseConfigData();

        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(result.courses));
        window.shiguangBridge.showToast(`成功导入 ${result.courses.length} 门课程块！`);

        // 默认时间表，失败不阻断
        await importPresetTimeSlots();

        window.shiguangBridge.notifyTaskCompletion();

    } catch (error) {
        window.shiguangBridge.showToast("导入发生错误: " + error.message);
    }
}

// 启动执行
runImportFlow();
