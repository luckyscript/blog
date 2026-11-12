const e=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const two=value=>String(value).padStart(2,'0')

export function selectHeroPhotos(photos,cover) {
  const candidates=[cover,...photos.filter(p=>p.featured).sort((a,b)=>(a.featuredOrder||0)-(b.featuredOrder||0))].filter(Boolean)
  return candidates.filter((photo,index)=>candidates.findIndex(p=>p.id===photo.id)===index)
}

export function heroLayout(photo) {
  const ratio=Number(photo?.width)/Number(photo?.height)
  if(!Number.isFinite(ratio)||ratio<=0)return 'portrait'
  return ratio<1?'portrait':ratio>1.6?'wide':'immersive'
}

export function renderHeroSlides(photos) {
  return `<div class="hero-slides">${photos.map((p,i)=>`<div class="hero-slide${i===0?' is-active':''}" data-layout="${heroLayout(p)}" data-hero-id="${e(p.id)}" data-title="${e(p.title)}" data-demo="${p.isDemo!==false}" role="group" aria-roledescription="幻灯片" aria-label="${i+1} / ${photos.length}：${e(p.title)}" aria-hidden="${i!==0}"><img class="hero-image" ${i===0?'src':'data-src'}="${e(p.largeSrc||p.src)}" alt="${e(p.description||p.title)}" width="${p.width}" height="${p.height}" ${i===0?'fetchpriority="high"':'decoding="async"'}><span class="hero-atmosphere" aria-hidden="true"><img class="hero-backdrop" ${i===0?'src':'data-src'}="${e(p.largeSrc||p.src)}" alt="" decoding="async" fetchpriority="low"></span></div>`).join('')}</div>`
}

export function renderHeroControls(photos) {
  return `<div class="hero-reel-caption"><span class="hero-reel-label">THE SELECTED / 精选放映</span><span class="hero-current-title">${e(photos[0].title)}</span><span class="hero-reel-demo"${photos[0].isDemo===false?' hidden':''}>示意摄影</span></div><div class="hero-reel-controls" hidden><div class="hero-reel-index" aria-hidden="true"><span class="hero-current-index">01</span><span class="hero-reel-divider"></span><span>${two(photos.length)}</span></div><div class="hero-reel-progress" aria-hidden="true"><span></span></div><button type="button" data-hero-prev aria-label="上一幅作品">←</button><button type="button" data-hero-pause aria-label="暂停自动轮播"><span aria-hidden="true">Ⅱ</span></button><button type="button" data-hero-next aria-label="下一幅作品">→</button></div><span class="hero-reel-status" role="status" aria-live="polite" aria-atomic="true"></span>`
}
