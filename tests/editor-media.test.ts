import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardImages, insertEditorText, replaceImagePlaceholder, mediaMarkdown, stripPendingImages } from '../src/lib/admin/editor-media';
test('剪贴板仅提取图片文件，不重复上传同一剪贴板项目或处理普通文字', () => {
  const file = new File(['photo'], 'image.png', { type: 'image/png' });
  const data = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } as unknown as DataTransfer;
  assert.deepEqual(clipboardImages(data), [file]);
  assert.deepEqual(clipboardImages({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } as unknown as DataTransfer), []);
});
test('图片替换保留上传期间的新输入，用户删除占位后不插回图片', () => {
  const marker = '\n[图片上传中（1）…]\n';
  const inserted = insertEditorText('前文选择后文', marker, 2, 4);
  assert.equal(inserted.markdown, '前文' + marker + '后文');
  const updated = inserted.markdown + '正在继续输入';
  const replaced = replaceImagePlaceholder(updated, marker, '\n![山](https://images.example.com/image.jpg)\n');
  assert(replaced.inserted); assert(replaced.markdown.endsWith('后文正在继续输入'));
  assert.deepEqual(replaceImagePlaceholder('已删除占位', marker, 'image'), { markdown: '已删除占位', inserted: false });
  assert.equal(replaceImagePlaceholder(updated, marker, '').markdown, '前文后文正在继续输入');
  assert(!stripPendingImages(updated, [marker]).includes('图片上传中')); assert(stripPendingImages(updated, [marker]).endsWith('后文正在继续输入'));
  assert.equal(stripPendingImages(updated), updated);
});
test('只有有效上传地址能生成图片或附件 Markdown', () => {
  assert.equal(mediaMarkdown({ mime: 'image/webp', url: 'https://images.example.com/image.webp', alt: '山[色]\n' }), '![山色](https://images.example.com/image.webp)');
  assert.equal(mediaMarkdown({ mime: 'application/pdf', url: '/media/articles/document.pdf', name: '附件' }), '[附件](/media/articles/document.pdf)');
  for (const url of ['', 'javascript:alert(1)', '//evil.test/image']) assert.throws(() => mediaMarkdown({ mime: 'image/png', url }));
});
