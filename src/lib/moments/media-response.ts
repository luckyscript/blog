import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { momentMediaDirectory } from './media-cache';
import { momentMediaName } from './media-path';

/** Only saved content-addressed images are public; this endpoint never fetches a URL. */
export async function momentImageResponse(request: Request, name: string, directory = momentMediaDirectory()) {
  const missing = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!momentMediaName.test(name)) return missing();
  const path = join(directory, name);
  let file;
  try { file = await stat(path); }
  catch (error: any) { if (error.code === 'ENOENT') return missing(); throw error; }
  if (!file.isFile()) return missing();
  const etag = `"${name.split('.')[0]}"`;
  const headers = new Headers({
    'content-type': `image/${name.endsWith('.jpg') ? 'jpeg' : name.split('.').at(-1)}`,
    'cache-control': 'public, max-age=31536000, immutable', etag,
    'x-content-type-options': 'nosniff', 'content-length': String(file.size),
  });
  if (request.headers.get('if-none-match')?.split(',').map(s => s.trim().replace(/^W\//, '')).some(s => s === etag || s === '*')) {
    headers.delete('content-length'); return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(path)) as ReadableStream, { headers });
}
