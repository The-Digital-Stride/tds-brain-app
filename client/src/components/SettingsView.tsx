import { useEffect, useId, useMemo, useState } from 'react';
import {
  EFFORT_LEVELS,
  type EffortLevel,
  type EngineChoices,
  type ModelChoice,
} from '../../../shared/contract.ts';
import {
  isLevelTier,
  LEVEL_TIERS,
  LEVEL_TIERS_ORDER,
  type LevelMode,
  type LevelTier,
  type SkillLevels,
} from '../../../shared/levels-contract.ts';
import {
  UPDATE_BLOCKED_TEXT,
  UPDATE_CHECK_FAILED_TEXT,
  UPDATE_UNFINISHED_TEXT,
} from '../../../shared/update-contract.ts';
import { api } from '../api.ts';
import { approvalsSentence } from '../approvals.ts';
import { EFFORT_OPTION_WORDS, modelName } from '../format.ts';
import { helpVisible } from '../help/visibility.ts';
import { APPROVALS_SHORT } from '../shell/Inspector.tsx';
import { Seg } from '../shell/Seg.tsx';
import { useShell } from '../shell/ShellProvider.tsx';
import { phaseText, UpdateAction } from '../shell/UpdateBanner.tsx';
import { syncWords } from '../shell/words.ts';
import { useUpdate } from '../state/update.ts';
import { useStore } from '../store.tsx';
import { useDockApp } from '../useDockApp.ts';
import { HealthPanel } from './HealthPanel.tsx';
import { VersionHistory } from './VersionHistory.tsx';

const ROLE_WORDS = { owner: 'Owner', scout: 'Scout', team: 'Team', unknown: 'Not recognised' } as const;

