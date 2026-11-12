import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {DatabaseSync,backup} from 'node:sqlite'
import mysql from 'mysql2/promise'
import {openDatabase,projectRoot} from './db.mjs'
import {mysqlConfig,databaseError} from './mysql-config.mjs'
import {readRecords,importIntoEmptyDatabase} from './data-transfer.mjs'

// Snapshot an existing SQLite store read-only, then upgrade the temporary copy.
// Source IDs, password hashes, sessions, EXIF and file paths are preserved.
export async function migrateSqlite(dataDir,target) {
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jianshan-migrate-'))
  let source
  try {
    await fs.mkdir(path.join(scratch,'db'))
    const raw=new DatabaseSync(path.join(dataDir,'db/portfolio.sqlite'),{readOnly:true})
    try {await backup(raw,path.join(scratch,'db/portfolio.sqlite'))} finally {raw.close()}
    source=await openDatabase(scratch,{initialize:false,recover:false})
    const records=await readRecords(source)
    return await importIntoEmptyDatabase(target,records)
  } finally {
    await source?.close()
    await fs.rm(scratch,{recursive:true,force:true})
  }
}

async function main() {
  const action=process.argv[2]
  if (action==='check') {
    const connection=await mysql.createConnection(mysqlConfig())
    try {
      const [rows]=await connection.query('SELECT DATABASE() AS name, VERSION() AS version')
      const [tables]=await connection.query('SHOW TABLES')
      console.log(`MySQL 连接成功：${rows[0].name} / ${rows[0].version}，${tables.length} 张表`)
    } finally {await connection.end()}
    return
  }
  if (!['init','migrate'].includes(action)) throw new Error('用法：npm run db:check / db:init / db:migrate -- [原数据目录]')
  const dataDir=path.resolve(process.argv[3]||process.env.PORTFOLIO_DATA_DIR||path.join(projectRoot,'data'))
  const db=await openDatabase(dataDir,{client:'mysql',initialize:false,recover:false})
  try {
    if (action==='migrate') {
      const counts=await migrateSqlite(dataDir,db)
      console.log('迁移完成并已核对记录数；原 SQLite 与照片文件未修改。')
      console.log(JSON.stringify(counts,null,2))
      console.log(`启动时 PORTFOLIO_DATA_DIR 必须继续指向：${dataDir}`)
    } else {
      try {await fs.access(path.join(dataDir,'db/portfolio.sqlite'));throw new Error('发现原 SQLite 数据，请先运行 npm run db:migrate，避免初始化空站点')} catch(error) {if(error.code!=='ENOENT')throw error}
      console.log('MySQL 表结构初始化完成。启动服务后创建管理员，照片不会存入数据库。')
    }
  } finally {await db.close()}
}

if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await main()} catch(error) {
    console.error(error.code?databaseError(error):error.message)
    process.exitCode=1
  }
}
