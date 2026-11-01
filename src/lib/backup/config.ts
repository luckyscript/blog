import path from "node:path";
import { createHash } from "node:crypto";

export const DAY = 86_400_000;
export function backupConfig(values: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = values.BACKUP_DATABASE_URL || values.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("请配置 DATABASE_URL 或 BACKUP_DATABASE_URL");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("数据库连接串格式不正确");
  }
  if (url.protocol !== "mysql:" || !url.hostname || !url.pathname.slice(1))
    throw new Error("备份需要包含数据库名称的 MySQL 连接串");
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(values[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`${key} 必须是 1 到 ${max} 之间的整数`);
    return value;
  };
  const time = values.BACKUP_TIME || "03:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("BACKUP_TIME 请使用北京时间 HH:MM，例如 03:00");
  const sourceId = createHash("sha256")
    .update(`${url.hostname}:${url.port || "3306"}${url.pathname}`)
    .digest("hex")
    .slice(0, 16);
  const ossFields = [
    "BACKUP_OSS_BUCKET",
    "BACKUP_OSS_REGION",
    "BACKUP_OSS_ACCESS_KEY_ID",
    "BACKUP_OSS_ACCESS_KEY_SECRET",
  ] as const;
  const ossEnabled = ossFields.some((key) => Boolean(values[key]));
  if (ossEnabled && !ossFields.every((key) => Boolean(values[key])))
    throw new Error(
      "OSS 配置不完整：请填写 Bucket、Region、AccessKey ID 和 Secret"
    );
  const prefix = (values.BACKUP_OSS_PREFIX || "blog-database").replace(
    /^\/+|\/+$/g,
    ""
  );
  if (
    !prefix ||
    !/^[\w/-]+$/.test(prefix) ||
    prefix.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      "BACKUP_OSS_PREFIX 只能包含字母、数字、下划线、横线和目录分隔符"
    );
  const secrets = [
    url.password,
    decodeURIComponent(url.password),
    values.BACKUP_OSS_ACCESS_KEY_SECRET,
    values.BACKUP_OSS_ACCESS_KEY_ID,
    values.BACKUP_OSS_STS_TOKEN,
  ].filter((value): value is string => Boolean(value));
  return {
    databaseUrl,
    sourceId,
    time,
    directory: path.resolve(
      values.BACKUP_DIRECTORY || ".local/backups/service",
      sourceId
    ),
    retentionDays: integer("BACKUP_RETENTION_DAYS", 30, 3650),
    timeoutMs: integer("BACKUP_TIMEOUT_SECONDS", 900, 7200) * 1000,
    retryDelaysMs: [60_000, 300_000],
    secrets,
    oss: ossEnabled
      ? {
          bucket: values.BACKUP_OSS_BUCKET!,
          region: values.BACKUP_OSS_REGION!,
          accessKeyId: values.BACKUP_OSS_ACCESS_KEY_ID!,
          accessKeySecret: values.BACKUP_OSS_ACCESS_KEY_SECRET!,
          stsToken: values.BACKUP_OSS_STS_TOKEN || undefined,
          prefix,
        }
      : undefined,
  };
}
export type BackupConfig = ReturnType<typeof backupConfig>;

/** Daily schedule in China Standard Time, independent of the host timezone. */
export function scheduledAt(now: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const day = Math.floor((now.getTime() + 8 * 3_600_000) / DAY);
  const today = day * DAY + (hour - 8) * 3_600_000 + minute * 60_000;
  return new Date(today <= now.getTime() ? today : today - DAY);
}
export const nextScheduledAt = (now: Date, time: string) =>
  new Date(scheduledAt(now, time).getTime() + DAY);

export function safeError(error: unknown, config: BackupConfig) {
  let message = error instanceof Error ? error.message : "备份失败";
  message = message.replace(/mysql:\/\/[^\s]+/gi, "[数据库连接已隐藏]");
  for (const secret of config.secrets)
    message = message.split(secret).join("[已隐藏]");
  return message.slice(0, 500);
}
