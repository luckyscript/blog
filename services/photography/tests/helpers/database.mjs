import {after} from 'node:test'
import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import {createPortfolioServer as createServer} from '../../server/index.mjs'
import {openDatabase} from '../../server/db.mjs'
import {migrateSqlite} from '../../server/database-cli.mjs'

const databases=new Set()
const socketPath=process.env.TEST_MYSQL_SOCKET
const options={socketPath,user:'root',charset:'utf8mb4'}

// Opt-in testing only: isolated schemas on a local socket, never .env or RDS.
export async function createPortfolioServer(config) {
  if (!socketPath) return createServer(config)
  const database='test_jianshan_'+createHash('sha256').update(path.resolve(config.dataDir)).digest('hex').slice(0,20)
  if (!databases.has(database)) {
    const connection=await mysql.createConnection(options)
    try {await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)} finally {await connection.end()}
    databases.add(database)
    if (await fs.stat(path.join(config.dataDir,'db/portfolio.sqlite')).catch(()=>null)) {
      const target=await openDatabase(config.dataDir,{client:'mysql',mysqlOptions:{...options,database},initialize:false,recover:false})
      try {await migrateSqlite(config.dataDir,target)} finally {await target.close()}
    }
  }
  return createServer({...config,database:{...config.database,client:'mysql',mysqlOptions:{...options,database}}})
}

after(async()=>{
  if (!databases.size) return
  const connection=await mysql.createConnection(options)
  try {
    for (const name of databases) await connection.query(`DROP DATABASE \`${name}\``)
  } finally {await connection.end()}
})
