import path from "node:path";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import {
  backupConfig,
  nextScheduledAt,
  safeError,
  scheduledAt,
  type BackupConfig,
} from "./config";
import {
  atomicJson,
  createArchive,
  listArchives,
  pruneArchives,
  verifyArchive,
  type Archive,
} from "./archive";
import { ossStore } from "./oss";

export function isComplete(archive: Archive, config: BackupConfig) {
  return (
    !config.oss ||
    (archive.manifest.remote?.bucket === config.oss.bucket &&
      archive.manifest.remote.key ===
        `${config.oss.prefix}/${config.sourceId}/${archive.manifest.id}/database.sql.gz`)
  );
}
export type Progress = {
  phase: "running" | "retrying";
  attempt: number;
  error?: string;
};
export async function runBackupCycle(
  config: BackupConfig,
  options: {
    signal?: AbortSignal;
    progress?: (value: Progress) => Promise<void>;
    create?: typeof createArchive;
    upload?: (archive: Archive, signal?: AbortSignal) => Promise<void>;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {}
) {
  const archives = await listArchives(config);
  let archive =
    archives[0] && !isComplete(archives[0], config) ? archives[0] : undefined;
  const upload = options.upload ?? ossStore(config);
  for (let attempt = 0; attempt <= config.retryDelaysMs.length; attempt++) {
    options.signal?.throwIfAborted();
    await options.progress?.({ phase: "running", attempt: attempt + 1 });
    try {
      const signal = AbortSignal.any([
        AbortSignal.timeout(config.timeoutMs),
        ...(options.signal ? [options.signal] : []),
      ]);
      archive ??= await (options.create ?? createArchive)(config, signal);
      try {
        await verifyArchive(archive, signal);
      } catch (error) {
        archive = undefined;
        throw error;
      }
      signal.throwIfAborted();
      if (upload) await upload(archive, signal);
      signal.throwIfAborted();
      const removed = await pruneArchives(config, archive);
      return { archive, removed };
    } catch (error) {
      if (options.signal?.aborted || attempt === config.retryDelaysMs.length)
        throw error;
      await options.progress?.({
        phase: "retrying",
        attempt: attempt + 1,
        error: safeError(error, config),
      });
      await (
        options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }))
      )(config.retryDelaysMs[attempt], options.signal);
    }
  }
  throw new Error("备份未完成");
}

