'use strict';

let photos = window.PORTFOLIO_PHOTOS;
const backend = !!window.PORTFOLIO_BACKEND;
const albums = window.PORTFOLIO_ALBUMS;
const C = window.PortfolioCatalog;
const assetRoot = document.querySelector('.photography-workspace').dataset.root || '';
const page = document.querySelector('.photography-workspace').dataset.page;
const e = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const two = value => String(value).padStart(2, '0');

// Pan only the part of a wide cover that object-fit has cropped away.
// Keeping the image inside its cover box avoids exposing empty edges.
(() => {
  const hero=document.querySelector('.home-hero');
  const image=hero?.querySelector('img.hero-image');
  if(!image||hero.classList.contains('hero-carousel'))return;
  const mouse=matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const originalPosition=image.style.objectPosition;
  let enabled=false,frame=0,lastTime=0,baseX=50,currentX=50,targetX=50,vertical='50%';
  function reset(){
    cancelAnimationFrame(frame);frame=0;lastTime=0;
    image.style.objectPosition=originalPosition;
  }
  function update(){
    reset();
    const position=getComputedStyle(image).objectPosition.split(' ');
    baseX=currentX=targetX=Number.parseFloat(position[0])||0;
    vertical=position[1]||'50%';
    const width=image.clientWidth,height=image.clientHeight;
    const scale=Math.max(width/image.naturalWidth,height/image.naturalHeight);
    enabled=hero.dataset.pan!=='false'&&mouse.matches&&!reducedMotion.matches&&image.naturalWidth>0&&image.naturalWidth*scale-width>2;
  }
  function animate(time){
    const elapsed=lastTime?Math.min(time-lastTime,64):16;
    lastTime=time;
    currentX+=(targetX-currentX)*(1-Math.exp(-elapsed/150));
    if(Math.abs(targetX-currentX)<0.05)currentX=targetX;
    image.style.objectPosition=`${currentX}% ${vertical}`;
    if(currentX!==targetX)frame=requestAnimationFrame(animate);
    else{frame=0;lastTime=0;if(targetX===baseX)image.style.objectPosition=originalPosition;}
  }
  function moveTo(value){targetX=value;if(!frame)frame=requestAnimationFrame(animate);}
  function follow(event){
    if(!enabled||event.pointerType!=='mouse')return;
    const rect=hero.getBoundingClientRect();
    moveTo(Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)));
  }
  hero.addEventListener('pointerenter',follow);
  hero.addEventListener('pointermove',follow,{passive:true});
  hero.addEventListener('pointerleave',()=>{if(enabled)moveTo(baseX);});
  hero.addEventListener('pointercancel',()=>{if(enabled)moveTo(baseX);});
  image.addEventListener('load',update);
  image.addEventListener('error',()=>{enabled=false;reset();});
  mouse.addEventListener('change',update);
  reducedMotion.addEventListener('change',update);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)update();});
  if('ResizeObserver' in window)new ResizeObserver(update).observe(hero);
  else window.addEventListener('resize',update,{passive:true});
  update();
})();

