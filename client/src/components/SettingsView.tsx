import { approvalsSentence } from '../approvals.ts';
import { useStore } from '../store.tsx';

const ROLE_WORDS = { owner: 'Owner', scout: 'Scout', team: 'Team', unknown: 'Not recognised' } as const;

export function SettingsView() {
  const { boot, updatePrefs } = useStore();
  if (!boot) return null;
  const { prefs, identity, brain, engine, appVersion } = boot;
  return (
    <div className="page">
      <h1>Settings</h1>

      <section className="card setting">
        <input
          id="set-direct"
          type="checkbox"
          checked={prefs.directWrites}
          onChange={(e) => void updatePrefs({ directWrites: e.target.checked })}
        />
        <div>
          <label className="setting-label" htmlFor="set-direct">
            Let the app tick to-dos
          </label>
          <p className="lede" id="set-direct-help">
            Lets you tick to-dos off here. Each tick changes the shared brain, so the whole team sees it.
          </p>
          <p className="meta">Off by default.</p>
        </div>
      </section>

      <section className="card setting">
        <input
          id="set-panel"
          type="checkbox"
          checked={prefs.todoPanelOpen}
          onChange={(e) => void updatePrefs({ todoPanelOpen: e.target.checked })}
        />
        <div>
          <label className="setting-label" htmlFor="set-panel">
            Show the to-do panel
          </label>
          <p className="lede">Keeps your to-dos beside every chat. It hides itself on narrow windows.</p>
        </div>
      </section>

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About TDS Brain on this computer</h2>
        <dl className="about">
          <dt>You are</dt>
          <dd>
            {identity.name}, {ROLE_WORDS[identity.role]}
            {identity.knownMember ? '' : ' (not found in the team list)'}
          </dd>
          <dt>Brain folder</dt>
          <dd>
            <code className="about-code">{brain.path}</code>
          </dd>
          <dt>Brain health</dt>
          <dd>
            {brain.ok ? (
              'No problems found.'
            ) : (
              <ul className="problem-list">
                {brain.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Claude Code</dt>
          <dd>
            {engine.ok ? (
              <code className="about-code">{engine.claudePath}</code>
            ) : (
              (engine.problem ?? 'Not ready.')
            )}
          </dd>
          <dt>Approvals</dt>
          <dd>
            {approvalsSentence(engine.permissionMode)}
            <p className="meta">
              This follows your Claude Code setting, so the app asks as often as your terminal does.
            </p>
          </dd>
          <dt>App version</dt>
          <dd>{appVersion}</dd>
        </dl>
      </section>
    </div>
  );
}
