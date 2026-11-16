// 广东交通职业技术学院（jw.gdcp.edu.cn）强智「教学管理信息服务平台」拾光适配脚本（容错版）
// 与同目录 gdcp_01.js / gdcp_02.js 的区别：不强制校验 origin；7 列与 8 列表格都支持，节次优先取课程自带的
// “周次(节次)”字段；单元格结构异常只跳过该格；校区、作息、周历任一取不到都降级继续导入，不中断。
// 作息与校区数据沿用 gdcp_01.js（作者：小漫君）与 gdcp_02.js（作者：Haooz）。
// 适配作者：拾光课程表社区

'use strict';

// 'byBuilding' 按校区表区分早/晚班（不一致的课程带自定义时间）；'uniform' 全校区共用基础作息。
// 学校若统一作息，改成 'uniform' 即可。
const SCHEDULE_MODE = 'byBuilding';

const GDCP_ORIGIN = 'https://jw.gdcp.edu.cn';
const TIMETABLE_PATH = '/jsxsd/xskb/xskb_list.do';
const CALENDAR_PATH = '/jsxsd/jxzl/jxzl_query';

// 基础作息（早班）。第 7~8、9~10、11~12 节为 80 分钟连堂，网格按 40 分钟一小节排布。
const BASE_SLOTS = [
    { number: 1, startTime: '08:30', endTime: '09:10' },
    { number: 2, startTime: '09:15', endTime: '09:55' },
    { number: 3, startTime: '10:10', endTime: '10:50' },
    { number: 4, startTime: '10:55', endTime: '11:35' },
    { number: 5, startTime: '14:15', endTime: '14:55' },
    { number: 6, startTime: '15:00', endTime: '15:40' },
    { number: 7, startTime: '15:55', endTime: '16:35' },
    { number: 8, startTime: '16:35', endTime: '17:15' },
    { number: 9, startTime: '18:05', endTime: '18:45' },
    { number: 10, startTime: '18:45', endTime: '19:25' },
    { number: 11, startTime: '19:40', endTime: '20:20' },
    { number: 12, startTime: '20:20', endTime: '21:00' }
];

// 晚班作息：仅第 3、4 节推后 20 分钟
const LATE_SLOTS = BASE_SLOTS.map(function (slot) {
    if (slot.number === 3) return { number: 3, startTime: '10:30', endTime: '11:10' };
    if (slot.number === 4) return { number: 4, startTime: '11:15', endTime: '11:55' };
    return slot;
});

const CAMPUSES = [
    { name: '天河校区', early: ['9号楼', '10号楼', '12号楼', '图书馆', '公路楼', '汽车实训楼', '轨道楼'], late: ['2号楼', '运动场'] },
    { name: '花都校区', early: ['1号楼', '图书馆'], late: ['10号楼', '15号楼', '16号楼', '运动场'] },
    { name: '国际校区', early: ['教学楼', '运动场'], late: [] },
    { name: '清远校区', early: ['厚德楼', '明德楼', '立业楼', '创新楼', '求是楼', '笃实楼'], late: ['融新楼', '融创楼', '运动场', '体育馆'] }
];

function toHalfWidth(str) {
    return String(str == null ? '' : str)
        .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
        .replace(/\u3000/g, ' ');
}

function clean(str) {
    return String(str == null ? '' : str).replace(/[\s\u00a0]+/g, ' ').trim();
}

function toast(msg) {
    try {
        if (window.shiguangBridge && window.shiguangBridge.showToast) window.shiguangBridge.showToast(msg);
    } catch (e) { /* ignore */ }
}

async function alertUser(title, content, confirmText) {
    try {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, content, confirmText || '知道了');
        }
    } catch (e) { /* ignore */ }
    return true;
}

const BLOCK_TAGS = {
    DIV: 1, P: 1, TR: 1, LI: 1, TABLE: 1, TBODY: 1, THEAD: 1, BR: 1, TD: 1, TH: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, DL: 1, DT: 1, DD: 1, SECTION: 1, ARTICLE: 1
};

function lookLikeFields(texts) {
    const hasWeek = texts.some(function (t) { return /周/.test(t); });
    const hasSec = texts.some(function (t) { return /节/.test(t); });
    const hasPos = texts.some(function (t) { return /教室|教学楼|楼|室|馆|场/.test(t); });
    if (!hasWeek && !hasSec && !hasPos) return false;
    const shortCount = texts.filter(function (t) { return t.length <= 14; }).length;
    return shortCount >= Math.ceil(texts.length / 2);
}

