import fs from 'node:fs/promises'
import path from 'node:path'
import {displayImage,renditionVersion} from './watermark.mjs'

export async function writeRenditions(storage,id,input,workspace) {
  const variants=[]
  for(const [width,format]of [[640,'webp'],[1280,'webp'],[2560,'webp'],[2560,'jpeg']]){
    const relative=`derivatives/${id}/${renditionVersion}/${width}.${format==='jpeg'?'jpg':format}`
    const destination=path.join(workspace,`${width}.${format}`)
    const result=await (await displayImage(input,{width,format})).toFile(destination)
    await storage.putFile(relative,destination)
    await fs.rm(destination,{force:true})
    variants.push({id:`${id}-${width}-${format}`,width:result.width,height:result.height,format,path:relative})
  }
  return variants
}
