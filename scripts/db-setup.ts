import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getPool, closeDatabase } from "../src/db";
import { env } from "../src/lib/server/env";
import { createAdmin } from "../src/lib/server/auth";

try {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS blog_migrations (name VARCHAR(190) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB`
  );
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const source = await readFile(
      new URL(`../db/migrations/${name}`, import.meta.url),
      "utf8"
    );
    const checksum = createHash("sha256").update(source).digest("hex");
    const [rows] = await pool.query<any[]>(
      "SELECT checksum FROM blog_migrations WHERE name = ?",
      [name]
    );
    if (rows.length) {
      if (rows[0].checksum !== checksum)
        throw new Error(`已应用的迁移 ${name} 被修改，请添加新的迁移文件`);
      continue;
    }
    // Every DDL statement is idempotent, so an interrupted MySQL DDL migration can be resumed.
    for (const statement of source
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await pool.query(statement);
    await pool.query(
      "INSERT INTO blog_migrations VALUES (?, ?, UTC_TIMESTAMP(3))",
      [name, checksum]
    );
    console.log(`已应用迁移：${name}`);
  }
  const email = env("ADMIN_EMAIL");
  const password = env("ADMIN_PASSWORD");
  if (email && password) {
    await createAdmin(email, password);
    console.log(`管理员已就绪：${email}（已有账号不会重设密码）`);
  } else {
    console.log(
      "数据库已就绪。首次创建管理员请配置 ADMIN_EMAIL 和 ADMIN_PASSWORD 后再次运行。"
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "初始化失败");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
