import { createHash, createHmac } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { momentMediaName, MOMENT_MEDIA_PREFIX } from './media-path';

export type R2Credential = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Uint8Array, value: string) => createHmac('sha256', key).update(value).digest();
const MAX_BYTES = 8 * 1024 * 1024;
export const ARTICLE_MEDIA_PREFIX = '/media/articles/';
export const articleMediaName = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif|pdf)$/;
type R2Options = { prefix?: typeof ARTICLE_MEDIA_PREFIX; maxBytes?: number };
export async function readR2Credential(file = process.env.MOMENTS_R2_CREDENTIAL_FILE): Promise<R2Credential | undefined> {
  if (!file) return;
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid?.()) throw new Error('MOMENTS_R2_INSECURE_CREDENTIAL');
  let value: any;
  try { value = JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('MOMENTS_R2_INVALID_CREDENTIAL'); }
  if (!value || typeof value !== 'object' || !/^[a-f0-9]{32}$/.test(value.accountId || '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value.bucket || '') ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.accessKeyId || '') || !/^[A-Za-z0-9/+_=-]{24,256}$/.test(value.secretAccessKey || '')) throw new Error('MOMENTS_R2_INVALID_CREDENTIAL');
  return value;
}

export async function verifyR2ImageResponse(response: Response, name: string, expectedLength: number, maxBytes = MAX_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('MOMENTS_R2_EMPTY');
  const hash = createHash('sha256'); let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length;
    if (size > maxBytes) throw new Error('MOMENTS_R2_TOO_LARGE'); hash.update(item.value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  if (size !== expectedLength || hash.digest('hex') !== name.split('.')[0]) throw new Error('MOMENTS_R2_HASH_MISMATCH');
}

/** S3 Signature V4. Object keys are exclusively content-addressed public images. */
export function signR2Request(credential: R2Credential, method: 'HEAD' | 'PUT' | 'GET', name: string, bytes?: Uint8Array, now = new Date(), options: R2Options = {}) {
  const prefix = options.prefix || MOMENT_MEDIA_PREFIX;
  if (prefix !== MOMENT_MEDIA_PREFIX && prefix !== ARTICLE_MEDIA_PREFIX || !(prefix === ARTICLE_MEDIA_PREFIX ? articleMediaName : momentMediaName).test(name)) throw new Error('MOMENTS_R2_INVALID_NAME');
  const url = new URL(`https://${credential.accountId}.r2.cloudflarestorage.com/${credential.bucket}${prefix}${name}`);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const bodyHash = digest(bytes || ''), scope = `${date}/auto/s3/aws4_request`;
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': bodyHash, 'x-amz-date': amzDate };
  if (method === 'PUT') {
    headers['content-type'] = name.endsWith('.pdf') ? 'application/pdf' : `image/${name.endsWith('.jpg') ? 'jpeg' : name.split('.').at(-1)}`;
    headers['cache-control'] = 'public, max-age=31536000, immutable';
    headers['x-amz-meta-sha256'] = name.split('.')[0];
  }
  const names = Object.keys(headers).sort(), signedHeaders = names.join(';');
  const canonical = [method, url.pathname, '', names.map(key => `${key}:${headers[key]}\n`).join(''), signedHeaders, bodyHash].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credential.secretAccessKey}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${digest(canonical)}`).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

export function r2ImageMirror(credential: R2Credential, fetcher: typeof fetch = fetch, options: R2Options = {}) {
  const ensured = new Set<string>();
  const maxBytes = options.maxBytes || MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) throw new Error('MOMENTS_R2_INVALID_LIMIT');
  async function request(method: 'HEAD' | 'GET' | 'PUT', name: string, bytes?: Uint8Array, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      const { url, headers } = signR2Request(credential, method, name, bytes, new Date(), options);
      try {
        const response = await fetcher(url, { method, headers, redirect: 'manual', body: method === 'PUT' ? bytes as BodyInit : undefined,
          signal: AbortSignal.any([AbortSignal.timeout(method === 'PUT' ? 300_000 : 45_000), ...(signal ? [signal] : [])]) });
        if (!response.ok && !(method === 'HEAD' && response.status === 404)) {
          await response.body?.cancel(); throw new Error(`MOMENTS_R2_HTTP_${response.status}`);
        }
        return response;
      } catch (error: any) {
        const transient = error.name === 'TypeError' || error.name === 'TimeoutError' || /^MOMENTS_R2_HTTP_(429|5\d\d)$/.test(error.message || '');
        if (signal?.aborted || !transient || attempt >= 3) throw error;
        await delay(1000 * 2 ** attempt, undefined, { signal });
      }
    }
  }
  async function verify(name: string, expected: Uint8Array, signal?: AbortSignal) {
    await verifyR2ImageResponse(await request('GET', name, undefined, signal), name, expected.length, maxBytes);
  }
  return {
    verify,
    async ensure(name: string, bytes: Uint8Array, signal?: AbortSignal) {
      if (!(options.prefix === ARTICLE_MEDIA_PREFIX ? articleMediaName : momentMediaName).test(name) || bytes.length > maxBytes || digest(bytes) !== name.split('.')[0]) throw new Error('MOMENTS_R2_INVALID_IMAGE');
      if (ensured.has(name)) return;
      const head = await request('HEAD', name, undefined, signal);
      if (head.status === 404) {
        await head.body?.cancel();
        const uploaded = await request('PUT', name, bytes, signal); await uploaded.body?.cancel();
        await verify(name, bytes, signal);
      } else {
        const valid = Number(head.headers.get('content-length')) === bytes.length && head.headers.get('x-amz-meta-sha256') === name.split('.')[0];
        await head.body?.cancel(); if (!valid) throw new Error('MOMENTS_R2_METADATA_MISMATCH');
      }
      ensured.add(name);
    },
  };
}
