import { mapAsync } from "./async-utils.mjs";
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {displayImage} from './watermark.mjs';
import {getStudio,saveStudio} from './studio-config.mjs';
import {updatePhoto,photoData} from './model.mjs';
import {transaction,now,openDatabase} from './db.mjs';
import {failure,within} from './media.mjs';
import {imageInput} from './image-input.mjs';
import {backupPortfolio,restorePortfolio} from './backup.mjs';
import {readRecords,insertRecords} from './data-transfer.mjs';
import {createMediaStorage} from './storage.mjs';

export function createStudio({db,dataDir,processor,mediaStorage=createMediaStorage(dataDir)}){
 let maintenance=false;const details=new Map();
 const backupRoot=path.join(dataDir,'backups');
 async function backups(){
  await fs.mkdir(backupRoot,{recursive:true,mode:0o700});const result=[];
  for(const entry of await fs.readdir(backupRoot,{withFileTypes:true})){
   if(!entry.isDirectory()||entry.isSymbolicLink())continue;
   try{const m=JSON.parse(await fs.readFile(path.join(backupRoot,entry.name,'manifest.json'),'utf8'));result.push({id:entry.name,createdAt:m.createdAt,files:m.files.length});}catch{}
  }return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 async function makeBackup(prefix='manual'){
  const id=prefix+'-'+now().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const manifest=await backupPortfolio(dataDir,path.join(backupRoot,id),{db,storage:mediaStorage});return {id,createdAt:manifest.createdAt,files:manifest.files.length};
 }
 async function restore(id){
  if(typeof id!=='string'||!(await backups()).some(b=>b.id===id))throw failure(404,'备份不存在');
  const staging=path.join(dataDir,'restores',randomUUID());
  await fs.mkdir(path.dirname(staging),{recursive:true});
  await restorePortfolio(path.join(backupRoot,id),staging);
  const restored=await openDatabase(staging,{seed:false});
  let records;try{records=await readRecords(restored);}finally{await restored.close();}
  const safety=await makeBackup('before-restore');
  // Restore immutable asset files before an atomic database switch. Current files
  // stay on disk so the automatically created safety snapshot can be restored.
  const manifest=JSON.parse(await fs.readFile(path.join(backupRoot,id,'manifest.json'),'utf8'));
  for(const file of manifest.files){const dest=path.resolve(dataDir,file.path);if(!within(dataDir,dest))throw failure(400,'备份路径不正确');await mediaStorage.putFile(file.path,path.join(staging,file.path));}
  try{await transaction(db,async () => {
   for(const table of ['import_jobs','import_scans','photo_versions','collection_photos','collections','photos','renditions','assets','settings'])await db.exec('DELETE FROM '+table);
   await insertRecords(db,records,['assets','renditions','photos','collections','collection_photos','photo_versions','settings']);
  });}finally{await fs.rm(staging,{recursive:true,force:true});}
  return {ok:true,safetyBackup:safety.id};
 }
 async function storage(){
  const totals={masters:0,derivatives:0,backups:0,other:0};
  async function walk(dir,kind){for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){if(entry.isSymbolicLink())continue;const f=path.join(dir,entry.name);if(entry.isDirectory())await walk(f,kind);else if(entry.isFile())totals[kind]+=(await fs.stat(f)).size;}}
  await Promise.all(Object.keys(totals).filter(k=>k!=='other').map(k=>walk(path.join(dataDir,k),k)));
  if(mediaStorage.driver==='r2'){
   totals.masters=Number((await db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM assets').get()).n);
   totals.derivatives=0;
   for(const row of await db.prepare('SELECT path FROM renditions').all())totals.derivatives+=(await mediaStorage.open(row.path,{head:true})).size;
  }
  const disk=await fs.statfs(dataDir);return {driver:mediaStorage.driver,totals,free:disk.bavail*disk.bsize,versions:(await db.prepare('SELECT count(*) n FROM photo_versions').get()).n,backups:await backups()};
 }
 async function versions(id) {
  const p=await db.prepare('SELECT * FROM photos WHERE id=?').get(id);if(!p||p.is_demo)throw failure(404,'这件作品没有修图版本');
  const items=await db.prepare('SELECT a.id AS assetId,a.filename,a.created_at AS createdAt FROM assets a WHERE a.id=? OR a.id IN (SELECT asset_id FROM photo_versions WHERE photo_id=?) ORDER BY a.created_at DESC').all(p.asset_id,id);
  return {version:p.version,items:items.map(v=>({...v,current:v.assetId===p.asset_id,src:`/media/${v.assetId}-640-webp`}))};
 }
 return {
  get busy(){return maintenance;},
  async handle({pathname,method,url,body}){
   if(pathname==='/api/admin/studio'){if(method==='GET')return await getStudio(db);if(method==='PATCH')return await saveStudio(db,await body());}
   if(pathname==='/api/admin/home-order'&&method==='POST'){
    const {photos}=await body();if(!Array.isArray(photos)||!photos.length||photos.length>500||new Set(photos.map(p=>p.id)).size!==photos.length)throw failure(400,'代表作列表不正确');
    return await transaction(db,async () => ({
     photos:await mapAsync(
      photos,
      async (p, i) => await updatePhoto(db,p.id,{version:p.version,featured:true,featuredOrder:i},true)
     )
    }));
   }
   if(pathname==='/api/admin/photos/batch'&&method==='POST'){
    const {photos,changes,addCollection}=await body();
    if(!Array.isArray(photos)||!photos.length||photos.length>500||new Set(photos.map(p=>p.id)).size!==photos.length)throw failure(400,'请选择 1 至 500 张不同的照片');
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(k=>!['status','category','picked','featured','rating'].includes(k)))throw failure(400,'批量修改内容不正确');
    // Each update checks its version inside one atomic transaction.
    return await transaction(db,async () => {
     const result=await mapAsync(photos, async p => {
      let collections;
      if(addCollection){if(!Number.isInteger(addCollection)||!(await db.prepare('SELECT id FROM collections WHERE id=?').get(addCollection)))throw failure(400,'合集不存在');collections=[...new Set([...(await db.prepare('SELECT collection_id id FROM collection_photos WHERE photo_id=?').all(p.id)).map(r=>r.id),addCollection])];}
      return await updatePhoto(db,p.id,{...changes,version:p.version,...(collections?{collections}:{})},true);
     });return {photos:result};
    });
   }
   const versionPath=pathname.match(/^\/api\/admin\/photos\/(\d+)\/versions$/);
   if(versionPath){const id=Number(versionPath[1]);if(method==='GET')return await versions(id);if(method==='POST'){
    const b=await body(),p=await db.prepare('SELECT * FROM photos WHERE id=?').get(id);if(!p||p.version!==b.version)throw failure(409,'作品已更新，请重新打开');
    if(!(await versions(id)).items.some(v=>v.assetId===b.assetId))throw failure(400,'版本不属于此作品');
    const asset=await db.prepare('SELECT metadata FROM assets WHERE id=?').get(b.assetId);
    const changed=await db.prepare('UPDATE photos SET asset_id=?,exif=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(b.assetId,JSON.stringify({...JSON.parse(p.exif),...JSON.parse(asset.metadata)}),now(),id,b.version);
    if(!changed.changes)throw failure(409,'作品已更新，请重新打开');
    return await photoData(db,await db.prepare('SELECT * FROM photos WHERE id=?').get(id),true);
   }}
   if(pathname==='/api/admin/storage'&&method==='GET')return await storage();
   if(pathname==='/api/admin/backups'&&method==='POST'){
    maintenance=true;try{await processor.idle();return await makeBackup();}finally{maintenance=false;}
   }
   if(pathname==='/api/admin/backups/restore'&&method==='POST'){
    const b=await body();if(b.confirm!=='恢复备份')throw failure(400,'请填写“恢复备份”以确认');
    maintenance=true;try{await processor.idle();return await restore(b.id);}finally{maintenance=false;}
   }
   return undefined;
  },
  async detail(id){
   const row=await db.prepare('SELECT a.* FROM assets a JOIN photos p ON p.asset_id=a.id WHERE p.id=?').get(id);if(!row)throw failure(404,'原尺寸照片不可用');
   if(!details.has(row.id))details.set(row.id,mediaStorage.withFile(row.master_path,async filename=>{const {input}=await imageInput(filename);return (await displayImage(input,{quality:95})).toBuffer();}).finally(()=>details.delete(row.id)));
   return details.get(row.id);
  }
 };
}
