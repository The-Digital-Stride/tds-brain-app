import { useEffect, useId, useRef, useState } from 'react';
import type { DayEntryView, EntryPatchRequest, EntryValues } from '../../../../shared/time-contract.ts';
import { MAX_DESCRIPTION_LENGTH, MINUTES_PER_DAY } from '../../../../shared/time-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useUnsavedWork } from '../../tools/ad-manager/unsaved.ts';
import { myDay, useMyDay } from './store.ts';
import {
  CHOOSE_ENTRY,
  chatTitleWords,
  endClock,
  entriesInOrder,
  HINT_RESTRICTED,
  londonClock,
  londonIso,
  minutesError,
  nextNeedingAttention,
  START_ERROR,
  USE_AS_DESCRIPTION,
} from './words.ts';

const NEW_VALUES: EntryValues = {
  startAt: null,
  minutes: 30,
  workItemId: null,
  description: '',
  billable: false,
};

/** A key typed into a field is never a shortcut. */
function isTypingTarget(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable);
}

/** The right panel: edit one entry, or add one. Reads and changes the day through the store. */
export function MyDayPanel() {
  const s = useMyDay();
  const day = s.day;
  if (!day || !s.date || s.editing === null) {
    return <p className="dock-empty">{CHOOSE_ENTRY}</p>;
  }
  const entry = s.editing === 'new' ? null : (day.entries.find((e) => e.id === s.editing) ?? null);
  if (s.editing !== 'new' && !entry) {
    return <p className="dock-empty">{CHOOSE_ENTRY}</p>;
  }
  return (
    <EntryForm
      key={s.editing}
      date={s.date}
      entry={entry}
      order={entriesInOrder(day).map((e) => e.id)}
      privateAllowed={day.privateAllowed}
      workItems={s.workItems}
      busy={s.busy}
    />
  );
}

