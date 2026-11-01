import mysql from "mysql2/promise";
import { open, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { env } from "../lib/server/env";

function identifier(value: string) {
  return "`" + value.replaceAll("`", "``") + "`";
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}
export function fingerprint(rows: Record<string, unknown>[]) {
  return createHash("sha256")
    .update(
      rows
        .map((row) => JSON.stringify(canonical(row)))
        .sort()
        .join("\n")
    )
    .digest("hex");
}

/** Back up the configured database, including RDS, without exposing credentials to a subprocess. */
export async function createBackup(
  destination: string,
  options: { databaseUrl?: string; signal?: AbortSignal } = {}
) {
  const uri = options.databaseUrl ?? env("DATABASE_URL");
  if (!uri) throw new Error("请配置 DATABASE_URL");
  options.signal?.throwIfAborted();
  const connection = await mysql.createConnection({
    uri,
    timezone: "Z",
    dateStrings: true,
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 15_000,
  });
  const abort = () => connection.destroy();
  options.signal?.addEventListener("abort", abort, { once: true });
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    options.signal?.throwIfAborted();
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query(
      "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ"
    );
    await connection.query(
      "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
    );
    const [tableRows] = await connection.query<any[]>(
      "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"
    );
    const tables = tableRows.map((row) => String(Object.values(row)[0])).sort();
    const [info] = await connection.query<any[]>(
      "SELECT VERSION() AS version, DATABASE() AS name"
    );
    const manifest = {
      createdAt: new Date().toISOString(),
      host: new URL(uri).hostname,
      database: info[0].name,
      mysqlVersion: info[0].version,
      tables: [] as Array<{ name: string; rows: number; sha256: string }>,
    };
    file = await open(destination, "wx", 0o600);
    created = true;
    await file.writeFile(
      "-- Blog database backup. Restore into an empty database.\nSET NAMES utf8mb4;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\nSET TIME_ZONE='+00:00';\nSET FOREIGN_KEY_CHECKS=0;\n"
    );
    for (const table of tables) {
      const [schema] = await connection.query<any[]>(
        `SHOW CREATE TABLE ${identifier(table)}`
      );
      await file.writeFile(String(schema[0]["Create Table"]) + ";\n");
    }
    await file.writeFile("START TRANSACTION;\n");
    for (const table of tables) {
      const [rows, fields] = await connection.query<any[]>(
        `SELECT * FROM ${identifier(table)}`
      );
      manifest.tables.push({
        name: table,
        rows: rows.length,
        sha256: fingerprint(rows),
      });
      const columns = fields.map((field) => identifier(field.name)).join(", ");
      for (let offset = 0; offset < rows.length; offset += 50) {
        const values = rows
          .slice(offset, offset + 50)
          .map(
            (row) =>
              "(" +
              fields
                .map((field) => {
                  const value = row[field.name];
                  return connection.escape(
                    field.columnType === 245 && value !== null
                      ? JSON.stringify(value)
                      : value
                  );
                })
                .join(", ") +
              ")"
          )
          .join(",\n");
        await file.writeFile(
          `INSERT INTO ${identifier(table)} (${columns}) VALUES ${values};\n`
        );
      }
    }
    await file.writeFile("COMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n");
    await file.close();
    file = undefined;
    await connection.commit();
    await writeFile(
      destination + ".manifest.json",
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600, flag: "wx" }
    );
    return manifest;
  } catch (error) {
    await file?.close().catch(() => {});
    await connection.rollback().catch(() => {});
    if (created) await unlink(destination).catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await connection.end().catch(() => {});
  }
}
