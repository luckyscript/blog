// VIDEO view — embedded playback with chapter list + ink-frame

const VideoView = ({ theme, fontFamily }) => {
  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', stamp: '#c56b3f' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', stamp: '#8a4a1a' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', stamp: '#a8542a' };

  const typeStack = { serif: '"Source Serif Pro", Georgia, serif', sans: '"Inter", system-ui, sans-serif', kai: '"Ma Shan Zheng", serif', mono: '"JetBrains Mono", Menlo, monospace' }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const related = [
    { mark: '影', ch: 'Nerdwriter1', title: 'How Wes Anderson uses symmetry', dur: '8:42', views: '1.2M' },
    { mark: '光', ch: 'Every Frame a Painting', title: 'The spielberg oner', dur: '9:14', views: '2.8M' },
    { mark: '幕', ch: 'Kaptain Kristian', title: 'Letterboxing — why films aren\u2019t square', dur: '6:38', views: '420K' },
    { mark: '鏡', ch: '李永樂老師', title: '电影院的银幕为什么不发光', dur: '12:20', views: '380K' },
  ];

  const paperTex = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, backgroundImage: paperTex, color: palette.ink, fontFamily: typeStack, overflow: 'hidden' }}>
      <aside style={{ width: 64, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{mk: '全'}, {mk: '文'}, {mk: '言'}, {mk: '聲'}, {mk: '影', on: true}, {mk: '圖'}].map((x, i) => (
            <div key={i} style={{ width: 34, height: 34, border: x.on ? `1px solid ${palette.stamp}` : '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: x.on ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", serif', fontSize: 15 }}>{x.mk}</div>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', background: palette.panel }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 48px 80px' }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 6 }}>YouTube · Every Frame a Painting · 4 months ago</div>
          <h1 style={{ margin: '0 0 18px', fontFamily: typeStack, fontSize: 34, lineHeight: 1.12, fontWeight: 500, letterSpacing: '-0.018em', color: palette.ink }}>The language of ink — what Asian cinema learned from brush painting</h1>

          {/* player */}
          <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0a0a0a', border: `1px solid ${palette.border}`, overflow: 'hidden' }}>
            <svg viewBox="0 0 800 450" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid slice">
              <defs>
                <radialGradient id="mist" cx="40%" cy="30%" r="70%"><stop offset="0%" stopColor="#3a3530" /><stop offset="100%" stopColor="#0a0a0a" /></radialGradient>
              </defs>
              <rect width="800" height="450" fill="url(#mist)" />
              <path d="M 100 280 Q 220 180 340 260 Q 460 340 580 240 Q 700 160 800 220 L 800 450 L 0 450 Z" fill="#1a1510" opacity="0.85" />
              <path d="M 0 340 Q 180 300 340 330 Q 520 360 800 320 L 800 450 L 0 450 Z" fill="#0d0a08" />
              <circle cx="600" cy="120" r="44" fill="#e8d9b0" opacity="0.35" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, cursor: 'pointer' }}>▶</div>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 16px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', color: '#fff' }}>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.3)', marginBottom: 10 }}><div style={{ height: '100%', width: '38%', background: palette.stamp }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5 }}>
                <span>⏸</span><span>⏭</span><span>🔊</span><span>5:23 / 14:08</span><span style={{ marginLeft: 'auto' }}>⚙ 1080p</span><span>⛶</span>
              </div>
            </div>
          </div>

          {/* meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 0', borderBottom: `1px solid ${palette.borderSoft}` }}>
            <div style={{ width: 44, height: 44, background: palette.stamp, color: palette.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 22, boxShadow: `inset 0 0 0 2px ${palette.panel}, 0 0 0 1px ${palette.stamp}` }}>影</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: palette.ink }}>Every Frame a Painting</div>
              <div style={{ fontSize: 11.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em' }}>1.4M subscribers · 142K views</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {['★ Save', '⧖ Later', '↗ YouTube'].map((b) => (
                <button key={b} style={{ padding: '7px 14px', border: `1px solid ${palette.borderSoft}`, background: 'transparent', color: palette.ink, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer' }}>{b}</button>
              ))}
            </div>
          </div>

          <div style={{ padding: '22px 0', borderBottom: `1px solid ${palette.borderSoft}`, fontSize: 14.5, lineHeight: 1.7, color: palette.inkSoft, maxWidth: 680 }}>
            An essay on how the rhythm of traditional Chinese and Japanese brush painting — its pauses, its empty space, its single-gesture commitments — shaped the visual grammar of filmmakers from Ozu to Wong Kar-wai.
          </div>

          <div style={{ marginTop: 28 }}>
            <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 22, color: palette.ink, marginBottom: 14, letterSpacing: '0.1em' }}>相關 · Related</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {related.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, cursor: 'pointer' }}>
                  <div style={{ width: 140, aspectRatio: '16/9', background: palette.panelAlt, position: 'relative', flexShrink: 0, border: `1px solid ${palette.borderSoft}` }}>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 34, color: palette.stamp, opacity: 0.7 }}>{r.mark}</div>
                    <div style={{ position: 'absolute', bottom: 4, right: 5, fontSize: 10, fontFamily: '"JetBrains Mono", monospace', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '1px 4px' }}>{r.dur}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.35, color: palette.ink, marginBottom: 4 }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace' }}>{r.ch} · {r.views}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

window.VideoView = VideoView;
