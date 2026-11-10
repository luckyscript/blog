import React, { useEffect, useRef, useState } from "react";
import { clipboardImages } from "../../lib/admin/editor-media";

type Photo = { url: string; alt: string };
type Record = {
  id: string;
  version: string;
  status: string;
  editable: boolean;
  text: string;
  images: Photo[];
  publishedAt: string;
};
const blank = () => ({
  text: "",
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
  const disabled = busy || uploading;
  function open(row: Record | null) {
    setEditing(row);
    setForm(
      row
        ? { text: row.text, images: row.images, publishedAt: row.publishedAt }
        : blank()
    );
    setNotice(null);
  }
  async function addFiles(files: File[]) {
    if (uploadLock.current || busy) return;
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
  async function save(status: "draft" | "published") {
    if (disabled || uploadLock.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const input = { ...formRef.current, status };
      await request(editing ? `moments/local/${editing.id}` : "moments/local", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editing ? { input, version: editing.version } : input
        ),
      });
      setEditing(undefined);
      setForm(blank());
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
          <textarea
            aria-label="碎碎念正文"
            placeholder="有什么想说的？也可以直接粘贴图片。"
            maxLength={20000}
            value={form.text}
            disabled={busy}
            onChange={(event) =>
              setForm((current) => ({ ...current, text: event.target.value }))
            }
            onPaste={(event) => {
              const files = clipboardImages(event.clipboardData);
              if (files.length) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
          />
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
                : `${form.text.length} 字 · ${form.images.length} / 9 张图片`}
            </span>
          </div>
          <div className="local-note-footer">
            <label>
              发布时间
              <input
                type="datetime-local"
                aria-label="碎碎念发布时间"
                value={localTime(form.publishedAt)}
                disabled={busy}
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
                onClick={() => setEditing(undefined)}
              >
                取消
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
