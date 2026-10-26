// 山东华宇工学院 拾光课程表适配脚本
// 基于正方教务系统API适配

/**
 * 解析周次字符串
 */
function parseWeeks(weekStr) {
	var weeks = [];
	if (!weekStr) return weeks;
	
	var weekSets = weekStr.split(',');
	for (var i = 0; i < weekSets.length; i++) {
		var set = weekSets[i].trim();
		var isSingle = set.indexOf('(单)') !== -1;
		var isDouble = set.indexOf('(双)') !== -1;
		
		set = set.split('(单)').join('');
		set = set.split('(双)').join('');
		set = set.trim();
		
		var dashIdx = set.indexOf('-');
		var start = 0;
		var end = 0;
		var processed = false;
		
		if (dashIdx !== -1 && set.indexOf('周') !== -1) {
			start = parseInt(set.substring(0, dashIdx));
			var endPart = set.substring(dashIdx + 1);
			endPart = endPart.split('周').join('');
			end = parseInt(endPart);
			processed = true;
		} else {
			var weekNum = parseInt(set);
			if (!isNaN(weekNum)) {
				start = end = weekNum;
				processed = true;
			}
		}
		
		if (processed) {
			for (var w = start; w <= end; w++) {
				if (isSingle && w % 2 === 0) continue;
				if (isDouble && w % 2 !== 0) continue;
				weeks.push(w);
			}
		}
	}
	
	var uniqueWeeks = [];
	for (var j = 0; j < weeks.length; j++) {
		if (uniqueWeeks.indexOf(weeks[j]) === -1) {
			uniqueWeeks.push(weeks[j]);
		}
	}
	uniqueWeeks.sort(function(a, b) { return a - b; });
	return uniqueWeeks;
}

/**
 * 解析API返回的JSON数据
 */
function parseJsonData(jsonData) {
	console.log('JS: parseJsonData 正在解析JSON数据...');
	
	if (!jsonData || !Array.isArray(jsonData.kbList)) {
		console.warn('JS: JSON数据结构错误或缺少kbList字段');
		return [];
	}
	
	var rawCourseList = jsonData.kbList;
	var finalCourseList = [];
	
	for (var i = 0; i < rawCourseList.length; i++) {
		var rawCourse = rawCourseList[i];
		
		if (!rawCourse.kcmc || !rawCourse.xm || !rawCourse.cdmc || 
			!rawCourse.xqj || !rawCourse.jcs || !rawCourse.zcd) {
			continue;
		}
		
		var weeksArray = parseWeeks(rawCourse.zcd);
		if (weeksArray.length === 0) {
			continue;
		}
		
		var sectionParts = rawCourse.jcs.split('-');
		var startSection = parseInt(sectionParts[0]);
		var endSection = parseInt(sectionParts[sectionParts.length - 1]);
		var day = parseInt(rawCourse.xqj);
		
		if (isNaN(day) || isNaN(startSection) || isNaN(endSection) || 
			day < 1 || day > 7 || startSection > endSection) {
			continue;
		}
		
		var courseName = rawCourse.kcmc.trim();
		courseName = courseName.split('★').join('');
		courseName = courseName.split('●').join('');
		courseName = courseName.split('◆').join('');
		courseName = courseName.split('◇').join('');
		courseName = courseName.split('○').join('');
		
		finalCourseList.push({
			name: courseName,
			teacher: rawCourse.xm.trim(),
			position: rawCourse.cdmc.trim(),
			day: day,
			startSection: startSection,
			endSection: endSection,
			weeks: weeksArray
		});
	}
	
	finalCourseList.sort(function(a, b) {
		if (a.day !== b.day) return a.day - b.day;
		if (a.startSection !== b.startSection) return a.startSection - b.startSection;
		return a.name.localeCompare(b.name);
	});
	
	console.log('JS: JSON数据解析完成，共找到 ' + finalCourseList.length + ' 门课程');
	return finalCourseList;
}

/**
 * 检查是否在登录页面
 */
function isLoginPage() {
	var url = window.location.href;
	var loginUrls = [
		'login_slogin.html',
		'login_login.html'
	];
	for (var i = 0; i < loginUrls.length; i++) {
		if (url.indexOf(loginUrls[i]) !== -1) return true;
	}
	return false;
}

/**
 * 自动获取当前学年
 * 优先从页面下拉框获取，失败则根据日期计算
 */
