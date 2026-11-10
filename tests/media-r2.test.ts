import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadArticleToR2 } from '../src/lib/server/media-r2';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
test('后台 R2 上传保存本机副本并回读校验，失败不会返回成功链接', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'article-r2-')), credential = join(directory, 'credential.json');
  const keys = ['ARTICLE_MEDIA_DIRECTORY', 'ARTICLE_R2_CREDENTIAL_FILE', 'ARTICLE_MEDIA_PUBLIC_ORIGIN'];
  const previous = keys.map(key => process.env[key]);
  try {
    await writeFile(credential, JSON.stringify({ accountId: 'a'.repeat(32), bucket: 'rain-blog-media', accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64) }), { mode: 0o600 });
    Object.assign(process.env, { ARTICLE_MEDIA_DIRECTORY: join(directory, 'images'), ARTICLE_R2_CREDENTIAL_FILE: credential, ARTICLE_MEDIA_PUBLIC_ORIGIN: 'https://images.example.com' });
    const name = createHash('sha256').update(png).digest('hex') + '.png'; const calls: string[] = [];
    const result = await uploadArticleToR2(png, name, async (url, init) => {
      assert(new URL(String(url)).pathname.includes('/media/articles/')); calls.push(init!.method!);
      return init!.method === 'HEAD' ? new Response(null, { status: 404 }) : init!.method === 'PUT' ? new Response(null) : new Response(png);
    });
    assert.deepEqual(calls, ['HEAD', 'PUT', 'GET']); assert.equal(result.url, 'https://images.example.com/media/articles/' + name);
    assert.deepEqual(await readFile(join(directory, 'images', name)), png); assert.equal((await stat(join(directory, 'images', name))).mode & 0o777, 0o600);
    await assert.rejects(() => uploadArticleToR2(png, name, async () => new Response(null, { status: 403 })), /HTTP_403/);
    assert.deepEqual(await readFile(join(directory, 'images', name)), png);
  } finally { keys.forEach((key, index) => previous[index] === undefined ? delete process.env[key] : process.env[key] = previous[index]); await rm(directory, { recursive: true, force: true }); }
});
