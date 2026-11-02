// Optional real-browser drill. Uses only a temporary API data directory.
// DAYNEST_TEST_API: a freshly built cmd/api executable.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_EXECUTABLE: optional local Playwright module/browser.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.local/checks');
fs.mkdirSync(out,{recursive:true});
let api,browser,release,logs='',dir,currentPage;
const checks=[],report={schema_version:1,started_at:new Date().toISOString(),fixtures_only:true,production_changed:false,apk_built:false,device_verified:false,checks};
const check=name=>{checks.push({name,passed:true});console.log('PASS '+name);};
(async()=>{
 const binary=path.resolve(process.env.DAYNEST_TEST_API||path.join(root,'.local/memo-drafts-api.exe'));
 assert(fs.statSync(binary).isFile(),'Build the test API before running this drill');
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 dir=fs.mkdtempSync(path.join(root,'.local/memo-drafts-browser-'));
 api=spawn(binary,[],{cwd:root,windowsHide:true,env:{...process.env,HTTP_ADDR:'127.0.0.1:'+port,JWT_SECRET:crypto.randomBytes(32).toString('hex'),DATA_FILE:path.join(dir,'fixture.json')},stdio:['ignore','pipe','pipe']});
 api.stdout.on('data',v=>logs+=v);api.stderr.on('data',v=>logs+=v);
 const origin='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Fixture API did not start');
 const email='draft-drill@example.test',password='draft-drill-only-password';
 const auth=await(await fetch(origin+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'草稿验证用户',email,password})})).json();assert(auth.data?.token);
 const request=async(url,method='GET',body)=>{const response=await fetch(origin+url,{method,headers:{Authorization:'Bearer '+auth.data.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert(response.ok,`Fixture API ${method} ${url} ${response.status}`);return (await response.json()).data;};
 const note=await request('/api/v1/memos','POST',{title:'旅行路上的念头',content:'服务端原始文字',tags:['日常'],color:'mint'});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];
 currentPage=page;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let offline=false,hold=false,writes=0,lateScripts=false;
 await page.route('**/static/memos.js*',async r=>{if(lateScripts)await new Promise(resolve=>setTimeout(resolve,250));await r.continue();});
 await context.route('**/api/v1/weather**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"fixture"}}'}));
 await page.route('**/api/v1/memos/**',async route=>{
   const req=route.request();
   if(req.method()==='PATCH'){writes++;if(hold){hold=false;await new Promise(r=>release=r);}if(offline)return route.abort('failed');}
   await route.continue();
 });
 await page.goto(origin+'/#memos',{waitUntil:'domcontentloaded'});await page.fill('#login-email',email);await page.fill('#login-password',password);await page.click('#login-form button[type=submit]');
 await page.waitForSelector('#app-view:not(.hidden)');await page.waitForFunction(()=>document.getElementById('memo-content').value==='服务端原始文字');
 offline=true;await page.fill('#memo-content','刷新之前，留下一段未提交的旅行记录。');
 await page.waitForFunction(()=>[...Array(localStorage.length)].some((_,i)=>localStorage.key(i).startsWith('daynest.memo-draft.v1:')));
 lateScripts=true;await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('memo-content').value==='服务端原始文字');
 await page.click('#memo-drafts-open');await page.waitForFunction(()=>!document.getElementById('memo-drafts-restore').disabled);
 assert.equal(await page.inputValue('#memo-drafts-text'),'刷新之前，留下一段未提交的旅行记录。');
 await page.locator('#memo-drafts-dialog').screenshot({path:path.join(out,'memo-drafts-desktop.png')});
 const before=writes;await page.click('#memo-drafts-restore');await page.waitForSelector('#memo-drafts-dialog:not([open])',{state:'attached'});await page.waitForTimeout(950);
 assert.equal(writes,before,'Restoration auto-submitted before confirmation');assert.equal(await page.inputValue('#memo-content'),'刷新之前，留下一段未提交的旅行记录。');
 offline=false;await page.click('#memo-save');await page.waitForFunction(()=>document.getElementById('memo-save-state').textContent.includes('已提交服务'));
 assert.equal((await request('/api/v1/memos/'+note.id)).content,'刷新之前，留下一段未提交的旅行记录。');
 check('reload_and_explicit_recovery');
 hold=true;await page.fill('#memo-content','保存途中第一版');await page.click('#memo-save');await page.waitForFunction(()=>document.getElementById('memo-save-state').textContent.includes('正在保存'));
 // Wait for the held network request, rather than relying on UI timing.
 for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,20));assert(release);
 await page.fill('#memo-content','保存途中第二版');release();release=null;await page.waitForFunction(()=>document.getElementById('memo-save-state').textContent.includes('已提交服务'));
 assert.equal((await request('/api/v1/memos/'+note.id)).content,'保存途中第二版');check('edits_during_pending_save');
 // Use a second real browser page to exercise the production atomic precondition.
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));second.on('dialog',d=>d.accept());
 await second.goto(origin+'/#memos',{waitUntil:'domcontentloaded'});await second.waitForFunction(()=>document.getElementById('memo-content').value==='保存途中第二版');
 await page.fill('#memo-content','窗口一已经提交的新内容');await page.click('#memo-save');await page.waitForFunction(()=>document.getElementById('memo-save-state').textContent.includes('已提交服务'));
 await second.fill('#memo-content','窗口二未提交的独立想法');await second.click('#memo-save');await second.waitForFunction(()=>document.getElementById('memo-save-state').textContent.includes('保存失败'));
 assert.equal((await request('/api/v1/memos/'+note.id)).content,'窗口一已经提交的新内容');
 await second.click('#memo-drafts-open');await second.waitForFunction(()=>document.getElementById('memo-drafts-status').textContent.includes('服务端也有修改'));
 assert(await second.locator('#memo-drafts-restore').isDisabled());assert.equal(await second.inputValue('#memo-drafts-text'),'窗口二未提交的独立想法');assert.equal(await second.inputValue('#memo-drafts-server-text'),'窗口一已经提交的新内容');
 await second.setViewportSize({width:390,height:844});await second.locator('#memo-drafts-dialog').screenshot({path:path.join(out,'memo-drafts-mobile.png')});
 assert(await second.locator('#memo-drafts-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Mobile dialog horizontal overflow');
 const box=await second.locator('#memo-drafts-dialog').boundingBox();assert(box.width<=390&&box.height<=844);
 await second.setViewportSize({width:1440,height:1080});await second.evaluate(()=>document.documentElement.dataset.theme='dark');await second.locator('#memo-drafts-dialog').screenshot({path:path.join(out,'memo-drafts-dark.png')});
 await second.click('#memo-drafts-copy');await second.waitForSelector('#memo-drafts-dialog:not([open])',{state:'attached'});
 const all=await request('/api/v1/memos');assert(all.some(n=>n.title.endsWith('（草稿恢复）')));assert.equal((await request('/api/v1/memos/'+note.id)).content,'窗口一已经提交的新内容');
 check('two_tabs_conflict_and_copy');check('desktop_mobile_dark_layouts');
 // Fully offline preview/export after login. The shell itself is not an offline app.
 await page.fill('#memo-content','断网时需要导出的文字');offline=true;
 await page.click('#memo-drafts-open');await page.waitForFunction(()=>document.getElementById('memo-drafts-text').value==='断网时需要导出的文字');
 await page.evaluate(()=>{window.DaynestMobile={saveBlob:async(blob,name,owner)=>{window.__draftExport={text:await blob.text(),name,ownerMatches:owner===localStorage.getItem('studyflow.token')};}};});
 await page.route('**/api/v1/memos/'+note.id,r=>r.abort('failed'));
 await page.locator('#memo-drafts-list button').first().click();await page.waitForFunction(()=>document.getElementById('memo-drafts-status').textContent.includes('本机文字仍可查看和导出'));
 await page.click('#memo-drafts-export');await page.waitForFunction(()=>!!window.__draftExport);const exported=await page.evaluate(()=>window.__draftExport);assert(exported.ownerMatches&&exported.text.includes('断网时需要导出的文字'));
 check('offline_preview_and_native_export_handoff');
 assert.deepEqual(errors,[]);report.passed=true;
})().catch(async e=>{report.passed=false;report.failure=e.message;console.error(e);if(currentPage){console.error(await currentPage.evaluate(()=>({hash:location.hash,content:document.getElementById('memo-content')?.value,list:document.getElementById('memo-note-list')?.textContent,status:document.getElementById('memo-drafts-status')?.textContent,toast:document.getElementById('toast')?.textContent,app:document.getElementById('app-view')?.className})));await currentPage.screenshot({path:path.join(out,'memo-drafts-failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}).finally(async()=>{
 release?.();if(browser)await browser.close();if(api){api.kill();await Promise.race([new Promise(r=>api.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);}
 report.finished_at=new Date().toISOString();fs.writeFileSync(path.join(out,'memo-drafts-browser-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Report: .local/checks/memo-drafts-browser-report.json. Temporary records only; native file save simulated; no APK or device verification.');
});
