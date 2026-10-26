// 山东轻工职业学院(sdlivc.cn) 拾光课程表适配脚本
// 数据来源：教务系统 /jedu/edu/core/eduScheduleInfo/getScheduleNew.do

(function () {
    const ROOT_PATH = window.__rootPath || '/jedu';
    const WEEK_MAP = {
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
        sun: 7
    };

    function showToast(message) {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
            window.shiguangBridge.showToast(message);
        } else {
            console.log('[Toast]', message);
        }
    }

    function getStudentId() {
        if (typeof window.stuId === 'string' && window.stuId.trim()) {
            return window.stuId.trim();
        }

        const html = document.body ? document.body.innerHTML : '';
        const match = html.match(/var\s+stuId\s*=\s*["']([^"']+)["']/);
        return match ? match[1] : '';
    }

    function getSelectedSemesterId() {
        if (typeof mini !== 'undefined' && typeof mini.get === 'function') {
            const picker = mini.get('semId');
            if (picker && typeof picker.getValue === 'function') {
                return picker.getValue() || '';
            }
        }

        const input = document.querySelector('input[name="semId"], #semId');
        return input ? input.value || '' : '';
    }

    function toDayNumber(week) {
        return WEEK_MAP[String(week || '').toLowerCase()] || null;
    }

    function expandWeekRange(start, end, parity) {
        const weeks = [];
        const from = Math.min(start, end);
        const to = Math.max(start, end);

        for (let week = from; week <= to; week += 1) {
            if (parity === 'odd' && week % 2 === 0) continue;
            if (parity === 'even' && week % 2 !== 0) continue;
            weeks.push(week);
        }

        return weeks;
    }

    function parseWeeks(weekList) {
        if (!weekList) return [];

        const weeks = new Set();
        const normalized = String(weekList)
            .replace(/\s+/g, '')
            .replace(/，/g, ',')
            .replace(/（/g, '(')
            .replace(/）/g, ')')
            .replace(/第/g, '')
            .replace(/周/g, '');

        for (const rawPart of normalized.split(',')) {
            if (!rawPart) continue;

            const parity = rawPart.includes('单') ? 'odd' : rawPart.includes('双') ? 'even' : null;
            const numberPart = rawPart.replace(/\([^)]*\)/g, '');
            const rangeMatch = numberPart.match(/^(\d+)-(\d+)$/);
            const singleMatch = numberPart.match(/^(\d+)$/);

            if (rangeMatch) {
                expandWeekRange(Number(rangeMatch[1]), Number(rangeMatch[2]), parity)
                    .forEach(week => weeks.add(week));
            } else if (singleMatch) {
                const week = Number(singleMatch[1]);
                if (parity === 'odd' && week % 2 === 0) continue;
                if (parity === 'even' && week % 2 !== 0) continue;
                weeks.add(week);
            }
        }

        return Array.from(weeks).sort((a, b) => a - b);
    }

    function cleanPlaceName(item) {
        const place = item && item.eduPlace ? item.eduPlace : {};
        return place.placeName || place.nameIncludeNum || '';
    }

    function convertScheduleItem(item) {
        if (!item || item.stopCourse !== 'NO') return null;

        const lesson = item.eduLesson || {};
        const day = toDayNumber(item.week);
        const weeks = parseWeeks(item.weekList);
        const startSection = Number(lesson.startLesson);
        const endSection = Number(lesson.endLesson);

        if (!item.courseName || !day || !startSection || !endSection || weeks.length === 0) {
            return null;
        }

        return {
            name: item.courseName,
            teacher: item.teacherName || '',
            position: cleanPlaceName(item),
            day,
            startSection,
            endSection,
            weeks,
            isCustomTime: false
        };
    }

    function mergeCourses(courses) {
        const courseMap = new Map();

        courses.forEach(course => {
            const key = [
                course.name,
                course.teacher,
                course.position,
                course.day,
                course.startSection,
                course.endSection
            ].join('|');

            const existing = courseMap.get(key);
            if (existing) {
                existing.weeks = Array.from(new Set(existing.weeks.concat(course.weeks))).sort((a, b) => a - b);
            } else {
                courseMap.set(key, Object.assign({}, course, {
                    weeks: Array.from(new Set(course.weeks)).sort((a, b) => a - b)
                }));
            }
        });

        return Array.from(courseMap.values());
    }

    function getMaxWeek(courses) {
        const weeks = courses.flatMap(course => Array.isArray(course.weeks) ? course.weeks : []);
        return weeks.length > 0 ? Math.max.apply(null, weeks) : 20;
    }

    async function fetchSchedule() {
        const stuId = getStudentId();
        if (!stuId) {
            throw new Error('未找到学生 ID，请先通过学生信息系统进入“学期课表”页面。');
        }

        const params = new URLSearchParams({
            semId: getSelectedSemesterId(),
            stuId,
            checkType: 'student'
        });

        const response = await fetch(ROOT_PATH + '/edu/core/eduScheduleInfo/getScheduleNew.do', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: params.toString()
        });

        if (!response.ok) {
            throw new Error('课表接口请求失败：HTTP ' + response.status);
        }

        const json = await response.json();
        if (!json || json.success !== true) {
            throw new Error((json && json.message) || '课表接口返回失败。');
        }

        return json.data && Array.isArray(json.data.schedule) ? json.data.schedule : [];
    }

    async function saveImportedData(courses) {
        const courseResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (courseResult !== true) {
            throw new Error('课程保存失败：' + courseResult);
        }

        if (typeof window.shiguangBridgePromise.saveCourseConfig === 'function') {
            const configResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
                semesterTotalWeeks: getMaxWeek(courses),
                defaultClassDuration: 45,
                defaultBreakDuration: 10,
                firstDayOfWeek: 1
            }));
            if (configResult !== true) {
                throw new Error('课表配置保存失败：' + configResult);
            }
        }
    }

    async function promptUserToStart() {
        if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.showAlert !== 'function') {
            return true;
        }

        return await window.shiguangBridgePromise.showAlert(
            '山东轻工职业学院课表导入',
            '请确认已登录并进入“学期课表”页面。脚本将读取当前学期课表并导入拾光课程表。',
            '开始导入'
        );
    }

    async function runImportFlow() {
        try {
            const confirmed = await promptUserToStart();
            if (!confirmed) return;

            showToast('正在读取学期课表...');
            const rawSchedule = await fetchSchedule();
            const courses = mergeCourses(rawSchedule.map(convertScheduleItem).filter(Boolean));

            if (courses.length === 0) {
                showToast('未解析到可导入课程');
                return;
            }

            await saveImportedData(courses);
            showToast('成功导入 ' + courses.length + ' 条课程');
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            console.error('山东轻工职业学院课表导入失败', error);
            showToast('课表导入失败：' + error.message);
        }
    }

    window.__sdlivcImporter = {
        parseWeeks,
        toDayNumber,
        convertScheduleItem,
        mergeCourses,
        getMaxWeek,
        saveImportedData
    };

    if (window.__SDLIVC_AUTO_RUN__ !== false) {
        runImportFlow();
    }
}());
