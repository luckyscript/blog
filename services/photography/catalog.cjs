(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PortfolioCatalog = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const categories = { all: '全部题材', landscape: '风光山野', city: '城市漫游', daily: '日常片刻', adventure: '户外探索' };
  function parseState(query, photos) {
    const params = new URLSearchParams(query);
    const years = new Set(photos.filter(photo=>photo.date).map(photo => photo.date.slice(0, 4)));
    return {
      year: params.get('year')==='unknown'||years.has(params.get('year')) ? params.get('year') : 'all',
      month: /^(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month') : 'all',
      category: Object.hasOwn(categories, params.get('category')) ? params.get('category') : 'all',
      order: params.get('order') === 'oldest' ? 'oldest' : 'newest',
      view: params.get('view') === 'grid' ? 'grid' : 'timeline',
      q:(params.get('q')||'').trim().slice(0,100),source:params.get('source')==='originals'?'originals':'all',equipment:/^[a-z0-9-]{1,80}$/.test(params.get('equipment')||'')?params.get('equipment'):'all'
    };
  }
  function serializeState(state) {
    const query = new URLSearchParams();
    const defaults = {year:'all',month:'all',category:'all',order:'newest',view:'timeline',q:'',source:'all',equipment:'all'};
    for (const key of Object.keys(defaults)) if (state[key] && state[key] !== defaults[key]) query.set(key, state[key]);
    return query.toString();
  }
  // The public archive intentionally offers only time, subject, order and view.
  // Keep parseState available for internal/API workflows, but never apply hidden
  // legacy search, source or camera restrictions on the simplified public page.
  function parseArchiveState(query, photos, remote=false) {
    const input=new URLSearchParams(query),allowed=new URLSearchParams();
    for(const key of ['year','month','category','order','view'])if(input.has(key))allowed.set(key,input.get(key));
    const state=parseState(allowed.toString(),photos);
    if(remote&&/^(\d{4}|unknown)$/.test(allowed.get('year')||''))state.year=allowed.get('year');
    return state;
  }
  function selectPhotos(photos, state) {
    return photos.filter(photo =>
      (state.year === 'all' || (state.year==='unknown'?!photo.date:photo.date?.startsWith(state.year + '-'))) &&
      (state.month === 'all' || photo.date?.slice(5, 7) === state.month) &&
      (state.category === 'all' || photo.category === state.category) &&
      (!state.q || (photo.title+' '+photo.description).toLocaleLowerCase().includes(state.q.toLocaleLowerCase())) &&
      (state.source !== 'originals' || photo.isDemo === false) &&
      (!state.equipment || state.equipment === 'all' || (photo.isDemo===false && (state.equipment==='unknown'?!photo.equipmentId:photo.equipmentId===state.equipment)))
    ).sort((a, b) => {
      if (!a.date || !b.date) return (!a.date ? 1 : 0) - (!b.date ? 1 : 0) || b.id - a.id;
      const dateOrder = a.date.localeCompare(b.date);
      return (state.order === 'oldest' ? dateOrder : -dateOrder) || (state.order==='oldest'?a.id-b.id:b.id-a.id);
    });
  }
  function groupByMonth(photos) {
    const groups = new Map();
    for (const photo of photos) {
      const month = photo.date?.slice(0, 7) || 'unknown';
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(photo);
    }
    return [...groups].map(([month, photos]) => ({month, photos}));
  }
  function albumPhotos(photos, album) {
    const byId = new Map(photos.map(photo => [photo.id, photo]));
    return album.photos.map(id => byId.get(id)).filter(Boolean);
  }
  function dateRange(photos) {
    const dates = photos.map(photo => photo.date).filter(Boolean).sort();
    return dates.length ? [dates[0].slice(0,7), dates.at(-1).slice(0,7)] : [];
  }
  return {categories, parseState, parseArchiveState, serializeState, selectPhotos, groupByMonth, albumPhotos, dateRange};
});
