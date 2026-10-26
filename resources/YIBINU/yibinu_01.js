// 宜宾学院(yibinu.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提issues或者提交pr更改,这更加快速

//避免多次执行脚本出现已声明报错，文件中无全局常量
// ==================== 普通工具函数 ====================
// 解析周次字符串，转换为具体的周次数组
function parseWeeks(weekStr) {
    if (!weekStr) return [];
    const weekSets = weekStr.split(',');
    let weeks = [];
    for (const set of weekSets) {
        const trimmedSet = set.trim();
        const rangeMatch = trimmedSet.match(/(\d+)-(\d+)周/);
        const singleMatch = trimmedSet.match(/^(\d+)周/);
        let start = 0, end = 0, processed = false;

        if (rangeMatch) {
            start = Number(rangeMatch[1]);
            end = Number(rangeMatch[2]);
            processed = true;
        } else if (singleMatch) {
            start = end = Number(singleMatch[1]);
            processed = true;
        }
        
        if (processed) {
            const isSingle = trimmedSet.includes('(单)');
            const isDouble = trimmedSet.includes('(双)');
            for (let w = start; w <= end; w++) {
                if (isSingle && w % 2 === 0) continue;
                if (isDouble && w % 2 !== 0) continue;
                weeks.push(w);
            }
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}
//对课程列表进行排序
function sortCourses(courseList) {
    return courseList.sort((a, b) =>
        a.day - b.day ||
        a.startSection - b.startSection ||
        a.name.localeCompare(b.name, 'zh-CN')
    );
}
//获取整理好的课程类别的课程数量（名字相同即是同一门）
function getCourseNum(courseList) {
    if (!Array.isArray(courseList)) return 0;
    const uniqueCourseNames = new Set(courseList.map(course => course.name));
    return uniqueCourseNames.size;
}

// ==================== 实验平台请求签名生成器 ====================
function SignatureGenerator() {
    const secret = {
        signature: "zxtd_256-bit-secret-key-2025-8-7",
        zhxhsign: "zhxintd201020301"
    };

    const generateNonce = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 20; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    const hmacSha512 = async (message, key) => {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key);
        const messageData = encoder.encode(message);
        const cryptoKey = await crypto.subtle.importKey(
            "raw", keyData, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
        return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const hmacSha256 = async (message, key) => {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(key);
        const messageData = encoder.encode(message);
        const cryptoKey = await crypto.subtle.importKey(
            "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        );
        const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
        return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    };

    const generateSignature = async () => {
        const timestamp = Date.now();
        const nonce = generateNonce();
        const signString = `${timestamp}-${nonce}`;
        const signature = await hmacSha512(signString, secret.signature);
        return { timestamp, nonce, signature };
    };

    const generateZhxhsign = async (data) => {
        const paramMap = {};
        for (let key in data) {
            if (data.hasOwnProperty(key)) {
                let value = data[key];
                if (value !== undefined && value !== null && value !== '') {
                    if (!paramMap[key]) paramMap[key] = [];
                    paramMap[key].push(String(value));
                }
            }
        }
        const sortedKeys = Object.keys(paramMap).sort();
        let signStr = '';
        for (let key of sortedKeys) {
            const values = paramMap[key];
            values.sort();
            for (let value of values) {
                signStr += key + '=' + value;
            }
        }
        return await hmacSha256(signStr, secret.zhxhsign);
    };

    const generateAll = async (data) => {
        const signatureData = await generateSignature();
        const zhxhsign = await generateZhxhsign(data);
        return {
            timestamp: signatureData.timestamp,
            random: signatureData.timestamp,
            nonce: signatureData.nonce,
            signature: signatureData.signature,
            zhxhsign: zhxhsign
        };
    };

    return { generateAll };
}


// ==================== 自动获取实验平台凭证 key1 (通过隐藏 iframe 模拟 SSO) ====================
async function autoGetKey1() {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = 'https://scjx2.yibinu.edu.cn/zxcas/';
        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                reject(new Error('超时，请确认已登录过统一认证平台'));
                iframe.remove();
            }
        }, 15000);

        // 轮询检测 iframe 的 URL（同源时才能访问）
        const interval = setInterval(() => {
            if (resolved) return;
            try {
                const iframeUrl = iframe.contentWindow.location.href;
                const match = iframeUrl.match(/id=([^&]+)/);
                if (match) {
                    const key1 = decodeURIComponent(match[1]);
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolved = true;
                    iframe.remove();
                    resolve(key1);
                }
            } catch (e) {
                // 跨域无法访问，忽略，继续等待
            }
        }, 200);

        iframe.onload = () => {
            if (resolved) return;
            try {
                const iframeUrl = iframe.contentWindow.location.href;
                const match = iframeUrl.match(/id=([^&]+)/);
                if (match) {
                    const key1 = decodeURIComponent(match[1]);
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolved = true;
                    iframe.remove();
                    resolve(key1);
                }
            } catch (e) {}
        };
        document.body.appendChild(iframe);
    });
}

