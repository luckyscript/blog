import {
  mysqlTable,
  varchar,
  text,
  longtext,
  int,
  boolean,
  datetime,
  json,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import type { PostInput } from "../lib/server/content-input";
import type { Platform, SyncState, MomentMedia } from "../lib/moments/types";

const id = () => varchar("id", { length: 36 }).primaryKey();
const time = (name: string) => datetime(name, { mode: "date", fsp: 3 });
export const users = mysqlTable("blog_users", {
  id: id(),
  email: varchar("email", { length: 190 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: time("created_at").notNull(),
});
export const sessions = mysqlTable("blog_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
});
export const loginAttempts = mysqlTable("blog_login_attempts", {
  key: varchar("attempt_key", { length: 64 }).primaryKey(),
  count: int("count").notNull(),
  resetsAt: time("resets_at").notNull(),
});
export const categories = mysqlTable("blog_categories", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const tags = mysqlTable("blog_tags", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});
export const posts = mysqlTable(
  "blog_posts",
  {
    id: id(),
    section: varchar("section", { length: 20 }).notNull(),
    year: varchar("year", { length: 4 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    path: varchar("path", { length: 512 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    markdown: longtext("markdown").notNull(),
    description: text("description").notNull(),
    categoryId: varchar("category_id", { length: 36 }).references(
      () => categories.id,
      { onDelete: "set null" }
    ),
    authorId: varchar("author_id", { length: 36 })
      .notNull()
      .references(() => users.id),
    status: varchar("status", { length: 16 }).notNull(),
    featured: boolean("featured").notNull().default(false),
    externalUrl: text("external_url").notNull(),
    coverUrl: text("cover_url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    publishedAt: time("published_at").notNull(),
    contentUpdatedAt: time("content_updated_at"),
    createdAt: time("created_at").notNull(),
    updatedAt: time("updated_at").notNull(),
    version: int("version").notNull().default(1),
    sourcePath: varchar("source_path", { length: 512 }).unique(),
  },
  (table) => [
    index("blog_posts_public").on(
      table.status,
      table.section,
      table.publishedAt
    ),
  ]
);
export const postTags = mysqlTable(
  "blog_post_tags",
  {
    postId: varchar("post_id", { length: 36 })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: varchar("tag_id", { length: 36 })
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tagId] })]
);
export const drafts = mysqlTable("blog_post_drafts", {
  postId: varchar("post_id", { length: 36 })
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  content: json("content").$type<PostInput>().notNull(),
  updatedAt: time("updated_at").notNull(),
});
export const revisions = mysqlTable("blog_post_revisions", {
  id: id(),
  postId: varchar("post_id", { length: 36 })
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  content: json("content").$type<PostInput>().notNull(),
  action: varchar("action", { length: 24 }).notNull(),
  createdAt: time("created_at").notNull(),
});
export const redirects = mysqlTable("blog_redirects", {
  path: varchar("path", { length: 512 }).primaryKey(),
  postId: varchar("post_id", { length: 36 })
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
});
export const media = mysqlTable(
  "blog_media",
  {
    id: id(),
    name: varchar("name", { length: 255 }).notNull(),
    key: varchar("storage_key", { length: 512 }).notNull(),
    url: text("url").notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size: int("size").notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    sha: varchar("sha", { length: 64 }),
    alt: varchar("alt", { length: 500 }).notNull().default(""),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: time("created_at").notNull(),
  },
  (table) => [uniqueIndex("blog_media_checksum").on(table.checksum)]
);

export const momentSources = mysqlTable("blog_moment_sources", {
  id: varchar("id", { length: 190 }).primaryKey(),
  platform: varchar("platform", { length: 16 }).$type<Platform>().notNull(),
  account: varchar("account", { length: 128 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  syncState: json("sync_state").$type<SyncState>().notNull(),
  lastAttemptAt: time("last_attempt_at"), lastSuccessAt: time("last_success_at"),
  lastError: varchar("last_error", { length: 255 }), createdAt: time("created_at").notNull(),
}, table => [uniqueIndex("blog_moment_source_account").on(table.platform, table.account)]);
export const moments = mysqlTable("blog_moments", {
  id: id(), sourceId: varchar("source_id", { length: 190 }).notNull().references(() => momentSources.id),
  externalId: varchar("external_id", { length: 128 }).notNull(), sourceUrl: text("source_url").notNull(),
  title: varchar("title", { length: 500 }).notNull(), text: longtext("body_text").notNull(), html: longtext("body_html").notNull(),
  media: json("media").$type<MomentMedia[]>().notNull(), tags: json("tags").$type<string[]>().notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("published"),
  publishedAt: time("published_at").notNull(), firstSeenAt: time("first_seen_at").notNull(), lastSeenAt: time("last_seen_at").notNull(),
}, table => [uniqueIndex("blog_moments_external").on(table.sourceId, table.externalId), index("blog_moments_public").on(table.status, table.publishedAt, table.id)]);
export const momentSyncRuns = mysqlTable("blog_moment_sync_runs", {
  id: id(), sourceId: varchar("source_id", { length: 190 }).notNull().references(() => momentSources.id),
  startedAt: time("started_at").notNull(), finishedAt: time("finished_at"), outcome: varchar("outcome", { length: 16 }).notNull(),
  pages: int("pages").notNull().default(0), received: int("received").notNull().default(0), changed: int("changed").notNull().default(0),
  error: varchar("error", { length: 255 }),
}, table => [index("blog_moment_runs_source").on(table.sourceId, table.startedAt)]);
