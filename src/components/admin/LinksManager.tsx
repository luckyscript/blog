import React, { useEffect, useState } from "react";
import { healthDisplay,type LinkHealth } from '../../lib/link-health';
import '../../styles/link-health.css';
type Link = {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  status: string;
  sortOrder: number;
  visits: number;
  version: number;
  health?:LinkHealth|null;
};
const blank = () => ({
  name: "",
  url: "",
  description: "",
  category: "友情链接",
  sortOrder: 0,
});
export default function LinksManager({
  request,
}: {
  request: (path: string, options?: RequestInit) => Promise<any>;
}) {
  const [items, setItems] = useState<Link[] | null>(null),
    [filter, setFilter] = useState(""),
    [q, setQ] = useState("");
  const [editing, setEditing] = useState<Link | null | undefined>(undefined),
    [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(
      null
    );
  const load = () =>
    request("links")
      .then(setItems)
      .catch((error) => setNotice({ text: error.message, error: true }));
  useEffect(() => {
    void load();
  }, []);
  function open(row: Link | null) {
    setEditing(row);
    setForm(
      row
        ? {
            name: row.name,
            url: row.url,
            description: row.description,
            category: row.category,
            sortOrder: row.sortOrder,
          }
        : blank()
    );
    setNotice(null);
  }
  async function save(status: "draft" | "published") {
    setBusy(true);
    setNotice(null);
    try {
      const input = { ...form, status };
      await request(editing ? `links/${editing.id}` : "links", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          editing ? { input, version: editing.version } : input
        ),
      });
      setEditing(undefined);
      setFilter(status);
      await load();
      setNotice({
        text:
          status === "published"
            ? "链接已发布，本站跳转地址已生效。"
            : "已保存为草稿，前台不会展示。",
      });
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  async function change(row: Link, action: "trash" | "restore") {
    setBusy(true);
    setNotice(null);
    try {
      await request(`links/${row.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: row.version }),
      });
      await load();
      setNotice({
        text:
          action === "trash"
            ? "已移入回收站，跳转地址已停用。"
            : "已恢复为草稿，重新发布后跳转地址生效。",
      });
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  const visible = items?.filter(
    (item) =>
      (filter ? item.status === filter : item.status !== "trash") &&
      `${item.name} ${item.category} ${item.url}`
        .toLowerCase()
        .includes(q.toLowerCase())
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PLACES WORTH RETURNING TO</span>
          <h1>链接收藏</h1>
          <p>整理常去的网站，留住值得重读的文字。</p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => open(null)}
        >
          添加链接
        </button>
      </div>
      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className={`notice ${notice.error ? "error" : ""}`}
        >
          {notice.text}
        </div>
      )}
      {editing !== undefined && (
        <section className="local-note-composer" aria-label="编辑收藏链接">
          <div className="local-note-heading">
            <h2>{editing ? "编辑链接" : "新的书签"}</h2>
            <span>前台只展示已发布的链接</span>
          </div>
          <div className="link-editor-fields">
            <label>
              链接名称
              <input
                aria-label="链接名称"
                value={form.name}
                maxLength={160}
                disabled={busy}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              目标网址
              <input
                aria-label="目标网址"
                type="url"
                placeholder="https://"
                value={form.url}
                maxLength={2000}
                disabled={busy}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
            <label>
              分类
              <input
                aria-label="链接分类"
                list="link-categories"
                value={form.category}
                maxLength={100}
                disabled={busy}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
              <datalist id="link-categories">
                {[...new Set(items?.map((item) => item.category))].map(
                  (category) => (
                    <option key={category} value={category} />
                  )
                )}
              </datalist>
            </label>
            <label>
              排列顺序
              <input
                aria-label="链接排列顺序"
                type="number"
                min={-10000}
                max={10000}
                value={form.sortOrder}
                disabled={busy}
                onChange={(e) =>
                  setForm({ ...form, sortOrder: Number(e.target.value) })
                }
              />
            </label>
            <label className="link-description-field">
              简短介绍
              <textarea
                aria-label="链接介绍"
                rows={3}
                maxLength={500}
                value={form.description}
                disabled={busy}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
          </div>
          {editing && (
            <p className="link-stable-address">
              本站地址：<code>/link/to/{editing.id}</code>
            </p>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              取消
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void save("draft")}
            >
              {editing?.status === "published" ? "撤回为草稿" : "保存草稿"}
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !form.name.trim() ||
                !form.url.trim() ||
                !form.category.trim()
              }
              onClick={() => void save("published")}
            >
              {busy
                ? "正在保存…"
                : editing?.status === "published"
                ? "更新发布"
                : "发布链接"}
            </button>
          </div>
        </section>
      )}
      <div
        className="local-note-filters"
        role="group"
        aria-label="筛选收藏链接"
      >
        {[
          ["", "全部"],
          ["published", "已发布"],
          ["draft", "草稿"],
          ["trash", "回收站"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            className={`button ${filter === value ? "active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <input
          className="link-admin-search"
          aria-label="搜索后台链接"
          placeholder="搜索名称、分类或网址"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {items === null ? (
        <div className="loading" role="status">
          正在整理书签…
        </div>
      ) : (
        <div className="local-note-list">
          {visible?.length === 0 && (
            <div className="empty-state">
              <h2>这里还没有链接</h2>
              <p>添加一个常去的网站吧。</p>
            </div>
          )}
          {visible?.map((row) => (
            <article className="local-note-row" key={row.id}>
              <div className="local-note-row-heading">
                <span className="badge-outline">{row.category}</span>
                <span className="badge-outline">
                  {row.status === "published"
                    ? "已发布"
                    : row.status === "trash"
                    ? "回收站"
                    : "草稿"}
                </span>
                <span className="muted">{row.visits} 次到访</span>
              </div>
              <h2 className="link-admin-name">{row.name}</h2>
              <p className="link-admin-url">{row.url}</p>
              <div className="link-health-meta"><span className="link-health" data-tone={healthDisplay(row.health).tone} title={healthDisplay(row.health).title}>{healthDisplay(row.health).label}</span>{row.health&&<time dateTime={healthDisplay(row.health).checkedAt}>{healthDisplay(row.health).checkedLabel}</time>}</div>
              {row.description && <p>{row.description}</p>}
              <div className="button-row">
                {row.status === "published" && (
                  <a
                    className="button"
                    href={`/link/to/${row.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看跳转
                  </a>
                )}
                {row.status === "trash" ? (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void change(row, "restore")}
                  >
                    恢复为草稿
                  </button>
                ) : (
                  <>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => open(row)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void change(row, "trash")}
                    >
                      移入回收站
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
