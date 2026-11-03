import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../../db";
import {
  posts,
  drafts,
  revisions,
  categories,
  tags,
  postTags,
  redirects,
} from "../../db/schema";
import { AppError } from "./errors";
import { parsePost, postPath, type PostInput } from "./content-input";

type Store = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Store["transaction"]>[0]>[0];
type QueryStore = Store | Tx;
type PostRow = typeof posts.$inferSelect;

export async function hydrate(rows: PostRow[], store: QueryStore = db()) {
  if (!rows.length) return [];
  const [categoryRows, tagRows] = await Promise.all([
    store.select().from(categories),
    store
      .select({ postId: postTags.postId, name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(
        inArray(
          postTags.postId,
          rows.map((row) => row.id)
        )
      ),
  ]);
  return rows.map((row) => ({
    ...row,
    input: {
      title: row.title,
      section: row.section,
      year: row.year,
      slug: row.slug,
      markdown: row.markdown,
      description: row.description,
      category:
        categoryRows.find((category) => category.id === row.categoryId)?.name ??
        "",
      tags: tagRows
        .filter((tag) => tag.postId === row.id)
        .map((tag) => tag.name)
        .sort(),
      publishedAt: row.publishedAt.toISOString(),
      contentUpdatedAt: row.contentUpdatedAt?.toISOString() ?? null,
      externalUrl: row.externalUrl,
      coverUrl: row.coverUrl,
      canonicalUrl: row.canonicalUrl,
      featured: row.featured,
      metadata: row.metadata,
    } as PostInput,
  }));
}

export async function publicPosts(section?: string, year?: string) {
  const conditions = [
    eq(posts.status, "published"),
    lte(posts.publishedAt, new Date()),
  ];
  if (section) conditions.push(eq(posts.section, section));
  if (year) conditions.push(eq(posts.year, year));
  return hydrate(
    await db()
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.publishedAt))
  );
}

export async function recentPublicPosts(section: string, limit = 3) {
  return db().select({ year: posts.year, slug: posts.slug, title: posts.title, publishedAt: posts.publishedAt, externalUrl: posts.externalUrl })
    .from(posts).where(and(eq(posts.status, 'published'), eq(posts.section, section), lte(posts.publishedAt, new Date())))
    .orderBy(desc(posts.publishedAt)).limit(Math.min(20, Math.max(1, limit)));
}

export async function publicPost(path: string) {
  const [row] = await db()
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.path, path),
        eq(posts.status, "published"),
        lte(posts.publishedAt, new Date())
      )
    );
  if (!row) throw new AppError(404, "文章不存在或尚未发布");
  return (await hydrate([row]))[0];
}

