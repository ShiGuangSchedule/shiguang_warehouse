/**
 * 电子科技大学 (UESTC) - EAMS 教务系统课程导入适配器
 *
 * 2026-07-26 | CorunLing
 *
 * 适配流程：
 *   1. 用户登录 https://eams.uestc.edu.cn/eams
 *   2. 进入课程表页面或任意已登录页面
 *   3. 执行导入，选择学期
 *   4. 脚本通过 Fetch 请求课表 API，解析 TaskActivity 数据
 *   5. 生成课程列表并保存
 */

(function () {
'use strict';

// ═══════════════════════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════════════════════

const UESTC_CONFIG = {
  semesterBase: 483,    // 2025-2026 第一学期
  semesterStep: 20,     // 每学期 +20
  yearBase: 2025,
  defaultTotalWeeks: 20,
};

/** 电子科技大学标准作息时间段（仅供参考，可在 APP 中调整） */
const DEFAULT_TIME_SLOTS = [
  { number: 1,  startTime: '08:30', endTime: '09:15' },
  { number: 2,  startTime: '09:20', endTime: '10:05' },
  { number: 3,  startTime: '10:25', endTime: '11:10' },
  { number: 4,  startTime: '11:15', endTime: '12:00' },
  { number: 5,  startTime: '14:00', endTime: '14:45' },
  { number: 6,  startTime: '14:50', endTime: '15:35' },
  { number: 7,  startTime: '15:55', endTime: '16:40' },
  { number: 8,  startTime: '16:45', endTime: '17:30' },
  { number: 9,  startTime: '19:00', endTime: '19:45' },
  { number: 10, startTime: '19:50', endTime: '20:35' },
  { number: 11, startTime: '20:40', endTime: '21:25' },
  { number: 12, startTime: '21:30', endTime: '22:15' },
];

// ═══════════════════════════════════════════════════════════
//  学期工具
// ═══════════════════════════════════════════════════════════

/** 正模运算（JS 的 % 对负数返回负值） */
function mod(n, m) { return ((n % m) + m) % m; }

/**
 * 学期 ID → 中文名
 * 483 → 2025-2026 第一学期, 503 → 2025-2026 第二学期, 523 → 2026-2027 第一学期 ...
 */
function semesterLabel(id) {
  const n = parseInt(id) - UESTC_CONFIG.semesterBase;
  const y = UESTC_CONFIG.yearBase + Math.floor(n / (UESTC_CONFIG.semesterStep * 2));
  const first = mod(n, UESTC_CONFIG.semesterStep * 2) < UESTC_CONFIG.semesterStep;
  return first ? `${y}-${y + 1} 第一学期` : `${y}-${y + 1} 第二学期`;
}

/** 生成可选学期列表（当前 ± 4 学期） */
function buildSemesterOptions() {
  const now = new Date();
  const m = now.getMonth() + 1;
  let curYear = now.getFullYear();
  if (m >= 2) curYear -= 1; // 春季学期，学年是去年-今年

  const offset = (curYear - UESTC_CONFIG.yearBase) * UESTC_CONFIG.semesterStep * 2;
  const currentId = UESTC_CONFIG.semesterBase + offset;

  const list = [];
  for (let i = -4; i <= 2; i++) {
    const id = currentId + i * UESTC_CONFIG.semesterStep;
    if (id >= UESTC_CONFIG.semesterBase - 80) {
      list.push({ id: String(id), label: semesterLabel(id) });
    }
  }
  return list;
}

// ═══════════════════════════════════════════════════════════
//  周次转换
// ═══════════════════════════════════════════════════════════

/**
 * 将 53 位二进制周数字符串转为周数数组
 * '111111111111111111100000...' → [1, 2, 3, ..., 19]
 */
function binaryWeeksToArray(binStr) {
  if (!binStr || typeof binStr !== 'string') return [];
  const weeks = [];
  const len = Math.min(binStr.length, 54);
  // EAMS 二进制串: position i = week i（position 0 始终是 0，忽略）
  for (let i = 0; i < len; i++) {
    if (binStr[i] === '1') weeks.push(i);
  }
  return weeks.filter(w => w > 0);
}

/**
 * 将中文周数描述转为周数数组（安全降级用）
 * '1-16周' → [1..16], '单1-17' → [1,3,5,...,17], '连1-16,单9-17' → 合并
 */
function parseChineseWeeks(str) {
  if (!str) return [];
  const weeksSet = new Set();

  const segments = str.split(/[,，]/);
  for (const seg of segments) {
    const trimmed = seg.trim();

    // 连续周: "连1-16"、"1-16"、"1-16周"
    let m = trimmed.match(/(?:连)?(\d+)\s*-\s*(\d+)/);
    if (m) {
      const start = parseInt(m[1]), end = parseInt(m[2]);
      for (let w = start; w <= end; w++) weeksSet.add(w);
      continue;
    }

    // 单周: "单1-17"、"单3"
    m = trimmed.match(/单(\d+)(?:\s*-\s*(\d+))?/);
    if (m) {
      const start = parseInt(m[1]);
      const end = m[2] ? parseInt(m[2]) : start;
      for (let w = start; w <= end; w += 2) weeksSet.add(w);
      continue;
    }

    // 双周: "双2-16"、"双4"
    m = trimmed.match(/双(\d+)(?:\s*-\s*(\d+))?/);
    if (m) {
      const start = parseInt(m[1]);
      const end = m[2] ? parseInt(m[2]) : start;
      for (let w = start; w <= end; w += 2) weeksSet.add(w);
      continue;
    }

    // 显式逗号列表: "1,3,5,7"
    const nums = trimmed.match(/\d+/g);
    if (nums) {
      for (const n of nums) weeksSet.add(parseInt(n));
    }
  }

  return [...weeksSet].sort((a, b) => a - b);
}

/** 通用周数解析：尝试二进制 → 中文 → 空 */
function parseWeeks(raw) {
  if (!raw) return [];
  if (/^[01]{20,54}$/.test(raw)) return binaryWeeksToArray(raw);
  const parsed = parseChineseWeeks(raw);
  return parsed.length > 0 ? parsed : [];
}

// ═══════════════════════════════════════════════════════════
//  TaskActivity 解析
// ═══════════════════════════════════════════════════════════

/**
 * 从 EAMS 课表页面的 HTML 响应中解析 TaskActivity
 *
 * HTML 中包含如下格式的 JavaScript:
 *   activity = new TaskActivity("", "teacherName", "", "courseName", "", "room", "validWeeks", ...)
 *   index = day * unitCount + period
 */
function parseTaskActivities(html) {
  let unitCount = 12;
  const unitMatch = html.match(/var\s+unitCount\s*=\s*(\d+)/);
  if (unitMatch) unitCount = parseInt(unitMatch[1]);

  const activities = [];
  // 一次性从 HTML 中提取所有 activity 声明和 index 赋值
  // 格式: activity = new TaskActivity(...); index = D*unitCount+P; ...; index = D*unitCount+P;
  // 活动和索引可能在同一行，也可能跨行

  // 1. 提取所有 activity = new TaskActivity(...) 及其参数
  const actRegex = /new TaskActivity\(/g;
  let match;
  const actEntries = []; // { actStart, actEnd, line, content }

  while ((match = actRegex.exec(html)) !== null) {
    const contentStart = match.index + 'new TaskActivity('.length;
    let depth = 0;
    let i = contentStart;
    for (; i < html.length; i++) {
      if (html[i] === '(') depth++;
      else if (html[i] === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
    const content = html.substring(contentStart, i);
    const args = splitArgs(content);
    if (args.length >= 7) {
      actEntries.push({
        teacherName: cleanStr(args[1]),
        courseName: cleanStr(args[3]),
        roomName: cleanStr(args[5]),
        validWeeks: cleanStr(args[6]),
        declEnd: i + 1, // 这个 activity 声明结束位置
      });
    }
  }

  // 2. 提取所有 index = D*unitCount+P 及位置
  const idxRegex = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g;
  const idxEntries = []; // { pos, day, period }
  while ((match = idxRegex.exec(html)) !== null) {
    idxEntries.push({
      pos: match.index,
      day: parseInt(match[1]) + 1,
      period: parseInt(match[2]) + 1,
    });
  }

  // 3. 匹配：每个 index 归属于它前面最近的那个 activity 声明
  for (const idx of idxEntries) {
    // 找 pos 之前最近的 activity 声明
    let bestAct = null;
    for (const act of actEntries) {
      if (act.declEnd <= idx.pos) {
        bestAct = act;
      } else break;
    }
    if (bestAct) {
      activities.push({ ...bestAct, day: idx.day, period: idx.period });
    }
  }

  // 移除多余的 declEnd 等字段
  for (const a of activities) { delete a.declEnd; }

  return { activities, unitCount };
}

function splitArgs(raw) {
  const args = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') { inQuote = !inQuote; current += ch; }
    else if (ch === ',' && !inQuote) { args.push(current); current = ''; }
    else { current += ch; }
  }
  if (current) args.push(current);
  return args;
}

function cleanStr(s) {
  if (!s) return '';
  return s.replace(/^["'\s]+|["'\s]+$/g, '');
}

// ═══════════════════════════════════════════════════════════
//  课程分组与转换
// ═══════════════════════════════════════════════════════════

/** 去掉课程名末尾的课程编码，如 "大学物理Ⅱ(D1200440.18)" → "大学物理Ⅱ" */
function cleanCourseName(name) {
  return name.replace(/\s*\([A-Z]{1,3}\d+\.[\w.]+\)\s*$/, '');
}

/**
 * 将解析出的活动条目合并为课程列表
 * 同一天 + 同课程名 + 同教师的连续节次合并为一条课程
 * "停课" 条目：其周次从正常条目中扣除，本身不作为独立课程输出
 */
function mergeToCourses(activities) {
  // 第1步：按 (天, 课程名, 教师) 分组（跨房间）
  const groups = {};
  for (const act of activities) {
    const key = `${act.day}|${act.courseName}|${act.teacherName}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(act);
  }

  const allCourses = [];
  for (const key of Object.keys(groups)) {
    const acts = groups[key];
    const normals = acts.filter(a => a.roomName !== '停课');
    if (normals.length === 0) continue;

    // 第2步：按 (period, room) 聚合，每个组合得到独立周次集合
    // cellWeeks: "period|room" → Set<week>
    const cellWeeks = {};
    for (const act of normals) {
      const p = act.period;
      const room = act.roomName || '';
      const cellKey = `${p}|${room}`;
      if (!cellWeeks[cellKey]) cellWeeks[cellKey] = new Set();
      for (const w of parseWeeks(act.validWeeks)) cellWeeks[cellKey].add(w);
    }

    // 第3步：按房间分组，每个房间内找连续节次区间，合并周次
    const rooms = [...new Set(normals.map(a => a.roomName || ''))];
    const roomEntries = [];

    for (const room of rooms) {
      // 收集该房间所有 period 的周次
      const roomPeriods = {};
      for (const [cellKey, weeks] of Object.entries(cellWeeks)) {
        const [p, r] = cellKey.split('|');
        if (r === room) roomPeriods[Number(p)] = new Set([...weeks]);
      }

      const periods = Object.keys(roomPeriods).map(Number).sort((a, b) => a - b);
      if (periods.length === 0) continue;

      // 找连续区间（但相邻 period 周次差异过大时断开）
      let i = 0;
      while (i < periods.length) {
        let j = i;
        while (j + 1 < periods.length && periods[j + 1] === periods[j] + 1) {
          // 如果下一个 period 的周次与本区间已有周次交集 < 30%，则断开
          const curWeeks = new Set();
          for (let k = i; k <= j; k++) {
            for (const w of roomPeriods[periods[k]]) curWeeks.add(w);
          }
          const nextWeeks = roomPeriods[periods[j + 1]];
          const intersect = [...curWeeks].filter(w => nextWeeks.has(w)).length;
          const union = new Set([...curWeeks, ...nextWeeks]).size;
          const overlapRatio = union > 0 ? intersect / union : 0;
          if (overlapRatio < 0.3) break;
          j++;
        }

        const mergedWeeks = new Set();
        for (let k = i; k <= j; k++) {
          for (const w of roomPeriods[periods[k]]) mergedWeeks.add(w);
        }

        roomEntries.push({
          room, startSection: periods[i], endSection: periods[j], weeks: mergedWeeks,
        });

        i = j + 1;
      }
    }

    for (const entry of roomEntries) {
      const weeks = [...entry.weeks].sort((a, b) => a - b);
      allCourses.push({
        name: cleanCourseName(normals[0].courseName),
        teacher: normals[0].teacherName,
        position: entry.room,
        day: normals[0].day,
        startSection: entry.startSection,
        endSection: entry.endSection,
        weeks: weeks,
      });
    }
  }

  return allCourses;
}

// ═══════════════════════════════════════════════════════════
//  课表数据获取
// ═══════════════════════════════════════════════════════════

function extractIds() {
  for (const el of document.querySelectorAll('form input[name="ids"]')) {
    if (el.value) return el.value;
  }
  for (const el of document.querySelectorAll('form input[name="params"]')) {
    const m = el.value.match(/[?&]ids=(\d+)/);
    if (m) return m[1];
  }
  return null;
}

async function fetchCourseHtml(semesterId) {
  const ids = extractIds();
  const baseParams = {
    'ignoreHead': '1',
    'setting.kind': 'std',
    'startWeek': '',
    'project.id': '1',
    'isEng': '0',
    'semester.id': semesterId,
  };

  // 尝试 1: 有 ids
  if (ids) {
    const html = await doFetch({ ...baseParams, ids });
    if (html && isValidResponse(html)) return html;
  }

  // 尝试 2: 无 ids
  const html2 = await doFetch(baseParams);
  if (html2 && isValidResponse(html2)) return html2;

  throw new Error('无法获取课表数据，请确认已登录 eams.uestc.edu.cn');
}

async function doFetch(params) {
  const body = Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  try {
    const resp = await fetch('/eams/courseTableForStd!courseTable.action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body,
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch (e) {
    console.warn('Fetch 失败:', e.message);
    return null;
  }
}

function isValidResponse(html) {
  return html && html.length > 100 && html.includes('TaskActivity');
}

// ═══════════════════════════════════════════════════════════
//  主流程
// ═══════════════════════════════════════════════════════════

async function runImportFlow() {
  console.log('📚 电子科技大学 EAMS 教务导入开始');

  try {
    // ── Step 1: 欢迎提示 ──
    const ready = await window.shiguangBridgePromise.showAlert(
      '电子科技大学 - 教务导入',
      '请确保已在 eams.uestc.edu.cn 完成登录。\n\n建议先在教务中打开「个人课表」页面，\n然后返回本应用执行导入。',
      '已登录，开始导入'
    );
    if (!ready) { console.log('❌ 用户取消'); return; }

    // ── Step 2: 选择学期 ──
    const options = buildSemesterOptions();
    const labels = options.map(o => o.label);
    const defaultIdx = Math.min(4, labels.length - 1);

    const selectedIdx = await window.shiguangBridgePromise.showSingleSelection(
      '选择学期',
      JSON.stringify(labels),
      defaultIdx
    );
    if (selectedIdx === null || selectedIdx === -1) { console.log('❌ 取消学期选择'); return; }

    const semesterId = options[selectedIdx].id;
    console.log(`📅 学期: ${options[selectedIdx].label} (id=${semesterId})`);

    // ── Step 3: 获取课表数据 ──
    window.shiguangBridge.showToast('正在获取课表数据...');
    const html = await fetchCourseHtml(semesterId);

    // ── Step 4: 解析 ──
    console.log(`📄 响应长度: ${html.length}`);
    const { activities } = parseTaskActivities(html);
    console.log(`📊 活动记录: ${activities.length} 条`);

    if (activities.length === 0) {
      window.shiguangBridge.showToast('未找到课程数据');
      await window.shiguangBridgePromise.showAlert('导入结果', '未在当前学期找到课程数据。', '知道了');
      return;
    }

    const courses = mergeToCourses(activities);
    console.log(`📋 课程: ${courses.length} 门`);

    // ── Step 5: 保存 ──
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    console.log('✅ 课程已保存');

    try {
      await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(DEFAULT_TIME_SLOTS));
      console.log('✅ 时间段已保存');
    } catch (e) { console.warn('⚠️ 时间段保存失败:', e.message); }

    try {
      await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterTotalWeeks: UESTC_CONFIG.defaultTotalWeeks,
      }));
      console.log('✅ 配置已保存');
    } catch (e) { console.warn('⚠️ 配置保存失败:', e.message); }

    // ── Step 6: 完成 ──
    window.shiguangBridge.showToast(`导入成功！共 ${courses.length} 门课程`);
    await window.shiguangBridgePromise.showAlert(
      '✅ 导入完成',
      `成功导入 ${courses.length} 门课程。\n学期: ${options[selectedIdx].label}\n请返回课表查看。`,
      '好的'
    );
    window.shiguangBridge.notifyTaskCompletion();

  } catch (error) {
    console.error('❌ 导入失败:', error);
    window.shiguangBridge.showToast('导入失败: ' + error.message);
    try {
      await window.shiguangBridgePromise.showAlert(
        '❌ 导入失败',
        '错误: ' + error.message + '\n\n请检查:\n1. 已登录 eams.uestc.edu.cn\n2. 网络正常\n3. 可先打开个人课表页面',
        '知道了'
      );
    } catch (_) {}
  }
}

// 暴露到全局（兼容 Tester 和 APP）
window.runImportFlow = runImportFlow;
// 自动启动
runImportFlow();

})();
