/**
 * 广东海洋大学阳江校区教务适配（备用通道）
 * @date 2026-9-12
 * @author Yihe-ng，海大百事通
 * @version 1.0
 *
 * 教务系统不可用时的备用通道：数据取自教学质量综合评价系统（jxpj.gdou.edu.cn），
 * 校内外均可直连，无需 VPN 或校园网。
 * 该系统课表与教务同源同步，字段含周次、星期、节次、教室，可直接生成课表。
 * 该方法由海大百事通与20260912发现
 *
 * 接口链路（均为同源请求，复用页面登录态）：
 *   POST /apiservice/University/GetAllSemester          学期列表
 *   POST /mita/prepare/timetable/setting                学期设置（总周数、当前周、当前周周一）
 *   POST /mita/online/message/student/course/list        学生课程列表（含教师工号）
 *   POST /mita/prepare/timetable/timetables              按教师查询全学期排课
 *
 * 两处报文字段沿用服务端约定（非笔误）：学期参数名为 semeter；请求体需加密并追加固定后缀。
 */

(function () {

// ==================== 常量 ====================

const AES_KEY = "nfZYwnW2ppQc3CXr";
const AES_SUFFIX = "d^PrEK&c";

const API_SEMESTER_LIST = "/apiservice/University/GetAllSemester";
const API_TIMETABLE_SETTING = "/prepare/timetable/setting";
const API_COURSE_LIST = "/online/message/student/course/list";
const API_TIMETABLE = "/prepare/timetable/timetables";

const DEFAULT_TOTAL_WEEKS = 20;

// 单次请求超时。若服务端不响应，fetch 会一直挂起，流程既无法失败也无法返回。
const REQUEST_TIMEOUT_MS = 20000;

// 阳江校区慎思楼上课时间
const TimeSlots = [
    { number: 1, startTime: "08:10", endTime: "08:55" },
    { number: 2, startTime: "09:05", endTime: "09:50" },
    { number: 3, startTime: "10:20", endTime: "11:05" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:20", endTime: "17:05" },
    { number: 8, startTime: "17:10", endTime: "17:55" },
    { number: 9, startTime: "19:30", endTime: "20:15" },
    { number: 10, startTime: "20:25", endTime: "21:10" }
];

/**
 * 阳江校区其他场地（非慎思楼）的作息。
 * 只有第 3、4 节在校区作息表中是不同的连续时间块，使用自定义时间表示。
 * 貌似无法动态获取时间
 */
const OTHER_VENUE_SECTION_3_4_TIME = { startTime: "10:10", endTime: "11:40" };

// ==================== AES-128-ECB 加密 ====================

function utf8Bytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return bytes;
}

function gfMultiply(a, b) {
    let product = 0;
    for (let i = 0; i < 8; i++) {
        if (b & 1) product ^= a;
        const highBit = a & 0x80;
        a = (a << 1) & 0xff;
        if (highBit) a ^= 0x1b;
        b >>= 1;
    }
    return product & 0xff;
}

function gfPower(base, exponent) {
    let result = 1;
    while (exponent > 0) {
        if (exponent & 1) result = gfMultiply(result, base);
        base = gfMultiply(base, base);
        exponent >>= 1;
    }
    return result;
}

const S_BOX = (function () {
    const box = new Array(256);
    for (let i = 0; i < 256; i++) {
        const inverse = i === 0 ? 0 : gfPower(i, 254);
        let value = 0;
        for (let bit = 0; bit < 8; bit++) {
            const b = ((inverse >> bit) & 1)
                ^ ((inverse >> ((bit + 4) % 8)) & 1)
                ^ ((inverse >> ((bit + 5) % 8)) & 1)
                ^ ((inverse >> ((bit + 6) % 8)) & 1)
                ^ ((inverse >> ((bit + 7) % 8)) & 1)
                ^ ((0x63 >> bit) & 1);
            value |= b << bit;
        }
        box[i] = value & 0xff;
    }
    return box;
})();

function expandKey(keyBytes) {
    const words = [];
    for (let i = 0; i < 4; i++) {
        words[i] = ((keyBytes[4 * i] << 24) | (keyBytes[4 * i + 1] << 16)
            | (keyBytes[4 * i + 2] << 8) | keyBytes[4 * i + 3]) >>> 0;
    }
    let roundConstant = 1;
    for (let i = 4; i < 44; i++) {
        let temp = words[i - 1];
        if (i % 4 === 0) {
            temp = ((temp << 8) | (temp >>> 24)) >>> 0;
            temp = ((S_BOX[(temp >>> 24) & 0xff] << 24)
                | (S_BOX[(temp >>> 16) & 0xff] << 16)
                | (S_BOX[(temp >>> 8) & 0xff] << 8)
                | S_BOX[temp & 0xff]) >>> 0;
            temp = (temp ^ (roundConstant << 24)) >>> 0;
            roundConstant = gfMultiply(roundConstant, 2);
        }
        words[i] = (words[i - 4] ^ temp) >>> 0;
    }
    return words;
}

function addRoundKey(state, words, round) {
    for (let column = 0; column < 4; column++) {
        const word = words[4 * round + column];
        state[4 * column] ^= (word >>> 24) & 0xff;
        state[4 * column + 1] ^= (word >>> 16) & 0xff;
        state[4 * column + 2] ^= (word >>> 8) & 0xff;
        state[4 * column + 3] ^= word & 0xff;
    }
}

function subBytes(state) {
    for (let i = 0; i < 16; i++) state[i] = S_BOX[state[i]];
}

function shiftRows(state) {
    let temp = state[1];
    state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = temp;
    temp = state[2]; state[2] = state[10]; state[10] = temp;
    temp = state[6]; state[6] = state[14]; state[14] = temp;
    temp = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = state[3]; state[3] = temp;
}

function mixColumns(state) {
    for (let column = 0; column < 4; column++) {
        const i = 4 * column;
        const a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
        const all = a0 ^ a1 ^ a2 ^ a3;
        state[i] = a0 ^ all ^ gfMultiply(a0 ^ a1, 2);
        state[i + 1] = a1 ^ all ^ gfMultiply(a1 ^ a2, 2);
        state[i + 2] = a2 ^ all ^ gfMultiply(a2 ^ a3, 2);
        state[i + 3] = a3 ^ all ^ gfMultiply(a3 ^ a0, 2);
    }
}

function encryptBlock(words, input) {
    const state = input.slice();
    addRoundKey(state, words, 0);
    for (let round = 1; round <= 9; round++) {
        subBytes(state);
        shiftRows(state);
        mixColumns(state);
        addRoundKey(state, words, round);
    }
    subBytes(state);
    shiftRows(state);
    addRoundKey(state, words, 10);
    return state;
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes) {
    let output = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        output += BASE64_CHARS[b0 >> 2];
        output += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
        output += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
        output += i + 2 < bytes.length ? BASE64_CHARS[b2 & 0x3f] : "=";
    }
    return output;
}

function encryptPayload(plainText) {
    const key = utf8Bytes(AES_KEY);
    const data = utf8Bytes(plainText + AES_SUFFIX);

    const padLength = 16 - (data.length % 16);
    for (let i = 0; i < padLength; i++) data.push(padLength);

    const words = expandKey(key);
    const output = [];
    for (let offset = 0; offset < data.length; offset += 16) {
        const block = encryptBlock(words, data.slice(offset, offset + 16));
        for (let i = 0; i < 16; i++) output.push(block[i]);
    }
    return bytesToBase64(output);
}

// ==================== 会话与请求 ====================

function readStorageJson(storage, key) {
    try {
        return JSON.parse(storage.getItem(key) || "null");
    } catch (error) {
        return null;
    }
}

/**
 * 读取登录用户信息。
 * 该系统的桌面端将 current-user 存于 localStorage，微信/移动端存于 sessionStorage，
 * 应用中打开的是移动端，故两处都必须尝试。
 */
function readCurrentUser() {
    return readStorageJson(sessionStorage, "current-user")
        || readStorageJson(localStorage, "current-user");
}

function readClientId() {
    const visitor = readStorageJson(localStorage, "visitorObj");
    return visitor && visitor.ClientId ? visitor.ClientId : "";
}

function readCachedSemester() {
    const cached = readStorageJson(sessionStorage, "semester")
        || readStorageJson(localStorage, "semester");
    return cached && cached.key ? String(cached.key) : "";
}

/**
 * 解析用户标识。移动端以 realCode 作为实际账号，桌面端仅提供 Code，故需回退。
 */
function resolveUserCode(user) {
    return String((user && (user.realCode || user.Code)) || "");
}

function formatNow() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildSystemParams(user, clientId, apiName, semester) {
    return {
        DegreeLevel: 0,
        Token: user.Token,
        UserCode: resolveUserCode(user),
        UniversityCode: user.UniversityCode,
        ApiName: apiName,
        ClientTime: formatNow(),
        ClientId: clientId,
        ClientType: 0,
        Semester: semester,
        RequestOriginPageAddress: window.location.href
    };
}

/**
 * 带超时的 fetch。旧版 WebView 可能没有 AbortController，此时退化为普通请求。
 */
async function fetchWithTimeout(url, options) {
    if (typeof AbortController === "undefined") {
        return await fetch(url, options);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
        clearTimeout(timer);
    }
}

async function postApi(user, clientId, path, apiName, semester, requestParams) {
    const payload = {
        SystemParams: buildSystemParams(user, clientId, apiName, semester),
        RequestParams: requestParams || {}
    };

    const response = await fetchWithTimeout(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "token": user.Token
        },
        body: encryptPayload(JSON.stringify(payload)),
        credentials: "include"
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
}

async function postMita(user, clientId, path, semester, params) {
    const userCode = resolveUserCode(user);
    const merged = Object.assign(
        {
            teacherCode: userCode,
            teacherName: user.Name,
            semeter: semester,
            schoolCode: user.UniversityCode,
            currentUser: userCode,
            Token: user.Token,
            ClientId: clientId
        },
        params || {},
        { RequestOriginPageAddress: window.location.href }
    );

    const response = await fetchWithTimeout("/mita" + path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "token": user.Token
        },
        body: encryptPayload(JSON.stringify(merged)),
        credentials: "include"
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
}

// ==================== 数据转换 ====================

function padTwo(value) {
    return String(value).padStart(2, "0");
}

/**
 * 由「当前周」与「当前周周一日期」反推学期第一周的周一日期。
 * 服务端返回的 firstOfWeek 是当前周的周一，需按已过周数向前回退。
 */
function deriveSemesterStartDate(firstOfWeek, currentWeek) {
    const text = String(firstOfWeek || "").trim();
    const matched = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!matched) return null;

    const week = Number(currentWeek);
    const offsetDays = Number.isInteger(week) && week > 0 ? (week - 1) * 7 : 0;

    const date = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
    if (isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - offsetDays);

    return `${date.getUTCFullYear()}-${padTwo(date.getUTCMonth() + 1)}-${padTwo(date.getUTCDate())}`;
}

