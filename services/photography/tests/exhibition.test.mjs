import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {once} from 'node:events'
import {renderSite} from '../src/render.mjs'
import {socialMetadata} from '../src/exhibition.mjs'
import {getStudio,saveStudio} from '../server/studio-config.mjs'
import {createPortfolioServer} from './helpers/database.mjs'
import {applyExhibition,exhibitionSettings,bookLayout} from '../deploy/exhibition-release.mjs'

const seed=JSON.parse(await fs.readFile(new URL('../src/content.json',import.meta.url),'utf8'))
const data={...seed,backend:true,photos:seed.photos.map(p=>({...p,isDemo:false,shareSrc:`media/${p.id}-jpeg?v=brand-v2`})),studio:{}}

test('exhibition home prioritizes series, preserves frames and removes demo-only credits for originals',async()=>{
  const pages=renderSite(data).pages,home=pages[0].html
  assert.ok(home.indexOf('id="series"')<home.indexOf('id="selected"'))
  assert.ok(!home.includes('class="home-index"'))
  assert.ok(!home.includes('VOL. 02'))
  for(const page of pages)assert.ok(!page.html.includes('id="credits-open"'))
  assert.ok(!pages.find(p=>p.page==='archive').html.includes('示意作品单独标注'))
  assert.ok(renderSite(seed).pages[0].html.includes('id="credits-open"'),'real demo attribution is retained')
  const css=await fs.readFile(new URL('../dist/exhibition.css',import.meta.url),'utf8')
  assert.match(css,/home-photo-grid[^}]+aspect-ratio:auto/)
  assert.match(css,/album-hero-image>img[^}]+object-fit:contain/)
  assert.ok(home.includes('mobile-archive-entry'))
})

test('quiet public pages remove generic guidance without losing authored copy or navigation',()=>{
  const custom={...data,studio:{headline:'自写的首页标题',intro:'自写的引言',about:'作者自己的自述'}}
  const pages=renderSite(custom).pages,home=pages[0].html
  for(const text of ['自写的首页标题','自写的引言','mobile-archive-entry','data-gallery="featured"'])assert.ok(home.includes(text))
  for(const text of ['一段完整的观看','片刻，留在这里','exhibition-home-nav','home-closing','从最近的一次按下快门','一个可以回去的瞬间','照片之间，也有回响','有时是一段旅程','点击照片，进入沉浸浏览','从作品，继续认识我','这一页，写给看见之前']){
    assert.ok(!pages.some(p=>p.html.includes(text)),text)
  }
  assert.ok(pages.find(p=>p.page==='about').html.includes('作者自己的自述'))
  assert.ok(renderSite({...data,studio:{about:''}}).pages.find(p=>p.page==='about').html.includes('artist-layout-image-only'))
  const album=pages.find(p=>p.page==='album')
  assert.ok(album.html.includes(data.albums[0].description))
})

test('home grids handle empty, single and odd selections in explicit display order',()=>{
  for(const n of [0,1,3,5,6]){
    const photos=data.photos.slice(0,n).map((p,i)=>({...p,featured:true,featuredOrder:n-i}))
    for(const count of [0,1,2]){
      const albums=data.albums.slice(0,count).map(a=>({...a,cover:photos[0]?.id,photos:photos.map(p=>p.id)}))
      const home=renderSite({...data,photos,albums,studio:{originalsOnly:false}}).pages[0].html
      assert.ok(home.includes('class="home-photo-grid"'))
      assert.ok(!home.includes('representative-gallery'))
      assert.deepEqual([...home.matchAll(/data-photo="([^"]+)"/g)].map(m=>m[1]),photos.toReversed().map(p=>String(p.id)))
      assert.equal([...home.matchAll(/class="home-series-card"/g)].length,count)
      if(!n)assert.ok(home.includes('暂无精选作品'))
      if(count)assert.ok(home.includes('class="home-series-copy"'))
    }
  }
})

test('desktop grid neutralizes legacy offsets and crops neither landscape nor portrait photos',async()=>{
  const css=await fs.readFile(new URL('../dist/exhibition.css',import.meta.url),'utf8')
  assert.match(css,/\.home-photo-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css,/\.home-photo-grid \.photo-card:nth-child\(n\)\{grid-column:auto;padding:0;animation:none\}/)
  assert.match(css,/\.home-photo-grid[^}]+aspect-ratio:3\/2/)
  assert.match(css,/\.home-photo-grid[^}]+object-fit:contain/)
  const mobile=css.slice(css.indexOf('@media(max-width:700px)'))
  assert.match(mobile,/\.home-photo-grid\{grid-template-columns:1fr/)
  assert.match(mobile,/\.home-photo-grid[^}]+aspect-ratio:auto/)
  assert.match(mobile,/\.home-photo-grid[^}]+position:relative;height:auto/)
})

test('two independent work pages carry their own matching social metadata and no invented information',()=>{
  for(const photo of data.photos.slice(0,2)){
    const work=renderSite(data,{origin:'https://portfolio.example',photoId:photo.id}).pages.find(p=>p.page==='work')
    assert.equal(work.title,photo.title)
    assert.ok(work.html.includes(`<h1>${photo.title}</h1>`))
    for(const name of ['og:title','twitter:title'])assert.ok(work.html.includes(`="${name}" content="${photo.title} · 见山 JIANSHAN"`))
    assert.ok(work.html.includes(`property="og:image" content="https://portfolio.example/media/${photo.id}-jpeg?v=brand-v2"`))
    assert.ok(work.html.includes(`rel="canonical" href="https://portfolio.example/works/${photo.id}/"`))
    assert.ok(work.html.includes(`name="description" content="${photo.description}"`))
    assert.ok(work.html.includes(`property="og:description" content="${photo.description}"`))
    assert.ok(work.html.includes(`name="twitter:description" content="${photo.description}"`))
    assert.ok(work.html.includes('data-share-work="'+photo.id+'"'))
    assert.ok(!work.html.includes('public/og.png'))
  }
  const hostile={...data.photos[0],title:'<script>alert(1)</script>',description:'A "quote" & a thought'}
  const html=renderSite({...data,photos:[hostile],albums:[]},{origin:'https://portfolio.example',photoId:hostile.id}).pages.find(p=>p.page==='work').html
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!socialMetadata({origin:'https://portfolio.example',route:'works/1/',title:'One',description:'',image:null}).includes('og:image'))
  assert.ok(!socialMetadata({origin:'https://portfolio.example',route:'works/1/',title:'One',description:'',image:'javascript:alert(1)'}).includes('og:image'))
})

