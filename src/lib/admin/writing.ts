import { z } from 'zod';
import { postDraftInput, type PostInput } from '../server/content-input';

/** A paragraph is a run of nonblank lines; positions use the editor's UTF-16 offsets. */
export function paragraphRange(text: string, position: number) {
  position = Math.max(0, Math.min(text.length, position));
  let from = position === 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1;
  let to = text.indexOf('\n', position);
  if (to < 0) to = text.length;
  if (!text.slice(from, to).trim()) return { from, to };
  while (from > 0) {
    const previous = text.lastIndexOf('\n', from - 2) + 1;
    if (!text.slice(previous, from - 1).trim()) break;
    from = previous;
  }
  while (to < text.length) {
    const end = text.indexOf('\n', to + 1);
    const next = end < 0 ? text.length : end;
    if (!text.slice(to + 1, next).trim()) break;
    to = next;
  }
  return { from, to };
}

export function writingWords(markdown: string) {
  const text = markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '');
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}])+/gu) || []).length;
}

export type LocalDraft = { input: PostInput; baseVersion: number | null; savedAt: string; id?: string };
export function encodeDraft(input: PostInput, baseVersion: number | null, id?: string) {
  return JSON.stringify({ format: 1, input, baseVersion, id, savedAt: new Date().toISOString() });
}
export function decodeDraft(raw: string | null): LocalDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const input = postDraftInput.parse(value.format === 1 ? value.input : value);
    return { input, baseVersion: Number.isInteger(value.baseVersion) ? value.baseVersion : null, savedAt: typeof value.savedAt === 'string' ? value.savedAt : '', ...(z.string().uuid().safeParse(value.id).success ? { id: value.id } : {}) };
  } catch { return null; }
}
