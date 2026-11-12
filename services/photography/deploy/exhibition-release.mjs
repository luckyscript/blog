// Scoped, reversible editorial upgrade. No photo titles, dates or masters change.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {openDatabase,transaction} from '../server/db.mjs'
import {getStudio,saveStudio,studioDefaults} from '../server/studio-config.mjs'
import {collectionsData,saveCollection} from '../server/model.mjs'

const previousDefaults={desktopHeight:560,titleTop:16,titleSize:64,mobileTitleSize:38,shade:35,headline:'万物有光，\n值得被看见。',intro:'走进山野，也走进日常。\n用镜头，收藏那些不想错过的瞬间。',about:'我喜欢山野的辽阔，也喜欢寻常街角的光。\n记录那些值得再次回望的瞬间。'}
export function exhibitionSettings(current) {
  return Object.fromEntries(Object.entries(previousDefaults).filter(([key,value])=>current[key]===value).map(([key])=>[key,studioDefaults[key]]))
}
export function bookLayout(ids) {
  return ids.map((photoId,i)=>({type:'photo',photoId,span:i===0||i===ids.length-1||ids.length===3||(ids.length%2===1&&i===3)?'wide':'half'}))
}
export async function applyExhibition(db,dataDir,{apply=false}={}) {
  const settings=await getStudio(db),patch=exhibitionSettings(settings)
  const row=await db.prepare('SELECT * FROM collections WHERE slug=?').get('ningxia')
  const album=row&&row.status==='published'&&row.layout==='[]'?(await collectionsData(db,true)).find(a=>a.id===row.id):null
  const plan={settings:Object.keys(patch),album:album?album.slug:null}
  if(!apply||(!plan.settings.length&&!album))return plan
  const directory=path.join(dataDir,'maintenance');await fs.mkdir(directory,{recursive:true,mode:0o700})
  const checkpoint=path.join(directory,'exhibition-before-'+Date.now()+'.json')
  // Includes old paths for rollback; contains no account hashes or credentials.
  await fs.writeFile(checkpoint,JSON.stringify({studio:await db.prepare("SELECT * FROM settings WHERE `key`='studio'").get(),collection:row,collectionPhotos:row?await db.prepare('SELECT * FROM collection_photos WHERE collection_id=? ORDER BY sort_order').all(row.id):[],renditions:await db.prepare('SELECT * FROM renditions ORDER BY id').all()},null,2),{mode:0o600,flag:'wx'})
  await transaction(db,async()=>{
    if(plan.settings.length)await saveStudio(db,{version:settings.version,...patch})
    if(album)await saveCollection(db,album.id,{...album,sortOrder:album.sort_order,layout:bookLayout(album.photos)})
  })
  return {...plan,checkpoint}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataDir=path.resolve(process.env.PORTFOLIO_DATA_DIR||'data')
  const db=await openDatabase(dataDir,{client:process.env.DB_CLIENT||'sqlite',initialize:false,recover:false})
  try{console.log(JSON.stringify(await applyExhibition(db,dataDir,{apply:process.argv.includes('--apply')})))}finally{await db.close()}
}