test('about page uses only supplied identity and optional contact, never a draft photograph',()=>{
  const about=studio=>renderSite({...data,studio}).pages.find(p=>p.page==='about').html
  assert.ok(!about({}).includes('mailto:'))
  assert.ok(!about({}).includes('为什么叫'))
  const html=about({artistName:'某某',about:'真实的自述。',aboutNote:'这个名字来自一次阅读。',contactEmail:'artist@example.com',aboutPhotoId:999999})
  assert.ok(html.includes('真实的自述。'))
  assert.ok(html.includes('这个名字来自一次阅读。'))
  assert.ok(html.includes('mailto:artist@example.com'))
  assert.ok(!html.includes('data-photo="999999"'))
  assert.ok(!html.includes('about-principles'))
})

test('book layout preserves order, opening and closing; editorial settings keep personalized values',()=>{
  for(const n of [1,2,3,4,5,8,9,10]){
    const ids=Array.from({length:n},(_,i)=>i+1),layout=bookLayout(ids)
    assert.deepEqual(layout.map(b=>b.photoId),ids)
    assert.equal(layout[0].span,'wide');assert.equal(layout.at(-1).span,'wide')
  }
  assert.deepEqual(exhibitionSettings({headline:'我自己的标题',intro:'真实引言',about:'作者自述',shade:19}),{})
})

test('public work routes are read-only, hide draft/trash and invalidate metadata after edits',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-exhibition-'))
  const app=await createPortfolioServer({dataDir:dir,seed:true,turnstile:{env:{}}})
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const base='http://127.0.0.1:'+app.server.address().port
  try{
    const first=await app.db.prepare("SELECT id,title FROM photos WHERE status='published' ORDER BY id LIMIT 1").get()
    const res=await fetch(`${base}/works/${first.id}/`);assert.equal(res.status,200)
    assert.equal(res.headers.get('cache-control'),'no-store')
    assert.ok((await res.text()).includes('rel="canonical"'))
    assert.equal((await fetch(`${base}/works/${first.id}/`,{method:'HEAD'})).status,200)
    const redirect=await fetch(`${base}/works/${first.id}`,{redirect:'manual'});assert.equal(redirect.status,302)
    await app.db.prepare('UPDATE photos SET title=?,description=? WHERE id=?').run('新的标题','新的短笺',first.id)
    const edited=await(await fetch(`${base}/works/${first.id}/`)).text()
    assert.ok(edited.includes('property="og:title" content="新的标题'))
    assert.ok(edited.includes('property="og:description" content="新的短笺"'))
    for(const status of ['draft','trash']){
      await app.db.prepare('UPDATE photos SET status=? WHERE id=?').run(status,first.id)
      const withdrawn=await fetch(`${base}/works/${first.id}/`,{headers:{Accept:'text/html'}})
      assert.equal(withdrawn.status,404);assert.ok(!(await withdrawn.text()).includes('新的短笺'))
    }
    assert.equal((await fetch(base+'/works/999999/')).status,404)
    assert.equal((await fetch(base+'/works/1/',{method:'POST'})).status,405)
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})

test('artist settings validate email and revision, persist across restart, and release is reversible/idempotent',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-artist-'))
  let app=await createPortfolioServer({dataDir:dir,seed:true,turnstile:{env:{}}})
  try{
    let value=await getStudio(app.db)
    for(const email of ['bad','a@example.com\nBcc:bad@example.com','javascript:alert(1)','a@example.com?subject=bad'])await assert.rejects(saveStudio(app.db,{version:value.version,contactEmail:email}),e=>e.status===400)
    value=await saveStudio(app.db,{version:value.version,artistName:'真实作者',contactEmail:'artist@example.com',aboutNote:'名字的来处',aboutPhotoId:1})
    await assert.rejects(saveStudio(app.db,{version:0,artistName:'overwritten'}),e=>e.status===409)
    await assert.rejects(saveStudio(app.db,{version:value.version,aboutPhotoId:999999}),e=>e.status===400)
    await app.close();app=await createPortfolioServer({dataDir:dir,seed:false,turnstile:{env:{}}})
    assert.equal((await getStudio(app.db)).contactEmail,'artist@example.com')
    value=await getStudio(app.db)
    await saveStudio(app.db,{version:value.version,headline:'万物有光，\n值得被看见。'})
    const first=await applyExhibition(app.db,dir,{apply:true})
    assert.ok(first.settings.includes('headline'))
    const snapshot=JSON.parse(await fs.readFile(first.checkpoint,'utf8'))
    assert.ok(JSON.parse(snapshot.studio.value).headline.includes('万物有光'))
    assert.equal((await fs.stat(first.checkpoint)).mode&0o777,0o600)
    assert.deepEqual((await applyExhibition(app.db,dir,{apply:true})).settings,[])
    assert.equal((await getStudio(app.db)).artistName,'真实作者')
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})
