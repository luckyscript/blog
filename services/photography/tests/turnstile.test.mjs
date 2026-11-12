import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {createTurnstile,turnstileConfig} from '../server/turnstile.mjs'
import {createAuth,createLoginLimiter} from '../server/auth.mjs'
import {createPortfolioServer} from './helpers/database.mjs'
const {createLoginChallenge}=createRequire(import.meta.url)('../dist/admin/turnstile.js')
const env={TURNSTILE_REQUIRED:'true',TURNSTILE_SITE_KEY:'fixture-public-site-key',TURNSTILE_SECRET_KEY:'fixture-private-secret-key'}
const valid=(hostname='127.0.0.1')=>({success:true,hostname,action:'admin-login',challenge_ts:new Date().toISOString()})
const answer=value=>new Response(JSON.stringify(value))
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()}

test('Turnstile config is explicit, rejects partial/test keys and exposes no secret',async()=>{
  assert.equal(turnstileConfig({}),null)
  for(const bad of [{TURNSTILE_REQUIRED:'true'},{TURNSTILE_REQUIRED:'yes'},{TURNSTILE_SITE_KEY:env.TURNSTILE_SITE_KEY},{TURNSTILE_SECRET_KEY:env.TURNSTILE_SECRET_KEY},{...env,TURNSTILE_SITE_KEY:'1x00000000000000000000AA'},{...env,TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA'}])assert.throws(()=>turnstileConfig(bad))
  const disabled=createTurnstile({env:{},fetchImpl:()=>{throw new Error('must not fetch')}})
  await disabled.verify(undefined,'http://127.0.0.1')
  assert.deepEqual(disabled.publicConfig,{enabled:false})
  assert.deepEqual(createTurnstile({env}).publicConfig,{enabled:true,siteKey:env.TURNSTILE_SITE_KEY,action:'admin-login'})
})

test('server validates token, hostname, action and age and fails closed on provider errors',async()=>{
  let calls=0
  const challenge=createTurnstile({env,fetchImpl:async(url,options)=>{
    calls++
    assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error')
    assert.equal(options.body.get('secret'),env.TURNSTILE_SECRET_KEY)
    assert.equal(options.body.get('response'),'valid-token')
    assert.equal(options.body.has('remoteip'),false)
    return answer(valid())
  }})
  for(const token of [undefined,'',' ',{},'x'.repeat(2049)])await assert.rejects(challenge.verify(token,'http://127.0.0.1'),e=>e.status===403)
  assert.equal(calls,0)
  await challenge.verify('valid-token','http://127.0.0.1:3009');assert.equal(calls,1)
  for(const change of [{success:false},{success:'true'},{hostname:'evil.test'},{action:'other-form'},{challenge_ts:'invalid'},{challenge_ts:new Date(Date.now()-301000).toISOString()},{challenge_ts:new Date(Date.now()+60000).toISOString()}]){
    await assert.rejects(createTurnstile({env,fetchImpl:async()=>answer({...valid(),...change})}).verify('token','http://127.0.0.1'),e=>e.status===403)
  }
  for(const response of [()=>new Response(env.TURNSTILE_SECRET_KEY,{status:503}),()=>new Response('not JSON'),()=>new Response('x'.repeat(17000))]){
    await assert.rejects(createTurnstile({env,fetchImpl:async()=>response()}).verify('token','http://127.0.0.1'),e=>e.status===503&&!e.message.includes(env.TURNSTILE_SECRET_KEY))
  }
  await assert.rejects(createTurnstile({env,fetchImpl:async()=>{throw new Error(env.TURNSTILE_SECRET_KEY)}}).verify('token','http://127.0.0.1'),e=>e.status===503&&!e.message.includes(env.TURNSTILE_SECRET_KEY))
  const timeout=createTurnstile({env,timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true})})})
  await assert.rejects(timeout.verify('token','http://127.0.0.1'),e=>e.status===503)
})

test('concurrency is bounded and login rate limits are shared without trusting forwarded headers',async()=>{
  const pending=[],challenge=createTurnstile({env,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))})
  const requests=Array.from({length:4},()=>challenge.verify('token','http://127.0.0.1'))
  await assert.rejects(challenge.verify('token','http://127.0.0.1'),e=>e.status===429)
  pending.forEach(resolve=>resolve(answer(valid())));await Promise.all(requests)
  const limiter=createLoginLimiter(),db={prepare(){throw new Error('must not query passwords before challenge')}}
  const rejecting={verify:async()=>{throw Object.assign(new Error('rejected'),{status:403})}}
  const auth=createAuth(db,'https://see.jsjhlk.com',{limiter,challenge:rejecting})
  const tunnel=createAuth(db,'http://127.0.0.1',{limiter,challenge:rejecting})
  const req=i=>({headers:{origin:'https://see.jsjhlk.com','x-forwarded-for':'1.2.3.'+i,'cf-connecting-ip':'1.2.3.'+i},socket:{remoteAddress:'127.0.0.1'}})
  for(let i=0;i<10;i++)await assert.rejects(auth.signIn(req(i),'password',false,'token'),e=>e.status===403)
  await assert.rejects(auth.signIn(req(11),'password',false,'token'),e=>e.status===429)
  await assert.rejects(tunnel.signIn({...req(12),headers:{origin:'http://127.0.0.1'}},'password',false,'token'),e=>e.status===429)
  await assert.rejects(auth.signIn({...req(13),headers:{origin:'https://evil.test'}},'password',false,'token'),e=>e.status===403)
})

