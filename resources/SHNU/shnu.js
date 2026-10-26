// 上海师范大学(course.shnu.edu.cn) 时光课程表适配脚本
// 适配对象: 树维EAMS经典版 (courseTableForStd)
// 登录方式: 统一身份认证(cas.shnu.edu.cn), 登录成功回到教务系统页面后点击导入
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

const BASE_URL = "https://course.shnu.edu.cn/eams";

// 上师大每天 14 节(EAMS unitCount 默认 14), 作息时间参考上师大教务处公开作息
const DEFAULT_UNIT_COUNT = 14;

// 节次 → 时间 (第 N 节), 与教务系统课表一致
const SHNU_TIME_SLOTS = [
    { "number": 1, "startTime": "08:00", "endTime": "08:45" },
    { "number": 2, "startTime": "08:50", "endTime": "09:30" },
    { "number": 3, "startTime": "09:45", "endTime": "10:30" },
    { "number": 4, "startTime": "10:35", "endTime": "11:15" },
    { "number": 5, "startTime": "11:25", "endTime": "12:10" },
    { "number": 6, "startTime": "13:00", "endTime": "13:45" },
    { "number": 7, "startTime": "13:50", "endTime": "14:30" },
    { "number": 8, "startTime": "14:45", "endTime": "15:30" },
    { "number": 9, "startTime": "15:35", "endTime": "16:15" },
    { "number": 10, "startTime": "16:25", "endTime": "17:10" },
    { "number": 11, "startTime": "18:00", "endTime": "18:45" },
    { "number": 12, "startTime": "18:50", "endTime": "19:30" },
    { "number": 13, "startTime": "19:40", "endTime": "20:25" },
    { "number": 14, "startTime": "20:30", "endTime": "21:10" }
];

/**
 * 统一网络请求(携带登录 Cookie)
 */
async function request(url, options = {}) {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) throw new Error(`网络请求失败: ${res.status}`);
    return await res.text();
}

/**
 * 获取课表初始化页面, 优先走 AJAX 接口(无冗余布局), 失败则回退完整页面
 */
async function fetchCourseTablePage() {
    try {
        return await request(`${BASE_URL}/courseTableForStd.action?sf_request_type=ajax`);
    } catch (e) {
        return await request(`${BASE_URL}/courseTableForStd.action`);
    }
}

/**
 * 从课表初始化页面提取关键参数
 * ids: 个人课表id(第一个匹配为 std 个人课表, 第二个为 class 班级课表)
 * tagId: 学期选择条 id, 用于 dataQuery 查询全部学期
 * currentSemesterId: 页面隐藏域中的当前学期 id
 */
function detectParameters(html) {
    const idsMatch = html.match(/bg\.form\.addInput\(form,\s*"ids"\s*,\s*"(\d+)"\)/);
    if (!idsMatch) return null;

    const tagIdMatch = html.match(/id="(semesterBar\d+Semester)"/);
    const semMatch = html.match(/name="semester\.id"\s+value="(\d+)"/);

    return {
        ids: idsMatch[1],
        tagId: tagIdMatch ? tagIdMatch[1] : null,
        currentSemesterId: semMatch ? semMatch[1] : null
    };
}

/**
 * 通过 dataQuery 接口获取所有学期, 解析失败时返回 null
 */
function parseSemesterCalendar(raw) {
    // 树维返回的是不带引号 key 的 JS 字面量, 用 Function 求值
    try {
        const data = Function("return (" + raw + ");")();
        if (data && data.semesters) return data.semesters;
    } catch (e) { /* 忽略, 走正则兜底 */ }

    const m = raw.match(/semesters\s*:\s*(\{[\s\S]*\})/);
    if (m) {
        try {
            const data = Function("return ({semesters: " + m[1] + "});")();
            if (data && data.semesters) return data.semesters;
        } catch (e) { /* 兜底也失败 */ }
    }
    return null;
}

/**
 * 获取学期列表并让用户选择
 * 默认选中当前学期(id 与页面隐藏域一致), 其次为 id 最大的(最新)学期
 */
