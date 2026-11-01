import { setTimeout as delay } from "node:timers/promises";
import { closeDatabase } from "../src/db";
import { ensureMomentSource, momentSources, syncMomentSource, syncError } from "../src/lib/moments/store";

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--service','--backfill','--healthcheck'].includes(arg))) throw new Error('MOMENTS_INVALID_ARGUMENT');
  const interval = Number(process.env.MOMENTS_SYNC_INTERVAL_SECONDS || 300);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error('MOMENTS_INVALID_INTERVAL');
  if (args.includes('--healthcheck')) {
    const sources = (await momentSources()).filter(s => s.enabled && s.mode === 'live');
    const healthy = sources.length > 0 && sources.every(s => s.lastSuccessAt && !s.lastError && Date.now() - new Date(s.lastAttemptAt).getTime() < s.intervalSeconds * 3_000);
    console.log(JSON.stringify({ healthy, sources })); if (!healthy) process.exitCode = 1; return;
  }
  await ensureMomentSource();
  do {
    let failures = 0;
    for (const source of await momentSources()) {
      if (!source.enabled || source.mode === 'archive' || controller.signal.aborted) continue;
      if (args.includes('--service') && source.lastAttemptAt && Date.now() - new Date(source.lastAttemptAt).getTime() < source.intervalSeconds * 1000) continue;
      // Weibo calls may use paid credits: even explicit backfills stay bounded to two pages per run.
      const maxPages = source.platform === 'weibo' ? 2 : args.includes('--backfill') ? 100 : 5;
      try { console.log(JSON.stringify({ event:'moments_sync_success', ...await syncMomentSource(source.id, { maxPages, signal: controller.signal }) })); }
      catch (error) { if (controller.signal.aborted) break; failures++; console.error(JSON.stringify({ event:'moments_sync_failed', sourceId:source.id, error:syncError(error) })); }
    }
    if (!args.includes('--service')) { if (failures) process.exitCode = 1; break; }
    await delay(interval * 1000, undefined, { signal: controller.signal }).catch(() => {});
  } while (!controller.signal.aborted);
}
main().catch(error => { console.error(JSON.stringify({ event:'moments_worker_failed', error:syncError(error) })); process.exitCode=1; }).finally(closeDatabase);
