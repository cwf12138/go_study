(() => {
  "use strict";
  const state = { token:"", initialized:false, loading:false, mode:"books", catalog:[], catalogMeta:{}, shelf:[], classics:[], studies:[], overview:{}, currentReading:null, content:null, page:0, currentWork:null, currentStudy:null, translationVisible:true, readerStarted:0, saveTimer:null, classicQuery:"", dynasty:"", genre:"" };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHTML = (value) => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  let literatureWriteTail=Promise.resolve();
  async function literatureAPI(path, options={}) {
    const token=localStorage.getItem("studyflow.token")||"";
    const execute=async()=>{
      if(token!==(localStorage.getItem("studyflow.token")||""))throw new Error('账号已切换，请重新打开阅读书房');
      const result=await literatureRequest(path,options);
      if(token!==(localStorage.getItem("studyflow.token")||""))throw new Error('账号已切换，已忽略旧响应');
      return result;
    };
    if(!options.method || options.method==='GET')return execute();
    const pending=literatureWriteTail.then(execute);
    literatureWriteTail=pending.catch(()=>{});
    return pending;
  }
  async function literatureRequest(path, options={}) {
    const headers=new Headers(options.headers||{}),token=localStorage.getItem("studyflow.token")||"";
    if(token)headers.set("Authorization",`Bearer ${token}`);if(options.body)headers.set("Content-Type","application/json");
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),25000);
    try{const response=await fetch(path,{...options,headers,signal:controller.signal});if(response.status===204)return null;const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(response.status===401?'登录已过期，请重新登录':payload?.error?.message||`请求失败（${response.status}）`);return payload.data}
    catch(error){if(error.name==='AbortError')throw new Error('请求超时，请检查网络后重试');throw error}
    finally{window.clearTimeout(timer)}
  }
  function notify(message,type="success"){const toast=$("#toast");if(!toast)return;toast.textContent=message;toast.className=`toast visible ${type==="error"?"error":""}`;window.setTimeout(()=>{if(toast.textContent===message)toast.className="toast"},3300)}
  function syncAccount(){const token=localStorage.getItem("studyflow.token")||"";if(token===state.token)return token;state.token=token;state.initialized=false;state.catalog=[];state.shelf=[];state.classics=[];state.studies=[];state.overview={};state.currentReading=null;state.content=null;return token}
  const authorLabel=(book)=>(book.authors||[]).join(" · ")||"Unknown author";
  const shelfReading=(bookID)=>state.shelf.find((item)=>item.book?.id===bookID);
  const studyFor=(workID)=>state.studies.find((item)=>item.work_id===workID);
  const palette=(id)=>{const colors=[["#355b90","#182a4b"],["#8b553d","#3f2721"],["#4f6f60","#203a32"],["#65548f","#302746"],["#9a7538","#47381f"]];let hash=0;for(const char of id)hash=(hash*31+char.charCodeAt(0))>>>0;return colors[hash%colors.length]};
  function renderOverview(){const overview=state.overview||{};$("#lit-books-count").textContent=overview.books_in_shelf||0;$("#lit-completed-count").textContent=overview.books_completed||0;$("#lit-minutes-count").textContent=`${overview.reading_minutes||0} 分`;$("#lit-classics-count").textContent=overview.classics_studied||0;$("#classics-study-summary").innerHTML=`<span>已掌握<b>${overview.classics_mastered||0}</b></span><span>已收藏<b>${overview.classics_favorites||0}</b></span>`}
  function renderCatalog(){const container=$("#ebook-catalog");$("#ebook-provider").textContent=state.catalogMeta.provider||"精选书目";$("#ebook-catalog-title").textContent=state.catalogMeta.query?`“${state.catalogMeta.query}”的搜索结果`:"精选世界名著";if(!state.catalog.length){container.innerHTML='<div class="literature-empty">没有找到可导入的公共领域纯文本版本。可以换用英文原名或作者搜索。</div>';return} container.innerHTML=state.catalog.map((book)=>{const reading=shelfReading(book.id),colors=palette(book.id);return `<article class="ebook-card"><div class="ebook-cover" style="--book-a:${colors[0]};--book-b:${colors[1]}"><span>${escapeHTML(book.title.slice(0,1))}</span></div><h4>${escapeHTML(book.title)}</h4><small>${escapeHTML(authorLabel(book))}</small><p>${escapeHTML(book.summary||"公共领域经典作品")}</p><div class="ebook-card-foot"><span>${book.download_count?`${Number(book.download_count).toLocaleString()} 次下载`:book.language?.toUpperCase()||"EN"}</span><button class="${reading?"quiet":"primary"}" type="button" data-ebook-add="${escapeHTML(book.id)}">${reading?"继续阅读":"下载到书房"}</button></div></article>`}).join("")}
  function renderShelf(){
    const query=$("#shelf-query").value.trim().toLowerCase(),status=$("#shelf-status").value;
    const books=state.shelf.filter(item=>(!status||item.status===status)&&`${item.book.title} ${authorLabel(item.book)}`.toLowerCase().includes(query)).sort((a,b)=>new Date(b.last_read_at||b.updated_at)-new Date(a.last_read_at||a.updated_at));
    $("#ebook-shelf-meta").textContent=`${books.length} / ${state.shelf.length} 本`;
    const recent=[...state.shelf].filter(item=>item.status!=="completed").sort((a,b)=>new Date(b.last_read_at||b.updated_at)-new Date(a.last_read_at||a.updated_at))[0];
    $("#reading-resume").innerHTML=recent?`<div><p class="eyebrow">CONTINUE YOUR STORY</p><h3>${escapeHTML(recent.book.title)}</h3><p>${escapeHTML(authorLabel(recent.book))} · 已读 ${Math.round(recent.progress||0)}%</p></div><button class="primary" type="button" data-ebook-open="${escapeHTML(recent.id)}">继续阅读 →</button>`:'<div><p class="eyebrow">YOUR QUIET CORNER</p><h3>给自己留一段安静阅读的时间</h3><p>从下方选一本书，下一次从这里继续。</p></div>';
    $("#ebook-shelf").innerHTML=books.length?books.map(reading=>`<article class="ebook-shelf-row"><h4>${escapeHTML(reading.book.title)}</h4><small>${escapeHTML(authorLabel(reading.book))}</small><div class="ebook-shelf-progress"><i style="width:${Math.min(100,Math.max(0,reading.progress||0))}%"></i></div><div class="ebook-shelf-actions"><span>${reading.status==="completed"?"已读完":`${Math.round(reading.progress||0)}% · ${Math.floor((reading.reading_seconds||0)/60)} 分钟`}</span><div><button class="quiet" type="button" data-ebook-open="${escapeHTML(reading.id)}">阅读</button><button class="quiet danger-text" type="button" data-ebook-remove="${escapeHTML(reading.id)}">移除</button></div></div></article>`).join(""):'<div class="literature-empty">没有匹配的书籍。可以清空筛选，或在目录中添加一本书。</div>';
  }
  function filteredClassics(){const query=state.classicQuery.toLowerCase();return state.classics.filter((work)=>(!state.dynasty||work.dynasty===state.dynasty)&&(!state.genre||work.genre===state.genre)&&(!query||`${work.title} ${work.author} ${work.dynasty} ${(work.tags||[]).join(" ")} ${(work.text||[]).join(" ")}`.toLowerCase().includes(query)))}
  function renderClassicFeatured(work){const container=$("#classics-featured");if(!work){container.innerHTML='<div class="literature-empty">没有符合条件的篇目。</div>';return}container.innerHTML=`<div class="classics-featured-content"><p class="eyebrow">TODAY'S CLASSIC · ${escapeHTML(work.dynasty)}${escapeHTML(work.genre)}</p><h2>${escapeHTML(work.title)}</h2><small>${escapeHTML(work.author)} · ${escapeHTML(work.difficulty)}</small><blockquote>${escapeHTML((work.text||[])[0]||"")}</blockquote><button class="quiet" type="button" data-classic-open="${work.id}">进入研习 →</button></div>`}
  function renderClassics(){const items=filteredClassics();$("#classics-result-count").textContent=`${items.length} 篇`;renderClassicFeatured(items.find((work)=>work.featured)||items[0]);$("#classics-grid").innerHTML=items.length?items.map((work)=>{const study=studyFor(work.id);return `<article class="classic-card"><div class="classic-card-top"><span>${escapeHTML(work.dynasty)} · ${escapeHTML(work.genre)}</span><i>${study?.favorite?"★":""}</i></div><h4>${escapeHTML(work.title)}</h4><small>${escapeHTML(work.author)} · ${escapeHTML(work.difficulty)}</small><p>${escapeHTML((work.text||[]).join(" "))}</p><footer><span>${study?.status==="mastered"?"已掌握":study?`诵读 ${study.recitation_count||0} 次`:(work.tags||[]).slice(0,2).join(" · ")}</span><button type="button" data-classic-open="${work.id}">研习 →</button></footer></article>`}).join(""):'<div class="literature-empty">没有匹配的古诗文，清空筛选条件再试试。</div>'}
  function setMode(mode){state.mode=mode;$("#literature-books-view").classList.toggle("hidden",mode!=="books");$("#literature-classics-view").classList.toggle("hidden",mode!=="classics");$$('[data-literature-mode]').forEach((button)=>button.classList.toggle("active",button.dataset.literatureMode===mode))}
  async function loadLiterature(){
    if(!syncAccount()||state.loading)return;state.loading=true;const token=state.token;
    const jobs=[['catalog',value=>{state.catalog=value?.items||[];state.catalogMeta=value||{};renderCatalog()}],['shelf',value=>{state.shelf=value||[];renderShelf()}],['classics',value=>{state.classics=value||[];renderClassics()}],['classic-studies',value=>{state.studies=value||[];renderClassics()}],['overview',value=>{state.overview=value||{};renderOverview()}]];
    const results=await Promise.allSettled(jobs.map(async([path,render])=>{const value=await literatureAPI('/api/v1/literature/'+path);if(token===state.token)render(value)}));
    state.loading=false;if(token!==state.token)return;
    state.initialized=results.every(item=>item.status==='fulfilled');
    $("#literature-health").textContent=state.initialized?'书架与阅读记录已同步':'部分内容加载失败，已保留可用内容。点击“重新同步”重试。';
  }
  async function searchBooks(event){event?.preventDefault();const query=$("#ebook-search").value.trim(),version=++searchVersion,token=state.token;$("#ebook-catalog").innerHTML='<div class="literature-loading">正在检索可阅读的纯文本版本…</div>';try{const catalog=await literatureAPI(`/api/v1/literature/catalog?q=${encodeURIComponent(query)}`);if(version!==searchVersion||token!==state.token)return;state.catalog=catalog?.items||[];state.catalogMeta=catalog||{};renderCatalog();if(catalog?.degraded)notify("在线目录暂不可用，当前展示本地精选匹配结果。","error")}catch(error){if(version!==searchVersion)return;$("#ebook-catalog").innerHTML=`<div class="literature-empty">${escapeHTML(error.message)}<br>请重新搜索或点击“查看精选”。</div>`;notify(error.message,"error")}}
  async function addOrOpenBook(bookID,button){const existing=shelfReading(bookID);if(existing)return openEBook(existing.id);const book=state.catalog.find((item)=>item.id===bookID);if(!book)return;button.disabled=true;button.textContent="正在加入…";try{const reading=await literatureAPI("/api/v1/literature/shelf",{method:"POST",body:JSON.stringify({book})});state.shelf.unshift(reading);renderCatalog();renderShelf();state.overview=await literatureAPI("/api/v1/literature/overview");renderOverview();notify("书籍已加入书房，正在下载正文。");await openEBook(reading.id)}catch(error){notify(error.message,"error");renderCatalog()}}