function textLines(node, doc) {
    let buf = '';
    (function walk(n) {
        if (!n) return;
        if (n.nodeType === 3) { buf += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        const isBlock = !!BLOCK_TAGS[n.tagName];
        if (isBlock) buf += '\n';

        const kids = n.children;
        let split = false;
        if (kids && kids.length >= 2 && kids.length <= 8) {
            const texts = [];
            for (let i = 0; i < kids.length; i++) {
                if (BLOCK_TAGS[kids[i].tagName]) { texts.length = 0; break; }
                const t = clean(kids[i].textContent);
                if (t) texts.push(t);
            }
            if (texts.length >= 2) split = lookLikeFields(texts);
        }

        if (split) {
            for (let i = 0; i < n.childNodes.length; i++) { buf += '\n'; walk(n.childNodes[i]); }
            buf += '\n';
        } else {
            for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
        }
        if (isBlock) buf += '\n';
    })(node);
    return buf.split('\n').map(clean).filter(Boolean);
}

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function parseWeeks(text) {
    if (text == null) return [];
    let s = toHalfWidth(text)
        .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
        .replace(/[\[\]{}]/g, ' ')
        .replace(/:/g, ' ');
    s = s.replace(/第?\s*\d{1,2}\s*[-–~至]\s*\d{1,2}\s*节/g, ' ')
        .replace(/第?\s*\d{1,2}\s*节/g, ' ')
        .replace(/周次|周数|上课周|起始周|结束周|全部|单周|双周|第|周/g, ' ')
        .replace(/单/g, ' 单 ').replace(/双/g, ' 双 ');

    const weeks = new Set();
    s.split(/[,，、;；]+|\s+(?=\d)/).forEach(function (seg) {
        seg = seg.trim();
        if (!seg) return;
        const isOdd = /单/.test(seg);
        const isEven = /双/.test(seg);
        const body = seg.replace(/单|双|\(|\)|\s/g, '').replace(/^[^\d]+/, '').replace(/[^\d]+$/, '');
        if (!body) return;

        const range = body.match(/^(\d{1,2})\s*[-–~至]\s*(\d{1,2})$/);
        if (range) {
            const a = parseInt(range[1], 10);
            const b = parseInt(range[2], 10);
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
                if (isOdd && i % 2 === 0) continue;
                if (isEven && i % 2 === 1) continue;
                weeks.add(i);
            }
            return;
        }
        const single = body.match(/^(\d{1,2})$/);
        if (single) {
            const n = parseInt(single[1], 10);
            if (isOdd && n % 2 === 0) return;
            if (isEven && n % 2 === 1) return;
            weeks.add(n);
        }
    });
    return Array.from(weeks).filter(function (w) { return w >= 1 && w <= 40; }).sort(function (a, b) { return a - b; });
}

function parseSections(text) {
    if (text == null) return null;
    const s = toHalfWidth(text).replace(/[（(]/g, '(').replace(/[）)]/g, ')').replace(/[\[\]{}]/g, ' ').trim();
    if (!s) return null;

    let m = s.match(/(\d{1,2})\s*[-–~至]\s*(\d{1,2})\s*节/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    // 强智行头：「0102节 (01,02小节)」「1112节 (11,12小节)」
    m = s.match(/\(?\s*(\d{1,2})\s*[,，]\s*(\d{1,2})\s*小节/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    m = s.match(/(\d{2})(\d{2})\s*节/);
    if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (a >= 1 && b >= a && b <= 20) return { start: a, end: b };
    }
    m = s.match(/第\s*(\d{1,2})\s*节/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[1], 10) };
    m = s.match(/第([一二三四五六七八九十])大节/);
    if (m) { const n = CN_NUM[m[1]] || 0; if (n) return { start: n, end: n }; }
    m = s.match(/^(\d{1,2})\s*[-–~]\s*(\d{1,2})$/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    m = s.match(/^(\d{1,2})$/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[1], 10) };
    return null;
}

// 解析 “1-16周(单)[01-02节]” 这类强智字段
function parseWeekSectionText(text) {
    const raw = clean(toHalfWidth(text));
    const weeks = parseWeeks(raw);

    const sections = [];
    const brackets = raw.match(/\[[^\]]*\]/g) || [];
    brackets.forEach(function (group) {
        (group.match(/\d+/g) || []).forEach(function (num) {
            const n = parseInt(num, 10);
            if (n >= 1 && n <= 20 && sections.indexOf(n) < 0) sections.push(n);
        });
    });
    sections.sort(function (a, b) { return a - b; });
    if (!sections.length) {
        const fallback = parseSections(raw);
        if (fallback) return { weeks: weeks, startSection: fallback.start, endSection: fallback.end };
        return { weeks: weeks, startSection: null, endSection: null };
    }
    return { weeks: weeks, startSection: sections[0], endSection: sections[sections.length - 1] };
}

