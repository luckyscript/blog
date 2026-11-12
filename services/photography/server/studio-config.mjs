import {transaction} from './db.mjs'
export const studioDefaults={version:0,originalsOnly:true,coverId:null,desktopHeight:620,mobileHeight:570,x:50,y:50,mobileX:50,mobileY:50,titleAlign:'left',titleTop:12,titleSize:40,mobileTitleSize:30,shade:18,pan:true,headline:'山野之间，\n日常之中。',intro:'',about:'',artistName:'见山',aboutNote:'',contactEmail:'',aboutPhotoId:null};
const bad=message=>Object.assign(new Error(message),{status:400});
export async function getStudio(db) {return {...studioDefaults,...JSON.parse((await db.prepare("SELECT value FROM settings WHERE `key`='studio'").get())?.value||'{}')};}
export async function saveStudio(db, body, inTransaction=false) {
 if(!inTransaction)return transaction(db,()=>saveStudio(db,body,true));
 await db.prepare("INSERT OR IGNORE INTO settings VALUES('studio','{}')").run();
 // Lock the setting row before reading its revision, including across processes.
 if(db.dialect==='mysql')await db.prepare("SELECT value FROM settings WHERE `key`='studio' FOR UPDATE").get();
 const current=await getStudio(db);if(body.version!==current.version)throw Object.assign(new Error('首页设置已更新，请重新载入后编辑'),{status:409});
 const result={...current};
 for(const [key,min,max]of [['desktopHeight',320,850],['mobileHeight',380,780],['x',0,100],['y',0,100],['mobileX',0,100],['mobileY',0,100],['titleTop',5,45],['titleSize',32,84],['mobileTitleSize',26,52],['shade',0,85]]){if(body[key]!==undefined){if(!Number.isFinite(body[key])||body[key]<min||body[key]>max)throw bad('请检查封面的尺寸和位置');result[key]=body[key];}}
 for(const key of ['originalsOnly','pan']){if(body[key]!==undefined){if(typeof body[key]!=='boolean')throw bad('开关设置不正确');result[key]=body[key];}}
 for(const [key,max]of [['headline',80],['intro',300],['about',3000],['artistName',80],['aboutNote',1500],['contactEmail',254]]){if(body[key]!==undefined){if(typeof body[key]!=='string'||body[key].length>max)throw bad('文字过长');result[key]=body[key].trim();}}
 if(result.contactEmail&&!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(result.contactEmail))throw bad('请填写有效的公开联系邮箱');
 if(body.titleAlign!==undefined){if(!['left','center','right'].includes(body.titleAlign))throw bad('标题位置不正确');result.titleAlign=body.titleAlign;}
 if(body.coverId!==undefined){if(body.coverId!==null&&(!Number.isInteger(body.coverId)||!(await db.prepare("SELECT id FROM photos WHERE id=? AND status!='trash'").get(body.coverId))))throw bad('封面作品不存在');result.coverId=body.coverId;}
 if(body.aboutPhotoId!==undefined){if(body.aboutPhotoId!==null&&(!Number.isInteger(body.aboutPhotoId)||!(await db.prepare("SELECT id FROM photos WHERE id=? AND status!='trash'").get(body.aboutPhotoId))))throw bad('关于页作品不存在');result.aboutPhotoId=body.aboutPhotoId;}
 result.version++;await db.prepare("UPDATE settings SET value=? WHERE `key`='studio'").run(JSON.stringify(result));return result;
}
export function cleanLayout(input,ids){
 if(!Array.isArray(input)||input.length>2500)throw bad('合集编排内容过多');
 const seen=new Set();const blocks=input.map(block=>{
  if(block?.type==='text'){if(typeof block.text!=='string'||block.text.length>1500)throw bad('段落文字过长');return {type:'text',text:block.text.trim()};}
  if(block?.type!=='photo'||!ids.includes(block.photoId)||seen.has(block.photoId)||!['wide','half'].includes(block.span))throw bad('合集编排与选中作品不一致');
  seen.add(block.photoId);return {type:'photo',photoId:block.photoId,span:block.span};
 });
 for(const id of ids)if(!seen.has(id))blocks.push({type:'photo',photoId:id,span:'half'});
 return blocks;
}
