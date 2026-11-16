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
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import type { MomentForm } from "../lib/admin/moment-writing";
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
export const curatedLinks = mysqlTable('blog_links', {
  id: id(), name:varchar('name',{length:160}).notNull(),url:text('url').notNull(),
  description:varchar('description',{length:500}).notNull().default(''),category:varchar('category',{length:100}).notNull(),
  status:varchar('status',{length:16}).notNull(),sortOrder:int('sort_order').notNull().default(0),visits:int('visits').notNull().default(0),
  sourceKey:varchar('source_key',{length:64}).unique(),version:int('version').notNull().default(1),createdAt:time('created_at').notNull(),updatedAt:time('updated_at').notNull(),
},table=>[index('blog_links_public').on(table.status,table.sortOrder,table.createdAt)]);
export const linkHealth = mysqlTable('blog_link_health', {
  linkId:varchar('link_id',{length:36}).primaryKey().references(()=>curatedLinks.id,{onDelete:'cascade'}),
  urlHash:varchar('url_hash',{length:64}).notNull(),state:varchar('state',{length:16}).notNull(),
  httpStatus:int('http_status'),latencyMs:int('latency_ms'),reason:varchar('reason',{length:24}).notNull().default(''),checkedAt:time('checked_at').notNull(),
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
export const momentDrafts = mysqlTable('blog_moment_drafts', {
  momentId: varchar('moment_id', { length: 36 }).primaryKey().references(() => moments.id, { onDelete: 'cascade' }),
  content: json('content').$type<MomentForm>().notNull(),
  updatedAt: time('updated_at').notNull(),
}, table => [index('blog_moment_draft_updated').on(table.updatedAt)]);
// Separate visibility metadata leaves imported content and publication status intact.
export const momentDuplicates = mysqlTable("blog_moment_duplicates", {
  momentId: varchar("moment_id", { length: 36 }).primaryKey().references(() => moments.id, { onDelete: "cascade" }),
  duplicateOf: varchar("duplicate_of", { length: 36 }).notNull().references(() => moments.id, { onDelete: "cascade" }),
  reason: varchar("reason", { length: 16 }).notNull(),
}, table => [index("blog_moment_duplicate_original").on(table.duplicateOf)]);
export const comments = mysqlTable('blog_comments', {
  id: id(),
  postId: varchar('post_id', { length: 36 }).references(() => posts.id, { onDelete: 'cascade' }),
  momentId: varchar('moment_id', { length: 36 }).references(() => moments.id, { onDelete: 'cascade' }),
  seriesNoteId: varchar('series_note_id', { length: 36 }).references(() => seriesNotes.id, { onDelete: 'cascade' }),
  parentId: varchar('parent_id', { length: 36 }).references((): AnyMySqlColumn => comments.id, { onDelete: 'cascade' }),
  authorId: varchar('author_id', { length: 36 }).references(() => users.id, { onDelete: 'set null' }),
  name: varchar('author_name', { length: 60 }).notNull(),
  email: varchar('author_email', { length: 254 }).notNull().default(''),
  body: text('body').notNull(),
  status: varchar('status', { length: 16 }).$type<'pending' | 'approved' | 'trash'>().notNull().default('pending'),
  version: int('version').notNull().default(1),
  createdAt: time('created_at').notNull(), updatedAt: time('updated_at').notNull(),
}, table => [index('blog_comments_post').on(table.postId, table.status, table.createdAt), index('blog_comments_moment').on(table.momentId, table.status, table.createdAt), index('blog_comments_series_note').on(table.seriesNoteId, table.status, table.createdAt), index('blog_comments_review').on(table.status, table.createdAt), index('blog_comments_parent').on(table.parentId)]);
export const commentLimits = mysqlTable('blog_comment_limits', {
  key: varchar('rate_key', { length: 64 }).primaryKey(),
  attempts: int('attempts').notNull(), resetsAt: time('resets_at').notNull(),
}, table => [index('blog_comment_limit_expiry').on(table.resetsAt)]);

export const momentSyncRuns = mysqlTable("blog_moment_sync_runs", {
  id: id(), sourceId: varchar("source_id", { length: 190 }).notNull().references(() => momentSources.id),
  startedAt: time("started_at").notNull(), finishedAt: time("finished_at"), outcome: varchar("outcome", { length: 16 }).notNull(),
  pages: int("pages").notNull().default(0), received: int("received").notNull().default(0), changed: int("changed").notNull().default(0),
  error: varchar("error", { length: 255 }),
}, table => [index("blog_moment_runs_source").on(table.sourceId, table.startedAt)]);


export const analyticsViews = mysqlTable('blog_analytics_views', {
  id:id(),visitorKey:varchar('visitor_key',{length:64}).notNull(),sessionKey:varchar('session_key',{length:64}).notNull(),
  path:varchar('path',{length:512}).notNull(),category:varchar('category',{length:24}).notNull(),
  referrerHost:varchar('referrer_host',{length:255}).notNull().default(''),referrerPath:varchar('referrer_path',{length:512}).notNull().default(''),
  utmSource:varchar('utm_source',{length:80}).notNull().default(''),utmMedium:varchar('utm_medium',{length:80}).notNull().default(''),utmCampaign:varchar('utm_campaign',{length:80}).notNull().default(''),
  device:varchar('device',{length:16}).notNull(),browser:varchar('browser',{length:32}).notNull(),os:varchar('os',{length:32}).notNull(),
  country:varchar('country',{length:2}).notNull().default(''),region:varchar('region',{length:80}).notNull().default(''),city:varchar('city',{length:80}).notNull().default(''),
  language:varchar('language',{length:20}).notNull().default(''),viewportWidth:int('viewport_width').notNull().default(0),viewportHeight:int('viewport_height').notNull().default(0),
  startedAt:time('started_at').notNull(),lastSeenAt:time('last_seen_at').notNull(),durationMs:int('duration_ms').notNull().default(0),scrollPercent:int('scroll_percent').notNull().default(0),interactions:int('interactions').notNull().default(0),
  lcpMs:int('lcp_ms'),inpMs:int('inp_ms'),clsMilli:int('cls_milli'),fcpMs:int('fcp_ms'),ttfbMs:int('ttfb_ms'),
},table=>[index('blog_analytics_started').on(table.startedAt),index('blog_analytics_active').on(table.lastSeenAt),index('blog_analytics_visitor').on(table.visitorKey,table.startedAt),index('blog_analytics_session').on(table.sessionKey,table.startedAt),index('blog_analytics_category').on(table.category,table.startedAt)]);
export const analyticsEvents = mysqlTable('blog_analytics_events', {
  id:id(),viewId:varchar('view_id',{length:36}).notNull().references(()=>analyticsViews.id,{onDelete:'cascade'}),
  type:varchar('type',{length:32}).notNull(),target:varchar('target',{length:512}).notNull().default(''),label:varchar('label',{length:40}).notNull().default(''),value:int('value').notNull().default(0),createdAt:time('created_at').notNull(),
},table=>[index('blog_analytics_event_time').on(table.createdAt),index('blog_analytics_event_type').on(table.type,table.createdAt),index('blog_analytics_event_view').on(table.viewId)]);

export const seriesCollections = mysqlTable('blog_series', {
  id: id(), slug: varchar('slug', {length:120}).notNull().unique(),
  title: varchar('title', {length:160}).notNull(), description: text('description').notNull(),
  section: varchar('section', {length:20}).notNull().default('blog'),
  status: varchar('status', {length:16}).notNull().default('draft'),
  state: varchar('state', {length:16}).notNull().default('ongoing'),
  rootPostId: varchar('root_post_id', {length:36}).unique().references(()=>posts.id, {onDelete:'restrict'}),
  version: int('version').notNull().default(1), createdAt:time('created_at').notNull(),updatedAt:time('updated_at').notNull(),
},table=>[index('blog_series_public').on(table.status,table.section,table.updatedAt)]);
export const seriesEntries = mysqlTable('blog_series_entries', {
  postId:varchar('post_id',{length:36}).primaryKey().references(()=>posts.id,{onDelete:'cascade'}),
  seriesId:varchar('series_id',{length:36}).notNull().references(()=>seriesCollections.id,{onDelete:'cascade'}),
},table=>[index('blog_series_entry_collection').on(table.seriesId,table.postId)]);
export const seriesNotes = mysqlTable('blog_series_notes', {
  id: id(), seriesId: varchar('series_id', {length:36}).notNull().references(()=>seriesCollections.id, {onDelete:'restrict'}),
  slug: varchar('slug', {length:180}).notNull(), title: varchar('title', {length:255}).notNull(), markdown: longtext('markdown').notNull(),
  description: text('description').notNull(), context: varchar('context', {length:200}).notNull().default(''), status: varchar('status', {length:16}).notNull().default('draft'),
  publishedAt: time('published_at').notNull(), contentUpdatedAt: time('content_updated_at'), createdAt: time('created_at').notNull(), updatedAt: time('updated_at').notNull(), version: int('version').notNull().default(1),
},table=>[uniqueIndex('blog_series_note_slug').on(table.seriesId,table.slug),index('blog_series_notes_public').on(table.seriesId,table.status,table.publishedAt)]);
