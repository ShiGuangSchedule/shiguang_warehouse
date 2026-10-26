// 曲阜师范大学(zhjw.qfnu.edu.cn) 拾光课程表适配脚本
// 教务系统：强智 jsxsd
// 使用流程：在软件内置浏览器登录教务系统，停留在任意教务功能页面后执行导入
// 说明：学期列表与教学周历自动读取；教务系统不提供节次时间，导入后需在软件内设置上课时间
// 维护者：Yumu-banxia

const QFNU_KB_URL = '/jsxsd/xskb/xskb_list.do';
const QFNU_CALENDAR_URL = '/jsxsd/jxzl/jxzl_query';
const QFNU_CLASS_DURATION = 45;
const QFNU_BREAK_DURATION = 10;
const QFNU_POST_OPTIONS = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

// ==================== 桥接封装 ====================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[QFNU] ' + message);
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

// 兼容直连与 WebVPN 形态的地址，取 /jsxsd/ 之前的部分作为前缀
function jsxsdUrl(path) {
    const currentPath = window.location.pathname || '';
    const index = currentPath.indexOf('/jsxsd/');
    return window.location.origin + (index < 0 ? '' : currentPath.slice(0, index)) + path;
}

async function requestText(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    return await response.text();
}

// 课表页表单字段与页面 Form1 一致，POST 失败时退回带查询参数的 GET
async function fetchTimetableDoc(semesterValue, kbjcmsid) {
    const url = jsxsdUrl(QFNU_KB_URL);
    const body = 'jx0404id=&cj0701id=&zc=&demo=&xnxq01id=' + encodeURIComponent(semesterValue) +
        '&sfFD=1&kbjcmsid=' + encodeURIComponent(kbjcmsid);

    const posted = new DOMParser().parseFromString(
        await requestText(url, Object.assign({ method: 'POST', body: body }, QFNU_POST_OPTIONS)), 'text/html');
    if (findTimetableTable(posted)) return posted;

    const got = new DOMParser().parseFromString(
        await requestText(url + '?xnxq01id=' + encodeURIComponent(semesterValue)), 'text/html');
    return findTimetableTable(got) ? got : null;
}

// ==================== 学期与教学周历 ====================

// 学期列表：[{ value: "2026-2027-1", label: "2026-2027 学年第 1 学期", selected: true }]
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

function parseKbjcmsid(doc) {
    const select = doc.querySelector('select[name="kbjcmsid"]');
    const option = select ? (select.querySelector('option[selected]') || select.querySelector('option')) : null;
    return option ? String(option.getAttribute('value') || '').trim() : '';
}

// 教学周历：首列为周次序号，第二列含该周星期一日期
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
        const text = await requestText(jsxsdUrl(QFNU_CALENDAR_URL), Object.assign(
            { method: 'POST', body: 'xnxq01id=' + encodeURIComponent(semesterValue) }, QFNU_POST_OPTIONS));
        return parseCalendar(new DOMParser().parseFromString(text, 'text/html'));
    } catch (error) {
        console.warn('[QFNU] 教学周历读取失败：', error);
        return { semesterStartDate: null, totalWeeks: null };
    }
}

// ==================== 课表解析 ====================

// 不同强智版本分别使用 #timetable 与 #kbtable
function findTimetableTable(doc) {
    return doc.getElementById('timetable') || doc.getElementById('kbtable');
}

// 周次与节次：兼容 1-16(周)[01-02节]、1-8,10-16(周)、1-15周(单)、2-16(双)、第3-4节 等写法
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

        const teacher = pickText(['教师', '老师']);
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
    Array.from(table.querySelectorAll('tr')).forEach(function (row) {
        const label = row.querySelector('th');
        const labelMatch = label ? String(label.textContent).match(/(\d+)\s*[~～\-—]\s*(\d+)\s*节/) : null;
        const rowSections = labelMatch ? [parseInt(labelMatch[1], 10), parseInt(labelMatch[2], 10)] : null;

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

// 节次与周次合并去重函数
// 来源：官方 Wiki《课程合并与去重函数》
// https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
// 阶段一按名称、教师、地点、星期、周次一致合并连续节次并去除完全重复，阶段二按相同节次合并周次
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
        const listDoc = new DOMParser().parseFromString(await requestText(jsxsdUrl(QFNU_KB_URL)), 'text/html');
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
        const tableDoc = await fetchTimetableDoc(semester.value, parseKbjcmsid(listDoc));
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
            semesterTotalWeeks: calendar.totalWeeks || Math.max.apply(null, weeks),
            defaultClassDuration: QFNU_CLASS_DURATION,
            defaultBreakDuration: QFNU_BREAK_DURATION
        };
        if (calendar.semesterStartDate) {
            config.semesterStartDate = calendar.semesterStartDate;
        } else {
            toast('未读取到教学周历，开学日期可在软件内手动校准');
        }

        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        if (!await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses))) {
            toast('课程保存失败，请重试');
            return;
        }

        toast('导入成功：' + semester.label + ' 共 ' + courses.length + ' 条课程时段');
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error('[QFNU] 导入流程异常：', error);
        await alertUser('导入失败', error && error.message ? error.message : String(error));
    }
}

// 启动导入流程
runImportFlow();
