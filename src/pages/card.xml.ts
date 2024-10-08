import rss from "@astrojs/rss";
import { card } from "../lib/markdoc/frontmatter.schema";
import { readOne, readAll } from "../lib/markdoc/read";
import { SITE_TITLE, SITE_DESCRIPTION, SITE_URL } from "../config";

export const GET = async () => {

  const cards = await readAll({
    directory: "card",
    frontmatterSchema: card,
  });

  const sortedPosts = cards
    .filter((p) => p.frontmatter.draft !== true)
    .sort(
      (a, b) =>
        new Date(b.frontmatter.date).valueOf() -
        new Date(a.frontmatter.date).valueOf()
    );

  let baseUrl = SITE_URL;
  // removing trailing slash if found
  // https://example.com/ => https://example.com
  baseUrl = baseUrl.replace(/\/+$/g, "");

  const rssItems = await Promise.all(sortedPosts.map(async ({ frontmatter, slug, year }) => {
    const title = frontmatter.title;
    const pubDate = frontmatter.date;
    const link = `${baseUrl}/card/${slug}`;
    const { html } = await readOne({
      directory: `card`,
      slug,
      frontmatterSchema: card,
    });

    return {
      title,
      pubDate,
      description: title,
      link,
      content: html,
    };
  }));

  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: baseUrl,
    items: rssItems,
  });
};
