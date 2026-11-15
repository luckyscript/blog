import type { Transaction } from '@codemirror/state';

/** Complete an undo/redo atomically so finished upload placeholders never become document content. */
export function cleanUploadHistory(transaction: Transaction, completedMarkers: Iterable<string>): Transaction {
  if (!transaction.isUserEvent('undo') && !transaction.isUserEvent('redo')) return transaction;
  const text = transaction.newDoc.toString();
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const marker of completedMarkers) {
    let index = text.indexOf(marker);
    while (index >= 0) {
      changes.push({ from: index, to: index + marker.length, insert: '' });
      index = text.indexOf(marker, index + marker.length);
    }
  }
  if (!changes.length) return transaction;
  changes.sort((a,b) => a.from - b.from);
  // Keep the original transaction's history annotations and map its selection
  // through the cleanup, instead of making cleanup a separate undo event.
  return transaction.startState.update(transaction, { changes, sequential: true, filter: false });
}
