import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getPool, closeDatabase } from "../src/db";

const schema = `blog_verify_${randomUUID().replaceAll("-", "")}`;
function mysql(args: string[]) {
  return spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "mysql",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --batch --skip-column-names "$@"',
      "sh",
      ...args,
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
}
function finish(child: ReturnType<typeof mysql>) {
  let output = "",
    error = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  return new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(error || `mysql exited ${code}`))
    );
  });
}
async function query(sql: string) {
  const child = mysql(["-e", sql]);
  const done = finish(child);
  child.stdin.end();
  return done;
}
async function main() {
  const argument = process.argv[2];
  if (!argument)
    throw new Error(
      "用法：npm run db:verify-backup -- .local/backups/备份文件.sql"
    );
  const filename = await realpath(argument);
  if (!filename.startsWith((await realpath(".local/backups")) + path.sep))
    throw new Error("只验证本项目 .local/backups 下的备份");
  await query(
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  try {
    const child = mysql([schema]);
    const done = finish(child);
    await Promise.all([
      pipeline(createReadStream(filename), child.stdin),
      done,
    ]);
    const tables = [
      "blog_users",
      "blog_posts",
      "blog_post_drafts",
      "blog_post_revisions",
      "blog_categories",
      "blog_tags",
      "blog_media",
    ];
    for (const table of tables) {
      const [rows] = await getPool().query<any[]>(
        `SELECT COUNT(*) AS count FROM \`${table}\``
      );
      const restored = Number(
        await query(`SELECT COUNT(*) FROM \`${schema}\`.\`${table}\``)
      );
      if (restored !== Number(rows[0].count))
        throw new Error(
          `${table} 记录数不同：备份 ${restored}，当前 ${rows[0].count}。请在内容未变动时重新验证。`
        );
      const [fingerprints] = await getPool().query<any[]>(
        `CHECKSUM TABLE \`${table}\` EXTENDED`
      );
      const restoredChecksum = (
        await query(`CHECKSUM TABLE \`${schema}\`.\`${table}\` EXTENDED`)
      ).split("\t")[1];
      if (String(fingerprints[0].Checksum) !== restoredChecksum)
        throw new Error(`${table} 数据校验和不同`);
      console.log(`${table}: ${restored} 条，恢复校验通过`);
    }
  } finally {
    await query(`DROP DATABASE \`${schema}\``);
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