function EntryForm({
  date,
  entry,
  order,
  privateAllowed,
  workItems,
  busy,
}: {
  date: string;
  entry: DayEntryView | null;
  order: string[];
  privateAllowed: boolean;
  workItems: ReturnType<typeof useMyDay>['workItems'];
  busy: boolean;
}) {
  const { state, dispatch, modes, guardPanel, panelHold } = useShell();
  const id = useId();
  const original = entry?.values ?? NEW_VALUES;
  const originalClock = londonClock(original.startAt) ?? '';
  const [description, setDescription] = useState(original.description);
  const [workItemId, setWorkItemId] = useState<string | null>(original.workItemId);
  const [start, setStart] = useState(originalClock);
  const [minutes, setMinutes] = useState(String(original.minutes));
  const [billable, setBillable] = useState(original.billable);
  const [billableTouched, setBillableTouched] = useState(false);
  const [priv, setPriv] = useState(false);
  const [remember, setRemember] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<{ start?: string; minutes?: string }>({});
  const descriptionBox = useRef<HTMLTextAreaElement>(null);
  const startBox = useRef<HTMLInputElement>(null);
  const minutesBox = useRef<HTMLInputElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const putBack = useRef(false);

  const place = entry?.placeLabel ?? null;
  const known = workItems.find((w) => w.id === workItemId);
  const options = [...workItems];
  const orphan = workItemId !== null && !known;
  const descriptionChanged = description !== original.description;
  const workItemChanged = workItemId !== original.workItemId;
  const dirty =
    descriptionChanged ||
    workItemChanged ||
    start !== originalClock ||
    minutes !== String(original.minutes) ||
    (workItemId ? billable : false) !== original.billable;

  const reset = () => {
    setDescription(original.description);
    setWorkItemId(original.workItemId);
    setStart(originalClock);
    setMinutes(String(original.minutes));
    setBillable(original.billable);
    setBillableTouched(false);
    setPriv(false);
    setErrors({});
  };
  useUnsavedWork(dirty, reset);

  // The form opens with the cursor in Description. The panel's own heading takes focus as it opens, so this waits a beat.
  useEffect(() => {
    const t = setTimeout(() => descriptionBox.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Cancelling the Delete question puts focus back on Delete.
  useEffect(() => {
    if (!deleting && putBack.current) {
      putBack.current = false;
      deleteButton.current?.focus();
    }
  }, [deleting]);

  const stepIds = entry ? order : [];
  const at = entry ? stepIds.indexOf(entry.id) : -1;
  const prevId = at > 0 ? (stepIds[at - 1] ?? null) : null;
  const nextId = at >= 0 ? (stepIds[at + 1] ?? null) : null;
  const step = (to: string | null) => {
    if (to === null || deleting || panelHold.asking) return;
    guardPanel(() => myDay.edit(to));
  };

  // P and N step between entries while focus is not in a field.
  useEffect(() => {
    if (!entry || !state.singleKeys) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if ((key !== 'p' && key !== 'n') || isTypingTarget(document.activeElement)) return;
      if (state.paletteOpen || state.viewer) return;
      e.preventDefault();
      step(key === 'p' ? prevId : nextId);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const closeDock = () => {
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
  };
  /** Closes the form and sends focus to the row it was for, or to Add for a new or deleted entry. */
  const close = (focusTo: string) => {
    myDay.leave(focusTo);
    closeDock();
  };
  const cancel = () => guardPanel(() => close(entry ? `myday:${entry.id}` : 'myday:add'));

  /** After a save: the next entry still short of words or a work item opens; with none left the form closes. */
  const moveOn = () => {
    const day = myDay.get().day;
    const next = entry && day ? nextNeedingAttention(day, entry.id) : null;
    if (next) myDay.edit(next);
    else close(entry ? `myday:${entry.id}` : 'myday:add');
  };

  const pickWorkItem = (value: string) => {
    const next = value === '' ? null : value;
    setWorkItemId(next);
    if (next === null) setBillable(false);
    else if (!billableTouched) {
      const item = workItems.find((w) => w.id === next);
      if (item) setBillable(item.kind !== 'internal');
    }
  };

  const save = async () => {
    const mins = Number(minutes);
    const found: { start?: string; minutes?: string } = {};
    let startAt: string | null = null;
    if (start !== '') {
      startAt = londonIso(date, start);
      if (!startAt) found.start = START_ERROR;
    }
    if (!Number.isInteger(mins) || mins < 1 || mins > MINUTES_PER_DAY) {
      found.minutes = minutesError(MINUTES_PER_DAY);
    }
    setErrors(found);
    if (found.start) {
      startBox.current?.focus();
      return;
    }
    if (found.minutes) {
      minutesBox.current?.focus();
      return;
    }
    if (!entry) {
      const ok = await myDay.addEntry({
        values: { startAt, minutes: mins, workItemId, description, billable: workItemId ? billable : false },
      });
      if (ok) moveOn();
      return;
    }
    const patch: EntryPatchRequest = {};
    if (descriptionChanged) patch.description = description;
    if (workItemChanged) patch.workItemId = workItemId;
    if (start !== originalClock) patch.startAt = startAt;
    if (mins !== original.minutes) patch.minutes = mins;
    const finalBillable = workItemId ? billable : false;
    if (finalBillable !== original.billable) patch.billable = finalBillable;
    if (descriptionChanged && priv && privateAllowed) patch.privateEdit = true;
    if (workItemChanged && place) patch.remember = remember;
    if (Object.keys(patch).length === 0) {
      moveOn();
      return;
    }
    const ok = await myDay.saveEntry(entry.id, patch);
    if (ok) moveOn();
  };

  const remove = async (asPrivate: boolean) => {
    if (!entry) return;
    setDeleting(false);
    const ok = await myDay.deleteEntry(entry.id, asPrivate);
    if (ok) close('myday:add');
  };

  const hint = entry?.titleHint ?? null;
  const canUseHint = entry !== null && hint !== null && entry.hintAcceptable && original.description !== hint;
  /**
   * "Use as description" (plan decision 32): saves the chat's title as an ordinary description edit, logged
   * like any other. It goes through the panel hold, so typed changes are never dropped without asking.
   */
  const acceptHint = () => {
    if (!entry || hint === null || busy) return;
    guardPanel(() => {
      void (async () => {
        const ok = await myDay.saveEntry(entry.id, { description: hint });
        if (ok) {
          setDescription(hint);
          setPriv(false);
        }
      })();
    });
  };

  const times = entry ? endClock(original.startAt, original.minutes) : null;
  const when = times && originalClock ? `${originalClock}–${times}` : null;
  const headingId = `${id}-head`;
  const startErr = errors.start ? `${id}-start-err` : undefined;
  const minutesErr = errors.minutes ? `${id}-mins-err` : undefined;

  return (
    <form
      className="myday-form"
      aria-labelledby={headingId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
      onKeyDown={(e) => {
        // ⌘Enter (Ctrl on Windows) saves and moves on from anywhere in the form.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (!busy) void save();
        }
      }}
    >
      <div className="myday-form-head">
        <div>
          <h3 id={headingId}>{entry ? 'Edit entry' : 'Add an entry'}</h3>
          {when ? <p className="myday-form-when">{when}</p> : null}
        </div>
        {entry ? (
          <div className="myday-step">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous entry"
              data-tip={state.singleKeys ? 'Previous entry (P)' : 'Previous entry'}
              aria-disabled={prevId === null || undefined}
              onClick={() => step(prevId)}
            >
              <Icon name="up" size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next entry"
              data-tip={state.singleKeys ? 'Next entry (N)' : 'Next entry'}
              aria-disabled={nextId === null || undefined}
              onClick={() => step(nextId)}
            >
              <Icon name="chevron" size={18} />
            </button>
          </div>
        ) : null}
      </div>

      {panelHold.asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={() => dispatch({ type: 'discard-panel' })}
          onCancel={() => dispatch({ type: 'keep-panel' })}
        />
      ) : null}

      <div className="form-field">
        <label htmlFor={`${id}-desc`}>Description</label>
        <textarea
          id={`${id}-desc`}
          ref={descriptionBox}
          className="field"
          rows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {descriptionChanged && !privateAllowed ? (
          <p className="hint">Toolbox already holds the earlier wording.</p>
        ) : null}
        {hint !== null ? (
          <div className="myday-title-hint">
            <p className="hint" id={`${id}-hint`}>
              {chatTitleWords(hint)}
            </p>
            {canUseHint ? (
              <button
                type="button"
                className="btn"
                data-size="small"
                aria-describedby={`${id}-hint`}
                aria-disabled={busy || undefined}
                onClick={acceptHint}
              >
                {USE_AS_DESCRIPTION}
              </button>
            ) : null}
            {entry?.hintAcceptable === false ? <p className="hint">{HINT_RESTRICTED}</p> : null}
          </div>
        ) : null}
      </div>
      {descriptionChanged && privateAllowed ? (
        <label className="myday-check">
          <input
            type="checkbox"
            className="tick"
            checked={priv}
            onChange={(e) => setPriv(e.target.checked)}
          />
          This removes private detail
        </label>
      ) : null}

      <div className="form-field">
        <label htmlFor={`${id}-item`}>Work item</label>
        <select
          id={`${id}-item`}
          className="field"
          value={workItemId ?? ''}
          onChange={(e) => pickWorkItem(e.target.value)}
        >
          <option value="">None</option>
          {orphan ? <option value={workItemId ?? ''}>Closed in Toolbox</option> : null}
          {options.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {entry?.workItemClosed ? (
          <p className="hint">This work item is closed in Toolbox. Pick another.</p>
        ) : null}
      </div>
      {entry && place ? (
        <label className="myday-check">
          <input
            type="checkbox"
            className="tick"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember for {place}
        </label>
      ) : null}

      <div className="myday-pair">
        <div className="form-field">
          <label htmlFor={`${id}-start`}>Start time</label>
          <input
            id={`${id}-start`}
            ref={startBox}
            type="time"
            className="field"
            value={start}
            aria-invalid={errors.start ? true : undefined}
            aria-describedby={startErr}
            onChange={(e) => {
              setStart(e.target.value);
              setErrors((x) => ({ ...x, start: undefined }));
            }}
          />
          {errors.start ? (
            <p className="error" id={startErr} role="alert">
              {errors.start}
            </p>
          ) : null}
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-mins`}>Minutes</label>
          <input
            id={`${id}-mins`}
            ref={minutesBox}
            type="number"
            className="field"
            min={1}
            max={MINUTES_PER_DAY}
            step={1}
            inputMode="numeric"
            value={minutes}
            aria-invalid={errors.minutes ? true : undefined}
            aria-describedby={minutesErr}
            onChange={(e) => {
              setMinutes(e.target.value);
              setErrors((x) => ({ ...x, minutes: undefined }));
            }}
          />
          {errors.minutes ? (
            <p className="error" id={minutesErr} role="alert">
              {errors.minutes}
            </p>
          ) : null}
        </div>
      </div>

      <label className="myday-check">
        <input
          type="checkbox"
          className="tick"
          checked={workItemId ? billable : false}
          disabled={!workItemId}
          aria-describedby={workItemId ? undefined : `${id}-bill`}
          onChange={(e) => {
            setBillable(e.target.checked);
            setBillableTouched(true);
          }}
        />
        Billable
      </label>
      {workItemId ? null : (
        <p className="hint" id={`${id}-bill`}>
          Pick a work item before marking time as billable.
        </p>
      )}

      <div className="myday-form-actions" data-item={entry ? 'true' : undefined}>
        {entry && !deleting ? (
          // Delete leads to a question, so it is a plain button; the red one is inside the question.
          <button
            ref={deleteButton}
            type="button"
            className="btn myday-delete"
            aria-disabled={busy || undefined}
            onClick={() => setDeleting(true)}
          >
            Delete
          </button>
        ) : null}
        <div className="myday-form-main">
          <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
            Save
          </button>
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
      {entry && deleting ? (
        <Confirm
          label="Delete this entry"
          text="Delete this entry from the day?"
          action="Delete"
          variant="danger"
          busy={busy}
          extra={
            privateAllowed ? { label: 'Remove as private', onChoose: () => void remove(true) } : undefined
          }
          onConfirm={() => void remove(false)}
          onCancel={() => {
            putBack.current = true;
            setDeleting(false);
          }}
        />
      ) : null}
    </form>
  );
}
