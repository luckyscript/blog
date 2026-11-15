import { z } from 'zod';
import { isCachedMomentImage } from '../moments/media-path';
export const momentForm = z.object({
  text: z.string().max(20000),
  images: z.array(z.object({ url: z.string().max(2048).refine(value => { if (isCachedMomentImage(value)) return true; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }), alt: z.string().max(500).default('') })).max(9),
  publishedAt: z.string().datetime({ offset: true }),
  format: z.enum(['plain','markdown']).default('plain'),
});
export type MomentForm = z.infer<typeof momentForm>;
export function encodeMomentDraft(input: MomentForm, baseVersion: string | null, id?: string) {
  return JSON.stringify({ format: 1, input, baseVersion, ...(id ? { id } : {}), savedAt: new Date().toISOString() });
}
export function decodeMomentDraft(raw: string | null) {
  try {
    const value = JSON.parse(raw || 'null');
    if (value?.format !== 1) return null;
    return { input: momentForm.parse(value.input), baseVersion: typeof value.baseVersion === 'string' ? value.baseVersion : null, ...(z.string().uuid().safeParse(value.id).success ? { id: value.id as string } : {}) };
  } catch { return null; }
}
