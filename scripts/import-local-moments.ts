import { legacyData } from '../src/data/legacyMoments.js';
import { closeDatabase, getPool } from '../src/db';
import { parseLocalArchive, saveLocalArchive } from '../src/lib/moments/local-archive';
import { syncError } from '../src/lib/moments/store';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--dry-run')) throw new Error('MOMENTS_INVALID_IMPORT_ARGUMENT');
  const { posts, skipped } = parseLocalArchive(legacyData, process.env.SITE_URL || 'https://rainonpiano.com');
  console.log(JSON.stringify({ event: 'local_moments_validated', total: legacyData.length, candidates: posts.length, skipped, dryRun: args.includes('--dry-run') }));
  if (args.includes('--dry-run')) return;
  const connection = await getPool().getConnection();
  let locked = false;
  try {
    const [locks] = await connection.query<any[]>("SELECT GET_LOCK('rain_local_moments_import',0) AS acquired");
    if (Number(locks[0].acquired) !== 1) throw new Error('MOMENTS_IMPORT_BUSY');
    locked = true;
    const result = await saveLocalArchive(connection, posts);
    console.log(JSON.stringify({ event: 'local_moments_imported', received: posts.length, inserted: result.insertedIds.length, ...result }));
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('rain_local_moments_import')");
    connection.release();
  }
}
main().catch(error => { console.error(syncError(error)); process.exitCode = 1; }).finally(closeDatabase);
