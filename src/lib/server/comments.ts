import type { APIContext } from 'astro';
import { createHmac, randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { db } from '../../db';
import { comments, commentLimits, posts, moments, momentSources, momentDuplicates } from '../../db/schema';
import { type CommentTarget, type CommentPage, commentInput, commentBody } from '../comments/input';
import { AppError } from './errors';
import { env } from './env';
import { verifyTurnstile } from './turnstile';

type Store = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Store['transaction']>[0]>[0];
type QueryStore = Store | Tx;
const targetWhere = (target: CommentTarget) => target.kind === 'post' ? eq(comments.postId, target.id) : eq(comments.momentId, target.id);
const targetOf = (row: typeof comments.$inferSelect): CommentTarget => row.postId ? { kind: 'post', id: row.postId } : { kind: 'moment', id: row.momentId! };
const parent = alias(comments, 'comment_parent');

export async function visibleCommentTarget(target: CommentTarget, store: QueryStore = db()) {
  if (target.kind === 'post') {
    const [row] = await store.select({ id: posts.id, path: posts.path, title: posts.title }).from(posts)
      .where(and(eq(posts.id, target.id), eq(posts.status, 'published'), lte(posts.publishedAt, new Date())));
    if (row) return row;
  } else {
    const [row] = await store.select({ id: moments.id, title: moments.title }).from(moments)
      .innerJoin(momentSources, eq(momentSources.id, moments.sourceId)).leftJoin(momentDuplicates, eq(momentDuplicates.momentId, moments.id))
      .where(and(eq(moments.id, target.id), eq(moments.status, 'published'), eq(momentSources.enabled, true), lte(moments.publishedAt, new Date()), isNull(momentDuplicates.momentId)));
    if (row) return { ...row, path: `/moments/posts/${row.id}` };
  }
  throw new AppError(404, '内容不存在或尚未公开');
}

export async function commentTargetForPath(path: string): Promise<CommentTarget | null> {
  const [row] = await db().select({ id: posts.id }).from(posts)
    .where(and(eq(posts.path, path.replace(/\/$/, '')), eq(posts.status, 'published'), lte(posts.publishedAt, new Date())));
  return row ? { kind: 'post', id: row.id } : null;
}

export async function publicComments(target: CommentTarget, page = 1): Promise<CommentPage> {
  await visibleCommentTarget(target);
  const where = and(targetWhere(target), eq(comments.status, 'approved'), or(isNull(comments.parentId), eq(parent.status, 'approved')));
  const rows = await db().select({ id: comments.id, name: comments.name, body: comments.body, authorId: comments.authorId, createdAt: comments.createdAt, parentId: comments.parentId, replyTo: parent.name })
    .from(comments).leftJoin(parent, eq(parent.id, comments.parentId)).where(where)
    .orderBy(asc(comments.createdAt), asc(comments.id)).limit(20).offset((page - 1) * 20);
  const [total] = await db().select({ value: count() }).from(comments).leftJoin(parent, eq(parent.id, comments.parentId)).where(where);
  return { items: rows.map(({ authorId, createdAt, ...row }) => ({ ...row, isAuthor: Boolean(authorId), createdAt: createdAt.toISOString() })), total: Number(total.value), page, pages: Math.max(1, Math.ceil(Number(total.value) / 20)) };
}

const rateSecret = randomBytes(32).toString('hex');
export async function limitCommentSubmission(context: APIContext) {
  let address = 'unknown';
  try { address = context.clientAddress; } catch {}
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) address = context.request.headers.get('x-real-ip') || address;
  const key = createHmac('sha256', env('TURNSTILE_SECRET_KEY') || rateSecret).update('comment:' + address).digest('hex');
  const now = new Date(), resetsAt = new Date(now.getTime() + 10 * 60000);
  await db().delete(commentLimits).where(lte(commentLimits.resetsAt, now));
  await db().transaction(async tx => {
    await tx.insert(commentLimits).values({ key, attempts: 1, resetsAt }).onDuplicateKeyUpdate({ set: { attempts: sql`${commentLimits.attempts} + 1` } });
    const [limit] = await tx.select().from(commentLimits).where(eq(commentLimits.key, key));
    // Commit rejected attempts too, rather than rolling back the throttle.
    return limit.attempts;
  }).then(attempts => { if (attempts > 10) throw new AppError(429, '评论提交过于频繁，请十分钟后再试'); });
}

async function checkParent(tx: Tx, target: CommentTarget, parentId: string | null) {
  if (!parentId) return;
  const [row] = await tx.select().from(comments).where(eq(comments.id, parentId)).for('update');
  if (!row || row.status !== 'approved' || row.parentId || targetOf(row).kind !== target.kind || targetOf(row).id !== target.id)
    throw new AppError(400, '只能回复当前内容下已公开的评论');
}

