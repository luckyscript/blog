import test from 'node:test';
import assert from 'node:assert/strict';
import { weiboWebAdapter, weiboWebRequest, parseWeiboPageConfig } from '../src/lib/moments/weibo-web';
import { collectPages } from '../src/lib/moments/plan';

const account='5351049607';
const post=(idstr:string,extra:any={})=>({idstr,user:{idstr:account},text_raw:'正文 #摄影#',created_at:'2026-11-01T01:00:00Z',...extra});
function request(pages:Record<string,any[]>,extra:Record<string,any>={}) {
  const calls:string[]=[];
  return {calls,run:async(path:string,params:Record<string,string>)=>{
    calls.push(path);
    if(path==='/')return {user:{idstr:account}};
    if(path==='/ajax/profile/info')return {user:{idstr:account}};
    if(path==='/ajax/statuses/mymblog')return {list:pages[params.page]};
    if(path in extra)return extra[path];
    throw Error('UNEXPECTED_REQUEST');
  }};
}
test('免费微博分页保留精确 ID，排除私密内容，置顶不改变同步检查点',async()=>{
  const mock=request({'1':[post('5330000000000001'),post('5000000000000001',{isTop:1})],
    '2':[post('5320000000000001',{visible:{type:1}}),post('5310000000000001')],'3':[]});
  const saved:string[]=[];
  const result=await collectPages(weiboWebAdapter(account,{request:mock.run}),{},async posts=>{saved.push(...posts.map(p=>p.externalId));},5);
  assert.equal(result.state.checkpoint,'5330000000000001');assert(result.state.backfillComplete);
  assert(saved.includes('5310000000000001'));assert(!saved.includes('5320000000000001'));
  assert(mock.calls.every(path=>path==='/'||path.startsWith('/ajax/')));
});
test('网页登录态与目标账号不符立即停止，无法将另一账号内容混入',async()=>{
  const adapter=weiboWebAdapter(account,{request:async()=>({uid:'1562002727'})});
  await assert.rejects(()=>adapter.fetchPage(),/ACCOUNT_MISMATCH/);
  assert.throws(()=>weiboWebAdapter('9999999'),/INVALID_ACCOUNT/);
});
test('从首页读取实际登录配置，不执行页面脚本，缺失身份应要求登录',async()=>{
  const config={user:{idstr:account,screen_name:'括号 } 与引号 " 测试'},uid:account};
  assert.deepEqual(parseWeiboPageConfig(`<script>window.$CONFIG = ${JSON.stringify(config)}; alert('never execute')</script>`),config);
  assert.throws(()=>parseWeiboPageConfig('<script>window.$CONFIG = { user: runCode() };</script>'),/INVALID_RESPONSE/);
  assert.throws(()=>parseWeiboPageConfig('<html>登录</html>'),/AUTH_REQUIRED/);
  await assert.rejects(()=>weiboWebAdapter(account,{request:async()=>({})}).fetchPage(),/AUTH_REQUIRED/);
});
test('补齐 PC 图片元数据和长文；转载中的照片也保留',async()=>{
  const status=post('5330000000000001',{isLongText:true,pic_num:2,pic_ids:['one','two'],pic_infos:{one:{large:{url:'https://wx1.sinaimg.cn/large/one.jpg'}},two:{original:{url:'https://wx2.sinaimg.cn/large/two.jpg'}}},retweeted_status:post('5000000000000001',{user:{idstr:'1562002727'},pics:[{large:{url:'https://wx3.sinaimg.cn/large/three.jpg'}}]})});
  const mock=request({'1':[status]},{'/ajax/statuses/longtext':{longTextContent:'<p>完整的长文</p>'}});
  const page=await weiboWebAdapter(account,{request:mock.run}).fetchPage();
  assert.match(page.posts[0].text,/完整的长文/);assert.equal(page.posts[0].media.length,2);
  assert.match(page.posts[0].html,/three.jpg/);assert(mock.calls.includes('/ajax/statuses/longtext'));
});
test('快转按本账号的真实转发 ID 和时间保存，保留原作者内容',async()=>{
  const original=post('5000000000000001',{user:{idstr:'1733388114'},ori_uid:Number(account),ori_mid:'5330000000000001'});
  const repost=post('5330000000000001',{text_raw:'转发微博',retweeted_status:{...original,ori_uid:undefined,ori_mid:undefined}});
  const mock=request({'1':[original]},{'/ajax/statuses/show':repost});
  const page=await weiboWebAdapter(account,{request:mock.run}).fetchPage();
  assert.equal(page.posts[0].externalId,repost.idstr);assert.deepEqual(page.observedIds,[repost.idstr]);
  assert.match(page.posts[0].html,/1733388114/);assert(mock.calls.includes('/ajax/statuses/show'));
  const wrong=request({'1':[original]},{'/ajax/statuses/show':{...repost,user:{idstr:'1733388114'}}});
  await assert.rejects(()=>weiboWebAdapter(account,{request:wrong.run}).fetchPage(),/ACCOUNT_MISMATCH/);
});
test('失效原文保留本人转发文字和来源提示，未知缺失作者仍应报错',async()=>{
  const notice='抱歉，根据作者设置的微博可见时间范围，此微博已不可见。';
  const raw=post('5330000000000001',{text_raw:'当时的转发评论',retweeted_status:{idstr:'5000000000000001',user:null,text_raw:notice,visible:{type:0}}});
  const mock=request({'1':[raw]});
  const page=await weiboWebAdapter(account,{request:mock.run}).fetchPage();
  assert.match(page.posts[0].text,/当时的转发评论/);assert.match(page.posts[0].html,/此微博已不可见/);
  assert.match(page.posts[0].html,/https:\/\/weibo.com\/detail\/5000000000000001/);
  const restricted=request({'1':[post('5330000000000001',{retweeted_status:{idstr:'5000000000000001',user:null,text_raw:'private-secret',visible:{type:1}}})]});
  const privatePage=await weiboWebAdapter(account,{request:restricted.run}).fetchPage();
  assert.doesNotMatch(privatePage.posts[0].html,/private-secret/);assert.match(privatePage.posts[0].html,/原微博当前不可见/);
  const unknown=request({'1':[post('5330000000000001',{retweeted_status:{idstr:'5000000000000001',user:null,text_raw:'未知结构'}})]});
  await assert.rejects(()=>weiboWebAdapter(account,{request:unknown.run}).fetchPage(),/INVALID_ID/);
});
test('图片缺失、长文缺失和重复分页必须失败，不伪装为空历史',async()=>{
  const incomplete=post('5330000000000001',{pic_num:2,pics:[{large:{url:'https://wx1.sinaimg.cn/large/one.jpg'}}]});
  const mock=request({'1':[incomplete]},{'/ajax/statuses/show':incomplete});
  await assert.rejects(()=>weiboWebAdapter(account,{request:mock.run}).fetchPage(),/IMAGES_INCOMPLETE/);
  const long=request({'1':[post('5330000000000001',{isLongText:true})]},{'/ajax/statuses/longtext':{}});
  await assert.rejects(()=>weiboWebAdapter(account,{request:long.run}).fetchPage(),/LONG_TEXT_REQUIRED/);
  const repeated=request({'1':[post('5330000000000001')],'2':[post('5330000000000001')]});
  const adapter=weiboWebAdapter(account,{request:repeated.run});await adapter.fetchPage();
  await assert.rejects(()=>adapter.fetchPage('web:2'),/CURSOR_IGNORED/);
  await assert.rejects(()=>adapter.fetchPage('5330000000000001'),/INVALID_CURSOR/);
});
test('网页读取只访问固定免费来源；登录墙与上游原始错误不会泄露',async()=>{
  let calls=0;
  const run=weiboWebRequest({account,cookies:{SUB:'test-session'}},async(url,options)=>{
    calls++;assert.equal(new URL(String(url)).origin,'https://weibo.com');assert.equal(options?.redirect,'manual');
    return new Response(JSON.stringify({ok:0,msg:'请先登录 secret-debug-message'}),{headers:{'content-type':'application/json'}});
  });
  await assert.rejects(()=>run('/ajax/statuses/mymblog',{uid:account,page:'1'}),/^Error: WEIBO_AUTH_REQUIRED$/);
  await assert.rejects(()=>run('https://evil.test',{}),/INVALID_REQUEST/);assert.equal(calls,1);
});
