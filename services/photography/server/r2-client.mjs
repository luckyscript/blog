import {S3Client} from '@aws-sdk/client-s3'

export function r2Config(env=process.env) {
  for (const key of ['R2_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']) {
    if (!env[key]) throw new Error(`缺少 ${key} 配置`)
  }
  const endpoint=new URL(env.R2_ENDPOINT)
  if (endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.r2.cloudflarestorage.com')||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/') {
    throw new Error('R2_ENDPOINT 必须是 Cloudflare 控制台提供的 HTTPS S3 终结点')
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET)) throw new Error('R2_BUCKET 名称不正确')
  return {
    bucket:env.R2_BUCKET,
    clientOptions:{
      region:'auto',endpoint:endpoint.origin,forcePathStyle:true,maxAttempts:3,
      requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
      credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}
    }
  }
}

export function createR2Client(env=process.env) {
  const {bucket,clientOptions}=r2Config(env)
  return {bucket,client:new S3Client(clientOptions)}
}
