import path from "node:path";
import { backupConfig, safeError } from "../src/lib/backup/config";
import { readArchive, verifyArchive } from "../src/lib/backup/archive";
import { healthcheck, startBackupService } from "../src/lib/backup/service";

async function main() {
  const config = backupConfig();
  const args = process.argv.slice(2);
  if (args[0] === "--healthcheck") {
    const status = await healthcheck(config);
    console.log(
      JSON.stringify({
        healthy: true,
        lastSuccessAt: status.lastSuccessAt,
        nextRunAt: status.nextRunAt,
      })
    );
    return;
  }
  if (args[0] === "--verify" && args[1]) {
    const archive = await readArchive(path.resolve(args[1]), config.sourceId);
    await verifyArchive(archive);
    console.log(`备份压缩文件与 SHA-256 校验通过：${archive.manifest.id}`);
    return;
  }
  if (args.length && !(args.length === 1 && args[0] === "--once"))
    throw new Error(
      "用法：backup-service.ts [--once | --healthcheck | --verify 备份目录]"
    );
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await startBackupService(config, args[0] === "--once", controller.signal);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}
main().catch((error) => {
  let message = error instanceof Error ? error.message : "备份服务失败";
  try {
    message = safeError(error, backupConfig());
  } catch {
    /* Invalid configuration contains no logged credentials. */
  }
  console.error(
    JSON.stringify({ event: "backup_service_error", error: message })
  );
  process.exitCode = 1;
});
