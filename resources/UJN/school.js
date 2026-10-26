/**
 * 济南大学教务适配
 * @since 2026-3-13
 * @description 支持班级课表和个人课表的导入
 * @author Moyu
 * @version 1.0
 */
class CourseModel {
  name = ""; // 课程名称 (String)
  teacher = ""; // 教师姓名 (String)
  position = ""; // 上课地点 (String)
  day = 0; //星期几 (Int, 1=周一, 7=周日)
  startSection = 0; // 开始节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
  endSection = 0; // 结束节次 (Int, 如果 isCustomTime 为 false 或未提供，则必填)
  weeks = [0]; // 上课周数 (Int Array, 必须是数字数组，例如 [1, 3, 5, 7])
  isCustomTime = false; // 是否使用自定义时间 (Boolean, 可选，默认为 false。如果为 true，则 customStartTime 和 customEndTime 必填；如果为 false 或未提供，则 startSection 和 endSection 必填)
  customStartTime = ""; // 自定义开始时间 (String, 格式 HH:mm, 如果 isCustomTime 为 true 则必填)
  customEndTime = ""; // 自定义结束时间 (String, 格式 HH:mm, 如果 isCustomTime 为 true 则必填)
  constructor(
    name, // 课程名称 (String)
    teacher, // 教师姓名 (String)
    position, // 上课地点 (String)
    day, // 星期几 (Int, 1=周一,7=周日)
    startSection, // 开始节次 (Int)
    endSection, // 结束节次 (Int)
    weeks = [], // 上课周数 (Int Array)
    isCustomTime = false, // 是否自定义时间 (Boolean，默认false)
    customStartTime = "", // 自定义开始时间 (可选)
    customEndTime = "", // 自定义结束时间 (可选)
  ) {
    // 1. 基础字段赋值（必选参数）
    this.name = name;
    this.teacher = teacher;
    this.position = position;
    this.day = day;
    this.startSection = startSection;
    this.endSection = endSection;
    this.weeks = weeks;
    this.isCustomTime = isCustomTime;
    this.customStartTime = customStartTime;
    this.customEndTime = customEndTime;
  }
}
class CustomTimeModel {
  number = 0;
  startTime = ""; // 开始时间 (String, 格式 HH:mm)
  endTime = ""; // 结束时间 (String, 格式 HH:mm)
  constructor(num, start, end) {
    this.number = num;
    this.startTime = start;
    this.endTime = end;
  }
}

const urlPersonnalClassTable =
  "jwgl.ujn.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html";
const urlClassTable = "jwgl.ujn.edu.cn/jwglxt/kbdy/bjkbdy_cxBjkbdyIndex.html";

//解析周数据
function parseWeekText(text) {
  if (!text) return [];
  text = text.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "").trim();

  const allWeeks = new Set();
  const noJie = text.replace(/\(\d+-\d+节\)/g, " ");

  const rangePattern = /(\d+)-(\d+)周(?:\((单|双)\))?/g;
  const singlePattern = /(\d+)周(?:\((单|双)\))?/g;

  let match;
  while ((match = rangePattern.exec(noJie)) !== null) {
    const [, start, end, type] = match;
    for (let w = parseInt(start, 10); w <= parseInt(end, 10); w++) {
      if (
        !type ||
        (type === "单" && w % 2 === 1) ||
        (type === "双" && w % 2 === 0)
      ) {
        allWeeks.add(w);
      }
    }
  }

  const processedRanges = [];
  rangePattern.lastIndex = 0;
  while ((match = rangePattern.exec(noJie)) !== null) {
    processedRanges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  singlePattern.lastIndex = 0;
  while ((match = singlePattern.exec(noJie)) !== null) {
    const weekNum = parseInt(match[1], 10);
    const type = match[2];

    // 检查这个匹配是否已经被范围正则匹配过了（简单判断：如果包含"-"就跳过）
    const matchStr = match[0];
    if (matchStr.includes("-")) continue;

    if (
      !type ||
      (type === "单" && weekNum % 2 === 1) ||
      (type === "双" && weekNum % 2 === 0)
    ) {
      allWeeks.add(weekNum);
    }
  }

  return [...allWeeks].sort((a, b) => a - b);
}
function offsetColByRow(row) {
  row = row - 2;
  if (row % 4 == 0) {
    return 0;
  }
  if (row % 4 == 2) {
    return 1;
  }
}
function analyzeCourseModel(item, flag) {
  let td = item.closest("td");
  let elements = item.querySelectorAll("p");
  if (!td) {
    console.error("找不到单元格");
    return null;
  }
  let tr = td.parentElement;
  let site = {
    row: tr.rowIndex, //第几行
    rowSpan: td.rowSpan || 1, //跨几行
    col: td.cellIndex, //第几列
    colSpan: td.colSpan || 1, //跨几列
    cell: td, //本身
  };
  let currentItem = item.querySelector(".title");
  let name = currentItem.textContent;
  let teacher;
  let position;
  let weeks;
  if (flag == 1) {
    teacher = elements[2].lastElementChild.innerText;
    position = elements[1].lastElementChild.innerText;
    weeks = parseWeekText(elements[0].lastElementChild.innerText);
  } else {
    if (elements.length != 1) {
      teacher =
        elements[4].firstElementChild.nextSibling.textContent.split("(")[0];
      position = elements[3].firstElementChild.nextSibling.textContent;
      weeks = parseWeekText(
        elements[2].firstElementChild.nextSibling.textContent,
      );
    } else {
      teacher = "";
      position = "";
      weeks = parseWeekText("1-20周");
    }
  }
  return new CourseModel(
    name.replace(/[■☆★◆]/g, ""),
    teacher.trim(),
    position.trim(),
    site.col - 1 + offsetColByRow(site.row),
    site.row - 1,
    site.row + site.rowSpan - 2,
    [...weeks],
  );
}