function getOtherVenueCustomTime(position, startSection, endSection) {
    const positionText = position == null ? "" : String(position);
    if (!positionText || positionText.includes("慎思楼")) return null;
    if (startSection !== 3 || endSection !== 4) return null;
    return OTHER_VENUE_SECTION_3_4_TIME;
}

function normalizeWeek(value) {
    const week = Number(value);
    return Number.isInteger(week) && week > 0 ? week : null;
}

function normalizeSection(value) {
    const section = Number(value);
    return Number.isInteger(section) && section >= 1 ? section : null;
}

function splitClassNames(value) {
    return String(value == null ? "" : value)
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * 从教师排课记录中筛选属于该学生的课程。
 * 评价系统的 classCode 与排课系统可能不同源，故先按 classCode 精确匹配，
 * 未命中时退回按班级名称匹配。
 */
function pickStudentEntries(entries, course) {
    const sameCourse = entries.filter((entry) => entry.courseCode === course.courseCode);
    if (sameCourse.length === 0) return [];

    const byClassCode = sameCourse.filter((entry) => entry.classCode === course.classCode);
    if (byClassCode.length > 0) return byClassCode;

    const classNames = splitClassNames(course.className);
    if (classNames.length === 0) return [];

    return sameCourse.filter((entry) => (entry.reTimetableClasses || []).some((item) =>
        splitClassNames(item.className).some((name) => classNames.indexOf(name) !== -1)
    ));
}

function toCourseKey(course) {
    return [course.name, course.teacher, course.position, course.day,
        course.startSection, course.endSection].join("\u0001");
}

/**
 * 节次与周次合并去重。
 * 取自官方 wiki《课程合并与去重函数》的参考实现，未作改动；
 * 用于把服务端可能返回的「逐节」或「分段周次」记录归一为连续区间。
 */
function mergeAndDistinctCourses(courses) {
    if (!Array.isArray(courses) || courses.length <= 1) return courses;

    const list = courses.map(c => ({
        ...c,
        name: c.name || '',
        teacher: c.teacher || '',
        position: c.position || '',
        weeks: Array.isArray(c.weeks) ? [...c.weeks].sort((a, b) => a - b) : []
    }));

    list.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        a.weeks.join(',').localeCompare(b.weeks.join(',')) ||
        (a.startSection || 0) - (b.startSection || 0)
    );

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
            current.endSection = next.endSection;
        } else if (isSameCourseAndWeeks && isDuplicate) {
            continue;
        } else {
            step1Merged.push(current);
            current = next;
        }
    }
    step1Merged.push(current);

    step1Merged.sort((a, b) =>
        a.name.localeCompare(b.name) ||
        a.teacher.localeCompare(b.teacher) ||
        a.position.localeCompare(b.position) ||
        (a.day || 0) - (b.day || 0) ||
        (a.startSection || 0) - (b.startSection || 0) ||
        (a.endSection || 0) - (b.endSection || 0)
    );

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
 * 为其他场地第 3-4 节补充自定义时间。
 * 必须在合并之后调用：只有先合并成完整的 3-4 节，才满足自定义时间的匹配条件。
 */
