import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, closeDatabase } from "../src/db";
import {
  posts,
  drafts,
  revisions,
  postTags,
  redirects,
} from "../src/db/schema";
import { createAdmin } from "../src/lib/server/auth";
import { env } from "../src/lib/server/env";

test("真实 MySQL 与 HTTP：草稿、发布、路径迁移、版本冲突、回收站、权限与导出", async (t) => {
  const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
    "集成测试只能连接本机预览"
  );
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(env("DATABASE_URL")).hostname),
    "集成测试只能连接本机数据库"
  );
  const schema = new URL(env("DATABASE_URL")).pathname.slice(1);
  assert.ok(
    /^blog_integration_[a-f0-9]{32}$/.test(schema) &&
      schema === env("TEST_ISOLATED_DATABASE"),
    "集成测试必须由 npm run test:integration 创建独立临时数据库"
  );
  const unique = randomUUID().slice(0, 8);
  const email = `integration-${unique}@example.test`;
  const password = `local-integration-${unique}-only`;
  await createAdmin(email, password);
  let postId = "",
    cookie = "";
  const category = `integration-${unique}`,
    tag = `tag-${unique}`;
  const call = async (
    path: string,
    method = "GET",
    value?: unknown,
    authenticated = true,
    customOrigin = origin
  ) => {
    return fetch(`${origin}/api/admin/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: customOrigin,
        ...(authenticated ? { cookie } : {}),
      },
      body: value === undefined ? undefined : JSON.stringify(value),
      redirect: "manual",
    });
  };
  try {
    assert.equal((await call("posts", "GET", undefined, false)).status, 401);
    const linksPage = await fetch(`${origin}/link`);
    assert.equal(linksPage.status, 200);
    assert.match(await linksPage.text(), /友情链接/);
    assert.equal(
      (
        await call(
          "auth/login",
          "POST",
          { email, password },
          false,
          "https://elsewhere.invalid"
        )
      ).status,
      403
    );
    const missingVerification = await call(
      "auth/login",
      "POST",
      { email, password },
      false
    );
    assert.equal(missingVerification.status, 403);
    assert.equal(missingVerification.headers.get("set-cookie"), null);
    const login = await call(
      "auth/login",
      "POST",
      { email, password, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" },
      false
    );
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(login.headers.get("set-cookie")!, /SameSite=Strict/i);
    let input = {
      title: `集成验证 ${unique}`,
      section: "blog",
      year: "2026",
      slug: `integration-${unique}`,
      markdown:
        "# 正文验证\n\n这是公开内容。\n\n```unknown\n<img onerror=alert(1)>\n```",
      description: "公开摘要",
      category,
      tags: [tag],
      publishedAt: new Date(Date.now() - 60_000).toISOString(),
      metadata: { draft: true, toc: false },
      externalUrl: "",
      canonicalUrl: "",
      coverUrl: "",
      featured: false,
      contentUpdatedAt: null,
    };
    let response = await call("posts", "POST", input);
    assert.equal(response.status, 201, await response.clone().text());
    let row = await response.json();
    postId = row.id;
    const originalPath = row.path;
    assert.equal((await fetch(`${origin}${originalPath}`)).status, 404);
    assert.equal(
      (await fetch(`${origin}/admin/preview/${postId}`, { redirect: "manual" }))
        .status,
      302
    );
    response = await call(`posts/${postId}/publish`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200, await response.clone().text());
    row = await response.json();
    assert.equal(row.hasDraft, false);
    const published = await fetch(`${origin}${originalPath}`);
    assert.equal(published.status, 200);
    const html = await published.text();
    assert.match(html, /这是公开内容/);
    assert.doesNotMatch(html, /<img onerror=/);
    assert.equal(
      (
        await fetch(`${origin}/admin/preview/${postId}`, {
          headers: { cookie },
        })
      ).status,
      200
    );
    input = {
      ...input,
      title: "私密待发布标题",
      markdown: "私密草稿内容不应该出现",
      slug: `renamed-${unique}`,
    };
    response = await call(`posts/${postId}`, "PUT", {
      input,
      version: row.version,
    });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(
      (await call(`posts/${postId}`, "PUT", { input, version: row.version }))
        .status,
      409
    );
    const live = await (await fetch(`${origin}${originalPath}`)).text();
    assert.doesNotMatch(live, /私密待发布标题|私密草稿内容/);
    assert.doesNotMatch(
      await (await fetch(`${origin}/rss.xml`)).text(),
      /私密待发布标题/
    );
    response = await call(`posts/${postId}/publish`, "POST", {
      version: saved.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    const redirect = await fetch(`${origin}${originalPath}`, {
      redirect: "manual",
    });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), row.path);
    assert.equal((await fetch(`${origin}${row.path}`)).status, 200);
    assert.match(
      await (await fetch(`${origin}/sitemap.xml`)).text(),
      new RegExp(`renamed-${unique}`)
    );
    assert.doesNotMatch(
      await (await fetch(`${origin}/sitemap.xml`)).text(),
      /\/admin/
    );
    const taxonomy = await (await call("taxonomy")).json();
    const term = taxonomy.categories.find(
      (item: any) => item.name === category
    );
    assert.equal(
      (
        await call("taxonomy", "POST", {
          kind: "categories",
          action: "delete",
          id: term.id,
        })
      ).status,
      409
    );
    assert.equal(
      (
        await call("taxonomy", "POST", {
          kind: "categories",
          action: "rename",
          id: term.id,
          name: `${category}-renamed`,
        })
      ).status,
      200
    );
    assert.match(
      await (await call(`posts/${postId}/export`)).text(),
      /私密草稿内容/
    );
    const exportResponse = await call("export");
    assert.equal(exportResponse.status, 200);
    const backup = await exportResponse.json();
    assert.ok(backup.posts.find((item: any) => item.id === postId));
    response = await call(`posts/${postId}/revisions`, "POST", {
      revisionId: row.revisions[row.revisions.length - 1].id,
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(row.hasDraft, true);
    assert.match(row.input.markdown, /这是公开内容/);
    response = await call(`posts/${postId}/unpublish`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(
      (await fetch(`${origin}/blog/2026/renamed-${unique}`)).status,
      404
    );

    // Delete a published article with a newer, private draft still pending.
    response = await call(`posts/${postId}/publish`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    const pendingInput = {
      ...input,
      title: `待删除文章 ${unique}`,
      markdown: `删除后仍应保留的草稿 ${unique}`,
    };
    response = await call(`posts/${postId}`, "PUT", {
      input: pendingInput,
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    const beforeDelete = (
      await db().select().from(posts).where(eq(posts.id, postId))
    )[0];
    const retainedDrafts = await db()
      .select()
      .from(drafts)
      .where(eq(drafts.postId, postId));
    const retainedTags = await db()
      .select()
      .from(postTags)
      .where(eq(postTags.postId, postId));
    const retainedRedirects = await db()
      .select()
      .from(redirects)
      .where(eq(redirects.postId, postId));
    const retainedRevisions = await db()
      .select()
      .from(revisions)
      .where(eq(revisions.postId, postId));
    assert.equal(beforeDelete.status, "published");
    assert.ok(beforeDelete.categoryId);
    assert.ok(
      retainedDrafts.length && retainedTags.length && retainedRedirects.length
    );
    assert.equal(
      (await call(`posts/${postId}`, "DELETE", { version: row.version }, false))
        .status,
      401
    );
    assert.equal(
      (
        await call(
          `posts/${postId}`,
          "DELETE",
          { version: row.version },
          true,
          "https://elsewhere.invalid"
        )
      ).status,
      403
    );
    assert.equal(
      (await call(`posts/${postId}`, "DELETE", { version: row.version - 1 }))
        .status,
      409
    );
    response = await call(`posts/${postId}`, "DELETE", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(row.status, "trash");
    const deletedRow = (
      await db().select().from(posts).where(eq(posts.id, postId))
    )[0];
    assert.deepEqual(
      {
        ...deletedRow,
        status: beforeDelete.status,
        version: beforeDelete.version,
        updatedAt: beforeDelete.updatedAt,
      },
      beforeDelete,
      "软删除只能更新状态、修改时间和版本号，原文及关联必须保留"
    );
    assert.deepEqual(
      await db().select().from(drafts).where(eq(drafts.postId, postId)),
      retainedDrafts
    );
    assert.deepEqual(
      await db().select().from(postTags).where(eq(postTags.postId, postId)),
      retainedTags
    );
    assert.deepEqual(
      await db().select().from(redirects).where(eq(redirects.postId, postId)),
      retainedRedirects
    );
    const deletedRevisions = await db()
      .select()
      .from(revisions)
      .where(eq(revisions.postId, postId));
    assert.equal(deletedRevisions.length, retainedRevisions.length + 1);
    for (const revision of retainedRevisions)
      assert.deepEqual(
        deletedRevisions.find((item) => item.id === revision.id),
        revision
      );
    assert.equal((await fetch(`${origin}${row.path}`)).status, 404);
    assert.equal(
      (await fetch(`${origin}${originalPath}`, { redirect: "manual" })).status,
      404
    );
    for (const page of ["/", "/blog", "/rss.xml", "/sitemap.xml"])
      assert.doesNotMatch(
        await (await fetch(`${origin}${page}`)).text(),
        new RegExp(`renamed-${unique}`)
      );
    assert.equal((await (await call(`posts?q=${unique}`)).json()).total, 0);
    const trashList = await (
      await call(`posts?status=trash&q=${unique}`)
    ).json();
    assert.ok(trashList.items.some((item: any) => item.id === postId));
    assert.match(
      await (await call(`posts/${postId}/export`)).text(),
      /删除后仍应保留的草稿/
    );
    const deletedExport = await (await call("export")).json();
    assert.equal(
      deletedExport.posts.find((item: any) => item.id === postId).status,
      "trash"
    );
    for (const [path, method] of [
      [`posts/${postId}/trash`, "POST"],
      [`posts/${postId}`, "DELETE"],
    ]) {
      response = await call(path, method, { version: row.version });
      assert.equal(response.status, 200);
      const repeated = await response.json();
      assert.equal(repeated.version, row.version);
      assert.deepEqual(repeated.revisions, row.revisions);
    }
    assert.equal(
      (await call(`posts/${postId}`, "PUT", { input, version: row.version }))
        .status,
      409
    );
    assert.equal(
      (
        await call(`posts/${postId}/revisions`, "POST", {
          revisionId: retainedRevisions[0].id,
          version: row.version,
        })
      ).status,
      409
    );
    assert.equal(
      (await call(`posts/${postId}/publish`, "POST", { version: row.version }))
        .status,
      409
    );
    response = await call(`posts/${postId}/restore`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(row.status, "draft");
    assert.equal(row.input.markdown, pendingInput.markdown);
    assert.equal((await fetch(`${origin}${row.path}`)).status, 404);
    // The original UI endpoint also soft-deletes drafts and preserves their content.
    response = await call(`posts/${postId}/trash`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(row.status, "trash");
    assert.equal(
      (await db().select().from(posts).where(eq(posts.id, postId))).length,
      1
    );
    response = await call(`posts/${postId}/restore`, "POST", {
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    assert.equal(row.status, "draft");
    assert.equal(row.input.markdown, pendingInput.markdown);
    if (!env("GITHUB_MEDIA_TOKEN")) {
      const file = new FormData();
      file.set(
        "file",
        new File([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], "test.png", {
          type: "image/png",
        })
      );
      assert.equal(
        (
          await fetch(`${origin}/api/admin/media`, {
            method: "POST",
            headers: { cookie, origin },
            body: file,
          })
        ).status,
        503
      );
    }
    assert.equal((await call("import", "POST", { dryRun: true })).status, 200);
    const imported = await (
      await call("import", "POST", { dryRun: false })
    ).json();
    assert.equal(imported.imported, 0);
    assert.ok(imported.skipped >= 134);
    assert.equal(
      (
        await call("auth/password", "POST", {
          currentPassword: password,
          newPassword: `${password}-updated`,
        })
      ).status,
      200
    );
    assert.equal((await call("posts")).status, 401);
    const renewed = await call(
      "auth/login",
      "POST",
      {
        email,
        password: `${password}-updated`,
        turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      },
      false
    );
    assert.equal(renewed.status, 200);
    cookie = renewed.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await call("auth/logout", "POST", {})).status, 200);
    assert.equal((await call("posts")).status, 401);
  } finally {
    // The runner disposes of the whole temporary database after stopping its server.
    await closeDatabase();
  }
});
