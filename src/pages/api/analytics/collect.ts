import type { APIContext } from "astro";
import { collectAnalytics } from "../../../lib/analytics/server";
import { AppError } from "../../../lib/server/errors";
export const prerender = false;
export async function POST(context: APIContext) {
  try {
    const status = await collectAnalytics(context);
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store",
        "x-analytics-status": status,
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      const code = (error as { code?: unknown })?.code;
      console.error(
        JSON.stringify({
          event: "analytics_collect_failed",
          code:
            typeof code === "string" && /^[A-Z0-9_]+$/.test(code)
              ? code
              : "unknown",
        })
      );
    }
    return new Response(null, {
      status: error instanceof AppError ? error.status : 503,
      headers: {
        "cache-control": "private, no-store",
        "x-analytics-status":
          error instanceof AppError ? "rejected" : "unavailable",
      },
    });
  }
}
