import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load } from "cheerio";
import { getPool, closeDatabase } from "../src/db";
const run = promisify(execFile);
test("系列独立栏目、独立存储与编辑发布：保真迁移、旧址跳转、普通文章隔离、草稿并发及历史恢复", async () => {
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
    auth = true,
    source = origin
  ) =>
    fetch(origin + "/api/admin/" + path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: source,
        ...(auth ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const [[before]] = await getPool().query<any[]>(
      "SELECT * FROM blog_posts WHERE path='/blog/2023/passenger-and-drivers'"
    );
    const legacyMigration = await run(
      process.execPath,
      ["--import", "tsx", "scripts/migrate-driver-series.ts", "--apply"],
      { env: process.env }
    );
    const legacy = JSON.parse(legacyMigration.stdout.trim());
    const baseEntry = await (
      await call("posts/" + legacy.chapterIds[0])
    ).json();
    const oldDraft = await (
      await call("posts", "POST", {
        ...baseEntry.input,
        title: "旧版未发布草稿",
        slug: "legacy-unpublished-draft",
        markdown: "这段文字还没有公开",
        metadata: { seriesId: legacy.seriesId, seriesContext: "草稿场景" },
      })
    ).json();
    assert.equal(oldDraft.status, "draft");
    const migration = await run(
      process.execPath,
      ["--import", "tsx", "scripts/separate-series-storage.ts", "--apply"],
      { env: process.env }
    );
    assert.equal(JSON.parse(migration.stdout.trim()).migratedNotes, 4);
    const again = await run(
      process.execPath,
      ["--import", "tsx", "scripts/separate-series-storage.ts", "--apply"],
      { env: process.env }
    );
    assert.equal(JSON.parse(again.stdout.trim()).migratedNotes, 0);
    const [[after]] = await getPool().query<any[]>(
      "SELECT * FROM blog_posts WHERE id=?",
      [before.id]
    );
    assert.equal(after.markdown, before.markdown);
    assert.equal(after.status, "series");
    const [copied] = await getPool().query<any[]>(
      "SELECT n.*,p.markdown AS original FROM blog_series_notes n JOIN blog_posts p ON p.id=n.id"
    );
    assert.equal(copied.length, 4);
    const restoredDraft = await (
      await call("series/notes/" + oldDraft.id)
    ).json();
    assert.equal(restoredDraft.input.markdown, "这段文字还没有公开");
    assert.equal(restoredDraft.status, "draft");
    assert.equal((await fetch(origin + restoredDraft.path)).status, 404);
    for (const n of copied) assert.equal(n.markdown, n.original);
    let response = await fetch(origin + before.path, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(
      new URL(response.headers.get("location")!, origin).pathname,
      "/series/passenger-and-drivers"
    );
    response = await fetch(origin + "/series/passenger-and-drivers");
    assert.equal(response.status, 200);
    let page = load(await response.text());
    assert.equal(page(".series-story-link").length, 3);
    assert.equal(
      page(".desktop-nav a[aria-current=page]").attr("href"),
      "/series"
    );
    assert(!page(".series-collection").text().includes("读最新"));
    assert(!page.text().includes(String.fromCodePoint(0x2197)));
    response = await fetch(origin + "/blog/2024/rear-end-collision", {
      redirect: "manual",
    });
    assert.equal(response.status, 301);
    assert.equal(
      new URL(response.headers.get("location")!, origin).pathname,
      "/series/passenger-and-drivers/rear-end-collision"
    );
    page = load(await (await fetch(origin + "/blog")).text());
    assert.equal(page(".series-shelf").length, 0);
    assert.equal(page('a.post-link[href*="rear-end-collision"]').length, 0);
    assert.equal((await call("posts/" + copied[0].id)).status, 404);
    const articles = await (await call("posts?search=被追尾了")).json();
    assert(!articles.items.some((p: any) => p.id === copied[0].id));
    assert.equal((await call("series", "GET", undefined, false)).status, 401);
    assert.equal(
      (await call("series", "POST", {}, true, "https://elsewhere.invalid"))
        .status,
      403
    );
    const suffix = randomUUID().slice(0, 8),
      form = {
        title: "独立系列 " + suffix,
        slug: "series-" + suffix,
        description: "测试介绍",
        status: "published",
        state: "ongoing",
      };
    response = await call("series", "POST", form);
    assert.equal(response.status, 201);
    let series = await response.json();
    response = await call("series/" + series.id + "/entries", "POST", {});
    assert.equal(response.status, 201);
    let note = await response.json();
    assert(!("section" in note.input));
    assert.equal((await call("posts/" + note.id)).status, 404);
    assert.equal((await fetch(origin + note.path)).status, 404);
    const edited = {
      ...note.input,
      title: "第一则 " + suffix,
      markdown: "独立系列正文",
      context: "杭州 · 车上",
    };
    let saved = await (
      await call("series/notes/" + note.id, "PUT", {
        input: edited,
        version: note.version,
      })
    ).json();
    response = await call("series/notes/" + note.id, "PUT", {
      input: edited,
      version: note.version,
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).version,
      saved.version,
      "相同草稿重试不重复写入"
    );
    assert.equal(
      (
        await call("series/notes/" + note.id, "PUT", {
          input: { ...edited, title: "旧版本" },
          version: note.version,
        })
      ).status,
      409
    );
    response = await call("series/notes/" + note.id + "/publish", "POST", {
      version: saved.version,
    });
    assert.equal(response.status, 200);
    note = await response.json();
    response = await fetch(origin + note.path);
    assert.equal(response.status, 200);
    page = load(await response.text());
    assert.equal(page("h1").text(), edited.title);
    assert.equal(page(".series-breadcrumbs a").first().attr("href"), "/series");
    let draft = await (
      await call("series/notes/" + note.id, "PUT", {
        input: { ...note.input, markdown: "未发布的私密修改" },
        version: note.version,
      })
    ).json();
    assert(
      !(await (await fetch(origin + note.path)).text()).includes(
        "未发布的私密修改"
      )
    );
    const originalPath = note.path;
    draft = await (
      await call("series/notes/" + note.id, "PUT", {
        input: { ...draft.input, slug: "改名手记" },
        version: draft.version,
      })
    ).json();
    note = await (
      await call("series/notes/" + note.id + "/publish", "POST", {
        version: draft.version,
      })
    ).json();
    assert.equal(
      (await fetch(origin + originalPath, { redirect: "manual" })).status,
      301
    );
    const unicodeFeed = await fetch(origin + "/series/rss.xml");
    assert.equal(unicodeFeed.status, 200);
    assert((await unicodeFeed.text()).includes(note.path));
    const oldRevision = note.revisions.find(
      (r: any) => r.action === "publish" && r.id !== note.revisions[0].id
    );
    assert(oldRevision);
    draft = await (
      await call("series/notes/" + note.id + "/revision", "POST", {
        version: note.version,
        revisionId: oldRevision.id,
      })
    ).json();
    assert(draft.hasDraft);
    assert.equal(draft.input.markdown, "独立系列正文");
    assert(
      (await (await fetch(origin + note.path)).text()).includes(
        "未发布的私密修改"
      ),
      "恢复历史只创建草稿，不直接覆盖前台"
    );
    note = await (
      await call("series/notes/" + note.id + "/trash", "POST", {
        version: draft.version,
      })
    ).json();
    assert.equal((await fetch(origin + note.path)).status, 404);
    note = await (
      await call("series/notes/" + note.id + "/restore", "POST", {
        version: note.version,
      })
    ).json();
    assert.equal(note.status, "draft");
    assert.equal((await fetch(origin + note.path)).status, 404);
    series = await (await call("series/" + series.id)).json();
    assert.equal(series.publishedCount, 0);
    assert.equal(series.entries.length, 1);
    assert.equal(
      (
        await call("series/" + series.id, "PUT", {
          input: { ...form, title: "不能覆盖" },
          version: series.version + 1,
        })
      ).status,
      409
    );
    const feed = await (await fetch(origin + "/series/rss.xml")).text();
    assert(feed.includes("/series/passenger-and-drivers/rear-end-collision"));
    assert(
      !(await (await fetch(origin + "/rss.xml")).text()).includes(
        "rear-end-collision"
      )
    );
    assert(
      (await (await fetch(origin + "/sitemap.xml")).text()).includes(
        "/series/passenger-and-drivers/rear-end-collision"
      )
    );
  } finally {
    await getPool().query("DELETE FROM blog_sessions WHERE token_hash=?", [
      hash,
    ]);
    await closeDatabase();
  }
});
