import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load } from "cheerio";
import { getPool, closeDatabase } from "../src/db";

const run = promisify(execFile);
test("系列：旧文保真迁移、权限、写新篇、草稿隔离、发布归属与前台阅读导航", async () => {
  const url = new URL(process.env.DATABASE_URL!),
    origin = process.env.TEST_BASE_URL!;
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^blog_integration_[a-f0-9]{32}$/.test(url.pathname.slice(1))
  );
  const [[owner]] = await getPool().query<any[]>(
    "SELECT id FROM blog_users LIMIT 1"
  );
  const token = randomBytes(32).toString("hex"),
    hash = createHash("sha256").update(token).digest("hex"),
    cookie = "inkrain_admin=" + token;
  await getPool().query(
    "INSERT INTO blog_sessions(token_hash,user_id,expires_at) VALUES(?,?,UTC_TIMESTAMP()+INTERVAL 15 MINUTE)",
    [hash, owner.id]
  );
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    authenticated = true,
    source = origin
  ) =>
    fetch(origin + "/api/admin/" + path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: source,
        ...(authenticated ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal((await call("series", "GET", undefined, false)).status, 401);
    assert.equal(
      (await call("series", "POST", {}, true, "https://elsewhere.invalid"))
        .status,
      403
    );
    const [[before]] = await getPool().query<any[]>(
      "SELECT id,markdown FROM blog_posts WHERE path='/blog/2023/passenger-and-drivers'"
    );
    assert(before);
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "scripts/migrate-driver-series.ts", "--apply"],
      { env: process.env }
    );
    assert.equal(JSON.parse(stdout.trim()).chapters, 3);
    const [[after]] = await getPool().query<any[]>(
      "SELECT markdown FROM blog_posts WHERE id=?",
      [before.id]
    );
    assert.equal(after.markdown, before.markdown);
    let response = await fetch(origin + "/blog/2023/passenger-and-drivers");
    assert.equal(response.status, 200);
    let page = load(await response.text());
    assert.equal(page(".series-story-link").length, 3);
    assert.equal(page("h1").text(), "乘客与司机");
    assert.equal(page('[id="被追尾了"]').length, 1);
    assert(!page(".series-collection").text().includes("读最新"));
    assert(!page(".series-collection").text().includes("从头读"));
    response = await fetch(origin + "/series/passenger-and-drivers", {
      redirect: "manual",
    });
    assert.equal(response.status, 301);
    assert.equal(
      new URL(response.headers.get("location")!, origin).pathname,
      "/blog/2023/passenger-and-drivers"
    );
    const suffix = randomUUID().slice(0, 8),
      input = {
        title: "独立系列 " + suffix,
        slug: "series-" + suffix,
        description: "系列介绍",
        section: "blog",
        status: "published",
        state: "ongoing",
      };
    response = await call("series", "POST", input);
    assert.equal(response.status, 201);
    let series = await response.json();
    response = await call("series/" + series.id, "PUT", {
      input: { ...input, title: "不应保存" },
      version: series.version + 1,
    });
    assert.equal(response.status, 409);
    response = await call("series/" + series.id + "/entries", "POST", {});
    assert.equal(response.status, 201);
    let entry = await response.json();
    assert.equal(entry.input.metadata.seriesId, series.id);
    assert.equal(entry.status, "draft");
    assert.equal((await fetch(origin + entry.path)).status, 404);
    const title = "第一则 " + suffix;
    entry = await (
      await call("posts/" + entry.id, "PUT", {
        input: {
          ...entry.input,
          title,
          markdown: "这是第一则公开手记。",
          description: "第一则的摘要。",
          metadata: { ...entry.input.metadata, seriesContext: "杭州 · 车上" },
        },
        version: entry.version,
      })
    ).json();
    response = await call("posts/" + entry.id + "/publish", "POST", {
      version: entry.version,
    });
    assert.equal(response.status, 200);
    entry = await response.json();
    response = await fetch(origin + "/series/" + series.slug);
    assert.equal(response.status, 200);
    page = load(await response.text());
    assert.equal(page(".series-story-link").length, 1);
    assert(page("h3").text().includes(title));
    assert(page(".series-collection").text().includes("杭州 · 车上"));
    response = await fetch(origin + entry.path);
    assert.equal(response.status, 200);
    page = load(await response.text());
    assert.equal(page(".series-reading-directory").length, 1);
    assert.equal(page(".series-reading-context").length, 1);
    response = await call("series/" + series.id, "PUT", {
      input: { ...input, slug: "changed-" + suffix },
      version: series.version,
    });
    assert.equal(response.status, 400, "公开篇目的系列网址必须保留");
    let original = await (await call("posts/" + before.id)).json();
    original = await (
      await call("posts/" + before.id, "PUT", {
        input: { ...original.input, metadata: { seriesId: series.id } },
        version: original.version,
      })
    ).json();
    assert.equal(
      (
        await call("posts/" + before.id + "/publish", "POST", {
          version: original.version,
        })
      ).status,
      400,
      "系列入口不能嵌入另一个系列"
    );

    let second = await (
      await call("series/" + series.id + "/entries", "POST", {})
    ).json();
    second = await (
      await call("posts/" + second.id, "PUT", {
        input: {
          ...second.input,
          title: "尚未公开 " + suffix,
          markdown: "保密的系列草稿内容",
        },
        version: second.version,
      })
    ).json();
    series = await (await call("series/" + series.id)).json();
    assert.equal(series.publishedCount, 1);
    assert.equal(series.draftCount, 1);
    assert.equal(series.entries.length, 2);
    assert(
      !(await (await fetch(origin + "/series/" + series.slug)).text()).includes(
        "保密的系列草稿内容"
      )
    );
    const invalid = randomUUID();
    entry = await (
      await call("posts/" + entry.id, "PUT", {
        input: { ...entry.input, metadata: { seriesId: invalid } },
        version: entry.version,
      })
    ).json();
    assert.equal(
      (
        await call("posts/" + entry.id + "/publish", "POST", {
          version: entry.version,
        })
      ).status,
      400
    );
    assert(
      (await (await fetch(origin + "/series/" + series.slug)).text()).includes(
        title
      )
    );
    entry = await (
      await call("posts/" + entry.id, "PUT", {
        input: { ...entry.input, metadata: {} },
        version: entry.version,
      })
    ).json();
    assert(
      (await (await fetch(origin + "/series/" + series.slug)).text()).includes(
        title
      )
    );
    entry = await (
      await call("posts/" + entry.id + "/publish", "POST", {
        version: entry.version,
      })
    ).json();
    assert(
      !(await (await fetch(origin + "/series/" + series.slug)).text()).includes(
        title
      )
    );
    assert.equal((await fetch(origin + entry.path)).status, 200);
    const sitemap = await (await fetch(origin + "/sitemap.xml")).text();
    assert(sitemap.includes("/blog/2023/passenger-and-drivers"));
    assert(sitemap.includes("/blog/2024/rear-end-collision"));
  } finally {
    await getPool().query("DELETE FROM blog_sessions WHERE token_hash=?", [
      hash,
    ]);
    await closeDatabase();
  }
});
