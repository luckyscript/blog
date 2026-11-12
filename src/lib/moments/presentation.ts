import { load } from 'cheerio';
import { cleanMomentHtml, escapeHtml } from './content';
import { momentOriginalPath, momentPreviewUrl } from './preview';

/** Enhance saved HTML for reading without changing the stored original. */
export function presentMoment(html: string, id: string) {
  const $ = load(cleanMomentHtml(html), {}, false);
  const pictures: { id: string; src: string; alt: string }[] = [];
  $('img[src]').each((index, element) => {
    const image = $(element), src = image.attr('src')!;
    const alt = image.attr('alt') || '';
    if (/\/(?:emoticon|face)\//.test(src) || /^\[[^\]]{1,12}\]$/.test(alt)) {
      image.addClass('moment-inline-emoji'); return;
    }
    const popoverId = `moment-image-${id.replace(/[^a-zA-Z0-9_-]/g, '')}-${index}`;
    pictures.push({ id: popoverId, src, alt });
    image.attr({ loading: 'lazy', decoding: 'async' });
    const small = momentPreviewUrl(src, 320), large = momentPreviewUrl(src, 640);
    if (small && large) image.attr({ src: small, srcset: `${small} 320w, ${large} 640w` });
    const figure = $('<figure class="moment-photo"></figure>');
    const button = $('<button type="button" class="moment-photo-button"></button>').attr({ popovertarget: popoverId, 'aria-label': `查看图片 ${pictures.length}${alt ? `：${alt.slice(0, 80)}` : ''}` });
    const parent = image.parent();
    const target = parent.is('a') && parent.children().length === 1 && !parent.text().trim() ? parent : image;
    target.replaceWith(figure);
    figure.append(button.append(image));
    const paragraph = figure.parent();
    if (paragraph.is('p') && !paragraph.text().trim() && paragraph.children().length === 1) paragraph.replaceWith(figure);
  });
  $('figure.moment-photo').each((_, element) => {
    const figure = $(element);
    if (figure.parent().hasClass('moment-gallery')) return;
    const group = [element];
    for (let next = figure.next(); next.is('figure.moment-photo'); next = next.next()) group.push(next[0]);
    const gallery = $('<div class="moment-gallery"></div>').attr('data-count', String(group.length));
    figure.before(gallery);
    for (const item of group) gallery.append(item);
    gallery.find('img[srcset]').attr('sizes', group.length === 1 ? '(max-width: 680px) 220px, 360px' : '(max-width: 680px) calc((100vw - 64px) / 3), 156px');
  });
  const body = $.html();
  const preview = $('.moment-gallery').first().clone();
  if (preview.length) {
    preview.children().slice(3).remove();
    preview.attr('data-count', String(preview.children().length));
  }
  const lightboxes = pictures.map((picture, i) => `<div id="${picture.id}" class="moment-lightbox" popover>
    <button type="button" class="moment-lightbox-close" popovertarget="${picture.id}" popovertargetaction="hide" aria-label="关闭大图">关闭 ×</button>
    <img data-full-src="${escapeHtml(picture.src)}"${momentOriginalPath(picture.src) ? ` data-full-fallback="${escapeHtml(momentOriginalPath(picture.src)!)}"` : ''} alt="${escapeHtml(picture.alt)}" decoding="async">
    <p class="moment-lightbox-count">${i + 1} / ${pictures.length}</p></div>`).join('');
  return { body, lightboxes, imageCount: pictures.length, previewGallery: preview.length ? preview.toString() : '' };
}
