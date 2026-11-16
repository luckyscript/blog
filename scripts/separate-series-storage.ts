import { createHash } from "node:crypto";
import { getPool, closeDatabase } from "../src/db";
import { seriesJson } from "../src/lib/server/series";
const toNote = (v: any) => ({
  title: v.title || "",
  slug: v.slug || "",
  markdown: v.markdown || "",
  description: v.description || "",
  context:
    typeof v.metadata?.seriesContext === "string"
      ? v.metadata.seriesContext
      : "",
  publishedAt: v.publishedAt,
});
async function main() {
  const apply = process.argv.includes("--apply"),
    db = await getPool().getConnection();
  try {
    await db.beginTransaction();
    const [groups] = await db.query<any[]>(
      "SELECT * FROM blog_series ORDER BY id FOR UPDATE"
    );
    let count = 0;
    const checks = [];
    for (const group of groups) {
      const [rows] = await db.query<any[]>(
        `SELECT p.*,e.series_id AS live_series,d.content AS pending_content FROM blog_posts p LEFT JOIN blog_series_entries e ON e.post_id=p.id LEFT JOIN blog_post_drafts d ON d.post_id=p.id WHERE p.id<>COALESCE(?, '') AND (e.series_id=? OR JSON_UNQUOTE(JSON_EXTRACT(p.metadata,'$.seriesId'))=? OR JSON_UNQUOTE(JSON_EXTRACT(d.content,'$.metadata.seriesId'))=?) ORDER BY p.id FOR UPDATE`,
        [group.root_post_id, group.id, group.id, group.id]
      );
      for (const row of rows) {
        if (row.pending_content) {
          const pending = seriesJson(row.pending_content).metadata?.seriesId;
          if (!row.live_series && pending !== group.id) continue;
          if (row.live_series && pending !== row.live_series)
            throw new Error("存在待发布的跨系列归属变更，请先处理后再迁移");
        }

        const [[existing]] = await db.query<any[]>(
          "SELECT id FROM blog_series_notes WHERE id=?",
          [row.id]
        );
        if (existing) {
          if (row.status !== "series")
            throw new Error("系列迁移状态异常，请核对");
          continue;
        }
        if (row.status === "series") throw new Error("系列归档缺少独立篇目");
        count++;
        checks.push({
          id: row.id,
          sha256: createHash("sha256").update(row.markdown).digest("hex"),
        });
        if (!apply) continue;
        const meta = seriesJson(row.metadata),
          context =
            typeof meta.seriesContext === "string" ? meta.seriesContext : "";
        await db.query(
          "INSERT INTO blog_series_notes(id,series_id,slug,title,markdown,description,context,status,published_at,content_updated_at,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            row.id,
            group.id,
            row.slug,
            row.title,
            row.markdown,
            row.description,
            context,
            row.status,
            row.published_at,
            row.content_updated_at,
            row.created_at,
            row.updated_at,
            row.version,
          ]
        );
        const [[draft]] = await db.query<any[]>(
          "SELECT content,updated_at FROM blog_post_drafts WHERE post_id=?",
          [row.id]
        );
        if (draft)
          await db.query(
            "INSERT INTO blog_series_note_drafts(note_id,content,updated_at) VALUES(?,?,?)",
            [
              row.id,
              JSON.stringify(toNote(seriesJson(draft.content))),
              draft.updated_at,
            ]
          );
        const [history] = await db.query<any[]>(
          "SELECT * FROM blog_post_revisions WHERE post_id=?",
          [row.id]
        );
        for (const h of history)
          await db.query(
            "INSERT INTO blog_series_note_revisions(id,note_id,content,action,created_at) VALUES(?,?,?,?,?)",
            [
              h.id,
              row.id,
              JSON.stringify(toNote(seriesJson(h.content))),
              h.action,
              h.created_at,
            ]
          );
        await db.query(
          "INSERT INTO blog_series_paths(path,series_id,note_id) VALUES(?,?,?)",
          [row.path, group.id, row.id]
        );
        await db.query("UPDATE blog_posts SET status='series' WHERE id=?", [
          row.id,
        ]);
      }
      if (apply) {
        if (group.root_post_id) {
          const [[root]] = await db.query<any[]>(
            "SELECT path FROM blog_posts WHERE id=? FOR UPDATE",
            [group.root_post_id]
          );
          if (root) {
            await db.query(
              "INSERT IGNORE INTO blog_series_paths(path,series_id,note_id) VALUES(?,?,NULL)",
              [root.path, group.id]
            );
            await db.query("UPDATE blog_posts SET status='series' WHERE id=?", [
              group.root_post_id,
            ]);
          }
        }
        await db.query(
          "UPDATE blog_series SET section='series',root_post_id=NULL WHERE id=?",
          [group.id]
        );
      }
    }
    if (apply) {
      await db.query("UPDATE blog_comments c JOIN blog_series_notes n ON n.id=c.post_id SET c.series_note_id=n.id,c.post_id=NULL");
      await db.commit();
    }
    else await db.rollback();
    console.log(
      JSON.stringify({
        event: apply ? "series_storage_separated" : "series_storage_preview",
        collections: groups.length,
        migratedNotes: count,
        checks,
      })
    );
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "系列迁移失败");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
