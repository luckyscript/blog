import { load } from 'cheerio';
import { cleanMomentHtml, escapeHtml, httpsUrl } from './content';
import type { MomentAdapter, MomentInput, MomentPage } from './types';

// Transport and OAuth follow the official @weibo-ai/weibo-cli 0.9.8 protocol.
export const WEIBO_API = 'https://open.weibo.com/cli/api';
export const defaultWeiboAccounts = ['5351049607', '1562002727'];
export const weiboTitles: Record<string, string> = { '5351049607': 'luckyscript', '1562002727': 'jsjhlk' };
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function weiboAccounts() {
  const accounts = [...new Set((process.env.MOMENTS_WEIBO_UIDS ?? defaultWeiboAccounts.join(',')).split(',').map(v => v.trim()).filter(Boolean))];
  if (accounts.some(v => !/^[1-9]\d{3,19}$/.test(v))) throw new Error('WEIBO_INVALID_ACCOUNT');
  return accounts;
}
export function weiboInterval() {
  const value = Number(process.env.MOMENTS_WEIBO_INTERVAL_SECONDS || 3600);
  if (!Number.isInteger(value) || value < 300 || value > 86400) throw new Error('WEIBO_INVALID_INTERVAL');
  return value;
}
/** Weibo uses base62 in groups of four, each representing seven decimal digits. */
export function weiboMidToId(mid: string) {
  if (!/^[a-zA-Z0-9]{1,20}$/.test(mid)) throw new Error('WEIBO_INVALID_ID');
  if (/^\d{16,20}$/.test(mid)) return BigInt(mid).toString();
  const chunks: string[] = [];
  for (let end = mid.length; end > 0; end -= 4) {
    let value = 0;
    for (const char of mid.slice(Math.max(0, end - 4), end)) value = value * 62 + alphabet.indexOf(char);
    if (value > 9_999_999) throw new Error('WEIBO_INVALID_ID');
    chunks.unshift(end > 4 ? String(value).padStart(7, '0') : String(value));
  }
  return BigInt(chunks.join('')).toString();
}
export function weiboIdToMid(id: string) {
  if (!/^[1-9]\d{0,29}$/.test(id)) throw new Error('WEIBO_INVALID_ID');
  const chunks: string[] = [];
  for (let end = id.length; end > 0; end -= 7) {
    let value = Number(id.slice(Math.max(0, end - 7), end)), chunk = '';
    do { chunk = alphabet[value % 62] + chunk; value = Math.floor(value / 62); } while (value);
    chunks.unshift(end > 7 ? chunk.padStart(4, '0') : chunk);
  }
  return chunks.join('');
}
const decimalId = (value: unknown) => {
  if (typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error('WEIBO_INVALID_ID');
};
const secureMedia = (value: unknown) => typeof value === 'string' ? httpsUrl(value.replace(/^http:\/\//, 'https://').replace(/^\/\//, 'https://')) : '';
export function parseWeiboStatus(status: any, account: string, depth = 0): MomentInput | null {
  // Do not republish friends-only, private, deleted or explicitly restricted posts.
  if (status.deleted || (status.visible && Number(status.visible.type) !== 0)) return null;
  const uid = decimalId(status.user?.idstr ?? status.user?.id);
  if (uid !== account) throw new Error('WEIBO_ACCOUNT_MISMATCH');
  const externalId = decimalId(status.idstr ?? status.id);
  const long = status.longText?.longTextContent ?? status.long_text?.long_text_content ?? status.long_text?.longTextContent ?? status.long_text?.content ?? status.long_text?.text ?? (typeof status.long_text === 'string' ? status.long_text : undefined);
  if ((status.isLongText || status.is_long_text) && !long) throw new Error('WEIBO_LONG_TEXT_REQUIRED');
  const raw = long ?? status.text_raw ?? status.text;
  if (typeof raw !== 'string') throw new Error('WEIBO_INVALID_CONTENT');
  const $ = load(raw);
  $('script,style').remove(); $('br').replaceWith('\n');
  let text = status.text_raw && !long ? raw.trim() : $.root().text().trim();
  // Official timeline text is plain text; longTextContent may contain formatted HTML.
  let html = status.text_raw && !long ? escapeHtml(raw).replace(/\n/g, '<br>') : cleanMomentHtml(raw.replace(/\n/g, '<br>'));
  const media: MomentInput['media'] = [];
  for (const pic of status.pics ?? status.pic_urls ?? []) {
    const url = secureMedia(pic.large?.url ?? pic.largest?.url ?? pic.url ?? pic.thumbnail_pic);
    if (url && !media.some(v => v.url === url)) media.push({ type: 'image', url, alt: '' });
  }
  const video = secureMedia(status.page_info?.media_info?.stream_url_hd ?? status.page_info?.media_info?.stream_url);
  if (video) media.push({ type: 'video', url: video, alt: '' });
  if (depth === 0 && status.retweeted_status && !status.retweeted_status.deleted) {
    const originalAccount = decimalId(status.retweeted_status.user?.idstr ?? status.retweeted_status.user?.id);
    const original = parseWeiboStatus(status.retweeted_status, originalAccount, depth + 1);
    if (original) {
      text += `\n转发：${original.text}`;
      html += `<blockquote><p><a href="${original.sourceUrl}">转发原文</a></p>${original.html}</blockquote>`;
    }
  }
  const publishedAt = new Date(status.created_at);
  if (!Number.isFinite(publishedAt.getTime())) throw new Error('WEIBO_INVALID_DATE');
  const body = html + media.map(m => m.type === 'image' ? `<p><img src="${escapeHtml(m.url)}" alt="" loading="lazy"></p>` : `<video controls preload="none" src="${escapeHtml(m.url)}"></video>`).join('');
  return { externalId, sourceUrl: `https://weibo.com/${account}/${weiboIdToMid(externalId)}`, title: text.slice(0, 80), text, html: cleanMomentHtml(body), publishedAt: publishedAt.toISOString(), tags: [...new Set([...text.matchAll(/#([^#\n]{1,100})#/g)].map(v => v[1]))], media };
}
export function parseWeiboTimeline(payload: any, account: string, cursor?: string): MomentPage {
  if (payload?.error || payload?.error_code || payload?.meta?.outcome && payload.meta.outcome !== 'success') throw new Error('WEIBO_API_REJECTED');
  const result = payload?.result ?? payload;
  const data = result?.data?.statuses ? result.data : result;
  if (result?.error || result?.error_code || data?.error || data?.error_code) throw new Error('WEIBO_API_REJECTED');
  if (!Array.isArray(data?.statuses)) throw new Error('WEIBO_INVALID_RESPONSE');
  const all = data.statuses as any[];
  // A pinned old post must not move the historical cursor past newer unpinned posts.
  const ids = all.filter(p => !p.isTop && !p.is_top).map(p => decimalId(p.idstr ?? p.id));
  if (cursor && ids.some(id => BigInt(id) > BigInt(cursor))) throw new Error('WEIBO_CURSOR_IGNORED');
  const posts = all.filter(p => !cursor || !p.isTop && !p.is_top).map(p => parseWeiboStatus(p, account)).filter((p): p is MomentInput => !!p);
  posts.sort((a, b) => BigInt(a.externalId) > BigInt(b.externalId) ? -1 : 1);
  const oldest = ids.length ? ids.reduce((a, b) => BigInt(a) < BigInt(b) ? a : b) : undefined;
  return { posts, observedIds: [...ids].sort((a,b) => BigInt(a) > BigInt(b) ? -1 : 1), nextCursor: oldest && BigInt(oldest) > 1n ? String(BigInt(oldest) - 1n) : undefined };
}

/** Fixed official origin, no redirects and no raw upstream errors in logs. */
export async function weiboRequest(path: string, token: string | undefined, body?: unknown, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(WEIBO_API + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 401 ? 'WEIBO_AUTH_REQUIRED' : response.status === 403 ? 'WEIBO_PERMISSION_REQUIRED' : response.status === 429 ? 'WEIBO_RATE_LIMITED' : `WEIBO_HTTP_${response.status}`);
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error('WEIBO_INVALID_RESPONSE');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 5_000_000) throw new Error('WEIBO_RESPONSE_TOO_LARGE'); chunks.push(value); } }
  finally { await reader.cancel(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('WEIBO_INVALID_RESPONSE'); }
}
export function weiboAdapter(account: string, getToken: (signal?: AbortSignal) => Promise<string>, request = weiboRequest): MomentAdapter {
  if (!weiboAccounts().includes(account)) throw new Error('WEIBO_INVALID_ACCOUNT');
  let flags: Set<string> | undefined;
  return { async fetchPage(cursor, signal) {
    const token = await getToken(signal);
    if (!flags) {
      const meta = await request('/cli/commands/statuses/user_timeline%2Fbiz', token, undefined, signal);
      flags = new Set<string>((meta.command?.flags || []).map((v: any) => v.name));
      if (!flags.has('count') || !flags.has('max_id')) throw new Error('WEIBO_UNSUPPORTED_PAGINATION');
    }
    const args: Record<string, string> = { count: '50', ...(cursor ? { max_id: cursor } : {}) };
    if (flags.has('isGetLongText')) args.isGetLongText = '1';
    const result = await request('/cli/invoke', token, { group: 'statuses', action: 'user_timeline/biz', args }, signal);
    return parseWeiboTimeline(result, account, cursor);
  } };
}
