import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXPage, xAccounts, xAdapter, xInterval } from '../src/lib/moments/x';
import { collectPages } from '../src/lib/moments/plan';
import { cacheMomentImages, imageSource } from '../src/lib/moments/media-cache';
import { normalizeMoment } from '../src/lib/moments/content';

const account = 'rainonpiano';
const user = (name = account, id = '123') => ({ rest_id: id, core: { screen_name: name }, legacy: { protected: false } });
function tweet(id: string, overrides: any = {}) {
  return { rest_id: id, core: { user_results: { result: user() } }, legacy: {
    full_text: '正文 https://t.co/abc #摄影', created_at: 'Tue Aug 25 15:19:35 +0000 2026',
    entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://rainonpiano.com/' }], hashtags: [{ text: '摄影' }] },
    ...overrides,
  } };
}
const payload = (tweets: any[], nextCursor: string | null = null) => ({ ok: true, profile: { id: '123', screenName: account, protected: false }, tweets, nextCursor });

test('X 只接入配置账号，用户名规范化且频率与游标有明确边界', () => {
  assert.deepEqual(xAccounts({ MOMENTS_X_ACCOUNTS: '@RainOnPiano,raininpiano,rainonpiano' }), ['rainonpiano', 'raininpiano']);
  assert.deepEqual(xAccounts({}), []);
  assert.throws(() => xAccounts({ MOMENTS_X_ACCOUNTS: '../secret' }), /INVALID_ACCOUNT/);
  assert.throws(() => xAdapter('other', { MOMENTS_X_ACCOUNTS: account }), /INVALID_ACCOUNT/);
  assert.equal(xInterval({}), 3600);
  assert.throws(() => xInterval({ MOMENTS_X_INTERVAL_SECONDS: '10' }), /INVALID_INTERVAL/);
  assert.throws(() => parseXPage(payload([], '../escape'), account), /INVALID_CURSOR/);
  assert.throws(() => parseXPage({ ok: false, error: 'login required' }, account), /INVALID_RESPONSE/);
});
test('X 保留长 ID、完整长文、时间、链接与标签，置顶和重复内容不扰乱检查点', () => {
  const pinned = tweet('1999999999999999999');
  const newer = tweet('2000000000000000001', { truncated: true });
  (newer as any).note_tweet = { note_tweet_results: { result: { text: '完整长文\n<script>alert(1)</script> #摄影' } } };
  const page = parseXPage(payload([pinned, newer, newer], 'DAABC_12-='), account);
  assert.deepEqual(page.posts.map(p => p.externalId), ['2000000000000000001', '1999999999999999999']);
  assert.deepEqual(page.observedIds, ['2000000000000000001', '1999999999999999999']);
  assert.equal(page.posts[0].text, '完整长文\n<script>alert(1)</script> #摄影');
  assert.doesNotMatch(page.posts[0].html, /<script/);
  assert.equal(page.posts[0].publishedAt, '2026-08-25T15:19:35.000Z');
  assert.match(page.posts[1].html, /href="https:\/\/rainonpiano.com\/"/);
  assert.deepEqual(page.posts[1].tags, ['摄影']);
  assert.throws(() => parseXPage(payload([tweet('20', { truncated: true })]), account), /INCOMPLETE_TEXT/);
});
test('X 账号身份不符和非公开内容不会被发布，过滤记录仍可推进历史游标', async () => {
  const wrong = tweet('20'); wrong.core.user_results.result = user('other', '456');
  assert.throws(() => parseXPage(payload([wrong]), account), /ACCOUNT_MISMATCH/);
  assert.throws(() => parseXPage({ ...payload([]), profile: { id: '123', screenName: account, protected: true } }, account), /INVALID_RESPONSE/);
  const hidden = tweet('20'); hidden.core.user_results.result.legacy.protected = true;
  const page = parseXPage(payload([hidden], 'older'), account);
  assert.equal(page.posts.length, 0); assert.deepEqual(page.observedIds, ['20']);
  const result = await collectPages({ fetchPage: async cursor => cursor ? parseXPage(payload([tweet('19')]), account) : page }, {}, async () => {}, 2);
  assert.equal(result.state.checkpoint, '20'); assert.equal(result.state.backfillComplete, true);
});
test('转推保留自己的转推 ID 与时间，标注原作者；原文的图片先缓存再发布', async () => {
  const original = tweet('10', { extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/example.jpg', ext_alt_text: '山水' }] } });
  original.core.user_results.result = user('photographer', '456');
  const repost = tweet('30', { retweeted_status_result: { result: original } });
  const page = parseXPage(payload([repost]), account);
  assert.equal(page.posts[0].externalId, '30'); assert.match(page.posts[0].text, /^转推 @photographer/);
  assert.match(page.posts[0].html, /https:\/\/x.com\/photographer/);
  assert.equal(page.posts[0].media[0].alt, '山水');
  let downloads = 0;
  const cachedUrl = '/media/moments/' + 'a'.repeat(64) + '.jpg';
  const [cached] = await cacheMomentImages(page.posts, { cache: async url => { assert.equal(url, 'https://pbs.twimg.com/media/example.jpg'); downloads++; return cachedUrl; } });
  assert.equal(downloads, 1); assert.ok(cached.html.includes(cachedUrl));
  assert.equal(normalizeMoment(cached).media[0].url, cachedUrl);
  assert.equal(imageSource('https://pbs.twimg.com/media/example.jpg?name=orig').hostname, 'pbs.twimg.com');
  for (const url of ['https://pbs.twimg.com.evil.test/x', 'https://evil.twimg.com/x', 'https://video.twimg.com/x.jpg']) assert.throws(() => imageSource(url), /INVALID_SOURCE/);
});
test('X 已验证的空末页可结束回溯；有内容的重复游标仍会失败', async () => {
  const latest = parseXPage(payload([tweet('30')], 'bottom'), account);
  const empty = parseXPage(payload([], 'bottom'), account, 'bottom');
  assert.equal(empty.nextCursor, undefined);
  const result = await collectPages({ fetchPage: async cursor => cursor ? empty : latest }, {}, async () => {}, 5);
  assert.equal(result.pages, 2); assert.equal(result.state.backfillComplete, true);
  const repeated = parseXPage(payload([tweet('20')], 'bottom'), account, 'bottom');
  await assert.rejects(() => collectPages({ fetchPage: async cursor => cursor ? repeated : latest }, {}, async () => {}, 5), /CURSOR_STALLED/);
});
