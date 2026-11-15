import React, { useEffect, useRef, useState } from "react";
import MomentWritingSurface from "./MomentWritingSurface";
import { decodeMomentDraft, encodeMomentDraft, type MomentForm } from "../../lib/admin/moment-writing";

type Photo = { url: string; alt: string };
type Record = {
  id: string;
  version: string;
  status: string;
  editable: boolean;
  historical: boolean;
  hasDraft: boolean;
  text: string;
  format: 'plain' | 'markdown';
  images: Photo[];
  publishedAt: string;
};
const blank = (): MomentForm => ({
  text: "",
  format: 'markdown',
  images: [] as Photo[],
  publishedAt: new Date().toISOString(),
});
const localTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export default function LocalMoments({
  request,
  upload,
  mediaPicker,
}: {
  request: (path: string, options?: RequestInit) => Promise<any>;
  upload: (file: File, alt: string) => Promise<any>;
  mediaPicker: (onSelect: (item: any) => void) => React.ReactNode;
}) {
  const [data, setData] = useState<{
    items: Record[];
    pages: number;
    total: number;
  } | null>(null);
  const [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<Record | null | undefined>(undefined),
    [form, setForm] = useState(blank);
  const formRef = useRef(form);
  formRef.current = form;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const baseline = useRef('');
  const [recover, setRecover] = useState<ReturnType<typeof decodeMomentDraft>>(null);
  const recoverRef = useRef(recover);
  recoverRef.current = recover;
  const draftId = useRef('');
  const savePromise = useRef<Promise<Record | null> | null>(null);
  const unacknowledged = useRef<{ id: string; input: MomentForm; version: string | null } | null>(null);
  const session = useRef(0);
  const [syncing, setSyncing] = useState(false), [synced, setSynced] = useState(false), [syncError, setSyncError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Record | null>(null);
  const [writerSession, setWriterSession] = useState(0);
  const [localSaved, setLocalSaved] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const draftKey = () => `inkrain-moment-unsaved-${editingRef.current?.id || 'new'}`;
  const persistLocal = () => {
    if (editingRef.current === undefined || recoverRef.current) return false;
    try {
      if (JSON.stringify(formRef.current) === baseline.current) {
        localStorage.removeItem(draftKey()); setLocalSaved(false);
      } else {
        localStorage.setItem(draftKey(), encodeMomentDraft(formRef.current, editingRef.current?.version || null, draftId.current)); setLocalSaved(true);
      }
      setStorageFailed(false);
      return true;
    } catch { setStorageFailed(true); setLocalSaved(false); return false; }
  };
  const persistRef = useRef(persistLocal);
  persistRef.current = persistLocal;
  useEffect(() => { persistLocal(); }, [form, editing]);
  const syncRef = useRef<(keepalive?: boolean) => Promise<Record | null>>(async () => null);
  useEffect(() => {
    const preserve = () => persistRef.current();
    const flush = () => { preserve(); void syncRef.current(true).catch(() => {}); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const warn = (event: BeforeUnloadEvent) => {
      preserve();
      if (uploadLock.current || (editingRef.current !== undefined && !recoverRef.current && JSON.stringify(formRef.current) !== baseline.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', warn);
    return () => { preserve(); window.removeEventListener('pagehide', flush); window.removeEventListener('online', flush); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', warn); };
  }, []);
  const saveLock = useRef(false);
  const uploadLock = useRef(false),
    active = useRef(true),
    [picker, setPicker] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    request(`moments/local?status=${filter}&page=${page}`)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((error) => {
        if (current) setNotice({ text: error.message, error: true });
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [filter, page, reload]);
  const disabled = busy || uploading || !!recover;
  async function open(row: Record | null, skipSync = false) {
    if (saveLock.current || uploadLock.current) return;
    persistLocal();
    setBusy(true);
    try {
      if (!skipSync) await syncRef.current();
      let pending = null;
      try { pending = decodeMomentDraft(localStorage.getItem(`inkrain-moment-unsaved-${row?.id || 'new'}`)); } catch {}
      let current = row ? await request(`moments/local/${row.id}`) as Record : null;
      if (!row && pending?.id) {
        try { current = await request(`moments/local/${pending.id}`); } catch {}
      }
      const next = current ? { text: current.text, images: current.images, publishedAt: current.publishedAt, format: current.format || 'plain' as const } : blank();
      editingRef.current = current;
      draftId.current = current?.id || pending?.id || crypto.randomUUID();
      formRef.current = next;
      baseline.current = JSON.stringify(next);
      session.current++;
      unacknowledged.current = null;
      setEditing(current);
      setWriterSession(value => value + 1);
      setForm(next);
      setLocalSaved(false);
      setSynced(!!current);
      setSyncError('');
      if (!row && current && pending) {
        try {
          localStorage.setItem(draftKey(), encodeMomentDraft(pending.input, pending.baseVersion, current.id));
          localStorage.removeItem('inkrain-moment-unsaved-new');
        } catch { setStorageFailed(true); }
      }
      const recovery = pending && JSON.stringify(pending.input) !== baseline.current ? pending : null;
      recoverRef.current = recovery;
      setRecover(recovery);
      setNotice(null);
      requestAnimationFrame(() => document.querySelector('.local-note-composer')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } catch (error: any) { setNotice({ text: error.message, error: true }); }
    finally { setBusy(false); }
  }
  async function saveDraft(keepalive = false): Promise<Record | null> {
    while (savePromise.current) await savePromise.current;
    if (editingRef.current === undefined || recoverRef.current || uploadLock.current) return null;
    if (!unacknowledged.current && JSON.stringify(formRef.current) === baseline.current && editingRef.current) return editingRef.current;
    if (!unacknowledged.current && !editingRef.current && !formRef.current.text.trim() && !formRef.current.images.length) return null;
    const id = editingRef.current?.id || draftId.current;
    if (!id) return null;
    const currentSession = session.current;
    persistLocal(); setSyncing(true); setSyncError('');
    const work = (async () => {
      // Replay the exact uncertain request first, then send any newer typing with its acknowledged version.
      let replay = unacknowledged.current;
      for (;;) {
        const pending = replay || { id, input: formRef.current, version: editingRef.current?.version || null };
        unacknowledged.current = pending;
        const body = JSON.stringify({ input: pending.input, version: pending.version });
        const saved = await request(`moments/local/${pending.id}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: keepalive && new TextEncoder().encode(body).length < 60000 });
        unacknowledged.current = null;
        if (!active.current || currentSession !== session.current) return saved;
        const oldKey = draftKey();
        editingRef.current = saved; draftId.current = saved.id; setEditing(saved);
        baseline.current = JSON.stringify(pending.input); setSynced(true);
        if (JSON.stringify(formRef.current) === baseline.current) {
          try { localStorage.removeItem(oldKey); localStorage.removeItem(draftKey()); } catch {}
          setLocalSaved(false);
        } else {
          persistRef.current();
          try { if (oldKey !== draftKey() && localStorage.getItem(draftKey())) localStorage.removeItem(oldKey); } catch {}
        }
        setReload(value => value + 1);
        if (!replay || JSON.stringify(formRef.current) === baseline.current) return saved;
        replay = null;
      }
    })();
    savePromise.current = work;
    try { return await work; }
    catch (error: any) {
      if (error.status && error.status < 500) unacknowledged.current = null;
      if (active.current && currentSession === session.current) { persistRef.current(); setSyncError(error.message); }
      throw error;
    } finally {
      if (savePromise.current === work) savePromise.current = null;
      if (active.current && currentSession === session.current) setSyncing(false);
    }
  }
  syncRef.current = saveDraft;
  useEffect(() => {
    if (editing === undefined || recover || busy || uploading || syncing || syncError || JSON.stringify(form) === baseline.current) return;
    const timer = setTimeout(() => { void saveDraft().catch(() => {}); }, 1200);
    return () => clearTimeout(timer);
  }, [form, editing, recover, busy, uploading, syncing, syncError]);
  const updateForm = (patch: Partial<MomentForm>) => { formRef.current = { ...formRef.current, ...patch }; setForm(current => ({ ...current, ...patch })); setSyncError(''); };
  async function closeEditor() {
    if (saveLock.current || uploadLock.current || recoverRef.current) return;
    setBusy(true);
    try {
      await saveDraft();
      if (JSON.stringify(formRef.current) !== baseline.current) await saveDraft();
      editingRef.current = undefined; setEditing(undefined); setRecover(null); recoverRef.current = null;
    } catch {}
    finally { setBusy(false); }
  }
  async function addFiles(files: File[]) {
    if (uploadLock.current || busy || recoverRef.current) return;
    if (files.length + formRef.current.images.length > 9) {
      setNotice({
        text: "每条最多添加 9 张图片，请减少选择数量。",
        error: true,
      });
      return;
    }
    uploadLock.current = true;
    setUploading(true);
    setNotice({ text: `正在上传 ${files.length} 张图片…` });
    let failures = 0;
    try {
      for (const file of files) {
        try {
          if (!file.type.startsWith("image/"))
            throw new Error("请选择图片文件");
          const item = await upload(file, "");
          if (active.current)
            setForm((current) => ({
              ...current,
              images: [
                ...current.images,
                { url: item.url, alt: item.alt || "" },
              ],
            }));
        } catch (error: any) {
          failures++;
          if (active.current)
            setNotice({
              text: `图片上传失败：${error.message}。已成功的图片会保留，可以重试。`,
              error: true,
            });
        }
      }
      if (!failures && active.current)
        setNotice({ text: "图片已上传，可以发布了。" });
    } finally {
      uploadLock.current = false;
      if (active.current) setUploading(false);
    }
  }
  function pick(item: any) {
    setPicker(false);
    if (!item.mime?.startsWith("image/")) {
      setNotice({ text: "碎碎念配图请选择图片文件。", error: true });
      return;
    }
    if (formRef.current.images.length >= 9) {
      setNotice({ text: "每条最多添加 9 张图片。", error: true });
      return;
    }
    setForm((current) => ({
      ...current,
      images: [...current.images, { url: item.url, alt: item.alt || "" }],
    }));
    setPicker(false);
  }
  async function save(status: 'draft' | 'published') {
    if (busy || saveLock.current || uploadLock.current || recoverRef.current) return;
    saveLock.current = true; setBusy(true); setNotice(null);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const value = await request(`moments/local/${saved.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { ...formRef.current, status }, version: saved.version }) });
      try { localStorage.removeItem(draftKey()); } catch {}
      editingRef.current = undefined; setEditing(undefined); setForm(blank()); setSynced(false);
      setFilter(status); setPage(1); setReload(value => value + 1);
      setNotice({ text: value.status === 'published' ? '已发布，碎碎念时间线已更新。' : '已撤回为草稿，可在草稿箱继续编辑。' });
    } catch (error: any) { setNotice({ text: error.message, error: true }); }
    finally { saveLock.current = false; setBusy(false); }
  }
  async function change(row: Record, action: 'trash' | 'restore') {
    if (busy || saveLock.current) return;
    saveLock.current = true; setBusy(true); setNotice(null);
    try {
      const own = editingRef.current?.id === row.id;
      const target = own ? await saveDraft() || editingRef.current! : row;
      await request(`moments/local/${target.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: target.version }) });
      if (own) {
        try { localStorage.removeItem(draftKey()); } catch {}
        editingRef.current = undefined; setEditing(undefined); setRecover(null); recoverRef.current = null;
      }
      setPendingDelete(null); setReload(value => value + 1);
      setNotice({ text: action === 'trash' ? '已删除到回收站，可以恢复。' : '已恢复为草稿，可在草稿箱继续写作。' });
    } catch (error: any) { setNotice({ text: error.message, error: true }); }
    finally { saveLock.current = false; setBusy(false); }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SMALL NOTES, EVERYDAY LIFE</span>
          <h1>本站碎碎念</h1>
          <p>记下此刻的想法，给日常留一张小笺。</p>
        </div>
        <div className="button-row"><button className="button" disabled={busy} onClick={() => { setFilter('draft'); setPage(1); }}>继续写草稿</button><button
          className="button primary"
          disabled={disabled}
          onClick={() => void open(null)}
        >
          写一条碎碎念
        </button></div>
      </div>
      {notice && (
        <div
          className={`notice ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}
      {editing !== undefined && (
        <section className="local-note-composer" aria-label="编辑本站碎碎念">
          <div className="local-note-heading">
            <h2>{editing ? "编辑碎碎念" : "新的一条"}</h2>
            <div className="button-row"><span>文字与图片 · 最多 9 张</span>{editing && <button className="button small danger" disabled={disabled} onClick={() => setPendingDelete(editing)}>删除这条</button>}</div>
          </div>
          {storageFailed && <div className="notice error" role="alert">本机草稿存储不可用，请及时保存草稿或复制文字备份。</div>}
          {recover && <div className="notice recovery">
            {recover.baseVersion && recover.baseVersion !== editing?.version ? '服务器已有较新内容，请核对后恢复本机草稿。' : '发现上次未保存的碎碎念。'}
            <button onClick={() => { formRef.current = recover.input; setForm(recover.input); recoverRef.current = null; setRecover(null); setSyncError(''); }}>恢复本地内容</button>
            <button onClick={() => { try { localStorage.removeItem(draftKey()); } catch {} recoverRef.current = null; setRecover(null); }}>忽略</button>
          </div>}
          <MomentWritingSurface key={writerSession} value={form} onChange={updateForm} onImages={files => void addFiles(files)} onSave={async () => { try { await saveDraft(); } catch {} }} readOnly={busy || !!recover} request={request} />
          <div className={`moment-local-state ${syncError ? 'moment-sync-error' : ''}`} role={syncError ? 'alert' : 'status'}>
            {recover ? '选择恢复或忽略后继续写作' : uploading ? '图片上传中，完成后自动保存草稿。' : syncing ? '正在保存到服务器…' : syncError ? `同步失败：${syncError}。${localSaved ? '本机内容已保留。' : '请复制正文备份。'}` : JSON.stringify(form) !== baseline.current ? '等待保存到服务器…' : synced ? '已保存到服务器，可换设备继续写作。' : '输入后自动保存到服务器草稿箱。'}
            {syncError && <><button className="text-button" onClick={() => void saveDraft().catch(() => {})}>重试保存</button>{editing && <button className="text-button" onClick={() => void open(editing, true)}>重新打开服务器草稿</button>}</>}
          </div>
          {!!form.images.length && (
            <div className="local-note-photos">
              {form.images.map((image, index) => (
                <figure key={`${image.url}-${index}`}>
                  <img src={image.url} alt={image.alt || `配图 ${index + 1}`} />
                  <button
                    type="button"
                    className="local-note-remove"
                    disabled={disabled}
                    aria-label={`移除第 ${index + 1} 张图片`}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        images: current.images.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    ×
                  </button>
                  <input
                    aria-label={`第 ${index + 1} 张图片说明`}
                    placeholder="图片说明（可选）"
                    value={image.alt}
                    maxLength={500}
                    disabled={disabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        images: current.images.map((photo, i) =>
                          i === index
                            ? { ...photo, alt: event.target.value }
                            : photo
                        ),
                      }))
                    }
                  />
                </figure>
              ))}
            </div>
          )}
          <div className="local-note-tools">
            <label
              className="button local-note-file"
              aria-disabled={disabled || form.images.length >= 9}
            >
              上传图片
              <input
                type="file"
                aria-label="上传碎碎念图片"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                disabled={disabled || form.images.length >= 9}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (files.length) void addFiles(files);
                }}
              />
            </label>
            <button
              className="button"
              disabled={disabled || form.images.length >= 9}
              onClick={() => setPicker(true)}
            >
              从媒体库选择
            </button>
            <span>
              {uploading
                ? "图片上传中…"
                : '可直接粘贴或拖入图片'}
            </span>
          </div>
          <div className="local-note-footer">
            <label>
              发布时间
              <input
                type="datetime-local"
                aria-label="碎碎念发布时间"
                value={localTime(form.publishedAt)}
                disabled={busy || !!recover}
                onChange={(event) => {
                  if (event.target.value)
                    setForm((current) => ({
                      ...current,
                      publishedAt: new Date(event.target.value).toISOString(),
                    }));
                }}
              />
            </label>
            <div className="button-row">
              <button
                className="button"
                disabled={disabled}
                onClick={() => void closeEditor()}
              >
                收起
              </button>
              <button
                className="button"
                disabled={
                  disabled || (!form.text.trim() && !form.images.length)
                }
                onClick={() => void saveDraft().catch(() => {})}
              >
                保存草稿
              </button>
              {editing?.status === 'published' && <button className="button" disabled={disabled} onClick={() => void save('draft')}>撤回发布</button>}
              <button
                className="button primary"
                disabled={
                  disabled || (!form.text.trim() && !form.images.length)
                }
                onClick={() => void save("published")}
              >
                {busy
                  ? "正在保存…"
                  : editing?.status === "published"
                  ? "更新发布"
                  : "发布碎碎念"}
              </button>
            </div>
          </div>
        </section>
      )}
      <div
        className="local-note-filters"
        role="group"
        aria-label="筛选本站碎碎念"
      >
        {[
          ["", "全部"],
          ["published", "已发布"],
          ["draft", "草稿箱"],
          ["trash", "回收站"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`button ${filter === value ? "active" : ""}`}
            disabled={busy}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
        <span>共 {data?.total ?? 0} 条</span>
      </div>
      {loading ? (
        <div className="loading" role="status">
          正在整理碎碎念…
        </div>
      ) : (
        <div className="local-note-list">
          {data?.items.length === 0 ? (
            <div className="empty-state">
              <h2>这里还没有碎碎念</h2>
              <p>写下第一条，或切换分类查看。</p>
            </div>
          ) : (
            data?.items.map((row) => (
              <article className="local-note-row" key={row.id}>
                <div className="local-note-row-heading">
                  <time>{dateLabel(row.publishedAt)}</time>
                  <span className="badge-outline">
                    {row.status === "published"
                      ? "已发布"
                      : row.status === "trash"
                      ? "回收站"
                      : "草稿"}
                  </span>
                  {row.historical && <span className="badge-outline">历史随记</span>}
                  {row.hasDraft && row.status === 'published' && <span className="badge-outline">有未发布修改</span>}
                  <div className="local-note-row-actions">
                    {row.status === 'trash' ? <button className="button small" disabled={disabled} onClick={() => void change(row, 'restore')}>恢复为草稿</button> : <>
                      <button className="button small" disabled={disabled} onClick={() => void open(row)}>编辑</button>
                      <button className="button small danger" disabled={disabled} onClick={() => setPendingDelete(row)}>删除</button>
                    </>}
                  </div>
                </div>
                <p className="local-note-excerpt">{row.text || (row.images.length ? "一组照片" : "空白草稿")}</p>
                {!!row.images.length && (
                  <div className="local-note-thumbs">
                    {row.images.slice(0, 9).map((image, index) => (
                      <img
                        src={image.url}
                        alt={image.alt || `配图 ${index + 1}`}
                        loading="lazy"
                        key={`${image.url}-${index}`}
                      />
                    ))}
                  </div>
                )}
                <div className="button-row">
                  {row.status === "published" && (
                    <a
                      className="button"
                      href={`/moments/posts/${row.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看前台
                    </a>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      )}
      {!!data && data.pages > 1 && (
        <nav className="local-note-pagination" aria-label="本站碎碎念分页">
          <button
            className="button"
            disabled={page <= 1 || busy}
            onClick={() => setPage((value) => value - 1)}
          >
            上一页
          </button>
          <span>
            {page} / {data.pages}
          </span>
          <button
            className="button"
            disabled={page >= data.pages || busy}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </nav>
      )}
      {pendingDelete && <div className="modal-backdrop"><div className="modal moment-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="moment-delete-title">
        <h2 id="moment-delete-title">删除这条碎碎念？</h2><p>内容和草稿会移入回收站，可以恢复。</p><div className="button-row"><button className="button" disabled={busy} onClick={() => setPendingDelete(null)}>取消</button><button className="button danger" disabled={busy} onClick={() => void change(pendingDelete, 'trash')}>确认删除</button></div>
      </div></div>}
      {picker && (
        <div className="modal-backdrop">
          <div
            className="modal local-note-picker"
            role="dialog"
            aria-modal="true"
            aria-label="选择碎碎念配图"
          >
            <div className="modal-heading">
              <h2>选择图片</h2>
              <button className="text-button" onClick={() => setPicker(false)}>
                关闭
              </button>
            </div>
            {mediaPicker(pick)}
          </div>
        </div>
      )}
    </>
  );
}
