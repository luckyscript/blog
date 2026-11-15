import React, { useEffect, useRef, useState } from "react";
import MomentWritingSurface from "./MomentWritingSurface";
import { decodeMomentDraft, encodeMomentDraft, type MomentForm } from "../../lib/admin/moment-writing";

type Photo = { url: string; alt: string };
type Record = {
  id: string;
  version: string;
  status: string;
  editable: boolean;
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
  const [writerSession, setWriterSession] = useState(0);
  const [localSaved, setLocalSaved] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const draftKey = () => `inkrain-moment-unsaved-${editingRef.current?.id || 'new'}`;
  const persistLocal = () => {
    if (editingRef.current === undefined || recoverRef.current) return false;
    try {
      if (JSON.stringify(formRef.current) === baseline.current) {
        localStorage.removeItem(draftKey()); setLocalSaved(false);
      } else {
        localStorage.setItem(draftKey(), encodeMomentDraft(formRef.current, editingRef.current?.version || null)); setLocalSaved(true);
      }
      setStorageFailed(false);
      return true;
    } catch { setStorageFailed(true); setLocalSaved(false); return false; }
  };
  const persistRef = useRef(persistLocal);
  persistRef.current = persistLocal;
  useEffect(() => { persistLocal(); }, [form, editing]);
  useEffect(() => {
    const preserve = () => persistRef.current();
    const warn = (event: BeforeUnloadEvent) => {
      preserve();
      if (editingRef.current !== undefined && !recoverRef.current && JSON.stringify(formRef.current) !== baseline.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('pagehide', preserve);
    window.addEventListener('beforeunload', warn);
    return () => { preserve(); window.removeEventListener('pagehide', preserve); window.removeEventListener('beforeunload', warn); };
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
  function open(row: Record | null) {
    persistLocal();
    const next = row ? { text: row.text, images: row.images, publishedAt: row.publishedAt, format: row.format || 'plain' as const } : blank();
    editingRef.current = row;
    formRef.current = next;
    baseline.current = JSON.stringify(next);
    setEditing(row);
    setWriterSession(value => value + 1);
    setForm(next);
    setLocalSaved(false);
    let recovery = null;
    try {
      const pending = decodeMomentDraft(localStorage.getItem(draftKey()));
      if (pending && JSON.stringify(pending.input) !== baseline.current) recovery = pending;
    } catch {}
    recoverRef.current = recovery;
    setRecover(recovery);
    setNotice(null);
    requestAnimationFrame(() => document.querySelector('.local-note-composer')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
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
  async function save(status: "draft" | "published", close = true) {
    if (disabled || saveLock.current || uploadLock.current || recoverRef.current) return;
    if (!close && editingRef.current?.status === 'published') {
      const saved = persistLocal();
      setNotice(saved ? { text: '修改已保存在本机，点击「更新发布」后才会更新前台。' } : { text: '本机草稿保存失败，请复制文字备份。', error: true });
      return;
    }
    saveLock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const snapshot = formRef.current;
      const input = { ...snapshot, status };
      const previous = editingRef.current;
      const saved = await request(previous ? `moments/local/${previous.id}` : "moments/local", {
        method: previous ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          previous ? { input, version: previous.version } : input
        ),
      });
      if (close) {
        try { localStorage.removeItem(draftKey()); } catch {}
        editingRef.current = undefined;
        setEditing(undefined);
        setForm(blank());
      } else {
        const oldKey = draftKey();
        editingRef.current = saved;
        setEditing(saved);
        baseline.current = JSON.stringify(snapshot);
        if (JSON.stringify(formRef.current) === baseline.current) {
          setLocalSaved(false);
          try { localStorage.removeItem(oldKey); localStorage.removeItem(draftKey()); } catch {}
        } else {
          try {
            localStorage.setItem(draftKey(), encodeMomentDraft(formRef.current, saved.version));
            if (oldKey !== draftKey()) localStorage.removeItem(oldKey);
            setLocalSaved(true);
          } catch { setStorageFailed(true); }
        }
      }
      setFilter(status);
      setPage(1);
      setReload((value) => value + 1);
      setNotice({
        text:
          status === "published"
            ? "已发布，碎碎念时间线和「本站」分类已更新。"
            : "已保存为草稿，前台不会展示。",
      });
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  async function change(row: Record, action: "trash" | "restore") {
    setBusy(true);
    setNotice(null);
    try {
      await request(`moments/local/${row.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: row.version }),
      });
      setReload((value) => value + 1);
      setNotice({
        text:
          action === "trash"
            ? "已移入回收站，可以随时恢复。"
            : "已恢复为草稿，重新发布后前台可见。",
      });
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SMALL NOTES, EVERYDAY LIFE</span>
          <h1>本站碎碎念</h1>
          <p>记下此刻的想法，给日常留一张小笺。</p>
        </div>
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => open(null)}
        >
          写一条碎碎念
        </button>
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
            <span>文字与图片 · 最多 9 张</span>
          </div>
          {storageFailed && <div className="notice error" role="alert">本机草稿存储不可用，请及时保存草稿或复制文字备份。</div>}
          {recover && <div className="notice recovery">
            {recover.baseVersion && recover.baseVersion !== editing?.version ? '服务器已有较新内容，请核对后恢复本机草稿。' : '发现上次未保存的碎碎念。'}
            <button onClick={() => { formRef.current = recover.input; setForm(recover.input); recoverRef.current = null; setRecover(null); }}>恢复本地内容</button>
            <button onClick={() => { try { localStorage.removeItem(draftKey()); } catch {} recoverRef.current = null; setRecover(null); }}>忽略</button>
          </div>}
          <MomentWritingSurface key={writerSession} value={form} onChange={value => { formRef.current = value; setForm(value); }} onImages={files => void addFiles(files)} onSave={() => save('draft', false)} readOnly={busy || !!recover} request={request} />
          <p className="moment-local-state" role="status">{recover ? '选择恢复或忽略后继续写作' : localSaved ? '修改已保存在本机；保存草稿或发布后同步到服务器。' : '输入自动保存在本机，⌘ / Ctrl + S 保存草稿。'}</p>
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
                onClick={() => { persistLocal(); editingRef.current = undefined; setEditing(undefined); setRecover(null); recoverRef.current = null; }}
              >
                收起
              </button>
              <button
                className="button"
                disabled={
                  disabled || (!form.text.trim() && !form.images.length)
                }
                onClick={() => void save("draft")}
              >
                {editing?.status === "published" ? "撤回为草稿" : "保存草稿"}
              </button>
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
          ["draft", "草稿"],
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
                  {!row.editable && (
                    <span className="badge-outline">历史随记</span>
                  )}
                </div>
                <p>{row.text || "一组照片"}</p>
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
                  {row.editable &&
                    (row.status === "trash" ? (
                      <button
                        className="button"
                        disabled={disabled}
                        onClick={() => void change(row, "restore")}
                      >
                        恢复为草稿
                      </button>
                    ) : (
                      <>
                        <button
                          className="button"
                          disabled={disabled}
                          onClick={() => open(row)}
                        >
                          编辑
                        </button>
                        <button
                          className="text-button"
                          disabled={disabled}
                          onClick={() => void change(row, "trash")}
                        >
                          移入回收站
                        </button>
                      </>
                    ))}
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