function dayFromText(text) {
    if (!text) return null;
    const s = toHalfWidth(text).replace(/\s/g, '');
    const m = s.match(/(?:星期|周|礼拜)([一二三四五六日天1-7])/);
    if (m) {
        const k = m[1];
        if (CN_NUM[k]) return CN_NUM[k];
        if (k === '日' || k === '天') return 7;
        const n = parseInt(k, 10);
        if (n >= 1 && n <= 7) return n;
    }
    return null;
}

function buildGrid(table) {
    const rows = Array.prototype.slice.call(table.rows || table.querySelectorAll('tr'));
    const grid = [];
    const occupied = [];

    rows.forEach(function (row, r) {
        if (!grid[r]) grid[r] = [];
        let c = 0;
        const cells = Array.prototype.slice.call(row.cells || row.children);
        cells.forEach(function (cell) {
            while (occupied[r] && occupied[r][c]) c++;
            const rs = Math.max(1, cell.rowSpan || 1);
            const cs = Math.max(1, cell.colSpan || 1);
            grid[r][c] = { cell: cell, rowSpan: rs, colSpan: cs, origin: true };
            for (let dr = 0; dr < rs; dr++) {
                const rr = r + dr;
                if (!occupied[rr]) occupied[rr] = [];
                for (let dc = 0; dc < cs; dc++) {
                    occupied[rr][c + dc] = true;
                    if (dr > 0 || dc > 0) {
                        if (!grid[rr]) grid[rr] = [];
                        grid[rr][c + dc] = { cell: cell, rowSpan: rs, colSpan: cs, origin: false };
                    }
                }
            }
            c += cs;
        });
    });
    return grid;
}

function gridWidth(grid) {
    let width = 0;
    grid.forEach(function (row) { if (row && row.length > width) width = row.length; });
    return width;
}

function detectDayColumns(grid) {
    const map = {};
    const scanRows = Math.min(grid.length, 5);
    for (let r = 0; r < scanRows; r++) {
        (grid[r] || []).forEach(function (slot, c) {
            if (!slot || !slot.origin || map[c] !== undefined) return;
            const text = clean(slot.cell.textContent);
            if (text.length > 12) return;              // 表头单元格限定短文本，避免误认课程内容
            const day = dayFromText(text);
            if (day) map[c] = day;
        });
        if (Object.keys(map).length >= 5) break;
    }
    return map;
}

const SEPARATOR = /-{6,}\s*<br\s*\/?>/i;

// 一格内可能同时有简表 kbcontent1（无教师无节次）、详表 kbcontent 和另一个节次模式的空占位，
// 全解析会重复，所以按信息完整度打分，每格只取最高的那一份。
function rankedContainers(cell) {
    const found = Array.prototype.slice.call(cell.querySelectorAll('div[class*="kbcontent"]'));
    return found.map(function (div) {
        const hasTeacher = div.querySelector("font[title='教师']") ? 1 : 0;
        const titled = div.querySelectorAll('font[title]').length;
        const text = clean(div.textContent).length;
        return { div: div, score: hasTeacher * 10000 + titled * 100 + Math.min(text, 2000) };
    }).sort(function (a, b) { return b.score - a.score; });
}

