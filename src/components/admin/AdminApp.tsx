import React, { useEffect, useRef, useState } from "react";
import { sectionLabels, type PostInput } from "../../lib/server/content-input";
import { platformLabels } from '../../lib/moments/types';
import Turnstile, { type TurnstileSettings } from "./Turnstile";
import { mediaMarkdown, stripPendingImages } from '../../lib/admin/editor-media';
import LocalMoments from './LocalMoments';
import LinksManager from './LinksManager';
import PhotographyStudio from './PhotographyStudio';
import SeriesManager from './SeriesManager';
import SeriesNoteEditor from './SeriesNoteEditor';
import AnalyticsDashboard from './AnalyticsDashboard';
import WritingPreferences, { useWritingPreferences } from './WritingPreferences';
import UlyssesEditor, { type UlyssesEditorHandle, type WritingPosition } from './UlyssesEditor';
import { decodeDraft, encodeDraft, writingWords } from '../../lib/admin/writing';

type User = { id: string; email: string };
type Notice = { text: string; error?: boolean } | null;
type Post = {
  id: string;
  path: string;
  status: string;
  version: number;
  input: PostInput;
  hasDraft: boolean;
  revisions: { id: string; action: string; createdAt: string }[];
};

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: "same-origin",
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "content-type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "auth/login")
      window.location.assign("/admin/login");
    const error = new Error(
      data.error ??
        (data.errors?.length
          ? `导入预检发现 ${data.errors.length} 个错误`
          : "操作未完成")
    ) as Error & { details?: unknown; status?: number };
    error.details = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
const send = (path: string, value: unknown, method = "POST") =>
  api(path, { method, body: JSON.stringify(value) });
const formatDate = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const statusLabel = (status: string) =>
  ({ published: "已发布", draft: "草稿", trash: "回收站" }[status] ?? status);
function Message({ notice }: { notice: Notice }) {
  return notice ? (
    <div
      role={notice.error ? "alert" : "status"}
      className={`notice ${notice.error ? "error" : ""}`}
    >
      {notice.text}
    </div>
  ) : null;
}
function Spinner() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在整理书桌…
    </div>
  );
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    series: <><path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4zM13 7a3 3 0 0 1 3-3h5v14h-5a3 3 0 0 0-3 3" /></>,
    analytics: <><path d="M4 20V4M4 20h17M8 16v-4M13 16V8M18 16V5" /></>,
    moments: <><path d="M4 4h16v12H9l-5 4z" /><path d="M8 8h8M8 12h5" /></>,
    links: <><path d="m9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" /></>,
    posts: (
      <>
        <path d="M5 3h10l4 4v14H5z" />
        <path d="M14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    media: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8" cy="9" r="1.5" />
        <path d="m3 18 6-6 4 4 3-3 5 5" />
      </>
    ),
    taxonomy: (
      <>
        <path d="M3 4h8l10 10-7 7L3 10z" />
        <circle cx="7.5" cy="8" r="1" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.posts}
    </svg>
  );
}