// ==================== 实验课请求 ====================
async function fetchExperimentCourses(studentId,yearterm,authorization) {
    try {
        const url = "https://scjx2.yibinu.edu.cn/teach/teach/stuTime/listStuTimePage";
        const bodyData = {
            "yearterm": yearterm,
            "currpage": 1,
            "pagesize": 500
        };
        const signatures = await SignatureGenerator().generateAll(bodyData);
        
        if (!authorization) {
            console.error('未找到 authorization');
            window.shiguangBridge.showToast("未找到登录凭证，请重新登录");
            return [];
        }
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "authorization": authorization,
                "zhxhsign": signatures.zhxhsign,
                "signature": signatures.signature,
                "timestamp": signatures.timestamp.toString(),
                "random": signatures.random.toString(),
                "nonce": signatures.nonce,
                "currentroutepath": "/6001/modules/teach/stu/result/result",
                "userId": studentId,
                "x-requested-with": "XMLHttpRequest"
            },
            body: JSON.stringify(bodyData),
            credentials: "include"
        });

        if (!res.ok) {
            const errorData = await res.json();
            console.error("错误响应:", errorData);
            window.shiguangBridge.showToast(`实验课错误：${errorData.msg || res.status}`);
            return {};
        }

        const data = await res.json();
        console.log("成功获取数据，原始条数:", data.result?.list?.length || 0);
        return data;
    } catch (e) {
        console.error(e);
        window.shiguangBridge.showToast("实验课获取失败: " + e.message);
        return {};
    }
}

function parseExperimentCoursesData(jsonData) {
    console.log("JS: 解析实验课数据...");
    if (!jsonData || jsonData.code !== 200 || !jsonData.result?.list) {
        window.shiguangBridge.showToast("未获取到实验课数据！");
        return [];
    }
    const rawList = jsonData.result.list;
    const groupMap = new Map();
    for (const item of rawList) {
        const courseName = item.course_name?.trim();
        const teacher = item.teacher_name?.trim();
        const room = item.room_name?.trim().replace(/\t/g, '');
        const day = Number(item.week_day);
        const start = Number(item.jc_start);
        const end = Number(item.jc_end);
        const week = Number(item.week);
        if (!courseName || !teacher || !day || !start || !end || !week) continue;
        if (day < 1 || day > 7 || start > end) continue;
        const key = `${courseName}_${teacher}_${day}_${start}_${end}`;
        if (!groupMap.has(key)) {
            groupMap.set(key, { 
                name: courseName, 
                teacher: teacher, 
                position: room, 
                day: day, 
                startSection: start, 
                endSection: end, 
                weeks: new Set() 
            });
        }
        groupMap.get(key).weeks.add(week);
    }
    const courseList = [];
    for (const item of groupMap.values()) {
        item.name = "[实验]"+item.name
        item.weeks = [...item.weeks].sort((a, b) => a - b);
        courseList.push(item);
    }

    return sortCourses(courseList);
}

