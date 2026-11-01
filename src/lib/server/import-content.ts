import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { globby } from "globby";
import matter from "gray-matter";
import { importPost } from "./posts";
import { parsePost, sections, type PostInput } from "./content-input";
import { parseAndTransform } from "../markdoc/render";
import { db } from "../../db";
import { media } from "../../db/schema";

export async function scanContent() {
  const paths = await globby(
    sections.map((section) => `content/${section}/**/*.md`)
  );
  const items: Array<{ sourcePath: string; input: PostInput; draft: boolean }> =
    [];
  const errors: Array<{ sourcePath: string; error: string }> = [];
  for (const sourcePath of paths.sort()) {
    try {
      const { content, data } = matter(await readFile(sourcePath, "utf8"));
      const parts = sourcePath.split("/");
      const section = parts[1] as PostInput["section"];
      const date = new Date(data.date);
      const input = parsePost({
        title: data.title,
        section,
        year: ["blog", "tech", "sight"].includes(section)
          ? parts[2]
          : String(date.getUTCFullYear()),
        slug: path.basename(sourcePath, ".md"),
        markdown: content,
        description: data.description ?? "",
        category: data.category ?? "",
        tags: data.tags ?? [],
        publishedAt: date.toISOString(),
        contentUpdatedAt: data.update
          ? new Date(data.update).toISOString()
          : null,
        externalUrl:
          data.external || section === "projects" ? data.url ?? "" : "",
        coverUrl: data.ogImagePath ?? "",
        canonicalUrl: data.canonicalUrl ?? "",
        featured: data.featured ?? false,
        metadata: { ...data },
      });
      await parseAndTransform({ content });
      // This legacy file was already rendered publicly inside /link. Its draft flag only hid its list entry.
      if (sourcePath === "content/link/link.md")
        Object.assign(input.metadata, {
          pageContent: true,
          hideFromListing: true,
        });
      items.push({
        sourcePath,
        input,
        draft:
          sourcePath === "content/link/link.md" ? false : data.draft === true,
      });
    } catch (error) {
      errors.push({
        sourcePath,
        error: error instanceof Error ? error.message : "无法读取",
      });
    }
  }
  return { items, errors };
}
export async function importContent(authorId: string, dryRun = false) {
  const { items, errors } = await scanContent();
  let imported = 0,
    skipped = 0;
  // A failed preflight writes nothing. Existing database content is never overwritten.
  if (errors.length)
    return {
      imported,
      skipped,
      total: items.length + errors.length,
      errors,
      dryRun,
    };
  if (!dryRun) {
    for (const item of items) {
      const result = await importPost(
        item.input,
        item.sourcePath,
        item.draft,
        authorId
      );
      if (result.skipped) skipped++;
      else imported++;
    }
    for (const item of items) {
      for (const match of item.input.markdown.matchAll(
        /!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g
      )) {
        const url = match[2];
        if (!/^(https?:\/\/|\/(?!\/))/.test(url)) continue;
        let name = url.split("/").pop()?.split("?")[0] ?? "image";
        try {
          name = decodeURIComponent(name);
        } catch {}
        const extension = name.split(".").pop()?.toLowerCase() ?? "";
        const mime =
          (
            {
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              png: "image/png",
              gif: "image/gif",
              webp: "image/webp",
              svg: "image/svg+xml",
            } as Record<string, string>
          )[extension] ?? "image/jpeg";
        await db()
          .insert(media)
          .values({
            id: randomUUID(),
            name: name.slice(0, 255),
            key: `legacy:${url}`.slice(0, 512),
            url,
            mime,
            size: 0,
            checksum: createHash("sha256").update(`url:${url}`).digest("hex"),
            alt: match[1].slice(0, 500),
            status: "ready",
            createdAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              checksum: createHash("sha256").update(`url:${url}`).digest("hex"),
            },
          });
      }
    }
  }
  return { imported, skipped, total: items.length, errors, dryRun };
}
