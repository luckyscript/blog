import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { momentImageCache, cacheMomentImages, imageSource } from '../src/lib/moments/media-cache';
import { momentImageResponse } from '../src/lib/moments/media-response';
import { normalizeMoment } from '../src/lib/moments/content';
import { collectPages } from '../src/lib/moments/plan';
import type { MomentInput } from '../src/lib/moments/types';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const source = 'https://cdn5.telesco.pe/file/test.jpg';
const post: MomentInput = { externalId: '1', sourceUrl: 'https://t.me/test_blog/1', title: '照片', text: '正文', html: `<p>正文</p><img src="${source}" loading="lazy">`, publishedAt: '2026-11-01T00:00:00Z', tags: [], media: [{ type: 'image', url: source, alt: '照片' }] };
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'rain-moments-media-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
test('图片原子落盘、按内容去重，进程重建后源站离线仍可命中缓存', () => temporary(async directory => {
  let calls = 0;
  const cache = momentImageCache({ directory, fetcher: async () => { calls++; return new Response(png); } });
  const [cached] = await cacheMomentImages([post], cache);
  assert.equal(calls, 1); assert.match(cached.media[0].url, /^\/media\/moments\/[a-f0-9]{64}\.png$/);
  assert.ok(cached.html.includes(cached.media[0].url)); assert.equal(post.media[0].url, source);
  const second = await cache.cache('https://h5.sinaimg.cn/emoji.png');
  assert.equal(second, cached.media[0].url);
  assert.equal((await stat(join(directory, second.split('/').at(-1)!))).mode & 0o777, 0o640);
  assert.equal((await readdir(directory)).filter(n => !n.startsWith('.')).length, 1);
  const offline = momentImageCache({ directory, fetcher: async () => { throw new Error('offline'); } });
  assert.equal(await offline.cache(source), second);
  assert.equal(normalizeMoment(cached).media[0].url, second);
  for (const url of ['/media/moments/../../secret', '//example.com/photo', second + '?source=x', second + '/x'])
    assert.throws(() => normalizeMoment({ ...post, media: [{ ...post.media[0], url }] }));
}));
test('只下载明确允许的 HTTPS 图片源，重定向不能访问内部地址或其他网站', () => temporary(async directory => {
  for (const url of ['http://cdn5.telesco.pe/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://cdn5.telesco.pe.evil.test/x', 'https://sinaimg.cn@evil.test/x', 'https://cdn5.telesco.pe:8443/x'])
    assert.throws(() => imageSource(url), /INVALID_SOURCE/);
  let calls = 0;
  const cache = momentImageCache({ directory, fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }); } });
  await assert.rejects(() => cache.cache(source), /INVALID_SOURCE/); assert.equal(calls, 1);
}));
test('拒绝错误页、SVG 和超大响应，失败时不发布外链也不留下半张图片', () => temporary(async directory => {
  for (const response of [new Response('<svg onload="x()"/>'), new Response('missing', { status: 404 }), new Response(png, { headers: { 'content-length': String(9 * 1024 * 1024) } }), new Response(new Uint8Array(8 * 1024 * 1024 + 1))]) {
    const cache = momentImageCache({ directory, fetcher: async () => response });
    await assert.rejects(() => cacheMomentImages([post], cache), /MOMENTS_MEDIA_(INVALID_IMAGE|HTTP_404|TOO_LARGE)/);
    assert.deepEqual(await readdir(directory), []);
  }
  const cache = momentImageCache({ directory, fetcher: async () => new Response('gone', { status: 404 }) });
  const state = { checkpoint: '1', backfillComplete: true }; let saved = false;
  await assert.rejects(() => collectPages({ fetchPage: async () => ({ posts: [{ ...post, externalId: '2' }] }) }, state, async posts => { await cacheMomentImages(posts, cache); saved = true; }, 1));
  assert.equal(saved, false); assert.equal(state.checkpoint, '1');
}));
test('图片下载遵守超时与取消', () => temporary(async directory => {
  const cache = momentImageCache({ directory, timeoutMs: 20, fetcher: async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  }) });
  // AbortSignal.timeout alone does not keep Node's event loop alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(() => cache.cache(source), { name: 'TimeoutError' }); }
  finally { clearTimeout(keepAlive); }
  assert.deepEqual(await readdir(directory), []);
}));
test('R2 失败时保留本机副本并阻止发布，恢复后从已有文件重试', () => temporary(async directory => {
  const cache = momentImageCache({ directory, fetcher: async () => new Response(png), mirror: { ensure: async () => { throw Error('MOMENTS_R2_HTTP_503'); } } });
  let saved = false;
  await assert.rejects(() => collectPages({ fetchPage: async () => ({ posts: [post] }) }, {}, async posts => { await cacheMomentImages(posts, cache); saved = true; }), /R2_HTTP_503/);
  assert.equal(saved, false); assert.equal((await readdir(directory)).filter(name => !name.startsWith('.')).length, 1);
  let mirrored = 0;
  const retry = momentImageCache({ directory, fetcher: async () => { throw Error('source offline'); }, mirror: { ensure: async () => { mirrored++; } } });
  await retry.cache(source); assert.equal(mirrored, 1);
}));
test('站内图片支持 GET、HEAD、ETag 与长期缓存，拒绝路径穿越且不代理网络', () => temporary(async directory => {
  const cache = momentImageCache({ directory, fetcher: async () => new Response(png) });
  const url = await cache.cache(source), name = url.split('/').at(-1)!;
  const response = await momentImageResponse(new Request('https://blog.test' + url), name, directory);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control')!, /immutable/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(directory, name)));
  const head = await momentImageResponse(new Request('https://blog.test' + url, { method: 'HEAD' }), name, directory);
  assert.equal(head.headers.get('content-length'), String(png.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const unchanged = await momentImageResponse(new Request('https://blog.test' + url, { headers: { 'if-none-match': 'W/' + response.headers.get('etag') } }), name, directory);
  assert.equal(unchanged.status, 304);
  for (const bad of ['../../.env', name + '.html', 'https://cdn5.telesco.pe/x.jpg', '0'.repeat(64) + '.jpg'])
    assert.equal((await momentImageResponse(new Request('https://blog.test/x'), bad, directory)).status, 404);
}));
