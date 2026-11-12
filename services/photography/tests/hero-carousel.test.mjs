import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {selectHeroPhotos,renderHeroSlides} from '../src/hero.mjs'
import {renderSite} from '../src/render.mjs'
const {initHeroCarousel}=createRequire(import.meta.url)('../dist/hero-carousel.js')
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}

class Element extends EventTarget {
  constructor(){
    super()
    this.dataset={};this.attributes={};this.hidden=false;this.disabled=false;this.textContent=''
    this.children={};this.offsetWidth=100;this.style={setProperty(){}}
    const classes=new Set()
    this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n)}
  }
  setAttribute(key,value){this.attributes[key]=value}
  querySelector(selector){return this.children[selector]}
  closest(){return null}
  emit(type,props={}){const event=new Event(type,{cancelable:true});Object.assign(event,props);this.dispatchEvent(event);return event}
}
function fixture({count=3,reduced=false,pending=[]}={}){
  const root=new Element(),doc=new Element(),media=new Element(),timers=new Map()
  let sequence=0,intersection
  media.matches=reduced;doc.hidden=false
  const slides=Array.from({length:count},(_,i)=>{
    const slide=new Element(),img=new Element()
    slide.dataset={title:'作品 '+(i+1),demo:String(i===1)}
    slide.children.img=img;slide.setAttribute('aria-hidden',String(i!==0))
    if(i===0)slide.classList.add('is-active')
    img.complete=!pending.includes(i);img.naturalWidth=img.complete?1200:0
    if(i>0)img.dataset.src='/test-'+i+'.jpg'
    return slide
  })
  root.querySelectorAll=()=>slides
  for(const selector of ['.hero-reel-controls','[data-hero-pause]','[data-hero-prev]','[data-hero-next]','.hero-reel-progress span','.hero-current-title','.hero-current-index','.hero-reel-demo','.hero-reel-status'])root.children[selector]=new Element()
  root.children['[data-hero-pause]'].children.span=new Element()
  const env={document:doc,navigator:{},matchMedia:()=>media,
    setTimeout:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence},
    clearTimeout:id=>timers.delete(id),
    IntersectionObserver:class{constructor(callback){intersection=callback}observe(){}disconnect(){}}
  }
  const controller=initHeroCarousel(root,env)
  return {root,doc,media,slides,timers,controller,
    click:selector=>root.children[selector].emit('click'),
    active:()=>slides.findIndex(s=>s.classList.contains('is-active')),
    visible:value=>intersection([{isIntersecting:value}]),
    load(index,ok=true){const img=slides[index].children.img;img.complete=true;img.naturalWidth=ok?1200:0;img.emit(ok?'load':'error')},
    async fire(delay){const entry=Array.from(timers).find(([,t])=>t.delay===delay);assert.ok(entry,'expected scheduled timer '+delay);timers.delete(entry[0]);entry[1].fn();await flush()}
  }
}

test('hero uses the cover then ordered featured photos once; empty/single and original-only pages stay safe',async()=>{
  const data=JSON.parse(await fs.readFile(new URL('../src/content.json',import.meta.url),'utf8'))
  const photos=data.photos.slice(0,3).map((p,i)=>({...p,featured:i!==1,featuredOrder:3-i,isDemo:false}))
  assert.deepEqual(selectHeroPhotos(photos,photos[1]).map(p=>p.id),[photos[1].id,photos[2].id,photos[0].id])
  assert.deepEqual(selectHeroPhotos(photos,photos[0]).map(p=>p.id),[photos[0].id,photos[2].id])
  assert.deepEqual(selectHeroPhotos([],undefined),[])
  const home=items=>renderSite({...data,backend:true,photos:items,albums:[],studio:{originalsOnly:true}}).pages[0].html
  assert.ok(!home([]).includes('aria-roledescription="轮播"'))
  assert.ok(!home(photos.slice(0,1)).includes('aria-roledescription="轮播"'))
  const multi=home(photos)
  assert.match(multi,/aria-roledescription="轮播"/)
  assert.equal((multi.match(/data-hero-id=/g)||[]).length,2)
  assert.ok(!home([photos[0],{...photos[2],isDemo:true}]).includes('aria-roledescription="轮播"'))
  const slides=renderHeroSlides([{...photos[0],title:'<script>bad</script>',largeSrc:'/display/first.webp'},{...photos[2],largeSrc:'/display/second.webp'}])
  assert.ok(!slides.includes('<script>'))
  assert.equal((slides.match(/fetchpriority="high"/g)||[]).length,1)
  assert.match(slides,/data-src="\/display\/second.webp"/)
  assert.match(slides,/aria-hidden="true"/)
})

