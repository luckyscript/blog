import { useEffect, useRef, useState } from 'react';

type Comment = { id: string; name: string; email: string; body: string; status: 'pending' | 'approved' | 'trash'; version: number; createdAt: string; parentId: string | null; replyTo: string | null; isAuthor: boolean; target: { kind: 'post' | 'moment' | 'series'; id: string }; targetTitle: string; targetPath: string; targetStatus: string };
type Page = { items: Comment[]; total: number; pages: number; counts: Record<string, number> };
export default function CommentsManager({ request }: { request: (path: string, options?: RequestInit) => Promise<any> }) {
  const [data, setData] = useState<Page | null>(null), [status, setStatus] = useState('pending'), [kind, setKind] = useState(''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null), [busy, setBusy] = useState(false), [replying, setReplying] = useState<string | null>(null), [reply, setReply] = useState(''), [deleting, setDeleting] = useState<string | null>(null);
  const replyId = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    request(`comments?${new URLSearchParams({ status, kind, page: String(page) })}`, { signal: controller.signal }).then(setData).catch(error => { if (error.name !== 'AbortError') setNotice({ text: error.message, error: true }); });
    return () => controller.abort();
  }, [status, kind, page, refresh]);
  async function moderate(item: Comment, action: string) {
    setBusy(true); setNotice(null);
    try {
      await request(`comments/${item.id}`, { method: 'PUT', body: JSON.stringify({ action, version: item.version }) });
      setNotice({ text: action === 'approve' ? '评论已审核通过，前台已显示。' : action === 'trash' ? '评论已移入回收站，可恢复后重新审核。' : action === 'restore' ? '评论已恢复到待审核列表。' : '评论已撤回到待审核，前台不再显示。' });
      setDeleting(null); setReplying(null); setData(null); setRefresh(value => value + 1);
    } catch (error: any) { setNotice({ text: error.message, error: true }); }
    finally { setBusy(false); }
  }
  async function sendReply(item: Comment) {
    if (!reply.trim()) return;
    replyId.current ||= crypto.randomUUID();
    setBusy(true); setNotice(null);
    try {
      await request(`comments/${item.id}/replies`, { method: 'POST', body: JSON.stringify({ id: replyId.current, body: reply, version: item.version }) });
      setReply(''); setReplying(null); replyId.current = ''; setNotice({ text: '回复已发布，前台标记为博主。' }); setRefresh(value => value + 1);
    } catch (error: any) { setNotice({ text: error.message, error: true }); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><span className="eyebrow">A CONVERSATION CONTINUES</span><h1>评论</h1><p>来自文章、系列与碎碎念的留言，在这里慢慢回应。</p></div><button className="button" disabled={busy} onClick={() => { setNotice(null); setRefresh(value => value + 1); }}>刷新列表</button></div>
    {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
    <div className="comment-admin-filters"><div className="tabs" aria-label="评论状态">{[['pending', '待审核'], ['approved', '已公开'], ['trash', '回收站'], ['', '全部']].map(([key, label]) => <button key={key} aria-pressed={status === key} className={status === key ? 'selected' : ''} disabled={busy} onClick={() => { setStatus(key); setPage(1); setData(null); setDeleting(null); setReplying(null); }}>{label}{key && data ? ` ${data.counts[key] || 0}` : ''}</button>)}</div><label>来源<select aria-label="评论来源" value={kind} disabled={busy} onChange={event => { setKind(event.target.value); setPage(1); setData(null); }}><option value="">全部来源</option><option value="post">文章</option><option value="moment">碎碎念</option><option value="series">系列</option></select></label></div>
    <p className="muted">访客评论审核后公开。邮箱仅后台可见；删除进入回收站，恢复后需重新审核。</p>
    {!data ? <p className="muted" role="status">正在加载评论…</p> : data.items.length === 0 ? <section className="panel comment-admin-empty">{status === 'pending' ? '暂时没有待审核的评论。' : '这里还没有评论。'}</section> : <div className="comment-admin-list">{data.items.map(item => <article key={item.id} className="panel comment-admin-card">
      <header><div><strong>{item.name}</strong>{item.isAuthor && <span className="section-badge">博主</span>}<span className={`status-badge ${item.status === 'approved' ? 'published' : item.status === 'pending' ? 'draft' : 'trash'}`}>{({ pending: '待审核', approved: '已公开', trash: '回收站' })[item.status]}</span></div><time>{new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time></header>
      <p className="comment-admin-target">{item.target.kind === 'post' ? '文章' : item.target.kind === 'series' ? '系列' : '碎碎念'} · <a href={`${item.targetPath}#comments`} target="_blank" rel="noreferrer">{item.targetTitle}</a>{item.targetStatus !== 'published' && <span> · 原内容尚未公开</span>}</p>
      {item.replyTo && <p className="muted">回复 {item.replyTo}</p>}
      <p className="comment-admin-body">{item.body}</p>
      {item.email && <p className="comment-admin-email">邮箱（不公开）：{item.email}</p>}
      <div className="button-row">
        {item.status === 'pending' && <button className="button small primary" disabled={busy} onClick={() => void moderate(item, 'approve')}>审核通过</button>}
        {item.status === 'approved' && <><button className="button small" disabled={busy || !!item.parentId} onClick={() => { setReplying(item.id); setReply(''); replyId.current = ''; }}>回复</button><button className="button small" disabled={busy} onClick={() => void moderate(item, 'pending')}>撤回公开</button></>}
        {item.status === 'trash' ? <button className="button small" disabled={busy} onClick={() => void moderate(item, 'restore')}>恢复到待审核</button> : <button className="button small danger" disabled={busy} onClick={() => setDeleting(item.id)}>删除</button>}
      </div>
      {deleting === item.id && <div className="notice comment-admin-confirm" role="alertdialog" aria-label="确认删除评论">将这条评论移入回收站？其回复也会从前台隐藏。<div className="button-row"><button className="button small danger" disabled={busy} onClick={() => void moderate(item, 'trash')}>确认删除</button><button className="button small" disabled={busy} onClick={() => setDeleting(null)}>取消</button></div></div>}
      {replying === item.id && <div className="comment-admin-reply"><label>回复 {item.name}<textarea value={reply} onChange={event => { setReply(event.target.value); replyId.current = ''; }} rows={4} maxLength={4000} disabled={busy} autoFocus /></label><div className="button-row"><button className="button primary small" disabled={busy || !reply.trim()} onClick={() => void sendReply(item)}>发布回复</button><button className="button small" disabled={busy} onClick={() => setReplying(null)}>取消</button></div></div>}
    </article>)}</div>}
    {data && <div className="pagination"><span>共 {data.total} 条评论</span><div><button disabled={busy || page <= 1} onClick={() => { setPage(value => value - 1); setData(null); }}>上一页</button><span>{page} / {data.pages}</span><button disabled={busy || page >= data.pages} onClick={() => { setPage(value => value + 1); setData(null); }}>下一页</button></div></div>}
  </>;
}
