// 仲恺农业工程学院拾光课程表适配脚本
// https://edu-admin.zhku.edu.cn/
// 教务平台：强智教务
// 适配开发者：lc6464

const PRESET_TIME_CONFIG = {
	campuses: {
		haizhu: {
			startTimes: {
				morning: "08:00",
				noon: "11:30",
				afternoon: "14:30",
				evening: "19:30"
			}
		},
		baiyun: {
			startTimes: {
				morning: "08:40",
				noon: "12:20",
				afternoon: "13:30",
				evening: "19:00"
			}
		}
	},
	common: {
		sectionCounts: {
			morning: 4,
			noon: 1,
			afternoon: 4,
			evening: 3
		},
		durations: {
			classMinutes: 40,
			shortBreakMinutes: 10,
			longBreakMinutes: 20
		},
		longBreakAfter: {
			morning: 2,
			noon: 0,    // 午间课程无大课间
			afternoon: 2,
			evening: 0  // 晚间课程无大课间
		}
	}
};

const CAMPUS_OPTIONS = [
	{ id: "haizhu", label: "海珠校区" },
	{ id: "baiyun", label: "白云校区" }
];

// 统一做文本清洗，避免 DOM 中换行与多空格干扰匹配
function cleanText(value) {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

// HH:mm -> 当天分钟数
function parseTimeToMinutes(hhmm) {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

// 当天分钟数 -> HH:mm
function formatMinutesToTime(totalMinutes) {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 将“2026年03月09”这类中文日期转换为“2026-03-09”
function normalizeCnDateToIso(cnDateText) {
	const match = (cnDateText ?? "").match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
	if (match == null) {
		throw new Error(`无法解析日期：${cnDateText}`);
	}

	// 这里使用 Number 而不是 parseInt
	// 输入来自正则捕获组，已是纯数字，不需要 parseInt 的截断语义
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);

	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 通过首页时间模式标签识别校区
// 规则：name="kbjcmsid" 的 li 中，带 layui-this 的若是第一个则海珠，第二个则白云
async function detectCampusFromMainPage() {
	const url = "https://edu-admin.zhku.edu.cn/jsxsd/framework/xsMain_new.htmlx";
	const response = await fetch(url, {
		method: "GET",
		credentials: "include"
	});

	if (!response.ok) {
		throw new Error(`获取首页时间模式失败：HTTP ${response.status}`);
	}

	const html = await response.text();
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const nodes = Array.from(doc.querySelectorAll('li[name="kbjcmsid"]'));

	if (nodes.length < 2) {
		return null;
	}

	const activeIndex = nodes.findIndex((node) => {
		return node.classList.contains("layui-this");
	});

	if (activeIndex === 0) {
		return "haizhu";
	}

	if (activeIndex === 1) {
		return "baiyun";
	}

	// 兜底：若索引异常，按文本再次判断
	const activeNode = activeIndex >= 0 ? nodes[activeIndex] : null;
	const activeText = cleanText(activeNode?.textContent ?? "");
	if (activeText.includes("白云")) {
		return "baiyun";
	}
	if (activeText.includes("默认")) {
		return "haizhu";
	}

	return null;
}

// 获取最终校区
// 先尝试自动识别，识别失败再让用户选择
async function chooseCampus() {
	// 按 xsMain_new.htmlx 的时间模式标签判断
	try {
		const campusFromMain = await detectCampusFromMainPage();
		if (campusFromMain != null) {
			console.log("通过首页时间模式识别到校区：", campusFromMain);
			return campusFromMain;
		}
	} catch (error) {
		console.warn("通过首页时间模式识别校区失败，将回退到页面文本识别：", error);
	}

	const labels = CAMPUS_OPTIONS.map((item) => item.label);

	let selectedIndex = null;
	do {
		selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
			"校区检测失败，请选择校区",
			JSON.stringify(labels),
			-1
		);
	} while (selectedIndex == null || selectedIndex < 0 || selectedIndex >= CAMPUS_OPTIONS.length);

	return CAMPUS_OPTIONS[selectedIndex].id;
}

// 按规则动态生成节次时间
// 这样后续学校调整作息时，只需要改 PRESET_TIME_CONFIG
function buildPresetTimeSlots(campusId) {
	const campus = PRESET_TIME_CONFIG.campuses[campusId] ?? PRESET_TIME_CONFIG.campuses.baiyun;
	const common = PRESET_TIME_CONFIG.common;

	const segments = ["morning", "noon", "afternoon", "evening"];
	const slots = [];
	let sectionNumber = 1;

	for (const segment of segments) {
		// 每个时段从配置中的起始时间开始滚动推导
		let cursor = parseTimeToMinutes(campus.startTimes[segment]);
		const count = common.sectionCounts[segment];
		const longBreakAfter = common.longBreakAfter[segment] ?? 0;

		for (let i = 1; i <= count; i += 1) {
			const start = cursor;
			const end = start + common.durations.classMinutes;

			slots.push({
				number: sectionNumber,
				startTime: formatMinutesToTime(start),
				endTime: formatMinutesToTime(end)
			});
			sectionNumber += 1;

			cursor = end;
			if (i < count) {
				// 当 longBreakAfter 为 0 时，该时段不会触发大课间
				const longBreakApplies = longBreakAfter > 0 && i === longBreakAfter;
				cursor += longBreakApplies
					? common.durations.longBreakMinutes
					: common.durations.shortBreakMinutes;
			}
		}
	}

	return slots;
}

// 解析周次与节次
// 示例："3-4,6-8(周)[01-02节]"、"1-16(单周)[03-04节]"
function parseWeeksAndSections(rawText) {
	const text = cleanText(rawText);
	const match = text.match(/^(.*?)\(([^)]*周)\)\[(.*?)节\]$/);
	if (match == null) {
		throw new Error(`无法解析课程时间：${text}`);
	}

	const weeksPart = match[1];
	const weekFlag = match[2];
	const sectionsPart = match[3];

	// 先把周次范围展开成完整数组
	const weeks = [];
	const weekRanges = weeksPart.match(/\d+(?:-\d+)?/g) ?? [];
	for (const rangeText of weekRanges) {
		if (rangeText.includes("-")) {
			const [start, end] = rangeText.split("-").map(Number);
			for (let w = start; w <= end; w += 1) {
				weeks.push(w);
			}
		} else {
			weeks.push(Number(rangeText));
		}
	}

	// 去重并排序后，再根据单双周标记过滤
	let normalizedWeeks = [...new Set(weeks)].sort((a, b) => a - b);
	if (weekFlag.includes("单")) {
		normalizedWeeks = normalizedWeeks.filter((w) => w % 2 === 1);
	}
	if (weekFlag.includes("双")) {
		normalizedWeeks = normalizedWeeks.filter((w) => w % 2 === 0);
	}

	const sections = (sectionsPart.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
	if (sections.length === 0) {
		throw new Error(`无法解析节次：${text}`);
	}

	return {
		weeks: normalizedWeeks,
		startSection: sections[0],
		endSection: sections[sections.length - 1]
	};
}

// 从当前位置向前查找满足条件的 font 节点
function findPreviousFont(fonts, startIndex, predicate) {
	for (let i = startIndex - 1; i >= 0; i -= 1) {
		if (predicate(fonts[i])) {
			return fonts[i];
		}
	}
	return null;
}

// 从当前位置向后查找满足条件的 font 节点
function findNextFont(fonts, startIndex, predicate) {
	for (let i = startIndex + 1; i < fonts.length; i += 1) {
		if (predicate(fonts[i])) {
			return fonts[i];
		}
	}
	return null;
}

// 从课表文档中解析课程
// 输出为扁平数组，不做同名课程合并
function parseCoursesFromIframeDocument(iframeDoc) {
	const courses = [];
	const cells = iframeDoc.querySelectorAll(".kbcontent[id$='2']");

	cells.forEach((cell) => {
		// id 形如 xxxxx-<day>-2，day 为 1~7
		const idParts = (cell.id ?? "").split("-");
		const day = Number(idParts[idParts.length - 2]);
		if (!Number.isInteger(day) || day < 1 || day > 7) {
			return;
		}

		// 同一个 cell 里可能存在多个课程，因此要逐个锚点拆解
		const fonts = Array.from(cell.querySelectorAll("font"));

		fonts.forEach((font, idx) => {
			const title = cleanText(font.getAttribute("title") ?? "");
			if (!title.includes("周次")) {
				return;
			}

			const weekText = cleanText(font.textContent);
			if (weekText === "") {
				return;
			}

			// 以“周次(节次)”行为锚点，向前找教师和课程名，向后找教室
			const teacherFont = findPreviousFont(fonts, idx, (candidate) => {
				const candidateTitle = cleanText(candidate.getAttribute("title") ?? "");
				return candidateTitle.includes("教师");
			});

			const teacherIndex = teacherFont == null ? idx : fonts.indexOf(teacherFont);
			const nameFont = findPreviousFont(fonts, teacherIndex, (candidate) => {
				const candidateTitle = cleanText(candidate.getAttribute("title") ?? "");
				const candidateNameAttr = cleanText(candidate.getAttribute("name") ?? "");
				const text = cleanText(candidate.textContent);
				return (
					candidateTitle === "" &&
					candidateNameAttr === "" &&
					text !== ""
				);
			});

			const locationFont = findNextFont(fonts, idx, (candidate) => {
				const candidateTitle = cleanText(candidate.getAttribute("title") ?? "");
				return candidateTitle.includes("教室");
			});

			const courseName = cleanText(nameFont?.textContent ?? "");
			const teacher = cleanText(teacherFont?.textContent ?? "");
			let position = cleanText(locationFont?.textContent ?? "");

			// 过滤空课程名、网络课和不存在的虚拟位置
			if (courseName === ""
				|| position.includes("网络学时，不排时间教室")
				|| position.includes("经典研读")
				|| /^（?网络课）?/.test(courseName)) {
				return;
			}

			// 移除教室中的“(白)”“（白云）”“(白)实”等字样，该信息对于学生而言无意义
			position = position.replace(/[(（]白云?[)）](?:实(?![A-Za-z]))?/g, "");

			// 移除教室末尾的“xxxx实验室”字样，这个信息对于学生而言无意义
			position = position.replace(/(?:(?<=\d|\d[A-Za-z])(?:[^A-Za-z\d)）]|(?<!\d)[A-Za-z])*实验室(?:[(（]?[\d一二三四五六七八九十甲乙丙丁]+[）)]?|（物理实验室）|（机房）)*)+$/, "");

			// 补全开头的“英东楼”
			position = position.replace(/^英\s*(\d{3,4})/, "英东楼$1");

			// 移除掉生科楼的“实”
			position = position.replace(/(?<=生科[AB])实/, "");

			const parsed = parseWeeksAndSections(weekText);

			// 查重
			const existingCourse = courses.find((c) => c.name === courseName
				&& c.teacher === teacher
				&& c.position === position
				&& c.day === day
				&& c.startSection === parsed.startSection
				&& c.endSection === parsed.endSection
				&& JSON.stringify(c.weeks) === JSON.stringify(parsed.weeks));

			if (existingCourse != null) {
				return;
			}

			courses.push({
				name: courseName,
				teacher,
				position,
				day,
				startSection: parsed.startSection,
				endSection: parsed.endSection,
				weeks: parsed.weeks
			});
		});
	});

	return courses;
}

// 获取课表 iframe 的文档对象
function getScheduleIframeDocument() {
	const iframe = document.querySelector("iframe[src*='/jsxsd/xskb/xskb_list.do']");
	if (iframe == null) {
		return null;
	}
	if (iframe.contentDocument == null) {
		throw new Error("课表 iframe 内容尚未加载完成");
	}
	return iframe.contentDocument;
}

// 获取列表中的全部以及当前选择的学年学期 ID
function getSemesterIds(iframeDoc) {
	const select = iframeDoc.querySelector("#xnxq01id");
	if (select == null) {
		throw new Error("未找到学年学期选择框 #xnxq01id，请确认已登录教务系统");
	}

	const options = Array.from(select.querySelectorAll("option"))
		.map((opt) => cleanText(opt.value))
		.filter((value) => value !== "");
	const selectedOption = cleanText(select.value);

	if (selectedOption === "") {
		throw new Error("未找到当前激活的学年学期，请确认已登录教务系统");
	}

	return { options, selectedOption };
}

// 拉取学期理论课表并解析为文档对象
// 未指定学年学期时，教务系统返回当前激活学期的课表
async function fetchScheduleDocument(semesterId = "") {
	const query = semesterId === "" ? "" : `?xnxq01id=${encodeURIComponent(semesterId)}`;
	const url = `https://edu-admin.zhku.edu.cn/jsxsd/xskb/xskb_list.do${query}`;
	const response = await fetch(url, {
		method: "GET",
		credentials: "include"
	});
	if (!response.ok) {
		throw new Error(`获取学期理论课表失败：HTTP ${response.status}`);
	}

	const html = await response.text();
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	return doc;
}

// 获取学年学期列表并让用户选择，默认选中当前激活学期
async function chooseScheduleDocument() {
	const cachedDoc = await fetchScheduleDocument();
	const { options, selectedOption } = getSemesterIds(cachedDoc);
	const selection = await window.shiguangBridgePromise.showSingleSelection(
		"选择导入的学年学期",
		JSON.stringify(options),
		options.indexOf(selectedOption)
	);
	if (selection == null) {
		throw new Error("已取消选择学年学期");
	}

	const selectedIndex = Number(selection);
	if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
		throw new Error("未选择有效的学年学期");
	}

	const semesterId = options[selectedIndex];

	// 激活学期直接复用首次获取的课表，其它学期再按 ID 拉取
	let scheduleDoc = semesterId === selectedOption
		? cachedDoc
		: await fetchScheduleDocument(semesterId);

	return { scheduleDoc, semesterId };
}

