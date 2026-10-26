const STANDARD_TIME_SLOTS = [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:55", endTime: "09:40" },
    { number: 3, startTime: "10:00", endTime: "10:45" },
    { number: 4, startTime: "10:55", endTime: "11:40" },
    { number: 5, startTime: "14:00", endTime: "14:45" },
    { number: 6, startTime: "14:50", endTime: "15:35" },
    { number: 7, startTime: "15:55", endTime: "16:40" },
    { number: 8, startTime: "16:45", endTime: "17:30" },
    { number: 9, startTime: "18:30", endTime: "19:15" },
    { number: 10, startTime: "19:20", endTime: "20:05" },
    { number: 11, startTime: "20:10", endTime: "20:55" }
];

const CAMPUS_TIME_SLOTS = {
    "新庄校区": STANDARD_TIME_SLOTS,
    "淮安校区": STANDARD_TIME_SLOTS,
    "白马校区": [
        { number: 1, startTime: "08:30", endTime: "09:15" },
        { number: 2, startTime: "09:20", endTime: "10:05" },
        { number: 3, startTime: "10:25", endTime: "11:10" },
        { number: 4, startTime: "11:15", endTime: "12:00" },
        { number: 5, startTime: "14:00", endTime: "14:45" },
        { number: 6, startTime: "14:50", endTime: "15:35" },
        { number: 7, startTime: "15:55", endTime: "16:40" },
        { number: 8, startTime: "16:45", endTime: "17:30" },
        { number: 9, startTime: "18:30", endTime: "19:15" },
        { number: 10, startTime: "19:20", endTime: "20:05" },
        { number: 11, startTime: "20:10", endTime: "20:55" }
    ]
};

const CAMPUS_KEYWORDS = [
    { campus: "淮安校区", keywords: ["淮安校区"] },
    { campus: "白马校区", keywords: ["白马校区"] },
    { campus: "新庄校区", keywords: ["新庄校区"] }
];

function cleanPosition(position) {
    return String(position || "")
        .replace(/^(新庄校区|淮安校区|白马校区)/, "")
        .replace(/[（(]\d+人[)）]\s*$/g, "")
        .trim() || "待定";
}

function showToast(message) {
    if (typeof window.shiguangBridge !== "undefined") {
        window.shiguangBridge.showToast(message);
    } else {
        console.log(message);
    }
}

function parseWeeks(rawText) {
    if (!rawText) return [];

    const weekPart = String(rawText)
        .replace(/\s+/g, "")
        .replace(/\(周\).*/, "")
        .replace(/周次[:：]?/g, "");

    const weeks = new Set();
    weekPart.split(/[,，]/).forEach((segment) => {
        if (!segment) return;

        const isOdd = segment.includes("单");
        const isEven = segment.includes("双");
        const cleaned = segment.replace(/[单双周]/g, "");
        const match = cleaned.match(/^(\d+)(?:-(\d+))?$/);
        if (!match) return;

        const start = Number(match[1]);
        const end = Number(match[2] || match[1]);
        for (let week = start; week <= end; week++) {
            if (isOdd && week % 2 === 0) continue;
            if (isEven && week % 2 !== 0) continue;
            weeks.add(week);
        }
    });

    return Array.from(weeks).sort((a, b) => a - b);
}

function detectCampusOrNull(...texts) {
    const text = texts
        .filter(Boolean)
        .map((item) => String(item))
        .join(" ");

    for (const item of CAMPUS_KEYWORDS) {
        if (item.keywords.some((keyword) => text.includes(keyword))) {
            return item.campus;
        }
    }
    return null;
}

function readLineTexts(div) {
    const cloned = div.cloneNode(true);
    cloned.querySelectorAll(".item-box").forEach((node) => node.remove());
    return cloned.innerHTML
        .split(/<br\s*\/?>/i)
        .map((line) => line.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
}

function extractCourseName(lines) {
    const metadataPrefixes = ["通知单编号", "班级", "备注"];
    const metadataKeywords = ["周", "节", "教师", "教室", "校区"];
    const nameLines = [];

    for (const line of lines) {
        if (!line) continue;
        if (metadataPrefixes.some((prefix) => line.startsWith(prefix))) break;
        if (metadataKeywords.some((keyword) => line.includes(keyword))) break;
        nameLines.push(line);
    }

    return nameLines.join("").trim();
}

function parseCourseBlock(blockHtml, fallbackDay) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = blockHtml;

    const lines = readLineTexts(tempDiv);
    if (!lines.length) return null;

    let name = extractCourseName(lines);
    const teacher = tempDiv.querySelector('font[title="教师"]')?.innerText.trim() || "未知";
    if (teacher && name && name !== teacher && name.endsWith(teacher)) {
        name = name.slice(0, -teacher.length).trim();
    }
    const positionRaw = tempDiv.querySelector('font[title="教室"]')?.innerText.trim() || "待定";
    const building = tempDiv.querySelector('font[title="教学楼"]')?.innerText.trim()
        || tempDiv.querySelector('font[name="jxlmc"]')?.innerText.trim()
        || "";
    const position = cleanPosition(positionRaw);
    const timeText = tempDiv.querySelector('font[title="周次(节次)"]')?.innerText.trim() || "";
    if (!timeText) return null;

    const weekMatch = timeText.match(/^(.*?)\(周\)/);
    const sectionMatch = timeText.match(/\[(\d+)(?:-(\d+))?(?:-(\d+))?(?:-(\d+))?节\]/);
    const weeks = parseWeeks(weekMatch ? weekMatch[1] : timeText);

    let startSection = 0;
    let endSection = 0;
    if (sectionMatch) {
        const values = sectionMatch.slice(1).filter(Boolean).map(Number);
        startSection = values[0];
        endSection = values[values.length - 1];
    }

    if (!name || !weeks.length || !startSection || !endSection) return null;

    return {
        name,
        teacher,
        position,
        day: fallbackDay,
        startSection,
        endSection,
        weeks,
        campus: detectCampusOrNull(positionRaw, building, lines.join(" "))
    };
}

