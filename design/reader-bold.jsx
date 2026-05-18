// Bold ink-wash reader — Variant B
// Editorial feed with dramatic ink-wash header, calligraphic chrome,
// vertical stamps, drop-cap hero, more atmosphere.

const BoldReader = ({ theme, fontFamily }) => {
  const [selectedItem, setSelectedItem] = React.useState('atlantic-5');
  const [starred, setStarred] = React.useState(new Set(['hn-1']));

  const palette = theme === 'ink-dark'
    ? { bg: '#0f1114', panel: '#14171b', panelAlt: '#0d0f12', border: '#262a30', borderSoft: '#1c2025', ink: '#e4ddc8', inkSoft: '#9a9385', inkMuted: '#5a564d', accent: '#d8a96a', stamp: '#c56b3f', wash: 'radial-gradient(ellipse 80% 120% at 20% 0%, rgba(216,169,106,0.12), transparent 60%), radial-gradient(ellipse 100% 80% at 100% 100%, rgba(197,107,63,0.09), transparent 65%)' }
    : theme === 'sepia'
    ? { bg: '#ede2c4', panel: '#f2e9cf', panelAlt: '#e3d6b0', border: '#c8b98f', borderSoft: '#d9cba5', ink: '#1f1a10', inkSoft: '#5a4e35', inkMuted: '#8a7e60', accent: '#8a4a1a', stamp: '#8a4a1a', wash: 'radial-gradient(ellipse 80% 100% at 10% 0%, rgba(138,74,26,0.12), transparent 60%), radial-gradient(ellipse 90% 70% at 100% 100%, rgba(31,26,16,0.08), transparent 65%)' }
    : { bg: '#eae2ce', panel: '#f0ebda', panelAlt: '#dfd6ba', border: '#c9bf9f', borderSoft: '#d9cfaf', ink: '#121110', inkSoft: '#4a4539', inkMuted: '#857d6a', accent: '#1a1814', stamp: '#a8542a', wash: 'radial-gradient(ellipse 80% 100% at 15% 0%, rgba(20,18,15,0.18), transparent 55%), radial-gradient(ellipse 100% 80% at 105% 100%, rgba(168,84,42,0.12), transparent 60%)' };

  const items = [
    { id: 'atlantic-5', feed: 'The Atlantic', mark: '雲', title: 'A brief defense\nof the paragraph', excerpt: 'We have spent two decades shortening everything we write. The paragraph — that patient, unfashionable unit of thought — deserves another look.', author: 'Anne Applebaum', len: '9 min', time: 'Yesterday' },
    { id: 'paris-1', feed: 'Paris Review', mark: '雨', title: 'On rain, and reading in rain', excerpt: 'Essay in seven parts. A childhood habit returned to: the companionship of a downpour and a long article, read slowly, at a window.', author: 'Yiyun Li', len: '22 min', time: 'Yesterday' },
    { id: 'nyt-3', feed: 'NYT Magazine', mark: '印', title: 'The unhurried persistence\nof the letter press', excerpt: 'In a basement in Queens, craftspeople keep a nineteenth-century technique alive — and, quietly, ask what we have left behind.', author: 'Sarah Liu', len: '14 min', time: '4 h' },
    { id: 'newyorker-2', feed: 'The New Yorker', mark: '紙', title: 'The man who keeps Tokyo\u2019s last handmade-paper mill running', excerpt: 'Seventy-four years old, working alone, producing sheets for the restoration of eleventh-century scrolls. A profile.', author: 'Hua Hsu', len: '19 min', time: '3 d' },
    { id: 'hn-1', feed: 'Hacker News', mark: '碼', title: 'Show HN: I spent a year writing a typesetting engine in Rust', excerpt: 'After working with LaTeX for a decade I wanted to see if the old algorithms could feel fast on modern hardware.', author: 'alex-typesets', len: '8 min', time: '2 h' },
  ];

  const current = items.find((i) => i.id === selectedItem) || items[0];
  const toggleStar = (id) => { const n = new Set(starred); n.has(id) ? n.delete(id) : n.add(id); setStarred(n); };

  const typeStack = {
    serif: '"Source Serif Pro", "Songti SC", Georgia, serif',
    sans: '"Inter", "PingFang SC", system-ui, sans-serif',
    kai: '"Ma Shan Zheng", "Kaiti SC", "STKaiti", serif',
    mono: '"JetBrains Mono", "Sarasa Mono SC", Menlo, monospace',
  }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  // Rice paper + subtle wash
  const paperTex = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' seed='5'/%3E%3CfeColorMatrix values='0 0 0 0 0.10 0 0 0 0 0.08 0 0 0 0 0.06 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E")`;

  // SVG ink-wash brush splash for the hero
  const InkWash = ({ opacity = 0.18, flip = false }) => (
    <svg viewBox="0 0 400 300" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity, mixBlendMode: theme === 'ink-dark' ? 'screen' : 'multiply', transform: flip ? 'scaleX(-1)' : 'none' }} preserveAspectRatio="none">
      <defs>
        <filter id="ink-blur"><feGaussianBlur stdDeviation="1.5" /></filter>
        <radialGradient id="ink-grad" cx="30%" cy="20%" r="90%">
          <stop offset="0%" stopColor={theme === 'ink-dark' ? '#d8a96a' : '#1a1814'} stopOpacity="0.9" />
          <stop offset="50%" stopColor={theme === 'ink-dark' ? '#d8a96a' : '#1a1814'} stopOpacity="0.4" />
          <stop offset="100%" stopColor={theme === 'ink-dark' ? '#d8a96a' : '#1a1814'} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M 20 80 C 80 40, 180 30, 260 70 C 320 100, 360 150, 380 220 C 300 260, 180 250, 90 220 C 40 200, 10 140, 20 80 Z" fill="url(#ink-grad)" filter="url(#ink-blur)" />
      <path d="M 40 110 C 120 90, 200 100, 280 130 C 260 170, 160 180, 60 160 C 40 145, 30 125, 40 110 Z" fill="url(#ink-grad)" opacity="0.6" filter="url(#ink-blur)" />
    </svg>
  );

  const stamp = (label, size = 36) => (
    <div style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: palette.stamp, color: palette.panel, fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: size * 0.55, border: `1.5px solid ${palette.stamp}`, boxShadow: `inset 0 0 0 2px ${palette.panel}, 0 0 0 1px ${palette.stamp}` }}>{label}</div>
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: palette.bg, backgroundImage: paperTex, color: palette.ink, fontFamily: typeStack, fontSize: 14, overflow: 'hidden' }}>
      {/* ── Rail ──────────────────────────────────── */}
      <aside style={{ width: 64, flexShrink: 0, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0' }}>
        <div style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 26, color: palette.ink, writingMode: 'vertical-rl', letterSpacing: '0.15em', lineHeight: 1 }}>墨雨</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center' }}>
          {[{g: 'All', mk: '全'}, {g: 'Tech', mk: '技'}, {g: 'News', mk: '文'}, {g: 'Essay', mk: '思'}, {g: 'Star', mk: '星'}].map((x, i) => (
            <button key={x.g} title={x.g} style={{ width: 34, height: 34, border: i === 0 ? `1px solid ${palette.stamp}` : `1px solid transparent`, background: i === 0 ? 'transparent' : 'transparent', color: i === 0 ? palette.stamp : palette.inkMuted, fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 15, cursor: 'pointer', padding: 0 }}>{x.mk}</button>
          ))}
        </div>
        <div style={{ writingMode: 'vertical-rl', fontSize: 9.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.3em', textTransform: 'uppercase', paddingBottom: 8 }}>InkRain · v0.3</div>
      </aside>

      {/* ── Feed list ─────────────────────────────── */}
      <section style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${palette.border}`, display: 'flex', flexDirection: 'column', background: palette.panel, position: 'relative' }}>
        <div style={{ position: 'relative', padding: '28px 24px 22px', borderBottom: `1px solid ${palette.borderSoft}`, overflow: 'hidden' }}>
          <InkWash opacity={theme === 'ink-dark' ? 0.35 : 0.14} />
          <div style={{ position: 'relative' }}>
            <div style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 38, lineHeight: 1, color: palette.ink, marginBottom: 6 }}>今日 · 雨</div>
            <div style={{ fontSize: 11, letterSpacing: '0.25em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace' }}>Tue · 38 unread · light drizzle</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0 24px' }}>
          {items.map((it, idx) => {
            const active = selectedItem === it.id;
            const isStar = starred.has(it.id);
            return (
              <article key={it.id} onClick={() => setSelectedItem(it.id)} style={{ padding: '18px 24px 18px', cursor: 'pointer', position: 'relative', background: active ? (theme === 'ink-dark' ? 'rgba(216,169,106,0.06)' : 'rgba(26,24,20,0.05)') : 'transparent', borderBottom: `1px solid ${palette.borderSoft}` }}>
                {active && <span style={{ position: 'absolute', left: 0, top: 18, bottom: 18, width: 3, background: palette.stamp }} />}
                <div style={{ display: 'flex', gap: 14 }}>
                  <div style={{ flexShrink: 0, width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 18, color: palette.stamp, border: `1px solid ${palette.stamp}`, opacity: 0.92 }}>{it.mark}</div>
                    <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 8.5, color: palette.inkMuted, letterSpacing: '0.15em' }}>{String(idx + 1).padStart(2, '0')}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5, letterSpacing: '0.22em', textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 4 }}>{it.feed} · {it.time}</div>
                    <h3 style={{ margin: '0 0 6px', fontSize: 17, lineHeight: 1.22, fontWeight: 500, color: palette.ink, fontFamily: typeStack, letterSpacing: '-0.01em', whiteSpace: 'pre-line' }}>{it.title}</h3>
                    <p style={{ margin: '0 0 8px', fontSize: 12.5, lineHeight: 1.55, color: palette.inkSoft, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.excerpt}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em' }}>
                      <span>{it.author}</span>
                      <span style={{ width: 3, height: 3, borderRadius: 2, background: palette.inkMuted }} />
                      <span>{it.len}</span>
                      {isStar && <span style={{ marginLeft: 'auto', color: palette.stamp }}>★</span>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Reader ────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', background: palette.panel }}>
        {/* Action rail — vertical on right edge */}
        <div style={{ position: 'absolute', right: 20, top: 80, display: 'flex', flexDirection: 'column', gap: 18, zIndex: 2 }}>
          {[
            { k: '★', a: 'star', on: starred.has(current.id) },
            { k: '⧖', a: 'later' },
            { k: '✎', a: 'note' },
            { k: '↗', a: 'open' },
            { k: '⊕', a: 'ai' },
          ].map((b) => (
            <button key={b.a} onClick={() => b.a === 'star' && toggleStar(current.id)} title={b.a} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${b.on ? palette.stamp : palette.borderSoft}`, background: 'transparent', color: b.on ? palette.stamp : palette.inkSoft, fontSize: 14, cursor: 'pointer', fontFamily: typeStack }}>{b.k}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Hero with ink wash */}
          <div style={{ position: 'relative', padding: '64px 72px 44px 72px', overflow: 'hidden', background: palette.wash }}>
            <InkWash opacity={theme === 'ink-dark' ? 0.5 : 0.22} />
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 30 }}>
                {stamp(current.mark, 44)}
                <div>
                  <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: palette.inkMuted }}>{current.feed} · ISSUE NO. 142</div>
                  <div style={{ fontSize: 13, color: palette.inkSoft, marginTop: 3, fontFamily: typeStack }}>by {current.author} · {current.len} read</div>
                </div>
              </div>
              <h1 style={{ fontFamily: typeStack, fontSize: 64, lineHeight: 1.02, fontWeight: 400, letterSpacing: '-0.025em', color: palette.ink, margin: '0 0 24px', whiteSpace: 'pre-line', maxWidth: 680 }}>{current.title}</h1>
              <div style={{ fontFamily: typeStack, fontSize: 18, lineHeight: 1.55, color: palette.inkSoft, fontStyle: 'italic', maxWidth: 620 }}>{current.excerpt}</div>

              <div style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 20 }}>
                <div style={{ flex: 1, height: 1, background: palette.border }} />
                <div style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 22, color: palette.stamp, letterSpacing: '0.3em' }}>墨　雨</div>
                <div style={{ flex: 1, height: 1, background: palette.border }} />
              </div>
            </div>
          </div>

          {/* Body */}
          <article style={{ maxWidth: 680, margin: '0 auto', padding: '48px 48px 100px', fontFamily: typeStack, fontSize: 17.5, lineHeight: 1.78, color: palette.ink }}>
            <p style={{ margin: '0 0 26px' }}>
              <span style={{ float: 'left', fontFamily: typeStack, fontSize: 96, lineHeight: 0.82, paddingRight: 14, paddingTop: 6, fontWeight: 400, color: palette.stamp }}>A</span>
              paragraph is a small act of patience. It has a beginning, a direction, and — if the writer is lucky and attentive — an ending that was not obvious at the start. For most of literate history, the paragraph was the basic unit in which thinking happened on a page. It could be brisk; it could be long. It could change its mind halfway through.
            </p>
            <p style={{ margin: '0 0 26px' }}>The internet has not been kind to it. The feed asks for the sentence. The post asks for the aphorism. The thread asks for the bullet. Paragraphs, meanwhile, keep insisting on their old rhythm, and we no longer have the attention to keep up.</p>
            <div style={{ margin: '40px -20px', padding: '0 60px', textAlign: 'center', position: 'relative' }}>
              <div style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 36, color: palette.stamp, opacity: 0.9 }}>※</div>
            </div>
            <blockquote style={{ margin: '0 0 32px', padding: '0 0 0 26px', borderLeft: `2px solid ${palette.stamp}`, fontFamily: typeStack, fontStyle: 'italic', fontSize: 22, lineHeight: 1.5, color: palette.inkSoft, fontWeight: 400 }}>
              There is a particular pleasure, unfashionable now, in following a writer\u2019s mind as it turns a thought over for three hundred words without hurrying to the point.
            </blockquote>
            <p style={{ margin: '0 0 26px' }}>This essay is an argument for restoring that pleasure to our daily reading. Not as a curiosity — not as a throwback — but as a habit. The paragraph rewards the reader who stays with it.</p>
            <p style={{ margin: '0 0 26px', color: palette.inkSoft }}>Consider the opening of a nineteenth-century essayist — any of them; pick your own favorite — and notice how the first sentence does almost nothing except gesture at the territory ahead. Notice how the second narrows. How the third finds the question the paragraph will actually try to answer.</p>

            <footer style={{ marginTop: 64, paddingTop: 28, borderTop: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 22, color: palette.stamp }}>— 終 —</div>
              <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.inkMuted }}>theatlantic.com · #{current.id}</div>
            </footer>
          </article>
        </div>
      </main>
    </div>
  );
};

window.BoldReader = BoldReader;
