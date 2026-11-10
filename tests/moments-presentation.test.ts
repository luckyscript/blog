import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { presentMoment } from '../src/lib/moments/presentation';

const picture = (n: number) => `<img src="/media/moments/${String(n).repeat(64)}.jpg" alt="照片${n}">`;
test('逐段包装的相邻图片归入同一相册，夹在中间的文字保持原位',()=>{
  const result=presentMoment(`<p>${picture(1)}</p><p><a href="https://example.com">${picture(2)}</a></p><p>说明文字</p><p>${picture(3)}</p>`,'paragraph-photos');
  const $=load(result.body,{},false);
  assert.deepEqual($('.moment-gallery').toArray().map(el=>$(el).attr('data-count')),['2','1']);
  assert.deepEqual($.root().children().toArray().map(el=>el.tagName),['div','p','div']);
  assert.equal($('a button').length,0);assert.equal($('.moment-photo').length,3);
});
test('相邻照片组成相册，正文和非相邻照片的顺序保留，大图通过原生按钮打开', () => {
  const html = `<p>第一段</p>${picture(1)}${picture(2)}<p>第二段</p>${picture(3)}`;
  const result = presentMoment(html, 'note-1'), $ = load(result.body, {}, false);
  assert.deepEqual($('.moment-gallery').toArray().map(el => $(el).attr('data-count')), ['2', '1']);
  assert.deepEqual($.root().children().toArray().map(el => el.tagName), ['p','div','p','div']);
  const targets = $('button[popovertarget]').toArray().map(el=>$(el).attr('popovertarget'));
  const dialogs=load(result.lightboxes);
  for (const target of targets) assert.equal(dialogs(`#${target}[popover]`).length,1);
  assert.equal(result.imageCount,3);
  assert.equal(load(html).text(),$.text());
  assert.equal(html,`<p>第一段</p>${picture(1)}${picture(2)}<p>第二段</p>${picture(3)}`);
});
test('图片链接不会包含嵌套交互控件，显示增强不能引入脚本或事件处理器', () => {
  const result=presentMoment(`<a href="https://example.com">${picture(1)}</a><script>alert(1)</script><img src="https://example.com/a.jpg" onerror="steal()" alt='" onmouseover="steal()'>`,'note-2');
  const $=load(result.body);
  assert.equal($('a button').length,0);
  assert.equal($('script,[onerror],[onmouseover]').length,0);
  const dialogs=load(result.lightboxes);
  assert.equal(dialogs('[onmouseover]').length,0);
});
test('表情保持行内显示，长内容的相册预览最多三张且不丢失完整版', () => {
  const result=presentMoment(`<p>开心<img src="/media/moments/${'a'.repeat(64)}.gif" alt="[开心]"></p>${picture(1)}${picture(2)}${picture(3)}${picture(4)}`,'note-3');
  assert.equal(load(result.body)('img.moment-inline-emoji').length,1);
  assert.equal(result.imageCount,4);
  assert.equal(load(result.previewGallery)('.moment-photo').length,3);
  assert.equal(load(result.body)('.moment-photo').length,4);
});
