/**
 * `pnpm help:shots`: makes the pictures for the help pages (plan 2026-11-15-cortex-help-phase-1, decision 14).
 *
 * Copies the made-up Brain (scripts/help-demo/brain) into .help-demo/, starts the app in demo mode on its own
 * port with a scripted pretend Claude, drives it with its own Chrome (playwright-core, a fresh browser profile),
 * and writes help/images/<id>.webp for each entry in help/shots.json. Never touches the installed app, the real
 * Brain or the person's Chrome. Every shot starts from a fresh copy of the demo, so scenes never depend on each other.
 *
 * Run: node scripts/help-shots.ts [--only <id>]
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import sharp, { type OverlayOptions } from 'sharp';
import type { HelpShot } from '../client/src/help/contract.ts';
import { TOUR_VERSION } from '../client/src/tour/steps.ts';
import { demoSafeEnv } from '../server/engine/demo-guard.ts';
import { codeFromRunningServer, signInUrl } from '../server/launcher.ts';
import { defaultDataDir, expandHomeFor, readSettings } from '../server/settings.ts';
import { createAppStore } from '../server/store/app-store.ts';
import { createTokenSavingsStore } from '../server/store/token-savings.ts';
import { demoGitEnv, redact } from './help-shots-lib.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DEMO = join(ROOT, '.help-demo');
const BRAIN = join(DEMO, 'brain');
const DATA = join(DEMO, 'data');
const SEED = join(ROOT, 'scripts', 'help-demo', 'brain');
/** Files the attach scene picks: made up, kept with the demo seed and never from the person's disk. */
const SEED_FILES = join(ROOT, 'scripts', 'help-demo', 'files');
const IMAGES = join(ROOT, 'help', 'images');
const SHOTS = join(ROOT, 'help', 'shots.json');
/** Not the installed app's port (3877) and not the dev preview's (3878). */
const PORT = 3879;
const MAX_BYTES = 150 * 1024;
const FROZEN = '2026-11-20T09:30:00.000Z';
const VIEWPORT = { width: 1000, height: 760 };
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  'chats-drawer': { width: 1000, height: 420 },
  'todos-drawer': { width: 1000, height: 600 },
  'skills-drawer': { width: 1000, height: 560 },
  'documents-grid': { width: 920, height: 700 },
  'images-grid': { width: 920, height: 600 },
  'delete-chat': { width: 1000, height: 420 },
  'todo-add': { width: 1000, height: 640 },
  'todo-edit': { width: 1000, height: 700 },
  'file-viewer': { width: 1000, height: 460 },
  palette: { width: 1000, height: 560 },
  'settings-prefs': { width: 1000, height: 1100 },
  'tokens-saved': { width: 1000, height: 1300 },
  'skill-levels': { width: 1000, height: 1300 },
  'help-drawer': { width: 1000, height: 760 },
  'guide-sheet': { width: 1000, height: 780 },
  'settings-todos-switch': { width: 1000, height: 1100 },
};
const NAVY = '#021b43';
const SEED_DATE = new Date('2026-11-12T10:00:00Z');

function log(line: string): void {
  console.log(`[help:shots] ${line}`);
}

/**
 * The real .help-demo folder, made if missing. Refuses a link, or anything that is not the folder of that
 * name in the app folder once links are followed.
 */
function demoRoot(): string {
  if (!existsSync(DEMO)) mkdirSync(DEMO);
  if (lstatSync(DEMO).isSymbolicLink()) throw new Error('Refusing to use .help-demo: it is a link.');
  const real = realpathSync(DEMO);
  if (real !== join(realpathSync(ROOT), '.help-demo'))
    throw new Error('Refusing to use .help-demo: it is not the folder in the app folder.');
  return real;
}

/** Refuses to delete or write anything outside .help-demo, following links (the path or its parent). */
function inDemo(p: string): string {
  const root = demoRoot();
  const full = resolve(p);
  // A missing path (or a dangling link, which rmSync removes without following) is judged by its folder.
  const real = existsSync(full) ? realpathSync(full) : join(realpathSync(dirname(full)), basename(full));
  if (!real.startsWith(root + sep)) throw new Error(`Refusing to touch ${full}: outside .help-demo.`);
  return full;
}

