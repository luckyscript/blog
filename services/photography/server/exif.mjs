import exifr from 'exifr';

// The same allowlist is used for NAS previews, imports and public photo details.
// Location, serial numbers and unrelated file metadata never enter this view.
const textKeys=['Make','Model','LensModel','DateTimeOriginal','OffsetTimeOriginal'];
const numberKeys=['FNumber','ExposureTime','ISO','FocalLength'];
export function safeExif(input={}){
 const result={};
 for(const key of textKeys){
  if(typeof input?.[key]!=='string')continue;
  const value=input[key].replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,240);
  if(value)result[key]=value;
 }
 for(const key of numberKeys){const value=input?.[key];if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e7)result[key]=value;}
 return result;
}
export async function readExif(file){
 return safeExif(await exifr.parse(file,{pick:[...textKeys,...numberKeys],reviveValues:false}).catch(()=>null));
}
const decimal=value=>String(Number(value.toFixed(3)));
function shutter(seconds){
 if(!seconds)return null;
 if(seconds>=1)return `${decimal(seconds)} 秒`;
 const denominator=Math.round(1/seconds);
 return denominator>1&&Math.abs(1/denominator-seconds)/seconds<0.015?`1/${denominator} 秒`:`${Number(seconds.toPrecision(3))} 秒`;
}
function captureTime(value,offset){
 const match=value?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
 if(!match)return null;
 const [,year,month,day,hour,minute,second]=match;
 const date=`${year}-${month}-${day}T${hour}:${minute}:${second}`;
 const parsed=new Date(date+'Z');
 if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,19)!==date)return null;
 const zone=/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset||'')?` · UTC${offset}`:'';
 return date.replace('T',' ')+zone;
}
export function exifInfo(input){
 const exif=safeExif(input),{Make:make,Model:model}=exif;
 const brand=make?.replace(/\s+(corporation|corp\.?|inc\.?)$/i,'');
 const camera=model?(brand&&!model.toLowerCase().includes(brand.toLowerCase())?`${brand} ${model}`:model):make||null;
 const values=[
  ['camera','相机',camera],['lens','镜头',exif.LensModel||null],
  ['capturedAt','原始拍摄时间',captureTime(exif.DateTimeOriginal,exif.OffsetTimeOriginal)],
  ['focalLength','焦距',exif.FocalLength?`${decimal(exif.FocalLength)} mm`:null],
  ['aperture','光圈',exif.FNumber?`f/${decimal(exif.FNumber)}`:null],
  ['shutter','快门',shutter(exif.ExposureTime)],['iso','感光度',exif.ISO?`ISO ${decimal(exif.ISO)}`:null]
 ];
 return {available:values.some(([, ,value])=>value!==null),fields:values.map(([key,label,value])=>({key,label,value})),summary:values.filter(([key])=>['focalLength','aperture','shutter','iso'].includes(key)).map(([, ,value])=>value).filter(Boolean).join(' · ')};
}
