import { randomUUID, createHash } from "node:crypto";
import { getPool, closeDatabase } from "../src/db";
import { splitDriverNotes } from "../src/lib/series/driver-import";
import type { PostInput } from "../src/lib/server/content-input";

async function main() {
  const apply = process.argv.includes("--apply"),
    connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [[root]] = await connection.query<any[]>(
      "SELECT * FROM blog_posts WHERE path='/blog/2023/passenger-and-drivers' FOR UPDATE"
    );
    if (!root || root.status !== "published")
      throw new Error("找不到已发布的《乘客与司机》原文");
    const [[draft]] = await connection.query<any[]>(
      "SELECT post_id FROM blog_post_drafts WHERE post_id=?",
      [root.id]
    );
    if (draft) throw new Error("原文有未发布草稿，请先处理，避免迁移错版本");
    const parsed = splitDriverNotes(root.markdown);
    const [[existing]] = await connection.query<any[]>(
      "SELECT id,title,status FROM blog_series WHERE root_post_id=?",
      [root.id]
    );
    if (existing) {
      const [[count]] = await connection.query<any[]>(
        `SELECT COUNT(*) AS total,SUM(p.status='published') AS published FROM blog_series_entries e JOIN blog_posts p ON p.id=e.post_id WHERE e.series_id=?`,
        [existing.id]
      );
      if (
        Number(count.total) !== 3 ||
        Number(count.published) !== 3 ||
        existing.status !== "published"
      )
        throw new Error("系列已存在但状态与迁移预期不符，请人工核对");
      await connection.rollback();
      console.log(
        JSON.stringify({
          event: "driver_series_already_migrated",
          seriesId: existing.id,
          chapters: Number(count.total),
        })
      );
      return;
    }
    const fingerprint = createHash("sha256")
      .update(root.markdown)
      .digest("hex");
    if (!apply) {
      await connection.rollback();
      console.log(
        JSON.stringify(
          {
            event: "driver_series_preview",
            originalPath: root.path,
            originalSha256: fingerprint,
            title: "乘客与司机",
            chapters: parsed.chapters.map(({ title, publishedAt, slug }) => ({
              title,
              publishedAt,
              slug,
            })),
          },
          null,
          2
        )
      );
      return;
    }
    const seriesId = randomUUID(),
      now = new Date();
    await connection.query(
      "INSERT INTO blog_series(id,slug,title,description,section,status,state,root_post_id,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",
      [
        seriesId,
        "passenger-and-drivers",
        "乘客与司机",
        parsed.description,
        "blog",
        "published",
        "ongoing",
        root.id,
        now,
        now,
      ]
    );
    const ids: string[] = [];
    const [tags] = await connection.query<any[]>(
      "SELECT t.name,t.id FROM blog_tags t JOIN blog_post_tags pt ON pt.tag_id=t.id WHERE pt.post_id=?",
      [root.id]
    );
    const [[category]] = await connection.query<any[]>(
      "SELECT name FROM blog_categories WHERE id=?",
      [root.category_id]
    );
    for (const chapter of parsed.chapters) {
      const id = randomUUID(),
        path = `/blog/${chapter.year}/${chapter.slug}`;
      const metadata = { seriesId, seriesContext: chapter.context };
      const input: PostInput = {
        title: chapter.title,
        section: "blog",
        year: chapter.year,
        slug: chapter.slug,
        markdown: chapter.markdown,
        description: chapter.description,
        category: category?.name || "",
        tags: tags.map((tag) => tag.name),
        publishedAt: chapter.publishedAt,
        contentUpdatedAt: null,
        externalUrl: "",
        coverUrl: "",
        canonicalUrl: "",
        featured: false,
        metadata,
      };
      await connection.query(
        `INSERT INTO blog_posts(id,section,year,slug,path,title,markdown,description,category_id,author_id,status,featured,external_url,cover_url,canonical_url,metadata,published_at,content_updated_at,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,'published',0,'','','',?,?,NULL,?,?,1)`,
        [
          id,
          "blog",
          chapter.year,
          chapter.slug,
          path,
          chapter.title,
          chapter.markdown,
          chapter.description,
          root.category_id,
          root.author_id,
          JSON.stringify(metadata),
          new Date(chapter.publishedAt),
          now,
          now,
        ]
      );
      await connection.query(
        "INSERT INTO blog_series_entries(post_id,series_id) VALUES(?,?)",
        [id, seriesId]
      );
      for (const tag of tags)
        await connection.query(
          "INSERT INTO blog_post_tags(post_id,tag_id) VALUES(?,?)",
          [id, tag.id]
        );
      await connection.query(
        "INSERT INTO blog_post_revisions(id,post_id,content,action,created_at) VALUES(?,?,?,?,?)",
        [randomUUID(), id, JSON.stringify(input), "migrate-series", now]
      );
      ids.push(id);
    }
    await connection.commit();
    console.log(
      JSON.stringify({
        event: "driver_series_migrated",
        seriesId,
        originalId: root.id,
        originalPath: root.path,
        originalSha256: fingerprint,
        chapterIds: ids,
        chapters: parsed.chapters.length,
      })
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "系列迁移失败");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