async function insertComment(tx: Tx, target: CommentTarget, input: { id: string; name: string; email: string; body: string; parentId: string | null }, authorId: string | null) {
  await visibleCommentTarget(target, tx);
  await checkParent(tx, target, input.parentId);
  const now = new Date();
  await tx.insert(comments).values({ ...input, postId: target.kind === 'post' ? target.id : null, momentId: target.kind === 'moment' ? target.id : null, authorId, status: authorId ? 'approved' : 'pending', version: 1, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { id: sql`${comments.id}` } });
  const [row] = await tx.select().from(comments).where(eq(comments.id, input.id)).for('update');
  if (targetOf(row).kind !== target.kind || targetOf(row).id !== target.id || row.name !== input.name || row.email !== input.email || row.body !== input.body || row.parentId !== input.parentId || row.authorId !== authorId)
    throw new AppError(409, '这次提交已发生变化，请重新提交');
  // No private comment content or contact details leave the submission endpoint.
  return { id: row.id, status: row.status };
}

export async function submitComment(context: APIContext, target: CommentTarget, value: unknown) {
  const input = commentInput.parse(value);
  if (input.website) throw new AppError(400, '评论未能提交，请重试');
  await visibleCommentTarget(target);
  await limitCommentSubmission(context);
  await verifyTurnstile(input.turnstileToken, context.url.hostname, { action: 'comment-submit' });
  return db().transaction(tx => insertComment(tx, target, { id: input.id, name: input.name, email: input.email, body: input.body, parentId: input.parentId }, null));
}

export async function listComments(status = 'pending', kind = '', page = 1) {
  const conditions = [status ? eq(comments.status, status as 'pending' | 'approved' | 'trash') : undefined, kind === 'post' ? sql`${comments.postId} IS NOT NULL` : kind === 'moment' ? sql`${comments.momentId} IS NOT NULL` : undefined];
  const where = and(...conditions);
  const rows = await db().select({ comment: comments, postTitle: posts.title, postPath: posts.path, postStatus: posts.status, momentTitle: moments.title, momentStatus: moments.status, replyTo: parent.name })
    .from(comments).leftJoin(posts, eq(posts.id, comments.postId)).leftJoin(moments, eq(moments.id, comments.momentId)).leftJoin(parent, eq(parent.id, comments.parentId))
    .where(where).orderBy(desc(comments.createdAt), desc(comments.id)).limit(20).offset((page - 1) * 20);
  const [total] = await db().select({ value: count() }).from(comments).where(where);
  const groups = await db().select({ status: comments.status, value: count() }).from(comments).groupBy(comments.status);
  return { items: rows.map(({ comment, ...row }) => ({ ...comment, isAuthor: Boolean(comment.authorId), target: targetOf(comment), targetTitle: row.postTitle || row.momentTitle || '碎碎念', targetPath: row.postPath || `/moments/posts/${comment.momentId}`, targetStatus: row.postStatus || row.momentStatus, replyTo: row.replyTo })), total: Number(total.value), page, pages: Math.max(1, Math.ceil(Number(total.value) / 20)), counts: Object.fromEntries(groups.map(row => [row.status, Number(row.value)])) };
}

export async function moderateComment(id: string, version: number, action: 'approve' | 'pending' | 'trash' | 'restore') {
  return db().transaction(async tx => {
    const [row] = await tx.select().from(comments).where(eq(comments.id, id)).for('update');
    if (!row) throw new AppError(404, '评论不存在');
    if (row.version !== version) throw new AppError(409, '评论已被修改，请刷新列表后操作');
    if (action === 'approve') {
      if (row.status === 'trash') throw new AppError(400, '请先从回收站恢复评论');
      await visibleCommentTarget(targetOf(row), tx);
      await checkParent(tx, targetOf(row), row.parentId);
    }
    if (action === 'restore' && row.status !== 'trash') throw new AppError(400, '评论不在回收站');
    const status = action === 'approve' ? 'approved' : action === 'trash' ? 'trash' : 'pending';
    await tx.update(comments).set({ status, version: row.version + 1, updatedAt: new Date() }).where(eq(comments.id, id));
    return { id, status, version: row.version + 1 };
  });
}

export async function replyToComment(id: string, version: number, replyId: string, body: string, authorId: string) {
  const text = commentBody.parse(body);
  return db().transaction(async tx => {
    const [row] = await tx.select().from(comments).where(eq(comments.id, id)).for('update');
    if (!row) throw new AppError(404, '评论不存在');
    if (row.version !== version) throw new AppError(409, '评论已被修改，请刷新列表后回复');
    if (row.status !== 'approved') throw new AppError(400, '请先审核通过这条评论再回复');
    return insertComment(tx, targetOf(row), { id: replyId, name: '墨雨', email: '', body: text, parentId: id }, authorId);
  });
}
