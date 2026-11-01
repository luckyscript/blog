import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { categories, tags, posts, postTags, drafts } from "../../db/schema";
import { AppError } from "./errors";

export async function listTaxonomy() {
  const [categoryRows, tagRows, postRows, links, draftRows] = await Promise.all(
    [
      db().select().from(categories),
      db().select().from(tags),
      db().select({ id: posts.id, categoryId: posts.categoryId }).from(posts),
      db().select().from(postTags),
      db().select().from(drafts),
    ]
  );
  return {
    categories: categoryRows.map((row) => ({
      ...row,
      count: postRows.filter((post) => post.categoryId === row.id).length,
      drafts: draftRows.filter((draft) => draft.content.category === row.name)
        .length,
    })),
    tags: tagRows.map((row) => ({
      ...row,
      count: links.filter((link) => link.tagId === row.id).length,
      drafts: draftRows.filter((draft) => draft.content.tags.includes(row.name))
        .length,
    })),
  };
}

export async function changeTaxonomy(
  kind: "categories" | "tags",
  action: string,
  id: string,
  name: string
) {
  const table = kind === "categories" ? categories : tags;
  if (action !== "delete" && (!name.trim() || name.length > 100))
    throw new AppError(400, "名称需要 1 至 100 个字符");
  await db().transaction(async (tx) => {
    if (action === "create") {
      await tx.insert(table).values({ id: randomUUID(), name: name.trim() });
      return;
    }
    const [row] = await tx
      .select()
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    if (!row) throw new AppError(404, "分类或标签不存在");
    const draftRows = await tx.select().from(drafts);
    const affected = draftRows.filter((draft) =>
      kind === "categories"
        ? draft.content.category === row.name
        : draft.content.tags.includes(row.name)
    );
    if (action === "delete") {
      const usage =
        kind === "categories"
          ? await tx
              .select({ id: posts.id })
              .from(posts)
              .where(eq(posts.categoryId, id))
          : await tx
              .select({ id: postTags.postId })
              .from(postTags)
              .where(eq(postTags.tagId, id));
      if (usage.length || affected.length)
        throw new AppError(409, "仍有文章或草稿使用这个名称，请先在文章中移除");
      await tx.delete(table).where(eq(table.id, id));
    } else if (action === "rename") {
      await tx.update(table).set({ name: name.trim() }).where(eq(table.id, id));
      for (const draft of affected) {
        const content = { ...draft.content };
        if (kind === "categories") content.category = name.trim();
        else
          content.tags = content.tags.map((tag) =>
            tag === row.name ? name.trim() : tag
          );
        await tx
          .update(drafts)
          .set({ content, updatedAt: new Date() })
          .where(eq(drafts.postId, draft.postId));
        await tx
          .update(posts)
          .set({ version: sql`${posts.version} + 1` })
          .where(eq(posts.id, draft.postId));
      }
    } else throw new AppError(400, "操作不支持");
  });
  return listTaxonomy();
}
