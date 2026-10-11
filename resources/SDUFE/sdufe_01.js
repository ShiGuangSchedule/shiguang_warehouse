/**
 * 山东财经大学 教务适配脚本(强智教务系统)
 * 数据来源:/jsxsd/xskb/xskb_list.do(学期理论课表)
 */

// 山东财经大学作息时间。学校按“大节”排课,课表每一行(第一、二节 / 第三、四节 /
// 第五、六节 / 第七、八节 / 第九~十一节)对应下面的一个节次。
const TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "10:00" },
    { number: 2, startTime: "10:20", endTime: "11:50" },
    { number: 3, startTime: "14:00", endTime: "15:30" },
    { number: 4, startTime: "15:50", endTime: "17:20" },
    { number: 5, startTime: "18:40", endTime: "20:10" },
];

const TIMETABLE_URL = "/jsxsd/xskb/xskb_list.do";
const WEEK_INFO_URL = "/jsxsd/framework/main_index_loadkb.jsp";

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };
const TEACHER_TITLE_RE = /(副教授|教授|讲师（高校）|讲师|助教|副研究员|研究员|高级实验师|实验师)$/;

// ---------- 工具函数 ----------

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** 中文数字(一~九十九)或阿拉伯数字 -> 数字 */
function cnToNum(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (s === "十") return 10;
    if (s.startsWith("十")) return 10 + map[s[1]];
    if (s.endsWith("十")) return map[s[0]] * 10;
    if (s.includes("十")) return map[s[0]] * 10 + map[s[2]];
    return map[s];
}

/** “第一、二节” / “第九~十一节” -> { start, end } */
function parseSections(text) {
    const m = text.match(/第(.+?)节/);
    if (!m) return null;
    const nums = m[1]
        .split(/[、~\-—,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(cnToNum);
    if (!nums.length || nums.some((n) => !Number.isInteger(n))) return null;
    return { start: nums[0], end: nums[nums.length - 1] };
}

/** “1-3,5-7,18(周)” / “1-18(单周)” / “1-18(双周)” -> [1,2,3,...] */
function parseWeeks(text) {
    const m = text.match(/([\d,，\-~\s]+)[(（]\s*(单周|双周|周)\s*[)）]/);
    if (!m) return [];
    const mode = m[2];
    const set = new Set();
    m[1].split(/[,，]/).forEach((part) => {
        const p = part.trim();
        if (!p) return;
        const r = p.split(/[-~]/).map(Number);
        const a = r[0];
        const b = r.length > 1 ? r[1] : r[0];
        if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return;
        for (let w = a; w <= b; w++) {
            if (mode === "单周" && w % 2 === 0) continue;
            if (mode === "双周" && w % 2 === 1) continue;
            set.add(w);
        }
    });
    return Array.from(set).sort((x, y) => x - y);
}

/** “韩慧健教授” / “刘博,赵天龙” -> 去掉职称,保留姓名 */
function cleanTeacher(raw) {
    return raw
        .split(/[,，]/)
        .map((s) => s.trim().replace(TEACHER_TITLE_RE, ""))
        .filter(Boolean)
        .join(",");
}

// ---------- 解析 ----------

/** 解析单元格中的一段课程(一个格子可能有多门课,用横线分隔) */
function parseSegment(doc, html) {
    const box = doc.createElement("div");
    box.innerHTML = html;
    let name = "";
    for (const node of box.childNodes) {
        if (node.nodeType === 3 && node.textContent.trim()) {
            name = node.textContent.trim();
            break;
        }
    }
    if (!name) return null; // 空格子(&nbsp;)
    const pick = (title) => {
        const el = box.querySelector('font[title="' + title + '"]');
        return el ? el.textContent.trim() : "";
    };
    return {
        name: name,
        teacher: cleanTeacher(pick("老师")),
        position: pick("教室"),
        weeksText: pick("周次(节次)"),
    };
}

/** 解析整张课表,返回课程数组;无法解析周次的课程记入 skipped */
function parseCourses(doc) {
    const courses = [];
    const skipped = [];
    const table = doc.getElementById("kbtable");
    if (!table) return { courses: courses, skipped: skipped };

    let slot = 0; // 每一行“大节”对应 TIME_SLOTS 里的一个节次
    table.querySelectorAll("tr").forEach((tr) => {
        const th = tr.querySelector("th");
        const cells = tr.querySelectorAll("td");
        if (!th || cells.length !== 7) return; // 表头行、备注行
        if (!parseSections(th.textContent)) return; // 行首不是“第X节”
        slot++;

        cells.forEach((td, i) => {
            // 带教师信息的详细版本是 class="kbcontent"(kbcontent1 是简略版)
            const box = td.querySelector("div.kbcontent");
            if (!box) return;
            box.innerHTML.split(/-{5,}/).forEach((seg) => {
                const info = parseSegment(doc, seg);
                if (!info) return;
                const weeks = parseWeeks(info.weeksText);
                if (!weeks.length) {
                    skipped.push(info.name);
                    return;
                }
                courses.push({
                    name: info.name,
                    teacher: info.teacher,
                    position: info.position,
                    day: i + 1,
                    startSection: slot,
                    endSection: slot,
                    weeks: weeks,
                });
            });
        });
    });
    return { courses: courses, skipped: skipped };
}

/** 读取页面里的学年学期下拉框 */
function parseSemesters(doc) {
    const sel = doc.getElementById("xnxq01id");
    if (!sel) return [];
    return Array.from(sel.options).map((o) => ({
        value: o.value,
        label: o.textContent.trim(),
        selected: o.selected || o.hasAttribute("selected"),
    }));
}

// ---------- 网络请求 ----------

/** semester 为空则取教务系统默认(当前)学期 */
async function fetchTimetable(semester) {
    const options = { credentials: "include" };
    if (semester) {
        options.method = "POST";
        options.headers = FORM_HEADERS;
        options.body = "zc=&xnxq01id=" + encodeURIComponent(semester);
    }
    const res = await fetch(TIMETABLE_URL, options);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return new DOMParser().parseFromString(await res.text(), "text/html");
}

/** 尽力获取开学日期和总周数(失败返回 null,不影响课程导入) */
async function fetchSemesterConfig() {
    try {
        const today = new Date();
        const res = await fetch(WEEK_INFO_URL, {
            method: "POST",
            headers: FORM_HEADERS,
            body: "rq=" + formatDate(today),
            credentials: "include",
        });
        const text = await res.text();
        const m = text.match(/第(\d+)周<\/span>\/(\d+)周/);
        if (!m) return null;
        const week = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        const monday = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() - ((today.getDay() + 6) % 7) - (week - 1) * 7
        );
        return { semesterStartDate: formatDate(monday), semesterTotalWeeks: total };
    } catch (e) {
        return null;
    }
}

// ---------- 保存 ----------

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        window.shiguangBridge.showToast("成功导入 " + courses.length + " 条课程!");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存课程失败: " + error.message);
        return false;
    }
}

