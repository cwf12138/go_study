const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('internal/httpapi/assets/app.js','utf8');
const elements=new Map();
function element(selector){if(!elements.has(selector))elements.set(selector,{textContent:'',value:'',disabled:false,classList:{toggle(){}},parentElement:{classList:{toggle(){}}}});return elements.get(selector)}
const context={console,Date,Intl,URLSearchParams,Headers:class{set(){}has(){return false}},AbortController,localStorage:{getItem(){return ''},setItem(){},removeItem(){}},window:{setTimeout(){},clearTimeout(){}},document:{querySelector:element,querySelectorAll(){return []}}};
const instrumented=source.replace('  bootstrap();','  render=()=>{}; renderPlannerCalendar=()=>{}; renderPlannerDetail=()=>{}; renderPlannerUnscheduled=()=>{}; window.testApp={state,refresh,api,renderPlanner,markPlannerDraft};');
assert.notEqual(instrumented,source);vm.runInNewContext(instrumented,context);
const app=context.window.testApp;
app.state.user={id:'user'};app.state.token='first';app.state.tasks=[{id:'old-task'}];app.state.focus={id:'existing-focus'};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>({data})});
async function test(){
  app.state.plannerWeek={week_start:'2026-09-07',week_end:'2026-09-13',preferences:{time_zone:'UTC',session_minutes:50,windows:[]}};
  app.state.plannerSettingsOpen=true;app.renderPlanner();
  element('#planner-session-minutes').value=75;app.markPlannerDraft();app.renderPlanner();
  assert.equal(element('#planner-session-minutes').value,75,'refresh must not overwrite planner draft');
  assert.match(element('#planner-draft-status').textContent,/未保存修改/);
  app.state.plannerDraftRevision=0;app.renderPlanner();
  assert.equal(element('#planner-session-minutes').value,50,'clean planner form should reflect saved preferences');
  context.fetch=async path=>{
    if(path==='/api/v1/tasks'||path==='/api/v1/focus-sessions/active')return response({},503);
    if(path==='/api/v1/dashboard')return response({active_goals:7});
    return response([]);
  };
  await app.refresh();
  assert.equal(app.state.dashboard.active_goals,7,'successful module should update');
  assert.equal(app.state.tasks[0].id,'old-task','failed module must keep previous data');
  assert.equal(app.state.focus.id,'existing-focus','failed focus query must not erase active timer');
  assert.match(element('#app-sync-status').textContent,/任务.*专注会话/);
  context.fetch=async()=>response({},503);
  await app.refresh();
  assert.equal(app.state.dashboard.active_goals,7,'full outage must retain the last dashboard');
  assert.equal(element('#app-sync-retry').disabled,false,'retry must remain available after failure');
  context.fetch=async()=>({ok:true,status:200,json:async()=>{throw new Error('malformed JSON')}});
  await assert.rejects(app.api('/api/v1/dashboard'),/malformed JSON/);
  let release;
  context.fetch=()=>new Promise(resolve=>{release=resolve});
  const pending=app.api('/api/v1/me');app.state.token='second';
  release(response({},401));
  await assert.rejects(pending,/账号已切换/);
  assert.equal(app.state.token,'second','old unauthorized response must not log out the new account');
  console.log('app sync passed: partial failure isolation, focus preservation, stale-account response protection');
}
test().catch(error=>{console.error(error);process.exitCode=1});
