import { z } from 'zod';
const momentForm = z.object({
  text: z.string().max(20000),
  images: z.array(z.object({ url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }), alt: z.string().max(500) })).max(9),
  publishedAt: z.string().datetime({ offset: true }),
  format: z.enum(['plain','markdown']).default('plain'),
});
export type MomentForm = z.infer<typeof momentForm>;
export function encodeMomentDraft(input: MomentForm, baseVersion: string | null) {
  return JSON.stringify({ format: 1, input, baseVersion, savedAt: new Date().toISOString() });
}
export function decodeMomentDraft(raw: string | null) {
  try {
    const value = JSON.parse(raw || 'null');
    if (value?.format !== 1) return null;
    return { input: momentForm.parse(value.input), baseVersion: typeof value.baseVersion === 'string' ? value.baseVersion : null };
  } catch { return null; }
}
