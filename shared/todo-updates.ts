/**
 * Reading a task's `## Updates` log, its `## Handover history` lines and its web links (plan
 * docs/plans/2026-11-27-task-updates-handback.md, decisions 1, 5a, 6 and 7; the format is in
 * shared/todo-updates-contract.ts). Read side only: the brain's `tdsapp-todo` script (0.7) is the only
 * writer. Its `.cjs` follows the same rules; `shared/todo-updates.fixtures.json` is run by both test
 * suites so the two can't drift.
 *
 * Runs in Node and in the browser: no Node imports.
 */
import {
  type HandBackTarget,
  type IsTodoLinkUrl,
  type ParseTodoHandovers,
  type ParseTodoUpdates,
  type SplitTodoSections,
  TODO_LINK_URL_MAX,
  type TodoEntryAction,
  type TodoTimeline,
  type TodoUpdate,
  type UkWallToIso,
} from './todo-updates-contract.ts';

/** The log starts at a level-2 heading that says exactly "Updates" (any case). */
export const TODO_UPDATES_HEADING = /^##[ \t]+updates[ \t]*$/i;
/** The same rule for `## Files` (shared/todo-files.ts). */
export const TODO_FILES_HEADING = /^##[ \t]+files[ \t]*$/i;
const HANDOVER_HEADING = /^##[ \t]+handover history[ \t]*$/i;
/** A section ends at the next level-1 or level-2 heading. */
const NEXT_HEADING = /^#{1,2}[ \t]/;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `- D Mon YYYY, HH:mm UK: ` at column 0, then the rest of the line. */
const STAMP =
  /^- (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}), (\d{2}):(\d{2}) UK: (.+)$/;
/** After the stamp in `## Updates`: `Name (slug) ` and the rest. The name never holds "(" or ")". */
const ACTOR = /^([^()]+) \(([a-z0-9]+(?:-[a-z0-9]+)*)\) (.+)$/;
/** After the stamp in `## Handover history`: the name, then what happened (the script's wordings). */
const HANDOVER_WHAT = /^(.+?) ((?:passed|made|picked|handed) it\b.*)$/;
/** The tool at the end of an auto or handover line: ` (<via>).` */
const VIA = /^(.*) \(([^()]+)\)\.$/;
const NOTE = 'wrote: ';
/**
 * A note's further lines: indented by two spaces, straight after it (no blank line between). The two are
 * dropped; any more spaces are the text's own.
 */
const CONTINUATION = /^ {2}/;

/** Indexes of the lines outside ``` and ~~~ code fences (the script's `linesOutsideFences`). */
export function linesOutsideFences(lines: string[]): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] as string).match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence !== null) {
      if (m && (m[1] as string)[0] === fence[0] && (m[1] as string).length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1] as string;
      continue;
    }
    out.push(i);
  }
  return out;
}

/**
 * The [start, end) line range of EVERY section whose heading matches, outside code fences, in order. A
 * union merge can leave two (contract: "Under the union rule").
 */
export function todoSectionRanges(lines: string[], heading: RegExp): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (const i of linesOutsideFences(lines)) {
    const line = lines[i] as string;
    if (!NEXT_HEADING.test(line)) continue;
    if (start !== -1) out.push([start, i]);
    start = heading.test(line) ? i : -1;
  }
  if (start !== -1) out.push([start, lines.length]);
  return out;
}

/**
 * The body with every section matching one of `headings` taken out (`details`, trimmed; the pieces left
 * either side of a removed section are joined by one blank line), and each heading's sections as written
 * (joined by a blank line; '' when there are none). The body's line ending is kept.
 */
export function cutTodoSections(body: string, headings: RegExp[]): { details: string; sections: string[] } {
  const text = String(body ?? '');
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const perHeading = headings.map((h) => todoSectionRanges(lines, h));
  const all = perHeading.flat().sort((a, b) => a[0] - b[0]);
  if (all.length === 0) return { details: text.trim(), sections: headings.map(() => '') };
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, end] of all) {
    pieces.push(lines.slice(cursor, start).join(eol).trim());
    cursor = end;
  }
  pieces.push(lines.slice(cursor).join(eol).trim());
  const sections = perHeading.map((ranges) =>
    ranges.map(([start, end]) => lines.slice(start, end).join(eol).trimEnd()).join(`${eol}${eol}`),
  );
  return {
    details: pieces
      .filter((p) => p !== '')
      .join(`${eol}${eol}`)
      .trim(),
    sections,
  };
}

export const splitTodoSections: SplitTodoSections = (body) => {
  const { details, sections } = cutTodoSections(body, [TODO_FILES_HEADING, TODO_UPDATES_HEADING]);
  return { details, files: sections[0] as string, updates: sections[1] as string };
};

// ─── Time ────────────────────────────────────────────────────────────────────────────────────────

let london: Intl.DateTimeFormat | null = null;
/** The UK wall clock at `ms`, as "YYYY-MM-DD HH:mm". */
function londonWall(ms: number): string {
  london ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of london.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export const ukWallToIso: UkWallToIso = (date, time) => {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!d || !t) return null;
  const [y, m, day, h, min] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (h > 23 || min > 59 || m < 1 || m > 12 || day < 1) return null;
  const wall = Date.UTC(y, m - 1, day, h, min);
  if (new Date(wall).getUTCDate() !== day) return null;
  // BST first: in the hour that happens twice, that is the first one.
  for (const offset of [1, 0]) {
    if (londonWall(wall - offset * 3_600_000) === `${date} ${time}`)
      return `${date}T${time}:00+0${offset}:00`;
  }
  // The hour the clocks skip.
  return null;
};

