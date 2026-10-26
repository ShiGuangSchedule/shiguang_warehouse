// ============================================================
// 泉州职业技术大学（jw.qvtu.edu.cn/jsxsd，强智教务）
// 拾光课程表适配脚本
//
// 参照官方强智适配案例（YSSDUFE_01，见 shiguangschedule Wiki
// "常见教务系统适配案例参考"）编写：
//   1. 教学周历 jxzl_query 提供学期列表 / 开学日期 / 总周数；
//   2. 学期理论课表 xskb_list.do 提供课程数据（#kbtable / div.kbcontent 官方结构）。
// 若站点周历页结构与案例不同，自动降级：跳过选学期、不提交开学日期，
// 任何情况都不会阻塞导入。
// 流程遵循官方开发文档约定：学期配置 → 课程 → 作息时间（可选，失败不阻止完成）；
// notifyTaskCompletion 只在流程成功后调用。
// 出现问题请联系开发者或提交 PR 更改。
// ============================================================

// 整体包一层 IIFE：本脚本可能被反复注入同一页面（测试器每次点击都会
// 重新注入且不刷新页面），顶层 const/function 会与上一次注入冲突
// （Identifier has already been declared），也会覆盖教务页面自己的全局函数。
(function () {

// ================= 配置 =================

// 作息时间：来自教务"大节"时段，小节按"45 分钟上课 + 15 分钟休息"拆分。
// 注：站点里"第七大节(13,14小节) 12:00-13:59"与晚间节次时间重叠，
//     会被拾光"时间段不可重叠"校验拒绝，故不提供 13、14 节时间（当前无课程使用）。
const QVTU_TIME_SLOTS = [
  { number: 1, startTime: "08:10", endTime: "08:55" },
  { number: 2, startTime: "09:10", endTime: "09:55" },
  { number: 3, startTime: "10:10", endTime: "10:55" },
  { number: 4, startTime: "11:10", endTime: "11:55" },
  { number: 5, startTime: "14:10", endTime: "14:55" },
  { number: 6, startTime: "15:10", endTime: "15:55" },
  { number: 7, startTime: "16:10", endTime: "16:55" },
  { number: 8, startTime: "17:10", endTime: "17:55" },
  { number: 9, startTime: "19:10", endTime: "19:55" },
  { number: 10, startTime: "20:10", endTime: "20:55" },
  { number: 11, startTime: "21:10", endTime: "21:55" },
  { number: 12, startTime: "22:10", endTime: "22:55" }
];

// 教务系统地址与接口
const QVTU_ORIGIN_CHECK = /jw\.qvtu\.edu\.cn$/i; // 只在教务站点上运行
const QVTU_JXZL_URL = "/jsxsd/jxzl/jxzl_query"; // 教学周历（学期列表 + 开学日期 + 总周数）
const QVTU_XSKB_URL = "/jsxsd/xskb/xskb_list.do"; // 学期理论课表

const QVTU_REQUEST_TIMEOUT = 8000; // 单请求超时（毫秒）

// ================= 工具函数 =================

function toast(message) {
  window.shiguangBridge.showToast(message);
}

// 生命周期结束信号：只在流程成功后调用（官方约定）
function notifyDone() {
  window.shiguangBridge.notifyTaskCompletion();
}

// 带超时保护的 fetch（门户切换页面时站点脚本会中断进行中的请求，失败重试一次）
async function fetchText(url, options, tag) {
  const opts = options || { method: "GET", credentials: "include" };
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const p = fetch(url, opts).then(r => r.text());
      if (typeof setTimeout !== "function") return await p;
      return await Promise.race([p, new Promise((_, reject) => {
        setTimeout(() => reject(new Error("请求超时：" + tag)), QVTU_REQUEST_TIMEOUT);
      })]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("请求失败（" + tag + "）：" + (lastErr && lastErr.message ? lastErr.message : "网络错误"));
}

// 解析 HTML 文本为文档对象
function parseHtml(html) {
  return new DOMParser().parseFromString(String(html || ""), "text/html");
}

// 只认可解析得了的课表（登录页/错误页不含这些标记）。
// 不同强智版本课表格子用 class="kbcontent" 或 class="kb_table"，本站另有 <p title=...> 格式。
function hasCourse(text) {
  return /课程名称：|kbcontent|kb_table/.test(String(text || ""));
}

// ================= 核心解析逻辑（一）：教学周历 =================

// GET 周历页：解析学期下拉框，以当前选中学期为原点上下各取 3 个。
// 站点若无 xnxq01id 下拉框则返回空列表（流程自动跳过选学期）。
async function fetchSemesterList() {
  const doc = parseHtml(await fetchText(location.origin + QVTU_JXZL_URL, null, "教学周历页"));
  const select = doc.getElementById("xnxq01id");
  if (!select) return { list: [], defaultIndex: -1 };

  const all = Array.from(select.querySelectorAll("option")).map(opt => ({
    value: opt.value,
    label: opt.textContent.trim(),
    selected: opt.hasAttribute("selected")
  }));
  let idx = all.findIndex(o => o.selected);
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - 3);
  return {
    list: all.slice(start, Math.min(all.length, idx + 4)),
    defaultIndex: idx - start
  };
}

// POST 周历页：解析指定学期的开学日期（首行 td[title]）与总周数（首列最大整数）。
// 结构不符时返回 { startDate: null, totalWeeks: null }，不阻塞流程。
async function fetchSemesterInfo(semesterId) {
  const html = await fetchText(location.origin + QVTU_JXZL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "xnxq01id=" + encodeURIComponent(semesterId),
    credentials: "include"
  }, "教学周历详情");
  const doc = parseHtml(html);
  const timetable = doc.getElementById("kbtable");
  if (!timetable) return { startDate: null, totalWeeks: null };

  const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
  if (!rows.length) return { startDate: null, totalWeeks: null };

  // 开学日期：第一行首个带 title 的 td，如 "2025年9月1日"（兼容不补零）
  const title = (rows[0].querySelector("td[title]") || {}).getAttribute
    ? rows[0].querySelector("td[title]").getAttribute("title") : "";
  const m = String(title).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  const pad = n => (n < 10 ? "0" + n : "" + n);
  const startDate = m ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : null;

  // 总周数：所有行首列能解析为整数的最大值
  let totalWeeks = null;
  for (const row of rows) {
    const td = row.querySelector("td");
    if (!td) continue;
    const n = parseInt(td.textContent.trim(), 10);
    if (!isNaN(n) && n > 0 && (totalWeeks === null || n > totalWeeks)) totalWeeks = n;
  }
  return { startDate, totalWeeks };
}

// ================= 核心解析逻辑（二）：课程 =================

// "第3周"、"第1-16周"、"第1,3,5-8周"、"第1-15周(单周)" → [3] / [1..16] / 奇数周…
function parseWeeks(text) {
  let t = String(text || "").replace(/\s/g, "");
  const parity = t.indexOf("单周") >= 0 ? 1 : t.indexOf("双周") >= 0 ? 2 : 0;
  t = t.replace(/[（(][^）)]*[）)]/g, "");
  const set = {};
  const rangeRe = /(\d+)\s*[-–—~]\s*(\d+)/g;
  let m;
  while ((m = rangeRe.exec(t)) !== null) {
    for (let w = Math.min(+m[1], +m[2]); w <= Math.max(+m[1], +m[2]); w++) set[w] = 1;
  }
  for (const s of t.replace(rangeRe, " ").match(/\d+/g) || []) set[+s] = 1;
  const weeks = [];
  for (const k in set) {
    const n = +k;
    if (n >= 1 && n <= 30 && !(parity === 1 && n % 2 === 0) && !(parity === 2 && n % 2 === 1)) weeks.push(n);
  }
  return weeks.sort((a, b) => a - b);
}