function extractCoursesFromDoc(doc) {
    const table = doc.getElementById("timetable");
    if (!table) {
        throw new Error("未获取到课表表格，请确认当前账号已登录教务系统。");
    }

    const rows = Array.from(table.querySelectorAll("tr")).slice(1, -1);
    const courses = [];

    rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        cells.forEach((cell, index) => {
            const day = index + 1;
            const detailDivs = cell.querySelectorAll("div.kbcontent");
            detailDivs.forEach((div) => {
                const html = div.innerHTML.trim();
                if (!html || html === "&nbsp;") return;

                const blocks = html.split(/-{10,}\s*<br\s*\/?>/i).filter((item) => item.trim());
                if (!blocks.length) blocks.push(html);

                blocks.forEach((block) => {
                    const course = parseCourseBlock(block, day);
                    if (course) {
                        courses.push(course);
                    }
                });
            });
        });
    });

    const uniqueMap = new Map();
    courses.forEach((course) => {
        const key = [
            course.name,
            course.teacher,
            course.position,
            course.day,
            course.startSection,
            course.endSection,
            course.weeks.join(",")
        ].join("|");
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, course);
        }
    });

    return Array.from(uniqueMap.values());
}

function choosePrimaryCampus(courses) {
    for (const course of courses) {
        if (course.campus) {
            return course.campus;
        }
    }
    return "新庄校区";
}

function normalizeCourses(courses, primaryCampus) {
    return courses.map((course) => {
        return {
            name: course.name,
            teacher: course.teacher,
            position: course.position,
            day: course.day,
            startSection: course.startSection,
            endSection: course.endSection,
            weeks: course.weeks,
            campus: course.campus || primaryCampus
        };
    });
}

function parseSemesterOptions(doc) {
    const select = doc.getElementById("xnxq01id");
    if (!select) return { labels: [], values: [], defaultIndex: 0 };

    const labels = [];
    const values = [];
    let defaultIndex = 0;

    Array.from(select.querySelectorAll("option")).forEach((option) => {
        labels.push(option.innerText.trim());
        values.push(option.value);
        if (option.selected || option.hasAttribute("selected")) {
            defaultIndex = labels.length - 1;
        }
    });

    return { labels, values, defaultIndex };
}

async function fetchTermDoc(termValue) {
    const body = new URLSearchParams();
    if (termValue) body.append("xnxq01id", termValue);

    const response = await fetch("/jsxsd/xskb/xskb_list.do", {
        method: termValue ? "POST" : "GET",
        headers: termValue ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
        body: termValue ? body.toString() : undefined,
        credentials: "include"
    });

    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
}

async function pickTerm(doc) {
    const { labels, values, defaultIndex } = parseSemesterOptions(doc);
    if (!labels.length || typeof window.shiguangBridgePromise === "undefined") {
        return { doc, termLabel: labels[defaultIndex] || "" };
    }

    const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
        "请选择要导入的学期",
        JSON.stringify(labels),
        defaultIndex
    );
    if (selectedIndex === null || selectedIndex === -1) {
        throw new Error("已取消导入");
    }

    if (selectedIndex === defaultIndex) {
        return { doc, termLabel: labels[selectedIndex] };
    }

    const selectedDoc = await fetchTermDoc(values[selectedIndex]);
    return { doc: selectedDoc, termLabel: labels[selectedIndex] };
}

async function saveToApp(courses, primaryCampus) {
    const timeSlots = CAMPUS_TIME_SLOTS[primaryCampus];
    const allWeeks = courses.flatMap((course) => course.weeks || []);
    const semesterTotalWeeks = allWeeks.length ? Math.max(...allWeeks) : 20;

    if (typeof window.shiguangBridgePromise === "undefined") {
        console.log("Primary campus:", primaryCampus);
        console.log("Time slots:", timeSlots);
        console.log("Courses:", courses);
        alert(`解析完成：${primaryCampus}，共 ${courses.length} 门课程。请查看控制台输出。`);
        return;
    }

    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify({
        semesterTotalWeeks,
        firstDayOfWeek: 1
    }));
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
    const appCourses = courses.map(({ campus, ...course }) => course);
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(appCourses));
}

async function runImportFlow() {
    try {
        showToast("正在获取 NJFU 课表数据...");
        const initialDoc = await fetchTermDoc("");
        const { doc, termLabel } = await pickTerm(initialDoc);
        const parsedCourses = extractCoursesFromDoc(doc);

        if (!parsedCourses.length) {
            throw new Error("未解析到课程，请确认当前账号已登录教务系统。");
        }

        const primaryCampus = choosePrimaryCampus(parsedCourses);
        const courses = normalizeCourses(parsedCourses, primaryCampus);

        await saveToApp(courses, primaryCampus);

        const message = `导入完成：${primaryCampus}${termLabel ? ` ${termLabel}` : ""}`;

        showToast(message);
        if (typeof window.shiguangBridge !== "undefined") {
            window.shiguangBridge.notifyTaskCompletion();
        }
    } catch (error) {
        console.error(error);
        showToast(`导入失败: ${error.message}`);
    }
}

runImportFlow();
