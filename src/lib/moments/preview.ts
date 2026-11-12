import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { momentMediaDirectory } from './media-cache';
import { momentMediaName, MOMENT_MEDIA_PREFIX } from './media-path';

export const PREVIEW_PREFIX = `${MOMENT_MEDIA_PREFIX}previews/v1/`;
export const PREVIEW_WIDTHS = [320, 640] as const;
const inFlight = new Map<string, Promise<void>>();
let queue = Promise.resolve();

/** Only the blog's saved images have first-party previews and fallbacks. */
export function momentOriginalPath(src: string, origin = process.env.MOMENTS_MEDIA_PUBLIC_ORIGIN) {
  let path = src;
  if (!path.startsWith(MOMENT_MEDIA_PREFIX)) {
    if (!origin) return;
    try {
      const url = new URL(src);
      if (url.origin !== new URL(origin).origin || url.search || url.hash) return;
      path = url.pathname;
    } catch { return; }
  }
  const name = path.slice(MOMENT_MEDIA_PREFIX.length);
  if (!path.startsWith(MOMENT_MEDIA_PREFIX) || !momentMediaName.test(name)) return;
  return path;
}
export function momentPreviewUrl(src: string, width: number, origin = process.env.MOMENTS_MEDIA_PUBLIC_ORIGIN) {
  if (!PREVIEW_WIDTHS.includes(width as 320 | 640)) return;
  const path = momentOriginalPath(src, origin);
  if (path) return `${PREVIEW_PREFIX}${width}/${path.slice(MOMENT_MEDIA_PREFIX.length)}.webp`;
}

export async function momentPreviewResponse(request: Request, widthValue: string, previewName: string,
  options: { sourceDirectory?: string; cacheDirectory?: string } = {}) {
  const missing = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!/^(320|640)$/.test(widthValue) || !previewName.endsWith('.webp')) return missing();
  const name = previewName.slice(0, -5), width = Number(widthValue);
  if (!momentMediaName.test(name)) return missing();
  const source = join(options.sourceDirectory || momentMediaDirectory(), name);
  let original;
  try { original = await stat(source); }
  catch (error: any) { if (error.code === 'ENOENT') return missing(); throw error; }
  if (!original.isFile() || !original.size || original.size > 8 * 1024 * 1024) return missing();
  const directory = join(options.cacheDirectory || resolve(process.env.MOMENTS_PREVIEW_DIRECTORY || '.local/moment-previews'), 'v1', widthValue);
  const path = join(directory, previewName), etag = `"${name}-w${widthValue}-v1"`;
  let cached;
  try { cached = await stat(path); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (!cached?.isFile()) {
    // Serialize decoding on the small ECS, coalesce concurrent requests, and
    // fall back to the saved original if a burst fills the bounded queue.
    if (!inFlight.has(path) && inFlight.size >= 24)
      return new Response(null, { status: 302, headers: { location: MOMENT_MEDIA_PREFIX + name, 'cache-control': 'no-store' } });
    if (!inFlight.has(path)) {
      const work = queue.then(async () => {
        const bytes = await readFile(source);
        const preview = await sharp(bytes, { limitInputPixels: 32_000_000, sequentialRead: true })
          .rotate().resize({ width, withoutEnlargement: true })
          .webp({ quality: 78, effort: 3 }).toBuffer();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, preview, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
        finally { await unlink(temporary).catch(() => {}); }
      });
      inFlight.set(path, work);
      queue = work.catch(() => {});
    }
    const work = inFlight.get(path)!;
    try { await work; cached = await stat(path); }
    catch {
      return new Response(null, { status: 302, headers: { location: MOMENT_MEDIA_PREFIX + name, 'cache-control': 'no-store' } });
    } finally { if (inFlight.get(path) === work) inFlight.delete(path); }
  }
  const headers = new Headers({ 'content-type': 'image/webp', 'content-length': String(cached!.size),
    'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', etag });
  if (request.headers.get('if-none-match')?.split(',').some(value => [etag, '*'].includes(value.trim().replace(/^W\//, '')))) {
    headers.delete('content-length'); return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
}
