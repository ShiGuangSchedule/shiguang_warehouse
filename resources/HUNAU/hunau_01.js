// 湖南农业大学（hunau.edu.cn）拾光课程表适配脚本
// 教务系统：强智 jsxsd（湖南强智科技教务系统）
// 校外经 WebVPN（webvpn.hunau.edu.cn）访问，校内可直连；脚本按当前页面自动推导 /jsxsd 前缀，两种形态通用
// 使用流程：在软件内置浏览器登录学校统一身份认证/WebVPN，进入教务系统任意页面后执行导入
// 数据来源：GET {前缀}/jsxsd/xskb/xskb_list.do?xnxq01id=学期  → 课表页（table#timetable）
//           POST {前缀}/jsxsd/jxzl/jxzl_query  → 教学周历（首列为周次，第二列 title 为该周星期一日期）
// 维护者：salt-fishes

var HUNAU_KB_PATH = '/jsxsd/xskb/xskb_list.do';
var HUNAU_CALENDAR_PATH = '/jsxsd/jxzl/jxzl_query';
var HUNAU_CLASS_DURATION = 45;
var HUNAU_BREAK_DURATION = 10;
var HUNAU_DEFAULT_TOTAL_WEEKS = 20;
var HUNAU_POST_OPTIONS = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

// 兜底作息：当课表页未提供节次时间时使用（按湖南农大 6 个大节、每节 45 分钟、课间 10 分钟推得）
var HUNAU_FALLBACK_TIME_SLOTS = [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
    { number: 3, startTime: '10:05', endTime: '10:50' },
    { number: 4, startTime: '11:00', endTime: '11:45' },
    { number: 5, startTime: '14:30', endTime: '15:15' },
    { number: 6, startTime: '15:25', endTime: '16:10' },
    { number: 7, startTime: '16:35', endTime: '17:20' },
    { number: 8, startTime: '17:30', endTime: '18:15' },
    { number: 9, startTime: '19:30', endTime: '20:15' },
    { number: 10, startTime: '20:25', endTime: '21:10' },
    { number: 11, startTime: '21:20', endTime: '22:05' },
    { number: 12, startTime: '22:15', endTime: '23:00' }
];

var HUNAU_CN_NUMBER = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

// ==================== 桥接封装 ====================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[HUNAU] ' + message);
    }
}

async function alertUser(title, message) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        const confirmed = await window.shiguangBridgePromise.showAlert(title, message, '知道了');
        return confirmed === true || confirmed === 'true';
    }
    alert(title + '\n' + message);
    return true;
}

// 原生以字符串序号或 "null" 回传，统一为数字序号，-1 表示取消
async function selectFromList(title, items, defaultIndex) {
    if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showSingleSelection === 'function')) {
        return defaultIndex;
    }
    const result = await window.shiguangBridgePromise.showSingleSelection(title, JSON.stringify(items), defaultIndex);
    if (result === null || result === undefined || result === 'null') return -1;
    const index = typeof result === 'number' ? result : parseInt(result, 10);
    return isNaN(index) ? -1 : index;
}

// ==================== 请求 ====================

// 兼容直连与 WebVPN 形态的地址，取当前路径中 /jsxsd/ 之前的部分作为前缀
function jsxsdUrl(path) {
    const currentPath = window.location.pathname || '';
    const index = currentPath.indexOf('/jsxsd/');
    return window.location.origin + (index < 0 ? '' : currentPath.slice(0, index)) + path;
}

async function requestText(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    return await response.text();
}

// 不同强智版本分别使用 #timetable 与 #kbtable
function findTimetableTable(doc) {
    return doc.getElementById('timetable') || doc.getElementById('kbtable');
}

