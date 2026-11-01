import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyData } from '../src/data/legacyMoments.js';
import { normalizeMoment } from '../src/lib/moments/content';
import { parseWeiboArchive } from '../src/lib/moments/weibo-archive';
import { parseWeiboStatus, parseWeiboTimeline, weiboAdapter, weiboIdToMid, weiboMidToId, weiboRequest } from '../src/lib/moments/weibo';
import { syncError } from '../src/lib/moments/store';
import { collectPages } from '../src/lib/moments/plan';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { credentialPath, saveWeiboCredential, weiboToken } from '../src/lib/moments/weibo-auth';

const account = '5351049607';
const status = (id = '4900000000000012') => ({ idstr: id, user: { idstr: account }, created_at: 'Mon Jul 15 20:35:05 +0800 2024', text_raw: 'hello #生活#\n第二行', visible: { type: 0 } });
test('微博 ID 保留 64 位精度和 base62 大小写，存档原链接可以无损往返', () => {
  for (const mid of ['OnEFv4xf1','CnU6V5Jkh','O1UZPgpF6']) assert.equal(weiboIdToMid(weiboMidToId(mid)), mid);
  assert.notEqual(weiboMidToId('CnU6V5Jkh'), weiboMidToId('CnU6V5JkH'));
  for (const id of ['1','10000000','9007199254740993','12345678901234567890']) assert.equal(weiboMidToId(weiboIdToMid(id)), id);
  assert.throws(() => parseWeiboStatus({ ...status(), idstr: undefined, id: 9007199254740993 }, account), /INVALID_ID/);
});
test('微博内容保留图片、长文、转发和发布时间，拒绝错账号与非公开内容', () => {
  const p = parseWeiboStatus({ ...status(), pics: [{ large: { url: 'http://wx1.sinaimg.cn/pic.jpg' } }] }, account)!;
  assert.equal(p.publishedAt, '2024-07-15T12:35:05.000Z'); assert.match(p.html, /<br\s*\/?>/); assert.equal(p.media[0].url, 'https://wx1.sinaimg.cn/pic.jpg');
  assert.deepEqual(p.tags,['生活']); assert.throws(() => parseWeiboStatus(status(), '1562002727'), /ACCOUNT_MISMATCH/);
  assert.equal(parseWeiboStatus({ ...status(), visible: { type: 1 } }, account), null);
  assert.equal(parseWeiboStatus({ ...status(), deleted: '1' }, account), null);
  assert.throws(() => parseWeiboStatus({ ...status(), isLongText: true }, account), /LONG_TEXT_REQUIRED/);
  const long = parseWeiboStatus({ ...status(), isLongText: true, longText: { longTextContent: '<p>完整长文</p><script>bad()</script><img src="https://example.com/a" onerror="bad()">' } }, account)!;
  assert.match(long.text,/完整长文/); assert.doesNotMatch(long.html, /script|onerror/);
  const retweet = parseWeiboStatus({ ...status(), retweeted_status: { ...status('4800000000000001'), user: { idstr: '1111681197' }, text_raw: '转发内容' } }, account)!;
  assert.match(retweet.html, /blockquote/); assert.match(retweet.text, /转发内容/);
});
test('微博分页使用精确 max_id，非公开内容不阻断历史游标，接口失败不伪装空页', () => {
  const first = parseWeiboTimeline({ result: { statuses: [status(), { ...status('4900000000000010'), visible: { type: 1 } }] } }, account);
  assert.equal(first.posts.length, 1); assert.equal(first.nextCursor, '4900000000000009');
  assert.deepEqual(parseWeiboTimeline({ result: { statuses: [] } }, account), { posts: [], observedIds: [], nextCursor: undefined });
  assert.throws(() => parseWeiboTimeline({ error: { message: 'secret' } }, account), /API_REJECTED/);
  assert.throws(() => parseWeiboTimeline({result:{error:'quota',statuses:[]}}, account), /API_REJECTED/);
  assert.throws(() => parseWeiboTimeline({}, account), /INVALID_RESPONSE/);
  assert.throws(() => parseWeiboTimeline({ result: { statuses: [status()] } }, account, '4900000000000010'), /CURSOR_IGNORED/);
  const pinned = parseWeiboTimeline({result:{statuses:[status(), {...status('4500000000000001'),isTop:true}]}},account);
  assert.equal(pinned.nextCursor,'4900000000000011');
});
test('最新一页全为私密内容时仍能断点补抓公开历史', async () => {
  const adapter={fetchPage: async (cursor?: string) => cursor ? {posts:[],observedIds:[cursor],nextCursor: String(BigInt(cursor)-2n)} : {posts:[],observedIds:['100','99'],nextCursor:'98'}};
  const first=await collectPages(adapter,{},async()=>{},2);
  assert.equal(first.state.checkpoint,'100'); assert.equal(first.state.backfillCursor,'96');
  const second=await collectPages(adapter,first.state,async()=>{},2);
  assert.equal(second.state.backfillCursor,'94');
});
test('微博适配器只调用官方只读命令并校验元数据，每次最多一页，不泄露上游错误', async () => {
  const calls: any[] = [];
  const request = async (path: string, token: string | undefined, body?: any) => {
    calls.push({path,token,body});
    if (path.includes('/commands/')) return {command:{flags:['max_id','count','isGetLongText'].map(name=>({name}))}};
    return {result:{statuses:[status(body.args.max_id || undefined)]}};
  };
  const adapter = weiboAdapter(account, async () => 'private-test-token', request);
  const first = await adapter.fetchPage(); await adapter.fetchPage(first.nextCursor);
  assert.equal(calls.length,3); assert.equal(calls[1].body.action,'user_timeline/biz'); assert.equal(calls[1].body.args.isGetLongText,'1');
  assert.equal(calls[2].body.args.max_id,first.nextCursor);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":"private-test-token"}', { status: 401 });
    await assert.rejects(()=>weiboRequest('/cli/invoke','private-test-token',{}),/^Error: WEIBO_AUTH_REQUIRED$/);
    assert.equal(syncError(new Error('WEIBO_AUTH_REQUIRED')), 'WEIBO_AUTH_REQUIRED');
  } finally { globalThis.fetch = originalFetch; }
});
test('微博历史只导入有明确页脚的 451 条记录，不把普通卡片或正文引用认作来源', () => {
  const result = parseWeiboArchive(legacyData); assert.equal(result.posts.length,451); assert.equal(result.skipped,34);
  assert.equal(new Set(result.posts.map(p=>p.externalId)).size,451); result.posts.forEach(normalizeMoment);
  assert.doesNotMatch(result.posts[0].html,/来源于个人weibo/);
  assert.equal(parseWeiboArchive([{html:'<p><a href="https://m.weibo.cn/status/CnU6V5Jkh">正文引用</a></p>'}]).posts.length,0);
});
test('两个账号的授权文件相互隔离，刷新令牌轮换后以私有权限保存', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'rain-weibo-'));
  const previous = process.env.MOMENTS_WEIBO_CREDENTIAL_DIRECTORY, originalFetch = globalThis.fetch;
  process.env.MOMENTS_WEIBO_CREDENTIAL_DIRECTORY = directory;
  try {
    await assert.rejects(()=>weiboToken(account), /AUTH_REQUIRED/);
    await saveWeiboCredential(account,{access_token:'old-access',refresh_token:'old-refresh',expires_in:1});
    await saveWeiboCredential('1562002727',{access_token:'other-access',expires_in:3600});
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url),'https://open.weibo.com/cli/api/oauth/token');
      assert.equal(JSON.parse(String(init?.body)).refresh_token,'old-refresh');
      return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
    };
    assert.equal(await weiboToken(account),'new-access');
    assert.equal((await stat(credentialPath(account))).mode & 0o077,0);
    assert.equal(JSON.parse(await readFile(credentialPath(account),'utf8')).refreshToken,'new-refresh');
    assert.equal(await weiboToken('1562002727'),'other-access');
  } finally {
    globalThis.fetch=originalFetch;
    if(previous===undefined)delete process.env.MOMENTS_WEIBO_CREDENTIAL_DIRECTORY;else process.env.MOMENTS_WEIBO_CREDENTIAL_DIRECTORY=previous;
    await rm(directory,{recursive:true,force:true});
  }
});