// Static pages render useful content before JavaScript runs. Only archive controls
// update the result region; every other page is ordinary navigable HTML.
function archivePhoto(photo) {
 const sources=photo.srcset?.map(v=>`${assetRoot}${e(v.src)} ${v.width}w`).join(',');
 return `<article class="photo-card archive-photo${photo.width/photo.height>=2.1?' panoramic':''}"><button class="photo-button" data-photo="${photo.id}" aria-label="查看作品：${e(photo.title)}"><span class="photo-frame"><img src="${assetRoot}${e(photo.src)}" ${sources?`srcset="${sources}" sizes="${photo.width/photo.height>=2.1?'90vw':'(max-width:700px) 90vw, (max-width:1499px) 43vw, 30vw'}"`:''} alt="${e(photo.description||photo.title)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></span><span class="photo-label"><span><span class="photo-title">${e(photo.title)}</span><span class="photo-subtitle">${photo.date?photo.date.replaceAll('-','.'):'日期待补'}${photo.dateIsExample?' · 示例':''}</span></span><span class="photo-category">${e(photo.categoryLabel)}</span></span></button></article>`;
}
let archiveState=C.parseArchiveState(location.search,photos,backend);
let archivePage=1,archiveTotal=photos.length,archiveRequest=0,archiveHasMore=false,facetRequest=0;
function archiveParams(pageNumber){const {year,month,category,order}=archiveState;return new URLSearchParams({year,month,category,order,page:pageNumber,limit:36});}
function syncArchiveControls(){
 document.querySelectorAll('[data-year],[data-view]').forEach(button=>{const active=button.dataset.year?button.dataset.year===archiveState.year:button.dataset.view===archiveState.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 for(const [id,key]of [['month-filter','month'],['category-filter','category'],['order-filter','order']]){const input=document.getElementById(id);if(input&&document.activeElement!==input)input.value=archiveState[key];}
 document.querySelector('#reset-filters').hidden=archiveState.year==='all'&&archiveState.month==='all'&&archiveState.category==='all';
}
function drawArchive(items,total){
 const results=document.querySelector('#archive-results');syncArchiveControls();
 document.querySelector('#archive-result-count').textContent=`${archiveState.year==='all'&&archiveState.month==='all'&&archiveState.category==='all'?'全部作品':'符合条件'} · ${total} 幅作品`;
 if(!items.length)results.innerHTML='<div class="archive-empty"><span>00</span><h2>这一页，暂时留白。</h2><p>试试其他时间或题材。</p><button class="text-link" id="empty-reset">查看全部作品</button></div>';
 else if(archiveState.view==='grid')results.innerHTML=`<div class="archive-grid all-photos-grid">${items.map(archivePhoto).join('')}</div>`;
 else results.innerHTML=C.groupByMonth(items).map(group=>`<section class="timeline-group" aria-label="${group.month} 作品"><div class="timeline-label"><span>${group.month==='unknown'?'日期待补':group.month.slice(0,4)}</span><h2>${group.month==='unknown'?'—':group.month.slice(5)}<small>${group.month==='unknown'?'':'月'}</small></h2></div><div class="archive-grid">${group.photos.map(archivePhoto).join('')}</div></section>`).join('');
 document.querySelector('#archive-more').hidden=!archiveHasMore;document.querySelector('#archive-more').textContent='加载更多作品';
 document.querySelector('#archive-end-label').textContent=`已显示 ${items.length} / ${total} 幅作品`;
}
async function renderArchive(more=false){
 if(!backend){const selected=C.selectPhotos(photos,archiveState);drawArchive(selected,selected.length);return true;}
 const request=++archiveRequest,results=document.querySelector('#archive-results'),moreButton=document.querySelector('#archive-more'),targetPage=more?archivePage+1:1;
 results.setAttribute('aria-busy','true');moreButton.disabled=true;document.querySelector('#archive-result-count').textContent='正在查找作品…';
 try{
  const response=await fetch('/api/photography/photos?'+archiveParams(targetPage));if(!response.ok)throw Error('作品暂时无法加载，请重试。');const data=await response.json();if(request!==archiveRequest)return false;
  archivePage=targetPage;archiveTotal=data.total;archiveHasMore=data.hasMore;photos=more?[...photos,...data.photos.filter(p=>!photos.some(old=>old.id===p.id))]:data.photos;drawArchive(photos,data.total);return true;
 }catch(error){if(request!==archiveRequest)return false;document.querySelector('#archive-result-count').textContent=more?'追加加载失败，已显示的作品仍可浏览':'连接暂时中断';
  if(more){moreButton.hidden=false;moreButton.textContent='重试加载更多';}
  else{results.innerHTML=`<div class="archive-empty"><h2>暂时未能加载作品</h2><p>${e(error.message)}</p><button class="text-link" id="archive-retry">重新加载</button></div>`;moreButton.hidden=true;}return false;
 }finally{if(request===archiveRequest){results.removeAttribute('aria-busy');moreButton.disabled=false;if(moreButton.textContent!=='重试加载更多')moreButton.textContent='加载更多作品';}}
}
async function loadArchiveFacets(){
 if(!backend)return;const request=++facetRequest;
 try{const response=await fetch('/api/photography/archive/facets');if(!response.ok)return;const data=await response.json();if(request!==facetRequest)return;
  const aside=document.querySelector('.archive-sidebar');aside.querySelectorAll('.year-button').forEach(b=>b.remove());
  const buttons=[{year:'all',label:'全部年份',count:data.total},...data.years.map(y=>({...y,label:y.year})),...(data.unknown?[{year:'unknown',label:'日期待补',count:data.unknown}]:[])];
  if(!buttons.some(b=>b.year===archiveState.year))buttons.push({year:archiveState.year,label:archiveState.year==='unknown'?'日期待补':archiveState.year,count:0});
  aside.querySelector('p').insertAdjacentHTML('afterend',buttons.map(y=>`<button data-year="${e(y.year)}" class="year-button" aria-pressed="false">${e(y.label)}<span>${two(y.count)}</span></button>`).join(''));
  syncArchiveControls();
 }catch{}
}
function updateArchive(patch,reset=false){
 const onlyView=!reset&&Object.keys(patch).length===1&&patch.view;
 archiveState=reset?{...archiveState,year:'all',month:'all',category:'all'}:{...archiveState,...patch};
 const query=C.serializeState(archiveState),url=location.pathname+(query?'?'+query:'');if(url!==location.pathname+location.search)history.pushState(null,'',url);
 if(onlyView){drawArchive(backend?photos:C.selectPhotos(photos,archiveState),backend?archiveTotal:C.selectPhotos(photos,archiveState).length);return;}
 renderArchive();
}
if(page==='archive'){
 const query=C.serializeState(archiveState),url=location.pathname+(query?'?'+query:'')+location.hash;
 if(url!==location.pathname+location.search+location.hash)history.replaceState(null,'',url);
 if(!window.PORTFOLIO_ARCHIVE)loadArchiveFacets();document.querySelector('#archive-more').addEventListener('click',()=>renderArchive(true));
 document.querySelector('.archive-layout').addEventListener('click',event=>{const year=event.target.closest('[data-year]'),view=event.target.closest('[data-view]');if(year)updateArchive({year:year.dataset.year});else if(view)updateArchive({view:view.dataset.view});else if(event.target.closest('#archive-retry'))renderArchive();else if(event.target.closest('#reset-filters,#empty-reset'))updateArchive({},true);});
 for(const [id,key]of [['month-filter','month'],['category-filter','category'],['order-filter','order']])document.getElementById(id).addEventListener('change',event=>updateArchive({[key]:event.target.value}));
 window.addEventListener('popstate',()=>{if(lightbox.open)lightbox.close();archiveState=C.parseArchiveState(location.search,photos,backend);loadArchiveFacets();renderArchive();});
 if(window.PORTFOLIO_ARCHIVE&&!location.search){archiveTotal=window.PORTFOLIO_ARCHIVE.total;archiveHasMore=window.PORTFOLIO_ARCHIVE.hasMore;syncArchiveControls();document.querySelector('#archive-more').hidden=!archiveHasMore;}else renderArchive();
}

const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightbox-image');
const previousButton = document.querySelector('.lightbox-prev');
const nextButton = document.querySelector('.lightbox-next');
let currentPhotos = [];
let currentIndex = 0;
let archiveSequence=false,navigatingPhoto=false,lastPhotoId=null,viewerSession=0;
let lastPhotoButton = null;
let lightboxRequest=0;
function loadLightboxImage(photo){
 const request=++lightboxRequest,message=document.querySelector('#lightbox-message'),retry=document.querySelector('#lightbox-retry');
 if(!message||!retry){lightboxImage.src=assetRoot+(photo.largeSrc||photo.src);lightboxImage.hidden=false;return;}
 lightboxImage.hidden=true;message.hidden=false;message.querySelector('p').textContent='正在加载大图…';retry.hidden=true;
 const incoming=new Image();
 incoming.onload=()=>{if(request!==lightboxRequest)return;lightboxImage.src=incoming.src;lightboxImage.hidden=false;message.hidden=true;};
 incoming.onerror=()=>{if(request!==lightboxRequest)return;message.querySelector('p').textContent='大图暂时无法加载，请重试或浏览下一张。';retry.hidden=false;};
 incoming.src=assetRoot+(photo.largeSrc||photo.src);
}
document.querySelector('#lightbox-retry')?.addEventListener('click',()=>loadLightboxImage(currentPhotos[currentIndex]));
function showPhoto(index) {
  if (!currentPhotos.length) return;
  currentIndex = Math.max(0,Math.min(index,currentPhotos.length-1));
  const photo = currentPhotos[currentIndex];
  loadLightboxImage(photo);
  lightboxImage.alt = photo.description||photo.title;
  document.querySelector('#lightbox-title').textContent = photo.title;
  let workLink=document.querySelector('#viewer-work-link');
  if(!workLink){workLink=document.createElement('a');workLink.id='viewer-work-link';workLink.className='viewer-work-link';workLink.textContent='作品独立页 / 分享';document.querySelector('#lightbox-title').parentElement.append(workLink);}
  workLink.href=assetRoot+'works/'+photo.id+'/';workLink.hidden=!backend;
  document.querySelector('#lightbox-category').textContent = `${photo.categoryLabel} / ${photo.subtitle}`;
  document.querySelector('#lightbox-description').textContent = photo.description;document.querySelector('#lightbox-description-full').textContent=photo.description||'';
  document.querySelector('#lightbox-date').textContent = `${(photo.date ? photo.date.replaceAll('-', '.') : '日期待补')} · ${photo.dateIsExample ? '示例日期' : '拍摄日期'}`;
  window.renderExif(document.querySelector('#lightbox-exif'),photo.exifInfo,{demo:photo.isDemo!==false});
  for(const [selector,value] of [['#lightbox-camera',photo.exifInfo?.fields.find(f=>f.key==='camera')?.value],['#lightbox-settings',photo.exifInfo?.summary]]){const element=document.querySelector(selector);element.textContent=value||'';element.hidden=!value;}
  document.querySelector('#lightbox-count').textContent = `${two(currentIndex + 1)} / ${two(archiveSequence?archiveTotal:currentPhotos.length)}`;
  const source = document.querySelector('#lightbox-source');
  source.textContent = `摄影：${photo.author}`;
  if (photo.source) source.href = photo.source; else source.removeAttribute('href');
  document.querySelector('#lightbox-demo').hidden = photo.isDemo === false;
  const collection = albums.find(a => a.slug === document.querySelector('.photography-workspace').dataset.album && a.photos.includes(photo.id)) || albums.find(a => a.photos.includes(photo.id));
  const albumLink = document.querySelector('#lightbox-album');
  albumLink.hidden = !collection;
  if (collection) {
    albumLink.href = `${assetRoot}collections/${collection.slug}/`;
    albumLink.textContent = `所属合集 · ${collection.title}`;
  }
  previousButton.hidden = nextButton.hidden = (archiveSequence?archiveTotal:currentPhotos.length)<2;previousButton.disabled=currentIndex===0;nextButton.disabled=currentIndex===currentPhotos.length-1&&!(archiveSequence&&archiveHasMore);
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-photo]');
  if (!button) return;
  const scope = button.closest('[data-gallery]');
  if (!scope) return;
  currentPhotos = [...scope.querySelectorAll('[data-photo]')].map(item => photos.find(p => p.id === Number(item.dataset.photo))).filter(Boolean);
  viewerSession++;navigatingPhoto=false;archiveSequence=backend&&scope.dataset.gallery==='archive';lastPhotoId=Number(button.dataset.photo);lastPhotoButton = button;
  showPhoto(currentPhotos.findIndex(p => p.id === Number(button.dataset.photo)));
  lightbox.showModal();
  document.body.classList.add('modal-open');
  document.querySelector('#lightbox-close').focus();
});
async function navigatePhoto(direction){
 if(navigatingPhoto||!lightbox.open)return;
 if(direction>0&&currentIndex===currentPhotos.length-1&&archiveSequence&&archiveHasMore){
  navigatingPhoto=true;nextButton.disabled=true;const oldCount=currentPhotos.length,session=viewerSession;
  try{const loaded=await renderArchive(true);if(!lightbox.open||session!==viewerSession)return;if(loaded){currentPhotos=[...photos];if(currentPhotos.length>oldCount)showPhoto(oldCount);else showPhoto(currentIndex);}else{nextButton.disabled=false;document.querySelector('#lightbox-count').textContent='加载失败 · 点击下一张重试';}}
  finally{if(session===viewerSession)navigatingPhoto=false;}
 }else if(currentIndex+direction>=0&&currentIndex+direction<currentPhotos.length)showPhoto(currentIndex+direction);
}
const infoToggle=document.querySelector('#lightbox-info-toggle'),focusToggle=document.querySelector('#lightbox-focus');
function setInformation(open){document.querySelector('#lightbox-info').hidden=!open;lightbox.classList.toggle('information-open',open);infoToggle.setAttribute('aria-expanded',String(open));if(open)setFocus(false);}
function setFocus(active){lightbox.classList.toggle('focus-view',active);focusToggle.setAttribute('aria-pressed',String(active));focusToggle.textContent=active?'退出纯看图':'纯看图';if(active)setInformation(false);}
infoToggle.addEventListener('click',()=>setInformation(infoToggle.getAttribute('aria-expanded')!=='true'));
focusToggle.addEventListener('click',()=>setFocus(!lightbox.classList.contains('focus-view')));
lightbox.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey||event.target.matches('input,textarea,select'))return;if(event.key.toLowerCase()==='i'){event.preventDefault();infoToggle.click();}if(event.key.toLowerCase()==='f'){event.preventDefault();focusToggle.click();}});
document.querySelector('#lightbox-close').addEventListener('click', () => lightbox.close());
previousButton.addEventListener('click', () => navigatePhoto(-1));
nextButton.addEventListener('click', () => navigatePhoto(1));
lightbox.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    navigatePhoto(event.key==='ArrowRight'?1:-1);
  }
});
lightbox.addEventListener('close', () => {
  lightboxRequest++;viewerSession++;navigatingPhoto=false;
  document.body.classList.remove('modal-open');
  const focus=lastPhotoButton?.isConnected?lastPhotoButton:document.querySelector('[data-photo="'+lastPhotoId+'"]');focus?.focus({preventScroll:true});
});
let touchStart = null;
const stage = document.querySelector('.lightbox-stage');
stage.addEventListener('touchstart', event => {
  touchStart = event.touches.length === 1 ? {x:event.touches[0].clientX, y:event.touches[0].clientY} : null;
}, {passive:true});
stage.addEventListener('touchend', event => {
  if (!touchStart || event.changedTouches.length !== 1) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) navigatePhoto(dx<0?1:-1);
  touchStart = null;
}, {passive:true});
stage.addEventListener('touchcancel', () => {touchStart = null;}, {passive:true});

