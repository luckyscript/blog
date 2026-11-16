import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { getPool } from "../../db";
import { AppError } from "./errors";
import { getAdminSeries, notePath, seriesIso, seriesJson } from "./series";
import { parseAndTransform } from "../markdoc/render";
export const seriesNoteInput = z.object({
  title: z.string().max(255),
  slug: z.string().max(180),
  markdown: z.string().max(2000000).default(""),
  description: z.string().max(2000).default(""),
  context: z.string().max(200).default(""),
  publishedAt: z.string().datetime(),
});
export type SeriesNoteInput = z.infer<typeof seriesNoteInput>;
export type SeriesNoteRecord = {
  id: string;
  seriesId: string;
  seriesTitle: string;
  seriesSlug: string;
  path: string;
  status: string;
  version: number;
  input: SeriesNoteInput;
  hasDraft: boolean;
  revisions: { id: string; action: string; createdAt: string }[];
};
export function noteInput(r: any): SeriesNoteInput {
  return {
    title: r.title,
    slug: r.slug,
    markdown: r.markdown,
    description: r.description,
    context: r.context,
    publishedAt: seriesIso(r.published_at)!,
  };
}
export async function getSeriesNote(id: string, store: Pick<PoolConnection, 'query'> = getPool()): Promise<SeriesNoteRecord> {
  const [[r]] = await store.query<any[]>(
    `SELECT n.*,s.title AS series_title,s.slug AS series_slug,d.content AS draft_content FROM blog_series_notes n JOIN blog_series s ON s.id=n.series_id LEFT JOIN blog_series_note_drafts d ON d.note_id=n.id WHERE n.id=?`,
    [id]
  );
  if (!r) throw new AppError(404, "系列篇目不存在");
  const [history] = await store.query<any[]>(
    "SELECT id,action,created_at FROM blog_series_note_revisions WHERE note_id=? ORDER BY created_at DESC,id DESC",
    [id]
  );
  return {
    id: r.id,
    seriesId: r.series_id,
    seriesTitle: r.series_title,
    seriesSlug: r.series_slug,
    path: notePath(r.series_slug, r.slug),
    status: r.status,
    version: r.version,
    input: r.draft_content
      ? seriesNoteInput.parse(seriesJson(r.draft_content))
      : noteInput(r),
    hasDraft: !!r.draft_content,
    revisions: history.map((h) => ({
      id: h.id,
      action: h.action,
      createdAt: seriesIso(h.created_at)!,
    })),
  };
}
export async function createSeriesNote(seriesId: string) {
  await getAdminSeries(seriesId);
  const id = randomUUID(),
    slug = "note-" + id.slice(0, 8),
    input: SeriesNoteInput = {
      title: "",
      slug,
      markdown: "",
      description: "",
      context: "",
      publishedAt: new Date().toISOString(),
    };
  const db = await getPool().getConnection();
  try {
    await db.beginTransaction();
    await db.query(
      "INSERT INTO blog_series_notes(id,series_id,slug,title,markdown,description,context,status,published_at,created_at,updated_at,version) VALUES(?,?,?,'未命名手记','','','','draft',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)",
      [id, seriesId, slug, new Date(input.publishedAt)]
    );
    await db.query(
      "INSERT INTO blog_series_note_drafts(note_id,content,updated_at) VALUES(?,?,UTC_TIMESTAMP(3))",
      [id, JSON.stringify(input)]
    );
    const record = await getSeriesNote(id, db);
    await db.commit();
    return record;
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}
export async function saveSeriesNote(
  id: string,
  value: unknown,
  version: number
) {
  const input = seriesNoteInput.parse(value),
    db = await getPool().getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query<any[]>(
      "SELECT * FROM blog_series_notes WHERE id=? FOR UPDATE",
      [id]
    );
    if (!row) throw new AppError(404, "篇目不存在");
    if (row.status === "trash") throw new AppError(409, "请先恢复篇目");
    const [[draft]] = await db.query<any[]>(
      "SELECT content FROM blog_series_note_drafts WHERE note_id=?",
      [id]
    );
    if (
      draft &&
      isDeepStrictEqual(seriesNoteInput.parse(seriesJson(draft.content)), input)
    ) {
      const record = await getSeriesNote(id, db);
      await db.rollback();
      return record;
    }
    if (row.version !== version)
      throw new AppError(
        409,
        "篇目已在其他设备修改，本机输入仍保留，请重新打开后合并"
      );
    await db.query(
      "INSERT INTO blog_series_note_drafts(note_id,content,updated_at) VALUES(?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE content=VALUES(content),updated_at=VALUES(updated_at)",
      [id, JSON.stringify(input)]
    );
    await db.query(
      "UPDATE blog_series_notes SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [id]
    );
    const record = await getSeriesNote(id, db);
    await db.commit();
    return record;
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}
export async function seriesNoteAction(
  id: string,
  version: number,
  action: "publish" | "unpublish" | "trash" | "restore",
  revisionId?: string
) {
  const db = await getPool().getConnection();
  try {
    await db.beginTransaction();
    const [[r]] = await db.query<any[]>(
      "SELECT n.*,s.slug AS series_slug FROM blog_series_notes n JOIN blog_series s ON s.id=n.series_id WHERE n.id=? FOR UPDATE",
      [id]
    );
    if (!r) throw new AppError(404, "篇目不存在");
    if (r.version !== version)
      throw new AppError(409, "篇目已在其他窗口修改，请重新打开");
    const [[draft]] = await db.query<any[]>(
      "SELECT content FROM blog_series_note_drafts WHERE note_id=?",
      [id]
    );
    let input = seriesNoteInput.parse(
      draft ? seriesJson(draft.content) : noteInput(r)
    );
    if (revisionId) {
      await db.query(
        "INSERT INTO blog_series_note_revisions(id,note_id,content,action,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))",
        [randomUUID(), id, JSON.stringify(input), "before-restore"]
      );
      const [[history]] = await db.query<any[]>(
        "SELECT content FROM blog_series_note_revisions WHERE id=? AND note_id=?",
        [revisionId, id]
      );
      if (!history) throw new AppError(404, "历史版本不存在");
      input = seriesNoteInput.parse(seriesJson(history.content));
      await db.query(
        "INSERT INTO blog_series_note_drafts(note_id,content,updated_at) VALUES(?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE content=VALUES(content),updated_at=VALUES(updated_at)",
        [id, JSON.stringify(input)]
      );
    } else if (action === "publish") {
      if (r.status === "trash") throw new AppError(409, "请先恢复篇目");
      const title = input.title.trim(),
        slug = input.slug.trim();
      if (!title || !/^[\p{L}\p{N}_-]+$/u.test(slug) || !input.markdown.trim())
        throw new AppError(400, "请填写标题、有效网址和正文后再发布");
      if (new Date(input.publishedAt).getTime() > Date.now() + 60000)
        throw new AppError(400, "请选择当前或过去的发布时间");
      await parseAndTransform({ content: input.markdown });
      input = { ...input, title, slug };
      const destination = notePath(r.series_slug, slug);
      const [[taken]] = await db.query<any[]>(
        "SELECT note_id FROM blog_series_paths WHERE path=?",
        [destination]
      );
      if (taken && taken.note_id !== id)
        throw new AppError(409, "这个篇目网址已被使用");
      if (r.slug !== slug)
        await db.query(
          "INSERT INTO blog_series_paths(path,series_id,note_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE note_id=VALUES(note_id)",
          [notePath(r.series_slug, r.slug), r.series_id, id]
        );
      await db.query(
        "DELETE FROM blog_series_paths WHERE path=? AND note_id=?",
        [destination, id]
      );
      await db.query(
        "UPDATE blog_series_notes SET title=?,slug=?,markdown=?,description=?,context=?,published_at=?,content_updated_at=IF(status='published',UTC_TIMESTAMP(3),content_updated_at),status='published' WHERE id=?",
        [
          title,
          slug,
          input.markdown,
          input.description,
          input.context,
          new Date(input.publishedAt),
          id,
        ]
      );
      await db.query("DELETE FROM blog_series_note_drafts WHERE note_id=?", [
        id,
      ]);
    } else {
      if (action === "restore" && r.status !== "trash")
        throw new AppError(400, "篇目不在回收站");
      await db.query("UPDATE blog_series_notes SET status=? WHERE id=?", [
        action === "trash" ? "trash" : "draft",
        id,
      ]);
    }
    await db.query(
      "UPDATE blog_series_notes SET version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [id]
    );
    await db.query(
      "INSERT INTO blog_series_note_revisions(id,note_id,content,action,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))",
      [
        randomUUID(),
        id,
        JSON.stringify(input),
        revisionId ? "restore-version" : action,
      ]
    );
    const record = await getSeriesNote(id, db);
    await db.commit();
    return record;
  } catch (e) {
    await db.rollback();
    if ((e as any)?.code === "ER_DUP_ENTRY")
      throw new AppError(409, "这个篇目网址已被使用");
    throw e;
  } finally {
    db.release();
  }
}
export async function publicSeriesNote(seriesSlug: string, slug: string) {
  const [[row]] = await getPool().query<any[]>(
    `SELECT n.* FROM blog_series_notes n JOIN blog_series s ON s.id=n.series_id WHERE s.slug=? AND n.slug=? AND s.status='published' AND n.status='published' AND n.published_at<=UTC_TIMESTAMP(3)`,
    [seriesSlug, slug]
  );
  if (!row) throw new AppError(404, "篇目不存在或尚未发布");
  return {
    ...noteInput(row),
    id: row.id,
    seriesId: row.series_id,
    contentUpdatedAt: seriesIso(row.content_updated_at),
  };
}
