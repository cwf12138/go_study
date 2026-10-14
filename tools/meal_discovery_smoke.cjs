const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',core=fs.readFileSync(root+'meals-core.js','utf8'),discovery=fs.readFileSync(root+'meal-discovery-core.js','utf8'),script=fs.readFileSync(root+'meal-discovery.js','utf8'),html=fs.readFileSync(root+'index.html','utf8'),css=fs.readFileSync(root+'meal-discovery.css','utf8');
const ctx=vm.createContext({window:{},Intl,Date,console});vm.runInContext(core,ctx);vm.runInContext(discovery,ctx);const D=ctx.window.DaynestMealDiscovery;
assert(D.catalog.length>=30);assert.equal(new Set(D.catalog.map(r=>r.id)).size,D.catalog.length);
const snapshot=JSON.stringify(D.catalog);for(const r of D.catalog){assert(r.title.length<=80);assert(r.category);assert(r.ingredients.length>0&&r.ingredients.length<=40);assert.equal(new Set(r.ingredients.map(i=>i.name)).size,r.ingredients.length);assert(r.steps.length>0&&r.steps.length<=30);assert(r.steps.every(s=>s.length<=500));}
const pick=p=>D.recommend(p,[],()=>.5);
assert.equal(pick({slot:'breakfast',people:2,minutes:20}).length,1);
assert.equal(pick({mode:'single',minutes:20}).length,1);
assert.deepEqual(Array.from(pick({mode:'pair',minutes:60})).map(r=>r.role),['protein','veg','rice']);
assert.equal(pick({mode:'family',minutes:150,people:4}).length,5);
for(const mode of ['single','pair','family'])for(const vegetarian of [false,true])for(const flavor of ['any','mild','spicy']){
  const p={mode,vegetarian,flavor,minutes:150,people:3,avoid:['milk','peanut'],exclude:['西红柿']};const rows=pick(p);assert(rows.every(r=>D.allowed(r,p)));assert(rows.every(r=>r.servings===3));assert(rows.reduce((n,r)=>n+r.minutes,0)<=150);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);if(flavor==='spicy')assert(rows.some(r=>r.spicy));
}
for(const tag of Object.keys(D.patterns)){const p={mode:'single',minutes:60,avoid:[tag]};const rows=pick(p);assert(rows.every(r=>!D.patterns[tag].test(r.ingredients.map(i=>i.name).join(' '))));}
assert.throws(()=>pick({mode:'pair',minutes:20}));assert.throws(()=>pick({people:7}));assert.throws(()=>pick({mode:'pair',vegetarian:true,avoid:['egg','soy'],minutes:150}));
const pair=pick({mode:'pair',minutes:60});const changed=D.recommend({mode:'pair',minutes:60,locks:[pair[0].id]},pair,()=>.8);assert(changed.some(r=>r.id===pair[0].id));assert.throws(()=>D.recommend({mode:'pair',minutes:60,exclude:[pair[0].ingredients[0].name],locks:[pair[0].id]},pair));
const tomato=D.catalog.find(r=>r.id==='meal-discover-tomato-egg'),one=D.scale(tomato,1);assert.equal(one.ingredients.find(i=>i.name==='鸡蛋').quantity,'2个');assert.equal(one.ingredients.find(i=>i.name==='食用油').quantity,'5毫升');assert.equal(JSON.stringify(D.catalog),snapshot);
assert(D.validDay('2024-02-29'));assert(!D.validDay('2026-02-29'));assert(!D.validDay('1999-12-31'));assert(!D.validDay('2026-02-31'));
const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));for(const m of script.matchAll(/\$\('([^']+)'\)/g))assert(ids.has('meal-discover-'+m[1]),m[1]);assert(html.includes('id="meal-legacy-template"'));for(const file of ['meal-discovery-core.js','meal-discovery.js'])assert(!html.includes('src="/static/'+file));for(const marker of ['max-width:480px','data-theme="dark"','prefers-reduced-motion'])assert(css.includes(marker));
let owner='alice',ready=true,prepareCalls=0,arranged=[],shopped=[],delayed=false,release,partial=false;
const nodes=new Map(),events={},observers=[];function el(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,hidden:false,open:false,innerHTML:'',textContent:'',events:{},dataset:{},classList:{toggle(){}},reset(){},showModal(){this.open=true;},close(){this.open=false;},setAttribute(){},addEventListener(t,fn){this.events[t]=fn;},querySelectorAll(){return[];}});return nodes.get(id);}
const A={ready:()=>ready,have:()=>[],async prepare(rows){prepareCalls++;if(delayed)await new Promise(resolve=>release=resolve);return partial?null:rows;},async arrange(rows,date,slot){arranged.push({rows,date,slot});return true;},shop(rows){shopped.push(rows);}};
const ui=vm.createContext({console,Date,window:{DaynestMeals:ctx.window.DaynestMeals,DaynestMealDiscovery:D,DaynestMealActions:A,addEventListener(t,fn){events[t]=fn;}},localStorage:{getItem:()=>owner},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},document:{getElementById:el}});
vm.runInContext(script,ui);const E=id=>el('meal-discover-'+id),click=id=>E(id).events.click();
(async()=>{
  click('open');assert(E('dialog').open);assert(E('results').innerHTML.includes('meal-discover-card'));assert(!E('actions').hidden);
  E('mode').value='family';E('minutes').value='150';E('fields').events.change();assert(E('actions').hidden,'changing constraints invalidates old result');E('form').events.submit({preventDefault(){}});assert.equal((E('results').innerHTML.match(/class="meal-discover-card"/g)||[]).length,5);
  E('date').value='2026-02-31';await click('arrange');assert.equal(prepareCalls,0,'reject invalid dates before writes');
  E('date').value='2026-10-11';await click('arrange');assert.equal(arranged.length,1);assert.equal(arranged[0].rows.length,5);assert.equal(arranged[0].slot,'dinner');assert(!E('dialog').open);
  click('open');await click('shop');assert.equal(shopped.length,1);assert(!E('dialog').open);
  click('open');ready=false;await click('save');assert.match(E('status').textContent,/同步数据/);ready=true;partial=true;await click('save');assert.match(E('status').textContent,/尚未全部完成/);partial=false;
  delayed=true;const pending=click('save');assert(E('draw').disabled);const count=prepareCalls;await click('save');assert.equal(prepareCalls,count,'ignore repeated click while busy');owner='bob';observers.at(-1)();release();await pending;assert.equal(E('results').innerHTML.includes('meal-discover-card'),false);assert(!E('dialog').open);assert.equal(E('exclude').value,'');
  console.log('Meal discovery passed: catalog bounds, meal composition, strict exclusions, pantry aliases, portion scaling, locks, impossible requests, dates, UI wiring, actions, partial writes and stale-account cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
