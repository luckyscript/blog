import os from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {safeExif,exifInfo,readExif} from '../server/exif.mjs';
import {createPortfolioServer} from './helpers/database.mjs';

const raw={Make:'NIKON CORPORATION',Model:'NIKON D850',LensModel:'AF-S NIKKOR 24-70mm f/2.8E ED VR',DateTimeOriginal:'2026:09:12 10:20:30',OffsetTimeOriginal:'+08:00',FNumber:2.8,ExposureTime:1/125,ISO:100,FocalLength:50};
const values=info=>Object.fromEntries(info.fields.map(f=>[f.key,f.value]));
test('EXIF presents photographic units, preserves wall time, and handles missing or malformed metadata',()=>{
 assert.deepEqual(values(exifInfo(raw)),{camera:'NIKON D850',lens:raw.LensModel,capturedAt:'2026-09-12 10:20:30 · UTC+08:00',aperture:'f/2.8',shutter:'1/125 秒',iso:'ISO 100',focalLength:'50 mm'});
 assert.equal(exifInfo(raw).summary,'50 mm · f/2.8 · 1/125 秒 · ISO 100');
 assert.equal(values(exifInfo({ExposureTime:30})).shutter,'30 秒');
 assert.equal(values(exifInfo({ExposureTime:0.3})).shutter,'0.3 秒');
 assert.equal(values(exifInfo({ExposureTime:1/8000})).shutter,'1/8000 秒');
 assert.equal(values(exifInfo({DateTimeOriginal:'2024:02:29 23:59:59'})).capturedAt,'2024-02-29 23:59:59');
 assert.equal(values(exifInfo({DateTimeOriginal:'2025:02:29 23:59:59'})).capturedAt,null);
 assert.equal(exifInfo({}).available,false);assert.equal(exifInfo(null).available,false);
 assert.ok(exifInfo({}).fields.every(f=>f.value===null));
 assert.deepEqual(safeExif({GPSLatitude:31.2,SerialNumber:'secret',ISO:-1,FNumber:NaN,ExposureTime:'1/125',FocalLength:Infinity,Make:{bad:true}}),{});
 assert.equal(safeExif({Model:'A\0B'.repeat(200)}).Model.length,240);
});

test('NAS preview, NAS import and upload share EXIF; publication exposes only safe fields and sources stay unchanged',async()=>{
 const scratch=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');await fs.mkdir(scratch,{recursive:true});
 const dir=await fs.mkdtemp(path.join(scratch,'exif-')),nas=path.join(dir,'nas');await fs.mkdir(nas);
 const metadata={IFD0:{Make:raw.Make,Model:raw.Model},IFD2:{DateTimeOriginal:raw.DateTimeOriginal,OffsetTimeOriginal:raw.OffsetTimeOriginal,LensModel:raw.LensModel,FNumber:'28/10',ExposureTime:'1/125',ISOSpeedRatings:'100',FocalLength:'50/1',BodySerialNumber:'private-camera-serial'}};
 const fixture=async(color,format='jpeg')=>sharp({create:{width:90,height:60,channels:3,background:color}}).toFormat(format).withExif(metadata).toBuffer();
 const uploadedBytes=await fixture('#123456'),nasBytes=await fixture('#abcdef','png');
 await fs.writeFile(path.join(nas,'nas.png'),nasBytes);
 assert.deepEqual(await readExif(uploadedBytes),raw);assert.deepEqual(await readExif(nasBytes),raw);
 const app=await createPortfolioServer({dataDir:path.join(dir,'data'),nasRoot:nas,seed:true});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function request(route,{method='GET',data,body,auth=true}={}){return fetch(base+route,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):body});}
 async function ready(id){for(let i=0;i<200;i++){const job=await app.db.prepare('SELECT * FROM import_jobs WHERE id=?').get(id);if(['ready','failed'].includes(job.status)){assert.equal(job.status,'ready',job.error);return (await request('/api/admin/photos/'+job.photo_id)).json();}await new Promise(r=>setTimeout(r,25));}throw Error('Job timed out');}
 try{
  const setup=await request('/api/setup',{method:'POST',data:{password:'exif-test-passphrase'}});cookie=setup.headers.get('set-cookie').split(';')[0];
  const scan=await (await request('/api/admin/nas/scan',{method:'POST',data:{folder:''}})).json();
  const endpoint='/api/admin/nas/exif?'+new URLSearchParams({scanId:scan.id,key:scan.files[0].key});
  assert.equal((await request(endpoint,{auth:false})).status,401);
  const infoResponse=await request(endpoint);assert.equal(infoResponse.status,200);assert.equal(infoResponse.headers.get('cache-control'),'private, no-store');
  const info=await infoResponse.json();assert.deepEqual(info,exifInfo(raw));
  assert.equal((await app.db.prepare('SELECT count(*) n FROM assets').get()).n,0);assert.equal((await app.db.prepare('SELECT count(*) n FROM import_jobs').get()).n,0);
  assert.equal((await request(endpoint.replace(scan.files[0].key,'invalid'))).status,404);
  const upload=await (await request('/api/admin/uploads?name=upload.jpg',{method:'POST',body:uploadedBytes})).json();
  const uploaded=await ready(upload.id);
  const imported=await (await request('/api/admin/nas/import',{method:'POST',data:{scanId:scan.id,keys:[scan.files[0].key]}})).json();
  const nasPhoto=await ready(imported.jobs[0]);assert.notEqual(uploaded.id,nasPhoto.id);
  for(const photo of [uploaded,nasPhoto]){
   assert.deepEqual(photo.exif,raw);assert.deepEqual(photo.exifInfo,info);
   assert.equal((await request('/api/photos/'+photo.id,{auth:false})).status,404,'draft EXIF stays private');
   // Simulate legacy metadata with unrelated fields: API and SSR must still filter it.
   await app.db.prepare('UPDATE photos SET exif=? WHERE id=?').run(JSON.stringify({...raw,GPSLatitude:31.123,BodySerialNumber:'private-camera-serial'}),photo.id);
   const published=await request('/api/admin/photos/'+photo.id,{method:'PATCH',data:{version:photo.version,status:'published',date:'2020-01-01',featured:true}});assert.equal(published.status,200);
   const publicPhoto=await (await request('/api/photos/'+photo.id,{auth:false})).json();assert.deepEqual(publicPhoto.exifInfo,info,'editing display date preserves original capture time');
   assert.equal(publicPhoto.exif,undefined);assert.ok(!JSON.stringify(publicPhoto).includes('private-camera-serial'));assert.ok(!JSON.stringify(publicPhoto).includes('GPS'));
   const rendition=Buffer.from(await (await request('/'+photo.src,{auth:false})).arrayBuffer());assert.equal((await sharp(rendition).metadata()).exif,undefined);
  }
  const home=await (await request('/',{auth:false})).text();assert.ok(home.includes('lightbox-exif'));assert.ok(home.includes('1/125 秒'));assert.ok(!home.includes('private-camera-serial'));
  const demo=await (await request('/api/admin/photos/1')).json();assert.equal(demo.exifInfo.available,false);
  assert.deepEqual(await fs.readFile(path.join(nas,'nas.png')),nasBytes);assert.deepEqual(await fs.readdir(path.join(dir,'data','tmp')),[]);
  await fs.utimes(path.join(nas,'nas.png'),new Date(),new Date(Date.now()+5000));assert.equal((await request(endpoint)).status,409);
  await app.db.prepare('UPDATE import_scans SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',scan.id);assert.equal((await request(endpoint)).status,409);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
