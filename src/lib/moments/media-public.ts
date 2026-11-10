import { load } from 'cheerio';
import { isCachedMomentImage } from './media-path';
import type { MomentMedia } from './types';

export function publicMomentImages(content: string, media: MomentMedia[], origin = process.env.MOMENTS_MEDIA_PUBLIC_ORIGIN) {
  if (!origin) return { content, media };
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('MOMENTS_MEDIA_INVALID_PUBLIC_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname)) throw new Error('MOMENTS_MEDIA_INVALID_PUBLIC_ORIGIN');
  const resolve = (value: string) => isCachedMomentImage(value) ? url.origin + value : value;
  const $ = load(content, {}, false);
  $('img[src]').each((_, image) => { $(image).attr('src', resolve($(image).attr('src')!)); });
  return { content: $.html(), media: media.map(item => item.type === 'image' ? { ...item, url: resolve(item.url) } : item) };
}
