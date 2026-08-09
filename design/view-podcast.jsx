// PODCAST view — now-playing player + chapters + queue
// Radio / cassette aesthetic but keeping ink-wash language

const PodcastView = ({ theme, fontFamily }) => {
  const [playing, setPlaying] = React.useState(true);
  const [progress, setProgress] = React.useState(0.42);

  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', accent: '#d8a96a', stamp: '#c56b3f' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', accent: '#8a4a1a', stamp: '#8a4a1a' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', accent: '#1a1814', stamp: '#a8542a' };

  const typeStack = {
    serif: '"Source Serif Pro", Georgia, serif',
    sans: '"Inter", system-ui, sans-serif',
    kai: '"Ma Shan Zheng", "Kaiti SC", serif',
    mono: '"JetBrains Mono", Menlo, monospace',
  }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const nowPlaying = {
    title: 'The last handmade-paper mill',
    show: 'Longform Review',
    host: 'Evan Ratliff',
    ep: '#487',
    duration: '1:14:22',
    current: '31:08',
    mark: '聲',
  };

  const chapters = [
    { t: '00:00', title: 'Cold open — a knock at a wooden door', done: true },
    { t: '04:12', title: 'Arrival in Tokyo: the neighborhood of Ogawamachi', done: true },
    { t: '12:48', title: 'The mill\u2019s history, 1847 onward', done: true },
    { t: '24:33', title: 'Meeting Mr. Kubo, age 74', done: true },
    { t: '31:08', title: 'The physics of a single sheet of kozo paper', done: false, current: true },
    { t: '42:20', title: 'What the eleventh-century scrolls demand', done: false },
    { t: '56:04', title: 'On succession: who is left to learn this?', done: false },
    { t: '1:08:11', title: 'Outro — a sheet held up to the light', done: false },
  ];

  const queue = [
    { mark: '聲', show: 'Hard Fork', title: 'The quiet return of RSS', dur: '48:22' },
    { mark: '談', show: 'Ezra Klein Show', title: 'Why long reading still matters', dur: '1:02:15' },
    { mark: '韻', show: 'Song Exploder', title: 'Mitski on Bug Like an Angel', dur: '22:08' },
    { mark: '述', show: '聲东击西', title: '互联网的信息饥饿年代', dur: '58:40' },
  ];

  const paperTex = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' seed='9'/%3E%3CfeColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

  // Waveform placeholder
  const Wave = ({ h = 60, prog = 0.42 }) => {
    const bars = Array.from({ length: 120 }, (_, i) => 0.2 + 0.8 * Math.abs(Math.sin(i * 0.4) * Math.cos(i * 0.13)));
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: h, width: '100%' }}>
        {bars.map((v, i) => (
          <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: i / bars.length < prog ? palette.stamp : palette.inkMuted, opacity: i / bars.length < prog ? 0.9 : 0.35 }} />
        ))}
      </div>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, backgroundImage: paperTex, color: palette.ink, fontFamily: typeStack, overflow: 'hidden' }}>
      {/* rail */}
      <aside style={{ width: 64, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{mk: '全'}, {mk: '文'}, {mk: '言'}, {mk: '聲', on: true}, {mk: '影'}, {mk: '圖'}].map((x, i) => (
            <div key={i} style={{ width: 34, height: 34, border: x.on ? `1px solid ${palette.stamp}` : '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: x.on ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", serif', fontSize: 15 }}>{x.mk}</div>
          ))}
        </div>
      </aside>

      {/* queue column */}
      <section style={{ width: 300, borderRight: `1px solid ${palette.border}`, background: palette.panel, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '24px 22px 18px', borderBottom: `1px solid ${palette.borderSoft}` }}>
          <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 34, lineHeight: 1, color: palette.ink }}>聲 · Listen</div>
          <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', marginTop: 6 }}>Up next · 4 episodes</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {queue.map((q, i) => (
            <div key={i} style={{ padding: '14px 22px', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, flexShrink: 0, background: palette.stamp, color: palette.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 19, boxShadow: `inset 0 0 0 2px ${palette.panel}, 0 0 0 1px ${palette.stamp}` }}>{q.mark}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', marginBottom: 2 }}>{q.show}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.35, color: palette.ink }}>{q.title}</div>
                <div style={{ fontSize: 10.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', marginTop: 3 }}>{q.dur}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* now-playing + chapters */}
      <main style={{ flex: 1, overflowY: 'auto', background: palette.panel, minWidth: 0 }}>
        <div style={{ padding: '40px 56px 32px', borderBottom: `1px solid ${palette.borderSoft}`, background: `radial-gradient(ellipse 80% 120% at 20% 0%, ${theme === 'ink-dark' ? 'rgba(216,169,106,0.09)' : 'rgba(26,24,20,0.09)'}, transparent 65%)` }}>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
            {/* large stamp "cover" */}
            <div style={{ flexShrink: 0, width: 180, height: 180, background: palette.stamp, color: palette.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 96, boxShadow: `inset 0 0 0 6px ${palette.panel}, 0 0 0 2px ${palette.stamp}, 0 12px 40px rgba(0,0,0,0.15)` }}>{nowPlaying.mark}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 8 }}>{nowPlaying.show} · Episode {nowPlaying.ep}</div>
              <h1 style={{ margin: '0 0 14px', fontFamily: typeStack, fontSize: 40, lineHeight: 1.08, letterSpacing: '-0.02em', fontWeight: 500, color: palette.ink }}>{nowPlaying.title}</h1>
              <div style={{ fontSize: 13.5, color: palette.inkSoft, marginBottom: 18 }}>With {nowPlaying.host} · Recorded in Tokyo, March 2026</div>
              {/* waveform */}
              <Wave h={48} prog={progress} />
              {/* controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 18 }}>
                <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: palette.inkSoft, letterSpacing: '0.08em' }}>{nowPlaying.current} / {nowPlaying.duration}</div>
                <div style={{ flex: 1 }} />
                {['⟲ 15', '⏮', playing ? '⏸' : '▶', '⏭', '15 ⟳'].map((b, i) => (
                  <button key={i} onClick={() => i === 2 && setPlaying(!playing)} style={{ width: i === 2 ? 46 : 34, height: i === 2 ? 46 : 34, border: `1px solid ${i === 2 ? palette.stamp : palette.borderSoft}`, background: i === 2 ? palette.stamp : 'transparent', color: i === 2 ? palette.panel : palette.ink, fontSize: i === 2 ? 15 : 12, cursor: 'pointer', fontFamily: typeStack }}>{b}</button>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: palette.inkMuted, letterSpacing: '0.1em' }}>1.0× · SLEEP 30m</div>
              </div>
            </div>
          </div>
        </div>

        {/* chapters */}
        <div style={{ padding: '36px 56px 80px', maxWidth: 780 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
            <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 24, color: palette.ink, letterSpacing: '0.1em' }}>章 · Chapters</div>
            <div style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: palette.inkMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{chapters.length} marks · transcript available</div>
          </div>
          {chapters.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 20, padding: '14px 0', borderBottom: i < chapters.length - 1 ? `1px solid ${palette.borderSoft}` : 'none', cursor: 'pointer', opacity: c.done ? 0.55 : 1 }}>
              <div style={{ width: 60, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: c.current ? palette.stamp : palette.inkMuted, fontWeight: c.current ? 600 : 400, letterSpacing: '0.04em', flexShrink: 0 }}>{c.t}</div>
              <div style={{ flex: 1, fontSize: 15, lineHeight: 1.45, color: c.current ? palette.ink : palette.inkSoft, fontWeight: c.current ? 500 : 400 }}>{c.title}</div>
              {c.current && <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 14, color: palette.stamp, flexShrink: 0 }}>▸ 現正播放</div>}
              {c.done && !c.current && <div style={{ fontSize: 12, color: palette.inkMuted, flexShrink: 0 }}>✓</div>}
            </div>
          ))}

          <div style={{ marginTop: 36, padding: '18px 0 0', borderTop: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 18, color: palette.stamp, letterSpacing: '0.2em' }}>— 聆 —</div>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: palette.inkMuted }}>longformpod.com · MP3 · 62.4 MB</div>
          </div>
        </div>
      </main>
    </div>
  );
};

window.PodcastView = PodcastView;