// 把解析结果合并进总表（同名同天同节次区间同地点 → 合并周次）
function mergeCourse(map, c) {
  if (!c.name || !c.day || !c.weeks.length || !c.startSection) return;
  const key = [c.name, c.day, c.startSection + "-" + c.endSection, c.position].join("|");
  if (!map[key]) {
    map[key] = c;
  } else {
    for (const w of c.weeks) if (!map[key].weeks.includes(w)) map[key].weeks.push(w);
    map[key].weeks.sort((a, b) => a - b);
  }
}

// 解析路径 A：官方案例的 DOM 结构（#kbtable 内 div.kbcontent，多课程以长横线分隔）
function parseKbcontent(doc) {
  const timetable = doc.getElementById("kbtable");
  if (!timetable) return [];
  const map = {};
  const rows = Array.from(timetable.querySelectorAll("tr")).filter(r => r.querySelector("td"));
  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    cells.forEach((cell, dayIndex) => {
      const day = dayIndex + 1;
      cell.querySelectorAll("div.kbcontent").forEach(div => {
        const raw = div.innerHTML.trim();
        if (!raw || raw === "&nbsp;" || div.innerText.trim().length < 2) return;
        raw.split(/-{10,}/).forEach(block => {
          if (!block.trim()) return;
          const box = document.createElement("div");
          box.innerHTML = block;

          let name = "";
          for (const node of box.childNodes) {
            if (node.nodeType === 3 && node.textContent.trim() !== "") { name = node.textContent.trim(); break; }
          }
          const teacher = (box.querySelector('font[title="老师"], font[title="教师"]') || {}).innerText || "";
          const position = (box.querySelector('font[title="教室"]') || {}).innerText || "未知地点";
          const weekStr = ((box.querySelector('font[title="周次(节次)"]') || {}).innerText) || "";

          let startSection = 0, endSection = 0;
          const sec = weekStr.match(/\[(.*?)节\]/);
          if (sec && sec[1]) {
            const nums = sec[1].split("-").map(Number).filter(n => !isNaN(n));
            if (nums.length) { startSection = nums[0]; endSection = nums[nums.length - 1]; }
          }
          if (name && startSection > 0) {
            mergeCourse(map, {
              name, teacher: teacher.replace(/任课教师[:：]/, "").trim() || "未知教师",
              position, day, weeks: parseWeeks(weekStr),
              startSection, endSection
            });
          }
        });
      });
    });
  });
  return Object.values(map);
}

