import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  categoryLabels,
  eventLabels,
  pageCategories,
  type AnalyticsEventType,
  type PageCategory,
} from "../../lib/analytics/shared";
import "../../styles/analytics-dashboard.css";

type Requester = (path: string, options?: RequestInit) => Promise<any>;
type Filters = { start: string; end: string; category: string; path: string };
type Report = {
  range: Filters & { days: number };
  generatedAt: string;
  overview: Record<string, number>;
  previous: Record<string, number>;
  realtime: { visitors: number; sessions: number; minutes: any[] };
  series: { date: string; pv: number; uv: number; sessions: number }[];
  pages: any[];
  dimensions: any[];
  events: any[];
  eventTotals: any[];
  flows: any[];
  landings: any[];
  scroll: any[];
  vitals: Record<string, { p75: number | null; samples: number }>;
  collectionStartedAt: string | null;
};
const dateKey = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const presetRange = (days: number): Filters => ({
  start: dateKey(new Date(Date.now() - (days - 1) * 86400000)),
  end: dateKey(new Date()),
  category: "",
  path: "",
});
const number = (value: unknown) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(
    Number(value) || 0
  );
const percent = (value: number) => `${number(value * 100)}%`;
const duration = (value: number) =>
  value >= 60000
    ? `${Math.floor(value / 60000)}分${Math.round((value % 60000) / 1000)}秒`
    : `${number(value / 1000)}秒`;