function applyOtherVenueCustomTime(course) {
    const customTime = getOtherVenueCustomTime(
        course.position,
        course.startSection,
        course.endSection
    );
    if (!customTime) return course;

    return Object.assign({}, course, {
        isCustomTime: true,
        customStartTime: customTime.startTime,
        customEndTime: customTime.endTime
    });
}

function aggregateCourses(entries, course) {
    const merged = new Map();

    entries.forEach((entry) => {
        const week = normalizeWeek(entry.onweek);
        const startSection = normalizeSection(entry.seqStart);
        const endSection = normalizeSection(entry.seqEnd);
        const day = normalizeSection(entry.dayOfWeek);

        if (week === null || startSection === null || endSection === null || day === null) return;
        if (day < 1 || day > 7 || endSection < startSection) return;

        const position = entry.address == null ? "" : String(entry.address).trim();
        const item = {
            name: String(entry.courseName || course.courseName || "").trim(),
            teacher: String(entry.teacherName || course.teacherName || "").trim(),
            position: position,
            day: day,
            startSection: startSection,
            endSection: endSection
        };

        const key = toCourseKey(item);
        if (!merged.has(key)) {
            merged.set(key, Object.assign({}, item, { weeks: [] }));
        }

        const target = merged.get(key);
        if (target.weeks.indexOf(week) === -1) target.weeks.push(week);
    });

    return mergeAndDistinctCourses(Array.from(merged.values()))
        .map(applyOtherVenueCustomTime);
}

