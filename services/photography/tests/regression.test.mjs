import os from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createPortfolioServer} from './helpers/database.mjs';
import {photoData,collectionsData,updatePhoto,saveCollection} from '../server/model.mjs';
import {backupPortfolio,restorePortfolio} from '../server/backup.mjs';
import {renderSite} from '../src/render.mjs';
import {scanFolder} from '../server/media.mjs';

async function fixture(){
 const scratch=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');await fs.mkdir(scratch,{recursive:true});
 const dir=await fs.mkdtemp(path.join(scratch,'regression-')),nas=path.join(dir,'nas');await fs.mkdir(nas);
 const app=await createPortfolioServer({dataDir:path.join(dir,'data'),nasRoot:nas,seed:true});
 return {app,dir,nas,async close(){await app.close();await fs.rm(dir,{recursive:true,force:true});}};
}
test('editing photo metadata preserves collection order; concurrent membership edits conflict',async()=>{
 const f=await fixture();const db=f.app.db;
 const photo=async id => await photoData(db,await db.prepare('SELECT * FROM photos WHERE id=?').get(id),true);
 try{
  const album=(await collectionsData(db,true))[0],id=album.photos[0],p=await photo(id);
  await updatePhoto(db,id,{version:p.version,title:'Only change a title',collections:p.collections});
  assert.deepEqual((await collectionsData(db,true))[0].photos,album.photos,'curated order must not change');
  assert.equal((await collectionsData(db,true))[0].version,album.version,'metadata does not change memberships');
  const edited=await photo(id);await updatePhoto(db,id,{version:edited.version,collections:[]});
  await assert.rejects(saveCollection(db,album.id,{...album,version:album.version,sortOrder:0}),e=>e.status===409);
  const before=await photo(id);const current=(await collectionsData(db,true))[0];
  await saveCollection(db,current.id,{...current,photos:[id,...current.photos],cover:id,sortOrder:0});
  await assert.rejects(updatePhoto(db,id,{version:before.version,collections:[]}),e=>e.status===409);
  const stable=await photo(id);await assert.rejects(updatePhoto(db,id,{version:stable.version,date:'2025-02-30',title:'must not save'}),e=>e.status===400);
  assert.equal((await photo(id)).title,stable.title);assert.equal((await photo(id)).version,stable.version);
 }finally{await f.close();}
});
test('pagination, malformed input, private routes and redirect filters',async()=>{
 const f=await fixture();
 try{
  f.app.server.listen(0,'127.0.0.1');await once(f.app.server,'listening');const base='http://127.0.0.1:'+f.app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'regression-test-password'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
  for(const body of ['null','[]','"text"','{broken']){const r=await fetch(base+'/api/admin/nas/scan',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body});assert.equal(r.status,400,body);}
  for(const route of ['/api/admin/state','/api/admin/photos','/api/admin/nas/folders','/api/admin/jobs','/api/admin/collections'])assert.equal((await fetch(base+route)).status,401);
  for(const route of ['/.env','/server/index.mjs','/data/db/portfolio.sqlite'])assert.equal((await fetch(base+route)).status,404);
  const redirect=await fetch(base+'/archive?year=2024&view=grid',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/archive/?year=2024&view=grid');
  assert.equal((await fetch(base+'/%ZZ')).status,400);
  const missing=await fetch(base+'/collections/unpublished/',{headers:{Accept:'text/html'}});assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/text\/html/);assert.match(await missing.text(),/浏览作品档案/);
  const pages=[];for(let page=1;page<=3;page++){const r=await fetch(base+'/api/photos?limit=3&page='+page);const data=await r.json();pages.push(...data.photos);assert.equal(data.hasMore,page<3);}
  assert.equal(pages.length,8);assert.equal(new Set(pages.map(p=>p.id)).size,8);
  assert.equal((await (await fetch(base+'/api/photos?year=1900')).json()).total,0);
  const p=await f.app.db.prepare('SELECT * FROM photos LIMIT 1').get();
  const failure=await fetch(base+'/api/admin/photos/'+p.id,{method:'PATCH',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({version:p.version,date:'2025-02-30',title:'invalid'})});assert.equal(failure.status,400);
  assert.equal((await f.app.db.prepare('SELECT title FROM photos WHERE id=?').get(p.id)).title,p.title);
 }finally{await f.close();}
});
test('backup refuses overwrite and restore rejects tampered files',async()=>{
 const f=await fixture();
 try{
  const dest=path.join(f.dir,'backup');await backupPortfolio(path.join(f.dir,'data'),dest,{db:f.app.db});
  const before=await fs.readFile(path.join(dest,'portfolio.sqlite'));
  await assert.rejects(backupPortfolio(path.join(f.dir,'data'),dest,{db:f.app.db}),/目标已存在/);assert.deepEqual(await fs.readFile(path.join(dest,'portfolio.sqlite')),before);
  await fs.appendFile(path.join(dest,'portfolio.sqlite'),'tampered');await assert.rejects(restorePortfolio(dest,path.join(f.dir,'restore')),/校验失败/);
  await assert.rejects(fs.access(path.join(f.dir,'restore')));
 }finally{await f.close();}
});
test('empty portfolios and a single collection have useful states and no self-next link',async()=>{
 const data=JSON.parse(await fs.readFile(new URL('../src/content.json',import.meta.url),'utf8'));
 const empty=renderSite({...data,backend:true,photos:[],albums:[]}).pages;
 assert.match(empty.find(p=>p.page==='home').html,/暂无精选作品/);assert.match(empty.find(p=>p.page==='collections').html,/暂无合集/);
 assert.ok(!empty.find(p=>p.page==='home').html.includes('封面 · 示意摄影'));
 const single=renderSite({...data,backend:true,albums:[data.albums[0]]}).pages.find(p=>p.page==='album');assert.ok(!single.html.includes('class="next-collection"'));
});
test('queued NAS import refuses a changed file after server restart',async()=>{
 const f=await fixture();let restarted;
 try{
  const bytes=await sharp({create:{width:50,height:80,channels:3,background:'#557799'}}).jpeg().toBuffer();
  const source=path.join(f.nas,'selected.jpg');await fs.writeFile(source,bytes);
  await f.app.processor.close();
  f.app.server.listen(0,'127.0.0.1');await once(f.app.server,'listening');const base='http://127.0.0.1:'+f.app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'regression-test-password'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
  const post=(route,data)=>fetch(base+route,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const scan=await (await post('/api/admin/nas/scan',{folder:''})).json();
  const imported=await post('/api/admin/nas/import',{scanId:scan.id,keys:[scan.files[0].key]});assert.equal(imported.status,202);const jobId=(await imported.json()).jobs[0];
  assert.equal((await f.app.db.prepare('SELECT source_bytes FROM import_jobs WHERE id=?').get(jobId)).source_bytes,bytes.length);
  await fs.writeFile(source,await sharp(bytes).resize(20).jpeg().toBuffer());await f.app.close();
  restarted=await createPortfolioServer({dataDir:path.join(f.dir,'data'),nasRoot:f.nas,seed:false});await restarted.processor.idle();
  const job=await restarted.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(jobId);assert.equal(job.status,'failed');assert.match(job.error,/扫描后发生变化/);assert.equal(job.photo_id,null);
  assert.deepEqual(await fs.readdir(path.join(f.dir,'data','tmp')),[]);
 }finally{if(restarted)await restarted.close();else await f.app.close();await fs.rm(f.dir,{recursive:true,force:true});}
});
test('NAS failed job can retry when the unchanged source becomes available again',async()=>{
 const f=await fixture();
 try{
  const source=path.join(f.nas,'retry.jpg'),held=path.join(f.dir,'held.jpg');
  const bytes=await sharp({create:{width:64,height:90,channels:3,background:'#779966'}}).jpeg().toBuffer();await fs.writeFile(source,bytes);
  f.app.server.listen(0,'127.0.0.1');await once(f.app.server,'listening');const base='http://127.0.0.1:'+f.app.server.address().port;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'regression-test-password'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
  const post=(route,data={})=>fetch(base+route,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
  const scan=await (await post('/api/admin/nas/scan',{folder:''})).json();await fs.rename(source,held);
  const response=await post('/api/admin/nas/import',{scanId:scan.id,keys:[scan.files[0].key]});assert.equal(response.status,202);const id=(await response.json()).jobs[0];await f.app.processor.idle();
  assert.equal((await f.app.db.prepare('SELECT status FROM import_jobs WHERE id=?').get(id)).status,'failed');await fs.rename(held,source);
  assert.equal((await post('/api/admin/jobs/'+id+'/retry')).status,202);await f.app.processor.idle();assert.equal((await f.app.db.prepare('SELECT status FROM import_jobs WHERE id=?').get(id)).status,'ready');assert.deepEqual(await fs.readFile(source),bytes);
 }finally{await f.close();}
});
test('NAS depth limit is reported instead of implying a complete scan',async()=>{
 const f=await fixture();
 try{const deep=path.join(f.nas,...Array(17).fill('level'));await fs.mkdir(deep,{recursive:true});await fs.writeFile(path.join(deep,'deep.jpg'),'fixture');const result=await scanFolder(f.nas,'');assert.equal(result.truncated,true);assert.equal(result.files.length,0);}finally{await f.close();}
});

test('a minimal collection uses its description without empty headings or invented copy',async()=>{
 const content=JSON.parse(await fs.readFile(new URL('../src/content.json',import.meta.url)));
 const album={...content.albums[0],english:'',label:'',quote:'',story:'',description:'只填写介绍的影集 <sample>'};
 const html=renderSite({...content,albums:[album]}).pages.find(p=>p.page==='album').html;
 assert.ok(html.includes('只填写介绍的影集 &lt;sample&gt;'));
 assert.ok(!/<h2>\s*<\/h2>/.test(html));
 assert.ok(!html.includes('COLLECTION 01 / '));
});