function splitCellBlocks(cell, doc, includeAll) {
    let containers;
    if (includeAll) {
        containers = Array.prototype.slice.call(cell.querySelectorAll('div[class*="kbcontent"]'));
    } else {
        const ranked = rankedContainers(cell);
        containers = ranked.length
            ? ranked.filter(function (r) { return r.score === ranked[0].score; }).map(function (r) { return r.div; })
            : [];
    }
    if (!containers.length) containers = [cell];

    const blocks = [];
    containers.forEach(function (container) {
        // 悬浮提示里的重复内容不算
        const clone = container.cloneNode(true);
        Array.prototype.slice.call(clone.querySelectorAll('.item-box')).forEach(function (node) {
            if (node.parentNode) node.parentNode.removeChild(node);
        });

        const html = clone.innerHTML || '';
        if (SEPARATOR.test(html)) {
            html.split(SEPARATOR).forEach(function (part) {
                const holder = doc.createElement('div');
                holder.innerHTML = part;
                blocks.push(holder);
            });
        } else {
            blocks.push(clone);
        }
    });
    return blocks;
}

function fontText(block, matcher) {
    const fonts = Array.prototype.slice.call(block.querySelectorAll('font'));
    for (let i = 0; i < fonts.length; i++) {
        const title = clean(fonts[i].getAttribute('title'));
        if (title && matcher.test(title)) return clean(fonts[i].textContent);
    }
    return '';
}

function parseCourseBlock(block, day, rowSections) {
    let name = fontText(block, /课程名称|课程/);
    let teacher = fontText(block, /教师/);
    let timeText = fontText(block, /周次|节次|时间/);
    let position = fontText(block, /教室|地点/);
    let building = fontText(block, /教学楼|楼栋|校区/);

    // 强智新版：课程名是没有 title 的 font
    if (!name) {
        const untitled = Array.prototype.slice.call(block.querySelectorAll('font')).filter(function (f) {
            return !clean(f.getAttribute('title'));
        });
        if (untitled.length) name = clean(untitled[0].textContent);
    }

    const lines = textLines(block, block.ownerDocument);
    if (!name && lines.length) name = lines[0];

    let weeks = [];
    let startSection = null;
    let endSection = null;

    if (timeText) {
        const parsed = parseWeekSectionText(timeText);
        weeks = parsed.weeks;
        startSection = parsed.startSection;
        endSection = parsed.endSection;
    }

    // 没有结构化的“周次(节次)”字段时，从文本行里兜底提取
    if (!weeks.length) {
        for (let i = 0; i < lines.length; i++) {
            if (/周/.test(lines[i]) && /\d/.test(lines[i])) {
                const w = parseWeeks(lines[i]);
                if (w.length) { weeks = w; break; }
            }
        }
    }
    if (startSection === null) {
        for (let i = 0; i < lines.length; i++) {
            if (/节/.test(lines[i])) {
                const sec = parseSections(lines[i]);
                if (sec) { startSection = sec.start; endSection = sec.end; break; }
            }
        }
    }
    if (startSection === null && rowSections) {
        startSection = rowSections.start;
        endSection = rowSections.end;
    }

    if (!position) {
        for (let i = 0; i < lines.length; i++) {
            if (/教室|楼|室|馆|场/.test(lines[i]) && !/周/.test(lines[i])) { position = lines[i]; break; }
        }
    }
    if (!teacher) {
        for (let i = 0; i < lines.length; i++) {
            if (/^[\u4e00-\u9fa5]{2,4}$/.test(lines[i]) && lines[i] !== name) { teacher = lines[i]; break; }
        }
    }

    name = clean(name).replace(/[（(][^）)]*学分[）)]/g, '').trim();
    if (!name || !weeks.length || !startSection) return null;

    return {
        name: name,
        teacher: clean(teacher) || '未知',
        position: clean(position) || '待定',
        building: clean(building),
        day: day,
        startSection: startSection,
        endSection: endSection || startSection,
        weeks: weeks
    };
}

// 纯文本单元格：形如「军训（含入学教育）  3-4周;」，colspan 跨整行且没有 font 结构
function parsePlainCourseText(text) {
    const t = clean(text).replace(/[;；]+$/, '');
    const m = t.match(/^(.{2,30}?)\s*([\d,，、\-–—~至]+)\s*周/);
    if (!m) return null;
    const weeks = parseWeeks(m[2]);
    if (!weeks.length) return null;
    const name = clean(m[1]).replace(/[（(][^）)]*学分[）)]/g, '');
    if (!name) return null;
    return { name: name, weeks: weeks };
}