export function SettingsView() {
  const { boot, updatePrefs, settingsFocus, clearSettingsFocus, skillLevels, setSkillLevel } = useStore();
  const showHelp = helpVisible(boot?.identity.role ?? 'unknown');
  const [choices, setChoices] = useState<EngineChoices | null>(null);
  useEffect(() => {
    let live = true;
    // Never blocks the page: until this arrives (or if it fails) the selects use the fallback model list.
    Promise.resolve()
      .then(() => api.engineChoices())
      .then((c) => live && setChoices(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const ready = Boolean(boot);
  useEffect(() => {
    if (!settingsFocus || !ready) return;
    const el = document.getElementById('set-model');
    el?.focus();
    el?.scrollIntoView?.({ block: 'center' });
    clearSettingsFocus();
  }, [settingsFocus, ready, clearSettingsFocus]);
  const dock = useDockApp();
  const { state: shell, dispatch } = useShell();
  const update = useUpdate();
  if (!boot) return null;
  const { prefs, identity, engine, appVersion } = boot;
  return (
    // The sheet bar above carries the page's heading.
    <div className="page settings">
      <HealthPanel />

      <section aria-labelledby="prefs-h">
        <h2 id="prefs-h">Preferences</h2>
        <div className="setting-rows">
          <div className="setting">
            <div>
              <label className="setting-label" htmlFor="set-direct">
                Let the app change to-dos
              </label>
              <p className="setting-help" id="set-direct-help">
                Lets you mark to-dos as done, add, edit, pass them on and delete them here. Each change is
                made in the shared brain, so the whole team sees it. Off by default.
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
                for To-dos, <kbd>C</kbd> for Chats, <kbd>S</kbd> for Skills
                {showHelp ? (
                  <>
                    , <kbd>H</kbd> or <kbd>?</kbd> for Help
                  </>
                ) : null}{' '}
                and <kbd>/</kbd> to search.
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
          <div className="setting">
            <div>
              <p className="setting-label">Working out the client</p>
              <p className="setting-help">
                With Client set to Auto, the first message of a new chat and your client list go to Jev, a
                TypeSafe service, to work out the client. Choose a client, or No client, and nothing is sent.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="claude-h">
        <h2 id="claude-h">Claude in chats</h2>
        <p className="setting-help" id="claude-help">
          Used by new chats, and by open chats from their next reply.
        </p>
        {/* An older server sends no levelMode: the Model and Effort controls stay as they were. */}
        {prefs.levelMode ? (
          <div className="setting-rows">
            <div className="setting level-mode">
              <div>
                <p className="setting-label" id="level-mode-label">
                  Level
                </p>
                <p className="setting-help" id="level-mode-help">
                  {prefs.levelMode === 'auto'
                    ? 'The app picks Quick, Standard or Deep for each chat. You can change it under the message box.'
                    : 'You choose the model and effort below for every chat.'}
                </p>
              </div>
              <Seg<LevelMode>
                label="How the level is chosen"
                value={prefs.levelMode}
                options={[
                  { value: 'auto', label: 'Automatic (recommended)' },
                  { value: 'manual', label: 'Choose myself' },
                ]}
                onChange={(levelMode) => {
                  if (levelMode !== prefs.levelMode) void updatePrefs({ levelMode });
                }}
              />
            </div>
          </div>
        ) : null}
        {prefs.levelMode === 'auto' ? null : (
          <ClaudeChoices
            choices={choices}
            model={prefs.model ?? null}
            effort={prefs.effort ?? null}
            save={(patch) => void updatePrefs(patch)}
          />
        )}
      </section>

      {skillLevels ? (
        <SkillLevelsSection
          levels={skillLevels}
          skills={boot.skills}
          save={(skill, tier) => void setSkillLevel(skill, tier)}
        />
      ) : null}

      <section aria-labelledby="about-h">
        <h2 id="about-h">About TDS Brain on this computer</h2>
        <dl className="kv about">
          <dt>You are</dt>
          <dd>
            {identity.name}, {ROLE_WORDS[identity.role]}
            {identity.knownMember ? '' : ' (not found in the team list)'}
          </dd>
          <dt>Approvals</dt>
          <dd>
            {APPROVALS_SHORT}
            <span className="kv-note">{approvalsSentence(engine.permissionMode)}</span>
            <span className="kv-note">
              This follows your Claude Code setting, so the app asks as often as your terminal does.
            </span>
          </dd>
          <dt>Dock app</dt>
          <dd>
            {dock.state === 'installed' && 'Installed. TDS Brain is in your Dock.'}
            {dock.state === 'added' && 'Added. TDS Brain is in your Dock.'}
            {dock.state === 'dismissed' && "Not added. You can add it later from Chrome's menu."}
            {dock.state === 'can-install' && (
              <button type="button" className="btn" onClick={() => void dock.install()}>
                Add TDS Brain to your Dock
              </button>
            )}
            {dock.state === 'manual' &&
              "If TDS Brain isn't in your Dock yet, choose Install TDS Brain from Chrome's menu or the address bar."}
          </dd>
          <dt>App version</dt>
          <dd>
            {appVersion}{' '}
            <button
              type="button"
              className="btn"
              data-variant="quiet"
              data-size="small"
              aria-disabled={update.checking}
              onClick={() => {
                if (!update.checking) void update.check();
              }}
            >
              {update.checking ? 'Checking…' : 'Check for updates'}
            </button>
            <UpdateResult update={update} />
          </dd>
        </dl>
      </section>

      {identity.role === 'owner' || identity.role === 'scout' ? (
        <section aria-labelledby="changes-h">
          <h2 id="changes-h">What's changed</h2>
          <p className="setting-help">
            Every version of the app, newest first. Select a version to see what changed.
          </p>
          <VersionHistory current={appVersion} />
        </section>
      ) : null}
    </div>
  );
}

const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "ian-hancock" → "Ian Hancock". */
function setByWords(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function whenWords(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : WHEN.format(new Date(t));
}

/** Settings → Skill levels: the team's level for each skill; Owners and scouts can change them. */
function SkillLevelsSection({
  levels,
  skills,
  save,
}: {
  levels: SkillLevels;
  skills: { name: string; title: string; ownLevel?: unknown }[];
  save: (skill: string, tier: LevelTier | null) => void;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const editable = levels.canSet && levels.writable;
  const titles = useMemo(() => new Map(skills.map((s) => [s.name, s.title])), [skills]);
  // A skill's own model or effort always wins, so a team level would never apply to it.
  const ownSet = useMemo(() => new Set(skills.filter((s) => s.ownLevel).map((s) => s.name)), [skills]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const names = new Set(Object.keys(levels.levels));
    // Searching an editable list also finds skills with no level yet, so a level can be set for them.
    if (editable && q) for (const s of skills) names.add(s.name);
    return [...names]
      .map((name) => ({ name, title: titles.get(name) ?? name }))
      .filter((r) => !q || `${r.title} ${r.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, 'en-GB'));
  }, [levels.levels, skills, titles, query, editable]);
  const total = Object.keys(levels.levels).length;
  const missing = skills.filter((s) => !(s.name in levels.levels) && !ownSet.has(s.name)).length;
  return (
    <section aria-labelledby="levels-h">
      <h2 id="levels-h">Skill levels</h2>
      <p className="setting-help">
        How hard Claude works when a chat runs a skill. A skill's own setting always wins.
      </p>
      {editable && missing > 0 ? (
        <p className="setting-help" id="levels-missing">
          {missing === 1 ? '1 skill has' : `${missing} skills have`} no team level yet. Search to set one.
        </p>
      ) : null}
      {editable ? null : (
        <p className="setting-help" id="levels-readonly">
          {levels.canSet
            ? 'You can change these once the brain has the skill-levels update. Sync the brain, or ask an Owner.'
            : 'Only Owners and scouts can change these.'}
        </p>
      )}
      {total > 8 || editable ? (
        <div className="levels-search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search skills
          </label>
          <input
            id={searchId}
            type="search"
            className="field"
            placeholder={editable ? 'Search skills to set a level' : 'Search skills'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="setting-help">
          {query.trim() ? 'No skills match that search.' : 'No skill has a team level yet.'}
        </p>
      ) : (
        <ul className="levels-list">
          {rows.map((r) => {
            const level = levels.levels[r.name];
            const tier = level && isLevelTier(level.tier) ? level.tier : null;
            const own = ownSet.has(r.name);
            return (
              <li key={r.name} className="levels-row">
                <div className="levels-who">
                  <span className="setting-label">{r.title}</span>
                  <span className="setting-help">
                    {own
                      ? "Set by the skill itself, so a team level doesn't apply"
                      : level
                        ? `${tier ? LEVEL_TIERS[tier].label : 'Unknown level'} · ${level.setBy === 'prefill' ? 'suggested by the app and reviewed' : `set by ${setByWords(level.setBy)}`}${whenWords(level.at) ? `, ${whenWords(level.at)}` : ''}`
                        : 'No team level'}
                  </span>
                </div>
                {editable && !own ? (
                  <span className="levels-actions">
                    <select
                      className="field"
                      aria-label={`Team level for ${r.title}`}
                      value={tier ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isLevelTier(v)) save(r.name, v);
                      }}
                    >
                      {tier ? null : <option value="">Not set</option>}
                      {LEVEL_TIERS_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {LEVEL_TIERS[t].label}
                        </option>
                      ))}
                    </select>
                    {level ? (
                      <button
                        type="button"
                        className="btn"
                        data-variant="quiet"
                        data-size="small"
                        aria-label={`Clear the team level for ${r.title}`}
                        onClick={() => save(r.name, null)}
                      >
                        Clear
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Shown until the server's list arrives, and if it never does. */
const FALLBACK_MODELS: ModelChoice[] = [
  { value: 'opus', label: 'Opus', efforts: null },
  { value: 'sonnet', label: 'Sonnet', efforts: null },
  { value: 'haiku', label: 'Haiku', efforts: null },
];

function ClaudeChoices({
  choices,
  model,
  effort,
  save,
}: {
  choices: EngineChoices | null;
  model: string | null;
  effort: EffortLevel | null;
  save: (patch: { model: string | null } | { effort: EffortLevel | null }) => void;
}) {
  const models = choices?.models.length ? choices.models : FALLBACK_MODELS;
  const codeModel = choices?.claudeCode.model ?? null;
  const modelOptions =
    model && !models.some((m) => m.value === model)
      ? [...models, { value: model, label: modelName(model) }]
      : models;
  const codeRow = codeModel ? models.find((m) => m.value === codeModel) : undefined;
  const row =
    (model ? models.find((m) => m.value === model) : null) ??
    (model ? null : models.find((m) => m.value === codeModel));
  const known = row?.efforts ?? null;
  const efforts = EFFORT_LEVELS.filter((e) => e === effort || !known || known.includes(e));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border and spacing; the heading names the group.
    <div className="setting-rows" role="group" aria-labelledby="claude-h">
      <div className="setting">
        <label className="setting-label" htmlFor="set-model">
          Model
        </label>
        <select
          id="set-model"
          className="field"
          aria-describedby="claude-help"
          value={model ?? ''}
          onChange={(e) => save({ model: e.target.value || null })}
        >
          <option value="">
            {codeModel
              ? `Same as Claude Code (${codeRow?.label ?? modelName(codeModel)})`
              : 'Same as Claude Code'}
          </option>
          {modelOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="setting">
        <label className="setting-label" htmlFor="set-effort">
          Effort
        </label>
        <select
          id="set-effort"
          className="field"
          aria-describedby="claude-help"
          value={effort ?? ''}
          onChange={(e) => save({ effort: (e.target.value || null) as EffortLevel | null })}
        >
          <option value="">Same as Claude Code</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {EFFORT_OPTION_WORDS[e]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function UpdateResult({ update }: { update: ReturnType<typeof useUpdate> }) {
  const { status } = update;
  const running = phaseText(status, update.stalled, update.restarting);
  const failed = status?.phase === 'failed';
  let line = '';
  let action = false;
  if (status && !update.checking) {
    if (running) line = running;
    else if (failed) {
      line = status.error ?? UPDATE_UNFINISHED_TEXT;
      action = !status.blocked;
    } else if (status.blocked) line = UPDATE_BLOCKED_TEXT[status.blocked];
    else if (status.available) {
      line = `${status.latest} is available.`;
      action = true;
    } else if (status.unfinished) {
      line = UPDATE_UNFINISHED_TEXT;
      action = true;
    } else if (status.checkedAt && !status.checkFailed) line = 'You have the newest version.';
    if (status.checkFailed && !running)
      line = line ? `${line} ${UPDATE_CHECK_FAILED_TEXT}` : UPDATE_CHECK_FAILED_TEXT;
  }
  const checked = status?.checkedAt ? syncWords(status.checkedAt, Date.now()).time : '';
  return (
    <>
      {/* Always mounted, so a sentence is announced when it arrives. Only sentences go in it. */}
      <span className="kv-note" aria-live="polite">
        {line}
      </span>
      {action && !running ? (
        <span className="kv-note">
          <UpdateAction
            update={update}
            label={failed || status?.unfinished ? 'Try again' : 'Update and restart'}
          />
        </span>
      ) : null}
      {checked ? <span className="kv-note">Last checked {checked}</span> : null}
    </>
  );
}
