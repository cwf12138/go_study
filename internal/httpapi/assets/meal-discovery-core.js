(() => {
  'use strict';
  const C=window.DaynestMeals;if(!C)return;
  const dish=(id,title,role,minutes,ingredients,steps,spicy=false)=>({id:'meal-discover-'+id,kind:'recipe',title,category:{staple:'主食',rice:'主食',protein:'家常菜',veg:'轻食',soup:'汤羹',breakfast:'早餐'}[role],role,minutes,servings:2,ingredients:C.parseIngredients(ingredients),steps:steps.split('\n'),spicy,note:'用量与耗时为家常做法参考，请按人数调整；生熟分开，食材充分做熟。',favorite:false,deleted:false,revision:0});
  // Original concise recipes. Chinese cooking portals informed navigation, not copied instructions.
  const catalog=[
    dish('tomato-egg','番茄炒蛋','protein',15,'番茄 | 2个\n鸡蛋 | 3个\n食用油 | 10毫升\n盐 | 适量','番茄洗净切块，鸡蛋打散。\n热油炒鸡蛋至凝固，盛出备用。\n炒软番茄，加入鸡蛋和盐，翻炒至全熟。'),
    dish('pepper-pork','青椒肉丝','protein',20,'猪肉 | 200克\n青椒 | 2个\n生抽 | 10毫升\n食用油 | 10毫升','猪肉切细丝，青椒洗净切丝，分开使用刀板。\n热油炒肉丝至熟，再加入青椒。\n加入生抽与少量水，翻炒至肉和青椒熟透。'),
    dish('mushroom-chicken','香菇鸡丁','protein',25,'鸡肉 | 250克\n鲜香菇 | 5个\n生抽 | 10毫升\n食用油 | 10毫升','鸡肉切小块，香菇洗净切块。\n热油炒鸡肉，加入香菇与少量水。\n加入生抽焖煮，确认鸡肉内部完全熟透。'),
    dish('onion-beef','洋葱炒牛肉','protein',20,'牛肉 | 250克\n洋葱 | 1个\n生抽 | 10毫升\n食用油 | 10毫升','牛肉切薄片，洋葱切丝。\n热油翻炒牛肉，再加入洋葱。\n加入生抽和少量水，炒至所有食材充分熟透。'),
    dish('shrimp-egg','虾仁炒蛋','protein',15,'虾仁 | 180克\n鸡蛋 | 3个\n食用油 | 10毫升\n盐 | 适量','虾仁清洗沥干，鸡蛋打散。\n热油先将虾仁炒熟，倒入蛋液。\n轻轻翻炒，待虾仁和鸡蛋完全熟透后加盐。'),
    dish('steamed-fish','清蒸鱼片','protein',25,'鱼肉 | 300克\n姜 | 10克\n葱 | 1根\n盐 | 适量','鱼肉检查并去除鱼刺，洗净切片，放入耐热盘。\n加入姜、葱和少量盐，放入水已沸腾的蒸锅。\n蒸至鱼肉内部熟透，再取出；时间随厚度调整。'),
    dish('tofu-egg','豆腐抱蛋','protein',15,'嫩豆腐 | 300克\n鸡蛋 | 3个\n食用油 | 10毫升\n盐 | 适量','豆腐切小块，鸡蛋打散加少量盐。\n平底锅少量油，将豆腐加热。\n倒入蛋液，小火加盖煮至蛋液完全凝固、豆腐热透。'),
    dish('mapo','家常麻婆豆腐','protein',25,'豆腐 | 300克\n猪肉 | 100克\n豆瓣酱 | 15克\n淀粉 | 5克\n食用油 | 10毫升','豆腐切块，猪肉剁碎，淀粉加水调匀。\n热油将肉末炒熟，加入豆瓣酱炒香。\n加水和豆腐炖煮至熟透，用淀粉水少量勾芡。',true),
    dish('potato-chicken','土豆炖鸡块','protein',40,'鸡肉 | 300克\n土豆 | 2个\n胡萝卜 | 1根\n生抽 | 10毫升\n食用油 | 10毫升','鸡肉切块，土豆和胡萝卜洗净去皮切块；不用发芽或变绿土豆。\n热油炒鸡肉，加入蔬菜、生抽和水。\n加盖炖煮至蔬菜软熟，鸡肉内部完全熟透。'),
    dish('mushroom-tofu','香菇烧豆腐','protein',20,'豆腐 | 300克\n鲜香菇 | 5个\n生抽 | 10毫升\n食用油 | 10毫升','豆腐切块，香菇洗净切片。\n热油炒香菇，加入豆腐、生抽和适量水。\n小火炖煮至熟透，轻轻翻动避免碎裂。'),
    dish('cabbage','手撕包菜','veg',10,'包菜 | 300克\n食用油 | 10毫升\n盐 | 适量','包菜充分清洗后撕小块，沥干。\n热油下包菜翻炒，视情况加少量水。\n炒至熟透，加盐调味。'),
    dish('broccoli','蒜香西兰花','veg',15,'西兰花 | 300克\n蒜 | 10克\n食用油 | 10毫升\n盐 | 适量','西兰花掰小朵、充分清洗；蒜切碎。\n西兰花用沸水煮熟后沥干。\n少量油炒香蒜末，加入西兰花和盐拌炒。'),
    dish('potato','醋溜土豆丝','veg',15,'土豆 | 2个\n食用油 | 10毫升\n白醋 | 10毫升\n盐 | 适量','不使用发芽或变绿的土豆；去皮切丝，冲洗后沥干。\n热油翻炒土豆丝，加入少量水继续加热。\n炒至熟透，加入白醋和盐。'),
    dish('spinach','清炒菠菜','veg',10,'菠菜 | 300克\n食用油 | 10毫升\n盐 | 适量','菠菜择洗干净，沥干水分。\n用沸水焯熟后捞出。\n少量油将菠菜炒热，加盐调味。'),
    dish('zucchini','清炒西葫芦','veg',15,'西葫芦 | 1个\n蒜 | 10克\n食用油 | 10毫升\n盐 | 适量','西葫芦洗净切片，蒜切碎。\n热油炒香蒜末，加入西葫芦。\n加入少量水，炒至软熟后加盐。'),
    dish('cauliflower','香辣菜花','veg',20,'菜花 | 300克\n辣椒 | 1个\n食用油 | 10毫升\n盐 | 适量','菜花掰成小朵洗净，辣椒切段。\n菜花用沸水煮熟后沥干。\n热油炒香辣椒，加入菜花和盐翻炒。',true),
    dish('carrot','胡萝卜炒木耳','veg',15,'胡萝卜 | 1根\n鲜木耳 | 100克\n食用油 | 10毫升\n盐 | 适量','使用新鲜、可食用木耳，洗净后切小块；胡萝卜切片。\n木耳在沸水中煮熟。\n热油炒胡萝卜，加少量水煮软，加入木耳和盐炒熟。'),
    dish('egg-soup','番茄蛋花汤','soup',15,'番茄 | 2个\n鸡蛋 | 2个\n盐 | 适量','番茄洗净切块，鸡蛋打散。\n番茄加入清水煮软，保持沸腾。\n缓慢倒入蛋液，煮至蛋花熟透，加盐。'),
    dish('winter-melon','冬瓜豆腐汤','soup',20,'冬瓜 | 300克\n豆腐 | 200克\n盐 | 适量','冬瓜去皮去籽切块，豆腐切块。\n清水煮开，放入冬瓜煮软。\n加入豆腐继续煮至熟透，加少量盐。'),
    dish('corn-soup','玉米胡萝卜汤','soup',30,'玉米 | 1根\n胡萝卜 | 1根\n盐 | 适量','玉米洗净切段，胡萝卜去皮切块。\n放入锅中加水，煮沸后转小火。\n煮至玉米和胡萝卜熟透，少量盐调味。'),
    dish('seaweed','紫菜蛋花汤','soup',10,'紫菜 | 5克\n鸡蛋 | 2个\n盐 | 适量','按包装说明处理紫菜，鸡蛋打散。\n锅中清水煮开，放入紫菜煮熟。\n倒入蛋液，煮至鸡蛋熟透，加盐。'),
    dish('rice','白米饭','rice',25,'大米 | 150克','大米淘洗后放入电饭煲。\n按电饭煲说明添加适量水，选择煮饭程序。\n确认米饭煮熟，焖好后食用。'),
    dish('fried-rice','蔬菜鸡蛋炒饭','staple',20,'米饭 | 2人份\n鸡蛋 | 2个\n胡萝卜 | 1根\n小青菜 | 150克\n食用油 | 10毫升\n盐 | 适量','蔬菜洗净切碎，鸡蛋打散；米饭使用新煮或妥善冷藏的饭。\n热油炒熟鸡蛋，加入蔬菜炒至熟透。\n加入米饭翻炒至整体充分加热，加盐调味。'),
    dish('tomato-noodle','番茄鸡蛋面','staple',20,'面条 | 200克\n番茄 | 2个\n鸡蛋 | 2个\n食用油 | 10毫升\n盐 | 适量','番茄洗净切块，鸡蛋打散。\n热油炒熟鸡蛋，加入番茄炒软，加清水煮开。\n加入面条煮至面条与食材全部熟透，加盐。'),
    dish('mushroom-noodle','菌菇青菜面','staple',15,'面条 | 200克\n鲜香菇 | 5个\n小青菜 | 200克\n食用油 | 10毫升\n盐 | 适量','香菇洗净切片，青菜洗净。\n少量油炒香菇，加水煮开。\n加入面条与青菜，煮至全部熟透后加盐。'),
    dish('chicken-rice','鸡肉蔬菜盖饭','staple',30,'米饭 | 2人份\n鸡肉 | 250克\n胡萝卜 | 1根\n洋葱 | 1个\n生抽 | 10毫升\n食用油 | 10毫升','蔬菜切丁，鸡肉切小块，生熟食材分开处理。\n热油炒鸡肉，加蔬菜、生抽和少量水煮至鸡肉完全熟透。\n米饭充分加热，将鸡肉蔬菜铺在饭上。'),
    dish('beef-noodle','青菜牛肉面','staple',25,'面条 | 200克\n牛肉 | 200克\n小青菜 | 150克\n盐 | 适量','牛肉切薄片，青菜充分洗净。\n清水煮开，加入面条和牛肉。\n煮至肉和面熟透，放入青菜煮熟，加盐调味。'),
    dish('spicy-noodle','香辣蔬菜拌面','staple',20,'面条 | 200克\n小青菜 | 200克\n辣椒 | 1个\n生抽 | 10毫升\n食用油 | 10毫升','青菜与辣椒洗净，辣椒切碎。\n面条和青菜分别煮熟、沥干。\n少量油炒熟辣椒，加入面条、青菜和生抽充分炒热。',true),
    dish('pumpkin','南瓜小米粥','breakfast',35,'南瓜 | 200克\n小米 | 80克','南瓜去皮去籽切小块，小米淘洗。\n加足量清水煮开，转小火。\n搅拌防粘，煮至米粒和南瓜软熟。'),
    dish('toast','鸡蛋吐司','breakfast',10,'吐司 | 4片\n鸡蛋 | 2个\n食用油 | 10毫升','少量油将鸡蛋煎至蛋白蛋黄均熟。\n吐司加热或烘烤。\n将熟鸡蛋夹入吐司，及时食用。'),
    dish('oat','牛奶燕麦碗','breakfast',10,'燕麦片 | 80克\n牛奶 | 400毫升\n香蕉 | 1根','燕麦与牛奶放入锅中，按燕麦包装说明煮熟。\n香蕉去皮切片。\n盛出燕麦，放上香蕉，稍凉后食用。'),
    dish('egg-cake','葱香鸡蛋饼','breakfast',20,'面粉 | 100克\n鸡蛋 | 2个\n葱 | 1根\n盐 | 适量\n食用油 | 10毫升','面粉、鸡蛋与水搅成流动面糊，加入洗净葱花和盐。\n平底锅少量油，薄薄摊开面糊。\n两面煎熟，确认中心熟透。'),
    dish('sweet-potato','蒸红薯','breakfast',35,'红薯 | 2个','红薯洗净，切成大小接近的块。\n放入蒸锅，水沸后蒸至中心软熟。\n用筷子检查是否熟透，稍凉后食用。'),
    dish('soy-oat','豆浆燕麦粥','breakfast',15,'燕麦片 | 80克\n熟豆浆 | 400毫升','使用已经煮熟的豆浆，按包装说明加热。\n加入燕麦，按燕麦包装要求煮熟。\n搅拌防粘，稍凉后食用，不使用未煮熟生豆浆。')
  ];
  const patterns={egg:/鸡蛋|蛋液/,milk:/牛奶|奶酪|黄油|酸奶/,seafood:/鱼|虾|蟹|贝|紫菜/,soy:/豆腐|豆浆|豆瓣|生抽|酱油/,wheat:/面粉|面条|吐司|生抽|酱油|燕麦/,peanut:/花生/};
  const aliases=text=>C.key(text).replace(/西红柿/g,'番茄').replace(/马铃薯/g,'土豆');
  function allowed(row,p){const text=row.ingredients.map(i=>i.name).join(' ');return !(p.vegetarian&&/猪肉|鸡肉|牛肉|鱼肉|虾仁/.test(text))&&!(p.flavor==='mild'&&row.spicy)&&!(p.avoid||[]).some(tag=>patterns[tag]?.test(text))&&!(p.exclude||[]).some(name=>aliases(name)&&aliases(text).includes(aliases(name)));}
  function scale(row,people){const copy=JSON.parse(JSON.stringify(row)),factor=people/row.servings;copy.servings=people;copy.ingredients=copy.ingredients.map(i=>{const m=i.quantity.match(/^(\d+(?:\.\d+)?)(克|毫升|个|根|片|人份)$/);if(!m)return i;const n=Number(m[1])*factor,value=['个','根','片'].includes(m[2])?Math.ceil(n):Math.round(n*10)/10;return {...i,quantity:value+m[2]};});return copy;}
  function recommend(p={},current=[],random=Math.random){
    const people=Number(p.people)||1,limit=Number(p.minutes)||60;if(!Number.isInteger(people)||people<1||people>6)throw Error('人数范围为 1–6 人。');
    const roles=p.slot==='breakfast'?['breakfast']:p.mode==='family'?['protein','protein','veg','soup','rice']:p.mode==='pair'?['protein','veg','rice']:['staple'];
    const pool=catalog.filter(r=>allowed(r,p)),have=new Set((p.have||[]).map(aliases)),previous=new Set(current.map(r=>r.id));
    const locks=current.filter(r=>(p.locks||[]).includes(r.id));if(locks.some(r=>!pool.some(x=>x.id===r.id)))throw Error('锁定菜品不符合新条件，请先解锁。');
    const remaining=[...roles];for(const row of locks){const i=remaining.indexOf(row.role);if(i<0)throw Error('餐型已变化，请先解锁菜品。');remaining.splice(i,1);}
    const chosen=[...locks],lockedTime=locks.reduce((n,r)=>n+r.minutes,0);if(lockedTime>limit)throw Error('锁定菜品已经超过时间上限。');
    // Bounded backtracking finds a valid full combination; never silently ignores an exclusion.
    let visits=0;function search(index,total){if(index===remaining.length)return p.flavor!=='spicy'||p.slot==='breakfast'||chosen.some(r=>r.spicy);if(++visits>12000)return false;const role=remaining[index];const ranked=pool.filter(r=>r.role===role&&!chosen.some(c=>c.id===r.id)&&total+r.minutes<=limit).map(row=>({row,score:random()+row.ingredients.filter(i=>have.has(aliases(i.name))).length*.2+(p.flavor==='spicy'&&row.spicy?.6:0)-(previous.has(row.id)?1:0)})).sort((a,b)=>b.score-a.score);
      for(const {row} of ranked){chosen.push(scale(row,people));if(search(index+1,total+row.minutes))return true;chosen.pop();}return false;}
    if(!search(0,lockedTime))throw Error('没有符合全部条件的完整搭配。可增加时间、调整餐型或减少排除项；系统不会自动放宽忌口。');
    return chosen.map(r=>scale(r,people));
  }
  const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  window.DaynestMealDiscovery=Object.freeze({catalog,allowed,scale,recommend,aliases,patterns,validDay});
})();
