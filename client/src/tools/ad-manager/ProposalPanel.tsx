import { useEffect, useRef, useState } from 'react';
import {
  ADS_DRAFT_CHANGE_CAPABILITY,
  ADS_ERROR_MESSAGES,
  ADS_NOTE_MAX,
  type ClientApprovals,
  type ProposalSummary,
} from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { Fold } from '../../shell/Fold.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useStore } from '../../store.tsx';
import { StatusBadge } from './Approvals.tsx';
import { type RunOptions, useAdsRunner } from './actions.ts';
import { useRestoreFocus } from './focus.ts';
import { adStore, applyReply, findProposal, proposalKey, useAd } from './store.ts';
import { useUnsavedWork } from './unsaved.ts';
import { adsErrorText, isWaiting, personName, proposalFacts } from './words.ts';

type Ask = 'approve' | 'reject' | 'apply' | null;

/** The line shown instead of every button when Ad Manager would act in someone else's name. */
export const identityLine = (_name?: string | null) =>
  `Cortex and the Brain disagree about who you are on this Mac, so changes are switched off. Ask whoever set up this Mac to check the name it signs work with.`;

function LastResult() {
  const { last } = useAd();
  const { openChat } = useStore();
  const { dispatch, modes } = useShell();
  const [showOutput, setShowOutput] = useState(false);
  if (!last) return null;
  return (
    <div className="am-last">
      <p>
        <strong>Last result: </strong>
        <code>{last.id}</code> {last.text}
      </p>
      <div className="am-actions">
        {last.output ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-expanded={showOutput}
            onClick={() => setShowOutput(!showOutput)}
          >
            {showOutput ? 'Hide output' : 'Show output'}
          </button>
        ) : null}
        {last.chatId ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            onClick={() => {
              // A floating panel would sit over the chat drawer, so it closes first (a pushing one stays beside it).
              if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
              openChat(last.chatId as string, { in: 'drawer' });
            }}
          >
            Open chat
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          onClick={() => adStore.set({ last: null })}
        >
          Dismiss
        </button>
      </div>
      {showOutput && last.output ? <pre className="am-output">{last.output}</pre> : null}
    </div>
  );
}

