import fs from 'node:fs/promises'
import {createReadStream,realpathSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3'
import {openDatabase} from './db.mjs'
import {backupPortfolio} from './backup.mjs'
import {createMediaStorage} from './storage.mjs'
import {createR2Client} from './r2-client.mjs'
import {fileHashes} from './cloud-migrate.mjs'

const execute=promisify(execFile)
export async function uploadArchive({filename,key,connection}) {
  const hashes=await fileHashes(filename)
  const contentMd5=Buffer.from(hashes.md5,'hex').toString('base64')
  const body=createReadStream(filename)
  try{
    await connection.client.send(new PutObjectCommand({Bucket:connection.bucket,Key:key,Body:body,ContentLength:hashes.bytes,ContentMD5:contentMd5,ContentType:'application/gzip',CacheControl:'private, no-store',Metadata:{sha256:hashes.sha256}}),{abortSignal:AbortSignal.timeout(1200000)})
  }finally{body.destroy()}
  const stored=await connection.client.send(new HeadObjectCommand({Bucket:connection.bucket,Key:key}),{abortSignal:AbortSignal.timeout(60000)})
  if(stored.ContentLength!==hashes.bytes||stored.Metadata?.sha256!==hashes.sha256)throw new Error('异地备份校验失败')
  return {...hashes,key}
}
export function expiredAutomaticBackups(entries,keep=7) {
  // Never prune manual snapshots, restore safety copies, or incomplete uploads.
  return entries.filter(entry=>/^automatic-\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(entry.id)&&entry.remoteVerified).sort((a,b)=>b.id.localeCompare(a.id)).slice(keep)
}
async function main() {
  const dataDir=path.resolve(process.env.PORTFOLIO_DATA_DIR||'data')
  const root=path.join(dataDir,'backups')
  await fs.mkdir(root,{recursive:true,mode:0o700})
  let db,remote,storage,archive
  try{
    const id='automatic-'+new Date().toISOString().replace(/[:.]/g,'-')
    const destination=path.join(root,id)
    db=await openDatabase(dataDir,{client:process.env.DB_CLIENT||'mysql',initialize:false,recover:false})
    if((await db.prepare("SELECT count(*) AS n FROM import_jobs WHERE status IN ('queued','processing')").get()).n)throw new Error('导入正在进行，稍后重试备份')
    storage=createMediaStorage(dataDir,{driver:'local'})
    const manifest=await backupPortfolio(dataDir,destination,{db,storage})
    await db.close();db=null
    archive=path.join(dataDir,id+'.tar.gz')
    await execute('tar',['-czf',archive,'-C',root,id],{timeout:300000})
    remote=createR2Client()
    const uploaded=await uploadArchive({filename:archive,key:'backups/rain-blog-photography/'+id+'.tar.gz',connection:remote})
    const receipt={id,createdAt:manifest.createdAt,remoteVerified:true,...uploaded,files:manifest.files.length}
    await fs.writeFile(path.join(destination,'offsite.json'),JSON.stringify(receipt,null,2),{mode:0o600})
    const entries=[]
    for(const item of await fs.readdir(root,{withFileTypes:true})){
      if(!item.isDirectory()||item.isSymbolicLink())continue
      try{const entry=JSON.parse(await fs.readFile(path.join(root,item.name,'offsite.json'),'utf8'));if(entry.id===item.name)entries.push(entry)}catch{}
    }
    for(const entry of expiredAutomaticBackups(entries))await fs.rm(path.join(root,entry.id),{recursive:true})
    await fs.writeFile(path.join(dataDir,'cloud-backup-status.json'),JSON.stringify(receipt,null,2),{mode:0o600})
    console.log(JSON.stringify({event:'photography_backup_complete',id,files:manifest.files.length,offsiteVerified:true,bytes:uploaded.bytes}))
  }finally{
    await db?.close();remote?.client.destroy();storage?.close()
    if(archive)await fs.rm(archive,{force:true})
  }
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('摄影云端备份失败；已有备份与原片保留，请检查服务日志。');process.exitCode=1})
