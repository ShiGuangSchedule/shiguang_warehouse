// 江苏大学(ujs.edu.cn) 拾光课程表适配脚本
// 基于正方教务系统接口适配
// 出现问题请联系作者或者提交直接pr更改,这更加快速

// 基于GSMC修改
// 作者：洛初 Github@gongfuture

// 2026.03.30 第一版
// 通过正方接口 xskbcx_cxXsgrkb 拉取个人课表，解析课程名、教师、教室、星期、节次和周次（含单双周）。
// 交互上依次询问学年、学期与作息类型（夏令时/冬令时/智能选择，智能选择按固定切令时日期判定）。
// 按课程所在楼栋匹配上午与下午作息，写入课程的自定义时间；导入课程、课表配置与预设时间段。

// 2026.08.23 第二版
// 桥接接口升级至 v2（window.shiguangBridge / window.shiguangBridgePromise）。
// 补充开学日期：从首页日历区块取当前学期起止日期写入 semesterStartDate，总周数改为按实际周次取值；
// 取不到开学日期时跳过配置保存，避免覆盖用户已有设置。
// 课程备注补充重修标记、选课备注（体育项目、微专业等）与周次原文。
// 集中实践课（军训、毕业设计等）无星期节次无法排课，改为弹窗提示手动添加。
// 教师与教室为空不再丢弃课程；修正京江各号楼的楼栋匹配；支持校外 WebVPN 访问。

// 2026.09.07 第三版
// 开学日期改从校历接口 xskbcxZccx_cxZcByXnxq 按所选学年学期获取，历史学期同样能取到，
// 总周数取校历周数，日期解析兼容 zcrq / ksrq 字段兜底；取不到校历时仍跳过配置保存。
// 作息时间不随切令时自动变化，导入后弹窗提示下次切令时日期。
// 新增课程合并去重：连续节次合并、同课同节次的周次合并、完全重复去重。
// 学年学期改为从教务系统读取选项并默认选中当前学期，读取失败时回退手动输入。
// 课程请求与校历请求并行执行，课程解析与配置计算整合进同一函数，结构对齐官方参考脚本。
// 修复：教务页面 zftal 脚本会改写 Array.prototype.filter（回调实参颠倒），
// 导致集中实践课被静默丢弃，改用自实现的 arrayFilter 规避；清理注释残留与冗余日志。

/**
 * 数组过滤（原生实现）。
 * 教务页面加载的 zftal 脚本会改写 Array.prototype.filter/some/every，
 * 把回调实参换成 (index, value)（原生的 value 在前），
 * 原生 filter 写法在这种页面上会得到错误结果（例如过滤不掉空选项），
 * 所以这里用普通循环自行实现，不依赖任何被改写过的数组方法。
 */
function arrayFilter(arr, predicate) {
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i, arr)) {
            result.push(arr[i]);
        }
    }
    return result;
}

/**
 * 解析周次字符串，处理单双周和周次范围。
 */
function parseWeeks(weekStr) {
    if (!weekStr) return [];

    const weekSets = weekStr.split(',');
    let weeks = [];

    for (const set of weekSets) {
        const trimmedSet = set.trim();

        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/); // 匹配以数字周结束的

        let start = 0;
        let end = 0;
        let processed = false;

        if (rangeMatch) { // 范围, 如 "1-5周"
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) { // 单个周, 如 "6周"
            start = end = Number(singleMatch[1]);
            processed = true;
        }

        if (processed) {
            // 确定单双周
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');

            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue; // 单周跳过偶数
                if (isDouble && w % 2 !== 0) continue; // 双周跳过奇数
                weeks.push(w);
            }
        }
    }

    // 去重并排序
    return [...new Set(weeks)].sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重函数（参考官方 wiki 课程合并与去重函数）。
 * 正方系统常把同一门课拆成多条记录：连续节次分开返回（1-2 节 + 3-4 节）、
 * 单双周分开返回、或完全重复返回，这里统一合并/去重。
 * @param {Array<Object>} courses 原始解析课程数组
 * @returns {Array<Object>} 合并去重后的课程数组
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

    // 阶段 1：合并连续节次与完全重复记录（前提：名称、教师、地点、星期、周次一致）
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
            // 节次连续：延长结束节次 (如 1-2 节 + 3-4 节 -> 1-4 节)
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            // 完全重复：跳过
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
            // 周次合并去重 (如 1-8 周 + 9-16 周 -> 1-16 周，单周 + 双周 -> 每周)
            cur.weeks = Array.from(new Set([...cur.weeks, ...nxt.weeks])).sort((a, b) => a - b);
        } else {
            step2Merged.push(cur);
            cur = nxt;
        }
    }
    step2Merged.push(cur);

    return step2Merged;
}

