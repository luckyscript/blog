'use strict';
window.Studio=(()=>{
 const selected=new Map();let homeSettings=null,coverPhotos=[],previewMode='desktop',featuredPhotos=[],dragIndex=null,restoreId=null,homeDirty=false,orderDirty=false,batchPending=false;
 const refreshSelection=()=>{$$('[data-select-photo]').forEach(i=>i.checked=selected.has(Number(i.dataset.selectPhoto)));batchTools();};
 const bytes=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':(n/1024**2).toFixed(1)+' MB';
 function batchTools(){
  $('#batch-tools').classList.toggle('has-selection',selected.size>0);
  const retained=Object.fromEntries($$('#batch-tools select').map(el=>[el.id,el.value]));
  const hiddenSelected=[...selected.keys()].filter(id=>!state.photos.some(p=>p.id===id)).length;
  $('#batch-tools').innerHTML=`<div class="batch-toolbar"><label class="check"><input id="select-visible" type="checkbox" ${state.photos.length&&state.photos.every(p=>selected.has(p.id))?'checked':''}>选择当前列表</label><strong>${selected.size} 张已选</strong>${!selected.size?'<span class="selection-context">勾选照片，可对比、评分或批量整理</span>':''}${hiddenSelected?`<span class="selection-context">其中 ${hiddenSelected} 张不在当前列表</span>`:""}<button id="compare-selected" ${selected.size!==2?'disabled':''}>并排比较</button><button id="inspect-selected" ${selected.size!==1?'disabled':''}>检查细节</button><button id="pick-selected" ${!selected.size?'disabled':''}>标记入选</button><button id="clear-selected" ${!selected.size?'disabled':''}>清空选择</button></div><div class="batch-toolbar"><select id="batch-category" aria-label="批量题材"><option value="">题材不变</option><option value="landscape">风光山野</option><option value="city">城市漫游</option><option value="daily">日常片刻</option><option value="adventure">户外探索</option></select><select id="batch-rating" aria-label="批量星级"><option value="">星级不变</option><option value="5">★★★★★ · 5 星</option><option value="4">★★★★ · 4 星</option><option value="3">★★★ · 3 星</option><option value="2">★★ · 2 星</option><option value="1">★ · 1 星</option><option value="0">清除评分</option></select><select id="batch-status" aria-label="批量发布状态"><option value="">发布状态不变</option><option value="draft">保存草稿 · 仅自己可见</option><option value="published">发布到作品集</option></select><select id="batch-collection" aria-label="批量加入合集"><option value="">不加入新合集</option>${state.info.collections.map(a=>`<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select><button id="apply-batch" ${!selected.size?'disabled':''}>应用到选中作品</button></div>`;
  for(const [id,value]of Object.entries(retained)){const el=document.getElementById(id);if(el&&[...el.options].some(o=>o.value===value))el.value=value;}
  $('#select-visible').indeterminate=state.photos.some(p=>selected.has(p.id))&&!state.photos.every(p=>selected.has(p.id));
  if(batchPending)$$('#batch-tools button,#batch-tools input,#batch-tools select').forEach(el=>el.disabled=true);
  $('#select-visible').onchange=e=>{state.photos.forEach(p=>e.target.checked?selected.set(p.id,p):selected.delete(p.id));refreshSelection();};
  $('#clear-selected').onclick=()=>{selected.clear();$$('#batch-tools select').forEach(el=>el.value='');refreshSelection();};
  $('#compare-selected').onclick=()=>inspect([...selected.values()]);$('#inspect-selected').onclick=()=>inspect([...selected.values()]);
  $('#pick-selected').onclick=()=>batch({picked:true});
  $('#apply-batch').onclick=()=>{const changes={};if($('#batch-category').value)changes.category=$('#batch-category').value;if($('#batch-rating').value!=='')changes.rating=Number($('#batch-rating').value);if($('#batch-status').value)changes.status=$('#batch-status').value;const album=Number($('#batch-collection').value)||undefined;if(!Object.keys(changes).length&&!album)return notify('请选择需要修改的星级、题材、状态或合集。');batch(changes,album);};
 }
 async function batch(changes,addCollection){
  if(!selected.size||batchPending)return;batchPending=true;$$('#batch-tools button,#batch-tools input,#batch-tools select,[data-select-photo],[data-pick-photo]').forEach(b=>b.disabled=true);
  try{const result=await api('/api/admin/photos/batch',{method:'POST',body:JSON.stringify({photos:[...selected.values()].map(p=>({id:p.id,version:p.version})),changes,addCollection})});selected.clear();$$('#batch-tools select').forEach(el=>el.value='');await loadWorkspace();notify(`${result.photos.length} 张作品已更新${changes.status==='published'?'并发布':changes.status==='draft'?'为草稿，仅自己可见':''}。`);}catch(e){notify(e.message,true);}finally{batchPending=false;$$('[data-select-photo],[data-pick-photo]').forEach(el=>el.disabled=false);batchTools();}
 }
 function renderLibrary(photos){
  photos.forEach(p=>{if(selected.has(p.id))selected.set(p.id,p);});batchTools();
  return photos.map(p=>`<article class="library-card"><div class="library-card-tools"><label class="check"><input type="checkbox" data-select-photo="${p.id}" aria-label="选择 ${esc(p.title)}" ${selected.has(p.id)?'checked':''}>选择</label><button data-pick-photo="${p.id}" aria-pressed="${p.picked}">${p.picked?'★ 已入选':'☆ 入选'}</button></div><button class="photo-tile" data-edit="${p.id}"><img src="/${esc(p.thumbSrc||p.src)}" alt="${esc(p.title)}" loading="lazy" style="object-position:${esc(p.position)}"><div class="tile-copy"><span class="badge ${p.status}">${p.status==='draft'?'草稿 · 仅自己可见':labels[p.status]}</span>${p.featured?`<span class="featured-star">${p.status==='published'?'首页代表作':'发布后展示首页'}</span>`:''}<h3>${esc(p.title)}</h3>${p.rating?`<span class="curation-stars" aria-label="${p.rating} 星">${"★".repeat(p.rating)}<small>${p.rating} / 5</small></span>`:""}<p>${esc(p.date||'日期待补')}${p.isDemo?' · 示意作品':''}</p></div></button></article>`).join('');
 }
 $('#photo-grid').addEventListener('change',e=>{const id=Number(e.target.dataset.selectPhoto);if(!id||batchPending)return;const p=state.photos.find(p=>p.id===id);if(e.target.checked)selected.set(id,p);else selected.delete(id);batchTools();});
 $('#photo-grid').addEventListener('click',async e=>{const b=e.target.closest('[data-pick-photo]');if(!b||batchPending)return;const p=state.photos.find(p=>p.id===Number(b.dataset.pickPhoto));b.disabled=true;try{await api('/api/admin/photos/'+p.id,{method:'PATCH',body:JSON.stringify({version:p.version,picked:!p.picked})});await loadPhotos();}catch(error){notify(error.message,true);b.disabled=false;}});
 function publication(){
  const form=$('#photo-form'),value=form.elements.status.value;
  $('#publication-note').textContent=value==='trash'?'移入回收站后会从前台隐藏，照片文件会保留，可恢复为草稿或重新发布。':value==='published'?`保存后会展示在作品档案${form.elements.featured.checked?'及首页代表作':''}。`:'草稿仅自己可见。设为首页代表作后，仍需要点击“发布作品”。';
  $('#save-draft').textContent=state.edit?.status==='trash'?'恢复为草稿':state.edit?.status==='published'?'撤回为草稿':'保存草稿';
  $('#publish-photo').textContent=value==='trash'?(state.edit?.status==='trash'?'保存修改':'移入回收站'):state.edit?.status==='trash'?'恢复并发布':state.edit?.status==='published'&&value==='published'?'保存修改':'发布作品';
  $('#publish-photo').value=value==='trash'?'trash':'published';
 }
 $('#photo-form').addEventListener('change',publication);
 async function photoOpened(p){
  publication();$('#view-public-photo').hidden=p.status!=='published';$('#view-public-photo').href='/works/'+p.id+'/';
  const panel=$('#version-panel');panel.innerHTML=p.isDemo?'':`<section class="version-panel"><h3>修图版本</h3><p class="muted">替换画面会保留标题、合集与发布状态，旧版本可以切回。</p><label class="file-button">上传新的修图版本<input id="replacement-file" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"></label><p id="version-progress" role="status"></p><div id="version-list">正在读取版本…</div></section>`;
  if(p.isDemo)return;
  $('#replacement-file').onchange=async e=>{
   const file=e.target.files[0];if(!file)return;
   if(formBaselines.get($('#photo-form'))!==formState($('#photo-form'))){e.target.value='';$('#version-progress').textContent='请先保存文字或发布状态的修改，再上传新版本。';return;}
   e.target.disabled=true;$('#version-progress').textContent='正在上传和处理新版本…';
   try{
    const job=await api('/api/admin/uploads?'+new URLSearchParams({name:file.name,photoId:p.id,version:p.version}),{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream'}});
    let finished=false;
    for(let i=0;i<90;i++){
     await new Promise(r=>setTimeout(r,1000));const data=await api('/api/admin/jobs'),row=data.jobs.find(j=>j.id===job.id);
     if(row?.status==='failed')throw Error(row.error);if(row?.status==='ready'){finished=true;break;}
    }
    if(!finished)throw Error('仍在处理中，可在“导入任务”查看结果。');
    if($('#editor').open&&state.edit.id===p.id)await editPhoto(p.id);notify('新修图版本已启用，原版本已保留。');
   }catch(error){if($('#version-progress'))$('#version-progress').textContent=error.message;}finally{if(e.target.isConnected){e.target.disabled=false;e.target.value='';}}
  };
  try{const data=await api('/api/admin/photos/'+p.id+'/versions');if(state.edit.id!==p.id)return;$('#version-list').innerHTML=data.items.map(v=>`<div class="version-row"><img src="${esc(v.src)}" alt=""><div><strong>${esc(v.filename)}</strong><small>${esc(new Date(v.createdAt).toLocaleString('zh-CN',{hour12:false}))}</small></div>${v.current?'<span>当前版本</span>':`<button type="button" data-version="${v.assetId}">切回此版</button>`}</div>`).join('');
   $('#version-list').onclick=async e=>{const b=e.target.closest('[data-version]');if(!b)return;if(formBaselines.get($('#photo-form'))!==formState($('#photo-form')))return notify('请先保存当前编辑。',true);b.disabled=true;try{await api('/api/admin/photos/'+p.id+'/versions',{method:'POST',body:JSON.stringify({version:state.edit.version,assetId:b.dataset.version})});await editPhoto(p.id);notify('已切换修图版本。');}catch(error){notify(error.message,true);b.disabled=false;}};
  }catch(error){if($('#version-list'))$('#version-list').textContent=error.message;}
 }
 async function inspect(photos){
  $('#inspection-body').innerHTML=`<div class="inspection-grid ${photos.length===1?'single':''}">${photos.map(p=>`<section><div class="inspection-tools"><div><h3>${esc(p.title)}</h3>${p.rating?`<span class="curation-stars" aria-label="${p.rating} 星">${"★".repeat(p.rating)}<small>${p.rating} / 5</small></span>`:""}<p>${esc(p.exifInfo?.summary||'未提供拍摄参数')}</p></div><button data-detail="${p.id}">100% 检查</button></div><div class="inspection-viewport"><img src="/${esc(p.largeSrc||p.src)}" alt="${esc(p.title)}"></div><p class="detail-note" role="status">完整画面 · 适应窗口</p></section>`).join('')}</div>`;
  $('#inspection-dialog').showModal();$('#inspection-body').onclick=async e=>{const b=e.target.closest('[data-detail]');if(!b)return;const p=photos.find(p=>p.id===Number(b.dataset.detail)),section=b.closest('section'),view=section.querySelector('.inspection-viewport'),img=view.querySelector('img'),note=section.querySelector('.detail-note');
   if(view.classList.contains('actual')){view.classList.remove('actual');b.textContent='100% 检查';note.textContent='完整画面 · 适应窗口';return;}
   b.disabled=true;note.textContent='正在读取原尺寸画面…';
   const incoming=new Image();
   incoming.onload=()=>{if(!img.isConnected||!$('#inspection-dialog').open)return;if(!incoming.naturalWidth){incoming.onerror();return;}img.src=incoming.src;view.classList.add('actual');b.textContent='适应窗口';b.disabled=false;note.textContent=`${incoming.naturalWidth} × ${incoming.naturalHeight} · 可滚动查看细节`;};
   incoming.onerror=()=>{if(!img.isConnected)return;b.disabled=false;note.textContent='原尺寸加载失败，已保留预览。点击“100% 检查”重试。';};
   incoming.src=p.isDemo?'/'+(p.largeSrc||p.src):`/api/admin/photos/${p.id}/detail?attempt=${Date.now()}`;
  };
 }
 function syncBlocks(){
  state.albumBlocks=(state.albumBlocks||[]).filter(b=>b.type==='text'||state.albumIds.includes(b.photoId));
  const ids=new Set(state.albumBlocks.filter(b=>b.type==='photo').map(b=>b.photoId));state.albumIds.forEach(id=>{if(!ids.has(id))state.albumBlocks.push({type:'photo',photoId:id,span:'half'});});
  state.albumIds=state.albumBlocks.filter(b=>b.type==='photo').map(b=>b.photoId);
 }
 function renderAlbum(cover){
  syncBlocks();$('#album-selected').innerHTML=state.albumBlocks.map((b,i)=>`<div class="album-block" draggable="true" data-block="${i}"><span class="drag-grip" aria-hidden="true">⠿</span>${b.type==='text'?`<label>文字段落<textarea data-block-text="${i}" rows="3" maxlength="1500">${esc(b.text)}</textarea></label>`:`<img src="/${esc(state.albumPhotos.get(b.photoId)?.thumbSrc||state.albumPhotos.get(b.photoId)?.src||'')}" alt=""><strong>${esc(state.albumPhotos.get(b.photoId)?.title||'作品')}</strong><select data-block-span="${i}" aria-label="${esc(state.albumPhotos.get(b.photoId)?.title||'作品')} 的版式"><option value="half" ${b.span==='half'?'selected':''}>半幅并置</option><option value="wide" ${b.span==='wide'?'selected':''}>宽幅整行</option></select>`}<div class="block-buttons"><button type="button" data-block-move="${i}" data-step="-1" ${i===0?'disabled':''} aria-label="上移第 ${i+1} 项">↑</button><button type="button" data-block-move="${i}" data-step="1" ${i===state.albumBlocks.length-1?'disabled':''} aria-label="下移第 ${i+1} 项">↓</button><button type="button" data-block-remove="${i}" aria-label="移除第 ${i+1} 项">×</button></div></div>`).join('')||'<p class="muted">从下方选择照片，也可插入文字。</p>';
  $('#album-cover').innerHTML=state.albumIds.map(id=>`<option value="${id}">${esc(state.albumPhotos.get(id)?.title||'作品')}</option>`).join('');if(state.albumIds.includes(cover))$('#album-cover').value=cover;$$('#album-picker input').forEach(el=>el.checked=state.albumIds.includes(Number(el.value)));
 }
 function albumAction(e){const move=e.target.closest('[data-block-move]'),remove=e.target.closest('[data-block-remove]');if(!move&&!remove)return;const cover=Number($('#album-cover').value);if(move){const i=Number(move.dataset.blockMove),j=i+Number(move.dataset.step);if(j<0||j>=state.albumBlocks.length)return;[state.albumBlocks[i],state.albumBlocks[j]]=[state.albumBlocks[j],state.albumBlocks[i]];}if(remove)state.albumBlocks.splice(Number(remove.dataset.blockRemove),1);state.albumIds=state.albumBlocks.filter(b=>b.type==='photo').map(b=>b.photoId);renderAlbum(cover);}
 $('#add-album-text').onclick=()=>{state.albumBlocks.push({type:'text',text:''});renderAlbum(Number($('#album-cover').value));$('#album-selected textarea:last-of-type')?.focus();};
 $('#album-selected').addEventListener('input',e=>{if(e.target.dataset.blockText!==undefined)state.albumBlocks[Number(e.target.dataset.blockText)].text=e.target.value;});
 $('#album-selected').addEventListener('change',e=>{if(e.target.dataset.blockSpan!==undefined)state.albumBlocks[Number(e.target.dataset.blockSpan)].span=e.target.value;});
 $('#album-selected').addEventListener('dragstart',e=>{const row=e.target.closest('[data-block]');if(!row||e.target.closest('input,textarea,select')){e.preventDefault();return;}dragIndex=Number(row.dataset.block);e.dataTransfer.setData('text/plain',String(dragIndex));});
 $('#album-selected').addEventListener('dragover',e=>{if(e.target.closest('[data-block]'))e.preventDefault();});
 $('#album-selected').addEventListener('drop',e=>{e.preventDefault();const row=e.target.closest('[data-block]');if(row&&dragIndex!==null){const item=state.albumBlocks.splice(dragIndex,1)[0];state.albumBlocks.splice(Number(row.dataset.block),0,item);state.albumIds=state.albumBlocks.filter(b=>b.type==='photo').map(b=>b.photoId);renderAlbum(Number($('#album-cover').value));}dragIndex=null;});
 function pointerSort(root,rowSelector,handleSelector,indexKey,reorder){
  let active=null;
  root.addEventListener('pointerdown',e=>{const handle=e.target.closest(handleSelector),row=handle?.closest(rowSelector);if(!row||e.button!==0)return;e.preventDefault();active={from:Number(row.dataset[indexKey]),x:e.clientX,y:e.clientY};root.setPointerCapture(e.pointerId);row.classList.add('sorting-source');});
  root.addEventListener('pointermove',e=>{if(!active)return;root.querySelectorAll('.sorting-target').forEach(n=>n.classList.remove('sorting-target'));const row=document.elementFromPoint(e.clientX,e.clientY)?.closest(rowSelector);if(row&&root.contains(row))row.classList.add('sorting-target');});
  const finish=(e,cancel=false)=>{if(!active)return;const start=active;active=null;const row=document.elementFromPoint(e.clientX,e.clientY)?.closest(rowSelector);root.querySelectorAll('.sorting-target,.sorting-source').forEach(n=>n.classList.remove('sorting-target','sorting-source'));if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);if(!cancel&&row&&root.contains(row)&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)reorder(start.from,Number(row.dataset[indexKey]));};
  root.addEventListener('pointerup',e=>finish(e));root.addEventListener('pointercancel',e=>finish(e,true));
 }
 pointerSort($('#album-selected'),'[data-block]','.drag-grip','block',(from,to)=>{const cover=Number($('#album-cover').value),item=state.albumBlocks.splice(from,1)[0];state.albumBlocks.splice(to,0,item);state.albumIds=state.albumBlocks.filter(b=>b.type==='photo').map(b=>b.photoId);renderAlbum(cover);});
 const range=(name,label,min,max)=>`<label>${label}<span class="range-value" data-range-value="${name}"></span><input type="range" name="${name}" min="${min}" max="${max}"></label>`;
 async function loadHome(){
  if($('#cover-form')&&(homeDirty||orderDirty))return;
  previewMode='desktop';$('#home').innerHTML='<p class="muted">正在读取首页设置…</p>';
  try{
  homeSettings=await api('/api/admin/studio');
  const data=await api('/api/admin/photos?limit=60');coverPhotos=data.photos;
  if(homeSettings.coverId&&!coverPhotos.some(p=>p.id===homeSettings.coverId))coverPhotos.push(await api('/api/admin/photos/'+homeSettings.coverId));
  if(homeSettings.aboutPhotoId&&!coverPhotos.some(p=>p.id===homeSettings.aboutPhotoId))coverPhotos.push(await api('/api/admin/photos/'+homeSettings.aboutPhotoId));
  featuredPhotos=[];for(let page=1;page<=9;page++){const result=await api('/api/admin/photos?featured=true&limit=60&page='+page);featuredPhotos.push(...result.photos);if(!result.hasMore)break;}
  $('#home').innerHTML=`<form id="cover-form" class="cover-layout"><div class="cover-controls"><h2>封面与个人表达</h2><label class="check"><input name="originalsOnly" type="checkbox">首页只展示我的原作</label><p class="muted">示意作品仍保留在作品库和完整档案中，可自行撤回。</p><label>搜索封面作品<input id="cover-search" type="search" placeholder="输入作品标题"></label><label>封面照片<select name="coverId" id="cover-photo"></select></label><p id="cover-status" class="form-hint"></p><label>首页标题<textarea name="headline" rows="2" maxlength="80"></textarea></label><label>首页引言<textarea name="intro" rows="3" maxlength="300"></textarea></label><label>关于我的摄影<textarea name="about" rows="4" maxlength="3000"></textarea></label><label>标题位置<select name="titleAlign"><option value="left">左侧</option><option value="center">居中</option><option value="right">右侧</option></select></label><p class="form-hint">4:3 和方图横向铺满并延伸至导航背景；宽幅和竖幅保留完整画面。轮播高度根据整组照片自动确定。</p><button class="primary">保存首页设置</button><p class="error" role="alert"></p></div><div class="cover-preview-column"><div class="preview-switch"><button type="button" data-preview-mode="desktop" aria-pressed="true">电脑预览</button><button type="button" data-preview-mode="mobile" aria-pressed="false">手机预览</button><a class="quiet" href="/" target="_blank" rel="noopener">查看当前首页</a></div><p class="form-hint">预览封面比例与导航背景；完整轮播可在首页查看。</p><div id="cover-preview-wrap"><div id="cover-preview" class="cover-canvas"><div class="cover-preview-stage"><div class="cover-preview-header"><span>见山</span><span>作品档案</span></div><div class="cover-preview-image"><img alt="封面完整画面预览"></div></div><div class="cover-copy"><h2></h2><p></p></div></div></div><section class="home-order"><h2>代表作的阅读顺序</h2><p class="muted">拖动或用上下按钮编排。首页先展示封面，再按此顺序轮播已发布的代表作；草稿不参与轮播。</p><div id="home-order-list"></div><button type="button" id="save-home-order">保存代表作顺序</button></section></div></form>`;
  const form=$('#cover-form');
  form.elements.about.closest('label').insertAdjacentHTML('afterend',`<p class="form-hint">写真实的观看与经历，不必使用完整履历；留空时前台仅保留简短导语。</p><label>公开署名<input name="artistName" maxlength="80" placeholder="见山"></label><label>为什么叫「见山」<textarea name="aboutNote" rows="4" maxlength="1500" placeholder="可不填。请用自己的话写下这个名字的来处。"></textarea></label><label>公开联系邮箱<input name="contactEmail" type="email" maxlength="254" placeholder="不填写则不显示联系入口"></label><p class="form-hint">填写后访客可看到此邮箱，用于交流、合作或授权。</p><label>关于页配图<select name="aboutPhotoId"><option value="">使用首页封面或代表作</option>${coverPhotos.map(p=>`<option value="${p.id}">${esc(p.title)}${p.status==='published'?'':' · 未发布，仅后台可选'}</option>`).join('')}</select></label>`);
  for(const [key,value]of Object.entries(homeSettings)){const input=form.elements[key];if(!input)continue;if(input.type==='checkbox')input.checked=value;else input.value=value??'';}
  coverOptions(true);renderHomeOrder();previewCover();pointerSort($('#home-order-list'),'[data-home-index]','.drag-grip','homeIndex',(from,to)=>{const item=featuredPhotos.splice(from,1)[0];featuredPhotos.splice(to,0,item);orderDirty=true;renderHomeOrder();previewCover();});
  form.addEventListener('input',e=>{if(e.target.id!=='cover-search')homeDirty=true;previewCover();});form.addEventListener('change',()=>{homeDirty=true;previewCover();});
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button.primary');button.disabled=true;try{homeSettings=await api('/api/admin/studio',{method:'PATCH',body:JSON.stringify(coverValue())});homeDirty=false;notify('首页设置已保存。');form.querySelector('.error').textContent='';}catch(error){form.querySelector('.error').textContent=error.message;}finally{button.disabled=false;}};
  $$('.preview-switch button').forEach(b=>b.onclick=()=>{previewMode=b.dataset.previewMode;$$('.preview-switch button').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));previewCover();});
  let searchTimer,searchRequest=0;$('#cover-search').oninput=e=>{clearTimeout(searchTimer);const q=e.target.value,request=++searchRequest;searchTimer=setTimeout(async()=>{try{const current=coverPhotos.find(p=>p.id===Number(form.elements.coverId.value)),data=await api('/api/admin/photos?limit=60&q='+encodeURIComponent(q));if(request!==searchRequest)return;coverPhotos=data.photos;if(current&&!coverPhotos.some(p=>p.id===current.id))coverPhotos.unshift(current);coverOptions();previewCover();}catch(error){notify(error.message,true);}},250);};
  $('#save-home-order').onclick=async e=>{if(!featuredPhotos.length)return notify('请先选择首页代表作。');e.target.disabled=true;try{const result=await api('/api/admin/home-order',{method:'POST',body:JSON.stringify({photos:featuredPhotos.map(p=>({id:p.id,version:p.version}))})});featuredPhotos=result.photos;orderDirty=false;renderHomeOrder();notify('代表作顺序已保存。');}catch(error){notify(error.message,true);}finally{e.target.disabled=false;}};
  }catch(error){$('#home').innerHTML=errorBox(error.message)+'<button id="retry-home">重新读取首页设置</button>';$('#retry-home').onclick=()=>loadHome();}
 }
 function coverOptions(initial=false){const value=initial?(homeSettings.coverId||''):$('#cover-photo').value;$('#cover-photo').innerHTML='<option value="">自动使用第一幅代表作</option>'+coverPhotos.map(p=>`<option value="${p.id}">${esc(p.title)}${p.isDemo?' · 示意作品':''}${p.status==='draft'?' · 草稿':''}</option>`).join('');$('#cover-photo').value=value;}
 function coverValue(){const form=$('#cover-form'),data={...homeSettings};for(const key of Object.keys(homeSettings)){const input=form.elements[key];if(!input)continue;data[key]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;}data.coverId=Number(data.coverId)||null;data.aboutPhotoId=Number(data.aboutPhotoId)||null;return data;}
 function previewCover(){
  if(!$('#cover-form'))return;const c=coverValue(),mobile=previewMode==='mobile';let photo=coverPhotos.find(p=>p.id===c.coverId)||featuredPhotos.find(p=>p.status==='published'&&(!c.originalsOnly||!p.isDemo))||coverPhotos.find(p=>p.status==='published'&&(!c.originalsOnly||!p.isDemo));
  $('#cover-status').textContent=photo?.status==='draft'?'这张封面尚为草稿，发布后才会出现在首页。':c.originalsOnly&&photo?.isDemo?'已开启原作模式，这张示意图不会用作正式封面。':photo?'封面：'+photo.title:'还没有可展示的原作。';
  const ratio=p=>Number(p?.width)/Number(p?.height),immersive=p=>ratio(p)>=1&&ratio(p)<=1.6;
  const candidates=[photo,...featuredPhotos.filter(p=>p.status==='published'&&(!c.originalsOnly||!p.isDemo))].filter(Boolean);
  const stageRatio=candidates.reduce((value,p)=>immersive(p)?Math.min(value,ratio(p)):value,4/3);
  const canvas=$('#cover-preview'),width=mobile?390:1062,header=mobile?78:96,height=Math.max(width/stageRatio,header+width*.625),scale=Math.min(1,$('#cover-preview-wrap').clientWidth/width);
  canvas.style.width=width+'px';canvas.style.transform=`scale(${scale})`;canvas.style.marginLeft=Math.max(0,($('#cover-preview-wrap').clientWidth-width*scale)/2)+'px';
  canvas.dataset.layout=immersive(photo)?'immersive':'contained';canvas.style.setProperty('--preview-header',header+'px');canvas.querySelector('.cover-preview-stage').style.height=height+'px';
  const img=canvas.querySelector('img');img.hidden=!photo;if(photo){const src='/'+(photo.largeSrc||photo.src);if(img.getAttribute('src')!==src)img.src=src;}
  const copy=canvas.querySelector('.cover-copy');copy.style.textAlign=c.titleAlign;copy.querySelector('h2').textContent=c.headline;copy.querySelector('h2').style.fontSize=(mobile?Math.min(c.mobileTitleSize,26):Math.min(c.titleSize,32))+'px';copy.querySelector('p').textContent=c.intro;
  $('#cover-preview-wrap').style.height=canvas.offsetHeight*scale+'px';$$('[data-range-value]').forEach(el=>el.textContent=c[el.dataset.rangeValue]);
 }
 new ResizeObserver(()=>{if($('#cover-form'))previewCover();}).observe($('#home'));
 function renderHomeOrder(){
  $('#home-order-list').innerHTML=featuredPhotos.map((p,i)=>`<div class="order-row" draggable="true" data-home-index="${i}"><span class="drag-grip" aria-hidden="true">⠿</span><img src="/${esc(p.thumbSrc||p.src)}" alt=""><strong>${esc(p.title)}<small>${p.status==='published'?'已发布':'草稿 · 发布后展示'}${p.isDemo?' · 示意作品':''}</small></strong><button type="button" data-home-move="${i}" data-step="-1" ${i===0?'disabled':''} aria-label="前移 ${esc(p.title)}">↑</button><button type="button" data-home-move="${i}" data-step="1" ${i===featuredPhotos.length-1?'disabled':''} aria-label="后移 ${esc(p.title)}">↓</button></div>`).join('')||'<p class="muted">在作品编辑中勾选“设为首页代表作”，即可在这里编排。</p>';
  const list=$('#home-order-list');list.onclick=e=>{const b=e.target.closest('[data-home-move]');if(!b)return;const i=Number(b.dataset.homeMove),j=i+Number(b.dataset.step);if(j<0||j>=featuredPhotos.length)return;[featuredPhotos[i],featuredPhotos[j]]=[featuredPhotos[j],featuredPhotos[i]];orderDirty=true;renderHomeOrder();previewCover();};let from=null;list.ondragstart=e=>{const row=e.target.closest('[data-home-index]');if(row){from=Number(row.dataset.homeIndex);e.dataTransfer.setData('text/plain',String(from));}};list.ondragover=e=>e.preventDefault();list.ondrop=e=>{e.preventDefault();const row=e.target.closest('[data-home-index]');if(row&&from!==null){const item=featuredPhotos.splice(from,1)[0];featuredPhotos.splice(Number(row.dataset.homeIndex),0,item);orderDirty=true;renderHomeOrder();previewCover();}from=null;};
 }
 async function loadStorage(){
  $('#storage').innerHTML='<p class="muted">正在统计照片与备份…</p>';try{const data=await api('/api/admin/storage');
  $('#storage').innerHTML=`<div class="storage-stats"><article><span>网站母版</span><strong>${bytes(data.totals.masters)}</strong></article><article><span>展示图片</span><strong>${bytes(data.totals.derivatives)}</strong></article><article><span>历史备份</span><strong>${bytes(data.totals.backups)}</strong></article><article><span>磁盘可用空间</span><strong>${bytes(data.free)}</strong></article></div><div class="storage-heading"><div><h2>作品库备份</h2><p class="muted">包含作品、合集、首页设置、母版与修图版本。NAS 原片仍由 NAS 保存。</p></div><button id="create-backup" class="primary">立即创建备份</button></div><p id="backup-progress" role="status"></p><div class="backup-list">${data.backups.map(b=>`<article><div><strong>${esc(new Date(b.createdAt).toLocaleString('zh-CN',{hour12:false}))}</strong><p>${b.files} 个图片文件 · ${b.id.startsWith('before-restore')?'恢复前自动备份':'完整备份'}</p></div><button data-restore="${esc(b.id)}">恢复此备份</button></article>`).join('')||'<p class="muted">还没有备份。创建第一份可恢复的作品库快照。</p>'}</div>`;
  if(data.driver==='r2'){
   const note=document.createElement('p');note.className='muted';note.textContent='照片存储：Cloudflare R2。母版与展示图片占用云端空间；可用空间和历史备份指本机磁盘。完整备份会从 R2 下载照片，请确保本机空间充足。';$('#storage').prepend(note);
  }
  $('#create-backup').onclick=async e=>{e.target.disabled=true;$('#backup-progress').textContent='正在保存数据库与图片文件，请稍候…';try{await api('/api/admin/backups',{method:'POST'});await loadStorage();notify('备份已完成并校验。');}catch(error){$('#backup-progress').textContent=error.message;e.target.disabled=false;}};
  $$('#storage [data-restore]').forEach(b=>b.onclick=()=>{restoreId=b.dataset.restore;$('#restore-form').reset();$('#restore-form .error').textContent='';$('#restore-dialog').showModal();});
  }catch(error){$('#storage').innerHTML=errorBox(error.message)+'<button id="retry-storage">重新读取存储信息</button>';$('#retry-storage').onclick=()=>loadStorage();}
 }
 $('#restore-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button.primary');button.disabled=true;button.textContent='正在恢复…';try{await api('/api/admin/backups/restore',{method:'POST',body:JSON.stringify({id:restoreId,confirm:e.target.elements.confirm.value})});$('#restore-dialog').close();selected.clear();homeDirty=false;orderDirty=false;$('#home').innerHTML='';state.info=await api('/api/admin/state');await loadStorage();notify('作品库已恢复；恢复前的状态已自动备份。');}catch(error){$('#restore-form .error').textContent=error.message;}finally{button.disabled=false;button.textContent='恢复这个备份';}};
 if(state.info&&state.tab==='library')loadPhotos();
 if(state.info&&state.tab==='home')loadHome().catch(e=>notify(e.message,true));
 if(state.info&&state.tab==='storage')loadStorage().catch(e=>notify(e.message,true));
 window.addEventListener('beforeunload',e=>{if(homeDirty||orderDirty){e.preventDefault();e.returnValue='';}});
 return {renderLibrary,photoOpened,loadHome,loadStorage,renderAlbum,albumAction};
})();