function Actions({
  client,
  p,
  onDirty,
}: {
  client: ClientApprovals;
  p: ProposalSummary;
  /** Tells the panel whether anything is typed, so stepping to another proposal can ask first. */
  onDirty: (dirty: boolean) => void;
}) {
  const { ads } = useStore();
  const { busy, unknownApply, approvals } = useAd();
  const run = useAdsRunner();
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState('');
  const [who, setWho] = useState('');
  const [decided, setDecided] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const whoBox = useRef<HTMLInputElement>(null);
  const decidedBox = useRef<HTMLInputElement>(null);
  const key = proposalKey(client.slug, p.id);
  useRestoreFocus(ask, () => document.querySelector<HTMLElement>('.am-title'));
  const typed = note.trim() !== '' || who.trim() !== '' || decided.trim() !== '';
  useEffect(() => {
    onDirty(typed);
    return () => onDirty(false);
  }, [typed, onDirty]);
  // The shell holds a close, or another proposal, until this is answered; Discard empties the boxes.
  useUnsavedWork(typed, () => {
    setNote('');
    setWho('');
    setDecided('');
  });
  const f = p.flags;
  const canDraft = (ads?.features ?? []).includes(ADS_DRAFT_CHANGE_CAPABILITY);
  const isBusy = busy !== null;
  const inflight = f.inflight === true || unknownApply.includes(key);

  if (ads && ads.sameIdentity === false)
    return (
      <p className="notice" data-level="info" data-shape="box">
        {identityLine(ads.me?.name)}
      </p>
    );

  const base = { client: client.slug, id: p.id };
  const need = (value: string, box: { current: { focus: () => void } | null }, text: string): boolean => {
    if (value.trim()) {
      setHint(null);
      return true;
    }
    setHint(text);
    box.current?.focus();
    return false;
  };
  // The question goes as the work starts, so the button behind it can show it is busy.
  const runAsk = (o: RunOptions) => {
    setAsk(null);
    return run(o);
  };
  const guard = { 'aria-disabled': isBusy || undefined } as const;
  const press = (fn: () => void) => () => {
    if (!isBusy) fn();
  };
  const done = (ok: boolean) => {
    setAsk(null);
    if (ok) {
      setNote('');
      setWho('');
      setDecided('');
    }
  };

  const clearInflight = async () => {
    try {
      await api.adsClearInflight(client.slug, p.id);
      adStore.set({ unknownApply: adStore.get().unknownApply.filter((k) => k !== key) });
      const full = await api.adsProposal(client.slug, p.id);
      applyReply(client.slug, p.id, { proposal: full, message: '' }, false);
    } catch (err) {
      adStore.set({ last: { client: client.slug, id: p.id, ok: false, text: adsErrorText(err) } });
    }
  };

  if (ask === 'approve')
    return (
      <Confirm
        label="Approve this proposal"
        text={`Approve ${p.id}? ${p.fm.title}`}
        action="Approve"
        variant="primary"
        busy={isBusy}
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void runAsk({
            ...base,
            label: 'Approving',
            advance: true,
            call: () => api.adsChange('decide', { ...base, action: 'approve' }),
          }).then(done)
        }
      />
    );
  if (ask === 'reject')
    return (
      <Confirm
        label="Reject this proposal"
        text={`Reject ${p.id}? Your note goes with it.`}
        action="Reject"
        variant="danger"
        busy={isBusy}
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void runAsk({
            ...base,
            label: 'Rejecting',
            advance: true,
            call: () => api.adsChange('decide', { ...base, action: 'reject', note: note.trim() }),
          }).then(done)
        }
      />
    );
  if (ask === 'apply')
    return (
      <Confirm
        label="Apply this change to the live account"
        text={`Apply ${p.id} to the live account? This writes to Google Ads from this Mac, and Cortex can't undo it.`}
        action="Apply now"
        variant="primary"
        busy={isBusy}
        onCancel={() => setAsk(null)}
        onConfirm={() =>
          void runAsk({
            ...base,
            label: 'Applying',
            apply: true,
            call: () => api.adsChange('apply', { ...base, confirmed: true }),
          }).then(done)
        }
      />
    );

  const applying = busy === `apply:${p.id}`;
  const anyAction =
    f.canDecide ||
    f.canDryRun ||
    f.canApply ||
    f.canClientDraft ||
    f.canRecordClientApproval ||
    f.canRecordDecision ||
    inflight;
  const hintId = `am-hint-${p.id}`;
  return (
    <div className="am-act">
      {inflight ? (
        <div className="notice" data-level="warn" data-shape="box">
          <p>{ADS_ERROR_MESSAGES['unknown-outcome']}</p>
          <button type="button" className="btn" data-size="small" onClick={() => void clearInflight()}>
            I've checked the account
          </button>
        </div>
      ) : null}
      {f.canDecide ? (
        <label className="form-field">
          <span className="label">Reason or note (needed to reject or request changes)</span>
          <textarea
            ref={noteBox}
            className="field"
            rows={3}
            maxLength={ADS_NOTE_MAX}
            value={note}
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      ) : null}
      {f.canRecordDecision ? (
        <label className="form-field">
          <span className="label">What was decided</span>
          <input
            ref={decidedBox}
            className="field"
            maxLength={ADS_NOTE_MAX}
            value={decided}
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
            onChange={(e) => setDecided(e.target.value)}
          />
        </label>
      ) : null}
      {f.canRecordClientApproval ? (
        <label className="form-field">
          <span className="label">Who at the client said yes, and how</span>
          <input
            ref={whoBox}
            className="field"
            maxLength={ADS_NOTE_MAX}
            placeholder="For example: Mark, email 29 Oct"
            value={who}
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
            onChange={(e) => setWho(e.target.value)}
          />
        </label>
      ) : null}
      {hint ? (
        <p className="error" id={hintId} role="alert">
          {hint}
        </p>
      ) : null}
      <div className="am-actions">
        {f.canDecide ? (
          <>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              data-size="small"
              {...guard}
              data-am-opener="approve"
              onClick={press(() => setAsk('approve'))}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn"
              data-size="small"
              {...guard}
              onClick={press(() => {
                if (!need(note, noteBox, 'Write what to change first. A note is needed to request changes.'))
                  return;
                void run({
                  ...base,
                  label: 'Requesting changes',
                  advance: true,
                  revise: true,
                  call: () =>
                    api.adsChange('decide', { ...base, action: 'request-changes', note: note.trim() }),
                }).then(done);
              })}
            >
              Request changes
            </button>
            <button
              type="button"
              className="btn"
              data-size="small"
              {...guard}
              data-am-opener="reject"
              onClick={press(() => {
                if (need(note, noteBox, 'Say why first. A note is needed to reject.')) setAsk('reject');
              })}
            >
              Reject
            </button>
          </>
        ) : null}
        {f.canDryRun ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            {...guard}
            onClick={press(
              () => void run({ ...base, label: 'Dry run', call: () => api.adsChange('dry-run', base) }),
            )}
          >
            Dry run
          </button>
        ) : null}
        {f.canClientDraft ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            {...guard}
            onClick={press(
              () => void run({ ...base, label: 'Drafting', call: () => api.adsChange('client-draft', base) }),
            )}
          >
            Draft the client email
          </button>
        ) : null}
        {f.canRecordClientApproval ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            {...guard}
            onClick={press(() => {
              if (!need(who, whoBox, 'Say who at the client agreed, and how.')) return;
              void run({
                ...base,
                label: 'Recording',
                call: () => api.adsChange('client-approved', { ...base, who: who.trim() }),
              }).then(done);
            })}
          >
            Record client approval
          </button>
        ) : null}
        {f.canApply && !inflight ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            {...guard}
            data-am-opener="apply"
            onClick={press(() => setAsk('apply'))}
          >
            {applying ? 'Applying' : 'Apply now'}
          </button>
        ) : null}
        {f.canRecordDecision ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            {...guard}
            onClick={press(() => {
              if (!need(decided, decidedBox, 'Write what was decided first.')) return;
              void run({
                ...base,
                label: 'Recording',
                call: () => api.adsChange('decided', { ...base, note: decided.trim() }),
              }).then(done);
            })}
          >
            Record decision
          </button>
        ) : null}
        {f.canRecordDecision && canDraft ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            {...guard}
            onClick={press(() => {
              if (!need(decided, decidedBox, 'Write what was decided first.')) return;
              void run({
                ...base,
                label: 'Recording',
                draft: true,
                call: () => api.adsChange('decided', { ...base, note: decided.trim(), draftChange: true }),
              }).then(done);
            })}
          >
            Record and draft the change
          </button>
        ) : null}
      </div>
      {busy ? (
        <p className="notice" data-level="info" data-shape="box">
          {applying ? 'Applying to Google Ads. This can take a few minutes. Please wait.' : 'Working…'}
        </p>
      ) : null}
      {!anyAction ? (
        <p className="notice" data-level="info" data-shape="box">
          {client.mine
            ? 'Nothing to do here from Cortex. It was applied by hand or by a script.'
            : `Waiting for ${personName(client.reviewer || client.owner, approvals?.people) || 'the reviewer'}.`}
        </p>
      ) : null}
    </div>
  );
}