/**
 * 拼接教务系统接口地址。
 * 校内直连时 location.origin 就是教务域名，前缀为空；
 * 校外经 WebVPN 访问时路径带有 /http/<hex> 前缀，必须保留，否则会变成跨域请求。
 */
function buildApiUrl(path) {
    const prefixMatch = window.location.pathname.match(/^\/http\/[0-9a-f]+/i);
    const prefix = prefixMatch ? prefixMatch[0] : "";
    return window.location.origin + prefix + path;
}

/**
 * 拼装课程备注。
 * xm 只有姓名，kcmc 只有课程名，以下信息只存在于原始字段里，
 * 放进备注方便用户核对：重修标记、选课备注（体育项目、微专业等）、周次原文。
 */
function buildCourseRemark(rawCourse) {
    const parts = [];

    const retakeFlag = String(rawCourse.cxbjmc || "").trim();
    if (retakeFlag) {
        parts.push(retakeFlag);
    }

    const selectionNote = String(rawCourse.xkbz || "").trim();
    if (selectionNote) {
        parts.push(selectionNote);
    }

    const weekDesc = String(rawCourse.zcd || "").trim();
    if (weekDesc) {
        parts.push(weekDesc);
    }

    return parts.join(" | ");
}

/**
 * 解析集中实践课列表（sjkList）。
 * 这类课程（军事技能训练、形势与政策等）只有课程名、教师和起止周，
 * 没有星期和节次，无法映射到周课表，只能提示用户手动添加。
 */
function parsePracticeCourses(jsonData) {
    if (!jsonData || !Array.isArray(jsonData.sjkList)) {
        return [];
    }

    return arrayFilter(
        jsonData.sjkList
            .map((item) => ({
                name: String(item.kcmc || "").trim(),
                teacher: String(item.jsxm || "").trim(),
                weekDesc: String(item.qsjsz || "").trim()
            })),
        (item) => item.name
    );
}

/**
 * 解析 API 返回的 JSON 数据。
 * 合并去重后，按课程所在位置匹配作息，写入自定义时间。
 */
function parseJsonData(jsonData, isSummerTime) {
    // 检查JSON结构：新的数据在 kbList 字段中
    if (!jsonData || !Array.isArray(jsonData.kbList)) {
        console.warn("JS: JSON 数据结构错误或缺少 kbList 字段。");
        return [];
    }

    const rawCourseList = jsonData.kbList;
    const initialCourseList = [];

    for (const rawCourse of rawCourseList) {
        // 关键字段检查：只有 kcmc(课名), xqj(星期), jcs(节次范围), zcd(周次描述) 是排课必需的。
        // xm(教师) 与 cdmc(教室) 在实践课、线上课、未排地点的课程上可能为空，
        // 缺这两项不影响排课，不能因此丢弃整门课程。
        if (!rawCourse.kcmc || !rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
            continue;
        }

        const weeksArray = parseWeeks(rawCourse.zcd);

        // 周次有效性检查
        if (weeksArray.length === 0) {
            continue;
        }

        // 解析节次范围，例如 "1-2"
        const sectionParts = rawCourse.jcs.split('-');
        const startSection = Number(sectionParts[0]);
        const endSection = Number(sectionParts[sectionParts.length - 1]);

        const day = Number(rawCourse.xqj); // xqj: 星期几 (周一为1, 周日为7)

        // 数字有效性检查
        if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || day < 1 || day > 7 || startSection > endSection) {
            continue;
        }

        const remark = buildCourseRemark(rawCourse);

        const course = {
            name: String(rawCourse.kcmc).trim(),
            teacher: String(rawCourse.xm || "").trim(),
            position: String(rawCourse.cdmc || "").trim(),
            day: day,
            startSection: startSection,
            endSection: endSection,
            weeks: weeksArray
        };

        if (remark) {
            course.remark = remark;
        }

        initialCourseList.push(course);
    }

    // 正方常把同一门课拆成多条记录（连续节次、单双周、重复），先合并去重，
    // 再按楼栋匹配作息写入自定义时间，最后按星期节次排序。
    const mergedCourses = mergeAndDistinctCourses(initialCourseList);
    const finalCourseList = applyCustomTimeToCourses(mergedCourses, isSummerTime);
    finalCourseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name)
    );

    console.log(`JS: 课程解析完成，原始 ${initialCourseList.length} 条，合并去重后 ${finalCourseList.length} 条。`);
    return finalCourseList;
}

