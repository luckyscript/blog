import type { APIRoute } from "astro";
import { curatedLinkDestination } from "../../../lib/server/links";
import { AppError } from "../../../lib/server/errors";
export const prerender = false;
export const GET: APIRoute = async ({ params, url }) => {
  if (url.search)
    return new Response("跳转地址仅支持已登记的 UUID", {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  try {
    const target = await curatedLinkDestination(params.uuid || "");
    return new Response(null, {
      status: 302,
      headers: {
        location: target,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, {
        status: error.status,
        headers: { "cache-control": "no-store" },
      });
    throw error;
  }
};
