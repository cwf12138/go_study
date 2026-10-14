(() => {
  'use strict';
  const channelNames={delivery:'点外卖',dinein:'到店吃',ready:'买现成'},mealNames={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'加餐'};
  const rows=[];
  function add(title,icon,low,high,channel,meal,flavor,portion,vegetarian,order,keys){rows.push(Object.freeze({id:'food-local-'+rows.length,title,icon,budget_low:low,budget_high:high,channel,meal:meal.split(','),flavor,portion,vegetarian,order,keys}));}
  add('鸡腿饭','🍗',18,30,'delivery','lunch,dinner','mild','hearty',false,'鸡腿饭套餐，搭配一份蔬菜；酱汁另放。','鸡肉 米饭 大豆');
  add('牛肉面','🍜',18,32,'dinein','lunch,dinner','mild','hearty',false,'清汤牛肉面，辣椒另放；可搭配一份小菜。','牛肉 面 小麦 大豆');
  add('番茄鸡蛋面','🍅',12,22,'delivery','lunch,dinner','mild','normal',true,'番茄鸡蛋面，少油；喜欢汤面就备注多一点汤。','番茄 鸡蛋 面 小麦');
  add('清汤馄饨','🥟',12,22,'dinein','breakfast,lunch,dinner','mild','light',false,'一碗清汤馄饨，葱和香菜按喜好选择。','猪肉 馄饨 小麦 大豆');
  add('水饺','🥟',15,28,'delivery','lunch,dinner','mild','normal',false,'一份猪肉蔬菜水饺，蘸料单独放。','猪肉 饺子 小麦 大豆');
  add('黄焖鸡米饭','🍚',20,35,'delivery','lunch,dinner','mild','hearty',false,'黄焖鸡米饭，选不辣，搭配蔬菜。','鸡肉 米饭 大豆 香菇 土豆');
  add('日式咖喱饭','🍛',25,40,'delivery','lunch,dinner','mild','hearty',false,'鸡肉咖喱饭，留意咖喱酱是否含奶。','鸡肉 咖喱 米饭 牛奶 小麦');
  add('照烧鸡肉饭','🍱',25,40,'delivery','lunch,dinner','mild','normal',false,'照烧鸡肉饭，酱汁另放，可搭配蔬菜。','鸡肉 米饭 大豆 小麦');
  add('麻辣烫','🥘',20,35,'delivery','lunch,dinner','spicy','normal',false,'微辣麻辣烫，选主食、蔬菜和喜欢的熟食配料；下单前核对总价。','辣 鸡蛋 牛奶 大豆 小麦 花生 牛肉 猪肉 海鲜');
  add('酸辣粉','🌶️',12,22,'dinein','lunch,dinner','spicy','normal',false,'一碗酸辣粉，辣度按实际接受程度选择。','辣 粉 花生 大豆 猪肉');
  add('麻辣香锅','🌶️',35,55,'delivery','lunch,dinner','spicy','hearty',false,'单人麻辣香锅套餐，配米饭；选择前确认份量和配料。','辣 牛肉 猪肉 海鲜 大豆 花生 米饭');
  add('重庆小面','🍜',12,22,'dinein','lunch,dinner','spicy','normal',false,'小面加一份蔬菜；花生、辣椒和汤底提前询问。','辣 面 小麦 花生 大豆 猪肉');
  add('螺蛳粉','🍜',18,30,'delivery','lunch,dinner','spicy','normal',false,'一份螺蛳粉，辣油另放；确认是否接受酸笋味道。','辣 粉 花生 大豆 螺蛳 海鲜');
  add('拌面','🍝',15,25,'delivery','lunch,dinner','spicy','normal',false,'一份微辣拌面，搭配蔬菜，酱料单独放。','辣 面 小麦 花生 大豆 猪肉');
  add('盖浇饭','🍚',16,25,'dinein','lunch,dinner','mild','hearty',false,'选择一份不辣的肉菜盖饭，再配一份青菜。','猪肉 牛肉 米饭 大豆');
  add('素食便当','🥦',22,35,'delivery','lunch,dinner','mild','normal',true,'蔬菜、豆腐和米饭便当；向店家确认汤底与调味料。','蔬菜 豆腐 大豆 米饭');
  add('蔬菜沙拉','🥗',25,40,'delivery','lunch,dinner,snack','mild','light',true,'蔬菜沙拉配主食，酱汁另放；确认奶制品和坚果配料。','蔬菜 面包 小麦 牛奶 坚果 花生');
  add('杂粮饭便当','🍱',28,45,'delivery','lunch,dinner','mild','normal',false,'杂粮饭、鸡肉和蔬菜组合，酱汁另放。','鸡肉 杂粮 米饭 大豆');
  add('粥铺套餐','🥣',15,25,'dinein','breakfast,lunch,dinner','mild','light',false,'一碗粥加一个包子或小菜，按食量选择。','粥 米饭 猪肉 包子 小麦');
  add('清汤米粉','🍲',15,25,'dinein','breakfast,lunch,dinner','mild','light',false,'清汤米粉，配青菜；辣椒另放。','米粉 猪肉 鸡肉 大豆');
  add('鸡肉汉堡套餐','🍔',25,40,'delivery','lunch,dinner','mild','hearty',false,'鸡肉汉堡套餐，饮料可换无糖饮品或水。','鸡肉 面包 小麦 鸡蛋 牛奶 大豆');
  add('披萨','🍕',35,60,'delivery','lunch,dinner','mild','hearty',false,'单人披萨或小份套餐，按食量选尺寸，核对配料。','披萨 小麦 牛奶 猪肉');
  add('韩式拌饭','🍚',25,38,'dinein','lunch,dinner','spicy','normal',false,'一份拌饭，酱料另放；配料与辣度询问店家。','辣 米饭 鸡蛋 牛肉 大豆');
  add('寿司熟食套餐','🍣',30,50,'dinein','lunch,dinner','mild','light',false,'选择熟食寿司组合，配清汤，核对海鲜与蛋奶配料。','寿司 米饭 海鲜 鸡蛋 大豆');
  add('便利店饭团','🍙',8,15,'ready','breakfast,lunch,dinner,snack','mild','light',false,'挑一个饭团，可搭配水；先看配料与保质期。','饭团 米饭 海鲜 鸡蛋 大豆');
  add('便利店便当','🍱',18,30,'ready','lunch,dinner','mild','hearty',false,'挑一份便当，按包装说明加热，确认配料与价格。','米饭 猪肉 鸡肉 鸡蛋 大豆');
  add('三明治','🥪',12,25,'ready','breakfast,lunch,dinner,snack','mild','normal',false,'鸡肉或火腿三明治，搭配一瓶水；看清配料标签。','鸡肉 猪肉 火腿 面包 小麦 鸡蛋 牛奶 大豆');
  add('面包与牛奶','🥖',10,18,'ready','breakfast,snack','mild','light',true,'一份面包配牛奶，按食量选份量。','面包 小麦 鸡蛋 牛奶');
  add('水果与酸奶','🍎',12,25,'ready','breakfast,snack','mild','light',true,'水果杯配原味酸奶；看清配料及保质期。','水果 牛奶 酸奶');
  add('包子与豆浆','🥟',8,15,'dinein','breakfast','mild','normal',false,'两个包子配豆浆，馅料按喜好选。','包子 小麦 猪肉 大豆');
  add('煎饼果子','🌯',10,18,'dinein','breakfast,lunch','mild','normal',true,'一份煎饼果子，不加辣；确认鸡蛋和酱料。','煎饼 小麦 鸡蛋 大豆');
  add('饭团与豆浆','🍙',10,18,'dinein','breakfast','mild','normal',true,'素饭团配豆浆，确认是否含肉松及咸蛋。','饭团 米饭 鸡蛋 大豆');
  add('汤面早餐','🍜',12,20,'dinein','breakfast','mild','normal',false,'一碗清汤面，配一份小菜，向店家确认汤底。','面 小麦 猪肉 大豆');
  add('烤红薯','🍠',6,15,'ready','breakfast,snack','mild','light',true,'一份烤红薯，按大小计价，下单前核对价格。','红薯');
  add('玉米与茶叶蛋','🌽',6,12,'ready','breakfast,snack','mild','light',true,'一根熟玉米配茶叶蛋；确认调味配料。','玉米 鸡蛋 大豆');
  add('辣味鸡肉卷','🌯',18,30,'ready','lunch,dinner,snack','spicy','normal',false,'一份辣味鸡肉卷，核对配料，搭配水。','辣 鸡肉 小麦 鸡蛋 牛奶 大豆');
  add('素炒面','🍝',12,22,'dinein','lunch,dinner','mild','normal',true,'素炒面配青菜，确认是否含蛋及动物油。','面 小麦 鸡蛋 大豆');
  add('辣味豆腐饭','🍚',18,28,'delivery','lunch,dinner','spicy','normal',true,'选择素食辣味豆腐饭，确认是否放肉末或肉汤。','辣 豆腐 大豆 米饭');
  const canonical=s=>String(s).trim().toLowerCase().replace(/西红柿/g,'番茄').replace(/马铃薯/g,'土豆').replace(/乳制品/g,'牛奶').replace(/面食/g,'小麦').replace(/海产品/g,'海鲜');
  const names=s=>[...new Set(String(s).split(/[,，、;；\n]/).map(canonical).filter(Boolean))];
  function currentMeal(date=new Date()){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(date));return hour<10?'breakfast':hour<15?'lunch':hour<21?'dinner':'snack';}
  function prepare(raw){
    const p={...raw,exclude:[...(raw.exclude||[])].map(canonical),recent:[...(raw.recent||[])]};p.budget=Number(p.budget||0);const text=String(p.prompt||'').trim();const recognized=[];
    const money=text.match(/预算(?:只有|是|大概|约|不超过)?\s*(\d{1,3})\s*(?:元|块)?|(?:只有|最多|不超过)\s*(\d{1,3})\s*(?:元|块)/);if(!p.budget&&money){p.budget=Number(money[1]||money[2]);recognized.push('每人预算 '+p.budget+' 元');}
    if(p.flavor==='any'&&/不(?:吃|要|想吃)辣|清淡|不能吃辣/.test(text)){p.flavor='mild';recognized.push('不加辣');}
    if(p.channel==='any'){if(/外卖/.test(text)){p.channel='delivery';recognized.push('外卖');}else if(/到店|下馆子|堂食/.test(text)){p.channel='dinein';recognized.push('到店吃');}else if(/便利店|买现成/.test(text)){p.channel='ready';recognized.push('买现成');}}
    if(p.hunger==='any'){if(/很饿|吃饱|饿坏|饿得/.test(text)){p.hunger='hearty';recognized.push('吃饱一点');}else if(/不太饿|吃一点|少吃|小份/.test(text)){p.hunger='light';recognized.push('吃轻一点');}}
    if(/吃素|素食/.test(text)){p.vegetarian=true;recognized.push('素食方向');}
    for(const match of text.matchAll(/(?:不吃|不要|不想吃|不能吃|忌口[：:]?)\s*([^，。；;！!？?\n]{1,40})/g)){
      const chunks=match[1].split(/和|以及|也不吃|与|、/).map(canonical).filter(s=>s&&!/^(辣|太辣)$/.test(s));for(const s of chunks){if(s.length<=80){p.exclude.push(s);recognized.push('排除 '+s);}}
    }
    p.exclude=[...new Set(p.exclude)];
    if(!mealNames[p.meal]||!['any',...Object.keys(channelNames)].includes(p.channel)||!['any','mild','spicy'].includes(p.flavor)||!['any','light','hearty'].includes(p.hunger)||!Number.isInteger(p.budget)||p.budget<0||p.budget>500||p.exclude.length>20||p.exclude.some(s=>s.length>80))throw Error('请检查餐次、偏好与排除内容（最多 20 项）。');
    return {prefs:p,recognized};
  }
  function allowed(row,p){return row.meal.includes(p.meal)&&(p.channel==='any'||row.channel===p.channel)&&(!p.budget||row.budget_high<=p.budget)&&(p.flavor==='any'||row.flavor===p.flavor)&&(p.hunger==='any'||row.portion===p.hunger)&&(!p.vegetarian||row.vegetarian)&&!p.exclude.some(s=>canonical(row.title+' '+row.order+' '+row.keys).includes(s));}
  function recommend(p,random=Math.random){
    let pool=rows.filter(r=>allowed(r,p));if(!pool.length)throw Error('暂时没有同时符合这些条件的选择。试试放宽预算或就餐方式；忌口不会自动取消。');
    const fresh=pool.filter(r=>!p.recent.includes(r.title));const repeated=!fresh.length;if(fresh.length)pool=fresh;
    pool=pool.map(r=>({r,rank:random()})).sort((a,b)=>a.rank-b.rank).slice(0,3).map(({r})=>({...r,reason:[`适合${mealNames[p.meal]}，${channelNames[r.channel]}就能解决。`,p.hunger==='hearty'?'主食搭配更适合想吃饱的这一顿。':p.hunger==='light'?'份量方向轻一点，点单时再确认实际份量。':p.flavor==='mild'?'口味方向不加辣，点单时可以再备注。':'给纠结一个具体答案，先从这一份开始。'].join(' ')}));
    return {summary:repeated?'符合条件的选择不多，本次会重复一些候选；可以调整条件继续选。':'先选一个喜欢的，不必把整顿饭想得太复杂。',choices:pool,repeated};
  }
  window.DaynestFoodChoice=Object.freeze({catalog:Object.freeze(rows),channelNames,mealNames,names,canonical,currentMeal,prepare,recommend,allowed});
})();
