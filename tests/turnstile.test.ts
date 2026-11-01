import test from "node:test";
import assert from "node:assert/strict";
import {
  publicTurnstileSettings,
  verifyTurnstile,
  TURNSTILE_ACTION,
} from "../src/lib/server/turnstile";
import { login } from "../src/lib/server/auth";

const hostname = "blog.example.test";
const environment = {
  NODE_ENV: "production",
  SITE_URL: `https://${hostname}`,
  TURNSTILE_SITE_KEY: "site-production-key",
  TURNSTILE_SECRET_KEY: "secret-only-on-server",
};
const success = { success: true, hostname, action: TURNSTILE_ACTION };
function response(value: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
}
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(promise, (error: any) => error.status === status);

test("Turnstile 配置必须完整且绑定当前域名，浏览器配置不包含 Secret Key", () => {
  const config = publicTurnstileSettings(hostname, environment);
  assert.equal(config.configured, true);
  assert.equal(config.siteKey, environment.TURNSTILE_SITE_KEY);
  assert.doesNotMatch(
    JSON.stringify(config),
    /secret-only-on-server|secretKey|secret_key/
  );
  assert.equal(publicTurnstileSettings(hostname, {}).configured, false);
  assert.equal(
    publicTurnstileSettings(hostname, {
      ...environment,
      TURNSTILE_SECRET_KEY: "",
    }).configured,
    false
  );
  assert.equal(
    publicTurnstileSettings("elsewhere.test", environment).configured,
    false
  );
  assert.equal(
    publicTurnstileSettings("admin.example.test", {
      ...environment,
      TURNSTILE_HOSTNAMES: "blog.example.test,admin.example.test",
    }).configured,
    true
  );
});
test("缺失、过长或未配置的验证令牌直接拒绝，不请求 Cloudflare", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => {
    calls++;
    return new Response();
  };
  for (const token of [undefined, null, "", "   ", "x".repeat(2049)])
    await rejects(
      verifyTurnstile(token, hostname, { environment, fetch }),
      403
    );
  await rejects(
    verifyTurnstile("token", hostname, { environment: {}, fetch }),
    503
  );
  assert.equal(calls, 0);
});
test("服务器向固定 Siteverify 地址发送令牌和私钥，核对用途与域名", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(String(options?.body)), {
      secret: environment.TURNSTILE_SECRET_KEY,
      response: "widget-token",
    });
    return new Response(JSON.stringify(success));
  };
  await verifyTurnstile("widget-token", hostname, { environment, fetch });
  assert.equal(calls, 1);
  for (const changed of [
    { action: "contact" },
    { action: undefined },
    { hostname: "other.example.test" },
    { hostname: undefined },
    { metadata: { result_with_testing_key: true } },
  ])
    await rejects(
      verifyTurnstile("widget-token", hostname, {
        environment,
        fetch: response({ ...success, ...changed }),
      }),
      403
    );
});
test("Cloudflare 拒绝、过期、重复令牌和网络故障均不能登录", async () => {
  for (const code of ["invalid-input-response", "timeout-or-duplicate"])
    await rejects(
      verifyTurnstile("token", hostname, {
        environment,
        fetch: response({ success: false, "error-codes": [code] }),
      }),
      403
    );
  for (const code of ["internal-error", "invalid-input-secret"])
    await rejects(
      verifyTurnstile("token", hostname, {
        environment,
        fetch: response({ success: false, "error-codes": [code] }),
      }),
      503
    );
  for (const fetch of [
    response({}, 500),
    response({}),
    response({ success: "true" }),
    (async () => {
      throw new Error("network failure with private details");
    }) as typeof globalThis.fetch,
  ])
    await rejects(
      verifyTurnstile("token", hostname, { environment, fetch }),
      503
    );
});
test("官方测试密钥只允许开发环境的回环地址，依然执行 Siteverify 校验", async () => {
  const local = {
    NODE_ENV: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  };
  assert.equal(publicTurnstileSettings("127.0.0.1", local).testing, true);
  assert.equal(publicTurnstileSettings(hostname, local).configured, false);
  assert.equal(
    publicTurnstileSettings("127.0.0.1", { ...local, NODE_ENV: "production" })
      .configured,
    false
  );
  assert.equal(
    publicTurnstileSettings("127.0.0.1", {
      ...local,
      TURNSTILE_SECRET_KEY: environment.TURNSTILE_SECRET_KEY,
    }).configured,
    false
  );
  let calls = 0;
  await verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "127.0.0.1", {
    environment: local,
    fetch: async () => {
      calls++;
      return new Response(
        JSON.stringify({
          success: true,
          hostname: "example.com",
          metadata: { result_with_testing_key: true },
        })
      );
    },
  });
  assert.equal(calls, 1);
  await rejects(
    verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", "127.0.0.1", {
      environment: local,
      fetch: response({ success: false }),
    }),
    403
  );
  await rejects(
    verifyTurnstile("XXXX.DUMMY.TOKEN.XXXX", hostname, { environment: local }),
    503
  );
});
test("认证入口在查询密码或创建会话之前强制验证，不能只绕过登录表单", async (t) => {
  const previous = {
    siteKey: process.env.TURNSTILE_SITE_KEY,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
    hosts: process.env.TURNSTILE_HOSTNAMES,
  };
  process.env.TURNSTILE_SITE_KEY = environment.TURNSTILE_SITE_KEY;
  process.env.TURNSTILE_SECRET_KEY = environment.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_HOSTNAMES = hostname;
  t.after(() => {
    for (const [key, value] of [
      ["TURNSTILE_SITE_KEY", previous.siteKey],
      ["TURNSTILE_SECRET_KEY", previous.secretKey],
      ["TURNSTILE_HOSTNAMES", previous.hosts],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  let cookies = 0;
  const context = {
    url: new URL(`https://${hostname}/api/admin/auth/login`),
    cookies: {
      set() {
        cookies++;
      },
    },
  };
  await rejects(
    login(context as any, "admin@example.test", "not-a-password"),
    403
  );
  assert.equal(cookies, 0);
});
