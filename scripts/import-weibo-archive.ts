import { randomUUID } from 'node:crypto';
import { legacyData } from '../src/data/legacyMoments.js';
import { closeDatabase, getPool } from '../src/db';
import { parseWeiboArchive } from '../src/lib/moments/weibo-archive';
import { saveMomentPage, syncError } from '../src/lib/moments/store';
import { normalizeMoment } from '../src/lib/moments/content';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('WEIBO_INVALID_ARGUMENT');
  const { posts, skipped } = parseWeiboArchive(legacyData);
  posts.forEach(normalizeMoment);
  console.log(JSON.stringify({ event: 'weibo_archive_validated', total: legacyData.length, importedCandidates: posts.length, skipped, dryRun: args.includes('--dry-run') }));
  if (args.includes('--dry-run')) return;
  const connection = await getPool().getConnection(); const runId = randomUUID(); let locked = false, started = false;
  let changed = 0;
  try {
    const [locks] = await connection.query<any[]>("SELECT GET_LOCK('rain_weibo_archive_import',0) AS acquired");
    if (Number(locks[0].acquired) !== 1) throw new Error('WEIBO_IMPORT_BUSY'); locked = true;
    await connection.query(`INSERT INTO blog_moment_sources (id,platform,account,title,sync_state,created_at)
      VALUES ('weibo:archive','weibo','archive','微博历史存档','{"archive":true}',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE account=VALUES(account)`);
    await connection.query("INSERT INTO blog_moment_sync_runs (id,source_id,started_at,outcome) VALUES (?,'weibo:archive',UTC_TIMESTAMP(3),'running')", [runId]); started = true;
    for (let offset = 0; offset < posts.length; offset += 50) changed += await saveMomentPage(connection, 'weibo:archive', posts.slice(offset, offset + 50));
    await connection.query(`UPDATE blog_moment_sources SET sync_state='{"archive":true,"backfillComplete":true}',last_attempt_at=UTC_TIMESTAMP(3),last_success_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id='weibo:archive'`);
    await connection.query("UPDATE blog_moment_sync_runs SET finished_at=UTC_TIMESTAMP(3),outcome='success',pages=?,received=?,changed=? WHERE id=?", [Math.ceil(posts.length / 50), posts.length, changed, runId]);
    console.log(JSON.stringify({ event: 'weibo_archive_imported', received: posts.length, changed }));
  } catch (error) {
    if (started) await connection.query("UPDATE blog_moment_sync_runs SET finished_at=UTC_TIMESTAMP(3),outcome='failed',error=? WHERE id=?", [syncError(error),runId]);
    throw error;
  } finally { if (locked) await connection.query("SELECT RELEASE_LOCK('rain_weibo_archive_import')"); connection.release(); }
}
main().catch(error => { console.error(syncError(error)); process.exitCode = 1; }).finally(closeDatabase);
