// IMAGE view — masonry grid
const ImageView = ({ theme, fontFamily }) => {
  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', stamp: '#c56b3f' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', stamp: '#8a4a1a' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', stamp: '#a8542a' };
  const typeStack = { serif: '"Source Serif Pro", Georgia, serif', sans: '"Inter", system-ui, sans-serif', kai: '"Ma Shan Zheng", serif', mono: '"JetBrains Mono", Menlo, monospace' }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const pics = [
    { h: 280, mk: '山', who: '@todayscolors', cap: 'Yellow Mountain, before rain', tag: 'landscape' },
    { h: 340, mk: '茶', who: '@teahouse.tokyo', cap: 'First morning tea, Ogawamachi', tag: 'still life' },
    { h: 220, mk: '書', who: '@books.of.wander', cap: 'A borrowed copy of Calvino', tag: 'interior' },
    { h: 380, mk: '街', who: '@streetscapes', cap: 'Kyoto, 6:14am', tag: 'street' },
    { h: 260, mk: '海', who: '@tidallines', cap: 'Low tide at Enoshima', tag: 'landscape' },
    { h: 310, mk: '光', who: '@quietwindows', cap: 'A room full of afternoon', tag: 'interior' },
    { h: 240, mk: '花', who: '@ikebana.daily', cap: 'One stem of camellia', tag: 'still life' },
    { h: 360, mk: '雪', who: '@todayscolors', cap: 'First snow, Hokkaido', tag: 'landscape' },
    { h: 200, mk: '墨', who: '@brushandink', cap: 'Practice sheet, 47th attempt', tag: 'art' },
  ];

  const paperTex = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' seed='11'/%3E%3CfeColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, backgroundImage: paperTex, color: palette.ink, fontFamily: typeStack, overflow: 'hidden' }}>
      <aside style={{ width: 64, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0', flexShrink: 0 }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{mk: '全'}, {mk: '文'}, {mk: '言'}, {mk: '聲'}, {mk: '影'}, {mk: '圖', on: true}].map((x, i) => (
            <div key={i} style={{ width: 34, height: 34, border: x.on ? `1px solid ${palette.stamp}` : '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: x.on ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", serif', fontSize: 15 }}>{x.mk}</div>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', background: palette.panel }}>
        <div style={{ padding: '32px 40px 20px', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: '"Ma Shan Zheng", serif', fontSize: 36, lineHeight: 1, color: palette.ink }}>圖 · Image</div>
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', marginTop: 6 }}>9 feeds · 148 new this week</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Grid', 'Column', 'Single'].map((m, i) => (
              <div key={m} style={{ padding: '5px 10px', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase', color: i === 0 ? palette.ink : palette.inkMuted, border: i === 0 ? `1px solid ${palette.ink}` : '1px solid transparent' }}>{m}</div>
            ))}
          </div>
        </div>

        <div style={{ padding: '24px 40px 60px', columnCount: 3, columnGap: 18 }}>
          {pics.map((p, i) => (
            <figure key={i} style={{ breakInside: 'avoid', margin: '0 0 18px', position: 'relative' }}>
              <div style={{ height: p.h, background: `linear-gradient(${135 + i * 20}deg, ${palette.panelAlt}, ${palette.border})`, position: 'relative', overflow: 'hidden', border: `1px solid ${palette.borderSoft}` }}>
                <svg viewBox="0 0 300 400" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.35 }} preserveAspectRatio="none">
                  <path d={`M 0 ${200 + i * 10} Q 80 ${150 + i * 15} 160 ${180 + i * 8} T 300 ${160} L 300 400 L 0 400 Z`} fill={palette.inkSoft} />
                  <path d={`M 0 ${280} Q 100 ${250} 200 ${270} T 300 ${260} L 300 400 L 0 400 Z`} fill={palette.ink} opacity="0.5" />
                </svg>
                <div style={{ position: 'absolute', top: 8, left: 8, width: 28, height: 28, background: palette.stamp, color: palette.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", serif', fontSize: 14, boxShadow: `inset 0 0 0 1.5px ${palette.panel}` }}>{p.mk}</div>
              </div>
              <figcaption style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 2px 0', fontSize: 12 }}>
                <span style={{ color: palette.ink }}>{p.cap}</span>
              </figcaption>
              <div style={{ padding: '2px 2px', fontSize: 10.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.06em' }}>{p.who} · #{p.tag}</div>
            </figure>
          ))}
        </div>
      </main>
    </div>
  );
};
window.ImageView = ImageView;
