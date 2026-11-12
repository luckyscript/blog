import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { bridgeHeaders, verifyBridge } from '../src/lib/photography/bridge.mjs';
import { photographyPage } from '../src/lib/photography/presentation';

test('摄影授权绑定请求、权限和时间，公开请求与伪造请求不能变成管理员', () => {
  const secret = 'a'.repeat(64), now = Date.now(), path = '/api/admin/photos?status=draft';
  const request = (headers: any, url = path, method = 'GET', address = '127.0.0.1') => ({ headers, url, method, socket: { remoteAddress: address } });
  const signed = bridgeHeaders('GET', path, { secret, admin: true, now });
  assert.deepEqual(verifyBridge(request(signed), secret, now), { valid: true, admin: true });
  assert.equal(verifyBridge(request({ ...signed, 'x-rain-photo-role': 'public' }), secret, now).valid, false);
  assert.equal(verifyBridge(request(signed, '/api/admin/backups'), secret, now).valid, false);
  assert.equal(verifyBridge(request(signed, path, 'POST'), secret, now).valid, false);
  assert.equal(verifyBridge(request(signed, path, 'GET', '10.10.10.70'), secret, now).valid, false);
  assert.equal(verifyBridge(request(signed), secret, now + 61_000).valid, false);
  const publicHeaders = bridgeHeaders('GET', path, { secret, now });
  assert.deepEqual(verifyBridge(request(publicHeaders), secret, now), { valid: true, admin: false });
  assert.deepEqual(verifyBridge(request({}), secret, now), { valid: false, admin: false });
});

const photo = { id: 31, src: 'media/' + 'a'.repeat(64) + '-1280-webp?v=brand-v2', largeSrc: 'media/' + 'a'.repeat(64) + '-2560-webp?v=brand-v2', width: 2560, height: 1707, title: '一线光', description: '原有作品', date: '2026-09-29', category: 'landscape', categoryLabel: '风光山野', featured: true, author: '见山', isDemo: false, position: 'center', exifInfo: { fields: [], available: false } };
const data = { backend: true, photos: [photo], albums: [], equipment: [], studio: {} };
test('摄影重构保留作品链接、公开元信息，私密字段不进入页面', () => {
  const home = photographyPage({ ...data, photos: [{ ...photo, rating: 5, privateNote: 'PRIVATE_NOTE_NEVER_PUBLIC', filename: 'PRIVATE_FILENAME' }] }, '', 'https://blog.test')!;
  const $ = load(home.body);
  assert($('img').length > 0);
  assert($('img').toArray().every(element => $(element).attr('src')?.startsWith('/photography/')));
  assert(!JSON.stringify(home).includes('PRIVATE_NOTE_NEVER_PUBLIC'));
  assert(!JSON.stringify(home).includes('PRIVATE_FILENAME'));
  assert(home.dialogs.includes('data-lightbox-link'));
  assert(home.body.includes('/photography/works/31/'));
  const work = photographyPage(data, 'works/31/', 'https://blog.test')!;
  assert(work.body.includes('一线光'));
  assert(work.meta.includes('https://blog.test/photography/works/31/'));
  for (const route of ['works/999/', 'works/0/', 'collections/missing/', 'missing/']) assert.equal(photographyPage(data, route, 'https://blog.test'), null);
});

test('响应式图片使用博客内的绝对路径，首屏优先、档案延迟加载', () => {
  const responsive = { ...photo, thumbSrc: 'media/31-640-webp', src: 'media/31-1280-webp', largeSrc: 'media/31-2560-webp', srcset: [640,1280,2560].map(width => ({ src: `media/31-${width}-webp`, width })) };
  const home = photographyPage({ ...data, photos: [responsive] }, '', 'https://blog.test')!;
  const first = load(home.body)('.photo-cover img');
  assert(first.attr('srcset')?.includes('640w'));
  assert(first.attr('sizes')?.includes('92vw'));
  assert.equal(first.attr('fetchpriority'), 'high');
  const archive = photographyPage({ ...data, photos: [responsive] }, 'archive/', 'https://blog.test')!;
  const img = load(archive.body)('img').first();
  assert.equal(img.attr('loading'), 'lazy');
  assert(img.attr('srcset')?.includes('/photography/media/31-1280-webp'));
  assert(!img.attr('srcset')?.includes('/photography/archive/media/'));
});

test('合集保留文字、顺序和宽幅，脚本数据安全转义', () => {
  const second = { ...photo, id: 32, title: '</script><script>alert(1)</script>' };
  const album = { slug:'test', title:'合集中', photos:[31,32], cover:31, layout:[{type:'photo',photoId:32,span:'wide'},{type:'text',text:'第一段 <文字>'},{type:'photo',photoId:31,span:'half'}] };
  const page=photographyPage({...data,photos:[photo,second],albums:[album]},'collections/test/','https://blog.test')!;
  const $=load(page.body);
  assert.equal($('.photo-sequence-item').first().hasClass('is-wide'),true);
  assert.equal($('.photo-sequence-item').first().find('a').first().attr('href'),'/photography/works/32/');
  assert.equal($('.photo-sequence-text').text(),'第一段 <文字>');
  assert(!page.initialization.includes('</script><script>'));
  const values=JSON.parse(load(page.initialization)('#photography-data').text());
  assert.equal(values[1].title,second.title);
});

test('原作模式不会将示意作品用作首页封面，真实 EXIF 保留在作品详情', () => {
  const original={...photo,id:32,isDemo:false,exifInfo:{available:true,fields:[{label:'相机',value:'Nikon D850'},{label:'光圈',value:'f/8'}]}};
  const mixed={...data,photos:[{...photo,isDemo:true},original],studio:{originalsOnly:true,coverId:31}};
  const home=load(photographyPage(mixed,'','https://blog.test')!.body);
  assert.equal(home('.photo-cover a').attr('href'),'/photography/works/32/');
  const work=photographyPage(mixed,'works/32/','https://blog.test')!;
  assert(work.body.includes('Nikon D850'));assert(work.body.includes('f/8'));
});

// Imported galleries used date order for ties while the studio used ID order.
test('首页代表作顺序与后台相同，档案则按真实日期排列', () => {
  const values=[{...photo,id:1,date:'2026-01-01',featuredOrder:0},{...photo,id:2,date:'2025-01-01',featuredOrder:0},{...photo,id:3,date:'2024-01-01',featuredOrder:1}];
  const home=load(photographyPage({...data,photos:values},'','https://blog.test')!.body);
  assert.equal(home('.photo-cover a').attr('href'),'/photography/works/2/');
  assert.equal(home('.photo-grid .photo-entry-image').first().attr('href'),'/photography/works/1/');
  const archive=load(photographyPage({...data,photos:[values[2],values[0],values[1]]},'archive/','https://blog.test')!.body);
  assert.deepEqual(archive('.photo-entry-image').map((_,el)=>archive(el).attr('href')).get(),[1,2,3].map(id=>`/photography/works/${id}/`));
});
