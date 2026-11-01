import type { APIContext } from "astro";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import matter from "gray-matter";
import { login, logout, changePassword } from "../../../lib/server/auth";
import {
  listPosts,
  getPost,
  saveDraft,
  publishPost,
  changeStatus,
  restoreRevision,
  exportPosts,
} from "../../../lib/server/posts";
import { listTaxonomy, changeTaxonomy } from "../../../lib/server/taxonomy";
import { listMedia, uploadMedia, MAX_UPLOAD } from "../../../lib/server/media";
import { importContent } from "../../../lib/server/import-content";
import { AppError } from "../../../lib/server/errors";
import { parseAndTransform, renderHtml } from "../../../lib/markdoc/render";
import { db } from "../../../db";
import { media, revisions } from "../../../db/schema";
import { momentSources } from "../../../lib/moments/store";

export const prerender = false;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

async function limitedBody(request: Request, max = 2_500_000) {
  if (Number(request.headers.get("content-length")) > max)
    throw new AppError(413, "请求内容过大");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new AppError(413, "请求内容过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "请使用 JSON 请求");
  try {
    return JSON.parse(new TextDecoder().decode(await limitedBody(request)));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "JSON 格式不正确");
  }
}
const versionOf = (value: any) =>
  z.number().int().positive().parse(value.version);

