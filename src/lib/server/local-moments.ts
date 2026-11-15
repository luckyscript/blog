import { load } from "cheerio";
import { momentForm, type MomentForm } from "../admin/moment-writing";
import Markdoc from "@markdoc/markdoc";
import { transformMarkdown, renderHtml } from "../markdoc/render";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, getPool } from "../../db";
import { drizzle } from "drizzle-orm/mysql2";
import { reconcileMomentDuplicates, withMomentDedupLock } from "../moments/deduplication";
import { media, moments, momentSources, momentDrafts } from "../../db/schema";
import { cleanMomentHtml, escapeHtml } from "../moments/content";
import { AppError } from "./errors";

export const manualMomentSource = "local:manual";
export const localMomentSchema = momentForm.extend({
  text: z.string().trim().max(20000, '文字不能超过 20000 字'),
  status: z.enum(['draft','published']),
}).refine(value => !!value.text || value.images.length > 0, '请写点文字或添加图片');

export function prepareLocalMoment(value: unknown) {
  const input = localMomentSchema.parse(value);
  if (
    input.status === "published" &&
    Date.parse(input.publishedAt) > Date.now() + 5000
  )
    throw new AppError(400, "发布时间不能晚于当前时间");
  let paragraphs = input.text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
  if (input.format === 'markdown') {
    const linksForImages = (node: any): any => {
      if (Array.isArray(node)) return node.map(linksForImages);
      if (!(node instanceof Markdoc.Tag)) return node;
      if (node.name === 'img') return new Markdoc.Tag('a', { href: node.attributes.src }, [node.attributes.alt || '查看图片']);
      node.children = node.children.map(linksForImages);
      return node;
    };
    // The persisted wrapper identifies Markdown records without rewriting legacy text.
    // Images continue through the existing registered-media path and nine-photo limit.
    paragraphs = `<div class="local-moment-markdown">${renderHtml(linksForImages(transformMarkdown(input.text)))}</div>`;
  }
  const photos = input.images
    .map(
      (image) =>
        `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(
          image.alt
        )}" loading="lazy">`
    )
    .join("");
  return { input, html: cleanMomentHtml(paragraphs + photos) };
}

