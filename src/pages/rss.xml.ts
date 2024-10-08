import rss from "@astrojs/rss";
import { blog } from "../lib/markdoc/frontmatter.schema";
import { readOne, readBlog } from "../lib/markdoc/read";
import { SITE_TITLE, SITE_DESCRIPTION, SITE_URL } from "../config";

export const GET = async () => {

  const blogs = await readBlog({
    frontmatterSchema: blog,
  });

  const posts = blogs
  .map(item => item.posts
    .map(post => ({ ...post, year: item.year})))
    .flat();

  const sortedPosts = posts
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
    if (frontmatter.external) {
      const title = frontmatter.title;
      const pubDate = frontmatter.date;
      const link = frontmatter.url;

      return {
        title,
        pubDate,
        link,
      };
    }

    const title = frontmatter.title;
    const pubDate = frontmatter.date;
    const description = frontmatter.description;
    const link = `${baseUrl}/blog/${year}/${slug}`;
    const { html } = await readOne({
      directory: `blog/${year}`,
      slug,
      frontmatterSchema: blog,
    });

    return {
      title,
      pubDate,
      description,
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
