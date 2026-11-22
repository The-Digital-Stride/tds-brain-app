// Tests for the one-off move of the old project folders (plan
// docs/plans/2026-11-22-rehome-legacy-projects.md, decision 2). Each test builds a small fake brain in
// a temp folder, with the real tdsapp-todo script copied in, and runs the migration as a child
// process the way it will be run on the brain. Nothing here touches a real brain.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../server/brain/frontmatter.ts';

const SCRIPT = fileURLToPath(new URL('../brain-rules/rehome-legacy-projects.cjs', import.meta.url));
const TODO_SCRIPT = fileURLToPath(new URL('../../tdsapp-todo/scripts/tdsapp-todo.cjs', import.meta.url));

interface RehomeModule {
  cutTitle(text: string): { title: string; cut: boolean };
  rewriteText(rel: string, text: string): string;
  classify(rel: string, ctx?: unknown): 'rewrite' | 'history' | null;
}
const require = createRequire(import.meta.url);
const rehome = require(SCRIPT) as RehomeModule;

const NEW = 'clients/the-digital-stride/projects';
const ROLES = {
  members: [
    { name: 'Pete Tyler', email: 'pete@example.test', role: 'owner' },
    { name: 'Ian Hancock', email: 'ian@example.test', role: 'scout' },
    { name: 'Simon Jones', email: 'simon@example.test', role: 'scout' },
    { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
    { name: 'Steve Blassberg', email: 'steve@example.test', role: 'team' },
  ],
};
const LONG_ITEM =
  '**Tritax run:** capture the friction log ' +
  Array.from({ length: 40 }, (_, i) => `step${i} done`).join(' ') +
  ' and decide the next pass.';
const POINTER = 'todo/20261116-ads-manager-gate-closes-the-loop.md';

let root: string;
const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text: string | Buffer) {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const read = (rel: string) => readFileSync(abs(rel), 'utf8');
const card = (title: string, owner?: string) =>
  `---\nv: 1\ntitle: ${title}\nclient: the-digital-stride\nstatus: active\n${owner ? `owner: ${owner}\n` : ''}---\n`;
const checklist = (name: string, items: string[], eol = '\n') =>
  [`# ${name} — todo`, '', '## Active', '', ...items, '', '## Done', '', '- [x] Old thing', ''].join(eol);

// The fake brain: the eight live folders (one CRLF checklist, an owner not on the team, a project
// with no owner), both archives, the files the depth fixes and code edit need, listed and history files.
function buildBrain() {
  put('.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs', readFileSync(TODO_SCRIPT));
  put('.team-config/roles.json', JSON.stringify(ROLES));
  put('tools/members/command-centre/lib/todo-parser.cjs', '// cardProjectsV2: card projects read here\n');
  mkdirSync(abs('todo/done'), { recursive: true });
  put(POINTER, '---\nassignee: pete-tyler\ntitle: Close the gate loop\ncreated: 2026-11-16\n---\n');
  mkdirSync(abs('clients/urban-cooling'), { recursive: true });
  put('clients/the-digital-stride/profile.md', '# TDS\n');

  put(
    'projects/agency-brian-google-ads-manager/project.md',
    card('Agency Brian - the Ads Manager', 'pete-tyler'),
  );
  put(
    'projects/agency-brian-google-ads-manager/todo.md',
    checklist('Agency Brian', [
      '- [ ] Mon 16 Nov: review pack 4 (`todo/20261109-uc-water-cooled-bidding-decision.md`).',
      `- [ ] Close the gate loop: "Request changes" should make a follow-on proposal (\`${POINTER}\`, due 16 Nov).`,
      '- [x] Already done before the move.',
    ]),
  );
  put('projects/ai-blueprint/project.md', card('AI Blueprint — Service Build', 'pete-tyler'));
  put(
    'projects/ai-blueprint/todo.md',
    checklist('AI Blueprint', [`- [ ] ${LONG_ITEM}`, '', '- [ ] Re-run the scraper on the UC set.']),
  );
  put(
    'projects/ai-blueprint/README.md',
    '# AI Blueprint\n\n- `../../plans/20260723-ai-blueprint-build.md` — the plan\n- `../../templates/blueprint/` — the template\n',
  );
  put('projects/ai-blueprint/benchmarks/run.md', 'Notes on projects/ai-blueprint/benchmarks/run.md\n');
  put('projects/ai-in-your-stride/project.md', card('"AI in Your Stride: An Intro"', 'ian-hancock'));
  put(
    'projects/ai-in-your-stride/todo.md',
    checklist('AI in Your Stride', ['- [ ] Book the next attendee.'], '\r\n'),
  );
  put(
    'projects/ai-in-your-stride/build-kit.cjs',
    "// node projects/ai-in-your-stride/build-kit.cjs --name\nconst HERE = __dirname;\nconst ROOT = path.resolve(HERE, '../..');\n",
  );
  put(
    'projects/ai-in-your-stride/output/run-sheet.html',
    '<code>node projects/ai-in-your-stride/build-kit.cjs</code>\n',
  );
  put('projects/ai-search-outreach/project.md', card("Steve's Sale Shortlist", 'pete-tyler'));
  put(
    'projects/ai-search-outreach/todo.md',
    checklist('AI Search Outreach', ['- [ ] Get the Companies House key.']),
  );
  put('projects/ai-search-outreach/.gitignore', 'inbox/\nshortlists/\n');
  put(
    'projects/ai-search-outreach/README.md',
    'node projects/ai-search-outreach/scripts/build-shortlist.cjs\n',
  );
  put('projects/ai-search-outreach/scripts/qualify.cjs', "path.resolve(__dirname, '../../..');\n");
  put('projects/ai-search-outreach/scripts/visibility-check.cjs', "path.resolve(__dirname, '../../..');\n");
  put('projects/ai-search-outreach/inbox/today.json', '{"from":"projects/ai-search-outreach/inbox"}\n');
  put('projects/ai-search-outreach/shortlists/2026-08-14/list.json', '[]\n');
  put('projects/brain-map/project.md', card('Brain map', 'ian-hancock'));
  put(
    'projects/brain-map/todo.md',
    checklist('Brain Map', ['- [ ] Rescan (`node projects/brain-map/scan.cjs`) and check the colours.']),
  );
  put('projects/brain-map/index.html', '<code>node projects/brain-map/scan.cjs</code>\n');
  put('projects/brain-map/scan.cjs', '// node projects/brain-map/scan.cjs\n');
  put('projects/brain-map/graph.js', 'window.G = {"src":"projects/brain-map/scan.cjs"};\n');
  put('projects/brain-map/node_modules/three/index.js', 'module.exports = 1;\n');
  put('projects/client-portal/project.md', card('Client Portal', ''));
  put('projects/client-portal/todo.md', checklist('Client Portal', ['- [ ] Check the signed H2O contract.']));
  put('projects/client-portal/call-notes/2026-10-01-call.md', 'We keep projects/client-portal/notes here.\n');
  put('projects/gads-api-writes/project.md', card('Google Ads writes', 'nobody-here'));
  put(
    'projects/gads-api-writes/todo.md',
    checklist('Google Ads Writes', ['- [ ] Replace the hardcoded campaign IDs.']),
  );
  put('projects/supermetrics-studio/project.md', card('Supermetrics Studio', 'ben-mcadam'));
  put('projects-archive/uc-multiple-condenser-functionality/README.md', "# Urban Cooling's condenser work\n");
  put('projects-archive/aesop-funnel-report/report.html', '<p>Aesop</p>\n');

  put(
    '.claude/skills/brainmap/scripts/open.cjs',
    "// Opens projects/brain-map/index.html\nconst MAP = path.join(ROOT, 'projects', 'brain-map');\n",
  );
  put(
    '.claude/skills/brainmap/SKILL.md',
    'Opens `projects/brain-map/index.html`; see clients/acme/projects/brain-map too.\n',
  );
  put(
    '.gitignore',
    '# GDPR rule in projects/ai-blueprint/intake-process.md\n/projects/ai-search-outreach/\n',
  );
  put(
    'todo/20261125-gads-write-atomic-builds.md',
    '---\ntitle: Gads write\n---\n\nScripts in `projects/gads-api-writes/` 14.\n',
  );
  put('plans/20260723-ai-blueprint-build.md', 'Build lives at projects/ai-blueprint/.\r\n');
  put('clients/acme/created/push.cjs', '// see /Users/x/agencybrain/projects/gads-api-writes/README.md\n');
  put(
    'todo/20261118-ask-steve-about-untracking-four-ai-search-outreach-files.md',
    'projects/ai-search-outreach/inbox/\n',
  );
  put('briefing/2026-07-28-briefing.md', 'no `projects/ai-blueprint/todo.md` yet\n');
}

const HISTORY = [
  'plans/20260723-ai-blueprint-build.md',
  'clients/acme/created/push.cjs',
  'todo/20261118-ask-steve-about-untracking-four-ai-search-outreach-files.md',
  'briefing/2026-07-28-briefing.md',
];
const MOVED_HISTORY = [
  'ai-blueprint/benchmarks/run.md',
  'ai-in-your-stride/output/run-sheet.html',
  'brain-map/graph.js',
  'client-portal/call-notes/2026-10-01-call.md',
  'agency-brian-google-ads-manager/project.md',
];

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--brain', root, '--by', 'Ian Hancock', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  const lines = r.stdout.trim().split('\n');
  let summary: Record<string, unknown> = {};
  try {
    summary = JSON.parse(lines[lines.length - 1] ?? '');
  } catch {
    /* left empty */
  }
  return { exit: r.status, stdout: r.stdout, summary };
}

