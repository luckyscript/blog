import type { APIRoute } from 'astro';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { articleMediaName } from '../../../lib/moments/r2';
import { articleMediaDirectory } from '../../../lib/server/media-r2';
export const prerender = false;
export const GET: APIRoute = async ({ request, params }) => {
  const name = params.name || '';
  if (!articleMediaName.test(name)) return new Response(null, { status: 404 });
  const path = join(articleMediaDirectory(), name);
  let file; try { file = await stat(path); } catch (error: any) { if (error.code === 'ENOENT') return new Response(null, { status: 404 }); throw error; }
  if (!file.isFile()) return new Response(null, { status: 404 });
  const etag = `"${name.split('.')[0]}"`;
  const headers = new Headers({ 'content-type': name.endsWith('.pdf') ? 'application/pdf' : `image/${name.endsWith('.jpg') ? 'jpeg' : name.split('.').at(-1)}`,
    'content-length': String(file.size), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', etag });
  if (request.headers.get('if-none-match') === etag) { headers.delete('content-length'); return new Response(null, { status: 304, headers }); }
  return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
};
export const HEAD = GET;
