import { mapAsync } from "../server/async-utils.mjs";
import os from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import {createPortfolioServer} from './helpers/database.mjs';

test('NAS previews are private, oriented, bounded, read-only and tied to the scanned source',async()=>{
 const scratch=process.env.TEST_WORK_DIR||path.join(os.tmpdir(),'jianshan-portfolio-tests');
 await fs.mkdir(scratch,{recursive:true});
 const dir=await fs.mkdtemp(path.join(scratch,'previews-')),nas=path.join(dir,'nas');
 await fs.mkdir(nas);
 const bytes=await sharp({create:{width:2400,height:1200,channels:3,background:'#668877'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const filename=path.join(nas,'portrait.jpg');await fs.writeFile(filename,bytes);
 await fs.writeFile(path.join(nas,'broken.jpg'),'not a photo');
 const app=await createPortfolioServer({dataDir:path.join(dir,'data'),nasRoot:nas,seed:false});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function request(route,{method='GET',data,auth=true}={}){
  return fetch(base+route,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base,'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
 }
 try{
  const setup=await request('/api/setup',{method:'POST',data:{password:'preview-test-passphrase'}});assert.equal(setup.status,200);cookie=setup.headers.get('set-cookie').split(';')[0];
  const scan=await (await request('/api/admin/nas/scan',{method:'POST',data:{folder:''}})).json();
  const file=scan.files.find(f=>f.name==='portrait.jpg');assert.ok(file);
  const endpoint=(key=file.key,size='thumb')=>'/api/admin/nas/preview?'+new URLSearchParams({scanId:scan.id,key,size});
  assert.equal((await request(endpoint(),{auth:false})).status,401);
  const snapshots=async () => await mapAsync(
   ['photos','assets','import_jobs'],
   async table => (await app.db.prepare('SELECT count(*) AS n FROM '+table).get()).n
  );
  const before=await snapshots();
  const [thumb,large]=await Promise.all([request(endpoint()),request(endpoint(file.key,'large'))]);
  assert.equal(thumb.status,200);assert.equal(large.status,200);
  assert.equal(thumb.headers.get('content-type'),'image/jpeg');assert.equal(thumb.headers.get('cache-control'),'private, no-store');
  const thumbnail=Buffer.from(await thumb.arrayBuffer()),full=Buffer.from(await large.arrayBuffer());
  const smallInfo=await sharp(thumbnail).metadata(),largeInfo=await sharp(full).metadata();
  assert.deepEqual([smallInfo.width,smallInfo.height],[320,640]);assert.deepEqual([largeInfo.width,largeInfo.height],[800,1600]);
  assert.equal(smallInfo.exif,undefined);assert.equal(largeInfo.exif,undefined);assert.equal(largeInfo.orientation,undefined);
  assert.deepEqual(await fs.readFile(filename),bytes,'source unchanged');assert.deepEqual(await snapshots(),before,'no import records');
  assert.deepEqual(Buffer.from(await (await request(endpoint())).arrayBuffer()),thumbnail,'cached preview');
  assert.equal((await request(endpoint(),{auth:false})).status,401,'cache remains private');
  assert.equal((await request(endpoint('../portrait.jpg'))).status,404);assert.equal((await request(endpoint(file.key,'original'))).status,400);
  assert.equal((await request(endpoint(scan.files.find(f=>f.name==='broken.jpg').key))).status,422);
  await fs.utimes(filename,new Date(),new Date(Date.now()+5000));
  assert.equal((await request(endpoint())).status,409,'changed source invalidates cached preview');
  await fs.writeFile(path.join(dir,'outside.jpg'),bytes);await fs.unlink(filename);await fs.symlink(path.join(dir,'outside.jpg'),filename);
  assert.equal((await request(endpoint())).status,403,'source replaced with escaping symlink');
  await app.db.prepare('UPDATE import_scans SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',scan.id);
  assert.equal((await request(endpoint())).status,409,'expired scan');
  assert.deepEqual(await snapshots(),before);assert.deepEqual(await fs.readdir(path.join(dir,'data','tmp')),[],'preview scratch cleaned');
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
