import { publicPosts, publicPost } from "./posts";
import { parseAndTransform, renderHtml } from "../markdoc/render";
import type { PostInput } from "./content-input";

export async function adaptInput(input: PostInput, draft = false) {
  const content = await parseAndTransform({ content: input.markdown });
  return {
    slug: input.slug,
    content,
    brief: await parseAndTransform({
      content: input.markdown.split("<!--more-->")[0],
    }),
    rawContent: input.markdown,
    html: renderHtml(content),
    frontmatter: {
      ...input.metadata,
      title: input.title,
      date: new Date(input.publishedAt),
      update: input.contentUpdatedAt
        ? new Date(input.contentUpdatedAt)
        : undefined,
      description: input.description,
      category: input.category || undefined,
      tags: input.tags,
      draft,
      featured: input.featured,
      external: Boolean(input.externalUrl),
      url: input.externalUrl || undefined,
      ogImagePath: input.coverUrl || undefined,
      canonicalUrl: input.canonicalUrl || undefined,
    },
  };
}
export async function databaseReadOne(directory: string, slug: string) {
  const row = await publicPost(`/${directory}/${slug}`);
  return adaptInput(row.input);
}
export async function databaseReadAll(directory: string) {
  const [section, year] = directory.split("/");
  return Promise.all(
    (await publicPosts(section, year))
      .filter((row) => !row.input.metadata.hideFromListing)
      .map((row) => adaptInput(row.input))
  );
}
export async function databaseReadGroups(section: string) {
  const rows = await publicPosts(section);
  const years = [...new Set(rows.map((row) => row.year))];
  return Promise.all(
    years.map(async (year) => ({
      year,
      posts: await Promise.all(
        rows
          .filter((row) => row.year === year)
          .map((row) => adaptInput(row.input))
      ),
    }))
  );
}
