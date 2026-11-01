import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import lockfile from "proper-lockfile";
import {
  backupConfig,
  DAY,
  scheduledAt,
  nextScheduledAt,
  safeError,
} from "../src/lib/backup/config";
import {
  createArchive,
  verifyArchive,
  listArchives,
  atomicJson,
  pruneArchives,
  type Archive,
} from "../src/lib/backup/archive";
import {
  runBackupCycle,
  healthy,
  startBackupService,
  isComplete,
  type BackupStatus,
  healthcheck,
} from "../src/lib/backup/service";
import { ossStore } from "../src/lib/backup/oss";
import type { createBackup } from "../src/db/backup";

const fakeDump: typeof createBackup = async (destination) => {
  await writeFile(
    destination,
    "SET NAMES utf8mb4;\nINSERT INTO blog_posts VALUES ('正文、草稿、回收站都保留');\n",
    { mode: 0o600 }
  );
  return {
    createdAt: new Date().toISOString(),
    host: "localhost",
    database: "blog",
    mysqlVersion: "8.0",
    tables: [{ name: "blog_posts", rows: 3, sha256: "a".repeat(64) }],
  };
};
async function fixture(t: any, oss = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "blog-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = backupConfig({
    DATABASE_URL: "mysql://backup:encoded%40password@localhost/blog",
    BACKUP_DIRECTORY: directory,
    ...(oss
      ? {
          BACKUP_OSS_BUCKET: "private-backups",
          BACKUP_OSS_REGION: "oss-cn-hangzhou",
          BACKUP_OSS_ACCESS_KEY_ID: "test-id",
          BACKUP_OSS_ACCESS_KEY_SECRET: "test-secret",
        }
      : {}),
  });
  config.retryDelaysMs = [1, 2];
  await mkdir(config.directory, { mode: 0o700 });
  return config;
}
test("北京时间日程跨日计算，数据库密码轮换不改变备份命名空间", () => {
  const before = new Date("2026-10-31T18:59:59Z");
  assert.equal(
    scheduledAt(before, "03:00").toISOString(),
    "2026-10-30T19:00:00.000Z"
  );
  assert.equal(
    nextScheduledAt(before, "03:00").toISOString(),
    "2026-10-31T19:00:00.000Z"
  );
  assert.equal(
    scheduledAt(new Date("2026-10-31T19:00:00Z"), "03:00").toISOString(),
    "2026-10-31T19:00:00.000Z"
  );
  const first = backupConfig({ DATABASE_URL: "mysql://a:old@localhost/blog" });
  const next = backupConfig({
    DATABASE_URL: "mysql://readonly:new@localhost:3306/blog",
  });
  assert.equal(first.sourceId, next.sourceId);
  assert.throws(() =>
    backupConfig({ DATABASE_URL: first.databaseUrl, BACKUP_TIME: "25:00" })
  );
  assert.throws(() =>
    backupConfig({
      DATABASE_URL: first.databaseUrl,
      BACKUP_OSS_BUCKET: "partial",
    })
  );
  assert.throws(() =>
    backupConfig({
      DATABASE_URL: first.databaseUrl,
      BACKUP_RETENTION_DAYS: "0",
    })
  );
});
test("备份原子发布、gzip 与双重 SHA-256 校验，损坏的文件不能通过", async (t) => {
  const config = await fixture(t);
  const archive = await createArchive(config, undefined, fakeDump);
  await verifyArchive(archive);
  assert.equal((await listArchives(config)).length, 1);
  assert.deepEqual((await readdir(archive.directory)).sort(), [
    "database.sql.gz",
    "manifest.json",
  ]);
  assert.equal(
    (await stat(path.join(archive.directory, "database.sql.gz"))).mode & 0o777,
    0o600
  );
  await writeFile(path.join(archive.directory, "database.sql.gz"), "broken");
  await assert.rejects(verifyArchive(archive));
});
test("导出中断只清理临时文件，未完成的备份不会被发布", async (t) => {
  const config = await fixture(t);
  await assert.rejects(
    createArchive(config, undefined, async (destination) => {
      await writeFile(destination, "partial");
      throw new Error("connection lost");
    })
  );
  assert.deepEqual(await readdir(config.directory), []);
});
test("保留策略只处理当前数据库的过期备份，并始终保留本次成功的副本", async (t) => {
  const config = await fixture(t);
  const old = await createArchive(config, undefined, fakeDump);
  old.manifest.createdAt = new Date(Date.now() - 31 * DAY).toISOString();
  await atomicJson(path.join(old.directory, "manifest.json"), old.manifest);
  const fresh = await createArchive(config, undefined, fakeDump);
  await writeFile(path.join(config.directory, "manual.sql"), "existing backup");
  const unknown = await createArchive(config, undefined, fakeDump);
  unknown.manifest.sourceId = "another-database";
  await atomicJson(
    path.join(unknown.directory, "manifest.json"),
    unknown.manifest
  );
  assert.deepEqual(await pruneArchives(config, fresh), [old.manifest.id]);
  assert.ok(await stat(fresh.directory));
  assert.ok(await stat(unknown.directory));
  assert.ok(await stat(path.join(config.directory, "manual.sql")));
});
test("OSS 重试复用已生成的快照，失败时不清理旧备份", async (t) => {
  const config = await fixture(t);
  const old = await createArchive(config, undefined, fakeDump);
  old.manifest.createdAt = new Date(Date.now() - 31 * DAY).toISOString();
  await atomicJson(path.join(old.directory, "manifest.json"), old.manifest);
  let dumps = 0,
    uploads = 0;
  const waits: number[] = [];
  await assert.rejects(
    runBackupCycle(config, {
      create: async (settings, signal) => {
        dumps++;
        return createArchive(settings, signal, fakeDump);
      },
      upload: async () => {
        uploads++;
        throw new Error("OSS unavailable");
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    }),
    /OSS unavailable/
  );
  assert.equal(dumps, 1);
  assert.equal(uploads, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.ok(await stat(old.directory));
});
test("重启后优先补传最新的待上传副本，完成后才清理过期文件", async (t) => {
  const config = await fixture(t, true);
  const pending = await createArchive(config, undefined, fakeDump);
  let dumps = 0;
  const result = await runBackupCycle(config, {
    create: async (settings, signal) => {
      dumps++;
      return createArchive(settings, signal, fakeDump);
    },
    upload: async (archive) => {
      archive.manifest.remote = {
        bucket: config.oss!.bucket,
        key: `${config.oss!.prefix}/${config.sourceId}/${
          archive.manifest.id
        }/database.sql.gz`,
        uploadedAt: new Date().toISOString(),
      };
    },
  });
  assert.equal(result.archive.manifest.id, pending.manifest.id);
  assert.equal(dumps, 0);
  assert.ok(isComplete(result.archive, config));
});
test("OSS 使用私有 ACL 和 AES256，远程校验成功后才提交完成清单", async (t) => {
  const config = await fixture(t, true);
  const archive = await createArchive(config, undefined, fakeDump);
  const objects = new Map<
    string,
    { bytes: number; headers: Record<string, string> }
  >();
  const client = {
    getBucketACL: async () => ({ acl: "private" }),
    put: async (key: string, input: string | Buffer, options: any) => {
      const content = typeof input === "string" ? await readFile(input) : input;
      assert.equal(options.headers["x-oss-object-acl"], "private");
      assert.equal(options.headers["x-oss-server-side-encryption"], "AES256");
      objects.set(key, { bytes: content.length, headers: options.headers });
    },
    head: async (key: string) => {
      const object = objects.get(key)!;
      return {
        res: {
          headers: {
            ...object.headers,
            "content-length": String(object.bytes),
          },
        },
      };
    },
  };
  await ossStore(config, client as any)!(archive);
  assert.ok(isComplete(archive, config));
  assert.equal(objects.size, 2);
  const failed: Archive = await createArchive(config, undefined, fakeDump);
  await assert.rejects(
    ossStore(config, {
      ...client,
      head: async () => ({ res: { headers: { "content-length": "0" } } }),
    } as any)!(failed),
    /不匹配/
  );
  assert.equal(failed.manifest.remote, undefined);
  await assert.rejects(
    ossStore(config, {
      ...client,
      getBucketACL: async () => ({ acl: "public-read" }),
    } as any)!(failed),
    /私有/
  );
});
test("并发服务不能持有相同备份目录的锁", async (t) => {
  const config = await fixture(t);
  const release = await lockfile.lock(config.directory);
  try {
    await assert.rejects(startBackupService(config, true), { code: "ELOCKED" });
  } finally {
    await release();
  }
});
test("服务重启复用当日成功快照，正常停止后释放锁并更新状态", async (t) => {
  const config = await fixture(t);
  const archive = await createArchive(config, undefined, fakeDump);
  const controller = new AbortController();
  const running = startBackupService(config, false, controller.signal);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const status = await healthcheck(config);
        if (status.lastBackupId === archive.manifest.id) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(ready);
    assert.equal((await listArchives(config)).length, 1);
  } finally {
    controller.abort();
    await running;
  }
  const stopped = JSON.parse(
    await readFile(path.join(config.directory, "status.json"), "utf8")
  );
  assert.equal(stopped.phase, "stopped");
  assert.equal(await lockfile.check(config.directory), false);
});
test("健康检查识别停止、无心跳和过期备份，日志隐藏连接密码及 OSS 凭据", async (t) => {
  const config = await fixture(t, true);
  const status: BackupStatus = {
    format: 1,
    mode: "service",
    sourceId: config.sourceId,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    phase: "idle",
    lastSuccessAt: new Date().toISOString(),
    lastBackupId: null,
    nextRunAt: "",
    attempt: 0,
  };
  assert.ok(healthy(status, config));
  assert.equal(healthy({ ...status, phase: "stopped" }, config), false);
  assert.equal(
    healthy(
      { ...status, heartbeatAt: new Date(Date.now() - 100_000).toISOString() },
      config
    ),
    false
  );
  assert.equal(
    healthy(
      {
        ...status,
        lastSuccessAt: new Date(Date.now() - 27 * 3_600_000).toISOString(),
      },
      config
    ),
    false
  );
  assert.doesNotMatch(
    safeError(
      new Error(
        `failed ${config.databaseUrl} encoded@password test-secret test-id`
      ),
      config
    ),
    /encoded|password|test-secret|test-id/
  );
});
