import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, getPool } from "../../db";
import { seriesCollections, seriesEntries } from "../../db/schema";
import { AppError } from "./errors";
import { usesDatabase } from "./env";
import type { PostInput } from "./content-input";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
export const seriesInput = z.object({
  title: z.string().trim().min(1, "请填写系列名称").max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "独立网址请使用小写字母、数字和横线"),
  description: z.string().trim().max(2000).default(""),
  section: z.enum(["blog", "tech", "sight", "life", "card"]).default("blog"),
  status: z.enum(["draft", "published"]).default("published"),
  state: z.enum(["ongoing", "completed"]).default("ongoing"),
});
export type SeriesInput = z.infer<typeof seriesInput>;
export type SeriesSummary = SeriesInput & {
  id: string;
  version: number;
  rootPostId: string | null;
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
const iso = (value: unknown) =>
  value ? new Date(value as string).toISOString() : null;
const metadata = (value: unknown): Record<string, unknown> =>
  typeof value === "string"
    ? JSON.parse(value)
    : ((value || {}) as Record<string, unknown>);
function summary(row: any): SeriesSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    section: row.section,
    status: row.status,
    state: row.state,
    version: Number(row.version),
    rootPostId: row.root_post_id || null,
    path: row.root_path || `/series/${row.slug}`,
    publishedCount: Number(row.published_count) || 0,
    draftCount: Number(row.draft_count) || 0,
    latestAt: iso(row.latest_at),
  };
}
const summarySql = `SELECT s.*,root.path AS root_path,
 (SELECT COUNT(*) FROM blog_series_entries e JOIN blog_posts p ON p.id=e.post_id WHERE e.series_id=s.id AND p.status='published' AND p.published_at<=UTC_TIMESTAMP(3)) AS published_count,
 (SELECT MAX(GREATEST(p.published_at,COALESCE(p.content_updated_at,p.published_at))) FROM blog_series_entries e JOIN blog_posts p ON p.id=e.post_id WHERE e.series_id=s.id AND p.status='published' AND p.published_at<=UTC_TIMESTAMP(3)) AS latest_at
 FROM blog_series s LEFT JOIN blog_posts root ON root.id=s.root_post_id`;
