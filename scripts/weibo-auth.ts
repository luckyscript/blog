import { setTimeout as delay } from 'node:timers/promises';
import { saveWeiboCredential } from '../src/lib/moments/weibo-auth';
import { WEIBO_API, weiboAccounts, weiboRequest } from '../src/lib/moments/weibo';
import { syncError } from '../src/lib/moments/store';

// Run as the moments service user. Only a verification URL and one-time user code are printed.
async function main() {
  const [account, ...rest] = process.argv.slice(2);
  if (rest.length || !weiboAccounts().includes(account)) throw new Error('WEIBO_INVALID_ACCOUNT');
  const device = await weiboRequest('/oauth/device/code', undefined, { client_id: 'weibo-cli', device_name: `Rain Blog ${account}` });
  const url = new URL(device.verification_uri_complete || device.verification_uri);
  if (url.protocol !== 'https:' || url.hostname !== 'open.weibo.com' || !device.device_code || !device.user_code) throw new Error('WEIBO_INVALID_AUTH_RESPONSE');
  console.log(`请使用微博账号 ${account} 打开：${url.href}`);
  console.log(`设备验证码：${device.user_code}。请在官方页面确认授权。`);
  const deadline = Date.now() + Math.min(Number(device.expires_in) || 600, 900) * 1000;
  let interval = Math.max(Number(device.interval) || 5, 5);
  while (Date.now() < deadline) {
    await delay(interval * 1000);
    const response = await fetch(WEIBO_API + '/oauth/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code, client_id: 'weibo-cli' }) });
    const data = await response.json() as any;
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : data.error?.code;
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') { interval += 5; continue; }
      throw new Error('WEIBO_AUTH_FAILED');
    }
    // Verify the account once before saving a session for unattended calls.
    const info = await weiboRequest('/cli/invoke', data.access_token, { group: 'users', action: 'show/biz', args: {} });
    const user = info.result?.data ?? info.result;
    const uid = user?.idstr ?? (Number.isSafeInteger(user?.id) ? String(user.id) : undefined);
    if (uid !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
    await saveWeiboCredential(account, data);
    console.log(`账号 ${account} 授权已保存。下轮同步会读取该账号，令牌不会输出到终端。`);
    return;
  }
  throw new Error('WEIBO_AUTH_EXPIRED');
}
main().catch(error => { console.error(syncError(error)); process.exitCode = 1; });
