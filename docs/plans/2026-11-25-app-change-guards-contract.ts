/**
 * Contract for plan 2026-11-25-app-change-guards. Builder A moves the shared types into
 * `shared/contract.ts` and the functions into `server/engine/change-guards.ts`; Builder B builds the card
 * against the shared types. Names here are binding; bodies are not.
 */

// ---------------------------------------------------------------------------
// shared/contract.ts additions
// ---------------------------------------------------------------------------

/** What a confirmed publish does. `merge-and-push` is `wt-finish --merge --push` or a chain of both. */
export type PublishKind = 'push' | 'merge' | 'merge-and-push';

/** What the merge-and-push card shows. Every field but `kind` and `command` may be unknown (null). */
export interface PublishFacts {
  kind: PublishKind;
  /** `owner/name` from the repo's origin URL, e.g. "The-Digital-Stride/tds-brain-app". */
  repo: string | null;
  /** True when the repo is TDS Cortex itself (plan decision 2c). */
  isApp: boolean;
  /** The branch being merged or pushed, e.g. "app-change-guards". */
  branch: string | null;
  /** Where it lands, e.g. "main". */
  target: string | null;
  /** The app's package.json version when `isApp`, e.g. "0.82.3". */
  version: string | null;
  /** Up to 20 one-line commits going out, newest first ("abc1234 fix: …"). */
  commits: string[] | null;
  /** How many commits go out in total (may be more than `commits.length`). */
  commitCount: number | null;
  /** The exact command or tool call, as the ordinary card's detail shows it. */
  command: string;
}

// `permission-request` (ChatEvent) gains, optional so older pages ignore it:
//   publish?: PublishFacts;
// When `publish` is set the server always sends `sessionAllowLabel: null`.
// The client's PermissionItem (chat-reducer) carries it through as `publish?: PublishFacts`.

/** Card title per kind. */
export declare function publishTitle(kind: PublishKind): string;
// 'push' → "Are you sure you want to push?"
// 'merge' → "Are you sure you want to merge?"
// 'merge-and-push' → "Are you sure you want to merge and push?"

/** The Yes button per kind: "Yes, push" / "Yes, merge" / "Yes, merge and push". No button: "No, not now". */
export declare function publishYesLabel(kind: PublishKind): string;

// ---------------------------------------------------------------------------
// server/engine/change-guards.ts
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'scout' | 'team' | 'unknown';

export interface AppCodeContext {
  /** The running copy's folder (`config.appRoot`). */
  appRoot: string;
  /** The person's home folder (for `~` and `$HOME`, and the default install path). */
  home: string;
  /** The brain folder (for the brain-sync exemption, decision 6). */
  brainRoot: string;
}

/** Async: true when a detected publish is the brain's own plain push of `main` (no card, decision 6). */
export declare function isBrainSync(d: DetectedPublish, cwd: string, ctx: AppCodeContext): Promise<boolean>;

/** One publish found in a Bash command (plan decision 6). */
export interface DetectedPublish {
  kind: PublishKind;
  /** Force push (`-f`, `--force`, `--force-with-lease`, `+refspec`), `--delete` or `--mirror`. */
  dangerous: boolean;
  /** The repo folder by decision 8's rule: `git -C <p>`, else the last `cd <p>` before it, else null (use cwd). */
  repoDir: string | null;
  /** For `git merge X`: X. For `git push <remote> <branch>`: the branch. Else null. */
  ref: string | null;
}

/** Pure: the first publish in a Bash command, or null. Heredoc bodies stripped, quotes respected. */
export declare function detectPublish(command: string): DetectedPublish | null;

/** Pure: whether an MCP tool name is a merge or push (plan decision 6). */
export declare function isPublishTool(toolName: string): PublishKind | null;

/** Async (read-only git, cached per repo root): whether a path is inside app code (plan decision 2). */
export declare function isAppCodePath(path: string, ctx: AppCodeContext): Promise<boolean>;

/** Pure apart from `isAppCodePath`: whether a Bash command touches app code (plan decision 4). */
export declare function touchesAppCode(command: string, cwd: string, ctx: AppCodeContext): Promise<boolean>;

/** Pure: true when every segment of a command that touches app code is on the update allowlist (decision 3). */
export declare function teamMayRun(command: string): boolean;

/**
 * The whole team check for one tool call: null when allowed, else what to deny with (`reason` to Claude,
 * `notice` to the person). `getRole` is called only once the call touches app code (decision 15: it applies
 * the 10-minute last-known-role rule). Owners and scouts always get null. Throws nothing: an internal error
 * returns a refusal (fail closed).
 */
export declare function teamAppRefusal(
  getRole: () => Promise<Role>,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  ctx: AppCodeContext,
): Promise<{ reason: string; notice: string } | null>;

/** Async, read-only, best effort: the card's facts (plan decision 8). Never throws. */
export declare function publishFacts(d: DetectedPublish, command: string, cwd: string, ctx: AppCodeContext): Promise<PublishFacts & { warning: string | null }>;
// `warning` (force or delete) goes into the permission-request's existing `warning` field, e.g.
// "This is a force push: it can overwrite work already on GitHub." / "This deletes a branch on GitHub."

/** The deny reason Claude gets (plan decision 5). */
export declare const TEAM_APP_REFUSAL: string;
// "Only owners and scouts can change TDS Cortex's code, so this was refused. Don't try another way. Tell the
// person that, and offer to add their idea as a feature request in the TDS Cortex Feedback project. Only if
// they say yes, agree the wording with them, then run the tdsapp-todo skill's add with client
// the-digital-stride, project the-digital-stride/tds-cortex-feedback, stage Feature Request, via TDS Cortex,
// and assignee the owner: from clients/the-digital-stride/projects/tds-cortex-feedback/project.md."

/** The warning notice the person sees (plan decision 5). */
export declare const TEAM_APP_NOTICE: string;
// "Only owners and scouts can change TDS Cortex. Claude can add your idea as a feature request instead."

/** Notice and deny reason when the role can't be read and no recent role is known (decision 15). */
export declare const UNKNOWN_ROLE_NOTICE: string;
// "Cortex couldn't tell who you are, so it didn't change the app. Run /doctor-cortex."

/** Standing instructions for every chat (plan decision 11). */
export declare const PUBLISH_LINE: string;
// "At the point you would ask whether to merge or push, don't ask in the chat, in text or with
// AskUserQuestion: say briefly what will go out and run the merge or push command, and TDS Cortex shows the
// person a card to confirm it. If they say no, stop and don't try another way."
export declare const APP_CODE_LINE: string;
// "Only owners and scouts change TDS Cortex's own code (the installed app and any copy of the
// tds-brain-app repo). If someone on the team asks for a change to the app, say so and offer to add it as a
// Feature Request task in the TDS Cortex Feedback project with the tdsapp-todo skill."
