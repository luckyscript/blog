import React, { useEffect, useRef } from 'react';
import studioHtml from '../../lib/photography/vendor/studio.html?raw';
import '../../styles/photography-studio.css';
import '../../styles/photography-studio-details.css';
import '../../styles/photography-studio-theme.css';

export default function PhotographyStudio() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current || root.current.dataset.initialized) return;
    root.current.dataset.initialized = 'true';
    // The imported studio owns its DOM and listeners. Keep its descendants
    // outside React reconciliation while sharing the blog's authenticated shell.
    root.current.innerHTML = '<p class="photography-loading" data-studio-loading role="status">正在加载摄影工作室…</p><p hidden data-studio-error role="alert"></p>' + studioHtml;
    (async () => {
      const scripts = ['/photography/exif-view.js', '/photography/studio/turnstile.js', '/photography/studio/admin.js', '/photography/studio/ai-copy.js', '/photography/studio/studio.js'];
      // Download together, preserving classic-script execution order and globals.
      await Promise.all(scripts.map(src => new Promise<void>((resolve, reject) => {
        const script = document.createElement('script'); script.async = false;
        script.src = src + '?v=perf-20261112-4'; script.onload = () => resolve();
        script.onerror = () => reject(new Error('摄影管理界面未能加载，请刷新重试'));
        root.current?.append(script);
      })));
    })().catch(error => { root.current?.querySelector('[data-studio-loading]')?.remove(); const target = root.current?.querySelector('[data-studio-error]'); if (target) { target.textContent = error.message; target.removeAttribute('hidden'); } });
  }, []);
  return <div ref={root} className="photography-studio" />;
}
