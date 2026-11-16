import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPool } from "../../db";
import { AppError } from "./errors";
import { usesDatabase } from "./env";
export const seriesInput = z.object({
  title: z.string().trim().min(1, "请填写系列名称").max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "独立网址请使用小写字母、数字和横线"),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(["draft", "published"]).default("published"),
  state: z.enum(["ongoing", "completed"]).default("ongoing"),
});
export type SeriesInput = z.infer<typeof seriesInput>;
export type SeriesSummary = SeriesInput & {
  id: string;
  version: number;
  path: string;
  publishedCount: number;
  draftCount: number;
  latestAt: string | null;
};
export type SeriesStory = {
  id: string;
  title: string;
  path: string;
  description: string;
  context: string;
  publishedAt: string;
  status: string;
  hasDraft?: boolean;
};
export type SeriesDetail = SeriesSummary & { entries: SeriesStory[] };
export const seriesIso = (value: unknown) =>
  value ? new Date(value as string).toISOString() : null;
export const seriesJson = (value: unknown): Record<string, any> =>
  typeof value === "string"
    ? JSON.parse(value)
    : (value as Record<string, any>);
export const notePath = (seriesSlug: string, slug: string) =>
  `/series/${encodeURIComponent(seriesSlug)}/${encodeURIComponent(slug)}`;
const summarySql = `SELECT s.*,(SELECT COUNT(*) FROM blog_series_notes n WHERE n.series_id=s.id AND n.status='published' AND n.published_at<=UTC_TIMESTAMP(3)) AS published_count,(SELECT MAX(GREATEST(n.published_at,COALESCE(n.content_updated_at,n.published_at))) FROM blog_series_notes n WHERE n.series_id=s.id AND n.status='published' AND n.published_at<=UTC_TIMESTAMP(3)) AS latest_at FROM blog_series s`;
function summary(r: any): SeriesSummary {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    status: r.status,
    state: r.state,
    version: Number(r.version),
    path: `/series/${r.slug}`,
    publishedCount: Number(r.published_count) || 0,
    draftCount: 0,
    latestAt: seriesIso(r.latest_at),
  };
}
export async function publicSeriesStories(id: string): Promise<SeriesStory[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT n.*,s.slug AS series_slug FROM blog_series_notes n JOIN blog_series s ON s.id=n.series_id WHERE n.series_id=? AND n.status='published' AND n.published_at<=UTC_TIMESTAMP(3) AND s.status='published' ORDER BY n.published_at DESC,n.id DESC`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    path: notePath(r.series_slug, r.slug),
    description: r.description,
    context: r.context,
    publishedAt: seriesIso(r.published_at)!,
    status: r.status,
  }));
}
export async function listPublicSeries() {
  if (!usesDatabase()) return [];
  const [rows] = await getPool().query<any[]>(
    `${summarySql} WHERE s.status='published' ORDER BY latest_at DESC,s.created_at DESC`
  );
  return rows.map(summary);
}
export async function publicSeriesBySlug(slug: string): Promise<SeriesDetail> {
  if (!usesDatabase()) throw new AppError(404, "系列不存在或尚未公开");
  const [[row]] = await getPool().query<any[]>(
    `${summarySql} WHERE s.slug=? AND s.status='published'`,
    [slug]
  );
  if (!row) throw new AppError(404, "系列不存在或尚未公开");
  return { ...summary(row), entries: await publicSeriesStories(row.id) };
}
export async function adminSeriesStories(id: string): Promise<SeriesStory[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT n.*,s.slug AS series_slug,d.content AS draft_content FROM blog_series_notes n JOIN blog_series s ON s.id=n.series_id LEFT JOIN blog_series_note_drafts d ON d.note_id=n.id WHERE n.series_id=? ORDER BY n.published_at DESC,n.id DESC`,
    [id]
  );
  return rows.map((r) => {
    const d = r.draft_content ? seriesJson(r.draft_content) : null;
    return {
      id: r.id,
      title: d?.title ?? r.title,
      path: notePath(r.series_slug, r.slug),
      description: d?.description ?? r.description,
      context: d?.context ?? r.context,
      publishedAt: d?.publishedAt || seriesIso(r.published_at)!,
      status: r.status,
      hasDraft: !!d,
    };
  });
}
export async function listAdminSeries() {
  const [rows] = await getPool().query<any[]>(
    `${summarySql} ORDER BY s.updated_at DESC`
  );
  return Promise.all(
    rows.map(async (r) => ({
      ...summary(r),
      draftCount: (await adminSeriesStories(r.id)).filter(
        (n) => n.status !== "trash" && (n.status === "draft" || n.hasDraft)
      ).length,
    }))
  );
}
export async function getAdminSeries(id: string): Promise<SeriesDetail> {
  const [[r]] = await getPool().query<any[]>(`${summarySql} WHERE s.id=?`, [
    id,
  ]);
  if (!r) throw new AppError(404, "系列不存在");
  const entries = await adminSeriesStories(id);
  return {
    ...summary(r),
    draftCount: entries.filter(
      (n) => n.status !== "trash" && (n.status === "draft" || n.hasDraft)
    ).length,
    entries,
  };
}
export async function saveSeries(
  id: string | null,
  value: unknown,
  version: number | null
) {
  const input = seriesInput.parse(value),
    key = id || randomUUID(),
    db = await getPool().getConnection();
  try {
    await db.beginTransaction();
    if (id) {
      const [[row]] = await db.query<any[]>(
        "SELECT * FROM blog_series WHERE id=? FOR UPDATE",
        [id]
      );
      if (!row) throw new AppError(404, "系列不存在");
      if (row.version !== version)
        throw new AppError(409, "系列已在其他窗口修改，请重新打开");
      if (row.slug !== input.slug) {
        const [[note]] = await db.query<any[]>(
          "SELECT id FROM blog_series_notes WHERE series_id=? LIMIT 1",
          [id]
        );
        if (note)
          throw new AppError(400, "已有篇目的系列网址不能更改，以免旧链接失效");
      }
      await db.query(
        "UPDATE blog_series SET title=?,slug=?,description=?,status=?,state=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [
          input.title,
          input.slug,
          input.description,
          input.status,
          input.state,
          id,
        ]
      );
    } else
      await db.query(
        "INSERT INTO blog_series(id,title,slug,description,section,status,state,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [
          key,
          input.title,
          input.slug,
          input.description,
          "series",
          input.status,
          input.state,
        ]
      );
    await db.commit();
  } catch (e) {
    await db.rollback();
    if ((e as any)?.code === "ER_DUP_ENTRY")
      throw new AppError(409, "这个系列网址已被使用");
    throw e;
  } finally {
    db.release();
  }
  return getAdminSeries(key);
}
/** Old article URLs and renamed note URLs resolve only to published series content. */
export async function seriesRedirect(path: string) {
  if (
    !usesDatabase() ||
    !/^\/(?:blog|tech|life|sight|card|series)\//.test(path)
  )
    return null;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    return null;
  }
  const [[row]] = await getPool().query<any[]>(
    `SELECT s.slug,n.slug AS note_slug FROM blog_series_paths p JOIN blog_series s ON s.id=p.series_id LEFT JOIN blog_series_notes n ON n.id=p.note_id WHERE p.path IN (?,?) AND s.status='published' AND (p.note_id IS NULL OR (n.status='published' AND n.published_at<=UTC_TIMESTAMP(3)))`,
    [path, decoded]
  );
  return row
    ? row.note_slug
      ? notePath(row.slug, row.note_slug)
      : `/series/${row.slug}`
    : null;
}
