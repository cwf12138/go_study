(() => {
  'use strict';
  function fitImage(width,height,edge){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>24000000)throw Error('图片尺寸过大，请选择不超过 2400 万像素的图片。');
    if(![640,1280,1920,2560,3840].includes(Number(edge)))throw Error('请选择有效的最大边长。');
    const scale=Math.min(1,Number(edge)/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
  }
  function fileBase(name){return String(name||'图片').replace(/\.[^.]*$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)||'图片';}
  const audioExtension=type=>type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
  window.DaynestPocket=Object.freeze({fitImage,fileBase,audioExtension});
})();
