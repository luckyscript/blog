import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { load } from 'cheerio';
import { getPool, closeDatabase } from '../src/db';
import { normalizeMoment } from '../src/lib/moments/content';
import { cacheMomentImages, momentImageCache, momentMediaDirectory, imageFormat } from '../src/lib/moments/media-cache';
import { isCachedMomentImage, MOMENT_MEDIA_PREFIX } from '../src/lib/moments/media-path';
import { telegramAdapter } from '../src/lib/moments/telegram';
import { syncError } from '../src/lib/moments/store';
import type { MomentInput } from '../src/lib/moments/types';

type Entry = { id: string; sourceId: string; expectedHash: string; post: MomentInput };
type Manifest = { version: number; createdAt: string; entries: Entry[] };
const json = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const args = process.argv.slice(2), mode = args[0];
const argument = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const manifestPath = resolve(argument('--manifest') || '.local/moments-media-repair.json');
const imageUrls = (post: MomentInput) => {
  const $ = load(post.html, {}, false);
  return [...new Set([...post.media.filter(m => m.type === 'image').map(m => m.url), ...$('img[src]').toArray().map(img => $(img).attr('src')!)])];
};
async function stage() {
  const [rows] = await getPool().query<any[]>(`SELECT m.*,s.platform,s.account FROM blog_moments m JOIN blog_moment_sources s ON s.id=m.source_id WHERE s.enabled=TRUE ORDER BY s.id,m.published_at DESC`);
  const refreshed = new Map<string, MomentInput>();
  const accounts = [...new Set(rows.filter(r => r.platform === 'telegram').map(r => r.account as string))];
  for (const account of accounts) {
    const adapter = telegramAdapter(account); let cursor: string | undefined;
    try {
      for (let page = 0; page < 100; page++) {
        const result = await adapter.fetchPage(cursor);
        for (const post of result.posts) refreshed.set(`${account}/${post.externalId}`, post);
        console.log(JSON.stringify({ event: 'refresh_page', account, posts: result.posts.length }));
        if (!result.nextCursor) break;
        if (result.nextCursor === cursor) throw new Error('TELEGRAM_CURSOR_STALLED');
        cursor = result.nextCursor;
      }
    } finally { await adapter.close?.(); }
  }
  const cache = momentImageCache({ proxy: process.env.MOMENTS_HTTP_PROXY });
  const entries: Entry[] = []; let position = 0, processed = 0;
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (position < rows.length) {
        const row = rows[position++];
        const original: MomentInput = { externalId: row.external_id, sourceUrl: row.source_url, title: row.title, text: row.body_text,
          html: row.body_html, publishedAt: new Date(row.published_at).toISOString(), media: json(row.media), tags: json(row.tags) };
        if (!imageUrls(original).length) continue;
        const post = structuredClone(original);
        if (row.platform === 'telegram' && post.media.some(m => m.type === 'image' && !isCachedMomentImage(m.url))) {
          const fresh = refreshed.get(`${row.account}/${post.externalId}`);
          const oldImages = post.media.filter(m => m.type === 'image'), freshImages = fresh?.media.filter(m => m.type === 'image');
          if (!freshImages || oldImages.length !== freshImages.length) throw new Error('MOMENTS_MEDIA_REFRESH_MISMATCH');
          const replacements = new Map(oldImages.map((m, i) => [m.url, freshImages[i].url]));
          const $ = load(post.html, {}, false);
          $('img[src]').each((_, img) => { const value = replacements.get($(img).attr('src')!); if (value) $(img).attr('src', value); });
          post.html = $.html(); post.media = post.media.map(m => m.type === 'image' ? { ...m, url: replacements.get(m.url)! } : m);
        }
        const [cached] = await cacheMomentImages([post], cache);
        entries.push({ id: row.id, sourceId: row.source_id, expectedHash: row.content_hash, post: normalizeMoment(cached) });
        if (++processed % 25 === 0) console.log(JSON.stringify({ event: 'cached_posts', processed }));
      }
    }));
    entries.sort((a, b) => a.id.localeCompare(b.id));
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ event: 'staged', posts: entries.length, imageReferences: entries.reduce((n, e) => n + imageUrls(e.post).length, 0), directory: momentMediaDirectory() }));
  } finally { await cache.close(); }
}
async function apply() {
  const backupPath = argument('--backup'); if (!backupPath) throw new Error('MOMENTS_MEDIA_BACKUP_REQUIRED');
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !manifest.entries.length || manifest.entries.length > 10_000) throw new Error('MOMENTS_MEDIA_INVALID_MANIFEST');
  const names = new Set<string>();
  for (const entry of manifest.entries) {
    normalizeMoment(entry.post);
    for (const url of imageUrls(entry.post)) {
      if (!isCachedMomentImage(url)) throw new Error('MOMENTS_MEDIA_NOT_CACHED');
      names.add(url.slice(MOMENT_MEDIA_PREFIX.length));
    }
  }
  for (const name of names) {
    const bytes = await readFile(join(momentMediaDirectory(), name));
    if (`${createHash('sha256').update(bytes).digest('hex')}.${imageFormat(bytes)}` !== name) throw new Error('MOMENTS_MEDIA_HASH_MISMATCH');
  }
  const connection = await getPool().getConnection(), locks: string[] = [];
  try {
    for (const source of [...new Set(manifest.entries.map(e => e.sourceId))].sort()) {
      const name = 'rain_moments_' + createHash('sha256').update(source).digest('hex').slice(0, 32);
      const [found] = await connection.query<any[]>('SELECT GET_LOCK(?,10) AS acquired', [name]);
      if (Number(found[0].acquired) !== 1) throw new Error('MOMENTS_MEDIA_LOCKED'); locks.push(name);
    }
    await connection.beginTransaction(); const backup: any[] = [];
    for (const entry of manifest.entries) {
      const [found] = await connection.query<any[]>('SELECT id,source_id,external_id,body_html,media,content_hash FROM blog_moments WHERE id=? FOR UPDATE', [entry.id]);
      const row = found[0];
      if (!row || row.source_id !== entry.sourceId || row.external_id !== entry.post.externalId || row.content_hash !== entry.expectedHash) throw new Error('MOMENTS_MEDIA_CONTENT_CHANGED');
      backup.push(row);
    }
    // Make recovery concrete before modifying the database. IDs, text, dates and status stay intact.
    await writeFile(resolve(backupPath), JSON.stringify({ createdAt: new Date().toISOString(), rows: backup }, null, 2), { mode: 0o600, flag: 'wx' });
    for (const entry of manifest.entries) {
      const post = normalizeMoment(entry.post);
      await connection.query('UPDATE blog_moments SET body_html=?,media=?,content_hash=? WHERE id=?', [post.html, JSON.stringify(post.media), post.hash, entry.id]);
    }
    await connection.commit();
    console.log(JSON.stringify({ event: 'applied', posts: manifest.entries.length, assets: names.size }));
  } catch (error) { await connection.rollback(); throw error; }
  finally { for (const name of locks) await connection.query('SELECT RELEASE_LOCK(?)', [name]); connection.release(); }
}
if (!['stage', 'apply'].includes(mode)) throw new Error('Usage: cache-moment-images.ts stage|apply --manifest FILE [--backup FILE]');
(mode === 'stage' ? stage() : apply()).catch(error => { console.error(JSON.stringify({ event: 'media_repair_failed', error: syncError(error) })); process.exitCode = 1; }).finally(closeDatabase);
