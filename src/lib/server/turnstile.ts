import { z } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Agent } from "undici";
import { env } from "./env";
import { AppError } from "./errors";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Some ECS-to-Cloudflare connections exceed Node's default 250 ms family
// selection window. Allow a longer attempt without changing other requests.
const siteverifyAgent = new Agent({
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 1500,
  connectTimeout: 4000,
  connections: 2,
});
const transientNetworkCodes = new Set([
  "ETIMEDOUT",
  "ENETUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
function unavailable(reason: string, attempts: number): never {
  // Log only fixed reason codes, never tokens, secrets, response bodies or errors.
  console.warn(
    JSON.stringify({
      event: "turnstile_siteverify_unavailable",
      reason,
      attempts,
    })
  );
  throw new AppError(503, "安全验证暂不可用，请稍后重新验证");
}
export const TURNSTILE_ACTION = "admin-login";
const testSiteKeys = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
const testSecretKeys = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);
const normalizeHost = (value: string) => value.toLowerCase().replace(/\.$/, "");
type Settings = {
  siteKey: string;
  secretKey: string;
  hostnames: string[];
  testing: boolean;
  configured: boolean;
  hostnameMismatch: boolean;
  loginUrl: string | null;
};
function settings(
  requestHostname: string,
  values?: NodeJS.ProcessEnv
): Settings {
  const value = (name: string) => (values ? values[name] || "" : env(name));
  const siteKey = value("TURNSTILE_SITE_KEY").trim();
  const secretKey = value("TURNSTILE_SECRET_KEY").trim();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    normalizeHost(requestHostname)
  );
  const production =
    value("NODE_ENV") === "production" ||
    (!values && import.meta.env?.PROD === true);
  const testPair = testSiteKeys.has(siteKey) && testSecretKeys.has(secretKey);
  const testing = testPair && local && !production;
  let hostnames = value("TURNSTILE_HOSTNAMES")
    .split(",")
    .map((host) => normalizeHost(host.trim()))
    .filter(Boolean);
  if (!hostnames.length) {
    try {
      hostnames = [normalizeHost(new URL(value("SITE_URL")).hostname)];
    } catch {
      /* Missing deployment hostname keeps login closed. */
    }
  }
  const usesTestKey =
    testSiteKeys.has(siteKey) || testSecretKeys.has(secretKey);
  const keysConfigured = Boolean(
    siteKey &&
      secretKey &&
      /^[\w-]{1,200}$/.test(siteKey) &&
      (!usesTestKey || testing)
  );
  const hostnameMismatch =
    keysConfigured &&
    !testing &&
    !hostnames.includes(normalizeHost(requestHostname));
  const configured = keysConfigured && !hostnameMismatch;
  let loginUrl: string | null = null;
  if (hostnameMismatch) {
    try {
      const site = new URL(value("SITE_URL"));
      if (
        site.protocol === "https:" &&
        !site.username &&
        !site.password &&
        hostnames.includes(normalizeHost(site.hostname))
      )
        loginUrl = new URL("/admin/login", site.origin).href;
    } catch {
      /* A missing or invalid canonical URL must not produce a login link. */
    }
  }
  return {
    siteKey,
    secretKey,
    hostnames,
    testing,
    configured,
    hostnameMismatch,
    loginUrl,
  };
}

/** Only this projection may be passed to the browser. */
export function publicTurnstileSettings(
  hostname: string,
  values?: NodeJS.ProcessEnv
) {
  const config = settings(hostname, values);
  return {
    siteKey: config.configured ? config.siteKey : "",
    configured: config.configured,
    testing: config.testing,
    hostnameMismatch: config.hostnameMismatch,
    loginUrl: config.loginUrl,
  };
}

const verificationResult = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  metadata: z
    .object({ result_with_testing_key: z.boolean().optional() })
    .passthrough()
    .optional(),
});
export async function verifyTurnstile(
  token: unknown,
  hostname: string,
  options: {
    fetch?: typeof fetch;
    environment?: NodeJS.ProcessEnv;
  } = {}
) {
  const config = settings(hostname, options.environment);
  if (!config.configured)
    throw new AppError(
      503,
      config.hostnameMismatch
        ? "当前访问地址未绑定登录验证，请通过博客域名登录"
        : "登录验证尚未配置，请联系管理员"
    );
  if (typeof token !== "string" || !token.trim() || token.length > 2048)
    throw new AppError(403, "请先完成 Cloudflare 安全验证");
  let result: z.infer<typeof verificationResult> | undefined;
  const signal = AbortSignal.timeout(10_000);
  // Reusing this key makes a retry safe even if Cloudflare consumed the token
  // before the first connection was interrupted.
  const idempotencyKey = randomUUID();
  let attempts = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    attempts++;
    let reason = "TRANSPORT_ERROR";
    try {
      const request = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: config.secretKey,
          response: token,
          idempotency_key: idempotencyKey,
        }),
        signal,
        redirect: "error" as const,
        dispatcher: siteverifyAgent,
      };
      const response = await (options.fetch ?? fetch)(SITEVERIFY, request);
      if (!response.ok) {
        reason = `HTTP_${response.status}`;
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500)
          unavailable(reason, attempts);
        throw new Error("Siteverify unavailable");
      }
      reason = "INVALID_RESPONSE";
      result = verificationResult.parse(await response.json());
      const codes = result["error-codes"] ?? [];
      if (
        result.success ||
        !codes.length ||
        codes.some((code) => code !== "internal-error")
      )
        break;
      reason = "INTERNAL_ERROR";
    } catch (error) {
      if (error instanceof AppError) throw error;
      result = undefined;
      const code = (error as { cause?: { code?: unknown } })?.cause?.code;
      if (typeof code === "string" && transientNetworkCodes.has(code))
        reason = code;
    }
    if (attempt === 2 || signal.aborted)
      unavailable(signal.aborted ? "TIMEOUT" : reason, attempts);
    try {
      await delay(100 * (attempt + 1), undefined, { signal });
    } catch {
      unavailable("TIMEOUT", attempts);
    }
  }
  if (!result) unavailable("INVALID_RESPONSE", attempts);
  if (!result.success) {
    const codes = result["error-codes"] ?? [];
    const serviceError = [
      "missing-input-secret",
      "invalid-input-secret",
      "internal-error",
      "bad-request",
    ].find((code) => codes.includes(code));
    if (serviceError) unavailable(serviceError, attempts);
    throw new AppError(
      403,
      codes.includes("timeout-or-duplicate")
        ? "安全验证已过期或已使用，请重新验证"
        : "安全验证未通过，请重新验证"
    );
  }
  // Dummy responses do not carry the widget's hostname/action. They are accepted
  // only with an explicit official test-key pair on a non-production loopback URL.
  if (
    !config.testing &&
    (result.metadata?.result_with_testing_key ||
      result.action !== TURNSTILE_ACTION ||
      !result.hostname ||
      normalizeHost(result.hostname) !== normalizeHost(hostname) ||
      !config.hostnames.includes(normalizeHost(result.hostname)))
  )
    throw new AppError(403, "安全验证与当前登录页面不匹配，请重新验证");
}
