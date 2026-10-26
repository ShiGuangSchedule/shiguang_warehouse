// 文件: JLU_01.js (JLU 吉林大学教务适配)
// 经 iedu.jlu.edu.cn 直连"(新)教务管理系统"(金智旧版接口)抓取课表
// 流程：统一身份认证登录 -> 进入(新)教务"我的课表"页 -> 触发本脚本
// 兼容：经 Sangfor 网页 VPN 代理访问时基址可自动适配，无需改动脚本

// ========== 运行时提取教务站点基址 ==========
// 公网直连时基址为 https://iedu.jlu.edu.cn；若经 Sangfor webvpn 代理，则为
// https://vpn.jlu.edu.cn/https/<会话hex>（该 hex 是【会话相关】的，不能硬编码）。
// 两种情况都在课表页运行时从当前页 URL 提取基址，保证会话无关。
const PAGE_URL = window.location.href;
const _idx = PAGE_URL.indexOf("/jwapp/sys/");
if (_idx < 0) {
    window.shiguangBridge.showToast("请先进入(新)教务的「我的课表」页面再导入");
    throw new Error("未在课表页运行，无法定位教务站点基址");
}
const SITE_BASE = PAGE_URL.substring(0, _idx);            // https://iedu.jlu.edu.cn
const REFERER = PAGE_URL;                                 // 当前课表页 URL 作为 Referer

// 七个金智接口（均 POST，credentials:include 携带教务站点会话 cookie）
const EP_CURRENT_SEM   = "/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do";    // 当前学期（空 body）
const EP_SEMESTER_LIST = "/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do";   // 学期列表（*order=-DM 倒序，手动选择用）
const EP_SEM_CAL       = "/jwapp/sys/wdkb/modules/xskcb/cxxljc.do";     // 学期校历（XN+XQ -> 起始日/总周次）
const EP_SECTIONS      = "/jwapp/sys/wdkb/modules/jshkcb/jc.do";        // 节次时间（空 body）
const EP_COURSES       = "/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do"; // 课表（XNXQDM，不传 SKZC 取全部）
const EP_CHANGES       = "/jwapp/sys/wdkb/modules/xskcb/xsdkkc.do";     // 调课/停课（XNXQDM）
const EP_UNDETERMINED  = "/jwapp/sys/wdkb/modules/xskcb/xswpkc.do";    // 未定时间课程（XNXQDM，仅提醒不导入）

// ========== 请求工具 ==========
async function api(path, body) {
    const hasBody = body != null && body !== "";
    const headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": REFERER
    };
    if (hasBody) {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
    const res = await fetch(SITE_BASE + path, {
        method: "POST",
        headers: headers,
        body: hasBody ? body : "",
        credentials: "include"
    });
    return res.json();
}

// ========== 解析：周次二进制串 "0000111111111111" -> [5,6,...,16] ==========
// 长度可变（14/16...），按字符位遍历即可
function parseWeeksFromSkzc(skzc) {
    const weeks = [];
    const s = skzc || "";
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "1") weeks.push(i + 1);
    }
    return weeks;
}

// ========== 解析：教师字段 ==========
// 教务格式为 "姓名/工号"，多教师之间用 "," 分隔（工号不能当成第二位教师）
function cleanTeacher(raw) {
    return (raw || "").split(",").map(t => t.split("/")[0].trim()).filter(Boolean).join(",");
}

// ========== 解析：单条金智课程 -> 拾光模型 ==========
function parseSingleCourse(raw) {
    const name = raw.KCM;
    const teacher = cleanTeacher(raw.SKJS) || "未知教师";
    const position = raw.JASMC || "待定";          // JASMC 可能为 null
    const day = parseInt(raw.SKXQ, 10);            // 1=周一...7=周日
    const startSection = parseInt(raw.KSJC, 10);
    const endSection = parseInt(raw.JSJC, 10);
    const weeks = parseWeeksFromSkzc(raw.SKZC);
    if (!name || !day || !startSection || !endSection || weeks.length === 0) {
        return null;
    }
    return {
        name, teacher, position, day, startSection, endSection, weeks,
        _kbId: raw.KBID     // 内部字段，调课按 KBID 匹配用，保存前清除
    };
}

