const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('internal/httpapi/assets/app.js','utf8');
const html=fs.readFileSync('internal/httpapi/assets/index.html','utf8');
for(const id of ['mood-today','mood-draft-status','mood-note-count'])assert.ok(html.includes(`id="${id}"`));
const elements=new Map();
function element(key){if(!elements.has(key))elements.set(key,{value:'',innerHTML:'',textContent:'',className:'',disabled:false,attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v}});return elements.get(key)}
const context={console,Date,Intl,URLSearchParams,AbortController,Headers:class{set(){}has(){return false}},localStorage:{getItem(){return ''}},window:{setTimeout(){},clearTimeout(){},confirm(){return false}},document:{querySelector:element,querySelectorAll(){return []}}};
const testSource=source.replace('  bootstrap();','  window.moodTest={state,renderMoods,renderMoodTrend,markMoodDraft,canLeaveMoodDraft,saveMoodEntry};');
assert.notEqual(source,testSource);vm.runInNewContext(testSource,context);
const api=context.window.moodTest;
api.state.moodMonth='2026-09';api.state.moodSelectedDate='2026-09-01';
api.state.moodEntries=[{date:'2026-09-04',mood:'great'},{date:'2026-09-01',mood:'low',note:'saved'},{date:'2026-09-03',mood:'good'}];
api.renderMoods();
assert.equal((element('#mood-trend').innerHTML.match(/<polyline/g)||[]).length,1,'missing day must break trend line');
assert.ok(element('#mood-trend').attributes['aria-label'].indexOf('09-01')<element('#mood-trend').attributes['aria-label'].indexOf('09-03'));
assert.match(element('#mood-calendar').innerHTML,/mood-diary-dot/);
element('#mood-note').value='unsaved draft';api.markMoodDraft();api.renderMoods();
assert.equal(element('#mood-note').value,'unsaved draft','refresh overwrote diary');
assert.equal(api.canLeaveMoodDraft(),false,'cancel must preserve draft');
async function checkSave(){
  let release;
  context.fetch=async(path,options)=>{
    if(options.method==='PUT')return new Promise(resolve=>{release=()=>resolve({ok:true,status:200,json:async()=>({data:{date:'2026-09-01',mood:'low',note:'unsaved draft'}})})});
    return {ok:true,status:200,json:async()=>({data:path.includes('insights')?{}:[{date:'2026-09-01',mood:'low',note:'unsaved draft'}]})};
  };
  const saving=api.saveMoodEntry({preventDefault(){},currentTarget:{querySelector(){return element('submit')}}});
  element('#mood-note').value='typed during save';api.markMoodDraft();release();await saving;
  assert.equal(element('#mood-note').value,'typed during save');assert.ok(api.state.moodDraftRevision>0);
  assert.equal(api.state.moodSaving,false);assert.match(element('#mood-draft-status').textContent,/新修改/);
  console.log('mood regression passed: chronological trend, gaps, accessible labels, draft guard and edits during save');
}
checkSave().catch(error=>{console.error(error);process.exitCode=1});