/**
 * 检查当前是否处于夏令时作息时间段。
 * @returns true 夏令时 false 冬令时
 *
 * 曾尝试抓取教务处作息时间公告页（https://jwc.ujs.edu.cn/index/xl_zuo_xi_shi_jian.htm），
 * 但跨域（CORS）无法读取，智能选择回退到预设日期。
 * 冬令时是十一假期结束后调整，取 10 月 7 日；夏令时公告历年均为 4 月 7 日起执行。
 */
function whetherSummerTimeSlot() {
    // 预设日期
    const summerStart = new Date(new Date().getFullYear(), 3, 7); // 4月7日
    const winterStart = new Date(new Date().getFullYear(), 9, 7); // 10月7日

    const now = new Date();
    return now >= summerStart && now < winterStart;
}

/**
 * 计算本次导入的作息何时失效。
 * 作息时间是导入时一次性写死的，不会自动跟随切令时变化，
 * 所以这里返回下一个「切到另一种令时」的日期，用于提示用户届时重新导入。
 * 夏令时 4 月 7 日起执行，冬令时十一假期后（10 月 7 日）起执行。
 */
function getNextTimeSlotSwitchDate(isSummerTime) {
    const now = new Date();
    const year = now.getFullYear();
    const targetLabel = isSummerTime ? "冬令时" : "夏令时";

    const candidates = [
        { date: new Date(year, 3, 7), label: "夏令时" },
        { date: new Date(year, 9, 7), label: "冬令时" },
        { date: new Date(year + 1, 3, 7), label: "夏令时" },
        { date: new Date(year + 1, 9, 7), label: "冬令时" }
    ];

    const next = candidates.find((item) => item.date > now && item.label === targetLabel);

    return {
        label: next.label,
        text: `${next.date.getFullYear()}年${next.date.getMonth() + 1}月${next.date.getDate()}日`
    };
}

/**
 * 检查是否在登录页面。
 * 校内直连时地址是 http://jwxt.ujs.edu.cn/sso/jziotlogin，
 * 校外经 WebVPN 时地址是 https://webvpn.ujs.edu.cn/http/<hex>/sso/jziotlogin，
 * 因此按路径结尾判断，两种入口都能识别。
 */
function isLoginPage() {
    return window.location.pathname.endsWith("/sso/jziotlogin");
}


function validateYearInput(input) {
    if (/^[0-9]{4}$/.test(input)) {
        return false;
    }
    return "请输入四位数字的学年！";
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请确保您已在浏览器中成功登录教务系统",
        "好的，开始导入"
    );
}

/**
 * 从教务系统课表查询页读取学年学期选项。
 * 学年：以系统当前选中项为中心，取前 2 年 + 后 2 年，共 5 个选项；
 * 学期：直接取页面全部选项。
 * 读取失败返回 null，由调用方回退到手动输入。
 */
