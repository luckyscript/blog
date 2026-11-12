import {createHmac,timingSafeEqual} from 'node:crypto'
const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1'])
const message=(method,path,time,role)=>['rain-photography-v1',method,path,time,role].join('\n')
/** @param {string} method @param {string} path @param {{secret?: string, admin?: boolean, now?: number}} options */
export function bridgeHeaders(method,path,{secret,admin=false,now=Date.now()}={}) {
  if(!/^[a-f0-9]{64}$/.test(secret||''))throw new Error('PHOTOGRAPHY_BRIDGE_UNAVAILABLE')
  const time=String(Math.floor(now/1000)),role=admin?'admin':'public'
  const signature=createHmac('sha256',secret).update(message(method,path,time,role)).digest('hex')
  return {'x-rain-photo-time':time,'x-rain-photo-role':role,'x-rain-photo-signature':signature}
}
export function verifyBridge(req,secret=process.env.BLOG_PHOTOGRAPHY_BRIDGE_SECRET,now=Date.now()) {
  const invalid={valid:false,admin:false},time=req.headers['x-rain-photo-time'],role=req.headers['x-rain-photo-role'],signature=req.headers['x-rain-photo-signature']
  if(!loopback.has(req.socket.remoteAddress)||!/^[a-f0-9]{64}$/.test(secret||'')||typeof time!=='string'||!/^\d{10}$/.test(time)||Math.abs(now/1000-Number(time))>60||!['public','admin'].includes(role)||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))return invalid
  const expected=createHmac('sha256',secret).update(message(req.method,req.url,time,role)).digest()
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return invalid
  return {valid:true,admin:role==='admin'}
}
