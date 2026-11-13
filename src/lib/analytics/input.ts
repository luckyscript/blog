import { z } from "zod";
import { analyticsEventTypes, analyticsPath, campaignValue } from "./shared";
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(analyticsEventTypes),
    target: z.string().max(2048).default(""),
    label: z.string().max(80).default(""),
    value: z.number().int().min(0).max(100000).default(0),
  })
  .strip();
const metric = z.number().finite().min(0).max(120000).optional();
export const collectSchema = z
  .object({
    viewId: z.string().uuid(),
    path: z.string().max(2048),
    referrer: z.string().max(4096).default(""),
    source: z.string().max(200).default(""),
    medium: z.string().max(200).default(""),
    campaign: z.string().max(200).default(""),
    language: z.string().max(40).default(""),
    width: z.number().int().min(0).max(10000).default(0),
    height: z.number().int().min(0).max(10000).default(0),
    duration: z.number().int().min(0).max(86400000).default(0),
    idle: z.number().int().min(0).max(1800000).default(0),
    scroll: z.number().int().min(0).max(100).default(0),
    interactions: z.number().int().min(0).max(10000).default(0),
    vitals: z
      .object({
        LCP: metric,
        INP: metric,
        CLS: z.number().finite().min(0).max(100).optional(),
        FCP: metric,
        TTFB: metric,
      })
      .strip()
      .default({}),
    events: z.array(eventSchema).max(20).default([]),
  })
  .strip();
const labels = new Set([
  "navigation",
  "search",
  "category",
  "year",
  "camera",
  "platform",
  "image",
  "video",
  "audio",
  "copy_link",
  "native_share",
  "file",
  "paper",
  "moon",
  "sand",
  "celadon",
  "bamboo",
  "lotus",
  "ink",
  "dusk",
  "bronze",
  "bone",
  "javascript",
  "promise",
  "image_error",
  "script_error",
  "style_error",
  "resource_error",
  "link",
]);
export function sanitizeEvent(
  event: z.infer<typeof eventSchema>,
  origin: string
) {
  let target = "";
  if (event.type === "navigation") {
    try {
      const url = new URL(event.target, origin);
      if (url.origin === origin) target = analyticsPath(url.pathname);
    } catch {}
  } else if (event.type === "download") target = "file";
  else if (event.type === "outbound_click") {
    try {
      const url = new URL(event.target, origin);
      if (["https:", "http:"].includes(url.protocol)) {
        if (url.origin !== origin) target = url.hostname.slice(0, 255);
        else if (/^\/link\/to\/[a-f0-9-]{36}\/?$/.test(url.pathname))
          target = analyticsPath(url.pathname);
      }
    } catch {}
  } else if (
    ["filter", "theme_change", "reading_material", "error"].includes(event.type)
  )
    target = labels.has(event.target) ? event.target : "";
  else
    target =
      event.type === "search"
        ? "search"
        : event.type === "image_open"
        ? analyticsPath(event.target).startsWith("/photography/works/")
          ? analyticsPath(event.target)
          : "image"
        : event.type === "media_play"
        ? event.target === "audio"
          ? "audio"
          : "video"
        : event.type === "share"
        ? "copy_link"
        : "";
  return {
    id: event.id,
    type: event.type,
    target,
    label: labels.has(event.label) ? event.label : "",
    value: event.type === "search" ? Math.min(event.value, 500) : event.value,
  };
}
export function normalizedVisit(
  input: z.infer<typeof collectSchema>,
  origin: string
) {
  const path = analyticsPath(input.path);
  let host = "",
    referrerPath = "";
  try {
    const referrer = new URL(input.referrer);
    if (["https:", "http:"].includes(referrer.protocol)) {
      if (referrer.origin === origin)
        referrerPath = analyticsPath(referrer.pathname);
      else host = referrer.hostname.slice(0, 255);
    }
  } catch {}
  return {
    ...input,
    path,
    referrerHost: host,
    referrerPath,
    source: campaignValue(input.source),
    medium: campaignValue(input.medium),
    campaign: campaignValue(input.campaign),
    language: /^[a-zA-Z0-9-]{1,20}$/.test(input.language) ? input.language : "",
    events: input.events.map((event) => sanitizeEvent(event, origin)),
  };
}
export function userAgentDimensions(agent: string) {
  const device = /ipad|tablet|android(?!.*mobile)/i.test(agent)
    ? "平板"
    : /mobile|iphone|ipod/i.test(agent)
    ? "手机"
    : "电脑";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
    ? "Opera"
    : /Firefox\//.test(agent)
    ? "Firefox"
    : /Chrome\//.test(agent)
    ? "Chrome"
    : /Safari\//.test(agent)
    ? "Safari"
    : "其他";
  const os = /iPhone|iPad|iPod/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
    ? "Android"
    : /Windows/.test(agent)
    ? "Windows"
    : /Macintosh|Mac OS X/.test(agent)
    ? "macOS"
    : /Linux/.test(agent)
    ? "Linux"
    : "其他";
  return { device, browser, os };
}