function sortCourses(courses) {
    return courses.sort((a, b) =>
        a.day - b.day
        || a.startSection - b.startSection
        || a.name.localeCompare(b.name, "zh-Hans-CN")
    );
}

// ==================== 数据获取 ====================

function describeError(error) {
    return error && error.message ? error.message : String(error);
}

async function fetchSemesters(user, clientId) {
    const data = await postApi(user, clientId, API_SEMESTER_LIST,
        "University/GetAllSemester", user.CurrentSemester, {});

    if (!data || data.Success !== true || !Array.isArray(data.Value)) return [];

    return data.Value
        .map((item) => ({
            key: String(item.key || "").trim(),
            name: String(item.name || item.key || "").trim(),
            selected: item.selected === true
        }))
        .filter((item) => item.key);
}

async function fetchSemesterSetting(user, clientId, semester) {
    try {
        const data = await postMita(user, clientId, API_TIMETABLE_SETTING, semester, {});
        if (!data || data.success !== true || !data.result) return null;

        return {
            currentWeek: Number(data.result.currentWeek) || null,
            firstOfWeek: data.result.firstOfWeek || null
        };
    } catch (error) {
        console.warn("JS: 读取学期设置失败:", error);
        return null;
    }
}

async function fetchCourseList(user, clientId, semester) {
    const data = await postMita(user, clientId, API_COURSE_LIST, semester, {
        pageNum: "1",
        pageSize: "999",
        studentCode: resolveUserCode(user),
        isAdmin: "0"
    });

    if (!data || data.success !== true || !data.result) return [];
    return Array.isArray(data.result.result) ? data.result.result : [];
}