// -- the demo app ----------------------------------------------------------------------------------------------

let server: ChildProcess | null = null;

function touchAll(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.name === '.git') continue;
    if (e.isDirectory()) touchAll(p);
    utimesSync(p, SEED_DATE, SEED_DATE);
  }
}

/** A fresh Brain (a git repo with one commit, so it looks real) and an empty data folder. */
function freshDemo(): void {
  rmSync(inDemo(BRAIN), { recursive: true, force: true });
  rmSync(inDemo(DATA), { recursive: true, force: true });
  mkdirSync(inDemo(DATA));
  cpSync(SEED, inDemo(BRAIN), { recursive: true });
  touchAll(BRAIN);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Alex Morgan', '-c', 'user.email=alex@example.test', ...args], {
      cwd: BRAIN,
      stdio: 'ignore',
      env: demoGitEnv(process.env, SEED_DATE),
    });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Demo Brain');
}

/**
 * Scene-specific starting data, written before the demo app starts. The token ledger goes through the app's own
 * store module (never a hand-written file), into the demo data folder only.
 */
const SEEDERS: Record<string, () => Promise<void>> = {
  async 'tokens-saved'() {
    const store = createTokenSavingsStore(inDemo(DATA));
    const day = '2026-10-20';
    await store.add({ day, source: 'summary', measure: 'compacted', tokens: 184_000, dedupeKey: 'demo-a' });
    await store.add({ day, source: 'cache', measure: 'reused', tokens: 1_250_000, dedupeKey: 'demo-b' });
  },
};