test('carousel cycles, wraps, updates accessible captions, and pauses for manual navigation',async()=>{
  const f=fixture();await flush()
  assert.equal(f.active(),0);assert.equal(f.root.dataset.playing,'true')
  await f.fire(7000);assert.equal(f.active(),1)
  assert.equal(f.root.children['.hero-current-title'].textContent,'作品 2')
  assert.equal(f.slides[0].attributes['aria-hidden'],'true')
  assert.equal(f.slides[1].attributes['aria-hidden'],'false')
  assert.equal(f.root.children['.hero-reel-demo'].hidden,false)
  assert.equal(f.root.children['.hero-reel-status'].textContent,'','autoplay should not interrupt screen readers')
  f.click('[data-hero-next]');await flush();assert.equal(f.active(),2)
  assert.equal(f.root.dataset.playing,'false')
  assert.match(f.root.children['.hero-reel-status'].textContent,/第 3 幅/)
  f.click('[data-hero-next]');await flush();assert.equal(f.active(),0)
  f.click('[data-hero-prev]');await flush();assert.equal(f.active(),2)
  f.click('[data-hero-pause]');assert.equal(f.root.dataset.playing,'true')
  f.controller.destroy();assert.equal(f.timers.size,0)
})

test('hover, hidden tabs, offscreen, keyboard focus and reduced motion govern autoplay',async()=>{
  const f=fixture();await flush()
  f.root.emit('pointerenter',{pointerType:'mouse'});assert.equal(f.root.dataset.playing,'false')
  f.root.emit('pointerleave',{pointerType:'mouse'});assert.equal(f.root.dataset.playing,'true')
  f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.root.dataset.playing,'false')
  f.doc.hidden=false;f.doc.emit('visibilitychange');await flush();assert.equal(f.root.dataset.playing,'true')
  f.visible(false);assert.equal(f.root.dataset.playing,'false')
  f.visible(true);await flush();assert.equal(f.root.dataset.playing,'true')
  f.root.emit('focusin');assert.equal(f.root.dataset.playing,'false')
  f.click('[data-hero-pause]');assert.equal(f.root.dataset.playing,'true')
  f.media.matches=true;f.media.emit('change');assert.equal(f.root.dataset.playing,'false')
  f.controller.destroy()
  const reduced=fixture({reduced:true});await flush()
  assert.equal(reduced.root.dataset.playing,'false')
  reduced.click('[data-hero-next]');await flush();assert.equal(reduced.active(),1)
  reduced.controller.destroy()
})

test('arrow keys and horizontal touch swipes navigate without consuming vertical scroll',async()=>{
  const f=fixture();await flush()
  assert.equal(f.root.emit('keydown',{key:'ArrowLeft'}).defaultPrevented,true)
  await flush();assert.equal(f.active(),2)
  f.root.emit('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:1,clientX:200,clientY:100})
  f.root.emit('pointerup',{pointerId:1,clientX:80,clientY:105})
  await flush();assert.equal(f.active(),0)
  f.root.emit('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:2,clientX:200,clientY:100})
  f.root.emit('pointerup',{pointerId:2,clientX:180,clientY:300})
  await flush();assert.equal(f.active(),0)
  f.controller.destroy()
})

test('slow, failed and stale image requests never replace a newer selection or blank a healthy slide',async()=>{
  const f=fixture({pending:[1,2]});await flush()
  f.click('[data-hero-next]');await flush();assert.equal(f.active(),0)
  f.click('[data-hero-prev]');await flush();f.load(2);await flush();assert.equal(f.active(),2)
  f.load(1);await flush();assert.equal(f.active(),2,'late result is discarded')
  f.controller.destroy()
  const failed=fixture({count:2,pending:[1]});await flush()
  failed.click('[data-hero-next]');failed.load(1,false);await flush()
  assert.equal(failed.active(),0);assert.equal(failed.root.dataset.playing,'false')
  assert.equal(failed.root.children['[data-hero-next]'].disabled,true)
  failed.controller.destroy();assert.equal(failed.timers.size,0)
  const firstFailed=fixture({pending:[0]});firstFailed.load(0,false);await flush()
  assert.equal(firstFailed.active(),1,'first broken image falls back to a loaded work')
  firstFailed.controller.destroy()
})
