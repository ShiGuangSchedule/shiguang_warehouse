// 湖北民族大学教务系统（jwgl.hbmzu.edu.cn/edu）拾光课表导入适配脚本
// 理论课表：课表查询页（/edu/report/mySchedule.mvc）直接渲染 DOM：
//   #container 内每行 tr：首 td 为节次（"上午1-2节"…"晚上11-12节"），后续 7 个 td 对应周一~周日
//   每格 .course-block 含 span：课程名、教室、周次、教师（无教室时仅 3 个）
// 实验课表：/edu/report/myLabSchedule.mvc 页面内声明学号/学年/学期，按周请求：
//   /edu/report/stuLabCourseTable/{学号}/{学年}/{学期}/{周}.mvc
// 导入时把理论与实验课表合并；无开学日期接口，不写课表配置

// 预设作息时间（12 节，含午间/晚间）
const HBMZU_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "10:05", endTime: "10:50" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "16:05", endTime: "16:50" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:20", endTime: "20:05" },
    { number: 11, startTime: "20:15", endTime: "21:00" },
    { number: 12, startTime: "21:05", endTime: "21:50" }
];

function getErrorMessage(error) {
    if (error && typeof error.message === "string" && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") return serialized;
    } catch (_) {
        // Ignore serialization failures.
    }
    return "未知错误";
}

// 收集可访问的 document（frameset 用 <frame>，普通页面用 <iframe>）
function collectDocs() {
    const docs = [document];
    const frames = document.querySelectorAll("iframe, frame");
    for (const f of frames) {
        try {
            if (f.contentDocument) docs.push(f.contentDocument);
        } catch (_) {
            // 跨域 frame 无法访问，忽略。
        }
    }
    return docs;
}

