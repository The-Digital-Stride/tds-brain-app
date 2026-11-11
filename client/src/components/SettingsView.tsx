import { approvalsSentence } from '../approvals.ts';
import { APPROVALS_SHORT } from '../shell/Inspector.tsx';
import { useShell } from '../shell/ShellProvider.tsx';
import { useStore } from '../store.tsx';

const ROLE_WORDS = { owner: 'Owner', scout: 'Scout', team: 'Team', unknown: 'Not recognised' } as const;

export function SettingsView() {
  const { boot, updatePrefs } = useStore();
  const { state: shell, dispatch } = useShell();
  if (!boot) return null;
  const { prefs, identity, brain, engine, appVersion } = boot;
  return (
    // The sheet bar above carries the page's heading.
    <div className="page settings">
      <section aria-labelledby="prefs-h">
        <h2 id="prefs-h">Preferences</h2>
        <div className="setting-rows">
          <div className="setting">
            <div>
              <label className="setting-label" htmlFor="set-direct">
                Let the app tick to-dos
              </label>
              <p className="setting-help" id="set-direct-help">
                Lets you tick to-dos off here. Each tick changes the shared brain, so the whole team sees it.
                Off by default.
              </p>
            </div>
            <input
              id="set-direct"
              type="checkbox"
              role="switch"
              className="switch"
              aria-describedby="set-direct-help"
              checked={prefs.directWrites}
              aria-checked={prefs.directWrites}
              onChange={(e) => void updatePrefs({ directWrites: e.target.checked })}
            />
          </div>
          <div className="setting">
            <div>
              <label className="setting-label" htmlFor="set-keys">
                Single-key shortcuts
              </label>
              <p className="setting-help" id="set-keys-help">
                When you're not typing, press <kbd>[</kbd> to show or hide the names on the rail, <kbd>T</kbd>{' '}
                for To-dos, <kbd>C</kbd> for Chats and <kbd>S</kbd> for Skills.
              </p>
            </div>
            <input
              id="set-keys"
              type="checkbox"
              role="switch"
              className="switch"
              aria-describedby="set-keys-help"
              checked={shell.singleKeys}
              aria-checked={shell.singleKeys}
              onChange={(e) => dispatch({ type: 'set-single-keys', on: e.target.checked })}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="about-h">
        <h2 id="about-h">About TDS Brain on this computer</h2>
        <dl className="kv about">
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
            {APPROVALS_SHORT}
            <span className="kv-note">{approvalsSentence(engine.permissionMode)}</span>
            <span className="kv-note">
              This follows your Claude Code setting, so the app asks as often as your terminal does.
            </span>
          </dd>
          <dt>App version</dt>
          <dd>{appVersion}</dd>
        </dl>
      </section>
    </div>
  );
}
