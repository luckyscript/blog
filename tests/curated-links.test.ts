import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Markdoc from "@markdoc/markdoc";
import {
  safeLinkUrl,
  routeCuratedLinks,
  registeredLinkForUrl,
} from "../src/lib/server/links";
test("外链目标只接受完整公开网址，拒绝协议、凭据、控制字符与内部跳转链", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.com",
    "https://user:password@example.com",
    "http://localhost",
    "http://127.0.0.1",
    "http://0x7f000001",
    "http://[::1]",
    "https://example.com:8080",
    "https://example.com/\r\nLocation:evil",
    "https://example.com/%0d%0a",
    "https://example.com\\@evil.com",
    "https://rainonpiano.com/link/to/abc",
  ])
    assert.throws(() => safeLinkUrl(value), value);
  assert.equal(
    safeLinkUrl("https://example.com/path?q=hello#part"),
    "https://example.com/path?q=hello#part"
  );
  assert.equal(safeLinkUrl("http://example.com/"), "http://example.com/");
});
test("专题文章使用稳定 UUID，修改目标后保留旧 URL 别名，缓存树不被修改", () => {
  const originalUrl = "https://old.example.com/",
    id = "ed82f4d3-a5fd-4ea8-8e32-1fe07a9e7760";
  const links = [
    {
      id,
      url: "https://new.example.com/",
      status: "published",
      sourceKey: createHash("sha256").update(originalUrl).digest("hex"),
    },
  ];
  const original = new Markdoc.Tag("p", {}, [
    new Markdoc.Tag("a", { href: originalUrl }, ["原链接"]),
    new Markdoc.Tag("a", { href: "https://unregistered.example.com" }, [
      "未登记",
    ]),
  ]);
  const result = routeCuratedLinks(original, links);
  assert(result instanceof Markdoc.Tag);
  const first = result.children[0],
    second = result.children[1],
    old = original.children[0];
  assert(first instanceof Markdoc.Tag);
  assert(second instanceof Markdoc.Tag);
  assert(old instanceof Markdoc.Tag);
  assert.equal(first.attributes.href, `/link/to/${id}`);
  assert.equal(second.name, "span");
  assert.equal(old.attributes.href, originalUrl);
  assert.equal(registeredLinkForUrl(originalUrl, links)?.id, id);
  assert.match(Markdoc.renderers.html(result), /link\/to\//);
});
