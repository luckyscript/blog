import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramPage, telegramAdapter } from '../src/lib/moments/telegram';
import { normalizeMoment } from '../src/lib/moments/content';
import { collectPages } from '../src/lib/moments/plan';
import type { MomentAdapter, MomentInput, SyncState } from '../src/lib/moments/types';

const post = (externalId: string): MomentInput => ({externalId, sourceUrl:`https://t.me/test_blog/${externalId}`, title:'标题',text:'正文',html:'<p>正文</p>',publishedAt:'2026-08-01T10:00:00Z',tags:[],media:[]});
test('Telegram 解析文字、时间和媒体，按原始 ID 排序并移除脚本与事件属性', () => {
  const html=`<div class="tgme_channel_history">
    <div class="tgme_widget_message" data-post="test_blog/10"><a><time datetime="2026-08-01T10:00:00Z"></time></a><div class="tgme_widget_message_text">你好<br>第二行 #生活 <a onclick="steal()" href="javascript:alert(1)">危险链接</a><script>steal()</script></div><a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.cdn-telegram.org/photo.jpg')"></a></div>
    <div class="tgme_widget_message" data-post="test_blog/11"><time datetime="2026-08-02T10:00:00Z"></time><video src="https://cdn4.cdn-telegram.org/video.mp4"></video></div>
    <div class="tgme_widget_message service_message" data-post="test_blog/9"></div>
    <div class="tgme_widget_message" data-post="other_blog/12"><time datetime="2026-08-02T10:00:00Z"></time><div class="tgme_widget_message_text">别人的内容</div></div>
  </div>`;
  const result = parseTelegramPage(html,'test_blog');
  assert.deepEqual(result.posts.map(p=>p.externalId),['11','10']); assert.equal(result.nextCursor,'9');
  assert.match(result.posts[1].text,/你好\n第二行/); assert.deepEqual(result.posts[1].tags,['生活']);
  assert.equal(result.posts[1].media[0].url,'https://cdn4.cdn-telegram.org/photo.jpg');
  assert.equal(result.posts[0].media[0].type,'video');
  assert.doesNotMatch(result.posts[1].html,/<script|onclick|javascript:/);
  assert.throws(()=>parseTelegramPage('<html>登录墙</html>','test_blog'),/TELEGRAM_INVALID_PAGE/);
  assert.throws(()=>telegramAdapter('../escape'),/INVALID_ACCOUNT/);
});
test('统一格式校验拒绝危险来源，内容指纹稳定且编辑会改变指纹', () => {
  assert.equal(normalizeMoment(post('10')).hash,normalizeMoment(post('10')).hash);
  assert.notEqual(normalizeMoment(post('10')).hash,normalizeMoment({...post('10'),text:'修改'}).hash);
  assert.throws(()=>normalizeMoment({...post('10'),sourceUrl:'javascript:alert(1)'}));
  const value=normalizeMoment({...post('10'),html:'<img src="https://example.com/x" onerror="alert(1)"><iframe src="https://example.com"></iframe>'});
  assert.doesNotMatch(value.html,/onerror|iframe/);
});
test('历史补抓有页数上限，重启后从已保存游标继续', async () => {
  const pages:Record<string,any>={latest:{posts:[post('8'),post('7')],nextCursor:'7'},7:{posts:[post('6'),post('5')],nextCursor:'5'},5:{posts:[post('4')],nextCursor:undefined}};
  const adapter:MomentAdapter={fetchPage:async cursor=>pages[cursor||'latest']};
  const saved:string[]=[];const save=async(posts:MomentInput[])=>{saved.push(...posts.map(p=>p.externalId));};
  const first=await collectPages(adapter,{},save,2);assert.equal(first.state.backfillCursor,'5');assert.equal(first.pages,2);
  const next=await collectPages(adapter,first.state,save,2);assert.equal(next.state.backfillComplete,true);assert.ok(saved.includes('4'));
});
test('离线期间新增超过一页时继续补缺口，不因更新检查点而漏掉中间内容', async () => {
  const pages:Record<string,any>={latest:{posts:[post('20'),post('19')],nextCursor:'19'},19:{posts:[post('18'),post('17')],nextCursor:'17'},17:{posts:[post('16'),post('15')],nextCursor:'15'},15:{posts:[post('14'),post('10')],nextCursor:'10'}};
  const adapter:MomentAdapter={fetchPage:async cursor=>pages[cursor||'latest']};
  const saved=new Set<string>();const save=async(posts:MomentInput[])=>{posts.forEach(p=>saved.add(p.externalId));};
  let state:SyncState={checkpoint:'10',backfillComplete:true};
  for(let i=0;i<3;i++) state=(await collectPages(adapter,state,save,2)).state;
  assert.equal(state.checkpoint,'20');assert.equal(state.catchupTarget,undefined);
  for(const id of ['20','19','18','17','16','15','14','10']) assert.ok(saved.has(id),id);
});
test('抓取失败或游标停滞不会推进同步位置', async () => {
  const state:SyncState={checkpoint:'10',backfillCursor:'5'};
  const adapter:MomentAdapter={fetchPage:async cursor=>cursor?{posts:[post('4')],nextCursor:cursor}:{posts:[post('10')],nextCursor:'9'}};
  await assert.rejects(()=>collectPages(adapter,state,async()=>{},3),/CURSOR_STALLED/);
  assert.deepEqual(state,{checkpoint:'10',backfillCursor:'5'});
});
