import test from "node:test";
import assert from "node:assert/strict";
import { identifyFile, uploadToGithub } from "../src/lib/server/media";

test("上传依照真实文件头识别类型，脚本文件不能冒充图片", () => {
  assert.equal(
    identifyFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).mime,
    "image/png"
  );
  assert.equal(identifyFile(Buffer.from("%PDF-1.7")).mime, "application/pdf");
  assert.throws(() =>
    identifyFile(Buffer.from('<svg onload="alert(1)"></svg>'))
  );
  assert.throws(() => identifyFile(Buffer.from("fake.png")));
});
test("GitHub 上传使用服务端凭据，保留指定仓库与分支", async (t) => {
  const old = process.env.GITHUB_MEDIA_TOKEN;
  process.env.GITHUB_MEDIA_TOKEN = "test-only-token";
  t.after(() => {
    if (old === undefined) delete process.env.GITHUB_MEDIA_TOKEN;
    else process.env.GITHUB_MEDIA_TOKEN = old;
  });
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const mock = async (url: any, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return Response.json({ private: false });
    if (calls.length === 2) return new Response(null, { status: 404 });
    return Response.json({ content: { sha: "blob-sha" } }, { status: 201 });
  };
  const result = await uploadToGithub(
    Buffer.from("sample"),
    "uploads/2026/10/sample.png",
    mock as typeof fetch
  );
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /api.github.com\/repos\/luckyscript\/image$/);
  assert.equal(calls[2].options.method, "PUT");
  assert.equal(
    (calls[2].options.headers as any).Authorization,
    "Bearer test-only-token"
  );
  const uploaded = JSON.parse(calls[2].options.body as string);
  assert.equal(uploaded.branch, "master");
  assert.equal(Buffer.from(uploaded.content, "base64").toString(), "sample");
  assert.equal(
    result.url,
    "https://raw.githubusercontent.com/luckyscript/image/master/uploads/2026/10/sample.png"
  );
  assert.doesNotMatch(JSON.stringify(result), /test-only-token/);
});
test("GitHub 拒绝私有仓库并返回可理解的上传错误", async (t) => {
  const old = process.env.GITHUB_MEDIA_TOKEN;
  process.env.GITHUB_MEDIA_TOKEN = "test-only-token";
  t.after(() => {
    if (old === undefined) delete process.env.GITHUB_MEDIA_TOKEN;
    else process.env.GITHUB_MEDIA_TOKEN = old;
  });
  await assert.rejects(
    uploadToGithub(Buffer.from("x"), "uploads/x.png", (async () =>
      Response.json({ private: true })) as typeof fetch),
    /公开仓库/
  );
  await assert.rejects(
    uploadToGithub(
      Buffer.from("x"),
      "uploads/x.png",
      (async () => new Response(null, { status: 403 })) as typeof fetch
    ),
    /仓库权限/
  );
});
