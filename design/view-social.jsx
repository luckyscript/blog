// SOCIAL view — short-post timeline, card-is-all (no detail page)
// Ink-wash language: seal stamp avatars, kai accents, stitched column

const SocialView = ({ theme, fontFamily }) => {
  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', accent: '#d8a96a', stamp: '#c56b3f' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', accent: '#8a4a1a', stamp: '#8a4a1a' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', accent: '#1a1814', stamp: '#a8542a' };

  const typeStack = {
    serif: '"Source Serif Pro", "Songti SC", Georgia, serif',
    sans: '"Inter", "PingFang SC", system-ui, sans-serif',
    kai: '"Ma Shan Zheng", "Kaiti SC", serif',
    mono: '"JetBrains Mono", Menlo, monospace',
  }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const posts = [
    { id: 1, mark: '言', who: 'Paul Graham', handle: '@paulg', feed: 'Twitter', time: '12m', body: 'The startups that succeed are usually the ones whose founders were going to keep working on the idea anyway, because it interested them.', replies: 48, likes: 1240, quote: null },
    { id: 2, mark: '鏡', who: 'Craig Mod', handle: '@craigmod', feed: 'Twitter', time: '38m', body: 'Walked 27km along an old pilgrim road today. Zero mobile signal for six hours. I keep forgetting how mentally expensive it is to be reachable.', replies: 14, likes: 512, img: true },
    { id: 3, mark: '思', who: 'Visakan Veerasamy', handle: '@visakanv', feed: 'Twitter', time: '2h', body: 'the generous move, the thoughtful move, the patient move — they all look boring on a timeline and fantastic over a decade.', replies: 23, likes: 890, quote: null },
    { id: 4, mark: '墨', who: '阮一峰', handle: '@ruanyf', feed: '微博', time: '4h', body: '很多时候，我们不是缺乏知识，而是缺乏安静读完一篇长文的环境。墨雨之所以存在，正是想在算法之外留一个角落。', replies: 62, likes: 2100 },
    { id: 5, mark: '引', who: 'Robin Sloan', handle: '@robinsloan', feed: 'Mastodon', time: '6h', body: null, quote: { who: 'Austin Kleon', body: 'An RSS reader is basically a telescope — you aim it at the parts of the web you still trust.' }, replies: 8, likes: 234 },
    { id: 6, mark: '碼', who: 'Simon Willison', handle: '@simonw', feed: 'Mastodon', time: '8h', body: 'Just shipped a tiny CLI that pipes my RSS reader\u2019s starred items into a weekly digest. 140 lines of Python. I love this era.', replies: 11, likes: 420 },
  ];

  const paperTex = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' seed='5'/%3E%3CfeColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, backgroundImage: paperTex, color: palette.ink, fontFamily: typeStack, overflow: 'hidden' }}>
      {/* rail */}
      <aside style={{ width: 64, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{mk: '全'}, {mk: '文'}, {mk: '言', on: true}, {mk: '聲'}, {mk: '影'}, {mk: '圖'}].map((x, i) => (
            <div key={i} style={{ width: 34, height: 34, border: x.on ? `1px solid ${palette.stamp}` : '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: x.on ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", serif', fontSize: 15 }}>{x.mk}</div>
          ))}
        </div>
      </aside>

      {/* single-column feed */}
      <main style={{ flex: 1, overflowY: 'auto', background: palette.panel }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 48px 80px' }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `1px solid ${palette.borderSoft}`, paddingBottom: 18, marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 36, lineHeight: 1, color: palette.ink, marginBottom: 4 }}>言 · Voices</div>
              <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace' }}>Social · 32 new · Tue 11:24</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['All', 'Twitter', 'Mastodon', '微博'].map((t, i) => (
                <div key={t} style={{ padding: '5px 10px', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: i === 0 ? palette.ink : palette.inkMuted, border: i === 0 ? `1px solid ${palette.ink}` : '1px solid transparent', cursor: 'pointer' }}>{t}</div>
              ))}
            </div>
          </div>

          {posts.map((p, idx) => (
            <article key={p.id} style={{ padding: '22px 0', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', gap: 16 }}>
              {/* seal stamp avatar */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 42, height: 42, background: palette.stamp, color: palette.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 22, boxShadow: `inset 0 0 0 2px ${palette.panel}, 0 0 0 1px ${palette.stamp}` }}>{p.mark}</div>
                <div style={{ width: 1, flex: 1, background: palette.borderSoft, minHeight: 20 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: palette.ink, letterSpacing: '-0.005em' }}>{p.who}</span>
                  <span style={{ fontSize: 12, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace' }}>{p.handle}</span>
                  <span style={{ fontSize: 10, color: palette.inkMuted }}>·</span>
                  <span style={{ fontSize: 10.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{p.feed} · {p.time}</span>
                </div>
                {p.body && <p style={{ margin: '0 0 12px', fontSize: 15.5, lineHeight: 1.62, color: palette.ink, fontFamily: typeStack }}>{p.body}</p>}
                {p.quote && (
                  <blockquote style={{ margin: '4px 0 12px', padding: '10px 14px', borderLeft: `2px solid ${palette.stamp}`, background: palette.panelAlt, fontFamily: typeStack }}>
                    <div style={{ fontSize: 11.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', marginBottom: 4 }}>— {p.quote.who}</div>
                    <div style={{ fontSize: 14.5, lineHeight: 1.55, color: palette.inkSoft, fontStyle: 'italic' }}>{p.quote.body}</div>
                  </blockquote>
                )}
                {p.img && (
                  <div style={{ margin: '4px 0 12px', height: 180, background: `linear-gradient(135deg, ${palette.border} 0%, ${palette.panelAlt} 100%)`, position: 'relative', overflow: 'hidden' }}>
                    <svg viewBox="0 0 400 180" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4 }} preserveAspectRatio="none">
                      <path d="M0 140 Q100 110 180 130 T400 120 L400 180 L0 180 Z" fill={palette.inkSoft} />
                      <path d="M0 160 Q120 140 220 155 T400 150 L400 180 L0 180 Z" fill={palette.ink} opacity="0.5" />
                    </svg>
                    <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: palette.inkMuted, letterSpacing: '0.1em' }}>IMG.01 · 4.2MB</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 20, fontSize: 11.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.06em' }}>
                  <span style={{ cursor: 'pointer' }}>↺ {p.replies}</span>
                  <span style={{ cursor: 'pointer' }}>♡ {p.likes.toLocaleString()}</span>
                  <span style={{ cursor: 'pointer' }}>★</span>
                  <span style={{ cursor: 'pointer', marginLeft: 'auto' }}>↗ original</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
};

window.SocialView = SocialView;
