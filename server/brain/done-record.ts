/** Who finished a to-do, when, and where they ticked it. */
export interface DoneStamp {
  by: { name: string; slug: string };
  at: Date;
  /** The tool the tick came from, e.g. "TDS Brain App". */
  via: string;
}

/** The frontmatter lines a finished to-do carries. An earlier value of any of them is replaced. */
const DONE_KEYS = ['status', 'completed', 'completed_at', 'completed_by', 'completed_via'];
const DONE_KEY_LINE = new RegExp(`^(?:${DONE_KEYS.join('|')})\\s*:`);

/** One line of plain text: control characters and line breaks become single spaces. */
function oneLine(value: string): string {
  return String(value ?? '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim();
}

function slugOf(value: string): string {
  return oneLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A YAML value that is safe on one line: plain when simple, double-quoted otherwise. */
function yamlValue(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9 ._()/+-]*$/.test(value)) return value;
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/** The date, clock time and UTC offset in the UK at that instant (GMT in winter, BST in summer). */
function ukTime(at: Date): { date: string; time: string; seconds: string; offset: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const offsetMin = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  const abs = Math.abs(offsetMin);
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: p.second ?? '00',
    offset: `${offsetMin < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`,
  };
}

/**
 * The text of a to-do with its completion recorded: who ticked it, the UK date and time, and the
 * tool it was ticked in. The record goes in the frontmatter (for tools) and in a short "Done"
 * section at the end (for people). Everything else in the file is kept as written.
 */
export function stampDone(text: string, stamp: DoneStamp): string {
  const raw = String(text ?? '');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const src = bom ? raw.slice(1) : raw;
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src === '' ? [] : src.split(/\r\n|\n/);

  const when = ukTime(stamp.at);
  const name = oneLine(stamp.by.name) || 'unknown';
  const via = oneLine(stamp.via);
  const record = [
    'status: done',
    `completed: ${when.date}`,
    `completed_at: ${when.date}T${when.time}:${when.seconds}${when.offset}`,
    `completed_by: ${slugOf(stamp.by.slug) || 'unknown'}`,
    `completed_via: ${yamlValue(via || 'unknown')}`,
  ];

  let close = -1;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === '---') {
        close = i;
        break;
      }
    }
  }

  let out: string[];
  if (close === -1) {
    out = ['---', ...record, '---', ...lines];
  } else {
    const head: string[] = [];
    let dropping = false;
    for (const line of lines.slice(1, close)) {
      if (DONE_KEY_LINE.test(line)) {
        dropping = true; // and the rest of its value: indented lines, blank lines and "- item" lines
        continue;
      }
      if (dropping && (line.trim() === '' || /^\s/.test(line) || /^-\s/.test(line))) continue;
      dropping = false;
      head.push(line);
    }
    out = ['---', ...head, ...record, '---', ...lines.slice(close + 1)];
  }

  while (out.length > 0 && out[out.length - 1]?.trim() === '') out.pop();
  out.push(
    '',
    `## Done ${when.date}`,
    '',
    `Ticked off by ${name} at ${when.time} UK time${via ? ` (${via})` : ''}.`,
    '',
  );
  return bom + out.join(eol);
}
