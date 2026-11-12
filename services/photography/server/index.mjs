import {verifyBridge} from './blog-bridge.mjs'
import { mapAsync } from "./async-utils.mjs";
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openDatabase,projectRoot,now,transaction} from './db.mjs';
import {createAuth,createLoginLimiter} from './auth.mjs';
import {createProcessor,failure,MAX_BYTES,copyBounded,securePath,scanFolder,timed,within} from './media.mjs';
import {publicData,listPhotos,photoData,photosData,collectionsData,updatePhoto,saveCollection,getEquipment} from './model.mjs';
import {renderSite} from '../src/render.mjs';
import {createNasPreviews} from './nas-previews.mjs';
import {createStudio} from './studio.mjs';
import {createMediaStorage} from './storage.mjs';
import {createAiCopy} from './ai-copy.mjs';
import {createTurnstile} from './turnstile.mjs';
import sharp from 'sharp';
import {matchesEntityTag} from './http-cache.mjs';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
export function requestOrigin(req,port,publicOrigin=process.env.PUBLIC_ORIGIN){
 const localOrigin=`http://127.0.0.1:${port}`;
 // SSH port forwarding reaches the server over loopback. Keep first-time setup
 // private while allowing the owner to use the local admin page through a tunnel.
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 return loopback&&req.headers.host===`127.0.0.1:${port}`?localOrigin:publicOrigin||localOrigin;
}
async function jsonBody(req){let data='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)throw failure(413,'请求内容过大');data+=chunk;}try{const value=JSON.parse(data||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw failure(400,'请求格式不正确');}}
export async function createPortfolioServer({dataDir=path.join(projectRoot,'data'),seed=true,nasRoot=process.env.NAS_ROOT||'/Volumes/Photos',database={client:'sqlite'},media={driver:'local'},ai={},turnstile={},readOnly=process.env.PHOTOGRAPHY_READ_ONLY==='1'}={}){
 const aiCopy=createAiCopy(ai);
 const loginChallenge=createTurnstile(turnstile),loginLimiter=createLoginLimiter();
 dataDir=path.resolve(dataDir);await fs.mkdir(path.join(dataDir,'tmp'),{recursive:true,mode:0o700});
 const storage=createMediaStorage(dataDir,media);
 try{await storage.check();}catch(error){storage.close();throw error;}
 const db=await openDatabase(dataDir,{...database,seed,...(readOnly?{initialize:false,recover:false}:{})});const processor=createProcessor(db,dataDir,storage);const previews=createNasPreviews(dataDir);let cached=null;
 const invalidate=()=>{cached=null;};
 const studio=createStudio({db,dataDir,processor,mediaStorage:storage});
 const server=http.createServer(async(req,res)=>{
  const port=server.address()?.port;const origin=requestOrigin(req,port);
  const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));};
  try{
   if(req.headers.host!==new URL(origin).host&&!verifyBridge(req).valid)throw failure(403,'请使用服务器提供的本地网址');
   const url=new URL(req.url,origin);let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw failure(400,'无效网址');}
   if(pathname.includes('\0'))throw failure(400,'无效网址');
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
   const auth=createAuthInstance(origin);
   const method=req.method;
   if(readOnly&&!['GET','HEAD'].includes(method))throw failure(503,'迁移校验中，请稍后再试。');
   if(pathname==='/api/health'){await db.prepare('SELECT 1 AS ok').get();return send(200,{ok:true,version:'4.1.1',storage:storage.driver,database:db.dialect,source:process.env.PHOTOGRAPHY_SOURCE_LABEL||'QNAP Photos'});}
   if(pathname==='/api/blog-site'&&method==='GET'){if(!verifyBridge(req).valid)throw failure(403,'摄影连接未授权');return send(200,await publicData(db));}
   if(pathname==='/api/session'&&method==='GET')return send(200,{authenticated:await auth.session(req),configured:!!(await db.prepare('SELECT id FROM admin_users LIMIT 1').get()),turnstile:loginChallenge.publicConfig});
   if(['/api/setup','/api/login'].includes(pathname)&&method==='POST'){
    const body=await jsonBody(req);const cookie=await auth.signIn(req,body.password,pathname==='/api/setup',body.turnstileToken);return send(200,{ok:true},{'Set-Cookie':cookie});
   }
   if(pathname==='/api/logout'&&method==='POST'){auth.checkOrigin(req);return send(200,{ok:true},{'Set-Cookie':await auth.logout(req)});}
   if(pathname.startsWith('/api/admin/')){
    await auth.requireAdmin(req);if(!['GET','HEAD'].includes(method))auth.checkOrigin(req);
    if(studio.busy&&!['GET','HEAD'].includes(method))throw failure(503,'正在备份或恢复，请完成后重试。');
    const aiPath=pathname.match(/^\/api\/admin\/photos\/(\d+)\/ai-copy$/);
    if(aiPath&&method==='POST'){
     if(!aiCopy.enabled)throw failure(503,'AI 服务尚未配置，请联系管理员。');
     const body=await jsonBody(req),id=Number(aiPath[1]);
     if(!['title','description'].includes(body.field)||!Number.isSafeInteger(body.version))throw failure(400,'生成参数不正确');
     const row=await db.prepare('SELECT asset_id,version,is_demo,status FROM photos WHERE id=?').get(id);
     if(!row)throw failure(404,'作品不存在');
     if(row.is_demo||!row.asset_id||row.status==='trash')throw failure(400,'请为已导入的非回收站作品生成文案');
     if(row.version!==body.version)throw failure(409,'作品已更新，请重新打开后生成。');
     const variants=await db.prepare('SELECT * FROM renditions WHERE asset_id=?').all(row.asset_id);
     const variant=variants.find(v=>v.id.endsWith('-1280-webp'));
     if(!variant)throw failure(409,'图片尚未处理完成');
     const controller=new AbortController();const cancel=()=>{if(!res.writableEnded)controller.abort();};res.once('close',cancel);
     try{
      const image=await storage.withFile(variant.path,filename=>sharp(filename,{limitInputPixels:80_000_000}).rotate().resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:80}).toBuffer());
      if(controller.signal.aborted)throw failure(499,'AI 请求已取消。');
      const result=await aiCopy.generate({image,field:body.field,signal:controller.signal});
      const fresh=await db.prepare('SELECT asset_id,version,status FROM photos WHERE id=?').get(id);
      if(!fresh||fresh.version!==row.version||fresh.asset_id!==row.asset_id||fresh.status==='trash')throw failure(409,'作品已更新，本次生成未应用，请重新打开。');
      return send(200,{...result,version:row.version});
     }finally{res.off('close',cancel);}
    }
    const detailPath=pathname.match(/^\/api\/admin\/photos\/(\d+)\/detail$/);
    if(detailPath&&method==='GET'){const bytes=await studio.detail(Number(detailPath[1]));res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store'});return res.end(bytes);}
    const studioResult=await studio.handle({pathname,method,url,body:()=>jsonBody(req)});
    if(studioResult!==undefined){invalidate();return send(200,studioResult);}
    if(pathname==='/api/admin/state'&&method==='GET'){
     const counts=await db.prepare('SELECT status,count(*) AS n FROM photos GROUP BY status').all();
     return send(200,{counts:Object.fromEntries(counts.map(r=>[r.status,r.n])),equipment:await getEquipment(db),collections:await collectionsData(db,true),ai:{enabled:aiCopy.enabled},nas:{address:process.env.PHOTOGRAPHY_SOURCE_LABEL||(await db.prepare("SELECT value FROM settings WHERE `key`='nas_address'").get())?.value||'',mount:nasRoot}});
    }
    if(pathname==='/api/admin/photos'&&method==='GET')return send(200,await listPhotos(db,url.searchParams,true));
    const photoMatch=pathname.match(/^\/api\/admin\/photos\/(\d+)$/);
    if(photoMatch){const id=Number(photoMatch[1]);if(method==='PATCH'){const photo=await updatePhoto(db,id,await jsonBody(req));invalidate();return send(200,photo);}if(method==='GET'){const row=await db.prepare('SELECT * FROM photos WHERE id=?').get(id);if(!row)throw failure(404,'作品不存在');return send(200,await photoData(db,row,true));}}
    if(pathname==='/api/admin/collections'&&method==='GET')return send(200,{collections:await collectionsData(db,true)});
    if(pathname==='/api/admin/collections'&&method==='POST'){const album=await saveCollection(db,null,await jsonBody(req));invalidate();return send(201,album);}
    const albumMatch=pathname.match(/^\/api\/admin\/collections\/(\d+)$/);
    if(albumMatch&&method==='PATCH'){const album=await saveCollection(db,Number(albumMatch[1]),await jsonBody(req));invalidate();return send(200,album);}
    if(pathname==='/api/admin/uploads'&&method==='POST'){
     if(Number(req.headers['content-length'])>MAX_BYTES){req.resume();throw failure(413,'照片超过 100 MB');}
     const filename=path.basename((url.searchParams.get('name')||'photo.jpg').replaceAll('\\','/')).slice(0,240);
     if(!/\.(jpe?g|png|heic|heif)$/i.test(filename)){req.resume();throw failure(415,'请选择 JPEG、PNG 或 HEIC 成品照片');}
     const targetId=url.searchParams.has('photoId')?Number(url.searchParams.get('photoId')):null;
     const targetVersion=url.searchParams.has('version')?Number(url.searchParams.get('version')):null;
     if(targetId!==null){if(!Number.isSafeInteger(targetId)||targetId<1||!Number.isSafeInteger(targetVersion)||targetVersion<1){req.resume();throw failure(400,'修图版本的作品编号或版本不正确');}const p=await db.prepare('SELECT * FROM photos WHERE id=?').get(targetId);if(!p||p.is_demo||p.status==='trash'||p.version!==targetVersion){req.resume();throw failure(409,'作品已更新或不支持替换，请重新打开。');}}
     const id=randomUUID();const temp=path.join(dataDir,'tmp',id+'.upload');
     try{await copyBounded(req,temp);}catch(error){await fs.rm(temp,{force:true});throw error;}
     if(studio.busy){await fs.rm(temp,{force:true});throw failure(503,'正在备份或恢复，请稍后重新上传。');}
     await db.prepare('INSERT INTO import_jobs(id,filename,source_type,source_path,created_at,updated_at,target_photo_id,target_version) VALUES(?,?,?,?,?,?,?,?)').run(id,filename,'upload',temp,now(),now(),targetId,targetVersion);processor.wake();return send(202,{id,status:'queued'});
    }
    if(pathname==='/api/admin/jobs'&&method==='GET')return send(200,{jobs:await db.prepare('SELECT id,filename,source_type,status,error,photo_id,created_at,(SELECT status FROM photos WHERE id=photo_id) AS photo_status,target_photo_id FROM import_jobs ORDER BY created_at DESC,id DESC LIMIT 200').all(),active:(await db.prepare("SELECT count(*) AS n FROM import_jobs WHERE status IN ('queued','processing')").get()).n});
    const retry=pathname.match(/^\/api\/admin\/jobs\/([a-f0-9-]+)\/retry$/);
    if(retry&&method==='POST'){
     const job=await db.prepare('SELECT * FROM import_jobs WHERE id=?').get(retry[1]);if(!job||job.status!=='failed')throw failure(409,'此任务无需重试');
     await db.prepare("UPDATE import_jobs SET status='queued',error=NULL,updated_at=? WHERE id=?").run(now(),job.id);processor.wake();return send(202,{id:job.id});
    }
    if(pathname==='/api/admin/nas/folders'&&method==='GET'){
     const folder=url.searchParams.get('folder')||'';const {base,target}=await securePath(nasRoot,folder);
     const entries=await timed(fs.readdir(target,{withFileTypes:true}));
     return send(200,{address:process.env.PHOTOGRAPHY_SOURCE_LABEL||'smb://10.10.10.128/Photos',folder:path.relative(base,target),folders:entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!/^[.@]/.test(e.name)).map(e=>({name:e.name,folder:path.relative(base,path.join(target,e.name))})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))});
    }
    if(['/api/admin/nas/preview','/api/admin/nas/exif'].includes(pathname)&&method==='GET'){
     const scan=await db.prepare('SELECT * FROM import_scans WHERE id=?').get(url.searchParams.get('scanId'));
     if(!scan||Date.now()-Date.parse(scan.created_at)>24*3600_000)throw failure(409,'扫描已过期，请重新扫描文件夹。');
     const file=JSON.parse(scan.files).find(f=>f.key===url.searchParams.get('key'));
     if(!file)throw failure(404,'这张照片不在当前扫描清单中。');
     if(pathname.endsWith('/exif'))return send(200,await previews.get(scan,file,'info'),{'Cache-Control':'private, no-store'});
     if(!['thumb','large'].includes(url.searchParams.get('size')||'thumb'))throw failure(400,'无效的预览尺寸。');
     const bytes=await previews.get(scan,file,url.searchParams.get('size')||'thumb');
     res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store'});return res.end(bytes);
    }
    if(pathname==='/api/admin/nas/scan'&&method==='POST'){
     const body=await jsonBody(req);const result=await scanFolder(nasRoot,body.folder||'');const id=randomUUID();
     await db.prepare('INSERT INTO import_scans VALUES(?,?,?,?,?)').run(id,result.root,result.folder,JSON.stringify(result.files),now());
     await db.prepare('DELETE FROM import_scans WHERE created_at < ?').run(new Date(Date.now()-86400000).toISOString());
     return send(200,{id,folder:result.folder,files:result.files,skipped:result.skipped,truncated:result.truncated});
    }
    if(pathname==='/api/admin/nas/import'&&method==='POST'){
     const body=await jsonBody(req);const scan=await db.prepare('SELECT * FROM import_scans WHERE id=?').get(body.scanId);
     if(!scan||Date.now()-Date.parse(scan.created_at)>24*3600_000)throw failure(409,'扫描已过期，请重新扫描');
     if(!Array.isArray(body.keys)||!body.keys.length||body.keys.length>2000||new Set(body.keys).size!==body.keys.length)throw failure(400,'请选择需要导入的照片');
     const files=JSON.parse(scan.files);const selected=body.keys.map(key=>files.find(f=>f.key===key));if(selected.some(f=>!f))throw failure(400,'导入清单已变化，请重新扫描');
     const jobs=await transaction(db,async () => await mapAsync(
      selected,
      async file => {const id=randomUUID();await db.prepare('INSERT INTO import_jobs(id,filename,source_type,source_root,source_path,created_at,updated_at,source_bytes,source_modified) VALUES(?,?,?,?,?,?,?,?,?)').run(id,file.name,'nas',scan.root,file.relative,now(),now(),file.bytes,file.modified);return id;}
     ));
     processor.wake();return send(202,{jobs});
    }
    const master=pathname.match(/^\/api\/admin\/masters\/(\d+)$/);
    if(master&&method==='GET'){
     const record=await db.prepare('SELECT a.* FROM assets a JOIN photos p ON p.asset_id=a.id WHERE p.id=?').get(Number(master[1]));if(!record)throw failure(404,'母版不存在');
     return await sendMedia(record.master_path,res,req,{'Cache-Control':'private, no-store','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`});
    }
    throw failure(404,'管理接口不存在');
   }
   if(pathname==='/api/photos'&&method==='GET')return send(200,await listPhotos(db,url.searchParams));
   const detail=pathname.match(/^\/api\/photos\/(\d+)$/);
   if(detail&&method==='GET'){const row=await db.prepare("SELECT * FROM photos WHERE id=? AND status='published'").get(Number(detail[1]));if(!row)throw failure(404,'作品不存在');return send(200,await photoData(db,row));}
   if(pathname==='/api/archive/facets'&&method==='GET'){
    const equipment=await getEquipment(db);
    const originals=url.searchParams.get('originals')==='true',where="status='published'"+(originals?' AND is_demo=0':'');
    const cameras=(await db.prepare("SELECT equipment_id id,count(*) count FROM photos WHERE status='published' AND is_demo=0 GROUP BY equipment_id").all()).map(c=>({id:c.id||'unknown',name:equipment.find(g=>g.id===c.id)?.name||'器材待补',count:c.count}));
    return send(200,{years:await db.prepare(`SELECT substr(date,1,4) AS year,count(*) AS count FROM photos WHERE ${where} AND date IS NOT NULL GROUP BY year ORDER BY year DESC`).all(),unknown:(await db.prepare(`SELECT count(*) n FROM photos WHERE ${where} AND date IS NULL`).get()).n,total:(await db.prepare(`SELECT count(*) n FROM photos WHERE ${where}`).get()).n,cameras});
   }
   if(pathname==='/api/collections'&&method==='GET')return send(200,{collections:await collectionsData(db)});
   if(pathname.startsWith('/api/collections/')&&method==='GET'){const a=(await collectionsData(db)).find(a=>a.slug===pathname.split('/').at(-1));if(!a)throw failure(404,'合集不存在');const rows=a.photos.length?await db.prepare(`SELECT * FROM photos WHERE status='published' AND id IN (${a.photos.map(()=>'?').join(',')})`).all(...a.photos):[];const byId=new Map(rows.map(row=>[row.id,row]));return send(200,{...a,items:await photosData(db,a.photos.map(id=>byId.get(id)).filter(Boolean))});}
   if(pathname==='/api/equipment'&&method==='GET')return send(200,{equipment:await getEquipment(db)});
   if(pathname.startsWith('/media/')&&['GET','HEAD'].includes(method)){
    const id=pathname.slice(7);const v=await db.prepare('SELECT * FROM renditions WHERE id=?').get(id);if(!v)throw failure(404,'图片不存在');
    const visible=await db.prepare("SELECT id FROM photos WHERE asset_id=? AND status='published' LIMIT 1").get(v.asset_id);
    if(!visible&&!(await auth.session(req)))throw failure(404,'图片不存在');
    return await sendMedia(v.path,res,req,{'Cache-Control':visible?'private, no-cache':'private, no-store','Content-Type':v.format==='webp'?'image/webp':'image/jpeg'});
   }
   if(!['GET','HEAD'].includes(method))throw failure(405,'不支持的请求方式');
   if(pathname.startsWith('/api/'))throw failure(404,'接口不存在');
   if(pathname==='/admin'||pathname==='/admin/')return await sendFile(path.join(projectRoot,'dist/admin/index.html'),res,req);
   if(pathname==='/'||/^\/(archive|collections|equipment|about|works)(\/|$)/.test(pathname)){
    if(!pathname.endsWith('/')){res.writeHead(302,{Location:pathname+'/'+url.search});return res.end();}
    // Rendering reads the current database revision; no public copy of private data is written.
    const workMatch=pathname.match(/^\/works\/([1-9]\d*)\/$/);
    const data=await publicData(db);const pages=renderSite(data,{origin:process.env.PUBLIC_ORIGIN||origin,photoId:workMatch?Number(workMatch[1]):null}).pages;const page=pages.find(p=>'/'+p.route===pathname);if(!page)throw failure(404,'页面不存在');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(method==='HEAD'?'':page.html);
   }
   if(pathname.split('/').some(p=>p.startsWith('.')))throw failure(404,'文件不存在');
   const root=path.join(projectRoot,'dist'),filename=path.resolve(root,'.'+pathname);if(!within(root,filename))throw failure(404,'文件不存在');
   return await sendFile(filename,res,req);
  }catch(error){if(res.headersSent){res.destroy();return;}const status=error.status||(['ENOENT','ENOTDIR'].includes(error.code)?404:500);if(status===500)console.error(error);
   if(req.headers.accept?.includes('text/html')&&!req.url.startsWith('/api/')){
    const title=status===404?'这一页，暂时留白。':'暂时无法打开这一页。';
    const detail=status===404?'作品可能尚未发布，或网址已发生变化。可以回到作品档案继续浏览。':'请稍后重试，或通过首页重新进入。';
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    return res.end(req.method==='HEAD'?'':`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · 见山</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/pages.css"></head><body><header class="site-header"><a class="brand" href="/">见山 · JIANSHAN</a></header><main class="section-wrap portfolio-empty" style="min-height:65vh;display:grid;align-content:center;justify-items:center"><p>${status}</p><h1>${title}</h1><p>${detail}</p><a class="text-link" href="/archive/">浏览作品档案 →</a><a class="text-link" href="/">返回首页 →</a></main></body></html>`);
   }
   send(status,{error:status===500?'处理失败，请稍后重试':status===404?'内容不存在或暂时不可用':error.message});}
 });
 const authInstances=new Map();function createAuthInstance(origin){if(!authInstances.has(origin))authInstances.set(origin,createAuth(db,origin,{challenge:loginChallenge,limiter:loginLimiter}));return authInstances.get(origin);}
 async function sendFile(filename,res,req,headers={}){
  const stat=await fs.stat(filename);if(!stat.isFile())throw failure(404,'文件不存在');
  res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache',...headers});if(req.method==='HEAD')return res.end();
  const stream=createReadStream(filename);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }
 async function sendMedia(key,res,req,headers={}){
  const revalidate=headers['Cache-Control']==='private, no-cache';
  let opened=await storage.open(key,{head:req.method==='HEAD'||!!(revalidate&&req.headers['if-none-match'])});
  if(revalidate&&opened.etag){
   headers={...headers,ETag:opened.etag,Vary:'Cookie'};
   // The publication/session check above must run before returning a 304.
   if(matchesEntityTag(req.headers['if-none-match'],opened.etag)){opened.body?.destroy();res.writeHead(304,headers);return res.end();}
  }
  if(req.method!=='HEAD'&&!opened.body)opened=await storage.open(key);
  const {size,body}=opened;
  if(res.destroyed){body?.destroy();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(key)]||'application/octet-stream','Content-Length':size,...headers});
  if(req.method==='HEAD')return res.end();
  body.on('error',()=>res.destroy());res.on('close',()=>body.destroy());body.pipe(res);
 }
 if(!readOnly)processor.wake();
 return {server,db,processor,dataDir,storage,async close(){await new Promise(resolve=>server.close(resolve));await processor.close();await previews.close();await db.close();storage.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 sharp.concurrency(1);sharp.cache({memory:32,files:0,items:20});
 const app=await createPortfolioServer({dataDir:process.env.PORTFOLIO_DATA_DIR||path.join(projectRoot,'data'),seed:process.env.SEED_DEMO!=='0',database:{client:process.env.DB_CLIENT||'sqlite'},media:{driver:process.env.MEDIA_STORAGE||'local'}});
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
 if(host!=='127.0.0.1'&&!process.env.PUBLIC_ORIGIN)throw new Error('非本地运行请明确配置 PUBLIC_ORIGIN');
 app.server.listen(port,host,()=>console.log(`见山后台 http://127.0.0.1:${port}/admin/\n照片来源 ${process.env.PHOTOGRAPHY_SOURCE_LABEL||'smb://10.10.10.128/Photos'}\n本地数据 ${app.dataDir}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
