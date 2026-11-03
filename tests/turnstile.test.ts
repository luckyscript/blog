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
test("IP 入口区分域名不匹配与缺少密钥，只提供已绑定的 HTTPS 后台链接", () => {
  const mismatch = publicTurnstileSettings("47.97.9.7", environment);
  assert.equal(mismatch.configured, false);
  assert.equal(mismatch.siteKey, "");
  assert.equal(mismatch.hostnameMismatch, true);
  assert.equal(mismatch.loginUrl, `https://${hostname}/admin/login`);
  assert.doesNotMatch(JSON.stringify(mismatch), /secret-only-on-server/);
  const missing = publicTurnstileSettings("47.97.9.7", {});
  assert.equal(missing.hostnameMismatch, false);
  assert.equal(missing.loginUrl, null);
  const configured = publicTurnstileSettings(hostname, environment);
  assert.equal(configured.hostnameMismatch, false);
  assert.equal(configured.loginUrl, null);
  for (const siteUrl of [
    "not-a-url",
    `http://${hostname}`,
    "https://elsewhere.test",
    `https://user:password@${hostname}`,
    "javascript:alert(1)",
  ]) {
    const config = publicTurnstileSettings("47.97.9.7", {
      ...environment,
      TURNSTILE_HOSTNAMES: hostname,
      SITE_URL: siteUrl,
    });
    assert.equal(config.hostnameMismatch, true);
    assert.equal(config.loginUrl, null);
  }
  assert.equal(
    publicTurnstileSettings("47.97.9.7", {
      ...environment,
      SITE_URL: `https://${hostname}/path?next=https://elsewhere.test#fragment`,
    }).loginUrl,
    `https://${hostname}/admin/login`
  );
});
test("域名不匹配的登录请求依然拒绝，不调用验证服务或创建会话", async () => {
  let calls = 0;
  await assert.rejects(
    verifyTurnstile("token", "47.97.9.7", {
      environment,
      fetch: async () => {
        calls++;
        return new Response(JSON.stringify(success));
      },
    }),
    (error: any) =>
      error.status === 503 && /当前访问地址未绑定/.test(error.message)
  );
  assert.equal(calls, 0);
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
    const body = JSON.parse(String(options?.body));
    assert.match(body.idempotency_key, /^[a-f0-9-]{36}$/);
    const { idempotency_key, ...payload } = body;
    assert.deepEqual(payload, {
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
test("连接中断与临时 HTTP 错误会重试，并复用同一幂等键和总超时", async () => {
  const keys: string[] = [];
  const signals: unknown[] = [];
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    keys.push(JSON.parse(String(options?.body)).idempotency_key);
    signals.push(options?.signal);
    calls++;
    if (calls === 1)
      throw new TypeError("private connection details", {
        cause: { code: "ETIMEDOUT" },
      });
    if (calls === 2)
      return new Response("temporarily unavailable", { status: 503 });
    return new Response(JSON.stringify(success));
  };
  await verifyTurnstile("widget-token", hostname, { environment, fetch });
  assert.equal(calls, 3);
  assert.equal(new Set(keys).size, 1);
  assert.match(keys[0], /^[a-f0-9-]{36}$/);
  assert.equal(new Set(signals).size, 1);
});
test("Cloudflare internal-error 可重试，令牌过期、无效和密钥错误不会重试", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  await verifyTurnstile("widget-token", hostname, {
    environment,
    fetch: async () =>
      new Response(
        JSON.stringify(
          ++calls === 1
            ? { success: false, "error-codes": ["internal-error"] }
            : success
        )
      ),
  });
  assert.equal(calls, 2);
  for (const code of [
    "invalid-input-response",
    "timeout-or-duplicate",
    "invalid-input-secret",
    "bad-request",
  ]) {
    calls = 0;
    await rejects(
      verifyTurnstile("widget-token", hostname, {
        environment,
        fetch: async () => {
          calls++;
          return new Response(
            JSON.stringify({ success: false, "error-codes": [code] })
          );
        },
      }),
      ["invalid-input-secret", "bad-request"].includes(code) ? 503 : 403
    );
    assert.equal(calls, 1);
  }
});
test("重试耗尽依然拒绝验证，诊断日志不记录密钥、令牌或原始错误", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "warn", (value: string) => logs.push(value));
  let calls = 0;
  await rejects(
    verifyTurnstile("private-widget-token", hostname, {
      environment,
      fetch: async () => {
        calls++;
        throw new TypeError(
          "private-error secret-only-on-server private-widget-token",
          {
            cause: { code: "private-widget-token" },
          }
        );
      },
    }),
    503
  );
  assert.equal(calls, 3);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).attempts, 3);
  assert.doesNotMatch(
    logs.join(""),
    /private-widget-token|secret-only-on-server|private-error/
  );
});
test("十秒总时限耗尽后停止重试，不为每次请求重置超时", async (t) => {
  t.mock.method(console, "warn", () => {});
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (duration: number) => {
    assert.equal(duration, 10_000);
    return timeout(20);
  });
  let calls = 0;
  await rejects(
    verifyTurnstile("widget-token", hostname, {
      environment,
      fetch: async (_url, options) => {
        calls++;
        return new Promise((_resolve, reject) => {
          const fallback = setTimeout(
            () => reject(new Error("unexpected timeout")),
            100
          );
          options?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(fallback);
              reject(new DOMException("request aborted", "AbortError"));
            },
            { once: true }
          );
        });
      },
    }),
    503
  );
  assert.equal(calls, 1);
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