async function startServer(): Promise<{ token: string }> {
  const out: string[] = [];
  server = spawn(process.execPath, ['server/index.ts', '--no-open'], {
    cwd: ROOT,
    // No secrets or proxy settings (Jev's among them): the demo app never reaches the internet.
    env: {
      ...demoSafeEnv(process.env),
      TDS_CORTEX_DEMO: '1',
      TDS_BRAIN_PATH: BRAIN,
      TDS_BRAIN_APP_DATA: DATA,
      TDS_BRAIN_APP_PORT: String(PORT),
      TDS_BRAIN_SERVICE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const proc = server;
  const collect = (b: Buffer) => out.push(String(b));
  proc.stdout?.on('data', collect);
  proc.stderr?.on('data', collect);
  let exited = false;
  proc.on('exit', () => {
    exited = true;
  });
  const runtime = join(DATA, 'runtime.json');
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`The demo server stopped at start-up:\n${redact(out.join(''))}`);
    if (existsSync(runtime)) {
      const token = (JSON.parse(readFileSync(runtime, 'utf8')) as { launchToken?: string }).launchToken;
      if (token && (await codeFromRunningServer(PORT, token)) !== null) return { token };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`The demo server did not start in time:\n${redact(out.join(''))}`);
}

async function stopServer(): Promise<void> {
  const proc = server;
  server = null;
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((done) => {
    const kill = setTimeout(() => proc.kill('SIGKILL'), 8000);
    proc.once('exit', () => {
      clearTimeout(kill);
      done();
    });
    proc.kill('SIGTERM');
  });
}

// -- scenes ----------------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chooseClient(page: Page, name: string): Promise<void> {
  const input = page.locator('#client-select');
  await input.click();
  await input.fill(name);
  await page.getByRole('option', { name }).first().click();
}

/** Types a message on Home with a client picked (never Auto: that would ask a service on the internet). */
async function startChat(page: Page, client: string, text: string, waitFor: string): Promise<void> {
  await chooseClient(page, client);
  await page.locator('textarea.composer-input').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator(waitFor).first().waitFor();
}

async function openDrawer(page: Page, name: 'Chats' | 'To-dos' | 'Skills' | 'Help'): Promise<void> {
  const rail = page.locator(`button.rail-item[data-dock-label="${name}"]`);
  await rail.click();
  await page.locator(`#drawer[aria-label="${name}"]:not([inert])`).waitFor();
}

async function closeDrawer(page: Page): Promise<void> {
  await page.locator('#drawer button.icon-btn[aria-label^="Close "]').first().click();
  await page.locator('#drawer[inert]').waitFor({ state: 'attached' });
}

async function goHome(page: Page): Promise<void> {
  await page.locator('button.rail-item[aria-label="Home"]').click();
  await page.locator('.home-composer').waitFor();
}

async function openApp(page: Page, name: 'Documents' | 'Images'): Promise<void> {
  await page.locator(`button.rail-item[aria-label="${name}"]`).click();
  await page.locator('.lib-main').waitFor();
  await page.locator('.lib-list').first().waitFor();
}

/** Waits until every picture on the page has loaded. */
async function thumbsLoaded(page: Page): Promise<void> {
  await page.waitForFunction(
    () => [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    null,
    {
      timeout: 15000,
    },
  );
  await sleep(500);
}

/** Opens the right panel ("This chat") if it is shut. */
async function openThisChat(page: Page): Promise<void> {
  const toggle = page.locator('button.icon-btn[aria-label="Files and details"]');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await page.locator('.inspector').waitFor();
}

/** The Settings switch that lets the app change to-dos (the demo Brain has a stand-in to-do skill). */
async function enableTodoChanges(page: Page): Promise<void> {
  await page.locator('button.rail-item[aria-label="Settings"]').click();
  await page.locator('#set-direct').click();
  await page.locator('#set-direct[aria-checked="true"]').waitFor();
  await goHome(page);
}

type Scene = (page: Page) => Promise<void>;

const SCENES: Record<string, Scene> = {
  async 'home-start'(page) {
    await goHome(page);
  },

  async 'home-overview'(page) {
    // Pin a few things so the cards under the message box are not empty.
    await openDrawer(page, 'To-dos');
    await page.locator('#drawer .star-btn').nth(0).click();
    await page.locator('#drawer .star-btn').nth(1).click();
    await closeDrawer(page);
    await openDrawer(page, 'Skills');
    await page.locator('#drawer .fold-head button').first().click();
    await page.locator('#drawer .star-btn').first().click();
    await closeDrawer(page);
    await openDrawer(page, 'Chats');
    await page.getByRole('radio', { name: 'Earlier' }).click();
    await page.locator('#drawer .star-btn').first().click();
    await closeDrawer(page);
    await goHome(page);
    await page.locator('.tray .card').first().waitFor();
    await sleep(600);
  },

  async 'chats-drawer'(page) {
    await startChat(page, 'Acme Heating', 'Summarise the call notes for me', '.msg-assistant');
    await goHome(page);
    await startChat(page, 'Northwind', 'Summarise the kick-off call for me', '.msg-assistant');
    await openDrawer(page, 'Chats');
    await page.locator('#drawer .line').nth(1).waitFor();
  },

  async 'chat-reply'(page) {
    await startChat(page, 'Acme Heating', 'Summarise the call notes for me', '.msg-assistant');
  },

  async 'approval-card'(page) {
    await startChat(page, 'Acme Heating', 'approve the change to the call notes', '.approval');
  },

  async 'todos-drawer'(page) {
    // The change switch lives in Settings; the demo Brain has a stand-in to-do skill so the button shows.
    await page.locator('button.rail-item[aria-label="Settings"]').click();
    await page.locator('#set-direct').click();
    await page.locator('#set-direct[aria-checked="true"]').waitFor();
    await goHome(page);
    await openDrawer(page, 'To-dos');
    const seen = page.getByRole('button', { name: 'Mark all as seen' });
    if (await seen.count()) {
      await seen.click();
      // The drawer stays mounted, so "Marked as seen." would stay in the picture. Seen is saved, so a reload
      // brings back the plain list.
      await page.getByText('Marked as seen.').waitFor();
      await page.reload();
      // The shell remembers the open drawer, so after the reload To-dos may already be open.
      await page.locator('button.rail-item[data-dock-label="To-dos"]').waitFor();
      if (!(await page.locator('#drawer[aria-label="To-dos"]:not([inert])').count()))
        await openDrawer(page, 'To-dos');
    }
    await page.locator('#drawer .todo-add-btn, #drawer .todo-add-label').first().waitFor();
  },

  async 'skills-drawer'(page) {
    await openDrawer(page, 'Skills');
    await page.locator('#drawer .fold-head button').first().click();
    await page.locator('#drawer .star-btn').nth(1).click();
  },

  async 'documents-grid'(page) {
    await openApp(page, 'Documents');
    await page.getByRole('radio', { name: 'Grid' }).click();
    for (const name of ['Plans', 'Notes', 'Other'])
      await page.getByRole('button', { name: `Hide ${name}` }).click();
    await page.locator('.lib-list .doc-glyph, .lib-list img').first().waitFor();
    await thumbsLoaded(page);
  },

  async 'images-grid'(page) {
    await openApp(page, 'Images');
    await page.locator('.img-tile img').first().waitFor();
    await thumbsLoaded(page);
    await page.locator('.img-tile .tick').first().check();
  },

  // -- Phase 2 scenes --------------------------------------------------------------------------------------------

  async 'attach-files'(page) {
    await goHome(page);
    await chooseClient(page, 'Acme Heating');
    await page
      .locator('.home-composer input[type="file"]')
      .setInputFiles([join(SEED_FILES, 'visit-notes.txt'), join(SEED_FILES, 'page-figures.csv')]);
    await page.locator('.home-composer .file-chip[data-status="ready"]').nth(1).waitFor();
    await sleep(300);
  },

  async 'level-line'(page) {
    await startChat(page, 'Acme Heating', 'Summarise the call notes for me', '.msg-assistant');
    await page.locator('.level-line').waitFor();
    // One idea per picture: the meter above is left out.
    await page.locator('.context-foot').evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
  },

  async 'context-meter'(page) {
    await startChat(page, 'Acme Heating', 'Summarise the call notes for me', '.msg-assistant');
    await page.locator('.context-meter').waitFor();
    await page.locator('.level-line').evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
  },

  async 'chat-details'(page) {
    await startChat(page, 'Acme Heating', 'Summarise the call notes for me', '.msg-assistant');
    await openThisChat(page);
    await page.getByRole('radio', { name: 'Details' }).click();
    await page.locator('.inspector dl.kv').waitFor();
    // Left out of the picture: when the chat started, how Approvals reads the real ~/.claude settings, and the
    // terminal line (it holds this run's chat id).
    await page.evaluate(() => {
      for (const dt of document.querySelectorAll('.inspector dl.kv dt')) {
        const label = dt.textContent ?? '';
        if (/^(Started|Approvals|Continue in the terminal)$/.test(label)) {
          dt.nextElementSibling?.remove();
          dt.remove();
        }
      }
    });
  },

  async 'chat-files'(page) {
    await startChat(page, 'Acme Heating', 'approve the change to the call notes', '.approval');
    await page.getByRole('button', { name: 'Allow', exact: true }).first().click();
    await page.locator('.msg-assistant').first().waitFor();
    await openThisChat(page);
    await page.getByRole('radio', { name: 'Files' }).click();
    await page.locator('.inspector .files-row').first().waitFor();
    await sleep(600);
  },

  async 'delete-chat'(page) {
    await openDrawer(page, 'Chats');
    await page.getByRole('radio', { name: 'Earlier' }).click();
    await page.locator('#drawer button[aria-label^="Delete chat:"]').first().click();
    await page.locator('#drawer .line-confirm').waitFor();
  },

  async 'todo-add'(page) {
    await enableTodoChanges(page);
    await openDrawer(page, 'To-dos');
    await page.locator('#drawer .todo-add-btn, #drawer .todo-add-label').first().click();
    const form = page.locator('#drawer form[aria-label="Add a to-do"]');
    await form
      .getByRole('textbox', { name: 'What needs doing?' })
      .fill('Call the office manager about the quote');
    await form.getByRole('button', { name: 'Add a due date' }).click();
    await form.getByLabel('Due date (optional)').fill('2026-11-24');
    await form.getByRole('button', { name: "Choose who it's for" }).click();
    await form.getByLabel('Assigned to').selectOption({ label: 'Alex Morgan' });
    await sleep(300);
  },

  async 'todo-edit'(page) {
    await enableTodoChanges(page);
    await openDrawer(page, 'To-dos');
    await page.locator('#drawer button[aria-label^="Edit "]').first().click();
    await page.locator('#drawer form[aria-label^="Edit "]').waitFor();
    await sleep(300);
  },

  async 'settings-todos-switch'(page) {
    await page.locator('button.rail-item[aria-label="Settings"]').click();
    await page.locator('#set-direct').waitFor();
  },

  async 'file-viewer'(page) {
    // A page Claude changed in a chat, opened large from the Files tab.
    await startChat(page, 'Acme Heating', 'approve the change to the call notes', '.approval');
    await page.getByRole('button', { name: 'Allow', exact: true }).first().click();
    await page.locator('.msg-assistant').first().waitFor();
    await openThisChat(page);
    await page.getByRole('radio', { name: 'Files' }).click();
    await page.locator('.inspector .files-row').first().click();
    await page.locator('.inspector .files-actions button[aria-label^="Open "]').click();
    await page.locator('.viewer-drawer .viewer-body').waitFor();
    await sleep(600);
  },

  async palette(page) {
    await page.keyboard.press('Control+k');
    const input = page.locator('.palette-input');
    await input.waitFor();
    await input.fill('october');
    await page.locator('.palette-list .opt').first().waitFor();
    await sleep(600);
  },

  async 'settings-prefs'(page) {
    await page.locator('button.rail-item[aria-label="Settings"]').click();
    await page.locator('section[aria-labelledby="prefs-h"]').waitFor();
  },

  async 'tokens-saved'(page) {
    await page.locator('button.rail-item[aria-label="Settings"]').click();
    await page.locator('section[aria-labelledby="saved-h"] dl.kv').waitFor();
    await page.locator('section[aria-labelledby="saved-h"]').scrollIntoViewIfNeeded();
    // Today and the last 7 and 30 days follow the real date: only the total since the first day stays in.
    await page.evaluate(() => {
      for (const dt of document.querySelectorAll('section[aria-labelledby="saved-h"] dl.kv dt')) {
        if (/^(Today|Last \d+ days)$/.test(dt.textContent ?? '')) {
          dt.nextElementSibling?.remove();
          dt.remove();
        }
      }
    });
  },

  async profile(page) {
    await page.locator('button[aria-label$=": your profile"]').click();
    await page.locator('section[aria-labelledby="profile-h"]').waitFor();
  },

  async 'skill-levels'(page) {
    await page.locator('button.rail-item[aria-label="Settings"]').click();
    await page.locator('section[aria-labelledby="levels-h"] .levels-row').first().waitFor();
    await page.locator('section[aria-labelledby="levels-h"]').scrollIntoViewIfNeeded();
  },

  // Opened from the To-dos drawer's own Help button, so it shows the page for the screen you are on.
  async 'help-drawer'(page) {
    await openDrawer(page, 'To-dos');
    await page.locator('#drawer button[aria-label^="Help: "]').first().click();
    await page.locator('#drawer[aria-label="Help"]:not([inert]) .help-page').waitFor();
    await thumbsLoaded(page);
  },

  async 'guide-sheet'(page) {
    await openDrawer(page, 'Help');
    await page.getByRole('button', { name: 'Open the Cortex Guide' }).click();
    await page.locator('.guide .guide-contents').waitFor();
    await page.locator('.guide .guide-page').waitFor();
    await thumbsLoaded(page);
  },
};

// -- pictures --------------------------------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible' });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`"${selector}" has no size on the page.`);
  return box;
}

/** The person's real Brain folders, from the installed app's settings and the default (read only). */
function realBrains(home: string): string[] {
  const brains = new Set([join(home, 'agencybrain')]);
  const chosen = readSettings(defaultDataDir(home)).brainPath;
  if (chosen) brains.add(resolve(expandHomeFor(chosen, home)));
  return [...brains];
}

/**
 * Words that must never appear in a picture: the person's username and home folder, and, from each real
 * Brain (read only), its client folder names (also with - and _ as spaces) and client display names.
 */
function forbiddenWords(): string[] {
  const home = homedir();
  const words = new Set<string>();
  const add = (w: string) => {
    const t = w.trim();
    if (t.length < 3) return;
    words.add(t);
    words.add(t.replace(/[-_]+/g, ' '));
  };
  const name = userInfo().username;
  if (name) add(name);
  add(home);
  for (const brain of realBrains(home)) {
    const live = join(brain, 'clients');
    try {
      for (const f of readdirSync(live)) if (!f.startsWith('.') && !f.startsWith('_')) add(f);
    } catch {
      // no clients folder
    }
    try {
      const accounts = JSON.parse(readFileSync(join(brain, '.claude', 'accounts.json'), 'utf8')) as unknown;
      if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
        for (const [key, v] of Object.entries(accounts)) {
          add(key);
          const shown = v && typeof v === 'object' ? (v as { name?: unknown }).name : null;
          if (typeof shown === 'string') add(shown);
        }
      }
    } catch {
      // missing or unreadable
    }
  }
  return [...words];
}

