import fs from 'node:fs'

export function mysqlConfig(env=process.env) {
  for (const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD']) {
    if (!env[key]) throw new Error(`缺少 ${key} 配置`)
  }
  const port=Number(env.MYSQL_PORT||3306)
  if (!Number.isInteger(port)||port<1||port>65535) throw new Error('MYSQL_PORT 不正确')
  if (env.MYSQL_SSL&&!['true','false'].includes(env.MYSQL_SSL)) throw new Error('MYSQL_SSL 必须为 true 或 false')
  return {
    host:env.MYSQL_HOST, port, database:env.MYSQL_DATABASE,
    user:env.MYSQL_USER, password:env.MYSQL_PASSWORD,
    charset:'utf8mb4', connectTimeout:10000, dateStrings:true,
    supportBigNumbers:true, decimalNumbers:true, multipleStatements:false,
    ...(env.MYSQL_SSL==='true'?{ssl:{rejectUnauthorized:true,...(env.MYSQL_SSL_CA?{ca:fs.readFileSync(env.MYSQL_SSL_CA,'utf8')}:{})}}:{})
  }
}

export function databaseError(error) {
  const code=error.code||'DATABASE_ERROR'
  const hints={
    ETIMEDOUT:'连接超时，请检查 RDS 外网地址及 IP 白名单',
    ENOTFOUND:'数据库地址无法解析',
    ECONNREFUSED:'数据库拒绝连接，请检查地址和端口',
    ER_ACCESS_DENIED_ERROR:'数据库账号或密码不正确，或账号无访问权限',
    ER_BAD_DB_ERROR:'数据库不存在',
    ER_DBACCESS_DENIED_ERROR:'账号没有该数据库的访问权限'
  }
  return `${code}: ${hints[code]||'数据库操作失败，请检查服务端配置'}`
}