function getCurrentAcademicYear() {
	// 尝试从页面获取
	var xnmSelect = document.getElementById('xnm');
	if (xnmSelect && xnmSelect.value) {
		var year = xnmSelect.value;
		console.log('JS: 从页面获取到学年: ' + year);
		return year;
	}
	
	// 根据当前日期计算学年
	var now = new Date();
	var year = now.getFullYear();
	var month = now.getMonth() + 1;
	
	// 9月及以后属于新学年
	if (month >= 9) {
		console.log('JS: 根据日期计算学年: ' + year);
		return year.toString();
	} else {
		console.log('JS: 根据日期计算学年: ' + (year - 1));
		return (year - 1).toString();
	}
}

/**
 * 自动获取当前学期
 * 优先从页面下拉框获取，失败则根据日期计算
 */
function getCurrentSemesterIndex() {
	// 尝试从页面获取
	var xqmSelect = document.getElementById('xqm');
	if (xqmSelect && xqmSelect.value) {
		var xqm = xqmSelect.value;
		// xqm: 3=第一学期, 12=第二学期
		if (xqm === '3') {
			console.log('JS: 从页面获取到学期: 第一学期');
			return 0;
		} else if (xqm === '12') {
			console.log('JS: 从页面获取到学期: 第二学期');
			return 1;
		}
	}
	
	// 根据日期计算：9月-次年2月为第一学期，3月-7月为第二学期
	var month = new Date().getMonth() + 1;
	if (month >= 3 && month <= 7) {
		console.log('JS: 根据日期计算学期: 第二学期');
		return 1;
	} else {
		console.log('JS: 根据日期计算学期: 第一学期');
		return 0;
	}
}

function getSemesterCode(semesterIndex) {
	return semesterIndex === 0 ? '3' : '12';
}

function getSemesterName(semesterIndex) {
	return semesterIndex === 0 ? '第一学期' : '第二学期';
}

function validateDateInput(input) {
	console.log('JS: validateDateInput 被调用，输入: ' + input);
	if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input)) {
		console.log('JS: validateDateInput 验证通过');
		return false;
	} else {
		console.log('JS: validateDateInput 验证失败');
		return '请输入正确格式的开学日期（如2025-09-01）！';
	}
}

async function promptUserToStart() {
	console.log('JS: 流程开始：显示公告');
	return await window.shiguangBridgePromise.showAlert(
		'教务系统课表导入',
		'导入前请确保您已在浏览器中成功登录教务系统。',
		'好的，开始导入'
	);
}

async function confirmAcademicYear(year, semesterName) {
	console.log('JS: 显示学年学期确认弹窗');
	return await window.shiguangBridgePromise.showAlert(
		'确认学年学期',
		'检测到当前为 ' + year + '-' + (parseInt(year) + 1) + ' 学年' + semesterName + '，确认导入该学期课程吗？',
		'确认导入'
	);
}

async function getSemesterStartDate() {
	console.log('JS: 提示用户输入开学日期');
	return await window.shiguangBridgePromise.showPrompt(
		'选择开学日期',
		'请输入本学期开学日期（格式：YYYY-MM-DD，如2025-09-01）：',
		'2025-09-01',
		'validateDateInput'
	);
}

/**
 * 通过API请求和解析课程数据
 */
async function fetchAndParseCourses(academicYear, semesterIndex) {
	window.shiguangBridge.showToast('正在请求课表数据...');
	
	var semesterCode = getSemesterCode(semesterIndex);
	var baseUrl = window.location.origin;
	var url = baseUrl + '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151';
	var body = 'xnm=' + academicYear + '&xqm=' + semesterCode + '&kzlx=ck';
	
	console.log('JS: 发送请求到 ' + url + ', body: ' + body);
	
	try {
		var response = await fetch(url, {
			headers: {
				'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
			},
			referer: baseUrl + '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151',
			body: body,
			method: 'POST',
			credentials: 'include'
		});
		
		if (!response.ok) {
			throw new Error('网络请求失败。状态码: ' + response.status);
		}
		
		var jsonText = await response.text();
		var jsonData;
		try {
			jsonData = JSON.parse(jsonText);
		} catch (e) {
			console.error('JS: JSON解析失败，可能是会话过期:', e);
			window.shiguangBridge.showToast('数据返回格式错误，可能是您未成功登录或会话已过期。');
			return null;
		}
		
		var courses = parseJsonData(jsonData);
		if (courses.length === 0) {
			window.shiguangBridge.showToast('未找到任何课程数据，请检查所选学年学期是否正确。');
			return null;
		}
		
		console.log('JS: 课程数据解析成功，共找到 ' + courses.length + ' 门课程');
		return courses;
	} catch (error) {
		window.shiguangBridge.showToast('请求或解析失败: ' + error.message);
		console.error('JS: Fetch/Parse Error:', error);
		return null;
	}
}

