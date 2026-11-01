import OSS from "ali-oss";
import path from "node:path";
import { createHash } from "node:crypto";
import type { BackupConfig } from "./config";
import { atomicJson, type Archive } from "./archive";

type Client = Pick<OSS, "put" | "head" | "getBucketACL">;
export function ossStore(config: BackupConfig, client?: Client) {
  const options = config.oss;
  if (!options) return undefined;
  const oss = client ?? new OSS({ ...options, secure: true, timeout: 60_000 });
  return async (archive: Archive, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const acl = await oss.getBucketACL(options.bucket);
    signal?.throwIfAborted();
    if (acl.acl !== "private")
      throw new Error("数据库备份需要使用私有 OSS Bucket");
    const base = `${options.prefix}/${config.sourceId}/${archive.manifest.id}`;
    const headers = (sha256: string) => ({
      "x-oss-object-acl": "private",
      "x-oss-server-side-encryption": "AES256",
      "x-oss-meta-sha256": sha256,
    });
    const verify = async (key: string, bytes: number, hash: string) => {
      signal?.throwIfAborted();
      const response = await oss.head(key);
      signal?.throwIfAborted();
      const values = response.res.headers as Record<string, string>;
      if (
        Number(values["content-length"]) !== bytes ||
        values["x-oss-meta-sha256"] !== hash ||
        values["x-oss-server-side-encryption"] !== "AES256"
      )
        throw new Error("OSS 备份文件的大小、校验元数据或加密状态不匹配");
    };
    const key = `${base}/database.sql.gz`;
    await oss.put(key, path.join(archive.directory, "database.sql.gz"), {
      headers: headers(archive.manifest.archive.sha256),
      mime: "application/gzip",
    });
    await verify(
      key,
      archive.manifest.archive.bytes,
      archive.manifest.archive.sha256
    );
    const manifest = {
      ...archive.manifest,
      remote: {
        bucket: options.bucket,
        key,
        uploadedAt: new Date().toISOString(),
      },
    };
    const content = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const hash = createHash("sha256").update(content).digest("hex");
    signal?.throwIfAborted();
    await oss.put(`${base}/manifest.json`, content, {
      headers: headers(hash),
      mime: "application/json",
    });
    await verify(`${base}/manifest.json`, content.length, hash);
    await atomicJson(path.join(archive.directory, "manifest.json"), manifest);
    archive.manifest = manifest;
  };
}
