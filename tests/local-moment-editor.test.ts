import test from "node:test";
import assert from "node:assert/strict";
import { prepareLocalMoment } from "../src/lib/server/local-moments";
import { load } from "cheerio";
test("本站碎碎念保留段落与图片顺序，用户文字不能注入 HTML", () => {
  const result = prepareLocalMoment({
    text: "第一段\n换行\n\n<script>alert(1)</script>",
    images: [
      { url: "https://images.example.com/a.jpg", alt: '" onerror="steal()' },
    ],
    publishedAt: new Date().toISOString(),
    status: "published",
  });
  const $ = load(result.html);
  assert.equal($("p").length, 2);
  assert.equal($("br").length, 1);
  assert.equal($("script,[onerror]").length, 0);
  assert.equal($("img").length, 1);
  assert.equal($("p").last().text(), "<script>alert(1)</script>");
});
test("本站发布拒绝空白、超量图片、不安全地址和未来时间，图片单独发布有效", () => {
  const input = {
    text: "",
    images: [],
    publishedAt: new Date().toISOString(),
    status: "published",
  };
  assert.throws(() => prepareLocalMoment(input));
  assert.throws(() =>
    prepareLocalMoment({
      ...input,
      images: [{ url: "javascript:alert(1)", alt: "" }],
    })
  );
  assert.throws(() =>
    prepareLocalMoment({
      ...input,
      images: Array.from({ length: 10 }, () => ({
        url: "https://example.com/a.jpg",
        alt: "",
      })),
    })
  );
  assert.throws(() =>
    prepareLocalMoment({
      ...input,
      text: "未来",
      publishedAt: new Date(Date.now() + 60000).toISOString(),
    })
  );
  assert.equal(
    prepareLocalMoment({
      ...input,
      images: [{ url: "https://images.example.com/a.jpg", alt: "" }],
    }).input.images.length,
    1
  );
});

test('新碎碎念 Markdown 渲染为安全 HTML，旧纯文本标记保持原样', () => {
  const input = { text: '## 此刻\n\n**一些文字** [链接](https://example.com)\n\n<script>alert(1)</script>', images: [], publishedAt: new Date().toISOString(), status: 'published' };
  const markdown = prepareLocalMoment({ ...input, format: 'markdown' });
  const $ = load(markdown.html);
  assert(markdown.html.startsWith('<div class="local-moment-markdown">'));
  assert.equal($('h2').text(), '此刻');
  assert.equal($('strong').text(), '一些文字');
  assert.equal($('script,[onerror]').length, 0);
  assert.equal($('a').attr('href'), 'https://example.com');
  const plain = load(prepareLocalMoment(input).html);
  assert.equal(plain('h2,strong').length, 0);
  assert.match(plain('p').first().text(), /## 此刻/);
});

test('Markdown 内图片保持为链接，配图仍由九张图片限制与媒体库流程管理', () => {
  const result = prepareLocalMoment({ text: '![外部图片](https://example.com/photo.jpg) [危险](javascript:alert)', format: 'markdown', images: [{ url: 'https://images.example.com/registered.jpg', alt: '配图' }], publishedAt: new Date().toISOString(), status: 'draft' });
  const $ = load(result.html);
  assert.equal($('img').length, 1);
  assert.equal($('img').attr('src'), 'https://images.example.com/registered.jpg');
  assert.equal($('a').first().attr('href'), 'https://example.com/photo.jpg');
  assert.equal($('a[href^="javascript:"]').length, 0);
});
