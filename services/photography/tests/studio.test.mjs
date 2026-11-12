import os from 'node:os';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {once} from 'node:events';import sharp from 'sharp';import {createPortfolioServer} from './helpers/database.mjs';
const scratch=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');
test('studio: atomic batches, home settings, compositions, HEIC, revision retention and recoverable backup restore',async()=>{
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'studio-')),nas=path.join(dir,'nas');await fs.mkdir(nas);
 const heic=await fs.readFile(new URL('./fixtures/exif.heic',import.meta.url));await fs.writeFile(path.join(nas,'phone.heic'),heic);
 const app=await createPortfolioServer({dataDir:path.join(dir,'data'),nasRoot:nas,seed:true});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function req(route,{method='GET',data,body,auth=true}={}){const r=await fetch(base+route,{method,headers:{...(auth?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body});const json=(r.headers.get('content-type')||'').includes('json');return {status:r.status,value:json?await r.json():Buffer.from(await r.arrayBuffer()),r};}
 async function job(id){for(let n=0;n<200;n++){const j=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id);if(['ready','failed','duplicate'].includes(j.status)){assert.equal(j.status,'ready',j.error);return (await req('/api/admin/photos/'+j.photo_id)).value;}await new Promise(r=>setTimeout(r,25));}throw Error('Job timed out');}
 const photo=async id=>(await req('/api/admin/photos/'+id)).value;
 try{
  const setup=await req('/api/setup',{method:'POST',data:{password:'studio-test-passphrase'}});cookie=setup.r.headers.get('set-cookie').split(';')[0];assert.equal((await req('/api/admin/studio',{auth:false})).status,401);
  assert.equal((await req('/api/admin/uploads?name=x.jpg&photoId=bad&version=1',{method:'POST',body:Buffer.from('invalid')})).status,400);
  const scan=(await req('/api/admin/nas/scan',{method:'POST',data:{folder:''}})).value;assert.equal(scan.files.length,1);
  const preview=await req('/api/admin/nas/preview?'+new URLSearchParams({scanId:scan.id,key:scan.files[0].key}));assert.equal(preview.status,200);assert.equal((await sharp(preview.value).metadata()).format,'jpeg');
  const imported=(await req('/api/admin/nas/import',{method:'POST',data:{scanId:scan.id,keys:[scan.files[0].key]}})).value;let first=await job(imported.jobs[0]);assert.equal(first.exifInfo.fields.find(f=>f.key==='iso').value,'ISO 100');assert.deepEqual((await req('/api/admin/masters/'+first.id)).value,heic);
  const jpg=await sharp({create:{width:190,height:130,channels:3,background:'#668866'}}).jpeg().toBuffer();const upload=(await req('/api/admin/uploads?name=second.jpg',{method:'POST',body:jpg})).value;let second=await job(upload.id);
  const badBatch=await req('/api/admin/photos/batch',{method:'POST',data:{photos:[{id:first.id,version:first.version},{id:second.id,version:0}],changes:{status:'published',picked:true}}});assert.equal(badBatch.status,409);assert.equal((await photo(first.id)).status,'draft','batch rollback');
  const batch=await req('/api/admin/photos/batch',{method:'POST',data:{photos:[first,second].map(p=>({id:p.id,version:p.version})),changes:{status:'published',picked:true,featured:true}}});assert.equal(batch.status,200,JSON.stringify(batch.value));first=await photo(first.id);second=await photo(second.id);assert.equal(first.picked,true);
  let settings=(await req('/api/admin/studio')).value;assert.equal(settings.originalsOnly,true);
  assert.equal((await req('/api/admin/studio',{method:'PATCH',data:{...settings,coverId:99999}})).status,400);
  settings=(await req('/api/admin/studio',{method:'PATCH',data:{...settings,coverId:first.id,headline:'真实作品\n影像日记',desktopHeight:500,x:20,mobileX:80,shade:20}})).value;
  assert.equal((await req('/api/admin/studio',{method:'PATCH',data:{...settings,version:0}})).status,409);
  const home=(await req('/')).value.toString();assert.ok(home.includes('--cover-mobile-x:80%'));assert.ok(home.includes('真实作品<br>影像日记'));assert.ok(!home.match(/data-photo="[1-8]"/),'home gallery excludes demonstrations');
  const album=(await req('/api/admin/collections',{method:'POST',data:{slug:'studio-story',title:'摄影故事',status:'published',photos:[first.id,second.id],cover:first.id,layout:[{type:'photo',photoId:first.id,span:'wide'},{type:'text',text:'夜色 <script>safe</script>'},{type:'photo',photoId:second.id,span:'half'}]}})).value;
  assert.equal(album.layout[1].type,'text');const page=(await req('/collections/studio-story/')).value.toString();assert.ok(page.includes('span-wide'));assert.ok(page.includes('&lt;script&gt;safe&lt;/script&gt;'));assert.ok(!page.includes('<script>safe</script>'));
  second=await photo(second.id);const prior={title:second.title,status:second.status,collections:second.collections};
  const replacement=(await req('/api/admin/uploads?'+new URLSearchParams({name:'new-edit.heic',photoId:second.id,version:second.version}),{method:'POST',body:heic})).value;second=await job(replacement.id);assert.equal(second.id,batch.value.photos[1].id);assert.deepEqual({title:second.title,status:second.status,collections:second.collections},prior);
  let versions=(await req('/api/admin/photos/'+second.id+'/versions')).value;assert.equal(versions.items.length,2);
  const older=versions.items.find(v=>!v.current);const reverted=await req('/api/admin/photos/'+second.id+'/versions',{method:'POST',data:{version:second.version,assetId:older.assetId}});assert.equal(reverted.status,200);second=reverted.value;
  assert.equal((await req('/api/admin/photos/'+second.id+'/detail',{auth:false})).status,401);const detail=await req('/api/admin/photos/'+second.id+'/detail');assert.deepEqual([(await sharp(detail.value).metadata()).width,(await sharp(detail.value).metadata()).height],[190,130]);
  first=await photo(first.id);const order=await req('/api/admin/home-order',{method:'POST',data:{photos:[second,first].map(p=>({id:p.id,version:p.version}))}});assert.equal(order.status,200);assert.equal((await photo(second.id)).featuredOrder,0);
  const backup=(await req('/api/admin/backups',{method:'POST'})).value;assert.ok(backup.id);first=await photo(first.id);await req('/api/admin/photos/'+first.id,{method:'PATCH',data:{version:first.version,title:'after backup'}});
  assert.equal((await req('/api/admin/backups/restore',{method:'POST',data:{id:backup.id,confirm:'wrong'}})).status,400);
  const restored=await req('/api/admin/backups/restore',{method:'POST',data:{id:backup.id,confirm:'恢复备份'}});assert.equal(restored.status,200,JSON.stringify(restored.value));assert.ok(restored.value.safetyBackup);assert.equal((await photo(first.id)).title,first.title);assert.equal((await req('/api/session')).value.authenticated,true);
  const storage=(await req('/api/admin/storage')).value;assert.equal(storage.backups.length,2);assert.ok(storage.totals.masters>0);assert.ok(storage.free>0);assert.deepEqual(await fs.readFile(path.join(nas,'phone.heic')),heic);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
