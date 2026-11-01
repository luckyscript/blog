import test from "node:test";
import assert from "node:assert/strict";
import { parsePost, postPath } from "../src/lib/server/content-input";
import { parseAndTransform, renderHtml } from "../src/lib/markdoc/render";
import { scanContent } from "../src/lib/server/import-content";

const input = {
  title: "旧文章",
  section: "blog",
  year: "0000",
  slug: "legacy-post",
  markdown: "# 测试",
  publishedAt: "2020-01-01T00:00:00.000Z",
};
test("原始路径年份与发布时间独立，额外字段保留，保留字段不能覆盖可见性", () => {
  const value = parsePost({
    ...input,
    metadata: { draft: true, date: "bad", toc: false },
    tags: ["生活", "生活"],
  });
  assert.equal(postPath(value), "/blog/0000/legacy-post");
  assert.deepEqual(value.metadata, { toc: false });
  assert.deepEqual(value.tags, ["生活"]);
  assert.equal(
    postPath({ section: "ppt", year: "2026", slug: "passkey" }),
    "/ppt/passkey"
  );
});
test("阻止路径穿越、危险地址和过长标题", () => {
  for (const changed of [
    { slug: "../secret" },
    { slug: "a/b" },
    { year: "../." },
    { externalUrl: "javascript:alert(1)" },
    { coverUrl: "//evil.test/a.png" },
    { coverUrl: "https://" },
    { title: "a".repeat(256) },
  ]) {
    assert.throws(() => parsePost({ ...input, ...changed }));
  }
});
test("HTML 预览保留代码、图片、标题并转义脚本", async () => {
  const tree = await parseAndTransform({
    content:
      "# 标题\n\n```unknown\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(2)</script>\n\n![图](/images/a.png)",
  });
  const html = renderHtml(tree);
  assert.match(html, /<h1[^>]*>标题<\/h1>/);
  assert.match(html, /<pre><code/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script|<img src="x"/);
  assert.match(html, /src="\/images\/a.png"/);
});
test("全部已有 Markdown 可以导入，保留 Markdoc、历史 URL 和日期", async () => {
  const result = await scanContent();
  assert.deepEqual(result.errors, []);
  assert.ok(result.items.length >= 134);
  const post = result.items.find(
    (item) => item.sourcePath === "content/blog/2026/dongshan.md"
  )!;
  assert.equal(post.input.year, "2026");
  assert.equal(postPath(post.input), "/blog/2026/dongshan");
  assert.equal(post.input.metadata.toc, false);
  assert.match(
    result.items.find((item) => item.sourcePath === "content/link/LLM.md")!
      .input.markdown,
    /{% bilibili/
  );
});

test("相对文章链接与图片路径保留，危险协议不进入 HTML", async () => {
  const html = renderHtml(
    await parseAndTransform({
      content:
        "[下一篇](../next)\n\n![图片](./image.png)\n\n[危险](javascript:evil)",
    })
  );
  assert.match(html, /href="\.\.\/next"/);
  assert.match(html, /src="\.\/image.png"/);
  assert.doesNotMatch(html, /href="javascript:/);
});
