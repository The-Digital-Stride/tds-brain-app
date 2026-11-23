import { type FormEvent, useId, useMemo, useRef, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import {
  PROJECT_SLUG_MAX,
  PROJECT_TITLE_MAX,
  type ProjectCard,
} from '../../../../shared/projects-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { SearchSelect } from '../../shell/SearchSelect.tsx';
import { Seg } from '../../shell/Seg.tsx';
import type { PickOption } from '../../shell/search-select.ts';
import { projectsStore, useProjects } from '../../state/projects.ts';
import {
  changedFields,
  changedFieldWords,
  dateWords,
  EMPTY_VALUES,
  type FormErrors,
  type FormValues,
  fieldsFromValues,
  joinWords,
  KNOWN_SERVICES,
  LIGHT_WORDS,
  MOVE_LEGACY,
  MOVE_NO_SKILL,
  type MoveState,
  mergeOntoLatest,
  personName,
  STATUS_WORDS,
  STATUSES,
  serviceWords,
  slugFromTitle,
  validate,
  valuesFromCard,
} from './logic.ts';
import { useProjectChange } from './useChange.ts';

/** Form order, so the first invalid field gets focus. Ids match `id(name)` below. */
const FIELD_ORDER = ['title', 'client', 'slug', 'end', 'budget', 'stages', 'brief', 'team'] as const;

/** Shown after Add a card when the Account Owner we sent didn't stick. */
export const OWNER_DROPPED =
  'Saved. Only an owner or a scout can set the Account Owner on an existing folder, so it was left blank.';

type Mode = 'create' | 'edit' | 'card';

const KINDS = [
  { value: '', label: 'Not set' },
  { value: 'one-off', label: 'One-off' },
  { value: 'ongoing', label: 'Ongoing' },
] as const;
const LIGHTS = [
  { value: '', label: 'Not set' },
  { value: 'green', label: LIGHT_WORDS.green },
  { value: 'amber', label: LIGHT_WORDS.amber },
  { value: 'red', label: LIGHT_WORDS.red },
] as const;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Create a project, edit one, or add a card to a card-less folder. Every field of ProjectFields is here. */
export function ProjectForm({
  mode,
  card,
  clients,
  team,
  me,
  canMove = 'none',
  onMove,
  onDone,
  onCancel,
}: {
  mode: Mode;
  card: ProjectCard | null;
  clients: readonly { slug: string; name: string; aliases?: string[] }[];
  team: readonly TeamMember[] | undefined;
  me: string;
  /** Edit only: whether Move… is offered, and if not, why. */
  canMove?: MoveState;
  /** Leaves the form for the move screen. */
  onMove?: () => void;
  /** The new project's key after a create (null otherwise), and a line to show when a save left something out. */
  onDone: (key: string | null, notice?: string) => void;
  onCancel: () => void;
}) {
  const change = useProjectChange();
  const { refresh } = useProjects();
  const [v, setV] = useState<FormValues>(() =>
    card ? valuesFromCard(card) : { ...EMPTY_VALUES, owner: me },
  );
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'' | 'cancel' | 'move'>('');
  const [dropEnd, setDropEnd] = useState(false);
  const [kindNote, setKindNote] = useState('');
  const [reloaded, setReloaded] = useState('');
  const initial = useRef(JSON.stringify(v));
  const seen = useRef<ProjectCard | null>(card);
  const base = useId();
  const id = (n: string) => `${base}-${n}`;
  const set = (patch: Partial<FormValues>) => setV((x) => ({ ...x, ...patch }));
  const justMe = v.client === 'personal';
  const lastClient = useRef('');

  const clientOptions = useMemo<PickOption[]>(
    () => clients.map((c) => ({ value: c.slug, label: c.name, terms: c.aliases, group: 'Clients' })),
    [clients],
  );

  // Everyone on the roster, plus anyone already on the card who is not.
  const people = useMemo(() => {
    const slugs = new Set((team ?? []).map((m) => m.slug));
    for (const p of [...v.team, v.owner, card?.owner ?? '', ...(card?.team ?? [])]) if (p) slugs.add(p);
    return [...slugs].sort((a, b) => personName(a, team).localeCompare(personName(b, team), 'en-GB'));
  }, [team, v.team, v.owner, card]);
  const services = useMemo(() => [...new Set([...KNOWN_SERVICES, ...v.service])], [v.service]);

  // After a "changed" refusal: take the latest card, keep what this person typed, and say what a teammate changed.
  const reload = async () => {
    await refresh();
    const latest = projectsStore.get().list?.projects.find((p) => p.key === card?.key);
    const old = seen.current;
    if (!latest || !old) return;
    const theirs = changedFieldWords(old, latest);
    const mine = changedFields(old, v);
    const mineWords = changedFieldWords(old, { ...old, ...mine, version: old.version } as ProjectCard);
    const both = theirs.filter((w) => mineWords.includes(w));
    const who = latest.lastChanged ? personName(latest.lastChanged.by, team) : 'Someone';
    setV(mergeOntoLatest(old, v, latest));
    seen.current = latest;
    initial.current = JSON.stringify(valuesFromCard(latest));
    setReloaded(
      `${who} changed ${theirs.length > 0 ? joinWords(theirs) : 'this project'}. ` +
        (both.length > 0
          ? `You also changed ${joinWords(both)}, so your version is shown. Check it before you save. Your other changes are kept.`
          : 'Your other changes are kept.'),
    );
    setFailure(null);
  };

  const dirty = JSON.stringify(v) !== initial.current;
  const cancel = () => (dirty ? setAsking('cancel') : onCancel());
  const startMove = () => (dirty ? setAsking('move') : onMove?.());

  const setKind = (kind: FormValues['kind'], confirmed = false) => {
    if (kind === v.kind) return;
    if (kind === 'ongoing' && v.end && !confirmed) {
      setDropEnd(true);
      return;
    }
    setDropEnd(false);
    const clearBudget = v.kind !== '' && v.budget.trim() !== '';
    set({ kind, ...(kind === 'ongoing' ? { end: '' } : {}), ...(clearBudget ? { budget: '' } : {}) });
    setKindNote(
      clearBudget ? 'Budget hours cleared: one-off is for the whole project, ongoing is per month.' : '',
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const found = validate(v, mode);
    setErrors(found);
    setFailure(null);
    setReloaded('');
    const first = FIELD_ORDER.find((k) => found[k]);
    if (first) {
      // Focus after the errors have drawn.
      setTimeout(() => document.getElementById(id(first))?.focus(), 0);
      return;
    }
    setBusy(true);
    let res: Awaited<ReturnType<typeof change>>;
    let key: string | null = null;
    if (mode === 'create') {
      const personal = v.client === 'personal';
      key = `${personal ? 'personal' : v.client}/${v.slug}`;
      res = await change({
        kind: 'create',
        space: personal ? 'personal' : 'client',
        ...(personal ? {} : { client: v.client }),
        slug: v.slug,
        fields: fieldsFromValues(v),
      });
    } else if (card && mode === 'card') {
      res = await change({ kind: 'card', key: card.key, fields: fieldsFromValues(v) });
    } else if (card) {
      // Against the card the form was filled from, not the live one: a refresh while editing must not
      // turn a teammate's change into one of ours, and must still end in a "changed" refusal.
      const base = seen.current ?? card;
      const fields = changedFields(base, v);
      if (Object.keys(fields).length === 0) {
        setBusy(false);
        onCancel();
        return;
      }
      res = await change({ kind: 'edit', key: card.key, fields, expect: base.version });
    } else {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (res.ok) {
      const kept = mode === 'card' && card ? res.list.projects.find((c) => c.key === card.key) : undefined;
      const dropped = mode === 'card' && v.owner !== '' && kept !== undefined && !kept.owner;
      onDone(key, dropped ? OWNER_DROPPED : undefined);
    } else setFailure({ code: res.code, message: res.message });
  };

  const heading =
    mode === 'create'
      ? 'New project'
      : mode === 'card'
        ? `Add a card to ${card?.title ?? 'this project'}`
        : 'Edit project';
  const ongoing = v.kind === 'ongoing';
  const clientName = clients.find((c) => c.slug === card?.client)?.name ?? card?.client ?? '';

  return (
    <form className="proj-form-page" onSubmit={(e) => void submit(e)} noValidate aria-label={heading}>
      <div className="proj-head">
        <h2 className="proj-title">{heading}</h2>
      </div>
      {asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={() => (asking === 'move' ? onMove?.() : onCancel())}
          onCancel={() => setAsking('')}
        />
      ) : null}
      {reloaded ? (
        <p className="notice" data-level="warn" data-shape="box" role="status">
          {reloaded}
        </p>
      ) : null}
      {failure ? (
        <div className="notice" data-level="error" data-shape="box" role="alert">
          <span>{failure.message}</span>
          {failure.code === 'changed' ? (
            <button type="button" className="btn" data-size="small" onClick={() => void reload()}>
              Reload
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="card proj-card proj-form">
        <Field id={id('title')} label="Title" error={errors.title}>
          <input
            id={id('title')}
            className="field"
            value={v.title}
            maxLength={PROJECT_TITLE_MAX + 20}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? `${id('title')}-err` : undefined}
            onChange={(e) =>
              set({
                title: e.target.value,
                ...(mode === 'create' && !slugTouched ? { slug: slugFromTitle(e.target.value) } : {}),
              })
            }
          />
        </Field>

        {mode === 'edit' && card ? (
          <div className="form-field">
            <span className="label" id={id('client-label')}>
              Client
            </span>
            <div className="proj-static">
              <span id={id('client-now')}>{card.space === 'personal' ? 'Just me' : clientName}</span>
              {canMove === 'yes' ? (
                <button
                  type="button"
                  className="btn"
                  data-size="small"
                  aria-describedby={`${id('client-now')} ${id('client-hint')}`}
                  onClick={startMove}
                >
                  Move
                </button>
              ) : null}
            </div>
            <p className="hint" id={id('client-hint')}>
              {canMove === 'yes'
                ? card.space === 'personal'
                  ? 'Only you can see it. You can move it to a client.'
                  : 'The team can see it.'
                : canMove === 'no-skill'
                  ? MOVE_NO_SKILL
                  : canMove === 'legacy'
                    ? MOVE_LEGACY
                    : ''}
            </p>
          </div>
        ) : null}

        {mode === 'create' ? (
          <>
            <div className="form-field">
              <span className="label" id={id('who-label')}>
                Who is it for
              </span>
              <Seg
                label="Who is it for"
                labelledBy={id('who-label')}
                value={justMe ? 'me' : 'client'}
                options={[
                  { value: 'client', label: 'A client' },
                  { value: 'me', label: 'Just me' },
                ]}
                onChange={(who) => {
                  if (who === 'me') {
                    if (v.client !== 'personal') lastClient.current = v.client;
                    set({ client: 'personal' });
                  } else set({ client: lastClient.current });
                  setErrors((e) => ({ ...e, client: undefined }));
                }}
              />
              {justMe ? (
                <p className="hint">Only you can see it. You can move it to a client later.</p>
              ) : null}
            </div>
            {justMe ? null : (
              <Field id={id('client')} label="Client" error={errors.client} hint="The team can see it.">
                <SearchSelect
                  id={id('client')}
                  aria-invalid={errors.client ? true : undefined}
                  aria-describedby={`${id('client')}-hint${errors.client ? ` ${id('client')}-err` : ''}`}
                  value={v.client}
                  options={clientOptions}
                  onChange={(client) => set({ client })}
                  recentKey="clients"
                  placeholder="Choose a client"
                />
              </Field>
            )}
            <Field
              id={id('slug')}
              label="Folder name"
              hint={`Lower-case letters, numbers and dashes, up to ${PROJECT_SLUG_MAX}. It can't be changed later.`}
              error={errors.slug}
            >
              <input
                id={id('slug')}
                className="field"
                value={v.slug}
                aria-invalid={errors.slug ? true : undefined}
                aria-describedby={`${id('slug')}-hint${errors.slug ? ` ${id('slug')}-err` : ''}`}
                onChange={(e) => {
                  setSlugTouched(true);
                  set({ slug: e.target.value });
                }}
              />
            </Field>
          </>
        ) : null}

        <div className="form-field">
          <span className="label" id={id('kind-label')}>
            Kind
          </span>
          <Seg
            label="Kind"
            labelledBy={id('kind-label')}
            value={v.kind}
            options={[...KINDS]}
            onChange={(kind) => setKind(kind)}
          />
          {dropEnd ? (
            <div className="notice" data-level="warn" data-shape="box" role="alert">
              <span>
                Ongoing projects have no end date, so the end date ({dateWords(v.end)}) will be removed.
              </span>
              <button
                type="button"
                className="btn"
                data-size="small"
                onClick={() => setKind('ongoing', true)}
              >
                Switch to ongoing
              </button>
              <button type="button" className="btn" data-size="small" onClick={() => setDropEnd(false)}>
                Keep one-off
              </button>
            </div>
          ) : null}
          {kindNote ? (
            <p className="hint" role="status">
              {kindNote}
            </p>
          ) : null}
        </div>
        <div className="form-field">
          <span className="label" id={id('status-label')}>
            Status
          </span>
          <Seg
            label="Status"
            labelledBy={id('status-label')}
            value={v.status}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] }))}
            onChange={(status) => set({ status })}
          />
        </div>
        <div className="form-field">
          <span className="label" id={id('health-label')}>
            Health
          </span>
          <Seg
            label="Health"
            labelledBy={id('health-label')}
            value={v.health}
            options={[...LIGHTS]}
            onChange={(health) => set({ health })}
          />
        </div>
        <div className="form-field">
          <span className="label" id={id('comms-label')}>
            Client comms
          </span>
          <Seg
            label="Client comms"
            labelledBy={id('comms-label')}
            value={v.comms}
            options={[...LIGHTS]}
            onChange={(comms) => set({ comms })}
          />
        </div>
      </section>

      <section className="card proj-card proj-form">
        <Field id={id('owner')} label="Account Owner">
          <select
            id={id('owner')}
            className="field"
            value={v.owner}
            onChange={(e) => set({ owner: e.target.value })}
          >
            <option value="">Not set</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {personName(p, team)}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="form-field proj-checks" id={id('team')} tabIndex={-1}>
          <legend>Team</legend>
          {people.map((p) => (
            <label key={p} className="proj-check">
              <input
                type="checkbox"
                className="tick"
                checked={v.team.includes(p)}
                onChange={(e) =>
                  set({ team: e.target.checked ? [...v.team, p] : v.team.filter((x) => x !== p) })
                }
              />
              <span>{personName(p, team)}</span>
            </label>
          ))}
          {errors.team ? (
            <p className="error" role="alert">
              {errors.team}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="form-field proj-checks">
          <legend>Service</legend>
          {services.map((s) => (
            <label key={s} className="proj-check">
              <input
                type="checkbox"
                className="tick"
                checked={v.service.includes(s)}
                onChange={(e) =>
                  set({ service: e.target.checked ? [...v.service, s] : v.service.filter((x) => x !== s) })
                }
              />
              <span>{serviceWords(s)}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="card proj-card proj-form">
        <div className="proj-pair">
          <Field id={id('start')} label="Start date">
            <input
              id={id('start')}
              className="field"
              type="date"
              value={v.start}
              onChange={(e) => set({ start: e.target.value })}
            />
          </Field>
          {ongoing ? null : (
            <Field id={id('end')} label="End date" error={errors.end}>
              <input
                id={id('end')}
                className="field"
                type="date"
                value={v.end}
                aria-invalid={errors.end ? true : undefined}
                aria-describedby={errors.end ? `${id('end')}-err` : undefined}
                onChange={(e) => set({ end: e.target.value })}
              />
            </Field>
          )}
        </div>
        <Field
          id={id('budget')}
          label={ongoing ? 'Hours a month' : 'Budget hours'}
          hint={ongoing ? 'The hours included each month.' : 'The hours for the whole project.'}
          error={errors.budget}
        >
          <input
            id={id('budget')}
            className="field"
            inputMode="decimal"
            value={v.budget}
            aria-invalid={errors.budget ? true : undefined}
            aria-describedby={`${id('budget')}-hint${errors.budget ? ` ${id('budget')}-err` : ''}`}
            onChange={(e) => set({ budget: e.target.value })}
          />
        </Field>
        <label className="proj-check">
          <input
            type="checkbox"
            className="tick"
            checked={v.billable === true}
            onChange={(e) => set({ billable: e.target.checked })}
          />
          <span>Billable</span>
        </label>
        <Field
          id={id('stages')}
          label="Stages"
          hint="One per line, in order. To-dos can be put in a stage."
          error={errors.stages}
        >
          <textarea
            id={id('stages')}
            className="field proj-area"
            rows={3}
            value={v.stages}
            aria-invalid={errors.stages ? true : undefined}
            aria-describedby={`${id('stages')}-hint${errors.stages ? ` ${id('stages')}-err` : ''}`}
            onChange={(e) => set({ stages: e.target.value })}
          />
        </Field>
        <Field id={id('brief')} label="Brief" error={errors.brief}>
          <textarea
            id={id('brief')}
            className="field proj-area"
            rows={6}
            value={v.brief}
            aria-invalid={errors.brief ? true : undefined}
            aria-describedby={errors.brief ? `${id('brief')}-err` : undefined}
            onChange={(e) => set({ brief: e.target.value })}
          />
        </Field>
      </section>

      <div className="proj-buttons">
        <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
          {mode === 'create' ? 'Create project' : mode === 'card' ? 'Add card' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
