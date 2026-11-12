import fs from 'node:fs/promises'
import {createReadStream,realpathSync} from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {HeadObjectCommand} from '@aws-sdk/client-s3'
import {openDatabase} from './db.mjs'
import {readRecords} from './data-transfer.mjs'
import {createMediaStorage,mediaKey} from './storage.mjs'
import {createR2Client} from './r2-client.mjs'

export async function fileHashes(filename) {
  const sha=createHash('sha256'),md5=createHash('md5')
  let bytes=0
  for await(const chunk of createReadStream(filename)){sha.update(chunk);md5.update(chunk);bytes+=chunk.length}
  return {bytes,sha256:sha.digest('hex'),md5:md5.digest('hex')}
}
export function recordsDigest(records) {
  const normalized=Object.fromEntries(Object.keys(records).sort().map(table=>[table,records[table].map(row=>Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]]))).map(row=>JSON.stringify(row)).sort()]))
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
export async function copyCloudMedia({records,target,source,head,progress=()=>{}}) {
  const files=[...records.assets.map(a=>({path:a.master_path,expectedSha:a.sha256})),...records.renditions.map(r=>({path:r.path}))]
  const unique=[...new Map(files.map(file=>[mediaKey(file.path),file])).values()]
  let cursor=0,completed=0
  const results=[]
  async function worker() {
    while(cursor<unique.length){
      const file=unique[cursor++],key=mediaKey(file.path),destination=path.join(target,key)
      const remote=await head(key)
      if(!Number.isSafeInteger(remote.bytes)||remote.bytes<1||(!file.expectedSha&&!remote.sha256&&!remote.md5))throw new Error('源文件缺少完整性校验信息')
      await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700})
      let local=await fileHashes(destination).catch(error=>{if(error.code!=='ENOENT')throw error;return null})
      const matches=value=>value&&value.bytes===remote.bytes&&(!file.expectedSha||value.sha256===file.expectedSha)&&(!remote.sha256||value.sha256===remote.sha256)&&(!remote.md5||value.md5===remote.md5)
      if(!matches(local)){
        const temporary=destination+'.migrating'
        await fs.rm(temporary,{force:true})
        try{
          await source.download(key,temporary)
          local=await fileHashes(temporary)
          if(!matches(local))throw new Error('照片迁移完整性校验失败')
          await fs.rename(temporary,destination)
        }finally{await fs.rm(temporary,{force:true})}
      }
      if(!matches(local))throw new Error('照片迁移完整性校验失败')
      results.push({path:key,bytes:local.bytes,sha256:local.sha256})
      progress(++completed,unique.length)
    }
  }
  const workers=await Promise.allSettled(Array.from({length:3},()=>worker()))
  const failed=workers.find(result=>result.status==='rejected')
  if(failed)throw failed.reason
  return results.sort((a,b)=>a.path.localeCompare(b.path))
}
async function main() {
  const [mode,target]=process.argv.slice(2)
  if(!['snapshot','copy-media','verify'].includes(mode)||!target)throw new Error('Usage: cloud-migrate.mjs snapshot FILE | copy-media DATA_DIR | verify MANIFEST')
  const db=await openDatabase(process.env.PORTFOLIO_DATA_DIR,{client:'mysql',initialize:false,recover:false})
  let source,remote
  try{
    const records=await readRecords(db),digest=recordsDigest(records)
    const counts=Object.fromEntries(Object.entries(records).map(([table,rows])=>[table,rows.length]))
    if(mode==='snapshot'){
      await fs.writeFile(target,JSON.stringify({version:1,createdAt:new Date().toISOString(),digest,counts,records}),{mode:0o600,flag:'wx'})
      console.log(JSON.stringify({digest,counts}))
      return
    }
    if(mode==='verify'){
      const manifest=JSON.parse(await fs.readFile(target,'utf8'))
      for(const file of manifest.files){const actual=await fileHashes(path.join(manifest.target,mediaKey(file.path)));if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw new Error('照片校验失败')}
      if(digest!==manifest.databaseDigest)throw new Error('作品库在迁移后发生变化，请先增量复制')
      console.log(JSON.stringify({verified:manifest.files.length,databaseUnchanged:digest===manifest.databaseDigest,counts}))
      return
    }
    if(records.import_jobs.some(job=>['queued','processing'].includes(job.status)))throw new Error('请先等待正在运行的导入任务完成')
    const destination=path.resolve(target)
    source=createMediaStorage(destination,{driver:'r2'})
    remote=createR2Client()
    const files=await copyCloudMedia({records,target:destination,source,head:async key=>{
      const result=await remote.client.send(new HeadObjectCommand({Bucket:remote.bucket,Key:key}),{abortSignal:AbortSignal.timeout(120000)})
      const etag=result.ETag?.replaceAll('"','')
      return {bytes:result.ContentLength,sha256:result.Metadata?.sha256,md5:/^[a-f0-9]{32}$/.test(etag||'')?etag:null}
    },progress:(done,total)=>{if(done%10===0||done===total)console.log(JSON.stringify({copied:done,total}))}})
    const after=recordsDigest(await readRecords(db))
    if(after!==digest)throw new Error('作品库在复制期间发生变化，请重新运行增量校验')
    const manifest={version:1,createdAt:new Date().toISOString(),target:destination,databaseDigest:digest,counts,files}
    await fs.writeFile(path.join(destination,'migration-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600})
    console.log(JSON.stringify({verified:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),databaseUnchanged:true}))
  }finally{await db.close();source?.close();remote?.client.destroy()}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('云端迁移未通过校验，尚未切换线上服务。');process.exitCode=1})