// 拉取教学周历并提取开学日期与总周数
async function fetchSemesterCalendarInfo(semesterId) {
	const url = `https://edu-admin.zhku.edu.cn/jsxsd/jxzl/jxzl_query?xnxq01id=${encodeURIComponent(semesterId)}`;
	const response = await fetch(url, {
		method: "GET",
		credentials: "include"
	});
	if (!response.ok) {
		throw new Error(`获取教学周历失败：HTTP ${response.status}`);
	}

	const html = await response.text();
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	const rows = Array.from(doc.querySelectorAll("#kbtable tr"));

	// 周次行特征：第一列是纯数字
	const weekRows = rows.filter((row) => {
		const firstCell = row.querySelector("td");
		return /^\d+$/.test(cleanText(firstCell?.textContent ?? ""));
	});
	if (weekRows.length === 0) {
		throw new Error("教学周历中未找到周次行");
	}

	// 学期起始日按“第一周周一”计算
	const firstWeekRow = weekRows[0];
	const mondayCell = firstWeekRow.querySelectorAll("td")[1];
	const mondayTitle = mondayCell?.getAttribute("title") ?? "";
	if (mondayTitle === "") {
		throw new Error("教学周历中未找到第一周周一日期");
	}

	return {
		semesterStartDate: normalizeCnDateToIso(mondayTitle),
		semesterTotalWeeks: weekRows.length
	};
}

