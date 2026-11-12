import os from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createPortfolioServer} from './helpers/database.mjs';
import {scanFolder} from '../server/media.mjs';
import {backupPortfolio,restorePortfolio} from '../server/backup.mjs';
const scratch=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');
const hash=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('upload, private drafts, publication, NAS, collections, restoration and persistence',async()=>{
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'integration-'));const nas=path.join(dir,'nas');await fs.mkdir(path.join(nas,'chosen'),{recursive:true});
 let app=await createPortfolioServer({dataDir:path.join(dir,'data'),seed:false,nasRoot:nas});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 let base='http://127.0.0.1:'+app.server.address().port,cookie='';
 async function request(route,{method='GET',data,body,auth=true,origin=base}={}){
  const r=await fetch(base+route,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:origin}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body});
  const type=r.headers.get('content-type')||'';return {r,value:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
 }
 async function waitJob(id){for(let i=0;i<200;i++){const j=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id);if(['ready','failed','duplicate'].includes(j.status))return j;await sleep(25);}throw new Error('Job timed out');}
 try{
  assert.equal((await request('/')).r.status,200,'empty library');assert.equal((await request('/missing.css')).r.status,404);assert.equal((await request('/api/admin/state')).r.status,401);
  assert.equal((await request('/api/setup',{method:'POST',origin:'https://foreign.test',data:{password:'integration-passphrase'}})).r.status,403);
  const setup=await request('/api/setup',{method:'POST',data:{password:'integration-passphrase'}});assert.equal(setup.r.status,200,JSON.stringify(setup.value));cookie=setup.r.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/setup',{method:'POST',data:{password:'integration-passphrase'}})).r.status,409);assert.equal((await request('/api/login',{method:'POST',data:{password:'incorrect'}})).r.status,401);assert.equal((await request('/api/admin/state')).r.status,200);
  const bytes=await sharp({create:{width:300,height:180,channels:3,background:'#789376'}}).jpeg().withExif({IFD0:{Make:'Canon',Model:'Canon EOS 100D'},IFD2:{DateTimeOriginal:'2026:09:12 10:20:30'}}).toBuffer();
  const upload=await request('/api/admin/uploads?name=original.jpg',{method:'POST',body:bytes});assert.equal(upload.r.status,202,JSON.stringify(upload.value));
  const job=await waitJob(upload.value.id);assert.equal(job.status,'ready',job.error);const id=job.photo_id;let draft=(await request('/api/admin/photos/'+id)).value;
  assert.equal(draft.status,'draft');assert.equal(draft.date,'2026-09-12');assert.equal(draft.equipmentId,'canon-100d');assert.equal((await request('/api/photos',{auth:false})).value.total,0);assert.equal((await request('/'+draft.src,{auth:false})).r.status,404);assert.equal((await request('/api/admin/masters/'+id,{auth:false})).r.status,401);
  assert.equal(hash((await request('/api/admin/masters/'+id)).value),hash(bytes),'master byte-identical');assert.equal((await sharp((await request('/'+draft.src)).value).metadata()).exif,undefined);
  assert.equal((await request('/api/admin/photos/'+id,{method:'PATCH',data:{version:0,title:'stale'}})).r.status,409);
  const published=await request('/api/admin/photos/'+id,{method:'PATCH',data:{version:draft.version,title:'真实作品 <script>alert(1)</script>',date:'2024-05-21',status:'published',featured:true,featuredOrder:2}});assert.equal(published.r.status,200,JSON.stringify(published.value));draft=published.value;
  assert.equal((await request('/api/photos?year=2024&month=05',{auth:false})).value.total,1);assert.equal((await request('/'+draft.src,{auth:false})).r.status,200);
  const home=(await request('/',{auth:false})).value.toString();assert.ok(home.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!home.includes('<script>alert(1)</script>'));assert.ok(home.includes('window.PORTFOLIO_BACKEND=true'));
  const duplicate=await request('/api/admin/uploads?name=duplicate.jpg',{method:'POST',body:bytes});assert.equal((await waitJob(duplicate.value.id)).status,'duplicate');
  const invalid=await request('/api/admin/uploads?name=broken.jpg',{method:'POST',body:Buffer.from('not an image')});assert.equal((await waitJob(invalid.value.id)).status,'failed');
  const folderBytes=await sharp({create:{width:80,height:140,channels:3,background:'#abcdea'}}).png().toBuffer();await fs.writeFile(path.join(nas,'chosen','nas.png'),folderBytes);await fs.writeFile(path.join(nas,'chosen','skip.NEF'),'raw');await fs.symlink(path.join(dir,'data'),path.join(nas,'outside'));
  const listing=await request('/api/admin/nas/folders');assert.equal(listing.r.status,200);assert.equal(listing.value.folders.length,1);assert.equal((await request('/api/admin/nas/folders?folder=..')).r.status,400);await assert.rejects(scanFolder(nas,'outside'),/超出/);
  const scan=(await request('/api/admin/nas/scan',{method:'POST',data:{folder:'chosen'}})).value;assert.equal(scan.files.length,1);assert.equal(scan.skipped,1);
  const imported=await request('/api/admin/nas/import',{method:'POST',data:{scanId:scan.id,keys:[scan.files[0].key]}});assert.equal(imported.r.status,202);const nasJob=await waitJob(imported.value.jobs[0]);assert.equal(nasJob.status,'ready',nasJob.error);assert.equal(hash(await fs.readFile(path.join(nas,'chosen','nas.png'))),hash(folderBytes),'NAS unchanged');
  let nasPhoto=(await request('/api/admin/photos/'+nasJob.photo_id)).value;assert.equal(nasPhoto.date,null);nasPhoto=(await request('/api/admin/photos/'+nasPhoto.id,{method:'PATCH',data:{version:nasPhoto.version,title:'NAS 成品',status:'published'}})).value;
  const album=await request('/api/admin/collections',{method:'POST',data:{title:'我的合集 <b>',slug:'my-collection',photos:[nasPhoto.id,id],cover:nasPhoto.id,status:'published'}});assert.equal(album.r.status,201,JSON.stringify(album.value));
  const publicAlbum=(await request('/api/collections/my-collection',{auth:false})).value;assert.deepEqual(publicAlbum.photos,[nasPhoto.id,id]);assert.equal((await request('/collections/my-collection/',{auth:false})).r.status,200);
  const page=(await request('/api/photos?limit=1&page=1',{auth:false})).value;assert.equal(page.photos.length,1);assert.equal(page.total,2);assert.equal(page.hasMore,true);assert.equal((await request('/api/photos?limit=1&page=2',{auth:false})).value.photos[0].id,nasPhoto.id);
  draft=(await request('/api/admin/photos/'+id)).value;
  const revoke=await request('/api/admin/photos/'+id,{method:'PATCH',data:{version:draft.version,status:'draft'}});assert.equal(revoke.r.status,200);draft=revoke.value;assert.equal((await request('/'+draft.src,{auth:false})).r.status,404,'revoke media');
  const trashed=(await request('/api/admin/photos/'+id,{method:'PATCH',data:{version:draft.version,status:'trash'}})).value;assert.equal(trashed.status,'trash');assert.equal((await request('/api/admin/masters/'+id)).r.status,200);assert.equal((await request('/api/admin/photos/'+id,{method:'PATCH',data:{version:trashed.version,status:'draft'}})).r.status,200);
  await app.close();app=await createPortfolioServer({dataDir:path.join(dir,'data'),seed:false,nasRoot:nas});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;
  assert.equal((await request('/api/photos',{auth:false})).value.total,1);assert.equal((await request('/api/admin/photos/'+id)).r.status,200);
  for(const route of ['/','/archive/','/collections/','/equipment/','/about/','/admin/','/admin/admin.js','/admin/admin.css'])assert.equal((await request(route)).r.status,200,route);
  const backupDir=path.join(dir,'backup'),restoredDir=path.join(dir,'restored');
  const manifest=await backupPortfolio(path.join(dir,'data'),backupDir,{db:app.db});assert.equal(manifest.files.length,10);
  await restorePortfolio(backupDir,restoredDir);await assert.rejects(restorePortfolio(backupDir,restoredDir),/已存在/);
  const restored=await createPortfolioServer({dataDir:restoredDir,seed:false,nasRoot:nas});
  assert.equal((await restored.db.prepare('SELECT count(*) AS n FROM photos').get()).n,2);
  assert.equal((await restored.db.prepare('SELECT count(*) AS n FROM sessions').get()).n,0);
  await restored.processor.close();await restored.db.close();
  assert.equal((await request('/api/photos?page=1.5&limit=1.5',{auth:false})).r.status,200);
  assert.equal((await request('/api/logout',{method:'POST'})).r.status,200);assert.equal((await request('/api/admin/state')).r.status,401);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