function localRecord(row: typeof moments.$inferSelect, draft?: typeof momentDrafts.$inferSelect | null) {
  const input: MomentForm = draft?.content ?? {
    text: row.text,
    format: row.html.startsWith('<div class="local-moment-markdown">') ? 'markdown' : 'plain',
    images: row.media.filter(item => item.type === 'image').map(item => ({ url: item.url, alt: item.alt })),
    publishedAt: row.publishedAt.toISOString(),
  };
  return { id: row.id, version: row.contentHash, status: row.status, editable: true,
    historical: row.sourceId !== manualMomentSource, hasDraft: !!draft,
    ...input, updatedAt: (draft?.updatedAt ?? row.lastSeenAt).toISOString() };
}
export async function getLocalMoment(id: string) {
  const [row] = await db().select({ moment: moments, draft: momentDrafts }).from(moments)
    .innerJoin(momentSources, eq(momentSources.id, moments.sourceId))
    .leftJoin(momentDrafts, eq(momentDrafts.momentId, moments.id))
    .where(and(eq(moments.id, id), eq(momentSources.platform, 'local')));
  if (!row) throw new AppError(404, '这条碎碎念不存在');
  return localRecord(row.moment, row.draft);
}
export async function listLocalMoments(status: string, page: number) {
  const state = status === 'draft'
    ? and(sql`${moments.status} <> 'trash'`, or(eq(moments.status, 'draft'), isNotNull(momentDrafts.momentId)))
    : ['published','trash'].includes(status) ? eq(moments.status, status) : sql`${moments.status} <> 'trash'`;
  const filter = and(eq(momentSources.platform, 'local'), state);
  const [{ total }] = await db().select({ total: sql<number>`count(*)` }).from(moments)
    .innerJoin(momentSources, eq(momentSources.id, moments.sourceId))
    .leftJoin(momentDrafts, eq(momentDrafts.momentId, moments.id)).where(filter);
  const rows = await db().select({ moment: moments, draft: momentDrafts }).from(moments)
    .innerJoin(momentSources, eq(momentSources.id, moments.sourceId))
    .leftJoin(momentDrafts, eq(momentDrafts.momentId, moments.id)).where(filter)
    .orderBy(desc(status === 'draft' ? sql`COALESCE(${momentDrafts.updatedAt},${moments.lastSeenAt})` : moments.publishedAt), desc(moments.id))
    .limit(20).offset((page - 1) * 20);
  return { items: rows.map(row => localRecord(row.moment, row.draft)), total: Number(total), page, pages: Math.max(1, Math.ceil(Number(total) / 20)) };
}

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];
async function assertLocalSource(tx: Tx, row: typeof moments.$inferSelect | undefined) {
  if (!row) throw new AppError(404, '这条碎碎念不存在');
  const [source] = await tx.select({ platform: momentSources.platform }).from(momentSources).where(eq(momentSources.id, row.sourceId));
  if (source?.platform !== 'local') throw new AppError(404, '这条碎碎念不支持在此编辑');
}
async function assertImages(tx: Tx, input: MomentForm, existing?: typeof moments.$inferSelect) {
  const retained = new Set(existing?.media.filter(item => item.type === 'image').map(item => item.url) || []);
  const urls = [...new Set(input.images.map(image => image.url))].filter(url => !retained.has(url));
  if (!urls.length) return;
  const available = await tx.select({ url: media.url, mime: media.mime }).from(media)
    .where(and(inArray(media.url, urls), eq(media.status, 'ready')));
  if (urls.some(url => !available.some(item => item.url === url && item.mime.startsWith('image/'))))
    throw new AppError(400, '请先上传图片，或从媒体库选择已上传的图片');
}
async function ensureManualSource(tx: Tx, now: Date) {
  await tx.insert(momentSources).values({ id: manualMomentSource, platform: 'local', account: 'manual', title: '本站碎碎念', enabled: true, syncState: { archive: true, backfillComplete: true }, createdAt: now })
    .onDuplicateKeyUpdate({ set: { id: manualMomentSource } });
}
const revision = () => createHash('sha256').update(randomUUID()).digest('hex');

/** Save a separate cloud draft; published fields and visibility remain untouched. */
export async function saveLocalMomentDraft(id: string, value: unknown, version: string | null) {
  const input = momentForm.parse(value);
  const connection = await getPool().getConnection();
  try {
    return await withMomentDedupLock(connection, () => drizzle(connection).transaction(async tx => {
      const [existing] = await tx.select().from(moments).where(eq(moments.id, id)).for('update');
      const [draft] = await tx.select().from(momentDrafts).where(eq(momentDrafts.momentId, id));
      if (existing) {
        await assertLocalSource(tx, existing);
        if (existing.status === 'trash') throw new AppError(409, '请先从回收站恢复');
        // Retrying an acknowledged or lost response is safe only when its exact content is already stored.
        if (draft && JSON.stringify(momentForm.parse(draft.content)) === JSON.stringify(input)) return localRecord(existing, draft);
        if (!version || existing.contentHash !== version) throw new AppError(409, '草稿已在其他设备修改，请重新打开后编辑');
      } else if (version) throw new AppError(409, '草稿不存在，请重新打开');
      await assertImages(tx, input, existing);
      const now = new Date();
      if (!existing) {
        await ensureManualSource(tx, now);
        await tx.insert(moments).values({ id, sourceId: manualMomentSource, externalId: id, sourceUrl: '', title: '', text: '', html: '', media: [], tags: [], status: 'draft', contentHash: revision(), publishedAt: new Date(input.publishedAt), firstSeenAt: now, lastSeenAt: now });
      } else await tx.update(moments).set({ contentHash: revision(), lastSeenAt: now }).where(eq(moments.id, id));
      await tx.insert(momentDrafts).values({ momentId: id, content: input, updatedAt: now })
        .onDuplicateKeyUpdate({ set: { content: input, updatedAt: now } });
      const [saved] = await tx.select().from(moments).where(eq(moments.id, id));
      return localRecord(saved, { momentId: id, content: input, updatedAt: now });
    }));
  } finally { connection.release(); }
}