export type BackupStatus = {
  format: 1;
  mode: "service" | "once";
  sourceId: string;
  startedAt: string;
  heartbeatAt: string;
  phase: "idle" | "running" | "retrying" | "failed" | "stopped";
  lastSuccessAt: string | null;
  lastBackupId: string | null;
  nextRunAt: string;
  attempt: number;
  error?: string;
};
export function healthy(
  status: BackupStatus,
  config: BackupConfig,
  now = new Date()
) {
  return (
    status.format === 1 &&
    status.sourceId === config.sourceId &&
    status.mode === "service" &&
    status.phase !== "stopped" &&
    status.phase !== "failed" &&
    now.getTime() - Date.parse(status.heartbeatAt) < 90_000 &&
    (status.lastSuccessAt
      ? now.getTime() - Date.parse(status.lastSuccessAt) < 26 * 3_600_000
      : now.getTime() - Date.parse(status.startedAt) <
        3 * config.timeoutMs + 600_000)
  );
}
export async function healthcheck(config = backupConfig()) {
  const status = JSON.parse(
    await readFile(path.join(config.directory, "status.json"), "utf8")
  ) as BackupStatus;
  if (!healthy(status, config))
    throw new Error("备份服务异常、心跳过期或最近备份已过期");
  return status;
}
export async function startBackupService(
  config: BackupConfig,
  once = false,
  signal?: AbortSignal
) {
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const combined = AbortSignal.any([
    controller.signal,
    ...(signal ? [signal] : []),
  ]);
  let compromised: Error | undefined;
  const release = await lockfile.lock(config.directory, {
    stale: 120_000,
    update: 20_000,
    retries: 0,
    onCompromised(error) {
      compromised = error;
      controller.abort(error);
    },
  });
  const status: BackupStatus = {
    format: 1,
    mode: once ? "once" : "service",
    sourceId: config.sourceId,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    phase: "idle",
    lastSuccessAt: null,
    lastBackupId: null,
    nextRunAt: new Date().toISOString(),
    attempt: 0,
  };
  let writing = Promise.resolve();
  const persist = () => {
    if (compromised) return Promise.reject(compromised);
    status.heartbeatAt = new Date().toISOString();
    const snapshot = { ...status };
    writing = writing.then(() => {
      if (compromised) throw compromised;
      return atomicJson(path.join(config.directory, "status.json"), snapshot);
    });
    return writing;
  };
  const log = (event: string, data: object = {}) =>
    console.log(
      JSON.stringify({ time: new Date().toISOString(), event, ...data })
    );
  const heartbeat = setInterval(() => {
    void persist().catch((error) => controller.abort(error));
  }, 30_000);
  try {
    // This process owns the lock, so these are leftovers from interrupted exports.
    for (const name of await readdir(config.directory))
      if (/^\.staging-[a-f0-9-]{36}$/.test(name))
        await rm(path.join(config.directory, name), {
          recursive: true,
          force: true,
        });
    for (const latest of await listArchives(config)) {
      if (!isComplete(latest, config)) continue;
      try {
        await verifyArchive(latest, combined);
        status.lastSuccessAt = latest.manifest.createdAt;
        status.lastBackupId = latest.manifest.id;
        break;
      } catch (error) {
        combined.throwIfAborted();
        log("backup_archive_invalid", {
          id: latest.manifest.id,
          error: safeError(error, config),
        });
      }
    }
    await persist();
    log("backup_service_started", {
      mode: status.mode,
      scheduledTime: config.time,
      timezone: "Asia/Shanghai",
      oss: Boolean(config.oss),
    });
    let retryAfter = 0;
    do {
      combined.throwIfAborted();
      const now = new Date();
      const due =
        once ||
        !status.lastSuccessAt ||
        Date.parse(status.lastSuccessAt) <
          scheduledAt(now, config.time).getTime();
      if (due && Date.now() >= retryAfter) {
        try {
          const result = await runBackupCycle(config, {
            signal: combined,
            progress: async (progress) => {
              status.phase = progress.phase;
              status.attempt = progress.attempt;
              status.error = progress.error;
              await persist();
              log(`backup_${progress.phase}`, progress);
            },
          });
          status.lastSuccessAt = result.archive.manifest.createdAt;
          status.lastBackupId = result.archive.manifest.id;
          status.phase = "idle";
          status.error = undefined;
          status.attempt = 0;
          retryAfter = 0;
          log("backup_succeeded", {
            id: result.archive.manifest.id,
            tables: result.archive.manifest.database.tables.length,
            bytes: result.archive.manifest.archive.bytes,
            oss: Boolean(result.archive.manifest.remote),
            pruned: result.removed.length,
          });
        } catch (error) {
          if (combined.aborted) throw error;
          status.phase = "failed";
          status.error = safeError(error, config);
          retryAfter = Date.now() + 15 * 60_000;
          log("backup_failed", {
            error: status.error,
            retryAt: new Date(retryAfter).toISOString(),
          });
          if (once) throw error;
        }
      }
      status.nextRunAt = retryAfter
        ? new Date(retryAfter).toISOString()
        : nextScheduledAt(new Date(), config.time).toISOString();
      await persist();
      if (!once) await delay(15_000, undefined, { signal: combined });
    } while (!once);
  } catch (error) {
    if (compromised || !combined.aborted || !signal?.aborted) throw error;
  } finally {
    clearInterval(heartbeat);
    status.phase = "stopped";
    await persist().catch(() => {});
    await release().catch((error) => {
      if (!compromised) throw error;
    });
  }
}
