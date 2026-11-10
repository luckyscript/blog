import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { cleanMomentHtml, escapeHtml, httpsUrl } from './content';
import type { MomentAdapter, MomentInput, MomentMedia, MomentPage } from './types';

export function xAccounts(values = process.env) {
  const accounts = [...new Set((values.MOMENTS_X_ACCOUNTS || '').split(',').map(v => v.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
  if (accounts.some(v => !/^[a-z0-9_]{1,15}$/.test(v))) throw new Error('X_INVALID_ACCOUNT');
  return accounts;
}
export function xInterval(values = process.env) {
  const interval = Number(values.MOMENTS_X_INTERVAL_SECONDS || 3600);
  if (!Number.isInteger(interval) || interval < 300 || interval > 86400) throw new Error('X_INVALID_INTERVAL');
  return interval;
}
const unwrap = (tweet: any) => tweet?.__typename === 'TweetWithVisibilityResults' ? tweet.tweet : tweet;
const author = (tweet: any) => tweet?.core?.user_results?.result;
const screenName = (user: any) => user?.core?.screen_name || user?.legacy?.screen_name;
const privateUser = (user: any) => user?.legacy?.protected === true || user?.privacy?.protected === true;
function allowedMedia(value: unknown, kind: 'image' | 'video') {
  if (typeof value !== 'string' || !httpsUrl(value)) throw new Error('X_INVALID_MEDIA');
  const url = new URL(value);
  if (url.port || url.hostname !== (kind === 'image' ? 'pbs.twimg.com' : 'video.twimg.com')) throw new Error('X_INVALID_MEDIA');
  return url.href;
}
function renderText(text: string, entities: any) {
  let expanded = text;
  for (const item of entities?.urls || []) {
    if (typeof item.url === 'string' && item.url && typeof item.expanded_url === 'string' && httpsUrl(item.expanded_url))
      expanded = expanded.replaceAll(item.url, item.expanded_url);
  }
  return { text: expanded, html: escapeHtml(expanded).replace(/https:\/\/[^\s<>]+/g, value => `<a href="${value}">${value}</a>`).replaceAll('\n', '<br>') };
}
export function parseXPage(payload: any, account: string, requestCursor?: string): MomentPage {
  if (payload?.ok !== true || !Array.isArray(payload.tweets) || !/^\d+$/.test(payload.profile?.id || '') || payload.profile?.screenName?.toLowerCase() !== account || payload.profile?.protected !== false)
    throw new Error('X_INVALID_RESPONSE');
  if (payload.tweets.length > 200) throw new Error('X_RESPONSE_TOO_LARGE');
  const posts: MomentInput[] = [], observed = new Set<string>();
  for (const raw of payload.tweets) {
    const tweet = unwrap(raw), original = tweet?.legacy;
    if (!original || !/^\d+$/.test(tweet.rest_id || '')) continue;
    const user = author(tweet);
    if (screenName(user)?.toLowerCase() !== account || user?.rest_id !== payload.profile.id) throw new Error('X_ACCOUNT_MISMATCH');
    observed.add(tweet.rest_id);
    if (privateUser(user) || tweet.withheld_in_countries?.length || original.withheld_in_countries?.length || tweet.trusted_friends_info_result || original.limited_actions === 'limit_trusted_friends_tweet') continue;
    const retweet = unwrap(original.retweeted_status_result?.result);
    const content = retweet || tweet, contentUser = author(content), legacy = content.legacy;
    if (!legacy || privateUser(contentUser) || content.withheld_in_countries?.length || content.trusted_friends_info_result) continue;
    const note = content.note_tweet?.note_tweet_results?.result;
    if (legacy.truncated && !note?.text) throw new Error('X_INCOMPLETE_TEXT');
    let body = renderText(note?.text ?? legacy.full_text ?? legacy.text ?? '', note?.entity_set || legacy.entities);
    if (retweet) {
      const owner = screenName(contentUser);
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(owner || '')) throw new Error('X_INVALID_RESPONSE');
      body = { text: `转推 @${owner}：\n${body.text}`, html: `<p>转推 <a href="https://x.com/${owner}">@${owner}</a></p>${body.html}` };
    }
    const quoted = unwrap(content.quoted_status_result?.result);
    if (quoted?.legacy && !privateUser(author(quoted)) && !quoted.trusted_friends_info_result) {
      const quoteText = quoted.note_tweet?.note_tweet_results?.result?.text || quoted.legacy.full_text || '';
      const name = screenName(author(quoted));
      if (/^[a-zA-Z0-9_]{1,15}$/.test(name || '') && /^\d+$/.test(quoted.rest_id || ''))
        body.html += `<blockquote><a href="https://x.com/${name}/status/${quoted.rest_id}">@${name}</a><br>${escapeHtml(quoteText).replaceAll('\n', '<br>')}</blockquote>`;
    }
    const media: MomentMedia[] = [];
    for (const item of legacy.extended_entities?.media || []) {
      if (!['photo', 'video', 'animated_gif'].includes(item.type)) continue;
      const image = allowedMedia(item.media_url_https, 'image');
      media.push({ type: 'image', url: image, alt: String(item.ext_alt_text || body.text.slice(0, 100)).slice(0, 500) });
      body.html += `<img src="${escapeHtml(image)}" alt="${escapeHtml(media.at(-1)!.alt)}" loading="lazy">`;
      if (item.type !== 'photo') {
        const variants = (item.video_info?.variants || []).filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
        if (variants.length) {
          const url = allowedMedia(variants[0].url, 'video');
          media.push({ type: 'video', url, alt: body.text.slice(0, 100) });
          body.html += `<video src="${escapeHtml(url)}" controls preload="none" playsinline></video>`;
        }
      }
    }
    const date = new Date(original.created_at);
    if (!Number.isFinite(date.getTime())) throw new Error('X_INVALID_DATE');
    if (!body.text && !media.length) continue;
    posts.push({ externalId: tweet.rest_id, sourceUrl: `https://x.com/${account}/status/${tweet.rest_id}`, title: body.text.slice(0, 100) || '一则推文',
      text: body.text, html: cleanMomentHtml(body.html), publishedAt: date.toISOString(), media,
      tags: (legacy.entities?.hashtags || []).map((tag: any) => String(tag.text)).slice(0, 100) });
  }
  const sortIds = (a: string, b: string) => BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0;
  posts.sort((a, b) => sortIds(a.externalId, b.externalId));
  const cursor = payload.nextCursor;
  if (cursor != null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_+=/-]{1,4096}$/.test(cursor))) throw new Error('X_INVALID_CURSOR');
  // X returns its last Bottom cursor again on a successful empty terminal page.
  // Only this empty, identity-validated response is terminal; a repeated cursor
  // accompanied by entries remains an error in the shared collector.
  const terminal = requestCursor && cursor === requestCursor && payload.tweets.length === 0;
  return { posts: [...new Map(posts.map(post => [post.externalId, post])).values()], observedIds: [...observed].sort(sortIds), nextCursor: terminal ? undefined : cursor || undefined };
}