export async function saveLocalMoment(
  id: string | null,
  value: unknown,
  version = ""
) {
  const { input, html } = prepareLocalMoment(value);
  const connection = await getPool().getConnection();
  try {
    return await withMomentDedupLock(connection, () => drizzle(connection).transaction(async (tx) => {
      const now = new Date();
      let existing: typeof moments.$inferSelect | undefined;
      if (id) {
        [existing] = await tx
          .select()
          .from(moments)
          .where(eq(moments.id, id))
          .for("update");
        await assertLocalSource(tx, existing);
        if (!existing) throw new AppError(404, '这条碎碎念不存在');
        if (existing.contentHash !== version)
          throw new AppError(409, "内容已在其他窗口修改，请重新打开后编辑");
        if (existing.status === "trash")
          throw new AppError(409, "请先从回收站恢复");
      }
      await assertImages(tx, input, existing);
      if (!existing) await ensureManualSource(tx, now);
      const key = id || randomUUID();
      let publishedHtml = html;
      if (existing && existing.sourceId !== manualMomentSource && input.format === 'plain' && input.text === existing.text) {
        const originalImages = existing.media.filter(item => item.type === 'image').map(item => ({ url: item.url, alt: item.alt }));
        if (JSON.stringify(input.images) === JSON.stringify(originalImages)) publishedHtml = existing.html;
        else {
          const original = load(existing.html, {}, false); original('img').remove();
          const photos = input.images.map(image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" loading="lazy">`).join('');
          publishedHtml = cleanMomentHtml(original.html() + photos);
        }
      }
      const fields = {
        text: input.text,
        html: publishedHtml,
        title: existing && input.text === existing.text ? existing.title : input.text.slice(0, 80),
        media: [...input.images.map((image) => ({ type: "image" as const, ...image })), ...(existing?.media.filter(item => item.type !== 'image') || [])],
        tags: existing?.tags ?? [],
        status: input.status,
        publishedAt: new Date(input.publishedAt),
        lastSeenAt: now,
        contentHash: createHash("sha256")
          .update(JSON.stringify({ input, nonce: randomUUID() }))
          .digest("hex"),
      };
      if (existing)
        await tx.update(moments).set(fields).where(eq(moments.id, key));
      else
        await tx
          .insert(moments)
          .values({
            id: key,
            sourceId: manualMomentSource,
            externalId: key,
            sourceUrl: "",
            firstSeenAt: now,
            ...fields,
          });
      await tx.delete(momentDrafts).where(eq(momentDrafts.momentId, key));
      const [row] = await tx.select().from(moments).where(eq(moments.id, key));
      await reconcileMomentDuplicates(connection);
      return localRecord(row);
    }));
  } finally { connection.release(); }
}
export async function changeLocalMomentStatus(
  id: string,
  version: string,
  action: "trash" | "restore"
) {
  const connection = await getPool().getConnection();
  try {
    return await withMomentDedupLock(connection, () => drizzle(connection).transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(moments)
        .where(eq(moments.id, id))
        .for("update");
      await assertLocalSource(tx, row);
      if (!row) throw new AppError(404, '这条碎碎念不存在');
      if (row.contentHash !== version)
        throw new AppError(409, "内容已在其他窗口修改，请刷新列表");
      if (action === "restore" && row.status !== "trash")
        throw new AppError(409, "这条碎碎念不在回收站");
      await tx
        .update(moments)
        .set({
          status: action === "trash" ? "trash" : "draft",
          lastSeenAt: new Date(),
          contentHash: createHash("sha256").update(randomUUID()).digest("hex"),
        })
        .where(eq(moments.id, id));
      await reconcileMomentDuplicates(connection);
      return { ok: true };
    }));
  } finally { connection.release(); }
}
