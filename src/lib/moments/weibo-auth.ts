import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { weiboAccounts, weiboRequest } from './weibo';

type Credential = { account: string; accessToken: string; refreshToken?: string; expiresAt: number };
export function credentialPath(account: string) {
  if (!weiboAccounts().includes(account)) throw new Error('WEIBO_INVALID_ACCOUNT');
  return path.join(path.resolve(process.env.MOMENTS_WEIBO_CREDENTIAL_DIRECTORY || '.local/weibo'), `${account}.json`);
}
async function readCredential(file: string): Promise<Credential> {
  try {
    if ((await stat(file)).mode & 0o077) throw new Error('WEIBO_INSECURE_CREDENTIAL_FILE');
    const credential = JSON.parse(await readFile(file, 'utf8'));
    if (!credential.accessToken || !Number.isFinite(credential.expiresAt)) throw new Error('WEIBO_INVALID_CREDENTIAL');
    return credential;
  } catch (error: any) { if (error.code === 'ENOENT') throw new Error('WEIBO_AUTH_REQUIRED'); throw error; }
}
export async function saveWeiboCredential(account: string, tokens: any) {
  if (typeof tokens.access_token !== 'string' || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) throw new Error('WEIBO_INVALID_CREDENTIAL');
  const file = credentialPath(account);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const credential: Credential = { account, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in) * 1000 };
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(credential) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}
export async function weiboToken(account: string, signal?: AbortSignal) {
  const file = credentialPath(account);
  let credential = await readCredential(file);
  if (credential.account !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
  if (credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
  const release = await lockfile.lock(file, { realpath: false, stale: 60_000, retries: { retries: 6, minTimeout: 300, maxTimeout: 1000 } });
  try {
    credential = await readCredential(file);
    if (credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
    if (!credential.refreshToken) throw new Error('WEIBO_AUTH_REQUIRED');
    const tokens = await weiboRequest('/oauth/token', undefined, { grant_type: 'refresh_token', refresh_token: credential.refreshToken, client_id: 'weibo-cli' }, signal);
    await saveWeiboCredential(account, { ...tokens, refresh_token: tokens.refresh_token || credential.refreshToken });
    return tokens.access_token as string;
  } finally { await release(); }
}
