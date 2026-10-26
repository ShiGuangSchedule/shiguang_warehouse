// 江苏科技大学(just.edu.cn) 拾光课程表适配脚本
// 教务系统：正方新一代教务（/jwglxt）
// 校外访问：深信服 enlink WebVPN，统一身份认证 https://client.v.just.edu.cn/
//   WebVPN 代理路径形如 /http/webvpn<hex>/jwglxt/...，<hex> 与登录会话相关不能写死，
//   脚本从当前页面 URL 动态取前缀。
// 课表页的学年/学期是 <select id="xnm">（学年）/ <select id="xqm">（学期），
// 被 chosen 组件包装成 div#xnm_chosen / div#xqm_chosen（原 select 是容器的前一个兄弟节点）。
// 脚本读出选项让用户确认，再请求课表、校历与校区作息。
// 维护者：abyss-stars

(async function () {
    const bridge = window.shiguangBridgePromise;
    const native = window.shiguangBridge;
    if (!bridge || !native) return;
    if (window.__justImportRunning) {
        native.showToast('课表正在导入，请勿重复点击。');
        return;
    }
    window.__justImportRunning = true;

    const GNMKDM = 'N2151';
    const API = {
        course: '/kbcx/xskbcx_cxXsgrkb.html',
        calendar: '/kbcx/xskbcxZccx_cxZcByXnxq.html',
        timeSlots: '/kbcx/xskbcx_cxRjc.html'
    };

    // ---------- 1. 接口 ----------
    // 校内直连是 https://<host>/jwglxt/...，WebVPN 下前面还有 /http/webvpn<hex>（<hex> 与会话相关）
    const matched = (window.location.pathname || '').match(/^(.*?)\/jwglxt(?:\/|$)/i);
    const BASE = (matched ? matched[1] : '') + '/jwglxt';

    // enlink 网关下通常需要 enlink-vpn 标记，两种写法依次尝试
    async function request(modulePath, params) {
        const body = Object.keys(params)
            .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] == null ? '' : params[key])}`)
            .join('&');

        for (const suffix of [`?gnmkdm=${GNMKDM}&enlink-vpn`, `?gnmkdm=${GNMKDM}`]) {
            try {
                const response = await fetch(BASE + modulePath + suffix, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                    },
                    body: body
                });
                if (!response.ok) continue;
                const raw = await response.text();
                const head = raw.replace(/^\s+/, '').charAt(0);
                // 非 JSON（例如被跳到登录页）就换下一种写法
                if (head === '{' || head === '[') return JSON.parse(raw);
            } catch (error) {
                // 换下一种写法
            }
        }
        return null;
    }

    // ---------- 2. 解析 ----------
    const text = (value) => String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');

    // 周次："1-16周"、"1-16周(单)"、"1,3,5-9周" 等
    function parseWeeks(value) {
        const weeks = new Set();
        const normalized = text(value).replace(/\s/g, '').replace(/[，、；;]/g, ',')
            .replace(/（/g, '(').replace(/）/g, ')');

        for (const part of normalized.split(',')) {
            const odds = /单/.test(part);
            const evens = /双/.test(part);
            const digits = part.replace(/[^\d-]/g, '');
            const matched = digits.match(/^(\d+)-(\d+)$/) || digits.match(/^(\d+)$/);
            if (!matched) continue;

            const start = Number(matched[1]);
            const end = Number(matched[2] || matched[1]);
            if (!(start > 0) || end < start) continue;
            for (let week = start; week <= end; week++) {
                if (odds && week % 2 === 0) continue;
                if (evens && week % 2 !== 0) continue;
                weeks.add(week);
            }
        }
        return [...weeks].sort((a, b) => a - b);
    }

    // 节次："1-2"、"1"、"0102"（部分部署补零）
    function parseSections(value) {
        const raw = text(value);
        const hyphen = raw.match(/(\d+)\s*[-~—－]\s*(\d+)/);
        if (hyphen) return [Number(hyphen[1]), Number(hyphen[2])];

        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;
        if (digits.length === 4) return [Number(digits.slice(0, 2)), Number(digits.slice(2))];
        return [Number(digits), Number(digits)];
    }

    function toMinutes(value) {
        const matched = String(value == null ? '' : value).match(/^(\d{1,2}):(\d{2})$/);
        return matched ? Number(matched[1]) * 60 + Number(matched[2]) : -1;
    }

    // 统一成 app 要求的 HH:mm
    function padTime(value) {
        const matched = String(value == null ? '' : value).match(/(\d{1,2}):(\d{2})/);
        if (!matched) return '';
        const hour = Number(matched[1]);
        return hour > 23 ? '' : `${hour < 10 ? '0' : ''}${hour}:${matched[2]}`;
    }

    // 一条接口记录 -> 排课条目；没有固定星期/节次的（实践、网络课程等）返回 null
    function toCourseEntry(raw) {
        const name = text(raw.kcmc);
        const day = Number(text(raw.xqj));
        const weeks = parseWeeks(raw.zcd);
        const sections = parseSections(text(raw.jcs) !== '' ? raw.jcs : raw.jc);
        if (!name || !(day >= 1 && day <= 7) || !weeks.length || !sections) return null;
        if (!(sections[0] > 0) || sections[1] < sections[0]) return null;

        return {
            campusId: text(raw.xqh_id) || '0',
            campusName: text(raw.xqmc),
            course: {
                name: name,
                teacher: text(raw.xm) || '未知教师',
                position: text(raw.cdmc) || text(raw.cdbh) || '未排地点',
                day: day,
                startSection: sections[0],
                endSection: sections[1],
                weeks: weeks
            }
        };
    }

    // kbList 与 sjkList 通用：只取有固定星期与节次的记录，其余（实践课程、网络课程等）忽略
    function collectCourses(list) {
        const entries = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            const entry = toCourseEntry(raw);
            if (entry) entries.push(entry);
        }
        return entries;
    }

    // 校区作息：jcmc=节次，qssj/jssj=起止时间
    function parseTimeSlots(rows) {
        const slots = [];
        for (const row of (Array.isArray(rows) ? rows : [])) {
            const number = Number(text(row.jcmc != null ? row.jcmc : row.jcdm));
            const startTime = padTime(row.qssj);
            const endTime = padTime(row.jssj);
            if (!(number > 0) || !startTime || !endTime) continue;
            if (toMinutes(startTime) >= toMinutes(endTime)) continue;
            slots.push({ number: number, startTime: startTime, endTime: endTime });
        }

        slots.sort((a, b) => a.number - b.number);
        // app 要求节次从 1 连续，否则整段丢弃
        const continuous = slots.length > 0 && (() => {
            for (let i = 0; i < slots.length; i++) {
                if (slots[i].number !== i + 1) return false;
            }
            return true;
        })();
        return continuous ? slots : [];
    }

    // 学期校历：zs=周次，rq="起始日/结束日"
    function parseCalendar(rows) {
        const weeks = [];
        for (const row of (Array.isArray(rows) ? rows : [])) {
            const number = Number(text(row.zs != null ? row.zs : row.zsmc));
            const start = text(row.rq || row.zcrq || row.ksrq).split('/')[0];
            if (number > 0 && /^\d{4}-\d{2}-\d{2}$/.test(start)) weeks.push({ number: number, start: start });
        }
        if (!weeks.length) return null;

        weeks.sort((a, b) => a.number - b.number);
        const first = weeks[0];
        return {
            startDate: first.start,
            // app 的 firstDayOfWeek 是 1=周一 … 7=周日
            firstDayOfWeek: (new Date(`${first.start}T00:00:00Z`).getUTCDay() + 6) % 7 + 1,
            totalWeeks: weeks[weeks.length - 1].number
        };
    }

    // 教务处公布的作息时间表（接口取不到时兜底）
    const FALLBACK_TIME_SLOTS = {
        '长山': [[1, '08:30', '09:15'], [2, '09:20', '10:05'], [3, '10:25', '11:10'], [4, '11:15', '12:00'],
            [5, '14:00', '14:45'], [6, '14:50', '15:35'], [7, '15:55', '16:40'], [8, '16:45', '17:30'],
            [9, '18:30', '19:15'], [10, '19:20', '20:05']],
        '梦溪': [[1, '08:00', '08:45'], [2, '08:55', '09:40'], [3, '10:00', '10:45'], [4, '10:55', '11:40'],
            [5, '14:00', '14:45'], [6, '14:55', '15:40'], [7, '15:50', '16:35'], [8, '16:45', '17:30'],
            [9, '19:00', '19:45'], [10, '19:55', '20:40'], [11, '20:50', '21:35']],
        // 张家港取自 2026-2027-1 学期 xskbcx_cxRjc 接口实测（与梦溪不同）
        '张家港': [[1, '08:00', '08:45'], [2, '08:55', '09:40'], [3, '10:00', '10:45'], [4, '10:55', '11:40'],
            [5, '14:00', '14:45'], [6, '14:55', '15:40'], [7, '16:00', '16:45'], [8, '16:55', '17:40'],
            [9, '19:00', '19:45'], [10, '19:55', '20:40'], [11, '20:50', '21:35']]
    };

    function fallbackSlots(campusName) {
        for (const key of Object.keys(FALLBACK_TIME_SLOTS)) {
            if (new RegExp(key).test(campusName)) {
                return FALLBACK_TIME_SLOTS[key].map((item) => ({ number: item[0], startTime: item[1], endTime: item[2] }));
            }
        }
        return null;
    }

    // 节次与周次合并去重（参考 wiki《课程合并与去重函数》）
    function mergeCourses(courses) {
        if (courses.length <= 1) return courses;

        const sameCourse = (a, b) =>
            a.name === b.name && a.teacher === b.teacher && a.position === b.position && a.day === b.day &&
            !!a.isCustomTime === !!b.isCustomTime &&
            (!a.isCustomTime || (a.customStartTime === b.customStartTime && a.customEndTime === b.customEndTime));

        const list = courses.map((course) => Object.assign({}, course, {
            weeks: [...course.weeks].sort((a, b) => a - b)
        }));

        list.sort((a, b) =>
            a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) || a.day - b.day ||
            a.weeks.join(',').localeCompare(b.weeks.join(',')) || a.startSection - b.startSection);

        const merged = [];
        let current = list[0];
        for (let i = 1; i < list.length; i++) {
            const next = list[i];
            const mergeable = sameCourse(current, next) && !current.isCustomTime &&
                current.weeks.join(',') === next.weeks.join(',');

            if (mergeable && current.endSection + 1 === next.startSection) {
                current.endSection = next.endSection;                       // 连续节次：1-2 + 3-4 -> 1-4
            } else if (mergeable && current.startSection === next.startSection &&
                current.endSection === next.endSection) {
                continue;                                                   // 完全重复
            } else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);

        // 同节次的周次合并（单周 + 双周 -> 全周）
        merged.sort((a, b) =>
            a.name.localeCompare(b.name) || a.teacher.localeCompare(b.teacher) ||
            a.position.localeCompare(b.position) || a.day - b.day ||
            a.startSection - b.startSection || a.endSection - b.endSection);

        const result = [];
        let head = merged[0];
        for (let i = 1; i < merged.length; i++) {
            const next = merged[i];
            if (sameCourse(head, next) && head.startSection === next.startSection &&
                head.endSection === next.endSection) {
                head.weeks = [...new Set([...head.weeks, ...next.weeks])].sort((a, b) => a - b);
            } else {
                result.push(head);
                head = next;
            }
        }
        result.push(head);
        return result;
    }

    // ---------- 3. 学年学期 ----------
    // 学年/学期是 <select id="xnm"> / <select id="xqm">，chosen 组件会在其后插入 div#xnm_chosen 容器
    function findTermSelect(name) {
        const select = document.getElementById(name);
        if (select) return select;
        const chosen = document.getElementById(name + '_chosen');
        const sibling = chosen ? chosen.previousElementSibling : null;
        return sibling && sibling.tagName === 'SELECT' ? sibling : null;
    }

    function readSelectOptions(name) {
        const select = findTermSelect(name);
        const options = [];
        if (!select) return options;
        // 注意：教务页面改写了 Array.prototype.filter/some/every（回调实参变成下标），
        // 所以这里全部用普通循环，不调用这些方法。
        for (const option of Array.from(select.options)) {
            const value = text(option.value);
            if (value === '') continue;
            options.push({
                value: value,
                text: text(option.textContent) || value,
                selected: option.selected === true
            });
        }
        return options;
    }

    // 默认选中教务当前学年学期，没有标记则取第一项
    function defaultIndex(options) {
        for (let i = 0; i < options.length; i++) {
            if (options[i].selected) return i;
        }
        return 0;
    }

    async function selectTerm() {
        const yearOptions = readSelectOptions('xnm');
        const semesterOptions = readSelectOptions('xqm');
        if (!yearOptions.length || !semesterOptions.length) {
            await bridge.showAlert('读取学年学期失败',
                '未在页面中找到学年(.xnm)/学期(.xqm)下拉。\n请确认：\n' +
                '1. 已登录教务系统（校外需先登录 WebVPN）；\n' +
                '2. 当前停留在「信息查询-学生课表查询」页面。', '知道了');
            return null;
        }

        const yearIndex = await bridge.showSingleSelection('选择学年',
            JSON.stringify(yearOptions.map((item) => item.text)), defaultIndex(yearOptions));
        if (yearIndex === null || yearIndex === -1) return null;

        const semesterIndex = await bridge.showSingleSelection('选择学期',
            JSON.stringify(semesterOptions.map((item) => item.text)), defaultIndex(semesterOptions));
        if (semesterIndex === null || semesterIndex === -1) return null;

        return {
            xnm: yearOptions[yearIndex].value,
            xnmText: yearOptions[yearIndex].text,
            xqm: semesterOptions[semesterIndex].value,
            xqmText: semesterOptions[semesterIndex].text
        };
    }

    // 返回该校区节次作息数组；接口取不到时用教务处公布的作息，未知校区返回 null（跳过作息导入）
    async function fetchTimeSlots(campus, term) {
        if (campus.id !== '0') {
            const slots = parseTimeSlots(await request(API.timeSlots,
                Object.assign({ xqh_id: campus.id }, term)));
            if (slots.length) return slots;
        }
        return fallbackSlots(campus.name);
    }

    // ---------- 4. 主流程 ----------
    try {
        if (!await bridge.showAlert('江苏科技大学课表导入',
            '导入前请确保已登录教务系统。\n校外需先登录 WebVPN（client.v.just.edu.cn），' +
            '并进入教务系统页面（如「信息查询-学生课表查询」）。', '好的，开始导入')) {
            native.showToast('用户取消了导入。');
            return;
        }

        const term = await selectTerm();
        if (!term) {
            native.showToast('导入已取消。');
            return;
        }

        native.showToast('正在获取课表数据…');
        const params = { xnm: term.xnm, xqm: term.xqm };
        const [courseData, calendarRows] = await Promise.all([
            request(API.course, Object.assign({ kzlx: 'ck', xsdm: '', kclbdm: '', kclxdm: '' }, params)),
            request(API.calendar, params)
        ]);
        const calendar = parseCalendar(calendarRows);
        if (!courseData || !Array.isArray(courseData.kbList)) {
            await bridge.showAlert('获取课表失败',
                '教务系统未返回课表数据，请确认已登录、且当前在教务系统页面内。', '知道了');
            return;
        }

        // sjkList 是实践/集中教学安排，其中带星期与节次的同样可以排进课表
        const entries = collectCourses(courseData.kbList).concat(collectCourses(courseData.sjkList));
        if (!entries.length) {
            await bridge.showAlert('没有可导入的课程', '所选学期没有解析出已排课程。', '知道了');
            return;
        }

        const campusMap = new Map();
        for (const entry of entries) {
            const campus = campusMap.get(entry.campusId) ||
                { id: entry.campusId, name: entry.campusName, count: 0 };
            campus.count++;
            campusMap.set(entry.campusId, campus);
        }
        const campuses = [...campusMap.values()].sort((a, b) => b.count - a.count);

        native.showToast('正在获取校区作息…');
        const slotsMap = new Map();
        await Promise.all(campuses.map(async (campus) => {
            slotsMap.set(campus.id, await fetchTimeSlots(campus, params));
        }));

        let campusIndex = 0;
        if (campuses.length > 1) {
            const index = await bridge.showSingleSelection('选择默认作息校区',
                JSON.stringify(campuses.map((campus) => `${campus.name || campus.id}（${campus.count} 条）`)), 0);
            if (index === null || index === -1) {
                native.showToast('导入已取消。');
                return;
            }
            campusIndex = index;
        }
        const presetCampus = campuses[campusIndex];
        const presetSlots = slotsMap.get(presetCampus.id) || null;

        // 与默认作息不同的校区，课程改用自定义时间
        const courses = entries.map((entry) => {
            const course = Object.assign({}, entry.course);
            const slots = slotsMap.get(entry.campusId) || presetSlots;
            if (presetSlots && slots && JSON.stringify(slots) !== JSON.stringify(presetSlots)) {
                const first = slots[course.startSection - 1];
                const last = slots[course.endSection - 1];
                if (first && last) {
                    course.isCustomTime = true;
                    course.customStartTime = first.startTime;
                    course.customEndTime = last.endTime;
                }
            }
            return course;
        });
        const merged = mergeCourses(courses);

        // 课表配置
        const maxWeek = Math.max(0, ...merged.map((course) => Math.max(...course.weeks)));
        const config = { semesterTotalWeeks: Math.max(calendar ? calendar.totalWeeks : 0, maxWeek, 1) };
        if (calendar) {
            config.semesterStartDate = calendar.startDate;
            config.firstDayOfWeek = calendar.firstDayOfWeek;
        }
        const firstWeekday = Number(text(courseData.qsxqj));
        if (firstWeekday >= 1 && firstWeekday <= 7) config.firstDayOfWeek = firstWeekday;
        if (presetSlots) {
            const classDuration = toMinutes(presetSlots[0].endTime) - toMinutes(presetSlots[0].startTime);
            if (classDuration > 0) config.defaultClassDuration = classDuration;
            if (presetSlots.length > 1) {
                const breakDuration = toMinutes(presetSlots[1].startTime) - toMinutes(presetSlots[0].endTime);
                if (breakDuration > 0) config.defaultBreakDuration = breakDuration;
            }
        }

        await bridge.saveImportedCourses(JSON.stringify(merged));
        if (presetSlots) await bridge.savePresetTimeSlots(JSON.stringify(presetSlots));
        await bridge.saveCourseConfig(JSON.stringify(config));

        // 课表下方"未确认上课节次"的安排（实践课程、网络课程等）无法排进课表，直接忽略；
        // 只有本校区作息没取到时才提示一次
        if (!presetSlots) {
            await bridge.showAlert('导入完成',
                `${term.xnmText} 学年第 ${term.xqmText} 学期：已导入 ${merged.length} 条排课记录。\n\n` +
                '未能读取本校区节次作息，已跳过作息导入，请在应用内手动设置节次时间。', '知道了');
        }

        native.showToast(`课程导入成功，共导入 ${merged.length} 条排课记录！`);
        native.notifyTaskCompletion();
    } catch (error) {
        await bridge.showAlert('江苏科技大学课表导入失败', (error && error.message) || String(error), '知道了');
    } finally {
        delete window.__justImportRunning;
    }
})();
