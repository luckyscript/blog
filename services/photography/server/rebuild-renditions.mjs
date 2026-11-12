import fs from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {openDatabase,transaction} from './db.mjs'
import {createMediaStorage} from './storage.mjs'
import {imageInput} from './image-input.mjs'
import {writeRenditions} from './renditions.mjs'
import {renditionVersion} from './watermark.mjs'

export async function rebuildRenditions(db,storage,dataDir,{apply=false,onProgress=()=>{}}={}) {
  const active=await db.prepare("SELECT count(*) n FROM import_jobs WHERE status IN ('queued','processing')").get()
  if(Number(active.n))throw new Error('存在导入任务，请等待队列完成并停止站点后重建')
  const assets=await db.prepare('SELECT * FROM assets ORDER BY id').all()
  const before=await db.prepare('SELECT * FROM renditions ORDER BY id').all()
  const pending=assets.filter(a=>before.filter(r=>r.asset_id===a.id).some(r=>!r.path.includes('/'+renditionVersion+'/'))||before.filter(r=>r.asset_id===a.id).length!==4)
  if(!apply||!pending.length)return {assets:pending.length,updated:0}
  await fs.mkdir(path.join(dataDir,'maintenance'),{recursive:true,mode:0o700})
  const checkpoint=path.join(dataDir,'maintenance','renditions-before-'+randomUUID()+'.json')
  await fs.writeFile(checkpoint,JSON.stringify({createdAt:new Date().toISOString(),version:renditionVersion,renditions:before},null,2),{mode:0o600,flag:'wx'})
  await fs.mkdir(path.join(dataDir,'tmp'),{recursive:true,mode:0o700})
  const rebuilt=[]
  for(const asset of pending){
    const workspace=await fs.mkdtemp(path.join(dataDir,'tmp','watermark-'))
    try {
      const variants=await storage.withFile(asset.master_path,async filename=>{
        const hash=createHash('sha256')
        for await(const bytes of createReadStream(filename))hash.update(bytes)
        if(hash.digest('hex')!==asset.sha256)throw new Error('母版校验失败，停止重建')
        const {input}=await imageInput(filename)
        return writeRenditions(storage,asset.id,input,workspace)
      })
      rebuilt.push(...variants.map(v=>({...v,assetId:asset.id})))
      onProgress({done:rebuilt.length/4,total:pending.length})
    } finally {await fs.rm(workspace,{recursive:true,force:true})}
  }
  // All objects are uploaded and verified before switching any database paths.
  await transaction(db,async()=>{
    for(const v of rebuilt){
      const previous=before.find(r=>r.id===v.id)
      if(previous){
        if(previous.path===v.path&&previous.width===v.width&&previous.height===v.height&&previous.format===v.format)continue
        const changed=await db.prepare('UPDATE renditions SET width=?,height=?,format=?,path=? WHERE id=? AND path=?').run(v.width,v.height,v.format,v.path,v.id,previous.path)
        if(!changed.changes)throw new Error('展示图记录已变化，停止切换')
      }else await db.prepare('INSERT INTO renditions VALUES(?,?,?,?,?,?)').run(v.id,v.assetId,v.width,v.height,v.format,v.path)
    }
  })
  return {assets:pending.length,updated:rebuilt.length,checkpoint}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataDir=path.resolve(process.env.PORTFOLIO_DATA_DIR||'data')
  const db=await openDatabase(dataDir,{client:process.env.DB_CLIENT||'sqlite',initialize:false,recover:false})
  const storage=createMediaStorage(dataDir,{driver:process.env.MEDIA_STORAGE||'local'})
  try {
    const result=await rebuildRenditions(db,storage,dataDir,{apply:process.argv.includes('--apply'),onProgress:({done,total})=>console.log(`展示图已生成并验证 ${done}/${total}`)})
    console.log(JSON.stringify(result))
  }finally{await db.close();storage.close()}
}