// 优先用表头识别星期列；表头没有文字时，7 列按“列序=星期”，8 列按“首列为节次”
function parseTimetable(doc) {
    const table = doc.getElementById('timetable') || doc.querySelector('table#timetable');
    if (!table) return { courses: [], hasTable: false, skipped: 0 };

    const grid = buildGrid(table);
    const dayCols = detectDayColumns(grid);
    const hasHeader = Object.keys(dayCols).length >= 5;
    const width = gridWidth(grid);

    const dayOf = function (c) {
        if (hasHeader) return dayCols[c] || 0;
        if (width === 7) return c + 1;          // 无节次列
        if (width === 8) return c;              // 首列为节次，c=1..7
        if (width === 9) return c - 1 <= 7 && c - 1 >= 1 ? c - 1 : 0;
        return 0;
    };

    const courses = [];
    let skipped = 0;

    grid.forEach(function (row, r) {
        if (!row) return;

        // 「备注」行常写「军训（含入学教育）3-4周」这类集中实践说明，不能当作 7 条课铺满一周
        const head = row[0] && row[0].cell;
        if (head && /^备注/.test(clean(head.textContent))) return;

        let rowSections = null;
        row.forEach(function (slot, c) {
            if (rowSections || !slot || !slot.origin) return;
            if (dayOf(c)) return;
            const sec = parseSections(clean(slot.cell.textContent));
            if (sec) rowSections = sec;
        });

        row.forEach(function (slot, c) {
            if (!slot || !slot.origin) return;
            const day = dayOf(c);
            if (!day || day < 1 || day > 7) return;

            const cell = slot.cell;
            const cellText = clean(cell.textContent);
            if (!cellText) return;
            // 表头行（单元格只写“星期一”）跳过
            if (cellText.length <= 8 && dayFromText(cellText) && !/周次|节/.test(cellText)) return;

            // 纯文本单元格（集中实践周：军训/实训，常以 colspan 跨整行）
            if (!cell.querySelector('div[class*="kbcontent"]') && !cell.querySelector('font')) {
                const plain = parsePlainCourseText(cellText);
                if (plain) {
                    const days = [];
                    row.forEach(function (s, cc) {
                        if (!s || s.cell !== cell) return;
                        const d2 = dayOf(cc);
                        if (d2 >= 1 && d2 <= 7 && days.indexOf(d2) < 0) days.push(d2);
                    });
                    (days.length ? days : [day]).forEach(function (d2) {
                        courses.push({
                            name: plain.name,
                            teacher: '未知',
                            position: '待定',
                            building: '',
                            day: d2,
                            startSection: rowSections ? rowSections.start : 1,
                            endSection: rowSections ? rowSections.end : (rowSections ? rowSections.start : 1),
                            weeks: plain.weeks
                        });
                    });
                    return;
                }
            }

            // 先用最完整的表示，解析不出再回退到全部表示
            const take = function (blocks) {
                const got = [];
                blocks.forEach(function (block) {
                    const course = parseCourseBlock(block, day, rowSections);
                    if (course) got.push(course);
                });
                return got;
            };
            let got = take(splitCellBlocks(cell, doc));
            if (!got.length) got = take(splitCellBlocks(cell, doc, true));

            if (got.length) {
                got.forEach(function (c) { courses.push(c); });
            } else {
                skipped++;
            }
        });
    });

    return { courses: courses, hasTable: true, skipped: skipped };
}

function mergeCourses(list) {
    if (!list || list.length <= 1) return list || [];
    // 第一步：合并同课同师同地同天同周次的连续节次
    const sorted = list.slice().sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name)) ||
            String(a.teacher).localeCompare(String(b.teacher)) ||
            String(a.position).localeCompare(String(b.position)) ||
            a.day - b.day ||
            a.startSection - b.startSection ||
            a.weeks.join(',').localeCompare(b.weeks.join(','));
    });

    const step1 = [];
    let cur = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];
        const sameBody = cur.name === next.name && cur.teacher === next.teacher &&
            cur.position === next.position && cur.day === next.day &&
            cur.weeks.join(',') === next.weeks.join(',');
        if (sameBody && (cur.endSection + 1 === next.startSection || cur.startSection === next.startSection)) {
            cur.endSection = Math.max(cur.endSection, next.endSection);
        } else {
            step1.push(cur);
            cur = next;
        }
    }
    step1.push(cur);

    // 第二步：合并同课同节次的周次
    const map = new Map();
    step1.forEach(function (course) {
        const key = [course.name, course.teacher, course.position, course.day, course.startSection, course.endSection].join('|');
        if (!map.has(key)) {
            map.set(key, Object.assign({}, course, { weeks: course.weeks.slice() }));
        } else {
            const exist = map.get(key);
            exist.weeks = Array.from(new Set(exist.weeks.concat(course.weeks))).sort(function (a, b) { return a - b; });
        }
    });
    return Array.from(map.values());
}

