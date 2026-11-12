import {dataTables,transaction} from './db.mjs'

export async function readRecords(db,tables=dataTables) {
  return transaction(db,async()=>{
    const records={}
    for (const table of tables) {
      if (!dataTables.includes(table)) throw new Error('无效数据表')
      records[table]=await db.prepare(`SELECT * FROM ${table}`).all()
    }
    return records
  })
}

export async function insertRecords(db,records,tables=dataTables) {
  for (const table of tables) {
    if (!dataTables.includes(table)||!Array.isArray(records[table])) throw new Error('无效数据表')
    for (const row of records[table]) {
      const columns=Object.keys(row)
      if (!columns.length||columns.some(c=>!/^[a-z_][a-z0-9_]*$/.test(c))) throw new Error('无效数据列')
      await db.prepare(`INSERT INTO ${table}(${columns.map(c=>'`'+c+'`').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row))
    }
  }
}

export async function importIntoEmptyDatabase(db,records) {
  return transaction(db,async()=>{
    for (const table of dataTables) {
      if ((await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n) throw new Error('目标数据库已有业务数据，迁移已停止，未覆盖任何记录')
    }
    await insertRecords(db,records)
    const counts={}
    for (const table of dataTables) {
      counts[table]=(await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n
      if (counts[table]!==records[table].length) throw new Error(`迁移校验失败：${table}`)
    }
    return counts
  })
}
