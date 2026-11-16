import test from "node:test";
import assert from "node:assert/strict";
import { splitDriverNotes } from "../src/lib/series/driver-import";
import { analyticsPath, pageCategory } from "../src/lib/analytics/shared";
test("系列拆分保留原文、原始日期、行程与跨年顺序，不接受结构漂移", () => {
  const raw =
    "写在路上。\n\n## 被追尾了\n\n> 2024年1月6日 家-动物园（52元）\n\n第一段**原文**。\n\n另一段。\n\n## 萧山机场的高速费\n\n> 2023年6月19日 机场-家\n\n机场正文。\n\n## 北京的交警很少\n\n> 2023年4月18日 北京\n\n北京正文。\n";
  const parsed = splitDriverNotes(raw);
  assert.equal(parsed.description, "写在路上。");
  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.chapters[0].publishedAt, "2024-01-05T16:00:00.000Z");
  assert.equal(parsed.chapters[0].context, "家-动物园（52元）");
  assert.equal(
    parsed.chapters[0].markdown,
    "> 2024年1月6日 家-动物园（52元）\n\n第一段**原文**。\n\n另一段。"
  );
  assert.equal(parsed.chapters[0].description, "第一段原文。");
  assert.throws(
    () => splitDriverNotes(raw + "\n## 新故事\n内容"),
    /篇目已变化/
  );
  assert.throws(
    () => splitDriverNotes(raw.replace("2024年1月6日", "2024年2月30日")),
    /日期无效/
  );
});
test("系列入口参与访问统计，查询参数不进入路径", () => {
  assert.equal(
    analyticsPath("/series/passenger-and-drivers?token=private"),
    "/series/passenger-and-drivers"
  );
  assert.equal(pageCategory("/series/passenger-and-drivers"), "listing");
});
