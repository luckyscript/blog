const failure=(status,message)=>Object.assign(new Error(message),{status})
const action='admin-login'

export function turnstileConfig(env=process.env) {
  if(env.TURNSTILE_REQUIRED&&!['true','false'].includes(env.TURNSTILE_REQUIRED))throw new Error('TURNSTILE_REQUIRED 必须为 true 或 false')
  const siteKey=env.TURNSTILE_SITE_KEY||'',secret=env.TURNSTILE_SECRET_KEY||''
  if(!siteKey&&!secret&&env.TURNSTILE_REQUIRED!=='true')return null
  if(!siteKey||!secret)throw new Error('Turnstile 需要同时配置 Site Key 和 Secret Key')
  for(const value of [siteKey,secret]){
    if(!/^[a-zA-Z0-9_-]{10,200}$/.test(value))throw new Error('Turnstile 密钥格式不正确')
    if(/^[123]x0000000000/.test(value))throw new Error('不可使用 Turnstile 测试密钥保护后台登录')
  }
  return {siteKey,secret}
}

export function createTurnstile({env=process.env,fetchImpl=fetch,timeoutMs=8000}={}) {
  const config=turnstileConfig(env)
  let active=0
  return {
    publicConfig:config?{enabled:true,siteKey:config.siteKey,action}:{enabled:false},
    async verify(token,origin){
      if(!config)return
      if(typeof token!=='string'||!token.trim()||token.length>2048)throw failure(403,'请先完成人机验证，再登录。')
      if(active>=4)throw failure(429,'验证请求较多，请稍后再试。')
      active++
      try{
        const response=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          // Do not trust CF-Connecting-IP / X-Forwarded-For from an unverified proxy.
          body:new URLSearchParams({secret:config.secret,response:token})
        })
        if(!response.ok){await response.body?.cancel();throw failure(503,'人机验证服务暂时不可用，请稍后重试。')}
        let size=0;const chunks=[]
        for await(const chunk of response.body){size+=chunk.length;if(size>16384)throw failure(503,'人机验证返回异常，请稍后重试。');chunks.push(chunk)}
        const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const age=Date.now()-Date.parse(result?.challenge_ts)
        if(result?.success!==true||result.hostname!==new URL(origin).hostname||result.action!==action||!Number.isFinite(age)||age>300000||age< -30000){
          throw failure(403,'人机验证未通过或已过期，请重新验证。')
        }
      }catch(error){
        if(error.status)throw error
        // Never log or return the secret, submitted token or provider response.
        throw failure(503,'暂时无法完成人机验证，请稍后重试。')
      }finally{active--}
    }
  }
}