export async function getPost(id: string) {
  const [row] = await db().select().from(posts).where(eq(posts.id, id));
  if (!row) throw new AppError(404, "文章不存在");
  const [draft] = await db().select().from(drafts).where(eq(drafts.postId, id));
  const live = (await hydrate([row]))[0];
  const history = await db()
    .select({
      id: revisions.id,
      action: revisions.action,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .where(eq(revisions.postId, id))
    .orderBy(desc(revisions.createdAt));
  return {
    id,
    path: row.path,
    status: row.status,
    version: row.version,
    input: draft?.content ?? live.input,
    hasDraft: Boolean(draft),
    draftUpdatedAt: draft?.updatedAt,
    revisions: history,
    sourcePath: row.sourcePath,
  };
}

export async function listPosts(
  search = "",
  section = "",
  status = "",
  page = 1
) {
  const rows = await db().select().from(posts).orderBy(desc(posts.updatedAt));
  const draftRows = await db().select().from(drafts);
  const items = rows.map((row) => {
    const draft = draftRows.find((item) => item.postId === row.id);
    return {
      id: row.id,
      title: draft?.content.title ?? row.title,
      section: draft?.content.section ?? row.section,
      path: row.path,
      status: row.status,
      hasDraft: Boolean(draft),
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      version: row.version,
    };
  });
  const counts = {
    all: items.filter((item) => item.status !== "trash").length,
    published: items.filter((item) => item.status === "published").length,
    draft: items.filter((item) => item.status === "draft").length,
    trash: items.filter((item) => item.status === "trash").length,
  };
  const filtered = items.filter(
    (item) =>
      (!search || item.title.toLowerCase().includes(search.toLowerCase())) &&
      (!section || item.section === section) &&
      (status ? item.status === status : item.status !== "trash")
  );
  return {
    items: filtered.slice((page - 1) * 20, page * 20),
    total: filtered.length,
    page,
    pages: Math.max(1, Math.ceil(filtered.length / 20)),
    counts,
  };
}

async function lockPost(tx: Tx, id: string, version: number) {
  const [row] = await tx
    .select()
    .from(posts)
    .where(eq(posts.id, id))
    .for("update");
  if (!row) throw new AppError(404, "文章不存在");
  if (row.version !== version)
    throw new AppError(
      409,
      "文章已在其他窗口修改，请刷新后再编辑。当前输入仍保留在本窗口。"
    );
  return row;
}

function liveFields(input: PostInput) {
  return {
    section: input.section,
    year: input.year,
    slug: input.slug,
    path: postPath(input),
    title: input.title,
    markdown: input.markdown,
    description: input.description,
    publishedAt: new Date(input.publishedAt),
    contentUpdatedAt: input.contentUpdatedAt
      ? new Date(input.contentUpdatedAt)
      : null,
    externalUrl: input.externalUrl,
    coverUrl: input.coverUrl,
    canonicalUrl: input.canonicalUrl,
    metadata: input.metadata,
    featured: input.featured,
  };
}

export async function saveDraft(
  id: string | null,
  value: unknown,
  version: number,
  authorId: string
) {
  const input = parsePost(value);
  const postId = id ?? randomUUID();
  await db().transaction(async (tx) => {
    const now = new Date();
    if (id) {
      const row = await lockPost(tx, id, version);
      if (row.status === "trash")
        throw new AppError(409, "请先从回收站恢复文章");
      await tx
        .update(posts)
        .set({ version: row.version + 1, updatedAt: now })
        .where(eq(posts.id, id));
    } else {
      await assertPathAvailable(tx, postPath(input), postId);
      await tx.insert(posts).values({
        id: postId,
        ...liveFields(input),
        categoryId: null,
        authorId,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
    await tx
      .insert(drafts)
      .values({ postId, content: input, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { content: input, updatedAt: now } });
  });
  return getPost(postId);
}

async function assertPathAvailable(tx: Tx, path: string, id: string) {
  const [existing] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.path, path));
  const [redirect] = await tx
    .select()
    .from(redirects)
    .where(eq(redirects.path, path));
  if ((existing && existing.id !== id) || (redirect && redirect.postId !== id))
    throw new AppError(409, "这个文章地址已被使用，请更换路径名称");
}

async function applyTaxonomy(tx: Tx, postId: string, input: PostInput) {
  let categoryId: string | null = null;
  if (input.category) {
    await tx
      .insert(categories)
      .values({ id: randomUUID(), name: input.category })
      .onDuplicateKeyUpdate({ set: { name: input.category } });
    const [row] = await tx
      .select()
      .from(categories)
      .where(eq(categories.name, input.category));
    categoryId = row.id;
  }
  await tx.delete(postTags).where(eq(postTags.postId, postId));
  for (const name of input.tags) {
    await tx
      .insert(tags)
      .values({ id: randomUUID(), name })
      .onDuplicateKeyUpdate({ set: { name } });
    const [row] = await tx.select().from(tags).where(eq(tags.name, name));
    await tx
      .insert(postTags)
      .values({ postId, tagId: row.id })
      .onDuplicateKeyUpdate({ set: { tagId: row.id } });
  }
  return categoryId;
}

export async function publishPost(id: string, version: number) {
  await db().transaction(async (tx) => {
    const row = await lockPost(tx, id, version);
    if (row.status === "trash") throw new AppError(409, "请先恢复文章");
    const [draft] = await tx.select().from(drafts).where(eq(drafts.postId, id));
    const input = parsePost(
      draft?.content ?? (await hydrate([row], tx))[0].input
    );
    if (new Date(input.publishedAt).getTime() > Date.now() + 60_000)
      throw new AppError(400, "第一版支持立即发布，请选择当前或过去的发布时间");
    if (!input.externalUrl && !input.markdown.trim())
      throw new AppError(400, "请先填写正文");
    if (input.section === "projects" && !input.externalUrl)
      throw new AppError(400, "项目栏目通过外链展示，请填写项目地址");
    const path = postPath(input);
    await assertPathAvailable(tx, path, id);
    if (path !== row.path) {
      await tx
        .insert(redirects)
        .values({ path: row.path, postId: id })
        .onDuplicateKeyUpdate({ set: { postId: id } });
    }
    await tx
      .delete(redirects)
      .where(and(eq(redirects.path, path), eq(redirects.postId, id)));
    const now = new Date();
    const published = {
      ...input,
      contentUpdatedAt:
        row.status === "published" ? now.toISOString() : input.contentUpdatedAt,
    };
    const categoryId = await applyTaxonomy(tx, id, published);
    await tx
      .update(posts)
      .set({
        ...liveFields(published),
        categoryId,
        status: "published",
        updatedAt: now,
        version: row.version + 1,
      })
      .where(eq(posts.id, id));
    await tx.insert(revisions).values({
      id: randomUUID(),
      postId: id,
      content: published,
      action: "publish",
      createdAt: now,
    });
    await tx.delete(drafts).where(eq(drafts.postId, id));
  });
  return getPost(id);
}

export async function changeStatus(
  id: string,
  version: number,
  action: "unpublish" | "trash" | "restore"
) {
  await db().transaction(async (tx) => {
    const row = await lockPost(tx, id, version);
    // Article deletion only changes visibility; keep the row and all related data.
    if (action === "trash" && row.status === "trash") return;
    if (action === "restore" && row.status !== "trash")
      throw new AppError(400, "这篇文章不在回收站");
    if (action === "unpublish" && row.status !== "published")
      throw new AppError(400, "这篇文章尚未发布");
    const now = new Date();
    await tx
      .update(posts)
      .set({
        status: action === "trash" ? "trash" : "draft",
        updatedAt: now,
        version: row.version + 1,
      })
      .where(eq(posts.id, id));
    await tx.insert(revisions).values({
      id: randomUUID(),
      postId: id,
      content: (await hydrate([row], tx))[0].input,
      action,
      createdAt: now,
    });
  });
  return getPost(id);
}

export async function restoreRevision(
  id: string,
  revisionId: string,
  version: number,
  authorId: string
) {
  const [revision] = await db()
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.postId, id)));
  if (!revision) throw new AppError(404, "历史版本不存在");
  return saveDraft(id, revision.content, version, authorId);
}

