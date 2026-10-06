const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root='internal/httpapi/assets/',source=fs.readFileSync(root+'app.js','utf8'),html=fs.readFileSync(root+'index.html','utf8');
assert(!html.includes('id="vocab-word-form"'));assert(!html.includes('id="vocab-book-form"'));assert(!source.includes('data-vocab-delete='));
for(const id of ['vocab-catalog-drawer','vocab-status','vocab-empty-title','vocab-empty-description','vocab-plan-summary','vocab-refresh','vocab-open-catalog'])assert(html.includes(`id="${id}"`));
const elements=new Map();function el(selector){if(!elements.has(selector))elements.set(selector,{value:'',textContent:'',innerHTML:'',disabled:false,open:false,classList:{toggle(){},add(){},remove(){}},setAttribute(){},querySelector(){return el(selector+' child')},querySelectorAll(){return []},focus(){},scrollIntoView(){}});return elements.get(selector)}
const context={Date,Intl,URLSearchParams,AbortController,console,Headers:class{set(){}has(){return false}},localStorage:{getItem(){return ''},setItem(){}},document:{querySelector:el,querySelectorAll(){return []}},window:{setTimeout(){},clearTimeout(){}}};
vm.runInNewContext(source.replace('  bootstrap();','  window.test={state,renderVocabulary,refreshVocabulary,reviewVocabularyWord,selectVocabularyBook,importVocabularyCatalog};'),context);
const app=context.window.test;
const word=(id,book='a')=>({id,book_id:book,term:'word-'+id,definition:'释义',stage:'new'});
const response=(data)=>({ok:true,status:200,json:async()=>({data,meta:{total:1,page:1,total_pages:1}})});
async function run(){
 Object.assign(app.state,{user:{id:'user'},token:'first',vocabularyBookID:'a',wordBooks:[{id:'a',name:'IELTS',daily_new_limit:20},{id:'b',name:'TOEFL',daily_new_limit:20}],vocabularyQueue:[word('1')],vocabularyMode:'spelling',vocabularyOverview:{total:2000},vocabularyWords:[]});
 app.renderVocabulary();el('#vocab-spelling-input').value='my unfinished answer';app.renderVocabulary();assert.equal(el('#vocab-spelling-input').value,'my unfinished answer');
 const paths=[];context.fetch=async path=>{paths.push(path);return response([word('library')])};app.state.vocabularySearch='absent';app.state.vocabularyRevealed=true;await app.refreshVocabulary({libraryOnly:true});assert.equal(paths.length,1);assert(!paths[0].includes('/queue'));assert.equal(app.state.vocabularyQueue[0].id,'1');assert(app.state.vocabularyRevealed);assert.equal(el('#vocab-spelling-input').value,'my unfinished answer');assert.match(el('#vocab-books').innerHTML,/2000 词/);
 app.state.vocabularyWords=[];app.renderVocabulary();assert.match(el('#vocab-word-list').textContent,/没有匹配/);
 const waiting=[];context.fetch=path=>new Promise(resolve=>waiting.push({path,resolve}));
 const a=app.selectVocabularyBook('a'),b=app.selectVocabularyBook('b');assert.equal(waiting.length,6);
 for(const req of waiting.slice(3))req.resolve(response(req.path.includes('/overview')?{total:2}:[word('B','b')]));await b;
 for(const req of waiting.slice(0,3))req.resolve(response(req.path.includes('/overview')?{total:1}:[word('A')]));await a;
 assert.equal(app.state.vocabularyBookID,'b');assert.equal(app.state.vocabularyQueue[0].id,'B');assert(!app.state.vocabularyLoading);
 // Saving feedback is serialized even if the button is clicked again.
 app.state.vocabularyRevealed=true;let posts=0,release;
 context.fetch=(path,options)=>{if(options.method==='POST'){posts++;return new Promise(resolve=>{release=resolve})}return Promise.resolve(response(path.includes('/overview')?{total:2,reviewed_today:1}:path.includes('/queue')?[word('next','b')]:[]))};
 const review=app.reviewVocabularyWord(3);await app.reviewVocabularyWord(3);assert.equal(posts,1);release(response({}));await review;assert.equal(app.state.vocabularyQueue[0].id,'next');assert(!app.state.vocabularyReviewing);
 // A successful write followed by a failed reload must never leave the old card rateable.
 app.state.vocabularyRevealed=true;context.fetch=async(path,options)=>{if(options.method==='POST')return response({});throw new Error('offline')};await app.reviewVocabularyWord(3);assert.equal(app.state.vocabularyQueue.length,0);assert(app.state.vocabularyError);assert.match(el('#toast').textContent,/反馈已保存/);
 // An API failure retains the card, blocks further ratings, and explains refresh recovery.
 app.state.vocabularyError=false;app.state.vocabularyQueue=[word('fail','b')];app.renderVocabulary();app.state.vocabularyRevealed=true;context.fetch=async()=>{throw new Error('offline')};await app.reviewVocabularyWord(3);assert(app.state.vocabularyError);assert.equal(app.state.vocabularyQueue[0].id,'fail');
 app.state.vocabularyError=false;app.state.vocabularyQueue=[];app.state.vocabularyOverview={total:2000};app.renderVocabulary();assert.match(el('#vocab-empty-description').textContent,/每日新词限额/);assert(!el('#vocab-empty-title').textContent.includes('完成'));
 app.state.vocabularyCatalogs=[{id:'ielts',name:'IELTS',word_count:10,installed_word_count:10,installed:true,installed_book_id:'a',exam:'IELTS',description:'',license:'MIT'}];app.renderVocabulary();assert.match(el('#vocab-catalogs').innerHTML,/开始学习/);
 // Late responses from the previous account cannot update the screen.
 const pending=[];context.fetch=()=>new Promise(resolve=>pending.push(resolve));const stale=app.refreshVocabulary();app.state.token='second';for(const resolve of pending)resolve(response([]));await stale;assert.equal(app.state.vocabularyQueue.length,0);
 const css=fs.readFileSync(root+'vocabulary-studio.css','utf8');for(const hook of ['max-width:720px','prefers-reduced-motion:reduce',':focus-visible','var(--paper)'])assert(css.includes(hook));
 console.log('Vocabulary passed: retired manual forms, spelling draft preservation, library isolation, race-safe book switching, serialized reviews, save/reload failure recovery, empty states and account guards.');
}
run().catch(error=>{console.error(error);process.exitCode=1});
