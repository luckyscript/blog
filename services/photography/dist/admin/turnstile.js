'use strict'

function createLoginChallenge(env=window) {
  const doc=env.document,container=doc.querySelector('#login-challenge'),message=doc.querySelector('#challenge-message')
  const box=doc.querySelector('#challenge-box'),retry=doc.querySelector('#challenge-retry'),button=doc.querySelector('#auth-submit')
  let required=false,token='',widget=null,revision=0,submitting=false,sdkPromise,config
  const sync=()=>{button.disabled=submitting||(required&&!token)}
  const notice=text=>{message.textContent=text}
  function loadSdk(){
    if(env.turnstile)return Promise.resolve()
    if(sdkPromise)return sdkPromise
    sdkPromise=new Promise((resolve,reject)=>{
      const script=doc.createElement('script')
      let settled=false
      const finish=ok=>{
        if(settled)return
        settled=true;env.clearTimeout(timer)
        if(ok&&env.turnstile)resolve()
        else{script.remove();reject(new Error('验证组件未能加载，请检查网络后重试。'))}
      }
      const timer=env.setTimeout(()=>finish(false),15000)
      env.jianshanTurnstileReady=()=>finish(true)
      script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=jianshanTurnstileReady'
      script.async=true;script.onerror=()=>finish(false)
      doc.head.append(script)
    }).catch(error=>{sdkPromise=null;throw error})
    return sdkPromise
  }
  async function configure(next){
    const request=++revision
    config=next;required=next?.enabled===true;token=''
    if(widget!==null){env.turnstile?.remove(widget);widget=null}
    box.hidden=!required;retry.hidden=true;notice('');sync()
    if(!required)return
    notice('正在加载安全验证…')
    try{
      await loadSdk()
      if(request!==revision||!required)return
      widget=env.turnstile.render(container,{
        sitekey:next.siteKey,action:'admin-login',theme:'light',size:container.clientWidth&&container.clientWidth<300?'compact':'flexible',language:'zh-cn',
        'response-field':false,
        callback:value=>{if(request!==revision)return;token=value;notice('安全验证已通过');retry.hidden=true;sync()},
        'expired-callback':()=>{if(request!==revision)return;token='';notice('验证已过期，请重新验证。');retry.hidden=false;sync()},
        'timeout-callback':()=>{if(request!==revision)return;token='';notice('验证超时，请重试。');retry.hidden=false;sync()},
        'error-callback':()=>{if(request!==revision)return;token='';notice('安全验证暂不可用，请检查网络后重试。');retry.hidden=false;sync();return true}
      })
      if(!token)notice('请完成下方安全验证。')
    }catch(error){if(request===revision){notice('验证组件未能加载，请检查网络后重试。');retry.hidden=false;sync()}}
  }
  retry.addEventListener('click',()=>{if(!submitting)void configure(config)})
  return {
    configure,
    getToken(){if(required&&!token)throw new Error('请先完成人机验证。');return token||undefined},
    setSubmitting(value){submitting=value;sync()},
    reset(){
      token='';sync()
      if(!required)return
      notice('请重新完成人机验证。')
      if(widget!==null){try{env.turnstile.reset(widget)}catch{retry.hidden=false}}
      else retry.hidden=false
    }
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports={createLoginChallenge}
else window.LoginChallenge=createLoginChallenge(window)