// Every file in the brain with its hash, for "nothing changed" checks.
function tree(dir = root, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (lstatSync(p).isDirectory()) Object.assign(out, { [`${r}/`]: 'dir' }, tree(p, r));
    else out[r] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  return out;
}

// The value, or a thrown error naming what was missing (instead of a non-null assertion).
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing: ${what}`);
  return value;
}

function madeTodos() {
  return readdirSync(abs('todo'))
    .filter((n) => n.endsWith('.md'))
    .map((n) => ({ name: n, fm: parseFrontmatter(read(`todo/${n}`)) }))
    .filter((t) => t.fm.data.source === 'added from project move');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rehome-brain-'));
  buildBrain();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('dry run', () => {
  it('lists every action and writes nothing', () => {
    const before = tree();
    const r = run([]);
    expect(r.exit).toBe(0);
    expect(tree()).toEqual(before);
    expect(r.summary).toMatchObject({
      ok: true,
      mode: 'dry-run',
      changes: 0,
      todosMade: 9,
      itemsTicked: 9,
      foldersMoved: 10,
      depthFixes: 5,
      codeEdits: 1,
    });
    expect(r.stdout).toMatch(/^ {2}1\. /m);
    expect(r.stdout).toContain('Move projects/brain-map/ → clients/the-digital-stride/projects/brain-map/');
    expect(r.stdout).toContain('(AI Blueprint — Service Build)');
  });
});

describe('apply', () => {
  it('converts the checklists through the to-do script, moves the folders and rewrites the listed files', () => {
    const historyBefore = Object.fromEntries(HISTORY.map((h) => [h, read(h)]));
    const movedBefore = Object.fromEntries(MOVED_HISTORY.map((h) => [h, read(`projects/${h}`)]));
    const r = run(['--apply']);
    expect(r.exit, r.stdout).toBe(0);
    expect(r.summary).toMatchObject({
      ok: true,
      todosMade: 9,
      itemsTicked: 9,
      notesAdded: 7,
      foldersMoved: 10,
      depthFixes: 5,
      codeEdits: 1,
    });

    // Folders.
    for (const slug of [
      'agency-brian-google-ads-manager',
      'ai-blueprint',
      'client-portal',
      'supermetrics-studio',
    ]) {
      expect(existsSync(abs(`projects/${slug}`))).toBe(false);
      expect(existsSync(abs(`${NEW}/${slug}/project.md`))).toBe(true);
    }
    expect(readdirSync(abs('projects/ai-search-outreach')).sort()).toEqual(['inbox', 'shortlists']);
    expect(read(`${NEW}/ai-search-outreach/.gitignore`)).toBe('inbox/\nshortlists/\n');
    expect(readdirSync(abs('projects/brain-map'))).toEqual(['node_modules']);
    expect(existsSync(abs(`${NEW}/brain-map/node_modules`))).toBe(false);
    expect(
      existsSync(abs('clients/urban-cooling/projects-archive/uc-multiple-condenser-functionality/README.md')),
    ).toBe(true);
    expect(
      existsSync(abs('clients/the-digital-stride/projects-archive/aesop-funnel-report/report.html')),
    ).toBe(true);

    // To-dos: linked to the project's key, for the card's owner, made by the to-do script.
    const todos = madeTodos();
    expect(todos).toHaveLength(9);
    for (const t of todos) {
      expect(t.fm.data.client).toBe('the-digital-stride');
      expect(String(t.fm.data.project)).toMatch(/^the-digital-stride\/[a-z-]+$/);
      expect(t.fm.data.created_by).toBe('ian-hancock');
    }
    const byTitle = (s: string) =>
      must(
        todos.find((t) => String(t.fm.data.title).includes(s)),
        s,
      );
    expect(byTitle('Book the next attendee').fm.data).toMatchObject({
      assignee: 'ian-hancock',
      project: 'the-digital-stride/ai-in-your-stride',
    });
    // The title is plain words; the details keep the item as written, path already moved.
    expect(byTitle('Rescan').fm.data.title).toBe(
      'Rescan (node clients/the-digital-stride/projects/brain-map/scan.cjs) and check the colours.',
    );
    expect(byTitle('Rescan').fm.body.trim()).toBe(
      'Rescan (`node clients/the-digital-stride/projects/brain-map/scan.cjs`) and check the colours.',
    );
    // No owner: open. Owner not on the team: open, owner named in the details.
    expect(byTitle('H2O contract').fm.data.assignee).toBeUndefined();
    const gads = byTitle('hardcoded campaign IDs');
    expect(gads.fm.data.assignee).toBeUndefined();
    expect(gads.fm.body).toContain('nobody-here');
    const steve = byTitle('Move your own AI Search Outreach');
    expect(steve.fm.data).toMatchObject({
      assignee: 'steve-blassberg',
      project: 'the-digital-stride/ai-search-outreach',
    });
    // Following it never loses a private file or removes a shared one (review finding).
    expect(steve.fm.body).toContain('Leave these four files where they are');
    expect(steve.fm.body).toContain('inbox/test.json');
    expect(steve.fm.body).not.toContain('delete the old folder');

    // Checklists: ticked with pointers, the note under ## Active, CRLF kept.
    const brain = read(`${NEW}/brain-map/todo.md`);
    expect(brain).toMatch(
      /^Moved to to-dos on \d{1,2} [A-Z][a-z]+ \d{4}: open the project in TDS Cortex or the Workbench\.$/m,
    );
    const tick = must(
      brain.split('\n').find((l) => l.startsWith('- [x] Rescan')),
      'ticked line',
    );
    const pointer = must(tick.match(/ → (todo\/\S+\.md)$/)?.[1], 'pointer');
    expect(existsSync(abs(pointer))).toBe(true);
    expect(tick).toContain('clients/the-digital-stride/projects/brain-map/scan.cjs');
    const crlf = read(`${NEW}/ai-in-your-stride/todo.md`);
    expect(crlf.split('\r\n').length).toBe(crlf.split('\n').length);
    expect(crlf).toContain('- [x] Book the next attendee. → todo/');

    // Depth fixes and the code edit.
    expect(read(`${NEW}/ai-in-your-stride/build-kit.cjs`)).toContain("path.resolve(HERE, '../../../..')");
    expect(read(`${NEW}/ai-search-outreach/scripts/qualify.cjs`)).toBe(
      "path.resolve(__dirname, '../../../../..');\n",
    );
    expect(read(`${NEW}/ai-blueprint/README.md`)).toContain('`../../../../plans/20260723');
    expect(read(`${NEW}/ai-blueprint/README.md`)).toContain('`../../../../templates/blueprint/');
    expect(read('.claude/skills/brainmap/scripts/open.cjs')).toBe(
      "// Opens clients/the-digital-stride/projects/brain-map/index.html\nconst MAP = path.join(ROOT, 'clients', 'the-digital-stride', 'projects', 'brain-map');\n",
    );

    // Rewrites: listed files only; .gitignore comments only.
    expect(read('.claude/skills/brainmap/SKILL.md')).toBe(
      'Opens `clients/the-digital-stride/projects/brain-map/index.html`; see clients/acme/projects/brain-map too.\n',
    );
    expect(read('.gitignore')).toBe(
      '# GDPR rule in clients/the-digital-stride/projects/ai-blueprint/intake-process.md\n/projects/ai-search-outreach/\n',
    );
    expect(read('todo/20261125-gads-write-atomic-builds.md')).toContain(
      '`clients/the-digital-stride/projects/gads-api-writes/` 14',
    );
    expect(read(`${NEW}/brain-map/index.html`)).toContain(
      'node clients/the-digital-stride/projects/brain-map/scan.cjs',
    );
    expect(read(`${NEW}/ai-in-your-stride/build-kit.cjs`)).toContain(
      '// node clients/the-digital-stride/projects/ai-in-your-stride/build-kit.cjs',
    );

    // History: byte-identical, at the same place or inside the moved folder.
    for (const [h, text] of Object.entries(historyBefore)) expect(read(h)).toBe(text);
    for (const [h, text] of Object.entries(movedBefore)) expect(read(`${NEW}/${h}`)).toBe(text);
    expect(read('projects/ai-search-outreach/inbox/today.json')).toBe(
      '{"from":"projects/ai-search-outreach/inbox"}\n',
    );
    // No temp files left behind.
    expect(Object.keys(tree()).filter((p) => /\.tmp~$/.test(p))).toEqual([]);
  });

  it('a second apply changes nothing', () => {
    expect(run(['--apply']).exit).toBe(0);
    const after = tree();
    const again = run(['--apply']);
    expect(again.exit, again.stdout).toBe(0);
    expect(again.summary).toMatchObject({
      ok: true,
      changes: 0,
      todosMade: 0,
      itemsTicked: 0,
      filesRewritten: 0,
    });
    expect(tree()).toEqual(after);
    expect(run([]).summary).toMatchObject({ ok: true, planned: 0 });
  });

  it('the agency-brian item that names its to-do is ticked with that pointer, never added', () => {
    expect(run(['--apply']).exit).toBe(0);
    const text = read(`${NEW}/agency-brian-google-ads-manager/todo.md`);
    expect(text).toContain(`(\`${POINTER}\`, due 16 Nov). → ${POINTER}`);
    expect(madeTodos().filter((t) => String(t.fm.data.title).includes('gate loop'))).toEqual([]);
    // The other item that only mentions a to-do file is still added.
    expect(madeTodos().filter((t) => String(t.fm.data.title).startsWith('Mon 16 Nov'))).toHaveLength(1);
    expect(text).toContain('- [x] Already done before the move.\n');
  });
});

