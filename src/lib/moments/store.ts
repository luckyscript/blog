import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, Connection } from "mysql2/promise";
import { getPool } from "../../db";
import { env } from "../server/env";
import { AppError } from "../server/errors";
import { normalizeMoment } from "./content";
import { collectPages } from "./plan";
import { telegramAdapter } from "./telegram";
import { weiboAccounts, weiboAdapter, weiboInterval, weiboTitles } from "./weibo";
import { weiboToken } from "./weibo-auth";
import type { MomentAdapter, MomentInput, Platform, SyncState } from "./types";

type SqlConnection = PoolConnection | Connection;
const jsonValue = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
export const telegramAccount = () => env('MOMENTS_TELEGRAM_CHANNEL', env('CHANNEL', 'jsjhlkblog')).toLowerCase();
export async function ensureMomentSource() {
  const account = telegramAccount();
  if (!/^[a-z0-9_]{5,64}$/.test(account)) throw new Error('TELEGRAM_INVALID_ACCOUNT');
  await getPool().query(`INSERT INTO blog_moment_sources (id,platform,account,title,sync_state,created_at)
    VALUES (?, 'telegram', ?, ?, '{}', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE account=VALUES(account)`, [`telegram:${account}`, account, account]);
  for (const uid of weiboAccounts()) {
    await getPool().query(`INSERT INTO blog_moment_sources (id,platform,account,title,sync_state,last_error,created_at)
      VALUES (?, 'weibo', ?, ?, '{}', 'WEIBO_AUTH_REQUIRED', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE account=VALUES(account)`, [`weibo:${uid}`, uid, weiboTitles[uid] || uid]);
  }
}

