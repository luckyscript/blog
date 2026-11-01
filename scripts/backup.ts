import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "../src/db/backup";

async function main() {
  const directory = path.resolve(".local/backups");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(
    directory,
    `blog-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`
  );
  const manifest = await createBackup(destination);
  console.log(`数据库备份已保存：${destination}`);
  console.log(
    `来源：${manifest.host}/${manifest.database}；共 ${manifest.tables.length} 张表，附带 SHA-256 清单。`
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
