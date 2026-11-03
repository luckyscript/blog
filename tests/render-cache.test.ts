import test from 'node:test';
import assert from 'node:assert/strict';
import Markdoc from '@markdoc/markdoc';
import { renderedBody } from '../src/lib/markdoc/render-cache';
import { renderHtml } from '../src/lib/markdoc/render';
import { adaptInput } from '../src/lib/server/public-content';
import type { PostInput } from '../src/lib/server/content-input';

test('重复渲染保留 Markdoc 类型，调用方修改不会污染后续请求或摘要', async () => {
  const markdown = '# 独立内容\n\n正文\n\n<!--more-->\n\n后半段';
  const [first, concurrent] = await Promise.all([renderedBody(markdown),renderedBody(markdown)]);
  assert.ok(first.content instanceof Markdoc.Tag);
  assert.equal(first.html,concurrent.html);
  assert.notEqual(first.content,concurrent.content);
  first.content.children.length = 0;
  const again=await renderedBody(markdown);
  assert.match(renderHtml(again.content),/独立内容/);
  assert.doesNotMatch(renderHtml(again.brief),/后半段/);
  const noExcerpt=await renderedBody('# 相同摘要');
  assert.notEqual(noExcerpt.content,noExcerpt.brief);
});

test('正文修改立即使用新编译结果，元信息始终使用当前输入', async () => {
  const input={slug:'sample',title:'旧标题',section:'blog',year:'2026',markdown:'旧正文',description:'',category:'',tags:[],publishedAt:'2026-08-01T00:00:00Z',contentUpdatedAt:null,externalUrl:'',coverUrl:'',canonicalUrl:'',featured:false,metadata:{}} as PostInput;
  const before=await adaptInput(input);
  const changed=await adaptInput({...input,title:'新标题',tags:['新标签']});
  assert.equal(before.frontmatter.title,'旧标题');assert.equal(changed.frontmatter.title,'新标题');assert.deepEqual(changed.frontmatter.tags,['新标签']);
  const after=await adaptInput({...input,markdown:'新正文'});
  assert.match(after.html,/新正文/);assert.doesNotMatch(after.html,/旧正文/);
});

test('缓存保留安全过滤和图片延迟加载，失败的 Markdown 不会污染下次编译', async () => {
  const markdown='![照片](https://example.com/photo.jpg)\n\n[链接](javascript:alert)';
  const body=await renderedBody(markdown);
  assert.match(body.html,/loading="lazy"/);assert.match(body.html,/decoding="async"/);assert.doesNotMatch(body.html,/href=["']javascript:/);
  await assert.rejects(()=>renderedBody('{% invalid_cache_test /%}'));
  await assert.rejects(()=>renderedBody('{% invalid_cache_test /%}'));
});