// ========== 解析：节次时间行 -> timeSlots（只取 SFSY==1 启用的节次）==========
function parseTimeSlots(rows) {
    return (rows || [])
        .filter(r => Number(r.SFSY) === 1)
        .map(r => ({
            number: r.DM,
            startTime: r.KSSJ,
            endTime: r.JSSJ
        }))
        .sort((a, b) => a.number - b.number);
}

// ========== 解析：学期校历 -> {startDate, totalWeeks} ==========
function parseSemesterCalendar(rows) {
    const r = (rows || [])[0];
    if (!r) return null;
    const startDate = r.XQKSRQ ? String(r.XQKSRQ).split(" ")[0] : null; // "2026-03-09"
    const totalWeeks = Number(r.ZZC) || 20;                              // 18
    return { startDate, totalWeeks };
}

// ========== UI：开始提示 ==========
async function promptUserToStart() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "吉林大学课表导入",
        "请确保您已登录(新)教务管理系统，并已进入「我的课表」页面。\n未停留在课表页可能导致会话失效，无法获取数据。",
        "开始导入"
    );
    if (!confirmed) {
        window.shiguangBridge.showToast("已取消导入");
        return false;
    }
    return true;
}

// ========== 学期选择（默认当前学期，可选其他）==========
// 假期教务系统可能仍把"当前学期"指向上学期，故保留手动选择其他学期能力
async function selectSemester() {
    // 1. 尝试获取当前学期作为默认选项
    let current = null;
    try {
        current = await fetchCurrentSemester();
    } catch (e) {
        console.warn("当前学期获取失败，将直接显示学期列表:", e);
    }

    if (current) {
        // 2. 问用户：导入当前学期 / 选择其他
        const choice = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify([
                `导入当前学期：${current.mc}`,
                "选择其他学期"
            ]),
            0
        );
        if (choice === null) {
            window.shiguangBridge.showToast("已取消导入");
            return null;
        }
        if (choice === 0) return current;
        // choice === 1 -> 继续到学期列表
    }

    // 3. 拉取学期列表手动选择
    let rows = [];
    try {
        rows = await fetchSemesterList();
    } catch (e) {
        window.shiguangBridge.showToast("学期列表获取失败，请检查登录状态");
        console.error("学期列表获取失败:", e);
        return null;
    }
    if (rows.length === 0) {
        window.shiguangBridge.showToast("未获取到学期列表");
        return null;
    }
    const labels = rows.map(r => r.MC || r.DM);
    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择其他学期",
        JSON.stringify(labels),
        0
    );
    if (idx === null) {
        window.shiguangBridge.showToast("已取消导入");
        return null;
    }
    return parseSemesterRow(rows[idx]);
}

// ========== 数据获取 ==========
// 解析学期行 -> {xnxqdm, xn, xq, mc}（当前学期与列表选择共用）
function parseSemesterRow(r) {
    const xnxqdm = r.DM;                       // "2025-2026-2"
    const parts = xnxqdm.split("-");           // ["2025","2026","2"]
    const xn = parts[0] + "-" + parts[1];      // "2025-2026"
    const xq = parts[2];                       // "2"
    return { xnxqdm, xn, xq, mc: r.MC };
}

async function fetchCurrentSemester() {
    const res = await api(EP_CURRENT_SEM, ""); // 空 body
    const r = res?.datas?.dqxnxq?.rows?.[0];
    if (!r) return null;
    return parseSemesterRow(r);
}

async function fetchSemesterList() {
    const res = await api(EP_SEMESTER_LIST, "*order=-DM"); // 倒序，最新在前
    return res?.datas?.xnxqcx?.rows || [];
}

async function fetchSemesterCalendar(xn, xq) {
    const res = await api(EP_SEM_CAL, `XN=${xn}&XQ=${xq}`);
    return parseSemesterCalendar(res?.datas?.cxxljc?.rows);
}

