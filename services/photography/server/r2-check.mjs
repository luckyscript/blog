import {randomUUID} from 'node:crypto'
import {HeadBucketCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3'
import {createR2Client} from './r2-client.mjs'

let client
try {
  const connection=createR2Client()
  client=connection.client
  const Bucket=connection.bucket
  const send=command=>client.send(command,{abortSignal:AbortSignal.timeout(30000)})
  await send(new HeadBucketCommand({Bucket}))
  console.log(`R2 连接成功：${Bucket}`)
  if (process.argv.includes('--write')) {
    const Key=`_checks/jianshan-${randomUUID()}.txt`
    const Body=Buffer.from('JIANSHAN R2 connection check / 见山')
    // Always attempt cleanup, including when the upload result is ambiguous.
    try {
      await send(new PutObjectCommand({Bucket,Key,Body,ContentType:'text/plain; charset=utf-8',CacheControl:'no-store'}))
      const result=await send(new GetObjectCommand({Bucket,Key}))
      const actual=Buffer.from(await result.Body.transformToByteArray())
      if (!actual.equals(Body)) throw new Error('R2 下载内容校验失败')
    } finally {
      try {await send(new DeleteObjectCommand({Bucket,Key}))}
      catch(error) {console.error(`临时验证对象清理失败，待清理键：${Key}`);throw error}
    }
    try {
      await send(new HeadObjectCommand({Bucket,Key}))
      throw new Error('R2 临时验证对象仍然存在')
    } catch(error) {if(error.$metadata?.httpStatusCode!==404)throw error}
    console.log('上传、下载、字节校验与删除均通过；临时验证对象已删除。')
  }
} catch(error) {
  // Never print SDK request objects, authorization headers or credentials.
  console.error(error.$metadata?`R2 检查失败：${error.name} / HTTP ${error.$metadata.httpStatusCode}`:error.message)
  process.exitCode=1
} finally {client?.destroy()}
