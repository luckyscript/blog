import type { APIRoute } from 'astro';
import { publicPosts } from '../lib/server/posts';
import { usesDatabase } from '../lib/server/env';
import { readBlog, readTech, readSight, readAll } from '../lib/markdoc/read';
import { blog, ppt } from '../lib/markdoc/frontmatter.schema';
import { SITE_URL } from '../config';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const prerender = false;
export const GET: APIRoute = async () => {
  const urls = ['/', '/blog', '/tech', '/sight', '/link', '/ppt', '/moments'].map(path => ({ path, updated: '' }));
  if (usesDatabase()) {
    for (const post of await publicPosts()) if (!post.externalUrl && post.section !== 'projects' && !post.metadata.hideFromListing) urls.push({ path: post.path, updated: (post.contentUpdatedAt ?? post.publishedAt).toISOString() });
  } else {
    for (const [section, reader] of [['blog', readBlog], ['tech', readTech], ['sight', readSight]] as const) {
      for (const group of await reader({ frontmatterSchema: blog })) for (const post of group.posts) {
        if (!post.frontmatter.draft && !post.frontmatter.external) urls.push({ path: `/${section}/${group.year}/${post.slug}`, updated: '' });
      }
    }
    for (const section of ['link', 'ppt']) for (const post of await readAll({ directory: section, frontmatterSchema: section === 'ppt' ? ppt : blog })) {
      if (!post.frontmatter.draft && !post.frontmatter.external) urls.push({ path: `/${section}/${post.slug}`, updated: '' });
    }
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(item => `<url><loc>${escape(new URL(item.path, SITE_URL).href)}</loc>${item.updated ? `<lastmod>${item.updated}</lastmod>` : ''}</url>`).join('')}</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
