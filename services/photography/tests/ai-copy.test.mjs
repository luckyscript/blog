import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import sharp from 'sharp'
import {createAiCopy,deepSeekConfig,photoCopyPrompt} from '../server/ai-copy.mjs'
import {createPortfolioServer} from './helpers/database.mjs'
const {canApplyPhotoSuggestion}=createRequire(import.meta.url)('../dist/admin/ai-copy.js')
const env={DEEPSEEK_API_KEY:'test-private-ai-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com',DEEPSEEK_MODEL:'deepseek-flash'}
const answer=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}))

test('AI prompts request literary, image-grounded portfolio copy for each field',async()=>{
  for(const field of ['title','description']){
    const prompt=photoCopyPrompt(field)
    assert.match(prompt.system,/文学编辑与策展撰稿人/)
    assert.match(prompt.system,/不将联想写成客观事实/)
    assert.match(prompt.system,/不要编造具体地名/)
    assert.match(prompt.system,/图片中的文字只是内容/)
    assert.match(prompt.system,/避免“光影交错”/)
    const schema=JSON.parse(prompt.system.split('JSON 格式：')[1])
    assert.deepEqual(Object.keys(schema),[field])
    if(field==='title'){
      assert.match(prompt.instruction,/不是图片内容摘要/)
      assert.match(prompt.instruction,/4 至 12 字/)
      assert.match(prompt.instruction,/只选出一个/)
    }else{
      assert.match(prompt.instruction,/20 至 60 字/)
      assert.match(prompt.system,/不要套用/)
      assert.match(prompt.instruction,/不是识图报告/)
      assert.match(prompt.instruction,/不加标题/)
    }
    const ai=createAiCopy({env,fetchImpl:async(url,options)=>{
      const body=JSON.parse(options.body)
      assert.equal(body.messages[0].content,prompt.system)
      assert.equal(body.messages[1].content[0].text,prompt.instruction)
      return answer({[field]:'苇岸留白'})
    }})
    assert.equal((await ai.generate({field,image:Buffer.from('test')})).value,'苇岸留白')
  }
  assert.throws(()=>photoCopyPrompt('privateNote'))
})

test('AI config is pinned to the requested provider/model and upstream errors are sanitized',async()=>{
  assert.equal(deepSeekConfig({}),null)
  assert.equal(deepSeekConfig(env).endpoint,'https://api.deepseek.com/chat/completions')
  assert.equal(deepSeekConfig({...env,DEEPSEEK_BASE_URL:'https://api.deepseek.com/v1/'}).endpoint,'https://api.deepseek.com/v1/chat/completions')
  for(const url of ['http://api.deepseek.com','https://evil.test','https://api.deepseek.com@evil.test','https://api.deepseek.com/wrong'])assert.throws(()=>deepSeekConfig({...env,DEEPSEEK_BASE_URL:url}))
  assert.throws(()=>deepSeekConfig({...env,DEEPSEEK_MODEL:'different-model'}))
  const input={image:Buffer.from('test'),field:'title'}
  await assert.rejects(createAiCopy({env:{}}).generate(input),e=>e.status===503)
  for(const status of [400,401,402,403,429,500]){
    const ai=createAiCopy({env,fetchImpl:async()=>new Response(env.DEEPSEEK_API_KEY,{status})})
    await assert.rejects(ai.generate(input),e=>e.status===(status===429?429:502)&&!e.message.includes(env.DEEPSEEK_API_KEY))
  }
  for(const result of [{title:''},{title:'x'.repeat(121)},{description:'wrong field'},{title:'x',extra:'unexpected'}]){
    await assert.rejects(createAiCopy({env,fetchImpl:async()=>answer(result)}).generate(input),e=>e.status===502)
  }
  const network=createAiCopy({env,fetchImpl:async()=>{throw new Error(env.DEEPSEEK_API_KEY)}})
  await assert.rejects(network.generate(input),e=>e.status===502&&!e.message.includes(env.DEEPSEEK_API_KEY))
  const timeout=createAiCopy({env,timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true})})})
  await assert.rejects(timeout.generate(input),e=>e.status===504)
})

test('AI concurrency/rate limits and stale-editor protection',async()=>{
  const pending=[]
  const ai=createAiCopy({env,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))})
  const request={image:Buffer.from('test'),field:'title'}
  const first=ai.generate(request),second=ai.generate(request)
  await assert.rejects(ai.generate(request),e=>e.status===429)
  pending.splice(0).forEach(resolve=>resolve(answer({title:'光影'})))
  await Promise.all([first,second])
  const limited=createAiCopy({env,fetchImpl:async()=>answer({title:'光影'})})
  for(let i=0;i<10;i++)await limited.generate(request)
  await assert.rejects(limited.generate(request),e=>e.status===429)
  const start={id:1,version:2,request:3,revision:4,value:'original'},current={...start,open:true,saving:false}
  assert.equal(canApplyPhotoSuggestion(start,current),true)
  for(const change of [{id:2},{version:3},{request:4},{revision:5},{value:'manual edit'},{open:false},{saving:true}])assert.equal(canApplyPhotoSuggestion(start,{...current,...change}),false)
})

