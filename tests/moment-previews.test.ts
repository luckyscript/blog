import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { momentPreviewResponse, momentPreviewUrl } from '../src/lib/moments/preview';
import { presentMoment } from '../src/lib/moments/presentation';
import { load } from 'cheerio';

test('缩略图仅处理本站已保存的图片，拒绝任意外链、路径与尺寸', async () => {
  const name = 'a'.repeat(64) + '.jpg', path = '/media/moments/' + name;
  assert.equal(momentPreviewUrl(path, 320), `/media/moments/previews/v1/320/${name}.webp`);
  assert.equal(momentPreviewUrl('https://images.example.com' + path, 640, 'https://images.example.com'), `/media/moments/previews/v1/640/${name}.webp`);
  for (const url of ['https://evil.example.com' + path, 'https://images.example.com' + path + '?x=1', path + '/../secret', '/media/moments/../../.env'])
    assert.equal(momentPreviewUrl(url, 320, 'https://images.example.com'), undefined);
  assert.equal(momentPreviewUrl(path, 9999), undefined);
  for (const [width, file] of [['9999', name + '.webp'], ['320', '../.env.webp'], ['640', 'https://localhost/x.webp']])
    assert.equal((await momentPreviewResponse(new Request('https://blog.test/preview'), width, file)).status, 404);
});

test('生成小尺寸 WebP 并复用持久缓存，支持 HEAD / 304，原始图片保持完整', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rain-previews-'));
  const bytes = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#aa7788' } }).jpeg({ quality: 95 }).toBuffer();
  const name = createHash('sha256').update(bytes).digest('hex') + '.jpg';
  const options = { sourceDirectory: directory, cacheDirectory: join(directory, 'cache') };
  const request = new Request('https://blog.test/preview');
  try {
    await writeFile(join(directory, name), bytes);
    const responses = await Promise.all(Array.from({ length: 3 }, () => momentPreviewResponse(request, '320', name + '.webp', options)));
    const previews = await Promise.all(responses.map(response => response.arrayBuffer()));
    const result = await sharp(Buffer.from(previews[0])).metadata();
    assert.equal(result.format, 'webp'); assert.equal(result.width, 320); assert.equal(result.height, 240);
    assert(previews[0].byteLength < bytes.length);
    assert.deepEqual(await readFile(join(directory, name)), bytes);
    assert.deepEqual(previews[0], previews[1]);
    assert.equal((await readdir(join(options.cacheDirectory, 'v1', '320'))).length, 1);
    const cachedPath = join(options.cacheDirectory, 'v1', '320', name + '.webp');
    const before = (await stat(cachedPath)).mtimeMs;
    const head = await momentPreviewResponse(new Request(request, { method: 'HEAD' }), '320', name + '.webp', options);
    assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get('content-length'), String(previews[0].byteLength));
    assert.match(head.headers.get('cache-control')!, /immutable/);
    const conditional = await momentPreviewResponse(new Request(request, { headers: { 'if-none-match': 'W/' + head.headers.get('etag') } }), '320', name + '.webp', options);
    assert.equal(conditional.status, 304); assert.equal((await stat(cachedPath)).mtimeMs, before);
    const portrait = await sharp({ create: { width: 800, height: 3200, channels: 3, background: '#aa7788' } }).jpeg().toBuffer();
    const portraitName = createHash('sha256').update(portrait).digest('hex') + '.jpg';
    await writeFile(join(directory, portraitName), portrait);
    const portraitResponse = await momentPreviewResponse(request, '320', portraitName + '.webp', options);
    const portraitMetadata = await sharp(Buffer.from(await portraitResponse.arrayBuffer())).metadata();
    assert.equal(portraitMetadata.width, 320); assert.equal(portraitMetadata.height, 1280);
    assert.equal((await momentPreviewResponse(request, '320', 'b'.repeat(64) + '.jpg.webp', options)).status, 404);
    await writeFile(join(directory, 'c'.repeat(64) + '.jpg'), 'invalid image');
    const fallback = await momentPreviewResponse(request, '320', 'c'.repeat(64) + '.jpg.webp', options);
    assert.equal(fallback.status, 302); assert.equal(fallback.headers.get('cache-control'), 'no-store');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('列表使用响应式缩略图，大图在打开前没有 src，不提前下载原图', () => {
  const path = '/media/moments/' + 'a'.repeat(64) + '.jpg';
  const result = presentMoment(`<p><img src="${path}" alt="照片"></p>`, 'preview');
  const body = load(result.body), dialogs = load(result.lightboxes);
  assert.match(body('.moment-photo img').attr('src')!, /previews\/v1\/320\//);
  assert.match(body('.moment-photo img').attr('srcset')!, /640w/);
  assert.equal(dialogs('.moment-lightbox img').attr('src'), undefined);
  assert.equal(dialogs('.moment-lightbox img').attr('data-full-src'), path);
  assert.equal(dialogs('.moment-lightbox img').attr('data-full-fallback'), path);
});