export async function ALL(context: APIContext) {
  const path = context.params.path ?? "";
  const method = context.request.method;
  try {
    if (path === "auth/login" && method === "POST") {
      const value = z
        .object({
          email: z.string().email().max(190),
          password: z.string().min(1).max(128),
          turnstileToken: z.string().max(2048).optional(),
        })
        .parse(await body(context.request));
      return json(
        await login(context, value.email, value.password, value.turnstileToken)
      );
    }
    const user = context.locals.admin;
    if (!user) throw new AppError(401, "请先登录");
    if (path === "moments/sources" && method === "GET") return json(await momentSources());
    if (path === "auth/me" && method === "GET") return json(user);
    if (path === "auth/logout" && method === "POST") {
      await logout(context);
      return json({ ok: true });
    }
    if (path === "auth/password" && method === "POST") {
      const value = z
        .object({
          currentPassword: z.string().max(128),
          newPassword: z.string().min(12).max(128),
        })
        .parse(await body(context.request));
      await changePassword(user.id, value.currentPassword, value.newPassword);
      await logout(context);
      return json({ ok: true });
    }
    if (path === "posts" && method === "GET") {
      return json(
        await listPosts(
          context.url.searchParams.get("q") ?? "",
          context.url.searchParams.get("section") ?? "",
          context.url.searchParams.get("status") ?? "",
          Math.max(1, Number(context.url.searchParams.get("page")) || 1)
        )
      );
    }
    if (path === "posts" && method === "POST")
      return json(
        await saveDraft(null, await body(context.request), 0, user.id),
        201
      );
    const post = path.match(
      /^posts\/([a-f0-9-]{36})(?:\/(publish|unpublish|trash|restore|revisions|export))?$/
    );
    if (post) {
      const [, id, action] = post;
      if (!action && method === "GET") return json(await getPost(id));
      if (!action && method === "DELETE") {
        const value = await body(context.request);
        return json(await changeStatus(id, versionOf(value), "trash"));
      }
      if (!action && method === "PUT") {
        const value = await body(context.request);
        return json(
          await saveDraft(id, value.input, versionOf(value), user.id)
        );
      }
      if (action === "export" && method === "GET") {
        const row = await getPost(id);
        const input = row.input;
        const text = matter.stringify(input.markdown, {
          ...input.metadata,
          title: input.title,
          date: new Date(input.publishedAt),
          ...(input.contentUpdatedAt
            ? { update: new Date(input.contentUpdatedAt) }
            : {}),
          external: Boolean(input.externalUrl),
          ...(input.externalUrl ? { url: input.externalUrl } : {}),
          description: input.description,
          category: input.category,
          tags: input.tags,
          draft: row.hasDraft || row.status !== "published",
          featured: input.featured,
          ogImagePath: input.coverUrl,
          canonicalUrl: input.canonicalUrl,
        });
        return new Response(text, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
              input.slug
            )}.md`,
          },
        });
      }
      if (action === "revisions" && method === "POST") {
        const value = await body(context.request);
        return json(
          await restoreRevision(
            id,
            z.string().uuid().parse(value.revisionId),
            versionOf(value),
            user.id
          )
        );
      }
      if (action && method === "POST") {
        const value = await body(context.request);
        if (action === "publish") {
          const row = await getPost(id);
          await parseAndTransform({ content: row.input.markdown });
          return json(await publishPost(id, versionOf(value)));
        }
        if (["unpublish", "trash", "restore"].includes(action))
          return json(
            await changeStatus(
              id,
              versionOf(value),
              action as "trash" | "restore" | "unpublish"
            )
          );
      }
    }
    const revision = path.match(
      /^posts\/([a-f0-9-]{36})\/revisions\/([a-f0-9-]{36})$/
    );
    if (revision && method === "GET") {
      const [row] = await db()
        .select()
        .from(revisions)
        .where(
          and(eq(revisions.postId, revision[1]), eq(revisions.id, revision[2]))
        );
      if (!row) throw new AppError(404, "历史版本不存在");
      return json(row);
    }
    if (path === "preview" && method === "POST") {
      const value = z
        .object({ markdown: z.string().max(2_000_000) })
        .parse(await body(context.request));
      return json({
        html: renderHtml(await parseAndTransform({ content: value.markdown })),
      });
    }
    if (path === "taxonomy" && method === "GET")
      return json(await listTaxonomy());
    if (path === "taxonomy" && method === "POST") {
      const value = z
        .object({
          kind: z.enum(["categories", "tags"]),
          action: z.enum(["create", "rename", "delete"]),
          id: z.string().default(""),
          name: z.string().default(""),
        })
        .parse(await body(context.request));
      return json(
        await changeTaxonomy(value.kind, value.action, value.id, value.name)
      );
    }
    if (path === "media" && method === "GET") return json(await listMedia());
    if (path === "media" && method === "POST") {
      if (
        !context.request.headers
          .get("content-type")
          ?.startsWith("multipart/form-data")
      )
        throw new AppError(415, "请使用文件上传表单");
      const data = await new Response(
        await limitedBody(context.request, MAX_UPLOAD + 65_536),
        {
          headers: {
            "content-type": context.request.headers.get("content-type")!,
          },
        }
      ).formData();
      const file = data.get("file");
      if (!(file instanceof File)) throw new AppError(400, "请选择文件");
      return json(await uploadMedia(file, String(data.get("alt") ?? "")), 201);
    }
    const mediaItem = path.match(/^media\/([a-f0-9-]{36})$/);
    if (mediaItem && method === "PATCH") {
      const value = z
        .object({ alt: z.string().max(500) })
        .parse(await body(context.request));
      await db().update(media).set(value).where(eq(media.id, mediaItem[1]));
      return json({ ok: true });
    }
    if (path === "import" && method === "POST") {
      const value = z
        .object({ dryRun: z.boolean().default(true) })
        .parse(await body(context.request));
      const result = await importContent(user.id, value.dryRun);
      return json(result, result.errors.length ? 422 : 200);
    }
    if (path === "export" && method === "GET")
      return new Response(JSON.stringify(await exportPosts(), null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="blog-export-${new Date()
            .toISOString()
            .slice(0, 10)}.json"`,
        },
      });
    throw new AppError(404, "接口不存在");
  } catch (error: any) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json(
        {
          error: error.issues
            .map((item) => `${item.path.join(".")} ${item.message}`)
            .join("；"),
        },
        400
      );
    const databaseError = error?.cause?.code ?? error?.code;
    if (databaseError === "ER_DUP_ENTRY")
      return json({ error: "这个名称或地址已经存在，请换一个名称" }, 409);
    console.error(
      "Admin API failure:",
      databaseError ?? error?.name ?? "unknown"
    );
    return json({ error: "操作暂时未完成，请检查数据库或网络后重试" }, 503);
  }
}