function renderChapters(){const seen=new Set(),chapters=[];(state.content?.pages||[]).forEach((page)=>{if(!seen.has(page.chapter)){seen.add(page.chapter);chapters.push({title:page.chapter,index:page.index})}});const options=chapters.map((chapter)=>`<option value="${chapter.index}">${escapeHTML(chapter.title)}</option>`).join("");$("#ebook-chapter-select").innerHTML=options;$("#ebook-chapter-list").innerHTML=chapters.map((chapter)=>`<button type="button" data-ebook-page="${chapter.index}">${escapeHTML(chapter.title)}</button>`).join("")}
  function renderEBookPage(){const pages=state.content?.pages||[];if(!pages.length)return;state.page=Math.min(pages.length-1,Math.max(0,state.page));const page=pages[state.page];$("#reader-page-number").value=state.page+1;$("#ebook-page-chapter").textContent=page.chapter||"";$("#ebook-page-content").textContent=page.content;$("#ebook-reader-page").textContent=`${state.page+1} / ${pages.length}`;$("#ebook-page-footer").textContent=`第 ${state.page+1} 页，共 ${pages.length} 页`;const progress=pages.length===1?100:state.page*100/(pages.length-1);$("#ebook-reader-progress-bar").style.width=`${progress}%`;$("#ebook-page-prev").disabled=state.page===0;$("#ebook-page-next").disabled=state.page===pages.length-1;$("#ebook-chapter-select").value=String([...$("#ebook-chapter-select").options].reverse().find((option)=>Number(option.value)<=state.page)?.value||0);$$('[data-ebook-page]').forEach((button)=>button.classList.toggle("active",Number(button.dataset.ebookPage)<=state.page&&(!button.nextElementSibling||Number(button.nextElementSibling.dataset.ebookPage)>state.page)));$("#ebook-page-stage>article").scrollTop=0;renderEBookTools();scheduleProgressSave()}
