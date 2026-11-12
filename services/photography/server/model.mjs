import { mapAsync } from "./async-utils.mjs";
import fs from 'node:fs';
import path from 'node:path';
import {projectRoot,transaction,now} from './db.mjs';
import {failure} from './media.mjs';
import {safeExif,exifInfo} from './exif.mjs';
import {getStudio,cleanLayout} from './studio-config.mjs';
import {renditionVersion} from './watermark.mjs';
const seed=JSON.parse(fs.readFileSync(path.join(projectRoot,'src/content.json'),'utf8'));
export const equipment=seed.equipment;
export async function getEquipment(db){return JSON.parse((await db.prepare("SELECT value FROM settings WHERE `key`='equipment'").get())?.value||JSON.stringify(equipment));}
export const categories={landscape:'风光山野',city:'城市漫游',daily:'日常片刻',adventure:'户外探索'};
export function textField(value,max=1000){if(typeof value!=='string'||value.length>max)throw failure(400,'文字内容过长或格式不正确');return value.trim();}
export function validDate(value){if(value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw failure(400,'请填写有效日期');const d=new Date(value+'T12:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==value)throw failure(400,'请填写有效日期');return value;}
function integer(value,min=0,max=100000){if(!Number.isInteger(value)||value<min||value>max)throw failure(400,'排序或编号不正确');return value;}
// Hydrate a result set in a bounded number of queries; keep this context request-local.
export async function photosData(db,rows,admin=false,equipmentList) {
 const assets=[...new Set(rows.map(row=>row.asset_id).filter(Boolean))];
 const variants=new Map(),filenames=new Map(),memberships=new Map();
 if(assets.length){
  const slots=assets.map(()=>'?').join(',');
  for(const row of await db.prepare(`SELECT * FROM renditions WHERE asset_id IN (${slots})`).all(...assets)){if(!variants.has(row.asset_id))variants.set(row.asset_id,[]);variants.get(row.asset_id).push(row);}
  for(const row of await db.prepare(`SELECT id,filename FROM assets WHERE id IN (${slots})`).all(...assets))filenames.set(row.id,row.filename);
 }
 if(admin&&rows.length){
  for(const row of await db.prepare(`SELECT photo_id,collection_id FROM collection_photos WHERE photo_id IN (${rows.map(()=>'?').join(',')}) ORDER BY photo_id,collection_id`).all(...rows.map(row=>row.id))){if(!memberships.has(row.photo_id))memberships.set(row.photo_id,[]);memberships.get(row.photo_id).push(row.collection_id);}
 }
 const context={variants,filenames,memberships,equipment:equipmentList||await getEquipment(db)};
 return mapAsync(rows,row=>photoData(db,row,admin,context));
}
export async function photoData(db, row, admin=false,context) {
 let image={};
 const variants=row.is_demo?[]:context?context.variants.get(row.asset_id)||[]:await db.prepare('SELECT * FROM renditions WHERE asset_id=?').all(row.asset_id);
 if(row.is_demo)image=JSON.parse(row.demo_data);
 else{const rendition=width=>variants.find(v=>v.id.endsWith(`-${width}-webp`));const url=v=>`media/${v?.id}`+(v?.path.includes('/'+renditionVersion+'/')?`?v=${renditionVersion}`:'');const medium=rendition(1280),large=rendition(2560);image={src:url(medium),largeSrc:url(large),thumbSrc:url(rendition(640)),width:large?.width||0,height:large?.height||0,srcset:variants.filter(v=>v.format==='webp').map(v=>({src:url(v),width:v.width})),subtitle:'PHOTOGRAPHIC JOURNAL'};}
 const filename=row.asset_id?(context?context.filenames.get(row.asset_id):(await db.prepare('SELECT filename FROM assets WHERE id=?').get(row.asset_id))?.filename):null;
 const description=!row.is_demo&&(!row.description||row.description===path.parse(filename||'').name)?'':row.description;
 const result={...image,id:row.id,title:row.title,description,category:row.category,categoryLabel:categories[row.category],date:row.date,dateIsExample:!!row.is_demo,isDemo:!!row.is_demo,featured:!!row.featured,featuredOrder:row.featured_order,position:row.position,author:row.author||'见山',source:row.source,equipmentId:row.equipment_id};
 if(!row.is_demo){const jpeg=variants.find(v=>v.format==='jpeg');if(jpeg)result.shareSrc=`media/${jpeg.id}?v=${renditionVersion}`;}
 const exif=row.is_demo?{}:safeExif(JSON.parse(row.exif));
 result.exifInfo=exifInfo(exif);
 result.metadataCamera=result.exifInfo.fields.find(f=>f.key==='camera')?.value||null;
 const selected=row.equipment_id?(context?context.equipment:await getEquipment(db)).find(g=>g.id===row.equipment_id):null;
 result.equipmentName=selected?.name||result.metadataCamera;
 result.equipmentSource=selected?'catalog':result.metadataCamera?'exif':'unknown';
 if(admin)Object.assign(result,{status:row.status,version:row.version,createdAt:row.created_at,picked:!!row.picked,rating:row.rating,privateNote:row.private_note,filename,assetId:row.asset_id,exif,capturedRaw:row.captured_raw,offsetTime:row.offset_time,collections:context?context.memberships.get(row.id)||[]:(await db.prepare('SELECT collection_id FROM collection_photos WHERE photo_id=?').all(row.id)).map(r=>r.collection_id)});
 return result;
}
export async function listPhotos(db, params, admin=false) {
 const conditions=[],values=[];
 const status=params.get('status');if(!admin){conditions.push("status='published'");}else if(status&&['draft','published','trash'].includes(status)){conditions.push('status=?');values.push(status);}else conditions.push("status!='trash'");
 const year=params.get('year'),month=params.get('month'),cat=params.get('category'),query=params.get('q');
 if(year==='unknown')conditions.push('date IS NULL');else if(/^\d{4}$/.test(year||'')){conditions.push('substr(date,1,4)=?');values.push(year);}
 if(/^(0[1-9]|1[0-2])$/.test(month||'')){conditions.push('substr(date,6,2)=?');values.push(month);}
 if(Object.hasOwn(categories,cat||'')){conditions.push('category=?');values.push(cat);}
 if(query){const q='%'+query.slice(0,100)+'%';conditions.push(admin?'(title LIKE ? OR description LIKE ? OR private_note LIKE ? OR EXISTS(SELECT 1 FROM assets a WHERE a.id=photos.asset_id AND a.filename LIKE ?))':'(title LIKE ? OR description LIKE ?)');values.push(q,q);if(admin)values.push(q,q);}
 const camera=params.get('equipment');if(camera&&camera!=='all'){conditions.push('is_demo=0');if(camera==='unknown')conditions.push('equipment_id IS NULL');else{conditions.push('equipment_id=?');values.push(camera.slice(0,80));}}
 if(admin&&params.has('minRating')){const rating=Number(params.get('minRating'));if(!Number.isInteger(rating)||rating<0||rating>5)throw failure(400,'星级筛选不正确');conditions.push('rating>=?');values.push(rating);}
 if(admin&&params.get('picked')==='true')conditions.push('picked=1');
 if(params.get('originals')==='true')conditions.push('is_demo=0');
 if(params.get('featured')==='true')conditions.push('featured=1');
 const where='WHERE '+conditions.join(' AND ');
 const total=(await db.prepare(`SELECT count(*) AS n FROM photos ${where}`).get(...values)).n;
 const size=Math.floor(Math.max(1,Math.min(60,Number(params.get('limit'))||36)));const page=Math.floor(Math.max(1,Math.min(100000,Number(params.get('page'))||1)));
 const order=admin&&params.get('order')==='rating'?'rating DESC,date DESC,id DESC':params.get('featured')==='true'?'featured_order ASC,id DESC':`date IS NULL ASC,date ${params.get('order')==='oldest'?'ASC':'DESC'},id ${params.get('order')==='oldest'?'ASC':'DESC'}`;
 const rows=await db.prepare(`SELECT * FROM photos ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values,size,(page-1)*size);
 return {photos:await photosData(db,rows,admin),total,page,limit:size,hasMore:page*size<total};
}
export async function collectionsData(db, admin=false) {
 const albums=await db.prepare(`SELECT * FROM collections ${admin?'':"WHERE status='published'"} ORDER BY sort_order,id`).all();
 if(!albums.length)return [];
 const members=new Map();
 for(const row of await db.prepare(`SELECT cp.collection_id,p.id FROM collection_photos cp JOIN photos p ON p.id=cp.photo_id WHERE cp.collection_id IN (${albums.map(()=>'?').join(',')}) ${admin?"AND p.status!='trash'":"AND p.status='published'"} ORDER BY cp.collection_id,cp.sort_order`).all(...albums.map(a=>a.id))){if(!members.has(row.collection_id))members.set(row.collection_id,[]);members.get(row.collection_id).push(row.id);}
 return albums.map(a=>{const ids=members.get(a.id)||[];return {...a,cover:ids.includes(a.cover_photo_id)?a.cover_photo_id:ids[0],photos:ids,layout:cleanLayout(JSON.parse(a.layout).filter(b=>b.type==='text'||ids.includes(b.photoId)),ids),isDemo:!!a.is_demo};}).filter(a=>admin||a.photos.length);
}
export async function publicData(db) {
 const studio=await getStudio(db),equipment=await getEquipment(db);
 const rows=await db.prepare("SELECT * FROM photos WHERE status='published' ORDER BY featured_order,date DESC,id DESC").all();
 return {backend:true,studio,photos:await photosData(db,rows,false,equipment),albums:await collectionsData(db),equipment};
}
export async function updatePhoto(db, id, body, inTransaction=false) {
 if(!inTransaction)return transaction(db,()=>updatePhoto(db,id,body,true));
 const row=await db.prepare('SELECT * FROM photos WHERE id=?').get(id);if(!row)throw failure(404,'作品不存在');
 if(body.version!==row.version)throw failure(409,'作品已被更新，请重新打开后编辑');
 const updates={rating:body.rating===undefined?row.rating:integer(body.rating,0,5),private_note:body.privateNote===undefined?row.private_note:textField(body.privateNote,3000),picked:body.picked===undefined?row.picked:+!!body.picked,title:body.title===undefined?row.title:textField(body.title,120),description:body.description===undefined?row.description:textField(body.description,3000),date:body.date===undefined?row.date:validDate(body.date),category:body.category??row.category,equipment_id:body.equipmentId===undefined?row.equipment_id:body.equipmentId||null,author:body.author===undefined?row.author:textField(body.author,100),featured:body.featured===undefined?row.featured:+!!body.featured,featured_order:body.featuredOrder===undefined?row.featured_order:integer(body.featuredOrder),status:body.status??row.status,position:body.position??row.position};
 if(!updates.title||!Object.hasOwn(categories,updates.category)||!['draft','published','trash'].includes(updates.status)||!['center','top','bottom','left','right'].includes(updates.position))throw failure(400,'请检查标题、题材及状态');
 if(updates.equipment_id&&updates.equipment_id!==row.equipment_id&&!(await getEquipment(db)).some(e=>e.id===updates.equipment_id))throw failure(400,'器材不存在');
 if(updates.status==='published'&&!row.is_demo&&!(await db.prepare('SELECT id FROM assets WHERE id=?').get(row.asset_id)))throw failure(409,'图片尚未处理完成');
 if(updates.status==='trash')updates.featured=0;
 const write=async () => {
  const changed=await db.prepare(`UPDATE photos SET ${Object.keys(updates).map(k=>k+'=?').join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`).run(...Object.values(updates),now(),id,body.version);
  if(!changed.changes)throw failure(409,'作品已被更新，请重新打开后编辑');
  if(body.collections!==undefined){
   if(!Array.isArray(body.collections)||body.collections.length>100)throw failure(400,'合集列表不正确');
   const ids=[...new Set(body.collections)];for(const cid of ids)if(!(await db.prepare('SELECT id FROM collections WHERE id=?').get(integer(cid,1))))throw failure(400,'合集不存在');
   const previous=(await db.prepare('SELECT collection_id FROM collection_photos WHERE photo_id=?').all(id)).map(r=>r.collection_id);
   // Preserve curated positions for memberships that did not change.
   for(const cid of previous.filter(cid=>!ids.includes(cid))){await db.prepare('DELETE FROM collection_photos WHERE photo_id=? AND collection_id=?').run(id,cid);await db.prepare('UPDATE collections SET version=version+1 WHERE id=?').run(cid);}
   for(const cid of ids.filter(cid=>!previous.includes(cid))){const n=(await db.prepare('SELECT coalesce(max(sort_order),-1)+1 AS n FROM collection_photos WHERE collection_id=?').get(cid)).n;await db.prepare('INSERT INTO collection_photos VALUES(?,?,?)').run(cid,id,n);await db.prepare('UPDATE collections SET version=version+1 WHERE id=?').run(cid);}
  }
  if((row.status==='trash')!==(updates.status==='trash'))await db.prepare('UPDATE collections SET version=version+1 WHERE id IN (SELECT collection_id FROM collection_photos WHERE photo_id=?)').run(id);
 };if(inTransaction)await write();else await transaction(db,write);return await photoData(db,await db.prepare('SELECT * FROM photos WHERE id=?').get(id),true);
}
export async function saveCollection(db, id, body, inTransaction=false) {
 if(!inTransaction)return transaction(db,()=>saveCollection(db,id,body,true));
 const old=id?await db.prepare('SELECT * FROM collections WHERE id=?').get(id):null;
 if(id&&!old)throw failure(404,'合集不存在');if(old&&body.version!==old.version)throw failure(409,'合集已更新，请重新打开');
 const slug=textField(body.slug||'',80),title=textField(body.title||'',120);
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!title)throw failure(400,'请填写标题及英文短网址');
 if(!['draft','published'].includes(body.status||'draft'))throw failure(400,'合集状态不正确');
 if(!Array.isArray(body.photos)||body.photos.length>2000||new Set(body.photos).size!==body.photos.length)throw failure(400,'合集作品列表不正确');
 for(const pid of body.photos)if(!(await db.prepare("SELECT id FROM photos WHERE id=? AND status!='trash'").get(integer(pid,1))))throw failure(400,'部分作品已不可用，请重新打开合集');
 const cover=body.cover?integer(body.cover,1):body.photos[0]||null;if(cover&&!body.photos.includes(cover))throw failure(400,'封面必须来自本合集');
 const layout=cleanLayout(body.layout===undefined?(old?JSON.parse(old.layout).filter(b=>b.type==='text'||body.photos.includes(b.photoId)):[]):body.layout,body.photos);
 if(body.layout!==undefined)body.photos=layout.filter(b=>b.type==='photo').map(b=>b.photoId);
 const record={slug,title,layout:JSON.stringify(layout),description:textField(body.description||'',2000),story:textField(body.story||'',3000),label:textField(body.label||'',120),english:textField(body.english||'',120),quote:textField(body.quote||'',200),cover_photo_id:cover,status:body.status||'draft',sort_order:integer(body.sortOrder||0)};
 try{return await transaction(db,async () => {
  if(old){const changed=await db.prepare(`UPDATE collections SET ${Object.keys(record).map(k=>k+'=?').join(',')},version=version+1 WHERE id=? AND version=?`).run(...Object.values(record),id,body.version);if(!changed.changes)throw failure(409,'合集已更新，请重新打开');}
  else id=Number((await db.prepare(`INSERT INTO collections(${Object.keys(record).join(',')}) VALUES(${Object.keys(record).map(()=>'?').join(',')})`).run(...Object.values(record))).lastInsertRowid);
  const previous=(await db.prepare('SELECT photo_id FROM collection_photos WHERE collection_id=?').all(id)).map(r=>r.photo_id);
  const changed=[...previous.filter(pid=>!body.photos.includes(pid)),...body.photos.filter(pid=>!previous.includes(pid))];
  await db.prepare('DELETE FROM collection_photos WHERE collection_id=?').run(id);await mapAsync(
  body.photos,
  async (pid, i) => await db.prepare('INSERT INTO collection_photos VALUES(?,?,?)').run(id,pid,i)
 );
  for(const pid of changed)await db.prepare('UPDATE photos SET version=version+1,updated_at=? WHERE id=?').run(now(),pid);
  return (await collectionsData(db,true)).find(a=>a.id===id);
 });}catch(error){if(error.code==='ER_DUP_ENTRY'||error.message.includes('UNIQUE'))throw failure(409,'短网址已被其他合集使用');throw error;}
}
