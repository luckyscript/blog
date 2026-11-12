import fs from 'node:fs/promises';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readExif} from './exif.mjs';
import {imageInput} from './image-input.mjs';
import {transaction,now} from './db.mjs';
import {createMediaStorage} from './storage.mjs';
import {writeRenditions} from './renditions.mjs';
export const MAX_BYTES=100*1024*1024;
export const MAX_PIXELS=80_000_000;
const allowed=/\.(jpe?g|png|heic|heif)$/i;
export const within=(root,target)=>target===root||target.startsWith(root+path.sep);
export function failure(status,message){return Object.assign(new Error(message),{status});}
export async function timed(promise,ms=8000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(503,'NAS 暂时无法访问，请检查网络和共享文件夹挂载。')),ms);})]);}finally{clearTimeout(timer);}}
export async function securePath(root,relative=''){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..')||relative.includes('\0'))throw failure(400,'无效文件夹路径');
 const base=await timed(fs.realpath(root));const target=await timed(fs.realpath(path.resolve(base,relative)));
 if(!within(base,target))throw failure(403,'文件超出允许导入的文件夹');
 return {base,target};
}
export async function scanFolder(root,folder=''){
 const {base,target}=await securePath(root,folder);const files=[];let skipped=0,seen=0,depthLimited=false;const started=Date.now();
 async function walk(dir,depth){
  if(depth>16){depthLimited=true;return;}
  if(seen>=10000||files.length>=2000||Date.now()-started>15000)return;
  const entries=await timed(fs.readdir(dir,{withFileTypes:true}));
  for(const entry of entries){
   if(seen++>=10000||files.length>=2000||Date.now()-started>15000)break;
   if(entry.name.startsWith('.')||entry.name.startsWith('@')||entry.isSymbolicLink())continue;
   const filename=path.join(dir,entry.name);
   if(entry.isDirectory())await walk(filename,depth+1);
   else if(entry.isFile()&&allowed.test(entry.name)){
    const stat=await timed(fs.stat(filename));
    if(stat.size>MAX_BYTES){skipped++;continue;}
    files.push({key:randomUUID(),name:entry.name,relative:path.relative(base,filename),bytes:stat.size,modified:stat.mtimeMs});
   }else skipped++;
  }
 }
 await walk(target,0);
 return {root:base,folder,files,skipped,truncated:depthLimited||seen>=10000||files.length>=2000||Date.now()-started>15000};
}
export async function copyBounded(source,dest,{timeout=120000}={}){
 let bytes=0;const hash=createHash('sha256');
 const limiter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>MAX_BYTES)return callback(failure(413,'照片超过 100 MB'));hash.update(chunk);callback(null,chunk);}});
 await pipeline(source,limiter,createWriteStream(dest,{flags:'wx',mode:0o600}),{signal:AbortSignal.timeout(timeout)});
 return {bytes,sha256:hash.digest('hex')};
}
function dateValue(value){
 if(typeof value!=='string')return null;
 const m=value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);if(!m)return null;
 const result=`${m[1]}-${m[2]}-${m[3]}`;
 const parsed=new Date(result+'T12:00:00Z');return !Number.isNaN(+parsed)&&parsed.toISOString().slice(0,10)===result?result:null;
}
export function equipment(metadata){
 const value=String(metadata.Model||'').toLowerCase();
 if(/^(?:nikon\s+)?z\s*f$/.test(value.trim()))return 'nikon-zf';
 for(const [re,id]of [[/100d/,'canon-100d'],[/d850/,'nikon-d850'],[/ace pro(?!\s*2)/,'insta360-ace-pro'],[/insta360.*x3|^x3$/,'insta360-x3'],[/x200 pro mini/,'vivo-x200-pro-mini'],[/iphone 13 pro$/,'iphone-13-pro']])if(re.test(value))return id;
 return null;
}
export function createProcessor(db,dataDir,storage=createMediaStorage(dataDir)){
 let running=false,closed=false;let current=Promise.resolve();
 const tmpDir=path.join(dataDir,'tmp');
 async function process(job){
  const temp=path.join(tmpDir,job.id+'.upload');let workspace;
  try{
   let digest;
   if(job.source_type==='nas'){
    const {base,target}=await securePath(job.source_root,job.source_path);
    if(base!==job.source_root)throw failure(409,'NAS 导入目录已变化，请重新扫描');
    const handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
     const before=await handle.stat();if(!before.isFile())throw failure(400,'所选项目不是照片文件');
     if(job.source_bytes!=null&&(before.size!==job.source_bytes||before.mtimeMs!==job.source_modified))throw failure(409,'照片在扫描后发生变化，请重新扫描、预览后导入。');
     await fs.rm(temp,{force:true});
     digest=await copyBounded(handle.createReadStream({autoClose:false}),temp);
     const after=await handle.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw failure(409,'源文件在复制期间变化，请重新导入');
    }finally{await handle.close();}
   }else{
    const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(temp)){hash.update(chunk);bytes+=chunk.length;}
    digest={sha256:hash.digest('hex'),bytes};
   }
   const existing=await db.prepare('SELECT * FROM assets WHERE sha256=?').get(digest.sha256);
   if(existing&&!job.target_photo_id){
    const duplicate=await db.prepare('SELECT id FROM photos WHERE asset_id=? UNION SELECT photo_id AS id FROM photo_versions WHERE asset_id=? LIMIT 1').get(existing.id,existing.id);
    if(duplicate){await db.prepare("UPDATE import_jobs SET status='duplicate',photo_id=?,updated_at=? WHERE id=?").run(duplicate.id,now(),job.id);return;}
   }
   const target=job.target_photo_id?await db.prepare('SELECT * FROM photos WHERE id=?').get(job.target_photo_id):null;
   if(job.target_photo_id&&(!target||target.is_demo||target.version!==job.target_version))throw failure(409,'作品在上传期间被修改，请重新打开作品后上传新版本。');
   const {input,metadata}=await imageInput(temp);
   const fields=await readExif(temp);
   const id=digest.sha256,master=`masters/${id}/original.${metadata.format==='jpeg'?'jpg':metadata.format==='heif'?'heic':'png'}`;
   let variants=[];
   if(!existing){
    workspace=await fs.mkdtemp(path.join(tmpDir,'processing-'));
    await storage.putFile(master,temp);
    variants=await writeRenditions(storage,id,input,workspace);
   }
   await transaction(db,async () => {
    if(!existing){
     await db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,digest.sha256,master,job.filename,metadata.format,digest.bytes,metadata.orientation>=5?metadata.height:metadata.width,metadata.orientation>=5?metadata.width:metadata.height,JSON.stringify(fields),now());
     for(const v of variants)await db.prepare('INSERT INTO renditions VALUES(?,?,?,?,?,?)').run(v.id,id,v.width,v.height,v.format,v.path);
    }
    let photoId;
    if(target){
     const fresh=await db.prepare('SELECT version FROM photos WHERE id=?').get(target.id);
     if(fresh.version!==job.target_version)throw failure(409,'作品已更新，请重新上传新版本。');
     await db.prepare('INSERT OR IGNORE INTO photo_versions(photo_id,asset_id,created_at) VALUES(?,?,?)').run(target.id,target.asset_id,target.created_at);
     const changed=await db.prepare('UPDATE photos SET asset_id=?,exif=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(id,JSON.stringify({...JSON.parse(target.exif),...fields}),now(),target.id,job.target_version);
     if(!changed.changes)throw failure(409,'作品已更新，请重新上传新版本。');
     photoId=target.id;
    }else photoId=Number((await db.prepare('INSERT INTO photos(asset_id,title,date,captured_raw,offset_time,equipment_id,exif,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,path.parse(job.filename).name,dateValue(fields.DateTimeOriginal),String(fields.DateTimeOriginal||'')||null,String(fields.OffsetTimeOriginal||'')||null,equipment(fields),JSON.stringify(fields),now(),now())).lastInsertRowid);
    await db.prepare('INSERT OR IGNORE INTO photo_versions(photo_id,asset_id,created_at) VALUES(?,?,?)').run(photoId,id,now());
    await db.prepare("UPDATE import_jobs SET status='ready',photo_id=?,error=NULL,updated_at=? WHERE id=?").run(photoId,now(),job.id);
   });
  }catch(error){await db.prepare("UPDATE import_jobs SET status='failed',error=?,updated_at=? WHERE id=?").run(error.status?error.message:job.source_type==='nas'?'无法处理此照片，请检查文件是否完整或重新连接 NAS 后重试。':'无法处理此照片，请重新导出完整的 JPEG / PNG 后上传。',now(),job.id);}
  finally{if(workspace)await fs.rm(workspace,{recursive:true,force:true});if(job.source_type==='nas'||(await db.prepare('SELECT status FROM import_jobs WHERE id=?').get(job.id))?.status!=='failed')await fs.rm(temp,{force:true});}
 }
 async function drain(){
  if(running||closed)return;running=true;
  try{let job;while(!closed&&(job=await db.prepare("SELECT * FROM import_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").get())){
   await db.prepare("UPDATE import_jobs SET status='processing',error=NULL,updated_at=? WHERE id=?").run(now(),job.id);await process(job);
  }}finally{running=false;}
 }
 return {wake(){if(!running&&!closed)current=drain().catch(error=>{console.error('导入队列暂时不可用:',error.code||'DATABASE_ERROR');});return current;},async close(){closed=true;await current;},async idle(){await current;}};
}
