(function() {
    'use strict';

    function timeToMinutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
    function minutesToTime(m) { const hh=String(Math.floor(m/60)).padStart(2,'0'); const mm=String(m%60).padStart(2,'0'); return hh+':'+mm; }
    function parseWeeks(weekStr) {
        const cleaned = weekStr.replace(/[\[\]]/g,'').trim();
        let parity=null;
        if(cleaned.includes('(单周)')||cleaned.includes('单周')) parity=1;
        else if(cleaned.includes('(双周)')||cleaned.includes('双周')) parity=2;
        const m=cleaned.match(/(\d+)\s*[-~—]\s*(\d+)/);
        if(!m) return [];
        let s=parseInt(m[1]), e=parseInt(m[2]), weeks=[];
        for(let i=s;i<=e;i++) {
            if(parity===1 && i%2===0) continue;
            if(parity===2 && i%2!==0) continue;
            weeks.push(i);
        }
        return weeks;
    }

    function getScheduleDocument() {
        let dv = document.getElementById('dv1');
        if (dv && dv.querySelector('table tbody tr')) return document;
        const iframes = document.querySelectorAll('iframe');
        for (let f of iframes) {
            try {
                const doc = f.contentDocument || f.contentWindow.document;
                dv = doc.getElementById('dv1');
                if (dv && dv.querySelector('table tbody tr')) return doc;
            } catch(e) {}
        }
        return null;
    }

    function parseConfig(doc) {
        const ws = doc.getElementById('week');
        if(!ws) return { semesterStartDate:null, semesterTotalWeeks:20 };
        let sDate=null, total=0;
        ws.querySelectorAll('option').forEach(o=>{
            if(o.value && o.value!=='all'){
                if(!sDate) sDate=o.value;
                total++;
            }
        });
        return { semesterStartDate:sDate, semesterTotalWeeks:total||20 };
    }

    function parseTimeSlots(doc) {
        const slots=[];
        doc.querySelectorAll('#dv1 tbody tr').forEach(row=>{
            const first=row.querySelector('td:first-child');
            if(!first) return;
            const ps=first.querySelectorAll('p');
            if(ps.length<2) return;
            const secMatch=ps[0].textContent.trim().match(/\((\d+),\s*(\d+)小节\)/);
            if(!secMatch) return;
            const start=parseInt(secMatch[1]), end=parseInt(secMatch[2]);
            const timeMatch=ps[1].textContent.trim().match(/(\d{2}:\d{2})\s*[-~—]\s*(\d{2}:\d{2})/);
            if(!timeMatch) return;
            const bs=timeToMinutes(timeMatch[1]), be=timeToMinutes(timeMatch[2]);
            const dur=45;
            slots.push({number:start,startTime:timeMatch[1],endTime:minutesToTime(bs+dur)});
            slots.push({number:end,startTime:minutesToTime(be-dur),endTime:timeMatch[2]});
        });
        return slots.sort((a,b)=>a.number-b.number);
    }

    function parseCourses(doc) {
        const courses=[];
        doc.querySelectorAll('#dv1 tbody tr').forEach(row=>{
            const first=row.querySelector('td:first-child');
            if(!first) return;
            const ps=first.querySelectorAll('p');
            if(ps.length<2) return;
            const secMatch=ps[0].textContent.trim().match(/\((\d+),\s*(\d+)小节\)/);
            if(!secMatch) return;
            const startSec=parseInt(secMatch[1]), endSec=parseInt(secMatch[2]);
            row.querySelectorAll('td.kb-cell').forEach((cell,idx)=>{
                const day=idx+1;
                const classDiv=cell.querySelector('.person-class');
                if(!classDiv) return;
                const nameEl=classDiv.querySelector('h3 a');
                if(!nameEl) return;
                const lis=classDiv.querySelectorAll('ul>li');
                if(lis.length<4) return;
                const weeks=parseWeeks(lis[1].textContent.trim());
                if(!weeks.length) return;
                courses.push({
                    name:nameEl.textContent.trim(),
                    teacher:lis[2].textContent.trim(),
                    position:lis[3].textContent.trim(),
                    day, startSection:startSec, endSection:endSec,
                    weeks, isCustomTime:false
                });
            });
        });
        return courses;
    }

    async function saveCourses(c){ try{await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(c));}catch(e){} }
    async function saveTimeSlots(s){ try{await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(s));}catch(e){} }
    async function saveConfig(c){ try{await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(c));}catch(e){} }

    function waitForScheduleDoc(maxWait=15000) {
        const start=Date.now();
        return new Promise((resolve,reject)=>{
            function check(){
                const doc = getScheduleDocument();
                if(doc) return resolve(doc);
                if(Date.now()-start > maxWait) return reject(new Error('课表加载超时'));
                setTimeout(check,300);
            }
            check();
        });
    }

    async function main() {
        try {
            const doc = await waitForScheduleDoc();
            const config = parseConfig(doc);
            const timeSlots = parseTimeSlots(doc);
            const courses = parseCourses(doc);
            await saveConfig(config);
            await saveTimeSlots(timeSlots);
            await saveCourses(courses);
            window.shiguangBridge.notifyTaskCompletion();
        } catch(e) {}
    }

    setTimeout(main, 500);
})();