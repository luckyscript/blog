import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {projectRoot,openDatabase,transaction} from './db.mjs';
import {readRecords,insertRecords} from './data-transfer.mjs';
import {createMediaStorage} from './storage.mjs';
async function checksum(file){const {createReadStream}=await import('node:fs');const hash=createHash('sha256');for await(const data of createReadStream(file))hash.update(data);return hash.digest('hex');}
export async function backupPortfolio(dataDir,destination,{db:liveDb,storage=createMediaStorage(dataDir)}={}){
 const snapshot=path.resolve(destination);
 await fs.mkdir(path.dirname(snapshot),{recursive:true,mode:0o700});
 try{await fs.mkdir(snapshot,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('备份目标已存在，请选择新的目录，避免覆盖旧备份');throw error;}
 const dbFile=path.join(snapshot,'portfolio.sqlite');
 if(liveDb?.dialect==='mysql'){
  // SQLite is a portable, offline backup container, never the live MySQL store.
  const records=await readRecords(liveDb);
  const portable=await openDatabase(snapshot,{initialize:false,recover:false});
  try{await transaction(portable,()=>insertRecords(portable,records));}finally{await portable.close();}
  await fs.rename(path.join(snapshot,'db/portfolio.sqlite'),dbFile);
  await fs.rmdir(path.join(snapshot,'db'));
 }else{
  const live=new DatabaseSync(path.join(dataDir,'db/portfolio.sqlite'),{readOnly:true});try{await backup(live,dbFile);}finally{live.close();}
 }
 const db=new DatabaseSync(dbFile,{readOnly:true});const files=[];
 try{
  const records=[...db.prepare('SELECT master_path AS path FROM assets').all(),...db.prepare('SELECT path FROM renditions').all()];
  let required=0;
  for(const record of records){if(!safeMediaPath(record.path))throw new Error('备份照片路径不正确');required+=(await storage.open(record.path,{head:true})).size;}
  const disk=await fs.statfs(snapshot);
  if(required+128*1024*1024>disk.bavail*disk.bsize)throw Object.assign(new Error('本地空间不足以保存完整照片备份，请通过备份命令指定空间充足的外部磁盘目录。'),{status:507});
  for(const record of records){const to=path.join(snapshot,record.path);await fs.mkdir(path.dirname(to),{recursive:true,mode:0o700});await storage.download(record.path,to);files.push({path:record.path,sha256:await checksum(to)});}
 }finally{db.close();}
 const manifest={version:1,sourceDatabase:liveDb?.dialect||'sqlite',sourceStorage:storage.driver,createdAt:new Date().toISOString(),database:{path:'portfolio.sqlite',sha256:await checksum(dbFile)},files};
 await fs.writeFile(path.join(snapshot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});return manifest;
}
const safeMediaPath=name=>typeof name==='string'&&/^(masters|derivatives)\//.test(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='.'||p==='');
export async function restorePortfolio(snapshot,target){
 try{await fs.access(target);throw new Error('恢复目标已存在，请选择新的空目录');}catch(e){if(e.code!=='ENOENT')throw e;}
 const manifest=JSON.parse(await fs.readFile(path.join(snapshot,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.database?.path!=='portfolio.sqlite'||!Array.isArray(manifest.files)||manifest.files.some(f=>!safeMediaPath(f.path)))throw new Error('备份完整性校验失败：格式或路径不正确');
 const records=[manifest.database,...manifest.files];
 for(const item of records){if(await checksum(path.join(snapshot,item.path))!==item.sha256)throw new Error('备份完整性校验失败：'+item.path);}
 const staging=target+'.restoring-'+randomUUID();await fs.mkdir(path.join(staging,'db'),{recursive:true,mode:0o700});
 try{await fs.copyFile(path.join(snapshot,manifest.database.path),path.join(staging,'db/portfolio.sqlite'));
  for(const file of manifest.files){const out=path.join(staging,file.path);await fs.mkdir(path.dirname(out),{recursive:true,mode:0o700});await fs.copyFile(path.join(snapshot,file.path),out);}
  const db=new DatabaseSync(path.join(staging,'db/portfolio.sqlite'));try{db.exec('DELETE FROM sessions; DELETE FROM import_jobs; DELETE FROM import_scans');}finally{db.close();}
  await fs.rename(staging,target);
 }catch(e){await fs.rm(staging,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dataDir=path.resolve(process.env.PORTFOLIO_DATA_DIR||path.join(projectRoot,'data'));
 if(process.argv[2]==='restore'){
  if(!process.argv[3]||!process.argv[4])throw new Error('用法：npm run restore -- 备份目录 新的数据目录');
  await restorePortfolio(path.resolve(process.argv[3]),path.resolve(process.argv[4]));console.log('已恢复到新目录；原数据库未覆盖。');
 }else{
  const target=process.argv[2]?path.resolve(process.argv[2]):path.join(dataDir,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  const db=process.env.DB_CLIENT==='mysql'?await openDatabase(dataDir,{client:'mysql',initialize:false,recover:false}):null;
  const storage=createMediaStorage(dataDir,{driver:process.env.MEDIA_STORAGE||'local'});
  try{const manifest=await backupPortfolio(dataDir,target,{db,storage});console.log(`备份完成：${target}\n${manifest.files.length} 个文件已校验。`);}finally{await db?.close();storage.close();}
 }
}
