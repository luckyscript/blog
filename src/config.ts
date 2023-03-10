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

export const CDN_URL = import.meta.env.PROD ? 'http://static.rainonpiano.com' : SITE_URL;