function normalizeVenue(building) {
    return clean(building)
        .replace(/[【】\[\]]/g, '')
        .replace(/（(?:天河|花都|国际|清远)）$/, '')
        .replace(/^0+(\d+号楼)$/, '$1')
        .replace(/^操场$/, '运动场');
}

function isBuildingMatch(venue, name) {
    return venue === name || venue.indexOf(name) === 0;
}

function campusesOf(building) {
    const venue = normalizeVenue(building);
    if (!venue) return [];
    return CAMPUSES.filter(function (campus) {
        return campus.early.some(function (n) { return isBuildingMatch(venue, n); }) ||
            campus.late.some(function (n) { return isBuildingMatch(venue, n); });
    });
}

// 返回 'early' | 'late'，判定不出来返回 null
function scheduleOf(campus, building) {
    const venue = normalizeVenue(building);
    if (!venue) return null;
    if (campus.early.some(function (n) { return isBuildingMatch(venue, n); })) return 'early';
    if (campus.late.some(function (n) { return isBuildingMatch(venue, n); })) return 'late';
    return null;
}

function dominantCampus(courses) {
    const count = new Map();
    courses.forEach(function (course) {
        campusesOf(course.building).forEach(function (campus) {
            count.set(campus, (count.get(campus) || 0) + 1);
        });
    });
    let picked = null;
    count.forEach(function (times, campus) {
        if (!picked || times > count.get(picked)) picked = campus;
    });
    return picked;
}

// 7-8、9-10、11-12 节学校视为整段连堂，取整段的边界时间
function sectionTime(slots, section, isStart) {
    const index = Math.min(Math.max(section, 1), slots.length) - 1;
    if (isStart) {
        if (section === 8) return '15:55';
        if (section === 10) return '18:05';
        if (section === 12) return '19:40';
        return slots[index].startTime;
    }
    if (section === 7) return '17:15';
    if (section === 9) return '19:25';
    if (section === 11) return '21:00';
    return slots[index].endTime;
}

function withCustomTime(course, slots) {
    return Object.assign({}, course, {
        isCustomTime: true,
        customStartTime: sectionTime(slots, course.startSection, true),
        customEndTime: sectionTime(slots, course.endSection, false)
    });
}

// 校区判定不出来时全部用基础作息、不设自定义时间：宁可时间不完美，也要先能导入
function applySchedule(courses) {
    const result = { courses: [], timeSlots: BASE_SLOTS, campusName: '', customCount: 0, note: '' };
    const campus = dominantCampus(courses);

    if (!campus) {
        result.courses = courses.map(function (c) { return Object.assign({}, c); });
        const venues = Array.from(new Set(courses.map(function (c) { return normalizeVenue(c.building); }).filter(Boolean)));
        result.note = '未能判定上课校区' + (venues.length ? '（教学楼：' + venues.slice(0, 3).join('、') + '）' : '') + '，已按默认作息导入';
        return result;
    }
    result.campusName = campus.name;

    // uniform：不按楼栋区分，不产生自定义时间
    if (SCHEDULE_MODE === 'uniform') {
        result.courses = courses.map(function (c) { return Object.assign({}, c); });
        return result;
    }

    const groups = courses.map(function (c) { return scheduleOf(campus, c.building); });
    const lateCount = groups.filter(function (g) { return g === 'late'; }).length;
    const earlyCount = groups.filter(function (g) { return g === 'early'; }).length;
    const unknown = groups.length - lateCount - earlyCount;

    const majority = lateCount > earlyCount ? 'late' : 'early';
    result.timeSlots = majority === 'late' ? LATE_SLOTS : BASE_SLOTS;
    const minoritySlots = majority === 'late' ? BASE_SLOTS : LATE_SLOTS;

    result.courses = courses.map(function (course, i) {
        const group = groups[i];
        const plain = Object.assign({}, course);
        if (group !== 'late' && group !== 'early') return plain;      // 楼栋未收录：用默认作息
        if (group === majority) return plain;
        result.customCount++;
        return withCustomTime(plain, minoritySlots);
    });

    if (unknown) result.note = unknown + ' 条课程的教学楼未收录作息表，已按默认作息处理';
    return result;
}

