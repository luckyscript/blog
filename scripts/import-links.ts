import { createHash, randomUUID } from "node:crypto";
import Markdoc from "@markdoc/markdoc";
import { db, closeDatabase } from "../src/db";
import { curatedLinks } from "../src/db/schema";
import { publicPosts } from "../src/lib/server/posts";
import { safeLinkUrl } from "../src/lib/server/links";

const apply = process.argv.includes("--apply");
function label(node: any): string {
  return node.type === "text"
    ? node.attributes.content
    : (node.children || []).map(label).join("");
}
try {
  const wanted = new Map<string, typeof curatedLinks.$inferInsert>();
  let skipped = 0;
  for (const post of (await publicPosts("link")).sort((a, b) =>
    a.slug.localeCompare(b.slug)
  )) {
    const category = post.input.metadata.pageContent ? "友情链接" : post.title;
    const candidates: { name: string; url: string; description: string }[] = [];
    if (post.externalUrl)
      candidates.push({
        name: post.title,
        url: post.externalUrl,
        description: post.description,
      });
    for (const node of Markdoc.parse(post.markdown).walk())
      if (node.type === "link")
        candidates.push({
          name: label(node).trim(),
          url: node.attributes.href,
          description: "",
        });
    for (const candidate of candidates) {
      let url: string;
      try {
        url = safeLinkUrl(candidate.url);
      } catch {
        skipped++;
        continue;
      }
      const sourceKey = createHash("sha256").update(url).digest("hex");
      if (wanted.has(sourceKey)) continue;
      wanted.set(sourceKey, {
        id: randomUUID(),
        name: (candidate.name || new URL(url).hostname).slice(0, 160),
        url,
        description: candidate.description.slice(0, 500),
        category: category.slice(0, 100),
        sortOrder: category === "友情链接" ? -10 : 0,
        status: "published",
        sourceKey,
        version: 1,
        visits: 0,
        createdAt: post.publishedAt,
        updatedAt: new Date(),
      });
    }
  }
  const existing = await db()
    .select({ sourceKey: curatedLinks.sourceKey })
    .from(curatedLinks);
  const pending = [...wanted.values()].filter(
    (item) => !existing.some((row) => row.sourceKey === item.sourceKey)
  );
  if (apply && pending.length)
    await db().transaction(async (tx) => {
      for (const row of pending)
        await tx
          .insert(curatedLinks)
          .values(row)
          .onDuplicateKeyUpdate({ set: { sourceKey: row.sourceKey } });
    });
  console.log(
    JSON.stringify({
      event: "curated_links_import",
      mode: apply ? "apply" : "dry-run",
      found: wanted.size,
      added: apply ? pending.length : 0,
      pending: pending.length,
      skipped,
      originalPostsPreserved: true,
    })
  );
} finally {
  await closeDatabase();
}
