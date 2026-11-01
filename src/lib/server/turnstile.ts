import { z } from "zod";
import { env } from "./env";
import { AppError } from "./errors";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
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
  const configured = Boolean(
    siteKey &&
      secretKey &&
      /^[\w-]{1,200}$/.test(siteKey) &&
      (usesTestKey
        ? testing
        : hostnames.includes(normalizeHost(requestHostname)))
  );
  return { siteKey, secretKey, hostnames, testing, configured };
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
    throw new AppError(503, "登录验证尚未配置，请联系管理员");
  if (typeof token !== "string" || !token.trim() || token.length > 2048)
    throw new AppError(403, "请先完成 Cloudflare 安全验证");
  let result: z.infer<typeof verificationResult>;
  try {
    const response = await (options.fetch ?? fetch)(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Siteverify unavailable");
    result = verificationResult.parse(await response.json());
  } catch {
    throw new AppError(503, "安全验证暂不可用，请稍后重新验证");
  }
  if (!result.success) {
    const codes = result["error-codes"] ?? [];
    if (
      codes.some((code) =>
        [
          "missing-input-secret",
          "invalid-input-secret",
          "internal-error",
          "bad-request",
        ].includes(code)
      )
    )
      throw new AppError(503, "安全验证暂不可用，请稍后重新验证");
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
