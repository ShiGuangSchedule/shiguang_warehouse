// 北京工商大学(btbu.edu.cn) 拾光课程表适配脚本 · API解析（BTBU_02）
// 教务系统：强智（jsxsd）· 数据接口：/jsxsd/xskb/xskb_list.do
// 使用流程：登录教务系统（校园网直连或 WebVPN 均可）→ 进入任意教务页面 → 点击一键导入
// 自动获取学期列表
// 维护者：lztttt（出现解析问题请提交 issue 或 PR）
//
// 接口说明（依据 webvpn 抓包与 samples/xskb_list.html 校准）：
//   GET  {jsxsd前缀}/xskb/xskb_list.do          → 课表页（含学期下拉 xnxq01id 与课程模式 kbjcmsid）
//   POST {jsxsd前缀}/xskb/xskb_list.do          → 切换学期后的课表页（HTML，按真实页面结构解析）
//   请求体：cj0701id=&zc=&demo=&xnxq01id=学年-学期&sfFD=1&wkbkc=1&kbjcmsid=课程模式ID
//   WebVPN 包装形态：https://vpn.btbu.edu.cn/{https|https-443}/<站点哈希>/jsxsd/...
//   → 通过 location.pathname 中 '/jsxsd/' 的位置自动推导前缀，直连与 WebVPN 通用
//
// 传输方式：隐藏表单 + iframe 提交（与浏览器真实表单导航同语义）。
//   实测 WebVPN（深澜 wengine 会 hook window.fetch 并破坏 POST）与校园网直连均可靠。
//
// 输出数据：CourseJsonModel（不输出 id/color/remark 内部字段）
// 桥接 API 使用 v2 规范的 window.shiguangBridge / window.shiguangBridgePromise

// =========================================================================
// 桥接封装（浏览器 Alpha 调试时自动降级为 alert/console；原生返回值做归一化）
// =========================================================================

function toast(message) {
    if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
        window.shiguangBridge.showToast(message);
    } else {
        console.log('[BTBU] ' + message);
    }
}

async function alertUser(title, message) {
    if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showAlert === 'function') {
        // 原生侧以字符串 "true"/"false" 回传结果，字符串 "false" 为真值，统一归一化为布尔
        const confirmed = await window.shiguangBridgePromise.showAlert(title, message, '确定');
        return confirmed === true || confirmed === 'true';
    }
    alert(title + '\n' + message);
    return true;
}

// showPrompt 的全局校验函数（规范要求：验证通过返回 false，失败返回错误文案）
window.validateSemesterStartDate = function (input) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        const d = new Date(input + 'T00:00:00');
        if (!isNaN(d.getTime())) return false;
    }
    return '请输入 YYYY-MM-DD 格式的日期，例如 2025-09-01（学期第一周的周一）';
};

// showSingleSelection 归一化：原生以字符串序号或 "null" 回传，统一为数字序号（-1 表示取消）
async function selectFromList(title, items, defaultIndex) {
    if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showSingleSelection === 'function')) {
        return defaultIndex; // 无桥环境（浏览器调试）默认取推荐项
    }
    const r = await window.shiguangBridgePromise.showSingleSelection(title, JSON.stringify(items), defaultIndex);
    if (r === null || r === undefined || r === 'null') return -1;
    if (typeof r === 'number') return r;
    const n = parseInt(r, 10);
    return isNaN(n) ? -1 : n;
}

// =========================================================================
// 接口地址推导：兼容校园网直连（jwgl.btbu.edu.cn）与 WebVPN（vpn.btbu.edu.cn）
// =========================================================================

// 从当前页面地址推导 /jsxsd 前缀；不在教务系统页面内时返回 null
function getJsxsdBase() {
    const path = window.location.pathname;
    const idx = path.indexOf('/jsxsd/');
    if (idx < 0) return null;
    return path.slice(0, idx); // 直连：''；WebVPN：'/https/777264...b' 或 '/https-443/777...b'
}