describe('crash and rerun', () => {
  const settle = () => {
    const d = new Date();
    const stamp = `todo/${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-`;
    // To-dos made by the run hold the time they were made: compare their names, and every other
    // file's bytes.
    return Object.fromEntries(Object.entries(tree()).map(([k, v]) => [k, k.startsWith(stamp) ? 'made' : v]));
  };
  const titles = () =>
    madeTodos()
      .map((t) => `${t.fm.data.title}|${t.fm.data.project}`)
      .sort();

  it('a crash after a to-do is made but before its item is ticked gives no duplicate on rerun', () => {
    const crash = run(['--apply'], { REHOME_TEST_CRASH: 'after-add:3' });
    expect(crash.exit).toBe(70);
    expect(madeTodos()).toHaveLength(3);
    // The third to-do's item is still open in its checklist.
    expect(read('projects/ai-blueprint/todo.md')).toMatch(/^- \[ \] Re-run the scraper/m);
    const again = run(['--apply']);
    expect(again.exit, again.stdout).toBe(0);
    expect(again.stdout).toContain('its to-do is already made');
    expect(madeTodos()).toHaveLength(9);
    expect(new Set(titles()).size).toBe(9);
    expect(read(`${NEW}/ai-blueprint/todo.md`)).not.toMatch(/^- \[ \]/m);
    expect(run(['--apply']).summary).toMatchObject({ changes: 0 });
  });

  it('a to-do deleted between a crash and the rerun is not made again', () => {
    expect(run(['--apply'], { REHOME_TEST_CRASH: 'after-add:3' }).exit).toBe(70);
    const made = madeTodos();
    const gone = must(made[made.length - 1], 'a made to-do');
    mkdirSync(abs('todo/deleted'), { recursive: true });
    renameSync(abs(`todo/${gone.name}`), abs(`todo/deleted/${gone.name}`));
    expect(run(['--apply']).exit).toBe(0);
    expect(madeTodos().map((t) => t.fm.data.title)).not.toContain(gone.fm.data.title);
    expect(madeTodos()).toHaveLength(8);
  });

  it('a crash half-way through moving a folder finishes on rerun and ends like a clean run', () => {
    const crash = run(['--apply'], { REHOME_TEST_CRASH: 'after-entry:3' });
    expect(crash.exit).toBe(70);
    expect(existsSync(abs(`${NEW}/ai-search-outreach`))).toBe(true);
    expect(
      existsSync(abs('projects/ai-search-outreach/todo.md')) ||
        existsSync(abs('projects/ai-search-outreach/scripts')),
    ).toBe(true);
    const again = run(['--apply']);
    expect(again.exit, again.stdout).toBe(0);
    const resumed = settle();
    const resumedTitles = titles();

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    buildBrain();
    expect(run(['--apply']).exit).toBe(0);
    expect(settle()).toEqual(resumed);
    expect(titles()).toEqual(resumedTitles);
  });
});

