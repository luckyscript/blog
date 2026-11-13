import type { APIContext } from "astro";
import { collectAnalytics } from "../../../lib/analytics/server";
import { AppError } from "../../../lib/server/errors";
export const prerender = false;
export async function POST(context: APIContext) {
  try {
    await collectAnalytics(context);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return new Response(null, {
      status: error instanceof AppError ? error.status : 503,
      headers: { "cache-control": "private, no-store" },
    });
  }
}