async function fetchPage(url, options) {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url, text: text };
}

// =========================================================================
// 课表解析（依据真实页面结构校准；API 返回整页 HTML，经 DOMParser 构建文档后解析）
// =========================================================================

// 星期文本 → 数字（1=周一 … 7=周日），无法识别返回 0
function weekdayFromText(text) {
    const match = String(text || '').match(/(?:星期|周)\s*([一二三四五六日天])/);
    if (!match) return 0;
    return { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 }[match[1]];
}

// 扫描前几行表头，建立 “网格列号 → 星期几” 映射（考虑 colspan），至少命中 2 列才认为校准成功
function buildColumnDayMap(rows) {
    const map = {};
    for (let r = 0; r < Math.min(rows.length, 4); r++) {
        let col = 0;
        const headerCells = rows[r].querySelectorAll('th,td');
        for (let c = 0; c < headerCells.length; c++) {
            const span = parseInt(headerCells[c].getAttribute('colspan') || '1', 10) || 1;
            const day = weekdayFromText(headerCells[c].textContent);
            if (day >= 1 && day <= 7 && map[col] === undefined) map[col] = day;
            col += span;
        }
        if (Object.keys(map).length >= 2) break;
    }
    return map;
}

// 计算单元格在所在行中的网格列号（0 起，考虑 colspan）
function gridColumnIndexOf(cell) {
    const row = cell.parentElement;
    if (!row) return -1;
    let col = 0;
    for (let i = 0; i < row.children.length; i++) {
        if (row.children[i] === cell) return col;
        const span = parseInt(row.children[i].getAttribute('colspan') || '1', 10) || 1;
        col += span;
    }
    return -1;
}

/**
 * 解析“周次(节次)”文本 → { weeks: Number[], sections: Number[] }
 * 兼容格式（前三种为北工商实页形态）：
 *   "1-16(周)[01-02节]"、"1-16(周)[03-04-05节]"（三小节连排）、"9(周)"（单周）
 *   "1-8,10-16(周)[03-04节]"（分段）、"1-15周(单)[01-02节]"、"2-16(双)[01-02节]"（单双周）
 */
function parseWeeksAndSections(text) {
    const result = { weeks: [], sections: [] };
    const str = String(text || '').trim();
    if (!str) return result;

    // 1) 先识别单双周标记（(单)/(双)），全周课程无标记
    let parity = 0; // 1=单周 2=双周
    if (/双/.test(str)) parity = 2;
    else if (/单/.test(str)) parity = 1;

    // 2) 周次部分：取节次方括号“[”之前的内容，剥掉全部括号标记（(周)/(单)/(双)）与“周”字
    const bracketIdx = str.indexOf('[');
    const weekPart = bracketIdx >= 0 ? str.slice(0, bracketIdx) : str;
    const cleaned = weekPart
        .replace(/第/g, '')
        .replace(/至|到/g, '-')
        .replace(/[（(][^（）()]*[）)]/g, '')
        .replace(/周/g, '');

    for (let seg of cleaned.split(/[,，、;；\s]+/)) {
        seg = seg.trim();
        if (!seg) continue;
        const range = seg.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
        if (range) {
            let a = parseInt(range[1], 10);
            let b = parseInt(range[2], 10);
            if (a > b) { const t = a; a = b; b = t; }
            for (let w = a; w <= b; w++) result.weeks.push(w);
        } else {
            const w = parseInt(seg, 10);
            if (!isNaN(w)) result.weeks.push(w);
        }
    }

    // 3) 应用单双周过滤并排序去重
    if (parity === 1) result.weeks = result.weeks.filter(w => w % 2 === 1);
    else if (parity === 2) result.weeks = result.weeks.filter(w => w % 2 === 0);
    result.weeks = Array.from(new Set(result.weeks)).sort((a, b) => a - b);

    // 4) 节次部分：“[01-02节]”→[1,2]，“[03-04-05节]”→[3,4,5]
    //    存在三小节连排（如 03-04-05），直接提取方括号内全部数字
    const secMatch = str.match(/\[([^\]]*)\]/);
    if (secMatch) {
        const nums = secMatch[1].match(/\d+/g);
        if (nums) {
            for (let i = 0; i < nums.length; i++) {
                const s = parseInt(nums[i], 10);
                if (!isNaN(s)) result.sections.push(s);
            }
        }
    }

    return result;
}