// ================= 数据抓取与编排 =================

async function fetchAndParseCourses() {
  if (!QVTU_ORIGIN_CHECK.test(location.hostname)) {
    throw new Error("请先在浏览器/WebView 打开教务网站（https://jw.qvtu.edu.cn/jsxsd）并登录，再运行。当前页面：" + location.href);
  }

  // 1) 学期列表 + 用户选择（站点无学期下拉框时自动跳过，导入当前学期）
  let semesterId = null;
  const { list, defaultIndex } = await fetchSemesterList();
  if (list.length) {
    const picked = await window.shiguangBridgePromise.showSingleSelection(
      "选择学期", JSON.stringify(list.map(s => s.label)), defaultIndex
    );
    if (picked === null) { toast("已取消导入。"); return null; }
    semesterId = list[picked].value;
  }

  // 2) 教学周历 → 开学日期 + 总周数（结构不符则降级为 null）
  let startDate = null, totalWeeks = null;
  if (semesterId) {
    const info = await fetchSemesterInfo(semesterId);
    startDate = info.startDate;
    totalWeeks = info.totalWeeks;
  }

  // 3) 课表：选了学期用 POST 指定学期，否则 GET 当前学期
  const html = await fetchText(location.origin + QVTU_XSKB_URL, semesterId ? {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "jx0404id=&cj0701id=&zc=&demo=&xnxq01id=" + encodeURIComponent(semesterId),
    credentials: "include"
  } : null, "学期课表页");

  if (!hasCourse(html)) {
    if (/用户登录|请登录|loginForm|passwd/i.test(String(html))) {
      throw new Error("教务会话已过期或尚未登录（接口返回登录页）。请重新登录教务系统后运行。");
    }
    console.warn("[泉州职业技术大学适配器] 学期课表页返回了意外内容（前 300 字符）：",
      String(html || "").replace(/\s+/g, " ").slice(0, 300));
    throw new Error("学期课表页返回了无法识别的内容，请按 F12 打开控制台，把警告信息发给开发者核对。");
  }

  // 4) 解析（官方案例 DOM 结构）
  const courses = parseKbcontent(parseHtml(html));
  if (!courses.length) {
    throw new Error("教务页面里没有解析到课程。请确认所选学期已有排课，或把错误信息发给我核对。");
  }

  // 5) 周历未给出总周数时，取课程最大周次兜底
  if (!totalWeeks) {
    for (const c of courses) for (const w of c.weeks) if (w > totalWeeks) totalWeeks = w;
  }
  return { courses, startDate, totalWeeks };
}

