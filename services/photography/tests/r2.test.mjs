import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {once} from 'node:events'
import {Readable} from 'node:stream'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {createPortfolioServer} from './helpers/database.mjs'
import {createMediaStorage,mediaKey} from '../server/storage.mjs'
import {r2Config} from '../server/r2-client.mjs'

function fakeR2() {
  const objects=new Map(),calls=[]
  const client={
    failing:false,
    destroy() {},
    async send(command) {
      const {Key,Body,Metadata,ContentLength,ContentMD5}=command.input
      calls.push(command.constructor.name)
      if(client.failing) throw Object.assign(new Error('do not expose secret request'),{$metadata:{httpStatusCode:503}})
      if(command.constructor.name==='HeadBucketCommand') return {}
      if(command.constructor.name==='PutObjectCommand') {
        const chunks=[]
        for await(const chunk of Body) chunks.push(chunk)
        const bytes=Buffer.concat(chunks)
        assert.equal(ContentLength,bytes.length)
        assert.equal(ContentMD5,createHash('md5').update(bytes).digest('base64'))
        objects.set(Key,{bytes,Metadata})
        return {}
      }
      const value=objects.get(Key)
      if(!value) throw Object.assign(new Error('not found'),{$metadata:{httpStatusCode:404}})
      return {ContentLength:value.bytes.length,Metadata:value.Metadata,...(command.constructor.name==='GetObjectCommand'?{Body:Readable.from([value.bytes])}:{})}
    }
  }
  return {bucket:'test-photos',client,objects,calls}
}

test('R2 configuration rejects unsafe keys and endpoints; errors omit SDK details',async()=>{
  for(const key of ['../secret','masters/../secret','masters//x','masters/./x','masters/x\\y','/masters/x','other/x','masters/x\0']) assert.throws(()=>mediaKey(key))
  assert.equal(mediaKey('masters/abc/original.jpg'),'masters/abc/original.jpg')
  const env={R2_ENDPOINT:'https://test.r2.cloudflarestorage.com',R2_BUCKET:'test-photos',R2_ACCESS_KEY_ID:'fake',R2_SECRET_ACCESS_KEY:'fake'}
  assert.equal(r2Config(env).clientOptions.region,'auto')
  for(const endpoint of ['http://test.r2.cloudflarestorage.com','https://evil.test','https://test.r2.cloudflarestorage.com@evil.test','https://test.r2.cloudflarestorage.com/path']) assert.throws(()=>r2Config({...env,R2_ENDPOINT:endpoint}))
  assert.throws(()=>createMediaStorage('/tmp',{driver:'typo'}))
  const connection=fakeR2(),storage=createMediaStorage('/tmp',{driver:'r2',connection})
  await assert.rejects(storage.open('masters/missing.jpg'),e=>e.status===404)
  connection.client.failing=true
  await assert.rejects(storage.check(),e=>e.status===503&&!e.message.includes('secret'))
})

