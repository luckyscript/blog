'use strict';
document.querySelectorAll('[data-share-work]').forEach(button=>{
  button.addEventListener('click',async()=>{
    const title=button.dataset.shareTitle||document.title
    const url=new URL('/photography/works/'+button.dataset.shareWork+'/',location.origin).href
    const status=button.parentElement.querySelector('[data-share-status]')
    button.disabled=true
    try {
      if(navigator.share){await navigator.share({title,url});status.textContent=''}
      else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);status.textContent='作品链接已复制。'}
      else {status.textContent='请复制浏览器地址栏中的作品链接。'}
    }catch(error){if(error.name!=='AbortError')status.textContent='请复制浏览器地址栏中的作品链接。'}
    finally{button.disabled=false}
  })
})
