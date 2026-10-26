// 青海师范大学研究生教务系统拾光课表适配脚本
// 使用研究生教务系统的同源学期与课表接口，不处理账号密码或统一身份认证。

(function () {
    "use strict";

    const EXPECTED_ORIGIN = "https://yjsxt.qhnu.edu.cn";
    const SEMESTER_PATH = "/adminApi/kernel/config/xqgl/NoAuth";
    const SCHEDULE_PATH = "/adminApi/cloud-jx/api/xs/stuxkjg/NotAuth";
    // 来自学校公开前端配置。只读取这一项，不枚举或记录浏览器存储。
    const TOKEN_STORAGE_KEY = "sys-auth-token";

    const COMMON_TIME_SLOTS = {
        1: { start: "08:30", end: "09:15" },
        2: { start: "09:25", end: "10:10" },
        3: { start: "10:30", end: "11:15" },
        4: { start: "11:25", end: "12:10" }
    };

    const CAMPUS_TIME_SLOTS = {
        chengbei: Object.assign({}, COMMON_TIME_SLOTS, {
            5: { start: "14:00", end: "14:45" },
            6: { start: "14:55", end: "15:40" },
            7: { start: "15:50", end: "16:35" },
            8: { start: "16:45", end: "17:30" },
            9: { start: "19:30", end: "20:15" },
            10: { start: "20:25", end: "21:10" }
        }),
        chengxi: Object.assign({}, COMMON_TIME_SLOTS, {
            5: { start: "14:30", end: "15:15" },
            6: { start: "15:25", end: "16:10" },
            7: { start: "16:30", end: "17:15" },
            8: { start: "17:25", end: "18:10" },
            9: { start: "19:10", end: "19:55" }
        })
    };

    const CHENGBEI_PRESET_TIME_SLOTS = Object.keys(CAMPUS_TIME_SLOTS.chengbei).map(function (number) {
        const sectionNumber = Number(number);
        const slot = CAMPUS_TIME_SLOTS.chengbei[sectionNumber];
        return {
            number: sectionNumber,
            startTime: slot.start,
            endTime: slot.end
        };
    }).sort(function (left, right) {
        return left.number - right.number;
    });

    const WEEKDAY_MAP = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "日": 7,
        "天": 7
    };

    function showToast(message) {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === "function") {
            window.shiguangBridge.showToast(message);
        }
    }

    async function showAlert(title, message, buttonText) {
        if (!window.shiguangBridgePromise || typeof window.shiguangBridgePromise.showAlert !== "function") {
            throw new Error("当前环境不支持拾光课表导入弹窗，请在拾光课程表中重试。");
        }
        return await window.shiguangBridgePromise.showAlert(title, message, buttonText || "确定");
    }

    function assertSystemOrigin() {
        if (window.location.origin !== EXPECTED_ORIGIN) {
            throw new Error("请先进入青海师范大学研究生教务系统后再导入。");
        }
    }

    function getRuntimeToken() {
        let token = null;
        try {
            token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
        } catch (error) {
            throw new Error("无法读取登录状态，请重新登录研究生教务系统后重试。");
        }
        if (typeof token !== "string" || token.trim() === "") {
            throw new Error("未检测到有效登录状态，请重新登录研究生教务系统后重试。");
        }
        return token.trim();
    }

    async function requestJson(requestUrl, runtimeToken, resourceLabel) {
        let response;
        try {
            response = await fetch(requestUrl.toString(), {
                method: "GET",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Authorization": "Bearer " + runtimeToken
                }
            });
        } catch (error) {
            throw new Error(resourceLabel + "请求未能发送，请检查网络后重试。");
        }

        if (response.status === 401 || response.status === 403) {
            throw new Error("登录状态已失效或无" + resourceLabel + "访问权限，请重新登录研究生教务系统后重试。");
        }
        if (!response.ok) {
            throw new Error(resourceLabel + "请求失败（HTTP " + response.status + "），请稍后重试。");
        }

        const responseText = await response.text();
        if (/^\s*</.test(responseText)) {
            throw new Error(resourceLabel + "接口返回了登录页面，请重新登录后重试。");
        }

        try {
            return JSON.parse(responseText);
        } catch (error) {
            throw new Error(resourceLabel + "接口未返回有效 JSON，学校系统接口可能已调整。");
        }
    }

    async function fetchAllSemesterOptions(runtimeToken) {
        return await fetchAllPages(
            async function (page) {
                const requestUrl = new URL(SEMESTER_PATH, EXPECTED_ORIGIN);
                requestUrl.searchParams.set("page", String(page));
                requestUrl.searchParams.set("size", "999");
                requestUrl.searchParams.set("sort", "xqdm,desc");
                const payload = await requestJson(requestUrl, runtimeToken, "学期列表");
                const pageResult = validatePageResponse(payload, "学期列表");
                return {
                    totalElements: pageResult.totalElements,
                    content: pageResult.content.map(function (semester, index) {
                        if (!semester || typeof semester !== "object" || Array.isArray(semester)) {
                            throw new Error("学期列表第 " + (index + 1) + " 项结构异常。");
                        }
                        return {
                            id: requireText(semester.id, "学期列表第 " + (index + 1) + " 项 id"),
                            xqmc: requireText(semester.xqmc, "学期列表第 " + (index + 1) + " 项名称"),
                            sfdq: semester.sfdq === null || semester.sfdq === undefined ? "" : String(semester.sfdq).trim()
                        };
                    })
                };
            },
            function (semester) { return semester.id; },
            {
                empty: "学期列表为空，无法继续导入。",
                totalChanged: "学期列表分页总数发生变化，请稍后重试。",
                emptyPage: "学期列表在读取完成前返回空页，请稍后重试。",
                duplicate: "学期列表出现重复 id，请稍后重试。",
                overflow: "学期列表记录数超过接口声明总数，请稍后重试。",
                incomplete: "学期列表未完整返回，请稍后重试。"
            }
        );
    }

    async function selectSemester(runtimeToken) {
        const semesters = await fetchAllSemesterOptions(runtimeToken);
        const currentSemester = semesters.find(function (semester) {
            return String(semester.sfdq) === "0";
        });
        const seasonOrder = { "秋": 0, "夏": 1, "春": 2 };
        const semesterEntries = semesters.map(function (semester, originalIndex) {
            const match = /^(\d{4})年(春|夏|秋)季学期$/.exec(semester.xqmc);
            return {
                semester: semester,
                originalIndex: originalIndex,
                year: match ? Number(match[1]) : null,
                season: match ? match[2] : null
            };
        }).sort(function (left, right) {
            if (left.year !== null && right.year === null) return -1;
            if (left.year === null && right.year !== null) return 1;
            if (left.year !== null && right.year !== null) {
                if (left.year !== right.year) return right.year - left.year;
                const seasonDifference = seasonOrder[left.season] - seasonOrder[right.season];
                if (seasonDifference !== 0) return seasonDifference;
            }
            return left.originalIndex - right.originalIndex;
        });
        const defaultIndex = currentSemester ? semesterEntries.findIndex(function (entry) {
            return entry.semester === currentSemester;
        }) : 0;
        const selectedIndex = await window.shiguangBridgePromise.showSingleSelection(
            "请选择导入学期",
            JSON.stringify(semesterEntries.map(function (entry) {
                return entry.semester === currentSemester ?
                    entry.semester.xqmc + "（当前）" : entry.semester.xqmc;
            })),
            defaultIndex
        );
        if (selectedIndex === null || selectedIndex === undefined || selectedIndex === -1) return null;
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= semesterEntries.length) {
            throw new Error("无法识别所选学期，请重新导入。");
        }
        return semesterEntries[selectedIndex].semester;
    }

    async function fetchAllScheduleRecords(semesterCode, runtimeToken) {
        return await fetchAllPages(
            async function (page) {
                const requestUrl = new URL(SCHEDULE_PATH, EXPECTED_ORIGIN);
                requestUrl.searchParams.set("page", String(page));
                requestUrl.searchParams.set("size", "999");
                requestUrl.searchParams.set("sort", "createTime,desc");
                requestUrl.searchParams.set("xqcode", semesterCode);
                const payload = await requestJson(requestUrl, runtimeToken, "课表");
                return validatePageResponse(payload, "课表");
            },
            function (record) { return JSON.stringify(record); },
            {
                empty: "所选学期暂无课程，未保存空课表。",
                totalChanged: "课表分页总数发生变化，请稍后重新导入。",
                emptyPage: "课表分页在读取完成前返回空页，请稍后重新导入。",
                duplicate: "课表分页未继续前进，请稍后重新导入。",
                overflow: "课表分页记录数超过接口声明总数，请稍后重新导入。",
                incomplete: "课表记录未完整返回，请稍后重新导入。"
            }
        );
    }

    async function fetchAllPages(fetchPage, getSignature, messages) {
        const records = [];
        const seenSignatures = new Set();
        let expectedTotal = null;
        let page = 0;

        while (expectedTotal === null || records.length < expectedTotal) {
            const pageResult = await fetchPage(page);
            if (expectedTotal === null) {
                expectedTotal = pageResult.totalElements;
                if (expectedTotal === 0 && pageResult.content.length === 0) {
                    throw new Error(messages.empty);
                }
            } else if (pageResult.totalElements !== expectedTotal) {
                throw new Error(messages.totalChanged);
            }
            if (pageResult.content.length === 0) {
                throw new Error(messages.emptyPage);
            }

            pageResult.content.forEach(function (record) {
                const signature = getSignature(record);
                if (seenSignatures.has(signature)) {
                    throw new Error(messages.duplicate);
                }
                seenSignatures.add(signature);
                records.push(record);
            });
            if (records.length > expectedTotal) {
                throw new Error(messages.overflow);
            }
            page += 1;
        }
        if (records.length !== expectedTotal) {
            throw new Error(messages.incomplete);
        }
        return records;
    }

    function validatePageResponse(payload, resourceLabel) {
        const label = resourceLabel || "课表";
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new Error(label + "接口返回结构异常：响应根节点不是对象。");
        }
        if (!Array.isArray(payload.content)) {
            throw new Error(label + "接口返回结构异常：缺少 content 数组。");
        }
        const totalElements = payload.totalElements;
        if (!Number.isInteger(totalElements) || totalElements < 0) {
            throw new Error(label + "接口返回结构异常：totalElements 无效。");
        }
        return {
            content: payload.content,
            totalElements: totalElements
        };
    }

    function toPositiveInteger(value, fieldLabel) {
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0) {
            throw new Error(fieldLabel + "不是有效正整数。");
        }
        return number;
    }

    function uniqueSortedPositiveIntegers(values, fieldLabel) {
        const result = Array.from(new Set(values.map(function (value) {
            return toPositiveInteger(value, fieldLabel);
        }))).sort(function (left, right) {
            return left - right;
        });
        if (result.length === 0) {
            throw new Error(fieldLabel + "为空。");
        }
        return result;
    }

    function parseExplicitWeeks(value, fieldLabel) {
        const normalized = normalizeDigits(value === null || value === undefined ? "" : value);
        const matches = normalized.match(/\d+/g);
        if (!matches) {
            throw new Error(fieldLabel + "无法解析。");
        }
        return uniqueSortedPositiveIntegers(matches, fieldLabel);
    }

    function parseWeeks(schedule, courseLabel) {
        const mode = String(schedule.lxfs);
        const fieldLabel = "课程“" + courseLabel + "”的周次";
        if (mode === "3" || mode === "4") {
            return parseExplicitWeeks(schedule.skzc_Dm, fieldLabel);
        }
        if (mode !== "0" && mode !== "1" && mode !== "2") {
            throw new Error(fieldLabel + "模式无法识别。");
        }

        const startWeek = toPositiveInteger(schedule.kszc, fieldLabel + "起始值");
        const endWeek = toPositiveInteger(schedule.jszc, fieldLabel + "结束值");
        if (endWeek < startWeek) {
            throw new Error(fieldLabel + "起止范围无效。");
        }

        const weeks = [];
        for (let week = startWeek; week <= endWeek; week += 1) {
            if (mode === "1" && week % 2 === 0) continue;
            if (mode === "2" && week % 2 !== 0) continue;
            weeks.push(week);
        }
        return uniqueSortedPositiveIntegers(weeks, fieldLabel);
    }

    function normalizeDigits(value) {
        return String(value).replace(/[０-９]/g, function (digit) {
            return String.fromCharCode(digit.charCodeAt(0) - 65248);
        });
    }

    function expandSectionExpression(expression, courseLabel) {
        const normalized = normalizeDigits(expression).replace(/\s+/g, "");
        const pieces = normalized.split(/[,，、]/).filter(Boolean);
        const sections = [];

        pieces.forEach(function (piece) {
            const range = piece.match(/^(\d+)[\-~～至](\d+)$/);
            if (range) {
                const start = toPositiveInteger(range[1], "课程“" + courseLabel + "”的节次");
                const end = toPositiveInteger(range[2], "课程“" + courseLabel + "”的节次");
                if (end < start) {
                    throw new Error("课程“" + courseLabel + "”的节次范围无效。");
                }
                for (let section = start; section <= end; section += 1) sections.push(section);
                return;
            }
            if (!/^\d+$/.test(piece)) {
                throw new Error("课程“" + courseLabel + "”的节次无法解析。");
            }
            sections.push(toPositiveInteger(piece, "课程“" + courseLabel + "”的节次"));
        });
        return uniqueSortedPositiveIntegers(sections, "课程“" + courseLabel + "”的节次");
    }

    function groupContiguousSections(sections) {
        const groups = [];
        sections.forEach(function (section) {
            const last = groups[groups.length - 1];
            if (last && section === last.end + 1) {
                last.end = section;
            } else {
                groups.push({ start: section, end: section });
            }
        });
        return groups;
    }

    function parseScheduleFragments(value, courseLabel) {
        const text = normalizeDigits(value || "");
        const pattern = /星期([一二三四五六日天])[^0-9星期]*([0-9]+(?:\s*(?:[,，、\-~～至])\s*[0-9]+)*)\s*节/g;
        const weekdayOccurrences = text.match(/星期[一二三四五六日天]/g) || [];
        const fragments = [];
        let matchedOccurrences = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            matchedOccurrences += 1;
            const day = WEEKDAY_MAP[match[1]];
            const groups = groupContiguousSections(expandSectionExpression(match[2], courseLabel));
            groups.forEach(function (group) {
                fragments.push({ day: day, startSection: group.start, endSection: group.end });
            });
        }
        if (fragments.length === 0 || matchedOccurrences !== weekdayOccurrences.length) {
            throw new Error("课程“" + courseLabel + "”的星期或节次无法从 sjms 解析。");
        }
        return fragments;
    }

    function detectCampus(position) {
        const hasChengbei = position.indexOf("城北校区") >= 0;
        const hasChengxi = position.indexOf("城西校区") >= 0;
        if (hasChengbei && hasChengxi) return "ambiguous";
        if (hasChengbei) return "chengbei";
        if (hasChengxi) return "chengxi";
        return "unknown";
    }

    function applyCustomTime(position, startSection, endSection, courseLabel) {
        const campus = detectCampus(position);
        let slots;
        if (campus === "ambiguous") {
            throw new Error("课程“" + courseLabel + "”的地点同时包含两个校区，无法确定作息。");
        }
        if (campus === "unknown") {
            if (startSection > 4 || endSection > 4) {
                throw new Error("课程“" + courseLabel + "”第 5 节以后未标明校区，无法确定实际时间。");
            }
            slots = COMMON_TIME_SLOTS;
        } else {
            slots = CAMPUS_TIME_SLOTS[campus];
        }

        const startSlot = slots[startSection];
        const endSlot = slots[endSection];
        if (!startSlot || !endSlot) {
            if (campus === "chengxi" && (startSection === 10 || endSection === 10)) {
                throw new Error("课程“" + courseLabel + "”使用城西校区第 10 节，但该节时间尚未确认。");
            }
            throw new Error("课程“" + courseLabel + "”包含未收录的节次时间。");
        }
        return {
            isCustomTime: true,
            customStartTime: startSlot.start,
            customEndTime: endSlot.end
        };
    }

    function requireText(value, fieldLabel) {
        if (typeof value !== "string" || value.trim() === "") {
            throw new Error(fieldLabel + "为空。");
        }
        return value.trim();
    }

    function parseCourses(records) {
        const courses = [];
        records.forEach(function (record, recordIndex) {
            if (!record || typeof record !== "object" || Array.isArray(record)) {
                throw new Error("第 " + (recordIndex + 1) + " 条课程记录结构异常。");
            }
            const fallbackName = record.pkxxwh && record.pkxxwh.kcMc;
            const primaryName = typeof record.kcmc === "string" ? record.kcmc.trim() : record.kcmc;
            const name = requireText(primaryName || fallbackName, "第 " + (recordIndex + 1) + " 条课程名称");
            if (!record.pkxxwh || !Array.isArray(record.pkxxwh.jss) || record.pkxxwh.jss.length === 0) {
                throw new Error("课程“" + name + "”缺少授课安排。");
            }

            record.pkxxwh.jss.forEach(function (schedule) {
                if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
                    throw new Error("课程“" + name + "”的授课安排结构异常。");
                }
                const teacher = requireText(schedule.js_Xm, "课程“" + name + "”的教师");
                const position = requireText(schedule.jsmc, "课程“" + name + "”的地点");
                const weeks = parseWeeks(schedule, name);
                const fragments = parseScheduleFragments(schedule.sjms, name);

                fragments.forEach(function (fragment) {
                    const customTime = applyCustomTime(position, fragment.startSection, fragment.endSection, name);
                    courses.push({
                        name: name,
                        teacher: teacher,
                        position: position,
                        day: fragment.day,
                        startSection: fragment.startSection,
                        endSection: fragment.endSection,
                        weeks: weeks.slice(),
                        isCustomTime: customTime.isCustomTime,
                        customStartTime: customTime.customStartTime,
                        customEndTime: customTime.customEndTime
                    });
                });
            });
        });
        return dedupeAndSortCourses(courses);
    }

    function dedupeAndSortCourses(courses) {
        const seen = new Set();
        const result = [];
        courses.forEach(function (course) {
            const key = JSON.stringify([
                course.name, course.teacher, course.position, course.day,
                course.startSection, course.endSection, course.weeks,
                course.customStartTime, course.customEndTime
            ]);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(course);
            }
        });
        return result.sort(function (left, right) {
            return left.day - right.day ||
                left.startSection - right.startSection ||
                left.endSection - right.endSection ||
                left.name.localeCompare(right.name, "zh-CN") ||
                left.teacher.localeCompare(right.teacher, "zh-CN") ||
                left.position.localeCompare(right.position, "zh-CN");
        });
    }

    function validateDateString(value) {
        if (typeof value !== "string") return null;
        const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
            return null;
        }
        return match[1] + "-" + match[2] + "-" + match[3];
    }

    function getConsistentSemester(records) {
        const candidates = records.map(function (record) {
            return record && record.xqEntity;
        }).filter(function (semester) {
            return semester && typeof semester === "object" && !Array.isArray(semester);
        });
        if (candidates.length === 0) return {};

        const result = {};
        ["ksrq", "jsrq", "xqmc"].forEach(function (field) {
            const values = candidates.map(function (candidate) {
                return candidate[field] === null || candidate[field] === undefined ? "" : String(candidate[field]).trim();
            }).filter(Boolean);
            const expected = values[0] || "";
            candidates.forEach(function (candidate) {
                const actual = candidate[field] === null || candidate[field] === undefined ? "" : String(candidate[field]).trim();
                if (expected && actual && expected !== actual) {
                    throw new Error("课表记录中的学期信息不一致，请稍后重新导入。");
                }
            });
            if (expected) result[field] = expected;
        });
        return result;
    }

    function buildCourseConfig(records, courses, selectedSemesterName) {
        const semester = getConsistentSemester(records);
        const startDate = validateDateString(semester.ksrq);
        const endDate = validateDateString(semester.jsrq);
        const maxCourseWeek = courses.reduce(function (maximum, course) {
            return Math.max(maximum, course.weeks[course.weeks.length - 1] || 0);
        }, 0);
        let dateRangeWeeks = 0;
        if (startDate && endDate) {
            const startTime = Date.parse(startDate + "T00:00:00Z");
            const endTime = Date.parse(endDate + "T00:00:00Z");
            if (endTime >= startTime) {
                dateRangeWeeks = Math.ceil((endTime - startTime + 86400000) / 604800000);
            }
        }
        const totalWeeks = Math.max(maxCourseWeek, dateRangeWeeks);
        if (totalWeeks <= 0) {
            throw new Error("无法确定学期总周数。");
        }

        const config = {
            semesterTotalWeeks: totalWeeks,
            firstDayOfWeek: 1,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };
        if (startDate) config.semesterStartDate = startDate;
        return {
            config: config,
            semesterName: typeof semester.xqmc === "string" && semester.xqmc.trim() ? semester.xqmc.trim() :
                (selectedSemesterName || "当前查询学期")
        };
    }

    function validateCourses(courses) {
        if (!Array.isArray(courses) || courses.length === 0) {
            throw new Error("没有解析到可导入的课程时段。");
        }
        courses.forEach(function (course) {
            if (!Number.isInteger(course.day) || course.day < 1 || course.day > 7 ||
                !Number.isInteger(course.startSection) || !Number.isInteger(course.endSection) ||
                course.startSection <= 0 || course.endSection < course.startSection ||
                !Array.isArray(course.weeks) || course.weeks.length === 0 ||
                course.isCustomTime !== true ||
                !/^\d{2}:\d{2}$/.test(course.customStartTime) ||
                !/^\d{2}:\d{2}$/.test(course.customEndTime)) {
                throw new Error("课程“" + course.name + "”的导入字段校验失败。");
            }
        });
    }

    function buildCampusSummary(courses) {
        const campusLabels = new Set();
        courses.forEach(function (course) {
            const campus = detectCampus(course.position);
            if (campus === "chengbei") campusLabels.add("城北校区");
            if (campus === "chengxi") campusLabels.add("城西校区");
            if (campus === "unknown") campusLabels.add("未标明校区（仅共同时间节次）");
        });
        return Array.from(campusLabels).join("、");
    }

    function assertBridgeCapabilities() {
        const promiseBridge = window.shiguangBridgePromise;
        const bridge = window.shiguangBridge;
        if (!promiseBridge || typeof promiseBridge.showAlert !== "function" ||
            typeof promiseBridge.showSingleSelection !== "function" ||
            typeof promiseBridge.saveCourseConfig !== "function" ||
            typeof promiseBridge.savePresetTimeSlots !== "function" ||
            typeof promiseBridge.saveImportedCourses !== "function" ||
            !bridge || typeof bridge.notifyTaskCompletion !== "function") {
            throw new Error("当前拾光课表版本不支持所需导入接口，请更新应用后重试。");
        }
    }

    async function saveToApp(config, courses) {
        const configResult = await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        if (configResult !== true) {
            throw new Error("课表配置保存失败，课程尚未保存。");
        }
        const presetResult = await window.shiguangBridgePromise.savePresetTimeSlots(
            JSON.stringify(CHENGBEI_PRESET_TIME_SLOTS)
        );
        if (presetResult !== true) {
            throw new Error("城北基准时间轴保存失败；课表配置可能已更新，课程尚未保存。");
        }
        const courseResult = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (courseResult !== true) {
            throw new Error("课程保存失败；课表配置和城北基准时间轴可能已更新，请检查应用内课表后重试。");
        }
    }

    async function runImportFlow() {
        try {
            assertSystemOrigin();
            assertBridgeCapabilities();
            const runtimeToken = getRuntimeToken();
            const selectedSemester = await selectSemester(runtimeToken);
            if (!selectedSemester) return;

            showToast("正在读取青海师范大学研究生课表...");
            const records = await fetchAllScheduleRecords(selectedSemester.id, runtimeToken);
            const courses = parseCourses(records);
            validateCourses(courses);
            const semesterResult = buildCourseConfig(records, courses, selectedSemester.xqmc);

            const shouldSave = await showAlert(
                "确认导入课程表",
                "目标学期：" + semesterResult.semesterName + "\n" +
                "课程时段：" + courses.length + " 个\n" +
                "涉及校区：" + buildCampusSummary(courses) + "\n\n" +
                "节次网格以城北作息为基准，城西课程仍按实际时间显示。\n" +
                "确认后将保存课表配置、基准时间轴和课程。",
                "确认导入"
            );
            if (!shouldSave) return;

            await saveToApp(semesterResult.config, courses);
            showToast("导入成功，共保存 " + courses.length + " 个课程时段。");
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            const message = error && error.message ? error.message : "未知错误";
            showToast("导入失败：" + message);
            try {
                await showAlert("导入失败", message, "我知道了");
            } catch (alertError) {
                // 没有可用弹窗时仅保留 Toast；不输出可能携带外部数据的错误对象。
            }
        }
    }

    runImportFlow();
})();