async function fetchTimeSlots() {
    const res = await api(EP_SECTIONS, ""); // 空 body
    return parseTimeSlots(res?.datas?.jc?.rows);
}

async function fetchCourses(xnxqdm) {
    const res = await api(EP_COURSES, `XNXQDM=${xnxqdm}`); // 不传 SKZC，取全部课程
    const rows = res?.datas?.cxxszhxqkb?.rows || [];
    return rows.map(parseSingleCourse).filter(c => c !== null);
}

// ========== 调课/停课（xsdkkc.do，字段已按真实抓包核对）==========
async function fetchCourseChanges(xnxqdm) {
    const res = await api(EP_CHANGES, `XNXQDM=${xnxqdm}&*order=-SQSJ`);
    return res?.datas?.xsdkkc?.rows || [];
}

async function fetchUndeterminedCourses(xnxqdm) {
    const res = await api(EP_UNDETERMINED, `XNXQDM=${xnxqdm}`);
    return res?.datas?.xswpkc?.rows || [];
}

/**
 * 将调课/停课变更应用到已解析课程列表（就地修改）
 * - 停课：按 KBID 匹配原始课，删除受影响周次（change.SKZC）
 * - 调课：新时间字段齐全时，按新时间/周次/师/地落位；同一 KBID 已存在该时段则并入周次
 * - weeks 清空的课程（全周停课）被过滤掉
 * @returns {{courses: Array, appliedCount: number}}
 */
function applyCourseChanges(parsedCourses, rawChanges) {
    let appliedCount = 0;
    for (const change of rawChanges) {
        const kbID = change.KBID;
        // 课表接口同一学期内 KBID 唯一（实测 11/11），按 KBID 即可精确定位
        const affected = parsedCourses.filter(c => c._kbId === kbID);
        if (affected.length === 0) {
            console.warn("调课未匹配到课程, KBID:", kbID);
            continue;
        }
        let changeApplied = false;

        // 1. 从原课剔除被调走的周次（课表给整学期周次，调课记录只给被调走的那几周）
        const weeksToRemove = parseWeeksFromSkzc(change.SKZC);
        affected.forEach(course => {
            const before = course.weeks.length;
            course.weeks = course.weeks.filter(w => !weeksToRemove.includes(w));
            if (course.weeks.length < before) changeApplied = true;
        });

        // 2. 落位到新时间/地点（新时间字段齐全即为调课，缺字段的即为停课）
        const newWeeks = parseWeeksFromSkzc(change.XSKZC);
        const newDay = parseInt(change.XSKXQ, 10);
        const newStart = parseInt(change.XKSJC, 10);
        const newEnd = parseInt(change.XJSJC, 10);
        if (newWeeks.length > 0 && newDay && newStart && newEnd) {
            const newPosition = change.XJASMC || change.JASMC || "待定";
            // 同一 KBID 的同一课位（含教室）已存在则并入周次，避免产生重复条目
            const existing = parsedCourses.find(c =>
                c._kbId === kbID &&
                c.day === newDay &&
                c.startSection === newStart &&
                c.endSection === newEnd &&
                c.position === newPosition
            );
            if (existing) {
                existing.weeks = [...new Set([...existing.weeks, ...newWeeks])].sort((a, b) => a - b);
            } else {
                parsedCourses.push({
                    name: change.KCM,
                    teacher: cleanTeacher(change.XSKJS) || cleanTeacher(change.YSKJS) || "未知教师",
                    position: newPosition,
                    day: newDay,
                    startSection: newStart,
                    endSection: newEnd,
                    weeks: newWeeks,
                    _kbId: kbID
                });
            }
            changeApplied = true;
        }
        if (changeApplied) appliedCount++;
    }
    return { courses: parsedCourses.filter(c => c.weeks.length > 0), appliedCount };
}

/** 保存前清除内部匹配字段 */
function stripInternalFields(courses) {
    return courses.map(c => {
        delete c._kbId;
        return c;
    });
}