const credits = document.querySelector('#credits');
document.querySelector('#credits-open')?.addEventListener('click', () => {
  credits.showModal();
  document.body.classList.add('modal-open');
});
document.querySelector('#credits-close')?.addEventListener('click', () => credits.close());
credits?.addEventListener('close', () => document.body.classList.remove('modal-open'));
credits?.addEventListener('click', event => {
  if (event.target !== credits) return;
  const rect = credits.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) credits.close();
});


// A published work can be opened directly from its admin confirmation.
(async function openLinkedPhoto(){
 const id=new URLSearchParams(location.search).get('photo');if(!backend||!/^\d+$/.test(id||''))return;
 document.querySelector('#linked-photo-error')?.remove();
 try{const response=await fetch('/api/photography/photos/'+id);if(!response.ok)throw Object.assign(Error(response.status===404?'这张作品暂未发布，或已被撤回。':'暂时无法连接作品库，请重试。'),{status:response.status});const photo=await response.json();archiveSequence=false;currentPhotos=[photo];showPhoto(0);lightbox.showModal();document.body.classList.add('modal-open');document.querySelector('#lightbox-close').focus();}
 catch(error){const message=document.createElement('div');message.id='linked-photo-error';message.className='section-wrap portfolio-empty';message.setAttribute('role','status');const copy=document.createElement('p');copy.textContent=error.status===404?error.message:'暂时无法加载这张作品，请重试。';message.append(copy);if(error.status!==404){const retry=document.createElement('button');retry.className='text-link';retry.textContent='重试看这张作品';retry.onclick=openLinkedPhoto;message.append(retry);}document.querySelector('.photography-workspace').prepend(message);}
})();