/** The right panel for Ad Manager: the chosen proposal's facts, full text and the buttons the person may use. */
export function ProposalPanel() {
  const { approvals, selected, full, last, busy, focusTitle } = useAd();
  const { dispatch, panelHold } = useShell();
  const [dirty, setDirty] = useState(false);
  const [askStep, setAskStep] = useState<-1 | 1 | null>(null);
  const found = findProposal(approvals, selected);
  const key = found ? proposalKey(found.client.slug, found.proposal.id) : '';
  // After a decision the next proposal replaces this one and the button that was pressed is gone: the heading
  // takes focus, so it doesn't drop to the page.
  const seen = useRef(key);
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    const a = document.activeElement;
    if (!a || a === document.body) document.querySelector<HTMLElement>('.am-title')?.focus();
  }, [key]);
  // Details was pressed: say where the details are by moving focus to the title (the panel may only just have opened).
  useEffect(() => {
    if (!focusTitle || !key) return;
    const title = document.querySelector<HTMLElement>('.am-title');
    if (!title) return;
    title.focus();
    adStore.set({ focusTitle: false });
  }, [focusTitle, key]);
  // One status region for the whole panel, always mounted, so each result is announced once.
  const spoken = busy
    ? busy.startsWith('apply:')
      ? 'Applying to Google Ads. This can take a few minutes.'
      : 'Working'
    : last
      ? `${last.id}: ${last.text}`
      : '';
  const region = (
    <p className="visually-hidden" role="status">
      {spoken}
    </p>
  );
  if (!found)
    return (
      <div className="am-panel">
        {region}
        <p className="dock-empty">Choose a proposal to see its details.</p>
        <LastResult />
      </div>
    );
  const { client, proposal: p } = found;
  // Previous and Next follow the page's order: waiting for a decision, then approved and ready to apply.
  const order = [...client.open.filter(isWaiting), ...client.open.filter((x) => !isWaiting(x))];
  const at = order.findIndex((x) => x.id === p.id);
  const go = (by: -1 | 1) => {
    const to = order[at + by];
    if (to) adStore.set({ selected: { client: client.slug, id: to.id }, panelMode: 'proposal' });
  };
  // Typed text is lost when the next proposal replaces this one, so a step with text in the boxes asks first.
  const step = (by: -1 | 1) => {
    if (dirty) setAskStep(by);
    else go(by);
  };
  const text = full[key];
  const facts = proposalFacts(text ?? p, undefined, approvals?.people);
  const loadText = (open: boolean) => {
    if (!open || full[key]) return;
    api
      .adsProposal(client.slug, p.id)
      .then((r) => adStore.set({ full: { ...adStore.get().full, [key]: r } }))
      .catch((err) =>
        adStore.set({ last: { client: client.slug, id: p.id, ok: false, text: adsErrorText(err) } }),
      );
  };
  return (
    <div className="am-panel">
      {region}
      {order.length > 1 && at >= 0 ? (
        <nav className="am-step" aria-label="Proposals">
          <span className="am-sub" aria-hidden="true">
            {at + 1} of {order.length}
          </span>
          <span className="visually-hidden" aria-live="polite">
            {`Proposal ${at + 1} of ${order.length}, ${p.fm.title}`}
          </span>
          {/* Up and down icon buttons, as the to-do panel steps (design system, Actions rule 11). */}
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous proposal"
            data-tip="Previous proposal"
            aria-disabled={at === 0 || undefined}
            onClick={() => step(-1)}
          >
            <Icon name="up" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next proposal"
            data-tip="Next proposal"
            aria-disabled={at === order.length - 1 || undefined}
            onClick={() => step(1)}
          >
            <Icon name="chevron" size={18} />
          </button>
        </nav>
      ) : null}
      {/* One strip for both: a step from this panel, or what the shell held back (a close, another proposal). */}
      {askStep !== null || panelHold.asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={() => {
            const by = askStep;
            setAskStep(null);
            if (panelHold.asking) dispatch({ type: 'discard-panel' });
            else if (by !== null) {
              setDirty(false);
              go(by);
            }
          }}
          onCancel={() => {
            setAskStep(null);
            if (panelHold.asking) dispatch({ type: 'keep-panel' });
          }}
        />
      ) : null}
      <h3 className="am-title" tabIndex={-1}>
        {p.fm.title}
      </h3>
      <dl className="kv">
        {facts.map(([k, v]) => (
          <div key={k} className="am-kvrow">
            <dt>{k}</dt>
            <dd data-warn={k === 'Warnings' ? 'true' : undefined}>
              {k === 'Status' ? <StatusBadge status={p.fm.status} /> : v}
            </dd>
          </div>
        ))}
      </dl>
      <Fold key={`${key}-text`} title="Full proposal text" defaultOpen={false} onToggle={loadText}>
        {text ? <pre className="am-body">{text.body}</pre> : <StateNote kind="loading" />}
      </Fold>
      <Actions key={key} client={client} p={p} onDirty={setDirty} />
      <LastResult />
    </div>
  );
}
