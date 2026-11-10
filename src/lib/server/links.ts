import { randomUUID, createHash } from "node:crypto";
import Markdoc from "@markdoc/markdoc";
import { isIP } from "node:net";
import { and, asc, desc, eq, sql, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { curatedLinks, linkHealth } from "../../db/schema";
import { AppError } from "./errors";

export const linkUuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function safeLinkUrl(value: string) {
  if (
    value.length > 2000 ||
    /[\s\u0000-\u001f\u007f\\]/.test(value) ||
    /%0[ad]/i.test(value) ||
    !/^https?:\/\//i.test(value)
  )
    throw new AppError(400, "请输入完整的公开网站 http 或 https 地址");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, "链接地址格式不正确");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(
      host
    ) ||
    /^\/link\/to(?:\/|$)/.test(url.pathname)
  )
    throw new AppError(400, "请使用不含账号、端口和站内跳转路径的公开网站地址");
  return url.href;
}
export const curatedLinkInput = z.object({
  name: z.string().trim().min(1, "请填写链接名称").max(160),
  url: z.string().trim().transform(safeLinkUrl),
  description: z.string().trim().max(500).default(""),
  category: z.string().trim().min(1, "请填写分类").max(100),
  status: z.enum(["draft", "published"]),
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
});
export async function listCuratedLinks(admin = false, category = "", q = "") {
  const conditions = [];
  if (!admin) conditions.push(eq(curatedLinks.status, "published"));
  if (category)
    conditions.push(eq(curatedLinks.category, category.slice(0, 100)));
  if (q)
    conditions.push(
      sql`LOCATE(${q.slice(0, 100)},CONCAT(${curatedLinks.name},' ',${
        curatedLinks.description
      },' ',${curatedLinks.url})) > 0`
    );
  return db()
    .select({...getTableColumns(curatedLinks),health:linkHealth})
    .from(curatedLinks)
    .leftJoin(linkHealth,and(eq(linkHealth.linkId,curatedLinks.id),eq(linkHealth.urlHash,sql`SHA2(${curatedLinks.url},256)`)))
    .where(and(...conditions))
    .orderBy(
      asc(curatedLinks.sortOrder),
      desc(curatedLinks.createdAt),
      asc(curatedLinks.id)
    );
}
export async function saveCuratedLink(
  id: string | null,
  value: unknown,
  version = 0
) {
  const input = curatedLinkInput.parse(value);
  return db().transaction(async (tx) => {
    const now = new Date(),
      key = id || randomUUID();
    if (id) {
      const [row] = await tx
        .select()
        .from(curatedLinks)
        .where(eq(curatedLinks.id, id))
        .for("update");
      if (!row) throw new AppError(404, "链接不存在");
      if (row.version !== version)
        throw new AppError(409, "链接已在其他窗口修改，请重新打开后编辑");
      if (row.status === "trash")
        throw new AppError(409, "请先从回收站恢复链接");
      await tx
        .update(curatedLinks)
        .set({ ...input, version: row.version + 1, updatedAt: now })
        .where(eq(curatedLinks.id, id));
    } else
      await tx
        .insert(curatedLinks)
        .values({
          id: key,
          ...input,
          visits: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
    const [row] = await tx
      .select()
      .from(curatedLinks)
      .where(eq(curatedLinks.id, key));
    return row;
  });
}
export async function changeCuratedLinkStatus(
  id: string,
  version: number,
  action: "trash" | "restore"
) {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(curatedLinks)
      .where(eq(curatedLinks.id, id))
      .for("update");
    if (!row) throw new AppError(404, "链接不存在");
    if (row.version !== version)
      throw new AppError(409, "链接已在其他窗口修改，请刷新列表");
    if (action === "restore" && row.status !== "trash")
      throw new AppError(409, "链接不在回收站");
    await tx
      .update(curatedLinks)
      .set({
        status: action === "trash" ? "trash" : "draft",
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(curatedLinks.id, id));
    return { ok: true };
  });
}
export async function curatedLinkDestination(uuid: string) {
  if (!linkUuid.test(uuid)) throw new AppError(404, "链接不存在");
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(curatedLinks)
      .where(
        and(eq(curatedLinks.id, uuid), eq(curatedLinks.status, "published"))
      )
      .for("update");
    if (!row) throw new AppError(404, "链接不存在或已下线");
    let target: string;
    try {
      target = safeLinkUrl(row.url);
    } catch {
      throw new AppError(404, "链接暂不可用");
    }
    await tx
      .update(curatedLinks)
      .set({ visits: sql`LEAST(${curatedLinks.visits} + 1,2147483647)` })
      .where(eq(curatedLinks.id, uuid));
    return target;
  });
}
type LinkTarget = {
  id: string;
  url: string;
  status: string;
  sourceKey?: string | null;
};
export function registeredLinkForUrl(value: string, links: LinkTarget[]) {
  const url = safeLinkUrl(value),
    sourceKey = createHash("sha256").update(url).digest("hex");
  return links.find((link) => link.url === url || link.sourceKey === sourceKey);
}
/** Route registered targets without mutating cached Markdoc trees. */
export function routeCuratedLinks(content: any, links: LinkTarget[]) {
  const targets = new Map(links.map((link) => [link.url, link]));
  function walk(node: any): any {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const result =
      node instanceof Markdoc.Tag
        ? new Markdoc.Tag(node.name, { ...node.attributes }, [])
        : { ...node };
    if (node.attributes) result.attributes = { ...node.attributes };
    if (node.name === "a" && typeof node.attributes?.href === "string") {
      let url: string;
      try {
        url = safeLinkUrl(node.attributes.href);
      } catch {
        url = "";
      }
      const target =
        targets.get(url) ||
        links.find(
          (link) =>
            link.sourceKey === createHash("sha256").update(url).digest("hex")
        );
      if (target) {
        result.attributes.href = `/link/to/${target.id}`;
        result.attributes.rel = "noopener noreferrer";
      } else if (/^https?:/i.test(node.attributes.href)) {
        result.name = "span";
        result.attributes = {};
      }
    }
    if (node.children) result.children = node.children.map(walk);
    return result;
  }
  return walk(content);
}