export async function saveMomentPage(connection: SqlConnection, sourceId: string, posts: MomentInput[]) {
  let changed = 0;
  const normalized = posts.map(normalizeMoment);
  await connection.beginTransaction();
  try {
    for (const item of normalized) {
      let [rows] = await connection.query<any[]>('SELECT id, content_hash FROM blog_moments WHERE source_id=? AND external_id=? FOR UPDATE', [sourceId, item.externalId]);
      if (sourceId.startsWith('weibo:')) {
        // IDs are global within Weibo. Adopt an unattributed archive row once its author is verified.
        if (sourceId === 'weibo:archive') {
          const [existing] = await connection.query<any[]>(`SELECT m.id FROM blog_moments m JOIN blog_moment_sources s ON s.id=m.source_id WHERE s.platform='weibo' AND m.external_id=? LIMIT 1 FOR UPDATE`, [item.externalId]);
          if (existing.length) continue; // Archive import is insert-only, including trashed rows.
        } else if (!rows.length) {
          [rows] = await connection.query<any[]>("SELECT id,content_hash FROM blog_moments WHERE source_id='weibo:archive' AND external_id=? FOR UPDATE", [item.externalId]);
          if (rows.length) await connection.query('UPDATE blog_moments SET source_id=? WHERE id=?', [sourceId, rows[0].id]);
        }
      }
      const values = [item.sourceUrl, item.title, item.text, item.html, JSON.stringify(item.media), JSON.stringify(item.tags), item.hash, new Date(item.publishedAt)];
      if (!rows.length) {
        await connection.query(`INSERT INTO blog_moments (id,source_id,external_id,source_url,title,body_text,body_html,media,tags,content_hash,published_at,first_seen_at,last_seen_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, [randomUUID(), sourceId, item.externalId, ...values]); changed++;
      } else if (rows[0].content_hash !== item.hash) {
        // Keep status and first_seen_at: a remote edit must never resurrect a trashed item.
        await connection.query(`UPDATE blog_moments SET source_url=?,title=?,body_text=?,body_html=?,media=?,tags=?,content_hash=?,published_at=?,last_seen_at=UTC_TIMESTAMP(3) WHERE id=?`, [...values, rows[0].id]); changed++;
      } else await connection.query('UPDATE blog_moments SET last_seen_at=UTC_TIMESTAMP(3) WHERE id=?', [rows[0].id]);
    }
    await connection.commit(); return changed;
  } catch (error) { await connection.rollback(); throw error; }
}
export function syncError(error: unknown): string {
  const e = error as any;
  if (/^(?:TELEGRAM|MOMENTS|WEIBO)_[A-Z0-9_]+$/.test(e?.message || '')) return e.message;
  if (['TimeoutError', 'AbortError'].includes(e?.name)) return 'MOMENTS_TIMEOUT';
  const code = e?.cause?.code || e?.code;
  return typeof code === 'string' && /^[A-Z_0-9]{1,60}$/.test(code) ? code : 'MOMENTS_SYNC_FAILED';
}
export async function syncMomentSource(sourceId: string, options: { maxPages?: number; signal?: AbortSignal; adapter?: MomentAdapter; connection?: SqlConnection } = {}) {
  const connection = options.connection || await getPool().getConnection();
  const lockName = 'rain_moments_' + createHash('sha256').update(sourceId).digest('hex').slice(0, 32);
  let locked = false, adapter: MomentAdapter | undefined, runId: string | undefined;
  let received = 0, changed = 0, pages = 0;
  try {
    const [locks] = await connection.query<any[]>('SELECT GET_LOCK(?,0) AS acquired', [lockName]);
    if (Number(locks[0].acquired) !== 1) return { sourceId, skipped: true };
    locked = true;
    const [sources] = await connection.query<any[]>('SELECT * FROM blog_moment_sources WHERE id=? AND enabled=TRUE', [sourceId]);
    if (!sources.length) return { sourceId, skipped: true };
    const source = sources[0];
    if (jsonValue(source.sync_state)?.archive) return { sourceId, skipped: true };
    runId = randomUUID();
    await connection.query('UPDATE blog_moment_sources SET last_attempt_at=UTC_TIMESTAMP(3) WHERE id=?', [sourceId]);
    await connection.query("INSERT INTO blog_moment_sync_runs (id,source_id,started_at,outcome) VALUES (?,?,UTC_TIMESTAMP(3),'running')", [runId,sourceId]);
    if (options.adapter) adapter = options.adapter;
    else if (source.platform === 'telegram') adapter = telegramAdapter(source.account);
    else if (source.platform === 'weibo') adapter = weiboAdapter(source.account, signal => weiboToken(source.account, signal));
    else throw new Error('MOMENTS_PROVIDER_NOT_CONFIGURED');
    const result = await collectPages(adapter, jsonValue(source.sync_state) as SyncState, async posts => {
      changed += await saveMomentPage(connection, sourceId, posts); received += posts.length; pages++;
    }, options.maxPages ?? 5, options.signal);
    await connection.query('UPDATE blog_moment_sources SET sync_state=?,last_success_at=UTC_TIMESTAMP(3),last_error=NULL WHERE id=?', [JSON.stringify(result.state), sourceId]);
    await connection.query("UPDATE blog_moment_sync_runs SET finished_at=UTC_TIMESTAMP(3),outcome='success',pages=?,received=?,changed=? WHERE id=?", [pages,received,changed,runId]);
    return { sourceId, pages, received, changed, state: result.state };
  } catch (error) {
    const message = syncError(error);
    if (runId) {
      await connection.query('UPDATE blog_moment_sources SET last_error=? WHERE id=?', [message,sourceId]);
      await connection.query("UPDATE blog_moment_sync_runs SET finished_at=UTC_TIMESTAMP(3),outcome='failed',pages=?,received=?,changed=?,error=? WHERE id=?", [pages,received,changed,message,runId]);
    }
    throw Object.assign(new Error(message), { code: message });
  } finally {
    try { await adapter?.close?.(); }
    finally {
      try { if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); }
      finally { if (!options.connection) (connection as PoolConnection).release(); }
    }
  }
}
export async function momentSources() {
  const [rows] = await getPool().query<any[]>(`SELECT s.id,s.platform,s.account,s.title,s.enabled,s.last_attempt_at,s.last_success_at,s.last_error,s.sync_state,
    (SELECT COUNT(*) FROM blog_moments m WHERE m.source_id=s.id AND m.status='published') AS count FROM blog_moment_sources s ORDER BY s.platform,s.account`);
  return rows.map(row => ({ id: row.id, platform: row.platform as Platform, account: row.account, title: row.title, enabled: !!row.enabled,
    count: Number(row.count), lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at, lastError: row.last_error,
    mode: jsonValue(row.sync_state)?.archive ? 'archive' : 'live',
    intervalSeconds: row.platform === 'weibo' ? weiboInterval() : Number(env('MOMENTS_SYNC_INTERVAL_SECONDS', '300')),
    backfillComplete: !!jsonValue(row.sync_state)?.backfillComplete }));
}

const momentFrom = ' FROM blog_moments m JOIN blog_moment_sources s ON s.id=m.source_id';
const selectMoment = 'SELECT m.*,s.platform,s.account' + momentFrom;
async function findRow(id: string, cursorOnly = false) {
  const [rows] = await getPool().query<any[]>((cursorOnly ? 'SELECT m.id,m.published_at' + momentFrom : selectMoment) + ` WHERE m.status='published' AND s.enabled=TRUE AND m.published_at<=UTC_TIMESTAMP(3) AND ` +
    (/^[0-9]+$/.test(id) ? 'm.source_id=? AND m.external_id=?' : 'm.id=?') + ' LIMIT 1',
    /^[0-9]+$/.test(id) ? [`telegram:${telegramAccount()}`, id] : [id]);
  return rows[0];
}
function publicMoment(row: any) {
  return { id: row.id, externalId: row.external_id, platform: row.platform as Platform, account: row.account, sourceUrl: row.source_url,
    title: row.title, text: row.body_text, content: row.body_html, datetime: new Date(row.published_at).toISOString(), tags: jsonValue(row.tags), media: jsonValue(row.media) };
}
export async function momentById(id: string) {
  const row = await findRow(id); if (!row) throw new AppError(404, '这条碎碎念没有找到'); return publicMoment(row);
}
export async function momentChannel(options: { before?: string; after?: string; q?: string; limit?: number } = {}) {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const conditions = ["m.status='published'", 's.enabled=TRUE', 'm.published_at<=UTC_TIMESTAMP(3)']; const values: any[] = [];
  const cursorId = options.before || options.after;
  if (cursorId) {
    const cursor = await findRow(cursorId, true); if (!cursor) throw new AppError(404, '分页位置不存在');
    const op = options.before ? '<' : '>';
    conditions.push(`(m.published_at ${op} ? OR (m.published_at=? AND m.id ${op} ?))`); values.push(cursor.published_at, cursor.published_at, cursor.id);
  }
  if (options.q) { conditions.push("LOCATE(?, m.body_text)>0"); values.push(options.q.slice(0, 200)); }
  const [rows] = await getPool().query<any[]>(selectMoment + ' WHERE ' + conditions.join(' AND ') + ` ORDER BY m.published_at ${options.after ? 'ASC' : 'DESC'},m.id ${options.after ? 'ASC' : 'DESC'} LIMIT ?`, [...values,limit]);
  if (options.after) rows.reverse();
  let hasOlder = false, hasNewer = false;
  if (rows.length && limit > 3) {
    const exists = await Promise.all(['older','newer'].map(async direction => {
      const row = direction === 'older' ? rows[rows.length-1] : rows[0]; const op = direction === 'older' ? '<' : '>';
      const [found] = await getPool().query<any[]>('SELECT 1' + momentFrom + ` WHERE m.status='published' AND s.enabled=TRUE AND m.published_at<=UTC_TIMESTAMP(3) AND (m.published_at ${op} ? OR (m.published_at=? AND m.id ${op} ?))` + (options.q ? ' AND LOCATE(?,m.body_text)>0' : '') + ' LIMIT 1', [row.published_at,row.published_at,row.id,...(options.q ? [options.q.slice(0,200)] : [])]);
      return !!found.length;
    }));
    [hasOlder,hasNewer] = exists;
  }
  return { title: '碎碎念', posts: rows.map(publicMoment), hasOlder, hasNewer, query: options.q || '' };
}