// ====================智慧教学大厅页面： 理论课请求+学期信息请求 ====================
//第一步：建立会话
async function establishSession() {
    try {
        // 第一步：访问 appShow 页面，获取有效的会话
        const appShowUrl = 'https://ehall.yibinu.edu.cn/appShow?appId=4770397878132218';
        await fetch(appShowUrl, {
            method: 'GET',
            credentials: 'include',
            redirect: 'follow',  // 自动跟随重定向
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

    } catch (e) {
        console.error("错误：", e);
        window.shiguangBridge.showToast("会话连接建立失败，请重试！");
    }
}

//第二步：请求理论课表数据
async function fetchTheoryCourses(yearTerm, studentId) {
    try {
        // 请求课表数据
        const res = await fetch("https://ehall.yibinu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do", {
            method: "POST",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            },
            body: "XNXQDM=" + yearTerm + "&XH=" + studentId,
            credentials: "include"
        });
        if (!res.ok) throw new Error("请求失败：" + res.status);
        const text = await res.text();
        const data = JSON.parse(text);
        return data;
    } catch (e) {
        console.error("错误：", e);
        window.shiguangBridge.showToast("获取课表失败：" + e.message);
        return [];
    }
}

//第三步：请求学期信息（开学日期和总周次）
async function fetchTermInfo(academicYear,term) {
    try {
        // 请求课表数据
        const res = await fetch("https://ehall.yibinu.edu.cn/jwapp/sys/wdkb/modules/jshkcb/cxjcs.do", {
            method: "POST",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            },
            body: "XN=" + academicYear + "&XQ=" + term,
            credentials: "include"
        });
        if (!res.ok) throw new Error("请求失败：" + res.status);
        const text = await res.text();
        const data = JSON.parse(text);
        return data;
    } catch (e) {
        console.error("错误：", e);
        window.shiguangBridge.showToast("学期信息获取失败" );
        return {};
    }
}

//解析学年学期信息
function parseYearTermJson(jsonData){
    console.log("JS: 解析学期信息")
    if (!jsonData || !jsonData.datas?.cxjcs?.rows) {
        console.warn("JS: 学期信息格式错误");
        return {};
    }
    if(jsonData.datas?.cxjcs?.rows.length===0){
        window.shiguangBridge.showToast("所查询的学期信息为空");
        return {};
    }

    const termInfo={
        semesterTotalWeeks:jsonData.datas.cxjcs.rows[0].ZZC,
        semesterStartDate:jsonData.datas.cxjcs.rows[0].XQKSRQ?.substring(0, 10)
    }
    return termInfo;
}

//解析理论课表数据
function parseTheoryJson(jsonData) {
    console.log("JS: 解析理论课数据...");
    if (!jsonData || !jsonData.datas?.xskcb?.rows) {
        console.warn("JS: 理论课数据格式错误");
        return [];
    }
    if(jsonData.datas?.xskcb?.extParams?.code!==1){
        window.shiguangBridge.showToast(jsonData.datas?.xskcb?.extParams?.msg);
        return [];
    }

    const rawList = jsonData.datas.xskcb.rows;
    const courseList = [];
    
    for (const item of rawList) {
        if (!item.KCM || !item.SKJS || !item.JASMC || !item.SKXQ || !item.KSJC || !item.JSJC || !item.ZCMC) continue;
        const weeks = parseWeeks(item.ZCMC);
        if (weeks.length === 0) continue;

        const start = Number(item.KSJC);
        const end = Number(item.JSJC);
        const day = Number(item.SKXQ);
        if (isNaN(day) || day < 1 || day > 7 || start > end) continue;

        courseList.push({
            name: item.KCM.trim(),
            teacher: item.SKJS.trim(),
            position: item.JASMC.trim(),
            day: day,
            startSection: start,
            endSection: end,
            weeks: weeks
        });
    }
    return sortCourses(courseList);
}





