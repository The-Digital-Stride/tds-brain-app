/**
 * Projects R2 phase 5 (plan docs/plans/2026-11-24-projects-r2-email-entries.md, decision 2): which project an
 * email draft is pre-selected for. Pure, no I/O: the draft's recorded facts in, one EmailRoute out. It only
 * pre-selects; the owner's approval is always needed. Never a done or archived project.
 */
import type { EmailRoute } from '../../shared/project-email-contract.ts';
import type { ProjectKey } from '../../shared/projects-contract.ts';

/** What the script recorded in the draft (never addresses: only the sender's domain). */
export interface EmailRouteFacts {
  requested: string | null;
  /** Team slug of the inbox owner. */
  inboxOwner: string;
  threadId: string;
  emailKey: string;
  threadMessageIds: string[];
  codesSubject: string[];
  codesBody: string[];
  /** Lower-case domain of the sender, '' when unknown. */
  fromDomain: string;
}

export interface EmailRouteContext {
  /** A live project: its card exists, not archived, not done. */
  isLive(key: ProjectKey): boolean;
  /** The project holding an email entry for this inbox owner's thread, or null. */
  linkedThread(owner: string, threadId: string): ProjectKey | null;
  /** The project holding an email entry with this email_key or Message-ID, or null. */
  linkedMessage(id: string): ProjectKey | null;
  /** The shared code rules' lookup: a (folded) code to the one project holding it, or null. */
  resolveCode(code: string): ProjectKey | null;
  /** The live projects of the client whose website matches the domain; null when no client matches. */
  liveProjectsOfDomain(domain: string): ProjectKey[] | null;
}

const NONE: EmailRoute = { key: null, why: 'none' };

export function routeEmail(f: EmailRouteFacts, ctx: EmailRouteContext): EmailRoute {
  const live = (k: ProjectKey | null): k is ProjectKey => k !== null && ctx.isLive(k);

  if (f.requested !== null && ctx.isLive(f.requested)) return { key: f.requested, why: 'requested' };

  const thread = ctx.linkedThread(f.inboxOwner, f.threadId);
  if (live(thread)) return { key: thread, why: 'thread' };

  for (const id of [f.emailKey, ...f.threadMessageIds]) {
    const hit = ctx.linkedMessage(id);
    if (live(hit)) return { key: hit, why: 'message' };
  }

  // Codes: an unknown code, or one for a project that isn't live, says nothing and is ignored.
  const known = (codes: string[]): Map<ProjectKey, string> => {
    const out = new Map<ProjectKey, string>();
    for (const code of codes) {
      const key = ctx.resolveCode(code);
      if (live(key) && !out.has(key)) out.set(key, code);
    }
    return out;
  };
  const subject = known(f.codesSubject);
  const body = known(f.codesBody);
  const all = new Map([...subject, ...body]);
  if (all.size >= 2) return { key: null, why: 'codes-disagree', codes: [...all.values()] };
  if (subject.size === 1) return { key: [...subject.keys()][0] as ProjectKey, why: 'subject-code' };
  if (body.size === 1) return { key: [...body.keys()][0] as ProjectKey, why: 'body-code' };

  if (f.fromDomain !== '') {
    const projects = (ctx.liveProjectsOfDomain(f.fromDomain) ?? []).filter((k) => ctx.isLive(k));
    if (projects.length === 1) return { key: projects[0] as ProjectKey, why: 'domain' };
    if (projects.length > 1) return { key: null, why: 'domain-several' };
  }
  return NONE;
}
