'use strict'

function canApplyPhotoSuggestion(start,current){
  return current.open&&start.id===current.id&&start.version===current.version&&start.request===current.request&&start.revision===current.revision&&start.value===current.value&&!current.saving
}

if(typeof module==='object'&&module.exports)module.exports={canApplyPhotoSuggestion}
else (()=>{
  const form=document.querySelector('#photo-form'),dialog=document.querySelector('#editor')
  const fields=['title','description'],buttons=new Map(),revisions={title:0,description:0}
  const hint='点击 AI 将这张照片的压缩预览发送给 DeepSeek，生成内容仅填入当前字段，确认后保存。'
  const note=document.createElement('p');note.className='ai-copy-note';note.setAttribute('role','status');note.setAttribute('aria-live','polite')
  let serial=0,active=null
  for(const field of fields){
    const input=form.elements[field],label=input.closest('label'),wrapper=document.createElement('div')
    wrapper.className='ai-copy-field';label.before(wrapper);wrapper.append(label)
    const button=document.createElement('button');button.type='button';button.className='ai-copy-button';button.dataset.aiField=field
    button.innerHTML='<span aria-hidden="true">✦</span> AI';button.setAttribute('aria-label',field==='title'?'根据图片生成作品标题':'根据图片生成作品描述')
    button.title=field==='title'?'AI 看图生成标题':'AI 看图生成描述';wrapper.append(button);buttons.set(field,button)
    input.addEventListener('input',()=>{revisions[field]++})
    button.addEventListener('click',()=>generate(field))
  }
  buttons.get('description').parentElement.after(note)
  const allowed=()=>state.info?.ai?.enabled&&!state.edit?.isDemo&&state.edit?.status!=='trash'
  function controls(){for(const button of buttons.values()){button.disabled=!!active||!allowed();button.setAttribute('aria-busy',String(!!active&&active.field===button.dataset.aiField))}}
  function cancel(){serial++;active?.controller.abort();active=null;controls()}
  function opened(){cancel();note.textContent=allowed()?hint:state.edit?.isDemo?'示意作品不使用 AI 生成。':!state.info?.ai?.enabled?'AI 服务尚未配置。':'回收站作品不使用 AI 生成。';note.classList.remove('error')}
  async function generate(field){
    if(active||!allowed()||form.dataset.saving)return
    const input=form.elements[field],controller=new AbortController()
    const start={id:state.edit.id,version:state.edit.version,request:++serial,revision:revisions[field],value:input.value}
    active={field,controller};controls();note.classList.remove('error');note.textContent='AI 正在查看照片并生成'+(field==='title'?'标题':'描述')+'…'
    try{
      const result=await api(`/api/admin/photos/${start.id}/ai-copy`,{method:'POST',body:JSON.stringify({field,version:start.version}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])})
      if(start.request!==serial)return
      if(!canApplyPhotoSuggestion(start,{open:dialog.open,id:state.edit?.id,version:state.edit?.version,request:serial,revision:revisions[field],value:input.value,saving:!!form.dataset.saving})){
        note.textContent='你已修改内容或切换作品，本次生成未覆盖你的编辑。';return
      }
      if(result.field!==field||result.version!==start.version||typeof result.value!=='string')throw new Error('AI 返回格式不正确')
      input.value=result.value;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()
      note.textContent='已填入 AI 建议，请核对画面内容；点击保存后才会生效。'
    }catch(error){
      if(start.request!==serial||controller.signal.aborted)return
      note.classList.add('error');note.textContent=error.status?error.message:'生成未完成，请检查网络后重试；原有内容未改动。'
    }finally{if(start.request===serial){active=null;controls()}}
  }
  dialog.addEventListener('close',cancel)
  form.addEventListener('reset',opened)
  new MutationObserver(()=>{if(dialog.open)opened()}).observe(dialog,{attributes:true,attributeFilter:['open']})
  controls()
})()
