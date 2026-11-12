const root = document.querySelector<HTMLElement>('.photography-workspace');
if (root) {
  const photos: { id: number; title: string; src: string; date: string; camera: string; href: string }[] = JSON.parse(document.getElementById('photography-data')?.textContent || '[]');
  const form = root.querySelector<HTMLFormElement>('[data-photo-filters]');
  const entries = [...root.querySelectorAll<HTMLElement>('[data-photo-entry]')];
  function filter(updateUrl = true) {
    if (!form) return;
    const values = new FormData(form), query = String(values.get('q') || '').trim().toLowerCase();
    let count = 0;
    for (const entry of entries) {
      entry.hidden = !(['category', 'year', 'camera'].every(key => !values.get(key) || entry.dataset[key] === values.get(key)) && (!query || entry.dataset.search?.includes(query)));
      if (!entry.hidden) count++;
    }
    root!.querySelector('[data-photo-count]')!.textContent = `${count} 幅作品${count !== entries.length ? ` / 共 ${entries.length} 幅` : ''}`;
    (root!.querySelector('[data-photo-empty]') as HTMLElement).hidden = count > 0;
    if (updateUrl) {
      const url = new URL(location.href);
      for (const key of ['q', 'category', 'year', 'camera']) { const value = String(values.get(key) || '').trim(); value ? url.searchParams.set(key, value) : url.searchParams.delete(key); }
      history.replaceState(null, '', url);
    }
  }
  function readFilters() {
    if (!form) return;
    const params = new URLSearchParams(location.search);
    for (const key of ['q','category','year','camera']) { const control = form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement; control.value = params.get(key) || ''; }
    filter(false);
  }
  if (form) {
    form.addEventListener('input', () => filter());
    form.addEventListener('submit', event => { event.preventDefault(); filter(); });
    form.addEventListener('reset', () => queueMicrotask(() => filter()));
    window.addEventListener('popstate', readFilters);
    readFilters();
  }
  const dialog = root.querySelector<HTMLDialogElement>('.photo-lightbox')!;
  const image = dialog.querySelector('img')!;
  let current = 0, visible = photos, opener: HTMLElement | null = null;
  function display(index: number) {
    current = (index + visible.length) % visible.length;
    const photo = visible[current]; if (!photo) return;
    image.alt = photo.title; image.src = photo.src;
    dialog.querySelector('[data-lightbox-title]')!.textContent = photo.title;
    dialog.querySelector('[data-lightbox-caption]')!.textContent = [photo.date,photo.camera,`${current+1} / ${visible.length}`].filter(Boolean).join(' · ');
    (dialog.querySelector('[data-lightbox-link]') as HTMLAnchorElement).href = photo.href;
    (dialog.querySelector('[data-lightbox-error]') as HTMLElement).hidden = true;
    dialog.querySelectorAll<HTMLButtonElement>('[data-lightbox-prev],[data-lightbox-next]').forEach(button => button.disabled = visible.length < 2);
  }
  root.addEventListener('click', async event => {
    const target = event.target as HTMLElement;
    const open = target.closest<HTMLElement>('[data-photo-open]');
    if (open) {
      // Use the displayed sequence, including a collection's custom ordering.
      visible = entries.length ? entries.filter(e=>!e.hidden).map(e=>photos.find(p=>p.id===Number(e.querySelector<HTMLElement>('[data-photo-open]')?.dataset.photoOpen))!).filter(Boolean) : photos;
      const index = visible.findIndex(p=>p.id===Number(open.dataset.photoOpen));
      if(index<0)return;opener=open;display(index);dialog.showModal();return;
    }
    if (target.closest('[data-lightbox-close]')) dialog.close();
    if (target.closest('[data-lightbox-prev]')) display(current-1);
    if (target.closest('[data-lightbox-next]')) display(current+1);
    const share = target.closest<HTMLElement>('[data-photo-share]');
    if(share) {
      const status = root.querySelector('[data-share-status]')!;
      try { await navigator.clipboard.writeText(new URL(share.dataset.photoShare!,location.origin).href);status.textContent='链接已复制'; }
      catch { status.textContent='可复制浏览器地址栏中的作品链接。'; }
    }
  });
  image.addEventListener('error',()=>{(dialog.querySelector('[data-lightbox-error]') as HTMLElement).hidden=false;});
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>opener?.focus());
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();display(current-1);}if(event.key==='ArrowRight'){event.preventDefault();display(current+1);}});
}
