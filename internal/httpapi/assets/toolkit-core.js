(() => {
  'use strict';
  // Small arithmetic parser. Never execute user input as JavaScript.
  function calculate(input,angle='deg') {
    const text=String(input).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/\s/g,'');
    if(!text||text.length>160)throw Error('请输入算式，最多 160 个字符。');
    let i=0;
    const fail=()=>{throw Error('算式不完整，请检查数字、运算符和括号。');};
    function primary(){
      let n;
      if(text[i]==='('){i++;n=expression();if(text[i++]!==')')fail();}
      else if(text[i]==='π'){i++;n=Math.PI;}
      else if(/[a-z]/i.test(text[i]||'')){
        const name=text.slice(i).match(/^[a-z]+/i)[0].toLowerCase();i+=name.length;
        if(name==='pi')n=Math.PI;
        else if(name==='e')n=Math.E;
        else{
          if(!['sin','cos','tan','sqrt','cbrt','log','ln','abs','exp'].includes(name))throw Error('不支持这个函数，请使用科学模式中的按键。');
          if(text[i++]!=='(')fail();const value=expression();if(text[i++]!==')')fail();
          const radians=angle==='rad'?value:value*Math.PI/180;
          if(name==='sqrt'&&value<0)throw Error('实数范围内不能对负数开平方。');
          if((name==='ln'||name==='log')&&value<=0)throw Error('对数的真数必须大于零。');
          if(name==='tan'&&Math.abs(Math.cos(radians))<1e-14)throw Error('这个角度的正切无定义。');
          const functions={sin:()=>Math.sin(radians),cos:()=>Math.cos(radians),tan:()=>Math.tan(radians),sqrt:()=>Math.sqrt(value),cbrt:()=>Math.cbrt(value),log:()=>Math.log10(value),ln:()=>Math.log(value),abs:()=>Math.abs(value),exp:()=>Math.exp(value)};
          n=functions[name]();if(['sin','cos','tan'].includes(name)&&Math.abs(n)<1e-14)n=0;
        }
      }else {const match=text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);if(!match)fail();i+=match[0].length;n=Number(match[0]);}
      while(text[i]==='%'||text[i]==='!'){
        if(text[i++]==='%')n/=100;
        else{if(!Number.isInteger(n)||n<0||n>170)throw Error('阶乘仅支持 0–170 的整数。');let factorial=1;for(let k=2;k<=n;k++)factorial*=k;n=factorial;}
      }
      return n;
    }
    function power(){const n=primary();if(text[i]==='^'){i++;return n**unary();}return n;}
    function unary(){if(text[i]==='+'){i++;return unary();}if(text[i]==='-'){i++;return -unary();}return power();}
    function product(){let n=unary();while(text[i]==='*'||text[i]==='/'){const op=text[i++],rhs=unary();if(op==='/'&&rhs===0)throw Error('不能除以零。');n=op==='*'?n*rhs:n/rhs;}return n;}
    function expression(){let n=product();while(text[i]==='+'||text[i]==='-'){const op=text[i++],rhs=product();n=op==='+'?n+rhs:n-rhs;}return n;}
    const result=expression();if(i!==text.length)fail();if(!Number.isFinite(result))throw Error('结果超出可计算范围。');
    return Number(result.toPrecision(14));
  }
  const units={
    length:{label:'长度',units:{m:['米',1],km:['千米',1000],cm:['厘米',.01],mm:['毫米',.001],inch:['英寸',.0254],foot:['英尺',.3048],mile:['英里',1609.344]}},
    mass:{label:'重量',units:{kg:['千克',1],g:['克',.001],mg:['毫克',.000001],lb:['磅',.45359237],oz:['盎司',.028349523125]}},
    temperature:{label:'温度',units:{c:['摄氏度 °C',1],f:['华氏度 °F',1],k:['开尔文 K',1]}},
    area:{label:'面积',units:{m2:['平方米',1],km2:['平方千米',1000000],ha:['公顷',10000],ft2:['平方英尺',.09290304]}},
    volume:{label:'容量',units:{l:['升',1],ml:['毫升',.001],m3:['立方米',1000]}},
    time:{label:'时间',units:{second:['秒',1],minute:['分钟',60],hour:['小时',3600],day:['天（24 小时）',86400]}}
  };
  function convert(value,category,from,to){
    const n=Number(value),group=units[category]?.units;
    if(String(value).trim()===''||!Number.isFinite(n)||Math.abs(n)>1e15)throw Error('请输入有限数值，绝对值不超过 10¹⁵。');
    if(!group?.[from]||!group?.[to])throw Error('请选择有效单位。');
    let result;
    if(category==='temperature'){
      const kelvin=from==='k'?n:from==='c'?n+273.15:(n-32)*5/9+273.15;
      if(kelvin < -1e-9)throw Error('温度不能低于绝对零度。');
      result=to==='k'?Math.max(0,kelvin):to==='c'?kelvin-273.15:(kelvin-273.15)*9/5+32;
    }else result=n*group[from][1]/group[to][1];
    if(!Number.isFinite(result))throw Error('结果超出范围。');
    return Number(result.toPrecision(12));
  }
  const remaining=(timer,now)=>Math.max(0,timer.running?timer.end-now:timer.remaining);
  const elapsed=(watch,now)=>Math.max(0,watch.elapsed+(watch.running?Math.max(0,now-watch.started):0));
  function duration(ms,hundredths=false){
    const ticks=Math.max(0,Math.floor(ms/(hundredths?10:1000))),seconds=Math.floor(hundredths?ticks/100:ticks);
    const pad=n=>String(n).padStart(2,'0');
    const base=`${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds/60)%60)}:${pad(seconds%60)}`;
    return base+(hundredths?'.'+pad(ticks%100):'');
  }
  const clockZones=['local','Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York'];
  function clockTime(now,zone='local'){
    const timeZone=clockZones.includes(zone)&&zone!=='local'?zone:Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date=new Date(now);
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(date);
    const number=type=>Number(parts.find(p=>p.type===type).value);
    return {hour:number('hour'),minute:number('minute'),second:number('second'),zone:timeZone,date:new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(date)};
  }
  function fresh(){return {calculator:{mode:'basic',angle:'deg'},clock:{zone:'local',hour12:false,seconds:true},history:[],timer:{total:300000,remaining:300000,end:0,running:false,finished:false,label:'',sound:false},watch:{elapsed:0,started:0,running:false,laps:[]}};}
  function restore(raw,now){
    const result=fresh();if(!raw||typeof raw!=='object')return result;
    if(raw.calculator)result.calculator={mode:raw.calculator.mode==='scientific'?'scientific':'basic',angle:raw.calculator.angle==='rad'?'rad':'deg'};
    if(raw.clock)result.clock={zone:clockZones.includes(raw.clock.zone)?raw.clock.zone:'local',hour12:!!raw.clock.hour12,seconds:raw.clock.seconds!==false};
    result.history=Array.isArray(raw.history)?raw.history.filter(h=>typeof h?.expression==='string'&&h.expression.length<=160&&Number.isFinite(h.result)).slice(0,20).map(h=>({expression:h.expression,result:h.result,angle:h.angle==='rad'?'rad':'deg'})):[];
    const t=raw.timer;
    if(t&&Number.isFinite(t.total)&&t.total>=1000&&t.total<=86400000&&Number.isFinite(t.remaining)&&t.remaining>=0&&t.remaining<=t.total&&typeof t.running==='boolean'&&Number.isFinite(t.end)&&t.end>=0&&(!t.running||t.end<=now+86400000)){
      result.timer={total:t.total,remaining:t.remaining,end:t.end,running:t.running,finished:!!t.finished,label:typeof t.label==='string'?t.label.slice(0,40):'',sound:!!t.sound};
      if(t.running&&t.end<=now){result.timer.running=false;result.timer.remaining=0;result.timer.finished=true;}
    }
    const w=raw.watch;
    if(w&&Number.isFinite(w.elapsed)&&w.elapsed>=0&&w.elapsed<=31536000000&&Number.isFinite(w.started)&&w.started>=0&&w.started<=now&&typeof w.running==='boolean'){
      let previous=0;
      const laps=Array.isArray(w.laps)?w.laps.filter(n=>{if(!Number.isFinite(n)||n<previous||n>elapsed(w,now))return false;previous=n;return true;}).slice(0,50):[];
      result.watch={elapsed:w.elapsed,started:w.started,running:w.running,laps};
    }
    return result;
  }
  window.DaynestToolkit=Object.freeze({calculate,units,convert,remaining,elapsed,duration,fresh,restore,clockTime});
})();
