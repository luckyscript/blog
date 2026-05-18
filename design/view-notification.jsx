// NOTIFICATION view — compact changelog / monospace log
const NotifView = ({ theme, fontFamily }) => {
  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', stamp: '#c56b3f', ok: '#8fb37a', warn: '#d8a96a', err: '#c56b3f' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', stamp: '#8a4a1a', ok: '#4a7a3a', warn: '#8a5a1a', err: '#8a3a1a' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', stamp: '#a8542a', ok: '#3a6a2a', warn: '#a8542a', err: '#9a2a1a' };
  const mono = '"JetBrains Mono", "Sarasa Mono SC", Menlo, monospace';
  const typeStack = { serif: '"Source Serif Pro", Georgia, serif', sans: '"Inter", system-ui, sans-serif', kai: '"Ma Shan Zheng", serif', mono }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const notifs = [
    { t: '11:24', kind: 'RELEASE', feed: 'vercel/next.js', color: palette.ok, title: 'v16.2.2 released', body: 'Bug fixes to App Router prefetching; new experimental cache API.', meta: '+48 commits · 12 contributors' },
    { t: '10:48', kind: 'ALERT', feed: 'status.stripe.com', color: palette.err, title: 'Elevated API latency in us-east-1', body: 'Investigating delayed webhook delivery. Payments processing normally.', meta: 'Started 10:31 · investigating' },
    { t: '10:02', kind: 'RELEASE', feed: 'prisma/prisma', color: palette.ok, title: '5.28.0 — MongoDB replica set improvements', body: 'Adds support for secondary read preference; Rust engine 2% faster on cold starts.', meta: 'npm · 4.1M weekly downloads' },
    { t: '09:15', kind: 'BUILD', feed: 'inkrain/main', color: palette.warn, title: 'Deploy to production — canary 10%', body: 'commit 8f3a21c · "chore: update rss parser to 3.13.1" · by luckyscript', meta: 'CI: 2m 14s · all checks passed' },
    { t: '08:30', kind: 'SECURITY', feed: 'npm advisories', color: palette.err, title: 'CVE-2026-1147 — moderate severity in express@4.x', body: 'Prototype pollution in query parsing; upgrade to 4.19.2 or 5.x.', meta: '2 projects affected' },
    { t: '07:12', kind: 'INFO', feed: 'rsshub/routes', color: palette.ink, title: '43 new routes added this week', body: 'Added: Substack v2, Letterboxd lists, XKCD alt-text. Updated: Weibo, Reddit.', meta: '→ browse routes' },
    { t: 'Yd', kind: 'RELEASE', feed: 'honojs/hono', color: palette.ok, title: '4.7.0 — new streaming API', body: 'stream() helper for Server-Sent Events and chunked responses. Breaking in 5.0.', meta: '1.8k ★ this month' },
    { t: 'Yd', kind: 'ALERT', feed: 'uptimerobot', color: palette.warn, title: 'inkrain.jsjhlk.com — 1 outage (2m 14s)', body: 'HTTP 502 at 23:47 UTC. Back online 23:49. Cause: database connection pool saturation.', meta: 'Monthly uptime 99.94%' },
  ];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, color: palette.ink, fontFamily: typeStack, overflow: 'hidden' }}>
      <aside style={{ width: 64, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{mk: '全'}, {mk: '文'}, {mk: '言'}, {mk: '聲'}, {mk: '影'}, {mk: '圖'}, {mk: '訊', on: true}].map((x, i) => (
            <div key={i} style={{ width: 34, height: 34, border: x.on ? `1px solid ${palette.stamp}` : '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: x.on ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", serif', fontSize: 15 }}>{x.mk}</div>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', background: palette.panel }}>
        <div style={{ padding: '28px 40px 18px', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 34, lineHeight: 1, color: palette.ink }}>訊 · Signals</div>
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: mono, marginTop: 6 }}>Notifications · 18 today · 7 unread</div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: palette.inkMuted, letterSpacing: '0.1em' }}>— last synced 2m ago —</div>
        </div>

        <div style={{ padding: '4px 0' }}>
          {notifs.map((n, i) => (
            <div key={i} style={{ padding: '14px 40px', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', gap: 16, fontFamily: mono }}>
              <div style={{ width: 52, fontSize: 11.5, color: palette.inkMuted, letterSpacing: '0.06em', flexShrink: 0, paddingTop: 2 }}>{n.t}</div>
              <div style={{ width: 90, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.12em', color: n.color, flexShrink: 0, paddingTop: 3 }}>{n.kind}</div>
              <div style={{ width: 180, fontSize: 11.5, color: palette.inkSoft, flexShrink: 0, paddingTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.feed}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: typeStack, fontSize: 14.5, fontWeight: 500, color: palette.ink, marginBottom: 3, letterSpacing: '-0.005em' }}>{n.title}</div>
                <div style={{ fontFamily: typeStack, fontSize: 13, lineHeight: 1.55, color: palette.inkSoft, marginBottom: 4 }}>{n.body}</div>
                <div style={{ fontSize: 10.5, color: palette.inkMuted, letterSpacing: '0.06em' }}>{n.meta}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: palette.inkMuted, flexShrink: 0, paddingTop: 2 }}>
                <span style={{ cursor: 'pointer' }}>✓</span>
                <span style={{ cursor: 'pointer' }}>★</span>
                <span style={{ cursor: 'pointer' }}>↗</span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};
window.NotifView = NotifView;
