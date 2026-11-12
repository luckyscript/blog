import sharp from 'sharp';
import {Worker} from 'node:worker_threads';
const limit=80_000_000;
export async function imageInput(file){
 const metadata=await sharp(file,{limitInputPixels:limit,failOn:'warning'}).metadata();
 if(!metadata.width||!metadata.height||metadata.width*metadata.height>limit)throw Object.assign(Error('照片像素超过限制'),{status:413});
 if(['jpeg','png'].includes(metadata.format)&&!(metadata.pages>1))return {input:file,metadata};
 if(metadata.format!=='heif'||metadata.compression!=='hevc')throw Object.assign(Error('请选择 JPEG、PNG 或 HEIC 成品照片'),{status:415});
 const input=await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./heic-worker.mjs',import.meta.url),{workerData:{file,maxPixels:limit},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:512}});
  const timer=setTimeout(()=>{worker.terminate();reject(Object.assign(Error('HEIC 解码超时，请导出 JPEG 后重试'),{status:422}));},60000);
  worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(Object.assign(Error('无法解码此 HEIC，请重新导出后重试'),{status:422})):resolve(Buffer.from(message.png));});
  worker.once('error',error=>{clearTimeout(timer);reject(error);});
  worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Object.assign(Error('HEIC 解码未完成，请重试'),{status:422}));});
 });
 const rendered=await sharp(input).metadata();return {input,metadata:{...rendered,format:'heif'}};
}
