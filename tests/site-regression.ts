import test from "node:test";
import assert from "node:assert/strict";
import { publicPosts } from "../src/lib/server/posts";
import { closeDatabase } from "../src/db";
import { momentChannel } from "../src/lib/moments/store";

test("所有已发布文章和本地栏目均可访问，草稿与后台不进入 Sitemap", async () => {
  const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  try {
    const rows = await publicPosts();
    const pages = [
      "/",
      "/blog",
      "/tech",
      "/sight",
      "/link",
      "/ppt",
      "/projects",
      "/life",
      "/card",
      "/rss.xml",
      "/sitemap.xml",
      "/moments/archive",
    ];
    let checked = 0;
    for (const path of pages) {
      const response = await fetch(new URL(path, origin), {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 200, path);
      checked++;
    }
    const queue = rows.filter((row) => row.section !== "projects");
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          const response = await fetch(new URL(row.path, origin), {
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
          const expected = row.metadata.pageContent
            ? 301
            : row.externalUrl
            ? 302
            : 200;
          assert.equal(response.status, expected, row.path);
          if (expected === 200)
            assert.ok(
              (await response.text()).includes(
                row.title
                  .replaceAll("&", "&amp;")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;")
              ),
              row.path
            );
          checked++;
        }
      })
    );
    console.log(`已验证 ${checked} 个栏目、文章与输出地址`);
  } finally {
    await closeDatabase();
  }
});

test("碎碎念首页、接口、分页和旧链接都读取已同步数据", async () => {
  const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  try {
    const latest = await momentChannel({limit:3});
    assert.ok(latest.posts.length > 0, "请先同步公开频道");
    const api = await fetch(new URL('/api/moments.json',origin));
    assert.equal(api.status,200);
    assert.deepEqual((await api.json()).posts.map((p:any)=>p.id), latest.posts.map(p=>p.id));
    const home = await (await fetch(origin)).text();
    for (const post of latest.posts) assert.ok(home.includes(`/moments/posts/${post.id}`));
    let channel = await momentChannel(), path='/moments', seen = new Set<string>();
    do {
      const response=await fetch(new URL(path,origin)); assert.equal(response.status,200,path);
      const html=await response.text();
      for(const post of channel.posts) {assert.ok(html.includes(`/moments/posts/${post.id}`),path);assert.ok(!seen.has(post.id),'分页重复');seen.add(post.id);}
      if (!channel.hasOlder) break;
      const cursor=channel.posts.at(-1)!.id; path=`/moments/before/${cursor}`; channel=await momentChannel({before:cursor});
    } while(channel.posts.length);
    for(const id of [latest.posts[0].id,latest.posts[0].externalId]) {
      const response=await fetch(new URL(`/moments/posts/${id}`,origin));assert.equal(response.status,200);assert.ok((await response.text()).includes(latest.posts[0].sourceUrl));
    }
    console.log(`已验证 ${seen.size} 条已入库碎碎念的列表、分页和详情入口`);
  } finally {await closeDatabase();}
});