test('R2 import, private media, master download, details, versions, backup and restore',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-r2-test-'))
  const dataDir=path.join(dir,'data'),nas=path.join(dir,'nas'),connection=fakeR2()
  await fs.mkdir(nas)
  const app=await createPortfolioServer({dataDir,nasRoot:nas,seed:false,media:{driver:'r2',connection}})
  app.server.listen(0,'127.0.0.1')
  await once(app.server,'listening')
  const base=`http://127.0.0.1:${app.server.address().port}`
  let cookie=''
  async function req(route,{method='GET',data,body,auth=true}={}) {
    const response=await fetch(base+route,{method,headers:{...(auth?{Cookie:cookie}:{}),Origin:base,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body})
    const value=method==='HEAD'?null:(response.headers.get('content-type')||'').includes('json')?await response.json():Buffer.from(await response.arrayBuffer())
    return {status:response.status,value,response}
  }
  async function job(id) {
    await app.processor.idle()
    const result=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id)
    assert.equal(result.status,'ready',result.error)
    return (await req('/api/admin/photos/'+result.photo_id)).value
  }
  try {
    const setup=await req('/api/setup',{method:'POST',data:{password:'r2-integration-passphrase'}})
    cookie=setup.response.headers.get('set-cookie').split(';')[0]
    assert.equal((await req('/api/health')).value.storage,'r2')
    const original=await sharp({create:{width:280,height:180,channels:3,background:'#379c68'}}).jpeg().toBuffer()
    let photo=await job((await req('/api/admin/uploads?name=photo.jpg',{method:'POST',body:original})).value.id)
    assert.equal(connection.objects.size,5)
    for(const name of ['masters','derivatives','inspection']) await assert.rejects(fs.access(path.join(dataDir,name)))
    assert.deepEqual(await fs.readdir(path.join(dataDir,'tmp')),[])
    assert.equal((await req('/'+photo.src,{auth:false})).status,404)
    assert.equal((await req('/'+photo.src,{method:'HEAD',auth:false})).status,404)
    assert.equal((await req('/api/admin/masters/'+photo.id,{auth:false})).status,401)
    assert.deepEqual((await req('/api/admin/masters/'+photo.id)).value,original)
    assert.equal((await req('/'+photo.src,{method:'HEAD'})).status,200)
    assert.equal((await sharp((await req('/api/admin/photos/'+photo.id+'/detail')).value).metadata()).width,280)
    assert.deepEqual(await fs.readdir(path.join(dataDir,'tmp')),[])
    photo=(await req('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,status:'published'}})).value
    assert.equal((await req('/'+photo.src,{auth:false})).status,200)
    connection.client.failing=true
    assert.equal((await req('/'+photo.src,{auth:false})).status,503,'must not fall back to local media')
    connection.client.failing=false
    photo=(await req('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,status:'draft'}})).value
    assert.equal((await req('/'+photo.src,{auth:false})).status,404)
    const nasBytes=await sharp({create:{width:140,height:80,channels:3,background:'#ad8690'}}).png().toBuffer()
    await fs.writeFile(path.join(nas,'source.png'),nasBytes)
    const scan=(await req('/api/admin/nas/scan',{method:'POST',data:{folder:''}})).value
    const imported=(await req('/api/admin/nas/import',{method:'POST',data:{scanId:scan.id,keys:[scan.files[0].key]}})).value
    await job(imported.jobs[0])
    assert.deepEqual(await fs.readFile(path.join(nas,'source.png')),nasBytes)
    photo=await job((await req(`/api/admin/uploads?name=revision.png&photoId=${photo.id}&version=${photo.version}`,{method:'POST',body:nasBytes})).value.id)
    const versions=(await req('/api/admin/photos/'+photo.id+'/versions')).value
    assert.equal(versions.items.length,2)
    const previous=versions.items.find(v=>!v.current)
    photo=(await req('/api/admin/photos/'+photo.id+'/versions',{method:'POST',data:{version:photo.version,assetId:previous.assetId}})).value
    assert.deepEqual((await req('/api/admin/masters/'+photo.id)).value,original)
    const backup=await req('/api/admin/backups',{method:'POST'})
    assert.equal(backup.status,200,JSON.stringify(backup.value))
    assert.equal(backup.value.files,10)
    await req('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,title:'changed'}})
    const restored=await req('/api/admin/backups/restore',{method:'POST',data:{id:backup.value.id,confirm:'恢复备份'}})
    assert.equal(restored.status,200,JSON.stringify(restored.value))
    assert.equal((await req('/api/admin/photos/'+photo.id)).value.title,photo.title)
    assert.deepEqual((await req('/api/admin/masters/'+photo.id)).value,original)
    await assert.rejects(fs.access(path.join(dataDir,'masters')))
    const usage=(await req('/api/admin/storage')).value
    assert.equal(usage.driver,'r2')
    assert.equal(usage.totals.masters,original.length+nasBytes.length)
    assert.ok(usage.totals.derivatives>0)
    connection.client.failing=true
    const failed=(await req('/api/admin/uploads?name=failed.jpg',{method:'POST',body:await sharp(original).negate().jpeg().toBuffer()})).value
    await app.processor.idle()
    assert.equal((await app.db.prepare('SELECT status FROM import_jobs WHERE id=?').get(failed.id)).status,'failed')
    assert.equal((await app.db.prepare('SELECT count(*) n FROM assets').get()).n,2,'failed remote uploads do not commit assets')
    assert.deepEqual(await fs.readdir(path.join(dataDir,'tmp')),[failed.id+'.upload'],'failed uploads remain retryable, processing workspace removed')
  } finally {await app.close();await fs.rm(dir,{recursive:true,force:true})}
})