// 清理课程名称文本：剥离课程编号/课号前缀与后缀，返回纯课名（可能为空）
function cleanCourseName(text) {
    let name = String(text || '').trim();
    if (!name) return '';
    // “课程编号：XXX”（kchConfig 里的编号已在 DOM 层移除，这里兜底）
    name = name.replace(/课程编号\s*[:：]?\s*[A-Z0-9]+/gi, '');
    // 行首字母开头的短编码（如 CS101、GS140001），后随中文/空白/括号才剔除，
    // 避免误伤 “MATLAB程序设计” 等以字母开头的真实课名
    name = name.replace(/^[A-Za-z]{1,6}\d{2,10}[A-Za-z]?(?=[\u4e00-\u9fa5\s（(])\s*/, '');
    // 行首长编码（北工商形如 080901C4S2007：连续字母数字≥8位且含数字，后随中文/括号）
    name = name.replace(/^[A-Za-z0-9]{8,16}(?=[\u4e00-\u9fa5（(])/, function (m) {
        return /\d/.test(m) ? '' : m;
    });
    // 行首纯数字编码（如 “14000101高等数学”）
    name = name.replace(/^\d{5,12}(?=[\u4e00-\u9fa5\s（(])\s*/, '');
    // 行尾编码（如 “高等数学01110037”“高等数学（01110037）”）
    name = name.replace(/[（(][0-9A-Za-z]{5,16}[)）]\s*$/, '');
    name = name.replace(/([\u4e00-\u9fa5）)])(\d{5,12}[A-Za-z]?)\s*$/, '$1');
    return name.trim();
}

// 是否为“纯编号”文本（不含中文），兼容北工商形态 "080901C4S2007"、纯数字 "01110037"、"GS140001"
function isPureCourseCode(text) {
    if (/[\u4e00-\u9fa5]/.test(text)) return false;
    if (/^\d{6,16}$/.test(text)) return true;
    return /^[A-Z0-9]{6,16}$/.test(text) && /\d/.test(text) && /[A-Za-z]/.test(text);
}

// 解析一个课表格子（.kbcontent / .kbcontent1）内的课程信息，追加到 out
// 北工商真实结构（依据 samples/xskb_list.html 校准）：
//   课名 = 无 title 的外层 font，内嵌 <font class="kchConfig">（含 hint 与纯编号）+ <br> + 课名；
//   元数据 font 带 title：教师 / 周次(节次) / 教室 / 教学楼 / 通知单编号 / 班级 / 备注 / 课程二维码；
//   教务渲染的隐藏 kbcontent1 与可见 kbcontent 内容重复，由 parseTimetable 负责跳过。
function parseCellInto(cellDiv, day, out, rowSections) {
    const allFonts = cellDiv.getElementsByTagName('font');
    const fonts = [];
    for (let i = 0; i < allFonts.length; i++) {
        // 跳过嵌套在另一个 font 内部的 font（kchConfig/hint 会随外层整体清理）
        if (allFonts[i].parentElement && allFonts[i].parentElement.tagName === 'FONT') continue;
        fonts.push(allFonts[i]);
    }

    let current = null;
    let pendingCode = null; // 尚未等到课名的纯编号

    const pushCurrent = function () {
        if (current) {
            // 无 [节次] 括号时，用所在行标签的节次范围兜底（如 “1~2节”）
            if (current.sections.length === 0 && rowSections) {
                for (let s = rowSections[0]; s <= rowSections[1]; s++) current.sections.push(s);
            }
            out.push(current);
            current = null;
        }
    };
    const startCourse = function (name) {
        pushCurrent();
        current = { name: name, position: '', teacher: '', weeks: [], day: day, sections: [] };
    };

    for (let j = 0; j < fonts.length; j++) {
        const f = fonts[j];
        const title = f.getAttribute('title') || '';

        if (!title) {
            const tempNode = f.cloneNode(true);
            const kchElements = tempNode.getElementsByClassName('kchConfig');
            while (kchElements.length > 0) kchElements[0].parentNode.removeChild(kchElements[0]);

            const text = tempNode.textContent.replace(/\u00a0/g, ' ').trim();
            if (!text || /^[-—\s]+$/.test(text)) {
                // 同格两门课之间的 “------” 分隔线：结算上一门
                pushCurrent();
                pendingCode = null;
                continue;
            }

            // 关键：用清理后的名字判断是否课名，避免 “课程编号：XXX” 被清成纯编号后误当成课名
            const name = cleanCourseName(text);
            if (name && /[\u4e00-\u9fa5]/.test(name)) {
                startCourse(name);
                pendingCode = null;
            } else if (name && isPureCourseCode(name)) {
                if (!current) pendingCode = name; // 编号在课名之前单独出现，先暂存
                // 课程已开始时出现的编号只是附加信息，忽略
            }
        } else if (title.indexOf('课程') !== -1 && title.indexOf('周次') === -1) {
            // title=“课程名称”（其他强智变体的结构）
            const name = cleanCourseName(f.textContent.trim());
            if (name) startCourse(name);
            pendingCode = null;
        } else {
            if (!current && pendingCode) {
                // 编号后直接跟元数据且始终无课名：以编号兜底建课，避免丢课
                startCourse(pendingCode);
            }
            pendingCode = null;
            if (current) {
                const text = f.textContent.trim();
                // title 兼容 “教师/老师” 两种强智写法
                if (title.indexOf('教师') !== -1 || title.indexOf('老师') !== -1) {
                    current.teacher = text;
                } else if (title.indexOf('周次') !== -1) {
                    const parsed = parseWeeksAndSections(text);
                    current.weeks = parsed.weeks;
                    current.sections = parsed.sections;
                } else if (title.indexOf('教室') !== -1) {
                    current.position = text;
                }
            }
        }
    }
    pushCurrent();
}

function parseTimetable(doc) {
    const table = doc.getElementById('timetable');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    const colDayMap = buildColumnDayMap(rows);

    const result = [];
    for (let r = 0; r < rows.length; r++) {
        // 行标签里的节次范围（北工商形如 “1~2节 (01,02小节) 08:00-09:35”），作为无 [节次] 括号时的兜底
        const firstCell = rows[r].querySelector('th,td');
        const labelMatch = firstCell ? String(firstCell.textContent).match(/(\d+)\s*[~～]\s*(\d+)\s*节/) : null;
        const rowSections = labelMatch ? [parseInt(labelMatch[1], 10), parseInt(labelMatch[2], 10)] : null;

        const cells = rows[r].querySelectorAll('.kbcontent, .kbcontent1');
        if (cells.length === 0) continue;

        for (let i = 0; i < cells.length; i++) {
            const cellDiv = cells[i];
            // 北工商的 kbcontent1 是 display:none 的缩略副本，与同格 kbcontent 内容重复，跳过
            // （其他强智变体中可见的 kbcontent1 表示同格第二门课，不受影响）
            if (cellDiv.style && cellDiv.style.display === 'none') continue;

            const ownerCell = cellDiv.closest('td,th');
            if (!ownerCell) continue;

            const col = gridColumnIndexOf(ownerCell);
            if (col < 0) continue;

            // 优先使用表头校准结果；无表头时退化为“列号+1”（强智首列通常为节次标签列）
            const day = colDayMap[col] !== undefined ? colDayMap[col] : col + 1;
            if (day < 1 || day > 7) continue;

            parseCellInto(cellDiv, day, result, rowSections);
        }
    }
    return result;
}

// =========================================================================
// 学期信息提取（从 xskb_list.do 返回的页面中读取下拉框）
// =========================================================================

// 学期列表：[{ value: "2025-2026-2", label: "2025-2026学年第2学期" }, ...]（新学期在前）
function parseSemesterOptions(doc) {
    const sel = doc.querySelector('select[name="xnxq01id"]');
    if (!sel) return [];
    const out = [];
    sel.querySelectorAll('option').forEach(function (opt) {
        const v = (opt.getAttribute('value') || '').trim();
        if (!v) return;
        const label = v.replace(/^(\d{4})-(\d{4})-(\d)$/, '$1-$2 学年第 $3 学期');
        out.push({ value: v, label: label });
    });
    return out;
}

// 课程模式 ID（北工商仅 “默认节次模式” 一项；取不到时使用抓包所得常量兜底）
function parseKbjcmsid(doc) {
    const sel = doc.querySelector('select[name="kbjcmsid"]');
    if (sel) {
        const selected = sel.querySelector('option[selected], option:checked');
        const opt = selected || sel.querySelector('option[value]');
        if (opt) return (opt.getAttribute('value') || '').trim();
    }
    return 'BA619E6D28314968AD899E77F638AE08';
}

// =========================================================================
// 数据结构转换与合并（官方推荐，严格条件）
// =========================================================================

function convertCourses(rawCourses) {
    return rawCourses
        .map(function (item) {
            const sections = item.sections;
            return {
                name: item.name,
                teacher: item.teacher || '未知教师',
                position: item.position || '未知地点',
                day: item.day,
                startSection: sections[0],
                endSection: sections[sections.length - 1],
                weeks: item.weeks
            };
        })
        .filter(function (c) {
            return c.weeks.length > 0 &&
                Number.isInteger(c.startSection) && Number.isInteger(c.endSection);
        });
}

/**
 * 节次与周次合并去重函数
 * 来源：官方 Wiki《课程合并与去重函数》
 * https://github.com/XingHeYuZhuan/shiguangschedule/wiki/课程合并与去重函数
 * 功能：连续节次合并(1-2节+3-4节→1-4节)、同节次周次合并(单双周)、完全去重、周次排序
 * 采用官方严格条件：名称、教师、地点、星期、周次一致才合并；
 * 北工商同一门课跨大节时教师/教室可能不同，此时保留为两条独立记录。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    // 1. 深拷贝并规范周次数据，过滤无效项
    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致，官方严格条件）
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

    // 阶段 2：合并同节次的周次（前提：名称、教师、地点、星期、开始/结束节次一致）
    step1Merged.sort((a, b) => {
        return a.name.localeCompare(b.name) ||
               a.teacher.localeCompare(b.teacher) ||
               a.position.localeCompare(b.position) ||
               (a.day || 0) - (b.day || 0) ||
               (a.startSection || 0) - (b.startSection || 0) ||
               (a.endSection || 0) - (b.endSection || 0);
    });

    const step2Merged = [];
    let cur = step1Merged[0];

    for (let i = 1; i < step1Merged.length; i++) {
        const nxt = step1Merged[i];

        const isSameCourseAndSection =
            cur.name === nxt.name &&
            cur.teacher === nxt.teacher &&
            cur.position === nxt.position &&
            cur.day === nxt.day &&
            cur.startSection === nxt.startSection &&
            cur.endSection === nxt.endSection;

        if (isSameCourseAndSection) {
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

// =========================================================================
// 保存流程（顺序遵循规范参考：配置 → 课程 → 时间段；时间段失败不阻塞导入）
// =========================================================================

async function promptSemesterStartDate() {
    if (!(window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showPrompt === 'function')) {
        return null;
    }
    const input = await window.shiguangBridgePromise.showPrompt(
        '学期开始日期',
        '请输入本学期第一周的周一日期（YYYY-MM-DD）\n 点击取消跳过、后续可在软件内设置。',
        '',
        'validateSemesterStartDate'
    );
    // 原生侧取消时回传字符串 "null"，一并按取消处理
    if (input === null || input === undefined || input === 'null') return null;
    const trimmed = String(input).trim();
    return trimmed ? trimmed : null;
}

async function saveCourseConfig(rawCourses) {
    const allWeeks = rawCourses.flatMap(function (c) { return c.weeks; });
    const maxWeek = allWeeks.length > 0 ? Math.max.apply(null, allWeeks) : 20;

    const startDate = await promptSemesterStartDate();

    const config = {
        semesterTotalWeeks: maxWeek > 0 ? maxWeek : 20,
        defaultBreakDuration: 5
    };
    if (startDate) {
        config.semesterStartDate = startDate;
    } else {
        toast('未设置学期开始日期，可稍后在软件内手动校准周次');
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        console.error('[BTBU] 保存课表配置失败:', error);
        toast('课表配置保存失败：' + (error && error.message ? error.message : error));
        return false;
    }
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        console.error('[BTBU] 保存课程失败:', error);
        toast('课程保存失败：' + (error && error.message ? error.message : error));
        return false;
    }
}

async function importPresetTimeSlots() {
    // 北工商作息时间表（13 节）
    const timeSlots = [
        { number: 1, startTime: '08:00', endTime: '08:45' },
        { number: 2, startTime: '08:50', endTime: '09:35' },
        { number: 3, startTime: '09:50', endTime: '10:35' },
        { number: 4, startTime: '10:40', endTime: '11:25' },
        { number: 5, startTime: '11:30', endTime: '12:15' },
        { number: 6, startTime: '13:40', endTime: '14:25' },
        { number: 7, startTime: '14:30', endTime: '15:15' },
        { number: 8, startTime: '15:30', endTime: '16:15' },
        { number: 9, startTime: '16:20', endTime: '17:05' },
        { number: 10, startTime: '17:10', endTime: '17:55' },
        { number: 11, startTime: '18:45', endTime: '19:30' },
        { number: 12, startTime: '19:35', endTime: '20:20' },
        { number: 13, startTime: '20:25', endTime: '21:10' }
    ];

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        return true;
    } catch (error) {
        // 规范：时间段导入失败通常不阻止最终流程完成
        console.warn('[BTBU] 时间段导入失败(不阻塞):', error);
        toast('作息时间导入失败，可稍后在软件内手动设置');
        return false;
    }
}

// 通过隐藏表单 + 隐藏 iframe 提交（与浏览器真实表单导航同语义，
// Sec-Fetch-Dest: iframe / Referer 均与浏览器一致）。
// 实测：WebVPN 环境下深澜 wengine 会 hook window.fetch 并破坏 POST 请求，
// 而真实表单导航四个学期全部成功 —— 故为唯一的课表传输方式。
// 超时可经 window.__BTBU_FORM_TIMEOUT_MS__ 覆盖（默认 8000ms，移动网络经 WebVPN 较慢）。
// 返回提交后 iframe 内的 document（无论是否含课表，由调用方判定），异常时返回 null。
function submitViaHiddenForm(action, body) {
    return new Promise(function (resolve) {
        try {
            const frame = document.createElement('iframe');
            frame.name = 'btbuPostFrame' + Date.now();
            frame.style.display = 'none';
            const form = document.createElement('form');
            form.action = action;
            form.method = 'POST';
            form.target = frame.name;
            new URLSearchParams(body).forEach(function (v, k) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = k;
                input.value = v;
                form.appendChild(input);
            });
            document.body.appendChild(frame);
            document.body.appendChild(form);

            const timeoutMs = (window.__BTBU_FORM_TIMEOUT_MS__ | 0) || 8000;
            let settled = false;
            const finish = function (doc) {
                if (settled) return;
                settled = true;
                try { if (form.parentNode) form.parentNode.removeChild(form); } catch (e) {}
                setTimeout(function () { try { if (frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) {} }, 1000);
                resolve(doc || null);
            };
            frame.addEventListener('load', function () {
                try {
                    const d = frame.contentDocument;
                    if (!d || d.location.href === 'about:blank') return; // 初始空页，忽略
                    finish(d);
                } catch (e) { finish(null); }
            });
            setTimeout(function () {
                try { finish(frame.contentDocument); } catch (e) { finish(null); }
            }, timeoutMs);
            form.submit();
        } catch (e) { resolve(null); }
    });
}

// =========================================================================
// 流程编排
// =========================================================================

/**
 * 编排整个课程导入流程：
 *   推导接口前缀 → 拉取课表页（学期列表）→ 弹窗选学期 → 隐藏表单+iframe 拉取对应学期课表
 *   → 解析合并 → 保存。任何一步取消或失败都立即退出；notifyTaskCompletion 只在成功后调用。
 */
async function runImportFlow() {
    try {
        const base = getJsxsdBase();
        if (base === null) {
            await alertUser(
                '请先进入教务系统',
                '未检测到教务系统页面（/jsxsd/）。请先登录教务系统，进入主页或任意教务功能页面后再点击导入。'
            );
            return;
        }
        const listUrl = window.location.origin + base + '/jsxsd/xskb/xskb_list.do';

        // 1. 拉取课表页，提取学期列表
        toast('正在获取学期信息...');
        const listPage = await fetchPage(listUrl);
        const listDoc = new DOMParser().parseFromString(listPage.text, 'text/html');
        const semesters = parseSemesterOptions(listDoc);
        if (semesters.length === 0) {
            await alertUser(
                '未获取到学期列表',
                '课表页返回异常（HTTP ' + listPage.status + '，' + listPage.text.length + ' 字节），可能是登录已失效。请重新登录教务系统后再点击导入。'
            );
            return;
        }

        // 2. 用户选择学期（默认第一项，即最新学期）
        const labels = semesters.map(function (s) { return s.label; });
        const picked = await selectFromList('选择学期', labels, 0);
        if (picked < 0 || picked >= semesters.length) {
            toast('导入已取消');
            return;
        }
        const semester = semesters[picked];
        const kbjcmsid = parseKbjcmsid(listDoc);

        // 3. 请求所选学期的课表（请求体与浏览器抓包一致，经隐藏表单+iframe 提交）
        toast('正在获取 ' + semester.label + ' 课表...');
        const body = 'cj0701id=&zc=&demo=&xnxq01id=' + encodeURIComponent(semester.value) +
            '&sfFD=1&wkbkc=1&kbjcmsid=' + encodeURIComponent(kbjcmsid);
        let tableDoc = null;
        const frameDoc = await submitViaHiddenForm(listUrl, body);
        if (frameDoc && frameDoc.getElementById('timetable')) tableDoc = frameDoc;

        if (!tableDoc) {
            await alertUser(
                '未获取到课表数据',
                '请确认已登录教务系统后重试；如多次失败，请重新登录后再试或反馈给维护者。'
            );
            return;
        }

        // 4. 解析与合并（依据真实页面结构校准的解析规则）
        toast('正在解析课表...');
        const rawCourses = parseTimetable(tableDoc);
        if (rawCourses.length === 0) {
            await alertUser(
                '未解析到课程',
                semester.label + ' 的课表页面已获取，但表格中没有课程内容——该学期可能暂未发布课表数据。'
            );
            return;
        }

        // 5. 课表配置（含学期开始日期，可跳过）
        const configSaved = await saveCourseConfig(rawCourses);
        if (!configSaved) return;

        // 6. 课程数据（核心）
        const courses = mergeAndDistinctCourses(convertCourses(rawCourses));
        const saved = await saveCourses(courses);
        if (!saved) return;

        // 7. 预设作息时间段（失败不阻塞导入结果）
        await importPresetTimeSlots();

        toast('导入成功：' + semester.label + ' 共 ' + courses.length + ' 条课程时段');
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error('BTBU import failed:', error);
        await alertUser('导入失败', error && error.message ? error.message : String(error));
    }
}

// 启动导入流程
runImportFlow();
