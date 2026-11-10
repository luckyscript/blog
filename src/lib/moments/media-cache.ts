import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, unlink, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { load } from 'cheerio';
import { fetch as proxyFetch, ProxyAgent } from 'undici';
import { isCachedMomentImage, MOMENT_MEDIA_PREFIX } from './media-path';
import { readR2Credential, r2ImageMirror } from './r2';
import type { MomentInput } from './types';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const momentMediaDirectory = () => resolve(process.env.MOMENTS_MEDIA_DIRECTORY || '.local/moments-media');
export function imageFormat(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.length >= 12 && b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpg';
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (b.length >= 12 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) return 'gif';
  if (b.length >= 16 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('MOMENTS_MEDIA_INVALID_IMAGE');
}
export function imageSource(raw: string) {
  const url = new URL(raw);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(/^(?:cdn\d+\.telesco\.pe|cdn\d+\.cdn-telegram\.org)$/.test(host) || /^(?:[a-z0-9-]+\.)?sinaimg\.cn$/.test(host) || host === 'pbs.twimg.com'))
    throw new Error('MOMENTS_MEDIA_INVALID_SOURCE');
  return url;
}
type CacheOptions = { directory?: string; proxy?: string; fetcher?: typeof fetch; timeoutMs?: number;
  mirror?: { ensure: (name: string, bytes: Uint8Array, signal?: AbortSignal) => Promise<void> } };
/** A private URL index avoids fetching an already saved image while its provider is offline. */
export function momentImageCache(options: CacheOptions = {}) {
  const directory = options.directory || momentMediaDirectory();
  const agent = options.proxy ? new ProxyAgent(options.proxy) : undefined;
  const fetchImage = options.fetcher || (agent ? ((url, init) => proxyFetch(url as string, { ...init as any, dispatcher: agent }) as any) as typeof fetch : fetch);
  let mirror = options.mirror, mirrorLoaded = !!mirror;
  async function mirrored(url: string, signal?: AbortSignal) {
    if (!mirrorLoaded) { const credential = await readR2Credential(); mirror = credential ? r2ImageMirror(credential) : undefined; mirrorLoaded = true; }
    if (mirror) { const name = url.slice(MOMENT_MEDIA_PREFIX.length); await mirror.ensure(name, await readFile(join(directory, name)), signal); }
    return url;
  }
  async function exists(url: string) {
    if (!isCachedMomentImage(url)) return false;
    try { const file = await stat(join(directory, url.slice(MOMENT_MEDIA_PREFIX.length))); return file.isFile() && file.size > 0 && file.size <= MAX_IMAGE_BYTES; }
    catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function atomic(path: string, value: string | Buffer) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, value, { mode: 0o640, flag: 'wx', flush: true });
      // The worker keeps UMask=0077 for credentials; explicitly grant the web
      // service's shared group read access to these public images only.
      await chmod(temporary, 0o640); await rename(temporary, path);
    }
    finally { await unlink(temporary).catch(() => {}); }
  }
  return {
    exists,
    async cache(raw: string, signal?: AbortSignal): Promise<string> {
      if (isCachedMomentImage(raw)) {
        if (!await exists(raw)) throw new Error('MOMENTS_MEDIA_MISSING');
        return mirrored(raw, signal);
      }
      let url = imageSource(raw);
      const key = createHash('sha256').update(url.href).digest('hex');
      const ref = join(directory, '.refs', key);
      try { const cached = (await readFile(ref, 'utf8')).trim(); if (await exists(cached)) return mirrored(cached, signal); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const timeout = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15_000), ...(signal ? [signal] : [])]);
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 2; redirects++) {
        response = await fetchImage(url, { signal: timeout, redirect: 'manual', headers: { 'user-agent': 'RainBlog-Moments/1.0', accept: 'image/*', ...(url.hostname.endsWith('.sinaimg.cn') ? { referer: 'https://weibo.com/' } : {}) } });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const target = response.headers.get('location'); await response.body?.cancel();
        if (!target || redirects === 2) throw new Error('MOMENTS_MEDIA_REDIRECT');
        url = imageSource(new URL(target, url).href);
      }
      if (!response?.ok) { await response?.body?.cancel(); throw new Error(`MOMENTS_MEDIA_HTTP_${response?.status || 0}`); }
      if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error('MOMENTS_MEDIA_TOO_LARGE'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('MOMENTS_MEDIA_EMPTY');
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('MOMENTS_MEDIA_TOO_LARGE'); chunks.push(value); } }
      finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = Buffer.concat(chunks), extension = imageFormat(bytes);
      const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
      // Deployment provisions the shared directory with setgid. Reapplying
      // that bit here is denied by the worker's RestrictSUIDSGID sandbox.
      await mkdir(directory, { recursive: true, mode: 0o750 });
      await mkdir(join(directory, '.refs'), { recursive: true, mode: 0o700 });
      await atomic(join(directory, name), bytes);
      const cached = MOMENT_MEDIA_PREFIX + name;
      await atomic(ref, cached);
      return mirrored(cached, signal);
    },
    async close() { await agent?.close(); },
  };
}

export async function cacheMomentImages(posts: MomentInput[], cache: Pick<ReturnType<typeof momentImageCache>, 'cache'>, signal?: AbortSignal) {
  const result: MomentInput[] = [];
  for (const post of posts) {
    const $ = load(post.html, {}, false);
    const urls = [...new Set([...post.media.filter(m => m.type === 'image').map(m => m.url), ...$('img[src]').toArray().map(img => $(img).attr('src')!)])];
    const replacements = new Map<string, string>();
    for (const url of urls) replacements.set(url, await cache.cache(url, signal));
    $('img[src]').each((_, img) => { const src = $(img).attr('src')!; $(img).attr('src', replacements.get(src)!); });
    result.push({ ...post, html: $.html(), media: post.media.map(m => m.type === 'image' ? { ...m, url: replacements.get(m.url)! } : m) });
  }
  return result;
}
