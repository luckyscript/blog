import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {openDatabase} from '../server/db.mjs'
import {getEquipment,updatePhoto} from '../server/model.mjs'
import {equipment} from '../server/media.mjs'

test('Zf EXIF variants match without confusing the Z fc or changing historical Canon models',()=>{
  for (const Model of ['NIKON Z f','NIKON Zf','Z f','Zf',' Nikon Z F ']) assert.equal(equipment({Model}),'nikon-zf')
  for (const Model of ['NIKON Z fc','NIKON Zfc','NIKON Z 6','']) assert.equal(equipment({Model}),null)
  assert.equal(equipment({Model:'Canon EOS 100D'}),'canon-100d')
})

test('saved equipment upgrades once while preserving custom gear and historical photo metadata',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-equipment-'))
  let db=await openDatabase(dir,{seed:false})
  try {
    const fresh=await getEquipment(db)
    assert.equal(fresh.find(g=>g.id==='nikon-zf').color,'银色')
    assert.ok(!fresh.some(g=>g.id==='canon-100d'))
    const custom={id:'custom-camera',name:'My camera',intro:'Keep this note'}
    await db.prepare("UPDATE settings SET value=? WHERE `key`='equipment'").run(JSON.stringify([{id:'canon-100d',name:'Canon 100D'},custom]))
    await db.prepare('DELETE FROM settings WHERE `key`=?').run('equipment-nikon-zf-silver-2026-10-22')
    const exif=JSON.stringify({Make:'Canon',Model:'Canon EOS 100D'})
    const {lastInsertRowid:id}=await db.prepare('INSERT INTO photos(title,equipment_id,exif,created_at,updated_at) VALUES(?,?,?,?,?)').run('Old photo','canon-100d',exif,'2024-01-01','2024-01-01')
    await db.close()
    db=await openDatabase(dir,{seed:false})
    const upgraded=await getEquipment(db)
    assert.deepEqual(upgraded.map(g=>g.id),['nikon-zf','custom-camera'])
    assert.deepEqual(upgraded[1],custom)
    const photo=await updatePhoto(db,id,{version:1,title:'Updated old photo',equipmentId:'canon-100d'})
    assert.equal(photo.equipmentId,'canon-100d')
    assert.equal(photo.metadataCamera,'Canon EOS 100D')
    assert.equal((await db.prepare('SELECT exif FROM photos WHERE id=?').get(id)).exif,exif)
    await assert.rejects(updatePhoto(db,id,{version:photo.version,equipmentId:'invalid-camera'}),/器材不存在/)
    await db.prepare("UPDATE settings SET value=? WHERE `key`='equipment'").run(JSON.stringify([custom]))
    await db.close()
    db=await openDatabase(dir,{seed:false})
    assert.deepEqual(await getEquipment(db),[custom],'later catalogue edits survive subsequent starts')
  } finally {
    await db.close()
    await fs.rm(dir,{recursive:true,force:true})
  }
})
