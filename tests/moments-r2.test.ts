import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signR2Request, r2ImageMirror, readR2Credential, ARTICLE_MEDIA_PREFIX } from '../src/lib/moments/r2';
import { publicMomentImages } from '../src/lib/moments/media-public';

const bytes = Buffer.from('test image bytes'), hash = createHash('sha256').update(bytes).digest('hex'), name = `${hash}.jpg`;
const credential = { accountId: 'a'.repeat(32), bucket: 'rain-blog-media', accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64) };
test('R2 请求限定内容寻址文件与固定 S3 主机，签名包含正文与对象元数据', () => {
  const signed = signR2Request(credential, 'PUT', name, bytes, new Date('2026-11-08T10:00:00Z'));
  assert.equal(signed.url.href, `https://${credential.accountId}.r2.cloudflarestorage.com/rain-blog-media/media/moments/${name}`);
  assert.equal(signed.headers['x-amz-content-sha256'], hash); assert.equal(signed.headers['x-amz-meta-sha256'], hash);
  assert.equal(signed.headers['x-amz-date'], '20261108T100000Z'); assert.match(signed.headers.authorization, /20261108\/auto\/s3\/aws4_request/);
  assert.doesNotMatch(signed.headers.authorization, new RegExp(credential.secretAccessKey));
  for (const invalid of ['../../.env', name + '?x=y', 'https://evil.test/x']) assert.throws(() => signR2Request(credential, 'PUT', invalid, bytes), /INVALID_NAME/);
});
test('R2 上传后读取验证 SHA-256，已有对象去重，远端损坏与拒绝必须报错', async () => {
  const calls: string[] = [];
  const mirror = r2ImageMirror(credential, async (_url, init) => {
    calls.push(init!.method!);
    if (init!.method === 'HEAD') return new Response(null, { status: 404 });
    if (init!.method === 'PUT') { assert.deepEqual(Buffer.from(init!.body as Uint8Array), bytes); return new Response(null); }
    return new Response(bytes);
  });
  await mirror.ensure(name, bytes); await mirror.ensure(name, bytes); assert.deepEqual(calls, ['HEAD', 'PUT', 'GET']);
  await assert.rejects(() => r2ImageMirror(credential, async () => new Response('wrong bytes')).verify(name, bytes), /HASH_MISMATCH/);
  await assert.rejects(() => r2ImageMirror(credential, async () => new Response('secret upstream debug', { status: 403 })).ensure(name, bytes), /^Error: MOMENTS_R2_HTTP_403$/);
  await assert.rejects(() => r2ImageMirror(credential, async () => new Response(null, { headers: { 'content-length': String(bytes.length), 'x-amz-meta-sha256': 'wrong' } })).ensure(name, bytes), /METADATA_MISMATCH/);
});
test('R2 临时连接故障自动重试，权限错误不重复尝试', async () => {
  let calls = 0;
  const mirror = r2ImageMirror(credential, async () => {
    calls++; if (calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } });
    return new Response(null, { headers: { 'content-length': String(bytes.length), 'x-amz-meta-sha256': hash } });
  });
  await mirror.ensure(name, bytes); assert.equal(calls, 2);
  let denied = 0;
  await assert.rejects(() => r2ImageMirror(credential, async () => { denied++; return new Response(null, { status: 403 }); }).ensure(name, bytes), /HTTP_403/);
  assert.equal(denied, 1);
});
test('文章附件使用独立路径和正确 MIME，碎碎念路径仍拒绝 PDF', () => {
  const pdf = Buffer.from('%PDF-1.7'), filename = createHash('sha256').update(pdf).digest('hex') + '.pdf';
  const signed = signR2Request(credential, 'PUT', filename, pdf, new Date(), { prefix: ARTICLE_MEDIA_PREFIX });
  assert(signed.url.pathname.includes('/media/articles/'));assert.equal(signed.headers['content-type'], 'application/pdf');
  assert.throws(() => signR2Request(credential, 'PUT', filename, pdf), /INVALID_NAME/);
});
test('R2 凭据必须是本用户私有文件，拒绝链接和公开权限', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rain-r2-')), file = join(directory, 'credential.json');
  try {
    await writeFile(file, JSON.stringify(credential), { mode: 0o600 }); assert.deepEqual(await readR2Credential(file), credential);
    await chmod(file, 0o644); await assert.rejects(() => readR2Credential(file), /INSECURE_CREDENTIAL/);
    await chmod(file, 0o600); await symlink(file, join(directory, 'link')); await assert.rejects(() => readR2Credential(join(directory, 'link')), /INSECURE_CREDENTIAL/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('R2 公共域名同时替换正文与媒体图片，数据库原值与视频地址保持不变', () => {
  const original = `/media/moments/${name}`, content = `<blockquote><img src="${original}"></blockquote>`;
  const media = [{ type: 'image' as const, url: original, alt: '' }, { type: 'video' as const, url: 'https://video.twimg.com/example', alt: '' }];
  const result = publicMomentImages(content, media, 'https://images.example.com');
  assert.match(result.content, /https:\/\/images.example.com\/media\/moments\//); assert.equal(result.media[0].url, 'https://images.example.com' + original);
  assert.equal(result.media[1].url, media[1].url); assert.equal(media[0].url, original);
  for (const invalid of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://127.0.0.1']) assert.throws(() => publicMomentImages(content, media, invalid), /INVALID_PUBLIC_ORIGIN/);
});