test('login API cannot bypass challenge and creates sessions only with a valid token and password',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-turnstile-'))
  let calls=0
  const spent=new Set()
  const app=await createPortfolioServer({dataDir:dir,seed:false,turnstile:{env,fetchImpl:async(url,{body})=>{
    calls++;const token=body.get('response')
    if(!token.startsWith('valid-')||spent.has(token))return answer({success:false,'error-codes':['timeout-or-duplicate']})
    spent.add(token);return answer(valid())
  }}})
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const base='http://127.0.0.1:'+app.server.address().port
  const password='private-integration-password'
  const post=(route,data,origin=base)=>fetch(base+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)})
  const sessions=async()=>(await app.db.prepare('SELECT count(*) AS n FROM sessions').get()).n
  try{
    const setup=await post('/api/setup',{password});assert.equal(setup.status,200)
    const cookie=setup.headers.get('set-cookie').split(';')[0]
    await fetch(base+'/api/logout',{method:'POST',headers:{Origin:base,Cookie:cookie}})
    assert.equal(await sessions(),0)
    const sessionResponse=await fetch(base+'/api/session'),session=await sessionResponse.json()
    assert.equal(sessionResponse.headers.get('cache-control'),'no-store')
    assert.deepEqual(session.turnstile,{enabled:true,siteKey:env.TURNSTILE_SITE_KEY,action:'admin-login'})
    assert.ok(!JSON.stringify(session).includes(env.TURNSTILE_SECRET_KEY))
    assert.equal((await post('/api/login',{password})).status,403);assert.equal(calls,0)
    assert.equal((await post('/api/login',{password,turnstileToken:'forged'})).status,403)
    assert.equal((await post('/api/setup',{password})).status,409,'setup cannot log into an existing account')
    assert.equal((await post('/api/login',{password,turnstileToken:'valid-foreign'},'https://evil.test')).status,403)
    assert.equal(calls,1,'CSRF and setup do not reach provider')
    assert.equal((await post('/api/login',{password:'wrong',turnstileToken:'valid-once'})).status,401)
    assert.equal(await sessions(),0)
    assert.equal((await post('/api/login',{password,turnstileToken:'valid-once'})).status,403,'spent token cannot be reused after wrong password')
    const login=await post('/api/login',{password,turnstileToken:'valid-new'})
    assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
    assert.equal(await sessions(),1)
    assert.equal((await fetch(base+'/api/admin/state')).status,401)
    assert.equal((await fetch(base+'/api/admin/state',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}})).status,200)
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})

test('login widget blocks submission, clears expired/spent tokens and ignores old widget callbacks',async()=>{
  const elements=new Map()
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn}})
    return elements.get(selector)
  }
  let renders=[],resets=0,removed=[]
  element('#login-challenge').clientWidth=240
  const browserEnv={document:{querySelector:element},turnstile:{render(container,options){assert.equal(options.sitekey,env.TURNSTILE_SITE_KEY);assert.equal(options.size,'compact');renders.push(options);return renders.length-1},remove:id=>removed.push(id),reset(){resets++}}}
  const ui=createLoginChallenge(browserEnv)
  await ui.configure({enabled:true,siteKey:env.TURNSTILE_SITE_KEY})
  assert.equal(element('#auth-submit').disabled,true);assert.throws(()=>ui.getToken())
  renders[0].callback('first-token');assert.equal(ui.getToken(),'first-token');assert.equal(element('#auth-submit').disabled,false)
  ui.setSubmitting(true);assert.equal(element('#auth-submit').disabled,true)
  ui.reset();ui.setSubmitting(false);assert.equal(resets,1);assert.throws(()=>ui.getToken())
  renders[0].callback('new-token');renders[0]['expired-callback']();assert.throws(()=>ui.getToken())
  assert.equal(element('#challenge-retry').hidden,false)
  await ui.configure({enabled:true,siteKey:env.TURNSTILE_SITE_KEY})
  renders[0].callback('stale-token');assert.throws(()=>ui.getToken())
  renders[1]['error-callback']();assert.equal(element('#auth-submit').disabled,true)
  element('#challenge-retry').listeners.click();await flush()
  renders[2].callback('latest');assert.equal(ui.getToken(),'latest')
  await ui.configure({enabled:false});assert.equal(ui.getToken(),undefined);assert.equal(element('#auth-submit').disabled,false)
  assert.equal(element('#challenge-box').hidden,true);assert.deepEqual(removed,[0,1,2])
})

test('blocked widget script never enables login and can be retried without stale initialization',async()=>{
  const elements=new Map(),scripts=[],timers=new Map()
  let id=0,renders=0
  const element=selector=>{
    if(!elements.has(selector))elements.set(selector,{hidden:false,disabled:false,textContent:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn}})
    return elements.get(selector)
  }
  const browserEnv={document:{querySelector:element,createElement:()=>({remove(){this.removed=true}}),head:{append:script=>scripts.push(script)}},
    setTimeout:(fn,ms)=>{timers.set(++id,fn);return id},clearTimeout:timer=>timers.delete(timer)}
  const ui=createLoginChallenge(browserEnv)
  const configuring=ui.configure({enabled:true,siteKey:env.TURNSTILE_SITE_KEY})
  assert.match(scripts[0].src,/^https:\/\/challenges.cloudflare.com\//)
  scripts[0].onerror();await configuring
  assert.equal(element('#auth-submit').disabled,true);assert.throws(()=>ui.getToken())
  assert.equal(element('#challenge-retry').hidden,false)
  assert.equal(scripts[0].removed,true)
  const retrying=ui.configure({enabled:true,siteKey:env.TURNSTILE_SITE_KEY})
  await ui.configure({enabled:false})
  browserEnv.turnstile={render(){renders++;return 0},remove(){}}
  browserEnv.jianshanTurnstileReady();await retrying
  assert.equal(renders,0,'logout or session changes cancel pending widget initialization')
  assert.equal(element('#auth-submit').disabled,false)
  assert.equal(timers.size,0)
})
