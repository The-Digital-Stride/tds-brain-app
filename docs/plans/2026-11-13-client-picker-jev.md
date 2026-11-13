# Client picker: work the client out from the first message (Jev)

Date: 2026-11-13 · Size: L (two repos) · Branch: `client-picker-jev` (app) · Explainer: none

## Objective

People skip the "Client" dropdown above the Home composer and name the client in their message instead. Worse, the dropdown silently pre-fills the last client used, so a skipped dropdown can tag a chat to the wrong client: the engine is told "keep to clients/<old>/" (`clientLine`, `server/engine/session-manager.ts:303`), the chat gets the wrong chip and grouping, and files are saved under the wrong client. Fix: the app works the client out from the first message (exact name match, then Jev), and asks with one tap only when it can't tell.

## User decisions (fixed)

- Flow: exact name match first, then Jev picks the client, then a one-tap question if Jev is unsure. Remove the last-client pre-fill.
- Jev is reached through a **separate Cloudflare Worker** (not the Google Ads gateway: its `MUTATE_MODE=off` refuses every POST, and Jev's question call is a POST). The TypeSafe key lives only on the Worker.
- The Worker's code is a **new brain skill `jev-proxy`** in `~/agencybrain/.claude/skills/jev-proxy/`, sibling of `gads-proxy` and `meta-proxy`, so brain sessions can use it later (brain search is a separate, later project).
- Jev was added to and then removed from the Google Ads gateway on 2026-11-13; that gateway is back as it was. Don't touch it.
- Drawer work was committed to `app-closes-drawer` (b9232e7) before this branch.

## Decisions

Overseer pre-review (fable) returned 5 blocking and 5 should items; all are folded in below.

1. **New Worker `jev-proxy`, question-only by construction.** Routes: `GET /ping` (no secret; says whether the TypeSafe key is set and the Worker version); `POST /ask` with header `x-proxy-secret`, body `{ state, questions }`. The Worker builds the upstream body itself from `state` and `questions` only (never `assets`, never caller headers): always `POST https://api.typesafe.ai/v1/systemone`, `model` pinned in one constant (`jev-latest`). Refuses: `box` questions, more than 8 questions, a body over 32 KB, a choice with more than 200 criteria, `state` that isn't a string or plain object. Never retries upstream. Logs (console only) the roster name (`owner`, a person's name), status, token counts and time; never `state`, question text or a token.
   Plain: the TypeSafe key sits in one locked place online, and that place can only ask Jev text questions.
2. **Tokens: the Worker's own roster** (overseer decision: a token the app holds must not also open Google Ads). Owner key `JEV_PROXY_SECRET` plus per-person map `JEV_PROXY_TOKENS`, managed by `manage-tokens.cjs` (copied from meta-proxy, roster at `~/.brain-secrets/jev-proxy-tokens.json`, one administrator). Token check compares SHA-256 digests with `crypto.subtle.timingSafeEqual` (equal lengths by construction). Tokens are issued to the team before the app release, or every unnamed message falls back to asking.
   Plain: each person gets their own Jev key, which opens nothing else and can be cut off alone.
3. **Caller config, meta-proxy's tiers** (`meta-proxy/scripts/meta.cjs:9-11`): 1. env `JEV_PROXY_URL` + `JEV_PROXY_SECRET`; 2. `jev-proxy.yaml` in the brain root (`url:`, `secret:`, quotes stripped), added to the brain's `.gitignore` next to `meta-proxy.yaml`; 3. `data/jev-proxy.json` (`{ "url": … }`, synced to the team) + `JEV_PROXY_SECRET` from the brain's `.env`. The app runs under launchd with no brain env loaded, so `server/engine/jev.ts` reads the brain's `.env` file itself (read-only parse, only that one key). URL must be `https:`. The skill ships `scripts/ask.cjs` (`--check`, `--ping`, `ask --state=… --questions=file.json`).
   Plain: the URL is shared with the team automatically; each person's own key never leaves their machine.
4. **The skill's admin scripts are owner/scout only** (`roles: owner, scout` in the SKILL.md frontmatter, with the using steps open to everyone, as meta-proxy does). The skill is built in a staging folder (`<scratchpad>/jev-proxy/`), reviewed, then copied into the brain in one go, because the brain auto-syncs to the team every few minutes.
   Plain: the team never sees a half-built skill.
