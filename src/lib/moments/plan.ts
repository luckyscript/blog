import type { MomentAdapter, MomentInput, SyncState } from "./types";

/** Fetch recent updates and resume both gaps and initial history across bounded runs. */
export async function collectPages(adapter: MomentAdapter, previous: SyncState, save: (posts: MomentInput[]) => Promise<void>, maxPages = 5, signal?: AbortSignal) {
  const state = { ...previous }; let pages = 0;
  const page = async (cursor?: string) => {
    signal?.throwIfAborted(); const result = await adapter.fetchPage(cursor, signal); pages++;
    if (cursor && result.nextCursor === cursor) throw new Error('MOMENTS_CURSOR_STALLED');
    await save(result.posts); return result;
  };
  const latest = await page();
  const ids = (page: { posts: MomentInput[]; observedIds?: string[] }) => page.observedIds ?? page.posts.map(p => p.externalId);
  const head = ids(latest)[0];
  if (!state.checkpoint) {
    state.checkpoint = head; state.backfillCursor = latest.nextCursor; state.backfillComplete = !latest.nextCursor;
  } else if (head && head !== state.checkpoint && !state.catchupTarget) {
    if (ids(latest).includes(state.checkpoint)) state.checkpoint = head;
    else { state.catchupTarget = state.checkpoint; state.catchupHead = head; state.catchupCursor = latest.nextCursor; }
  }
  while (state.catchupTarget && pages < maxPages) {
    const next = state.catchupCursor ? await page(state.catchupCursor) : { posts: [], nextCursor: undefined };
    if (ids(next).includes(state.catchupTarget) || !next.nextCursor) {
      state.checkpoint = state.catchupHead; delete state.catchupTarget; delete state.catchupHead; delete state.catchupCursor;
    } else state.catchupCursor = next.nextCursor;
  }
  while (!state.catchupTarget && !state.backfillComplete && state.backfillCursor && pages < maxPages) {
    const next = await page(state.backfillCursor); state.backfillCursor = next.nextCursor; state.backfillComplete = !next.nextCursor;
  }
  return { state, pages };
}