export default function AdminApp({
  route,
  user,
  configured = true,
  turnstile = { siteKey: "", configured: false, testing: false },
}: {
  route: string;
  user?: User;
  configured?: boolean;
  turnstile?: TurnstileSettings;
}) {
  if (route === "login")
    return <Login configured={configured} turnstile={turnstile} />;
  const view = route.startsWith("posts/") ? "editor" : route.startsWith("series/notes/") ? "series-note" : route.startsWith("series/") ? "series" : route || "posts";
  const links = [
    ["", "posts", "文章"],
    ["series", "series", "系列手记"],
    ["analytics", "analytics", "访问分析"],
    ["moments", "moments", "碎碎念"],
    ['links','links','链接'],
    ['photography','media','摄影'],
    ["media", "media", "媒体库"],
    ["taxonomy", "taxonomy", "分类与标签"],
    ["settings", "settings", "设置与迁移"],
  ];
  return (
    <div className={`admin-shell ${view === "editor" ? "writing-workspace" : ""}`}>
      <aside className="sidebar">
        <a href="/admin" className="brand">
          <span className="brand-seal">雨</span>
          <span>
            雨间书房<small>INKRAIN · STUDIO</small>
          </span>
        </a>
        <div className="sidebar-label">内容工作台</div>
        <nav aria-label="后台导航">
          {links.map(([path, key, label]) => (
            <a
              key={path}
              href={`/admin${path ? `/${path}` : ""}`}
              className={
                (view === "series-note" ? "series" : view) === (path || key) || (key === "posts" && view === "editor")
                  ? "active"
                  : ""
              }
            >
              <Icon name={key} />
              {label}
              <span className="nav-dot" />
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="connection">
            <i />
            MySQL 内容管理
          </span>
          <a href="/" target="_blank" rel="noreferrer">
            打开博客 <Icon name="arrow" />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            下雨就像弹钢琴 <span className="topbar-divider">/</span>{" "}
            {view === "editor"
              ? "写作"
              : links.find((item) => (item[0] || item[1]) === (view === "series-note" ? "series" : view))?.[2]}
          </span>
          <div className="account">
            <span className="avatar">
              {user?.email[0]?.toUpperCase() ?? "A"}
            </span>
            <span>{user?.email}</span>
            <button
              className="text-button"
              onClick={async () => {
                await send("auth/logout", {});
                window.location.assign("/admin/login");
              }}
            >
              退出
            </button>
          </div>
        </header>
        <main
          className={`admin-main ${view === "editor" ? "editor-main" : ""}`}
        >
          {view === "posts" && <Posts />}
          {view === "series-note" && <SeriesNoteEditor noteId={route.split("/")[2]} request={api} upload={uploadPreparedMedia} />}
          {view === "series" && <SeriesManager request={api} initialId={route.split("/")[1]} />}
          {view === "analytics" && <AnalyticsDashboard request={api} />}
          {view === "editor" && (
            <Editor
              postId={route === "posts/new" ? null : route.split("/")[1]}
            />
          )}
          {view === "media" && <MediaLibrary />}
          {view === 'moments' && <LocalMoments request={api} upload={uploadPreparedMedia} mediaPicker={onSelect=><MediaLibrary picker onSelect={onSelect} />} />}
          {view === 'links' && <LinksManager request={api} />}
          {view === 'photography' && <PhotographyStudio />}
          {view === "taxonomy" && <Taxonomy />}
          {view === "settings" && <Settings />}
        </main>
        <footer className="admin-footer">
          <span>把日子写下来，让文字慢慢生长。</span>
          <span>INKRAIN / CONTENT STUDIO</span>
        </footer>
      </div>
    </div>
  );
}

function Login({
  configured,
  turnstile,
}: {
  configured: boolean;
  turnstile: TurnstileSettings;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="login-page">
      <div className="login-story">
        <a className="login-site" href="/">
          下雨就像弹钢琴 <Icon name="arrow" />
        </a>
        <div className="login-poem">
          <span className="eyebrow">A QUIET PLACE TO WRITE</span>
          <h1>
            落笔，
            <br />
            听雨。
          </h1>
          <p>
            收集生活里的微光，
            <br />
            写下一些值得留下的事。
          </p>
          <div className="rain-lines" />
        </div>
        <span className="login-copyright">INKRAIN · PERSONAL JOURNAL</span>
      </div>
      <div className="login-panel">
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !configured || !turnstile.configured || !turnstileToken)
              return;
            setBusy(true);
            setNotice(null);
            const data = new FormData(event.currentTarget);
            try {
              await send("auth/login", {
                email: data.get("email"),
                password: data.get("password"),
                turnstileToken,
              });
              window.location.assign("/admin");
            } catch (error: any) {
              setNotice({ text: error.message, error: true });
              setTurnstileToken("");
              setResetKey((value) => value + 1);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="brand-seal">雨</span>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>回到书房</h2>
          <p className="muted">登录后，继续你的下一篇故事。</p>
          <Message notice={notice} />
          {!configured && (
            <div className="notice">
              请先复制 env.example 为 .env，配置 MySQL，然后执行 npm run
              db:setup。
            </div>
          )}
          {!turnstile.configured && (
            <div className="notice error" role="alert">
              {turnstile.hostnameMismatch ? (
                <>
                  当前访问地址未绑定登录验证，请通过博客域名登录。
                  {turnstile.loginUrl && (
                    <a href={turnstile.loginUrl}>前往域名后台</a>
                  )}
                </>
              ) : (
                "登录验证尚未配置，请联系管理员。"
              )}
            </div>
          )}
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="你的管理员邮箱"
              required
              disabled={!configured}
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="管理员密码"
              required
              disabled={!configured}
              maxLength={128}
            />
          </label>
          {turnstile.configured && (
            <Turnstile
              siteKey={turnstile.siteKey}
              resetKey={resetKey}
              onToken={setTurnstileToken}
            />
          )}
          {turnstile.testing && (
            <p className="verification-test-note">当前为本地验证测试模式。</p>
          )}
          <button
            className="button primary login-submit"
            disabled={
              busy || !configured || !turnstile.configured || !turnstileToken
            }
          >
            {busy ? "正在登录…" : "进入书房"}
            <Icon name="arrow" />
          </button>
          <p className="login-note">
            Cloudflare Turnstile 为本次登录提供安全验证。
          </p>
        </form>
      </div>
    </div>
  );
}

function Posts() {
  const [data, setData] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<Notice>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api(
        `posts?${new URLSearchParams({
          q: query,
          section,
          status,
          page: String(page),
        })}`,
        { signal: controller.signal }
      )
        .then((value) => {
          setData(value);
          setNotice(null);
        })
        .catch((error) => {
          if (error.name !== "AbortError")
            setNotice({ text: error.message, error: true });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, section, status, page, refresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORDS, YOUR WORLD</span>
          <h1>文章</h1>
          <p>生活、思考和偶然的灵感，都在这里。</p>
        </div>
        <a className="button primary" href="/admin/posts/new">
          <Icon name="plus" />
          写一篇文章
        </a>
      </div>
      <Message notice={notice} />
      {notice?.error && (
        <button
          className="button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          重新加载
        </button>
      )}
      <div className="stat-grid">
        {[
          ["全部文章", data?.counts.all, "01", "all"],
          ["已发布", data?.counts.published, "02", "published"],
          ["草稿箱", data?.counts.draft, "03", "draft"],
        ].map(([label, count, number, key]) => (
          <button
            key={String(key)}
            className={`stat-card stat-${key}`}
            onClick={() => {
              setStatus(key === "all" ? "" : String(key));
              setPage(1);
            }}
          >
            <span>
              {label}
              <small>{number}</small>
            </span>
            <strong>{count ?? "—"}</strong>
            <span className="stat-caption">
              {key === "published"
                ? "已经分享的故事"
                : key === "draft"
                ? "等待落笔的想法"
                : "写下的每一次认真"}
            </span>
          </button>
        ))}
      </div>
      <section className="panel posts-panel">
        <div className="list-toolbar">
          <div className="tabs">
            {[
              ["", "全部"],
              ["published", "已发布"],
              ["draft", "草稿"],
              ["trash", "回收站"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={status === key ? "selected" : ""}
                onClick={() => {
                  setStatus(key);
                  setPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="list-filters">
            <input
              aria-label="搜索文章"
              placeholder="搜索文章标题…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="筛选栏目"
              value={section}
              onChange={(event) => {
                setSection(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部栏目</option>
              {Object.entries(sectionLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <div className="empty-state">
            <Icon name="posts" />
            <h3>{query ? "没有找到对应文章" : "给这个书房写下第一句话"}</h3>
            <p>
              {query
                ? "试试其他标题或栏目。"
                : "你可以开始写作，或先导入已有的 Markdown。"}
            </p>
            <a className="button" href={query ? "/admin" : "/admin/settings"}>
              {query ? "查看全部" : "导入已有内容"}
            </a>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="posts-table">
                <thead>
                  <tr>
                    <th>文章标题</th>
                    <th>栏目</th>
                    <th>状态</th>
                    <th>最近编辑</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((post: any) => (
                    <tr key={post.id}>
                      <td>
                        <a
                          className="post-name"
                          href={`/admin/posts/${post.id}`}
                        >
                          {post.title}
                        </a>
                        <small className="post-path">{post.path}</small>
                      </td>
                      <td>
                        <span className="section-badge">
                          {sectionLabels[post.section]}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${post.status}`}>
                          {statusLabel(post.status)}
                        </span>
                        {post.hasDraft && post.status === "published" && (
                          <small className="draft-marker">有未发布修改</small>
                        )}
                      </td>
                      <td className="date-cell">
                        {formatDate(post.updatedAt)}
                      </td>
                      <td>
                        <a
                          className="row-edit"
                          href={`/admin/posts/${post.id}`}
                          aria-label={`编辑 ${post.title}`}
                        >
                          <Icon name="arrow" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>共 {data.total} 篇文章</span>
              <div>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  上一页
                </button>
                <span>
                  {page} / {data.pages}
                </span>
                <button
                  disabled={page >= data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="under-note">每一篇草稿，都有成为故事的可能。</p>
    </>
  );
}

function TagsField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState(tags.join(", "));
  const split = (value: string) =>
    value
      .split(/[,，]/)
      .map((part) => part.trim())
      .filter(Boolean);
  useEffect(() => {
    if (JSON.stringify(split(text)) !== JSON.stringify(tags))
      setText(tags.join(", "));
  }, [tags]);
  return (
    <input
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(split(event.target.value));
      }}
      placeholder="旅行, 生活"
    />
  );
}

function blankPost(): PostInput {
  const now = new Date();
  return {
    title: "",
    section: "blog",
    year: String(now.getFullYear()),
    slug: `post-${Date.now()}`,
    markdown: "",
    description: "",
    category: "",
    tags: [],
    publishedAt: now.toISOString(),
    contentUpdatedAt: null,
    externalUrl: "",
    coverUrl: "",
    canonicalUrl: "",
    featured: false,
    metadata: {},
  };
}

function Editor({ postId }: { postId: string | null }) {
  const [input, setInput] = useState<PostInput>(blankPost);
  const inputRef = useRef(input);
  inputRef.current = input;
  const [record, setRecord] = useState<Post | null>(null);
  const recordRef = useRef<Post | null>(null);
  const [loaded, setLoaded] = useState(!postId);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [savedAt, setSavedAt] = useState("");
  const [tab, setTab] = useState("edit");
  const [properties, setProperties] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [writingSettings, setWritingSettings] = useWritingPreferences();
  const { paragraphFocus, typewriter, font, fontSize, dark } = writingSettings;
  const [selected, setSelected] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const recoverRef = useRef<PostInput | null>(null);
  const words = writingWords(input.markdown);
  const [html, setHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [terms, setTerms] = useState<any>({ categories: [], tags: [] });
  const [picker, setPicker] = useState(false);
  const [recover, setRecover] = useState<PostInput | null>(null);
  const [recoveryStale, setRecoveryStale] = useState(false);
  const [revision, setRevision] = useState<any>(null);
  const lastSaved = useRef(JSON.stringify(input));
  const savingPromise = useRef<Promise<Post | null> | null>(null);
  const writer = useRef<UlyssesEditorHandle>(null);
  const [imageUploads, setImageUploads] = useState(0);
  const imageUploadCount = useRef(0);
  const pendingImageMarkers = useRef(new Set<string>());
  const uploadSequence = useRef(0);
  const editorActive = useRef(true);
  useEffect(() => { editorActive.current = true; return () => { editorActive.current = false; }; }, []);
  const dirty = JSON.stringify(input) !== lastSaved.current;
  const storageKey = () =>
    `inkrain-unsaved-${recordRef.current?.id ?? postId ?? "new"}`;
  const applyRecord = (value: Post) => {
    recordRef.current = value;
    setRecord(value);
  };
  const persistLocal = () => {
    if (!loaded || recoverRef.current || recordRef.current?.status === 'trash') return;
    const value = inputRef.current;
    if (JSON.stringify(value) === lastSaved.current) {
      try { localStorage.removeItem(storageKey()); } catch {}
      setLocalSaved(false);
      return;
    }
    try {
      localStorage.setItem(storageKey(), encodeDraft({ ...value, markdown: stripPendingImages(value.markdown, pendingImageMarkers.current) }, recordRef.current?.version ?? null));
      setStorageFailed(false);
      setLocalSaved(true);
    } catch { setStorageFailed(true); setLocalSaved(false); }
  };
  const persistRef = useRef(persistLocal);
  persistRef.current = persistLocal;
  useEffect(() => {
    api("taxonomy").then(setTerms).catch(() => {});
    const checkRecovery = (serverInput: PostInput | null) => {
      try {
        const pending = decodeDraft(localStorage.getItem(storageKey()));
        if (pending && JSON.stringify(pending.input) !== JSON.stringify(serverInput)) {
          recoverRef.current = pending.input;
          setRecover(pending.input);
          setRecoveryStale(pending.baseVersion !== null && pending.baseVersion !== recordRef.current?.version);
        }
      } catch {}
    };
    if (postId) api(`posts/${postId}`).then(value => {
      applyRecord(value);
      lastSaved.current = JSON.stringify(value.input);
      inputRef.current = value.input;
      setInput(value.input);
      checkRecovery(value.input);
      setLoaded(true);
    }).catch(error => setNotice({ text: error.message, error: true }));
    else checkRecovery(null);
  }, []);
  useEffect(() => {
    if (!loaded || recover) return;
    persistLocal();
    if (!dirty || !input.title.trim() || notice?.error || busy || imageUploads || record?.status === "trash") return;
    const timer = setTimeout(() => {
      save().catch(error => setNotice({ text: error.message, error: true }));
    }, 1800);
    return () => clearTimeout(timer);
  }, [input, loaded, busy, imageUploads, recover]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      persistRef.current();
      if (JSON.stringify(inputRef.current) !== lastSaved.current && (inputRef.current.title || inputRef.current.markdown)) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    const preserve = () => {
      persistRef.current();
      const position = writer.current?.position();
      if (position) try { localStorage.setItem(`${storageKey()}-position`, JSON.stringify(position)); } catch {}
    };
    const visibility = () => { if (document.visibilityState === 'hidden') preserve(); };
    const online = () => {
      if (!busyRef.current && !recoverRef.current && inputRef.current.title.trim() && JSON.stringify(inputRef.current) !== lastSaved.current)
        save().then(() => setNotice(null)).catch(error => setNotice({ text: error.message, error: true }));
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setImmersive(false); setProperties(false); } };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', preserve);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', escape);
    return () => {
      preserve();
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', preserve);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  const restorePosition = () => {
    try {
      const position = JSON.parse(localStorage.getItem(`${storageKey()}-position`) || 'null');
      if (position && [position.anchor, position.head, position.scrollTop].every(Number.isFinite)) writer.current?.restore(position as WritingPosition);
    } catch {}
  };
  useEffect(() => { if (loaded && !recover) { const frame = requestAnimationFrame(restorePosition); return () => cancelAnimationFrame(frame); } }, [loaded, recover]);
  useEffect(() => {
    if (tab === 'edit') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("preview", {
        method: "POST",
        body: JSON.stringify({ markdown: input.markdown }),
        signal: controller.signal,
      })
        .then((value) => {
          setHtml(value.html);
          setPreviewError("");
        })
        .catch((error) => {
          if (error.name !== "AbortError") setPreviewError(error.message);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input.markdown, tab]);
  async function save(): Promise<Post | null> {
    if (recoverRef.current) throw new Error('请先恢复或忽略上次的本地内容');
    if (imageUploadCount.current) throw new Error('图片正在上传，请稍后保存或发布');
    while (savingPromise.current) {
      await savingPromise.current;
    }
    if (imageUploadCount.current) throw new Error('图片正在上传，请稍后保存或发布');
    const snapshot = inputRef.current;
    if (!snapshot.title.trim()) throw new Error("请先填写文章标题");
    if (JSON.stringify(snapshot) === lastSaved.current && recordRef.current)
      return recordRef.current;
    setSaving(true);
    const current = recordRef.current;
    const request = (async () => {
      const value = await (current
        ? send(
            `posts/${current.id}`,
            { input: snapshot, version: current.version },
            "PUT"
          )
        : send("posts", snapshot));
      applyRecord(value);
      lastSaved.current = JSON.stringify(snapshot);
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      if (!current) {
        // A draft can gain its server ID while more text is still being typed.
        // Move that newer local snapshot before retiring the original recovery key.
        let moved = false;
        try {
          localStorage.setItem(storageKey(), encodeDraft({ ...inputRef.current, markdown: stripPendingImages(inputRef.current.markdown, pendingImageMarkers.current) }, value.version));
          moved = true;
        } catch { setStorageFailed(true); }
        history.replaceState(null, "", `/admin/posts/${value.id}`);
        if (moved || JSON.stringify(inputRef.current) === JSON.stringify(snapshot)) {
          try { localStorage.removeItem("inkrain-unsaved-new"); } catch {}
        }
      }
      if (JSON.stringify(inputRef.current) === JSON.stringify(snapshot)) {
        try { localStorage.removeItem(storageKey()); } catch {}
        setLocalSaved(false);
      } else persistRef.current();
      return value;
    })();
    savingPromise.current = request;
    try {
      return await request;
    } finally {
      savingPromise.current = null;
      setSaving(false);
    }
  }
  const field = <K extends keyof PostInput>(key: K, value: PostInput[K]) => {
    inputRef.current = { ...inputRef.current, [key]: value };
    setInput(inputRef.current);
  };
  const saveManually = () => {
    if (busyRef.current || recordRef.current?.status === 'trash') return;
    setNotice(null);
    save().then(() => setNotice({ text: '草稿已保存。' })).catch(error => setNotice({ text: error.message, error: true }));
  };
  async function action(kind: string) {
    setBusy(true);
    setNotice(null);
    try {
      const row = kind === "restore" ? recordRef.current : await save();
      if (!row) return;
      const value = await send(`posts/${row.id}/${kind}`, {
        version: row.version,
      });
      applyRecord(value);
      lastSaved.current = JSON.stringify(value.input);
      setInput(value.input);
      setNotice({
        text: (
          {
            publish: "文章已发布，前台已更新。",
            unpublish: "文章已撤回为草稿。",
            trash: "文章已移入回收站，正文、草稿和历史版本均已保留。",
            restore: "已恢复为草稿。",
          } as any
        )[kind],
      });
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  function insertMedia(item: any) {
    writer.current?.insert(`\n${mediaMarkdown(item)}\n`);
    setPicker(false);
  }
  function uploadImages(files: File[]) {
    if (busy || recordRef.current?.status === 'trash' || recoverRef.current) return;
    const entries = files.map(file => ({ file, placeholder: `\n[图片上传中（${++uploadSequence.current}）…]\n` }));
    entries.forEach(entry => pendingImageMarkers.current.add(entry.placeholder));
    writer.current?.insert(entries.map(entry => entry.placeholder).join(''));
    imageUploadCount.current += entries.length;
    setImageUploads(count => count + entries.length);
    setNotice({ text: `正在上传 ${entries.length} 张图片…` });
    void (async () => {
      let failed = false;
      let inserted = 0;
      for (const entry of entries) {
        try {
          const item = await uploadPreparedMedia(entry.file, '');
          if (!editorActive.current) return;
          if (writer.current?.replacePlaceholder(entry.placeholder, `\n${mediaMarkdown(item)}\n`)) inserted++;
        } catch (error: any) {
          failed = true;
          if (editorActive.current) {
            writer.current?.replacePlaceholder(entry.placeholder, '');
            setNotice({ text: `图片上传失败：${error.message}。可以重新粘贴重试。`, error: true });
          }
        } finally {
          pendingImageMarkers.current.delete(entry.placeholder);
          imageUploadCount.current = Math.max(0, imageUploadCount.current - 1);
          if (editorActive.current) setImageUploads(count => Math.max(0, count - 1));
        }
      }
      if (!failed && editorActive.current) setNotice({ text: inserted === entries.length ? '图片已上传并插入正文。' : '图片已上传，可在媒体库重新插入。' });
    })();
  }
  if (!loaded)
    return (
      <>
        <Message notice={notice} />
        {!notice?.error && <Spinner />}
        <a href="/admin">返回文章列表</a>
      </>
    );
  return (
    <div className={`writer-studio ${immersive ? 'writer-immersive' : ''} ${dark ? 'writer-dark' : ''} writer-font-${font}`} style={{ '--writer-size': `${fontSize}px` } as React.CSSProperties}>
      <div className="editor-heading">
        <div>
          <a className="back-link" href="/admin">
            ← 全部文章
          </a>
          <h1>{record ? statusLabel(record.status) : "新文稿"}</h1>
        </div>
        <div className="editor-actions">
          <span className="save-state" role="status" aria-live="polite">
            {saving
              ? "正在保存…"
              : recover
              ? "等待恢复本地内容"
              : dirty
              ? (localSaved ? "修改已保存在本机" : "有未保存修改")
              : savedAt
              ? `${savedAt} 已保存`
              : "修改自动保存为草稿"}
          </span>
          <button
            className="button"
            disabled={busy || saving || imageUploads > 0 || !!recover || record?.status === "trash"}
            onClick={saveManually}
          >
            保存草稿
          </button>
          <button
            className="button primary"
            disabled={busy || saving || imageUploads > 0 || !!recover || record?.status === "trash"}
            aria-expanded={properties}
            aria-controls="writer-properties"
            onClick={() => { setProperties(value => !value); setImmersive(false); }}
          >
            发布设置
            <Icon name="arrow" />
          </button>
        </div>
      </div>
      <Message notice={notice} />
      {storageFailed && <div className="notice error" role="alert">本机草稿存储不可用，请及时保存到服务器或复制正文备份。</div>}
      {recover && (
        <div className="notice recovery">
          {recoveryStale ? '服务器已有较新版本。恢复本机内容会替换当前草稿，请先核对。' : '发现上次未保存的编辑，选择恢复后继续写作。'}
          <button
            onClick={() => {
              inputRef.current = recover;
              setInput(recover);
              recoverRef.current = null;
              setRecover(null);
            }}
          >
            恢复本地内容
          </button>
          <button
            onClick={() => {
              try { localStorage.removeItem(storageKey()); } catch {}
              recoverRef.current = null;
              setRecover(null);
            }}
          >
            忽略
          </button>
        </div>
      )}
      {record?.status === "trash" && (
        <div className="notice">
          文章在回收站中，公开页面不可见，正文、草稿和历史版本均保留。
          <button className="text-button" onClick={() => action("restore")}>
            恢复为草稿
          </button>
        </div>
      )}
      <fieldset
        className="editor-fieldset"
        disabled={busy || !!recover || record?.status === "trash"}
      >
        <div className={`editor-grid ${properties ? 'writer-with-properties' : ''}`}>
          <section className="panel writing-panel">
            <input
              className="title-input"
              aria-label="文章标题"
              value={input.title}
              maxLength={255}
              onChange={(event) => field("title", event.target.value)}
              placeholder="给故事起个名字…"
            />
            <div className="writing-toolbar">
              <div className="tabs" aria-label="写作视图">
                {[["edit", "写作"], ["preview", "阅读预览"]].map(([key, label]) => (
                  <button key={key} aria-pressed={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>
                ))}
              </div>
              <div className="writer-tools">
                <button className="text-button" onClick={() => setPicker(true)} aria-label="插入图片或附件"><Icon name="media" /></button>
                <WritingPreferences settings={writingSettings} onChange={setWritingSettings} />
                <button className="text-button" aria-pressed={immersive} onClick={() => { setImmersive(value => !value); setProperties(false); }}>{immersive ? '退出专注' : '专注'}</button>
              </div>
            </div>
            <div className={`writing-body mode-${tab}`}>
              <div className="writer-pane" hidden={tab === 'preview'}>
                <UlyssesEditor ref={writer} value={input.markdown} onChange={value => field('markdown', value)} onImages={uploadImages} onSave={saveManually} onSelection={setSelected} paragraphFocus={paragraphFocus} typewriter={typewriter} readOnly={busy || !!recover || record?.status === 'trash'} />
                {selected && <div className="writer-formatbar" role="toolbar" aria-label="文字格式" onMouseDown={event => event.preventDefault()}>
                  <button onClick={() => writer.current?.format('**', '**')} aria-label="加粗">B</button>
                  <button onClick={() => writer.current?.format('*', '*')} aria-label="斜体"><i>I</i></button>
                  <button onClick={() => writer.current?.format('[', '](https://)')} aria-label="插入链接">链接</button>
                  <button onClick={() => writer.current?.format('`', '`')} aria-label="行内代码">代码</button>
                </div>}
              </div>
              {tab !== "edit" && (
                <div className="markdown-preview">
                  <span className="preview-label">阅读预览</span>
                  {previewError ? (
                    <div role="alert" className="notice error">
                      {previewError}
                    </div>
                  ) : (
                    <iframe
                      title="Markdown 实时预览"
                      sandbox=""
                      srcDoc={`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font:16px/1.95 system-ui;color:#343b38;margin:8px 20px 40px;overflow-wrap:anywhere}h1,h2,h3{font-family:serif;line-height:1.5}img{max-width:100%;height:auto}pre{padding:18px;background:#f2f1ed;overflow:auto;font-size:13px}code{font-family:monospace}blockquote{border-left:3px solid #b5876a;margin:20px 0;padding-left:16px;color:#777}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:6px}a{color:#98664e}</style></head><body>${
                        html ||
                        '<p style="color:#aaa">文字会在这里慢慢显现。</p>'
                      }</body></html>`}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="writing-footer">
              <span>
                {imageUploads ? `${imageUploads} 张图片上传中…` : `${words.toLocaleString()} 字 · 约 ${Math.max(1, Math.ceil(words / 400))} 分钟阅读`}
              </span>
              {record && (
                <a
                  href={`/admin/preview/${record.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  完整预览已保存草稿
                </a>
              )}
            </div>
          </section>
          <aside className="editor-properties" id="writer-properties" hidden={!properties}>
            <section className="panel property-panel writer-publish-panel">
              <div className="writer-inspector-heading"><h2>发布与文章信息</h2><button className="text-button" onClick={() => setProperties(false)} aria-label="关闭发布设置">关闭</button></div>
              <p className="muted">{record?.status === 'published' ? '草稿修改在发布更新后才会公开。' : '准备好了，再把文字分享出去。'}</p>
              <button className="button primary" disabled={busy || saving || imageUploads > 0 || !!recover || record?.status === 'trash'} onClick={() => action('publish')}>{busy ? '正在发布…' : record?.status === 'published' ? '发布更新' : '发布文章'}</button>
            </section>
            <section className="panel property-panel">
              <h2>文章设置</h2>
              <label>
                栏目
                <select
                  value={input.section}
                  onChange={(event) =>
                    field("section", event.target.value as PostInput["section"])
                  }
                >
                  {Object.entries(sectionLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  路径年份
                  <input
                    value={input.year}
                    onChange={(event) => field("year", event.target.value)}
                    pattern="[0-9]{4}"
                    maxLength={4}
                  />
                </label>
                <label>
                  发布时间
                  <input
                    type="datetime-local"
                    value={localDate(input.publishedAt)}
                    onChange={(event) => {
                      if (event.target.value)
                        field(
                          "publishedAt",
                          new Date(event.target.value).toISOString()
                        );
                    }}
                  />
                </label>
              </div>
              <label>
                路径名称
                <input
                  value={input.slug}
                  maxLength={180}
                  onChange={(event) => field("slug", event.target.value)}
                />
              </label>
              <small className="field-hint">
                修改路径后，原文章地址会自动跳转。
              </small>
              <label>
                分类
                <input
                  list="category-options"
                  value={input.category}
                  onChange={(event) => field("category", event.target.value)}
                  placeholder="选择或创建分类"
                  maxLength={100}
                />
                <datalist id="category-options">
                  {terms.categories.map((item: any) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              </label>
              <label>
                标签<span className="field-hint">用逗号分隔</span>
                <TagsField
                  tags={input.tags}
                  onChange={(value) => field("tags", value)}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={input.featured}
                  onChange={(event) => field("featured", event.target.checked)}
                />
                精选文章
              </label>
            </section>
            <section className="panel property-panel">
              <h2>摘要与分享</h2>
              <label>
                摘要
                <textarea
                  value={input.description}
                  onChange={(event) => field("description", event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="用几句话介绍这篇文章…"
                />
              </label>
              <label>
                封面地址
                <input
                  value={input.coverUrl}
                  onChange={(event) => field("coverUrl", event.target.value)}
                  placeholder="https://… 或 /images/…"
                />
              </label>
              <label>
                外链地址
                <input
                  type="url"
                  value={input.externalUrl}
                  onChange={(event) => field("externalUrl", event.target.value)}
                  placeholder="外链文章填写"
                />
              </label>
              <label>
                Canonical 地址
                <input
                  type="url"
                  value={input.canonicalUrl}
                  onChange={(event) =>
                    field("canonicalUrl", event.target.value)
                  }
                  placeholder="原创来源地址（可选）"
                />
              </label>
            </section>
          </aside>
        </div>
      </fieldset>
      {record && properties && (
        <section className="panel history-panel">
          <div>
            <h2>版本与管理</h2>
            <p className="muted">
              恢复历史版本会生成草稿，再次发布后才会更新前台。
            </p>
          </div>
          <div className="history-tools">
            <a
              className="button small"
              href={`/api/admin/posts/${record.id}/export`}
            >
              导出 Markdown
            </a>
            {record.status === "published" && (
              <>
                <a
                  className="button small"
                  href={record.path}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看公开页面
                </a>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => action("unpublish")}
                >
                  撤回为草稿
                </button>
              </>
            )}
            {record.status !== "trash" && (
              <button
                className="button small danger"
                disabled={busy}
                onClick={() => action("trash")}
              >
                移入回收站
              </button>
            )}
          </div>
          <div className="revision-list">
            {record.revisions.length === 0 ? (
              <p className="muted">首次发布后会留下版本记录。</p>
            ) : (
              record.revisions.map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    api(`posts/${record.id}/revisions/${item.id}`)
                      .then(setRevision)
                      .catch((error) =>
                        setNotice({ text: error.message, error: true })
                      )
                  }
                >
                  <span>
                    {
                      (
                        {
                          publish: "发布版本",
                          import: "导入版本",
                          unpublish: "撤回",
                          trash: "移入回收站",
                          restore: "恢复文章",
                        } as any
                      )[item.action]
                    }
                  </span>
                  <time>{formatDate(item.createdAt)}</time>
                  <span>查看 →</span>
                </button>
              ))
            )}
          </div>
        </section>
      )}
      {picker && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-heading">
              <h2>选择图片或附件</h2>
              <button className="button small" onClick={() => setPicker(false)}>
                关闭
              </button>
            </div>
            <MediaLibrary picker onSelect={insertMedia} />
          </div>
        </div>
      )}
      {revision && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-heading">
              <h2>{revision.content.title}</h2>
              <button
                className="button small"
                onClick={() => setRevision(null)}
              >
                关闭
              </button>
            </div>
            <p className="muted">{formatDate(revision.createdAt)} · 历史快照</p>
            <pre className="revision-source">{revision.content.markdown}</pre>
            <button
              className="button primary"
              disabled={busy || record?.status === "trash"}
              onClick={async () => {
                setBusy(true);
                try {
                  const current = await save();
                  const value = await send(`posts/${current!.id}/revisions`, {
                    revisionId: revision.id,
                    version: current!.version,
                  });
                  applyRecord(value);
                  lastSaved.current = JSON.stringify(value.input);
                  setInput(value.input);
                  setRevision(null);
                  setNotice({ text: "历史版本已恢复到草稿，发布后才会生效。" });
                } catch (error: any) {
                  setNotice({ text: error.message, error: true });
                } finally {
                  setBusy(false);
                }
              }}
            >
              恢复到草稿
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

async function prepareFile(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return file;
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张图片，请重新选择图片'); });
  const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88)
  );
  if (!blob) throw new Error("图片处理失败，请换一张图片");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
    type: "image/webp",
  });
}

async function uploadPreparedMedia(file: File, alt: string) {
  const processed = await prepareFile(file);
  if (!processed.size || processed.size > 8 * 1024 * 1024) throw new Error('处理后的文件应在 8 MB 以内');
  const form = new FormData(); form.set('file', processed); form.set('alt', alt);
  const item = await api('media', { method: 'POST', body: form });
  if (item.status !== 'ready' || !item.url) throw new Error('图片上传尚未完成');
  return item;
}

function MediaLibrary({
  picker = false,
  onSelect,
}: {
  picker?: boolean;
  onSelect?: (item: any) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [alt, setAlt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const load = () =>
    api("media")
      .then(setData)
      .catch((error) => setNotice({ text: error.message, error: true }));
  useEffect(() => {
    load();
  }, []);
  const items =
    data?.items.filter(
      (item: any) =>
        item.status === "ready" &&
        `${item.name} ${item.alt}`.toLowerCase().includes(search.toLowerCase())
    ) ?? [];
  const storage = data?.storage || { configured: data?.github.configured, label: 'GitHub 图床' };
  return (
    <>
      {!picker && (
        <div className="page-heading">
          <div>
            <span className="eyebrow">A COLLECTION OF MOMENTS</span>
            <h1>媒体库</h1>
            <p>给文字配上画面，留下看得见的记忆。</p>
          </div>
          <span className="badge-outline">{storage.label || '图片存储'}</span>
        </div>
      )}
      <Message notice={notice} />
      {data && !storage.configured && (
        <div className="notice">
          图片上传暂不可用，已有图片仍可使用。请联系站点管理员检查图床连接。
        </div>
      )}
      <form
        className="panel upload-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file) return;
          setBusy(true);
          setNotice(null);
          try {
            const item = await uploadPreparedMedia(file, alt);
            setNotice({ text: `文件已上传到${storage.label || '图床'}。` });
            setAlt("");
            setFile(null);
            await load();
            if (onSelect) onSelect(item);
          } catch (error: any) {
            setNotice({ text: error.message, error: true });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="upload-description">
          <Icon name="media" />
          <div>
            <strong>上传公开展示文件</strong>
            <p>
              照片自动生成最长边 2560px 的 WebP 展示图。支持
              GIF、PDF，单文件最大 8 MB。
            </p>
          </div>
        </div>
        <div className="upload-controls">
          <input
            aria-label="选择上传文件"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            disabled={busy || !storage.configured}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <input
            aria-label="文件说明"
            placeholder="图片替代文字 / 文件说明"
            value={alt}
            maxLength={500}
            onChange={(event) => setAlt(event.target.value)}
          />
          <button
            className="button primary"
            disabled={busy || !file || !storage.configured}
          >
            {busy ? "正在上传…" : "上传到图床"}
          </button>
        </div>
      </form>
      <div className="media-toolbar">
        <span>{items.length} 份文件</span>
        <input
          aria-label="搜索媒体"
          placeholder="搜索文件名或说明…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {!data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="panel empty-state">
          <Icon name="media" />
          <h3>画面将在这里收藏</h3>
          <p>上传新文件，或在设置中导入现有文章和图片引用。</p>
        </div>
      ) : (
        <div className="media-grid">
          {items.map((item: any) => (
            <article className="panel media-card" key={item.id}>
              <a
                className="media-thumb"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.mime.startsWith("image/") ? (
                  <img
                    src={item.url}
                    alt={item.alt || item.name}
                    loading="lazy"
                  />
                ) : (
                  <span className="file-placeholder">PDF</span>
                )}
              </a>
              <div className="media-card-body">
                <strong title={item.name}>{item.name}</strong>
                <small>
                  {item.size
                    ? `${Math.round(item.size / 1024)} KB`
                    : "现有图片引用"}{" "}
                  · {item.mime.split("/")[1].toUpperCase()}
                </small>
                <p>{item.alt || "尚未填写说明"}</p>
                <div className="media-card-actions">
                  {onSelect ? (
                    <button
                      className="text-button"
                      onClick={() => onSelect(item)}
                    >
                      插入正文 →
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(item.url)
                          .then(() => setNotice({ text: "图片地址已复制。" }))
                          .catch(() =>
                            setNotice({ text: `图片地址：${item.url}` })
                          )
                      }
                    >
                      复制地址
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => setEdit({ ...item })}
                  >
                    编辑说明
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <div className="modal-backdrop">
          <form
            className="modal small-modal"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await send(`media/${edit.id}`, { alt: edit.alt }, "PATCH");
                setEdit(null);
                await load();
              } catch (error: any) {
                setNotice({ text: error.message, error: true });
              }
            }}
          >
            <h2>文件说明</h2>
            <label>
              替代文字
              <input
                value={edit.alt}
                onChange={(event) =>
                  setEdit({ ...edit, alt: event.target.value })
                }
                maxLength={500}
              />
            </label>
            <div className="button-row">
              <button
                className="button"
                type="button"
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button className="button primary">保存</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Taxonomy() {
  const [data, setData] = useState<any>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [names, setNames] = useState({ categories: "", tags: "" });
  const [editing, setEditing] = useState<any>(null);
  useEffect(() => {
    api("taxonomy")
      .then(setData)
      .catch((error) => setNotice({ text: error.message, error: true }));
  }, []);
  async function change(kind: string, action: string, id = "", name = "") {
    try {
      const value = await send("taxonomy", { kind, action, id, name });
      setData(value);
      setNotice({ text: "已保存分类与标签。" });
      setEditing(null);
      return true;
    } catch (error: any) {
      setNotice({ text: error.message, error: true });
      return false;
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GIVE YOUR STORIES A PLACE</span>
          <h1>分类与标签</h1>
          <p>分类整理主题，标签串起灵感。</p>
        </div>
      </div>
      <Message notice={notice} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="taxonomy-grid">
          {(["categories", "tags"] as const).map((kind) => (
            <section className="panel taxonomy-panel" key={kind}>
              <div className="panel-heading">
                <h2>{kind === "categories" ? "分类" : "标签"}</h2>
                <span>{data[kind].length} 个</span>
              </div>
              <form
                className="term-create"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (await change(kind, "create", "", names[kind]))
                    setNames((current) => ({ ...current, [kind]: "" }));
                }}
              >
                <input
                  aria-label={`新建${kind === "categories" ? "分类" : "标签"}`}
                  placeholder={`添加${
                    kind === "categories" ? "分类" : "标签"
                  }名称`}
                  required
                  maxLength={100}
                  value={names[kind]}
                  onChange={(event) =>
                    setNames({ ...names, [kind]: event.target.value })
                  }
                />
                <button className="button">添加</button>
              </form>
              <div className="term-list">
                {data[kind].map((item: any) => (
                  <div className="term-row" key={item.id}>
                    <div>
                      <strong>
                        {kind === "tags" ? "# " : ""}
                        {item.name}
                      </strong>
                      <small>
                        {item.count} 篇文章
                        {item.drafts ? ` · ${item.drafts} 份草稿` : ""}
                      </small>
                    </div>
                    <div className="button-row">
                      <button
                        className="text-button"
                        onClick={() => setEditing({ ...item, kind })}
                      >
                        重命名
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => change(kind, "delete", item.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <form
            className="modal small-modal"
            onSubmit={(event) => {
              event.preventDefault();
              change(editing.kind, "rename", editing.id, editing.name);
            }}
          >
            <h2>重命名</h2>
            <label>
              名称
              <input
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
                maxLength={100}
                required
              />
            </label>
            <p className="muted">引用此名称的文章和草稿会同步更新。</p>
            <div className="button-row">
              <button
                type="button"
                className="button"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="button primary">保存</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Settings() {
  const [notice, setNotice] = useState<Notice>(null);
  const [scan, setScan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [momentSources, setMomentSources] = useState<any[] | null>(null);
  const [momentsError, setMomentsError] = useState("");
  useEffect(() => {
    api("media")
      .then((value) => { setGithub(value.github); setStorage(value.storage); })
      .catch(() => {});
    api("moments/sources").then(setMomentSources).catch(error => setMomentsError(error.message));
  }, []);
  async function runImport(dryRun: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const value = await send("import", { dryRun });
      setScan(value);
      setNotice({
        text: dryRun
          ? `预检完成：${value.total} 篇内容可导入。`
          : `导入完成：新增 ${value.imported} 篇，跳过已有 ${value.skipped} 篇。`,
      });
    } catch (error: any) {
      if (error.details?.errors) setScan(error.details);
      setNotice({ text: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP YOUR WORK IN GOOD HANDS</span>
          <h1>设置与迁移</h1>
          <p>让内容安稳保存，也能随时带走。</p>
        </div>
      </div>
      <Message notice={notice} />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <span className="step-number">MOMENTS / SYNC</span>
          <h2>碎碎念同步</h2>
          <p>首页和碎碎念页面展示已保存的内容。来源暂时不可用时，已有内容继续保留。</p>
          {momentsError && <p role="alert">{momentsError}</p>}
          {momentSources === null && !momentsError && <p>正在读取同步状态…</p>}
          {momentSources?.length === 0 && <p>尚未配置同步来源。</p>}
          {momentSources?.map(source => <div key={source.id} className="scan-result">
            <strong>{platformLabels[source.platform as keyof typeof platformLabels] || source.platform} · {source.title} {source.account !== source.title && source.mode !== 'archive' ? `(${source.account})` : ''}</strong>
            <span>已保存 {source.count} 条 · {source.mode === 'archive' ? '历史存档已导入' : source.lastError === 'WEIBO_AUTH_REQUIRED' ? '等待微博网页登录授权' : source.backfillComplete ? '历史补抓完成' : '历史补抓尚未完成'}</span>
            {source.mode === 'live' && <p>检查间隔：{Math.round(source.intervalSeconds / 60)} 分钟{source.platform === 'weibo' ? '，每轮最多 2 页' : ''}</p>}
            <p>最近成功：{source.lastSuccessAt ? formatDate(source.lastSuccessAt) : "尚未成功"}</p>
            <p>最近尝试：{source.lastAttemptAt ? formatDate(source.lastAttemptAt) : "尚未运行"}</p>
            {source.lastError === 'WEIBO_AUTH_REQUIRED' ? <p>请为此账号完成微博扫码登录，登录后自动开始同步。</p> : source.lastError && <p role="alert">同步失败：{source.lastError}，已有内容不受影响。</p>}
          </div>)}
        </section>
        <section className="panel settings-panel">
          <span className="step-number">01 / CONTENT</span>
          <h2>迁移现有 Markdown</h2>
          <p>
            从项目 content 目录导入文章与图片引用，保留原有栏目、年份、路径和
            Markdoc 语法。已有记录会跳过。
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => runImport(true)}
            >
              {busy ? "正在处理…" : "先做导入预检"}
            </button>
            <button
              className="button primary"
              disabled={busy || !scan || scan.errors?.length > 0}
              onClick={() => runImport(false)}
            >
              导入到 MySQL
            </button>
          </div>
          {scan && (
            <div className="scan-result">
              <strong>
                {scan.total} 篇内容 · {scan.errors.length} 个错误
              </strong>
              {!scan.dryRun && (
                <span>
                  新增 {scan.imported} · 已存在 {scan.skipped}
                </span>
              )}
              {scan.errors.map((item: any) => (
                <p key={item.sourcePath}>
                  {item.sourcePath}：{item.error}
                </p>
              ))}
            </div>
          )}
        </section>
        <section className="panel settings-panel">
          <span className="step-number">02 / EXPORT</span>
          <h2>导出内容</h2>
          <p>
            下载全部文章的正式内容与编辑草稿。单篇 Markdown
            可以在文章编辑页面导出。
          </p>
          <a className="button" href="/api/admin/export">
            下载内容备份 JSON <Icon name="arrow" />
          </a>
          <p className="field-hint">
            此导出包含正文和草稿；完整数据库备份还应包含账号、版本、分类和媒体信息。
          </p>
        </section>
        <section className="panel settings-panel">
          <span className="step-number">03 / MEDIA</span>
          <h2>{storage?.label || '图片存储'}</h2>
          <dl className="config-list">
            <div>
              <dt>{storage?.provider === 'r2' ? '服务' : '仓库'}</dt>
              <dd>{storage?.provider === 'r2' ? 'Cloudflare R2' : github?.repo ?? '…'}</dd>
            </div>
            <div>
              <dt>{storage?.provider === 'r2' ? '访问域名' : '分支'}</dt>
              <dd>{storage?.provider === 'r2' ? storage.publicOrigin : github?.branch ?? '…'}</dd>
            </div>
            <div>
              <dt>上传权限</dt>
              <dd>
                <span
                  className={`status-badge ${
                    (storage?.configured ?? github?.configured) ? "published" : "draft"
                  }`}
                >
                  {(storage?.configured ?? github?.configured) ? '上传已就绪' : '上传未就绪'}
                </span>
              </dd>
            </div>
          </dl>
          <p>
            粘贴图片和媒体库上传使用同一图床，上传完成后可以插入文章。
          </p>
          <a href="/admin/media" className="text-link">
            前往媒体库 →
          </a>
        </section>
        <section className="panel settings-panel">
          <span className="step-number">04 / ACCOUNT</span>
          <h2>修改登录密码</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              try {
                await send("auth/password", {
                  currentPassword: form.get("currentPassword"),
                  newPassword: form.get("newPassword"),
                });
                window.location.assign("/admin/login");
              } catch (error: any) {
                setNotice({ text: error.message, error: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              当前密码
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                placeholder="至少 12 个字符"
              />
            </label>
            <button className="button" disabled={busy}>
              更新密码并重新登录
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