async function fetchAcademicOptions() {
    const url = buildApiUrl("/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151");

    try {
        const response = await fetch(url, {
            method: "GET",
            credentials: "include"
        });

        if (!response.ok) return null;

        const doc = new DOMParser().parseFromString(await response.text(), "text/html");

        const allYearOptions = arrayFilter(
            Array.from(doc.querySelectorAll("#xnm option"))
                .map((opt) => ({
                    value: opt.value,
                    text: opt.textContent.trim(),
                    selected: opt.selected
                })),
            (opt) => opt.value !== ""
        );

        const semesterOptions = arrayFilter(
            Array.from(doc.querySelectorAll("#xqm option"))
                .map((opt) => ({
                    value: opt.value,
                    // 江大返回的文本只有「1」「2」，直接展示不友好，补成「第一学期」这类写法。
                    text: /^\d$/.test(opt.textContent.trim())
                        ? `第${"一二三四五六七八九十"[Number(opt.textContent.trim()) - 1] || opt.textContent.trim()}学期`
                        : opt.textContent.trim(),
                    selected: opt.selected
                })),
            (opt) => opt.value !== ""
        );

        if (allYearOptions.length === 0 || semesterOptions.length === 0) {
            return null;
        }

        const selectedIndex = allYearOptions.findIndex((opt) => opt.selected);
        const start = Math.max(0, selectedIndex === -1 ? 0 : selectedIndex - 2);
        const end = Math.min(allYearOptions.length, selectedIndex === -1 ? 5 : selectedIndex + 3);
        const yearOptions = allYearOptions.slice(start, end);

        const defaultSemesterIndex = semesterOptions.findIndex((opt) => opt.selected);

        return {
            yearOptions,
            semesterOptions,
            defaultYearIndex: selectedIndex === -1 ? 0 : selectedIndex - start,
            defaultSemesterIndex: defaultSemesterIndex === -1 ? 0 : defaultSemesterIndex
        };
    } catch (error) {
        console.warn("JS: 读取学年学期选项失败:", error);
        return null;
    }
}

/**
 * 提示用户选择学年和学期。
 * 优先用教务系统返回的选项（自动默认选中当前学期），
 * 读取失败时回退为手动输入学年 + 固定的两学期选择。
 * @returns {{academicYear: string, semesterCode: string}} 或 null（取消）
 */
async function selectAcademicYearAndSemester() {
    const optionsData = await fetchAcademicOptions();

    if (optionsData) {
        const { yearOptions, semesterOptions, defaultYearIndex, defaultSemesterIndex } = optionsData;

        const yearIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学年",
            JSON.stringify(yearOptions.map((item) => item.text)),
            defaultYearIndex
        );
        if (yearIndex === null || yearIndex === -1) return null;

        const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
            "选择学期",
            JSON.stringify(semesterOptions.map((item) => item.text)),
            defaultSemesterIndex
        );
        if (semesterIndex === null || semesterIndex === -1) return null;

        return {
            academicYear: yearOptions[yearIndex].value,
            semesterCode: semesterOptions[semesterIndex].value
        };
    }

    // 回退：手动输入学年。
    const currentYear = new Date().getFullYear().toString();
    const currentMonth = new Date().getMonth() + 1; // 月份从0开始，所以加1
    // 如果当前月份在8月或之后，默认学年是当前年份，否则是上一年份
    const defaultYear = currentMonth >= 8 ? currentYear : (Number(currentYear) - 1).toString();

    const academicYear = await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "未能从教务系统读取学年学期，请手动输入要导入课程的起始学年（如2025-2026 应该填2025）:",
        defaultYear,
        "validateYearInput"
    );
    if (academicYear === null) return null;

    const semesters = ["第一学期", "第二学期"];
    const defaultSemesterIndex = currentMonth >= 8 ? 0 : 1;
    const semesterIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters),
        defaultSemesterIndex
    );
    if (semesterIndex === null || semesterIndex === -1) return null;

    return {
        academicYear,
        semesterCode: getSemesterCode(semesterIndex)
    };
}

async function selectTimeSlot() {
    const timeSlots = ["智能选择" ,"夏令时", "冬令时"];
    const timeSlotIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择作息时间",
        JSON.stringify(timeSlots),
        0
    );
    return timeSlotIndex;
}

async function reselectTimeSlot(selectedTimeSlot) {
    const options = ["对的对的，就是这个", "不对不对，应该是另外一个"];
    const dialogTitle = "当前智能选择结果为: \n  " + (selectedTimeSlot ? "夏令时" : "冬令时") + "\n是否更改选择？";
    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        dialogTitle,
        JSON.stringify(options),
        0
    );

    if (selectedIndex === null || selectedIndex === -1) {
        return false;
    }

    // 选中第 2 项（索引 1）表示“需要改成另外一个”。
    return selectedIndex === 1;
}

