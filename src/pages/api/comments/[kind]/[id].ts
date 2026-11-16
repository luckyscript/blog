import type { APIContext } from 'astro';
import { ZodError } from 'zod';
import { commentTarget } from '../../../../lib/comments/input';
import { publicComments, submitComment } from '../../../../lib/server/comments';
import { readSmallJson } from '../../../../lib/server/request-json';
import { AppError } from '../../../../lib/server/errors';
import { databaseConfigured } from '../../../../lib/server/env';

export const prerender = false;
export async function ALL(context: APIContext) {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  try {
    if (!databaseConfigured()) throw new AppError(503, '评论暂不可用');
    const target = commentTarget.parse({ kind: context.params.kind, id: context.params.id });
    if (context.request.method === 'GET') return json(await publicComments(target, Math.min(10000, Math.max(1, Math.floor(Number(context.url.searchParams.get('page')) || 1)))));
    if (context.request.method !== 'POST') throw new AppError(405, '不支持的请求方式');
    if (context.request.headers.get('origin') !== context.url.origin) throw new AppError(403, '请从本站页面提交评论');
    return json(await submitComment(context, target, await readSmallJson(context.request)), 201);
  } catch (error) {
    return json({ error: error instanceof ZodError ? error.issues[0]?.message || '请检查填写内容' : error instanceof AppError ? error.message : '评论服务暂不可用，请稍后重试' }, error instanceof ZodError ? 400 : error instanceof AppError ? error.status : 503);
  }
}