function renderEBookTools(){const reading=state.currentReading;if(!reading)return;$("#ebook-bookmarks").innerHTML=reading.bookmarks?.length?reading.bookmarks.map((bookmark)=>`<article class="ebook-tool-item"><strong>${escapeHTML(bookmark.label||`第 ${bookmark.page_index+1} 页`)}</strong><p>${escapeHTML(bookmark.excerpt||"")}</p><footer><span>第 ${bookmark.page_index+1} 页</span><span><button type="button" data-bookmark-goto="${bookmark.page_index}">跳转</button><button type="button" data-bookmark-delete="${bookmark.id}">删除</button></span></footer></article>`).join(""):'<div class="literature-empty">还没有书签。</div>';$("#ebook-notes").innerHTML=reading.notes?.length?reading.notes.map((note)=>`<article class="ebook-tool-item"><p>${escapeHTML(note.content)}</p><footer><span>第 ${note.page_index+1} 页</span><span><button type="button" data-note-goto="${note.page_index}">跳转</button><button type="button" data-note-edit="${note.id}">编辑</button><button type="button" data-note-delete="${note.id}">删除</button></span></footer></article>`).join(""):'<div class="literature-empty">还没有阅读笔记。</div>'}
  async function openEBook(readingID){
    const reading=state.shelf.find(item=>item.id===readingID); if(!reading)return;
    if(state.currentReading && !(await saveProgress())) return;
    const version=++readerVersion;
    state.currentReading=reading; state.content=null; state.page=reading.page_index||0; state.readerStarted=0;
    $("#ebook-note-input").value="";
    $("#ebook-reader-title").textContent=reading.book.title; $("#ebook-reader-author").textContent=authorLabel(reading.book);
    $("#ebook-page-content").textContent="正在下载并整理正文…";
    $("#ebook-reader-page").textContent="加载中";
    $("#ebook-chapter-list").replaceChildren(); $("#ebook-chapter-select").replaceChildren();
    $("#ebook-source-link").removeAttribute("href"); $("#ebook-license-notice").textContent="";
    $("#reader-search-results").replaceChildren(); $("#reader-text-query").value="";
    $("#reader-save-status").textContent="正在打开书籍…";
    $("#ebook-page-prev").disabled=true; $("#ebook-page-next").disabled=true;
    if(!$("#ebook-reader-dialog").open)$("#ebook-reader-dialog").showModal();
    try{
      const content=await literatureAPI(`/api/v1/literature/shelf/${encodeURIComponent(readingID)}/content`);
      if(version!==readerVersion || !$("#ebook-reader-dialog").open)return;
      if(!content?.pages?.length)throw new Error("书籍没有可阅读的正文");
      state.content=content; state.readerStarted=document.hidden?0:Date.now();
      const source=content.book?.source_url||""; if(/^https:\/\//i.test(source))$("#ebook-source-link").href=source;
      $("#ebook-license-notice").textContent=content.license_notice||"";
      $("#reader-page-number").max=content.pages.length;
      renderChapters();renderEBookPage();
    }catch(error){if(version!==readerVersion)return;$("#ebook-page-content").textContent=`正文暂不可用：${error.message}\n\n请点击下方“重试下载”。`;$("#reader-save-status").textContent="下载失败，可重试";notify(error.message,"error")}
  }
  function elapsedReadingSeconds(){if(!state.readerStarted)return 0;const seconds=Math.min(3600,Math.max(0,Math.floor((Date.now()-state.readerStarted)/1000)));state.readerStarted=Date.now();return seconds}
  async function saveProgress(status=""){
    if(progressPromise){if(!(await progressPromise))return false;return saveProgress(status)}
    if(!state.currentReading||!state.content)return true;
    window.clearTimeout(state.saveTimer);
    const id=state.currentReading.id, token=state.token;
    const payload={page_index:state.page,total_pages:state.content.pages.length,reading_seconds_delta:elapsedReadingSeconds(),status};
    $("#reader-save-status").textContent="正在保存阅读位置…";
    progressPromise=(async()=>{
      try{
        const updated=await literatureAPI(`/api/v1/literature/shelf/${encodeURIComponent(id)}/progress`,{method:"PATCH",body:JSON.stringify(payload)});
        if(token!==state.token)return false;
        if(state.currentReading?.id===id)state.currentReading={...state.currentReading,page_index:updated.page_index,progress:updated.progress,status:updated.status,reading_seconds:updated.reading_seconds};
        const index=state.shelf.findIndex(item=>item.id===id);if(index>=0)state.shelf[index]={...state.shelf[index],...updated};renderShelf();
        $("#reader-save-status").textContent="阅读位置已保存";progressFailed=false;return true;
      }catch(error){progressFailed=true;$("#reader-save-status").textContent="保存失败，请点击重试保存";notify("阅读进度暂未保存："+error.message,"error");return false}
    })();
    const result=await progressPromise;progressPromise=null;return result;
  }
  function scheduleProgressSave(){window.clearTimeout(state.saveTimer);state.saveTimer=window.setTimeout(()=>saveProgress(),900)}
  function goToPage(page){
    if(!state.content)return;const target=Math.min(state.content.pages.length-1,Math.max(0,Math.floor(Number(page)||0)));
    if(target===state.page)return;
    if($("#ebook-note-input").value.trim()){
      if(!window.confirm('本页笔记尚未保存，放弃草稿并翻页吗？'))return;
      $("#ebook-note-input").value='';
    }
    window.speechSynthesis?.cancel();state.page=target;$("#reader-page-number").value=target+1;renderEBookPage();
    $('.ebook-reader-body').classList.remove('show-navigation');$("#reader-nav-toggle").setAttribute('aria-expanded','false');
  }
  async function addBookmark(){if(!state.currentReading||!state.content)return;const page=state.content.pages[state.page];try{const updated=await literatureAPI(`/api/v1/literature/shelf/${state.currentReading.id}/bookmarks`,{method:"POST",body:JSON.stringify({page_index:state.page,label:page.chapter||`第 ${state.page+1} 页`,excerpt:page.content.slice(0,180)})});syncReading(updated);notify("已收藏当前页。") }catch(error){notify(error.message,"error")}}
  async function addNote(){
    if(!state.currentReading||!state.content||$("#ebook-add-note").disabled)return;
    const content=$("#ebook-note-input").value.trim(),id=state.currentReading.id,page=state.page;
    if(!content){notify("请先写下笔记内容。","error");return}
    $("#ebook-add-note").disabled=true;
    try{
      const updated=await literatureAPI(`/api/v1/literature/shelf/${id}/notes`,{method:"POST",body:JSON.stringify({page_index:page,content})});
      if(state.currentReading?.id===id&&state.page===page&&$("#ebook-note-input").value.trim()===content)$("#ebook-note-input").value="";
      syncReading(updated);notify("阅读笔记已保存。");
    }catch(error){notify(error.message,"error")}
    finally{$("#ebook-add-note").disabled=false}
  }
  function syncReading(updated){if(state.currentReading?.id===updated.id){state.currentReading=updated;renderEBookTools()}const index=state.shelf.findIndex(item=>item.id===updated.id);if(index>=0)state.shelf[index]=updated;renderShelf()}
  async function removeBookmark(id){if(!state.currentReading||!window.confirm('移除这个书签？'))return;try{syncReading(await literatureAPI(`/api/v1/literature/shelf/${state.currentReading.id}/bookmarks/${id}`,{method:"DELETE"}))}catch(error){notify(error.message,"error")}}
  async function removeNote(id){if(!state.currentReading||!window.confirm('永久删除这条阅读笔记？此操作无法撤销。'))return;try{syncReading(await literatureAPI(`/api/v1/literature/shelf/${state.currentReading.id}/notes/${id}`,{method:"DELETE"}))}catch(error){notify(error.message,"error")}}
  function speakEBookPage(){if(!state.content||!window.speechSynthesis)return notify("当前浏览器不支持语音朗读。","error");window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(state.content.pages[state.page].content);utterance.lang="en-US";utterance.rate=.9;window.speechSynthesis.speak(utterance)}
  async function openClassic(workID){const work=state.classics.find((item)=>item.id===workID);if(!work)return;state.currentWork=work;state.currentStudy=studyFor(workID)||null;state.translationVisible=true;$("#classic-reader-meta").textContent=`${work.dynasty} · ${work.genre} · ${work.difficulty}`;$("#classic-reader-title").textContent=work.title;$("#classic-reader-author").textContent=work.author;$("#classic-parallel-text").classList.remove("translation-hidden");$("#classic-toggle-translation").textContent="隐藏译文";$("#classic-parallel-text").innerHTML=(work.text||[]).map((paragraph,index)=>`<article class="classic-paragraph"><div class="classic-original">${escapeHTML(paragraph)}</div><div class="classic-translation">${escapeHTML(work.translation?.[index]||"")}</div></article>`).join("");$("#classic-background").textContent=work.background;$("#classic-appreciation").textContent=work.appreciation;$("#classic-annotations").innerHTML=(work.annotations||[]).map((item)=>`<article class="classic-annotation"><strong>${escapeHTML(item.term)}</strong><p>${escapeHTML(item.meaning)}</p></article>`).join("");$("#classic-reader-dialog").showModal();if(!state.currentStudy){try{state.currentStudy=await updateClassicStudy({status:"learning"},false)}catch(error){notify(error.message,"error")}}renderClassicStudy()}
  function renderClassicStudy(){const study=state.currentStudy;$("#classic-favorite").textContent=study?.favorite?"★ 已收藏":"☆ 收藏";$("#classic-master").textContent=study?.status==="mastered"?"✓ 已掌握":"标记已掌握";$("#classic-notes").value=study?.notes||"";$("#classic-study-state").textContent=study?`${study.status==="mastered"?"已掌握":"学习中"} · 已诵读 ${study.recitation_count||0} 次`:"尚未开始学习"}
  async function updateClassicStudy(payload,rerender=true){const study=await literatureAPI(`/api/v1/literature/classic-studies/${state.currentWork.id}`,{method:"PUT",body:JSON.stringify(payload)});state.currentStudy=study;const index=state.studies.findIndex((item)=>item.work_id===study.work_id);if(index>=0)state.studies[index]=study;else state.studies.unshift(study);if(rerender){renderClassicStudy();renderClassics();state.overview=await literatureAPI("/api/v1/literature/overview");renderOverview()}return study}
  function speakClassic(){if(!state.currentWork||!window.speechSynthesis)return notify("当前浏览器不支持语音朗读。","error");window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(`${state.currentWork.title}，${state.currentWork.author}。${state.currentWork.text.join("。")}`);utterance.lang="zh-CN";utterance.rate=.78;window.speechSynthesis.speak(utterance)}
  function bind(){document.querySelector('[data-view="literature"]')?.addEventListener("click",()=>{syncAccount();if(!state.initialized)loadLiterature()});$$('[data-literature-mode]').forEach((button)=>button.addEventListener("click",()=>setMode(button.dataset.literatureMode)));$("#ebook-search-form").addEventListener("submit",searchBooks);$("#ebook-reset-search").addEventListener("click",()=>{$("#ebook-search").value="";searchBooks()});$("#classics-search").addEventListener("input",()=>{state.classicQuery=$("#classics-search").value.trim();renderClassics()});$("#classics-dynasty").addEventListener("change",()=>{state.dynasty=$("#classics-dynasty").value;renderClassics()});$("#classics-genre").addEventListener("change",()=>{state.genre=$("#classics-genre").value;renderClassics()});$("#classics-random").addEventListener("click",()=>{const items=filteredClassics();if(items.length)renderClassicFeatured(items[Math.floor(Math.random()*items.length)])});$("#ebook-reader-close").addEventListener("click",()=>{saveProgress();window.speechSynthesis?.cancel();$("#ebook-reader-dialog").close()});$("#ebook-reader-tools-toggle").addEventListener("click",()=>$(".ebook-reader-tools").classList.toggle("open"));$("#ebook-page-prev").addEventListener("click",()=>goToPage(state.page-1));$("#ebook-page-next").addEventListener("click",()=>goToPage(state.page+1));$("#ebook-chapter-select").addEventListener("change",(event)=>goToPage(event.target.value));$("#ebook-add-bookmark").addEventListener("click",addBookmark);$("#ebook-add-note").addEventListener("click",addNote);$("#ebook-speak-page").addEventListener("click",speakEBookPage);$("#ebook-finish-reading").addEventListener("click",async()=>{await saveProgress("completed");notify("这本书已标记为读完。")});$("#ebook-font-size").addEventListener("input",(event)=>{const value=`${event.target.value}px`;$("#ebook-font-output").textContent=value;$("#ebook-page-content").style.fontSize=value});$("#ebook-line-height").addEventListener("input",(event)=>{const value=(Number(event.target.value)/100).toFixed(2);$("#ebook-line-output").textContent=value;$("#ebook-page-content").style.lineHeight=value});$$('[data-ebook-theme]').forEach((button)=>button.addEventListener("click",()=>{$("#ebook-page-stage").dataset.readerTheme=button.dataset.ebookTheme;$$('[data-ebook-theme]').forEach((item)=>item.classList.toggle("active",item===button))}));$$('[data-ebook-tool]').forEach((button)=>button.addEventListener("click",()=>{$$('[data-ebook-tool]').forEach((item)=>item.classList.toggle("active",item===button));$$('.ebook-tool-panel').forEach((panel)=>panel.classList.toggle("hidden",panel.id!==`ebook-tool-${button.dataset.ebookTool}`))}));$("#classic-reader-close").addEventListener("click",()=>{window.speechSynthesis?.cancel();$("#classic-reader-dialog").close()});$("#classic-speak").addEventListener("click",speakClassic);$("#classic-toggle-translation").addEventListener("click",()=>{state.translationVisible=!state.translationVisible;$("#classic-parallel-text").classList.toggle("translation-hidden",!state.translationVisible);$("#classic-toggle-translation").textContent=state.translationVisible?"隐藏译文":"显示译文"});$("#classic-favorite").addEventListener("click",()=>updateClassicStudy({favorite:!state.currentStudy?.favorite}).catch((error)=>notify(error.message,"error")));$("#classic-save-notes").addEventListener("click",()=>updateClassicStudy({notes:$("#classic-notes").value.trim()}).then(()=>notify("古诗文学习笔记已保存。")).catch((error)=>notify(error.message,"error")));$("#classic-recite").addEventListener("click",()=>updateClassicStudy({increment_recitation:true}).then(()=>notify("已记录一次诵读。")).catch((error)=>notify(error.message,"error")));$("#classic-master").addEventListener("click",()=>updateClassicStudy({status:state.currentStudy?.status==="mastered"?"learning":"mastered"}).catch((error)=>notify(error.message,"error")));
    document.addEventListener("click",async(event)=>{const add=event.target.closest("[data-ebook-add]");if(add)await addOrOpenBook(add.dataset.ebookAdd,add);const open=event.target.closest("[data-ebook-open]");if(open)await openEBook(open.dataset.ebookOpen);const remove=event.target.closest("[data-ebook-remove]");if(remove&&window.confirm("从书架移除这本书？阅读进度、书签和笔记也会删除。")){try{await literatureAPI(`/api/v1/literature/shelf/${remove.dataset.ebookRemove}`,{method:"DELETE"});state.shelf=state.shelf.filter((item)=>item.id!==remove.dataset.ebookRemove);renderShelf();renderCatalog();state.overview=await literatureAPI("/api/v1/literature/overview");renderOverview();notify("已从书架移除。") }catch(error){notify(error.message,"error")}}const page=event.target.closest("[data-ebook-page]");if(page)goToPage(page.dataset.ebookPage);const bookmarkGo=event.target.closest("[data-bookmark-goto]");if(bookmarkGo)goToPage(bookmarkGo.dataset.bookmarkGoto);const bookmarkDelete=event.target.closest("[data-bookmark-delete]");if(bookmarkDelete)await removeBookmark(bookmarkDelete.dataset.bookmarkDelete);const noteGo=event.target.closest("[data-note-goto]");if(noteGo)goToPage(noteGo.dataset.noteGoto);const noteDelete=event.target.closest("[data-note-delete]");if(noteDelete)await removeNote(noteDelete.dataset.noteDelete);const classic=event.target.closest("[data-classic-open]");if(classic)await openClassic(classic.dataset.classicOpen);const retry=event.target.closest("[data-literature-retry]");if(retry)loadLiterature()});document.addEventListener("keydown",(event)=>{if(!$("#ebook-reader-dialog").open||event.target.closest?.("input,textarea,select,button,a,summary,[contenteditable]"))return;if(event.key==="ArrowLeft"){event.preventDefault();goToPage(state.page-1)}if(event.key==="ArrowRight"||event.key===" "){event.preventDefault();goToPage(state.page+1)}});const panel=$("#panel-literature");if(panel){new MutationObserver(()=>{if(panel.classList.contains("active")){syncAccount();if(!state.initialized)loadLiterature()}}).observe(panel,{attributes:true,attributeFilter:["class"]});if(panel.classList.contains("active"))loadLiterature()}}
  let readerVersion=0, searchVersion=0, progressPromise=null, progressFailed=false;
  function findInBook(pages,query){
    const needle=query.trim().toLocaleLowerCase();if(needle.length<2)return [];
    return pages.flatMap((page,index)=>{const offset=page.content.toLocaleLowerCase().indexOf(needle);return offset<0?[]:[{index,excerpt:page.content.slice(Math.max(0,offset-45),offset+needle.length+100)}]}).slice(0,60);
  }
  function readerSettings(){
    return {font:Number($("#ebook-font-size").value),line:Number($("#ebook-line-height").value),theme:$("#ebook-page-stage").dataset.readerTheme||"paper"};
  }
  function persistReaderSettings(){try{localStorage.setItem("studyflow.reader.settings",JSON.stringify(readerSettings()))}catch(_){}}
  function setupProduct(){
    let editingNote=null;
    const cancelEdit=event=>{
      if(editingNote&&$("#reading-note-edit-content").value!==editingNote.content&&!window.confirm('放弃尚未保存的笔记修改？')){event?.preventDefault();return}
      $("#reading-note-edit-dialog").close();editingNote=null;
    };
    $("#reading-note-edit-cancel").addEventListener('click',cancelEdit);
    $("#reading-note-edit-dialog").addEventListener('cancel',cancelEdit);
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-note-edit]');if(!button||!state.currentReading)return;
      const note=state.currentReading.notes?.find(item=>item.id===button.dataset.noteEdit);if(!note)return;
      editingNote={...note,readingID:state.currentReading.id};
      $("#reading-note-edit-content").value=note.content;$("#reading-note-edit-status").textContent=`第 ${note.page_index+1} 页 · 修改不会改变原页码`;
      $("#reading-note-edit-dialog").showModal();$("#reading-note-edit-content").focus();
    });
    $("#reading-note-edit-form").addEventListener('submit',async event=>{
      event.preventDefault();if(!editingNote||$("#reading-note-edit-save").disabled)return;
      const note=editingNote,content=$("#reading-note-edit-content").value.trim();
      if(!content){$("#reading-note-edit-status").textContent='笔记不能为空';return}
      $("#reading-note-edit-save").disabled=true;$("#reading-note-edit-status").textContent='正在保存…';
      try{
        const updated=await literatureAPI(`/api/v1/literature/shelf/${note.readingID}/notes/${note.id}`,{method:'PATCH',body:JSON.stringify({content})});
        syncReading(updated);
        if(editingNote===note){
          if($("#reading-note-edit-content").value.trim()===content){editingNote=null;$("#reading-note-edit-dialog").close()}
          else{editingNote.content=content;$("#reading-note-edit-status").textContent='已保存提交内容，仍有新修改待保存'}
        }
      }catch(error){$("#reading-note-edit-status").textContent=error.message}
      finally{$("#reading-note-edit-save").disabled=false}
    });
    new MutationObserver(()=>{
      const token=localStorage.getItem('studyflow.token')||'';
      if(token!==state.token){readerVersion++;searchVersion++;progressFailed=false;state.readerStarted=0;window.clearTimeout(state.saveTimer);window.speechSynthesis?.cancel();$("#ebook-reader-dialog").close();$("#classic-reader-dialog").close();$("#reading-note-edit-dialog").close();editingNote=null;syncAccount()}
    }).observe($("#app-view"),{attributes:true,attributeFilter:['class']});
    try{
      const settings=JSON.parse(localStorage.getItem("studyflow.reader.settings")||"null");
      if(settings){
        if(Number.isFinite(settings.font)&&settings.font>=15&&settings.font<=28){$("#ebook-font-size").value=settings.font;$("#ebook-font-output").textContent=settings.font+'px';$("#ebook-page-content").style.fontSize=settings.font+'px'}
        if(Number.isFinite(settings.line)&&settings.line>=150&&settings.line<=230){$("#ebook-line-height").value=settings.line;$("#ebook-line-output").textContent=(settings.line/100).toFixed(2);$("#ebook-page-content").style.lineHeight=settings.line/100}
        if(['paper','sepia','night'].includes(settings.theme)){$("#ebook-page-stage").dataset.readerTheme=settings.theme;$$('[data-ebook-theme]').forEach(button=>button.classList.toggle('active',button.dataset.ebookTheme===settings.theme))}
      }
    }catch(_){}
    $("#ebook-font-size").addEventListener('input',persistReaderSettings);$("#ebook-line-height").addEventListener('input',persistReaderSettings);
    $$('[data-ebook-theme]').forEach(button=>button.addEventListener('click',persistReaderSettings));
    $("#shelf-query").addEventListener('input',renderShelf);$("#shelf-status").addEventListener('change',renderShelf);
    $("#reader-jump-form").addEventListener('submit',event=>{event.preventDefault();if(state.content)goToPage(Number($("#reader-page-number").value)-1)});
    $("#reader-nav-toggle").addEventListener('click',()=>{const open=$('.ebook-reader-body').classList.toggle('show-navigation');$("#reader-nav-toggle").setAttribute('aria-expanded',String(open))});
    $("#reader-focus").addEventListener('click',()=>{const focused=$('.ebook-reader-body').classList.toggle('reader-focused');$("#reader-focus").setAttribute('aria-pressed',String(focused));$("#reader-focus").textContent=focused?'退出沉浸':'沉浸阅读'});
    $("#reader-stop-speech").addEventListener('click',()=>window.speechSynthesis?.cancel());
    $("#reader-retry").addEventListener('click',()=>{if(state.currentReading)openEBook(state.currentReading.id)});
    $("#reader-save").addEventListener('click',()=>saveProgress());
    $("#reader-search-form").addEventListener('submit',event=>{
      event.preventDefault();if(!state.content)return;
      const results=findInBook(state.content.pages,$("#reader-text-query").value);
      $("#reader-search-results").innerHTML=results.length?`<p>找到 ${results.length}${results.length===60?'（最多显示 60）':''} 个匹配页面</p>`+results.map(item=>`<button type="button" data-bookmark-goto="${item.index}"><strong>第 ${item.index+1} 页</strong> ${escapeHTML(item.excerpt)}</button>`).join(''):'没有匹配的原文，请尝试其他词句。';
    });
    $("#reader-export").addEventListener('click',()=>{
      const reading=state.currentReading;if(!reading)return;
      const text=`# ${reading.book.title}\n\n${authorLabel(reading.book)}\n\n## 阅读笔记\n\n`+(reading.notes||[]).map(note=>`### 第 ${note.page_index+1} 页\n\n${note.content}`).join('\n\n')+'\n\n## 书签\n\n'+(reading.bookmarks||[]).map(bookmark=>`- 第 ${bookmark.page_index+1} 页：${bookmark.label}`).join('\n');
      const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=reading.book.title.replace(/[\\/:*?"<>|]/g,'-').slice(0,100)+'-阅读笔记.md';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const close=async event=>{
      event.preventDefault();event.stopImmediatePropagation();
      if($("#ebook-note-input").value.trim()&&!window.confirm('有尚未保存的阅读笔记，仍要关闭吗？'))return;
      const pending=saveProgress();state.readerStarted=0;
      if(!(await pending))return;
      readerVersion++;window.clearTimeout(state.saveTimer);state.readerStarted=0;window.speechSynthesis?.cancel();$("#ebook-reader-dialog").close();
    };
    $("#ebook-reader-close").addEventListener('click',close,true);$("#ebook-reader-dialog").addEventListener('cancel',close,true);
    $("#ebook-finish-reading").addEventListener('click',async event=>{event.stopImmediatePropagation();if(state.content&&await saveProgress('completed'))notify('这本书已标记为读完。')},true);
    document.addEventListener('visibilitychange',()=>{if(!$("#ebook-reader-dialog").open)return;if(document.hidden){saveProgress();state.readerStarted=0;window.speechSynthesis?.cancel()}else if(state.content)state.readerStarted=Date.now()});
    window.setInterval(()=>{if(!document.hidden&&$("#ebook-reader-dialog").open&&state.content)saveProgress()},60000);
    window.addEventListener('beforeunload',event=>{if(progressPromise||progressFailed||($("#ebook-reader-dialog").open&&state.content)){event.preventDefault();event.returnValue=''}});
  }
  bind();
  setupProduct();
})();