async function saveConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("保存课表配置失败: " + error.message);
        return false;
    }
}

async function importPresetTimeSlots() {
    if (!TIME_SLOTS.length) {
        window.shiguangBridge.showToast("未配置作息时间,已跳过。");
        return false;
    }
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TIME_SLOTS));
        window.shiguangBridge.showToast("作息时间导入成功!");
        return true;
    } catch (error) {
        window.shiguangBridge.showToast("导入作息时间失败: " + error.message);
        return false;
    }
}

// ---------- 主流程 ----------

async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("课程导入流程即将开始...");

        // 1. 公告和前置检查
        const confirmed = await window.shiguangBridgePromise.showAlert(
            "导入前提示",
            "请先登录山东财经大学教务系统。\n导入只会读取“学期理论课表”,不会修改教务系统中的任何数据。",
            "开始导入"
        );
        if (!confirmed) return;

        // 2. 读取默认(当前)学期课表,同时拿到学期列表
        let doc = await fetchTimetable(null);
        if (!doc.getElementById("kbtable")) {
            await window.shiguangBridgePromise.showAlert(
                "无法读取课表",
                "未获取到课表页面,请确认已登录教务系统后重试。",
                "知道了"
            );
            return;
        }

        // 3. 选择学期
        const semesters = parseSemesters(doc);
        let isCurrentSemester = true;
        if (semesters.length) {
            const defIdx = Math.max(0, semesters.findIndex((s) => s.selected));
            const idx = await window.shiguangBridgePromise.showSingleSelection(
                "选择学期",
                JSON.stringify(semesters.map((s) => s.label)),
                defIdx
            );
            if (idx === null) {
                window.shiguangBridge.showToast("导入已取消。");
                return;
            }
            if (idx !== defIdx) {
                doc = await fetchTimetable(semesters[idx].value);
                isCurrentSemester = false;
                if (!doc.getElementById("kbtable")) {
                    window.shiguangBridge.showToast("该学期没有课表数据。");
                    return;
                }
            }
        }

        // 4. 解析课程
        const result = parseCourses(doc);
        if (!result.courses.length) {
            await window.shiguangBridgePromise.showAlert(
                "没有可导入的课程",
                "所选学期的课表为空。",
                "知道了"
            );
            return;
        }
        if (result.skipped.length) {
            window.shiguangBridge.showToast("有 " + result.skipped.length + " 门课的周次无法识别,已跳过。");
        }

        // 5. 保存课程
        if (!(await saveCourses(result.courses))) return;

        // 6. 课表配置:单节 90 分钟、课间 20 分钟;开学日期与总周数只在导入当前学期时可靠
        const config = { defaultClassDuration: 90, defaultBreakDuration: 20 };
        if (isCurrentSemester) Object.assign(config, await fetchSemesterConfig());
        await saveConfig(config);

        // 7. [可选] 作息时间(失败不阻止流程完成)
        await importPresetTimeSlots();

        // 8. 全部完成
        window.shiguangBridge.showToast("所有任务已完成!");
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast("导入出错: " + error.message);
    }
}

runImportFlow();