async function getSelectedSemester(tagId, currentSemesterId) {
    let list = [];

    if (tagId) {
        try {
            const raw = await request(`${BASE_URL}/dataQuery.action?sf_request_type=ajax`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar&empty=false`
            });
            const semesters = parseSemesterCalendar(raw);
            if (semesters) {
                const seen = {};
                for (const key in semesters) {
                    const arr = semesters[key];
                    if (!Array.isArray(arr)) continue;
                    arr.forEach(s => {
                        if (!s || s.id == null || seen[s.id]) return;
                        seen[s.id] = true;
                        list.push({ id: String(s.id), name: `${s.schoolYear} ${s.name}学期` });
                    });
                }
                // id 越大学期越新, 按新→旧排列
                list.sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0));
            }
        } catch (e) { /* dataQuery 失败, 走兜底 */ }
    }

    // 兜底: 仅使用页面自带的当前学期
    if (list.length === 0) {
        if (!currentSemesterId) {
            throw new Error("无法获取学期列表, 请确认已登录教务系统");
        }
        list = [{ id: currentSemesterId, name: "当前学期" }];
    }

    // 计算默认选中项: 当前学期优先
    let defaultIndex = 0;
    if (currentSemesterId) {
        const idx = list.findIndex(s => s.id === currentSemesterId);
        if (idx >= 0) defaultIndex = idx;
    }

    const idx = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期", JSON.stringify(list.map(s => s.name)), defaultIndex
    );
    return idx !== null ? list[idx] : null;
}

/**
 * 拉取指定学期的完整课表页面(包含全部周次的 TaskActivity 数据)
 */
async function fetchCourseTableHtml(semesterId, ids) {
    return await request(`${BASE_URL}/courseTableForStd!courseTable.action?sf_request_type=ajax`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `ignoreHead=1&setting.kind=std&startWeek=&project.id=1&semester.id=${encodeURIComponent(semesterId)}&ids=${encodeURIComponent(ids)}`
    });
}

/**
 * 解析课表 HTML 中的 TaskActivity JS 数据 (上师大版本)
 *
 * 树维 EAMS 页面结构:
 *   var teachers = new Array();
 *   var actTeachers = new Array();
 *   teachers[0] = "张三";
 *   actTeachers[0] = {id: 123, name: "张三"};
 *   activity = new TaskActivity(参数中引号字段依次为: [0]编号? [1]课程名 [2]? [3]地点 [4]周次bitmap [5]...);
 *   index = day * unitCount + slot;   // day: 0=周一, slot: 0-based 节次
 *
 * 周次 bitmap: 第 i 位为 '1' 表示第 i 周有课(第 0 位恒为 '0')
 */
function parseTaskActivities(html) {
    const rawResults = [];

    const unitCountMatch = html.match(/unitCount\s*=\s*(\d+)/);
    const unitCount = unitCountMatch ? parseInt(unitCountMatch[1]) : DEFAULT_UNIT_COUNT;

    const blocks = html.split(/activity\s*=\s*new\s+TaskActivity\s*\(/);

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];

        // 教师来自上一个分块末尾的 actTeachers 赋值(即本课程对应的教师数组)
        let teacher = "";
        const prevBlock = blocks[i - 1];
        // 风格一: 数组字面量 actTeachers = [{id:.., name:"张三"}, ...]
        const teacherAssigns = prevBlock.match(/actTeachers\s*=\s*\[([\s\S]*?)\]/g);
        if (teacherAssigns && teacherAssigns.length > 0) {
            const names = teacherAssigns[teacherAssigns.length - 1].match(/name\s*:\s*"([^"]*)"/g);
            if (names) {
                teacher = names.map(n => n.replace(/name\s*:\s*"/, "").replace(/"$/, "")).join(",");
            }
        }
        // 风格二: 元素赋值 actTeachers[0] = {id:.., name:"张三"};
        if (!teacher) {
            const elemAssigns = prevBlock.match(/actTeachers\[\d+\]\s*=\s*\{[^}]*\}/g);
            if (elemAssigns && elemAssigns.length > 0) {
                const names = elemAssigns.join(",").match(/name\s*:\s*"([^"]*)"/g);
                if (names) {
                    teacher = names.map(n => n.replace(/name\s*:\s*"/, "").replace(/"$/, "")).join(",");
                }
            }
        }

        // 提取 TaskActivity(...) 参数 (截到第一个 ");")
        const argsMatch = block.match(/^([\s\S]*?)\)\s*;/);
        if (!argsMatch) continue;
        const argsStr = argsMatch[1];

        const quoted = [];
        const quotedMatches = argsStr.match(/"([^"]*)"/g);
        if (quotedMatches) {
            quotedMatches.forEach(q => quoted.push(q.substring(1, q.length - 1)));
        }
        if (quoted.length < 5) continue;

        // 课程名: 去掉末尾的 "(xx)" 班级号后缀
        let courseName = (quoted[1] || "").trim();
        courseName = courseName.replace(/\([^)]*\)\s*$/, "").trim();
        if (!courseName) courseName = "未知课程";

        // 周次 bitmap: 优先取第 5 个引号字段, 不符时回退为首个形如 0/1 串的字段
        let weeksBitmap = quoted[4];
        if (!/^[01]+$/.test(weeksBitmap)) {
            const bitmapIdx = quoted.findIndex(q => /^[01]{6,}$/.test(q));
            if (bitmapIdx < 0) continue;
            weeksBitmap = quoted[bitmapIdx];
        }

        // 地点: bitmap 前一个引号字段 (标准结构), 兜底取第 4 个
        let position = quoted[3] || "";
        const finalBitmapIdx = quoted.indexOf(weeksBitmap);
        if (finalBitmapIdx > 0 && finalBitmapIdx !== 4) {
            position = quoted[finalBitmapIdx - 1] || position;
        }
        position = position.replace(/\(.*?\)/g, "").trim() || "未知地点";

        // 周次: bitmap 第 i 位 = 第 i 周
        const weeks = [];
        for (let j = 0; j < weeksBitmap.length; j++) {
            if (weeksBitmap.charAt(j) === "1") weeks.push(j);
        }
        if (weeks.length === 0) continue;

        // 上课时间: index = day * unitCount + slot
        const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)\s*;/g;
        let m;
        while ((m = idxRegex.exec(block)) !== null) {
            rawResults.push({
                name: courseName,
                teacher: teacher || "未知教师",
                position: position,
                day: parseInt(m[1]) + 1,          // 1=周一 ... 7=周日
                startSection: parseInt(m[2]) + 1, // 1-based 节次
                endSection: parseInt(m[2]) + 1,
                weeks: weeks
            });
        }
    }

    return mergeContinuousLessons(rawResults);
}

/**
 * 全局课程合并逻辑
 */
function mergeContinuousLessons(lessons) {
    if (!lessons || lessons.length === 0) return [];
    // 1. 建立基于 (课程名|教师|地点|星期几) 的分组
    const groups = {};
    lessons.forEach(l => {
        const key = `${l.name}|${l.teacher}|${l.position}|${l.day}`;
        if (!groups[key]) {
            groups[key] = {
                name: l.name,
                teacher: l.teacher,
                position: l.position,
                day: l.day,
                // 假设大学最多 50 周，构建一个：第 N 周对应哪些节次的矩阵
                weeksMatrix: Array.from({ length: 50 }, () => new Set())
            };
        }
        // 将系统传来的凌乱数据彻底打散，按“周”填入对应的“节”中，Set自动去重
        if (l.weeks && Array.isArray(l.weeks)) {
            l.weeks.forEach(w => {
                if (w >= 0 && w < 50) {
                    for (let s = l.startSection; s <= l.endSection; s++) {
                        groups[key].weeksMatrix[w].add(s);
                    }
                }
            });
        }
    });
    const merged = [];
    // 2. 根据矩阵重新组装绝对精确的课程块
    for (const key in groups) {
        const group = groups[key];
        const matrix = group.weeksMatrix;

        // 用于记录相同的“连续节次块”分布在哪些周次
        // 例如 blockMap["1-2"] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
        // 例如 blockMap["2-2"] = [10]
        const blockMap = {};
        for (let w = 0; w < matrix.length; w++) {
            const sections = Array.from(matrix[w]).sort((a, b) => a - b);
            if (sections.length === 0) continue;
            // 寻找当前周的连续节次块
            let start = sections[0];
            let prev = sections[0];
            for (let i = 1; i < sections.length; i++) {
                const curr = sections[i];
                if (curr === prev + 1) {
                    prev = curr; // 节次连续，继续延伸
                } else {
                    // 节次断开，结算上一个块
                    const blockKey = `${start}-${prev}`;
                    if (!blockMap[blockKey]) blockMap[blockKey] = [];
                    blockMap[blockKey].push(w);

                    // 开启新块
                    start = curr;
                    prev = curr;
                }
            }
            // 结算每周最后一个块
            const blockKey = `${start}-${prev}`;
            if (!blockMap[blockKey]) blockMap[blockKey] = [];
            blockMap[blockKey].push(w);
        }
        // 3. 将聚合好的 blockMap 转换为最终的 JSON 对象
        for (const blockKey in blockMap) {
            const [startSec, endSec] = blockKey.split('-').map(Number);
            merged.push({
                name: group.name,
                teacher: group.teacher,
                position: group.position,
                day: group.day,
                startSection: startSec,
                endSection: endSec,
                weeks: blockMap[blockKey]
            });
        }
    }
    // 4. 排序以便输出整洁美观
    merged.sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        if (a.startSection !== b.startSection) return a.startSection - b.startSection;
        return a.name.localeCompare(b.name);
    });
    return merged;
}

/**
 * 导入上师大预设作息时间
 */
async function applyTimeSlots() {
    return await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(SHNU_TIME_SLOTS));
}

/**
 * 编排整个课程导入流程。
 * 在任何一步用户取消或发生错误时，都会立即退出，notifyTaskCompletion()只在成功后调用
 */
async function runImportFlow() {
    try {
        window.shiguangBridge.showToast("开始探测教务参数...");
        const html = await fetchCourseTablePage();
        const params = detectParameters(html);
        if (!params) throw new Error("未能识别教务参数, 请先登录教务系统再点击导入");

        window.shiguangBridge.showToast("正在获取学期列表...");
        const semester = await getSelectedSemester(params.tagId, params.currentSemesterId);
        if (!semester) return; // 用户取消

        window.shiguangBridge.showToast(`正在同步 ${semester.name} 课表...`);
        const tableHtml = await fetchCourseTableHtml(semester.id, params.ids);
        const courses = parseTaskActivities(tableHtml);
        if (!courses || courses.length === 0) throw new Error("未解析到课程数据, 可能为该学期无课或页面结构变化");

        await applyTimeSlots();
        const saveResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

        if (saveResult) {
            window.shiguangBridge.showToast(`成功导入 ${courses.length} 个课程条目`);
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (e) {
        console.error(`[SHNU适配器异常] ${e.message}`);
        window.shiguangBridge.showToast(e.message);
    }
}

runImportFlow();
