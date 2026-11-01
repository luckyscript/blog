import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MomentInput } from "./types";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
export function cleanMomentHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "video", "audio", "source"],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"], img: ["src", "alt", "loading"],
      video: ["src", "controls", "preload", "playsinline"], audio: ["src", "controls", "preload"], source: ["src", "type"],
      code: ["class"], span: ["class"], div: ["class"],
    },
    allowedSchemes: ["https"], allowProtocolRelative: false,
    transformTags: { a: (tagName, attrs) => ({ tagName, attribs: { ...attrs, target: "_blank", rel: "noopener noreferrer" } }) },
  });
}
const inputSchema = z.object({
  externalId: z.string().regex(/^[\w-]{1,128}$/), sourceUrl: z.string().url().refine(v => !!httpsUrl(v)),
  title: z.string().max(500), text: z.string().max(500_000), html: z.string().max(1_000_000),
  publishedAt: z.string().refine(v => Number.isFinite(Date.parse(v))), tags: z.array(z.string().max(100)).max(100),
  media: z.array(z.object({ type: z.enum(["image", "video", "audio"]), url: z.string().refine(v => !!httpsUrl(v)), alt: z.string().max(500) })).max(100),
});
export function normalizeMoment(input: MomentInput) {
  const value = inputSchema.parse(input);
  value.html = cleanMomentHtml(value.html);
  value.publishedAt = new Date(value.publishedAt).toISOString();
  value.tags = [...new Set(value.tags)].sort();
  return { ...value, hash: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
