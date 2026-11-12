import { ROLE_WORDS } from '../shell/words.ts';
import { useStore } from '../store.tsx';

/**
 * The person using the app, as the brain has them: who they are from the team list
 * (`.team-config/roles.json`), and their title, departments and day-to-day work from the team
 * profile (`context/team-profile.md`). Read-only for now; more details join this page later.
 */
export function ProfileView() {
  const { boot } = useStore();
  if (!boot) return null;
  const { name, email, role, knownMember } = boot.identity;
  const { title, departments, owns } = boot.profile;
  const quiet = (text: string) => <span className="kv-quiet">{text}</span>;
  return (
    // The sheet bar above carries the page's heading.
    <div className="page settings profile">
      <section aria-labelledby="profile-h">
        <h2 id="profile-h">Your details in the brain</h2>
        <p className="setting-help">
          {knownMember
            ? "These details come from the brain. To change them, ask the brain's Owner."
            : "You're not on the brain's team list yet, so these come from this computer. Ask the brain's Owner to add you."}
        </p>
        <dl className="kv about">
          <dt>Name</dt>
          <dd>{name}</dd>
          <dt>Job title</dt>
          <dd>{title ?? quiet('Not listed yet')}</dd>
          <dt>Email</dt>
          <dd>{email ?? quiet('Not listed yet')}</dd>
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
              quiet('None listed yet')
            )}
          </dd>
          <dt>Day to day</dt>
          <dd className="profile-owns">{owns ?? quiet('Not listed yet')}</dd>
        </dl>
      </section>
    </div>
  );
}
