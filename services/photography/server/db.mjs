import {DatabaseSync} from 'node:sqlite'
import {AsyncLocalStorage} from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import mysql from 'mysql2/promise'
import {mysqlConfig} from './mysql-config.mjs'
import {studioDefaults} from './studio-config.mjs'

export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
export const now=()=>new Date().toISOString()
export const transaction=(db,fn)=>db.transaction(fn)
export const dataTables=['admin_users','sessions','settings','assets','renditions','photos','collections','collection_photos','import_jobs','import_scans','photo_versions']

// Unrelated requests wait outside the current transaction, including on SQLite.
export function databaseAdapter(driver,dialect) {
  const context=new AsyncLocalStorage()
  let pending=Promise.resolve()
  function schedule(fn) {
    const current=context.getStore()
    if (current?.active) return fn(current.connection)
    const result=pending.then(()=>fn(driver))
    pending=result.catch(()=>{})
    return result
  }
  async function execute(connection,sql,params=[],kind='run') {
    if (dialect==='sqlite') {
      if (kind==='exec') return connection.exec(sql)
      return connection.prepare(sql)[kind](...params)
    }
    // Ignore duplicate keys only, never truncation or foreign-key errors.
    const ignore=/^INSERT OR IGNORE INTO /i.test(sql)
    sql=sql.replace(/^INSERT OR IGNORE INTO /i,'INSERT INTO ')
    try {
      for (const p of params) if (p!==null&&!['string','number'].includes(typeof p)) throw new Error('Unsupported SQL parameter')
      const [rows]=kind==='exec'?await connection.query(sql):await connection.execute(sql,params)
      if (kind==='get') return rows[0]
      if (kind==='all') return rows
      return {changes:rows.affectedRows,lastInsertRowid:rows.insertId}
    } catch (error) {
      if (ignore&&error.code==='ER_DUP_ENTRY') return {changes:0,lastInsertRowid:0}
      throw error
    }
  }
  const db={
    dialect,
    prepare(sql) {
      return Object.fromEntries(['get','all','run'].map(kind=>[kind,(...params)=>schedule(c=>execute(c,sql,params,kind))]))
    },
    exec:sql=>schedule(c=>execute(c,sql,[],'exec')),
    transaction(fn) {
      if (context.getStore()?.active) return Promise.resolve().then(fn)
      return schedule(async()=>{
        const connection=dialect==='mysql'?await driver.getConnection():driver
        const scope={connection,active:true}
        try {
          if (dialect==='mysql') {await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await connection.beginTransaction()}
          else connection.exec('BEGIN IMMEDIATE')
          const value=await context.run(scope,fn)
          if (dialect==='mysql') await connection.commit()
          else connection.exec('COMMIT')
          return value
        } catch (error) {
          try {
            if (dialect==='mysql') await connection.rollback()
            else connection.exec('ROLLBACK')
          } catch {}
          throw error
        } finally {
          scope.active=false
          if (dialect==='mysql') connection.release()
        }
      })
    },
    close:()=>schedule(()=>dialect==='mysql'?driver.end():driver.close())
  }
  return db
}

