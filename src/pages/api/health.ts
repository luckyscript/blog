import type { APIRoute } from "astro";
import { getPool } from "../../db";

export const GET: APIRoute = async () => {
  let ready = false;
  try {
    await getPool().query({ sql: "SELECT 1", timeout: 5_000 });
    ready = true;
  } catch {
    // Public readiness must not disclose connection details or credentials.
  }
  return new Response(JSON.stringify({ status: ready ? "ok" : "unavailable" }), {
    status: ready ? 200 : 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
