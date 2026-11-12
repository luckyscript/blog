import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {displayImage} from './watermark.mjs';
import {imageInput} from './image-input.mjs';
import {readExif,exifInfo} from './exif.mjs';
import {securePath,timed,failure,MAX_BYTES,copyBounded} from './media.mjs';

// Private, bounded in-memory cache. Previewing never creates an asset or import job.
export function createNasPreviews(dataDir){
 const cache=new Map(),pending=new Map(),queue=[];
 let active=0,cacheBytes=0,closed=false;
 const MAX_CACHE=32*1024*1024;
 async function source(scan,file){
  const {base,target}=await securePath(scan.root,file.relative);
  if(base!==scan.root)throw failure(409,'照片目录已变化，请重新扫描。');
  const stat=await timed(fs.stat(target));
  if(!stat.isFile()||stat.size>MAX_BYTES)throw failure(413,'此文件无法生成预览。');
  if(stat.size!==file.bytes||stat.mtimeMs!==file.modified)throw failure(409,'照片在扫描后发生了变化，请重新扫描。');
  return target;
 }
 async function render(scan,file){
  const target=await source(scan,file);
  const temporary=path.join(dataDir,'tmp','nas-preview-'+randomUUID());
  let handle;
  try{
   const opening=fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{handle=await timed(opening);}catch(error){opening.then(lateHandle=>lateHandle.close()).catch(()=>{});throw error;}
   const before=await handle.stat();
   if(!before.isFile()||before.size!==file.bytes||before.mtimeMs!==file.modified)throw failure(409,'照片已变化，请重新扫描。');
   await copyBounded(handle.createReadStream({autoClose:false}),temporary,{timeout:25000});
   const after=await handle.stat();
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw failure(409,'读取期间照片发生变化，请重新扫描。');
   const {input}=await imageInput(temporary);
   const resize=async size=>(await displayImage(input,{width:size,flatten:true,quality:size===640?80:88})).toBuffer();
   // Keep large-photo decoding serial within each of the two workers.
   return {thumb:await resize(640),large:await resize(1600),info:exifInfo(await readExif(temporary))};
  }catch(error){
   if(error.status)throw error;
   if(['ENOENT','EIO','ETIMEDOUT','ESTALE','ENOTCONN'].includes(error.code)||error.name==='AbortError')throw failure(503,'无法读取 NAS 照片，请检查连接后重试。');
   throw failure(422,'预览生成失败，文件可能不完整或格式不受支持。');
  }finally{await handle?.close();await fs.rm(temporary,{force:true});}
 }
 function remember(key,value){
  const bytes=value.thumb.length+value.large.length+Buffer.byteLength(JSON.stringify(value.info));
  while(cacheBytes+bytes>MAX_CACHE&&cache.size){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).bytes;cache.delete(oldest);}
  if(bytes<=MAX_CACHE){cache.set(key,{...value,bytes});cacheBytes+=bytes;}
 }
 function pump(){
  while(active<2&&queue.length){
   const job=queue.shift();active++;
   render(job.scan,job.file).then(value=>{if(!closed)remember(job.key,value);job.resolve(value);},job.reject).finally(()=>{pending.delete(job.key);active--;pump();});
  }
 }
 return {
  async get(scan,file,size='thumb'){
   if(closed)throw failure(503,'预览服务正在重启，请稍后重试。');
   if(!['thumb','large','info'].includes(size))throw failure(400,'无效的预览尺寸。');
   await source(scan,file); // Even cache hits recheck the file and scan boundary.
   const key=createHash('sha256').update(JSON.stringify([scan.root,file.relative,file.bytes,file.modified])).digest('hex');
   if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value[size];}
   if(!pending.has(key)){
    if(queue.length>=32)throw failure(429,'预览请求较多，请稍后重试。');
    const promise=new Promise((resolve,reject)=>queue.push({scan,file,key,resolve,reject}));pending.set(key,promise);pump();
   }
   return (await pending.get(key))[size];
  },
  async close(){closed=true;await Promise.allSettled([...pending.values()]);cache.clear();cacheBytes=0;}
 };
}