// ==================== 保存配置 ====================
//保存课表信息配置
async function saveAllCourses(courses) {
    try { 
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses, null, 2)); 
        return true; 
    }
    catch (e) { 
        window.shiguangBridge.showToast("课程保存失败"); 
        return false; 
    }
}
//保存学期信息配置
async function saveConfig(semesterTotalWeeks,semesterStartDate) {
    const config = { 
        ...(semesterTotalWeeks !== undefined && { semesterTotalWeeks }),
        ...(semesterStartDate !== undefined && { semesterStartDate }),
        defaultClassDuration: 45,
        defaultBreakDuration: 5,
        firstDayOfWeek: 1
    };
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
}
//保存节次信息配置
function getTimeSlots(){
    const TimeSlots = [
    { number: 1, startTime: "08:30", endTime: "09:15" },
    { number: 2, startTime: "09:20", endTime: "10:05" },
    { number: 3, startTime: "10:25", endTime: "11:10" },
    { number: 4, startTime: "11:15", endTime: "12:00" },
    { number: 5, startTime: "14:30", endTime: "15:15" },
    { number: 6, startTime: "15:20", endTime: "16:05" },
    { number: 7, startTime: "16:25", endTime: "17:10" },
    { number: 8, startTime: "17:15", endTime: "18:00" },
    { number: 9, startTime: "19:00", endTime: "19:45" },
    { number: 10, startTime: "19:50", endTime: "20:35" },
    { number: 11, startTime: "20:45", endTime: "21:30" },
    { number: 12, startTime: "22:05", endTime: "22:50" }
    ];
    return TimeSlots;
}
async function importTimeSlots() {
    try { 
        await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(getTimeSlots())); 

    } catch (e) {}
}

// ==================== 用户交互 ====================
//智慧校园大厅首次执行提示
async function promptUserToStart() {
    return await window.shiguangBridgePromise.showAlert(
        "宜宾学院课表导入",
        "导入流程:1.在智慧校园内执行脚本→2.在实验教学系统再次执行脚本→3.等待执行完成。\n所有数据采用请求方式，可以不在课表页面执行，如果您担心，也可以在课表页面确认后再执行脚本；执行中途取消后可以再次点击执行",
        "开始导入",
    );
}
//理论课及学期信息保存后提示
async function askImportExperiment(theoryNum,startDate) {
    const options = ["继续导入实验课", "仅保存理论课"];
    return await window.shiguangBridgePromise.showSingleSelection(
        `获取进度:理论课${theoryNum}门,开学日期${startDate!==undefined?startDate:"未知"}`,
        JSON.stringify(options),
        0
    );
}
//让用户输入学年
async function getAcademicYear() {
    const startYear = new Date().getFullYear().toString();
    return await window.shiguangBridgePromise.showPrompt(
        "选择学年",
        "请输入起始学年（如2025-2026填2025）:",
        startYear,
        "validateYearInput"
    );
}
function validateYearInput(input) {
    return /^[0-9]{4}$/.test(input) ? false : "请输入四位数字学年！";
}
//让用户选择学期
async function selectSemester() {
    const semesters = ["第一学期", "第二学期"];
    return await window.shiguangBridgePromise.showSingleSelection(
        "选择学期",
        JSON.stringify(semesters), 
        0
    );
}
//准备跳转实验页面的操作提醒
async function reminderMotion() {
    return await window.shiguangBridgePromise.showAlert(
        "操作提醒(请认真理解！)",
        "在跳转页面后就可以再次点击底部的|执行导入|，不需要登录；\n当然，你也可以登录后去确认你的实验课表，然后再执行导入；\n一句话：跳转页面后一定！一定！一定！要再次点击执行导入！",
        "我已了解下一步操作"
    );
}

// ==================== 页面判断 ====================
//判断是否在统一认证登录界面
function isTheoryLoginPage() {
    return window.location.href.includes("authserver.yibinu.edu.cn/authserver/login");
}
//判断是否在实践教育教学系统
function isExpLoginPage() {
    return window.location.href.includes("scjx2.yibinu.edu.cn");
}

