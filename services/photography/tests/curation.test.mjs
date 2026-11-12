import os from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createRequire} from 'node:module';
import {createPortfolioServer} from './helpers/database.mjs';
const C=createRequire(import.meta.url)('../dist/catalog.js');

test('archive search state preserves source, camera and keywords while intersecting filters',()=>{
 const photos=[
  {id:1,title:'雨后山色',description:'晨光',date:'2026-01-01',category:'landscape',equipmentId:'nikon-d850',isDemo:false},
  {id:2,title:'山色示例',description:'示意',date:'2026-01-02',category:'landscape',isDemo:true}
 ];
 const state=C.parseState('?q=山色&source=originals&equipment=nikon-d850&view=grid',photos);
 assert.deepEqual(C.parseState(C.serializeState(state),photos),state);
 assert.deepEqual(C.selectPhotos(photos,state).map(p=>p.id),[1]);
 assert.equal(C.selectPhotos(photos,{...state,equipment:'canon-100d'}).length,0);
 const undated=[{...photos[0],date:null}];assert.equal(C.selectPhotos(undated,C.parseState('?year=unknown',undated)).length,1);
});

test('private curation persists, filters atomically, stays private and survives backup restore',async()=>{
 const root=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');await fs.mkdir(root,{recursive:true});
 const dir=await fs.mkdtemp(path.join(root,'curation-'));
 const app=await createPortfolioServer({dataDir:dir,nasRoot:path.join(dir,'nas'),seed:true});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function request(route,method='GET',body,raw=false){
  const r=await fetch(base+route,{method,headers:{Cookie:cookie,...(method!=='GET'?{Origin:base}:{}),...(!raw&&body?{'Content-Type':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});
  return {status:r.status,r,value:(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text()};
 }
 const getPhoto=async id=>(await request('/api/admin/photos/'+id)).value;
 try{
  const setup=await request('/api/setup','POST',{password:'isolated-curation-password'});cookie=setup.r.headers.get('set-cookie').split(';')[0];
  async function upload(name,bytes){
   const r=await request('/api/admin/uploads?name='+name,'POST',bytes,true);
   assert.equal(r.status,202,JSON.stringify(r.value));
   for(let i=0;i<200;i++){
    const j=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(r.value.id);
    if(j.status==='failed')throw Error(j.error);if(j.status==='ready')return getPhoto(j.photo_id);
    await new Promise(r=>setTimeout(r,25));
   }throw Error('Timed out');
  }
  let a=await upload('camera-original.heic',await fs.readFile(new URL('./fixtures/exif.heic',import.meta.url)));
  let b=await upload('unlabelled.jpg',await sharp({create:{width:640,height:260,channels:3,background:'#d2caba'}}).jpeg().toBuffer());
  const secret='PRIVATE CURATION NOTE 439';
  a=(await request('/api/admin/photos/'+a.id,'PATCH',{version:a.version,title:'晨光山色',status:'published',rating:5,privateNote:secret})).value;
  b=(await request('/api/admin/photos/'+b.id,'PATCH',{version:b.version,status:'published',rating:3})).value;
  assert.equal(a.rating,5);assert.equal((await getPhoto(a.id)).privateNote,secret);
  assert.equal((await request('/api/admin/photos?minRating=4&order=rating')).value.total,1);
  assert.equal((await request('/api/admin/photos?q=439')).value.total,1);
  assert.equal((await request('/api/admin/photos?q=camera-original')).value.total,1);
  assert.equal((await request('/api/photos?q=439')).value.total,0);
  assert.equal((await request('/api/photos?equipment=nikon-d850&originals=true')).value.total,1);
  assert.equal((await request('/api/photos?equipment=unknown')).value.total,1);
  const facets=(await request('/api/archive/facets?originals=true')).value;
  assert.equal(facets.total,2);assert.equal(facets.cameras.find(c=>c.id==='nikon-d850').count,1);
  for(const url of ['/api/photos/'+a.id,'/api/photos','/','/archive/','/collections/']){
   const res=await request(url),value=typeof res.value==='string'?res.value:JSON.stringify(res.value);
   assert.ok(!value.includes(secret),url);
   if(url.startsWith('/api/photos')){assert.ok(!value.includes('privateNote'));assert.ok(!value.includes('"rating"'));}
  }
  assert.equal((await request('/api/admin/photos/'+a.id,'PATCH',{version:a.version,rating:6})).status,400);
  assert.equal((await request('/api/admin/photos/'+a.id,'PATCH',{version:a.version,privateNote:'x'.repeat(3001)})).status,400);
  const failed=await request('/api/admin/photos/batch','POST',{photos:[{id:a.id,version:a.version},{id:b.id,version:0}],changes:{rating:1}});
  assert.equal(failed.status,409);assert.equal((await getPhoto(a.id)).rating,5);
  const batch=await request('/api/admin/photos/batch','POST',{photos:[a,b].map(p=>({id:p.id,version:p.version})),changes:{rating:4}});
  assert.equal(batch.status,200);assert.ok(batch.value.photos.every(p=>p.rating===4));
  const backup=(await request('/api/admin/backups','POST')).value;
  a=await getPhoto(a.id);
  await request('/api/admin/photos/'+a.id,'PATCH',{version:a.version,rating:0,privateNote:''});
  assert.equal((await request('/api/admin/backups/restore','POST',{id:backup.id,confirm:'恢复备份'})).status,200);
  a=await getPhoto(a.id);assert.equal(a.rating,4);assert.equal(a.privateNote,secret);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
