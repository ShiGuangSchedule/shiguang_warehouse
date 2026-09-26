/* Synthetic fixtures only. Open tests.html in a browser. */
(async function () {
  'use strict';
  const api = window.NEFUAdapter;
  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });
  const assert = (v, message = '断言失败') => { if (!v) throw new Error(message); };
  const equal = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const throws = (fn, code) => { try { fn(); } catch (e) { equal(e.code, code); return; } throw new Error('应当拒绝该输入'); };
  const rejects = async (fn, code) => { try { await fn(); } catch (e) { equal(e.code, code); return; } throw new Error('应当拒绝该请求'); };
  const card = (time = '1-8周[1-2节]', name = '示例课程', teacher = '示例教师', place = '示例楼101') => `<li class="courselists-item"><div class="qz-hasCourse-title">${name}</div><p><span class="qz-hasCourse-abbrinfo">老师:${teacher};时间:${time};地点:${place}</span><span name="dealeSpan">班级:虚构;总人数:99;</span><span name="kchSpan">课程编号:DEMO</span></p></li>`;
  const cell = (cards = '', rowspan = 1) => `<td name="kbDataTd" rowspan="${rowspan}"><ul name="kbdataUl" kbdatasize="${(cards.match(/<li /g) || []).length}">${cards}</ul></td>`;
  const row = (start, cells) => `<tr><td name="timeTd"><div>第${start}大节</div><div>(${start}、${start + 1}小节)</div><div>08:00~09:35</div></td>${cells.join('')}</tr>`;
  const emptyCells = () => Array.from({ length: 7 }, () => cell());
  function fixture(rows = [row(1, emptyCells()), row(3, emptyCells())], extra = '') {
    return `<html><head><title>课表</title></head><body><select id="xnxq01id"><option value="FUTURE">未来学期</option><option value="DEMO" selected>示例学期</option></select><select id="kbjcmsid"><option value="MAIN" selected>本部</option></select><select id="zc"><option value="" selected>全部</option><option value="2">第2周</option></select><table class="qz-weeklyTable"><thead><tr><th>周次</th>${['一','二','三','四','五','六','日'].map(d => `<th>星期${d}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody><tfoot><tr><td>备注</td><td colspan="7" class="qz-weeklyTable-detailtext">${extra}</td></tr></tfoot></table></body></html>`;
  }
  const single = (contents = card()) => { const c = emptyCells(); c[0] = cell(contents); return fixture([row(1, c), row(3, emptyCells())]); };
  test('有效空课表不是失败', () => { const r = api.parseHTML(fixture()); equal(r.status, 'scheduled-empty'); equal(r.courses, []); });
  test('保留无具体时间备注但不伪造课程', () => { const r = api.parseHTML(fixture(undefined, '示例实践 1-18周')); equal(r.courses.length, 0); equal(r.remarks, ['示例实践 1-18周']); });
  test('标准课程符合拾光数据字段', () => equal(api.parseHTML(single()).courses[0], {name:'示例课程',teacher:'示例教师',position:'示例楼101',day:1,weeks:[1,2,3,4,5,6,7,8],startSection:1,endSection:2}));
  test('未来学期排首位时仍使用 selected', () => equal(api.parseHTML(fixture()).semesterId, 'DEMO'));
  test('离散区间、排序、重复周去重', () => equal(api.parseTime('7-8,1-5,3周[1-2节]').weeks, [1,2,3,4,5,7,8]));
  test('真实格式：1-17单周', () => equal(api.parseTime('1-17单周[3-4节]').weeks, [1,3,5,7,9,11,13,15,17]));
  test('真实格式：1-17双周', () => equal(api.parseTime('1-17双周[3-4节]').weeks, [2,4,6,8,10,12,14,16]));
  test('显式括号单双周', () => equal(api.parseTime('1-6周(双周)[1-2节]').weeks, [2,4,6]));
  test('不按单双周 JSON 标签猜测普通 HTML 周次', () => equal(api.parseTime('6周[3-4节]').weeks, [6]));
  test('单节课程', () => equal(api.parseTime('2周[3节]').ranges, [[3,3]]));
  test('中文顿号节次', () => equal(api.parseTime('1，3周[1、2节]').ranges, [[1,2]]));
  test('不连续节次分成两条记录', () => { const r = api.parseHTML(single(card('1周[1、3节]'))); equal(r.courses.map(c => [c.startSection,c.endSection]), [[1,1],[3,3]]); });
  test('完全重复记录去重', () => equal(api.parseHTML(single(card()+card())).courses.length, 1));
  test('同名异地不合并', () => equal(api.parseHTML(single(card()+card('1-8周[1-2节]', '示例课程', '示例教师', '示例楼202'))).courses.length, 2));
  test('空教师与空地点仍保留', () => { const c = api.parseHTML(single(card('1周[1节]', '示例课程', '', ''))).courses[0]; equal([c.teacher,c.position],['','']); });
  test('不拼入课程编号、班级与人数', () => { const c = api.parseHTML(single()).courses[0]; equal(c.position, '示例楼101'); assert(!JSON.stringify(c).includes('99')); });
  test('rowspan 下方星期四不误判为星期三', () => {
    const a = emptyCells(); a[2] = cell(card('1周[1-3节]'), 2);
    const b = emptyCells(); b.splice(2, 1); b[2] = cell(card('2周[3-4节]', '示例晚课'));
    equal(api.parseHTML(fixture([row(1,a),row(3,b)])).courses.map(c => c.day), [3,4]);
  });
  test('按星期表头映射而非固定列次序', () => {
    const html = single().replace('星期一','交换').replace('星期二','星期一').replace('交换','星期二');
    equal(api.parseHTML(html).courses[0].day, 2);
  });
  test('登录页拒绝，不转换成空数组', () => throws(() => api.parseHTML('<title>登录</title><input id="userPassword">'), 'LOGIN_REQUIRED'));
  test('外层框架拒绝', () => throws(() => api.parseHTML('<iframe id="Iframe1"></iframe>'), 'NOT_TIMETABLE'));
  test('缺失周表拒绝', () => throws(() => api.parseHTML(fixture().replace('qz-weeklyTable','other-table')), 'NOT_TIMETABLE'));
  test('重复表拒绝', () => throws(() => api.parseHTML(fixture().replace('</body>', '<table class="qz-weeklyTable"></table></body>')), 'NOT_TIMETABLE'));
  test('表头缺失拒绝', () => throws(() => api.parseHTML(fixture().replace('星期日','未知')), 'BAD_HEADER'));
  test('单元格缺失拒绝', () => throws(() => api.parseHTML(fixture([row(1, emptyCells().slice(1)),row(3,emptyCells())])), 'BAD_GRID'));
  test('跨行越界拒绝', () => throws(() => api.parseHTML(single().replace('rowspan="1"','rowspan="3"')), 'BAD_GRID'));
  test('未知卡片结构拒绝', () => throws(() => api.parseHTML(single().replace('courselists-item','new-course')), 'BAD_CARD'));
  test('卡片计数不符拒绝', () => throws(() => api.parseHTML(single().replace('kbdatasize="1"','kbdatasize="2"')), 'BAD_CARD'));
  test('缺名称拒绝', () => throws(() => api.parseHTML(single(card('1周[1节]', ''))), 'BAD_CARD'));
  test('缺字段拒绝', () => throws(() => api.parseHTML(single().replace('老师:', '讲授人:')), 'BAD_CARD'));
  test('格式变更拒绝而不是跳过课程', () => throws(() => api.parseHTML(single(card('每周一上课'))), 'INVALID_TIME'));
  test('非法零周拒绝', () => throws(() => api.parseTime('0周[1节]'), 'INVALID_RANGE'));
  test('倒序周次拒绝', () => throws(() => api.parseTime('8-1周[1节]'), 'INVALID_RANGE'));
  test('过大范围拒绝', () => throws(() => api.parseTime('1-999周[1节]'), 'INVALID_RANGE'));
  test('单双周矛盾拒绝', () => throws(() => api.parseTime('1-8单周(双)[1节]'), 'INVALID_TIME'));
  test('单双周过滤变空拒绝', () => throws(() => api.parseTime('2单周[1节]'), 'INVALID_TIME'));
  test('节次不在作息模式中拒绝', () => throws(() => api.parseHTML(single(card('1周[5-6节]'))), 'BAD_CARD'));
  test('服务器返回错误学期拒绝', () => throws(() => api.parseHTML(fixture(),{semesterId:'OTHER'}), 'QUERY_MISMATCH'));
  test('服务器返回错误校区模式拒绝', () => throws(() => api.parseHTML(fixture(),{modeId:'OTHER'}), 'QUERY_MISMATCH'));
  test('服务器返回错误周次拒绝', () => throws(() => api.parseHTML(fixture(),{week:'2'}), 'QUERY_MISMATCH'));
  test('大节时间不冒充 timeSlots', () => { const r = api.parseHTML(fixture()); assert(!('timeSlots' in r)); equal(r.teachingBlocks[0].sections,[1,2]); });
  test('缺失大节钟点不编造', () => { const r = api.parseHTML(fixture().replaceAll('08:00~09:35','')); equal(r.teachingBlocks[0].startTime,null); });
  test('错误运行域名拒绝', () => throws(() => api.createClient({location:{origin:'https://example.invalid'}}), 'WRONG_ORIGIN'));
  const response = (html, status = 200) => ({ok:status===200,status,url:'https://jwxt.nefu.edu.cn/jsxsd/xskb/xskb_list.do',text:async()=>html});
  test('客户端只做同源 GET，并正确选择学期', async () => {
    const calls = [];
    const client = api.createClient({location:{origin:'https://jwxt.nefu.edu.cn'},fetch:async(url,options)=>{calls.push({url,options});return response(single());}});
    const result = await client.load({semesterId:'DEMO',modeId:'MAIN'});
    equal(result.courses.length,1); equal(calls.length,2);
    assert(calls.every(c=>c.options.method==='GET'&&c.options.credentials==='same-origin'));
    equal(new URL(calls[1].url,'https://jwxt.nefu.edu.cn').searchParams.get('viweType'),'0');
    assert(!('save' in client));
  });
  test('客户端 HTTP 失败拒绝', async () => {
    const client=api.createClient({location:{origin:'https://jwxt.nefu.edu.cn'},fetch:async()=>response('',503)});
    await rejects(()=>client.options(),'HTTP_ERROR');
  });
  test('客户端登录过期拒绝', async () => {
    const client=api.createClient({location:{origin:'https://jwxt.nefu.edu.cn'},fetch:async()=>response('<input id="userAccount">')});
    await rejects(()=>client.options(),'LOGIN_REQUIRED');
  });
  test('客户端不接受不存在的学期', async () => {
    const client=api.createClient({location:{origin:'https://jwxt.nefu.edu.cn'},fetch:async()=>response(fixture())});
    await rejects(()=>client.load({semesterId:'BAD'}),'BAD_SELECTION');
  });

  const course = (overrides = {}) => ({ name: '测试课程', teacher: '测试教师', position: '测试地点', day: 1, startSection: 1, endSection: 2, weeks: [1, 2], ...overrides });
  function atoms(courses) {
    const result = new Set();
    for (const c of courses) for (const w of c.weeks) for (let s = c.startSection; s <= c.endSection; s++) {
      result.add(JSON.stringify([c.name, c.teacher, c.position, c.day, w, s]));
    }
    return [...result].sort();
  }
  test('合并重复、连续节次和周次', () => {
    const input = [course(), course(), course({startSection:3,endSection:4}), course({weeks:[3],endSection:4})];
    equal(api.mergeCourses(input), [course({endSection:4,weeks:[1,2,3]})]);
  });
  test('不跨教师、地点或星期合并', () => {
    const input = [course(), course({teacher:'另一教师'}), course({position:'另一地点'}), course({day:2}), course({name:'另一课程'})];
    equal(api.mergeCourses(input).length,5);
  });
  test('不跨节次空隙合并', () => equal(api.mergeCourses([course(), course({startSection:4,endSection:5})]).length,2));
  test('部分周次连续节次不扩展到其他周', () => {
    const input = [course(), course({startSection:3,endSection:4,weeks:[2,3]})];
    equal(atoms(api.mergeCourses(input)), atoms(input));
    equal(api.mergeCourses(input).length,3);
  });
  test('重叠与包含区间保持全部上课时间', () => {
    const input = [course({endSection:4}), course({startSection:2,endSection:3}), course({startSection:4,endSection:6})];
    equal(api.mergeCourses(input),[course({endSection:6})]);
  });
  test('合并不修改输入，周次排序去重', () => {
    const input = [course({weeks:[3,1,1]})], before=JSON.stringify(input);
    equal(api.mergeCourses(input)[0].weeks,[1,3]); equal(JSON.stringify(input),before);
  });
  test('合并 1000 组随机数据保持逐周逐节语义，且幂等', () => {
    let seed=10225;
    const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let i=0;i<1000;i++) {
      const input=Array.from({length:1+random(20)},()=>{const start=1+random(10);return course({
        name:'测试'+random(2),teacher:'教师'+random(2),position:'地点'+random(2),day:1+random(7),
        startSection:start,endSection:start+random(13-start),weeks:Array.from({length:1+random(10)},()=>1+random(20))
      });});
      const output=api.mergeCourses(input);
      equal(atoms(output),atoms(input)); equal(api.mergeCourses(output),output);
      equal(api.mergeCourses([...input].reverse()),output);
    }
  });
  function scenario({html=single(), selected=1, saveResult=true, saveError=false, fetchError=false, status=200, redirect=false}={}) {
    const calls={fetch:[],selection:[],save:[],toast:[],done:0,order:[]};
    const env={location:{origin:'https://jwxt.nefu.edu.cn'},fetch:async(url,options)=>{
      calls.fetch.push({url,options});
      if(fetchError) throw new TypeError('network failure');
      const doc=new DOMParser().parseFromString(html,'text/html');
      const params=new URL(url,env.location.origin).searchParams;
      for(const id of ['xnxq01id','kbjcmsid','zc']) if(params.has(id)&&doc.getElementById(id)) doc.getElementById(id).value=params.get(id);
      // outerHTML 不会序列化 select.value，需要同步 selected 属性。
      for(const select of doc.querySelectorAll('select')) for(const opt of select.options) opt.toggleAttribute('selected', opt.selected);
      return {...response(doc.documentElement.outerHTML,status),url:redirect?'https://login.invalid/':env.location.origin+'/jsxsd/xskb/xskb_list.do'};
    },shiguangBridgePromise:{
      showSingleSelection:async(...args)=>{calls.selection.push(args);return selected;},
      saveImportedCourses:async(value)=>{calls.save.push(value);calls.order.push('save');if(saveError)throw new Error('save failed');return saveResult;},
      savePresetTimeSlots:()=>{throw new Error('不应写入作息');},
      saveCourseConfig:()=>{throw new Error('不应写入配置');},
      showAlert:()=>{throw new Error('不应增加确认弹窗');}
    },shiguangBridge:{showToast:message=>calls.toast.push(message),notifyTaskCompletion:()=>{calls.done++;calls.order.push('done');}}};
    return {env,calls};
  }
  test('完整流程使用 V2 桥接和服务端默认学期，只保存一次 JSON 字符串', async()=>{
    const {env,calls}=scenario(); equal(await api.runImportFlow(env),{status:'saved',count:1});
    equal(calls.selection[0][2],1); equal(JSON.parse(calls.selection[0][1]),['未来学期','示例学期']);
    equal(calls.fetch.length,2); equal(calls.save.length,1); equal(typeof calls.save[0],'string');
    equal(JSON.parse(calls.save[0]),api.mergeCourses(api.parseHTML(single()).courses));
    equal(calls.order,['save','done']); assert(calls.toast.some(x=>x.includes('保留原有作息')));
    const q=new URL(calls.fetch[1].url,env.location.origin).searchParams;
    equal(q.get('viweType'),'0'); equal(q.get('zc'),''); equal(q.get('kbjcmsid'),'MAIN');
    assert(calls.fetch.every(c=>c.options.method==='GET'&&c.options.credentials==='same-origin'));
  });
  test('索引 0 是有效学期，不是取消', async()=>{
    const {env,calls}=scenario({selected:0}); equal((await api.runImportFlow(env)).status,'saved');
    equal(new URL(calls.fetch[1].url,env.location.origin).searchParams.get('xnxq01id'),'FUTURE');
  });
  test('取消学期选择终止流程',async()=>{
    const {env,calls}=scenario({selected:null}); equal((await api.runImportFlow(env)).status,'cancelled');
    equal(calls.fetch.length,1); equal(calls.save,[]); equal(calls.done,0);
  });
  test('无效选择不调用保存',async()=>{
    for(const selected of [-1,2,undefined,'0',NaN]) {
      const s=scenario(); s.env.shiguangBridgePromise.showSingleSelection=async()=>selected;
      equal((await api.runImportFlow(s.env)).code,'BAD_SELECTION'); equal(s.calls.save,[]); equal(s.calls.done,0);
    }
  });
  test('正常空课表按 App 流程提交空数组',async()=>{
    const {env,calls}=scenario({html:fixture(undefined,'测试实践项目')});
    equal(await api.runImportFlow(env),{status:'saved',count:0}); equal(calls.save,['[]']); equal(calls.done,1);
    assert(calls.toast.some(x=>x.includes('备注项目')));
  });
  test('仅用本部选项构造请求，不校验用户身份',async()=>{
    const html=single().replace('<option value="MAIN" selected>本部</option>','<option value="OTHER" selected>另一模式</option><option value="MAIN">本部</option>');
    const {env,calls}=scenario({html}); equal((await api.runImportFlow(env)).status,'saved');
    equal(new URL(calls.fetch[1].url,env.location.origin).searchParams.get('kbjcmsid'),'MAIN');
  });
  test('选项改名时沿用教务默认模式，不额外拦截校区',async()=>{
    const {env}=scenario({html:single().replace('>本部</option>','>教务默认</option>')}); equal((await api.runImportFlow(env)).status,'saved');
  });
  for(const [name,options,code] of [
    ['登录页',{html:'<input id="userAccount">'},'LOGIN_REQUIRED'],
    ['结构变更',{html:single().replace('qz-weeklyTable','unknown-table')},'NOT_TIMETABLE'],
    ['HTTP 失败',{status:503},'HTTP_ERROR'],
    ['网络断开',{fetchError:true},'IMPORT_FAILED'],
    ['登录跳转',{redirect:true},'LOGIN_REQUIRED']
  ]) test(name+'报告错误，不伪造空课表',async()=>{
    const {env,calls}=scenario(options); equal((await api.runImportFlow(env)).code,code);
    equal(calls.save,[]); equal(calls.done,0); assert(calls.toast.some(x=>x.startsWith('导入失败')));
  });
  for(const saveResult of [false,undefined,null,'true']) test('非成功保存结果 '+saveResult+' 不发送完成信号',async()=>{
    const {env,calls}=scenario(); env.shiguangBridgePromise.saveImportedCourses=async()=>saveResult;
    equal((await api.runImportFlow(env)).code,'SAVE_FAILED'); equal(calls.done,0);
  });
  test('保存异常不发送完成信号',async()=>{
    const {env,calls}=scenario({saveError:true}); equal((await api.runImportFlow(env)).status,'error');
    equal(calls.save.length,1); equal(calls.done,0);
  });
  test('完成信号在异步保存成功之后发送',async()=>{
    const {env,calls}=scenario(); let release,started;
    const ready=new Promise(resolve=>{started=resolve;});
    env.shiguangBridgePromise.saveImportedCourses=()=>{started();return new Promise(resolve=>{release=resolve;});};
    const run=api.runImportFlow(env); await ready; equal(calls.done,0); release(true); await run; equal(calls.done,1);
  });
  test('请求中止报告超时',async()=>{
    const {env,calls}=scenario(); env.fetch=async()=>{throw new DOMException('aborted','AbortError');};
    equal((await api.runImportFlow(env)).code,'TIMEOUT'); equal(calls.done,0);
  });
  test('浏览器直接执行正式文件会自动启动导入',async()=>{
    const {env,calls}=scenario(); let done; const completed=new Promise(resolve=>{done=resolve;});
    env.shiguangBridge.notifyTaskCompletion=()=>{calls.done++;done();};
    new Function('window', window.NEFUSource)(env);
    await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('入口未执行')),2000))]);
    equal(calls.done,1); equal(calls.save.length,1);
  });
  const results = [];
  for (const {name,fn} of cases) {
    try { await fn(); results.push({name,pass:true}); }
    catch (error) { results.push({name,pass:false,error:String(error)}); }
  }
  window.NEFUAdapterTestResults = { total: results.length, passed: results.filter(r=>r.pass).length, results };
  const el=document.getElementById('results');
  el.textContent=`${window.NEFUAdapterTestResults.passed}/${results.length} 通过\n\n`+results.map(r=>`${r.pass?'PASS':'FAIL'} ${r.name}${r.error?' — '+r.error:''}`).join('\n');
  el.className=results.every(r=>r.pass)?'pass':'fail';
})();
