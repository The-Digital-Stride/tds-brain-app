import { useStore, type View } from '../store.tsx';

const MENU: { view: View; label: string }[] = [
  { view: 'chat', label: 'Chat' },
  { view: 'skills', label: 'Skills' },
  { view: 'todos', label: 'To-dos' },
  { view: 'history', label: 'History' },
  { view: 'settings', label: 'Settings' },
];

const ROLE_WORDS = { owner: 'Owner', scout: 'Scout', team: 'Team', unknown: 'Role not set' } as const;

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { boot, view, openView, newChat } = useStore();
  if (!boot) return null;
  const byName = (name: string) => boot.skills.find((s) => s.name === name);
  const pinned = boot.prefs.pins.map(byName).filter((s) => s !== undefined);
  const often = boot.usedOften
    .map((u) => byName(u.name))
    .filter((s) => s !== undefined)
    .filter((s) => !boot.prefs.pins.includes(s.name));

  return (
    <div className="sidebar" id="sidebar" data-open={open}>
      <div className="brand">TDS Brain</div>
      <button
        type="button"
        className="btn btn-new"
        onClick={() => {
          newChat();
          onNavigate();
        }}
      >
        New chat
      </button>
      <nav aria-label="Main menu">
        <ul>
          {MENU.map((m) => (
            <li key={m.view}>
              <button
                type="button"
                className="side-link"
                aria-current={view === m.view ? 'page' : undefined}
                onClick={() => {
                  openView(m.view);
                  onNavigate();
                }}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section className="side-section" aria-labelledby="pinned-h">
        <h3 id="pinned-h">Pinned skills</h3>
        {pinned.length === 0 ? (
          <p className="side-empty">Pin a skill from the Skills page and it will show here.</p>
        ) : (
          <ul className="side-list">
            {pinned.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="side-link"
                  onClick={() => {
                    newChat({ draft: `/${s.name} `, skill: s });
                    onNavigate();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="side-section" aria-labelledby="often-h">
        <h3 id="often-h">Used often</h3>
        {often.length === 0 ? (
          <p className="side-empty">The skills you use most will show here.</p>
        ) : (
          <ul className="side-list">
            {often.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="side-link"
                  onClick={() => {
                    newChat({ draft: `/${s.name} `, skill: s });
                    onNavigate();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="who">
        <div>{boot.identity.name}</div>
        <div className="who-role">{ROLE_WORDS[boot.identity.role]}</div>
      </div>
    </div>
  );
}
