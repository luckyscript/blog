import fs from 'node:fs/promises'
import {createReadStream,createWriteStream} from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pipeline} from 'node:stream/promises'
import {HeadBucketCommand,HeadObjectCommand,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3'
import {createR2Client} from './r2-client.mjs'

export function mediaKey(key) {
  if(typeof key!=='string'||!/^(masters|derivatives)\//.test(key)||key.includes('\\')||key.includes('\0')||key.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error('无效照片存储路径')
  return key
}

const contentType=key=>({'.jpg':'image/jpeg','.png':'image/png','.heic':'image/heic','.webp':'image/webp'}[path.extname(key)]||'application/octet-stream')

export function createMediaStorage(dataDir,{driver='local',env=process.env,connection}={}) {
  if(!['local','r2'].includes(driver)) throw new Error('MEDIA_STORAGE 必须为 local 或 r2')
  const remote=driver==='r2'?(connection||createR2Client(env)):null
  const localPath=key=>path.join(dataDir,mediaKey(key))
  async function send(Command,key,options={}) {
    try {
      return await remote.client.send(new Command({Bucket:remote.bucket,...(key?{Key:mediaKey(key)}:{}),...options}),{abortSignal:AbortSignal.timeout(120000)})
    } catch(error) {
      if(error.$metadata?.httpStatusCode===404) throw Object.assign(new Error('照片文件不存在'),{code:'ENOENT',status:404})
      // Do not expose SDK request details or credentials to logs/clients.
      throw Object.assign(new Error('R2 暂时无法访问，请稍后重试。'),{status:503})
    }
  }
  const storage={
    driver,
    async check() {if(remote) await send(HeadBucketCommand)},
    async putFile(key,filename) {
      mediaKey(key)
      if(!remote) {
        const dest=localPath(key)
        await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700})
        await fs.copyFile(filename,dest)
        return
      }
      const stat=await fs.stat(filename),md5=createHash('md5'),sha=createHash('sha256')
      for await(const chunk of createReadStream(filename)) {md5.update(chunk);sha.update(chunk)}
      const hash=sha.digest('hex'),body=createReadStream(filename)
      try {
        await send(PutObjectCommand,key,{Body:body,ContentLength:stat.size,ContentType:contentType(key),ContentMD5:md5.digest('base64'),Metadata:{sha256:hash},CacheControl:'private, no-store'})
      } finally {body.destroy()}
      const stored=await send(HeadObjectCommand,key)
      if(stored.ContentLength!==stat.size||stored.Metadata?.sha256!==hash) throw Object.assign(new Error('R2 上传校验失败，请重试。'),{status:503})
    },
    async open(key,{head=false}={}) {
      mediaKey(key)
      if(remote) {
        const result=await send(head?HeadObjectCommand:GetObjectCommand,key)
        return {size:result.ContentLength,body:result.Body,etag:result.Metadata?.sha256?`"sha256-${result.Metadata.sha256}"`:result.ETag}
      }
      const filename=localPath(key),stat=await fs.stat(filename)
      if(!stat.isFile()) throw Object.assign(new Error('照片文件不存在'),{code:'ENOENT'})
      return {size:stat.size,body:head?undefined:createReadStream(filename),etag:`W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`}
    },
    async download(key,filename) {
      const {body}=await storage.open(key)
      let created=false
      const output=createWriteStream(filename,{flags:'wx',mode:0o600})
      output.once('open',()=>{created=true})
      try {await pipeline(body,output)}
      catch(error) {if(created)await fs.rm(filename,{force:true});throw error}
    },
    async withFile(key,fn) {
      if(!remote) return fn(localPath(key))
      const root=path.join(dataDir,'tmp')
      await fs.mkdir(root,{recursive:true,mode:0o700})
      const temp=await fs.mkdtemp(path.join(root,'r2-read-'))
      try {
        const filename=path.join(temp,path.basename(mediaKey(key)))
        await storage.download(key,filename)
        return await fn(filename)
      } finally {await fs.rm(temp,{recursive:true,force:true})}
    },
    close() {remote?.client.destroy()}
  }
  return storage
}