// 从各 frame 中查找理论课表表格（#container 内含 .course-block）
// 注入时机早于 frame 加载完成，故轮询等待 frame 就绪（最长 6 秒）
async function findCourseTable() {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
        for (const doc of collectDocs()) {
            const container = doc.getElementById("container");
            if (container && container.querySelector(".course-block")) {
                return container;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return null;
}

// 解析周次文本："3-14周"→3..14；"3-13单周"→3,5,7,9,11,13；"4-14双周"→4,6..14；"14-15周"→14,15
function parseWeeksText(weekStr) {
    const text = String(weekStr || "").replace(/\s+/g, "");
    const m = text.match(/^(\d+)-(\d+)(单|双)?周$/);
    if (!m) return [];
    const start = Number(m[1]);
    const end = Number(m[2]);
    const parity = m[3]; // "单" / "双" / undefined
    const weeks = [];
    for (let w = start; w <= end; w++) {
        if (parity === "单" && w % 2 === 0) continue;
        if (parity === "双" && w % 2 === 1) continue;
        weeks.push(w);
    }
    return weeks;
}

// 是否为周次文本（"3-14周" / "3-13单周" / "4-14双周" / "12-12周"）
// 用于在 3 个 span 时区分"无教室（名-周次-教师）"和"无教师（名-教室-周次）"两种结构
function isWeeksText(text) {
    return /^\d+-\d+(单|双)?周$/.test(String(text || "").replace(/\s+/g, ""));
}

// 解析理论课表表格
// 每行首 td 为节次文本（"上午1-2节"→1-2），其后 7 个 td 依次为周一~周日
function parseCourseTable(container) {
    const courses = [];
    container.querySelectorAll("tr").forEach(row => {
        const tds = row.querySelectorAll("td");
        if (tds.length < 2) return;
        const sectionText = (tds[0].textContent || "").replace(/\s+/g, "");
        const sectionMatch = sectionText.match(/(\d+)-(\d+)节/);
        if (!sectionMatch) return;
        const startSection = Number(sectionMatch[1]);
        const endSection = Number(sectionMatch[2]);

        for (let i = 0; i < 7; i++) {
            const dayTd = tds[i + 1];
            if (!dayTd) continue;
            const blocks = dayTd.querySelectorAll(".course-block");
            for (const block of blocks) {
                const cells = [];
                block.querySelectorAll("span").forEach(function (s) {
                    cells.push((s.textContent || "").trim());
                });
                if (cells.length < 3) continue;
                const name = cells[0];
                if (!name) continue;
                // span 结构：[名称, 教室?, 周次, 教师]，教室或教师可能缺失：
                //   3 个 span 可能是 [名称, 周次, 教师]（无教室），也可能是 [名称, 教室, 周次]（无教师）
                // 先找出长得像周次的 span：它前面的第一个 span 是教室，后面的第一个 span 是教师
                let weekIndex = -1;
                let weekStr = "";
                for (let j = 1; j < cells.length; j++) {
                    if (isWeeksText(cells[j])) {
                        weekIndex = j;
                        weekStr = cells[j];
                        break;
                    }
                }
                if (weekIndex < 0) continue;
                const position = weekIndex >= 2 ? cells[weekIndex - 1] : "";
                const teacher = weekIndex + 1 < cells.length ? cells[weekIndex + 1] : "";
                const weeks = parseWeeksText(weekStr);
                if (weeks.length === 0) continue;
                courses.push({
                    name,
                    teacher: teacher || "",
                    position: position || "",
                    day: i + 1,
                    startSection,
                    endSection,
                    weeks
                });
            }
        }
    });
    return courses;
}

// 应用上下文路径（通常为 /edu），兼容不同的部署目录
function getContextPath() {
    const m = window.location.pathname.match(/^(.*?)\/(?:report|mainpage)\//);
    return m ? m[1] : "/edu";
}

// 学年兜底：9 月及以后算当年，1~8 月算上一年
function fallbackAcademicYear() {
    const now = new Date();
    return String(now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1);
}

// 从实验课表页读取学号、学年、学期（页面内声明：const id=…; const openYear=…; const openTerm=…;）
async function fetchLabBase() {
    const ctx = getContextPath();
    const resp = await fetch(ctx + "/report/myLabSchedule.mvc", { credentials: "include" });
    if (!resp.ok) return null;
    const html = await resp.text();
    const idMatch = html.match(/(?:const|let|var)\s+id\s*=\s*["']?(\d+)["']?\s*;/);
    const yearMatch = html.match(/(?:const|let|var)\s+openYear\s*=\s*["']?(\d{4})["']?\s*;/);
    const termMatch = html.match(/(?:const|let|var)\s+openTerm\s*=\s*["']?(\d+)["']?\s*;/);
    if (!idMatch || !termMatch) return null;
    return {
        ctx,
        sid: idMatch[1],
        year: yearMatch ? yearMatch[1] : fallbackAcademicYear(),
        term: termMatch[1]
    };
}

// 解析单周实验课表：sheduleTable 为「大节 × 星期」二维数组，单元格内 lessons 为课程
function parseLabTable(data, fallbackWeek) {
    const courses = [];
    if (!data || data.code !== 0 || !Array.isArray(data.sheduleTable)) return courses;
    for (const row of data.sheduleTable) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
            if (!cell || !Array.isArray(cell.lessons)) continue;
            for (const lesson of cell.lessons) {
                if (!lesson || !lesson.courseName) continue;
                const day = Number(lesson.weekday);
                const startSection = Number(lesson.startSection);
                const period = Number(lesson.period) > 0 ? Number(lesson.period) : 1;
                if (!(day >= 1 && day <= 7) || !(startSection >= 1)) continue;
                const week = Number(lesson.week);
                courses.push({
                    name: String(lesson.courseName).trim(),
                    teacher: String(lesson.teacherName || "").trim(),
                    position: String(lesson.roomName || "").trim(),
                    day,
                    startSection,
                    endSection: startSection + period - 1,
                    weeks: [Number.isFinite(week) && week > 0 ? week : fallbackWeek]
                });
            }
        }
    }
    return courses;
}

async function fetchLabWeek(base, week) {
    const url = base.ctx + "/report/stuLabCourseTable/" + base.sid + "/" + base.year + "/" + base.term + "/" + week + ".mvc";
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return resp.json();
}

// 拉取整学期实验课表：先取第 1 周拿到总周数，再按周补齐
async function fetchLabCourses() {
    let base;
    try {
        base = await fetchLabBase();
    } catch (error) {
        console.error("JS: 读取实验课表入口失败", error);
        return { courses: [], warning: "实验课表入口读取失败" };
    }
    if (!base) return { courses: [], warning: "未找到实验课表入口" };

    let first;
    try {
        first = await fetchLabWeek(base, 1);
    } catch (error) {
        console.error("JS: 第 1 周实验课表请求失败", error);
        return { courses: [], warning: "第 1 周实验课表请求失败" };
    }

    const totalWeeks = Math.max(1, Number(first.totalWeeks) || 20);
    const courses = parseLabTable(first, 1);
    const pending = [];
    for (let w = 2; w <= totalWeeks; w++) pending.push(w);

    // 分批并发，避免一次性打满
    const batchSize = 5;
    for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(function (w) {
            return fetchLabWeek(base, w).then(function (data) {
                return { week: w, data };
            }).catch(function () {
                return null;
            });
        }));
        for (const r of results) {
            if (!r) continue;
            courses.push(...parseLabTable(r.data, r.week));
        }
    }
    return { courses, warning: "" };
}

// 合并同课程同时间同教室的条目（跨周合并 weeks；单双周分教室的保持两条）
function mergeCourses(courses) {
    const merged = new Map();
    for (const c of courses) {
        const key = `${c.name}|${c.teacher}|${c.position}|${c.day}|${c.startSection}|${c.endSection}`;
        const holder = merged.get(key);
        if (holder) {
            holder.weeks = Array.from(new Set([...holder.weeks, ...c.weeks])).sort((a, b) => a - b);
        } else {
            merged.set(key, { ...c, weeks: [...c.weeks].sort((a, b) => a - b) });
        }
    }
    return Array.from(merged.values()).sort(
        (a, b) => a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name)
    );
}

// 保存作息时间
async function saveTimeSlots(timeSlots) {
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    } catch (error) {
        console.error("JS: 作息时间保存失败", error);
    }
}

async function runImportFlow() {
    const alertConfirmed = await window.shiguangBridgePromise.showAlert(
        "课表导入",
        "导入前请确保已登录并打开课表查询页面，将同时导入理论课表与实验课表。",
        "好的，开始导入"
    );
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    window.shiguangBridge.showToast("正在获取理论课表...");
    try {
        let theoryCourses = [];
        const container = await findCourseTable();
        if (container) {
            theoryCourses = parseCourseTable(container);
        }

        window.shiguangBridge.showToast("正在获取实验课表...");
        const labResult = await fetchLabCourses();

        const merged = mergeCourses([...theoryCourses, ...labResult.courses]);
        if (merged.length === 0) throw new Error("未解析到有效课程，请确认已登录并打开课表查询页面。");

        window.shiguangBridge.showToast(`正在保存 ${merged.length} 条课程...`);
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged, null, 2));
        await saveTimeSlots(HBMZU_TIME_SLOTS);

        window.shiguangBridge.showToast(
            `课程导入成功，共 ${merged.length} 条（理论 ${theoryCourses.length} 条 · 实验 ${labResult.courses.length} 条）！`
        );
        if (labResult.warning) {
            window.shiguangBridge.showToast("实验课表未导入：" + labResult.warning);
        }
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        window.shiguangBridge.showToast(`导入失败：${getErrorMessage(error)}`);
        console.error("JS: Import Error", error);
    }
}

runImportFlow();
