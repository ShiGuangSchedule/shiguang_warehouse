// 南昌科技职业大学教务系统适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

function parseWeeks(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).reduce((acc, part) => {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) acc.push(i);
    } else {
      const n = Number(part);
      if (!isNaN(n)) acc.push(n);
    }
    return acc;
  }, []).sort((a, b) => a - b);
}

/**
 * 节次与周次合并去重函数
 */
function mergeAndDistinctCourses(courses) {
  if (!Array.isArray(courses) || courses.length <= 1) return courses;

  // 1. 深拷贝并规范周次数据
  const list = courses.map(c => ({
    ...c,
    name: c.name || '',
    teacher: c.teacher || '',
    position: c.position || '',
    weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
  }));

  // 阶段 1：合并连续节次与完全重复记录
  list.sort((a, b) => {
    return a.name.localeCompare(b.name) ||
      a.teacher.localeCompare(b.teacher) ||
      a.position.localeCompare(b.position) ||
      (a.day || 0) - (b.day || 0) ||
      a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
      (a.startSection || 0) - (b.startSection || 0);
  });

  const step1 = [];
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
      step1.push(current);
      current = next;
    }
  }
  step1.push(current);

  // 阶段 2：合并同节次的周次
  step1.sort((a, b) => {
    return a.name.localeCompare(b.name) ||
      a.teacher.localeCompare(b.teacher) ||
      a.position.localeCompare(b.position) ||
      (a.day || 0) - (b.day || 0) ||
      (a.startSection || 0) - (b.startSection || 0) ||
      (a.endSection || 0) - (b.endSection || 0);
  });

  const step2 = [];
  let cur = step1[0];

  for (let i = 1; i < step1.length; i++) {
    const nxt = step1[i];

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
      step2.push(cur);
      cur = nxt;
    }
  }
  step2.push(cur);

  return step2;
}

async function runImportFlow() {
  window.shiguangBridge.showToast("课程导入流程即将开始...");

  const baseUrl = window.location.origin;
  let semester = '2026-2027-1';
  let semesterStartDate = '2026-09-01';

  // 获取学期信息
  try {
    const semesterRes = await fetch(baseUrl + '/api/baseInfo/semester/selectCurrentXnXq?_t=' + Date.now(), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const semesterJson = await semesterRes.json();
    if (semesterJson.code === 200 && semesterJson.data) {
      semester = semesterJson.data.semester || semester;
      if (semesterJson.data.ksrq) {
        semesterStartDate = semesterJson.data.ksrq.split(' ')[0];
      }
    }
  } catch (e) {
    console.error("获取学期信息失败:", e);
    window.shiguangBridge.showToast("获取学期信息失败，将使用默认值");
  }

  // 获取所有周次
  let weeks = [];
  try {
    const qwRes = await fetch(baseUrl + '/api/arrange/teacherServer/queryWeek?schoolYear=' + encodeURIComponent(semester) + '&_t=' + Date.now());
    const qwJson = await qwRes.json();
    weeks = qwJson.code === 200 && Array.isArray(qwJson.data) ? qwJson.data : [];
  } catch (e) {
    console.error("获取周次信息失败:", e);
    window.shiguangBridge.showToast("获取周次信息失败");
    return;
  }

  if (weeks.length === 0) {
    window.shiguangBridge.showToast("未获取到周次信息");
    return;
  }

  // 逐周获取课程数据
  const allData = [];
  for (const w of weeks) {
    try {
      const res = await fetch(baseUrl + '/api/arrange/CourseScheduleAllQuery/studentCourseSchedule?_t=' + Date.now(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': baseUrl,
          'Referer': baseUrl + '/'
        },
        body: JSON.stringify({ studentId: '', oddOrDouble: 1, source: 'xs', semester, weeks: [w], queryType: 'single' })
      });
      const json = await res.json();
      if (json.code === 200 && Array.isArray(json.data)) {
        allData.push(...json.data);
      }
    } catch (e) {
      console.error("获取第" + w + "周课程数据失败:", e);
    }
  }

  // 解析课程和时间段
  const courses = [];
  const timeSlotsMap = new Map();

  for (const slot of allData) {
    if (!slot.time || !slot.time.timeCode || !slot.week || slot.week.weekCode == null) {
      continue;
    }

    const timeCode = slot.time.timeCode;
    const parts = timeCode.split('_');
    const startSection = Number(parts[0]);
    const endSection = Number(parts[1]);
    const day = slot.week.weekCode == 1 ? 7 : slot.week.weekCode - 1;

    if (!timeSlotsMap.has(timeCode)) {
      timeSlotsMap.set(timeCode, { number: startSection, startTime: slot.time.startTime, endTime: slot.time.endTime });
    }

    if (Array.isArray(slot.courseList)) {
      for (const c of slot.courseList) {
        if (c.courseName) {
          courses.push({
            name: c.courseName,
            teacher: c.teacherName || '',
            position: c.classroomName || '',
            day,
            startSection,
            endSection,
            weeks: parseWeeks(c.weeks),
            isCustomTime: false
          });
        }
      }
    }
  }

  const merged = mergeAndDistinctCourses(courses);
  const timeSlots = Array.from(timeSlotsMap.values()).sort((a, b) => a.number - b.number);

  if (merged.length === 0) {
    window.shiguangBridge.showToast("未解析到有效课程数据");
    return;
  }

  // 保存课程数据
  try {
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(merged));
    window.shiguangBridge.showToast("成功导入 " + merged.length + " 门课程");
  } catch (e) {
    console.error("保存课程失败:", e);
    window.shiguangBridge.showToast("保存课程失败: " + e.message);
    return;
  }

  // 保存预设时间段
  if (timeSlots.length > 0) {
    try {
      await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
      window.shiguangBridge.showToast("预设时间段导入成功");
    } catch (e) {
      console.error("保存时间段失败:", e);
      window.shiguangBridge.showToast("保存时间段失败: " + e.message);
    }
  }

  // 保存课表配置
  try {
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
      semesterStartDate,
      semesterTotalWeeks: weeks.length || 20,
      firstDayOfWeek: 1
    }));
  } catch (e) {
    console.error("保存配置失败:", e);
  }

  window.shiguangBridge.showToast("所有任务已完成！");
  window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();
