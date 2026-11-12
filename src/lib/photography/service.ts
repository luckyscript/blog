import type { APIContext } from 'astro';
import { AppError } from '../server/errors';
import { sessionUser } from '../server/auth';
import { bridgeHeaders } from './bridge.mjs';

const serviceOrigin = () => {
  const url = new URL(process.env.PHOTOGRAPHY_SERVICE_ORIGIN || 'http://127.0.0.1:3009');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('PHOTOGRAPHY_INVALID_SERVICE');
  return url.origin;
};
export async function photographyFetch(path: string, options: { request?: Request; admin?: boolean; method?: string } = {}) {
  if (!/^\/(?:api\/|media\/)/.test(path) || /[\r\n\\]/.test(path) || path.includes('..')) throw new AppError(400, '摄影请求不正确');
  const method = options.method || options.request?.method || 'GET';
  const headers = new Headers(bridgeHeaders(method, path, { secret: process.env.BLOG_PHOTOGRAPHY_BRIDGE_SECRET, admin: !!options.admin }));
  headers.set('host', '127.0.0.1:3009');
  for (const key of ['content-type', 'content-length', 'if-none-match']) {
    const value = options.request?.headers.get(key); if (value) headers.set(key, value);
  }
  const hasBody = !['GET', 'HEAD'].includes(method);
  if (Number(headers.get('content-length')) > 101 * 1024 * 1024) throw new AppError(413, '照片超过 100 MB');
  return fetch(serviceOrigin() + path, { method, headers, redirect: 'manual',
    ...(hasBody ? { body: options.request?.body, duplex: 'half' } : {}),
    signal: AbortSignal.any([AbortSignal.timeout(hasBody ? 300_000 : 90_000), ...(options.request ? [options.request.signal] : [])]),
  } as RequestInit);
}
export async function photographyData() {
  const response = await photographyFetch('/api/blog-site');
  if (!response.ok) throw new AppError(503, '摄影作品暂时无法读取，请稍后重试');
  return response.json();
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
export async function photographyApi(context: APIContext, admin: boolean) {
  try {
    if (admin && !context.locals.admin) throw new AppError(401, '请先登录');
    const path = context.params.path || '';
    if (admin && path === 'session') return json({ authenticated: true, configured: true, turnstile: { enabled: false } });
    if (!admin && !/^(?:photos(?:\/\d+)?|archive\/facets|collections(?:\/[a-z0-9-]+)?|equipment)$/.test(path)) throw new AppError(404, '摄影接口不存在');
    if (!admin && !['GET', 'HEAD'].includes(context.request.method)) throw new AppError(405, '请求方式不支持');
    const response = await photographyFetch(`/api/${admin ? 'admin/' : ''}${path}${context.url.search}`, { request: context.request, admin });
    const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    for (const key of ['content-type', 'content-length', 'content-disposition']) { const value = response.headers.get(key); if (value) headers.set(key, value); }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) { return json({ error: error instanceof AppError ? error.message : '摄影服务暂时无法连接，请稍后重试' }, error instanceof AppError ? error.status : 503); }
}
export async function photographyMedia(context: APIContext) {
  try {
    const name = context.params.name || '';
    if (!/^[a-f0-9]{64}-(?:640|1280|2560)-(?:webp|jpeg)$/.test(name) || [...context.url.searchParams.keys()].some(key => key !== 'v')) return new Response(null, { status: 404 });
    const user = await sessionUser(context);
    const response = await photographyFetch('/media/' + name + context.url.search, { request: context.request, admin: !!user });
    const revalidate = (response.ok || response.status === 304) && response.headers.get('cache-control') === 'private, no-cache';
    const headers = new Headers({ 'cache-control': revalidate ? 'private, no-cache' : 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' });
    for (const key of ['content-type', 'content-length', 'etag']) { const value = response.headers.get(key); if (value) headers.set(key, value); }
    return new Response(response.body, { status: response.status, headers });
  } catch { return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } }); }
}