/**
 * 将选择索引转换为 API 所需的学期码。
 */
function getSemesterCode(semesterIndex) {
    // semesterIndex 3 (第一学期), 12 (第二学期)
    return semesterIndex === 0 ? "3" : "12";
}


/**
 * 获取指定学年学期的校历周次。
 *
 * 接口按周次顺序返回数组，每个元素代表一周：
 * rq 形如 "2026-08-31/2026-09-06"，zs 是周次序号。
 * 第 1 周的起始日（周一）就是 semesterStartDate 需要的开学日期，
 * 数组长度就是教务排的总周数。
 * 与首页日历区块不同，这个接口尊重 xnm/xqm 参数，历史学期同样能取到；
 * 尚未排出校历的学期返回空数组。
 */
async function fetchSemesterWeeks(academicYear, semesterCode) {
    const url = buildApiUrl("/kbcx/xskbcxZccx_cxZcByXnxq.html?gnmkdm=N2154");

    try {
        const response = await fetch(url, {
            "headers": {
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            },
            "body": `xnm=${academicYear}&xqm=${semesterCode}`,
            "method": "POST",
            "credentials": "include"
        });

        if (!response.ok) {
            throw new Error(`状态码 ${response.status}`);
        }

        const weekList = JSON.parse(await response.text());

        if (!Array.isArray(weekList) || weekList.length === 0) {
            console.warn("JS: 校历接口未返回周次数据，该学期可能尚未排出校历。");
            return null;
        }

        // 正常情况下数组已按周次排好，仍按 zs 找一次第 1 周，避免顺序变化时取错日期。
        const firstWeek = weekList.find((item) => Number(item.zs) === 1) || weekList[0];

        // rq 形如 "2026-08-31/2026-09-06"，取斜杠前的周一日期；
        // 部分正方部署改用 zcrq / ksrq 字段，一并兜底。
        const rqDate = String(firstWeek.rq || "").split("/")[0].trim();
        const fallbackMatch = String(firstWeek.zcrq || firstWeek.ksrq || "").match(/(\d{4}-\d{2}-\d{2})/);
        const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rqDate) ? rqDate : (fallbackMatch ? fallbackMatch[1] : "");

        if (!startDate) {
            console.warn("JS: 校历接口返回的日期无法识别:", firstWeek);
            return null;
        }

        const range = { startDate: startDate, totalWeeks: weekList.length };
        console.log("JS: 校历周次:", range);
        return range;

    } catch (error) {
        console.warn("JS: 获取校历周次失败:", error);
        return null;
    }
}

/**
 * 计算课表配置。
 *
 * 应用侧的 saveCourseConfig 是整体覆盖而非字段级合并：没有传入的字段会被写成模型默认值，
 * 其中 semesterStartDate 的默认值是 null，会把用户已经设置好的开学日期清空。
 * 所以拿不到真实开学日期时返回 null，由调用方跳过整个配置保存，宁可不写也不要写坏。
 *
 * defaultClassDuration / defaultBreakDuration 不显式传入，会被重置为应用默认的 45 / 10 分钟，
 * 与江大「45 分钟一节、课间 10 分钟」一致，因此没有副作用。
 */
function buildCourseConfig(semesterRange, firstDayOfWeek) {
    if (!semesterRange) {
        return null;
    }

    return {
        semesterStartDate: semesterRange.startDate,
        // 直接采用校历周数。校历含考试周与假期周，比实际上课周多几周，
        // 但这个值只是课表的周次上限：多几周空白无害，少了会截断课程。
        semesterTotalWeeks: semesterRange.totalWeeks,
        firstDayOfWeek: firstDayOfWeek
    };
}


/**
 * 请求和解析课程数据。
 * 课程请求与校历请求并行执行，课表配置一并算好返回，
 * 由调用方决定是否保存（拿不到开学日期时 config 为 null）。
 */
