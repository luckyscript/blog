import { getPool } from "../../db";
import { AppError } from "../server/errors";
import { analyticsPath, pageCategories } from "./shared";
const day = 86400000;
const dateKey = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function analyticsRange(params: URLSearchParams, now = new Date()) {
  const days = Number(params.get("days") || 7);
  if (![1, 7, 30, 90].includes(days)) throw new AppError(400, "统计区间无效");
  const end = params.get("end") || dateKey(now),
    start =
      params.get("start") ||
      dateKey(
        new Date(new Date(end + "T00:00:00+08:00").getTime() - (days - 1) * day)
      );
  for (const key of [start, end])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
      !Number.isFinite(Date.parse(key + "T00:00:00+08:00")) ||
      dateKey(new Date(key + "T00:00:00+08:00")) !== key
    )
      throw new AppError(400, "日期格式无效");
  const from = new Date(start + "T00:00:00+08:00"),
    until = new Date(new Date(end + "T00:00:00+08:00").getTime() + day),
    count = Math.round((until.getTime() - from.getTime()) / day);
  if (
    count < 1 ||
    count > 90 ||
    end > dateKey(now) ||
    start < dateKey(new Date(now.getTime() - 179 * day))
  )
    throw new AppError(400, "请选择最近 180 天内、不超过 90 天的区间");
  const category = params.get("category") || "";
  if (category && !pageCategories.includes(category as any))
    throw new AppError(400, "页面类型无效");
  const requested = params.get("path") || "",
    path = requested ? analyticsPath(requested) : "";
  if (requested && !path) throw new AppError(400, "页面地址无效");
  return { start, end, from, until, days: count, category, path };
}
type Range = ReturnType<typeof analyticsRange>;
async function rows(sql: string, values: unknown[] = []) {
  const [data] = await getPool().query<any[]>({ sql, timeout: 15000 }, values);
  return data;
}
function filter(range: Range, alias = "v") {
  let sql = `${alias}.started_at>=? AND ${alias}.started_at<?`;
  const values: unknown[] = [range.from, range.until];
  if (range.category) {
    sql += ` AND ${alias}.category=?`;
    values.push(range.category);
  }
  if (range.path) {
    sql += ` AND ${alias}.path=?`;
    values.push(range.path);
  }
  return { sql, values };
}
async function summary(range: Range) {
  const f = filter(range);
  const [row] = await rows(
    `SELECT COUNT(*) AS sessions,COUNT(DISTINCT visitor_key) AS uv,COALESCE(SUM(pv),0) AS pv,
 COALESCE(SUM(duration_ms),0) AS durationMs,COALESCE(SUM(interactions),0) AS interactions,COALESCE(SUM(completions),0) AS completions,COALESCE(SUM(total_scroll),0) AS totalScroll,
 COALESCE(SUM(pv=1 AND duration_ms<10000 AND interactions=0),0) AS bounces FROM
 (SELECT session_key,MAX(visitor_key) AS visitor_key,COUNT(*) AS pv,SUM(duration_ms) AS duration_ms,SUM(interactions) AS interactions,SUM(scroll_percent) AS total_scroll,
 SUM(scroll_percent>=90 AND duration_ms>=10000) AS completions FROM blog_analytics_views v WHERE ${f.sql} GROUP BY session_key) AS visits`,
    f.values
  );
  const [actions] = await rows(
    `SELECT COUNT(*) AS total FROM blog_analytics_events e JOIN blog_analytics_views v ON v.id=e.view_id WHERE ${f.sql} AND e.created_at>=? AND e.created_at<? AND e.type<>'error'`,
    [...f.values, range.from, range.until]
  );
  row.interactions = actions.total;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value) || 0])
  );
}
async function percentile(range: Range, column: string) {
  const f = filter(range);
  const [row] = await rows(
    `SELECT value,samples FROM
 (SELECT ${column} AS value,ROW_NUMBER() OVER(ORDER BY ${column}) AS row_num,COUNT(*) OVER() AS samples FROM blog_analytics_views v WHERE ${f.sql} AND ${column} IS NOT NULL) AS ranked
 WHERE row_num=CEIL(samples*0.75) LIMIT 1`,
    f.values
  );
  return {
    p75: row ? Number(row.value) : null,
    samples: row ? Number(row.samples) : 0,
  };
}
const cache = new Map<string, { until: number; value: Promise<any> }>();
export async function analyticsDashboard(params: URLSearchParams) {
  const range = analyticsRange(params),
    key = JSON.stringify(range),
    cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (cache.size >= 20) cache.delete(cache.keys().next().value!);
  const promise = loadDashboard(range).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { until: Date.now() + 30000, value: promise });
  return promise;
}
async function loadDashboard(range: Range) {
  const f = filter(range),
    previousRange = {
      ...range,
      from: new Date(range.from.getTime() - range.days * day),
      until: range.from,
    };
  const [overview, previous] = await Promise.all([
    summary(range),
    summary(previousRange),
  ]);
  const realtimeFilter =
      (range.category ? " AND category=?" : "") +
      (range.path ? " AND path=?" : ""),
    realtimeValues = [
      ...(range.category ? [range.category] : []),
      ...(range.path ? [range.path] : []),
    ];
  const [realtime] = await rows(
    `SELECT COUNT(DISTINCT visitor_key) AS visitors,COUNT(DISTINCT session_key) AS sessions FROM blog_analytics_views WHERE last_seen_at>=UTC_TIMESTAMP(3)-INTERVAL 5 MINUTE${realtimeFilter}`,
    realtimeValues
  );
  const minutes = await rows(
    `SELECT DATE_FORMAT(DATE_ADD(started_at,INTERVAL 8 HOUR),'%H:%i') AS minute,COUNT(*) AS pv FROM blog_analytics_views WHERE started_at>=UTC_TIMESTAMP(3)-INTERVAL 30 MINUTE${realtimeFilter} GROUP BY minute ORDER BY minute`,
    realtimeValues
  );
  const chart = await rows(
    `SELECT DATE_FORMAT(DATE_ADD(started_at,INTERVAL 8 HOUR),'%Y-%m-%d') AS date,COUNT(*) AS pv,COUNT(DISTINCT visitor_key) AS uv,COUNT(DISTINCT session_key) AS sessions FROM blog_analytics_views v WHERE ${f.sql} GROUP BY date ORDER BY date`,
    f.values
  );
  const series = [];
  for (
    let time = range.from.getTime();
    time < range.until.getTime();
    time += day
  ) {
    const date = dateKey(new Date(time)),
      entry = chart.find((row) => row.date === date);
    series.push({
      date,
      pv: Number(entry?.pv) || 0,
      uv: Number(entry?.uv) || 0,
      sessions: Number(entry?.sessions) || 0,
    });
  }
  const empty = {
    range: {
      start: range.start,
      end: range.end,
      days: range.days,
      category: range.category,
      path: range.path,
    },
    generatedAt: new Date().toISOString(),
    overview,
    previous,
    realtime: {
      visitors: Number(realtime.visitors),
      sessions: Number(realtime.sessions),
      minutes,
    },
    series,
    pages: [] as any[],
    dimensions: [] as any[],
    events: [] as any[],
    eventTotals: [] as any[],
    flows: [] as any[],
    landings: [] as any[],
    scroll: [] as any[],
    vitals: {} as Record<string, { p75: number | null; samples: number }>,
    collectionStartedAt: null as string | null,
  };
  const [first] = await rows(
    "SELECT MIN(started_at) AS started FROM blog_analytics_views"
  );
  empty.collectionStartedAt = first.started
    ? new Date(first.started).toISOString()
    : null;
  if (!overview.pv) return empty;
  const [
    pages,
    dimensions,
    events,
    eventTotals,
    flows,
    landings,
    scroll,
    ...vitalValues
  ] = await Promise.all([
    rows(
      `SELECT path,MAX(category) AS category,COUNT(*) AS pv,COUNT(DISTINCT visitor_key) AS uv,ROUND(AVG(duration_ms)) AS durationMs,ROUND(AVG(scroll_percent)) AS scroll,ROUND(AVG(lcp_ms)) AS lcpMs,SUM(scroll_percent>=90 AND duration_ms>=10000) AS completions FROM blog_analytics_views v WHERE ${f.sql} GROUP BY path ORDER BY pv DESC LIMIT 50`,
      f.values
    ),
    (async () => {
      const result = [];
      for (const field of ["device", "browser", "os", "country"] as const) {
        const data = await rows(
          `SELECT ? AS kind,COALESCE(NULLIF(${field},''),'未知') AS label,COUNT(*) AS total,COUNT(DISTINCT visitor_key) AS uv FROM blog_analytics_views v WHERE ${f.sql} GROUP BY ${field} ORDER BY total DESC LIMIT 12`,
          [field, ...f.values]
        );
        result.push(...data);
      }
      for (const field of ["source", "campaign"] as const) {
        const expression =
          field === "source"
            ? "COALESCE(NULLIF(utm_source,''),NULLIF(referrer_host,''),'直接访问')"
            : "COALESCE(NULLIF(utm_campaign,''),'未标记推广')";
        const data = await rows(
          `SELECT ? AS kind,${expression} AS label,COUNT(*) AS total,COUNT(DISTINCT visitor_key) AS uv FROM (SELECT v.*,ROW_NUMBER() OVER(PARTITION BY session_key ORDER BY started_at,id) AS row_num FROM blog_analytics_views v WHERE ${f.sql}) AS entries WHERE row_num=1 GROUP BY label ORDER BY total DESC LIMIT 15`,
          [field, ...f.values]
        );
        result.push(...data);
      }
      return result;
    })(),
    rows(
      `SELECT e.type,e.target,e.label,v.path AS page,MAX(l.name) AS targetName,COUNT(*) AS total,COUNT(DISTINCT v.visitor_key) AS uv FROM blog_analytics_events e JOIN blog_analytics_views v ON v.id=e.view_id LEFT JOIN blog_links l ON e.target=CONCAT('/link/to/',l.id) WHERE ${f.sql} AND e.created_at>=? AND e.created_at<? GROUP BY e.type,e.target,e.label,v.path ORDER BY total DESC LIMIT 100`,
      [...f.values, range.from, range.until]
    ),
    rows(
      `SELECT e.type,COUNT(*) AS total,COUNT(DISTINCT v.visitor_key) AS uv FROM blog_analytics_events e JOIN blog_analytics_views v ON v.id=e.view_id WHERE ${f.sql} AND e.created_at>=? AND e.created_at<? GROUP BY e.type ORDER BY total DESC`,
      [...f.values, range.from, range.until]
    ),
    rows(
      `SELECT path,next_path AS nextPath,COUNT(*) AS total FROM (SELECT path,LEAD(path) OVER(PARTITION BY session_key ORDER BY started_at,id) AS next_path FROM blog_analytics_views v WHERE ${f.sql}) AS ordered WHERE next_path IS NOT NULL AND next_path<>path GROUP BY path,next_path ORDER BY total DESC LIMIT 15`,
      f.values
    ),
    rows(
      `SELECT 'entry' AS kind,path,COUNT(*) AS total FROM (SELECT path,ROW_NUMBER() OVER(PARTITION BY session_key ORDER BY started_at,id) AS row_num FROM blog_analytics_views v WHERE ${f.sql}) AS entries WHERE row_num=1 GROUP BY path UNION ALL SELECT 'exit' AS kind,path,COUNT(*) AS total FROM (SELECT path,ROW_NUMBER() OVER(PARTITION BY session_key ORDER BY started_at DESC,id DESC) AS row_num FROM blog_analytics_views v WHERE ${f.sql}) AS exits WHERE row_num=1 GROUP BY path ORDER BY total DESC LIMIT 40`,
      [...f.values, ...f.values]
    ),
    rows(
      `SELECT SUM(scroll_percent>=25) AS depth25,SUM(scroll_percent>=50) AS depth50,SUM(scroll_percent>=75) AS depth75,SUM(scroll_percent>=90) AS depth90,SUM(scroll_percent>=100) AS depth100 FROM blog_analytics_views v WHERE ${f.sql}`,
      f.values
    ),
    ...["lcp_ms", "inp_ms", "cls_milli", "fcp_ms", "ttfb_ms"].map((column) =>
      percentile(range, column)
    ),
  ]);
  if (pages.length) {
    const paths = pages.map((row) => row.path);
    const titles = await rows(
      "SELECT path,title FROM blog_posts WHERE status='published' AND path IN (?)",
      [paths]
    );
    pages.forEach(
      (row) =>
        (row.title =
          titles.find((title) => title.path === row.path)?.title || "")
    );
  }
  return {
    ...empty,
    pages,
    dimensions,
    events,
    eventTotals,
    flows,
    landings,
    scroll: [25, 50, 75, 90, 100].map((depth) => ({
      depth,
      total: Number(scroll[0]?.["depth" + depth]) || 0,
    })),
    vitals: Object.fromEntries(
      ["LCP", "INP", "CLS", "FCP", "TTFB"].map((name, i) => [
        name,
        {
          ...vitalValues[i],
          p75:
            vitalValues[i].p75 === null
              ? null
              : name === "CLS"
              ? vitalValues[i].p75! / 1000
              : vitalValues[i].p75,
        },
      ])
    ),
  };
}
