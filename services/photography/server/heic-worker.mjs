import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import decode from 'heic-decode';
import sharp from 'sharp';
try{
 const {width,height,data}=await decode({buffer:await fs.readFile(workerData.file)});
 if(width*height>workerData.maxPixels)throw Error('照片像素超过限制');
 const png=await sharp(Buffer.from(data),{raw:{width,height,channels:4}}).png().toBuffer();
 parentPort.postMessage({png});
}catch(error){parentPort.postMessage({error:error.message});}
