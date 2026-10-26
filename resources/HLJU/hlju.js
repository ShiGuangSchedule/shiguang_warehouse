function findHljuTimetableRequest(){
    const resources=performance.getEntriesByType("resource");
    const matches=resources.map(item=>item.name).filter(url=>url.includes("TimeTableNewService/GetTimeTableByStudent"));
    return matches.length?matches[matches.length-1]:null;
}

async function fetchHljuTimetable(){
    const url=findHljuTimetableRequest();
    if(!url){
        throw new Error("没有找到课表请求，请先打开黑龙江大学课表并查询。");
    }
    const response=await fetch(url,{
        method:"GET",
        credentials:"include",
        headers:{
            "Accept":"application/json, text/javascript, */*; q=0.01",
            "X-Requested-With":"XMLHttpRequest"
        }
    });
    if(!response.ok){
        throw new Error(`课表请求失败 HTTP ${response.status}`);
    }
    const data=await response.json();
    if(!Array.isArray(data)){
        throw new Error("课表接口返回格式错误");
    }
    return data;
}

function parseSections(text){
    if(!text)return null;
    const match=text.match(/(\d+)\s*(?:,|，|-|~|～|至)\s*(\d+)/);
    if(!match)return null;
    return {
        start:Number(match[1]),
        end:Number(match[2])
    };
}

function parseWeeks(text){
    if(!text)return [];
    const weeks=new Set();
    const regex=/(\d+)\s*[-~～至]\s*(\d+)/g;
    let match;
    while((match=regex.exec(text))!==null){
        const start=Number(match[1]);
        const end=Number(match[2]);
        for(let i=start;i<=end;i++){
            weeks.add(i);
        }
    }
    return Array.from(weeks).sort((a,b)=>a-b);
}

function parseMultiTeacherWeeks(text){
    const result=[];
    if(!text)return result;
    const regex=/(\d+(?:[-~～]\d+)?)\(([^)]+)\)/g;
    let match;
    while((match=regex.exec(text))!==null){
        result.push({
            teacher:match[2].trim(),
            weeks:parseWeeks(match[1])
        });
    }
    return result;
}

function getField(lines,name){
    for(const line of lines){
        const match=line.match(new RegExp("^"+name+"\\s*[:：](.*)$"));
        if(match)return match[1].trim();
    }
    return "";
}

function parseCourseBlock(block,weekday,sections){
    const lines=block.split(/\r?\n/).map(x=>x.trim()).filter(x=>x);
    if(lines.length<1)return [];

    const name=lines[0];
    const weekText=getField(lines,"周次");
    const position=getField(lines,"地点");

    const multi=parseMultiTeacherWeeks(weekText);
    const courses=[];

    if(multi.length){
        for(const item of multi){
            courses.push({
                name:name,
                teacher:item.teacher,
                position:position,
                day:weekday,
                startSection:sections.start,
                endSection:sections.end,
                weeks:item.weeks,
                isCustomTime:false
            });
        }
        return courses;
    }

    const teacherLine=lines[1]||"";
    const teacher=teacherLine.split(/\s+/)[0].trim();
    const weeks=parseWeeks(weekText);

    if(!weeks.length)return [];

    courses.push({
        name:name,
        teacher:teacher,
        position:position,
        day:weekday,
        startSection:sections.start,
        endSection:sections.end,
        weeks:weeks,
        isCustomTime:false
    });

    return courses;
}

function parseCourseCell(content,weekday,sections){
    if(!content||typeof content!=="string")return [];
    const text=content.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
    if(!text)return [];

    const blocks=text.split(/\n\s*\n+/).map(x=>x.trim()).filter(x=>x);

    let result=[];

    for(const block of blocks){
        result.push(...parseCourseBlock(block,weekday,sections));
    }

    return result;
}
function parseHljuTimetable(data){
    const weekdayFields=[
        {field:"Monday",day:1},
        {field:"Tuesday",day:2},
        {field:"Wednesday",day:3},
        {field:"Thursday",day:4},
        {field:"Friday",day:5},
        {field:"Saturday",day:6},
        {field:"Sunday",day:7}
    ];

    const courses=[];

    for(const row of data){
        if(!row||typeof row!=="object")continue;

        const sections=parseSections(row.JieCi);

        if(!sections){
            console.warn("无法解析节次:",row.JieCi);
            continue;
        }

        for(const weekday of weekdayFields){
            const content=row[weekday.field];

            if(!content)continue;

            const result=parseCourseCell(
                content,
                weekday.day,
                sections
            );

            courses.push(...result);
        }
    }

    return courses;
}

function validateCourses(courses){
    if(!Array.isArray(courses)){
        throw new Error("课程解析结果错误");
    }

    if(courses.length===0){
        throw new Error("没有解析到任何课程");
    }

    for(const course of courses){
        if(!course.name){
            throw new Error("存在课程名称为空");
        }

        if(!Number.isInteger(course.day)){
            throw new Error(
                `课程 ${course.name} 星期解析错误`
            );
        }

        if(!Number.isInteger(course.startSection)||
           !Number.isInteger(course.endSection)){
            throw new Error(
                `课程 ${course.name} 节次解析错误`
            );
        }

        if(!Array.isArray(course.weeks)||
           course.weeks.length===0){
            throw new Error(
                `课程 ${course.name} 周次解析错误`
            );
        }
    }
}

function printCourses(courses){
    console.log(
        "========== 黑龙江大学课程解析结果 =========="
    );

    console.table(
        courses.map(course=>({
            课程:course.name,
            教师:course.teacher,
            地点:course.position,
            星期:course.day,
            节次:
            `${course.startSection}-${course.endSection}`,
            周次:
            course.weeks.join(",")
        }))
    );

    console.log(
        "完整课程数据:",
        courses
    );

    console.log(
        "=========================================="
    );
}

async function saveHljuCourses(courses){
    try{
        await window.AndroidBridgePromise.saveImportedCourses(
            JSON.stringify(courses)
        );

        AndroidBridge.showToast(
            `成功导入 ${courses.length} 个课程时段`
        );

        return true;

    }catch(error){

        console.error(
            "保存课程失败:",
            error
        );

        AndroidBridge.showToast(
            "课程保存失败:"+error.message
        );

        return false;
    }
}

async function runImportFlow(){
    try{
        AndroidBridge.showToast(
            "正在获取黑龙江大学课表..."
        );

        const timetable=
            await fetchHljuTimetable();

        console.log(
            "黑龙江大学原始数据:",
            timetable
        );

        const courses=
            parseHljuTimetable(
                timetable
            );

        validateCourses(
            courses
        );

        printCourses(
            courses
        );

        const success=
            await saveHljuCourses(
                courses
            );

        if(!success){
            return;
        }

        AndroidBridge.showToast(
            "黑龙江大学课表导入成功"
        );

        AndroidBridge.notifyTaskCompletion();

    }catch(error){

        console.error(
            "========== 导入失败 ==========",
            error
        );

        AndroidBridge.showToast(
            "导入失败:"+error.message
        );
    }
}

runImportFlow();
