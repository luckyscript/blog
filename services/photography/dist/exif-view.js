'use strict';
window.renderExif=function(target,info,{demo=false}={}){
 if(!target)return;
 target.replaceChildren();
 const heading=document.createElement('h3');heading.textContent='拍摄信息';target.append(heading);
 const note=document.createElement('p');note.className='exif-note';
 if(demo||!info?.available){note.textContent=demo?'示意作品，未提供原始 EXIF。':'未读取到拍摄参数，照片可能未包含 EXIF，或已在导出时移除。';target.append(note);return;}
 const grid=document.createElement('dl');grid.className='exif-fields';
 for(const field of info.fields){
  const pair=document.createElement('div');pair.dataset.exifField=field.key;
  const term=document.createElement('dt');term.textContent=field.label;
  const value=document.createElement('dd');value.textContent=field.value||'未记录';if(!field.value)value.className='exif-missing';
  pair.append(term,value);grid.append(pair);
 }
 target.append(grid);
 note.textContent='来自照片原始 EXIF';target.append(note);
};
