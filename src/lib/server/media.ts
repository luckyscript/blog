import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { media } from "../../db/schema";
import { env } from "./env";
import { AppError } from "./errors";

export const MAX_UPLOAD = 8 * 1024 * 1024;
export function githubConfiguration() {
  const repo = env("GITHUB_MEDIA_REPO", "luckyscript/image");
  const branch = env("GITHUB_MEDIA_BRANCH", "master");
  const prefix = env("GITHUB_MEDIA_PREFIX", "uploads");
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !/^[\w./-]+$/.test(branch) ||
    !/^[\w/-]+$/.test(prefix) ||
    prefix.split("/").some((part) => !part || part === "..")
  )
    throw new AppError(503, "GitHub 图床配置有误");
  return {
    configured: Boolean(env("GITHUB_MEDIA_TOKEN")),
    repo,
    branch,
    prefix,
  };
}

export function identifyFile(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: "image/png", extension: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: "image/jpeg", extension: "jpg" };
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
    return { mime: "image/gif", extension: "gif" };
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return { mime: "image/webp", extension: "webp" };
  if (bytes.subarray(0, 5).toString() === "%PDF-")
    return { mime: "application/pdf", extension: "pdf" };
  throw new AppError(400, "支持 JPEG、PNG、WebP、GIF 图片和 PDF 文件");
}

export async function uploadToGithub(
  bytes: Buffer,
  key: string,
  fetcher: typeof fetch = fetch
) {
  const config = githubConfiguration();
  const token = env("GITHUB_MEDIA_TOKEN");
  if (!token)
    throw new AppError(
      503,
      "GitHub 图床尚未配置上传令牌，请在服务端设置 GITHUB_MEDIA_TOKEN"
    );
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "InkRain-Blog-Admin",
  };
  const repoUrl = `https://api.github.com/repos/${config.repo}`;
  const repoResponse = await fetcher(repoUrl, {
    headers,
    signal: AbortSignal.timeout(25_000),
  });
  if (!repoResponse.ok)
    throw new AppError(
      502,
      `无法访问 GitHub 图片仓库（${repoResponse.status}），请检查仓库权限`
    );
  const repo = await repoResponse.json();
  if (repo.private)
    throw new AppError(
      400,
      "当前图床需要公开仓库，请选择用于公开展示图片的仓库"
    );
  const url = `${repoUrl}/contents/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const existing = await fetcher(
    `${url}?ref=${encodeURIComponent(config.branch)}`,
    { headers, signal: AbortSignal.timeout(25_000) }
  );
  const blobSha = createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest("hex");
  let sha = blobSha;
  if (existing.ok) {
    const data = await existing.json();
    if (data.sha !== blobSha)
      throw new AppError(409, "GitHub 中存在同名但内容不同的文件");
    sha = data.sha;
  } else if (existing.status === 404) {
    const response = await fetcher(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Upload blog media: ${key}`,
        content: bytes.toString("base64"),
        branch: config.branch,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok)
      throw new AppError(
        502,
        `GitHub 上传失败（${response.status}），可以稍后重试`
      );
    const data = await response.json();
    sha = data.content.sha;
  } else throw new AppError(502, `GitHub 文件检查失败（${existing.status}）`);
  return {
    sha,
    url: `https://raw.githubusercontent.com/${config.repo}/${encodeURIComponent(
      config.branch
    )}/${key.split("/").map(encodeURIComponent).join("/")}`,
  };
}

export async function uploadMedia(file: File, alt: string) {
  if (!githubConfiguration().configured)
    throw new AppError(
      503,
      "请先在服务端配置 GITHUB_MEDIA_TOKEN，现有图片仍可正常使用"
    );
  if (!file.size || file.size > MAX_UPLOAD)
    throw new AppError(400, "文件大小应在 1 字节至 8 MB 之间");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = identifyFile(bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const claim = await db().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(media)
      .where(eq(media.checksum, checksum))
      .for("update");
    if (existing?.status === "ready")
      return { ready: existing, id: existing.id, key: existing.key };
    if (
      existing?.status === "pending" &&
      Date.now() - existing.createdAt.getTime() < 120_000
    ) {
      throw new AppError(409, "这份文件正在上传，请稍后在媒体库查看");
    }
    const now = new Date();
    const key =
      existing?.key ??
      `${githubConfiguration().prefix}/${now.getUTCFullYear()}/${String(
        now.getUTCMonth() + 1
      ).padStart(2, "0")}/${checksum}.${type.extension}`;
    const id = existing?.id ?? randomUUID();
    if (existing)
      await tx
        .update(media)
        .set({ status: "pending", createdAt: now })
        .where(eq(media.id, id));
    else
      await tx
        .insert(media)
        .values({
          id,
          name: file.name.slice(0, 255),
          key,
          url: "",
          mime: type.mime,
          size: bytes.length,
          checksum,
          alt: alt.slice(0, 500),
          status: "pending",
          createdAt: now,
        });
    return { ready: null, id, key };
  });
  if (claim.ready) return claim.ready;
  const { id, key } = claim;
  try {
    const result = await uploadToGithub(bytes, key);
    await db()
      .update(media)
      .set({ ...result, status: "ready" })
      .where(eq(media.id, id));
    const [row] = await db().select().from(media).where(eq(media.id, id));
    return row;
  } catch (error) {
    await db().update(media).set({ status: "failed" }).where(eq(media.id, id));
    throw error;
  }
}
export async function listMedia() {
  return {
    items: await db()
      .select()
      .from(media)
      .orderBy(desc(media.createdAt))
      .limit(200),
    github: githubConfiguration(),
  };
}