/** The stamp of an entry line as ISO, and the rest of the line; null when it isn't a stamped line or a real time. */
function stampOf(line: string): { at: string; rest: string } | null {
  const m = STAMP.exec(line);
  if (!m) return null;
  const month = String(MONTHS.indexOf(m[2] as string) + 1).padStart(2, '0');
  const at = ukWallToIso(`${m[3]}-${month}-${(m[1] as string).padStart(2, '0')}`, `${m[4]}:${m[5]}`);
  return at === null ? null : { at, rest: m[6] as string };
}

/** "what (via)." → its words and the tool; without a tool, the words less a final full stop. */
function viaOf(rest: string): { text: string; via: string | null } {
  const m = VIA.exec(rest);
  if (m) return { text: m[1] as string, via: m[2] as string };
  return { text: rest.replace(/\.$/, ''), via: null };
}

/** The action an auto entry's wording stands for (the script's fixed wordings), or null. */
function autoAction(text: string): TodoEntryAction | null {
  if (/^(?:set the due date to |changed the due date from |cleared the due date(?: |$))/.test(text))
    return 'due';
  if (text === 'changed the title' || text === 'changed the title and the details') return 'title';
  if (text === 'changed the details') return 'details';
  if (/^(?:added|removed) a file(?:: .+)?$/.test(text)) return 'files';
  if (/^(?:added|removed) a link(?:: .+)?$/.test(text)) return 'links';
  if (text === 'changed the project') return 'project';
  return null;
}

// ─── Readers ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `by` is the slug as written: the shared reader doesn't know the team, so the server sets it to null for
 * a slug that isn't on it (contract TodoUpdate.by).
 */
export const parseTodoUpdates: ParseTodoUpdates = (body) => {
  const lines = String(body ?? '').split(/\r?\n/);
  const entries: TodoUpdate[] = [];
  const extras: string[] = [];
  for (const [start, end] of todoSectionRanges(lines, TODO_UPDATES_HEADING)) {
    // The note whose further lines may follow; its text is joined up as they come.
    let note: TodoUpdate | null = null;
    for (let i = start + 1; i < end; i++) {
      const line = (lines[i] as string).trimEnd();
      if (line === '') {
        note = null;
        continue;
      }
      if (note !== null && CONTINUATION.test(line)) {
        note.text += `\n${line.slice(2)}`;
        continue;
      }
      note = null;
      const stamp = stampOf(line);
      const actor = stamp ? ACTOR.exec(stamp.rest) : null;
      if (!stamp || !actor) {
        extras.push(line.trim());
        continue;
      }
      const rest = actor[3] as string;
      const base = { at: stamp.at, by: actor[2] as string, byName: (actor[1] as string).trim() };
      if (rest.startsWith(NOTE)) {
        note = { kind: 'note', ...base, text: rest.slice(NOTE.length), via: null, action: 'update' };
        entries.push(note);
      } else {
        const { text, via } = viaOf(rest);
        entries.push({ kind: 'auto', ...base, text, via, action: autoAction(text) });
      }
    }
  }
  return { entries, extras };
};

export const parseTodoHandovers: ParseTodoHandovers = (body) => {
  const lines = String(body ?? '').split(/\r?\n/);
  const out: TodoUpdate[] = [];
  for (const [start, end] of todoSectionRanges(lines, HANDOVER_HEADING)) {
    for (let i = start + 1; i < end; i++) {
      const stamp = stampOf((lines[i] as string).trimEnd());
      const what = stamp ? HANDOVER_WHAT.exec(stamp.rest) : null;
      if (!stamp || !what) continue;
      const { text, via } = viaOf(what[2] as string);
      out.push({
        kind: 'handover',
        at: stamp.at,
        by: null,
        byName: (what[1] as string).trim(),
        text,
        via,
        action: /^handed it back to /.test(text) ? 'handback' : 'assignee',
      });
    }
  }
  return out;
};

export const todoTimeline: TodoTimeline = (body) => {
  const { entries, extras } = parseTodoUpdates(body);
  // Array.prototype.sort is stable: equal minutes keep file order, `## Updates` first.
  const updates = [...entries, ...parseTodoHandovers(body)].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  return { updates, extras };
};

// ─── Links and hand back ─────────────────────────────────────────────────────────────────────────

/**
 * The contract's URL rules. It also needs `//` straight after the scheme, so `http:example.com` (which the
 * URL parser would read as http://example.com/) is refused: what is written is what a person sees.
 */
export const isTodoLinkUrl: IsTodoLinkUrl = (url) => {
  if (typeof url !== 'string' || url === '' || url.length > TODO_LINK_URL_MAX) return false;
  if (/[\s\p{Cc}<>\\]/u.test(url) || !/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
};

export const handBackTarget: HandBackTarget = (todo, me, team) => {
  if (todo.scope !== 'tds' || !me || todo.assignee !== me) return null;
  if (todo.handover?.back === true) return null;
  const slug = todo.handover?.by ?? todo.createdBy;
  if (!slug || slug === me) return null;
  const member = team.find((m) => m.slug === slug);
  return member ? { slug: member.slug, name: member.name } : null;
};