const publicCondition = `s.status='published' AND (s.root_post_id IS NULL OR (root.status='published' AND root.published_at<=UTC_TIMESTAMP(3)))`;
export async function listPublicSeries(section?: string) {
  if (!usesDatabase()) return [];
  const [rows] = await getPool().query<any[]>(
    `${summarySql} WHERE ${publicCondition}${
      section ? " AND s.section=?" : ""
    } ORDER BY latest_at DESC,s.created_at DESC`,
    section ? [section] : []
  );
  return rows.map(summary);
}
export async function publicSeriesStories(id: string): Promise<SeriesStory[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT p.id,p.title,p.path,p.description,p.metadata,p.published_at,p.status FROM blog_series_entries e JOIN blog_posts p ON p.id=e.post_id WHERE e.series_id=? AND p.status='published' AND p.published_at<=UTC_TIMESTAMP(3) ORDER BY p.published_at DESC,p.id DESC`,
    [id]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    path: row.path,
    description: row.description,
    context:
      typeof metadata(row.metadata).seriesContext === "string"
        ? String(metadata(row.metadata).seriesContext)
        : "",
    publishedAt: iso(row.published_at)!,
    status: row.status,
  }));
}
export async function publicSeriesBySlug(slug: string): Promise<SeriesDetail> {
  if (!usesDatabase()) throw new AppError(404, "系列不存在或尚未公开");
  const [[row]] = await getPool().query<any[]>(
    `${summarySql} WHERE s.slug=? AND ${publicCondition}`,
    [slug]
  );
  if (!row) throw new AppError(404, "系列不存在或尚未公开");
  return { ...summary(row), entries: await publicSeriesStories(row.id) };
}
export async function publicSeriesContext(path: string): Promise<{
  root: SeriesDetail | null;
  chapter: { series: SeriesDetail; index: number } | null;
}> {
  if (!usesDatabase()) return { root: null, chapter: null };
  const [[root]] = await getPool().query<any[]>(
    `${summarySql} WHERE root.path=?`,
    [path]
  );
  if (root) {
    if (root.status !== "published") throw new AppError(404, "系列尚未公开");
    return {
      root: { ...summary(root), entries: await publicSeriesStories(root.id) },
      chapter: null,
    };
  }
  const [[row]] = await getPool().query<any[]>(
    `${summarySql} JOIN blog_series_entries e ON e.series_id=s.id JOIN blog_posts p ON p.id=e.post_id WHERE p.path=? AND p.status='published' AND p.published_at<=UTC_TIMESTAMP(3) AND ${publicCondition}`,
    [path]
  );
  if (!row) return { root: null, chapter: null };
  const entries = await publicSeriesStories(row.id);
  return {
    root: null,
    chapter: {
      series: { ...summary(row), entries },
      index: entries.findIndex((entry) => entry.path === path),
    },
  };
}
export async function adminSeriesStories(id: string): Promise<SeriesStory[]> {
  const [rows] = await getPool().query<any[]>(
    `SELECT p.*,d.content AS draft_content FROM blog_posts p LEFT JOIN blog_post_drafts d ON d.post_id=p.id WHERE p.status<>'trash' AND NOT EXISTS(SELECT 1 FROM blog_series roots WHERE roots.root_post_id=p.id) AND (JSON_UNQUOTE(JSON_EXTRACT(p.metadata,'$.seriesId'))=? OR JSON_UNQUOTE(JSON_EXTRACT(d.content,'$.metadata.seriesId'))=?) ORDER BY p.published_at DESC,p.id DESC`,
    [id, id]
  );
  return rows
    .map((row) => {
      const draft = row.draft_content
        ? (metadata(row.draft_content) as any)
        : null;
      const info = draft?.metadata || metadata(row.metadata);
      return {
        id: row.id,
        title: draft?.title || row.title,
        path: row.path,
        description: draft?.description ?? row.description,
        context:
          typeof info.seriesContext === "string" ? info.seriesContext : "",
        publishedAt: draft?.publishedAt || iso(row.published_at)!,
        status: row.status,
        hasDraft: !!draft,
        seriesId: info.seriesId,
      };
    })
    .filter((row) => row.seriesId === id);
}
export async function listAdminSeries() {
  const [rows] = await getPool().query<any[]>(
    `${summarySql} ORDER BY s.updated_at DESC`
  );
  return Promise.all(
    rows.map(async (row) => {
      const entries = await adminSeriesStories(row.id);
      return {
        ...summary(row),
        draftCount: entries.filter(
          (entry) => entry.status === "draft" || entry.hasDraft
        ).length,
      };
    })
  );
}
export async function getAdminSeries(id: string): Promise<SeriesDetail> {
  const [[row]] = await getPool().query<any[]>(`${summarySql} WHERE s.id=?`, [
    id,
  ]);
  if (!row) throw new AppError(404, "系列不存在");
  const entries = await adminSeriesStories(id);
  return {
    ...summary(row),
    draftCount: entries.filter(
      (entry) => entry.status === "draft" || entry.hasDraft
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
    seriesId = id || randomUUID(),
    connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    if (id) {
      const [[row]] = await connection.query<any[]>(
        "SELECT * FROM blog_series WHERE id=? FOR UPDATE",
        [id]
      );
      if (!row) throw new AppError(404, "系列不存在");
      if (row.version !== version)
        throw new AppError(409, "系列已在其他窗口修改，请重新打开后再编辑");
      if (row.slug !== input.slug && !row.root_post_id) {
        const [[published]] = await connection.query<any[]>(
          "SELECT p.id FROM blog_series_entries e JOIN blog_posts p ON p.id=e.post_id WHERE e.series_id=? AND p.status='published' LIMIT 1",
          [id]
        );
        if (published)
          throw new AppError(
            400,
            "已有公开篇目的系列网址不能更改，以免旧链接失效"
          );
      }
      if (row.section !== input.section) {
        const [[entry]] = await connection.query<any[]>(
          `SELECT p.id FROM blog_posts p LEFT JOIN blog_post_drafts d ON d.post_id=p.id WHERE p.id=? OR JSON_UNQUOTE(JSON_EXTRACT(p.metadata,'$.seriesId'))=? OR JSON_UNQUOTE(JSON_EXTRACT(d.content,'$.metadata.seriesId'))=? LIMIT 1`,
          [row.root_post_id, id, id]
        );
        if (entry)
          throw new AppError(400, "已有篇目的系列不能更换栏目，请先移出篇目");
      }
      await connection.query(
        "UPDATE blog_series SET title=?,slug=?,description=?,section=?,status=?,state=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [
          input.title,
          input.slug,
          input.description,
          input.section,
          input.status,
          input.state,
          id,
        ]
      );
    } else
      await connection.query(
        "INSERT INTO blog_series(id,title,slug,description,section,status,state,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [
          seriesId,
          input.title,
          input.slug,
          input.description,
          input.section,
          input.status,
          input.state,
        ]
      );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if ((error as any)?.code === "ER_DUP_ENTRY")
      throw new AppError(409, "这个系列网址已被使用");
    throw error;
  } finally {
    connection.release();
  }
  return getAdminSeries(seriesId);
}
export async function newSeriesEntryInput(id: string): Promise<PostInput> {
  const series = await getAdminSeries(id),
    now = new Date();
  return {
    title: "未命名手记",
    section: series.section,
    year: String(now.getFullYear()),
    slug: `post-${randomUUID().slice(0, 8)}`,
    markdown: "",
    description: "",
    category: "",
    tags: [],
    publishedAt: now.toISOString(),
    contentUpdatedAt: null,
    externalUrl: "",
    coverUrl: "",
    canonicalUrl: "",
    featured: false,
    metadata: { seriesId: id },
  };
}
/** Membership changes become public atomically with article publication. */
export async function syncSeriesMembership(
  tx: Tx,
  postId: string,
  input: PostInput
) {
  const raw = input.metadata.seriesId;
  const seriesId =
    raw === undefined || raw === ""
      ? null
      : z.string().uuid("请选择有效的系列").parse(raw);
  if (!seriesId) {
    await tx.delete(seriesEntries).where(eq(seriesEntries.postId, postId));
    return;
  }
  const [series] = await tx
    .select()
    .from(seriesCollections)
    .where(eq(seriesCollections.id, seriesId))
    .for("update");
  if (!series) throw new AppError(400, "所选系列不存在，请重新选择");
  const [rootCollection] = await tx
    .select({ id: seriesCollections.id })
    .from(seriesCollections)
    .where(eq(seriesCollections.rootPostId, postId))
    .limit(1);
  if (rootCollection)
    throw new AppError(400, "系列入口不能加入任何系列作为篇目");
  if (series.rootPostId === postId)
    throw new AppError(400, "系列入口不能作为自己的篇目");
  if (series.section !== input.section)
    throw new AppError(400, "篇目栏目需要与系列栏目一致");
  if (input.externalUrl)
    throw new AppError(400, "系列篇目需要有本站正文，不能使用外链文章");
  const context = input.metadata.seriesContext;
  if (context !== undefined)
    z.string().max(200, "系列附注不能超过200字").parse(context);
  await tx
    .insert(seriesEntries)
    .values({ postId, seriesId })
    .onDuplicateKeyUpdate({ set: { seriesId } });
}
