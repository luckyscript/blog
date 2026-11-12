import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {renderSite} from '../src/render.mjs'
import {renderEquipmentNotebook} from '../src/equipment-page.mjs'
const C=createRequire(import.meta.url)('../dist/catalog.js')
const data=JSON.parse(await fs.readFile(new URL('../src/content.json',import.meta.url),'utf8'))

test('home has a direct mobile archive link outside the collapsed navigation',()=>{
  const home=renderSite(data).pages.find(p=>p.page==='home').html
  const header=home.match(/<header class="site-header">([\s\S]*?)<\/header>/)[1]
  assert.match(header,/<a class="mobile-archive-entry" href="archive\/"/)
  assert.match(header,/直接进入作品档案/)
  assert.match(header,/class="menu-toggle"/)
  assert.match(home,/hero-carousel/,'preserves carousel')
})

test('public archive only renders time, subject, order and view controls',()=>{
  const archive=renderSite(data).pages.find(p=>p.page==='archive').html
  for(const id of ['archive-search','archive-search-form','source-filter','camera-filter'])assert.ok(!archive.includes('id="'+id+'"'))
  for(const id of ['month-filter','category-filter','order-filter','reset-filters','archive-more'])assert.ok(archive.includes('id="'+id+'"'))
  assert.match(archive,/data-year="all"/)
  assert.match(archive,/data-view="timeline"/)
  assert.match(archive,/data-view="grid"/)
})

test('legacy hidden filters are discarded without losing time, subject, sort or view',()=>{
  const query='?year=2026&month=07&category=landscape&order=oldest&view=grid&q=missing&equipment=nikon-d850&source=originals'
  const state=C.parseArchiveState(query,data.photos)
  assert.deepEqual({q:state.q,equipment:state.equipment,source:state.source},{q:'',equipment:'all',source:'all'})
  assert.equal(C.serializeState(state),'year=2026&month=07&category=landscape&order=oldest&view=grid')
  assert.deepEqual(C.selectPhotos(data.photos,state).map(p=>p.id),[4,2])
  assert.deepEqual(C.parseArchiveState(C.serializeState(state),data.photos),state)
  assert.equal(C.parseArchiveState('?year=2030',[],true).year,'2030','remote pagination does not hide valid years')
  assert.equal(C.parseArchiveState('?year=bad&month=13&category=bad',[],true).year,'all')
  const reset=C.parseArchiveState('',data.photos)
  assert.equal(C.selectPhotos(data.photos,reset).length,data.photos.length)
})

test('equipment is an editorial notebook with real model names, sources and no review cards',()=>{
  const page=renderSite(data).pages.find(p=>p.page==='equipment')
  assert.equal(page.title,'器物手记')
  assert.match(page.html,/与光同行的/)
  assert.equal((page.html.match(/class="gear-story"/g)||[]).length,data.equipment.length)
  for(const gear of data.equipment){
    assert.ok(page.html.includes('id="'+gear.id+'"'))
    assert.ok(page.html.includes(gear.name))
    assert.ok(page.html.includes(gear.image.src))
    assert.ok(page.html.includes(gear.image.source.replaceAll('&','&amp;')))
  }
  assert.ok(!page.html.includes('gear-product-stage'))
  assert.ok(!page.html.includes('gear-subjects'))
  assert.ok(!page.html.includes('拍摄时，可以这样看'))
  assert.ok(!page.html.includes('?equipment='))
  assert.match(renderEquipmentNotebook([]),/慢慢整理中/)
  const custom=renderEquipmentNotebook([{id:'custom',name:'<script>device</script>',tagline:'<b>title</b>',intro:'A & B'}])
  assert.ok(!custom.includes('<script>'))
  assert.match(custom,/&lt;b&gt;title&lt;\/b&gt;/)
  assert.match(custom,/A &amp; B/)
})

test('archive controller initializes and changes retained filters without removed DOM inputs',async()=>{
  const source=await fs.readFile(new URL('../dist/app.js',import.meta.url),'utf8')
  const code=source.slice(source.indexOf('let archiveState='),source.indexOf('const lightbox ='))
  const elements=new Map(),requests=[],events={}
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'all',innerHTML:'',textContent:'',listeners:{},hidden:false,
      addEventListener(type,fn){this.listeners[type]=fn},setAttribute(){},removeAttribute(){},
      querySelector(){return {insertAdjacentHTML(){}}},querySelectorAll(){return []}})
    return elements.get(id)
  }
  const retained=new Set(['month-filter','category-filter','order-filter'])
  const location={pathname:'/archive/',search:'?q=absent&source=originals&equipment=wrong',hash:''}
  const context=vm.createContext({C,URLSearchParams,photos:data.photos,backend:true,page:'archive',location,
    lightbox:{open:false},e:String,two:n=>String(n).padStart(2,'0'),archivePhoto:p=>'<article>'+p.id+'</article>',
    document:{activeElement:null,querySelector:element,querySelectorAll:()=>[],getElementById:id=>{assert.ok(retained.has(id),'only retained controls are accessed');return element('#'+id)}},
    window:{addEventListener:(name,fn)=>events[name]=fn},
    history:{pushState(a,b,url){location.search=url.includes('?')?'?'+url.split('?')[1]:''},replaceState(a,b,url){location.search=url.includes('?')?'?'+url.split('?')[1]:''}},
    fetch:async url=>{
      requests.push(url)
      if(url==='/api/archive/facets')return {ok:true,json:async()=>({total:data.photos.length,years:[{year:'2026',count:5},{year:'2025',count:3}],unknown:0})}
      const state=C.parseArchiveState(url.split('?')[1],data.photos)
      const selected=C.selectPhotos(data.photos,state)
      return {ok:true,json:async()=>({photos:selected,total:selected.length,hasMore:false})}
    }
  })
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
  vm.runInContext(code,context);await flush()
  assert.equal(location.search,'')
  assert.match(element('#archive-result-count').textContent,/全部作品 · 8 幅/)
  for(const [id,value]of [['month-filter','07'],['category-filter','landscape'],['order-filter','oldest']]){
    element('#'+id).listeners.change({target:{value}});await flush()
  }
  assert.match(element('#archive-result-count').textContent,/2 幅/)
  assert.ok(element('#archive-results').innerHTML.indexOf('>4<')<element('#archive-results').innerHTML.indexOf('>2<'))
  for(const url of requests.filter(url=>url.startsWith('/api/photos?'))){
    const params=new URLSearchParams(url.split('?')[1])
    for(const key of ['q','source','equipment','originals'])assert.equal(params.has(key),false)
  }
  location.search='?year=2025&view=grid&equipment=wrong'
  events.popstate();await flush()
  assert.match(element('#archive-result-count').textContent,/3 幅/)
  assert.match(element('#archive-results').innerHTML,/all-photos-grid/)
})
