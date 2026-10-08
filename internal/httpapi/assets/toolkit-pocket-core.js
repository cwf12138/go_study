(() => {
  'use strict';
  const DAY=86400000;
  function parseDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('请选择完整日期。');
    const [y,m,d]=value.split('-').map(Number),ms=Date.UTC(y,m-1,d);
    if(y<1900||y>2200||new Date(ms).toISOString().slice(0,10)!==value)throw Error('日期须有效，范围为 1900–2200 年。');
    return ms;
  }
  function dateSpan(start,end,inclusive=false){
    const a=parseDate(start),b=parseDate(end),signed=Math.round((b-a)/DAY),days=Math.abs(signed)+(inclusive?1:0);
    const first=Math.min(a,b)+(inclusive?0:DAY),weeks=Math.floor(days/7);let weekdays=weeks*5;
    for(let i=0;i<days%7;i++){const day=new Date(first+(weeks*7+i)*DAY).getUTCDay();if(day!==0&&day!==6)weekdays++;}
    return {signed,days,weekdays,weeks:Math.floor(days/7),remainder:days%7};
  }
  function shiftDate(start,offset){
    if(String(offset).trim()===''||!Number.isInteger(Number(offset))||Math.abs(Number(offset))>36500)throw Error('天数须为 -36500 至 36500 的整数。');
    const result=new Date(parseDate(start)+Number(offset)*DAY).toISOString().slice(0,10);parseDate(result);return result;
  }
  function fitImage(width,height,edge){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>24000000)throw Error('图片尺寸过大，请选择不超过 2400 万像素的图片。');
    if(![640,1280,1920,2560,3840].includes(Number(edge)))throw Error('请选择有效的最大边长。');
    const scale=Math.min(1,Number(edge)/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
  }
  function fileBase(name){return String(name||'图片').replace(/\.[^.]*$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)||'图片';}
  const audioExtension=type=>type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
  window.DaynestPocket=Object.freeze({parseDate,dateSpan,shiftDate,fitImage,fileBase,audioExtension});
})();
