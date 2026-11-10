import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseWeiboStatus, weiboAccounts, weiboIdToMid } from './weibo';
import { escapeHtml } from './content';
import type { MomentAdapter, MomentInput, MomentPage } from './types';

export function weiboTransport() {
  const value = process.env.MOMENTS_WEIBO_TRANSPORT || 'web';
  if (!['web', 'official'].includes(value)) throw new Error('WEIBO_INVALID_TRANSPORT');
  return value;
}
type Credential = { account: string; cookies: Record<string, string> };
type Request = (path: string, params: Record<string, string>, signal?: AbortSignal) => Promise<any>;
export function parseWeiboPageConfig(html: string): any {
  const marker = /window\.\$CONFIG\s*=\s*\{/.exec(html);
  if (!marker) throw new Error('WEIBO_AUTH_REQUIRED');
  const start = marker.index + marker[0].length - 1;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); }
      catch { throw new Error('WEIBO_INVALID_RESPONSE'); }
    }
  }
  throw new Error('WEIBO_INVALID_RESPONSE');
}
export async function readWeiboWebCredential(account: string): Promise<Credential> {
  if (!weiboAccounts().includes(account)) throw new Error('WEIBO_INVALID_ACCOUNT');
  const file = join(resolve(process.env.MOMENTS_WEIBO_WEB_CREDENTIAL_DIRECTORY || '.local/weibo-web'), `${account}.json`);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.()) throw new Error('WEIBO_INSECURE_CREDENTIAL_FILE');
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.account !== account || !data.cookies?.SUB) throw new Error('WEIBO_AUTH_REQUIRED');
    for (const [name, value] of Object.entries(data.cookies))
      if (!/^[A-Za-z0-9_-]+$/.test(name) || typeof value !== 'string' || /[\r\n;]/.test(value)) throw new Error('WEIBO_INVALID_CREDENTIAL');
    return data;
  } catch (error: any) { if (error.code === 'ENOENT') throw new Error('WEIBO_AUTH_REQUIRED'); throw error; }
}
export function weiboWebRequest(credential: Credential, fetcher: typeof fetch = fetch): Request {
  const cookie = Object.entries(credential.cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  let lastRequest = 0;
  return async (path, params, signal) => {
    if (!['/', '/ajax/profile/info', '/ajax/statuses/mymblog', '/ajax/statuses/show', '/ajax/statuses/longtext'].includes(path)) throw new Error('WEIBO_INVALID_REQUEST');
    const remaining = 1200 - (Date.now() - lastRequest);
    if (remaining > 0) await delay(remaining, undefined, { signal });
    signal?.throwIfAborted();
    const url = new URL(path, 'https://weibo.com');
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    lastRequest = Date.now();
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]),
      headers: { accept: 'application/json', Cookie: cookie, Referer: `https://weibo.com/u/${credential.account}`,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest', ...(credential.cookies['XSRF-TOKEN'] ? { 'X-Xsrf-Token': credential.cookies['XSRF-TOKEN'] } : {}) } });
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel();
      throw new Error(response.status === 401 || response.status === 302 ? 'WEIBO_AUTH_REQUIRED' : response.status === 429 ? 'WEIBO_RATE_LIMITED' : `WEIBO_WEB_HTTP_${response.status}`);
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error('WEIBO_INVALID_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length;
      if (size > 8_000_000) throw new Error('WEIBO_RESPONSE_TOO_LARGE'); chunks.push(item.value); } }
    finally { await reader.cancel(); reader.releaseLock(); }
    const body = Buffer.concat(chunks).toString('utf8');
    if (path === '/') return parseWeiboPageConfig(body);
    let data: any;
    try { data = JSON.parse(body); } catch { throw new Error('WEIBO_INVALID_RESPONSE'); }
    if (data?.ok === -100 || data?.ok === 0 && /请.*登录|用户未登录/.test(data.msg || data.message || '')) throw new Error('WEIBO_AUTH_REQUIRED');
    if (Number(data?.ok) !== 1 && !(path === '/ajax/statuses/show' && data?.idstr && data?.user)) throw new Error('WEIBO_WEB_REJECTED');
    return data.data ?? data;
  };
}
const id = (status: any): string => {
  const value = status?.idstr ?? status?.id;
  if (typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error('WEIBO_INVALID_ID');
};
const pinned = (status: any) => !!(status.isTop || status.is_top || status.top);
function normalizePictures(status: any) {
  let pictures = status.pics ?? status.pic_urls;
  if (Array.isArray(status.pic_ids) && status.pic_infos) {
    pictures = status.pic_ids.map((pid: string) => status.pic_infos[pid]).filter(Boolean).map((photo: any) => ({
      large: { url: photo.original?.url || photo.largest?.url || photo.large?.url || photo.bmiddle?.url || photo.url },
    }));
  }
  if (!pictures?.length && Array.isArray(status.mix_media_info?.items)) pictures = status.mix_media_info.items
    .filter((item: any) => item.type === 'pic' || item.type === 'image').map((item: any) => item.data || item);
  return Array.isArray(pictures) ? pictures : [];
}
async function completeStatus(input: any, request: Request, signal?: AbortSignal, depth = 0): Promise<any> {
  if (input.deleted || input.visible && Number(input.visible.type) !== 0) return input;
  let status = { ...input };
  let pictures = normalizePictures(status);
  if (Number(status.pic_num || 0) > pictures.length) {
    const detail = await request('/ajax/statuses/show', { id: status.mblogid || weiboIdToMid(id(status)) }, signal);
    if (id(detail) !== id(status)) throw new Error('WEIBO_ACCOUNT_MISMATCH');
    status = { ...status, ...detail }; pictures = normalizePictures(status);
  }
  if (Number(status.pic_num || 0) > pictures.length) throw new Error('WEIBO_IMAGES_INCOMPLETE');
  status.pics = pictures;
  if ((status.isLongText || status.is_long_text) && !status.longText?.longTextContent && !status.long_text?.longTextContent) {
    const data = await request('/ajax/statuses/longtext', { id: id(status) }, signal);
    const text = data.longTextContent ?? data.long_text_content;
    if (typeof text !== 'string' || !text) throw new Error('WEIBO_LONG_TEXT_REQUIRED');
    status.longText = { longTextContent: text };
  }
  if (depth === 0 && status.retweeted_status && !status.retweeted_status.deleted) {
    const original = status.retweeted_status;
    const restricted = original.visible && Number(original.visible.type) !== 0;
    const notice = restricted ? '原微博当前不可见。' : String(original.text_raw ?? original.text ?? '');
    if (restricted || !original.user && /此微博已不可见|此微博已被作者删除|没有这条微博的查看权限|该账号.{0,80}现已无法查看|该内容请至手机客户端查看/.test(notice)) {
      let originalId: string | undefined;
      try { originalId = id(original); } catch { /* Some deleted originals omit their ID. */ }
      status.unavailableRetweet = { id: originalId, notice };
      delete status.retweeted_status;
    } else status.retweeted_status = await completeStatus(original, request, signal, depth + 1);
  }
  return status;
}
export function weiboWebAdapter(account: string, options: { request?: Request; credential?: () => Promise<Credential> } = {}): MomentAdapter {
  if (!weiboAccounts().includes(account)) throw new Error('WEIBO_INVALID_ACCOUNT');
  let request = options.request, verified = false;
  const fingerprints = new Map<string, number>();
  return {
    async fetchPage(cursor, signal): Promise<MomentPage> {
      if (cursor && !/^web:[1-9]\d*$/.test(cursor)) throw new Error('WEIBO_INVALID_CURSOR');
      const page = cursor ? Number(cursor.slice(4)) : 1;
      if (!Number.isSafeInteger(page) || page > 10000 || cursor && page < 2) throw new Error('WEIBO_INVALID_CURSOR');
      if (!request) request = weiboWebRequest(await (options.credential || (() => readWeiboWebCredential(account)))());
      if (!verified) {
        const config = await request('/', {}, signal);
        const sessionAccount = String(config.user?.idstr || config.user?.id || config.uid || '');
        if (!sessionAccount || config.login === false) throw new Error('WEIBO_AUTH_REQUIRED');
        if (sessionAccount !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
        const profile = await request('/ajax/profile/info', { uid: account }, signal);
        if (String(profile.user?.idstr ?? profile.user?.id ?? profile.userInfo?.id ?? '') !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
        verified = true;
      }
      const data = await request('/ajax/statuses/mymblog', { uid: account, page: String(page), feature: '0' }, signal);
      if (!Array.isArray(data.list)) throw new Error('WEIBO_INVALID_RESPONSE');
      if (data.list.length > 200) throw new Error('WEIBO_RESPONSE_TOO_LARGE');
      const statuses: any[] = [];
      for (const input of data.list) {
        let status = input;
        if (String(input.user?.idstr ?? input.user?.id ?? '') !== account) {
          // Quick reposts display the original author in the timeline. ori_mid
          // identifies this account's actual repost, with its own date and ID.
          if (String(input.ori_uid ?? '') !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
          const repostId = id({ idstr: input.ori_mid });
          status = await request('/ajax/statuses/show', { id: weiboIdToMid(repostId) }, signal);
          if (id(status) !== repostId || String(status.user?.idstr ?? status.user?.id ?? '') !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
          if (pinned(input)) status = { ...status, isTop: 1 };
        }
        statuses.push(status);
      }
      const regular = statuses.filter((status: any) => !pinned(status));
      const ids = regular.map(id);
      const fingerprint = ids.join(',');
      if (ids.length && fingerprints.has(fingerprint) && fingerprints.get(fingerprint) !== page) throw new Error('WEIBO_CURSOR_IGNORED');
      if (ids.length) fingerprints.set(fingerprint, page);
      const posts: MomentInput[] = [];
      for (const status of statuses.filter((status: any) => page === 1 || !pinned(status))) {
        const completed = await completeStatus(status, request, signal);
        const post = parseWeiboStatus(completed, account);
        if (post) {
          if (completed.unavailableRetweet) {
            const { id: originalId, notice } = completed.unavailableRetweet;
            post.text += `\n转发原文：${notice}`;
            post.html += `<blockquote>${originalId ? `<p><a href="https://weibo.com/detail/${originalId}">转发原文</a></p>` : ''}<p>${escapeHtml(notice)}</p></blockquote>`;
          }
          posts.push(post);
        }
      }
      posts.sort((a, b) => BigInt(a.externalId) > BigInt(b.externalId) ? -1 : 1);
      return { posts, observedIds: ids.sort((a: string, b: string) => BigInt(a) > BigInt(b) ? -1 : 1), nextCursor: regular.length ? `web:${page + 1}` : undefined };
    },
  };
}
