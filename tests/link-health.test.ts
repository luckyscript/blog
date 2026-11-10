import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  checkPublicLink,
  isPublicAddress,
  pinnedProbe,
} from "../src/lib/server/link-health-check";
import { healthDisplay } from "../src/lib/link-health";
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
test("探测拒绝回环、内网、元数据、映射地址、保留网段，允许公网 IPv4 和 IPv6", () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "172.16.1.1",
    "192.168.3.4",
    "169.254.169.254",
    "100.100.100.200",
    "0.0.0.0",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of [
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicAddress(ip), true, ip);
});
test("混合私网解析和跳往私网的重定向都不能发出内部请求", async () => {
  let requests = 0;
  const mixed = await checkPublicLink("https://example.com", {
    resolve: async () => [
      ...(await publicDns()),
      { address: "10.0.0.1", family: 4 },
    ],
    probe: async () => {
      requests++;
      return { status: 200 };
    },
  });
  assert.equal(mixed.state, "blocked");
  assert.equal(requests, 0);
  const redirect = await checkPublicLink("https://example.com", {
    resolve: async (host) =>
      host === "internal.example.com"
        ? [{ address: "169.254.169.254", family: 4 }]
        : publicDns(),
    probe: async () => {
      requests++;
      return { status: 302, location: "https://internal.example.com/metadata" };
    },
  });
  assert.equal(redirect.state, "blocked");
  assert.equal(requests, 1);
});
test("HEAD 不受支持时尝试 GET，认证与反爬不误报为失效", async () => {
  const methods: string[] = [];
  const normal = await checkPublicLink("https://example.com", {
    resolve: publicDns,
    probe: async (_url, address, method) => {
      assert.equal(address.address, "93.184.216.34");
      methods.push(method);
      return { status: method === "HEAD" ? 405 : 200 };
    },
  });
  assert.equal(normal.state, "healthy");
  assert.deepEqual(methods, ["HEAD", "GET"]);
  for (const [status, state] of [
    [403, "restricted"],
    [429, "restricted"],
    [404, "broken"],
    [410, "broken"],
    [503, "error"],
  ] as const) {
    const result = await checkPublicLink("https://example.com", {
      resolve: publicDns,
      probe: async () => ({ status }),
    });
    assert.equal(result.state, state);
    assert.equal(result.httpStatus, status);
  }
});
test("解析失败、超时与重定向循环有界返回且不冒充页面不存在", async () => {
  const dns = await checkPublicLink("https://example.com", {
    resolve: async () => {
      throw Object.assign(new Error(), { code: "ENOTFOUND" });
    },
  });
  assert.equal(dns.state, "unreachable");
  assert.equal(dns.reason, "dns");
  const timeout = await checkPublicLink("https://example.com", {
    timeoutMs: 10,
    resolve: publicDns,
    probe: async () =>
      new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 40)),
  });
  assert.equal(timeout.state, "unreachable");
  assert.equal(timeout.reason, "timeout");
  let calls = 0;
  const loop = await checkPublicLink("https://example.com", {
    resolve: publicDns,
    probe: async () => {
      calls++;
      return { status: 301, location: "/" };
    },
  });
  assert.equal(loop.reason, "redirect");
  assert.equal(calls, 1);
});
test("底层连接使用指定地址并保留原始 Host，不再次依赖域名解析", async () => {
  let host = "",
    method = "";
  const server = createServer((request, response) => {
    host = request.headers.host || "";
    method = request.method || "";
    response.writeHead(200, { "content-type": "text/html" });
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = new URL(`http://nonexistent.example.com:${address.port}/check`);
    const result = await pinnedProbe(
      url,
      { address: "127.0.0.1", family: 4 },
      "HEAD",
      AbortSignal.timeout(2000)
    );
    assert.equal(result.status, 200);
    assert.equal(host, `nonexistent.example.com:${address.port}`);
    assert.equal(method, "HEAD");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("没有结果与过期结果保持中性，受限提示与检查时间可见", () => {
  assert.equal(healthDisplay(null).label, "待检查");
  const health = {
    state: "restricted",
    httpStatus: 403,
    latencyMs: 123,
    reason: "",
    checkedAt: new Date(),
  };
  assert.equal(healthDisplay(health).label, "访问受限");
  assert.match(healthDisplay(health).title, /HTTP 403/);
  assert.equal(
    healthDisplay({
      ...health,
      checkedAt: new Date(Date.now() - 8 * 24 * 3600_000 - 3600_000),
    }).label,
    "待复查"
  );
});