async function fetchAndParseCourses(academicYear, semesterCode, isSummerTime) {
    window.shiguangBridge.showToast("正在请求课表数据...");

    const xnmXqmBody = `xnm=${academicYear}&xqm=${semesterCode}&kzlx=ck&xsdm=&kclbdm=`;
    const url = buildApiUrl("/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151");

    // 并行获取课程数据和校历周次
    const [courseResponse, semesterRange] = await Promise.all([
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: xnmXqmBody,
            credentials: "include"
        }),
        fetchSemesterWeeks(academicYear, semesterCode)
    ]);

    try {
        if (!courseResponse.ok) {
            throw new Error(`网络请求失败。状态码: ${courseResponse.status} (${courseResponse.statusText})`);
        }

        let jsonData;
        try {
            jsonData = JSON.parse(await courseResponse.text());
        } catch (e) {
            console.error('JS: JSON 解析失败，可能是会话过期:', e);
            window.shiguangBridge.showToast("数据返回格式错误，可能是您未成功登录或会话已过期。");
            return null;
        }

        const courses = parseJsonData(jsonData, isSummerTime);

        if (courses.length === 0) {
            window.shiguangBridge.showToast("未找到任何课程数据，请检查所选学年学期是否正确或本学期无课，或教务系统需要二次登录。");
            return null;
        }

        // 集中实践课（军训、形势与政策等）没有星期和节次，无法排进周课表，单独取出用于提示。
        const practiceCourses = parsePracticeCourses(jsonData);
        if (practiceCourses.length > 0) {
            console.log(`JS: 检测到 ${practiceCourses.length} 门集中实践课，无法自动导入。`);
        }

        // qsxqj: 教务系统设置的一周起始星期几，缺失时按周一处理。
        const rawFirstDay = Number(jsonData.qsxqj);
        const firstDayOfWeek = (rawFirstDay >= 1 && rawFirstDay <= 7) ? rawFirstDay : 1;

        return {
            courses: courses,
            practiceCourses: practiceCourses,
            config: buildCourseConfig(semesterRange, firstDayOfWeek)
        };

    } catch (error) {
        window.shiguangBridge.showToast(`请求或解析失败: ${error.message}`);
        console.error('JS: Fetch/Parse Error:', error);
        return null;
    }
}

async function saveCourses(parsedCourses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
        return true;
    } catch (error) {
        window.shiguangBridge.showToast(`课程保存失败: ${error.message}`);
        console.error('JS: Save Courses Error:', error);
        return false;
    }
}

/**
 * 只在能拿到真实开学日期时写入课表配置。
 * 拿不到就完全不调用 saveCourseConfig —— 应用侧是整体覆盖，
 * 传入不含 semesterStartDate 的配置会把用户已设置的开学日期清空。
 */
async function saveCourseConfigIfPossible(config) {
    if (!config) {
        window.shiguangBridge.showToast("未取到本学期开学日期，已跳过课表配置，请在应用内手动设置开学日期。");
        console.log("JS: 无可用开学日期，跳过 saveCourseConfig 以保留用户现有配置。");
        return;
    }

    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        window.shiguangBridge.showToast(
            `课表配置更新成功！开学日期 ${config.semesterStartDate}，总周数 ${config.semesterTotalWeeks} 周。`
        );
    } catch (error) {
        window.shiguangBridge.showToast(`课表配置保存失败: ${error.message}`);
        console.error('JS: Save Config Error:', error);
    }
}

// 上午作息时间
// 北固及本部主楼、主A楼、生环楼、汽车能动楼、京江楼
const AMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
];

// 三江楼、材料楼、机械楼、新校区各教学楼
const BMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:10", endTime: "10:55" },
    { number: 4, startTime: "11:05", endTime: "11:50" },
];

// 三山楼、讲堂群、实践楼
const CMorningTimeSlots = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
];

// 夏令时
// 下午作息时间
// 北固
const DSummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "15:50", endTime: "16:35" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
];

// 本部
const ESummerAfternoonTimeSlots = [
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:55", endTime: "15:40" },
    { number: 7, startTime: "16:00", endTime: "16:45" },
    { number: 8, startTime: "16:55", endTime: "17:40" },
];

// 晚上作息时间
const SummerEveningTimeSlots = [
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:55", endTime: "20:40" },
    { number: 11, startTime: "20:50", endTime: "21:35" },
];

// 冬令时
// 下午作息时间
// 北固
const DWinterAfternoonTimeSlots = [
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:20", endTime: "16:05" },
    { number: 8, startTime: "16:15", endTime: "17:00" },
];

