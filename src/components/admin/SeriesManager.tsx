import React, { useEffect, useState } from "react";
import type {
  SeriesDetail,
  SeriesInput,
  SeriesSummary,
} from "../../lib/server/series";
import "../../styles/admin-series.css";
type Requester = (path: string, options?: RequestInit) => Promise<any>;
const empty: SeriesInput = {
  title: "",
  slug: "",
  description: "",
  status: "published",
  state: "ongoing",
};
const inputOf = (record: SeriesSummary): SeriesInput => ({
  title: record.title,
  slug: record.slug,
  description: record.description,
  status: record.status,
  state: record.state,
});
const day = (date: string) =>
  new Date(date).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
export default function SeriesManager({
  request,
  initialId,
}: {
  request: Requester;
  initialId?: string;
}) {
  const [items, setItems] = useState<SeriesSummary[]>([]),
    [detail, setDetail] = useState<SeriesDetail | null>(null),
    [form, setForm] = useState<SeriesInput | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const dirty =
    !!form &&
    (!detail || JSON.stringify(form) !== JSON.stringify(inputOf(detail)));
  const reload = async () => setItems(await request("series"));
  const open = async (id: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const record = await request("series/" + id);
      setDetail(record);
      setForm(inputOf(record));
      history.replaceState(null, "", "/admin/series/" + id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void reload().catch((error) => setError(error.message));
    if (initialId) void open(initialId);
  }, [initialId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leave = () =>
    !dirty || window.confirm("系列设置尚未保存，确定离开吗？");
  const create = () => {
    if (!leave()) return;
    setDetail(null);
    setForm({ ...empty });
    setNotice("");
    setError("");
    history.replaceState(null, "", "/admin/series");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const record = await request(detail ? "series/" + detail.id : "series", {
        method: detail ? "PUT" : "POST",
        body: JSON.stringify(
          detail ? { input: form, version: detail.version } : form
        ),
      });
      setDetail(record);
      setForm(inputOf(record));
      setNotice("系列设置已保存");
      history.replaceState(null, "", "/admin/series/" + record.id);
      await reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const write = async (id: string) => {
    if (dirty) {
      setError("请先保存系列设置，再写新篇。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const record = await request("series/" + id + "/entries", {
        method: "POST",
        body: "{}",
      });
      location.assign("/admin/series/notes/" + record.id);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="series-manager">
      <header className="page-heading">
        <div>
          <p className="eyebrow">SERIES & NOTES</p>
          <h1>系列手记</h1>
          <p className="muted">每篇独立书写，目录随发布自动整理。</p>
        </div>
        <button className="button primary" onClick={create} disabled={busy}>
          新建系列
        </button>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {form ? (
        <>
          <div className="series-manager-back">
            <button
              className="text-button"
              onClick={() => {
                if (!leave()) return;
                setForm(null);
                setDetail(null);
                setError("");
                setNotice("");
                history.replaceState(null, "", "/admin/series");
              }}
            >
              ← 全部系列
            </button>
            {detail && (
              <div>
                <a
                  className="button"
                  href={detail.path}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看前台
                </a>
                <button
                  className="button primary"
                  onClick={() => void write(detail.id)}
                  disabled={busy || dirty}
                >
                  写新篇
                </button>
              </div>
            )}
          </div>
          <form className="panel series-editor" onSubmit={save}>
            <div className="series-editor-fields">
              <label>
                系列名称
                <input
                  value={form.title}
                  maxLength={160}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                独立网址
                <input
                  value={form.slug}
                  maxLength={120}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={(event) =>
                    setForm({ ...form, slug: event.target.value })
                  }
                  required
                />
                <small className="field-hint">
                  /series/{form.slug || "series-name"}
                </small>
              </label>
              <label className="series-description-field">
                系列简介
                <textarea
                  value={form.description}
                  rows={4}
                  maxLength={2000}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </label>
              <label>
                入口可见性
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      status: event.target.value as SeriesInput["status"],
                    })
                  }
                >
                  <option value="published">公开</option>
                  <option value="draft">草稿</option>
                </select>
              </label>
              <label>
                更新状态
                <select
                  value={form.state}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      state: event.target.value as SeriesInput["state"],
                    })
                  }
                >
                  <option value="ongoing">持续更新</option>
                  <option value="completed">已完结</option>
                </select>
              </label>
            </div>
            <div className="series-editor-save">
              <p className="muted">
                篇目按发布时间自动排序。修改系列设置不会替你发布、撤回或删除篇目。
              </p>
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? "正在保存…" : detail ? "保存系列设置" : "创建系列"}
              </button>
            </div>
          </form>
          {detail && (
            <section className="panel series-entry-manager">
              <header>
                <h2>篇目</h2>
                <span className="muted">
                  {detail.publishedCount} 则已发布 · {detail.draftCount} 则草稿
                  / 待更新
                </span>
              </header>
              {detail.entries.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>标题</th>
                        <th>状态</th>
                        <th>日期</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>
                            <a href={"/admin/series/notes/" + entry.id}>
                              {entry.title || "未命名手记"}
                            </a>
                            {entry.context && <small>{entry.context}</small>}
                          </td>
                          <td>
                            {entry.status === "published"
                              ? "已发布"
                              : entry.status === "trash"
                              ? "回收站"
                              : "草稿"}
                            {entry.hasDraft && entry.status === "published"
                              ? " · 待更新"
                              : ""}
                          </td>
                          <td>{day(entry.publishedAt)}</td>
                          <td>
                            <a href={"/admin/series/notes/" + entry.id}>编辑</a>
                            {entry.status === "published" && (
                              <a
                                href={entry.path}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">还没有篇目。点“写新篇”开始第一则手记。</p>
              )}
            </section>
          )}
        </>
      ) : (
        <div className="series-admin-list">
          {items.map((item) => (
            <section className="panel" key={item.id}>
              <div className="series-admin-item">
                <div>
                  <h2>{item.title}</h2>
                  <p>{item.description || "尚未填写简介"}</p>
                  <small>
                    {item.publishedCount} 则已发布 · {item.draftCount} 则草稿 /
                    待更新 · {item.status === "published" ? "公开" : "草稿"} ·{" "}
                    {item.state === "completed" ? "已完结" : "持续更新"}
                  </small>
                </div>
                <div>
                  <button
                    className="button"
                    onClick={() => {
                      if (leave()) void open(item.id);
                    }}
                    disabled={busy}
                  >
                    管理系列
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void write(item.id)}
                    disabled={busy}
                  >
                    写新篇
                  </button>
                </div>
              </div>
            </section>
          ))}
          {!items.length && !busy && (
            <section className="panel">
              <p className="muted">
                还没有系列。创建一个主题后，就可以持续添加独立篇目。
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