async function fetchTeacherTimetable(user, clientId, semester, teacherCode) {
    const data = await postMita(user, clientId, API_TIMETABLE, semester, {
        onweek: null,
        teacherCode: teacherCode
    });

    if (!data || data.success !== true) return [];
    return Array.isArray(data.result) ? data.result : [];
}

async function collectCourses(user, clientId, semester) {
    const courseList = await fetchCourseList(user, clientId, semester);
    if (courseList.length === 0) return null;

    const byTeacher = new Map();
    courseList.forEach((course) => {
        const teacherCode = String(course.teacherCode || "").trim();
        if (!teacherCode) return;
        if (!byTeacher.has(teacherCode)) byTeacher.set(teacherCode, []);
        byTeacher.get(teacherCode).push(course);
    });

    const teacherCodes = Array.from(byTeacher.keys());
    const timetables = await Promise.all(teacherCodes.map((teacherCode) =>
        fetchTeacherTimetable(user, clientId, semester, teacherCode)
            .catch((error) => {
                console.warn(`JS: 读取教师 ${teacherCode} 排课失败:`, error);
                return [];
            })
    ));

    const courses = [];
    teacherCodes.forEach((teacherCode, index) => {
        const entries = timetables[index];
        if (!entries.length) return;

        byTeacher.get(teacherCode).forEach((course) => {
            const picked = pickStudentEntries(entries, course);
            if (picked.length === 0) return;
            courses.push.apply(courses, aggregateCourses(picked, course));
        });
    });

    return sortCourses(courses);
}

// ==================== 用户交互 ====================

function showToast(message) {
    window.shiguangBridge.showToast(message);
}

async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "广东海洋大学阳江校区课表导入（备用通道）",
        "本适配器通过接口直接获取课表，无需停留在课表页面。\n\n"
        + "导入步骤：\n"
        + "1. 确认已登录教学质量综合评价系统（未登录请先完成统一认证）\n"
        + "2. 停留在任意页面即可，无需切换\n"
        + "3. 点击「执行导入」\n\n"
        + "说明：数据取自教学评价系统，部分课程可能缺失，可手动补录。",
        "我已登录，开始导入"
    );
}

async function promptUserToLogin() {
    return await window.shiguangBridgePromise.showAlert(
        "需要先登录",
        "未检测到登录状态，请先在本页面完成登录：\n\n"
        + "1. 页面若显示登录框，输入账号密码登录\n"
        + "2. 若已登录但提示本消息，请稍候几秒后重新点击「执行导入」\n\n"
        + "登录成功后无需切换页面，直接点击「执行导入」即可。",
        "我知道了"
    );
}

async function selectSemester(user, clientId) {
    let semesters = [];
    try {
        semesters = await fetchSemesters(user, clientId);
    } catch (error) {
        console.warn("JS: 读取学期列表失败:", error);
    }

    const fallback = String(user.CurrentSemester || "").trim() || readCachedSemester();
    if (semesters.length === 0) {
        if (!fallback) return null;
        return { key: fallback, name: fallback };
    }

    const labels = semesters.map((item) => item.name);
    let defaultIndex = semesters.findIndex((item) => item.selected);
    if (defaultIndex === -1) defaultIndex = semesters.findIndex((item) => item.key === fallback);
    if (defaultIndex === -1) defaultIndex = 0;

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(labels),
        defaultIndex
    );

    if (selectedIndex === null || selectedIndex === -1 || !semesters[selectedIndex]) return null;
    return semesters[selectedIndex];
}

async function saveCourseConfig(config) {
    try {
        await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        return true;
    } catch (error) {
        showToast(`课表配置保存失败: ${describeError(error)}`);
        return false;
    }
}

async function saveCourses(courses) {
    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        return true;
    } catch (error) {
        showToast(`课程保存失败: ${describeError(error)}`);
        return false;
    }
}

