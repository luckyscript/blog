import * as cheerio from "cheerio";
import { fetch as proxyFetch, ProxyAgent } from "undici";
import { cleanMomentHtml, escapeHtml, httpsUrl } from "./content";
import type { MomentAdapter, MomentInput, MomentMedia, MomentPage } from "./types";

export function parseTelegramPage(html: string, account: string): MomentPage {
  const $ = cheerio.load(html);
  if (!$('.tgme_channel_history').length) throw new Error("TELEGRAM_INVALID_PAGE");
  const posts: MomentInput[] = [];
  const ids: string[] = [];
  $('.tgme_widget_message[data-post]').each((_, element) => {
    const item = $(element);
    const [channel, externalId] = (item.attr('data-post') || '').split('/');
    if (channel?.toLowerCase() !== account.toLowerCase() || !/^\d+$/.test(externalId || '')) return;
    ids.push(externalId);
    if (item.hasClass('service_message')) return;
    const publishedAt = item.find('time[datetime]').attr('datetime');
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return;
    const content = item.find('.tgme_widget_message_text').first();
    content.find('script,style,iframe,object').remove();
    content.find('br').replaceWith('\n');
    content.find('a').each((_, anchor) => {
      const link = $(anchor); const href = link.attr('href') || '';
      try { link.attr('href', new URL(href, `https://t.me/${account}/`).href); } catch { link.removeAttr('href'); }
    });
    const text = content.text().trim();
    const title = text.slice(0, 100) || "一则碎碎念";
    const media: MomentMedia[] = [];
    const seen = new Set<string>();
    const add = (type: MomentMedia['type'], raw?: string) => {
      const url = httpsUrl(raw || '');
      if (url && !seen.has(url)) { seen.add(url); media.push({ type, url, alt: title }); }
    };
    item.find('.tgme_widget_message_photo_wrap').each((_, node) => add('image', $(node).attr('style')?.match(/url\(["']?(.*?)["']?\)/)?.[1]));
    item.find('.tgme_widget_message_sticker').each((_, node) => add('image', $(node).attr('data-webp')));
    item.find('video').each((_, node) => add('video', $(node).attr('src') || $(node).find('source').attr('src')));
    item.find('audio').each((_, node) => add('audio', $(node).attr('src')));
    if (!text && !media.length) return;
    const attachments = media.map(m => m.type === 'image'
      ? `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.alt)}" loading="lazy">`
      : `<${m.type} src="${escapeHtml(m.url)}" controls preload="none"></${m.type}>`).join('');
    // Preserve line breaks while leaving the original text and media URLs separately queryable.
    posts.push({ externalId, sourceUrl: `https://t.me/${account}/${externalId}`, title, text,
      html: cleanMomentHtml((content.html() || '').replaceAll('\n', '<br>') + attachments), publishedAt,
      tags: [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map(m => m[1]).slice(0, 100), media });
  });
  posts.sort((a,b) => BigInt(a.externalId) > BigInt(b.externalId) ? -1 : 1);
  const oldest = ids.reduce<string | undefined>((min, id) => !min || BigInt(id) < BigInt(min) ? id : min, undefined);
  return { posts, nextCursor: oldest && BigInt(oldest) > 1n ? oldest : undefined };
}

export function telegramAdapter(account: string, values = process.env): MomentAdapter {
  if (!/^[A-Za-z0-9_]{5,64}$/.test(account)) throw new Error('TELEGRAM_INVALID_ACCOUNT');
  const origin = new URL(values.MOMENTS_TELEGRAM_ORIGIN || 'https://t.me');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('TELEGRAM_INVALID_ORIGIN');
  const proxy = values.MOMENTS_HTTP_PROXY;
  if (proxy && !['http:', 'https:'].includes(new URL(proxy).protocol)) throw new Error('MOMENTS_INVALID_PROXY');
  const agent = proxy ? new ProxyAgent(proxy) : undefined;
  return {
    async fetchPage(cursor, signal) {
      const url = new URL(`/s/${account}`, origin);
      if (cursor) { if (!/^\d+$/.test(cursor)) throw new Error('TELEGRAM_INVALID_CURSOR'); url.searchParams.set('before', cursor); }
      const options = { signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]), headers: { 'user-agent': 'RainBlog-Moments/1.0', accept: 'text/html' }, redirect: 'error' as const };
      const response = agent ? await proxyFetch(url, { ...options, dispatcher: agent }) : await fetch(url, options);
      if (!response.ok) throw new Error(`TELEGRAM_HTTP_${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('TELEGRAM_EMPTY_RESPONSE');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { while (true) { const {done,value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 3_000_000) { await reader.cancel(); throw new Error('TELEGRAM_RESPONSE_TOO_LARGE'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      return parseTelegramPage(Buffer.concat(chunks).toString('utf8'), account);
    },
    async close() { await agent?.close(); },
  };
}
