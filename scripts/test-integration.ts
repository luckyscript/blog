import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";

const schema = `blog_integration_${randomUUID().replaceAll("-", "")}`;
let control: mysql.Connection | undefined;
let server: ChildProcess | undefined;
let serverOutput = "";
let created = false;

function run(args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: environment,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`验证子进程退出：${code}`))
    );
  });
}

async function main() {
  const source = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!source)
    throw new Error("请配置本机 TEST_DATABASE_URL（需要创建临时数据库的权限）");
  const url = new URL(source);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error(
      "集成测试只能连接本机数据库；请通过 TEST_DATABASE_URL 指定本机测试连接"
    );
  // Never create fixtures in the configured application database.
  url.pathname = "/";
  control = await mysql.createConnection(url.toString());
  await control.query(
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  created = true;
  url.pathname = `/${schema}`;
  const environment = {
    ...process.env,
    DATABASE_URL: url.toString(),
    CONTENT_SOURCE: "mysql",
    ADMIN_EMAIL: "fixture@example.test",
    ADMIN_PASSWORD: randomUUID(),
    GITHUB_MEDIA_TOKEN: "",
    TEST_ISOLATED_DATABASE: schema,
    NODE_ENV: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  };
  const nodeArgs = ["--import", "tsx"];
  await run([...nodeArgs, "scripts/db-setup.ts"], environment);
  await run([...nodeArgs, "scripts/import-content.ts"], environment);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("无法分配测试端口");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve()))
  );
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/astro/astro.js",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: { ...environment, SITE_URL: origin },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  server.on("error", (error) => {
    serverOutput += error.message;
  });
  for (const stream of [server.stdout, server.stderr])
    stream?.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-12_000);
    });
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      const response = await fetch(`${origin}/admin/login`, {
        signal: AbortSignal.timeout(2_000),
      });
      await response.arrayBuffer();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error(`独立测试服务未能启动\n${serverOutput}`);
  console.log(`集成测试使用临时数据库 ${schema} 与独立本机服务`);
  await run([...nodeArgs, "--test", "tests/integration.ts"], {
    ...environment,
    TEST_BASE_URL: origin,
  });
}

main()
  .finally(async () => {
    if (server && server.exitCode === null && server.pid) {
      const stopped = once(server, "close");
      server.kill("SIGTERM");
      const force = setTimeout(() => server?.kill("SIGKILL"), 5_000);
      try {
        await stopped;
      } finally {
        clearTimeout(force);
      }
    }
    try {
      if (created) await control?.query(`DROP DATABASE \`${schema}\``);
    } finally {
      await control?.end();
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "集成测试失败");
    process.exitCode = 1;
  });
