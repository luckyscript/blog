import type { Connection, PoolConnection } from 'mysql2/promise';
import { getPool } from '../../db';

type SqlConnection = Connection | PoolConnection;
type Candidate = { id: string; source_id: string; body_text: string; media: unknown };
type Entry = { id: string; sourceId: string; text: string; length: number; prefix: string; mediaKey: string };
type Duplicate = { id: string; originalId: string; reason: 'exact' | 'prefix' | 'media' };
const lockName = 'rain_moments_deduplication';
const minimumTextLengthForPrefix = 15;
const genericCaptions = new Set([
  '转发', '转发微博', '分享图片', '分享照片', '分享视频', '图片分享', '照片分享',
  'sharewithpics', 'repost', 'retweet',
]);

// Compare Unicode characters rather than UTF-16 halves (for example, emoji).
function comparableText(text: string) {
  return text.normalize('NFKC').replace(/[\s\u200b\ufeff]+/gu, '');
}
function mediaIdentity(value: unknown) {
  const media = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(media) || !media.length) return '';
  return JSON.stringify(media.map(item => {
    // Local files and their CDN mirrors share the same content-addressed name.
    const url = String(item.url || '');
    const digest = /(?:^|\/)([a-f0-9]{64})\.(?:jpg|png|webp|gif)(?:[?#]|$)/i.exec(url)?.[1];
    return [item.type, digest || url];
  }));
}

/** Generic captions and unavailable reposts do not identify their original content. */
function hasMeaningfulText(text: string) {
  const label = text.replace(/[\p{P}\p{S}]/gu, '').toLowerCase();
  return !!label && !genericCaptions.has(label) && !label.includes('该内容请至手机客户端查看') &&
    !label.includes('根据作者设置的微博可见时间范围此微博已不可见');
}

function textDuplicate(previous: Entry, incoming: Entry) {
  if (previous.mediaKey !== incoming.mediaKey) return false;
  if (previous.text === incoming.text) return true;
  // Either side being short disables prefix matching. The common prefix must
  // cover half of BOTH texts, so use the longer text's halfway point.
  if (Math.min(previous.length, incoming.length) < minimumTextLengthForPrefix) return false;
  const longer = previous.length >= incoming.length ? previous : incoming;
  const shorter = longer === previous ? incoming : previous;
  return shorter.text.startsWith(longer.prefix);
}

/** Rows arrive in first-seen order. Only compare against earlier visible records. */
export function duplicateRecords(rows: Candidate[]) {
  const textBuckets = new Map<string, Entry[]>();
  const mediaBuckets = new Map<string, Entry[]>();
  const duplicates: Duplicate[] = [];
  for (const row of rows) {
    const text = comparableText(row.body_text);
    const characters = Array.from(text);
    const prefix = characters.slice(0, Math.ceil(characters.length / 2)).join('');
    const mediaKey = mediaIdentity(row.media);
    const entry = { id: row.id, sourceId: row.source_id, text, length: characters.length, prefix, mediaKey };
    if (hasMeaningfulText(text)) {
      const bucket = textBuckets.get(characters[0]) || [];
      const original = bucket.find(previous => previous.sourceId !== entry.sourceId && textDuplicate(previous, entry));
      if (original) duplicates.push({ id: entry.id, originalId: original.id, reason: original.text === text ? 'exact' : 'prefix' });
      else { bucket.push(entry); textBuckets.set(characters[0], bucket); }
    } else {
      // Empty/generic captions alone are insufficient. Require the full media
      // list AND the caption to match; unrelated photos must stay visible.
      if (!mediaKey) continue;
      const bucket = mediaBuckets.get(mediaKey) || [];
      const original = bucket.find(previous => previous.sourceId !== entry.sourceId && previous.text === entry.text);
      if (original) duplicates.push({ id: entry.id, originalId: original.id, reason: 'media' });
      else { bucket.push(entry); mediaBuckets.set(mediaKey, bucket); }
    }
  }
  return duplicates;
}

/** Serialize cross-source saves as well as reconciliation; a per-source lock alone is insufficient. */
export async function withMomentDedupLock<T>(connection: SqlConnection, work: () => Promise<T>) {
  const [locks] = await connection.query<any[]>('SELECT GET_LOCK(?,30) AS acquired', [lockName]);
  if (Number(locks[0]?.acquired) !== 1) throw new Error('MOMENTS_DEDUPLICATION_BUSY');
  try { return await work(); }
  finally { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); }
}

/** Call inside the save transaction and global lock; never modify the original records. */
export async function reconcileMomentDuplicates(connection: SqlConnection) {
  const [rows] = await connection.query<any[]>(`SELECT m.id,m.source_id,m.body_text,m.media
    FROM blog_moments m JOIN blog_moment_sources s ON s.id=m.source_id
    WHERE m.status='published' AND s.enabled=TRUE AND m.published_at<=UTC_TIMESTAMP(3)
    ORDER BY m.first_seen_at ASC,m.published_at ASC,m.id ASC`);
  const duplicates = duplicateRecords(rows);
  const desired = new Map(duplicates.map(row => [row.id, row]));
  const [existing] = await connection.query<any[]>('SELECT moment_id,duplicate_of,reason FROM blog_moment_duplicates');
  let updated = 0;
  const unchanged = new Set<string>();
  const removed = existing.filter(row => {
    const next = desired.get(row.moment_id);
    if (next?.originalId === row.duplicate_of && next.reason === row.reason) { unchanged.add(row.moment_id); return false; }
    return !next;
  }).map(row => row.moment_id);
  for (let offset = 0; offset < removed.length; offset += 200) {
    const ids = removed.slice(offset, offset + 200);
    await connection.query('DELETE FROM blog_moment_duplicates WHERE moment_id IN (?)', [ids]);
    updated += ids.length;
  }
  const changed = duplicates.filter(row => !unchanged.has(row.id));
  for (let offset = 0; offset < changed.length; offset += 200) {
    const values = changed.slice(offset, offset + 200).map(row => [row.id,row.originalId,row.reason]);
    await connection.query(`INSERT INTO blog_moment_duplicates (moment_id,duplicate_of,reason) VALUES ?
      ON DUPLICATE KEY UPDATE duplicate_of=VALUES(duplicate_of),reason=VALUES(reason)`, [values]);
    updated += values.length;
  }
  return { eligible: rows.length, hidden: duplicates.length, visible: rows.length - duplicates.length, updated };
}

export async function refreshMomentDuplicates() {
  const connection = await getPool().getConnection();
  try {
    return await withMomentDedupLock(connection, async () => {
      await connection.beginTransaction();
      try {
        const result = await reconcileMomentDuplicates(connection);
        await connection.commit();
        return result;
      } catch (error) { await connection.rollback(); throw error; }
    });
  } finally { connection.release(); }
}