// ==================== 1. 理论课流程 ====================
async function runImportFlow() {
    if (isTheoryLoginPage()) { 
        window.shiguangBridge.showToast("请先登录智慧校园！"); 
        return; 
    }

    const studentId = localStorage.getItem('ampUserId');
    if (!studentId) {
        window.shiguangBridge.showToast("请确保已登录智慧校园！");
        return;
    }

    if (!await promptUserToStart()) return;
    const startYear = await getAcademicYear(); 
    if (!startYear) return;
    
    const semesterIdx = await selectSemester(); 
    if (semesterIdx === null) return;
    const term=semesterIdx+1;

    const academicYear = `${startYear}-${Number(startYear)+1}`
    const yearTerm = `${academicYear}-${term}`;

    window.shiguangBridge.showToast("稍等一下哦,信息获取中");
    await establishSession();
    const [theoryRes, termInfoRes] = await Promise.all([
        fetchTheoryCourses(yearTerm, studentId),
        fetchTermInfo(academicYear, term)
    ]);

    const theoryCourses=parseTheoryJson(theoryRes);
    const {semesterTotalWeeks,semesterStartDate} = parseYearTermJson(termInfoRes);
    
    const theoryNum = getCourseNum(theoryCourses)
    const needExp = await askImportExperiment(theoryNum,semesterStartDate);
    if(needExp === null) return;
    if (needExp === 0) {
        // 将数据传递给实验课页面
        if(!await reminderMotion()) return;
        const params = {
            theoryCourses,
            yearTerm,
            studentId,
            ...(semesterTotalWeeks !== undefined && { semesterTotalWeeks }),
            ...(semesterStartDate !== undefined && { semesterStartDate })
        };
        const jumpUrl = `https://scjx2.yibinu.edu.cn/TEACH/#/login`;
        window.name = JSON.stringify(params)
        window.location.href = jumpUrl;
        return;
    }

    await saveConfig(semesterTotalWeeks,semesterStartDate); 
    await importTimeSlots(); 
    await saveAllCourses(theoryCourses);
    window.shiguangBridge.showToast(`导入成功！共 ${theoryNum} 门理论课`);
    window.shiguangBridge.notifyTaskCompletion();
}

// ==================== 2. 实验课流程 ====================
async function runExpAutoMerge() {
    try {
        const decodeData = JSON.parse(window.name);
        console.log("数据："+window.name)
        if (!decodeData) {
            window.shiguangBridge.showToast("未检测到理论课参数，请重新从理论课流程开始！");
            return;
        }
        const { theoryCourses, yearTerm, studentId,semesterTotalWeeks,semesterStartDate } = decodeData;
        if (!theoryCourses || !yearTerm || !studentId) {
            window.shiguangBridge.showToast("参数不完整，请重新导入理论课！");
            return;
        }
        
        const key1 = await autoGetKey1();
        const expCoursesRes = await fetchExperimentCourses(studentId,yearTerm,key1);
        const expCourses=parseExperimentCoursesData(expCoursesRes)
        const allCourses = sortCourses([...theoryCourses, ...expCourses]);
        
        await saveConfig(semesterTotalWeeks,semesterStartDate);
        await importTimeSlots();
        await saveAllCourses(allCourses);

        const theoryNum = getCourseNum(theoryCourses);
        const expNum = getCourseNum(expCourses);
        
        window.shiguangBridge.showToast(`导入成功！理论课${theoryNum}门 + 实验课${expNum}门`);
        window.shiguangBridge.notifyTaskCompletion();
    } catch (err) {
        console.error(err);
        window.shiguangBridge.showToast("自动导入失败！请退出重新开始流程");
    }
}

// ==================== 脚本入口 ====================
(async () => {
    if (isExpLoginPage()) {
        await runExpAutoMerge();
    } else {
        await runImportFlow();
    }
})();