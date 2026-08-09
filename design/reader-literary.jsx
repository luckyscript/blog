// Restrained literary reader — Variant A
// Three-pane: sidebar, feed list, article. Cream paper, restrained ink tones.

const LitReader = ({ theme, fontFamily }) => {
  const [selectedFeed, setSelectedFeed] = React.useState('all');
  const [selectedItem, setSelectedItem] = React.useState('nyt-3');
  const [starred, setStarred] = React.useState(new Set(['hn-1', 'verge-2']));

  const palette = theme === 'ink-dark'
    ? { bg: '#15171a', panel: '#1a1d21', panelAlt: '#191c20', border: '#262a2f', borderSoft: '#1f2327', ink: '#d9d4c7', inkSoft: '#9a948a', inkMuted: '#63605a', accent: '#c2bfa3', unread: '#d9d4c7', stamp: '#a8663a' }
    : theme === 'sepia'
    ? { bg: '#f2ebd9', panel: '#f6f0de', panelAlt: '#ece3cd', border: '#d9cfb4', borderSoft: '#e5dcc5', ink: '#2a251d', inkSoft: '#5b5243', inkMuted: '#8a8170', accent: '#5b5243', unread: '#2a251d', stamp: '#a8663a' }
    : { bg: '#f5f1e8', panel: '#faf7ee', panelAlt: '#f0ebdd', border: '#e2dcc8', borderSoft: '#ebe4cf', ink: '#1a1814', inkSoft: '#4a463d', inkMuted: '#847f73', accent: '#2a251f', unread: '#1a1814', stamp: '#a8663a' };

  const feeds = [
    { id: 'all', name: 'All articles', count: 142, group: null },
    { id: 'tech', name: 'Technology', count: 48, group: 'header' },
    { id: 'hn', name: 'Hacker News', count: 23, group: 'child', mark: '技' },
    { id: 'verge', name: 'The Verge', count: 12, group: 'child', mark: '技' },
    { id: 'arstech', name: 'Ars Technica', count: 8, group: 'child', mark: '技' },
    { id: 'stratech', name: 'Stratechery', count: 5, group: 'child', mark: '技' },
    { id: 'news', name: 'News & world', count: 62, group: 'header' },
    { id: 'nyt', name: 'NYT Magazine', count: 17, group: 'child', mark: '文' },
    { id: 'newyorker', name: 'The New Yorker', count: 9, group: 'child', mark: '文' },
    { id: 'atlantic', name: 'The Atlantic', count: 14, group: 'child', mark: '文' },
    { id: 'essay', name: 'Essays', count: 32, group: 'header' },
    { id: 'paris', name: 'Paris Review', count: 6, group: 'child', mark: '思' },
    { id: 'lithub', name: 'Lit Hub', count: 11, group: 'child', mark: '思' },
  ];

  const items = [
    { id: 'nyt-3', feed: 'NYT Magazine', mark: '文', title: 'The unhurried persistence of the letter press', excerpt: 'In a basement in Queens, a handful of craftspeople keep a nineteenth-century printing technique alive — and, in doing so, ask quiet questions about what we\u2019ve left behind.', author: 'Sarah Liu', time: '4 h', unread: false, len: '14 min' },
    { id: 'hn-1', feed: 'Hacker News', mark: '技', title: 'Show HN: I spent a year writing a typesetting engine in Rust', excerpt: 'After working with LaTeX for a decade I wanted to see if the old algorithms could feel fast on modern hardware. Some notes on what surprised me.', author: 'alex-typesets', time: '2 h', unread: true, len: '8 min' },
    { id: 'verge-2', feed: 'The Verge', mark: '技', title: 'Why the web quietly became a place for slow reading again', excerpt: 'RSS never died — it went underground, and came back wearing different clothes. A walk through the small renaissance of reader apps.', author: 'Nilay Patel', time: '6 h', unread: true, len: '11 min' },
    { id: 'atlantic-5', feed: 'The Atlantic', mark: '文', title: 'A brief defense of the paragraph', excerpt: 'We have spent two decades shortening everything we write. The paragraph — that patient, unfashionable unit of thought — deserves another look.', author: 'Anne Applebaum', time: '1 d', unread: true, len: '9 min' },
    { id: 'paris-1', feed: 'Paris Review', mark: '思', title: 'On rain, and reading in rain', excerpt: 'Essay in seven parts. The author returns to a childhood habit: the companionship of a downpour and a long article, read slowly, at a window.', author: 'Yiyun Li', time: '1 d', unread: false, len: '22 min' },
    { id: 'arstech-9', feed: 'Ars Technica', mark: '技', title: 'A field guide to the languages that ship with macOS', excerpt: 'Apple quietly includes eight programming languages in every install. We tried to write the same small program in each.', author: 'John Timmer', time: '2 d', unread: true, len: '17 min' },
    { id: 'newyorker-2', feed: 'The New Yorker', mark: '文', title: 'The man who keeps Tokyo\u2019s last handmade-paper mill running', excerpt: 'Seventy-four years old, working alone, producing sheets used for the restoration of eleventh-century scrolls. A profile.', author: 'Hua Hsu', time: '3 d', unread: true, len: '19 min' },
    { id: 'stratech-3', feed: 'Stratechery', mark: '技', title: 'Aggregation theory and the attention of the reader', excerpt: 'The feed ate the newspaper. Then the algorithm ate the feed. What if the next layer turns out to be smaller and quieter than any of them?', author: 'Ben Thompson', time: '3 d', unread: false, len: '13 min' },
  ];

  const current = items.find((i) => i.id === selectedItem) || items[0];

  const toggleStar = (id) => {
    const n = new Set(starred);
    n.has(id) ? n.delete(id) : n.add(id);
    setStarred(n);
  };

  const typeStack = {
    serif: '"Source Serif Pro", "Songti SC", "Noto Serif SC", Georgia, serif',
    sans: '"Inter", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
    kai: '"Ma Shan Zheng", "Kaiti SC", "STKaiti", "Noto Serif SC", serif',
    mono: '"JetBrains Mono", "Sarasa Mono SC", Menlo, monospace',
  }[fontFamily] || '"Source Serif Pro", Georgia, serif';

  const readingFont = fontFamily === 'sans' ? typeStack : typeStack;

  // Subtle rice-paper texture via SVG
  const paperBg = theme === 'ink-dark'
    ? palette.bg
    : `${palette.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.12 0 0 0 0 0.10 0 0 0 0 0.07 0 0 0 0.035 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E")`;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: paperBg, color: palette.ink, fontFamily: readingFont, fontSize: 14, overflow: 'hidden' }}>
      {/* ── Sidebar ───────────────────────────────── */}
      <aside style={{ width: 244, flexShrink: 0, borderRight: `1px solid ${palette.border}`, background: palette.panelAlt, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '22px 22px 14px', borderBottom: `1px solid ${palette.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 32, lineHeight: 1, color: palette.ink, fontWeight: 400 }}>墨雨</span>
            <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: palette.inkMuted }}>InkRain</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: palette.inkMuted, fontStyle: 'italic', lineHeight: 1.5 }}>如雨落墨，静心阅读</div>
        </div>

        <div style={{ padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
          {[{ id: 'unread', label: 'Unread', n: 38 }, { id: 'starred', label: 'Starred', n: 14 }, { id: 'later', label: 'Read later', n: 7 }].map((v) => (
            <button key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', border: 'none', background: 'transparent', color: palette.inkSoft, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', borderRadius: 2, textAlign: 'left' }}>
              <span>{v.label}</span>
              <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: palette.inkMuted }}>{v.n}</span>
            </button>
          ))}

          <div style={{ height: 1, background: palette.borderSoft, margin: '12px 4px' }} />

          {feeds.map((f) => {
            if (f.group === 'header') return (
              <div key={f.id} style={{ padding: '14px 10px 4px', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace' }}>
                {f.name}
              </div>
            );
            const active = selectedFeed === f.id;
            return (
              <button key={f.id} onClick={() => setSelectedFeed(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: 'none', background: active ? palette.panel : 'transparent', color: active ? palette.ink : palette.inkSoft, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', borderRadius: 2, textAlign: 'left', borderLeft: active ? `2px solid ${palette.accent}` : '2px solid transparent', marginLeft: f.group === 'child' ? 0 : 0 }}>
                {f.mark && <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 11, color: palette.stamp, border: `0.5px solid ${palette.stamp}`, opacity: 0.75 }}>{f.mark}</span>}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: palette.inkMuted }}>{f.count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ borderTop: `1px solid ${palette.borderSoft}`, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: palette.inkMuted }}>
          <span>Synced 4m ago</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>v0.3</span>
        </div>
      </aside>

      {/* ── Feed list ─────────────────────────────── */}
      <section style={{ width: 360, flexShrink: 0, borderRight: `1px solid ${palette.border}`, background: palette.panel, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${palette.borderSoft}` }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', marginBottom: 6 }}>
            {feeds.find(f => f.id === selectedFeed)?.name || 'All articles'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em' }}>Today &middot; Tuesday</div>
            <div style={{ fontSize: 11.5, color: palette.inkMuted, fontVariantNumeric: 'tabular-nums' }}>{items.length} entries</div>
          </div>
        </header>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.map((it) => {
            const active = selectedItem === it.id;
            const isStar = starred.has(it.id);
            return (
              <article key={it.id} onClick={() => setSelectedItem(it.id)} style={{ padding: '14px 22px 16px', borderBottom: `1px solid ${palette.borderSoft}`, cursor: 'pointer', background: active ? (theme === 'ink-dark' ? 'rgba(194,191,163,0.07)' : 'rgba(0,0,0,0.03)') : 'transparent', borderLeft: active ? `2px solid ${palette.accent}` : '2px solid transparent', paddingLeft: active ? 20 : 22, position: 'relative' }}>
                {it.unread && <span style={{ position: 'absolute', left: 8, top: 21, width: 5, height: 5, borderRadius: '50%', background: palette.unread }} />}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, fontSize: 10.5, color: palette.inkMuted, letterSpacing: '0.05em' }}>
                  <span style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 9.5, color: palette.stamp, border: `0.5px solid ${palette.stamp}`, opacity: 0.8 }}>{it.mark}</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{it.feed}</span>
                  <span>·</span>
                  <span>{it.time}</span>
                  {isStar && <span style={{ marginLeft: 'auto', color: palette.stamp, fontSize: 10 }}>★</span>}
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, lineHeight: 1.35, fontWeight: it.unread ? 600 : 500, color: palette.ink, letterSpacing: '-0.005em' }}>{it.title}</h3>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: palette.inkSoft, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.excerpt}</p>
                <div style={{ marginTop: 8, fontSize: 10.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em' }}>{it.author} &middot; {it.len}</div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Article ───────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: palette.panel, minWidth: 0 }}>
        <div style={{ padding: '14px 28px', borderBottom: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: palette.inkMuted }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            <span>{current.feed}</span>
            <span>·</span>
            <span>{current.len} read</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {['Star', 'Later', 'Full text', 'Open'].map((a, i) => (
              <button key={a} onClick={() => a === 'Star' && toggleStar(current.id)} style={{ border: 'none', background: 'transparent', color: a === 'Star' && starred.has(current.id) ? palette.stamp : palette.inkSoft, fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer', padding: 0, letterSpacing: '0.04em' }}>
                {a === 'Star' && starred.has(current.id) ? '★ Starred' : a}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <article style={{ maxWidth: 640, margin: '0 auto', padding: '56px 40px 80px' }}>
            <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Ma Shan Zheng", "Kaiti SC", serif', fontSize: 20, color: palette.stamp, border: `1px solid ${palette.stamp}`, letterSpacing: 0 }}>{current.mark}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: palette.ink }}>{current.feed}</div>
                <div style={{ fontSize: 11, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em' }}>{current.author} &middot; Oct 28, 2025</div>
              </div>
            </div>

            <h1 style={{ fontFamily: typeStack, fontSize: 40, lineHeight: 1.12, fontWeight: 500, letterSpacing: '-0.012em', color: palette.ink, margin: '0 0 20px' }}>{current.title}</h1>
            <div style={{ fontSize: 16, color: palette.inkSoft, fontStyle: 'italic', lineHeight: 1.5, marginBottom: 40, borderLeft: `2px solid ${palette.accent}`, paddingLeft: 18 }}>{current.excerpt}</div>

            <div style={{ fontSize: 16.5, lineHeight: 1.75, color: palette.ink, letterSpacing: '0.005em' }}>
              <p style={{ margin: '0 0 22px' }}>
                <span style={{ float: 'left', fontFamily: typeStack, fontSize: 64, lineHeight: 0.86, paddingRight: 10, paddingTop: 5, fontWeight: 500, color: palette.ink }}>I</span>
                n the winter of 2007, long before the studios in Queens began taking themselves seriously, a young printer named Leo Fisher arrived at 47-33 Vernon Boulevard with a pallet of lead type, an astonished letter of introduction, and the intention of not leaving.
              </p>
              <p style={{ margin: '0 0 22px' }}>The building was cold. The press had not been turned in three years. Leo unpacked the type, sorted it into a borrowed case, and — because the only way to understand an old machine is to make something with it — set the opening paragraph of an essay he had been carrying around for months.</p>
              <p style={{ margin: '0 0 22px' }}>"The machine has a rhythm," he told me, two decades later, "and the rhythm has opinions. You don\u2019t print on a hand press the way you write in a text editor. You have to slow down to where the machine already is."</p>
              <blockquote style={{ margin: '32px 0', padding: '4px 0 4px 22px', borderLeft: `2px solid ${palette.accent}`, fontFamily: typeStack, fontStyle: 'italic', fontSize: 19, lineHeight: 1.5, color: palette.inkSoft }}>
                You don\u2019t print on a hand press the way you write in a text editor. You have to slow down to where the machine already is.
              </blockquote>
              <p style={{ margin: '0 0 22px' }}>The basement has since grown. There are four presses now, three apprentices, and a small, steady income from book covers commissioned by publishers who have, quietly, begun to care again about the physical object.</p>
              <p style={{ margin: '0 0 22px', color: palette.inkSoft }}>[This article continues — 11 minutes of reading remain. Press <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, padding: '1px 6px', background: palette.panelAlt, border: `1px solid ${palette.borderSoft}` }}>J</span> for the next article.]</p>
            </div>

            <footer style={{ marginTop: 56, paddingTop: 24, borderTop: `1px solid ${palette.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: palette.inkMuted, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              <span>— 原文于 nytimes.com</span>
              <span>{current.id}</span>
            </footer>
          </article>
        </div>
      </main>
    </div>
  );
};

window.LitReader = LitReader;