async function saveCourses() {
  let flag = null;
  let elements = [];
  if (window.location.href.includes(urlPersonnalClassTable)) {
    elements = document.querySelectorAll(
      "#innerContainer #table1 div.timetable_con",
    );
    flag = 1;
  } else {
    if (window.location.href.includes(urlClassTable)) {
      elements = document.querySelectorAll(
        "#table1.tab-pane>.timetable1 div.timetable_con",
      );
      flag = 0;
    }
  }
  let courseModels = [];
  elements.forEach((item) => {
    let course = analyzeCourseModel(item, flag);
    if (course) {
      courseModels.push({ ...course });
    }
  });

  try {
    await window.shiguangBridgePromise.saveImportedCourses(
      JSON.stringify(courseModels),
    );
    return courseModels.length;
  } catch (error) {
    console.error("保存课程失败:", error);
    window.shiguangBridge.showToast("保存课程失败，请重试");
    return 0;
  }
}
async function checkEnvirenment() {
  const nowSite = window.location.href;

  const tableType = ["班级课表", "个人课表"];
  if (
    !nowSite.includes(urlPersonnalClassTable) &&
    !nowSite.includes(urlClassTable)
  ) {
    window.shiguangBridge.showToast("当前页面不在支持的导入范围内");
    const selectedOption =
      await window.shiguangBridgePromise.showSingleSelection(
        "现在不在可导入的页面中，请选择导入班级课表还是个人课表，之后并确保打开具体课程页面",
        JSON.stringify(tableType), // 必须是 JSON 字符串
        -1, // 默认不选中
      );
    if (selectedOption === 0) {
      clickMenu(
        "N214505",
        "/kbdy/bjkbdy_cxBjkbdyIndex.html",
        "班级课表查询",
        "null",
      );
      return false;
    } else if (selectedOption === 1) {
      clickMenu(
        "N253508",
        "/kbcx/xskbcx_cxXskbcxIndex.html",
        "个人课表",
        "null",
      );
      return false;
    } else {
      return false;
    }
  }

  return true;
}

async function runImportFlow() {
  window.shiguangBridge.showToast("课程导入流程即将开始...");

  if (!(await checkEnvirenment())) return;

  const savedCourseCount = await saveCourses();
  if (!savedCourseCount) {
    return;
  }
  const slots = [
    new CustomTimeModel(1, "08:00", "08:50"),
    new CustomTimeModel(2, "08:55", "09:45"),
    new CustomTimeModel(3, "10:15", "11:05"),
    new CustomTimeModel(4, "11:10", "12:00"),
    new CustomTimeModel(5, "14:00", "14:50"),
    new CustomTimeModel(6, "14:55", "15:45"),
    new CustomTimeModel(7, "16:15", "17:05"),
    new CustomTimeModel(8, "17:10", "18:00"),
    new CustomTimeModel(9, "19:00", "19:50"),
    new CustomTimeModel(10, "19:55", "20:45"),
    new CustomTimeModel(11, "20:50", "21:45"),
  ];
  try {
    await window.shiguangBridgePromise.savePresetTimeSlots(
      JSON.stringify(slots),
    );
  } catch (error) {
    console.error("保存时间段失败:", error);
    window.shiguangBridge.showToast("保存时间段失败，请重试");
    return;
  }
  // 8. 流程**完全成功**，发送结束信号。
  window.shiguangBridge.showToast(`导入成功：共 ${savedCourseCount} 门课程`);
  window.shiguangBridge.notifyTaskCompletion();
}

// 启动导入流程
runImportFlow();