5. **App: `server/engine/client-guess.ts`, pure logic plus one injected Jev call.**
   - Step 1, exact match (code), whole words, case-insensitive, on: the client's `name`; the slug with hyphens as spaces; and a `map.json` alias only when its letters and digits (lower-cased, non-alphanumerics removed) contain, or sit inside, the name's or slug's (e.g. "Digital Stride", "H2O", "Bookvault"). Exactly one client matched → `sure` (how `named`). Two or more → `ask` with those (at most 3, map order).
   - Other aliases (nicknames: "TDS", "Our Account", "UC", "AC", "Air Con", "Rooflights") are **hints**, never `sure` on their own: matched case-sensitively when 3 characters or fewer or all capitals, else case-insensitively, whole words. A hinted client goes to Jev; if Jev is unsure or down, `ask` puts the hinted clients first.
   - Step 2, Jev, when step 1 found no single name. One `choice` question: criteria = each client slug → "The client <Name> (also called <aliases>)" (aliases without `_`/`-`), except `the-digital-stride` → "The Digital Stride's own marketing: its ads, website and SEO", plus `none` → "Not about any one client: internal agency work, admin, tools, hiring or general questions". State = the message text cut to 4,000 characters.
   - Gate, thresholds in one exported block `CLIENT_GUESS_THRESHOLDS`: top is a client with probability ≥ 0.90 and confidence ≥ 0.80 → `sure` (how `jev`). Top is `none` with probability ≥ 0.80 → `none`. Else → `ask` with client choices at probability ≥ 0.10, best first, at most 2, after any hinted clients (dedupe, at most 3). A `choice` that isn't one of the criteria is treated as Jev unavailable.
   - Jev unavailable (no config, 2,000 ms timeout, any error) → `ask` with hinted clients or no options. After a failure, Jev is skipped for 60 seconds. Never throws.
   - Empty text (a skill chat with nothing after the name) → `none`, nothing sent.
   Plain: real names are instant and free; nicknames and indirect mentions go to Jev; anything unsure becomes one tap.
6. **App: new route `POST /api/client-guess`**, body `ClientGuessRequest`, answer `ClientGuessResponse` (`shared/contract.ts`). Accepts text up to `MAX_PROMPT_CHARS` (100,000) and cuts it to 4,000 itself; non-string → `bad-request`. `StartSessionRequest` is unchanged: Home still sends an explicit `client` (slug or null); older app versions keep working. The client calls it with the first 4,000 characters and treats any error or unknown `kind` as `ask` with no options. Fetches to the Worker: `https:` only, `redirect: 'error'`.
   Plain: the server answers "who is this for?" before the chat starts, and the chat then starts exactly as it does today.
7. **Home UI.** The standalone "Client" row above the composer goes. Composer gets a `tools` slot in `.composer-foot`; Home puts a native `.field` select there with a visually hidden label "Client": options "Client: auto" (default), "No client", then client names. No new menu component.
   - After Send with auto: Composer's `onSend` promise stays open while the guess and any question are pending (the box is read-only, nothing is cleared). After 400 ms a polite status "Working out the client…" appears. `sure`/`none` → start the chat → resolve `true`.
   - `ask` → an inline card above the composer reusing `.pending` (the Answer box style): `role="group"` named by its heading "Which client is this for?", focus moves to it; standard `.btn` per option (none primary), "Not client work", and a `.field` select "Another client…" with the full list. A choice starts the chat and resolves `true`. "Cancel" or Escape closes the card and resolves `false` (text and files stay in the box). Home never stashes the text.
   - The guess is skipped when the person chose a client or "No client" in the select.
   Plain: people just type; the app interrupts only when it truly can't tell, and what's sent is exactly what's in the box.
8. **No more pre-fill; other ways in keep their client.** Home neither reads nor writes `clientChoice` and ignores `prefs.lastClient` (the server still writes it, for compatibility). The library apps' shared choice (`client/src/apps/shared/store.ts`, `pickScope`) is unchanged. `newChat` gains `client?: string | null`: the palette's `chooseClient` (`client/src/shell/Palette.tsx:167`) passes its slug instead of setting `clientChoice`; a to-do chat (`Home.tsx:67`) passes the to-do's `client` (a personal to-do: No client). A chat opened with a client set shows that client in the select and skips the guess. `docs/design-system.md:185-187` is updated to match.
   Plain: a forgotten setting can't quietly file a chat under the wrong client, and picking a client from search or opening a to-do still works.
