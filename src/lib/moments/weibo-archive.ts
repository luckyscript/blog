import { load } from 'cheerio';
import { cleanMomentHtml, httpsUrl } from './content';
import { weiboMidToId } from './weibo';
import type { MomentInput } from './types';

export function parseWeiboArchive(records: any[]) {
  const posts = new Map<string, MomentInput>(); let skipped = 0;
  for (const record of records) {
    if (record.draft) { skipped++; continue; }
    const $ = load(record.html || '');
    // Only the explicit attribution footer establishes provenance; body links may be reposts.
    const footer = $('a').toArray().reverse().find(a => $(a).text().trim() === '原文链接' && /来源于个人weibo/.test($(a).parent().text()));
    if (!footer) { skipped++; continue; }
    const url = new URL($(footer).attr('href') || '');
    const mid = url.hostname === 'm.weibo.cn' && url.pathname.match(/^\/status\/([a-zA-Z0-9]+)$/)?.[1];
    if (!mid) throw new Error('WEIBO_INVALID_ARCHIVE_SOURCE');
    const externalId = weiboMidToId(mid);
    $(footer).parent().remove(); $('script,style').remove();
    const media: MomentInput['media'] = [];
    for (const img of $('img').toArray()) {
      const src = $(img).attr('src') || ''; const safe = httpsUrl(src.replace(/^http:\/\//, 'https://'));
      if (safe) { $(img).attr('src', safe); media.push({ type: 'image', url: safe, alt: ($(img).attr('alt') || '').slice(0, 500) }); }
    }
    const html = cleanMomentHtml($('body').html() || '');
    $('br').replaceWith('\n'); $('p').append('\n');
    const text = $('body').text().trim();
    const publishedAt = new Date(record.date).toISOString();
    const post: MomentInput = { externalId, sourceUrl: `https://m.weibo.cn/status/${mid}`, title: text.slice(0, 80), text, html, publishedAt, media, tags: Array.isArray(record.tags) ? record.tags : [] };
    if (posts.has(externalId)) throw new Error('WEIBO_DUPLICATE_ARCHIVE_ID');
    posts.set(externalId, post);
  }
  return { posts: [...posts.values()], skipped };
}
