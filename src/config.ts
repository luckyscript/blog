// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = "下雨就像弹钢琴";
export const SITE_DESCRIPTION = "";
export const TWITTER_HANDLE = "@_luckyscript";
export const MY_NAME = "luckyscript";

// setup in astro.config.mjs
const BASE_URL = new URL(import.meta.env.SITE);

export const SITE_URL = BASE_URL.origin;

export const CDN_URL = SITE_URL;

export const WEIBO_CONFIG = {
  value: 5351049607,
  containerid: 1076035351049607,
  name: 'luckyscript',
}

export const NAV = {
  Home: '/',
  About: '/about',
  Life: '/blog',
  Tech: 'https://sailor.ink/blog/',
  More: {
    Link: '/link',
    PPT: '/ppt',
    Weekly: '/weekly',
  }
}