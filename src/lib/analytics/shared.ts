export const analyticsEventTypes = [
  "navigation",
  "outbound_click",
  "search",
  "filter",
  "image_open",
  "media_play",
  "share",
  "download",
  "theme_change",
  "reading_material",
  "error",
] as const;
export type AnalyticsEventType = (typeof analyticsEventTypes)[number];
export const pageCategories = [
  "home",
  "article",
  "moments",
  "photography",
  "links",
  "ppt",
  "listing",
  "other",
] as const;
export type PageCategory = (typeof pageCategories)[number];
export const categoryLabels: Record<PageCategory, string> = {
  home: "首页",
  article: "文章",
  moments: "碎碎念",
  photography: "摄影",
  links: "链接",
  ppt: "PPT",
  listing: "文章列表",
  other: "其他页面",
};
export const eventLabels: Record<AnalyticsEventType, string> = {
  navigation: "站内跳转",
  outbound_click: "外链点击",
  search: "搜索",
  filter: "筛选",
  image_open: "图片放大",
  media_play: "音视频播放",
  share: "分享 / 复制链接",
  download: "下载",
  theme_change: "切换主题",
  reading_material: "切换阅读材质",
  error: "前端异常",
};

/** Never retain query strings, fragments, search text or private application paths. */
export function analyticsPath(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return "";
  let path = value.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "";
  }
  if (
    /^\/(?:admin|api|media|_astro|fonts|\.well-known)(?:\/|$)/i.test(decoded) ||
    decoded.includes("..") ||
    /\.(?:js|css|json|xml|map|txt|jpg|jpeg|png|gif|webp|svg|ico|woff2?|ttf|pdf|zip)$/i.test(
      decoded
    )
  )
    return "";
  if (path.startsWith("/moments/search/")) path = "/moments/search/[query]";
  if (
    path.length > 512 ||
    (path !== "/" &&
      !/^\/(?:blog|tech|sight|life|moments|photography|link|ppt|card|category|projects|series)(?:\/|$)/.test(
        path
      ))
  )
    return "";
  return path === "/" ? "/" : path.replace(/\/+$/, "");
}
export function pageCategory(path: string): PageCategory {
  if (path === "/") return "home";
  if (
    /^\/(?:blog|tech|sight|life)\/\d{4}\//.test(path) ||
    (/^\/card\/[^/]+$/.test(path) && !path.startsWith("/card/tag/"))
  )
    return "article";
  if (path.startsWith("/series")) return "listing";
  if (path.startsWith("/moments")) return "moments";
  if (path.startsWith("/photography")) return "photography";
  if (path.startsWith("/link")) return "links";
  if (path.startsWith("/ppt")) return "ppt";
  if (/^\/(?:blog|tech|sight|life|card|category|projects)(?:\/|$)/.test(path))
    return "listing";
  return "other";
}
export function campaignValue(value: unknown) {
  return typeof value === "string" && /^[\p{L}\p{N}_. -]{1,80}$/u.test(value)
    ? value.trim()
    : "";
}