// 优先 GET 带学期参数；失败再退回 POST 表单
async function fetchTimetableDoc(semesterValue) {
    const url = jsxsdUrl(HUNAU_KB_PATH);
    const got = new DOMParser().parseFromString(
        await requestText(url + '?xnxq01id=' + encodeURIComponent(semesterValue)), 'text/html');
    if (findTimetableTable(got)) return got;

    const body = 'xnxq01id=' + encodeURIComponent(semesterValue) + '&sfFD=1';
    const posted = new DOMParser().parseFromString(
        await requestText(url, Object.assign({ method: 'POST', body: body }, HUNAU_POST_OPTIONS)), 'text/html');
    return findTimetableTable(posted) ? posted : null;
}

// ==================== 学期 ====================

// 学期列表：[{ value: "2025-2026-2", label: "2025-2026 学年第 2 学期", selected: true }]
function parseSemesters(doc) {
    const select = doc.querySelector('select[name="xnxq01id"], select#xnxq01id');
    if (!select) return [];
    const list = [];
    select.querySelectorAll('option').forEach(function (option) {
        const value = String(option.getAttribute('value') || '').trim();
        if (!value) return;
        list.push({
            value: value,
            label: value.replace(/^(\d{4})-(\d{4})-(\d)$/, '$1-$2 学年第 $3 学期'),
            selected: option.hasAttribute('selected')
        });
    });
    return list;
}

// ==================== 节次时间 ====================

function timeToMinutes(text) {
    const match = String(text || '').match(/(\d{1,2}):(\d{2})/);
    return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : null;
}

function minutesToTime(minutes) {
    const value = Math.round(minutes);
    return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
}

// 从课表行标题（如“第一大节 08:00-09:40”）推导每一小节的上课时间。
// 大节内的小节数由时长反推：n 个小节的时长 = n*45 + (n-1)*课间，
// 大节内的剩余时间再均分为课间。这样即使某门课跨大节，也不会污染小节的节次编号。
function parseTimeSlots(doc) {
    const table = findTimetableTable(doc);
    if (!table) return [];
    const slots = [];
    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const label = row.querySelector('th');
        if (!label) return;
        const labelText = String(label.textContent).replace(/\s+/g, ' ').trim();
        const match = labelText.match(/第([一二三四五六七八九十]+)大节\s*(\d{1,2}:\d{2})\s*[-~—]\s*(\d{1,2}:\d{2})/);
        if (!match) return;

        const bigIndex = HUNAU_CN_NUMBER[match[1]];
        const startMin = timeToMinutes(match[2]);
        const endMin = timeToMinutes(match[3]);
        if (!bigIndex || startMin === null || endMin === null || endMin <= startMin) return;

        const span = endMin - startMin;
        const unit = HUNAU_CLASS_DURATION + HUNAU_BREAK_DURATION;
        const count = Math.max(1, Math.round((span + HUNAU_BREAK_DURATION) / unit));
        const gap = count > 1 ? (span - count * HUNAU_CLASS_DURATION) / (count - 1) : 0;

        for (let i = 0; i < count; i++) {
            const start = startMin + i * (HUNAU_CLASS_DURATION + gap);
            slots.push({
                number: (bigIndex - 1) * count + i + 1,
                startTime: minutesToTime(start),
                endTime: minutesToTime(start + HUNAU_CLASS_DURATION)
            });
        }
    });

    // 去重并按节次排序；数据不足时回退到内置作息
    const byNumber = {};
    slots.forEach(function (slot) { if (!byNumber[slot.number]) byNumber[slot.number] = slot; });
    const result = Object.keys(byNumber).map(function (key) { return byNumber[key]; })
        .sort(function (a, b) { return a.number - b.number; });
    return result.length >= 6 ? result : HUNAU_FALLBACK_TIME_SLOTS;
}

// ==================== 课表解析 ====================