/**
 * The text a reader could see in the picture: the crop element's own text, plus every text node, field value
 * and picture description anywhere on the page that overlaps the clip (menus, toasts and other overlays sit
 * outside the crop element). Over-inclusive on purpose: hidden-but-present text counts too.
 */
async function visibleText(page: Page, selector: string, clip: Box): Promise<string> {
  const inCrop = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees
      return (el as HTMLElement).innerText;
    });
  const inClip = await page.evaluate((c) => {
    const hits = (r: DOMRect) =>
      r.width > 0 &&
      r.height > 0 &&
      r.right > c.x &&
      r.left < c.x + c.width &&
      r.bottom > c.y &&
      r.top < c.y + c.height;
    const parts: string[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      if (!text.trim()) continue;
      range.selectNodeContents(n);
      if ([...range.getClientRects()].some(hits)) parts.push(text);
    }
    const attrs = ['alt', 'title', 'aria-label', 'placeholder'];
    for (const el of document.querySelectorAll(
      'input, textarea, select, [alt], [title], [aria-label], [placeholder]',
    )) {
      if (!hits(el.getBoundingClientRect())) continue;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      )
        parts.push(el.value);
      for (const a of attrs) parts.push(el.getAttribute(a) ?? '');
    }
    return parts.join('\n');
  }, clip);
  return `${inCrop}\n${inClip}`;
}

