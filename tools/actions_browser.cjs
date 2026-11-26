// Real HTTP + Edge drill. Uses isolated fixture accounts and snapshots only.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..'),out=path.join(root,'.local/checks');fs.mkdirSync(out,{recursive:true});
let api,browser,page;const report={schema_version:1,started_at:new Date().toISOString(),fixtures_only:true,production_changed:false,apk_built:false,device_verified:false,checks:[]};
const pass=name=>{report.checks.push({name,passed:true});console.log('PASS '+name);};
(async()=>{
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));const origin='http://127.0.0.1:'+port;
  const dir=fs.mkdtempSync(path.join(root,'.local/actions-browser-')),binary=path.resolve(process.env.DAYNEST_TEST_API||path.join(root,'.local/actions-api.exe'));
  api=spawn(binary,[],{cwd:root,windowsHide:true,env:{...process.env,HTTP_ADDR:'127.0.0.1:'+port,JWT_SECRET:crypto.randomBytes(32).toString('hex'),DATA_FILE:path.join(dir,'fixture.json'),FRONTEND_DIR:path.join(root,'internal/httpapi/assets')},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'fixture API failed to start');
  async function json(route,token,method='GET',body){const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=response.status===204?{}:await response.json();assert(response.ok,JSON.stringify(result));return result.data;}
  const a=await json('/api/v1/auth/register','','POST',{name:'行动回归 A',email:'actions-a@example.test',password:'actions-fixture-password'}),b=await json('/api/v1/auth/register','','POST',{name:'行动回归 B',email:'actions-b@example.test',password:'actions-fixture-password'});
  const note=await json('/api/v1/memos',a.token,'POST',{title:'日常整理',content:'- [ ] 整理书架\n- [ ] 预约检查\n- [ ] 确认账单',color:'default',tags:[]});
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE});const context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'Asia/Shanghai'});
  await context.addInitScript(({token})=>localStorage.setItem('studyflow.token',token),{token:a.token});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(origin+'/#todo');
  await page.waitForFunction(()=>!!window.DaynestAccount?.current?.());
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  const linkPath='/api/v1/memos/'+note.id+'/actions';
  const legacyBody=(text,title=text)=>({anchor_kind:'line',anchor_text:text,expected_updated_at:note.updated_at,
    title,priority:'medium',my_day_date:today});
  const firstBody=legacyBody('整理书架','整理书架并分类');
  const created=await json(linkPath,a.token,'POST',firstBody);
  const first=created.context.todo;
  assert(created.created&&first.memo_action_id);
  await page.evaluate(id=>window.DaynestActions.openTodo(id),first.id);
  await page.waitForSelector('[data-action-focus]');
  assert((await page.locator('#action-body').textContent()).includes('整理书架'));
  assert.equal(await page.locator('[data-action-source]').count(),0);
  pass('legacy_memo_link_shows_the_preserved_excerpt_without_opening_removed_page');
  await page.locator('#action-dialog').screenshot({path:path.join(out,'actions-desktop.png')});await page.setViewportSize({width:390,height:844});assert(await page.locator('#action-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.locator('#action-dialog').screenshot({path:path.join(out,'actions-mobile.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('#action-dialog').screenshot({path:path.join(out,'actions-dark.png')});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.setViewportSize({width:1440,height:1050});
  await page.click('[data-action-focus]');await page.waitForFunction(id=>document.getElementById('focus-task').value==='todo:'+id,first.id);assert.equal(await page.locator('#focus-complete-task').count(),0);await page.click('#start-focus');await page.waitForSelector('#pause-focus:visible');await page.click('#pause-focus');await page.waitForSelector('#resume-focus:visible');await page.click('#resume-focus');await page.waitForSelector('#pause-focus:visible');await page.click('#finish-focus');await page.waitForSelector('#start-focus:visible');
  let todos=await json('/api/v1/todos?view=all',a.token);assert.equal(todos[0].status,'open');pass('todo_focus_pause_resume_finish_without_auto_completion');
  const next=new Date(today+'T12:00:00+08:00');next.setUTCDate(next.getUTCDate()+1);const end=next.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  const overview=await json(`/api/v1/calendar?start=${today}&end=${end}`,a.token);assert.equal(overview.focus_sessions.length,1);assert.equal(overview.focus_sessions[0].title_snapshot,first.title);assert.equal(overview.todos.length,1);
  await page.locator('.nav-link[data-view="calendar"]').click();await page.waitForSelector('#calendar-day-agenda [data-action-link]');await page.locator('#calendar-day-agenda [data-action-link]').first().click();await page.waitForSelector('.action-source');assert((await page.locator('#action-body').textContent()).includes('整理书架'));pass('calendar_focus_projection_and_source_lookup');
  await page.click('[data-action-todo]');await page.waitForSelector(`#todo-items [data-todo-completed="true"][data-id="${first.id}"]`);await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/todos/${first.id}/status`)&&r.request().method()==='PATCH'),page.click(`#todo-items [data-todo-completed="true"][data-id="${first.id}"]`)]);todos=await json('/api/v1/todos?view=all',a.token);assert.equal(todos[0].status,'completed');pass('todo_completion_requires_explicit_click');
  const replay=await json(linkPath,a.token,'POST',firstBody);
  assert(!replay.created&&replay.context.todo.id===first.id);
  pass('legacy_link_api_replays_without_duplicate_todo');

  const pendingBody=legacyBody('预约检查');
  const second=await json(linkPath,a.token,'POST',pendingBody);
  await page.evaluate(({path,body})=>{
    DaynestActionCore.commands(localStorage,DaynestHTTP.capture()).put('link',{path,body,createdAt:Date.now()});
    window.dispatchEvent(new StorageEvent('storage',{key:'daynest.actions.v1:fixture'}));
  },{path:linkPath,body:pendingBody});
  await page.click('.action-pending');
  assert.equal(await page.locator('[data-action-retry="link"]').count(),0);
  await page.click('[data-action-check="link"]');
  await page.waitForSelector('[data-action-focus]');
  assert((await page.locator('#action-body').textContent()).includes(second.context.todo.title));
  assert.equal(await page.isVisible('.action-pending'),false);
  pass('old_pending_link_recovers_original_receipt');
  let dropFocus=true;await page.route('**/api/v1/focus-sessions',async route=>{if(route.request().method()==='POST'&&dropFocus){dropFocus=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.click('[data-action-focus]');await page.click('#start-focus');await page.waitForSelector('.action-pending:visible');await page.click('.action-pending');await page.click('[data-action-check="focus"]');await page.waitForFunction(()=>document.getElementById('action-status').textContent.includes('已确认会话'));await page.click('[data-action-close]');await page.waitForSelector('#pause-focus:visible');assert.equal(await page.isVisible('.action-pending'),false);await page.click('#abandon-focus');await page.waitForSelector('#start-focus:visible');pass('lost_focus_response_recovers_existing_timer');
  await json('/api/v1/todos/'+first.id,a.token,'DELETE');
  const deleted=await json(linkPath,a.token,'POST',firstBody);
  assert(!deleted.created&&deleted.context.todo===null);
  todos=await json('/api/v1/todos?view=all',a.token);
  assert.equal(todos.length,1);
  pass('deleted_todo_is_not_resurrected');
  await page.evaluate(id=>DaynestActions.openTodo(id),second.context.todo.id);
  await page.waitForSelector('.action-source');
  await page.click('[data-action-close]');await page.evaluate(({token})=>{localStorage.setItem('studyflow.token',token);window.dispatchEvent(new StorageEvent('storage',{key:'studyflow.token',newValue:token}));},{token:b.token});await page.waitForFunction(id=>window.DaynestAccount?.current?.()?.userID===id,b.user.id);assert.equal(await page.isVisible('.action-pending'),false);assert.equal(await page.locator('#action-dialog').evaluate(el=>el.open),false);pass('account_switch_clears_action_context');
  assert.deepEqual(errors,[]);report.passed=true;
})().catch(async error=>{report.passed=false;report.failure=error.message;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'actions-failure.png'),fullPage:true}).catch(()=>{});}).finally(async()=>{if(browser)await browser.close();if(api){api.kill();await Promise.race([new Promise(r=>api.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);}report.finished_at=new Date().toISOString();fs.writeFileSync(path.join(out,'actions-browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log('Report: .local/checks/actions-browser-report.json. Fixture data only; no APK/device test.');});