// 登录后可能停在别的同域页面，所以优先取当前页面的 origin
function resolveBase() {
    try {
        const href = String(window.location.href || '');
        if (/\/jsxsd\//.test(href)) return window.location.origin;
        if (/gdcp\.edu\.cn/.test(href)) return window.location.origin;
    } catch (e) { /* ignore */ }
    return GDCP_ORIGIN;
}

async function fetchDoc(url, body) {
    const options = { credentials: 'include' };
    if (body) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        options.body = body;
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    const Parser = (typeof DOMParser !== 'undefined') ? DOMParser
        : (typeof window !== 'undefined' && window.DOMParser) ? window.DOMParser : null;
    if (!Parser) throw new Error('当前环境不支持 DOMParser');
    return new Parser().parseFromString(html, 'text/html');
}

// 判断返回的是不是登录页（会话失效）
function isLoginPage(doc) {
    if (!doc) return false;
    if (!doc.getElementById('xnxq01id') && doc.getElementById('loginForm')) return true;
    const title = clean(doc.title || '');
    return /教学管理信息服务平台/.test(title) && !!doc.getElementById('loginForm');
}

async function pickSemester(doc) {
    const select = doc.getElementById('xnxq01id');
    if (!select) return { error: '未找到学期下拉框（xnxq01id）' };

    const options = Array.prototype.slice.call(select.options);
    if (!options.length) return { error: '学期下拉框为空' };

    if (options.length === 1) {
        return { value: options[0].value, text: clean(options[0].textContent) };
    }

    const picked = await window.shiguangBridgePromise.showSingleSelection(
        '选择学期',
        JSON.stringify(options.map(function (o) { return clean(o.textContent); })),
        select.selectedIndex >= 0 ? select.selectedIndex : -1
    );
    if (picked === null) return { cancelled: true };
    if (typeof picked !== 'number' || picked < 0 || picked >= options.length) return { error: '学期选择无效' };
    return { value: options[picked].value, text: clean(options[picked].textContent) };
}

async function fetchTimetableDoc(base, semesterValue, modeValue) {
    const params = new URLSearchParams();
    params.append('cj0701id', '');
    params.append('zc', '');
    params.append('demo', '');
    params.append('xnxq01id', semesterValue);
    params.append('sfFD', '1');
    if (modeValue) params.append('kbjcmsid', modeValue);
    return fetchDoc(base + TIMETABLE_PATH, params.toString());
}

async function fetchCalendarConfig(base, semesterValue) {
    const params = new URLSearchParams({ xnxq01id: semesterValue });
    const doc = await fetchDoc(base + CALENDAR_PATH, params.toString());

    const table = doc.querySelector('table');
    if (!table) return null;

    let startDate = null;
    let totalWeeks = 0;
    Array.prototype.slice.call(table.querySelectorAll('tr')).forEach(function (row) {
        const cells = Array.prototype.slice.call(row.children);
        if (!cells.length) return;
        const first = clean(cells[0].textContent);
        if (!/^\d+$/.test(first)) return;
        const week = parseInt(first, 10);
        if (week > totalWeeks) totalWeeks = week;
        if (week === 1 && !startDate && cells.length > 1) {
            const raw = clean(cells[1].getAttribute('title')) || clean(cells[1].textContent);
            const m = raw.match(/(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})/);
            if (m) startDate = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
        }
    });

    if (!startDate || !totalWeeks) return null;
    return {
        semesterStartDate: startDate,
        semesterTotalWeeks: totalWeeks,
        firstDayOfWeek: 1,
        defaultClassDuration: 40,
        defaultBreakDuration: 5
    };
}

// 只保留协议字段，不把 building 等内部字段提交给应用
function toPayload(course) {
    const out = {
        name: course.name,
        teacher: course.teacher,
        position: course.position,
        day: course.day,
        startSection: course.startSection,
        endSection: course.endSection,
        weeks: course.weeks
    };
    if (course.isCustomTime) {
        out.isCustomTime = true;
        out.customStartTime = course.customStartTime;
        out.customEndTime = course.customEndTime;
    }
    return out;
}

async function saveCourses(courses) {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses.map(toPayload)));
}