export async function importPost(
  input: PostInput,
  sourcePath: string,
  isDraft: boolean,
  authorId: string
) {
  const [existing] = await db()
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.sourcePath, sourcePath));
  if (existing) return { skipped: true, id: existing.id };
  const parsed = parsePost(input);
  const id = randomUUID();
  await db().transaction(async (tx) => {
    await assertPathAvailable(tx, postPath(parsed), id);
    const now = new Date();
    await tx.insert(posts).values({
      id,
      ...liveFields(parsed),
      authorId,
      categoryId: null,
      status: isDraft ? "draft" : "published",
      createdAt: now,
      updatedAt: now,
      sourcePath,
      version: 1,
    });
    const categoryId = await applyTaxonomy(tx, id, parsed);
    await tx.update(posts).set({ categoryId }).where(eq(posts.id, id));
    if (isDraft)
      await tx
        .insert(drafts)
        .values({ postId: id, content: parsed, updatedAt: now });
    await tx.insert(revisions).values({
      id: randomUUID(),
      postId: id,
      content: parsed,
      action: "import",
      createdAt: now,
    });
  });
  return { skipped: false, id };
}

export async function exportPosts() {
  const rows = await hydrate(await db().select().from(posts));
  const draftRows = await db().select().from(drafts);
  return {
    exportedAt: new Date().toISOString(),
    format: 1,
    posts: rows.map((row) => ({
      id: row.id,
      status: row.status,
      path: row.path,
      input: row.input,
      draft:
        draftRows.find((draft) => draft.postId === row.id)?.content ?? null,
    })),
  };
}