// ========== 保存 ==========
async function saveAll(courses, timeSlots, startDate, totalWeeks) {
    // 1. 课表配置（起始日 + 总周次，来自学期校历接口）
    const config = {
        semesterStartDate: startDate,        // "2026-03-09" 或 null
        semesterTotalWeeks: totalWeeks       // 18
    };
    const cfgOk = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    if (!cfgOk) {
        window.shiguangBridge.showToast("课表配置保存失败");
        return false;
    }

    // 2. 节次时间
    const slotOk = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    if (!slotOk) {
        window.shiguangBridge.showToast("节次时间保存失败");
        return false;
    }

    // 3. 课程
    const courseOk = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (!courseOk) {
        window.shiguangBridge.showToast("课程数据保存失败");
        return false;
    }
    return true;
}

// ========== 主流程 ==========
async function runImportFlow() {
    window.shiguangBridge.showToast("吉林大学课表导入启动...");
    try {
        if (!(await promptUserToStart())) return;

        // 1. 选择学期（默认当前学期，可选其他；假期教务可能仍指上学期）
        const sem = await selectSemester();
        if (!sem) return;

        // 2. 学期校历（起始日 + 总周次）
        const cal = await fetchSemesterCalendar(sem.xn, sem.xq);
        const startDate = cal?.startDate || null;
        const totalWeeks = cal?.totalWeeks || 20;

        // 3. 节次时间
        const timeSlots = await fetchTimeSlots();

        // 4. 课程数据
        const courses = await fetchCourses(sem.xnxqdm);
        if (courses.length === 0) {
            window.shiguangBridge.showToast("该学期未查询到课程数据");
            return;
        }

        // 4.5 调课/停课（查询异常不阻塞主流程）
        let finalCourses = courses;
        let changeNote = "";
        try {
            const changes = await fetchCourseChanges(sem.xnxqdm);
            const result = applyCourseChanges(courses, changes);
            finalCourses = result.courses;
            if (result.appliedCount > 0) {
                changeNote = `已应用${result.appliedCount}条调课`;
            }
        } catch (e) {
            console.warn("调课处理跳过:", e);
            changeNote = "调课查询异常";
        }
        finalCourses = stripInternalFields(finalCourses);

        // 4.6 未定时间课程（仅提醒不导入；查询失败静默跳过）
        let undetermined = [];
        try {
            undetermined = await fetchUndeterminedCourses(sem.xnxqdm);
        } catch (e) {
            console.warn("未定课程查询跳过:", e);
        }

        // 5. 保存
        window.shiguangBridge.showToast(`当前学期：${sem.mc}，${finalCourses.length} 条课程${changeNote ? "（" + changeNote + "）" : ""}，正在导入...`);
        const ok = await saveAll(finalCourses, timeSlots, startDate, totalWeeks);
        if (!ok) return;

        // 5.5 未定时间课程提醒（导入已成功；提醒失败不回滚，仍结束流程）
        if (undetermined.length > 0) {
            try {
                const names = [...new Set(undetermined.map(c => c.KCM).filter(Boolean))].join("、");
                await window.shiguangBridgePromise.showAlert(
                    "导入完成",
                    `已导入 ${finalCourses.length} 条课程。\n另有 ${undetermined.length} 门课程上课时间暂未确定，未导入：${names}。\n请关注教务通知，时间确定后重新导入。`,
                    "知道了"
                );
            } catch (e) {
                console.warn("未定课程提醒失败:", e);
                window.shiguangBridge.showToast(`导入成功！共 ${finalCourses.length} 条课程。`);
            }
        } else {
            window.shiguangBridge.showToast(`导入成功！共 ${finalCourses.length} 条课程。`);
        }
        window.shiguangBridge.notifyTaskCompletion();
    } catch (error) {
        console.error("主流程异常:", error);
        window.shiguangBridge.showToast("意外错误: " + error.message);
    }
}

// 启动
runImportFlow();
