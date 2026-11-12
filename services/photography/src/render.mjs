import {studioDefaults} from '../server/studio-config.mjs';
import {selectHeroPhotos,renderHeroSlides,renderHeroControls,heroLayout} from './hero.mjs'
import {renderEquipmentNotebook} from './equipment-page.mjs'
import {socialMetadata,workPage,aboutPage} from './exhibition.mjs'
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../catalog.cjs');
export function renderSite(data,{origin='',photoId=null}={}) {
const { photos, albums, equipment } = data;
const e = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const two = value => String(value).padStart(2, '0');
const photoById = id => photos.find(photo => photo.id === id) || photos[0];
const backend = !!data.backend;
const studio={...studioDefaults,...(backend?data.studio:{originalsOnly:false,desktopHeight:750})};
const homePhotos=studio.originalsOnly?photos.filter(p=>p.isDemo===false):photos;
const demoPhotos=photos.filter(p=>p.isDemo!==false);
const homeAlbums=studio.originalsOnly?albums.filter(a=>a.photos.some(id=>homePhotos.some(p=>p.id===id))).map(a=>({...a,cover:homePhotos.some(p=>p.id===a.cover)?a.cover:a.photos.find(id=>homePhotos.some(p=>p.id===id))})):albums;
const breaks=value=>e(value).replaceAll('\n','<br>');
const displayDate = p => p.date ? p.date.replaceAll('-', '.') : '日期待补';
const rangeLabel = members => !members.some(p=>p.date)?'拍摄日期待补':members.some(p=>p.dateIsExample)?(members.some(p=>!p.dateIsExample)?'含示例日期':'示例时间'):'拍摄时间';
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const navigation = [['home','', '首页'], ['archive','archive/', '作品档案'], ['collections','collections/', '主题合集'], ['equipment','equipment/', '器物手记'], ['about','about/', '关于']];
const prefix = route => '../'.repeat(route.split('/').filter(Boolean).length);
const image = (p, R, className = '', priority = false) => !p ? `<div class="${className} empty-image" role="img" aria-label="等待第一幅作品"></div>` : `<img class="${className}" src="${R}${e(priority?(p.largeSrc||p.src):p.src)}" alt="${e(p.description||p.title)}" width="${p.width}" height="${p.height}" ${priority ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'} style="object-position:${e(p.position)}">`;
const textLink = (href, text) => `<a class="text-link" href="${href}">${text}</a>`;

function photoCard(p, R, compact = false) {
  return `<article class="photo-card${compact ? ' archive-photo'+(p.width/p.height>=2.1?' panoramic':'') : ''}"><button class="photo-button" data-photo="${p.id}" aria-label="查看作品：${e(p.title)}"><span class="photo-frame">${image(p,R)}</span><span class="photo-label"><span><span class="photo-title">${e(p.title)}</span><span class="photo-subtitle">${compact ? displayDate(p)+(p.dateIsExample ? ' · 示例' : '') : e(p.subtitle)}</span></span><span class="photo-category">${e(p.categoryLabel)}</span></span></button></article>`;
}
function albumCard(album, R) {
  const members = C.albumPhotos(photos, album);
  const range = C.dateRange(members).map(d=>d.replace('-','.')).join(' — ');
  return `<a class="album-card" href="${R}collections/${album.slug}/"><div class="album-cover">${image(photoById(album.cover),R)}</div><div class="album-card-meta"><div><h3>${e(album.title)}</h3>${album.label?`<span>${e(album.label)}</span>`:''}</div><span>${two(members.length)} 幅作品</span></div><p class="album-summary">${e(album.description)}</p><p class="album-range">${range} <span>${rangeLabel(members)}</span></p></a>`;
}
function homeSeriesCard(album) {
  return `<a class="home-series-card" href="collections/${e(album.slug)}/"><div class="home-series-image">${image(photoById(album.cover),'')}</div><div class="home-series-copy"><h3>${e(album.title)}</h3>${album.label?`<p class="home-series-label">${e(album.label)}</p>`:''}</div></a>`
}
function archiveContent(items, R) {
  return C.groupByMonth(items).map(group => `<section class="timeline-group" aria-label="${group.month} 作品"><div class="timeline-label"><span>${(group.month === 'unknown' ? '待补日期' : group.month.slice(0,4))}</span><h2>${(group.month === 'unknown' ? '—' : group.month.slice(5))}<small>${group.month==='unknown'?'':'月'}</small></h2><p>${two(group.photos.length)} 幅作品</p></div><div class="archive-grid">${group.photos.map(p=>photoCard(p,R,true)).join('')}</div></section>`).join('');
}
function dialogs(R) {
  return `<dialog class="lightbox gallery-viewer" id="lightbox" aria-label="作品大图浏览"><div class="lightbox-top"><span class="lightbox-brand">见山 <span>PHOTOGRAPHY</span></span><span id="lightbox-count" aria-live="polite"></span><div class="viewer-tools"><button id="lightbox-info-toggle" aria-expanded="false" aria-controls="lightbox-info">拍摄信息</button><button id="lightbox-focus" aria-pressed="false">纯看图</button><button class="icon-button" id="lightbox-close" aria-label="关闭大图">×</button></div></div><div class="lightbox-stage"><button class="lightbox-prev icon-button" aria-label="上一张">←</button><img id="lightbox-image" alt=""><div id="lightbox-message" class="lightbox-message" role="status" hidden><p>正在加载大图…</p><button id="lightbox-retry" hidden>重新加载</button></div><button class="lightbox-next icon-button" aria-label="下一张">→</button></div><div class="lightbox-bottom"><div><p id="lightbox-category" class="eyebrow light"></p><h2 id="lightbox-title"></h2><p id="lightbox-description"></p><p id="lightbox-date" class="photo-date"></p></div><span class="keyboard-tip">← → 切换 · I 拍摄信息 · F 纯看图 · ESC 关闭</span></div><aside class="lightbox-info" id="lightbox-info" aria-label="作品与拍摄信息" hidden><div class="lightbox-credit"><a id="lightbox-source" target="_blank" rel="noopener noreferrer"></a><span id="lightbox-demo" hidden>示意摄影 · 非本人原作</span><span id="lightbox-camera" class="lightbox-camera" hidden></span><span id="lightbox-settings" class="lightbox-settings" hidden></span><a id="lightbox-album" class="lightbox-album"></a></div><p class="viewer-story" id="lightbox-description-full"></p><section id="lightbox-exif" class="photo-exif" aria-label="照片 EXIF"></section></aside></dialog>
  ${demoPhotos.length?`<dialog id="credits" class="credits-dialog" aria-labelledby="credits-title"><div class="credits-heading"><h2 id="credits-title">示意作品与来源</h2><button id="credits-close" class="icon-button" aria-label="关闭图片来源">×</button></div><p>以下示意作品来自第三方摄影师，并非站点拥有者原作；示例标题与日期不代表真实拍摄资料。</p><div id="credits-list">${demoPhotos.map(p=>`<div class="credit-row"><span>${e(p.title)}</span><a href="${e(p.source)}" target="_blank" rel="noopener noreferrer">${e(p.author)} · Unsplash</a></div>`).join('')}</div><p class="credits-note">图片依据 <a href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">Unsplash License</a> 使用。器材产品图的来源另见器物手记中的署名。</p></dialog>`:''}`;
}
function layout({page, route, title, description, body, slug = '',photo,shareImage}) {
  const R = prefix(route);
  const visiblePhotos = page === 'home' ? homePhotos.filter(p=>p.featured) : page === 'archive' ? C.selectPhotos(photos,C.parseState('',photos)).slice(0,36) : page === 'album' ? C.albumPhotos(photos,albums.find(a=>a.slug===slug)) : page==='work'?[photo]:[];
  const socialPhoto=page==='work'?null:page==='album'?photos.find(p=>p.id===albums.find(a=>a.slug===slug)?.cover):page==='home'?cover:page==='about'?photos.find(p=>p.id===studio.aboutPhotoId)||cover:null;
  const meta=socialMetadata({origin,route,title,description,image:shareImage||socialPhoto?.shareSrc||socialPhoto?.largeSrc||socialPhoto?.src});
  const photoScript = backend ? `<script>window.PORTFOLIO_BACKEND=true;window.PORTFOLIO_PHOTOS=${safeJson(visiblePhotos)};window.PORTFOLIO_ALBUMS=${safeJson(albums)};</script>` : `<script defer src="${R}photos.js"></script>`;
  const nav = navigation.map(([id, url, label]) => `<a class="nav-link${page === id || (page === 'album' && id === 'collections') ? ' active' : ''}" href="${R}${url || './'}"${page === id || (page === 'album' && id === 'collections') ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#15352f"><meta name="description" content="${e(description)}"><title>${e(title)} · 见山 JIANSHAN</title>${meta}<link rel="icon" href="${R}favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${R}styles.css"><link rel="stylesheet" href="${R}pages.css?v=editorial1"><link rel="stylesheet" href="${R}exif.css"><link rel="stylesheet" href="${R}studio.css"><link rel="stylesheet" href="${R}gallery.css">${page==='home'?'<link rel="stylesheet" href="hero-carousel.css?v=softframe1"><script defer src="hero-carousel.js?v=softframe1"></script>':''}${page === 'equipment' ? `<link rel="stylesheet" href="${R}equipment.css?v=notebook1">` : ''}<link rel="stylesheet" href="${R}exhibition.css?v=3">${photoScript}<script defer src="${R}catalog.js?v=archive2"></script><script defer src="${R}exif-view.js"></script><script defer src="${R}app.js?v=quietlinks1"></script><script defer src="${R}share.js?v=1"></script></head>
<body id="top" data-page="${page}" data-root="${R}" data-album="${slug}"><a class="skip-link" href="#main-content">跳到主要内容</a><header class="site-header"><a class="brand" href="${R || './'}" aria-label="见山，返回首页"><span class="brand-mark" aria-hidden="true">见山<span class="brand-dot"></span></span><span class="brand-latin">JIANSHAN<br><span>PHOTOGRAPHY</span></span></a><nav class="desktop-nav" aria-label="主导航">${nav}</nav>${page==='home'?'<a class="mobile-archive-entry" href="archive/" aria-label="直接进入作品档案">作品档案</a>':''}<button class="menu-toggle" aria-label="展开导航" aria-expanded="false" aria-controls="mobile-nav"><span></span><span></span></button></header><nav id="mobile-nav" class="mobile-nav" aria-label="移动端导航" hidden>${nav}</nav>
<main id="main-content">${body}</main>
<footer class="site-footer section-wrap"><span>© ${new Date().getFullYear()} ${e(studio.artistName||'见山')}</span><div class="footer-links">${demoPhotos.length?'<button id="credits-open">示意作品与来源</button>':''}<a class="back-top" href="#top">回到顶部</a></div></footer>${dialogs(R)}</body></html>`;
}

const pages = [];
const featured = homePhotos.filter(p=>p.featured).sort((a,b)=>(a.featuredOrder||0)-(b.featuredOrder||0));
const cover=homePhotos.find(p=>p.id===studio.coverId)||featured[0]||homePhotos[0];
const heroPhotos=selectHeroPhotos(homePhotos,cover)
const carousel=heroPhotos.length>1
const heroVars=`--cover-height:${studio.desktopHeight}px;--cover-mobile-height:${studio.mobileHeight}px;--cover-x:${studio.x}%;--cover-y:${studio.y}%;--cover-mobile-x:${studio.mobileX}%;--cover-mobile-y:${studio.mobileY}%;--cover-title-top:${studio.titleTop}%;--cover-title-size:${studio.titleSize}px;--cover-title-mobile-size:${studio.mobileTitleSize}px;--cover-shade:${studio.shade/100};`;
pages.push({page:'home',route:'',title:studio.headline.replaceAll('\n','')||'摄影作品集',description:studio.intro||'见山摄影作品集。山野之间，日常之中。',body:`
<section class="hero home-hero curated-hero hero-adaptive${carousel?' hero-carousel':''}" data-layout="${cover?heroLayout(cover):'empty'}" data-title-align="${studio.titleAlign}" data-pan="false" style="${heroVars}" aria-label="作品集封面"${carousel?' role="region" aria-roledescription="轮播"':''}>${renderHeroSlides(heroPhotos)}<div class="hero-footer"><div class="hero-content"><h1>${breaks(studio.headline)}</h1><p class="hero-description">${breaks(studio.intro)}</p></div><div class="hero-bottom">${carousel?renderHeroControls(heroPhotos):`<span class="hero-current-title">${cover?e(cover.title):''}</span>${cover && cover.isDemo !== false ? '<span class="hero-demo">封面 · 示意摄影</span>' : ''}`}</div></div></section>

${homeAlbums.length?`<section class="home-collections section-wrap" id="series"><div class="section-heading"><h2>主题合集</h2>${textLink('collections/','全部合集')}</div><div class="home-series-grid">${homeAlbums.map(album=>homeSeriesCard(album)).join('')}</div></section>`:'<span id="series"></span>'}
<section class="works section-wrap" id="selected"><div class="section-heading"><h2>精选作品</h2></div><div class="home-photo-grid" data-gallery="featured">${featured.length?featured.map(p=>photoCard(p,'')).join(''):'<div class="portfolio-empty"><h3>暂无精选作品</h3></div>'}</div><p class="home-archive-entry">${textLink('archive/','浏览作品档案')}</p></section>
`});

const years = [...new Set(photos.filter(p=>p.date).map(p=>p.date.slice(0,4)))].sort().reverse();
const ordered = C.selectPhotos(photos,C.parseState('',photos));
pages.push({page:'archive',route:'archive/',title:'作品档案',description:'按年份、月份与题材浏览完整摄影档案，切换时间线与网格。',body:`
<section class="page-intro section-wrap"><div><h1>作品档案</h1></div></section>
<section class="archive-layout section-wrap"><aside class="archive-sidebar" aria-label="按年份筛选"><p>年份</p><button data-year="all" class="year-button active" aria-pressed="true">全部年份 <span>${two(photos.length)}</span></button>${years.map(y=>`<button data-year="${y}" class="year-button" aria-pressed="false">${y}<span>${two(photos.filter(p=>p.date?.startsWith(y)).length)}</span></button>`).join('')}</aside><div class="archive-main"><div class="archive-controls"><div class="archive-selects"><label><span>月份</span><select id="month-filter" aria-label="筛选月份"><option value="all">全部月份</option>${Array.from({length:12},(_,i)=>`<option value="${two(i+1)}">${i+1} 月</option>`).join('')}</select></label><label><span>题材</span><select id="category-filter" aria-label="筛选题材">${Object.entries(C.categories).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label><span>顺序</span><select id="order-filter" aria-label="作品排序"><option value="newest">由近到远</option><option value="oldest">由远到近</option></select></label></div><div class="view-switch" role="group" aria-label="作品显示方式"><button data-view="timeline" class="active" aria-pressed="true">时间线</button><button data-view="grid" aria-pressed="false">网格</button></div></div><div class="archive-summary"><span id="archive-result-count" aria-live="polite">全部作品 · ${two(photos.length)} 幅</span><button id="reset-filters" hidden>清除筛选 ×</button></div><div id="archive-results" data-gallery="archive">${archiveContent(backend ? ordered.slice(0,36) : ordered,'../')}</div><button type="button" class="text-link archive-more" id="archive-more" hidden>加载更多作品</button><div class="archive-end"><span class="tiny-line"></span><span id="archive-end-label">${photos.length} 幅作品，已全部呈现</span><span class="tiny-line"></span></div></div></section>
<div class="page-next section-wrap">${textLink('../collections/','主题合集')}</div>`});

pages.push({page:'collections',route:'collections/',title:'主题合集',description:'按主题阅读完整摄影合集，用照片串联旅程与故事。',body:`
<section class="page-intro section-wrap"><div><h1>主题合集</h1></div><div class="intro-counter"><strong>${two(albums.length)}</strong><span>本主题影集</span></div></section>
<section class="collections-page section-wrap"><div class="album-grid collections-grid">${albums.length?albums.map(a=>albumCard(a,'../')).join(''):'<div class="portfolio-empty"><h2>暂无合集</h2></div>'}</div></section><div class="page-next section-wrap">${textLink('../archive/','作品档案')}</div>`});

for (const [index, album] of albums.entries()) {
  const members = C.albumPhotos(photos,album);
  const range = C.dateRange(members).map(d=>d.replace('-','.')).join(' — ');
  const next = albums[(index+1)%albums.length];
  pages.push({page:'album',slug:album.slug,route:`collections/${album.slug}/`,title:album.title,description:album.description,body:`
<div class="breadcrumb section-wrap"><a href="../../collections/">主题合集</a><span>/</span><span>${e(album.title)}</span></div><section class="album-hero"><div class="album-hero-image">${image(photoById(album.cover),'../../','',true)}<div class="album-hero-shade"></div><div class="album-hero-copy"><p>COLLECTION ${two(index+1)}${album.english?' / '+e(album.english):''}</p><h1>${e(album.title)}</h1>${album.label?`<span>${e(album.label)}</span>`:''}</div><span class="album-hero-count">${two(members.length)} FRAMES</span></div></section>
<section class="album-introduction section-wrap"><div><p class="eyebrow">${range}</p><span class="date-example">${rangeLabel(members)} · ${members.length} 幅作品</span></div>${album.quote||album.story||album.description?`<div>${album.quote?`<h2>${e(album.quote)}</h2>`:''}${album.story||album.description?`<p>${breaks(album.story||album.description)}</p>`:''}</div>`:''}</section><section class="album-photos section-wrap" aria-label="${e(album.title)} 完整作品"><div class="gallery album-composition" data-gallery="album">${album.layout?.length?album.layout.map(block=>block.type==='text'?`<div class="album-text-block"><p>${breaks(block.text)}</p></div>`:`<div class="album-photo-block span-${block.span}">${photoCard(photoById(block.photoId),'../../')}</div>`).join(''):members.map(p=>photoCard(p,'../../')).join('')}</div></section>
<nav class="album-back section-wrap" aria-label="合集导航">${textLink('../../collections/','全部合集')}${albums.length>1?textLink('../../collections/'+next.slug+'/','下一辑 · '+e(next.title)):textLink('../../archive/','作品档案')}</nav>`});
}

pages.push({page:'equipment',route:'equipment/',title:'器物手记',description:'与摄影作品一同留下的器物。',body:renderEquipmentNotebook(equipment,photos)});

pages.push({page:'about',route:'about/',title:'关于 '+(studio.artistName||'见山'),description:studio.about||'见山，摄影作品与作者。',body:aboutPage({studio,photos:homePhotos,albums:homeAlbums,image})});
if(photoId!==null){const photo=photos.find(p=>p.id===photoId);if(photo)pages.push(workPage(photo,{photos,albums}));}

return { pages: pages.map(page=>({...page,html:layout(page)})), photos, albums };
}
