import { useId, useState } from 'react';
import type { DayEntryView, EntryPatchRequest, EntryValues } from '../../../../shared/time-contract.ts';
import { MAX_DESCRIPTION_LENGTH, MINUTES_PER_DAY } from '../../../../shared/time-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { myDay, useMyDay } from './store.ts';
import { londonClock, londonIso } from './words.ts';

const NEW_VALUES: EntryValues = {
  startAt: null,
  minutes: 30,
  workItemId: null,
  description: '',
  billable: false,
};

/** The right panel: edit one entry, or add one. Reads and changes the day through the store. */
export function MyDayPanel() {
  const s = useMyDay();
  const day = s.day;
  if (!day || !s.date || s.editing === null) {
    return <p className="dock-empty">Choose an entry to edit it, or press Add entry.</p>;
  }
  const entry = s.editing === 'new' ? null : (day.entries.find((e) => e.id === s.editing) ?? null);
  if (s.editing !== 'new' && !entry) {
    return <p className="dock-empty">Choose an entry to edit it, or press Add entry.</p>;
  }
  return (
    <EntryForm
      key={s.editing}
      date={s.date}
      entry={entry}
      privateAllowed={day.privateAllowed}
      workItems={s.workItems}
      busy={s.busy}
    />
  );
}

function EntryForm({
  date,
  entry,
  privateAllowed,
  workItems,
  busy,
}: {
  date: string;
  entry: DayEntryView | null;
  privateAllowed: boolean;
  workItems: ReturnType<typeof useMyDay>['workItems'];
  busy: boolean;
}) {
  const { dispatch, modes } = useShell();
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
  const [error, setError] = useState('');

  const place = entry?.placeLabel ?? null;
  const known = workItems.find((w) => w.id === workItemId);
  const options = [...workItems];
  const orphan = workItemId !== null && !known;
  const descriptionChanged = description !== original.description;
  const workItemChanged = workItemId !== original.workItemId;

  const close = () => {
    myDay.edit(null);
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
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
    if (!Number.isInteger(mins) || mins < 1 || mins > MINUTES_PER_DAY) {
      setError(`Enter whole minutes, from 1 to ${MINUTES_PER_DAY}.`);
      return;
    }
    let startAt: string | null = null;
    if (start !== '') {
      startAt = londonIso(date, start);
      if (!startAt) {
        setError('Enter the start time as hours and minutes.');
        return;
      }
    }
    setError('');
    if (!entry) {
      const ok = await myDay.addEntry({
        values: { startAt, minutes: mins, workItemId, description, billable: workItemId ? billable : false },
      });
      if (ok) close();
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
      close();
      return;
    }
    const ok = await myDay.saveEntry(entry.id, patch);
    if (ok) close();
  };

  const remove = async (asPrivate: boolean) => {
    if (!entry) return;
    setDeleting(false);
    const ok = await myDay.deleteEntry(entry.id, asPrivate);
    if (ok) close();
  };

  return (
    <form
      className="myday-form"
      aria-label={entry ? 'Edit entry' : 'Add entry'}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
    >
      <div className="form-field">
        <label htmlFor={`${id}-desc`}>Description</label>
        <textarea
          id={`${id}-desc`}
          className="field"
          rows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {descriptionChanged && !privateAllowed ? (
          <p className="hint">Toolbox already holds the earlier wording.</p>
        ) : null}
      </div>
      {descriptionChanged && privateAllowed ? (
        <label className="tick-hit">
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
        <label className="tick-hit">
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
            type="time"
            className="field"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-mins`}>Minutes</label>
          <input
            id={`${id}-mins`}
            type="number"
            className="field"
            min={1}
            max={MINUTES_PER_DAY}
            step={1}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>

      <label className="tick-hit">
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

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="myday-form-actions">
        <button type="submit" className="btn" data-variant="primary" aria-disabled={busy || undefined}>
          Save
        </button>
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        {entry && !deleting ? (
          <button
            type="button"
            className="btn"
            data-variant="danger"
            aria-disabled={busy || undefined}
            onClick={() => setDeleting(true)}
          >
            Delete
          </button>
        ) : null}
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
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </form>
  );
}
