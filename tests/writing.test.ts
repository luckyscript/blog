import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphRange, writingWords, encodeDraft, decodeDraft } from '../src/lib/admin/writing';
const input = { title: '', section: 'blog' as const, year: '2026', slug: 'draft', markdown: '还没想好标题的正文', description: '', category: '', tags: [], publishedAt: '2026-11-15T00:00:00.000Z', contentUpdatedAt: null, externalUrl: '', coverUrl: '', canonicalUrl: '', featured: false, metadata: {} };
test('本地恢复允许无标题正文、兼容旧格式，拒绝损坏或不完整的草稿', () => {
  assert.deepEqual(decodeDraft(encodeDraft(input, 7))?.input, input);
  assert.equal(decodeDraft(encodeDraft(input, 7))?.baseVersion, 7);
  assert.deepEqual(decodeDraft(JSON.stringify(input))?.input, input);
  for (const raw of [null, '', '{', '{}', JSON.stringify({ format: 1, input: { markdown: 'bad' } })]) assert.equal(decodeDraft(raw), null);
});
test('段落聚焦覆盖多行并在空行停止，兼容中文、文首和文末', () => {
  const text = '第一行\n换行继续\n\n第二段\n\n末尾';
  assert.deepEqual(paragraphRange(text, 0), { from: 0, to: 8 });
  assert.deepEqual(paragraphRange(text, 5), { from: 0, to: 8 });
  assert.deepEqual(paragraphRange(text, 9), { from: 9, to: 9 });
  assert.deepEqual(paragraphRange(text, 11), { from: 10, to: 13 });
  assert.deepEqual(paragraphRange(text, text.length), { from: 15, to: 17 });
  assert.deepEqual(paragraphRange('\n正文', 0), { from: 0, to: 0 });
  assert.deepEqual(paragraphRange('', 0), { from: 0, to: 0 });
});
test('中文字数与英文单词混排，链接目标和 Markdown 标记不计入字数', () => {
  assert.equal(writingWords('## 你好 **世界** hello world'), 6);
  assert.equal(writingWords('[文字](https://example.com/long-path) ![](https://example.com/photo.jpg)'), 2);
  assert.equal(writingWords('Markdown格式'), 3);
  assert.equal(writingWords(''), 0);
});

test('异步上传完成后撤销图片不复活占位，重做恢复图片并保留上传期间的文字', async () => {
  const { EditorState, Transaction } = await import('@codemirror/state');
  const { history, undo, redo, isolateHistory } = await import('@codemirror/commands');
  const { cleanUploadHistory } = await import('../src/lib/admin/editor-history');
  const marker = '\n[图片上传中（1）…]\n', image = '\n![山](/media/articles/mountain.webp)\n';
  const completed = new Set<string>();
  let state = EditorState.create({ doc: '前文', extensions: [history()] });
  const dispatch = (transaction: import('@codemirror/state').Transaction) => { state = cleanUploadHistory(transaction, completed).state; };
  dispatch(state.update({ changes: { from: state.doc.length, insert: marker }, annotations: isolateHistory.of('full') }));
  dispatch(state.update({ changes: { from: state.doc.length, insert: '上传期间的新文字' }, annotations: isolateHistory.of('full') }));
  completed.add(marker);
  dispatch(state.update({ changes: { from: 2, to: 2 + marker.length, insert: image }, annotations: [Transaction.userEvent.of('input.upload'), isolateHistory.of('full')] }));
  assert.equal(state.doc.toString(), '前文' + image + '上传期间的新文字');
  assert(undo({ state, dispatch }));
  assert.equal(state.doc.toString(), '前文上传期间的新文字');
  assert(redo({ state, dispatch }));
  assert.equal(state.doc.toString(), '前文' + image + '上传期间的新文字');
});

test('碎碎念本机草稿保留格式、配图与冲突版本，拒绝损坏和超限数据', async () => {
  const { encodeMomentDraft, decodeMomentDraft } = await import('../src/lib/admin/moment-writing');
  const input = { text: '**此刻**', format: 'markdown' as const, images: [{ url: 'https://example.com/image.jpg', alt: '山' }], publishedAt: '2026-11-15T00:00:00.000Z' };
  assert.deepEqual(decodeMomentDraft(encodeMomentDraft(input, 'v1')), { input, baseVersion: 'v1' });
  assert.equal(decodeMomentDraft('{'), null);
  assert.equal(decodeMomentDraft(encodeMomentDraft({ ...input, text: 'x'.repeat(20001) }, null)), null);
  assert.equal(decodeMomentDraft(encodeMomentDraft({ ...input, images: Array(10).fill(input.images[0]) }, null)), null);
});

test('云端草稿恢复保持稳定标识，并可恢复历史随记的缓存配图', async () => {
  const { encodeMomentDraft, decodeMomentDraft } = await import('../src/lib/admin/moment-writing');
  const id='00000000-0000-4000-8000-000000000001';
  const input={text:'跨设备继续写',format:'plain' as const,images:[{url:'/media/moments/'+'a'.repeat(64)+'.jpg',alt:'历史图片'}],publishedAt:'2026-11-15T00:00:00.000Z'};
  const restored=decodeMomentDraft(encodeMomentDraft(input,null,id));
  assert.equal(restored?.id,id);assert.deepEqual(restored?.input,input);
  assert.equal(decodeMomentDraft(encodeMomentDraft({...input,images:[{url:'javascript:alert(1)',alt:''}]},null,id)),null);
});
