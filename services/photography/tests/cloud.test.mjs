import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {copyCloudMedia,fileHashes,recordsDigest} from '../server/cloud-migrate.mjs'
import {expiredAutomaticBackups,uploadArchive} from '../server/cloud-backup.mjs'
import {openDatabase} from '../server/db.mjs'
import {createPortfolioServer} from '../server/index.mjs'
import {once} from 'node:events'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
test('migration CLI still executes when launched through the current release symlink',async()=>{
  const target=await fs.mkdtemp(path.join(os.tmpdir(),'photography-cli-'))
  try{
    const link=path.join(target,'cloud-migrate.mjs')
    await fs.symlink(fileURLToPath(new URL('../server/cloud-migrate.mjs',import.meta.url)),link)
    const result=spawnSync(process.execPath,[link,'verify'],{encoding:'utf8'})
    assert.equal(result.status,1,'invalid arguments must fail before opening a database')
    assert.match(result.stderr,/迁移未通过校验/)
  }finally{await fs.rm(target,{recursive:true,force:true})}
})
test('read-only preflight does not start import jobs or accept writes',async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'photography-preflight-'))
  const db=await openDatabase(dataDir,{seed:false})
  await db.prepare('INSERT INTO import_jobs(id,filename,source_type,source_path,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('qa-job','missing.jpg','upload','/no-such-qa-file',new Date().toISOString(),new Date().toISOString())
  await db.close()
  const app=await createPortfolioServer({dataDir,seed:false,readOnly:true})
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const origin='http://127.0.0.1:'+app.server.address().port
  try{
    assert.equal((await fetch(origin+'/api/photos')).status,200)
    assert.equal((await fetch(origin+'/api/admin/uploads?name=qa.jpg',{method:'POST',body:'qa'})).status,503)
    assert.equal((await app.db.prepare('SELECT status FROM import_jobs WHERE id=?').get('qa-job')).status,'queued')
  }finally{await app.close();await fs.rm(dataDir,{recursive:true,force:true})}
})
test('cloud media migration verifies content, resumes, and preserves originals on corruption',async()=>{
  const target=await fs.mkdtemp(path.join(os.tmpdir(),'photography-cloud-'))
  const key='masters/abc/original.jpg',bytes=Buffer.from('original photo bytes')
  const records={assets:[{master_path:key,sha256:digest(bytes)}],renditions:[]}
  let downloads=0
  const source={async download(name,destination){assert.equal(name,key);downloads++;await fs.writeFile(destination,bytes,{flag:'wx'})}}
  const head=async()=>({bytes:bytes.length,sha256:digest(bytes)})
  try{
    const first=await copyCloudMedia({records,target,source,head})
    assert.equal(first[0].sha256,digest(bytes))
    assert.equal((await fileHashes(path.join(target,key))).bytes,bytes.length)
    await copyCloudMedia({records,target,source,head})
    assert.equal(downloads,1,'matching files are not downloaded again')
    const changed=Buffer.from('replacement source')
    await assert.rejects(copyCloudMedia({records:{assets:[{master_path:key,sha256:digest(changed)}],renditions:[]},target,source,head:async()=>({bytes:changed.length,sha256:digest(changed)})}),/校验失败/)
    assert.deepEqual(await fs.readFile(path.join(target,key)),bytes,'bad copy does not replace an existing original')
    await assert.rejects(fs.access(path.join(target,key+'.migrating')))
    await assert.rejects(copyCloudMedia({records:{assets:[{master_path:'masters/../secret'}],renditions:[]},target,source,head}),/无效/)
    await assert.rejects(copyCloudMedia({records:{assets:[],renditions:[{path:'derivatives/abc.webp'}]},target,source,head:async()=>({bytes:3})}),/缺少完整性/)
  }finally{await fs.rm(target,{recursive:true,force:true})}
})
test('database comparison includes private fields and is independent of row and column order',()=>{
  const a={photos:[{id:1,rating:5,private_note:'kept'},{id:2,rating:4}],settings:[]}
  const b={settings:[],photos:[{rating:4,id:2},{private_note:'kept',rating:5,id:1}]}
  assert.equal(recordsDigest(a),recordsDigest(b))
  assert.notEqual(recordsDigest(a),recordsDigest({...a,photos:[...a.photos,{id:3}]}))
  assert.notEqual(recordsDigest(a),recordsDigest({...a,photos:[{...a.photos[0],private_note:'lost'},a.photos[1]]}))
})
test('offsite backup validates uploads before allowing automatic snapshot retention',async()=>{
  const target=await fs.mkdtemp(path.join(os.tmpdir(),'photography-backup-'))
  const filename=path.join(target,'archive.tar.gz'),bytes=Buffer.from('private backup')
  await fs.writeFile(filename,bytes)
  let saved,corrupt=false
  const connection={bucket:'test-photos',client:{async send(command){
    if(command.constructor.name==='PutObjectCommand'){
      const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk)
      saved=Buffer.concat(chunks)
      assert.deepEqual(saved,bytes)
      assert.equal(command.input.CacheControl,'private, no-store')
      return {}
    }
    return {ContentLength:saved.length,Metadata:{sha256:corrupt?'bad':digest(saved)}}
  }}}
  try{
    assert.equal((await uploadArchive({filename,key:'backups/test.tar.gz',connection})).sha256,digest(bytes))
    corrupt=true
    await assert.rejects(uploadArchive({filename,key:'backups/test.tar.gz',connection}),/校验失败/)
    const entries=Array.from({length:9},(_,i)=>({id:`automatic-2026-11-${String(i+1).padStart(2,'0')}T04-35-00-000Z`,remoteVerified:true}))
    entries.push({id:'manual-2026-01-01',remoteVerified:true},{id:'before-restore-2026-01-01',remoteVerified:true},{id:'automatic-2026-01-01T00-00-00-000Z',remoteVerified:false})
    assert.deepEqual(expiredAutomaticBackups(entries).map(e=>e.id),[entries[1].id,entries[0].id])
  }finally{await fs.rm(target,{recursive:true,force:true})}
})
