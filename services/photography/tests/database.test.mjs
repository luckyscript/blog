import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {scryptSync,createHash} from 'node:crypto'
import {createPortfolioServer} from './helpers/database.mjs'
import {openDatabase,transaction,dataTables} from '../server/db.mjs'
import {migrateSqlite} from '../server/database-cli.mjs'
import {readRecords,importIntoEmptyDatabase} from '../server/data-transfer.mjs'
import {updatePhoto} from '../server/model.mjs'
import {saveStudio,getStudio} from '../server/studio-config.mjs'
import {createAuth} from '../server/auth.mjs'
import {mysqlConfig,databaseError} from '../server/mysql-config.mjs'

test('migration preserves every business table and refuses overwrite; failure rolls back',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-transfer-'))
  const sourceDir=path.join(dir,'source')
  let source=await openDatabase(sourceDir,{seed:true})
  let app
  try {
    const password='migration-test-password',salt='test-salt'
    await source.prepare('INSERT INTO admin_users VALUES(1,?,?)').run(scryptSync(password,salt,64).toString('hex'),salt)
    await source.prepare('INSERT INTO sessions VALUES(?,?)').run('existing-session',Date.now()+3600000)
    await source.prepare('UPDATE photos SET date=NULL,rating=5,private_note=?,exif=? WHERE id=1').run('私密笔记 ⛰️',JSON.stringify({DateTimeOriginal:'2024:02:03 04:05:06'}))
    await source.prepare('INSERT INTO import_scans VALUES(?,?,?,?,?)').run('scan','/Volumes/Photos','chosen','[]','2026-09-17T00:00:00.000Z')
    await source.prepare('INSERT INTO import_jobs(id,filename,source_type,source_path,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('job','原片.jpg','nas','chosen/原片.jpg','failed','2026-09-17T00:00:00.000Z','2026-09-17T00:00:00.000Z')
    const expected=await readRecords(source)
    await source.close();source=null
    const sourceFile=path.join(sourceDir,'db/portfolio.sqlite')
    const before=createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex')
    app=await createPortfolioServer({dataDir:path.join(dir,'target'),seed:false,database:{initialize:false,recover:false}})
    await app.processor.close()
    // Roll back earlier inserts when a later foreign-key relationship is invalid.
    const invalid=structuredClone(expected)
    invalid.collection_photos.push({collection_id:999999,photo_id:1,sort_order:0})
    await assert.rejects(importIntoEmptyDatabase(app.db,invalid))
    for(const table of dataTables)assert.equal((await app.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n,0)
    const counts=await migrateSqlite(sourceDir,app.db)
    for(const table of dataTables)assert.equal(counts[table],expected[table].length)
    const actual=await readRecords(app.db)
    const normalize=rows=>rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).sort()))).sort()
    for(const table of dataTables)assert.deepEqual(normalize(actual[table]),normalize(expected[table]),table)
    await assert.rejects(migrateSqlite(sourceDir,app.db),/已有业务数据/)
    assert.equal(createHash('sha256').update(await fs.readFile(sourceFile)).digest('hex'),before)
    const cookie=await createAuth(app.db,'http://localhost').signIn({headers:{origin:'http://localhost'},socket:{remoteAddress:'127.0.0.1'}},password)
    assert.match(cookie,/jianshan_session=/)
    const inserted=await app.db.prepare('INSERT INTO photos(title,created_at,updated_at) VALUES(?,?,?)').run('迁移后的作品','2026-09-17T00:00:00.000Z','2026-09-17T00:00:00.000Z')
    assert.ok(Number(inserted.lastInsertRowid)>Math.max(...expected.photos.map(p=>p.id)))
    if(app.db.dialect==='mysql')await assert.rejects(fs.access(path.join(dir,'target','db/portfolio.sqlite')))
  } finally {await source?.close();await app?.close();await fs.rm(dir,{recursive:true,force:true})}
})

test('async transactions isolate unrelated writes and concurrent edits detect stale versions',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-transactions-'))
  const app=await createPortfolioServer({dataDir:dir,seed:true})
  try {
    await app.processor.idle()
    let entered,release
    const inside=new Promise(resolve=>{entered=resolve})
    const gate=new Promise(resolve=>{release=resolve})
    const failing=transaction(app.db,async()=>{
      await app.db.prepare('INSERT INTO settings VALUES(?,?)').run('rolled-back','no')
      entered();await gate;throw new Error('rollback')
    })
    const rejected=assert.rejects(failing,/rollback/)
    await inside
    const unrelated=app.db.prepare('INSERT INTO settings VALUES(?,?)').run('unrelated','yes')
    release();await rejected;await unrelated
    assert.equal(await app.db.prepare('SELECT value FROM settings WHERE `key`=?').get('rolled-back'),undefined)
    assert.equal((await app.db.prepare('SELECT value FROM settings WHERE `key`=?').get('unrelated')).value,'yes')
    const photo=await app.db.prepare('SELECT * FROM photos WHERE id=1').get()
    const edits=await Promise.allSettled(['first','second'].map(title=>updatePhoto(app.db,photo.id,{version:photo.version,title})))
    assert.equal(edits.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(edits.find(r=>r.status==='rejected').reason.status,409)
    const studio=await getStudio(app.db)
    const settings=await Promise.allSettled(['one','two'].map(headline=>saveStudio(app.db,{version:studio.version,headline})))
    assert.equal(settings.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(settings.find(r=>r.status==='rejected').reason.status,409)
    await assert.rejects(app.db.prepare('INSERT OR IGNORE INTO photo_versions(photo_id,asset_id,created_at) VALUES(?,?,?)').run(999999,'missing','2026-09-17T00:00:00.000Z'))
    await app.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('duplicate','original')
    assert.equal((await app.db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('duplicate','changed')).changes,0)
  } finally {await app.close();await fs.rm(dir,{recursive:true,force:true})}
})

test('MySQL config keeps passwords literal, validates port and redacts driver errors',()=>{
  const env={MYSQL_HOST:'localhost',MYSQL_DATABASE:'test',MYSQL_USER:'user',MYSQL_PASSWORD:'has@colon:and#hash'}
  assert.equal(mysqlConfig(env).password,env.MYSQL_PASSWORD)
  assert.equal(mysqlConfig({...env,MYSQL_SSL:'true'}).ssl.rejectUnauthorized,true)
  assert.throws(()=>mysqlConfig({...env,MYSQL_PORT:'0'}),/MYSQL_PORT/)
  assert.throws(()=>mysqlConfig({...env,MYSQL_PASSWORD:''}),/MYSQL_PASSWORD/)
  assert.ok(!databaseError({code:'ER_ACCESS_DENIED_ERROR',message:env.MYSQL_PASSWORD}).includes(env.MYSQL_PASSWORD))
})