async function saveSlots(slots) {
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(slots));
}

async function saveConfig(config) {
    if (!config) return;
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}

async function runImportFlow() {
    const warnings = [];

    try {
        const base = resolveBase();

        toast('正在连接教务系统...');
        let pageDoc = null;
        let netError = '';

        try {
            pageDoc = await fetchDoc(base + TIMETABLE_PATH);
        } catch (e) {
            netError = e && e.message ? e.message : String(e);
        }

        // 接口不可用或返回登录页时，退回当前已显示的页面
        if (!pageDoc || isLoginPage(pageDoc) || !pageDoc.getElementById('xnxq01id')) {
            if (typeof document !== 'undefined' && document.getElementById('xnxq01id')) {
                pageDoc = document;
            }
        }

        if (!pageDoc || isLoginPage(pageDoc)) {
            await alertUser('请先登录教务系统',
                '没有检测到有效的登录会话。\n\n请先在软件内登录教务系统（' + GDCP_ORIGIN + '），' +
                '登录成功后回到导入页再点一次执行导入。' + (netError ? '\n\n接口提示：' + netError : ''), '知道了');
            return;
        }

        const semester = await pickSemester(pageDoc);
        if (semester.cancelled) { toast('已取消导入'); return; }
        if (semester.error) throw new Error(semester.error);

        const modeSelect = pageDoc.getElementById('kbjcmsid');
        const modeValue = modeSelect ? modeSelect.value : '';

        toast('正在获取「' + semester.text + '」课表...');
        let tableDoc = null;
        try {
            tableDoc = await fetchTimetableDoc(base, semester.value, modeValue);
        } catch (e) {
            warnings.push('课表接口请求失败：' + (e && e.message ? e.message : e));
        }

        // 返回的学期与所选不一致时，说明会话或参数有问题，改用当前页
        if (tableDoc) {
            const returned = tableDoc.getElementById('xnxq01id');
            if (returned && returned.value && returned.value !== semester.value) {
                warnings.push('接口返回的学期与所选不一致，已改用当前页面');
                tableDoc = null;
            }
        }

        let parsed = { courses: [], hasTable: false, skipped: 0 };
        if (tableDoc) parsed = parseTimetable(tableDoc);
        if (!parsed.courses.length && typeof document !== 'undefined' && document.getElementById('timetable')) {
            parsed = parseTimetable(document);
        }

        if (!parsed.courses.length) {
            const empty = parsed.hasTable && !parsed.skipped;
            await alertUser(empty ? '该学期暂无课程' : '未解析到课程',
                empty
                    ? '「' + semester.text + '」的课表里没有任何课程（可能还没排课，或该学期已归档）。\n\n' +
                      '可以重新执行导入，换一个学期试试。'
                    : '没有从「' + semester.text + '」解析出可识别的课程。\n\n' +
                      '请先在教务系统的课表页点一次“查询”，确认页面能显示课程后再回到这里执行导入。',
                '知道了');
            return;
        }

        // 校区作息与教学周历取不到都不影响导入，只计入提示
        const scheduled = applySchedule(parsed.courses);
        const courses = mergeCourses(scheduled.courses);
        if (scheduled.note) warnings.push(scheduled.note);

        let config = null;
        try {
            config = await fetchCalendarConfig(base, semester.value);
            if (!config) warnings.push('未取到教学周历，开学日期与总周数沿用软件当前设置');
        } catch (e) {
            warnings.push('教学周历请求失败：' + (e && e.message ? e.message : e));
        }

        if (config) await saveConfig(config);
        await saveSlots(scheduled.timeSlots);
        await saveCourses(courses);

        const summary = courses.length + ' 条课程' +
            (scheduled.campusName ? ' · ' + scheduled.campusName : '') +
            (scheduled.customCount ? ' · ' + scheduled.customCount + ' 条按自定义时间' : '') +
            (config ? ' · 共 ' + config.semesterTotalWeeks + ' 周' : '');
        toast('导入成功：' + summary);
        if (warnings.length) toast('提示：' + warnings.join('；'));

        if (window.shiguangBridge && window.shiguangBridge.notifyTaskCompletion) {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        toast('导入失败：' + message);
        await alertUser('导入失败',
            message + (warnings.length ? '\n\n其他提示：\n· ' + warnings.join('\n· ') : ''), '知道了');
    }
}

runImportFlow();
