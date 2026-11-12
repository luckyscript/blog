'use strict';
window.createNasReview=function({root,onImport}){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dialog=document.getElementById('nas-preview-dialog');
 const fullImage=dialog.querySelector('img');
 const stage=dialog.querySelector('.nas-preview-stage');
 const message=dialog.querySelector('.nas-preview-message');
 const chosen=dialog.querySelector('[data-preview-selected]');
 const exifPanel=dialog.querySelector('[data-preview-exif]');
 const selected=new Set(),controllers=new Set(),objectUrls=new Set();
 let scan=null,shown=0,index=0,generation=0,largeGeneration=0,largeController=null,largeUrl=null,observer=null,lastFocus=null;
 let waiting=[],loading=0,submitting=false;
 const pageSize=48;
 const fileSize=bytes=>bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
 function previewUrl(file,size){return '/api/admin/nas/preview?'+new URLSearchParams({scanId:scan.id,key:file.key,size});}
 async function getImage(file,size,signal){
  const response=await fetch(previewUrl(file,size),{credentials:'same-origin',signal});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'预览暂时无法加载，请重试。');}
  return URL.createObjectURL(await response.blob());
 }
 async function showExif(file,request,signal){
  exifPanel.innerHTML='<h3>拍摄信息</h3><p class="exif-note">正在读取 EXIF…</p>';
  try{
   const response=await fetch('/api/admin/nas/exif?'+new URLSearchParams({scanId:scan.id,key:file.key}),{credentials:'same-origin',signal});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'暂时无法读取拍摄信息。');
   if(request!==largeGeneration||!dialog.open)return;
   window.renderExif(exifPanel,data);
  }catch(error){
   if(error.name==='AbortError'||request!==largeGeneration||!dialog.open)return;
   exifPanel.innerHTML=`<h3>拍摄信息</h3><p class="exif-note">${escape(error.message)}</p><button class="exif-retry" type="button" data-exif-retry>重试读取 EXIF</button>`;
  }
 }
 function updateSelection(){
  root.querySelectorAll('[data-nas-select]').forEach(input=>{const active=selected.has(input.value);input.checked=active;input.closest('.nas-photo-card').classList.toggle('selected',active);});
  const count=root.querySelector('[data-nas-count]');if(count)count.textContent=`已选 ${selected.size} / ${scan.files.length} 张`;
  const all=root.querySelector('[data-nas-all]');if(all)all.textContent=selected.size===scan.files.length?'取消全选':'全选照片';
  const submit=root.querySelector('[data-nas-import]');if(submit)submit.disabled=submitting||selected.size===0;
  if(scan&&dialog.open){chosen.checked=selected.has(scan.files[index].key);dialog.querySelector('[data-preview-selection-count]').textContent=`已选 ${selected.size} 张`;}
 }
 function setSelected(key,value){if(value)selected.add(key);else selected.delete(key);updateSelection();}
 function tile(file,i){return `<article class="nas-photo-card${selected.has(file.key)?' selected':''}" data-nas-card="${escape(file.key)}"><button type="button" class="nas-photo-open" data-nas-open="${i}" aria-label="放大预览：${escape(file.name)}"><img data-nas-thumb="${escape(file.key)}" alt="${escape(file.name)}" decoding="async"><span class="nas-thumb-status">正在加载预览…</span><span class="nas-enlarge">查看大图</span></button><div class="nas-photo-details"><label class="nas-photo-choice"><input type="checkbox" data-nas-select value="${escape(file.key)}" aria-label="选择 ${escape(file.name)}" ${selected.has(file.key)?'checked':''}><span title="${escape(file.name)}">${escape(file.name)}</span></label><p title="${escape(file.relative)}">${escape(file.relative)}</p><div class="nas-photo-meta"><span>${fileSize(file.bytes)}</span><button type="button" class="nas-thumb-retry" data-nas-retry="${escape(file.key)}" hidden>重试预览</button></div></div></article>`;}
 function enqueue(image){if(image.dataset.queued)return;image.dataset.queued='1';waiting.push({image,file:scan.files.find(f=>f.key===image.dataset.nasThumb),generation});pump();}
 function pump(){
  while(loading<3&&waiting.length){
   const task=waiting.shift();if(task.generation!==generation||!task.image.isConnected)continue;
   const controller=new AbortController();controllers.add(controller);loading++;
   getImage(task.file,'thumb',controller.signal).then(url=>{
    if(task.generation!==generation||!task.image.isConnected){URL.revokeObjectURL(url);return;}
    objectUrls.add(url);task.image.src=url;task.image.closest('.nas-photo-card').classList.add('preview-ready');
   }).catch(error=>{
    if(error.name==='AbortError'||task.generation!==generation||!task.image.isConnected)return;
    const card=task.image.closest('.nas-photo-card');card.classList.add('preview-error');card.querySelector('.nas-thumb-status').textContent='预览暂不可用';card.querySelector('.nas-thumb-status').title=error.message;card.querySelector('.nas-thumb-retry').hidden=false;
   }).finally(()=>{controllers.delete(controller);loading--;pump();});
  }
 }
 function append(){
  const end=Math.min(shown+pageSize,scan.files.length),grid=root.querySelector('.nas-photo-grid');
  grid.insertAdjacentHTML('beforeend',scan.files.slice(shown,end).map((f,i)=>tile(f,shown+i)).join(''));shown=end;
  grid.querySelectorAll('img[data-nas-thumb]:not([data-observed])').forEach(img=>{img.dataset.observed='1';if(observer)observer.observe(img);else enqueue(img);});
  root.querySelector('[data-nas-shown]').textContent=`已显示 ${shown} / ${scan.files.length} 张`;
  root.querySelector('[data-nas-more]').hidden=shown>=scan.files.length;
 }
 function closePreview(){if(dialog.open)dialog.close();}
 function clear(){
  generation++;closePreview();observer?.disconnect();observer=null;waiting=[];controllers.forEach(c=>c.abort());objectUrls.forEach(url=>URL.revokeObjectURL(url));objectUrls.clear();selected.clear();scan=null;shown=0;root.innerHTML='';
 }
 function setScan(value){
  clear();scan=value;
  if(!scan.files.length){root.innerHTML=scan.truncated?'<div class="empty"><h3>扫描尚未覆盖全部照片</h3><p>目录层级或扫描范围已达到上限，请进入更具体的子文件夹后重新扫描。</p></div>':'<div class="empty"><h3>没有可预览的照片</h3><p>当前文件夹没有 JPEG / PNG / HEIC 成品照片。</p></div>';return;}
  root.innerHTML=`<div class="nas-selection-bar"><div><h3>${scan.files.length} 张照片</h3><span data-nas-count aria-live="polite">已选 0 / ${scan.files.length} 张</span></div><div class="nas-selection-actions"><button type="button" data-nas-all>全选照片</button><button type="button" data-nas-import class="primary" disabled>导入选中的照片</button></div></div><p class="muted nas-review-note">点击画面查看大图与 EXIF，勾选照片后导入。${scan.skipped?`已跳过 ${scan.skipped} 个不支持或过大的文件。`:''}${scan.truncated?'本次扫描已达到上限，请选择更具体的文件夹继续。':''}</p><p class="error" data-nas-error role="alert" hidden></p><div class="nas-photo-grid"></div><div class="list-foot"><span data-nas-shown></span><button type="button" data-nas-more>加载更多照片</button></div>`;
  if('IntersectionObserver' in window)observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);enqueue(entry.target);}}),{rootMargin:'200px'});
  append();
 }
 function stopLarge(){largeGeneration++;largeController?.abort();largeController=null;fullImage.removeAttribute('src');if(largeUrl)URL.revokeObjectURL(largeUrl);largeUrl=null;}
 async function showLarge(i){
  if(!scan)return;stopLarge();index=i;const request=largeGeneration,file=scan.files[index];
  fullImage.hidden=true;stage.classList.add('loading');message.hidden=false;message.querySelector('p').textContent='正在加载大图…';message.querySelector('button').hidden=true;
  dialog.querySelector('[data-preview-title]').textContent=file.name;dialog.querySelector('[data-preview-path]').textContent=file.relative;
  dialog.querySelector('[data-preview-number]').textContent=`${index+1} / ${scan.files.length}`;
  dialog.querySelector('[data-preview-previous]').disabled=index===0;dialog.querySelector('[data-preview-next]').disabled=index===scan.files.length-1;
  fullImage.alt=file.name;updateSelection();
  largeController=new AbortController();
  showExif(file,request,largeController.signal);
  try{
   const url=await getImage(file,'large',largeController.signal);
   if(request!==largeGeneration||!dialog.open){URL.revokeObjectURL(url);return;}
   largeUrl=url;fullImage.src=url;
   await fullImage.decode();if(request!==largeGeneration)return;
   fullImage.hidden=false;message.hidden=true;stage.classList.remove('loading');
  }catch(error){if(error.name==='AbortError'||request!==largeGeneration||!dialog.open)return;message.querySelector('p').textContent=error.message;message.querySelector('button').hidden=false;stage.classList.remove('loading');}
 }
 function openPreview(i,button){lastFocus=button;index=i;dialog.showModal();showLarge(i);dialog.querySelector('[data-preview-close]').focus();}
 root.addEventListener('change',event=>{if(event.target.matches('[data-nas-select]'))setSelected(event.target.value,event.target.checked);});
 root.addEventListener('click',async event=>{
  const open=event.target.closest('[data-nas-open]'),retry=event.target.closest('[data-nas-retry]');
  if(open)return openPreview(Number(open.dataset.nasOpen),open);
  if(retry){const card=retry.closest('.nas-photo-card'),img=card.querySelector('img');card.classList.remove('preview-error');card.querySelector('.nas-thumb-status').textContent='正在加载预览…';retry.hidden=true;delete img.dataset.queued;enqueue(img);return;}
  if(event.target.closest('[data-nas-more]'))return append();
  if(event.target.closest('[data-nas-all]')){if(selected.size===scan.files.length)selected.clear();else scan.files.forEach(file=>selected.add(file.key));updateSelection();return;}
  const submit=event.target.closest('[data-nas-import]');
  if(submit&&!submitting){submitting=true;submit.disabled=true;const error=root.querySelector('[data-nas-error]');error.hidden=true;try{await onImport([...selected]);}catch(e){error.textContent=e.message;error.hidden=false;}finally{submitting=false;if(submit.isConnected)submit.disabled=selected.size===0;}}
 });
 dialog.querySelector('[data-preview-close]').onclick=closePreview;
 dialog.querySelector('[data-preview-previous]').onclick=()=>{if(index>0)showLarge(index-1);};
 dialog.querySelector('[data-preview-next]').onclick=()=>{if(scan&&index<scan.files.length-1)showLarge(index+1);};
 dialog.querySelector('[data-preview-retry]').onclick=()=>showLarge(index);
 exifPanel.addEventListener('click',event=>{if(event.target.closest('[data-exif-retry]')&&scan&&largeController)showExif(scan.files[index],largeGeneration,largeController.signal);});
 chosen.onchange=()=>setSelected(scan.files[index].key,chosen.checked);
 dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'&&index>0){event.preventDefault();showLarge(index-1);}if(event.key==='ArrowRight'&&scan&&index<scan.files.length-1){event.preventDefault();showLarge(index+1);}});
 dialog.addEventListener('close',()=>{stopLarge();if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});});
 return {setScan,clear};
};
