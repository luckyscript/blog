'use strict'

function initHeroCarousel(root,env=window) {
  const slides=Array.from(root.querySelectorAll('.hero-slide'))
  if(slides.length<2)return null
  const doc=env.document,media=env.matchMedia('(prefers-reduced-motion: reduce)')
  const controls=root.querySelector('.hero-reel-controls')
  const pause=root.querySelector('[data-hero-pause]')
  const previous=root.querySelector('[data-hero-prev]'),next=root.querySelector('[data-hero-next]')
  const progress=root.querySelector('.hero-reel-progress span')
  const caption=root.querySelector('.hero-current-title'),counter=root.querySelector('.hero-current-index')
  const demo=root.querySelector('.hero-reel-demo'),status=root.querySelector('.hero-reel-status')
  const broken=new Set(),loads=new Map(),listeners=[],loadCancels=new Set()
  const duration=7000
  let current=0,timer=0,request=0,ready=false,busy=false,destroyed=false
  let paused=media.matches,hovered=false,visible=true,touch=null,observer
  const on=(target,event,handler,options)=>{
    target.addEventListener(event,handler,options)
    listeners.push(()=>target.removeEventListener(event,handler,options))
  }
  const wrap=index=>(index+slides.length)%slides.length
  const available=()=>slides.length-broken.size

  function schedule() {
    env.clearTimeout(timer)
    root.dataset.playing='false'
    pause.setAttribute('aria-label',paused?'播放自动轮播':'暂停自动轮播')
    pause.querySelector('span').textContent=paused?'▷':'Ⅱ'
    previous.disabled=next.disabled=available()<2
    pause.disabled=available()<2
    if(destroyed||!ready||busy||paused||hovered||!visible||doc.hidden||available()<2)return
    // Restart the progress bar and its matching timer together after each pause.
    void progress.offsetWidth
    root.dataset.playing='true'
    timer=env.setTimeout(()=>show(wrap(current+1)),duration)
  }

  function prepare(index) {
    if(broken.has(index))return Promise.resolve(false)
    if(loads.has(index))return loads.get(index)
    const img=slides[index].querySelector('img')
    const promise=new Promise(resolve=>{
      let settled=false,timeout
      const finish=ok=>{
        if(settled)return
        settled=true
        env.clearTimeout(timeout)
        img.removeEventListener('load',loaded)
        img.removeEventListener('error',failed)
        loadCancels.delete(cancel)
        if(!ok&&!destroyed)broken.add(index)
        const backdrop=slides[index].querySelector('.hero-backdrop')
        if(ok&&!destroyed&&backdrop?.dataset.src){backdrop.src=backdrop.dataset.src;delete backdrop.dataset.src}
        resolve(ok)
      }
      const loaded=()=>finish(img.naturalWidth>0)
      const failed=()=>finish(false)
      const cancel=()=>finish(false)
      loadCancels.add(cancel)
      img.addEventListener('load',loaded)
      img.addEventListener('error',failed)
      timeout=env.setTimeout(failed,15000)
      if(img.dataset.src){img.src=img.dataset.src;delete img.dataset.src}
      if(img.complete)loaded()
    })
    loads.set(index,promise)
    return promise
  }

  function preload() {
    if(destroyed||!visible||doc.hidden||env.navigator?.connection?.saveData)return
    for(let step=1;step<slides.length;step++){
      const index=wrap(current+step)
      if(!broken.has(index)){
        void prepare(index).then(()=>{if(!destroyed)schedule()})
        break
      }
    }
  }

  async function show(target,manual=false,direction=1) {
    if(destroyed)return
    if(manual)paused=true
    const token=++request
    busy=true
    schedule()
    let index=wrap(target),found=false
    for(let attempt=0;attempt<slides.length;attempt++,index=wrap(index+direction)){
      if(index===current&&!broken.has(current)){found=true;break}
      if(await prepare(index)){found=true;break}
      if(destroyed||token!==request)return
    }
    if(destroyed||token!==request)return
    if(found&&index!==current){
      const incoming=slides[index]
      incoming.classList.remove('is-developed')
      void incoming.offsetWidth
      slides[current].classList.remove('is-active')
      slides[current].setAttribute('aria-hidden','true')
      incoming.classList.add('is-active','is-developed')
      incoming.setAttribute('aria-hidden','false')
      current=index
      root.dataset.layout=incoming.dataset.layout
      caption.textContent=incoming.dataset.title
      counter.textContent=String(index+1).padStart(2,'0')
      demo.hidden=incoming.dataset.demo==='false'
      if(manual)status.textContent=`第 ${index+1} 幅，共 ${slides.length} 幅：${incoming.dataset.title}`
    }else if(manual||!found){
      status.textContent='其他封面暂时无法加载，请稍后刷新重试。'
    }
    busy=false
    ready=found
    schedule()
    preload()
  }

  on(previous,'click',()=>show(wrap(current-1),true,-1))
  on(next,'click',()=>show(wrap(current+1),true))
  on(pause,'click',()=>{paused=!paused;schedule()})
  on(root,'pointerenter',event=>{if(event.pointerType==='mouse'){hovered=true;schedule()}})
  on(root,'pointerleave',event=>{if(event.pointerType==='mouse'){hovered=false;schedule()}})
  // Keyboard focus and manual navigation stop rotation until Play is chosen.
  on(root,'focusin',()=>{paused=true;schedule()})
  on(root,'keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return
    event.preventDefault()
    const direction=event.key==='ArrowLeft'?-1:1
    void show(wrap(current+direction),true,direction)
  })
  on(root,'pointerdown',event=>{
    if(event.pointerType!=='touch'||!event.isPrimary||event.target.closest('a,button'))return
    touch={id:event.pointerId,x:event.clientX,y:event.clientY}
  },{passive:true})
  on(root,'pointerup',event=>{
    if(!touch||touch.id!==event.pointerId)return
    const dx=event.clientX-touch.x,dy=event.clientY-touch.y
    touch=null
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5){
      const direction=dx<0?1:-1
      void show(wrap(current+direction),true,direction)
    }
  },{passive:true})
  on(root,'pointercancel',()=>{touch=null})
  on(doc,'visibilitychange',()=>{schedule();if(!doc.hidden)preload()})
  on(media,'change',()=>{if(media.matches)paused=true;schedule()})
  if(env.IntersectionObserver){
    observer=new env.IntersectionObserver(entries=>{
      visible=entries[0].isIntersecting
      schedule()
      if(visible)preload()
    },{threshold:0})
    observer.observe(root)
  }
  controls.hidden=false
  root.dataset.enhanced='true'
  root.style.setProperty('--hero-duration',duration+'ms')
  slides[0].classList.add('is-developed')
  void prepare(0).then(ok=>{
    if(destroyed)return
    ready=ok
    if(!ok)void show(1)
    else{schedule();preload()}
  })
  return {destroy(){
    destroyed=true
    request++
    env.clearTimeout(timer)
    for(const cancel of loadCancels)cancel()
    listeners.forEach(remove=>remove())
    observer?.disconnect()
    root.dataset.playing='false'
    controls.hidden=true
  }}
}

if(typeof module!=='undefined'&&module.exports)module.exports={initHeroCarousel}
else document.querySelectorAll('.hero-carousel').forEach(root=>initHeroCarousel(root))