function assertClean(id: string, text: string, words: string[]): void {
  const lower = text.toLowerCase();
  for (const w of words) {
    if (lower.includes(w.toLowerCase())) {
      throw new Error(
        `Shot "${id}" shows text that looks real ("${w.length > 3 ? `${w.slice(0, 2)}...` : w}"). Nothing was saved.`,
      );
    }
  }
}

function calloutSvg(n: number, size: number): Buffer {
  const r = size / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<circle cx="${r}" cy="${r}" r="${r - size * 0.045}" fill="${NAVY}" stroke="#ffffff" stroke-width="${size * 0.09}"/>` +
      `<text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size * 0.55}">${n}</text></svg>`,
  );
}

async function encode(png: Buffer): Promise<Buffer> {
  for (const quality of [92, 86, 80, 74, 68, 60, 50]) {
    const out = await sharp(png).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error('A picture would be larger than 150 KB even at low quality. Crop it tighter.');
}

async function samePixels(file: string, next: Buffer): Promise<boolean> {
  if (!existsSync(file)) return false;
  const [a, b] = await Promise.all([
    sharp(file).raw().toBuffer({ resolveWithObject: true }),
    sharp(next).raw().toBuffer({ resolveWithObject: true }),
  ]);
  return a.info.width === b.info.width && a.info.height === b.info.height && a.data.equals(b.data);
}

async function takeShot(browser: Browser, shot: HelpShot, words: string[]): Promise<'written' | 'unchanged'> {
  const scene = SCENES[shot.scene];
  if (!scene) throw new Error(`Shot "${shot.id}" names a scene that does not exist: "${shot.scene}".`);
  freshDemo();
  // The demo person has taken the tour and read every note, so neither covers a picture.
  await createAppStore(inDemo(DATA)).update({ tourSeen: TOUR_VERSION, whatsNewSeen: '9999.0.0' });
  await SEEDERS[shot.scene]?.();
  const { token } = await startServer();
  const context = await browser.newContext({
    viewport: VIEWPORTS[shot.id] ?? VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.clock.install({ time: new Date(FROZEN) });
    const code = await codeFromRunningServer(PORT, token);
    if (!code) throw new Error('The demo server would not give a sign-in code.');
    await page.goto(signInUrl(PORT, code));
    await page.locator('.home-composer').waitFor();
    await scene(page);
    await sleep(400);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);

    await page.locator(shot.crop).first().scrollIntoViewIfNeeded();
    const pad = shot.pad ?? 16;
    const crop = await boxOf(page, shot.crop);
    const vp = page.viewportSize() ?? VIEWPORT;
    const x = Math.max(0, Math.floor(crop.x - pad));
    const y = Math.max(0, Math.floor(crop.y - pad));
    const clip = {
      x,
      y,
      width: Math.min(vp.width - x, Math.ceil(crop.x + crop.width + pad) - x),
      height: Math.min(vp.height - y, Math.ceil(crop.y + crop.height + pad) - y),
    };
    assertClean(shot.id, await visibleText(page, shot.crop, clip), words);
    let image = await page.screenshot({ clip, animations: 'disabled', caret: 'hide', type: 'png' });

    const dot = 22 * 2;
    const layers: OverlayOptions[] = [];
    for (const c of shot.callouts ?? []) {
      const box = await boxOf(page, c.target);
      // Sits on the target's top-left corner, just outside it, kept inside the picture.
      const left = Math.round(Math.min(Math.max((box.x - clip.x) * 2 - dot * 0.8, 0), clip.width * 2 - dot));
      const top = Math.round(Math.min(Math.max((box.y - clip.y) * 2 - dot * 0.8, 0), clip.height * 2 - dot));
      layers.push({ input: calloutSvg(c.n, dot), left, top });
    }
    if (layers.length > 0) image = await sharp(image).composite(layers).png().toBuffer();

    const webp = await encode(image);
    const file = join(IMAGES, `${shot.id}.webp`);
    if (await samePixels(file, webp)) return 'unchanged';
    mkdirSync(IMAGES, { recursive: true });
    writeFileSync(file, webp);
    log(`${shot.id}.webp ${(webp.length / 1024).toFixed(0)} KB`);
    return 'written';
  } finally {
    await context.close();
    await stopServer();
  }
}

// -- main ------------------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
  if (onlyAt >= 0 && !only) {
    console.error('Give a shot id after --only.');
    return 1;
  }
  const shots = JSON.parse(readFileSync(SHOTS, 'utf8')) as HelpShot[];
  const chosen = only ? shots.filter((s) => s.id === only) : shots;
  if (chosen.length === 0) {
    console.error(`No shot named "${only}" in help/shots.json.`);
    return 1;
  }
  const words = forbiddenWords();

  log('Building the client.');
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' });

  let browser: Browser | null = null;
  const counts = { written: 0, unchanged: 0 };
  try {
    // Chrome as installed, driven with a brand-new profile: never the person's own.
    browser = await chromium.launch({ channel: 'chrome' });
    for (const shot of chosen) counts[await takeShot(browser, shot, words)]++;
    log(`Done: ${counts.written} changed, ${counts.unchanged} unchanged.`);
    return 0;
  } catch (err) {
    console.error(`[help:shots] ${redact(err instanceof Error ? err.message : String(err))}`);
    return 1;
  } finally {
    await browser?.close().catch(() => {});
    await stopServer();
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void stopServer().then(() => process.exit(1));
  });
}
process.exitCode = await main();