// 本部
const EWinterAfternoonTimeSlots = [
    { number: 5, startTime: "13:30", endTime: "14:15" },
    { number: 6, startTime: "14:25", endTime: "15:10" },
    { number: 7, startTime: "15:30", endTime: "16:15" },
    { number: 8, startTime: "16:25", endTime: "17:10" },
];

// 晚上作息时间
const WinterEveningTimeSlots = [
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:25", endTime: "20:10" },
    { number: 11, startTime: "20:20", endTime: "21:05" },
];

// 全局默认作息
// 夏令时
const SummerTimeSlots = [...AMorningTimeSlots, ...ESummerAfternoonTimeSlots, ...SummerEveningTimeSlots];

// 冬令时
const WinterTimeSlots = [...AMorningTimeSlots, ...EWinterAfternoonTimeSlots, ...WinterEveningTimeSlots];

function getCampusTypeFromPosition(position) {
    const normalized = String(position || "").replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    // api 不再返回「本部」这类校区前缀，北固的返回格式也未确认，只能先这么写：
    // 带「北固」的按北固校区处理，其余一律按本部处理。
    const firstPart = normalized.split(" ")[0] || "";
    if (firstPart.includes("北固") || normalized.includes("北固")) return "D";
    return "E";
}

function getMorningTypeFromPosition(position) {
    const text = String(position || "").trim();

    // 教务系统返回的是「京江2号楼2101」「京江3号楼3407」这类名称，没有「京江楼」这个写法，
    // 所以这里匹配「京江」而不是「京江楼」。
    if (text.includes("主A楼") || text.includes("京江")) return "A";
    if (text.includes("三江楼")) return "B";
    if (text.includes("三山楼") || text.includes("讲堂群")) return "C";

    return null;
}

function buildCourseTimeSlotsByPosition(position, isSummerTime) {
    const morningType = getMorningTypeFromPosition(position);
    const campusType = getCampusTypeFromPosition(position);

    // 仅对指定楼宇做自定义。
    if (!morningType || !campusType) {
        return null;
    }

    const morningTimeSlots = morningType === "A"
        ? AMorningTimeSlots
        : morningType === "B"
            ? BMorningTimeSlots
            : CMorningTimeSlots;

    const afternoonTimeSlots = isSummerTime
        ? (campusType === "D" ? DSummerAfternoonTimeSlots : ESummerAfternoonTimeSlots)
        : (campusType === "D" ? DWinterAfternoonTimeSlots : EWinterAfternoonTimeSlots);

    const eveningTimeSlots = isSummerTime ? SummerEveningTimeSlots : WinterEveningTimeSlots;

    return [...morningTimeSlots, ...afternoonTimeSlots, ...eveningTimeSlots];
}

function applyCustomTimeToCourses(courses, isSummerTime) {
    let customizedCount = 0;
    let skippedCount = 0;

    const updatedCourses = courses.map((course) => {
        const courseTimeSlots = buildCourseTimeSlotsByPosition(course.position, isSummerTime);
        if (!courseTimeSlots) {
            skippedCount += 1;
            return course;
        }

        const slotMap = new Map(courseTimeSlots.map((slot) => [slot.number, slot]));
        const startSlot = slotMap.get(course.startSection);
        const endSlot = slotMap.get(course.endSection);

        if (!startSlot || !endSlot) {
            skippedCount += 1;
            console.warn(`JS: 课程 ${course.name} 的节次(${course.startSection}-${course.endSection})未命中自定义时间映射，回退为普通节次。`);
            return course;
        }

        customizedCount += 1;
        return {
            ...course,
            isCustomTime: true,
            customStartTime: startSlot.startTime,
            customEndTime: endSlot.endTime,
        };
    });

    console.log(`JS: 自定义时间处理完成，命中 ${customizedCount} 门，跳过 ${skippedCount} 门。`);
    return updatedCourses;
}


