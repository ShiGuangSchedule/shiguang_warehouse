/**
 * 重庆科技大学 (CQUST) 树维 EAMS 教务系统课表导入
 * Maintainer: yuexps
 */

(async () => {
    'use strict';

    // 允许访问的教务域名
    const ALLOWED_HOSTS = [
        'web.cqust.edu.cn',
        'jwnew.cqust.edu.ex2.http.80.ipv6.cqust.edu.cn',
        'jwnew.cqust.edu.cn'
    ];

    // 作息时间表（共 11 节）
    const CQUST_TIME_SLOTS = [
        { number: 1, startTime: '08:30', endTime: '09:15' },
        { number: 2, startTime: '09:25', endTime: '10:10' },
        { number: 3, startTime: '10:30', endTime: '11:15' },
        { number: 4, startTime: '11:25', endTime: '12:10' },
        { number: 5, startTime: '14:00', endTime: '14:45' },
        { number: 6, startTime: '14:55', endTime: '15:40' },
        { number: 7, startTime: '16:00', endTime: '16:45' },
        { number: 8, startTime: '16:55', endTime: '17:40' },
        { number: 9, startTime: '19:00', endTime: '19:45' },
        { number: 10, startTime: '19:55', endTime: '20:40' },
        { number: 11, startTime: '20:50', endTime: '21:35' }
    ];

    // Toast 提示
    const toast = (msg) => {
        if (window.shiguangBridge && typeof window.shiguangBridge.showToast === 'function') {
            window.shiguangBridge.showToast(msg);
        } else {
            console.log('[Toast]', msg);
        }
    };

    // 判断是否为 WebVPN
    const isWebvpn = () => window.location.hostname === 'web.cqust.edu.cn';

    // 检查页面域名与路径
    const checkHost = () => {
        const curHost = window.location.hostname;
        if (!ALLOWED_HOSTS.some(h => curHost.includes(h) || curHost === h)) return false;
        if (isWebvpn()) {
            return window.location.pathname.includes('/eams/') || window.location.pathname.includes('fae04f99307e6b416b1b9de29d51367b4912');
        }
        return true;
    };

    // 提取 WebVPN 路径前缀
    const getWebvpnPrefix = () => {
        const m = window.location.pathname.match(/^\/(?:http|https)\/[0-9a-fA-F]+/);
        return m ? m[0] : '';
    };

    // HTTP 请求封装
    const request = async (path, options = {}) => {
        const prefix = getWebvpnPrefix();
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        const url = path.startsWith('http') ? path : `${window.location.origin}${prefix}${cleanPath}`;
        const resp = await fetch(url, {
            credentials: 'include',
            ...options
        });
        if (!resp.ok) {
            throw new Error(`请求接口异常: ${resp.status} ${resp.statusText}`);
        }
        return await resp.text();
    };

    // 获取所在周周一日期
    const getWeekMondayStr = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay() === 0 ? 7 : d.getDay();
        d.setDate(d.getDate() - (day - 1));
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayStr = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dayStr}`;
    };

    // 推算学期开始日期
    const calcSemesterStartDate = (schoolYear, termName) => {
        const years = (schoolYear || '').match(/\d{4}/g) || [];
        const isSecond = String(termName) === '2' || (termName && termName.includes('2'));
        if (years.length >= 2) {
            return isSecond ? getWeekMondayStr(`${years[1]}-02-22`) : getWeekMondayStr(`${years[0]}-09-07`);
        }
        const nowYear = new Date().getFullYear();
        return isSecond ? getWeekMondayStr(`${nowYear}-02-22`) : getWeekMondayStr(`${nowYear}-09-07`);
    };

    // 获取排课标识 ids
    const detectParams = async () => {
        const html = await request('/eams/courseTableForStd.action');
        if (html.includes('actionError') || html.includes('login.action') || html.includes('密码错误') || html.includes('用户登录')) {
            throw new Error('未检测到登录状态，请先登录教务系统');
        }

        const idsMatch = html.match(/bg\.form\.addInput\(form,\s*["']ids["'],\s*["'](\d+)["']\)/);
        const tagMatch = html.match(/id=["'](semesterBar\d+Semester)["']/);

        let ids = idsMatch ? idsMatch[1] : null;
        if (!ids) {
            const inputEl = document.querySelector('form input[name="ids"]');
            if (inputEl && inputEl.value) ids = inputEl.value;
        }

        if (!ids) {
            throw new Error('未获取到排课标识 ids');
        }

        const tagId = tagMatch ? tagMatch[1] : 'semesterBar8875271691Semester';
        return { ids, tagId };
    };

    // 选择学期
    const selectSemester = async (tagId) => {
        let semesterList = [];
        let curSemId = '561';

        try {
            const queryRes = await request('/eams/dataQuery.action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: `tagId=${encodeURIComponent(tagId)}&dataType=semesterCalendar&value=561&empty=false`
            });

            const semIdMatch = queryRes.match(/semesterId:\s*["']?(\d+)["']?/);
            if (semIdMatch) curSemId = semIdMatch[1];

            const itemRegex = /\{id:(\d+),schoolYear:"([^"]+)",name:"([^"]+)"\}/g;
            let m;
            while ((m = itemRegex.exec(queryRes)) !== null) {
                semesterList.unshift({
                    id: m[1],
                    schoolYear: m[2],
                    name: m[3],
                    label: `${m[2]}学年 第${m[3]}学期${m[1] === curSemId ? ' (当前)' : ''}`
                });
            }
        } catch (e) {
            console.warn('[获取学期列表异常]', e);
        }

        if (!semesterList.length) {
            const nowYear = new Date().getFullYear();
            return {
                id: curSemId,
                schoolYear: `${nowYear}-${nowYear + 1}`,
                name: '1',
                label: '当前学期'
            };
        }

        let defaultIdx = semesterList.findIndex(s => s.id === curSemId);
        if (defaultIdx < 0) defaultIdx = 0;

        if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.showSingleSelection === 'function') {
            const labels = semesterList.map(s => s.label);
            const chosenIdx = await window.shiguangBridgePromise.showSingleSelection(
                '请选择需要导入的学期',
                JSON.stringify(labels),
                defaultIdx
            );

            if (chosenIdx === null || chosenIdx < 0) {
                return null;
            }
            return semesterList[chosenIdx];
        }

        return semesterList[defaultIdx];
    };

    // 解析课表数据
    const parseCourseTableHtml = (html) => {
        const rawSlots = [];
        const creditMap = new Map();

        // 提取课程代码与学分映射
        const cReg = />([A-Za-z0-9._-]+)<\/a>\s*<\/td>\s*<td>([^<]+)<\/td>\s*<td>([0-9.]+)<\/td>/g;
        let cm;
        while ((cm = cReg.exec(html)) !== null) {
            if (cm[1]) creditMap.set(cm[1].trim(), cm[3].trim());
            if (cm[2]) creditMap.set(cm[2].trim(), cm[3].trim());
        }

        // 解析 TaskActivity 课程
        const scriptMatch = html.match(/var\s+table0\s*=\s*new\s+CourseTable[\s\S]*?<\/script>/);
        if (scriptMatch) {
            const lines = scriptMatch[0].split('\n');
            let curAct = null;
            const actReg = /activity\s*=\s*new\s+TaskActivity\((.*)\);/;
            const idxReg = /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+);/;
            const strReg = /"([^"]*)"/g;

            for (const lineRaw of lines) {
                const line = lineRaw.trim();
                const aM = line.match(actReg);
                if (aM) {
                    const args = [];
                    let sm;
                    while ((sm = strReg.exec(aM[1])) !== null) args.push(sm[1]);
                    if (args.length >= 7) {
                        const rawName = args[3] || '';
                        const cleanName = rawName.replace(/\([A-Za-z0-9._-]+\)$/, '').trim() || rawName;
                        curAct = {
                            teacher: args[1] || '',
                            name: cleanName,
                            room: args[5] || '',
                            weeksStr: args[6] || ''
                        };
                    }
                }

                const iM = line.match(idxReg);
                if (iM && curAct) {
                    const day = parseInt(iM[1], 10) + 1;
                    const sec = parseInt(iM[2], 10) + 1;
                    const weeks = [];
                    for (let w = 1; w < curAct.weeksStr.length; w++) {
                        if (curAct.weeksStr[w] === '1') weeks.push(w);
                    }
                    rawSlots.push({
                        name: curAct.name,
                        teacher: curAct.teacher,
                        position: curAct.room,
                        day,
                        section: sec,
                        weeks
                    });
                }
            }
        }

        // 合并同天连续节次
        const groups = new Map();
        for (const slot of rawSlots) {
            const key = `${slot.name}|${slot.teacher}|${slot.position}|${slot.day}|${slot.weeks.join(',')}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(slot);
        }

        const mergedCourses = [];
        for (const slots of groups.values()) {
            if (!slots.length) continue;
            slots.sort((a, b) => a.section - b.section);

            let startSec = slots[0].section;
            let endSec = slots[0].section;

            for (let i = 1; i < slots.length; i++) {
                if (slots[i].section === endSec + 1) {
                    endSec = slots[i].section;
                } else {
                    mergedCourses.push({
                        name: slots[0].name,
                        teacher: slots[0].teacher,
                        position: slots[0].position,
                        day: slots[0].day,
                        startSection: startSec,
                        endSection: endSec,
                        weeks: slots[0].weeks
                    });
                    startSec = slots[i].section;
                    endSec = slots[i].section;
                }
            }
            mergedCourses.push({
                name: slots[0].name,
                teacher: slots[0].teacher,
                position: slots[0].position,
                day: slots[0].day,
                startSection: startSec,
                endSection: endSec,
                weeks: slots[0].weeks
            });
        }

        // 解析未安排时间任务列表
        const unarrangedMatch = html.match(/未安排时间任务列表[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
        if (unarrangedMatch) {
            const tableHtml = unarrangedMatch[1];
            const trReg = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            const strip = /<[^>]+>/g;
            let tr;
            while ((tr = trReg.exec(tableHtml)) !== null) {
                const tds = (tr[1].match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(td => td.replace(strip, '').trim());
                if (tds.length >= 8 && /^\d+$/.test(tds[0])) {
                    const name = tds[2];
                    const teacher = tds[5] || '';
                    const weeksStr = tds[6] || '';
                    const weeks = [];

                    if (weeksStr) {
                        const parts = weeksStr.split(/[,，]/);
                        for (const p of parts) {
                            const range = p.trim().match(/^(\d+)\s*[-~至]\s*(\d+)$/);
                            if (range) {
                                const s = parseInt(range[1], 10);
                                const e = parseInt(range[2], 10);
                                for (let w = s; w <= e; w++) weeks.push(w);
                            } else {
                                const single = parseInt(p.trim(), 10);
                                if (!isNaN(single)) weeks.push(single);
                            }
                        }
                    }

                    if (name) {
                        mergedCourses.push({
                            name,
                            teacher,
                            position: '集中实践',
                            day: 0,
                            startSection: 0,
                            endSection: 0,
                            weeks: weeks.length ? weeks : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
                        });
                    }
                }
            }
        }

        return mergedCourses;
    };

    // 导入主流程
    const runImport = async () => {
        if (!checkHost()) {
            throw new Error('请先登录并进入教务系统页面');
        }

        const { ids, tagId } = await detectParams();

        const semester = await selectSemester(tagId);
        if (!semester) {
            toast('已取消学期选择');
            return;
        }

        const courseHtml = await request('/eams/courseTableForStd!courseTable.action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `ignoreHead=1&setting.kind=std&startWeek=1&project.id=1&semester.id=${semester.id}&ids=${ids}`
        });

        if (!courseHtml.includes('TaskActivity')) {
            throw new Error('未查询到该学期的有效排课数据');
        }

        const courses = parseCourseTableHtml(courseHtml);
        if (!courses || !courses.length) {
            throw new Error('未能从课表页面解析出课程记录');
        }

        // 计算最大周次与开学日期
        let maxWeek = 20;
        courses.forEach(c => {
            if (Array.isArray(c.weeks) && c.weeks.length) {
                const m = Math.max(...c.weeks);
                if (m > maxWeek) maxWeek = m;
            }
        });

        const semesterStartDate = calcSemesterStartDate(semester.schoolYear, semester.name);
        const config = {
            semesterStartDate,
            semesterTotalWeeks: maxWeek,
            defaultClassDuration: 45,
            defaultBreakDuration: 10
        };

        // 保存学期配置
        if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.saveCourseConfig === 'function') {
            await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
        }

        // 保存作息时间
        if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.savePresetTimeSlots === 'function') {
            await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(CQUST_TIME_SLOTS));
        }

        // 保存课程列表
        if (window.shiguangBridgePromise && typeof window.shiguangBridgePromise.saveImportedCourses === 'function') {
            const ok = await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
            if (ok) {
                toast(`导入成功，共 ${courses.length} 门课程`);
            } else {
                toast('课程数据保存完成');
            }
        } else {
            console.log('[课程数据]', courses);
            toast(`解析成功，共 ${courses.length} 门课程`);
        }
    };

    try {
        await runImport();
    } catch (err) {
        console.error('[CQUST 导入异常]', err);
        toast(`导入失败: ${err.message || '未知错误'}`);
    } finally {
        if (window.shiguangBridge && typeof window.shiguangBridge.notifyTaskCompletion === 'function') {
            window.shiguangBridge.notifyTaskCompletion();
        }
    }
})();
