import React, { useEffect, useState } from 'react';
export type WritingSettings = { paragraphFocus: boolean; typewriter: boolean; dark: boolean; font: 'serif' | 'sans'; fontSize: number };
const defaults: WritingSettings = { paragraphFocus: false, typewriter: false, dark: false, font: 'serif', fontSize: 18 };
const key = 'inkrain-writing-settings';
function decode(raw: string | null): WritingSettings {
  try {
    const value = JSON.parse(raw || '{}');
    return { paragraphFocus: value.paragraphFocus === true, typewriter: value.typewriter === true, dark: value.dark === true, font: value.font === 'sans' ? 'sans' : 'serif', fontSize: [16,18,20,22].includes(value.fontSize) ? value.fontSize : 18 };
  } catch { return defaults; }
}
export function useWritingPreferences() {
  const [settings, setSettings] = useState<WritingSettings>(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setSettings(decode(localStorage.getItem(key))); } catch {}
    setReady(true);
    const sync = (event: StorageEvent) => { if (event.key === key) setSettings(decode(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(key, JSON.stringify(settings)); } catch {} }, [settings, ready]);
  return [settings, setSettings] as const;
}
export default function WritingPreferences({ settings, onChange }: { settings: WritingSettings; onChange: (value: WritingSettings) => void }) {
  return <details className="writer-preferences">
    <summary aria-label="写作偏好">Aa</summary>
    <div className="writer-preferences-panel">
      <span className="eyebrow">写作偏好</span>
      <label>字体<select value={settings.font} onChange={event => onChange({ ...settings, font: event.target.value as WritingSettings['font'] })}><option value="serif">宋体</option><option value="sans">无衬线</option></select></label>
      <label>字号<select value={settings.fontSize} onChange={event => onChange({ ...settings, fontSize: Number(event.target.value) })}>{[16,18,20,22].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={settings.typewriter} onChange={event => onChange({ ...settings, typewriter: event.target.checked })} />打字机模式</label>
      <label className="check-label"><input type="checkbox" checked={settings.paragraphFocus} onChange={event => onChange({ ...settings, paragraphFocus: event.target.checked })} />聚焦当前段落</label>
      <label className="check-label"><input type="checkbox" checked={settings.dark} onChange={event => onChange({ ...settings, dark: event.target.checked })} />深色纸面</label>
      <small>⌘ / Ctrl + S 保存 · Escape 退出专注</small>
    </div>
  </details>;
}
