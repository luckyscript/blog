import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, getPool } from "../../db";
import { curatedLinks, linkHealth } from "../../db/schema";
import { checkPublicLink } from "./link-health-check";
import type { LinkHealth } from "../link-health";

export async function runLinkHealthChecks(
  options: {
    force?: boolean;
    limit?: number;
    check?: (url: string) => Promise<LinkHealth>;
    signal?: AbortSignal;
  } = {}
) {
  const connection = await getPool().getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query<any[]>(
      "SELECT GET_LOCK('rain_blog_link_health',0) AS acquired"
    );
    locked = Number(lock.acquired) === 1;
    if (!locked)
      return {
        skipped: true,
        checked: 0,
        changed: 0,
        states: {} as Record<string, number>,
      };
    const [rows] = await connection.query<any[]>(
      `SELECT l.id,l.url FROM blog_links l LEFT JOIN blog_link_health h ON h.link_id=l.id WHERE l.status='published' AND (? OR h.link_id IS NULL OR h.url_hash<>SHA2(l.url,256) OR h.checked_at<UTC_TIMESTAMP(3)-INTERVAL 7 DAY) ORDER BY h.checked_at ASC,l.id LIMIT ?`,
      [!!options.force, Math.min(100, Math.max(1, options.limit ?? 100))]
    );
    let cursor = 0,
      checked = 0,
      changed = 0;
    const states: Record<string, number> = {};
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < rows.length) {
          options.signal?.throwIfAborted();
          const row = rows[cursor++];
          const result = await (
            options.check ??
            ((url) => checkPublicLink(url, { signal: options.signal }))
          )(row.url);
          checked++;
          options.signal?.throwIfAborted();
          await db().transaction(async (tx) => {
            const [current] = await tx
              .select()
              .from(curatedLinks)
              .where(eq(curatedLinks.id, row.id))
              .for("update");
            // A response for an old URL must never become the health of a newly edited link.
            if (
              !current ||
              current.status !== "published" ||
              current.url !== row.url
            )
              return;
            const fields = {
              urlHash: createHash("sha256").update(row.url).digest("hex"),
              state: result.state,
              httpStatus: result.httpStatus,
              latencyMs: result.latencyMs,
              reason: result.reason,
              checkedAt: new Date(result.checkedAt),
            };
            await tx
              .insert(linkHealth)
              .values({ linkId: row.id, ...fields })
              .onDuplicateKeyUpdate({ set: fields });
            changed++;
            states[result.state] = (states[result.state] || 0) + 1;
          });
        }
      })
    );
    return { skipped: false, checked, changed, states };
  } finally {
    try {
      if (locked)
        await connection.query("SELECT RELEASE_LOCK('rain_blog_link_health')");
    } finally {
      connection.release();
    }
  }
}
