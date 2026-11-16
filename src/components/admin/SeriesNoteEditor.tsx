import React, { useEffect, useRef, useState } from "react";
import UlyssesEditor, { type UlyssesEditorHandle } from "./UlyssesEditor";
import type {
  SeriesNoteRecord,
  SeriesNoteInput,
} from "../../lib/server/series-notes";
import type { SeriesDetail } from "../../lib/server/series";
import { mediaMarkdown } from "../../lib/admin/editor-media";
import { writingWords } from "../../lib/admin/writing";
import "../../styles/admin-series.css";
type Props = {
  noteId: string;
  request: (path: string, options?: RequestInit) => Promise<any>;
  upload: (file: File, alt: string) => Promise<any>;
};
export default function SeriesNoteEditor({ noteId, request, upload }: Props) {
  const [record, setRecord] = useState<SeriesNoteRecord | null>(null),
    [input, setInput] = useState<SeriesNoteInput | null>(null),
    [series, setSeries] = useState<SeriesDetail | null>(null),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("write"),
    [html, setHtml] = useState(""),
    [recover, setRecover] = useState<SeriesNoteInput | null>(null),
    [uploading, setUploading] = useState(0);
  const editor = useRef<UlyssesEditorHandle>(null),
    file = useRef<HTMLInputElement>(null),
    valueRef = useRef(input),
    recordRef = useRef(record),
    last = useRef(""),
    flight = useRef<Promise<SeriesNoteRecord | null> | null>(null),
    saveRef = useRef<(keepalive?: boolean) => Promise<SeriesNoteRecord | null>>(
      async () => null
    ),
    busyRef = useRef(false),
    key = "inkrain-series-note-" + noteId;
  valueRef.current = input;
  recordRef.current = record;
  busyRef.current = busy || !!recover || uploading > 0;
  const dirty = !!input && JSON.stringify(input) !== last.current;
  function apply(r: SeriesNoteRecord, replace = false) {
    recordRef.current = r;
    setRecord(r);
    if (replace) {
      valueRef.current = r.input;
      setInput(r.input);
      last.current = JSON.stringify(r.input);
    }
  }
  function backup() {
    if (!valueRef.current || !recordRef.current) return;
    try {
      if (JSON.stringify(valueRef.current) === last.current)
        localStorage.removeItem(key);
      else
        localStorage.setItem(
          key,
          JSON.stringify({
            input: valueRef.current,
            baseVersion: recordRef.current.version,
          })
        );
    } catch {
      setMessage("浏览器本机备份不可用，请保持网络连接并确认云端保存成功。");
    }
  }
  useEffect(() => {
    let alive = true;
    request("series/notes/" + noteId)
      .then(async (r) => {
        if (!alive) return;
        apply(r, true);
        try {
          const local = JSON.parse(localStorage.getItem(key) || "null");
          if (
            local?.input &&
            JSON.stringify(local.input) !== JSON.stringify(r.input)
          )
            setRecover(local.input);
        } catch {}
        setSeries(await request("series/" + r.seriesId));
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [noteId, request]);
  async function save(keepalive = false): Promise<SeriesNoteRecord | null> {
    if (flight.current) return flight.current;
    if (
      !valueRef.current ||
      !recordRef.current ||
      busyRef.current ||
      recordRef.current.status === "trash"
    )
      return recordRef.current;
    if (JSON.stringify(valueRef.current) === last.current)
      return recordRef.current;
    const sent = structuredClone(valueRef.current),
      version = recordRef.current.version;
    backup();
    setSaving(true);
    const pending = request("series/notes/" + noteId, {
      method: "PUT",
      body: JSON.stringify({ input: sent, version }),
      keepalive,
    })
      .then((r) => {
        apply(r);
        last.current = JSON.stringify(sent);
        setError("");
        setMessage("已保存到系列草稿");
        backup();
        return r;
      })
      .catch((e) => {
        setError(e.message);
        return null;
      })
      .finally(() => {
        flight.current = null;
        setSaving(false);
      });
    flight.current = pending;
    return pending;
  }
  saveRef.current = save;
  useEffect(() => {
    if (!input || recover) return;
    backup();
    if (!dirty || error || busy || uploading || saving) return;
    const t = setTimeout(() => void saveRef.current(), 1200);
    return () => clearTimeout(t);
  }, [input, recover, dirty, error, busy, uploading, saving, record?.version]);
  useEffect(() => {
    const hide = () => {
      backup();
      void saveRef.current(true);
    };
    const leave = (e: BeforeUnloadEvent) => {
      backup();
      if (
        flight.current ||
        (valueRef.current && JSON.stringify(valueRef.current) !== last.current)
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("pagehide", hide);
    addEventListener("beforeunload", leave);
    return () => {
      removeEventListener("pagehide", hide);
      removeEventListener("beforeunload", leave);
    };
  }, []);
  useEffect(() => {
    if (tab !== "preview" || !input) return;
    const c = new AbortController(),
      t = setTimeout(
        () =>
          request("series/notes/" + noteId + "/preview", {
            method: "POST",
            body: JSON.stringify({ markdown: input.markdown }),
            signal: c.signal,
          })
            .then((r) => setHtml(r.html))
            .catch((e) => {
              if (!c.signal.aborted) setError(e.message);
            }),
        250
      );
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [tab, input?.markdown]);
  const field = (name: keyof SeriesNoteInput, value: string) =>
    setInput((i) => (i ? { ...i, [name]: value } : i));
  async function action(type: string, revisionId?: string) {
    setError("");
    const saved = await save();
    if (!saved) return;
    if (valueRef.current && JSON.stringify(valueRef.current) !== last.current) {
      setError("请等待当前草稿保存完成，再操作。");
      return;
    }
    setBusy(true);
    try {
      const r = await request("series/notes/" + noteId + "/" + type, {
        method: "POST",
        body: JSON.stringify({ version: saved.version, revisionId }),
      });
      apply(r, true);
      localStorage.removeItem(key);
      setMessage(type === "publish" ? "篇目已发布" : "操作已保存");
      setSeries(await request("series/" + r.seriesId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function images(files: File[]) {
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const image = await upload(f, "");
        editor.current?.insert(mediaMarkdown(image));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }
  if (!input || !record)
    return (
      <div role={error ? "alert" : "status"}>
        {error || "正在打开系列篇目…"}
      </div>
    );
  const locked = busy || !!recover || record.status === "trash";
  return (
    <div className="series-note-studio">
      <header className="series-note-toolbar">
        <div>
          <a href={"/admin/series/" + record.seriesId}>
            ← {record.seriesTitle} · 系列工作台
          </a>
          <p>
            {record.status === "published"
              ? "已发布"
              : record.status === "trash"
              ? "回收站"
              : "系列草稿"}{" "}
            ·{" "}
            {saving
              ? "正在同步…"
              : dirty
              ? "有未保存修改"
              : message || "已同步"}
          </p>
        </div>
        <div>
          <button
            className="button"
            disabled={busy || saving || !!recover || record.status === "trash"}
            onClick={() => void save()}
          >
            保存草稿
          </button>
          {record.status === "trash" ? (
            <button
              className="button primary"
              onClick={() => void action("restore")}
            >
              恢复篇目
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy || saving || !!recover || uploading > 0}
              onClick={() => void action("publish")}
            >
              {record.status === "published" ? "发布更新" : "发布篇目"}
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void save()}>
            重试保存
          </button>
        </div>
      )}
      {recover && (
        <div className="notice" role="alert">
          发现本机尚未同步的系列草稿。
          <button
            className="button"
            onClick={() => {
              setInput(recover);
              valueRef.current = recover;
              setRecover(null);
              setError("");
            }}
          >
            恢复本机内容
          </button>
          <button
            className="button"
            onClick={() => {
              setRecover(null);
              localStorage.removeItem(key);
            }}
          >
            使用云端内容
          </button>
        </div>
      )}
      <div className="series-studio-layout">
        <aside className="series-studio-directory">
          <h2>{record.seriesTitle}</h2>
          <a href={"/admin/series/" + record.seriesId}>管理系列与篇目</a>
          <ol>
            {series?.entries.map((n) => (
              <li key={n.id}>
                <a
                  aria-current={n.id === noteId ? "page" : undefined}
                  href={"/admin/series/notes/" + n.id}
                >
                  {n.title || "未命名手记"}
                  <small>
                    {n.status === "published"
                      ? "已发布"
                      : n.status === "trash"
                      ? "回收站"
                      : "草稿"}
                  </small>
                </a>
              </li>
            ))}
          </ol>
        </aside>
        <main className="series-studio-writing">
          <input
            className="series-note-title"
            aria-label="系列篇目标题"
            value={input.title}
            maxLength={255}
            placeholder="为这一则手记起个名字"
            disabled={locked}
            onChange={(e) => field("title", e.target.value)}
          />
          <div className="series-writing-tools">
            <button
              aria-pressed={tab === "write"}
              onClick={() => setTab("write")}
            >
              写作
            </button>
            <button
              aria-pressed={tab === "preview"}
              onClick={() => setTab("preview")}
            >
              阅读预览
            </button>
            <button disabled={locked} onClick={() => file.current?.click()}>
              插入图片 / 附件
            </button>
            <span>{writingWords(input.markdown)} 字</span>
          </div>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void images(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          {tab === "write" ? (
            <UlyssesEditor
              ref={editor}
              value={input.markdown}
              onChange={(v) => field("markdown", v)}
              onImages={(files) => void images(files)}
              onSave={() => void save()}
              onSelection={() => {}}
              paragraphFocus={false}
              typewriter={false}
              readOnly={locked}
              ariaLabel="系列篇目正文"
            />
          ) : (
            <div
              className="series-note-preview prose"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </main>
        <aside className="series-studio-settings">
          <h2>篇目信息</h2>
          <label>
            独立网址
            <input
              disabled={locked}
              value={input.slug}
              maxLength={180}
              onChange={(e) => field("slug", e.target.value)}
            />
            <small>
              /series/{record.seriesSlug}/{input.slug}
            </small>
          </label>
          <label>
            记录日期
            <input
              disabled={locked}
              type="datetime-local"
              value={new Date(
                new Date(input.publishedAt).getTime() -
                  new Date(input.publishedAt).getTimezoneOffset() * 60000
              )
                .toISOString()
                .slice(0, 16)}
              onChange={(e) => {
                if (e.target.value)
                  field("publishedAt", new Date(e.target.value).toISOString());
              }}
            />
          </label>
          <label>
            场景 / 行程
            <input
              disabled={locked}
              value={input.context}
              maxLength={200}
              onChange={(e) => field("context", e.target.value)}
            />
          </label>
          <label>
            摘要
            <textarea
              disabled={locked}
              value={input.description}
              rows={4}
              maxLength={2000}
              onChange={(e) => field("description", e.target.value)}
            />
          </label>
          {record.status === "published" && (
            <>
              <a href={record.path} target="_blank" rel="noreferrer">
                查看已发布篇目
              </a>
              <button
                className="button"
                disabled={busy}
                onClick={() => void action("unpublish")}
              >
                撤回为草稿
              </button>
            </>
          )}
          {record.status !== "trash" && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void action("trash")}
            >
              移入系列回收站
            </button>
          )}
          {record.revisions.length > 0 && (
            <details>
              <summary>历史版本 · {record.revisions.length}</summary>
              {record.revisions.map((h) => (
                <button
                  className="series-revision"
                  key={h.id}
                  disabled={busy}
                  onClick={() => void action("revision", h.id)}
                >
                  恢复为草稿 · {new Date(h.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {h.action}
                </button>
              ))}
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
