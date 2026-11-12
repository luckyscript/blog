import fs from 'node:fs'
import path from 'node:path'
const [root,bridge]=process.argv.slice(2)
if(!root||!bridge)throw new Error('Usage: apply-bridge.mjs PROJECT BRIDGE_MODULE')
const authFile=path.join(root,'server/auth.mjs'),indexFile=path.join(root,'server/index.mjs')
let auth=fs.readFileSync(authFile,'utf8'),index=fs.readFileSync(indexFile,'utf8')
if(!auth.includes("from './blog-bridge.mjs'")){
  if(!auth.includes('function checkOrigin(req){')||!auth.includes('async function session(req) {'))throw new Error('Unsupported authentication source')
  auth="import {verifyBridge} from './blog-bridge.mjs'\n"+auth
  auth=auth.replace('function checkOrigin(req){','function checkOrigin(req){if(verifyBridge(req).admin)return;')
  auth=auth.replace('async function session(req) {','async function session(req) {if(verifyBridge(req).admin)return true;')
}
if(!index.includes("pathname==='/api/blog-site'")){
  const marker="   if(pathname==='/api/session'"
  if(!index.includes(marker))throw new Error('Unsupported server source')
  index="import {verifyBridge} from './blog-bridge.mjs'\n"+index
  index=index.replace(marker,"   if(pathname==='/api/blog-site'&&method==='GET'){if(!verifyBridge(req).valid)throw failure(403,'摄影连接未授权');return send(200,await publicData(db));}\n"+marker)
}
index=index.replace('if(req.headers.host!==new URL(origin).host)', 'if(req.headers.host!==new URL(origin).host&&!verifyBridge(req).valid)')
fs.copyFileSync(bridge,path.join(root,'server/blog-bridge.mjs'))
for(const [file,content]of [[authFile,auth],[indexFile,index]]){const temporary=file+'.blog-next';fs.writeFileSync(temporary,content,{mode:0o600});fs.renameSync(temporary,file)}
console.log('Photography bridge installed; original login remains available')
