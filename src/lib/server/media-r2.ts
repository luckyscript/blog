import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readR2Credential, r2ImageMirror, ARTICLE_MEDIA_PREFIX, articleMediaName } from '../moments/r2';
import { env } from './env';
import { AppError } from './errors';

export const articleMediaDirectory = () => resolve(env('ARTICLE_MEDIA_DIRECTORY', '.local/article-media'));
export function articleR2Configuration() {
  const origin = env('ARTICLE_MEDIA_PUBLIC_ORIGIN', env('MOMENTS_MEDIA_PUBLIC_ORIGIN'));
  if (origin) {
    let url: URL; try { url = new URL(origin); } catch { throw new AppError(503, '图片存储配置有误'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname)) throw new AppError(503, '图片存储配置有误');
  }
  return { provider: 'r2', label: 'Cloudflare R2', configured: Boolean(env('ARTICLE_R2_CREDENTIAL_FILE') && origin), publicOrigin: origin.replace(/\/$/, '') };
}
export async function uploadArticleToR2(bytes: Buffer, name: string, fetcher: typeof fetch = fetch) {
  const config = articleR2Configuration();
  if (!config.configured) throw new AppError(503, '图片上传暂不可用，已有图片仍可使用');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (!articleMediaName.test(name) || name.split('.')[0] !== checksum) throw new AppError(400, '文件内容校验失败');
  const credential = await readR2Credential(env('ARTICLE_R2_CREDENTIAL_FILE'));
  if (!credential) throw new AppError(503, '图片上传暂不可用，已有图片仍可使用');
  const directory = articleMediaDirectory(); await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `${name}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true }); await rename(temporary, join(directory, name)); }
  finally { await unlink(temporary).catch(() => {}); }
  const mirror = r2ImageMirror(credential, fetcher, { prefix: ARTICLE_MEDIA_PREFIX });
  await mirror.ensure(name, bytes);
  return { sha: checksum, url: config.publicOrigin + ARTICLE_MEDIA_PREFIX + name };
}
