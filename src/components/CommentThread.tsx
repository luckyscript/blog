import { useId, useRef, useState } from 'react';
import Turnstile, { type TurnstileSettings } from './admin/Turnstile';
import type { CommentTarget, CommentPage, PublicComment } from '../lib/comments/input';
import '../styles/comments.css';

export default function CommentThread({ target, initial, turnstile }: { target: CommentTarget; initial: CommentPage; turnstile: TurnstileSettings }) {
  const [data, setData] = useState(initial);
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [body, setBody] = useState(''), [website, setWebsite] = useState('');
  const [reply, setReply] = useState<PublicComment | null>(null);
  const [token, setToken] = useState(''), [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(false);
  const submissionId = useRef(''), submitting = useRef(false), textarea = useRef<HTMLTextAreaElement>(null);
  const formId = useId();
  const endpoint = `/api/comments/${target.kind}/${target.id}`;
  async function loadMore() {
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}?page=${data.page + 1}`);
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(current => ({ ...next, items: [...current.items, ...next.items.filter((row: PublicComment) => !current.items.some(item => item.id === row.id))] }));
    } catch (error: any) { setMessage(error.message || '评论加载失败，请重试'); setError(true); }
    finally { setLoading(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!token) { setMessage('请先完成安全验证'); setError(true); return; }
    submitting.current = true; setBusy(true); setMessage('');
    submissionId.current ||= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: submissionId.current, name, email: email.trim(), body, parentId: reply?.id || null, turnstileToken: token, website }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '评论提交失败');
      setBody(''); setReply(null); submissionId.current = '';
      setMessage(result.status === 'approved' ? '这条评论已公开。' : '评论已提交，审核通过后会显示在这里。'); setError(false);
    } catch (error: any) { setMessage(error.message || '网络连接失败，内容仍保留，请重新验证后重试。'); setError(true); }
    finally { setToken(''); setResetKey(key => key + 1); setBusy(false); submitting.current = false; }
  }
  return <section id="comments" className="comment-thread" aria-labelledby={`${formId}-heading`}>
    <header className="comment-heading"><div><span className="comment-eyebrow">LEAVE A NOTE</span><h2 id={`${formId}-heading`}>留几句话</h2></div><span>{data.total ? `${data.total} 条评论` : '欢迎留下第一条评论'}</span></header>
    {data.items.length > 0 && <ol className="comment-list">{data.items.map(item => <li key={item.id} id={`comment-${item.id}`} className={`comment-item ${item.parentId ? 'comment-reply' : ''}`}>
      <div className="comment-meta"><strong>{item.name}</strong>{item.isAuthor && <span className="comment-author-badge">博主</span>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
      {item.replyTo && <p className="comment-reply-to">回复 {item.replyTo}</p>}
      <p className="comment-body">{item.body}</p>
      {!item.parentId && <button className="comment-text-button" disabled={busy} onClick={() => { setReply(item); submissionId.current = ''; textarea.current?.focus(); }}>回复</button>}
    </li>)}</ol>}
    {data.page < data.pages && <button className="comment-more" disabled={loading} onClick={() => void loadMore()}>{loading ? '正在加载…' : '加载更多评论'}</button>}
    <form className="comment-form" onSubmit={submit}>
      <p className="comment-intro">无需注册。评论审核通过后公开，请友善交流。</p>
      {reply && <div className="comment-replying">正在回复 {reply.name}<button type="button" className="comment-text-button" disabled={busy} onClick={() => { setReply(null); submissionId.current = ''; }}>取消回复</button></div>}
      <fieldset disabled={busy || !turnstile.configured}>
        <label htmlFor={`${formId}-body`}>评论内容</label>
        <textarea id={`${formId}-body`} ref={textarea} value={body} onChange={event => { setBody(event.target.value); submissionId.current = ''; }} placeholder="读到这里，你想到了什么？" required maxLength={4000} rows={4} />
        <div className="comment-fields">
          <label htmlFor={`${formId}-name`}>昵称<input id={`${formId}-name`} value={name} onChange={event => { setName(event.target.value); submissionId.current = ''; }} required maxLength={60} autoComplete="nickname" /></label>
          <label htmlFor={`${formId}-email`}>邮箱 <span>选填，仅站长可见</span><input id={`${formId}-email`} type="email" value={email} onChange={event => { setEmail(event.target.value); submissionId.current = ''; }} maxLength={254} autoComplete="email" /></label>
        </div>
        <label className="comment-honeypot" aria-hidden="true">请留空<input value={website} onChange={event => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
      </fieldset>
      {turnstile.configured ? <Turnstile siteKey={turnstile.siteKey} action="comment-submit" resetKey={resetKey} onToken={setToken} /> : <p className="comment-status" role="status">评论提交暂不可用，请稍后再来。</p>}
      {message && <p className={`comment-status ${error ? 'comment-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
      <div className="comment-submit-row"><span>邮箱不会公开，也不会自动订阅邮件。</span><button className="comment-submit" type="submit" disabled={busy || !token || !turnstile.configured}>{busy ? '正在提交…' : '提交评论'}</button></div>
    </form>
  </section>;
}
