(function () {
    "use strict";

    function toast(message) {
        if (window.shiguangBridge && window.shiguangBridge.showToast) {
            window.shiguangBridge.showToast(message);
        } else {
            console.log("[USTC-GRAD]", message);
        }
    }

    async function alertUser(title, message) {
        if (window.shiguangBridgePromise && window.shiguangBridgePromise.showAlert) {
            return await window.shiguangBridgePromise.showAlert(title, message, "确定");
        }
        alert(title + "\n" + message);
        return true;
    }

    const HOST = "yjs1.ustc.edu.cn";
    const XNXQ_API = "/gsapp/sys/kbcxappustc/modules/xskbcx/xnxqxxcx.do";
    const KBCX_API = "/gsapp/sys/kbcxappustc/modules/xskbcx/xskbxxcx.do";

    function postForm(url, form) {
        return fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: new URLSearchParams(form).toString()
        }).then(function (resp) {
            if (!resp.ok) throw new Error("接口请求失败: HTTP " + resp.status + " (" + url + ")");
            return resp.text().then(function (text) {
                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    // 未登录时接口返回登录页 HTML 而非 JSON
                    throw new Error("请先登录研究生综合服务平台");
                }
                if (!data || data.code !== "0") {
                    throw new Error((data && (data.msg || data.message)) || "接口返回异常 (" + url + ")");
                }
                return data;
            });
        });
    }

    /** 学期列表, 保留上游参数拼写 pageNumer */
    function fetchSemesterList() {
        return postForm(XNXQ_API, { SFSY: "1", pageSize: "100", pageNumer: "1" }).then(function (data) {
            const rows = (data.datas && data.datas.xnxqxxcx && data.datas.xnxqxxcx.rows) || [];
            return rows.filter(function (r) { return r && r.DM && r.MC; });
        });
    }

    function fetchTimetableRows(dm) {
        const querySetting = [{ name: "XNXQDM", linkOpt: "AND", builderList: "cbl_String", builder: "equal", value: dm }];
        return postForm(KBCX_API, {
            querySetting: JSON.stringify(querySetting),
            pageSize: "999",
            pageNumber: "1"
        }).then(function (data) {
            return (data.datas && data.datas.xskbxxcx && data.datas.xskbxxcx.rows) || [];
        });
    }

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function fmtDate(d) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function mondayOf(dateStr) {
        const s = String(dateStr || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const d = new Date(s + "T00:00:00");
        if (isNaN(d.getTime())) return null;
        const day = d.getDay();
        d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
        return fmtDate(d);
    }

    function parseWeekText(text) {
        const weeks = [];
        String(text || "").split(/[,，]/).forEach(function (raw) {
            const part = raw.trim();
            if (!part) return;
            const parity = part.indexOf("单") >= 0 ? "odd" : (part.indexOf("双") >= 0 ? "even" : null);
            const range = part.match(/(\d+)\s*[~\-—–]\s*(\d+)/);
            let lo, hi;
            if (range) {
                lo = parseInt(range[1], 10);
                hi = parseInt(range[2], 10);
            } else {
                const single = part.match(/\d+/);
                if (!single) return;
                lo = hi = parseInt(single[0], 10);
            }
            if (isNaN(lo) || isNaN(hi)) return;
            for (let w = Math.min(lo, hi); w <= Math.max(lo, hi); w++) {
                if (parity === "odd" && w % 2 === 0) continue;
                if (parity === "even" && w % 2 === 1) continue;
                weeks.push(w);
            }
        });
        return weeks;
    }

    /**
     * 解析上课时间地点文本, 如 "GT-C102: 2(6,7,8);G3-113: 3(2,3,4)"
     * -> [{room:"GT-C102", day:2, sections:[6,7,8]}, {room:"G3-113", day:3, sections:[2,3,4]}]
     */
    function parseDateTimePlace(text) {
        const out = [];
        String(text || "").split(/[;；]/).forEach(function (raw) {
            const seg = raw.trim();
            if (!seg) return;
            const room = (seg.split(":")[0] || "").trim() || "未知地点";
            const re = /(\d+)\s*\(\s*([\d,，\-~\s]+?)\s*\)/g;
            let m;
            while ((m = re.exec(seg)) !== null) {
                const day = parseInt(m[1], 10);
                if (!(day >= 1 && day <= 7)) continue;
                const sections = [];
                m[2].split(/[,，]/).forEach(function (sRaw) {
                    const s = sRaw.trim();
                    if (!s) return;
                    const r = s.match(/^(\d+)\s*[-~]\s*(\d+)$/);
                    if (r) {
                        for (let i = parseInt(r[1], 10); i <= parseInt(r[2], 10); i++) sections.push(i);
                    } else {
                        const n = parseInt(s, 10);
                        if (!isNaN(n)) sections.push(n);
                    }
                });
                if (sections.length) out.push({ room: room, day: day, sections: sections });
            }
        });
        return out;
    }

    function getUSTCTimeSlots() {
        return [
            { number: 1, startTime: "07:50", endTime: "08:35" },
            { number: 2, startTime: "08:40", endTime: "09:25" },
            { number: 3, startTime: "09:45", endTime: "10:30" },
            { number: 4, startTime: "10:35", endTime: "11:20" },
            { number: 5, startTime: "11:25", endTime: "12:10" },
            { number: 6, startTime: "14:00", endTime: "14:45" },
            { number: 7, startTime: "14:50", endTime: "15:35" },
            { number: 8, startTime: "15:55", endTime: "16:40" },
            { number: 9, startTime: "16:45", endTime: "17:30" },
            { number: 10, startTime: "17:35", endTime: "18:20" },
            { number: 11, startTime: "19:30", endTime: "20:15" },
            { number: 12, startTime: "20:20", endTime: "21:05" },
            { number: 13, startTime: "21:10", endTime: "21:55" }
        ];
    }

    function toLessonLike(row) {
        const name = String(row.KCMC || "").trim() || "未知课程";
        return {
            course: { nameZh: name },
            nameZh: name,
            weekText: { text: String(row.ZCMC || "") },
            dateTimePlace: { text: String(row.PKSJDD || "") },
            teachers: String(row.RKJS || "").split(/[,，、]/)
                .map(function (t) { return { nameZh: t.trim() }; })
                .filter(function (t) { return t.nameZh; })
        };
    }

    /**
     * 文本解析: 时间分段(教室: 星期(节次)) + 起止周文本 -> 课程数组
     * 周次分配: 分段数一致按位配对; 周次仅 1 段全部适用; 否则取并集并告警
     */
    function buildCoursesFromText(lessons, warns) {
        const courses = [];
        let maxWeek = 0;
        lessons.forEach(function (les) {
            const segs = parseDateTimePlace(les.dateTimePlace && les.dateTimePlace.text);
            if (!segs.length) {
                warns.push("课程「" + ((les.course && les.course.nameZh) || les.nameZh) + "」无法解析上课时间, 已跳过");
                return;
            }
            const weekSegs = String((les.weekText && les.weekText.text) || "").split(/[;；]/).filter(function (s) { return s.trim(); });
            let allWeeks = null;
            const weeksFor = function (i) {
                if (weekSegs.length === segs.length) return parseWeekText(weekSegs[i]);
                if (weekSegs.length === 1) return parseWeekText(weekSegs[0]);
                // 分段数不对应(分段为去重后的节次/周次)时, 取所有周次并集并告警
                if (!allWeeks) {
                    allWeeks = [];
                    weekSegs.forEach(function (w) { parseWeekText(w).forEach(function (x) { if (allWeeks.indexOf(x) < 0) allWeeks.push(x); }); });
                    allWeeks.sort(function (a, b) { return a - b; });
                    warns.push("课程「" + ((les.course && les.course.nameZh) || les.nameZh) + "」时间分段与周次分段数不一致, 周次可能不准确");
                }
                return allWeeks;
            };
            const name = (les.course && les.course.nameZh) || les.nameZh || "未知课程";
            const teacher = (les.teachers || []).map(function (t) { return t.nameZh || t.name; }).filter(Boolean).join("、") || "未知教师";
            segs.forEach(function (seg, i) {
                const weeks = weeksFor(i);
                if (!weeks.length) return;
                // 连续节次合并为一段
                const sorted = seg.sections.slice().sort(function (a, b) { return a - b; });
                let start = sorted[0], prev = sorted[0];
                const flush = function (end) {
                    weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; });
                    courses.push({
                        name: name, teacher: teacher, position: seg.room,
                        day: seg.day, startSection: start, endSection: end, weeks: weeks.slice()
                    });
                };
                for (let k = 1; k < sorted.length; k++) {
                    if (sorted[k] !== prev + 1) { flush(prev); start = sorted[k]; }
                    prev = sorted[k];
                }
                flush(prev);
            });
        });
        return { courses: courses, maxWeek: maxWeek };
    }

    function dedupe(courses) {
        const seen = {};
        const out = [];
        courses.forEach(function (c) {
            const key = [c.name, c.teacher, c.position, c.day, c.startSection || c.customStartTime, c.endSection || c.customEndTime, c.weeks.join(",")].join("|");
            if (seen[key]) return;
            seen[key] = true;
            out.push(c);
        });
        return out.sort(function (a, b) {
            return a.day - b.day || (a.startSection || 0) - (b.startSection || 0);
        });
    }

    function buildCoursesFromRows(rows, warns) {
        const built = buildCoursesFromText(rows.map(toLessonLike), warns);
        return { courses: dedupe(built.courses), maxWeek: built.maxWeek };
    }

    function computeSemesterConfig(sem, maxWeek) {
        const config = { firstDayOfWeek: 7 };
        const zs = parseInt(sem && sem.ZS, 10);
        if (!isNaN(zs) && zs > 0) {
            config.semesterTotalWeeks = zs;
        } else if (maxWeek > 0) {
            config.semesterTotalWeeks = maxWeek;
        }
        const startDate = mondayOf((sem && (sem.TYKSRQ || sem.QSSJ || sem.ZCRQ)) || "");
        if (startDate) config.semesterStartDate = startDate;
        return config;
    }

    function pickDefaultSemesterIndex(rows) {
        for (let i = 0; i < rows.length; i++) {
            if (String(rows[i].SFDQXQ) === "1") return i;
        }
        return 0;
    }

    /**
     * 读取课表查询页当前显示的学期(页内「更改」切换后此处同步变化)
     * 页面通常位于同源 iframe 中, 标题形如: 我的课表 <label id="xnXqSpan">2026年秋季学期</label> 更改
     * 未找到时返回 null, 由调用方回退到当前学期
     */
    function getDisplayedSemesterName() {
        const docs = [document];
        const frames = document.querySelectorAll("iframe");
        for (let i = 0; i < frames.length; i++) {
            try {
                const d = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
                if (d) docs.push(d);
            } catch (e) { /* 跨域跳过 */ }
        }
        for (let i = 0; i < docs.length; i++) {
            try {
                const el = docs[i].getElementById("xnXqSpan") ||
                    docs[i].querySelector("h2 > label.bh-form-label");
                const t = el && (el.textContent || "").trim();
                if (t && /^\d{4}年/.test(t)) return t;
            } catch (e) { /* ignore */ }
        }
        return null;
    }

    async function runImportFlow() {
        try {
            const confirmed = await alertUser(
                "USTC 研究生课表导入",
                "请确保已登录研究生综合服务平台 yjs1.ustc.edu.cn\n且已进入「培养 → 课表查询 → 学生课表查询」页面",
                "开始导入"
            );
            if (!confirmed) {
                toast("用户取消了导入。");
                return;
            }
            if (location.hostname !== HOST) {
                toast("请在 yjs1.ustc.edu.cn 页面执行导入。");
                return;
            }
            toast("正在获取课程数据...");
            const semesters = await fetchSemesterList();
            const displayed = getDisplayedSemesterName();
            let sem = displayed && semesters.find(function (s) { return s.MC === displayed; });
            if (!sem) sem = semesters[pickDefaultSemesterIndex(semesters)];
            if (!sem) {
                toast("未获取到学期信息，请确认已登录。");
                return;
            }
            const rows = await fetchTimetableRows(sem.DM);
            if (!rows.length) {
                toast("该学期暂无课程数据。");
                return;
            }
            const warns = [];
            const built = buildCoursesFromRows(rows, warns);
            if (!built.courses.length) {
                toast("未解析到课程，请确认课表已正确加载。");
                return;
            }
            // 保存: 学期配置 -> 作息时间 -> 课程
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(computeSemesterConfig(sem, built.maxWeek)));
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(getUSTCTimeSlots()));
            await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(built.courses));

            toast("课程导入成功，共导入 " + built.courses.length + " 条课程（" + sem.MC + "）！");
            if (warns.length) console.warn("[USTC-GRAD]", warns.join("；"));
            window.shiguangBridge.notifyTaskCompletion();
        } catch (error) {
            console.error("[USTC-GRAD] import failed:", error);
            const msg = error && error.message ? error.message : String(error);
            toast(msg.indexOf("请先登录") >= 0 ? "请先登录研究生综合服务平台 yjs1.ustc.edu.cn" : "导入失败: " + msg);
        }
    }

    runImportFlow();
})();