export function xAdapter(account: string, values = process.env): MomentAdapter {
  if (!xAccounts(values).includes(account)) throw new Error('X_INVALID_ACCOUNT');
  let child: ReturnType<typeof spawn> | undefined;
  let pending: { resolve: (value: any) => void; reject: (error: Error) => void } | undefined, buffer = '';
  function fail(code: string) { pending?.reject(new Error(code)); pending = undefined; child?.kill(); child = undefined; }
  function start() {
    const home = resolve(values.MOMENTS_X_STATE_DIRECTORY || '.local/x');
    const environment: NodeJS.ProcessEnv = { PATH: values.PATH, LANG: 'C.UTF-8', HOME: home, XDG_CACHE_HOME: home + '/.cache',
      MOMENTS_X_ACCOUNTS: xAccounts(values).join(','), MOMENTS_X_CREDENTIAL_FILE: values.MOMENTS_X_CREDENTIAL_FILE,
      TWITTER_PROXY: values.MOMENTS_X_PROXY || values.MOMENTS_HTTP_PROXY };
    child = spawn(values.MOMENTS_X_PYTHON || '/opt/rain-blog/x-runtime/bin/python', [resolve('scripts/x-read.py')], { env: environment, stdio: ['pipe', 'pipe', 'ignore'] });
    child.on('error', () => fail('X_RUNTIME_UNAVAILABLE'));
    child.on('exit', () => { if (pending) fail('X_WORKER_FAILED'); });
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 5_000_000) return fail('X_RESPONSE_TOO_LARGE');
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { pending?.resolve(JSON.parse(line)); pending = undefined; }
      catch { fail('X_INVALID_RESPONSE'); }
    });
    child.stdin!.on('error', () => fail('X_WORKER_FAILED'));
  }
  return {
    async fetchPage(cursor, signal) {
      signal?.throwIfAborted();
      if (pending) throw new Error('X_REQUEST_BUSY');
      if (!child) start();
      let timer: ReturnType<typeof setTimeout>;
      const cancel = () => fail('X_CANCELLED');
      try {
        const payload: any = await new Promise((resolve, reject) => {
          pending = { resolve, reject }; timer = setTimeout(() => fail('X_TIMEOUT'), 90_000);
          signal?.addEventListener('abort', cancel, { once: true });
          child!.stdin!.write(JSON.stringify({ account, cursor }) + '\n');
        });
        if (payload?.ok !== true) throw new Error(/^X_[A-Z_0-9]+$/.test(payload?.error || '') ? payload.error : 'X_UPSTREAM_FAILED');
        return parseXPage(payload, account, cursor);
      } finally { clearTimeout(timer!); signal?.removeEventListener('abort', cancel); }
    },
    async close() { child?.kill(); child = undefined; },
  };
}