const ratio = (a: number, b: number) => (b ? a / b : 0);
function Trend({ series }: Pick<Report, "series">) {
  const [index, setIndex] = useState(series.length - 1);
  useEffect(() => setIndex(series.length - 1), [series]);
  const selected = series[Math.min(Math.max(0, index), series.length - 1)];
  const max = Math.max(1, ...series.map((row) => row.pv)),
    x = (i: number) => 45 + i * (900 / Math.max(1, series.length - 1)),
    y = (value: number) => 205 - (value / max) * 170;
  const line = (key: "pv" | "uv") =>
    series.map((row, i) => `${i ? "L" : "M"}${x(i)},${y(row[key])}`).join(" ");
  return (
    <>
      <div className="analytics-chart-summary">
        <strong>{selected?.date}</strong>
        <span>
          <i className="pv-key" />
          浏览 {number(selected?.pv)}
        </span>
        <span>
          <i className="uv-key" />
          访客 {number(selected?.uv)}
        </span>
        <span>会话 {number(selected?.sessions)}</span>
      </div>
      <svg
        className="analytics-trend"
        viewBox="0 0 1000 250"
        role="img"
        aria-label="每日浏览与访客趋势"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setIndex(
            Math.max(
              0,
              Math.min(
                series.length - 1,
                Math.round(
                  ((((event.clientX - rect.left) / rect.width) * 1000 - 45) /
                    900) *
                    (series.length - 1)
                )
              )
            )
          );
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <g key={step}>
            <line x1="45" x2="945" y1={y(max * step)} y2={y(max * step)} />
            <text x="32" y={y(max * step) + 4} textAnchor="end">
              {number(max * step)}
            </text>
          </g>
        ))}
        <path className="analytics-line pv-line" d={line("pv")} />
        <path className="analytics-line uv-line" d={line("uv")} />
        {selected && (
          <>
            <line
              className="analytics-guide"
              x1={x(Math.min(index, series.length - 1))}
              x2={x(Math.min(index, series.length - 1))}
              y1="25"
              y2="205"
            />
            <circle
              cx={x(Math.min(index, series.length - 1))}
              cy={y(selected.pv)}
              r="4"
              className="pv-point"
            />
          </>
        )}
        {series.map((row, i) =>
          i === 0 ||
          i === series.length - 1 ||
          i % Math.ceil(series.length / 7) === 0 ? (
            <text key={row.date} x={x(i)} y="235" textAnchor="middle">
              {row.date.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      <input
        className="analytics-chart-range"
        type="range"
        min="0"
        max={Math.max(0, series.length - 1)}
        value={Math.max(0, index)}
        onChange={(event) => setIndex(Number(event.target.value))}
        aria-label="查看某一天的访问数据"
      />
    </>
  );
}
function Distribution({
  title,
  subtitle,
  items,
  denominator,
}: {
  title: string;
  subtitle: string;
  items: any[];
  denominator: number;
}) {
  const max = Math.max(1, ...items.map((row) => Number(row.total)));
  return (
    <section className="analytics-panel">
      <header>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </header>
      {items.length ? (
        <div className="analytics-distribution">
          {items.map((row, i) => (
            <div
              className="analytics-distribution-row"
              key={row.label + ":" + i}
            >
              <div>
                <span title={row.label}>{row.label}</span>
                <strong>
                  {number(row.total)}{" "}
                  <small>
                    {percent(ratio(Number(row.total), denominator))}
                  </small>
                </strong>
              </div>
              <div className="analytics-bar">
                <i style={{ width: `${(Number(row.total) / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="analytics-empty">暂无数据</p>
      )}
    </section>
  );
}
function Kpi({
  label,
  value,
  previous,
  current,
  hint,
}: {
  label: string;
  value: string;
  previous?: number;
  current?: number;
  hint: string;
}) {
  const change = previous ? ((current || 0) - previous) / previous : null;
  return (
    <article className="analytics-kpi" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>
        {change === null
          ? "上期暂无可比数据"
          : `${change > 0 ? "↑" : change < 0 ? "↓" : "—"} ${percent(
              Math.abs(change)
            )} 较上一时段`}
      </small>
    </article>
  );
}
export default function AnalyticsDashboard({
  request,
}: {
  request: Requester;
}) {
  const [active, setActive] = useState<Filters>(() => presetRange(7)),
    [draft, setDraft] = useState(active),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [automatic, setAutomatic] = useState(true);
  const controller = useRef<AbortController | null>(null),
    requestNumber = useRef(0);
  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const id = ++requestNumber.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(active);
      const data = await request("analytics?" + params, {
        signal: current.signal,
      });
      if (id === requestNumber.current) setReport(data);
    } catch (error) {
      if (!current.signal.aborted && id === requestNumber.current)
        setError(
          error instanceof Error ? error.message : "访问数据暂时无法读取"
        );
    } finally {
      if (id === requestNumber.current) setBusy(false);
    }
  }, [active, request]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    return () => clearInterval(timer);
  }, [automatic, load]);
  const applyPreset = (days: number) => {
    const next = {
      ...presetRange(days),
      category: active.category,
      path: active.path,
    };
    setDraft(next);
    setActive(next);
  };
  const drill = (path: string) => {
    const next = { ...active, path };
    setDraft(next);
    setActive(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const o = report?.overview || {},
    p = report?.previous || {};
  const dimensions = (kind: string) =>
    report?.dimensions.filter((row) => row.kind === kind) || [];
  const eventName = (type: string) =>
    eventLabels[type as AnalyticsEventType] || type;
  const errors =
    Number(report?.eventTotals.find((row) => row.type === "error")?.total) || 0;
  return (
    <div className="analytics-dashboard">
      <header className="analytics-heading">
        <div>
          <p>READERS & JOURNEYS</p>
          <h1>访问分析</h1>
          <span>看见读者从哪里来，如何阅读，又在哪里停留。</span>
        </div>
        <div className="analytics-live">
          <i />
          <strong>{number(report?.realtime.visitors)}</strong> 位访客活跃于最近
          5 分钟
        </div>
      </header>
      <aside className="analytics-collection-note" role="note">
        <strong>当前浏览器已登录站长账号，前台访问不会计入统计。</strong>
        <span>
          验证采集时，请用未登录的无痕窗口打开博客，再回到这里刷新。看板数据最多缓存
          30 秒。
        </span>
      </aside>
      <form
        className="analytics-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setActive({ ...draft, path: draft.path.trim() });
        }}
      >
        <div className="analytics-presets">
          {[
            [1, "今天"],
            [7, "7 天"],
            [30, "30 天"],
            [90, "90 天"],
          ].map(([days, label]) => (
            <button
              type="button"
              key={days}
              aria-pressed={
                active.end === dateKey(new Date()) &&
                active.start === presetRange(Number(days)).start
              }
              onClick={() => applyPreset(Number(days))}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          开始日期
          <input
            type="date"
            value={draft.start}
            max={draft.end}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value })
            }
            required
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={draft.end}
            min={draft.start}
            max={dateKey(new Date())}
            onChange={(event) =>
              setDraft({ ...draft, end: event.target.value })
            }
            required
          />
        </label>
        <label>
          页面类型
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value })
            }
          >
            <option value="">全部页面</option>
            {pageCategories.map((category) => (
              <option value={category} key={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </select>
        </label>
        <label className="analytics-path-input">
          页面路径
          <input
            value={draft.path}
            onChange={(event) =>
              setDraft({ ...draft, path: event.target.value })
            }
            placeholder="例如 /photography"
            maxLength={512}
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          应用筛选
        </button>
        <button type="button" onClick={() => void load()} disabled={busy}>
          {busy ? "读取中…" : "刷新"}
        </button>
      </form>
      <div className="analytics-context">
        <span>
          {active.start} — {active.end} · 北京时间
          {active.path && (
            <>
              {" "}
              · {active.path}{" "}
              <button type="button" onClick={() => drill("")}>
                清除页面筛选
              </button>
            </>
          )}
        </span>
        <label>
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          每分钟刷新
        </label>
        <span>
          {report
            ? `更新于 ${new Date(report.generatedAt).toLocaleTimeString(
                "zh-CN",
                { timeZone: "Asia/Shanghai" }
              )}`
            : "等待首次读取"}
        </span>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
          <button type="button" onClick={() => void load()}>
            重新读取
          </button>
        </div>
      )}
      {!report && busy ? (
        <div role="status" className="loading">
          正在读取访问数据…
        </div>
      ) : (
        report && (
          <>
            {!o.pv && (
              <div className="analytics-onboarding">
                <strong>这个时段还没有访问记录</strong>
                <p>
                  埋点上线后会自动积累数据。登录管理员、常见机器人以及开启 DNT /
                  GPC
                  的访问不计入。可使用未登录的浏览器访问前台，随后刷新此看板。
                </p>
              </div>
            )}
            <div className="analytics-kpis">
              <Kpi
                label="浏览量 PV"
                value={number(o.pv)}
                current={o.pv}
                previous={p.pv}
                hint="每次页面打开记一次；心跳及重试不会重复累计。"
              />
              <Kpi
                label="独立访客 UV"
                value={number(o.uv)}
                current={o.uv}
                previous={p.uv}
                hint="区间内不同匿名浏览器标识数；不同设备和清除 Cookie 后会分别计算。"
              />
              <Kpi
                label="访问次数"
                value={number(o.sessions)}
                current={o.sessions}
                previous={p.sessions}
                hint="同一浏览器连续活动归为一次访问，30 分钟不活跃后开始新会话。"
              />
              <Kpi
                label="每次访问页数"
                value={number(ratio(o.pv, o.sessions))}
                current={ratio(o.pv, o.sessions)}
                previous={ratio(p.pv, p.sessions)}
                hint="所选页面范围内的浏览量除以访问次数。"
              />
              <Kpi
                label="平均活跃停留"
                value={duration(ratio(o.durationMs, o.pv))}
                current={ratio(o.durationMs, o.pv)}
                previous={ratio(p.durationMs, p.pv)}
                hint="页面可见且最近 60 秒有活动（或媒体正在播放）的累计时间；后台闲置不计。"
              />
              <Kpi
                label="跳出率"
                value={percent(ratio(o.bounces, o.sessions))}
                current={ratio(o.bounces, o.sessions)}
                previous={ratio(p.bounces, p.sessions)}
                hint="只有 1 次浏览、活跃不足 10 秒且无有效交互的会话占比。"
              />
              <Kpi
                label="阅读完成率"
                value={percent(ratio(o.completions, o.pv))}
                current={ratio(o.completions, o.pv)}
                previous={ratio(p.completions, p.pv)}
                hint="滚动达到页面 90% 且活跃至少 10 秒的浏览占比，为阅读深度的近似指标。"
              />
              <Kpi
                label="关键交互"
                value={number(o.interactions)}
                current={o.interactions}
                previous={p.interactions}
                hint="已入库的站内导航、外链、搜索、筛选、图片放大、播放、分享、下载和主题切换，不含错误。"
              />
            </div>
            <section className="analytics-panel analytics-chart-panel">
              <header>
                <h2>阅读足迹</h2>
                <span>按天查看 PV / UV · 悬停或拖动下方滑块查看明细</span>
              </header>
              <Trend series={report.series} />
            </section>
            <div className="analytics-two">
              <Distribution
                title="访问来源"
                subtitle="区间首个页面 · 会话数"
                items={dimensions("source")}
                denominator={o.sessions}
              />
              <Distribution
                title="推广活动"
                subtitle="UTM Campaign · 会话数"
                items={dimensions("campaign")}
                denominator={o.sessions}
              />
            </div>
            <section className="analytics-panel">
              <header>
                <h2>大家在读什么</h2>
                <span>前 50 个页面 · 点击路径可筛选</span>
              </header>
              <div className="analytics-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>页面</th>
                      <th>类型</th>
                      <th>PV</th>
                      <th>UV</th>
                      <th>活跃停留</th>
                      <th>平均滚动</th>
                      <th>阅读完成</th>
                      <th>平均 LCP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pages.map((row) => (
                      <tr key={row.path}>
                        <td>
                          <button
                            className="analytics-path-button"
                            onClick={() => drill(row.path)}
                          >
                            {row.title || row.path}
                          </button>
                          {row.title && <small>{row.path}</small>}
                        </td>
                        <td>
                          {categoryLabels[row.category as PageCategory] ||
                            row.category}
                        </td>
                        <td>{number(row.pv)}</td>
                        <td>{number(row.uv)}</td>
                        <td>{duration(Number(row.durationMs))}</td>
                        <td>{number(row.scroll)}%</td>
                        <td>
                          {percent(
                            ratio(Number(row.completions), Number(row.pv))
                          )}
                        </td>
                        <td>
                          {row.lcpMs === null
                            ? "—"
                            : `${number(Number(row.lcpMs) / 1000)}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.pages.length && (
                  <p className="analytics-empty">还没有页面数据</p>
                )}
              </div>
            </section>
            <div className="analytics-four">
              <Distribution
                title="访问设备"
                subtitle="浏览量 PV"
                items={dimensions("device")}
                denominator={o.pv}
              />
              <Distribution
                title="浏览器"
                subtitle="浏览量 PV"
                items={dimensions("browser")}
                denominator={o.pv}
              />
              <Distribution
                title="操作系统"
                subtitle="浏览量 PV"
                items={dimensions("os")}
                denominator={o.pv}
              />
              <Distribution
                title="国家 / 地区"
                subtitle="可用的来源地理标签 · PV"
                items={dimensions("country")}
                denominator={o.pv}
              />
            </div>
            <div className="analytics-two">
              <section className="analytics-panel">
                <header>
                  <h2>阅读深度</h2>
                  <span>到达各深度的浏览量</span>
                </header>
                {report.scroll.length ? (
                  report.scroll.map((row) => (
                    <div className="analytics-depth" key={row.depth}>
                      <span>{row.depth}% 页面</span>
                      <div className="analytics-bar">
                        <i
                          style={{
                            width: `${ratio(Number(row.total), o.pv) * 100}%`,
                          }}
                        />
                      </div>
                      <strong>{number(row.total)}</strong>
                      <small>{percent(ratio(Number(row.total), o.pv))}</small>
                    </div>
                  ))
                ) : (
                  <p className="analytics-empty">暂无滚动数据</p>
                )}
              </section>
              <section className="analytics-panel">
                <header>
                  <h2>体验与性能</h2>
                  <span>真实浏览样本的 P75</span>
                </header>
                <div className="analytics-vitals">
                  {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => {
                    const metric = report.vitals[name];
                    return (
                      <div key={name}>
                        <span>{name}</span>
                        <strong>
                          {metric?.p75 === null || metric?.p75 === undefined
                            ? "—"
                            : name === "CLS"
                            ? metric.p75.toFixed(3)
                            : `${number(metric.p75 / 1000)}s`}
                        </strong>
                        <small>{number(metric?.samples)} 个样本</small>
                      </div>
                    );
                  })}
                </div>
                <p className="analytics-performance-note">
                  {number(errors)}{" "}
                  次前端异常。未上报的指标显示“—”；浏览器支持范围不同，样本数可能不同。
                </p>
              </section>
            </div>
            <div className="analytics-two">
              {[
                ["entry", "区间入口"],
                ["exit", "区间最后浏览页"],
              ].map(([kind, title]) => (
                <Distribution
                  key={kind}
                  title={title}
                  subtitle="会话数；最后浏览页不等于已离站"
                  items={report.landings
                    .filter((row) => row.kind === kind)
                    .slice(0, 10)
                    .map((row) => ({ ...row, label: row.path }))}
                  denominator={o.sessions}
                />
              ))}
            </div>
            <section className="analytics-panel">
              <header>
                <h2>访问路径</h2>
                <span>同一会话内相邻页面 · 前 15 条</span>
              </header>
              {report.flows.length ? (
                <div className="analytics-flows">
                  {report.flows.map((row, i) => (
                    <div key={i}>
                      <button onClick={() => drill(row.path)}>
                        {row.path}
                      </button>
                      <span>→</span>
                      <button onClick={() => drill(row.nextPath)}>
                        {row.nextPath}
                      </button>
                      <strong>{number(row.total)} 次</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="analytics-empty">
                  有连续浏览后，会显示页面之间的流向。
                </p>
              )}
            </section>
            <section className="analytics-panel">
              <header>
                <h2>交互明细</h2>
                <span>按事件、目标及标签汇总 · 前 100 项</span>
              </header>
              <div className="analytics-event-tags">
                {report.eventTotals.map((row) => (
                  <span key={row.type}>
                    {eventName(row.type)} <strong>{number(row.total)}</strong>
                  </span>
                ))}
              </div>
              <div className="analytics-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>事件</th>
                      <th>目标</th>
                      <th>发生页面</th>
                      <th>标签</th>
                      <th>次数</th>
                      <th>访客</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.events.map((row, i) => (
                      <tr key={i}>
                        <td>{eventName(row.type)}</td>
                        <td>{row.targetName || row.target || "—"}</td>
                        <td>
                          <button
                            className="analytics-path-button"
                            onClick={() => drill(row.page)}
                          >
                            {row.page}
                          </button>
                        </td>
                        <td>{row.label || "—"}</td>
                        <td>{number(row.total)}</td>
                        <td>{number(row.uv)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.events.length && (
                  <p className="analytics-empty">暂无交互事件</p>
                )}
              </div>
            </section>
            <details className="analytics-definitions">
              <summary>统计口径与隐私</summary>
              <p>
                所有日期按北京时间统计。PV 按页面标识去重，UV
                以匿名浏览器标识计算，30 分钟不活跃后新开会话。数据保留 180
                天；指标反映执行了脚本且未选择退出的浏览，不能代表全部 HTTP
                请求。页面刷新计入新 PV。
              </p>
              <p>
                活跃时间排除隐藏页面与长时间闲置，阅读完成是滚动深度和停留时间的近似。来源以所选区间每次会话的首个页面为准；页面类型和路径筛选后，会话指标也只计该范围内的浏览。实时人数是最近
                5 分钟的窗口，与日期筛选独立。
              </p>
              <p>
                只保存匿名标识、公开页面路径和受限事件字段，不保存原始 IP、完整
                User-Agent、搜索文字、输入内容或错误堆栈。外部来源和外链只保存域名，不保存
                URL 参数；地区标签缺失时显示“未知”。管理员、DNT / GPC
                和常见机器人不计入。
              </p>
              <p>
                {report.collectionStartedAt
                  ? `保留期内最早记录：${new Date(
                      report.collectionStartedAt
                    ).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                  : "埋点刚上线，从真实访问发生时开始积累，不补造历史数据。"}
              </p>
            </details>
          </>
        )
      )}
    </div>
  );
}