async function importPresetTimeSlots(timeSlots) {
    if (timeSlots.length === 0) {
        window.shiguangBridge.showToast("警告：时间段为空，未导入时间段信息。");
        return;
    }

    window.shiguangBridge.showToast(`正在导入 ${timeSlots.length} 个预设时间段...`);
    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        window.shiguangBridge.showToast("预设时间段导入成功！");
    } catch (error) {
        window.shiguangBridge.showToast("导入时间段失败: " + error.message);
        console.error('JS: Save Time Slots Error:', error);
    }
}


async function runImportFlow() {
    if (isLoginPage()) {
        window.shiguangBridge.showToast("导入失败：请先登录教务系统！");
        console.log("JS: 检测到当前在登录页面，终止导入。");
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        window.shiguangBridge.showToast("用户取消了导入。");
        return;
    }

    const selection = await selectAcademicYearAndSemester();
    if (selection === null) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }
    const { academicYear, semesterCode } = selection;
    console.log(`JS: 已选择学年学期: ${academicYear} / ${semesterCode}`);

    const timeSlotIndex = await selectTimeSlot();
    if (timeSlotIndex === null || timeSlotIndex === -1) {
        window.shiguangBridge.showToast("导入已取消。");
        return;
    }

    let isSummerTime;
    if (timeSlotIndex === 1) {
        isSummerTime = true;
    } else if (timeSlotIndex === 2) {
        isSummerTime = false;
    } else {
        isSummerTime = whetherSummerTimeSlot();
        const shouldReselect = await reselectTimeSlot(isSummerTime);
        if (shouldReselect) {
            isSummerTime = !isSummerTime;
        }
    }
    console.log(`JS: 作息类型: ${isSummerTime ? "夏令时" : "冬令时"}`);

    const result = await fetchAndParseCourses(academicYear, semesterCode, isSummerTime);
    if (result === null) {
        console.log("JS: 课程获取或解析失败，流程终止。");
        return;
    }
    const { courses, practiceCourses, config } = result;

    // 作息时间在导入时一次性写入，不会自动跟随切令时变化，需要明确告知用户。
    // 同时说明只有部分教学楼收录了独立作息，其余楼栋使用默认作息时间。
    const nextSwitch = getNextTimeSlotSwitchDate(isSummerTime);
    await window.shiguangBridgePromise.showAlert(
        "作息时间提示",
        `本次按${isSummerTime ? "夏令时" : "冬令时"}导入。作息时间在导入时写入，不会自动跟随学校切换令时。\n` +
        `${nextSwitch.text}起学校切换为${nextSwitch.label}，届时请重新导入课表，或在应用内手动修改时间段。\n\n` +
        "脚本已根据课程所在位置匹配作息时间，部分课程可能与预设时间不符。\n" +
        "请在课表页面核对课程时间，如有错误请手动修改课程所在位置或节次信息。\n\n" +
        "已收录独立作息的楼栋：主A楼、京江各号楼、三江楼、三山楼、讲堂群。\n" +
        "其余楼栋（各学院楼、各实验室、运动场、未排地点等）使用默认作息时间。\n\n" +
        "欢迎其他楼栋的同学提供课程时间信息以完善脚本！",
        "我知道了"
    );

    if (practiceCourses.length > 0) {
        const practiceList = practiceCourses
            .map((item) => {
                const teacher = item.teacher ? `（${item.teacher}）` : "";
                const weekDesc = item.weekDesc ? ` ${item.weekDesc}` : "";
                return `· ${item.name}${teacher}${weekDesc}`;
            })
            .join("\n");

        console.log("JS: 集中实践课列表:", practiceCourses);
        await window.shiguangBridgePromise.showAlert(
            "集中实践课需手动添加",
            `本学期有 ${practiceCourses.length} 门集中实践课，教务系统未给出星期和节次，无法自动导入：\n\n` +
            practiceList +
            "\n\n请按实际安排在应用内手动添加。",
            "我知道了"
        );
    }

    const saveResult = await saveCourses(courses);
    if (!saveResult) {
        console.log("JS: 课程保存失败，流程终止。");
        return;
    }

    await saveCourseConfigIfPossible(config);

    await importPresetTimeSlots(isSummerTime ? SummerTimeSlots : WinterTimeSlots);


    window.shiguangBridge.showToast(`课程导入成功，共导入 ${courses.length} 门课程！`);
    console.log("JS: 整个导入流程执行完毕并成功。");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
