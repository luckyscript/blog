import rss from "@astrojs/rss";
import { listPublicSeries, publicSeriesStories } from "../../lib/server/series";
import { publicSeriesNote } from "../../lib/server/series-notes";
import { renderedBody } from "../../lib/markdoc/render-cache";
import { SITE_URL, SITE_TITLE } from "../../config";
export const prerender = false;
export async function GET() {
  const items = [];
  for (const series of await listPublicSeries())
    for (const entry of await publicSeriesStories(series.id)) {
      const slug = decodeURIComponent(entry.path.split("/").pop()!);
      const note = await publicSeriesNote(series.slug, slug),
        body = await renderedBody(note.markdown);
      items.push({
        title: `${series.title} · ${note.title}`,
        pubDate: new Date(note.publishedAt),
        link: entry.path,
        description: note.description,
        content: body.html,
      });
    }
  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return rss({
    title: `系列手记 · ${SITE_TITLE}`,
    description: "独立系列更新",
    site: SITE_URL,
    items,
  });
}
