import { closeDatabase } from '../src/db';
import { refreshMomentDuplicates } from '../src/lib/moments/deduplication';
import { syncError } from '../src/lib/moments/store';

refreshMomentDuplicates()
  .then(result => console.log(JSON.stringify({ event: 'moments_deduplicated', ...result })))
  .catch(error => { console.error(syncError(error)); process.exitCode = 1; })
  .finally(closeDatabase);