export async function openDatabase(dataDir,{seed=true,client='sqlite',mysqlOptions,initialize=true,recover=true}={}) {
  let db
  if (client==='mysql') {
    db=databaseAdapter(mysql.createPool({...mysqlOptions||mysqlConfig(),connectionLimit:4,waitForConnections:true,queueLimit:100,flags:'-FOUND_ROWS'}),'mysql')
  } else if (client==='sqlite') {
    fs.mkdirSync(path.join(dataDir,'db'),{recursive:true,mode:0o700})
    const raw=new DatabaseSync(path.join(dataDir,'db/portfolio.sqlite'))
    raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000')
    db=databaseAdapter(raw,'sqlite')
  } else throw new Error('DB_CLIENT 仅支持 mysql 或 sqlite')
  try {
    await migrateSchema(db)
    if (client==='mysql'&&initialize&&fs.existsSync(path.join(dataDir,'db/portfolio.sqlite'))&&!(await db.prepare("SELECT value FROM settings WHERE `key`='initialized'").get())) throw new Error('发现原 SQLite 数据，请先停止旧服务并运行 npm run db:migrate')
    if (initialize) {
      await initializeData(db,seed)
      await transaction(db,async()=>{
        const data=JSON.parse(fs.readFileSync(path.join(projectRoot,'src/content.json'),'utf8'))
        await db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('equipment',JSON.stringify(data.equipment))
        const updateKey='equipment-nikon-zf-silver-2026-10-22'
        if (!(await db.prepare('SELECT value FROM settings WHERE `key`=?').get(updateKey))) {
          const saved=JSON.parse((await db.prepare("SELECT value FROM settings WHERE `key`='equipment'").get()).value)
          const index=saved.findIndex(g=>g.id==='canon-100d')
          const updated=saved.filter(g=>g.id!=='canon-100d')
          if (!updated.some(g=>g.id==='nikon-zf')) updated.splice(index<0?0:index,0,data.equipment.find(g=>g.id==='nikon-zf'))
          await db.prepare("UPDATE settings SET value=? WHERE `key`='equipment'").run(JSON.stringify(updated))
          await db.prepare('INSERT INTO settings VALUES(?,?)').run(updateKey,'true')
        }
        await db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('studio',JSON.stringify(studioDefaults))
      })
    }
    if (recover) await db.prepare("UPDATE import_jobs SET status='queued' WHERE status='processing'").run()
    return db
  } catch (error) {await db.close();throw error}
}

async function migrateSchema(db) {
  if (db.dialect==='mysql') {
    // MySQL DDL commits implicitly. An advisory lock and idempotent DDL allow
    // retry after interrupted setup without pretending DDL can roll back.
    await db.transaction(async()=>{
      const lock=await db.prepare("SELECT GET_LOCK(CONCAT(DATABASE(), ':jianshan-schema'), 30) AS acquired").get()
      if (lock.acquired!==1) throw new Error('数据库初始化正在进行，请稍后重试')
      try {
        const sql=fs.readFileSync(path.join(projectRoot,'server/mysql-schema.sql'),'utf8')
        for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.exec(statement)
        await db.prepare('INSERT OR IGNORE INTO migrations VALUES(?,?)').run('001_mysql',now())
      } finally {await db.prepare("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':jianshan-schema'))").get()}
    })
    return
  }
  await db.exec('CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  for (const name of fs.readdirSync(path.join(projectRoot,'server/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
    if (await db.prepare('SELECT name FROM migrations WHERE name=?').get(name)) continue
    await transaction(db,async()=>{
      await db.exec(fs.readFileSync(path.join(projectRoot,'server/migrations',name),'utf8'))
      await db.prepare('INSERT INTO migrations VALUES(?,?)').run(name,now())
    })
  }
}

async function initializeData(db,seed) {
  await transaction(db,async()=>{
    const initialized=await db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('initialized','true')
    if (!initialized.changes) return
    if (seed) {
      const data=JSON.parse(fs.readFileSync(path.join(projectRoot,'src/content.json'),'utf8'))
      for (const p of data.photos) await db.prepare('INSERT INTO photos(id,title,description,category,date,featured,featured_order,status,is_demo,demo_data,author,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id,p.title,p.description,p.category,p.date,+p.featured,p.id,'published',1,JSON.stringify(p),p.author,p.source,now(),now())
      for (const [i,a] of data.albums.entries()) {
        const id=Number((await db.prepare('INSERT INTO collections(slug,title,description,story,label,english,quote,cover_photo_id,status,sort_order,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(a.slug,a.title,a.description,a.story,a.label,a.english,a.quote,a.cover,'published',i,1)).lastInsertRowid)
        for (const [j,pid] of a.photos.entries()) await db.prepare('INSERT INTO collection_photos VALUES(?,?,?)').run(id,pid,j)
      }
    }
    await db.prepare('INSERT INTO settings VALUES(?,?)').run('nas_address','smb://10.10.10.128/Photos')
  })
}
