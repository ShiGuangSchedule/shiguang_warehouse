/**
 * 基础工具函数：Base64 编码
 */
function encodeParams(xn, xq) {
    const rawStr = `xnm=${xn}&xqm=${xq}`;
    return rawStr;
}

/**
 * 判断是否处于教务系统登录环境
 */
async function checkLoginEnvironment() {
    const currentUrl = window.location.href;
    const loginUrl = "http://jwxt.nbut.edu.cn/jwglxt/xtgl/login_slogin.html";
    const targetUrl = "http://jwxt.nbut.edu.cn/"

    if (!currentUrl.includes(targetUrl)) {
        window.shiguangBridge.showToast("不处于教务系统网站，自动为你跳转");
        window.location.href = loginUrl;
        return false;
    } 
    if (currentUrl.includes(loginUrl)) {
        window.shiguangBridge.showToast("请先登录教务系统再进行导入");
        return false;
    }
    return true; 
}

/**
 * 星期解析函数
 */
function parseDayOfWeek(dateString){
    const weekdayMap = {
    "星期一": 1,
    "星期二": 2,
    "星期三": 3,
    "星期四": 4,
    "星期五": 5,
    "星期六": 6,
    "星期日": 7
    };
    return weekdayMap[dateString] || null;
}

/**
 * 上课周次解析函数
 */
function parseWeek(weekString){
    let a = weekString;
    a = a.replace("周","");
    a = a.replace("(","").replace(")","");
    const isSingle = a.includes("单");
    const isDouble = a.includes("双");
    a = a.replace("单","").replace("双","");
    const [start,end] = a.split("-").map(Number);
    const weeks = []
    for(let i = start;i <= end;i++){
        if(isSingle && i % 2 === 0){
            continue;
        }
        if(isDouble && i % 2 === 1){
            continue;
        }
        weeks.push(i);
    }
    return weeks;
}


/**
 * 处理单个课程信息
 */
function parseSingleCourseData(jsonObject){
    const singleCourse = new Object();
    singleCourse.name = jsonObject.kcmc;
    singleCourse.teacher = jsonObject.xm;
    singleCourse.position = jsonObject.cdmc;
    singleCourse.day = parseDayOfWeek(jsonObject.xqjmc);
    singleCourse.startSection = jsonObject.jcs.split("-").map(Number)[0];
    singleCourse.endSection = jsonObject.jcs.split("-").map(Number)[1];
    singleCourse.weeks = parseWeek(jsonObject.zcd);
    singleCourse.id = jsonObject.kch_id;
    return singleCourse;
}

/**
 * 课表数据解析函数
 */
function parseAllCourseData(jsonObject) {
    const newCourseList = [];
    const oldCourseList = jsonObject.kbList;
    for(let i = 0;i < oldCourseList.length;i++){
        newCourseList.push(parseSingleCourseData(oldCourseList[i]));
    }
    return newCourseList;
}

/**
 * 学期获取函数
 */
async function fetchYearAndSemester() {
    try {
        const response = await fetch("http://jwxt.nbut.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default", {
        });
        const html = await response.text();
        const dom = new DOMParser().parseFromString(html, 'text/html');
        xn = dom.getElementById("xnm").value;
        xq = dom.getElementById("xqm").value;
        return {xn,xq};
    } catch (error) {
        return null;
    }
}

/**
 * 课表抓取函数
 */
async function fetchCourses(xn, xq) {
    const paramsBase64 = encodeParams(xn, xq);
    const response = await fetch("http://jwxt.nbut.edu.cn/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151",{
        method: 'POST',
        body: paramsBase64,
        headers:{
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'http://jwxt.nbut.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default',
            'Origin': 'http://jwxt.nbut.edu.cn',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        credentials: 'include',
        mode:'cors'
    })
    if(!response.ok){
        throw new Error(`课表信息请求失败：${response.status}`);
    }
    const courseJson = await response.json();
    return parseAllCourseData(courseJson);
}

/**
 * 单个时间段解析函数
 */
function parseSinglePresetTimeSlot(jsonObject) {
    const timeData = new Object();
    timeData.number = jsonObject.jcmc;
    timeData.startTime = jsonObject.qssj;
    timeData.endTime = jsonObject.jssj;
    return timeData;
}


/**
 * 时间段解析函数
 */
function parseAllPresetTimeSlot(jsonObject) {
    const newTimeSlotList = [];
    const oldTimeSlotList = jsonObject;
    for(let i = 0;i < oldTimeSlotList.length;i++){
        newTimeSlotList.push(parseSinglePresetTimeSlot(oldTimeSlotList[i]));
    }
    return newTimeSlotList;
}

/**
 * 时间段导入函数
 */
async function fetchPresetTimeSlots(xn,xq) {
    const requestBody = encodeParams(xn,xq);
    const response = await fetch("http://jwxt.nbut.edu.cn/jwglxt/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151",{
        method : 'POST',
        body : requestBody,
        headers : {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept' : '*/*',
            'Content-Type' : 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'Origin' : 'http://jwxt.nbut.edu.cn',
            'Referer': 'http://jwxt.nbut.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default'
        },
        credentials: 'include',
        mode:'cors'
    })
    if(!response.ok){
        throw new Error(`时间段信息请求失败：${response.status}`)
    }
    const timeJson = await response.json();
    return parseAllPresetTimeSlot(timeJson);
}

/**
 * 全局配置解析函数
 */
async function fetchConfig(params) {
    try{
        const response = await fetch("http://jwxt.nbut.edu.cn/jwglxt/pkgl/xlglMobile_cxXlIndexForxs.html?gnmkdm=Y210501&layout=default",{
            method : 'GET',
            headers : {
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Content-Type' : 'application/x-www-form-urlencoded;charset=UTF-8',
                'User-Agent' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                'Origin' : 'http://jwxt.nbut.edu.cn',
                'Referer': 'http://jwxt.nbut.edu.cn/jwglxt/xtgl/index_initMenu.html?jsdm=xs&_t=1776496821521&echarts=1',
                'Upgrade-Insecure-Requests' : '1',
                'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
            },
            credentials: 'include',
            mode:'cors'
        })
        const html = await response.text();
        const dom = new DOMParser().parseFromString(html,'text/html');
        const semesterStartDate = dom.getElementById("ksrq").value;

        const config = new Object();
        config.semesterStartDate = semesterStartDate;
        config.defaultClassDuration = 40;
        return config;
    }catch(error){
        return null;
    }
   
}

/**
 * 最终流程控制
 */
async function runImportFlow() {
    console.log("开始导入")
    // 环境检查
    const isReady = await checkLoginEnvironment();
    if (!isReady) {
        console.log("不处于教务页面，或未登录")
        return
    };
    // 获取当前学期
    const params = await fetchYearAndSemester();
    if (!params){
        console.log("未找到学期")
        return;
    } ;
    // 获取，解析，保存课程数据
    const courses = await fetchCourses(params.xn, params.xq);
    if (!courses || courses.length === 0) {
        console.log("未找到有效课程");
        return;
    }
    await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));

    // 获取，解析，保存时间段
    const time = await fetchPresetTimeSlots(params.xn, params.xq);
    if (!time || time.length === 0) {
        console.log("未找到有效时间段");
        return;
    }
    await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(time));

    const config = await fetchConfig(params);
    if(!config){
        console.log("未找到学校全局配置")
        return;
    }
    await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config));
    // 完成
    console.log('导入成功')
    window.shiguangBridge.notifyTaskCompletion();
}

// 启动
runImportFlow();