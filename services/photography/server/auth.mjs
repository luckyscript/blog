import {verifyBridge} from './blog-bridge.mjs'
import {randomBytes,createHash,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {failure} from './media.mjs';
const scrypt=promisify(derive);
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createLoginLimiter(){
 const attempts=new Map();let cleaned=0;
 return {
  check(key){
   const now=Date.now();
   if(now-cleaned>60000){for(const [ip,attempt]of attempts)if(now-attempt.start>=15*60000)attempts.delete(ip);cleaned=now;}
   let attempt=attempts.get(key);
   if(!attempt||now-attempt.start>=15*60000){
    if(!attempt&&attempts.size>=10000)throw failure(429,'登录请求较多，请稍后再试');
    attempt={count:0,start:now};attempts.set(key,attempt);
   }
   if(attempt.count>=10)throw failure(429,'尝试次数过多，请 15 分钟后再试');
   attempt.count++;
  },
  clear(key){attempts.delete(key);}
 };
}
export function createAuth(db,origin,{challenge,limiter=createLoginLimiter()}={}){
 function checkOrigin(req){if(verifyBridge(req).admin)return;if(req.headers.origin!==origin)throw failure(403,'请从本站管理页面操作');}
 async function session(req) {if(verifyBridge(req).admin)return true;const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('jianshan_session='))?.slice(17);if(!token)return false;return !!(await db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()));}
 async function requireAdmin(req) {if(!(await session(req)))throw failure(401,'请先登录后台');}
 async function signIn(req,password,setup=false,turnstileToken){
  checkOrigin(req);const key=req.socket.remoteAddress;limiter.check(key);
  if(typeof password!=='string'||password.length>256)throw failure(400,'密码格式不正确');
  if(!setup)await challenge?.verify(turnstileToken,origin);
  let account=await db.prepare('SELECT * FROM admin_users WHERE id=1').get();
  if(setup){
   if(account)throw failure(409,'管理员已创建，请直接登录');
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw failure(403,'首次设置请在运行服务器的电脑上完成');
   if(password.length<12)throw failure(400,'请设置至少 12 位密码');
   const salt=randomBytes(24).toString('hex');const hash=(await scrypt(password,salt,64)).toString('hex');
   // Conditional insert resolves simultaneous first-time setup requests safely.
   const result=await db.prepare('INSERT OR IGNORE INTO admin_users VALUES(1,?,?)').run(hash,salt);
   if(!result.changes)throw failure(409,'管理员已创建，请登录');
  }else{
   if(!account)throw failure(409,'请先设置管理员密码');
   const actual=await scrypt(password,account.salt,64);if(!timingSafeEqual(actual,Buffer.from(account.password_hash,'hex')))throw failure(401,'密码不正确');
  }
  limiter.clear(key);await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  const token=randomBytes(32).toString('hex');await db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token),Date.now()+12*3600_000);
  return `jianshan_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${origin.startsWith('https:')?'; Secure':''}`;
 }
 async function logout(req) {const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('jianshan_session='))?.slice(17);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));return 'jianshan_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';}
 return {checkOrigin,session,requireAdmin,signIn,logout};
}
