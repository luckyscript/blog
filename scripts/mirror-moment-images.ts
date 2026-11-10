import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'cheerio';
import { getPool, closeDatabase } from '../src/db';
import { imageFormat, momentMediaDirectory } from '../src/lib/moments/media-cache';
import { isCachedMomentImage, MOMENT_MEDIA_PREFIX } from '../src/lib/moments/media-path';
import { publicMomentImages } from '../src/lib/moments/media-public';
import { readR2Credential, r2ImageMirror, verifyR2ImageResponse } from '../src/lib/moments/r2';
import { syncError } from '../src/lib/moments/store';

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !['--dry-run', '--upload', '--verify'].includes(mode)) throw new Error('MOMENTS_R2_INVALID_ARGUMENT');
  const [rows] = await getPool().query<any[]>(`SELECT m.source_id,m.body_html,m.media FROM blog_moments m JOIN blog_moment_sources s ON s.id=m.source_id WHERE m.status='published' AND m.published_at<=UTC_TIMESTAMP(3) AND s.enabled=TRUE`);
  const assets = new Set<string>(), sources: Record<string, Set<string>> = {};
  for (const row of rows) {
    const media = typeof row.media === 'string' ? JSON.parse(row.media) : row.media, $ = load(row.body_html);
    for (const url of [...media.filter((item: any) => item.type === 'image').map((item: any) => item.url), ...$('img[src]').toArray().map(image => $(image).attr('src')!)]) {
      if (!isCachedMomentImage(url)) throw new Error('MOMENTS_R2_IMAGE_NOT_CACHED');
      assets.add(url); (sources[row.source_id] ??= new Set()).add(url);
    }
  }
  const credential = mode === '--dry-run' ? undefined : await readR2Credential();
  if (mode !== '--dry-run' && !credential) throw new Error('MOMENTS_R2_AUTH_REQUIRED');
  const mirror = credential ? r2ImageMirror(credential) : undefined;
  let checked = 0, bytes = 0;
  const urls = [...assets]; let cursor = 0, failure: unknown;
  const copy = async (url: string) => {
    const name = url.slice(MOMENT_MEDIA_PREFIX.length), data = await readFile(join(momentMediaDirectory(), name));
    if (`${createHash('sha256').update(data).digest('hex')}.${imageFormat(data)}` !== name) throw new Error('MOMENTS_R2_INVALID_IMAGE');
    bytes += data.length;
    if (mode === '--upload') await mirror!.ensure(name, data);
    if (mode === '--verify') {
      await mirror!.verify(name, data);
      const publicUrl = publicMomentImages('', [{ type: 'image', url, alt: '' }]).media[0].url;
      if (!publicUrl.startsWith('https://')) throw new Error('MOMENTS_R2_PUBLIC_ORIGIN_REQUIRED');
      const response = await fetch(publicUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) { await response.body?.cancel(); throw new Error('MOMENTS_R2_PUBLIC_IMAGE_FAILED'); }
      await verifyR2ImageResponse(response, name, data.length);
    }
    checked++;
    if (mode !== '--dry-run' && checked % 25 === 0) console.log(JSON.stringify({ event: 'r2_image_progress', mode, checked, total: assets.size }));
  };
  await Promise.all(Array.from({ length: mode === '--dry-run' ? 1 : 2 }, async () => {
    while (cursor < urls.length && !failure) { const url = urls[cursor++]; try { await copy(url); } catch (error) { failure = error; } }
  }));
  if (failure) throw failure;
  console.log(JSON.stringify({ event: 'r2_image_complete', mode, images: checked, bytes, bucket: credential?.bucket,
    perSource: Object.fromEntries(Object.entries(sources).map(([source, urls]) => [source, urls.size])) }));
}
main().catch(error => { console.error(JSON.stringify({ event: 'r2_image_failed', error: syncError(error) })); process.exitCode = 1; }).finally(closeDatabase);
