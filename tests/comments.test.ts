import test from 'node:test';
import assert from 'node:assert/strict';
import { commentInput } from '../src/lib/comments/input';
import { readSmallJson } from '../src/lib/server/request-json';

test('评论输入保留纯文本、允许不填邮箱，并拒绝空白、损坏和超长内容', () => {
  const input = { id: '00000000-0000-4000-8000-000000000001', name: '  读者  ', body: '<script>只是文字</script>', turnstileToken: 'token' };
  const parsed = commentInput.parse(input);
  assert.equal(parsed.name, '读者'); assert.equal(parsed.email, ''); assert.equal(parsed.body, input.body);
  for (const change of [{ id: 'bad' }, { name: ' ' }, { body: ' ' }, { body: '字'.repeat(4001) }, { email: 'invalid' }, { parentId: 'bad' }]) assert(!commentInput.safeParse({ ...input, ...change }).success);
});

test('公开评论 JSON 读取限制流式请求大小并报告格式错误', async () => {
  const request = (body: string, type = 'application/json') => new Request('https://blog.example.test', { method: 'POST', headers: { 'content-type': type }, body });
  assert.deepEqual(await readSmallJson(request('{"body":"评论"}')), { body: '评论' });
  for (const [req, status] of [[request('x'.repeat(25000)), 413], [request('{'), 400], [request('{}', 'text/plain'), 415]] as const) await assert.rejects(readSmallJson(req), (error: any) => error.status === status);
});
