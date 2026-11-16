import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { load } from "cheerio";
import { db, closeDatabase } from "../src/db";
import { createAdmin } from "../src/lib/server/auth";
import { media, moments, momentSources } from "../src/db/schema";
import { curatedLinks, linkHealth } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { runLinkHealthChecks } from "../src/lib/server/link-health-worker";
import { listCuratedLinks } from "../src/lib/server/links";

test("独立 MySQL 与 HTTP：本站碎碎念发布、图片、冲突保护，链接 UUID 跳转与权限", async () => {
  const origin = process.env.TEST_BASE_URL!,
    uri = new URL(process.env.DATABASE_URL!);
  assert(
    ["127.0.0.1", "localhost"].includes(uri.hostname) &&
      /^blog_integration_[a-f0-9]{32}$/.test(uri.pathname.slice(1))
  );
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const id = randomUUID(),
    email = `author-${id}@example.test`,
    password = randomUUID();
  let cookie = "";
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    authenticated = true,
    requestOrigin = origin
  ) =>
    fetch(`${origin}/api/admin/${path}`, {
      method,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        ...(authenticated ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    await createAdmin(email, password);
    const login = await call(
      "auth/login",
      "POST",
      { email, password, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" },
      false
    );
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    for (const path of ["moments/local", "links"]) {
      assert.equal((await call(path, "GET", undefined, false)).status, 401);
      assert.equal(
        (await call(path, "POST", {}, true, "https://elsewhere.invalid"))
          .status,
        403
      );
    }
    const image = `https://images.example.com/${id}.jpg`,
      now = new Date();
    await db()
      .insert(media)
      .values({
        id: randomUUID(),
        name: "isolated-fixture.jpg",
        key: `fixtures/${id}.jpg`,
        url: image,
        mime: "image/jpeg",
        size: 10,
        checksum: createHash("sha256").update(id).digest("hex"),
        status: "ready",
        createdAt: now,
      });
    const input = {
      text: `本站发布验证 ${id}\n<script>alert(1)</script>`,
      images: [{ url: image, alt: "配图" }],
      publishedAt: now.toISOString(),
      status: "draft",
    };
    assert.equal(
      (await call("moments/local", "POST", { ...input, text: "", images: [] }))
        .status,
      400
    );
    assert.equal(
      (
        await call("moments/local", "POST", {
          ...input,
          images: [{ url: "https://unregistered.example.com/a.jpg", alt: "" }],
        })
      ).status,
      400
    );
    let response = await call("moments/local", "POST", input);
    assert.equal(response.status, 201);
    let row = await response.json();
    const noteId = row.id,
      draftVersion = row.version;
    assert.equal(
      (await fetch(`${origin}/moments/posts/${noteId}`)).status,
      404
    );
    response = await call(`moments/local/${noteId}`, "PUT", {
      input: { ...input, status: "published" },
      version: row.version,
    });
    assert.equal(response.status, 200);
    row = await response.json();
    response = await fetch(`${origin}/moments/posts/${noteId}`);
    assert.equal(response.status, 200);
    const note = load(await response.text());
    assert.equal(note(".telegram-content script").length, 0);
    assert(
      note(".telegram-content").text().includes("<script>alert(1)</script>")
    );
    assert.equal(note(".moment-photo-button").length, 1);
    assert.equal(
      (
        await call(`moments/local/${noteId}`, "PUT", {
          input,
          version: draftVersion,
        })
      ).status,
      409
    );
    assert.equal(
      (
        await call(`moments/local/${noteId}/trash`, "POST", {
          version: row.version,
        })
      ).status,
      200
    );
    assert.equal(
      (await fetch(`${origin}/moments/posts/${noteId}`)).status,
      404
    );
    const trashed = (
      await (await call("moments/local?status=trash")).json()
    ).items.find((item: any) => item.id === noteId);
    assert.equal(
      (
        await call(`moments/local/${noteId}/restore`, "POST", {
          version: trashed.version,
        })
      ).status,
      200
    );
    assert.equal(
      (await fetch(`${origin}/moments/posts/${noteId}`)).status,
      404
    );
    await db()
      .insert(momentSources)
      .values({
        id: `x:${id}`,
        platform: "x",
        account: id,
        title: "隔离测试",
        enabled: false,
        syncState: { archive: true },
        createdAt: now,
      });
    const externalId = randomUUID();
    await db()
      .insert(moments)
      .values({
        id: externalId,
        sourceId: `x:${id}`,
        externalId,
        sourceUrl: "https://example.com/",
        title: "来源原文",
        text: "原文",
        html: "<p>原文</p>",
        media: [],
        tags: [],
        contentHash: "a".repeat(64),
        status: "published",
        publishedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    assert.equal(
      (
        await call(`moments/local/${externalId}`, "PUT", {
          input,
          version: "a".repeat(64),
        })
      ).status,
      404
    );
    const link = {
      name: `链接验证 ${id}`,
      url: "https://example.com/original",
      category: "隔离验证",
      description: "测试说明",
      sortOrder: 0,
      status: "draft",
    };
    for (const url of [
      "javascript:alert(1)",
      "//evil.com",
      "http://127.0.0.1/",
      "https://user:password@example.com",
    ])
      assert.equal((await call("links", "POST", { ...link, url })).status, 400);
    response = await call("links", "POST", link);
    assert.equal(response.status, 201);
    let bookmark = await response.json();
    const uuid = bookmark.id,
      jump = `${origin}/link/to/${uuid}`;
    assert.match(
      uuid,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    );
    assert.equal((await fetch(jump, { redirect: "manual" })).status, 404);
    response = await call(`links/${uuid}`, "PUT", {
      input: { ...link, status: "published" },
      version: bookmark.version,
    });
    assert.equal(response.status, 200);
    bookmark = await response.json();
    assert.equal(
      (await call(`links/${uuid}`, "PUT", { input: link, version: 1 })).status,
      409
    );
    response = await fetch(jump, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), link.url);
    response = await fetch(jump + "?url=https://evil.com", {
      redirect: "manual",
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
    assert.equal(
      (await fetch(`${origin}/link/to/${randomUUID()}`, { redirect: "manual" }))
        .status,
      404
    );
    response = await call(`links/${uuid}`, "PUT", {
      input: {
        ...link,
        status: "published",
        url: "https://example.org/updated",
      },
      version: bookmark.version,
    });
    assert.equal(response.status, 200);
    bookmark = await response.json();
    assert.equal(bookmark.id, uuid);
    response = await fetch(jump, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "https://example.org/updated"
    );
    const linksPage = load(await (await fetch(`${origin}/link`)).text());
    assert.equal(linksPage('form:not([role="search"])').length, 0);
    assert(linksPage(".bookmark").length > 0);
    linksPage(".bookmark").each((_, element) =>
      assert.match(
        linksPage(element).attr("href")!,
        /^\/link\/to\/[a-f0-9-]{36}$/
      )
    );
    assert.equal(
      (await call(`links/${uuid}/trash`, "POST", { version: bookmark.version }))
        .status,
      200
    );
    assert.equal((await fetch(jump, { redirect: "manual" })).status, 404);
    bookmark = (await (await call("links")).json()).find(
      (item: any) => item.id === uuid
    );
    assert.equal(
      (
        await call(`links/${uuid}/restore`, "POST", {
          version: bookmark.version,
        })
      ).status,
      200
    );
    assert.equal((await fetch(jump, { redirect: "manual" })).status, 404);
    for (const path of ["/admin/moments", "/admin/links"]) {
      response = await fetch(origin + path, { headers: { cookie } });
      assert.equal(response.status, 200);
    }
    response = await fetch(`${origin}/card`, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), "/moments?platform=local");
    const article = load(
      await (await fetch(`${origin}/blog/2026/world-cup-twenty-years`)).text()
    );
    assert.equal(article(".reading-material-switch").length, 1);
    assert.equal(article(".reading-material-panel").length, 0);
  } finally {
    await closeDatabase();
  }
});

test("链接健康检查缓存结果、忽略草稿与过期响应，PPT 保留全部卡片入口", async () => {
  const uri = new URL(process.env.DATABASE_URL!),
    origin = process.env.TEST_BASE_URL!;
  assert(
    ["127.0.0.1", "localhost"].includes(uri.hostname) &&
      /^blog_integration_[a-f0-9]{32}$/.test(uri.pathname.slice(1))
  );
  const id = randomUUID(),
    draftId = randomUUID(),
    raceId = randomUUID(),
    now = new Date();
  const make = (key: string, status: string) => ({
    id: key,
    name: `健康验证 ${key}`,
    url: `https://example.org/${key}`,
    category: "隔离健康验证",
    description: "",
    status,
    sortOrder: -100,
    version: 1,
    visits: 0,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await db()
      .insert(curatedLinks)
      .values([
        make(id, "published"),
        make(draftId, "draft"),
        make(raceId, "published"),
      ]);
    const result = await runLinkHealthChecks({
      force: true,
      check: async (url) => {
        if (url.endsWith(raceId))
          await db()
            .update(curatedLinks)
            .set({ url: `https://example.org/new-${raceId}` })
            .where(eq(curatedLinks.id, raceId));
        assert(!url.endsWith(draftId));
        return {
          state: "healthy",
          httpStatus: 200,
          latencyMs: 42,
          reason: "",
          checkedAt: now,
        };
      },
    });
    assert(result.checked > 0);
    let rows = await listCuratedLinks();
    assert.equal(rows.find((row) => row.id === id)?.health?.state, "healthy");
    assert.equal(rows.find((row) => row.id === raceId)?.health, null);
    const draftHealth = await db()
      .select()
      .from(linkHealth)
      .where(eq(linkHealth.linkId, draftId));
    assert.equal(draftHealth.length, 0);
    await db()
      .update(curatedLinks)
      .set({ url: `https://example.net/changed-${id}` })
      .where(eq(curatedLinks.id, id));
    assert.equal(
      (await listCuratedLinks()).find((row) => row.id === id)?.health,
      null
    );
    const refresh = await runLinkHealthChecks({
      check: async () => ({
        state: "restricted",
        httpStatus: 403,
        latencyMs: 25,
        reason: "",
        checkedAt: new Date(),
      }),
    });
    assert.equal(refresh.checked, 2);
    await db().update(linkHealth).set({checkedAt:new Date(Date.now()-2*24*3600_000)}).where(eq(linkHealth.linkId,id));
    const unchanged = await runLinkHealthChecks({
      check: async () => {
        throw Error("不应重复请求");
      },
    });
    assert.equal(unchanged.checked, 0);
    const page = load(await (await fetch(`${origin}/link?view=list`)).text());
    assert.equal(page(".links-page").attr("data-links-view"), "list");
    assert.equal(page("[data-links-view-choice]").length, 2);
    assert(page(".link-health").length > 0);
    assert(page(".link-checked-at").length > 0);
    const pptPage = load(await (await fetch(`${origin}/ppt`)).text());
    assert.equal(pptPage(".slide-card").length, 2);
    pptPage(".slide-card").each((_, el) =>
      assert.match(pptPage(el).attr("href")!, /^\/ppt\//)
    );
  } finally {
    await closeDatabase();
  }
});

test('碎碎念云端草稿跨设备读取、并发保护、重试幂等与历史随记编辑回收', async () => {
  const origin = process.env.TEST_BASE_URL!, uri = new URL(process.env.DATABASE_URL!);
  assert(['127.0.0.1','localhost'].includes(uri.hostname) && /^blog_integration_[a-f0-9]{32}$/.test(uri.pathname.slice(1)));
  const id = randomUUID(), source = `local:fixture-${id}`, email = `draft-${id}@example.test`, password = randomUUID();
  const oldText = '历史随记，保留排版', oldHtml = '<p><strong>历史随记</strong>，<a href="https://example.com">保留排版</a></p><img src="https://legacy.example.com/old.jpg" alt="旧图">';
  const input = { text: oldText, format: 'plain', images: [{ url: 'https://legacy.example.com/old.jpg', alt: '旧图' }], publishedAt: new Date(Date.now()-60000).toISOString() };
  try {
    await createAdmin(email,password);
    const login = async () => {
      const response = await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password,turnstileToken:'XXXX.DUMMY.TOKEN.XXXX'})});
      assert.equal(response.status,200);return response.headers.get('set-cookie')!.split(';')[0];
    };
    const first = await login(), second = await login();
    const call = (path:string, method='GET', value?:unknown, cookie=first) => fetch(origin+'/api/admin/'+path,{method,headers:{origin,'content-type':'application/json',cookie},body:value===undefined?undefined:JSON.stringify(value)});
    await db().insert(momentSources).values({id:source,platform:'local',account:id,title:'历史随记测试',enabled:true,syncState:{archive:true},createdAt:new Date()});
    await db().insert(moments).values({id,sourceId:source,externalId:id,sourceUrl:'https://example.com/original',title:'历史标题',text:oldText,html:oldHtml,media:input.images.map(image=>({type:'image' as const,...image})),tags:['保留标签'],contentHash:'a'.repeat(64),status:'published',publishedAt:new Date(input.publishedAt),firstSeenAt:new Date(),lastSeenAt:new Date()});
    let row = await (await call(`moments/local/${id}`)).json();
    assert(row.editable && row.historical && !row.hasDraft);
    let response = await call(`moments/local/${id}/draft`,'PUT',{input:{...input,text:'**设备一的草稿**',format:'markdown'},version:row.version});
    assert.equal(response.status,200);row=await response.json();
    assert.equal(row.status,'published');assert(row.hasDraft);
    const [live] = await db().select().from(moments).where(eq(moments.id,id));
    assert.equal(live.text,oldText);assert.equal(live.html,oldHtml);assert.equal(live.status,'published');
    const page = await (await fetch(`${origin}/moments/posts/${id}`)).text();
    assert(page.includes('历史随记'));assert(!page.includes('设备一的草稿'));
    const remote = await (await call(`moments/local/${id}`,'GET',undefined,second)).json();
    assert.equal(remote.text,'**设备一的草稿**');assert.equal(remote.version,row.version);
    const next = {...input,text:'设备二继续写作',format:'markdown'};
    response = await call(`moments/local/${id}/draft`,'PUT',{input:next,version:remote.version},second);
    assert.equal(response.status,200);const updated=await response.json();
    assert.equal((await call(`moments/local/${id}/draft`,'PUT',{input:{...next,text:'旧设备不能覆盖'},version:row.version})).status,409);
    response = await call(`moments/local/${id}/draft`,'PUT',{input:next,version:row.version});
    assert.equal(response.status,200);assert.equal((await response.json()).version,updated.version);
    const drafts = await (await call('moments/local?status=draft')).json();
    assert(drafts.items.some((item:any)=>item.id===id && item.status==='published' && item.hasDraft));
    assert.equal((await call(`moments/local/${id}/draft`,'PUT',{input:{...input,images:[{url:'https://unregistered.example.com/new.jpg',alt:''}]},version:updated.version})).status,400);
    response = await call(`moments/local/${id}/draft`,'PUT',{input,version:updated.version});
    assert.equal(response.status,200);row=await response.json();
    response = await call(`moments/local/${id}`,'PUT',{input:{...input,status:'published'},version:row.version});
    assert.equal(response.status,200);row=await response.json();assert(!row.hasDraft);
    const [preserved] = await db().select().from(moments).where(eq(moments.id,id));
    assert.equal(preserved.html,oldHtml);assert.equal(preserved.sourceId,source);assert.deepEqual(preserved.tags,['保留标签']);
    assert.equal((await call(`moments/local/${id}/trash`,'POST',{version:row.version})).status,200);
    row=await (await call(`moments/local/${id}`)).json();assert.equal(row.status,'trash');
    assert.equal((await fetch(`${origin}/moments/posts/${id}`)).status,404);
    assert.equal((await call(`moments/local/${id}/restore`,'POST',{version:row.version})).status,200);
    const clientId=randomUUID(), unfinished={text:'{% unknown /%}',format:'markdown',images:[],publishedAt:new Date().toISOString()};
    response=await call(`moments/local/${clientId}/draft`,'PUT',{input:unfinished,version:null});assert.equal(response.status,200);row=await response.json();
    response=await call(`moments/local/${clientId}/draft`,'PUT',{input:unfinished,version:null});assert.equal(response.status,200);assert.equal((await response.json()).version,row.version);
    assert.equal((await db().select().from(moments).where(eq(moments.id,clientId))).length,1);
    assert.equal((await fetch(`${origin}/moments/posts/${clientId}`)).status,404);
    assert.equal((await call(`moments/local/${clientId}`,'PUT',{input:{...unfinished,status:'published'},version:row.version})).status,400);
    assert.equal((await (await call(`moments/local/${clientId}`,'GET',undefined,second)).json()).text,unfinished.text);
    const ready={...unfinished,text:'**准备好了**'};
    row=await (await call(`moments/local/${clientId}/draft`,'PUT',{input:ready,version:row.version})).json();
    response=await call(`moments/local/${clientId}`,'PUT',{input:{...ready,status:'published'},version:row.version});assert.equal(response.status,200);
    const published=await response.json();assert(!published.hasDraft);
    assert((await (await fetch(`${origin}/moments/posts/${clientId}`)).text()).includes('<strong>准备好了</strong>'));
  } finally { await closeDatabase(); }
});

test('文章云端草稿：无标题续写、独立会话、并发重试、发布隔离与草稿箱', async () => {
  const origin = process.env.TEST_BASE_URL!, uri = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(uri.hostname) && /^blog_integration_[a-f0-9]{32}$/.test(uri.pathname.slice(1)));
  assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const { posts } = await import('../src/db/schema');
  const id = randomUUID(), email = `article-cloud-${id}@example.test`, password = randomUUID();
  const call = (path: string, method = 'GET', body?: unknown, cookie = '', requestOrigin = origin) => fetch(`${origin}/api/admin/${path}`, { method, headers: { origin: requestOrigin, 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    await createAdmin(email, password);
    const login = async () => (await call('auth/login', 'POST', { email, password, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' })).headers.get('set-cookie')!.split(';')[0];
    const first = await login(), second = await login();
    const input = { title: '', section: 'blog', year: '20', slug: '', markdown: '未命名也可以从另一台设备继续写', description: '', category: '', tags: [], publishedAt: new Date(Date.now() - 60000).toISOString(), contentUpdatedAt: null, externalUrl: 'https://', coverUrl: '', canonicalUrl: '', featured: false, metadata: { z: 1, a: 2 } };
    const path = `posts/${id}/draft`, body = { input, version: null };
    assert.equal((await call(path, 'PUT', body)).status, 401);
    assert.equal((await call(path, 'PUT', body, first, 'https://elsewhere.invalid')).status, 403);
    const concurrent = await Promise.all([call(path, 'PUT', body, first), call(path, 'PUT', body, first)]);
    for (const response of concurrent) assert.equal(response.status, 200, await response.clone().text());
    let row = await concurrent[0].json();
    assert.equal((await concurrent[1].json()).version, row.version);
    assert.equal((await db().select().from(posts).where(eq(posts.id, id))).length, 1);
    let remote = await (await call(`posts/${id}`, 'GET', undefined, second)).json();
    assert.deepEqual(remote.input, input);
    assert.equal((await fetch(`${origin}${row.path}`)).status, 404);
    assert.equal((await call(`posts/${id}/publish`, 'POST', { version: row.version }, first)).status, 400);
    const next = { ...input, title: `云端文章 ${id}`, year: '2026', slug: `cloud-${id}`, externalUrl: '', markdown: '第二设备继续写作' };
    let response = await call(path, 'PUT', { input: next, version: row.version }, second); assert.equal(response.status, 200); remote = await response.json();
    assert.equal((await call(path, 'PUT', { input: { ...input, markdown: '过期设备覆盖' }, version: row.version }, first)).status, 409);
    response = await call(path, 'PUT', { input: next, version: row.version }, first); assert.equal(response.status, 200); assert.equal((await response.json()).version, remote.version);
    row = await (await call(`posts/${id}/publish`, 'POST', { version: remote.version }, first)).json(); assert.equal(row.status, 'published');
    const live = (await db().select().from(posts).where(eq(posts.id, id)))[0];
    response = await call(path, 'PUT', { input: { ...next, title: '', markdown: '未公开的新正文' }, version: row.version }, second); assert.equal(response.status, 200); row = await response.json();
    const after = (await db().select().from(posts).where(eq(posts.id, id)))[0];
    for (const field of ['title', 'markdown', 'path', 'status'] as const) assert.deepEqual(after[field], live[field]);
    const list = await (await call('posts?status=draft', 'GET', undefined, second)).json();
    assert(list.items.some((item: any) => item.id === id && item.status === 'published' && item.hasDraft));
    assert(!(await (await fetch(`${origin}${row.path}`)).text()).includes('未公开的新正文'));
    assert.equal((await call(`posts/${id}/trash`, 'POST', { version: row.version }, first)).status, 200);
    assert.equal((await call(path, 'PUT', { input: next, version: row.version }, second)).status, 409);
    row = await (await call(`posts/${id}`, 'GET', undefined, first)).json();
    response = await call(`posts/${id}/restore`, 'POST', { version: row.version }, first); assert.equal(response.status, 200); assert.equal((await response.json()).input.markdown, '未公开的新正文');
  } finally { await closeDatabase(); }
});