// 单独区分未登录错误，入口处使用弹窗提示
class LoginRequiredError extends Error {}

// 通过登录表单识别登录页面
function checkLoginDocument(doc) {
	const loginForm = doc.querySelector('#loginForm[action="/Logon.do?method=logon"]');
	if (loginForm != null) {
		throw new LoginRequiredError("请先登录教务系统，再点击“执行导入”。");
	}
}

// 主流程：读取课表 -> 选择校区 -> 拉周历 -> 生成节次 -> 调桥接导入
// 传统流程：从页面中读取用户打开的课表 iframe
// 便捷流程：若未打开课表，则让用户选择学年学期，直接拉取课表
async function importSchedule() {
	// 未登录时直接提示，不继续读取课表
	checkLoginDocument(document);

	window.shiguangBridge.showToast("开始读取教务课表……");

	// 读取 iframe，未打开课表时则走便捷导入流程
	const iframeDoc = getScheduleIframeDocument();
	let scheduleDoc = iframeDoc;
	let semesterId;
	if (iframeDoc == null) {
		const selectedSchedule = await chooseScheduleDocument();
		scheduleDoc = selectedSchedule.scheduleDoc;
		semesterId = selectedSchedule.semesterId;
	} else {
		semesterId = getSemesterIds(iframeDoc).selectedOption;
	}

	// 解析课程信息
	const courses = parseCoursesFromIframeDocument(scheduleDoc);
	if (courses.length === 0) {
		throw new Error("未解析到任何课程，请确认当前课表页面已加载完成");
	}

	// 拉取周历信息，获取开学日期与总周数
	const calendarInfo = await fetchSemesterCalendarInfo(semesterId);

	// 选择校区并生成预设上课时间配置
	const campusId = await chooseCampus();
	const campusLabel = CAMPUS_OPTIONS.find((item) => item.id === campusId)?.label ?? "白云校区";
	const presetTimeSlots = buildPresetTimeSlots(campusId);

	// 构建上课预设时间配置
	const config = {
		semesterStartDate: calendarInfo.semesterStartDate,
		semesterTotalWeeks: calendarInfo.semesterTotalWeeks,
		defaultClassDuration: PRESET_TIME_CONFIG.common.durations.classMinutes,
		defaultBreakDuration: PRESET_TIME_CONFIG.common.durations.shortBreakMinutes,
		// 每周按周一起始计算，因此固定为 1
		firstDayOfWeek: 1
	};

	// 通知课表软件进行导入，传递课程与预设时间配置
	await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
	await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(presetTimeSlots));
	await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));

	window.shiguangBridge.showToast(`导入成功：${campusLabel}，课程 ${courses.length} 条`);
	window.shiguangBridge.notifyTaskCompletion();
}

// 自执行入口
(async () => {
	try {
		await importSchedule();
	} catch (error) {
		if (error instanceof LoginRequiredError) {
			// 弹窗强提醒，同时也在控制台输出并展示 Toast
			await window.shiguangBridgePromise.showAlert("未登录教务系统", error.message, "好的");
		}

		console.error("课表导入失败：", error);
		// 失败原因直接提示给用户，便于在移动端快速定位问题
		window.shiguangBridge.showToast(`导入失败：${error.message}`);
	}
})();