// ================= 保存步骤（顺序参照官方开发文档） =================

// 保存学期配置（开学日期/总周数来自教学周历，没拿到就不提交/用课程最大周兜底）
// defaultClassDuration/defaultBreakDuration 与作息表一致（45 分钟一节、小节间休息 15 分钟）
async function saveCourseConfig(startDate, totalWeeks) {
  try {
    const config = {
      firstDayOfWeek: 1,
      defaultClassDuration: 45,
      defaultBreakDuration: 15,
      semesterTotalWeeks: totalWeeks > 0 ? totalWeeks : 20
    };
    if (startDate) config.semesterStartDate = startDate;
    const ok = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    if (!ok) { toast("学期配置保存失败。"); return false; }
    return true;
  } catch (e) {
    toast("学期配置保存失败：" + e.message);
    return false;
  }
}

// 保存课程数据
async function saveCourses(courses) {
  try {
    const ok = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    if (!ok) { toast("课程数据保存失败。"); return false; }
    return true;
  } catch (e) {
    toast("课程数据保存失败：" + e.message);
    return false;
  }
}

// 保存作息时间表（官方文档：可选步骤，失败不阻止导入完成）
async function savePresetTimeSlots() {
  try {
    const ok = await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(QVTU_TIME_SLOTS));
    if (!ok) toast("作息时间保存失败。");
    return !!ok;
  } catch (e) {
    toast("作息时间保存失败：" + e.message);
    return false;
  }
}

// ================= 流程编排 =================

/**
 * 编排整个课程导入流程（顺序与约定参照官方开发文档）。
 * 用户取消或关键步骤保存失败时立即结束；作息时间为可选步骤，失败不阻止完成；
 * notifyTaskCompletion 只在流程成功后调用（官方约定）。
 */
async function runImportFlow() {
  try {
    // 1. 公告和前置检查
    const confirmed = await window.shiguangBridgePromise.showAlert(
      "提示",
      "请确保已成功登录泉州职业技术大学教务系统。是否开始导入？",
      "开始"
    );
    if (!confirmed) {
      toast("已取消导入。");
      return;
    }

    // 2. 网络请求和数据解析（内部含选学期；取消时返回 null）
    toast("正在获取学期课表…");
    const result = await fetchAndParseCourses();
    if (!result) return;
    const { courses, startDate, totalWeeks } = result;

    // 3. 保存学期配置
    if (!await saveCourseConfig(startDate, totalWeeks)) return;

    // 4. 保存课程数据
    toast("正在保存 " + courses.length + " 条课程安排…");
    if (!await saveCourses(courses)) return;

    // 5. 导入作息时间表（可选步骤，失败不阻止导入完成）
    if (!await savePresetTimeSlots()) {
      toast("提示：作息时间未导入，课程已保存，可在 App 里手动设置或稍后重试。");
    }

    // 6. 流程成功，发送结束信号
    toast(`成功导入 ${courses.length} 条课程安排！` +
      (startDate ? `学期 ${startDate} 起，共 ${totalWeeks} 周。` : "开学日期未能自动获取，可在 App 里手动设置。"));
    notifyDone();
  } catch (error) {
    // 任何一步失败：记录并提示用户，与官方适配一致不向外抛出，也不发送完成信号
    console.error("[泉州职业技术大学适配器]", error);
    toast("导入失败：" + (error && error.message ? error.message : error));
  }
}

// 启动导入流程
runImportFlow();

})();