// 周次与节次：兼容 1-16(周)[01-02节]、1-8,10-16(周)、1-15周(单)、2-16(双) 等写法
function parseWeeksAndSections(text) {
    const result = { weeks: [], sections: [] };
    const content = String(text || '').trim();
    if (!content) return result;

    const parity = /双/.test(content) ? 2 : (/单/.test(content) ? 1 : 0);
    const bracketIndex = content.indexOf('[');
    const cleaned = (bracketIndex >= 0 ? content.slice(0, bracketIndex) : content)
        .replace(/第/g, '')
        .replace(/至|到|~/g, '-')
        .replace(/[（(][^（）()]*[）)]/g, '')
        .replace(/周/g, '');

    cleaned.split(/[,，、;；\s]+/).forEach(function (segment) {
        const item = segment.trim();
        const range = item.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (range) {
            for (let week = parseInt(range[1], 10); week <= parseInt(range[2], 10); week++) result.weeks.push(week);
        } else if (/^\d+$/.test(item)) {
            result.weeks.push(parseInt(item, 10));
        }
    });

    if (parity) {
        result.weeks = result.weeks.filter(function (week) { return week % 2 === (parity === 1 ? 1 : 0); });
    }
    result.weeks = Array.from(new Set(result.weeks)).sort(function (a, b) { return a - b; });

    const sectionMatch = content.match(/\[([^\]]*)\]/);
    if (sectionMatch) {
        (sectionMatch[1].match(/\d+/g) || []).forEach(function (number) {
            const section = parseInt(number, 10);
            if (result.sections.indexOf(section) < 0) result.sections.push(section);
        });
        result.sections.sort(function (a, b) { return a - b; });
    }
    return result;
}

// 教师姓名在教师字体里与职称连写（如“何龙姣讲师”“周小红其他”），且多人以逗号分隔，逐个去掉常见职称后缀
function cleanTeacher(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const titles = ['其他正高级', '其他副高级', '其他中级', '其他初级', '副教授', '教授', '副研究员', '研究员',
        '高级实验师', '实验师', '高级工程师', '工程师', '高级技师', '技师', '讲师', '助教', '其他'];
    const strip = function (name) {
        const value = name.trim();
        for (let i = 0; i < titles.length; i++) {
            if (value.length > titles[i].length && value.slice(-titles[i].length) === titles[i]) {
                return value.slice(0, value.length - titles[i].length).trim();
            }
        }
        return value;
    };
    return raw.split(/[,，、;；\/]+/).map(strip).filter(function (name) { return name; }).join(',');
}

// 收集单个课表单元格内的全部课程候选。强智在格内同时输出简表与详表，
// 简表缺少教师与节次方括号，此处一并解析，交由归并阶段择优。
function collectCellCandidates(cellDiv, day, output, rowSections) {
    const html = String(cellDiv.innerHTML || '').trim();
    if (!html || html.replace(/&nbsp;/gi, '').trim() === '') return;

    html.split(/[-—–]{6,}\s*(?:<br\s*\/?>)?/i).forEach(function (blockHtml) {
        if (!blockHtml.trim()) return;

        const holder = document.createElement('div');
        holder.innerHTML = blockHtml;

        let name = '';
        for (let i = 0; i < holder.childNodes.length; i++) {
            const node = holder.childNodes[i];
            if (node.nodeType === 3 && /[\u4e00-\u9fa5]/.test(node.textContent)) {
                name = node.textContent.trim();
                break;
            }
        }
        if (!name) name = String(holder.textContent || '').split('\n')[0].trim();
        if (!name) return;

        const pickText = function (titles) {
            for (let i = 0; i < titles.length; i++) {
                const element = holder.querySelector('font[title*="' + titles[i] + '"]');
                if (element && element.textContent.trim()) return element.textContent.trim();
            }
            return '';
        };

        let timeText = pickText(['周次', '节次']);
        if (!/\[[^\]]*\]/.test(timeText)) {
            const bracket = String(holder.textContent || '').match(/\[[^\]]*\]/);
            if (bracket) timeText += bracket[0];
        }

        const parsed = parseWeeksAndSections(timeText || holder.textContent);
        if (parsed.weeks.length === 0) return;
        if (parsed.sections.length === 0 && rowSections) {
            for (let section = rowSections[0]; section <= rowSections[1]; section++) parsed.sections.push(section);
        }

        const teacher = cleanTeacher(pickText(['教师', '老师']));
        const position = pickText(['教室', '地点']).replace(/\[\s*\d+\s*-\s*\d+\s*\]\s*节?$/, '').trim();

        output.push({
            name: name,
            teacher: teacher,
            position: position,
            day: day,
            weeks: parsed.weeks,
            sections: parsed.sections,
            score: (teacher ? 4 : 0) + (/\[[^\]]*\]/.test(timeText) ? 3 : 0) +
                (position ? 1 : 0) + (parsed.sections.length > 1 ? 1 : 0)
        });
    });
}

