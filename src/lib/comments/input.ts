import { z } from 'zod';

export const commentTarget = z.object({ kind: z.enum(['post', 'moment']), id: z.string().uuid() });
export type CommentTarget = z.infer<typeof commentTarget>;
export const commentBody = z.string().trim().min(1, '请填写评论内容').max(4000, '评论最多 4000 字');
export const commentInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, '请填写昵称').max(60, '昵称最多 60 字'),
  email: z.union([z.literal(''), z.string().email('邮箱格式不正确').max(254)]).default(''),
  body: commentBody,
  parentId: z.string().uuid().nullable().default(null),
  turnstileToken: z.string().max(2048),
  website: z.string().max(200).default(''),
});
export type PublicComment = { id: string; name: string; body: string; isAuthor: boolean; createdAt: string; parentId: string | null; replyTo: string | null };
export type CommentPage = { items: PublicComment[]; total: number; page: number; pages: number };
