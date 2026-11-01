import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/server/env";
import { AppError } from "../lib/server/errors";

let pool: mysql.Pool | undefined;
let database: ReturnType<typeof createDatabase> | undefined;
export function getPool() {
  const url = env("DATABASE_URL");
  if (!url) throw new AppError(503, "请先配置 MySQL，并执行 npm run db:setup");
  return (pool ??= mysql.createPool({
    uri: url,
    connectionLimit: 8,
    connectTimeout: 5_000,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: false,
    enableKeepAlive: true,
  }));
}
function createDatabase() {
  return drizzle(getPool());
}
export function db() {
  return (database ??= createDatabase());
}
export async function closeDatabase() {
  if (pool) await pool.end();
  pool = undefined;
  database = undefined;
}