// 按课程名、周次、教室归并候选，保留信息更完整的一条
function mergeCellCandidates(candidates) {
    const groups = {};
    const order = [];
    candidates.forEach(function (item) {
        const key = item.name + '|' + item.weeks.join(',') + '|' + item.position;
        if (groups[key] === undefined) {
            groups[key] = item;
            order.push(key);
        } else if (item.score > groups[key].score) {
            groups[key] = item;
        }
    });

    const courses = [];
    order.forEach(function (key) {
        const item = groups[key];
        if (item.sections.length === 0) return;
        courses.push({
            name: item.name,
            teacher: item.teacher || '未知教师',
            position: item.position || '未知地点',
            day: item.day,
            weeks: item.weeks,
            startSection: item.sections[0],
            endSection: item.sections[item.sections.length - 1]
        });
    });
    return courses;
}

function parseTimetable(doc) {
    const table = findTimetableTable(doc);
    if (!table) return [];

    const courses = [];
    let bigIndex = 0;
    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const label = row.querySelector('th');
        const labelText = label ? String(label.textContent).replace(/\s+/g, ' ').trim() : '';
        if (/^第[一二三四五六七八九十]+大节/.test(labelText)) bigIndex++;
        const rowSections = bigIndex > 0 ? [2 * bigIndex - 1, 2 * bigIndex] : null;

        Array.from(row.querySelectorAll('td')).forEach(function (cell, index) {
            const blocks = cell.querySelectorAll('div.kbcontent, div.kbcontent1');
            if (blocks.length === 0) return;

            const candidates = [];
            Array.from(blocks).forEach(function (block) {
                collectCellCandidates(block, index + 1, candidates, rowSections);
            });
            mergeCellCandidates(candidates).forEach(function (course) {
                courses.push(course);
            });
        });
    });
    return courses;
}

// ==================== 教学周历 ====================

// 教学周历：首列为周次序号，第二列 title 为该周星期一日期（如 2026年08月31）
function parseCalendar(doc) {
    const result = { semesterStartDate: null, totalWeeks: null };
    const table = doc.querySelector('table');
    if (!table) return result;

    const toDate = function (text) {
        const match = String(text || '').match(/(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})/);
        return match ? match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0') : null;
    };

    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const cells = Array.from(row.children);
        const first = cells.length > 0 ? String(cells[0].textContent).trim() : '';
        if (!/^\d+$/.test(first)) return;

        const week = parseInt(first, 10);
        result.totalWeeks = result.totalWeeks === null ? week : Math.max(result.totalWeeks, week);
        if (week === 1 && !result.semesterStartDate && cells.length > 1) {
            result.semesterStartDate = toDate(cells[1].getAttribute('title')) || toDate(cells[1].textContent);
        }
    });
    return result;
}

async function fetchCalendar(semesterValue) {
    try {
        const text = await requestText(jsxsdUrl(HUNAU_CALENDAR_PATH), Object.assign(
            { method: 'POST', body: 'xnxq01id=' + encodeURIComponent(semesterValue) }, HUNAU_POST_OPTIONS));
        return parseCalendar(new DOMParser().parseFromString(text, 'text/html'));
    } catch (error) {
        console.warn('[HUNAU] 教学周历读取失败：', error);
        return { semesterStartDate: null, totalWeeks: null };
    }
}

// ==================== 合并去重 ====================

