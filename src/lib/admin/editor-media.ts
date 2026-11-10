export function clipboardImages(data: Pick<DataTransfer, 'items' | 'files'>): File[] {
  const items = Array.from(data.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
  return items.length ? items : Array.from(data.files || []).filter(file => file.type.startsWith('image/'));
}
export function insertEditorText(markdown: string, snippet: string, start: number, end: number) {
  start = Math.max(0, Math.min(markdown.length, start)); end = Math.max(start, Math.min(markdown.length, end));
  return { markdown: markdown.slice(0, start) + snippet + markdown.slice(end), cursor: start + snippet.length };
}
export function replaceImagePlaceholder(markdown: string, placeholder: string, snippet: string) {
  const index = markdown.indexOf(placeholder);
  return index < 0 ? { markdown, inserted: false } : { markdown: markdown.slice(0, index) + snippet + markdown.slice(index + placeholder.length), inserted: true };
}
export function stripPendingImages(markdown: string, markers: Iterable<string> = []) {
  for (const marker of markers) markdown = replaceImagePlaceholder(markdown, marker, '').markdown;
  return markdown;
}
export function mediaMarkdown(item: { mime: string; url: string; alt?: string; name?: string }) {
  if (typeof item.url !== 'string' || !item.url.trim()) throw new Error('上传结果缺少有效的图片地址');
  let url: URL; try { url = new URL(item.url, 'https://local.invalid'); } catch { throw new Error('上传结果缺少有效的图片地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || item.url.startsWith('//')) throw new Error('上传结果缺少有效的图片地址');
  const label = String(item.alt || (item.mime === 'application/pdf' ? item.name || '' : '')).replace(/[\[\]\r\n]/g, '');
  const destination = item.url.replace(/[()\s]/g, char => encodeURIComponent(char));
  return `${item.mime === 'application/pdf' ? '' : '!'}[${label}](${destination})`;
}
