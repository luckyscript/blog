import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
  readdir,
  lstat,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { Writable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createBackup } from "../../db/backup";
import { DAY, type BackupConfig } from "./config";

export const backupName =
  /^blog-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;
export type BackupManifest = {
  format: 1;
  id: string;
  sourceId: string;
  createdAt: string;
  archive: {
    file: "database.sql.gz";
    bytes: number;
    sha256: string;
    sqlSha256: string;
  };
  database: Awaited<ReturnType<typeof createBackup>>;
  remote?: { bucket: string; key: string; uploadedAt: string };
};
export type Archive = { directory: string; manifest: BackupManifest };

export async function atomicJson(filename: string, value: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function readArchive(
  directory: string,
  sourceId: string
): Promise<Archive> {
  if (
    !backupName.test(path.basename(directory)) ||
    !(await lstat(directory)).isDirectory()
  )
    throw new Error("备份目录格式不正确");
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8")
  ) as BackupManifest;
  if (
    manifest.format !== 1 ||
    manifest.id !== path.basename(directory) ||
    manifest.sourceId !== sourceId ||
    manifest.archive?.file !== "database.sql.gz" ||
    !/^[a-f0-9]{64}$/.test(manifest.archive.sha256) ||
    !/^[a-f0-9]{64}$/.test(manifest.archive.sqlSha256) ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw new Error("备份清单格式不正确或不属于当前数据库");
  return { directory, manifest };
}
export async function listArchives(config: BackupConfig) {
  const result: Archive[] = [];
  for (const name of await readdir(config.directory)) {
    if (!backupName.test(name)) continue;
    try {
      result.push(
        await readArchive(path.join(config.directory, name), config.sourceId)
      );
    } catch {
      /* Unknown or damaged artifacts are preserved for inspection. */
    }
  }
  return result.sort((a, b) =>
    b.manifest.createdAt.localeCompare(a.manifest.createdAt)
  );
}
export async function verifyArchive(archive: Archive, signal?: AbortSignal) {
  const filename = path.join(archive.directory, archive.manifest.archive.file);
  if (!(await lstat(filename)).isFile())
    throw new Error("备份压缩文件不存在或不是普通文件");
  const compressed = createHash("sha256"),
    sql = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(filename),
    new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        compressed.update(chunk);
        done(null, chunk);
      },
    }),
    createGunzip(),
    new Writable({
      write(chunk, _encoding, done) {
        sql.update(chunk);
        done();
      },
    }),
    { signal }
  );
  if (
    bytes !== archive.manifest.archive.bytes ||
    compressed.digest("hex") !== archive.manifest.archive.sha256 ||
    sql.digest("hex") !== archive.manifest.archive.sqlSha256
  )
    throw new Error("备份文件的大小或 SHA-256 不匹配");
}
export async function createArchive(
  config: BackupConfig,
  signal?: AbortSignal,
  dump = createBackup
): Promise<Archive> {
  const id = `blog-backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const staging = path.join(config.directory, `.staging-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    const sqlFile = path.join(staging, "database.sql");
    const database = await dump(sqlFile, {
      databaseUrl: config.databaseUrl,
      signal,
    });
    const compressed = createHash("sha256"),
      sql = createHash("sha256");
    let bytes = 0;
    await pipeline(
      createReadStream(sqlFile),
      new Transform({
        transform(chunk, _encoding, done) {
          sql.update(chunk);
          done(null, chunk);
        },
      }),
      createGzip({ level: 9 }),
      new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          compressed.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(path.join(staging, "database.sql.gz"), {
        flags: "wx",
        mode: 0o600,
        flush: true,
      }),
      { signal }
    );
    const manifest: BackupManifest = {
      format: 1,
      id,
      sourceId: config.sourceId,
      createdAt: database.createdAt,
      archive: {
        file: "database.sql.gz",
        bytes,
        sha256: compressed.digest("hex"),
        sqlSha256: sql.digest("hex"),
      },
      database,
    };
    const archive = { directory: staging, manifest };
    await verifyArchive(archive, signal);
    await atomicJson(path.join(staging, "manifest.json"), manifest);
    await rm(sqlFile);
    await rm(sqlFile + ".manifest.json", { force: true });
    signal?.throwIfAborted();
    const directory = path.join(config.directory, id);
    await rename(staging, directory);
    return { directory, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function pruneArchives(
  config: BackupConfig,
  successful: Archive,
  now = new Date()
) {
  // Only run after the new required destinations have all succeeded.
  const cutoff = now.getTime() - config.retentionDays * DAY;
  const removed: string[] = [];
  for (const archive of await listArchives(config)) {
    if (
      archive.manifest.id === successful.manifest.id ||
      Date.parse(archive.manifest.createdAt) >= cutoff
    )
      continue;
    await rm(archive.directory, { recursive: true });
    removed.push(archive.manifest.id);
  }
  return removed;
}