// 节次与周次合并去重函数
// 来源：官方 Wiki《课程合并与去重函数》
// https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
            (a.startSection || 0) - (b.startSection || 0);
    });

    const step1Merged = [];
    let current = list[0];

    for (let i = 1; i < list.length; i++) {
        const next = list[i];

        const isSameCourseAndWeeks =
            current.name === next.name &&
            current.teacher === next.teacher &&
            current.position === next.position &&
            current.day === next.day &&
            current.weeks.join(',') === next.weeks.join(',');

        const isContinuous = current.endSection + 1 === next.startSection;
        const isDuplicate = current.startSection === next.startSection && current.endSection === next.endSection;

        if (isSameCourseAndWeeks && isContinuous) {
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
            a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) ||
            (a.day || 0) - (b.day || 0) ||
            (a.startSection || 0) - (b.startSection || 0) ||
            (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let merged = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const next = step1Merged[i];

        const isSameCourseAndSection =
            merged.name === next.name &&
            merged.teacher === next.teacher &&
            merged.position === next.position &&
            merged.day === next.day &&
            merged.startSection === next.startSection &&
            merged.endSection === next.endSection;

        if (isSameCourseAndSection) {
            merged.weeks = Array.from(new Set([...merged.weeks, ...next.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(merged);
            merged = next;
        }
    }
    step2Merged.push(merged);

    return step2Merged;
}

// ==================== 流程编排 ====================

async function runImportFlow() {
    try {
        if ((window.location.pathname || '').indexOf('/jsxsd/') < 0) {
            await alertUser('请先进入教务系统', '请登录教务系统并停留在任意教务功能页面后重新执行导入。');
            return;
        }

        toast('正在获取学期信息…');
        const listDoc = new DOMParser().parseFromString(await requestText(jsxsdUrl(HUNAU_KB_PATH)), 'text/html');
        const semesters = parseSemesters(listDoc);
        if (semesters.length === 0) {
            await alertUser('未获取到学期列表', '课表页返回异常，请确认登录状态有效后重试。');
            return;
        }

        let defaultIndex = 0;
        semesters.forEach(function (item, index) { if (item.selected) defaultIndex = index; });
        const picked = semesters.length > 1
            ? await selectFromList('选择学期', semesters.map(function (item) { return item.label; }), defaultIndex)
            : defaultIndex;
        if (picked < 0 || picked >= semesters.length) {
            toast('导入已取消');
            return;
        }
        const semester = semesters[picked];

        toast('正在获取 ' + semester.label + ' 课表…');
        const tableDoc = await fetchTimetableDoc(semester.value);
        if (!tableDoc) {
            await alertUser('未获取到课表数据', '请确认已登录教务系统后重试。');
            return;
        }

        const courses = mergeAndDistinctCourses(parseTimetable(tableDoc));
        if (courses.length === 0) {
            await alertUser('未解析到课程', semester.label + ' 页面中没有课程内容，该学期可能尚未发布课表。');
            return;
        }

        const calendar = await fetchCalendar(semester.value);
        const weeks = courses.reduce(function (all, course) { return all.concat(course.weeks); }, []);
        const config = {
            semesterTotalWeeks: Math.max(HUNAU_DEFAULT_TOTAL_WEEKS, Math.max.apply(null, weeks)),
            defaultClassDuration: HUNAU_CLASS_DURATION,
            defaultBreakDuration: HUNAU_BREAK_DURATION
        };
        if (calendar.semesterStartDate) {
            config.semesterStartDate = calendar.semesterStartDate;
        } else {
            toast('未读取到教学周历，开学日期可在软件内手动校准');
        }

        // 课表配置与节次时间属于可选数据，失败不影响课程导入
        try {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        } catch (error) {
            console.warn('[HUNAU] 课表配置保存失败：', error);
        }
        try {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(parseTimeSlots(tableDoc)));
        } catch (error) {
            console.warn('[HUNAU] 节次时间保存失败：', error);
        }

        if (!await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses))) {
            toast('课程保存失败，请重试');
            return;
        }

        toast('导入成功：' + semester.label + ' 共 ' + courses.length + ' 条课程时段');
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error('[HUNAU] 导入流程异常：', error);
        await alertUser('导入失败', error && error.message ? error.message : String(error));
    }
}

// 启动导入流程
runImportFlow();
