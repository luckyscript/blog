import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyData } from '../src/data/legacyMoments.js';
import { parseLocalArchive, saveLocalArchive } from '../src/lib/moments/local-archive';
import { parseWeiboArchive } from '../src/lib/moments/weibo-archive';
import type { PoolConnection } from 'mysql2/promise';

const note = { date: '2024-07-01T19:53:47.000Z', html: '<article><p>一段随记</p></article>', tags: ['生活'], pos: '云谷' };

test('485 条旧内容完整分流：451 条微博复用原记录，34 条本地随记保留时间和稳定身份', () => {
  const local = parseLocalArchive(legacyData);
  const weibo = parseWeiboArchive(legacyData);
  assert.equal(local.posts.length, 34);
  assert.equal(local.skipped, 451);
  assert.equal(local.posts.length + weibo.posts.length, legacyData.length);
  assert.equal(new Set(local.posts.map(post => post.externalId)).size, 34);
  assert.deepEqual(local.posts.map(post => post.externalId), parseLocalArchive([...legacyData].reverse()).posts.reverse().map(post => post.externalId));
  const edited = parseLocalArchive([{ ...note, html: '<p>修改后的文字</p>' }]).posts[0];
  assert.equal(edited.externalId, parseLocalArchive([note]).posts[0].externalId);
  assert.equal(edited.publishedAt, note.date);
});

test('本地随记保留标题、链接、视频引用、图片、标签和地点，移除脚本', () => {
  const html = '<heading level="2">旧标题</heading><p>第一段<br>第二行</p><p><a href="/ppt/passkey">站内链接</a></p>'
    + '<youtubeembed url="https://www.youtube.com/embed/mUzkBMJUdNA?si=old" label="发射视频"></youtubeembed>'
    + '<bilibiliembed id="BV1YQ4y1V7Yt"></bilibiliembed><img src="https://example.com/photo.png" alt="照片"><script>bad()</script>';
  const post = parseLocalArchive([{ ...note, html }]).posts[0];
  assert.equal(post.title, '旧标题');
  assert.match(post.html, /<h2>旧标题<\/h2>/);
  assert.match(post.html, /href="\/ppt\/passkey"/);
  assert.match(post.html, /https:\/\/www.youtube.com\/watch\?v=mUzkBMJUdNA/);
  assert.match(post.html, /https:\/\/www.bilibili.com\/video\/BV1YQ4y1V7Yt\//);
  assert.match(post.html, /moment-location.*云谷/);
  assert.doesNotMatch(post.html, /<script|youtubeembed|bilibiliembed|bad\(\)/);
  assert.match(post.text, /第一段\n第二行/);
  assert.deepEqual(post.tags, ['生活']);
  assert.deepEqual(post.media, [{ type: 'image', url: 'https://example.com/photo.png', alt: '照片' }]);
});

test('草稿不导入，冲突日期和损坏数据在写数据库前失败', () => {
  assert.equal(parseLocalArchive([{ ...note, draft: true }]).posts.length, 0);
  assert.throws(() => parseLocalArchive([note, note]), /DUPLICATE_LOCAL_DATE/);
  assert.throws(() => parseLocalArchive([{ ...note, date: 'invalid' }]), /INVALID_LOCAL_DATE/);
  assert.throws(() => parseLocalArchive([{ ...note, html: '<bilibiliembed id="invalid"></bilibiliembed>' }]), /INVALID_LOCAL_EMBED/);
});

test('重复导入不覆盖已有编辑或恢复回收站记录，写入失败会回滚', async () => {
  const records = new Map<string, any>();
  let snapshot = new Map<string, any>();
  const connection = {
    beginTransaction: async () => { snapshot = new Map(records); },
    commit: async () => {},
    rollback: async () => { records.clear(); for (const [key, value] of snapshot) records.set(key, value); },
    query: async (sql: string, values: any[]) => {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.startsWith('SELECT id FROM blog_moments')) return [records.has(values[1]) ? [records.get(values[1])] : []];
      if (sql.startsWith('INSERT INTO blog_moments ')) records.set(values[2], { id: values[0], text: values[5], status: 'published' });
      return [[]];
    },
  } as unknown as PoolConnection;
  const posts = parseLocalArchive([note]).posts;
  assert.equal((await saveLocalArchive(connection, posts)).insertedIds.length, 1);
  const saved = records.get(posts[0].externalId);
  saved.text = '后台已修改'; saved.status = 'trash';
  assert.equal((await saveLocalArchive(connection, posts)).insertedIds.length, 0);
  assert.deepEqual(records.get(posts[0].externalId), saved);
  const originalQuery = connection.query;
  connection.query = (async (sql: string, values: any[]) => {
    if (sql.startsWith('UPDATE blog_moment_sources')) throw new Error('write failed');
    return (originalQuery as any)(sql, values);
  }) as any;
  await assert.rejects(() => saveLocalArchive(connection, parseLocalArchive([{ ...note, date: '2024-07-02T19:53:47.000Z' }]).posts), /write failed/);
  assert.equal(records.size, 1);
});
