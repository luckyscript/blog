import { z } from "zod";

export const sections = [
  "blog",
  "tech",
  "sight",
  "link",
  "ppt",
  "projects",
  "life",
  "card",
] as const;
export const sectionLabels: Record<string, string> = {
  blog: "生活",
  tech: "技术",
  sight: "观察",
  link: "链接",
  ppt: "PPT",
  projects: "项目",
  life: "生活随记",
  card: "卡片",
};
const optionalUrl = z
  .string()
  .max(2000)
  .default("")
  .refine((value) => {
    if (!value) return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "请输入 http 或 https 地址");
const imageUrl = z
  .string()
  .max(2000)
  .default("")
  .refine((value) => {
    if (!value) return true;
    if (/\s/.test(value) || value.startsWith("//")) return false;
    try {
      if (!/^\/(?!\/)/.test(value) && !/^https?:\/\//.test(value)) return false;
      return ["http:", "https:"].includes(
        new URL(value, "https://local.invalid").protocol
      );
    } catch {
      return false;
    }
  }, "图片地址格式不正确");

export const postInput = z.object({
  title: z.string().trim().min(1, "请填写标题").max(255),
  section: z.enum(sections),
  year: z.string().regex(/^\d{4}$/, "年份应为四位数字"),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .regex(/^[\p{L}\p{N}_-]+$/u, "路径名称只能包含文字、数字、横线和下划线"),
  markdown: z.string().max(2_000_000).default(""),
  description: z.string().max(2000).default(""),
  category: z.string().trim().max(100).default(""),
  tags: z
    .array(z.string().trim().min(1).max(100))
    .max(30)
    .default([])
    .transform((values) => [...new Set(values)]),
  publishedAt: z.string().datetime(),
  contentUpdatedAt: z.string().datetime().nullable().default(null),
  externalUrl: optionalUrl,
  coverUrl: imageUrl,
  canonicalUrl: optionalUrl,
  featured: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});
export type PostInput = z.infer<typeof postInput>;

export function postPath(input: Pick<PostInput, "section" | "year" | "slug">) {
  const prefix = ["blog", "tech", "sight"].includes(input.section)
    ? `/${input.section}/${input.year}`
    : `/${input.section}`;
  return `${prefix}/${input.slug}`;
}

export function parsePost(value: unknown) {
  const parsed = postInput.parse(value);
  // Remove reserved frontmatter keys from extension data. Public visibility is controlled by the database.
  for (const key of [
    "title",
    "date",
    "update",
    "draft",
    "external",
    "url",
    "category",
    "tags",
    "featured",
    "description",
    "ogImagePath",
    "canonicalUrl",
  ]) {
    delete parsed.metadata[key];
  }
  return parsed;
}