async function importPresetTimeSlots() {
    if (TimeSlots.length === 0) return;

    try {
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(TimeSlots));
    } catch (error) {
        console.warn("JS: 预设时间段导入失败:", error);
        showToast("预设时间段导入失败，可稍后手动设置。");
    }
}

// ==================== 流程编排 ====================

/**
 * 识别是否停留在统一认证相关页面。
 * 学校统一认证存在缺陷：认证完成后偶发不回跳到本应用，而落到统一认证自身的页面，
 * 此时登录其实已成功，但本应用读不到登录态，需引导用户退回后再导入。
 *
 * 认证平台对桌面端与移动端提供不同页面，两者都要覆盖：
 *   个人信息中心  桌面 /personalInfo/personCenter/，移动 /personalInfo/personalMobile/
 *   密码找回页面  桌面 /retrieve-password/retrievePassword/，移动 /retrieve-password/passwordMobile/
 * 故按目录前缀匹配而非具体页面名。
 *
 * 各路径验证程度：
 *   个人信息中心    移动版路径由实机反馈确认；桌面版复现路径为
 *                  已认证 + 无 service 访问认证入口 → /authserver/index.do → /personalInfo/personCenter/。
 *   密码找回页面    移动版 /retrieve-password/passwordMobile/ 实测渲染「找回密码」，
 *                  且移动版认证页的「忘记密码」链接正指向该地址并追加 service 参数。
 *
 * 判定依据为 URL 路径：登录态存于评价系统域，认证域与之跨域、读不到，只能靠当前地址判断。
 */
function detectAuthPage() {
    const href = String(window.location.href);
    if (href.indexOf("/personalInfo/") !== -1) return "个人信息中心";
    if (href.indexOf("/retrieve-password/") !== -1) return "密码找回页面";
    if (href.indexOf("authserver.") !== -1) return "统一身份认证页面";
    return "";
}

async function promptWrongPage(pageName) {
    return await window.shiguangBridgePromise.showAlert(
        "请先返回评价系统",
        `当前停留在「${pageName}」，无法获取课表数据。\n\n`
        + "现象说明：学校统一认证平台在认证完成后，偶尔会跳转到自身的个人信息中心或密码找回页面，"
        + "此时登录其实已经成功，只是没有回到应用。\n\n"
        + "处理方式：点击左上角「返回」，回到教学质量综合评价系统页面后，再点击「执行导入」即可。",
        "我知道了"
    );
}

async function runImportFlow() {
    const authPage = detectAuthPage();
    if (authPage) {
        await promptWrongPage(authPage);
        return;
    }

    const user = readCurrentUser();
    if (!user || !user.Token) {
        await promptUserToLogin();
        return;
    }

    const alertConfirmed = await promptUserToStart();
    if (!alertConfirmed) {
        showToast("用户取消了导入。");
        return;
    }

    const clientId = readClientId();

    const semester = await selectSemester(user, clientId);
    if (!semester) {
        showToast("导入已取消。");
        return;
    }

    showToast("正在获取课程数据...");
    let courses = null;
    try {
        courses = await collectCourses(user, clientId, semester.key);
    } catch (error) {
        showToast(`获取课表失败: ${describeError(error)}`);
        return;
    }

    if (courses === null) {
        showToast("未查询到课程列表，请确认该学期有选课记录。");
        return;
    }

    if (courses.length === 0) {
        showToast("未匹配到任何排课记录，可尝试切换其他学期。");
        return;
    }

    const setting = await fetchSemesterSetting(user, clientId, semester.key);
    const config = {
        semesterTotalWeeks: DEFAULT_TOTAL_WEEKS,
        defaultClassDuration: 45,
        defaultBreakDuration: 10,
        firstDayOfWeek: 1
    };

    if (setting) {
        const startDate = deriveSemesterStartDate(setting.firstOfWeek, setting.currentWeek);
        if (startDate) config.semesterStartDate = startDate;
    }

    const configSaved = await saveCourseConfig(config);
    if (!configSaved) return;

    const coursesSaved = await saveCourses(courses);
    if (!coursesSaved) return;

    await importPresetTimeSlots();

    const tip = courses.length === 1 ? "1 门课程" : `${courses.length} 个课程时段`;
    showToast(`导入完成，共 ${tip}。部分课程可能缺失，可手动补录。`);

    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();

})();
