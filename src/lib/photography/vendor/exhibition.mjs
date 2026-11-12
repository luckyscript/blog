export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const e=escapeHtml
const paragraphs=value=>e(value).split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${p.replaceAll('\n','<br>')}</p>`).join('')

export function socialMetadata({origin,route,title,description,image}) {
  let base
  try {base=new URL(origin);if(!['https:','http:'].includes(base.protocol)||base.username||base.password)return ''}catch{return ''}
  const url=new URL('/'+route,base.origin).href
  let photo=''
  if(image){try{const value=new URL(image,base.origin+'/');if(['https:','http:'].includes(value.protocol)&&!value.username&&!value.password)photo=value.href}catch{}}
  const fullTitle=`${title} · 见山 JIANSHAN`
  return `<link rel="canonical" href="${e(url)}"><meta property="og:type" content="website"><meta property="og:site_name" content="见山 JIANSHAN"><meta property="og:locale" content="zh_CN"><meta property="og:url" content="${e(url)}"><meta property="og:title" content="${e(fullTitle)}"><meta property="og:description" content="${e(description)}"><meta name="twitter:card" content="${photo?'summary_large_image':'summary'}"><meta name="twitter:title" content="${e(fullTitle)}"><meta name="twitter:description" content="${e(description)}">${photo?`<meta property="og:image" content="${e(photo)}"><meta property="og:image:alt" content="${e(title)}"><meta name="twitter:image" content="${e(photo)}">`:''}`
}

export function workPage(photo,{photos,albums}) {
  const series=albums.filter(a=>a.photos.includes(photo.id))
  const sequence=series.length?series[0].photos.map(id=>photos.find(p=>p.id===id)).filter(Boolean):photos
  const index=sequence.findIndex(p=>p.id===photo.id),previous=sequence[index-1],next=sequence[index+1]
  const date=photo.date?.replaceAll('-','.')||''
  const facts=[date,photo.author||'见山'].filter(Boolean).map(e).join(' · ')
  const fields=(photo.exifInfo?.fields||[]).filter(f=>f.value!==null&&f.value!==undefined&&f.value!=='')
  const description=photo.description||[photo.title,date,photo.author||'见山'].filter(Boolean).join(' · ')
  return {page:'work',route:`works/${photo.id}/`,photo,title:photo.title,description,shareImage:photo.shareSrc||photo.largeSrc||photo.src,
    body:`<article class="work-page section-wrap"><nav class="work-breadcrumb" aria-label="作品导航"><a href="../../archive/">作品档案</a>${series[0]?`<span>/</span><a href="../../collections/${e(series[0].slug)}/">${e(series[0].title)}</a>`:''}</nav>
    <figure class="work-figure" data-gallery="work"><button class="photo-button" data-photo="${photo.id}" aria-label="全屏查看：${e(photo.title)}"><img src="../../${e(photo.largeSrc||photo.src)}" alt="${e(photo.title)}" width="${photo.width}" height="${photo.height}" fetchpriority="high"></button><figcaption><span>${e(photo.author||'见山')} ©${photo.date?' '+e(photo.date.slice(0,4)):''}</span></figcaption></figure>
    <div class="work-caption"><div><p class="exhibition-kicker">${facts}${photo.isDemo!==false?' · 示意作品':''}</p><h1>${e(photo.title)}</h1><div class="work-note">${paragraphs(photo.description||'')}</div>${series.length?`<p class="work-series">收录于 ${series.map(a=>`<a href="../../collections/${e(a.slug)}/">${e(a.title)}</a>`).join(' · ')}</p>`:''}</div><div class="work-actions"><button type="button" data-share-work="${photo.id}" data-share-title="${e(photo.title)}">分享这幅作品</button><span data-share-status role="status" aria-live="polite"></span>${fields.length?`<details class="work-exif"><summary>拍摄信息</summary><dl>${fields.map(f=>`<div><dt>${e(f.label)}</dt><dd>${e(f.value)}</dd></div>`).join('')}</dl></details>`:''}</div></div>
    <nav class="work-sequence" aria-label="继续观看">${previous?`<a href="../${previous.id}/"><small>上一幅</small><span>${e(previous.title)}</span></a>`:'<span></span>'}${next?`<a href="../${next.id}/"><small>下一幅</small><span>${e(next.title)}</span></a>`:'<a href="../../collections/"><small>继续阅读</small><span>主题合集</span></a>'}</nav></article>`}
}

export function aboutPage({studio,photos,albums,image}) {
  const selected=photos.find(p=>p.id===studio.aboutPhotoId)||photos.find(p=>p.id===studio.coverId)||photos.find(p=>p.featured)||photos[0]
  return `<section class="artist-page section-wrap"><header class="artist-heading"><h1>${e(studio.artistName||'见山')}<span>摄影作品集</span></h1></header><div class="artist-layout${studio.about||studio.aboutNote||studio.contactEmail?'':' artist-layout-image-only'}"><div class="artist-image">${image(selected,'../')}${selected?`<p>${e(selected.title)}${selected.date?' · '+e(selected.date.replaceAll('-','.')):''}</p>`:''}</div><div class="artist-statement">${paragraphs(studio.about||'')}${studio.aboutNote?`<section class="artist-note"><h2>关于「见山」</h2>${paragraphs(studio.aboutNote)}</section>`:''}${studio.contactEmail?`<a class="artist-contact" href="mailto:${e(studio.contactEmail)}"><small>交流 / 合作 / 作品授权</small><span>${e(studio.contactEmail)}</span></a>`:''}</div></div><nav class="artist-reading" aria-label="从作品认识作者">${albums[0]?`<a href="../collections/${e(albums[0].slug)}/">${e(albums[0].title)}</a>`:'<a href="../archive/">作品档案</a>'}<a href="../equipment/">器物手记</a></nav></section>`
}