describe('preflight refusals', () => {
  function refuses(reason: RegExp, args: string[] = []) {
    const before = tree();
    const r = run(['--apply', ...args]);
    expect(r.exit, r.stdout).toBe(2);
    expect(r.summary.ok).toBe(false);
    expect(
      (r.summary.refused as string[]).some((x) => reason.test(x)),
      JSON.stringify(r.summary),
    ).toBe(true);
    expect(tree()).toEqual(before);
  }

  it('the Workbench v2 patch is not in place (unless the check is skipped)', () => {
    put('tools/members/command-centre/lib/todo-parser.cjs', '// v1\n');
    refuses(/Workbench v2 patch isn't in place/);
    expect(run(['--skip-workbench-check']).exit).toBe(0);
  });

  it('a live source has no card', () => {
    rmSync(abs('projects/client-portal/project.md'));
    refuses(/projects\/client-portal has no project\.md card/);
  });

  it('a target exists with different contents', () => {
    put(`${NEW}/brain-map/project.md`, card('Another brain map', 'ian-hancock'));
    refuses(
      /target exists with different contents: clients\/the-digital-stride\/projects\/brain-map\/project\.md/,
    );
  });

  it("a payload fails the to-do script's own checks", () => {
    put('projects/client-portal/todo.md', checklist('Client Portal', [`- [ ] ${'word '.repeat(1700)}end`]));
    refuses(/details over 8000 characters|the to-do script refuses it/);
  });

  it('a payload the to-do script itself refuses (checked in a throwaway brain, not this one)', () => {
    put(
      '.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs',
      [
        'const chunks = [];',
        "process.stdin.on('data', (c) => chunks.push(c));",
        "process.stdin.on('end', () => {",
        "  if (process.argv[2] === 'roster') {",
        `    process.stdout.write(JSON.stringify({ members: ${JSON.stringify(['pete-tyler', 'ian-hancock', 'simon-jones', 'ben-mcadam', 'steve-blassberg'].map((slug) => ({ slug, name: slug })))} }) + '\\n');`,
        '    return;',
        '  }',
        "  if (!process.env.BRAIN_ROOT.includes('rehome-check-')) require('fs').writeFileSync(process.env.BRAIN_ROOT + '/todo/WRONG.md', 'x');",
        "  process.stdout.write(JSON.stringify({ error: 'stub says no', status: 400 }) + '\\n');",
        '  process.exitCode = 2;',
        '});',
      ].join('\n'),
    );
    refuses(/the to-do script refuses it: stub says no/);
  });

  it('the assignee is not in the roster', () => {
    put(
      '.team-config/roles.json',
      JSON.stringify({ members: ROLES.members.filter((m) => !m.name.startsWith('Steve')) }),
    );
    refuses(/steve-blassberg isn't in the roster/);
  });

  it('a file mentioning a moved path is on neither list', () => {
    put('context/random-note.md', 'See projects/brain-map/README.md for how.\n');
    refuses(/context\/random-note\.md:1: mentions a moved path but is on neither/);
    rmSync(abs('context/random-note.md'));
    put(`projects/ai-search-outreach/clients/seo.json`, '{"path":"projects/ai-search-outreach/clients"}\n');
    refuses(/projects\/ai-search-outreach\/clients\/seo\.json:1/);
  });

  it('a depth fix that no longer finds its text', () => {
    put('projects/ai-in-your-stride/build-kit.cjs', 'const ROOT = somewhereElse;\n');
    refuses(/build-kit\.cjs: expected .* once for the depth fix, found it 0 times/);
  });
});

describe('title cutting', () => {
  it('keeps a short title and cuts a long one at a word boundary to 200 characters', () => {
    expect(rehome.cutTitle('  Book the   next attendee. ')).toEqual({
      title: 'Book the next attendee.',
      cut: false,
    });
    const exact = 'a'.repeat(200);
    expect(rehome.cutTitle(exact)).toEqual({ title: exact, cut: false });
    const { title, cut } = rehome.cutTitle(LONG_ITEM);
    expect(cut).toBe(true);
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('…')).toBe(true);
    const stem = title.slice(0, -1);
    const plain = LONG_ITEM.replace(/\*\*/g, '');
    expect(plain.startsWith(stem)).toBe(true);
    expect(plain[stem.length]).toBe(' ');
    // No space at all: a hard cut.
    expect(rehome.cutTitle('x'.repeat(300)).title).toBe(`${'x'.repeat(199)}…`);
    // Titles show as typed: bold marks and backticks go, and the full text is kept in the details.
    expect(rehome.cutTitle('**Pete:** share the `drive/` folder')).toEqual({
      title: 'Pete: share the drive/ folder',
      cut: true,
    });
    expect(rehome.cutTitle('keep snake_case_names as they are')).toEqual({
      title: 'keep snake_case_names as they are',
      cut: false,
    });
  });

  it('puts the full text in the details when the title is cut', () => {
    expect(run(['--apply']).exit).toBe(0);
    const t = must(
      madeTodos().find((x) => String(x.fm.data.title).startsWith('Tritax run')),
      'Tritax to-do',
    );
    expect(String(t.fm.data.title).length).toBeLessThanOrEqual(200);
    expect(t.fm.body.trim()).toBe(LONG_ITEM);
    const short = must(
      madeTodos().find((x) => String(x.fm.data.title).startsWith('Re-run the scraper')),
      'short to-do',
    );
    expect(short.fm.body.trim()).toBe('');
  });
});

describe('path boundary rules', () => {
  const rw = (text: string, rel = 'README.md') => rehome.rewriteText(rel, text);
  it('rewrites only the eight slugs, only on a path boundary', () => {
    expect(rw('see projects/brain-map/x')).toBe('see clients/the-digital-stride/projects/brain-map/x');
    expect(rw('`projects/ai-blueprint`.')).toBe('`clients/the-digital-stride/projects/ai-blueprint`.');
    expect(rw('/Users/x/agencybrain/projects/gads-api-writes/a.cjs')).toBe(
      '/Users/x/agencybrain/clients/the-digital-stride/projects/gads-api-writes/a.cjs',
    );
    expect(rw('(projects/client-portal)')).toBe('(clients/the-digital-stride/projects/client-portal)');
    expect(rw('projects/brain-map-v2 and projects/brain-maps')).toBe(
      'projects/brain-map-v2 and projects/brain-maps',
    );
    expect(rw('myprojects/brain-map and old.projects/brain-map and x-projects/brain-map')).toBe(
      'myprojects/brain-map and old.projects/brain-map and x-projects/brain-map',
    );
    expect(rw('projects/tds-brain-app and projects/ and projects-archive/aesop-funnel-report')).toBe(
      'projects/tds-brain-app and projects/ and projects-archive/aesop-funnel-report',
    );
  });

  it('never rewrites a path already under clients/<x>/ or personal/', () => {
    const kept =
      'clients/acme/projects/brain-map, clients/the-digital-stride/projects/ai-blueprint, personal/projects/brain-map';
    expect(rw(kept)).toBe(kept);
    const once = rw('projects/brain-map');
    expect(rw(once)).toBe(once);
  });

  it('changes only comment lines in .gitignore', () => {
    expect(
      rw(
        '# in projects/ai-blueprint/x\n/projects/ai-search-outreach/\r\n  # projects/brain-map\r\n',
        '.gitignore',
      ),
    ).toBe(
      '# in clients/the-digital-stride/projects/ai-blueprint/x\n/projects/ai-search-outreach/\r\n  # clients/the-digital-stride/projects/brain-map\r\n',
    );
  });

  it('sorts files onto the rewrite and history lists', () => {
    expect(rehome.classify('projects/ai-search-outreach/scripts/qualify.cjs')).toBe('rewrite');
    expect(rehome.classify(`${NEW}/brain-map/scan.cjs`)).toBe('rewrite');
    expect(rehome.classify(`${NEW}/brain-map/graph.js`)).toBe('history');
    expect(rehome.classify('projects/ai-blueprint/project.md')).toBe('history');
    expect(rehome.classify('projects/client-portal/notes/x.md')).toBe('history');
    expect(rehome.classify('projects/ai-search-outreach/inbox/x.json')).toBe('history');
    expect(rehome.classify('.claude/skills/gads-write/SKILL.md')).toBe('rewrite');
    expect(rehome.classify('.team-config/feedback/gads-proxy.md')).toBe('history');
    expect(rehome.classify('clients/book-vault/context/account-changelog.md')).toBe('history');
    expect(rehome.classify('clients/_archive/tritax/blueprint/x.md')).toBe('history');
    expect(rehome.classify('todo/done/20261004-portal.md')).toBe('history');
    expect(rehome.classify('tools/save-location-baseline.json')).toBe('history');
    expect(rehome.classify('context/elsewhere.md')).toBeNull();
    expect(rehome.classify('projects/ai-search-outreach/config/x.json')).toBeNull();
  });
});