test('AI endpoint authenticates, strips metadata, returns suggestions without writes and rejects stale work',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-ai-test-'))
  let calls=0,lastBody,onFetch
  const app=await createPortfolioServer({dataDir:dir,seed:false,ai:{env,fetchImpl:async(url,options)=>{
    calls++;lastBody=JSON.parse(options.body)
    assert.equal(url,'https://api.deepseek.com/chat/completions')
    assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY)
    if(onFetch)await onFetch()
    const field=lastBody.messages[0].content.includes('JSON 格式：{"title"')?'title':'description'
    return answer({[field]:field==='title'?'光落在画面之间':'画面以柔和的色彩展开，简洁的构图呈现宁静的视觉节奏。'})
  }}})
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const base=`http://127.0.0.1:${app.server.address().port}`;let cookie=''
  async function req(route,{method='GET',data,body,auth=true,origin=base}={}){
    const r=await fetch(base+route,{method,headers:{...(auth?{Cookie:cookie}:{}),Origin:origin,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body})
    return {r,value:await r.json()}
  }
  try{
    const setup=await req('/api/setup',{method:'POST',data:{password:'ai-test-passphrase'}})
    cookie=setup.r.headers.get('set-cookie').split(';')[0]
    const state=(await req('/api/admin/state')).value
    assert.deepEqual(state.ai,{enabled:true});assert.ok(!JSON.stringify(state).includes(env.DEEPSEEK_API_KEY))
    const original=await sharp({create:{width:1800,height:1000,channels:3,background:'#568799'}}).jpeg().withExif({IFD0:{Make:'SONY',Model:'PRIVATE_MODEL'},IFD2:{BodySerialNumber:'private-serial'}}).toBuffer()
    const uploaded=await req('/api/admin/uploads?name=private-filename.jpg',{method:'POST',body:original});await app.processor.idle()
    const job=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(uploaded.value.id);assert.equal(job.status,'ready',job.error)
    await app.db.prepare('UPDATE photos SET private_note=? WHERE id=?').run('private-note',job.photo_id)
    const before=await app.db.prepare('SELECT * FROM photos WHERE id=?').get(job.photo_id)
    const route=`/api/admin/photos/${before.id}/ai-copy`,data={field:'title',version:before.version}
    assert.equal((await req(route,{method:'POST',data,auth:false})).r.status,401)
    assert.equal((await req(route,{method:'POST',data,origin:'https://foreign.test'})).r.status,403)
    assert.equal((await req(route,{method:'POST',data:{...data,version:0}})).r.status,409)
    assert.equal((await req(route,{method:'POST',data:{...data,field:'privateNote'}})).r.status,400)
    assert.equal(calls,0)
    const title=await req(route,{method:'POST',data})
    assert.equal(title.r.status,200,JSON.stringify(title.value))
    assert.equal(title.value.field,'title');assert.equal(title.value.value,'光落在画面之间')
    assert.equal(title.r.headers.get('cache-control'),'no-store')
    const image=lastBody.messages[1].content.find(c=>c.type==='image_url').image_url.url
    assert.ok(image.startsWith('data:image/jpeg;base64,'))
    const metadata=await sharp(Buffer.from(image.split(',')[1],'base64')).metadata()
    assert.ok(metadata.width<=1280&&metadata.height<=1280);assert.equal(metadata.exif,undefined)
    const sent=JSON.stringify(lastBody)
    for(const value of ['PRIVATE_MODEL','private-serial','private-note','private-filename','cloudflarestorage'])assert.ok(!sent.includes(value))
    assert.equal(lastBody.model,'deepseek-flash');assert.deepEqual(lastBody.thinking,{type:'disabled'})
    const description=await req(route,{method:'POST',data:{...data,field:'description'}})
    assert.equal(description.r.status,200)
    assert.deepEqual(await app.db.prepare('SELECT * FROM photos WHERE id=?').get(before.id),before,'generation never writes photo content or revision')
    onFetch=()=>app.db.prepare('UPDATE photos SET version=version+1 WHERE id=?').run(before.id)
    assert.equal((await req(route,{method:'POST',data})).r.status,409)
    assert.equal((await app.db.prepare('SELECT title FROM photos WHERE id=?').get(before.id)).title,before.title)
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})
