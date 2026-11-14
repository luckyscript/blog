import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { APIContext } from "astro";
import { getPool } from "../../db";
import { sessionUser } from "../server/auth";
import { AppError } from "../server/errors";
import { collectSchema, normalizedVisit, userAgentDimensions } from "./input";
import { pageCategory } from "./shared";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const visitorCookie = "inkrain_visitor",
  sessionCookie = "inkrain_visit";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const rateSecret = randomBytes(32);
const limits = new Map<string, { count: number; until: number }>();
type IgnoredCollection = "disabled" | "ignored-privacy" | "ignored-bot";
export type CollectionStatus =
  | IgnoredCollection
  | "ignored-admin"
  | "ignored-path"
  | "recorded";
function ignoredReason(context: APIContext): IgnoredCollection | null {
  if (process.env.ANALYTICS_ENABLED === "0") return "disabled";
  if (
    context.request.headers.get("dnt") === "1" ||
    context.request.headers.get("sec-gpc") === "1"
  )
    return "ignored-privacy";
  const agent = context.request.headers.get("user-agent") || "";
  return !agent ||
    /bot\b|spider|crawler|headless|lighthouse|preview|facebookexternalhit|curl\/|wget\//i.test(
      agent
    )
    ? "ignored-bot"
    : null;
}
function limitRequest(context: APIContext) {
  let address = "unknown";
  try {
    address = context.clientAddress;
  } catch {}
  if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address))
    address = context.request.headers.get("x-real-ip") || address;
  const key = createHmac("sha256", rateSecret).update(address).digest("hex"),
    now = Date.now();
  if (limits.size >= 5000) {
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    if (limits.size >= 5000) limits.delete(limits.keys().next().value!);
  }
  const current = limits.get(key);
  if (!current || current.until < now)
    limits.set(key, { count: 1, until: now + 60000 });
  else if (++current.count > 300)
    throw new AppError(429, "访问统计请求过于频繁");
}
async function readPayload(request: Request) {
  if (
    !/^(?:application\/json|text\/plain)(?:;|$)/i.test(
      request.headers.get("content-type") || ""
    )
  )
    throw new AppError(415, "不支持的数据格式");
  if (Number(request.headers.get("content-length")) > 32768)
    throw new AppError(413, "统计请求过大");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "缺少统计数据");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new AppError(413, "统计请求过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return collectSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new AppError(400, "统计数据格式不正确");
  }
}
function identity(context: APIContext, name: string, maxAge: number) {
  const existing = context.cookies.get(name)?.value;
  const token = existing && uuid.test(existing) ? existing : randomUUID();
  context.cookies.set(name, token, {
    httpOnly: true,
    secure: context.url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return token;
}
function geography(headers: Headers) {
  const country = headers.get("cf-ipcountry") || "";
  const clean = (value: string | null) => {
    if (!value) return "";
    try {
      return decodeURIComponent(value)
        .replace(/[<>\x00-\x1f]/g, "")
        .slice(0, 80);
    } catch {
      return "";
    }
  };
  return {
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "",
    region: clean(headers.get("cf-region")),
    city: clean(headers.get("cf-ipcity")),
  };
}
export async function collectAnalytics(
  context: APIContext
): Promise<CollectionStatus> {
  if (
    context.request.headers.get("origin") !== context.url.origin ||
    context.request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError(403, "请求来源不正确");
  const ignored = ignoredReason(context);
  if (ignored) return ignored;
  limitRequest(context);
  const input = normalizedVisit(
    await readPayload(context.request),
    context.url.origin
  );
  if (!input.path) return "ignored-path";
  // Authenticated owners viewing public pages should not inflate their own dashboard.
  if (context.cookies.has("inkrain_admin") && (await sessionUser(context)))
    return "ignored-admin";
  const visitorKey = hash(identity(context, visitorCookie, 180 * 86400));
  // Heartbeats must not extend a session after the reader stops interacting.
  const sessionKey = hash(
    visitorKey +
      ":" +
      identity(
        context,
        sessionCookie,
        Math.max(0, 1800 - Math.floor(input.idle / 1000))
      )
  );
  const dimensions = userAgentDimensions(
    context.request.headers.get("user-agent") || ""
  );
  const geo = geography(context.request.headers);
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT IGNORE INTO blog_analytics_views
      (id,visitor_key,session_key,path,category,referrer_host,referrer_path,utm_source,utm_medium,utm_campaign,device,browser,os,country,region,city,language,viewport_width,viewport_height,started_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [
        input.viewId,
        visitorKey,
        sessionKey,
        input.path,
        pageCategory(input.path),
        input.referrerHost,
        input.referrerPath,
        input.source,
        input.medium,
        input.campaign,
        dimensions.device,
        dimensions.browser,
        dimensions.os,
        geo.country,
        geo.region,
        geo.city,
        input.language,
        input.width,
        input.height,
      ]
    );
    const [[view]] = await connection.query<any[]>(
      "SELECT visitor_key,path,started_at FROM blog_analytics_views WHERE id=? FOR UPDATE",
      [input.viewId]
    );
    if (view.visitor_key !== visitorKey || view.path !== input.path)
      throw new AppError(409, "浏览标识已失效");
    const duration = Math.min(
      input.duration,
      Math.max(0, Date.now() - new Date(view.started_at).getTime()) + 5000
    );
    const vital = (name: keyof typeof input.vitals) =>
      input.vitals[name] === undefined
        ? null
        : Math.round(input.vitals[name]! * (name === "CLS" ? 1000 : 1));
    await connection.query(
      `UPDATE blog_analytics_views SET last_seen_at=UTC_TIMESTAMP(3),duration_ms=GREATEST(duration_ms,?),scroll_percent=GREATEST(scroll_percent,?),interactions=GREATEST(interactions,?),
      lcp_ms=IF(? IS NULL,lcp_ms,?),inp_ms=IF(? IS NULL,inp_ms,?),cls_milli=IF(? IS NULL,cls_milli,?),fcp_ms=IF(? IS NULL,fcp_ms,?),ttfb_ms=IF(? IS NULL,ttfb_ms,?) WHERE id=?`,
      [
        duration,
        input.scroll,
        input.interactions,
        ...(["LCP", "INP", "CLS", "FCP", "TTFB"] as const).flatMap((name) => [
          vital(name),
          vital(name),
        ]),
        input.viewId,
      ]
    );
    if (input.events.length)
      await connection.query(
        `INSERT IGNORE INTO blog_analytics_events (id,view_id,type,target,label,value,created_at) VALUES ${input.events
          .map(() => "(?,?,?,?,?,?,UTC_TIMESTAMP(3))")
          .join(",")}`,
        input.events.flatMap((event) => [
          event.id,
          input.viewId,
          event.type,
          event.target,
          event.label,
          event.value,
        ])
      );
    await connection.commit();
    return "recorded";
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