async function saveCourses(parsedCourses) {
	window.shiguangBridge.showToast('正在保存 ' + parsedCourses.length + ' 门课程...');
	console.log('JS: 尝试保存 ' + parsedCourses.length + ' 门课程');
	try {
		await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(parsedCourses));
		console.log('JS: 课程保存成功');
		return true;
	} catch (error) {
		window.shiguangBridge.showToast('课程保存失败: ' + error.message);
		console.error('JS: Save Courses Error:', error);
		return false;
	}
}

async function saveConfig(startDate) {
	console.log('JS: 尝试保存课表配置，开学日期: ' + startDate);
	var config = {
		semesterStartDate: startDate,
		semesterTotalWeeks: 20,
		defaultClassDuration: 45,
		defaultBreakDuration: 10,
		firstDayOfWeek: 1
	};
	try {
		await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
		window.shiguangBridge.showToast('课表配置更新成功！开学日期：' + startDate);
		console.log('JS: 配置保存成功');
		return true;
	} catch (error) {
		window.shiguangBridge.showToast('课表配置保存失败: ' + error.message);
		console.error('JS: Save Config Error:', error);
		return false;
	}
}

// 山东华宇工学院西区冬季作息时间
var TimeSlots = [
	{ number: 1, startTime: '08:10', endTime: '08:55' },
	{ number: 2, startTime: '09:05', endTime: '09:50' },
	{ number: 3, startTime: '10:15', endTime: '11:00' },
	{ number: 4, startTime: '11:15', endTime: '12:00' },
	{ number: 5, startTime: '14:40', endTime: '15:25' },
	{ number: 6, startTime: '15:35', endTime: '16:20' },
	{ number: 7, startTime: '16:30', endTime: '17:15' },
	{ number: 8, startTime: '17:25', endTime: '18:10' },
	{ number: 9, startTime: '19:10', endTime: '19:55' },
	{ number: 10, startTime: '20:05', endTime: '20:50' }
];

async function importPresetTimeSlots(timeSlots) {
	console.log('JS: 准备导入 ' + timeSlots.length + ' 个预设时间段');
	try {
		await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
		window.shiguangBridge.showToast('预设时间段导入成功！');
		console.log('JS: 预设时间段导入成功');
	} catch (error) {
		window.shiguangBridge.showToast('导入时间段失败: ' + error.message);
		console.error('JS: Save Time Slots Error:', error);
	}
}

async function runImportFlow() {
	if (isLoginPage()) {
		window.shiguangBridge.showToast('导入失败：请先登录教务系统！');
		console.log('JS: 检测到当前在登录页面，终止导入');
		return;
	}
	
	var alertConfirmed = await promptUserToStart();
	if (!alertConfirmed) {
		window.shiguangBridge.showToast('用户取消了导入');
		console.log('JS: 用户取消了导入流程');
		return;
	}
	
	// 自动获取学年和学期
	var academicYear = getCurrentAcademicYear();
	var semesterIndex = getCurrentSemesterIndex();
	var semesterName = getSemesterName(semesterIndex);
	
	console.log('JS: 自动获取到学年: ' + academicYear + ', 学期: ' + semesterName);
	
	// 让用户确认
	var confirmResult = await confirmAcademicYear(academicYear, semesterName);
	if (!confirmResult) {
		window.shiguangBridge.showToast('导入已取消');
		console.log('JS: 用户取消确认学年学期');
		return;
	}
	
	var startDate = await getSemesterStartDate();
	if (startDate === null) {
		window.shiguangBridge.showToast('导入已取消');
		console.log('JS: 获取开学日期失败/取消，流程终止');
		return;
	}
	console.log('JS: 已选择开学日期: ' + startDate);
	
	var courses = await fetchAndParseCourses(academicYear, semesterIndex);
	if (courses === null) {
		console.log('JS: 课程获取或解析失败，流程终止');
		return;
	}
	
	var saveResult = await saveCourses(courses);
	if (!saveResult) {
		console.log('JS: 课程保存失败，流程终止');
		return;
	}
	
	var configResult = await saveConfig(startDate);
	if (!configResult) {
		console.log('JS: 配置保存失败，流程终止');
		return;
	}
	
	await importPresetTimeSlots(TimeSlots);
	
	window.shiguangBridge.showToast('课程导入成功，共导入 ' + courses.length + ' 门课程！');
	console.log('JS: 整个导入流程执行完毕并成功');
	window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();