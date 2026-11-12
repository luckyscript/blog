import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {once} from 'node:events'
import sharp from 'sharp'
import {displayImage,renditionVersion} from '../server/watermark.mjs'
import {rebuildRenditions} from '../server/rebuild-renditions.mjs'
import {createPortfolioServer} from './helpers/database.mjs'

test('display watermark is burned into the bottom-right after orientation, including tiny photos',async()=>{
  const original=await sharp({create:{width:600,height:400,channels:3,background:'#203040'}}).jpeg().withExif({IFD0:{Make:'SONY',Model:'ILCE-7M4'}}).toBuffer()
  const output=await(await displayImage(original,{width:300,format:'webp'})).toBuffer()
  const metadata=await sharp(output).metadata()
  assert.equal(metadata.width,300)
  assert.equal(metadata.height,200)
  assert.equal(metadata.exif,undefined)
  const region=await sharp(output).extract({left:215,top:155,width:80,height:40}).raw().toBuffer()
  assert.ok(region.some(n=>n>140),'watermark has light pixels inside the image')
  const untouched=await sharp(output).extract({left:0,top:0,width:100,height:100}).raw().toBuffer()
  assert.ok(untouched.every(n=>n<100),'watermark does not cover the central subject')
  const rotated=await sharp(original).withMetadata({orientation:6}).jpeg().toBuffer()
  const portrait=await sharp(await(await displayImage(rotated,{width:300})).toBuffer()).metadata()
  assert.deepEqual([portrait.width,portrait.height],[200,300])
  for(const [width,height] of [[1,1],[2,20],[20,2],[10,10]]){
    const input=await sharp({create:{width,height,channels:3,background:'#fff'}}).png().toBuffer()
    const meta=await sharp(await(await displayImage(input)).toBuffer()).metadata()
    assert.deepEqual([meta.width,meta.height],[width,height])
  }
})

test('unmatched cameras fall back to EXIF; legacy rendition rebuild is atomic and preserves masters',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-watermark-test-'))
  const app=await createPortfolioServer({dataDir:dir,seed:false})
  app.server.listen(0,'127.0.0.1')
  await once(app.server,'listening')
  const base=`http://127.0.0.1:${app.server.address().port}`
  let cookie=''
  async function req(route,{method='GET',data,body}={}){
    const r=await fetch(base+route,{method,headers:{Cookie:cookie,Origin:base,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body})
    const value=(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())
    return {r,value}
  }
  async function upload(bytes,name){
    const result=await req('/api/admin/uploads?name='+name,{method:'POST',body:bytes})
    await app.processor.idle()
    const job=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(result.value.id)
    assert.equal(job.status,'ready',job.error)
    return (await req('/api/admin/photos/'+job.photo_id)).value
  }
  try {
    const setup=await req('/api/setup',{method:'POST',data:{password:'watermark-test-password'}})
    cookie=setup.r.headers.get('set-cookie').split(';')[0]
    const original=await sharp({create:{width:400,height:300,channels:3,background:'#233443'}}).jpeg().withExif({IFD0:{Make:'SONY',Model:'ILCE-7M4'}}).toBuffer()
    let photo=await upload(original,'sony.jpg')
    assert.equal(photo.equipmentId,null)
    assert.equal(photo.equipmentName,'SONY ILCE-7M4')
    assert.equal(photo.metadataCamera,'SONY ILCE-7M4')
    assert.equal(photo.equipmentSource,'exif')
    photo=(await req('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,title:'After editing',equipmentId:''}})).value
    assert.equal(photo.equipmentName,'SONY ILCE-7M4')
    photo=(await req('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,equipmentId:'nikon-d850'}})).value
    assert.equal(photo.equipmentSource,'catalog')
    assert.match(photo.equipmentName,/D850/)
    assert.equal(photo.metadataCamera,'SONY ILCE-7M4','manual choice does not overwrite EXIF')
    const missing=await upload(await sharp(original).negate().png().toBuffer(),'no-exif.png')
    assert.equal(missing.equipmentName,null)
    assert.equal(missing.equipmentSource,'unknown')
    assert.deepEqual((await req('/api/admin/masters/'+photo.id)).value,original)
    const rows=await app.db.prepare('SELECT * FROM renditions').all()
    assert.ok(rows.every(r=>r.path.includes('/'+renditionVersion+'/')))
    assert.ok(photo.src.endsWith('?v='+renditionVersion))
    // Model a pre-watermark library with reversible legacy paths.
    for(const row of rows){
      const old=row.path.replace('/'+renditionVersion+'/','/v1/')
      const out=path.join(dir,old)
      await fs.mkdir(path.dirname(out),{recursive:true})
      await sharp(original).resize({width:row.width,height:row.height,fit:'fill'}).toFormat(row.format).toFile(out)
      await app.db.prepare('UPDATE renditions SET path=? WHERE id=?').run(old,row.id)
    }
    const before=await app.db.prepare('SELECT * FROM renditions ORDER BY id').all()
    assert.equal((await rebuildRenditions(app.db,app.storage,dir)).assets,2)
    const failing={...app.storage,async putFile(){throw new Error('simulated upload failure')}}
    await assert.rejects(rebuildRenditions(app.db,failing,dir,{apply:true}),/simulated/)
    assert.deepEqual(await app.db.prepare('SELECT * FROM renditions ORDER BY id').all(),before,'remote failure never switches DB paths')
    const rebuilt=await rebuildRenditions(app.db,app.storage,dir,{apply:true})
    assert.equal(rebuilt.updated,8)
    const checkpoint=JSON.parse(await fs.readFile(rebuilt.checkpoint,'utf8'))
    assert.deepEqual(checkpoint.renditions,JSON.parse(JSON.stringify(before)))
    assert.equal((await rebuildRenditions(app.db,app.storage,dir,{apply:true})).updated,0,'rebuild is idempotent')
    for(const row of before)assert.ok((await fs.stat(path.join(dir,row.path))).isFile(),'old objects kept for rollback')
    assert.deepEqual((await req('/api/admin/masters/'+photo.id)).value,original)
    assert.deepEqual(await fs.readdir(path.join(dir,'tmp')),[])
  }finally{await app.close();await fs.rm(dir,{recursive:true,force:true})}
})
