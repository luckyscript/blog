const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const notes={
  'nikon-zf':{title:'把时光，握在手里。',text:'目光从一扇窗移向另一扇窗，影子沿着墙根慢慢伸长。轻装出门，把画面留给偶然，也留给那些没有名字的小地方。',after:'不必走远，日常自有深处。'},
  'nikon-d850':{title:'山有层次，光有来处。',text:'远山退入薄雾，近处的石纹仍清晰可读。观看有时需要一点分量，也需要一点耐心——等纷繁的景物，在取景框里各归其位。',after:'让目光停留，比抵达更久。'},
  'insta360-ace-pro':{title:'风经过的地方。',text:'路向前延伸，树影从身旁掠过。镜头不必总是站在远处，也可以随着脚步，走进起伏的地面与流动的空气。',after:'有些画面，要在行进中遇见。'},
  'insta360-x3':{title:'风景，不只有正面。',text:'身前是一条路，身后也许是另一重天地。把观看的边界放宽一些，让未被预料的方向，也在画面里拥有位置。',after:'转过身，世界仍在展开。'},
  'vivo-x200-pro-mini':{title:'细小的事物，也有回声。',text:'一片叶子的背面，一只杯沿的反光，一段落在桌上的影子。随手可及的镜头，让目光愿意俯身，去读这些轻声的段落。',after:'微小，并不意味着无足轻重。'},
  'iphone-13-pro':{title:'寻常一日，值得落款。',text:'窗外的天色换了一次，街角的树又添了几片叶。记录不一定要等到远行，普通的一天，也有只在此刻出现的纹理。',after:'把生活读慢一点。'}
}

export function renderEquipmentNotebook(equipment,photos=[]) {
  return `<div class="equipment-notebook section-wrap">
<header class="notebook-opening"><div class="notebook-title-row"><h1>与光同行的<br><em>器物。</em></h1></div><nav class="notebook-index" aria-label="器材目录">${equipment.map((g,i)=>`<a href="#${e(g.id)}"><span>${String(i+1).padStart(2,'0')}</span>${e(g.name)}</a>`).join('')}</nav></header>
<section class="notebook-entries" aria-label="摄影器物手记">${equipment.map((g,i)=>{
    const note=Object.hasOwn(notes,g.id)?notes[g.id]:{title:g.tagline||'目光所至，皆可入画。',text:g.intro||'一件器物，一种观看的方式。',after:''}
    const related=photos.filter(p=>p.equipmentId===g.id&&p.isDemo===false).slice(0,2)
    return `<article class="gear-story" id="${e(g.id)}"><div class="notebook-entry-index"><span>${String(i+1).padStart(2,'0')}</span><p>${e(g.type)}</p></div><figure class="notebook-object">${g.image?.src?`<div class="notebook-object-stage"><img src="../${e(g.image.src)}" alt="${e(g.image.alt||g.name)}" width="${Number(g.image.width)||640}" height="${Number(g.image.height)||640}" loading="lazy" decoding="async"></div>`:''}<figcaption><span class="notebook-object-name">${e(g.name)}</span>${g.color?`<span class="notebook-object-color">${e(g.color)}</span>`:''}${g.image?.source?`<a class="notebook-image-credit" href="${e(g.image.source)}" target="_blank" rel="noopener noreferrer">图像来源 · ${e(g.image.attribution||g.brand)}</a>`:''}</figcaption></figure><div class="notebook-prose"><p class="notebook-entry-label">${related.length?'由它留下的作品':'关于'+e(g.type||'观看')}</p><h2>${e(note.title)}</h2><p class="notebook-paragraph">${e(note.after||note.text)}</p>${related.length?`<div class="notebook-related">${related.map(p=>`<a href="../works/${p.id}/"><img src="../${e(p.thumbSrc||p.src)}" alt="${e(p.title)}" width="${p.width}" height="${p.height}" loading="lazy"><span>${e(p.title)}</span></a>`).join('')}</div>`:''}</div></article>`
  }).join('')||'<p class="notebook-empty">器物手记，慢慢整理中。</p>'}</section>
<footer class="notebook-colophon"><span class="notebook-small-rule" aria-hidden="true"></span><a href="../archive/">翻回作品</a><span class="notebook-endmark">见山 · JIANSHAN</span></footer>
</div>`
}
