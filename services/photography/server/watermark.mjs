import sharp from 'sharp'
import fs from 'node:fs/promises'

export const renditionVersion='brand-v2'
let brand
async function brandImage() {
  if(!brand)brand=fs.readFile(new URL('./fonts/brand-mark.png',import.meta.url)).catch(error=>{brand=null;throw error})
  return brand
}

// Burn the mark into display pixels, never the master or NAS source. Compositing
// happens after EXIF orientation and resize, so it stays in the visible corner.
export async function displayImage(input,{width,format='jpeg',quality=88,flatten=false}={}) {
  const metadata=await sharp(input,{limitInputPixels:80_000_000}).metadata()
  const rotated=metadata.orientation>=5
  const originalWidth=rotated?metadata.height:metadata.width,originalHeight=rotated?metadata.width:metadata.height
  const scale=width?Math.min(1,width/originalWidth,width/originalHeight):1
  const w=Math.max(1,Math.round(originalWidth*scale)),h=Math.max(1,Math.round(originalHeight*scale))
  const margin=Math.min(Math.max(1,Math.round(Math.min(w,h)*0.025)),Math.floor((Math.min(w,h)-1)/2))
  const markWidth=Math.max(1,Math.min(w-2*margin,Math.round(Math.min(w,h)*0.15)))
  const mark=await sharp(await brandImage()).resize({width:markWidth,height:Math.max(1,h-2*margin),fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const white=Buffer.from(mark.data),shadow=Buffer.from(mark.data)
  for(let i=0;i<white.length;i+=4){white[i+3]=Math.round(white[i+3]*0.45);shadow[i]=shadow[i+1]=shadow[i+2]=0;shadow[i+3]=Math.round(shadow[i+3]*0.28)}
  const left=w-margin-mark.info.width,top=h-margin-mark.info.height
  const raw={width:mark.info.width,height:mark.info.height,channels:4}
  let pipeline=sharp(input,{limitInputPixels:80_000_000}).rotate().resize({width:w,height:h,fit:'fill'}).toColourspace('srgb')
  if(flatten)pipeline=pipeline.flatten({background:'#eef1e8'})
  return pipeline.composite([
    {input:shadow,raw,left:Math.min(left+1,w-mark.info.width),top:Math.min(top+1,h-mark.info.height)},
    {input:white,raw,left,top}
  ]).toFormat(format,{quality})
}
