import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {createPortfolioServer} from '../server/index.mjs'
import {publicData,listPhotos,photoData,photosData,updatePhoto,saveCollection} from '../server/model.mjs'

async function fixture(count=12) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'photography-perf-'))
  const app=await createPortfolioServer({dataDir:directory,seed:false})
  const now=new Date().toISOString()
  for(let i=0;i<count;i++){
    const hash=createHash('sha256').update('isolated original '+i).digest('hex')
    await app.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)').run(hash,hash,`masters/${hash}/original.jpg`,`private-file-${i}.jpg`,'jpeg',1024,1200,800,'{}',now)
    for(const [width,format] of [[640,'webp'],[1280,'webp'],[2560,'webp'],[2560,'jpeg']]){
      const name=`derivatives/${hash}/brand-v2/${width}.${format}`
      await app.db.prepare('INSERT INTO renditions VALUES(?,?,?,?,?,?)').run(`${hash}-${width}-${format}`,hash,width,Math.round(width*2/3),format,name)
      const file=path.join(directory,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'isolated display bytes '+i+' '+width)
    }
    await app.db.prepare('INSERT INTO photos(asset_id,title,description,status,equipment_id,exif,rating,private_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(hash,'作品 '+i,`private-file-${i}`,i===count-1?'draft':'published','nikon-d850',JSON.stringify({Make:'NIKON CORPORATION',Model:'NIKON D850'}),5,'PRIVATE_NOTE_'+i,now,now)
  }
  return {app,directory,async close(){await app.processor.close();await app.previews?.close();await app.db.close();app.storage.close();await fs.rm(directory,{recursive:true,force:true})}}
}
test('batch hydration preserves metadata and privacy with query count independent of photo count',async()=>{
  const f=await fixture()
  try{
    const rows=await f.app.db.prepare('SELECT * FROM photos ORDER BY id').all()
    await saveCollection(f.app.db,null,{slug:'public-album',title:'公开合集',status:'published',photos:rows.map(r=>r.id)})
    for(const admin of [false,true]){
      const single=[];for(const row of rows)single.push(await photoData(f.app.db,row,admin))
      let queries=0
      const counted={...f.app.db,prepare(sql){queries++;return f.app.db.prepare(sql)}}
      assert.deepEqual(await photosData(counted,rows,admin),single)
      assert(queries<=4,`hydration executed ${queries} queries`)
      queries=0
      const list=await listPhotos(counted,new URLSearchParams('limit=60'),admin)
      assert.equal(list.total,admin?12:11)
      assert(queries<=6,`list executed ${queries} queries`)
      if(!admin)assert(!JSON.stringify(list).includes('PRIVATE_NOTE_'))
    }
    let queries=0
    const counted={...f.app.db,prepare(sql){queries++;return f.app.db.prepare(sql)}}
    const site=await publicData(counted)
    assert.equal(site.photos.length,11);assert.equal(site.albums[0].photos.length,11)
    assert(queries<=7,`public site executed ${queries} queries`)
    assert(!JSON.stringify(site).includes('PRIVATE_NOTE_'))
    const current=await f.app.db.prepare('SELECT version FROM photos WHERE id=?').get(rows[0].id)
    await updatePhoto(f.app.db,rows[0].id,{version:current.version,status:'draft'})
    assert.equal((await publicData(f.app.db)).photos.length,10,'unpublishing is visible immediately without a stale cache')
  }finally{await f.close()}
})
test('image revalidation saves the body while checking publication and login before every 304',async()=>{
  const f=await fixture(1)
  const {app}=f
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const origin='http://127.0.0.1:'+app.server.address().port
  try{
    let row=await app.db.prepare('SELECT * FROM photos LIMIT 1').get()
    row=await updatePhoto(app.db,row.id,{version:row.version,status:'published'})
    const route='/'+row.src
    const first=await fetch(origin+route);assert.equal(first.status,200);await first.arrayBuffer()
    assert.equal(first.headers.get('cache-control'),'private, no-cache')
    assert.equal(first.headers.get('vary'),'Cookie')
    const tag=first.headers.get('etag');assert(tag)
    const cached=await fetch(origin+route,{headers:{'if-none-match':`"unrelated", ${tag}`}})
    assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0)
    await updatePhoto(app.db,row.id,{version:row.version,status:'draft'})
    assert.equal((await fetch(origin+route,{headers:{'if-none-match':tag}})).status,404,'revoked image cannot get a 304')
    const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:'isolated-perf-test-password'})})
    const cookie=setup.headers.get('set-cookie').split(';')[0];await setup.arrayBuffer()
    const privateImage=await fetch(origin+route,{headers:{cookie,'if-none-match':tag}})
    assert.equal(privateImage.status,200);assert.equal(privateImage.headers.get('cache-control'),'private, no-store');assert.equal(privateImage.headers.get('etag'),null);await privateImage.arrayBuffer()
    const head=await fetch(origin+route,{method:'HEAD',headers:{cookie}});assert.equal(head.status,200);assert.equal(head.headers.get('etag'),null)
    const master=await fetch(origin+'/api/admin/masters/'+row.id);assert.equal(master.status,401)
  }finally{await app.close();await fs.rm(f.directory,{recursive:true,force:true})}
})