9. **Skill chats** from the palette follow decision 5/7 like any other new chat.
10. **Privacy line, no toggle** (overseer decision: choosing a client yourself already sends nothing). Settings, near the chat settings, UK English: "To spot the client, the first message of a new chat is sent to Jev (TypeSafe). Choose a client yourself and nothing is sent." Open: TypeSafe's data retention terms, and a dedicated, spend-capped TypeSafe key for the Worker (both for the owner at console.typesafe.ai).
    Plain: people are told plainly that a new service reads their first message, and how to avoid it.

## Contract

- `shared/contract.ts`: `ClientGuessRequest`, `ClientGuessResponse` (written by the lead).
- `server/engine/client-guess.ts` exports:
  - `interface ClientAlias { slug: string; name: string; aliases: string[] }`
  - `type JevAsk = (state: string, criteria: Record<string, string>, signal: AbortSignal) => Promise<{ choice: string; confidence: number; probabilities: Record<string, number> } | null>`
  - `const CLIENT_GUESS_THRESHOLDS`
  - `function nameMatches(text: string, clients: ClientAlias[]): { named: string[]; hinted: string[] }`
  - `function createClientGuesser(opts: { ask: JevAsk | null; timeoutMs?: number; backoffMs?: number; now?: () => number }): (text: string, clients: ClientAlias[]) => Promise<ClientGuessResponse>` (holds the 60 s backoff)
- `server/engine/jev.ts`: `function jevFromBrain(brainRoot: string, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): JevAsk | null` (reads config per decision 3 at call time).
- Worker HTTP contract: decision 1.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable, high | (read-only) |
| Builder A: Worker skill | `builder`, opus, high | `<scratchpad>/jev-proxy/**` (copied to `~/agencybrain/.claude/skills/jev-proxy/` by the lead) |
| Builder B: server | `builder`, opus, high | `server/engine/client-guess.ts`, `server/engine/client-guess.test.ts`, `server/engine/jev.ts`, `server/engine/jev.test.ts`, `server/http/routes.ts` (the one new route), any alias reader in `server/brain/` with its test |
| Builder C: UI | `builder`, sonnet, medium | `client/src/shell/Home.tsx`, `client/src/shell/Home.test.tsx`, `client/src/shell/ClientAsk.tsx` (new), `client/src/components/Composer.tsx`, `client/src/components/Composer.test.tsx`, `client/src/store.tsx`, `client/src/shell/Palette.tsx`, `client/src/styles/home.css`, `client/src/api.ts` (one new call), `client/src/components/SettingsView.tsx`, `docs/design-system.md` |
| Lead | me | `shared/contract.ts`, this plan, brain copy and `.gitignore` line, deploy, gates |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/engine/client-guess.test.ts` | one real name → sure without Jev; two names → ask with both; "TDS", "air con", "rooflights" never sure on their own and are put first in ask; Jev sure/none/unsure mapped by the thresholds; options under 0.10 dropped; choice outside criteria → unavailable; Jev null/throw/timeout → ask; 60 s backoff; empty text → none; text cut to 4,000 | Builder B (tests first) |
| `server/engine/jev.test.ts` | env beats yaml beats data json + .env; quoted values stripped; http URL refused; no config → null; request shape and header; non-200 → null | Builder B (tests first) |
| `<scratchpad>/jev-proxy/cloudflare/worker.test.mjs` | no/wrong token → 401; per-person token accepted; box question, >8 questions, >32 KB → 400; upstream URL, model and body fixed whatever the caller sends (assets dropped); state and tokens never logged | Builder A (tests first) |
| `client/src/shell/Home.test.tsx`, `Composer.test.tsx` | no client row above the composer; auto + sure starts with the client; ask shows the card, box read-only, text kept; a tap starts with the chosen client; Cancel/Escape keeps the text; manual pick skips the guess; no pre-fill from `lastClient` or `clientChoice`; to-do and palette chats carry their client | Builder C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint (biome) · [ ] Build (no dev server on 3000–3002)
- [ ] Domain gates: security (Worker auth, token handling, data sent to TypeSafe), UX (Home flow, card, copy in UK English)
- [ ] Browser check: Home → a message naming a client; one naming none; one ambiguous; manual pick
- [ ] Live: Worker deployed, `/ping` ok, 10-message trial through the Worker (speed and accuracy)

## Review outcomes

<Filled at step 10.>
