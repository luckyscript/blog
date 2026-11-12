// Rebuild the static typography asset, not a runtime dependency on fontconfig.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-font-cache-'))
process.env.FONTCONFIG_FILE=fileURLToPath(new URL('./fonts.conf',import.meta.url))
process.env.XDG_CACHE_HOME=scratch
try {
  const {default:sharp}=await import('sharp')
  await sharp({text:{
    text:'<span foreground="white" weight="600" letter_spacing="4000">JIANSHAN</span>\n<span foreground="white" size="27000" letter_spacing="3000">PHOTOGRAPHY</span>',
    font:'Figtree 64',fontfile:fileURLToPath(new URL('./Figtree.ttf',import.meta.url)),align:'right',rgba:true,spacing:10
  }}).png().toFile(fileURLToPath(new URL('./brand-mark.png',import.meta.url)))
}finally{await fs.rm(scratch,{recursive:true,force:true})}
