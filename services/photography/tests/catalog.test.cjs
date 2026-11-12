const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../dist/catalog.js');
const {photos, albums} = require('../src/content.json');
const initial = C.parseState('', photos);

test('the full archive contains each work once, in reverse chronological order', () => {
  const copy = JSON.stringify(photos);
  const selected = C.selectPhotos(photos, initial);
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map(p=>p.id)).size, 8);
  assert.equal(selected[0].id, 1);
  assert.equal(selected.at(-1).id, 7);
  assert.equal(JSON.stringify(photos), copy);
  assert.equal(C.selectPhotos(photos,{...initial,order:'oldest'})[0].id, 7);
});
test('year, month and subject filters intersect correctly, including empty results', () => {
  assert.deepEqual(C.selectPhotos(photos,C.parseState('?year=2026&month=07&category=landscape',photos)).map(p=>p.id),[2,4]);
  assert.equal(C.selectPhotos(photos,C.parseState('?year=2025',photos)).length,3);
  assert.equal(C.selectPhotos(photos,C.parseState('?year=2026&month=12',photos)).length,0);
  assert.deepEqual(C.selectPhotos(photos,C.parseState('?category=city',photos)).map(p=>p.id),[6]);
  assert.equal(C.selectPhotos(photos,C.parseState('?month=09',photos)).length,3);
});
test('URL state round trips and malformed query values degrade safely', () => {
  const state = C.parseState('?year=2026&month=07&category=landscape&view=grid&order=oldest',photos);
  assert.deepEqual(C.parseState(C.serializeState(state),photos),state);
  assert.deepEqual(C.parseState('?year=9999&month=13&category=__proto__&view=bad&order=bad',photos),initial);
  assert.equal(C.serializeState(initial),'');
});
test('timeline month groups preserve the current sorting and include every filtered frame', () => {
  const items = C.selectPhotos(photos,initial);
  const groups = C.groupByMonth(items);
  assert.equal(groups[0].month,'2026-09');
  assert.deepEqual(groups[0].photos.map(p=>p.id),[1,5]);
  assert.deepEqual(groups.flatMap(g=>g.photos.map(p=>p.id)),items.map(p=>p.id));
  assert.equal(C.groupByMonth(C.selectPhotos(photos,{...initial,order:'oldest'}))[0].month,'2025-02');
});
test('collection details preserve curated order, reference real works and cover the archive', () => {
  const covered = new Set();
  for (const album of albums) {
    assert.equal(new Set(album.photos).size,album.photos.length);
    assert.deepEqual(C.albumPhotos(photos,album).map(p=>p.id),album.photos);
    assert.ok(album.photos.includes(album.cover));
    album.photos.forEach(id=>covered.add(id));
  }
  assert.equal(covered.size,photos.length);
  assert.deepEqual(C.dateRange(C.albumPhotos(photos,albums[0])),['2025-02','2026-09']);
  assert.deepEqual(C.dateRange([]),[]);
});
test('the homepage is a curated subset; equipment has its own route', () => {
  const html = fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
  assert.equal((html.match(/data-photo="/g)||[]).length,6);
  assert.ok(html.includes('href="archive/"'));
  assert.ok(!html.includes('gear-story-copy'));
  const equipment = fs.readFileSync(path.join(__dirname,'../dist/equipment/index.html'),'utf8');
  assert.equal((equipment.match(/class="gear-story"/g)||[]).length,6);
});
