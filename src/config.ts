// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = "luckyscript.me";
export const SITE_DESCRIPTION =
  "Welcome to my blog!Wish you have a lucky script of your life";
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
  Article: '/blog',
  Tech: 'https://luckyscript.me/blog/',
  More: {
    About: '/about',
    Link: '/link',
    Card: '/cards',
    PPT: '/ppt',
    Weekly: '/weekly',
  }
}