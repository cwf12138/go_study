(() => {
  'use strict';
  const key=text=>String(text??'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  const names=text=>[...new Set(String(text).split(/[，,、\n]/).map(key).filter(Boolean))];
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const date=value=>new Date(value+'T12:00:00Z');
  function shift(value,n){const d=date(value);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function week(value){const offset=(date(value).getUTCDay()+6)%7;const monday=shift(value,-offset);return Array.from({length:7},(_,i)=>shift(monday,i));}
  function parseIngredients(text){return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const i=line.indexOf('|');return {name:(i<0?line:line.slice(0,i)).trim(),quantity:(i<0?'适量':line.slice(i+1)).trim()||'适量'};});}
  function missing(recipe,have){const owned=new Set(have.map(key));return recipe.ingredients.filter(item=>!owned.has(key(item.name)));}
  function filtered(rows,{query='',category='',minutes=0,favorite=false,ready=false,have=[]}={}){
    const q=key(query);return rows.filter(row=>row.kind==='recipe'&&!row.deleted&&(!category||row.category===category)&&(!minutes||row.minutes<=minutes)&&(!favorite||row.favorite)&&(!ready||!missing(row,have).length)&&(!q||key(row.title+' '+row.category+' '+row.ingredients.map(i=>i.name).join(' ')).includes(q))).sort((a,b)=>Number(b.favorite)-Number(a.favorite)||a.title.localeCompare(b.title,'zh-CN')||a.id.localeCompare(b.id));
  }
  function shopping(rows,ids){
    const needed=new Map();for(const id of [...new Set(ids)]){let row=rows.find(r=>r.id===id&&!r.deleted);if(row?.kind==='plan')row=rows.find(r=>r.id===row.recipe_id&&!r.deleted);if(!row||row.kind!=='recipe')throw Error('有菜谱已删除，请刷新菜单后重试。');for(const ingredient of row.ingredients){const k=key(ingredient.name),old=needed.get(k)||{name:ingredient.name,uses:[]};old.uses.push(row.title+'：'+ingredient.quantity);needed.set(k,old);}}
    return [...needed.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  }
  const starter=(id,title,category,minutes,servings,ingredients,steps,note='')=>({id:'meal-example-'+id,kind:'recipe',title,category,minutes,servings,ingredients:parseIngredients(ingredients),steps:steps.split('\n'),note,favorite:false,revision:0,deleted:false});
  // Original, editable home-cooking examples, not scraped recipes or nutrition advice.
  const examples=[
    starter('tomato','番茄炒蛋','家常菜',15,2,'番茄 | 2个\n鸡蛋 | 3个\n食用油 | 适量\n盐 | 适量','番茄洗净切块，鸡蛋打散。\n锅中热油，倒入蛋液，炒至凝固后盛出。\n炒软番茄，加入鸡蛋和盐，翻炒至鸡蛋熟透。'),
    starter('noodle','香菇青菜面','主食',15,1,'面条 | 1人份\n香菇 | 3朵\n小青菜 | 1把\n盐 | 适量\n食用油 | 适量','香菇洗净切片，小青菜洗净。\n锅中少量油炒香香菇，加入清水煮开。\n放入面条煮至熟透，加入青菜煮熟，加盐调味。'),
    starter('oats','香蕉燕麦碗','早餐',10,1,'燕麦片 | 40克\n牛奶 | 200毫升\n香蕉 | 1根','牛奶与燕麦放入小锅，按燕麦包装说明煮熟。\n香蕉去皮切片。\n燕麦盛入碗中，摆上香蕉，稍凉后享用。','乳制品过敏者请选用适合自己的替代品。'),
    starter('potato','清炒土豆丝','家常菜',20,2,'土豆 | 2个\n青椒 | 1个\n食用油 | 适量\n盐 | 适量\n白醋 | 少量','土豆去皮切丝，用清水冲洗后沥干；青椒切丝。\n锅中热油，放入土豆丝与青椒翻炒。\n加少量水继续炒至土豆熟透，加盐和白醋调味。','不食用发芽或明显变绿的土豆。'),
    starter('tofu','菌菇豆腐汤','汤羹',20,2,'嫩豆腐 | 1盒\n鲜香菇 | 4朵\n葱 | 1根\n盐 | 适量\n食用油 | 适量','豆腐切块，鲜香菇切片，葱洗净切段。\n锅中少量油炒香香菇，加水煮开。\n加入豆腐，小火煮约 8 分钟至食材熟透，加盐和葱。'),
    starter('rice','胡萝卜鸡肉饭','主食',30,2,'鸡肉 | 200克\n胡萝卜 | 1根\n米饭 | 2人份\n酱油 | 适量\n食用油 | 适量','鸡肉切小块，胡萝卜洗净切小丁，生熟食材分开处理。\n热油炒鸡肉，加入胡萝卜和少量水，焖煮至鸡肉完全熟透。\n加入米饭和酱油，翻炒至整体充分加热。','鸡肉需完全熟透；剩饭须妥善冷藏并充分加热。'),
    starter('salad','黄瓜番茄沙拉','轻食',10,2,'黄瓜 | 1根\n番茄 | 2个\n橄榄油 | 少量\n盐 | 少量','黄瓜和番茄充分清洗，使用干净刀具切块。\n放入碗中，加少量橄榄油和盐。\n轻轻拌匀，现做现吃。'),
    starter('egg','鸡蛋吐司','早餐',10,1,'吐司 | 2片\n鸡蛋 | 1个\n食用油 | 少量','平底锅少量油，煎鸡蛋至蛋白蛋黄均熟。\n吐司按喜好烘烤。\n将熟鸡蛋夹入吐司，趁热享用。')
  ];
  window.DaynestMeals=Object.freeze({key,names,today,shift,week,parseIngredients,missing,filtered,shopping,examples});
})();
