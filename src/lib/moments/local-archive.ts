import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import type { PoolConnection } from 'mysql2/promise';
import { cleanMomentHtml, escapeHtml, normalizeMoment } from './content';
import { parseWeiboArchive } from './weibo-archive';
import type { MomentInput } from './types';

export const localArchiveSource = 'local:notes';

/** Keep local notes; attributed Weibo records already have their own source IDs. */
export function parseLocalArchive(records: any[], site = 'https://rainonpiano.com') {
  const posts = new Map<string, MomentInput>();
  let skipped = 0;
  for (const record of records) {
    if (record.draft || parseWeiboArchive([record]).posts.length) { skipped++; continue; }
    const date = new Date(record.date);
    if (!Number.isFinite(date.getTime())) throw new Error('MOMENTS_INVALID_LOCAL_DATE');
    const externalId = `note-${date.getTime()}`;
    if (posts.has(externalId)) throw new Error('MOMENTS_DUPLICATE_LOCAL_DATE');
    const $ = load(record.html || '', {}, false);
    $('script,style').remove();
    $('heading').each((_, element) => {
      const level = /^[1-6]$/.test($(element).attr('level') || '') ? $(element).attr('level')! : '2';
      $(element).replaceWith(`<h${level}>${$(element).html() || ''}</h${level}>`);
    });
    $('youtubeembed,bilibiliembed').each((_, element) => {
      const embed = $(element);
      let url = '';
      if (element.tagName === 'bilibiliembed') {
        const id = embed.attr('id') || '';
        if (/^BV[a-zA-Z0-9]{10}$/.test(id)) url = `https://www.bilibili.com/video/${id}/`;
      } else {
        const original = new URL(embed.attr('url') || '');
        const id = original.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})$/)?.[1];
        if (['youtube.com', 'www.youtube.com'].includes(original.hostname) && id) url = `https://www.youtube.com/watch?v=${id}`;
      }
      if (!url) throw new Error('MOMENTS_INVALID_LOCAL_EMBED');
      embed.replaceWith(`<p><a href="${url}">${escapeHtml(embed.attr('label') || '观看视频')}</a></p>`);
    });
    const media: MomentInput['media'] = [];
    $('img[src]').each((_, element) => {
      const image = $(element), url = (image.attr('src') || '').replace(/^http:\/\//, 'https://');
      image.attr('src', url);
      media.push({ type: 'image', url, alt: (image.attr('alt') || '').slice(0, 500) });
    });
    const title = $('h1,h2,h3').first().text().trim();
    const textOnly = load($.html(), {}, false);
    textOnly('br').replaceWith('\n'); textOnly('p,li,h1,h2,h3,h4,h5,h6').append('\n');
    const text = textOnly.root().text().trim();
    if (record.pos) $.root().append(`<p><span class="moment-location">${escapeHtml(String(record.pos))}</span></p>`);
    const post = normalizeMoment({ externalId, sourceUrl: new URL('/moments', site).href,
      title: title || text.slice(0, 80), text, html: cleanMomentHtml($.html()),
      publishedAt: date.toISOString(), tags: Array.isArray(record.tags) ? record.tags : [], media });
    posts.set(externalId, post);
  }
  return { posts: [...posts.values()], skipped };
}

/** One transaction, insert-only: repeat runs preserve saved edits and trash status. */
export async function saveLocalArchive(connection: PoolConnection, posts: MomentInput[]) {
  const normalized = posts.map(normalizeMoment);
  const insertedIds: string[] = [];
  await connection.beginTransaction();
  try {
    await connection.query(`INSERT INTO blog_moment_sources (id,platform,account,title,sync_state,created_at)
      VALUES (?,'local','notes','本站随记','{"archive":true,"backfillComplete":true}',UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE id=id`, [localArchiveSource]);
    for (const item of normalized) {
      const [existing] = await connection.query<any[]>('SELECT id FROM blog_moments WHERE source_id=? AND external_id=? FOR UPDATE', [localArchiveSource, item.externalId]);
      if (existing.length) continue;
      const id = randomUUID();
      await connection.query(`INSERT INTO blog_moments (id,source_id,external_id,source_url,title,body_text,body_html,media,tags,content_hash,published_at,first_seen_at,last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [id,localArchiveSource,item.externalId,item.sourceUrl,item.title,item.text,item.html,JSON.stringify(item.media),JSON.stringify(item.tags),item.hash,new Date(item.publishedAt)]);
      insertedIds.push(id);
    }
    await connection.query('UPDATE blog_moment_sources SET last_attempt_at=UTC_TIMESTAMP(3),last_success_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=?', [localArchiveSource]);
    await connection.commit();
    return { insertedIds, existing: normalized.length - insertedIds.length };
  } catch (error) { await connection.rollback(); throw error; }
}
