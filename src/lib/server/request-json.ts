import { AppError } from './errors';

export async function readSmallJson(request: Request, max = 24000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415, '请使用 JSON 请求');
  if (Number(request.headers.get('content-length')) > max) throw new AppError(413, '提交内容过大');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, '请填写提交内容');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new AppError(413, '提交内容过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AppError(400, '提交格式不正确'); }
}
