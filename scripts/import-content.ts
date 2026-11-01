import { db, closeDatabase } from "../src/db";
import { users } from "../src/db/schema";
import { importContent, scanContent } from "../src/lib/server/import-content";

try {
  if (process.argv.includes("--dry-run")) {
    const result = await scanContent();
    console.log(
      JSON.stringify(
        {
          total: result.items.length + result.errors.length,
          valid: result.items.length,
          errors: result.errors,
        },
        null,
        2
      )
    );
    if (result.errors.length) process.exitCode = 1;
  } else {
    const [admin] = await db().select().from(users).limit(1);
    if (!admin) throw new Error("请先执行 npm run db:setup 创建管理员");
    const result = await importContent(admin.id);
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "导入失败");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
