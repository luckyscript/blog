import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { media, moments, momentSources } from "../../db/schema";
import { cleanMomentHtml, escapeHtml } from "../moments/content";
import { AppError } from "./errors";

export const manualMomentSource = "local:manual";
const imageSchema = z.object({
  url: z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    }, "图片地址无效"),
  alt: z.string().max(500).default(""),
});
export const localMomentSchema = z
  .object({
    text: z.string().trim().max(20_000, "文字不能超过 20000 字"),
    images: z.array(imageSchema).max(9, "每条最多添加 9 张图片"),
    publishedAt: z.string().datetime({ offset: true }),
    status: z.enum(["draft", "published"]),
  })
  .refine(
    (value) => !!value.text || value.images.length > 0,
    "请写点文字或添加图片"
  );

export function prepareLocalMoment(value: unknown) {
  const input = localMomentSchema.parse(value);
  if (
    input.status === "published" &&
    Date.parse(input.publishedAt) > Date.now() + 5000
  )
    throw new AppError(400, "发布时间不能晚于当前时间");
  const paragraphs = input.text
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
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

function localRecord(row: typeof moments.$inferSelect) {
  return {
    id: row.id,
    version: row.contentHash,
    status: row.status,
    editable: row.sourceId === manualMomentSource,
    text: row.text,
    images: row.media
      .filter((item) => item.type === "image")
      .map((item) => ({ url: item.url, alt: item.alt })),
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.lastSeenAt.toISOString(),
  };
}
export async function listLocalMoments(status: string, page: number) {
  const filter = and(
    eq(momentSources.platform, "local"),
    ["draft", "published", "trash"].includes(status)
      ? eq(moments.status, status)
      : sql`${moments.status} <> 'trash'`
  );
  const [{ total }] = await db()
    .select({ total: sql<number>`count(*)` })
    .from(moments)
    .innerJoin(momentSources, eq(momentSources.id, moments.sourceId))
    .where(filter);
  const rows = await db()
    .select({ moment: moments })
    .from(moments)
    .innerJoin(momentSources, eq(momentSources.id, moments.sourceId))
    .where(filter)
    .orderBy(desc(moments.publishedAt), desc(moments.id))
    .limit(20)
    .offset((page - 1) * 20);
  return {
    items: rows.map((row) => localRecord(row.moment)),
    total: Number(total),
    page,
    pages: Math.max(1, Math.ceil(Number(total) / 20)),
  };
}
export async function saveLocalMoment(
  id: string | null,
  value: unknown,
  version = ""
) {
  const { input, html } = prepareLocalMoment(value);
  return db().transaction(async (tx) => {
    const now = new Date();
    let existing: typeof moments.$inferSelect | undefined;
    if (id) {
      [existing] = await tx
        .select()
        .from(moments)
        .where(eq(moments.id, id))
        .for("update");
      if (!existing || existing.sourceId !== manualMomentSource)
        throw new AppError(404, "这条碎碎念不支持在此编辑");
      if (existing.contentHash !== version)
        throw new AppError(409, "内容已在其他窗口修改，请重新打开后编辑");
      if (existing.status === "trash")
        throw new AppError(409, "请先从回收站恢复");
    }
    const urls = [...new Set(input.images.map((image) => image.url))];
    if (urls.length) {
      const available = await tx
        .select({ url: media.url, mime: media.mime })
        .from(media)
        .where(and(inArray(media.url, urls), eq(media.status, "ready")));
      if (
        urls.some(
          (url) =>
            !available.some(
              (item) => item.url === url && item.mime.startsWith("image/")
            )
        )
      )
        throw new AppError(400, "请先上传图片，或从媒体库选择已上传的图片");
    }
    await tx
      .insert(momentSources)
      .values({
        id: manualMomentSource,
        platform: "local",
        account: "manual",
        title: "本站碎碎念",
        enabled: true,
        syncState: { archive: true, backfillComplete: true },
        createdAt: now,
      })
      .onDuplicateKeyUpdate({ set: { id: manualMomentSource } });
    const key = id || randomUUID();
    const fields = {
      text: input.text,
      html,
      title: input.text.slice(0, 80),
      media: input.images.map((image) => ({
        type: "image" as const,
        ...image,
      })),
      tags: [] as string[],
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
    const [row] = await tx.select().from(moments).where(eq(moments.id, key));
    return localRecord(row);
  });
}
export async function changeLocalMomentStatus(
  id: string,
  version: string,
  action: "trash" | "restore"
) {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(moments)
      .where(eq(moments.id, id))
      .for("update");
    if (!row || row.sourceId !== manualMomentSource)
      throw new AppError(404, "这条碎碎念不支持在此编辑");
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
    return { ok: true };
  });
}
