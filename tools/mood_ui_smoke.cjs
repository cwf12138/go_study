const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('internal/httpapi/assets/app.js','utf8');
const html=fs.readFileSync('internal/httpapi/assets/index.html','utf8');
const moods=['awful','low','neutral','good','great'];
const pickerHTML=html.match(/<div class="mood-picker"[^>]*>(.*?)<\/div>/s)[1];
for(const mood of moods){
  const path=`internal/httpapi/assets/mood-art/${mood}-flat-v2.png`;
  const png=fs.readFileSync(path);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','real PNG asset');
  assert.ok([2,6].includes(png[25]),'full-color PNG artwork');
  assert.ok(png.readUInt32BE(16)>=256,'image must be sharp on high-density screens');
  assert.ok(pickerHTML.includes(`src="/static/mood-art/${mood}-flat-v2.png"`),'picker uses generated local artwork');
}
assert.doesNotMatch(html,/id="mood-face-|mood-symbols|src="[^"]*clay-v1/,'retired artwork must not be used');
const css=fs.readFileSync('internal/httpapi/assets/mood-journal.css','utf8');
assert.match(css,/#panel-moods \.mood-avatar[^}]*border-radius:50%/,'all flat image badges must be circular');
assert.match(css,/grid-template-areas:"calendar entry" "trend insights"/,'desktop rows must stay aligned');
assert.ok(css.includes('prefers-reduced-motion'));
assert.ok(css.includes(':root[data-theme="dark"] #panel-moods'));
assert.doesNotMatch(css,/linear-gradient|mood-hero-art/,'no mixed 3D or gradient decoration');
assert.equal((pickerHTML.match(/loading="lazy"/g)||[]).length,5,'hidden panel must not eagerly fetch all illustrations');
assert.doesNotMatch(pickerHTML,/😣|🙁|😐|🙂|😄/,'do not fall back to platform emoji');
for(const id of ['mood-today','mood-draft-status','mood-note-count'])assert.ok(html.includes(`id="${id}"`));
const elements=new Map();
function element(key){if(!elements.has(key))elements.set(key,{value:'',innerHTML:'',textContent:'',className:'',disabled:false,attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v}});return elements.get(key)}
const choices=moods.map(mood=>Object.assign(element(mood),{dataset:{moodChoice:mood}}));
const context={console,Date,Intl,URLSearchParams,AbortController,Headers:class{set(){}has(){return false}},localStorage:{getItem(){return ''}},window:{setTimeout(){},clearTimeout(){},confirm(){return false}},document:{querySelector:element,querySelectorAll(selector){return selector==='[data-mood-choice]'?choices:[]}}};
const testSource=source.replace('  bootstrap();','  window.moodTest={state,renderMoods,renderMoodTrend,markMoodDraft,canLeaveMoodDraft,saveMoodEntry,moodAvatar};');
assert.notEqual(source,testSource);vm.runInNewContext(testSource,context);
const api=context.window.moodTest;
api.state.moodMonth='2026-09';api.state.moodSelectedDate='2026-09-01';
api.state.moodEntries=[{date:'2026-09-04',mood:'great'},{date:'2026-09-01',mood:'low',note:'saved'},{date:'2026-09-03',mood:'good'}];
api.renderMoods();
assert.equal(choices.filter(button=>button.attributes['aria-checked']==='true').length,1);
assert.equal(element('low').tabIndex,0,'saved mood remains keyboard accessible');
assert.equal(element('low').attributes.role,'radio');
for(const mood of moods)assert.ok(api.moodAvatar(mood).includes(`src="/static/mood-art/${mood}-flat-v2.png"`));
assert.doesNotMatch(api.moodAvatar('"><script>'),/script|src|href/,'unknown moods cannot generate image URLs');
assert.match(element('#mood-calendar').innerHTML,/src="\/static\/mood-art\/low-flat-v2.png"/);
assert.match(element('#mood-distribution').innerHTML,/src="\/static\/mood-art\/neutral-flat-v2.png"/);
assert.ok(element('#mood-trend').innerHTML.includes('clip-path="url(#mood-chart-badge)"'),'SVG axes must also crop icons to circles');
assert.ok(element('#mood-trend').innerHTML.includes('data-emotion="good"'),'trend dots follow the same emotion palette');
assert.match(element('#mood-trend').innerHTML,/href="\/static\/mood-art\/great-flat-v2.png"/);
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
