import React, { useEffect, useRef, useState } from 'react';
import UlyssesEditor, { type UlyssesEditorHandle } from './UlyssesEditor';
import WritingPreferences, { useWritingPreferences } from './WritingPreferences';
import { writingWords } from '../../lib/admin/writing';
import type { MomentForm } from '../../lib/admin/moment-writing';

export default function MomentWritingSurface({ value, onChange, onImages, onSave, readOnly, request }: {
  value: MomentForm; onChange: (value: MomentForm) => void; onImages: (files: File[]) => void;
  onSave: () => Promise<void>; readOnly: boolean; request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const [settings, setSettings] = useWritingPreferences();
  const [immersive, setImmersive] = useState(false), [selected, setSelected] = useState(false), [preview, setPreview] = useState(false);
  const [html, setHtml] = useState(''), [error, setError] = useState('');
  const editor = useRef<UlyssesEditorHandle>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setImmersive(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  useEffect(() => {
    if (!preview) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      request('moments/local/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), signal: controller.signal })
        .then(result => { setHtml(result.html); setError(''); })
        .catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [preview, value]);
  return <div className={`writer-studio moment-writing-surface writer-font-${settings.font} ${settings.dark ? 'writer-dark' : ''} ${immersive ? 'moment-writing-focus' : ''}`} style={{ '--writer-size': `${settings.fontSize}px` } as React.CSSProperties}>
    <div className="writing-toolbar">
      <div className="tabs" aria-label="碎碎念写作视图">
        <button aria-pressed={!preview} className={!preview ? 'selected' : ''} onClick={() => setPreview(false)}>写作</button>
        <button aria-pressed={preview} className={preview ? 'selected' : ''} onClick={() => setPreview(true)}>阅读预览</button>
      </div>
      <div className="writer-tools">
        <WritingPreferences settings={settings} onChange={setSettings} />
        <button className="text-button" aria-pressed={immersive} onClick={() => setImmersive(value => !value)}>{immersive ? '退出专注' : '专注'}</button>
      </div>
    </div>
    <div className="writing-body">
      <div className="writer-pane" hidden={preview}>
        <UlyssesEditor key={value.format} ref={editor} value={value.text} ariaLabel="碎碎念正文" placeholderText="记下此刻的想法，也可以直接粘贴图片…" maxLength={20000} plainText={value.format === 'plain'} onChange={text => onChange({ ...value, text })} onImages={onImages} onSave={() => { void onSave().then(() => requestAnimationFrame(() => editor.current?.focus())); }} onSelection={setSelected} paragraphFocus={settings.paragraphFocus} typewriter={settings.typewriter} readOnly={readOnly} />
        {selected && value.format === 'markdown' && <div className="writer-formatbar" role="toolbar" aria-label="碎碎念文字格式" onMouseDown={event => event.preventDefault()}>
          <button disabled={readOnly} onClick={() => editor.current?.format('**','**')} aria-label="加粗">B</button>
          <button disabled={readOnly} onClick={() => editor.current?.format('*','*')} aria-label="斜体"><i>I</i></button>
          <button disabled={readOnly} onClick={() => editor.current?.format('[','](https://)')} aria-label="插入链接">链接</button>
          <button disabled={readOnly} onClick={() => editor.current?.format('`','`')} aria-label="行内代码">代码</button>
        </div>}
      </div>
      {preview && <div className="markdown-preview">
        {error ? <p className="notice error" role="alert">{error}</p> : <iframe title="碎碎念阅读预览" sandbox="" srcDoc={`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:18px/1.95 'Songti SC',serif;color:#353c36;margin:24px;overflow-wrap:anywhere}h1,h2,h3{font-size:1.3em}img{max-width:100%;max-height:320px;object-fit:contain}blockquote{margin:20px 0;padding-left:18px;border-left:2px solid #a58b6c;color:#8d9187}pre{overflow:auto;padding:16px;background:#f3f1ea}a{color:#897453}</style><body>${html || '<p>文字会在这里慢慢显现。</p>'}</body></html>`} />}
      </div>}
    </div>
    <div className="writing-footer">
      <span>{writingWords(value.text)} 字 · {value.images.length} / 9 张配图 · {value.text.length} / 20000 字符</span>
      <select aria-label="碎碎念正文格式" value={value.format} disabled={readOnly} onChange={event => onChange({ ...value, format: event.target.value as MomentForm['format'] })}>
        <option value="markdown">轻量 Markdown</option><option value="plain">纯文本</option>
      </select>
    </div>
  </div>;
}
