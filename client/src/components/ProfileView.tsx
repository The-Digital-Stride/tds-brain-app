import { ROLE_WORDS } from '../shell/words.ts';
import { useStore } from '../store.tsx';

/**
 * The person using the app, as the brain's team list (`.team-config/roles.json`) has them.
 * Read-only for now; more details join this page later.
 */
export function ProfileView() {
  const { boot } = useStore();
  if (!boot) return null;
  const { name, email, role, knownMember, departments } = boot.identity;
  return (
    // The sheet bar above carries the page's heading.
    <div className="page settings profile">
      <section aria-labelledby="profile-h">
        <h2 id="profile-h">Your details in the brain</h2>
        <p className="setting-help">
          {knownMember
            ? "These come from the team list in the brain. To change them, ask the brain's Owner."
            : "You're not on the brain's team list yet, so these come from this computer. Ask the brain's Owner to add you."}
        </p>
        <dl className="kv about">
          <dt>Name</dt>
          <dd>{name}</dd>
          <dt>Email</dt>
          <dd>{email ?? 'Not listed'}</dd>
          <dt>Role</dt>
          <dd>{ROLE_WORDS[role]}</dd>
          <dt>Departments</dt>
          <dd>
            {departments.length > 0 ? (
              // biome-ignore lint/a11y/noRedundantRoles: Safari drops list meaning once bullets are off; this restores it.
              <ul className="dept-list" role="list">
                {departments.map((d) => (
                  <li key={d} className="chip">
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="kv-quiet">None listed yet</span>
            )}
          </dd>
        </dl>
      </section>
    </div>
  );
}
